/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVAOS_DESKTOP_RUNTIME_SESSION_ENDPOINT,
  EvaosBrokerSessionClient,
  EvaosBrokerSessionError,
  type EvaosBrokerFetch,
} from '@/process/services/evaosBrokerSession';

const NOW = new Date('2026-06-03T12:00:00.000Z');
const FUTURE = '2026-06-03T16:00:00.000Z';
const PAST = '2026-06-03T08:00:00.000Z';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function fetchMock(): ReturnType<typeof vi.fn<EvaosBrokerFetch>> {
  return vi.fn<EvaosBrokerFetch>();
}

function requestBody(call: Parameters<EvaosBrokerFetch>): Record<string, unknown> {
  const init = call[1];
  expect(init?.body).toBeTypeOf('string');
  return JSON.parse(init?.body as string) as Record<string, unknown>;
}

function requestHeaders(call: Parameters<EvaosBrokerFetch>): Record<string, string> {
  return call[1]?.headers as Record<string, string>;
}

describe('EvaosBrokerSessionClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed without calling the broker when no desktop session exists', async () => {
    const fetchImpl = fetchMock();
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await expect(client.runtimeStatus({ customerId: 'cus_123', runtime: 'browser' })).rejects.toMatchObject({
      code: 'missing_session',
      message: 'Sign in to evaOS before checking runtime status.',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(client.getSessionStatus()).toEqual({
      state: 'missing',
      authenticated: false,
      expired: false,
      source: 'none',
      message: 'Sign in to evaOS to connect this desktop shell.',
    });
  });

  it('fails closed without calling the broker when the desktop session is expired', async () => {
    const fetchImpl = fetchMock();
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {
        AIONUI_EVAOS_DESKTOP_SESSION: 'eds_expired_session_for_test',
        AIONUI_EVAOS_DESKTOP_SESSION_EXPIRES_AT: PAST,
      },
      now: () => NOW,
    });

    await expect(client.runtimeStatus({ customerId: 'cus_123', runtime: 'browser' })).rejects.toMatchObject({
      code: 'expired_session',
      message: 'Your evaOS desktop session has expired. Sign in again.',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(client.getSessionStatus()).toMatchObject({
      state: 'expired',
      authenticated: false,
      expired: true,
      source: 'environment',
    });
  });

  it('claims a device code into main-process state without returning the desktop session token', async () => {
    const fetchImpl = fetchMock();
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({
        desktop_session: 'eds_created_session_secret_for_test',
        desktop_session_expires_at: FUTURE,
        email: 'operator@example.test',
        access_token: 'should-not-leave-broker-response',
      })
    );
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    const status = await client.claimDeviceCode('ab-123');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(EVAOS_DESKTOP_RUNTIME_SESSION_ENDPOINT);
    expect(requestBody(fetchImpl.mock.calls[0])).toEqual({
      action: 'claim_desktop_device_code',
      device_code: 'AB123',
    });
    expect(requestHeaders(fetchImpl.mock.calls[0]).Authorization).toBeUndefined();
    expect(status).toEqual({
      state: 'authenticated',
      authenticated: true,
      expired: false,
      userEmail: 'operator@example.test',
      expiresAt: FUTURE,
      source: 'memory',
      message: 'evaOS desktop session is active.',
    });
    expect(JSON.stringify(status)).not.toContain('eds_created_session_secret_for_test');
    expect(JSON.stringify(status)).not.toContain('access_token');
  });

  it('loads runtime_status through the broker while returning only sanitized renderer metadata', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse({
          desktop_session: 'eds_created_session_secret_for_test',
          desktop_session_expires_at: FUTURE,
          email: 'operator@example.test',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          schema_version: 'desktop-runtime-session/v1',
          customer_account_id: 'acct_123',
          customer_id: 'cus_123',
          runtime_key: 'browser',
          display_label: 'Business Browser',
          status: 'running',
          health_summary: 'Browser is ready',
          last_checked_at: '2026-06-03T12:01:00.000Z',
          current_url: 'https://app.example.test/work?desktop_session=eds_url_secret#token=bad',
          owner: 'operations',
          auth_needed: false,
          waiting_on_user: false,
          actions: ['open', 'access_token=bad'],
          source_pointer: 'broker:runtime_status:browser',
          audit_id: 'audit_123',
          access_token: 'raw-access-token',
          provider_grant_handle: 'epg_raw_provider_grant',
        })
      );
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await client.claimDeviceCode('ab-123');
    const status = await client.runtimeStatus({ customerId: 'cus_123', runtime: 'browser' });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestHeaders(fetchImpl.mock.calls[1]).Authorization).toBe('Bearer eds_created_session_secret_for_test');
    expect(requestBody(fetchImpl.mock.calls[1])).toEqual({
      action: 'runtime_status',
      customer_id: 'cus_123',
      runtime: 'browser',
    });
    expect(status).toEqual({
      schemaVersion: 'desktop-runtime-session/v1',
      customerAccountId: 'acct_123',
      customerId: 'cus_123',
      runtimeKey: 'browser',
      displayLabel: 'Business Browser',
      status: 'running',
      healthSummary: 'Browser is ready',
      lastCheckedAt: '2026-06-03T12:01:00.000Z',
      currentUrlSummary: {
        scheme: 'https',
        host: 'app.example.test',
        path: '/work',
        displayText: 'app.example.test/work',
        redacted: true,
      },
      owner: 'operations',
      authNeeded: false,
      waitingOnUser: false,
      actions: ['open'],
      sourcePointer: 'broker:runtime_status:browser',
      auditId: 'audit_123',
    });

    const rendererPayload = JSON.stringify(status);
    expect(rendererPayload).not.toMatch(
      /eds_|epg_|access_token|provider_grant|desktop_session|Bearer|raw-access-token/
    );
  });

  it('redacts object-shaped current_url query and fragment material', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse({
          desktop_session: 'eds_created_session_secret_for_test',
          desktop_session_expires_at: FUTURE,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          customer_id: 'cus_123',
          runtime_key: 'browser',
          display_label: 'Business Browser',
          status: 'running',
          current_url: {
            scheme: 'https',
            host: 'app.example.test',
            path: '/oauth/callback?code=abc123&providerGrant=epg_raw_provider_grant',
            display_text: 'not a url',
          },
        })
      );
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await client.claimDeviceCode('ab-123');
    const status = await client.runtimeStatus({ customerId: 'cus_123', runtime: 'browser' });

    expect(status.currentUrlSummary).toEqual({
      scheme: 'https',
      host: 'app.example.test',
      path: '/oauth/callback',
      displayText: 'app.example.test/oauth/callback',
      redacted: true,
    });
    expect(JSON.stringify(status)).not.toMatch(/code=|providerGrant|grantHandle|epg_|abc123|eyJ/);
  });

  it('fails closed when runtime_status is malformed', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse({
          desktop_session: 'eds_created_session_secret_for_test',
          desktop_session_expires_at: FUTURE,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ customer_id: 'cus_123' }));
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await client.claimDeviceCode('ab-123');

    await expect(client.runtimeStatus({ customerId: 'cus_123', runtime: 'browser' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker returned an invalid response.',
    });
  });

  it('revokes the active desktop session without returning token material', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse({
          desktop_session: 'eds_created_session_secret_for_test',
          desktop_session_expires_at: FUTURE,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await client.claimDeviceCode('ab-123');
    const status = await client.revokeSession();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestHeaders(fetchImpl.mock.calls[1]).Authorization).toBe('Bearer eds_created_session_secret_for_test');
    expect(requestBody(fetchImpl.mock.calls[1])).toEqual({ action: 'revoke_desktop_session' });
    expect(status).toEqual({
      state: 'missing',
      authenticated: false,
      expired: false,
      source: 'none',
      message: 'Sign in to evaOS to connect this desktop shell.',
    });
    expect(JSON.stringify(status)).not.toContain('eds_created_session_secret_for_test');
  });

  it('clears the local session even when broker revoke fails', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse({
          desktop_session: 'eds_created_session_secret_for_test',
          desktop_session_expires_at: FUTURE,
        })
      )
      .mockRejectedValueOnce(new Error('offline'));
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await client.claimDeviceCode('ab-123');

    await expect(client.revokeSession()).resolves.toMatchObject({
      state: 'missing',
      authenticated: false,
      expired: false,
    });
    await expect(client.runtimeStatus({ customerId: 'cus_123', runtime: 'browser' })).rejects.toMatchObject({
      code: 'missing_session',
    });
  });

  it('rejects invalid runtime inputs before broker dispatch', async () => {
    const fetchImpl = fetchMock();
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {
        AIONUI_EVAOS_DESKTOP_SESSION: 'eds_valid_session_for_test',
        AIONUI_EVAOS_DESKTOP_SESSION_EXPIRES_AT: FUTURE,
      },
      now: () => NOW,
    });

    await expect(
      client.runtimeStatus({ customerId: 'cus_123', runtime: 'remote_webui' as 'browser' })
    ).rejects.toBeInstanceOf(EvaosBrokerSessionError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
