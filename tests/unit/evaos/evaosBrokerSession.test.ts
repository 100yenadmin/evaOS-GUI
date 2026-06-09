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
  shouldSkipDefaultBetaSafeStorageForMacApp,
  type EvaosBrokerFetch,
  type EvaosDesktopSessionStore,
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

function memorySessionStore(initialValue: unknown = null): EvaosDesktopSessionStore & {
  saved: unknown[];
  cleared: number;
} {
  let value = initialValue;
  return {
    saved: [],
    cleared: 0,
    load: () => value,
    save(session) {
      value = {
        accessToken: session.accessToken,
        userEmail: session.userEmail,
        expiresAt: session.expiresAt,
      };
      this.saved.push(value);
    },
    clear() {
      value = null;
      this.cleared += 1;
    },
  };
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
    delete process.env.AIONUI_EVAOS_IMPORT_WORKBENCH_KEYCHAIN;
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

  it('fails closed without calling the broker when customer targets have no desktop session', async () => {
    const fetchImpl = fetchMock();
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await expect(client.customerTargets()).rejects.toMatchObject({
      code: 'missing_session',
      message: 'Sign in to evaOS before loading customer targets.',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
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
    expect(status).toMatchObject({
      state: 'authenticated',
      authenticated: true,
      expired: false,
      userEmail: 'operator@example.test',
      expiresAt: FUTURE,
      source: 'memory',
      message: 'evaOS desktop session is active.',
    });
    expect(status.sessionKey).toMatch(/^evaos-session-\d+$/);
    expect(status.sessionEpoch).toBeGreaterThan(0);
    expect(JSON.stringify(status)).not.toContain('eds_created_session_secret_for_test');
    expect(JSON.stringify(status)).not.toContain('access_token');
  });

  it('persists claimed desktop sessions so the installed app can reload customer context after restart', async () => {
    const fetchImpl = fetchMock();
    const store = memorySessionStore();
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({
        desktop_session: 'eds_created_session_secret_for_test',
        desktop_session_expires_at: FUTURE,
        email: 'admin@100yen.org',
      })
    );
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
      sessionStore: store,
    });

    const status = await client.claimDeviceCode('ab-123');
    const restarted = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
      sessionStore: store,
    });

    expect(status).toMatchObject({
      state: 'authenticated',
      source: 'memory',
      userEmail: 'admin@100yen.org',
    });
    expect(store.saved).toHaveLength(1);
    expect(JSON.stringify(store.saved)).toContain('eds_created_session_secret_for_test');
    expect(restarted.getSessionStatus()).toMatchObject({
      state: 'authenticated',
      source: 'beta-storage',
      userEmail: 'admin@100yen.org',
      message: 'evaOS desktop session is active.',
    });
    expect(JSON.stringify(restarted.getSessionStatus())).not.toContain('eds_created_session_secret_for_test');
  });

  it('persists loopback desktop-auth callbacks and clears beta storage on logout', async () => {
    const fetchImpl = fetchMock();
    fetchImpl.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const store = memorySessionStore();
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
      sessionStore: store,
    });

    client.importDesktopSessionFromCallbackUrl(
      `http://127.0.0.1:49201/auth/evaos-workbench-beta/callback?desktop_session=eds_loopback_session_secret_for_test&desktop_session_expires_at=${encodeURIComponent(
        FUTURE
      )}&email=admin%40100yen.org`
    );
    const status = await client.revokeSession();
    const restarted = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
      sessionStore: store,
    });

    expect(store.saved).toHaveLength(1);
    expect(store.cleared).toBe(1);
    expect(requestBody(fetchImpl.mock.calls[0])).toEqual({ action: 'revoke_desktop_session' });
    expect(status).toMatchObject({ state: 'missing', authenticated: false });
    expect(restarted.getSessionStatus()).toMatchObject({ state: 'missing', source: 'none' });
  });

  it('does not rehydrate a locally persisted token after logout when storage clear fails', async () => {
    const fetchImpl = fetchMock();
    fetchImpl.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const persisted = {
      accessToken: 'eds_unclearable_session_secret_for_test',
      userEmail: 'admin@100yen.org',
      expiresAt: FUTURE,
    };
    const store: EvaosDesktopSessionStore = {
      load: () => persisted,
      save: vi.fn(),
      clear: () => {
        throw new Error('encrypted store locked');
      },
    };
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
      sessionStore: store,
    });

    expect(client.getSessionStatus()).toMatchObject({ state: 'authenticated', source: 'beta-storage' });

    const status = await client.revokeSession();

    expect(requestBody(fetchImpl.mock.calls[0])).toEqual({ action: 'revoke_desktop_session' });
    expect(status).toMatchObject({ state: 'missing', source: 'none' });
    expect(client.getSessionStatus()).toMatchObject({ state: 'missing', source: 'none' });
  });

  it('retries beta session persistence after an initial local storage failure', async () => {
    const fetchImpl = fetchMock();
    let rejectSave = true;
    let stored: unknown = null;
    const store: EvaosDesktopSessionStore = {
      load: () => stored,
      save: (session) => {
        if (rejectSave) {
          throw new Error('electron storage not ready');
        }
        stored = {
          accessToken: session.accessToken,
          userEmail: session.userEmail,
          expiresAt: session.expiresAt,
        };
      },
      clear: () => {
        stored = null;
      },
    };
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({
        desktop_session: 'eds_retry_persist_session_secret_for_test',
        desktop_session_expires_at: FUTURE,
        email: 'admin@100yen.org',
      })
    );
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
      sessionStore: store,
    });

    await client.claimDeviceCode('ab-123');
    expect(stored).toBeNull();

    rejectSave = false;
    expect(client.getSessionStatus()).toMatchObject({ state: 'authenticated', source: 'memory' });

    const restarted = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
      sessionStore: store,
    });
    expect(restarted.getSessionStatus()).toMatchObject({
      state: 'authenticated',
      source: 'beta-storage',
      userEmail: 'admin@100yen.org',
    });
    expect(JSON.stringify(restarted.getSessionStatus())).not.toContain('eds_retry_persist_session_secret_for_test');
  });

  it('drops expired persisted beta sessions instead of keeping the app in a stale signed-in state', () => {
    const store = memorySessionStore({
      accessToken: 'eds_expired_persisted_session_for_test',
      userEmail: 'admin@100yen.org',
      expiresAt: PAST,
    });

    const client = new EvaosBrokerSessionClient({
      fetchImpl: fetchMock(),
      env: {},
      now: () => NOW,
      sessionStore: store,
    });

    expect(client.getSessionStatus()).toMatchObject({ state: 'missing', source: 'none' });
    expect(store.cleared).toBe(1);
  });

  it('rotates a renderer-safe session key for same-account desktop session handoffs', async () => {
    const fetchImpl = fetchMock();
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    const firstStatus = client.importDesktopSessionFromCallbackUrl(
      `http://127.0.0.1:49201/auth/evaos-workbench-beta/callback?desktop_session=eds_first_session_secret_for_test&desktop_session_expires_at=${encodeURIComponent(
        FUTURE
      )}&email=admin%40100yen.org`
    );
    const secondStatus = client.importDesktopSessionFromCallbackUrl(
      `http://127.0.0.1:49201/auth/evaos-workbench-beta/callback?desktop_session=eds_second_session_secret_for_test&desktop_session_expires_at=${encodeURIComponent(
        FUTURE
      )}&email=admin%40100yen.org`
    );

    expect(firstStatus.userEmail).toBe('admin@100yen.org');
    expect(secondStatus.userEmail).toBe('admin@100yen.org');
    expect(firstStatus.expiresAt).toBe(FUTURE);
    expect(secondStatus.expiresAt).toBe(FUTURE);
    expect(firstStatus.sessionKey).toMatch(/^evaos-session-\d+$/);
    expect(secondStatus.sessionKey).toMatch(/^evaos-session-\d+$/);
    expect(secondStatus.sessionKey).not.toBe(firstStatus.sessionKey);
    expect(secondStatus.sessionEpoch).toBeGreaterThan(firstStatus.sessionEpoch ?? 0);
    expect(JSON.stringify({ firstStatus, secondStatus })).not.toMatch(
      /eds_first_session_secret_for_test|eds_second_session_secret_for_test|desktop_session|access_token|Bearer/i
    );
  });

  it('imports a Workbench loopback callback into main-process state before loading customer targets', async () => {
    const fetchImpl = fetchMock();
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({
        customers: [
          {
            customer_id: 'real-admin-customer',
            display_name: 'Real Admin Customer',
            email: 'admin@100yen.org',
            status: 'active',
            health_status: 'ready',
            is_default: true,
          },
        ],
      })
    );
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    const status = client.importDesktopSessionFromCallbackUrl(
      `http://127.0.0.1:49201/auth/evaos-workbench-beta/callback?desktop_session=eds_callback_session_secret_for_test&desktop_session_expires_at=${encodeURIComponent(
        FUTURE
      )}&email=admin%40100yen.org`
    );
    const targets = await client.customerTargets();

    expect(status).toMatchObject({
      state: 'authenticated',
      authenticated: true,
      expired: false,
      userEmail: 'admin@100yen.org',
      expiresAt: FUTURE,
      source: 'callback',
      message: 'evaOS desktop session is active.',
    });
    expect(status.sessionKey).toMatch(/^evaos-session-\d+$/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requestHeaders(fetchImpl.mock.calls[0]).Authorization).toBe('Bearer eds_callback_session_secret_for_test');
    expect(requestBody(fetchImpl.mock.calls[0])).toEqual({ action: 'list_customer_targets' });
    expect(targets.selectedCustomerId).toBe('real-admin-customer');
    expect(JSON.stringify(status)).not.toContain('eds_callback_session_secret_for_test');
    expect(JSON.stringify(targets)).not.toContain('eds_callback_session_secret_for_test');
  });

  it('rejects released Workbench loopback callback paths for the evaOS beta session importer', async () => {
    const fetchImpl = fetchMock();
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    expect(() =>
      client.importDesktopSessionFromCallbackUrl(
        `http://127.0.0.1:49201/auth/callback?desktop_session=eds_callback_session_secret_for_test&desktop_session_expires_at=${encodeURIComponent(
          FUTURE
        )}&email=admin%40100yen.org`
      )
    ).toThrow(EvaosBrokerSessionError);
    await expect(client.customerTargets()).rejects.toMatchObject({ code: 'missing_session' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects invalid desktop sign-in callbacks without creating a session', async () => {
    const fetchImpl = fetchMock();
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    expect(() =>
      client.importDesktopSessionFromCallbackUrl(
        `https://www.electricsheephq.com/auth/callback?desktop_session=eds_callback_session_secret_for_test&desktop_session_expires_at=${encodeURIComponent(
          FUTURE
        )}`
      )
    ).toThrow(EvaosBrokerSessionError);
    await expect(client.customerTargets()).rejects.toMatchObject({ code: 'missing_session' });
    expect(fetchImpl).not.toHaveBeenCalled();
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

  it('launches brokered runtimes from main process without returning raw dashboard URLs to renderer', async () => {
    const fetchImpl = fetchMock();
    const openRuntimeUrl = vi.fn();
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse({
          desktop_session: 'eds_created_session_secret_for_test',
          desktop_session_expires_at: FUTURE,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          launch_url: 'https://runtime.example.test/openclaw?desktop_session=eds_runtime_launch_secret#token=bad',
          expires_at: '2026-06-03T12:15:00.000Z',
          source_pointer: 'broker:runtime_launch:openclaw',
          audit_id: 'audit_runtime_launch',
          desktop_session: 'eds_should_not_render',
        })
      );
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await client.claimDeviceCode('ab-123');
    const result = await client.runtimeAction(
      { customerId: 'cus_123', runtime: 'openclaw', action: 'launch' },
      { openRuntimeUrl }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchImpl.mock.calls[1])).toEqual({
      action: 'runtime_launch',
      customer_id: 'cus_123',
      runtime: 'openclaw',
    });
    expect(openRuntimeUrl).toHaveBeenCalledWith(
      'https://runtime.example.test/openclaw?desktop_session=eds_runtime_launch_secret#token=bad'
    );
    expect(result).toEqual({
      status: 'opened',
      runtimeKey: 'openclaw',
      customerId: 'cus_123',
      message: 'Opened evaOS through the evaOS broker.',
      urlSummary: {
        scheme: 'https',
        host: 'runtime.example.test',
        path: '/openclaw',
        displayText: 'runtime.example.test/openclaw',
        redacted: true,
      },
      expiresAt: '2026-06-03T12:15:00.000Z',
      sourcePointer: 'broker:runtime_launch:openclaw',
      auditId: 'audit_runtime_launch',
      backendEnforced: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/eds_|desktop_session|token=bad|Bearer|launch_url/);
  });

  it('rejects plaintext remote runtime launch URLs before creating a renderer surface', async () => {
    const fetchImpl = fetchMock();
    const createRuntimeSurface = vi.fn();
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse({
          desktop_session: 'eds_created_session_secret_for_test',
          desktop_session_expires_at: FUTURE,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          launch_url: 'http://runtime.example.test/openclaw?desktop_session=eds_runtime_launch_secret',
          expires_at: '2026-06-03T12:15:00.000Z',
          source_pointer: 'broker:runtime_launch:openclaw',
          audit_id: 'audit_runtime_launch',
        })
      );
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await client.claimDeviceCode('ab-123');

    await expect(
      client.runtimeAction({ customerId: 'cus_123', runtime: 'openclaw', action: 'launch' }, { createRuntimeSurface })
    ).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker did not return a safe runtime launch target.',
    });
    expect(createRuntimeSurface).not.toHaveBeenCalled();
  });

  it('maps denied Terminal runtime launch responses before creating a VM shell surface', async () => {
    const fetchImpl = fetchMock();
    const createRuntimeSurface = vi.fn();
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse({
          desktop_session: 'eds_created_session_secret_for_test',
          desktop_session_expires_at: FUTURE,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'denied',
          runtime: 'terminal',
          customer_id: 'cus_123',
          message: 'Terminal access denied by VM shell authorization.',
          launch_url: 'https://ecs.electricsheephq.com/vm/benjamin-kennedy/workspace/terminal/',
          source_pointer: 'broker:runtime_launch:terminal',
          audit_id: 'audit_terminal_denied',
          backend_enforced: true,
          runtime_status: {
            runtime: 'terminal',
            customer_id: 'cus_123',
            status: 'denied',
            health_summary: 'Terminal VM shell authorization denied.',
            source_pointer: 'broker:runtime_status:terminal',
            audit_id: 'audit_terminal_status_denied',
          },
        })
      );
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await client.claimDeviceCode('ab-123');
    const result = await client.runtimeAction(
      { customerId: 'cus_123', runtime: 'terminal', action: 'launch' },
      { createRuntimeSurface }
    );

    expect(createRuntimeSurface).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'denied',
      runtimeKey: 'terminal',
      customerId: 'cus_123',
      message: 'Terminal access denied by VM shell policy.',
      runtimeStatus: {
        runtimeKey: 'terminal',
        customerId: 'cus_123',
        status: 'denied',
      },
      sourcePointer: 'broker:runtime_launch:terminal',
      auditId: 'audit_terminal_denied',
      backendEnforced: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/ecs\\.electricsheephq\\.com|launch_url|desktop_session|eds_|Bearer/i);
  });

  it('does not adopt the released Workbench keychain desktop session when the environment is explicitly overridden', () => {
    const fetchImpl = fetchMock();
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
      legacyWorkbenchSessionLoader: () => ({
        accessToken: 'eds_workbench_keychain_session_secret_for_test',
        userEmail: 'admin@electricsheephq.com',
        expiresAt: FUTURE,
        source: 'workbench-keychain',
      }),
    });

    expect(client.getSessionStatus()).toEqual({
      state: 'missing',
      authenticated: false,
      expired: false,
      source: 'none',
      message: 'Sign in to evaOS to connect this desktop shell.',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not touch the released Workbench keychain by default for the installed beta app path', () => {
    const fetchImpl = fetchMock();
    const legacyWorkbenchSessionLoader = vi.fn(() => ({
      accessToken: 'eds_workbench_keychain_session_secret_for_test',
      userEmail: 'admin@100yen.org',
      expiresAt: FUTURE,
      source: 'workbench-keychain' as const,
    }));
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      now: () => NOW,
      legacyWorkbenchSessionLoader,
    });

    const status = client.getSessionStatus();

    expect(status).toEqual({
      state: 'missing',
      authenticated: false,
      expired: false,
      source: 'none',
      message: 'Sign in to evaOS to connect this desktop shell.',
    });
    expect(legacyWorkbenchSessionLoader).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('can explicitly adopt the released Workbench keychain desktop session without returning its token', async () => {
    const fetchImpl = fetchMock();
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {
        AIONUI_EVAOS_IMPORT_WORKBENCH_KEYCHAIN: '1',
      },
      now: () => NOW,
      legacyWorkbenchSessionLoader: () => ({
        accessToken: 'eds_workbench_keychain_session_secret_for_test',
        userEmail: 'admin@100yen.org',
        expiresAt: FUTURE,
        source: 'workbench-keychain',
      }),
    });

    const status = client.getSessionStatus();

    expect(status).toMatchObject({
      state: 'authenticated',
      authenticated: true,
      expired: false,
      userEmail: 'admin@100yen.org',
      expiresAt: FUTURE,
      source: 'workbench-keychain',
      message: 'evaOS desktop session is active.',
    });
    expect(status.sessionKey).toMatch(/^evaos-session-\d+$/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(status)).not.toContain('eds_workbench_keychain_session_secret_for_test');
  });

  it('keeps explicit AionUi environment sessions ahead of the released Workbench keychain import', () => {
    const client = new EvaosBrokerSessionClient({
      fetchImpl: fetchMock(),
      env: {
        AIONUI_EVAOS_DESKTOP_SESSION: 'eds_environment_session_secret_for_test',
        AIONUI_EVAOS_DESKTOP_SESSION_EMAIL: 'operator@example.test',
        AIONUI_EVAOS_DESKTOP_SESSION_EXPIRES_AT: FUTURE,
      },
      now: () => NOW,
      legacyWorkbenchSessionLoader: () => ({
        accessToken: 'eds_workbench_keychain_session_secret_for_test',
        userEmail: 'admin@100yen.org',
        expiresAt: FUTURE,
        source: 'workbench-keychain',
      }),
    });

    expect(client.getSessionStatus()).toMatchObject({
      state: 'authenticated',
      userEmail: 'operator@example.test',
      source: 'environment',
    });
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

  it('loads customer targets through the broker while returning only safe selector metadata', async () => {
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
          roles: ['admin', 'support'],
          scopes: ['open_business_browser', 'access_terminal', 'unknown_scope', 'access_token'],
          is_operator: true,
          default_customer_id: 'david-poku',
          customers: [
            {
              customer_id: 'david-poku',
              display_name: 'David Poku Co',
              email: 'ops@example.test',
              status: 'active',
              health_status: 'ready',
              is_default: true,
              desktop_session: 'eds_should_not_render',
            },
            {
              customer_id: 'second-customer',
              display_name: 'Second Customer',
              email: 'owner@example.test',
              status: 'active',
              health_status: 'needs_attention',
            },
            {
              customer_id: 'bad-secret',
              display_name: 'Bearer eds_hidden',
              email: 'secret@example.test',
            },
          ],
          access_token: 'should-not-leave-broker-response',
        })
      );
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await client.claimDeviceCode('ab-123');
    const targets = await client.customerTargets();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestHeaders(fetchImpl.mock.calls[1]).Authorization).toBe('Bearer eds_created_session_secret_for_test');
    expect(requestBody(fetchImpl.mock.calls[1])).toEqual({ action: 'list_customer_targets' });
    expect(targets).toEqual({
      roles: ['admin', 'support'],
      scopes: ['open_business_browser', 'access_terminal'],
      isOperator: true,
      defaultCustomerId: 'david-poku',
      customers: [
        {
          customerId: 'david-poku',
          displayName: 'David Poku Co',
          email: 'ops@example.test',
          status: 'active',
          healthStatus: 'ready',
          isDefault: true,
        },
        {
          customerId: 'second-customer',
          displayName: 'Second Customer',
          email: 'owner@example.test',
          status: 'active',
          healthStatus: 'needs_attention',
          isDefault: false,
        },
      ],
      selectedCustomerId: 'david-poku',
      summaryText: '2 customer targets loaded',
    });
    expect(JSON.stringify(targets)).not.toMatch(
      /\b(?:eds|epg)_[A-Za-z0-9_-]{4,}\b|access_token|desktop_session|Bearer/i
    );
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

  it('opens a provider approval request without requiring manage_integrations in the shell first', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse({
          schema_version: 'evaos.account_policy.v1',
          customer_account_id: 'acct_123',
          membership_id: 'mem_requester',
          membership_role: 'manager',
          members: [],
          invites: [],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          schema_version: 'evaos.account_policy.v1',
          customer_account_id: 'acct_123',
          selected_customer_id: 'david-poku',
          membership_id: 'mem_requester',
          membership_role: 'manager',
          scopes: ['open_business_browser'],
          advanced_surfaces: {},
          backend_enforced: true,
          audit_id: 'audit_policy_requester',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          provider_profiles: [
            {
              provider_key: 'linear',
              title: 'Linear',
              status: 'connected',
              active: false,
              capabilities: ['issues'],
              last_validated_at: '2026-06-03T11:52:00.000Z',
              source_pointer: 'broker:provider_profile:linear',
              audit_id: 'audit_linear_profile',
            },
          ],
          approval_request: {
            id: 'apr_linear_123',
            provider_key: 'linear',
            requested_action: 'provider_mint_grant',
            agent_runtime: 'openclaw',
            status: 'pending',
            source_pointer: 'broker:provider_approval_request:david-poku:apr_linear_123',
            audit_id: 'audit_request_linear',
          },
        })
      );
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {
        AIONUI_EVAOS_DESKTOP_SESSION: 'eds_requester_session_for_test',
        AIONUI_EVAOS_DESKTOP_SESSION_EXPIRES_AT: FUTURE,
      },
      now: () => NOW,
    });

    const result = await client.requestProviderApproval({
      customerId: 'david-poku',
      providerKey: 'linear',
      requestedAction: 'provider_mint_grant',
      agentRuntime: 'openclaw',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(requestBody(fetchImpl.mock.calls[0])).toEqual({
      action: 'current_customer_account',
      customer_id: 'david-poku',
    });
    expect(requestBody(fetchImpl.mock.calls[1])).toEqual({
      action: 'current_customer_account_permissions',
      customer_id: 'david-poku',
    });
    expect(requestBody(fetchImpl.mock.calls[2])).toEqual({
      action: 'provider_approval_request',
      customer_id: 'david-poku',
      provider_key: 'linear',
      requested_action: 'provider_mint_grant',
      agent_runtime: 'openclaw',
    });
    expect(result).toEqual({
      status: 'pending',
      providerKey: 'linear',
      message: 'Approval request opened.',
      sourcePointer: 'broker:provider_approval_request:david-poku:apr_linear_123',
      auditId: 'audit_request_linear',
      backendEnforced: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/eds_|provider_grant|desktop_session|Bearer/i);
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

describe('shouldSkipDefaultBetaSafeStorageForMacApp', () => {
  it('skips Electron Safe Storage for packaged macOS ad-hoc proof builds', () => {
    expect(
      shouldSkipDefaultBetaSafeStorageForMacApp({
        env: {},
        executablePath: '/Applications/evaOS Workbench Beta.app/Contents/MacOS/evaOS Workbench Beta',
        isPackaged: true,
        platform: 'darwin',
        inspectSignature: () => ({ adhoc: true, teamIdentifier: null }),
      })
    ).toBe(true);
  });

  it('keeps Electron Safe Storage enabled for packaged macOS Developer ID builds', () => {
    expect(
      shouldSkipDefaultBetaSafeStorageForMacApp({
        env: {},
        executablePath: '/Applications/evaOS Workbench Beta.app/Contents/MacOS/evaOS Workbench Beta',
        isPackaged: true,
        platform: 'darwin',
        inspectSignature: () => ({ adhoc: false, teamIdentifier: 'TEAM123456' }),
      })
    ).toBe(false);
  });

  it('allows an explicit ad-hoc Safe Storage opt-in for local diagnostics', () => {
    expect(
      shouldSkipDefaultBetaSafeStorageForMacApp({
        env: { AIONUI_EVAOS_ALLOW_ADHOC_SAFE_STORAGE: '1' },
        executablePath: '/Applications/evaOS Workbench Beta.app/Contents/MacOS/evaOS Workbench Beta',
        isPackaged: true,
        platform: 'darwin',
        inspectSignature: () => ({ adhoc: true, teamIdentifier: null }),
      })
    ).toBe(false);
  });
});
