/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platformMock = vi.hoisted(() => ({
  adapter: vi.fn(),
  loggerProvider: vi.fn(),
}));

vi.mock('@office-ai/platform', () => ({
  bridge: {
    adapter: platformMock.adapter,
  },
  logger: {
    provider: platformMock.loggerProvider,
  },
}));

vi.mock('@/common/config/constants', () => ({
  WEBUI_DEFAULT_PORT: 13400,
}));

describe('Electron browser adapter provider ordering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    platformMock.adapter.mockClear();
    platformMock.loggerProvider.mockClear();
    (window as typeof window & { electronAPI?: unknown }).electronAPI = {
      emit: vi.fn().mockResolvedValue('ok'),
      on: vi.fn(),
    };
  });

  afterEach(() => {
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps ordinary Electron IPC emits immediate', async () => {
    await import('@/common/adapter/browser');
    const adapter = platformMock.adapter.mock.calls[0]?.[0];
    const electronAPI = (window as typeof window & { electronAPI: { emit: ReturnType<typeof vi.fn> } }).electronAPI;

    const result = adapter.emit('window-controls:minimize', undefined);

    expect(electronAPI.emit).toHaveBeenCalledWith('window-controls:minimize', undefined);
    await expect(result).resolves.toBe('ok');
  });

  it('defers provider requests so callback listeners can register before fast main-process replies', async () => {
    await import('@/common/adapter/browser');
    const adapter = platformMock.adapter.mock.calls[0]?.[0];
    const electronAPI = (window as typeof window & { electronAPI: { emit: ReturnType<typeof vi.fn> } }).electronAPI;

    const result = adapter.emit('subscribe-evaos.broker.session-status', {
      id: 'provider-call',
      data: undefined,
    });

    expect(electronAPI.emit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(24);
    expect(electronAPI.emit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(electronAPI.emit).toHaveBeenCalledWith('subscribe-evaos.broker.session-status', {
      id: 'provider-call',
      data: undefined,
    });
    await expect(result).resolves.toBe('ok');
  });

  it('uses late-injected Electron IPC from the WebSocket adapter path', async () => {
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
    vi.stubGlobal('WebSocket', FakeWebSocket);

    await import('@/common/adapter/browser');
    const adapter = platformMock.adapter.mock.calls[0]?.[0];
    (window as typeof window & { electronAPI?: unknown }).electronAPI = {
      emit: vi.fn().mockResolvedValue('late-ok'),
      on: vi.fn(),
    };
    const electronAPI = (window as typeof window & { electronAPI: { emit: ReturnType<typeof vi.fn> } }).electronAPI;

    const result = adapter.emit('subscribe-evaos.broker.session-status', {
      id: 'late-provider-call',
      data: undefined,
    });

    expect(electronAPI.emit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(25);

    expect(electronAPI.emit).toHaveBeenCalledWith('subscribe-evaos.broker.session-status', {
      id: 'late-provider-call',
      data: undefined,
    });
    await expect(result).resolves.toBe('late-ok');
  });
});

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;

  addEventListener = vi.fn();
  close = vi.fn();
  send = vi.fn();
}
