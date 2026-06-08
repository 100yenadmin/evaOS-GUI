/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platformMock = vi.hoisted(() => ({
  providers: new Map<string, { provider: ReturnType<typeof vi.fn>; invoke: ReturnType<typeof vi.fn> }>(),
  buildProvider: vi.fn((name: string) => {
    const provider = {
      provider: vi.fn(),
      invoke: vi.fn().mockResolvedValue({ source: 'platform', name }),
    };
    platformMock.providers.set(name, provider);
    return provider;
  }),
  buildEmitter: vi.fn(() => ({
    emit: vi.fn(),
    on: vi.fn(),
  })),
}));

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildEmitter: platformMock.buildEmitter,
    buildProvider: platformMock.buildProvider,
  },
}));

describe('evaOS IPC bridge provider wrapper', () => {
  const callbacks: Array<(event: { value: string }) => void> = [];

  beforeEach(() => {
    vi.resetModules();
    platformMock.providers.clear();
    platformMock.buildProvider.mockClear();
    platformMock.buildEmitter.mockClear();
    callbacks.length = 0;
  });

  afterEach(() => {
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
    delete (
      window as typeof window & {
        __evaosProviderCallbackInstalled?: boolean;
        __evaosProviderCallbacks?: unknown;
      }
    ).__evaosProviderCallbackInstalled;
    delete (
      window as typeof window & {
        __evaosProviderCallbackInstalled?: boolean;
        __evaosProviderCallbacks?: unknown;
      }
    ).__evaosProviderCallbacks;
  });

  it('registers evaOS Electron provider callbacks before emitting provider requests', async () => {
    const callOrder: string[] = [];
    (window as typeof window & { electronAPI?: unknown }).electronAPI = {
      on: vi.fn((callback: (event: { value: string }) => void) => {
        callOrder.push('on');
        callbacks.push(callback);
      }),
      emit: vi.fn((name: string, data: unknown) => {
        callOrder.push('emit');
        const request = data as { id: string };
        const providerName = name.replace(/^subscribe-/, '');
        const responseName = `subscribe.callback-${providerName}${request.id}`;
        callbacks.forEach((callback) => {
          callback({
            value: JSON.stringify({
              name: responseName,
              data: { success: true, data: { userEmail: 'admin@100yen.org' } },
            }),
          });
        });
      }),
    };

    const { evaosBroker } = await import('@/common/adapter/ipcBridge');

    await expect(evaosBroker.getSessionStatus.invoke()).resolves.toEqual({
      success: true,
      data: { userEmail: 'admin@100yen.org' },
    });

    const electronAPI = (
      window as typeof window & {
        electronAPI: { emit: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
      }
    ).electronAPI;
    expect(callOrder.slice(0, 2)).toEqual(['on', 'emit']);
    expect(electronAPI.on).toHaveBeenCalledTimes(1);
    expect(electronAPI.emit).toHaveBeenCalledWith(
      'subscribe-evaos.broker.session-status',
      expect.objectContaining({ data: undefined })
    );
    expect(platformMock.providers.get('evaos.broker.session-status')?.invoke).not.toHaveBeenCalled();
  });

  it('fails closed when Electron IPC is unavailable', async () => {
    const { evaosBroker } = await import('@/common/adapter/ipcBridge');

    await expect(evaosBroker.getSessionStatus.invoke()).rejects.toThrow(
      'evaOS Electron IPC bridge unavailable for evaos.broker.session-status'
    );

    expect(platformMock.providers.get('evaos.broker.session-status')?.invoke).not.toHaveBeenCalled();
  });
});
