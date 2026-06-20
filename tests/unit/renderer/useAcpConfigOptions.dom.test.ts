/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import { useAcpConfigOptions } from '@/renderer/hooks/agent/useAcpConfigOptions';

const { getConfigOptionsInvokeMock, setConfigOptionInvokeMock, responseStreamHandlerRef } = vi.hoisted(() => ({
  getConfigOptionsInvokeMock: vi.fn(),
  setConfigOptionInvokeMock: vi.fn(),
  responseStreamHandlerRef: {
    current: undefined as ((message: IResponseMessage) => void) | undefined,
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      getConfigOptions: { invoke: getConfigOptionsInvokeMock },
      setConfigOption: { invoke: setConfigOptionInvokeMock },
      responseStream: {
        on: vi.fn().mockImplementation((handler: (message: IResponseMessage) => void) => {
          responseStreamHandlerRef.current = handler;
          return vi.fn();
        }),
      },
    },
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

describe('useAcpConfigOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responseStreamHandlerRef.current = undefined;
    getConfigOptionsInvokeMock.mockResolvedValue({
      config_options: [
        {
          id: 'model',
          category: 'model',
          type: 'select',
          current_value: 'gpt-5.2',
          options: [
            { value: 'gpt-5.2', label: 'GPT-5.2' },
            { value: 'gpt-5.2-mini', label: 'GPT-5.2 Mini' },
          ],
        },
        {
          id: 'reasoning_effort',
          category: 'thought_level',
          type: 'select',
          selected_value: 'high',
          options: [
            { value: 'low', label: 'Low', description: 'Fast' },
            { value: 'high', label: 'High', description: 'Careful' },
          ],
        },
      ],
    });
  });

  it('treats 404 as capability absence instead of an error', async () => {
    getConfigOptionsInvokeMock.mockRejectedValue(
      new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/conv-1/config-options',
        status: 404,
        body: { success: false, code: 'NOT_FOUND', error: 'no config options' },
      })
    );

    const { result } = renderHook(() => useAcpConfigOptions({ conversation_id: 'conv-1' }), {
      wrapper: createSwrWrapper(),
    });

    await waitFor(() => {
      expect(getConfigOptionsInvokeMock).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    });
    expect(result.current.configOptions).toBeNull();
    expect(result.current.model).toBeNull();
    expect(result.current.thoughtLevel).toBeNull();
  });

  it('derives model and thought-level options from observed config options', async () => {
    const { result } = renderHook(() => useAcpConfigOptions({ conversation_id: 'conv-1' }), {
      wrapper: createSwrWrapper(),
    });

    await waitFor(() => {
      expect(result.current.model?.currentValue).toBe('gpt-5.2');
    });
    expect(result.current.model?.options).toEqual([
      { value: 'gpt-5.2', label: 'GPT-5.2', description: undefined },
      { value: 'gpt-5.2-mini', label: 'GPT-5.2 Mini', description: undefined },
    ]);
    expect(result.current.thoughtLevel?.currentValue).toBe('high');
    expect(result.current.thoughtLevel?.options[1]?.description).toBe('Careful');
  });

  it('clears stale options when a later runtime refresh reports no config capability', async () => {
    const { result } = renderHook(() => useAcpConfigOptions({ conversation_id: 'conv-1' }), {
      wrapper: createSwrWrapper(),
    });

    await waitFor(() => {
      expect(result.current.model?.currentValue).toBe('gpt-5.2');
    });

    getConfigOptionsInvokeMock.mockRejectedValue(
      new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/conv-1/config-options',
        status: 404,
        body: { success: false, code: 'NOT_FOUND', error: 'no config options' },
      })
    );

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'agent_status',
        conversation_id: 'conv-1',
        data: { status: 'session_active' },
      } as unknown as IResponseMessage);
    });

    await waitFor(() => {
      expect(result.current.model).toBeNull();
    });
    expect(result.current.thoughtLevel).toBeNull();
  });

  it('requires observed confirmation before accepting a config update', async () => {
    setConfigOptionInvokeMock.mockResolvedValue({ confirmation: 'command_ack', config_options: null });

    const { result } = renderHook(() => useAcpConfigOptions({ conversation_id: 'conv-1' }), {
      wrapper: createSwrWrapper(),
    });

    await waitFor(() => {
      expect(result.current.model?.id).toBe('model');
    });

    await expect(result.current.setConfigOption('model', 'gpt-5.2-mini')).rejects.toThrow('command_ack');
  });

  it('updates one conversation from stream evidence without leaking to another', async () => {
    const wrapperA = createSwrWrapper();
    const wrapperB = createSwrWrapper();
    const first = renderHook(() => useAcpConfigOptions({ conversation_id: 'conv-1' }), { wrapper: wrapperA });
    const second = renderHook(() => useAcpConfigOptions({ conversation_id: 'conv-2' }), { wrapper: wrapperB });

    await waitFor(() => {
      expect(first.result.current.model?.currentValue).toBe('gpt-5.2');
      expect(second.result.current.model?.currentValue).toBe('gpt-5.2');
    });

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'acp_config_option',
        conversation_id: 'conv-2',
        data: {
          config_options: [
            {
              id: 'model',
              category: 'model',
              type: 'select',
              current_value: 'gpt-5.2-mini',
              options: [{ value: 'gpt-5.2-mini', label: 'GPT-5.2 Mini' }],
            },
          ],
        },
      } as unknown as IResponseMessage);
    });

    await waitFor(() => {
      expect(second.result.current.model?.currentValue).toBe('gpt-5.2-mini');
    });
    expect(first.result.current.model?.currentValue).toBe('gpt-5.2');
  });
});
