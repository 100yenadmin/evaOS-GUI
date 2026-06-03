/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvaosBrokerSessionClient } from '@/process/services/evaosBrokerSession';

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: vi.fn(() => ({
      provider: vi.fn(),
      invoke: vi.fn(),
    })),
    buildEmitter: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn(),
    })),
  },
  storage: {
    buildStorage: () => ({
      getSync: () => undefined,
      setSync: () => {},
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
    }),
  },
}));

async function loadTrustSurfaceBridge() {
  vi.resetModules();
  const peopleBridge = await import('@process/bridge/evaosPeopleAccessBridge');
  const { ipcBridge } = await import('@/common');
  return { ...peopleBridge, ipcBridge };
}

function lastProviderHandler(provider: { mock: { calls: Array<[Function]> } }): Function {
  const call = provider.mock.calls.at(-1);
  if (!call) throw new Error('provider handler was not registered');
  return call[0];
}

describe('evaOS trust-surface bridge renderer secret boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed when Connected Apps returns raw provider secret material through IPC', async () => {
    const { initEvaosProviderHubBridge, ipcBridge } = await loadTrustSurfaceBridge();
    const client = {
      providerHub: vi.fn(async () => ({
        schemaVersion: 'evaos.provider_hub.v1',
        customerId: 'cus_123',
        routeDenied: false,
        profiles: [
          {
            providerKey: 'google_workspace',
            status: 'connected',
            accountLabel: 'sales@example.test',
            access_token: 'raw-provider-token-should-not-render',
          },
        ],
      })),
    } as unknown as EvaosBrokerSessionClient;

    initEvaosProviderHubBridge(client);

    const handler = lastProviderHandler(vi.mocked(ipcBridge.evaosProviderHub.getProfiles.provider));
    const response = await handler({ customerId: 'cus_123' });

    expect(response).toEqual({
      success: false,
      msg: 'The evaOS broker response included renderer-visible secret material at $.profiles[0].access_token.',
    });
  });
});
