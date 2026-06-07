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

async function loadBrokerBridge() {
  vi.resetModules();
  const brokerBridge = await import('@process/bridge/evaosBrokerBridge');
  const { ipcBridge } = await import('@/common');
  return { ...brokerBridge, ipcBridge };
}

function lastProviderHandler(provider: { mock: { calls: Array<[Function]> } }): Function {
  const call = provider.mock.calls.at(-1);
  if (!call) throw new Error('provider handler was not registered');
  return call[0];
}

describe('evaOS broker bridge renderer secret boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AIONUI_E2E_TEST;
    delete process.env.AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE;
  });

  it('accepts sanitized broker status payloads', async () => {
    const { assertEvaosRendererSafePayload } = await loadBrokerBridge();

    expect(() =>
      assertEvaosRendererSafePayload({
        state: 'authenticated',
        authenticated: true,
        expired: false,
        userEmail: 'operator@example.test',
        source: 'memory',
        message: 'evaOS desktop session is active.',
      })
    ).not.toThrow();
  });

  it('rejects secret-looking fields and values before they can cross generic IPC', async () => {
    const { assertEvaosRendererSafePayload } = await loadBrokerBridge();

    expect(() =>
      assertEvaosRendererSafePayload({
        desktop_session: 'eds_created_session_secret_for_test',
      })
    ).toThrow(/renderer-visible secret material/);

    expect(() =>
      assertEvaosRendererSafePayload({
        currentUrlSummary: {
          displayText: 'app.example.test/callback#Bearer eyJheader.payload.signature',
        },
      })
    ).toThrow(/renderer-visible secret material/);

    expect(() =>
      assertEvaosRendererSafePayload({
        actions: ['open', 'provider_grant_handle=epg_raw_provider_grant'],
      })
    ).toThrow(/renderer-visible secret material/);
  });

  it('fails closed when a broker client accidentally returns desktop-session material through IPC', async () => {
    const { initEvaosBrokerBridge, ipcBridge } = await loadBrokerBridge();
    const client = {
      claimDeviceCode: vi.fn(async () => ({
        state: 'authenticated',
        authenticated: true,
        expired: false,
        source: 'memory',
        message: 'evaOS desktop session is active.',
        desktop_session: 'eds_created_session_secret_for_test',
      })),
      getSessionStatus: vi.fn(() => ({
        state: 'authenticated',
        authenticated: true,
        expired: false,
        source: 'memory',
        message: 'evaOS desktop session is active.',
      })),
      runtimeStatus: vi.fn(),
      revokeSession: vi.fn(),
    } as unknown as EvaosBrokerSessionClient;

    initEvaosBrokerBridge(client);

    const handler = lastProviderHandler(vi.mocked(ipcBridge.evaosBroker.claimDeviceCode.provider));
    const response = await handler({ deviceCode: 'AB123' });

    expect(response).toEqual({
      success: false,
      msg: 'The evaOS broker response included renderer-visible secret material at $.desktop_session.',
    });
  });

  it('routes runtime status through the local product fixture only when explicitly enabled', async () => {
    process.env.AIONUI_E2E_TEST = '1';
    process.env.AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE = '1';
    const { initEvaosBrokerBridge, ipcBridge } = await loadBrokerBridge();
    const client = {
      runtimeStatus: vi.fn(async () => {
        throw new Error('live runtime status should not be called in local fixture mode');
      }),
    } as unknown as EvaosBrokerSessionClient;

    initEvaosBrokerBridge(client);

    const handler = lastProviderHandler(vi.mocked(ipcBridge.evaosBroker.runtimeStatus.provider));
    const response = await handler({ customerId: 'fixture-customer-acme', runtime: 'openclaw' });

    expect(response).toMatchObject({
      success: true,
      data: {
        runtimeKey: 'openclaw',
        status: 'running',
        sourcePointer: 'local-fixture:runtime:openclaw',
        auditId: 'fixture-audit-runtime-openclaw',
      },
    });
    expect(client.runtimeStatus).not.toHaveBeenCalled();
  });

  it('routes runtime actions through the local product fixture only when explicitly enabled', async () => {
    process.env.AIONUI_E2E_TEST = '1';
    process.env.AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE = '1';
    const { initEvaosBrokerBridge, ipcBridge } = await loadBrokerBridge();
    const client = {
      runtimeAction: vi.fn(async () => {
        throw new Error('live runtime action should not be called in local fixture mode');
      }),
    } as unknown as EvaosBrokerSessionClient;

    initEvaosBrokerBridge(client);

    const handler = lastProviderHandler(vi.mocked(ipcBridge.evaosBroker.runtimeAction.provider));
    const response = await handler({ customerId: 'fixture-customer-acme', runtime: 'openclaw', action: 'launch' });

    expect(response).toMatchObject({
      success: true,
      data: {
        runtimeKey: 'openclaw',
        status: 'opened',
        sourcePointer: 'local-fixture:runtime-action:openclaw:launch',
        auditId: 'fixture-audit-runtime-action-openclaw-launch',
        backendEnforced: true,
      },
    });
    expect(JSON.stringify(response)).not.toMatch(/eds_|epg_|desktop_session|provider_grant|Bearer|launch_url/i);
    expect(client.runtimeAction).not.toHaveBeenCalled();
  });
});
