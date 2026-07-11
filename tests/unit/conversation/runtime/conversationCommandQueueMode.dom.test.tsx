/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
import {
  type ConversationCommandQueueRuntimeGate,
  useConversationCommandQueue,
} from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const createSwrWrapper = () => {
  const cache = new Map();
  return function SwrTestWrapper({ children }: PropsWithChildren) {
    return createElement(
      SWRConfig,
      {
        value: {
          provider: () => cache,
          dedupingInterval: 0,
          revalidateOnFocus: false,
          revalidateOnReconnect: false,
        },
      },
      children
    );
  };
};

const processingGate: ConversationCommandQueueRuntimeGate = {
  hydrated: true,
  canSendMessage: true,
  isProcessing: true,
};

const idleGate: ConversationCommandQueueRuntimeGate = {
  hydrated: true,
  canSendMessage: true,
  isProcessing: false,
};

const storageKey = (conversationId: string) => `conversation-command-queue/${conversationId}`;

const createDeferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const renderQueue = ({
  conversation_id,
  runtimeGate,
  isBusy = false,
  onExecute = vi.fn().mockResolvedValue(undefined),
}: {
  conversation_id: string;
  runtimeGate: ConversationCommandQueueRuntimeGate;
  isBusy?: boolean;
  onExecute?: (item: Parameters<Parameters<typeof useConversationCommandQueue>[0]['onExecute']>[0]) => Promise<void>;
}) =>
  renderHook(
    ({ gate, busy, id = conversation_id }: { gate: ConversationCommandQueueRuntimeGate; busy: boolean; id?: string }) =>
      useConversationCommandQueue({
        conversation_id: id,
        enabled: true,
        isBusy: busy,
        runtimeGate: gate,
        onExecute,
      }),
    {
      initialProps: { gate: runtimeGate, busy: isBusy, id: conversation_id },
      wrapper: createSwrWrapper(),
    }
  );

describe('useConversationCommandQueue mode & send-now', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('defaults to auto mode', () => {
    const { result } = renderQueue({ conversation_id: 'conv-auto', runtimeGate: processingGate });
    expect(result.current.mode).toBe('auto');
  });

  it('toggles between auto and manual', async () => {
    const { result } = renderQueue({ conversation_id: 'conv-toggle', runtimeGate: processingGate });

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('manual'));

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('auto'));
  });

  it('does NOT auto-send queued commands while in manual mode', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderQueue({
      conversation_id: 'conv-manual',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('manual'));

    act(() => {
      result.current.enqueue({ input: 'stay queued', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    // Even when the runtime goes idle, manual mode must not drain automatically.
    rerender({ gate: idleGate, busy: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onExecute).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(1);
  });

  it('auto-sends again after switching manual back to auto', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderQueue({
      conversation_id: 'conv-manual-auto',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('manual'));

    act(() => {
      result.current.enqueue({ input: 'queued follow-up', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    rerender({ gate: idleGate, busy: false });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onExecute).not.toHaveBeenCalled();

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
  });

  it('sendNow executes the targeted command and leaves the rest queued', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const { result } = renderQueue({
      conversation_id: 'conv-sendnow',
      runtimeGate: processingGate,
      onExecute,
    });

    // Manual mode so nothing drains on its own — isolates sendNow behavior.
    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('manual'));

    act(() => {
      result.current.enqueue({ input: 'first', files: [] });
    });
    act(() => {
      result.current.enqueue({ input: 'second', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    const second = result.current.items[1];
    act(() => {
      result.current.sendNow(second.id);
    });

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ input: 'second' }));
    // The other command stays queued and manual mode is preserved.
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].input).toBe('first');
    expect(result.current.mode).toBe('manual');
  });

  it('keeps an explicitly paused auto queue paused after Send now completes', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const stopDeferred = createDeferred();
    const onStop = vi.fn(() => stopDeferred.promise);
    const { result, rerender } = renderQueue({
      conversation_id: 'conv-paused-sendnow',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.enqueue({ input: 'first', files: [] });
      result.current.enqueue({ input: 'second', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => {
      result.current.pause();
    });
    await waitFor(() => expect(result.current.isPaused).toBe(true));

    act(() => {
      result.current.sendNow(result.current.items[1].id, onStop);
    });
    await waitFor(() => expect(onStop).toHaveBeenCalledTimes(1));
    rerender({ gate: idleGate, busy: false });
    await act(async () => {
      stopDeferred.resolve();
      await stopDeferred.promise;
    });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));

    rerender({ gate: processingGate, busy: true });
    rerender({ gate: idleGate, busy: false });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(result.current.items.map((item) => item.input)).toEqual(['first']);
    expect(result.current.isPaused).toBe(true);
  });

  it('resumes auto-drain only after the Send now turn is observed complete', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const stopDeferred = createDeferred();
    const onStop = vi.fn(() => stopDeferred.promise);
    const { result, rerender } = renderQueue({
      conversation_id: 'conv-auto-sendnow',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.enqueue({ input: 'first', files: [] });
      result.current.enqueue({ input: 'second', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => {
      result.current.sendNow(result.current.items[1].id, onStop);
    });
    await waitFor(() => expect(onStop).toHaveBeenCalledTimes(1));
    rerender({ gate: idleGate, busy: false });
    await act(async () => {
      stopDeferred.resolve();
      await stopDeferred.promise;
    });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    expect(onExecute.mock.calls[0][0]).toEqual(expect.objectContaining({ input: 'second' }));

    rerender({ gate: processingGate, busy: true });
    rerender({ gate: idleGate, busy: false });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(2));
    expect(onExecute.mock.calls[1][0]).toEqual(expect.objectContaining({ input: 'first' }));
  });

  it('does not stop an idle runtime before Send now', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const onStop = vi.fn().mockResolvedValue(undefined);
    const { result } = renderQueue({
      conversation_id: 'conv-idle-sendnow',
      runtimeGate: idleGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('manual'));
    act(() => {
      result.current.enqueue({ input: 'idle target', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => {
      result.current.sendNow(result.current.items[0].id, onStop);
    });

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    expect(onStop).not.toHaveBeenCalled();
  });

  it('serializes rapid Send now requests before the runtime reports processing', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const { result } = renderQueue({
      conversation_id: 'conv-sendnow-single-flight',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('manual'));
    act(() => {
      result.current.enqueue({ input: 'first', files: [] });
      result.current.enqueue({ input: 'second', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => {
      result.current.sendNow(result.current.items[0].id);
      result.current.sendNow(result.current.items[1].id);
    });

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
  });

  it('keeps an Auto draft queued when stopping the active turn fails', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const onStop = vi.fn().mockRejectedValue(new Error('cancel failed'));
    const { result } = renderQueue({
      conversation_id: 'conv-stop-failure',
      runtimeGate: processingGate,
      onExecute,
    });

    expect(result.current.mode).toBe('auto');
    act(() => {
      result.current.enqueue({ input: 'kept target', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => {
      result.current.sendNow(result.current.items[0].id, onStop);
    });

    await waitFor(() => expect(onStop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(Message.warning).toHaveBeenCalled());
    expect(onExecute).not.toHaveBeenCalled();
    expect(result.current.items.map((item) => item.input)).toEqual(['kept target']);
    expect(result.current.mode).toBe('auto');
  });

  it('restores manual mode from persisted storage', async () => {
    sessionStorage.setItem(
      storageKey('conv-persist'),
      JSON.stringify({
        items: [{ id: 'q1', input: 'kept', files: [], created_at: 1 }],
        isPaused: false,
        mode: 'manual',
      })
    );

    const onExecute = vi.fn().mockResolvedValue(undefined);
    const { result } = renderQueue({
      conversation_id: 'conv-persist',
      runtimeGate: idleGate,
      onExecute,
    });

    await waitFor(() => expect(result.current.mode).toBe('manual'));
    // Manual mode restored → must not auto-drain even though runtime is idle.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onExecute).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(1);
  });

  it('migrates persisted queue state without a mode to auto', async () => {
    sessionStorage.setItem(
      storageKey('conv-legacy'),
      JSON.stringify({
        items: [{ id: 'q1', input: 'legacy', files: [], created_at: 1 }],
        isPaused: false,
      })
    );

    const { result } = renderQueue({
      conversation_id: 'conv-legacy',
      runtimeGate: processingGate,
    });

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.mode).toBe('auto');
  });

  it('restores a failed send-now item in place and pauses the queue', async () => {
    const onExecute = vi.fn().mockRejectedValue(new Error('send failed'));
    const { result } = renderQueue({
      conversation_id: 'conv-sendnow-failure',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('manual'));

    act(() => {
      result.current.enqueue({ input: 'first', files: [] });
      result.current.enqueue({ input: 'second', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    const second = result.current.items[1];
    act(() => {
      result.current.sendNow(second.id);
    });

    await waitFor(() => expect(result.current.isPaused).toBe(true));
    expect(result.current.items.map((item) => item.input)).toEqual(['first', 'second']);
    expect(result.current.mode).toBe('manual');
  });

  it('keeps manual mode when clearing the draft box', async () => {
    const { result } = renderQueue({
      conversation_id: 'conv-clear-manual',
      runtimeGate: processingGate,
    });

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('manual'));
    act(() => {
      result.current.enqueue({ input: 'clear me', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => {
      result.current.clear();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(0));
    expect(result.current.mode).toBe('manual');
  });

  it('does not resurrect a failed in-flight item after clear', async () => {
    const deferred = createDeferred();
    const onExecute = vi.fn(() => deferred.promise);
    const { result } = renderQueue({
      conversation_id: 'conv-clear-in-flight',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('manual'));
    act(() => {
      result.current.enqueue({ input: 'in flight', files: [] });
      result.current.enqueue({ input: 'also clear', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => {
      result.current.sendNow(result.current.items[0].id);
    });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.clear();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(0));

    await act(async () => {
      deferred.reject(new Error('late failure'));
      await deferred.promise.catch(() => {});
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current.items).toHaveLength(0);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.mode).toBe('manual');
    const persisted = sessionStorage.getItem(storageKey('conv-clear-in-flight'));
    expect(persisted).not.toContain('in flight');
    expect(persisted).not.toContain('also clear');
    expect(JSON.parse(persisted ?? '{}')).toMatchObject({ items: [], mode: 'manual' });
  });

  it('does not let a stale send-now release a newer reservation', async () => {
    const firstStop = createDeferred();
    const secondStop = createDeferred();
    const thirdStop = vi.fn().mockResolvedValue(undefined);
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const { result } = renderQueue({
      conversation_id: 'conv-sendnow-reservation-owner',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
      result.current.enqueue({ input: 'stale first', files: [] });
    });
    await waitFor(() => expect(result.current.mode).toBe('manual'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => {
      result.current.sendNow(result.current.items[0].id, () => firstStop.promise);
    });
    act(() => {
      result.current.clear();
      result.current.enqueue({ input: 'new second', files: [] });
      result.current.enqueue({ input: 'new third', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => {
      result.current.sendNow(result.current.items[0].id, () => secondStop.promise);
    });
    await act(async () => {
      firstStop.resolve();
      await firstStop.promise;
    });
    act(() => {
      result.current.sendNow(result.current.items[1].id, thirdStop);
    });

    expect(thirdStop).not.toHaveBeenCalled();
    expect(onExecute).not.toHaveBeenCalled();

    await act(async () => {
      secondStop.resolve();
      await secondStop.promise;
    });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
  });

  it('does not execute an invalidated send-now after an ordinary stop reset', async () => {
    const firstStop = createDeferred();
    const secondStop = createDeferred();
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const { result } = renderQueue({
      conversation_id: 'conv-sendnow-reset-owner',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
      result.current.enqueue({ input: 'first pending stop', files: [] });
      result.current.enqueue({ input: 'second pending stop', files: [] });
    });
    await waitFor(() => expect(result.current.mode).toBe('manual'));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => {
      result.current.sendNow(result.current.items[0].id, () => firstStop.promise);
      result.current.resetActiveExecution('stop');
      result.current.sendNow(result.current.items[1].id, () => secondStop.promise);
    });

    await act(async () => {
      firstStop.resolve();
      await firstStop.promise;
    });
    expect(onExecute).not.toHaveBeenCalled();
    expect(result.current.items.map((item) => item.input)).toEqual(['first pending stop', 'second pending stop']);

    await act(async () => {
      secondStop.resolve();
      await secondStop.promise;
    });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    expect(onExecute.mock.calls[0][0].input).toBe('second pending stop');
    expect(result.current.items.map((item) => item.input)).toEqual(['first pending stop']);
  });

  it('re-resolves a queued draft after a slow stop before sending', async () => {
    const stop = createDeferred();
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const { result } = renderQueue({
      conversation_id: 'conv-sendnow-edit-during-stop',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
      result.current.enqueue({ input: 'before edit', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const commandId = result.current.items[0].id;

    act(() => {
      result.current.sendNow(commandId, () => stop.promise);
      result.current.update(commandId, { input: 'after edit' });
    });
    await act(async () => {
      stop.resolve();
      await stop.promise;
    });

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    expect(onExecute.mock.calls[0][0].input).toBe('after edit');
  });

  it('does not send a queued draft removed during a slow stop', async () => {
    const stop = createDeferred();
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const { result } = renderQueue({
      conversation_id: 'conv-sendnow-remove-during-stop',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
      result.current.enqueue({ input: 'remove during stop', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const commandId = result.current.items[0].id;

    act(() => {
      result.current.sendNow(commandId, () => stop.promise);
      result.current.remove(commandId);
    });
    await act(async () => {
      stop.resolve();
      await stop.promise;
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onExecute).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(0);
  });

  it('resets in-flight send lifecycle when the conversation changes', async () => {
    const firstStop = createDeferred();
    const secondStop = createDeferred();
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderQueue({
      conversation_id: 'conv-route-a',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
      result.current.enqueue({ input: 'conversation A draft', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => {
      result.current.sendNow(result.current.items[0].id, () => firstStop.promise);
    });

    rerender({ gate: processingGate, busy: false, id: 'conv-route-b' });
    await waitFor(() => expect(result.current.items).toHaveLength(0));
    act(() => {
      result.current.toggleMode();
      result.current.enqueue({ input: 'conversation B draft', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => {
      result.current.sendNow(result.current.items[0].id, () => secondStop.promise);
    });

    await act(async () => {
      firstStop.resolve();
      await firstStop.promise;
    });
    expect(onExecute).not.toHaveBeenCalled();

    await act(async () => {
      secondStop.resolve();
      await secondStop.promise;
    });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    expect(onExecute.mock.calls[0][0].input).toBe('conversation B draft');
  });
});
