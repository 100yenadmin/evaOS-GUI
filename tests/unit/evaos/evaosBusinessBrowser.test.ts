/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EvaosBrokerSessionClient, type EvaosBrokerFetch } from '@/process/services/evaosBrokerSession';

const NOW = new Date('2026-06-03T12:00:00.000Z');
const FUTURE = '2026-06-03T18:00:00.000Z';

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

function authenticatedClient(fetchImpl: EvaosBrokerFetch): EvaosBrokerSessionClient {
  return new EvaosBrokerSessionClient({
    fetchImpl,
    env: {
      AIONUI_EVAOS_DESKTOP_SESSION: 'eds_business_browser_secret_for_test',
      AIONUI_EVAOS_DESKTOP_SESSION_EXPIRES_AT: FUTURE,
    },
    now: () => NOW,
  });
}

const accountPayload = {
  customer_account_id: 'acct_123',
  selected_customer_id: 'david-poku',
  members: [
    {
      membership_id: 'mem_admin',
      email: 'admin@example.test',
      membership_role: 'admin',
      status: 'active',
    },
  ],
};

function policyPayload(scopes: string[], overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'evaos.account_policy.v1',
    customer_account_id: 'acct_123',
    selected_customer_id: 'david-poku',
    membership_id: 'mem_admin',
    membership_role: 'admin',
    scopes,
    advanced_surfaces: {},
    backend_enforced: true,
    audit_id: 'audit_policy_123',
    ...overrides,
  };
}

function browserRuntimeResponse(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'desktop-runtime-session/v1',
    customer_account_id: 'acct_123',
    customer_id: 'david-poku',
    runtime_key: 'browser',
    display_label: 'Business Browser',
    status: 'running',
    health_summary: 'Browser is ready',
    current_url: 'https://app.example.test/dashboard?desktop_session=eds_url_secret#token=bad',
    control_session_active: true,
    actions: ['browser_open_url', 'browser_stop', 'access_token=bad'],
    source_pointer: 'broker:runtime_status:browser',
    audit_id: 'audit_browser_123',
    last_checked_at: '2026-06-03T12:01:00.000Z',
    ...overrides,
  };
}

describe('EvaosBrokerSessionClient Business Browser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed without broker calls when Business Browser loads without a desktop session', async () => {
    const fetchImpl = fetchMock();
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await expect(client.businessBrowserStatus({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'missing_session',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns route denial without runtime_status when open_business_browser is absent', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['view_company_brain'])));
    const client = authenticatedClient(fetchImpl);

    const status = await client.businessBrowserStatus({ customerId: 'david-poku' });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(status).toMatchObject({
      schemaVersion: 'evaos.browser_status.v1',
      customerId: 'david-poku',
      customerAccountId: 'acct_123',
      routeDenied: true,
      routeDenialReason: 'Business Browser requires the open_business_browser scope for this customer account.',
      status: 'denied',
      canLaunch: false,
      canOpenUrl: false,
      canStop: false,
      policyAuditId: 'audit_policy_123',
    });
  });

  it('maps runtime_status to browser control metadata without exposing URL secrets', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser'])))
      .mockResolvedValueOnce(jsonResponse(browserRuntimeResponse()));
    const client = authenticatedClient(fetchImpl);

    const status = await client.businessBrowserStatus({ customerId: 'david-poku' });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(requestBody(fetchImpl.mock.calls[2])).toEqual({
      action: 'runtime_status',
      customer_id: 'david-poku',
      runtime: 'browser',
    });
    expect(status).toMatchObject({
      schemaVersion: 'evaos.browser_status.v1',
      customerId: 'david-poku',
      customerAccountId: 'acct_123',
      routeDenied: false,
      status: 'running',
      controlSessionActive: true,
      canLaunch: true,
      canOpenUrl: true,
      canStop: true,
      currentUrlSummary: {
        scheme: 'https',
        host: 'app.example.test',
        path: '/dashboard',
        displayText: 'app.example.test/dashboard',
        redacted: true,
      },
      actions: ['browser_open_url', 'browser_stop'],
      sourcePointer: 'broker:runtime_status:browser',
      auditId: 'audit_browser_123',
    });
    expect(JSON.stringify(status)).not.toMatch(/eds_|access_token|desktop_session|token=bad|Bearer/i);
  });

  it('fails closed when runtime evidence belongs to a different customer', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser'])))
      .mockResolvedValueOnce(jsonResponse(browserRuntimeResponse({ customer_id: 'other-customer' })));
    const client = authenticatedClient(fetchImpl);

    await expect(client.businessBrowserStatus({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker returned browser runtime evidence for a different customer.',
    });
  });

  it('fails closed when browser status lacks explicit customer proof', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser'])))
      .mockResolvedValueOnce(jsonResponse(browserRuntimeResponse({ customer_id: undefined })));
    const client = authenticatedClient(fetchImpl);

    await expect(client.businessBrowserStatus({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker did not return browser runtime customer proof.',
    });
  });

  it('fails closed when browser status lacks runtime audit or source proof', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser'])))
      .mockResolvedValueOnce(jsonResponse(browserRuntimeResponse({ audit_id: undefined })));
    const client = authenticatedClient(fetchImpl);

    await expect(client.businessBrowserStatus({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker did not return browser runtime evidence proof.',
    });

    fetchImpl.mockReset();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser'])))
      .mockResolvedValueOnce(
        jsonResponse(browserRuntimeResponse({ source_pointer: 'broker:runtime_status:openclaw' }))
      );

    await expect(client.businessBrowserStatus({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker did not return browser runtime evidence proof.',
    });
  });

  it('fails closed when browser status belongs to a different customer account', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser'])))
      .mockResolvedValueOnce(jsonResponse(browserRuntimeResponse({ customer_account_id: 'acct_other' })));
    const client = authenticatedClient(fetchImpl);

    await expect(client.businessBrowserStatus({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker returned browser runtime evidence for a different customer account.',
    });
  });

  it('denies browser mutations before action RPCs when policy proof is not backend-enforced', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser'], { backend_enforced: false })));
    const client = authenticatedClient(fetchImpl);

    await expect(client.launchBusinessBrowser({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'action_denied',
      message: 'Business Browser actions require backend-enforced account policy proof.',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('opens a brokered URL only with action-scoped backend proof and sanitized URL evidence', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser'])))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'opened',
          customer_id: 'david-poku',
          message: 'Browser URL opened.',
          current_url: 'https://workspace.example.test/app?access_token=raw-token#frag',
          source_pointer: 'broker:browser_open_url:david-poku',
          audit_id: 'audit_open_123',
          backend_enforced: true,
          browser: browserRuntimeResponse({
            current_url: 'https://workspace.example.test/app?access_token=raw-token#frag',
            source_pointer: 'broker:runtime_status:browser',
            audit_id: 'audit_browser_after_open',
          }),
        })
      );
    const client = authenticatedClient(fetchImpl);

    const result = await client.openBusinessBrowserUrl({
      customerId: 'david-poku',
      url: 'https://workspace.example.test/app?view=alpha#section',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(requestBody(fetchImpl.mock.calls[2])).toEqual({
      action: 'browser_open_url',
      customer_id: 'david-poku',
      url: 'https://workspace.example.test/app',
    });
    expect(result).toMatchObject({
      status: 'opened',
      message: 'Browser URL opened.',
      urlSummary: {
        scheme: 'https',
        host: 'workspace.example.test',
        path: '/app',
        displayText: 'workspace.example.test/app',
        redacted: true,
      },
      auditId: 'audit_open_123',
      backendEnforced: true,
      browser: {
        customerId: 'david-poku',
        status: 'running',
        currentUrlSummary: {
          displayText: 'workspace.example.test/app',
          redacted: true,
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/eds_|access_token|raw-token|desktop_session|Bearer/i);
  });

  it('creates an opaque runtime surface for brokered Business Browser launch URLs', async () => {
    const fetchImpl = fetchMock();
    const createRuntimeSurface = vi.fn(() => ({
      schemaVersion: 'evaos.runtime_surface.v1' as const,
      surfaceId: 'surface-browser-live',
      surfaceUri: 'evaos-runtime-surface://surface-browser-live/',
      partition: 'evaos-runtime-browser-live',
      customerId: 'david-poku',
      runtimeKey: 'browser' as const,
      displayLabel: 'Business Browser',
      status: 'attached',
      sourcePointer: 'broker:browser_open_url:david-poku',
      auditId: 'audit_launch_surface',
    }));
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser'])))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'attached',
          customer_id: 'david-poku',
          message: 'Browser attached.',
          launch_url: 'https://runtime.example.test/browser?desktop_session=eds_runtime_secret&token=raw',
          current_url: 'https://runtime.example.test/browser?desktop_session=eds_runtime_secret&token=raw',
          source_pointer: 'broker:browser_open_url:david-poku',
          audit_id: 'audit_launch_surface',
          backend_enforced: true,
          browser: browserRuntimeResponse({
            current_url: 'https://runtime.example.test/browser?desktop_session=eds_runtime_secret&token=raw',
            source_pointer: 'broker:runtime_status:browser',
            audit_id: 'audit_browser_after_launch',
          }),
        })
      );
    const client = authenticatedClient(fetchImpl);

    const result = await client.launchBusinessBrowser({ customerId: 'david-poku' }, { createRuntimeSurface });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(requestBody(fetchImpl.mock.calls[2])).toEqual({
      action: 'browser_open_url',
      customer_id: 'david-poku',
      url: 'https://chatgpt.com/codex',
    });
    expect(createRuntimeSurface).toHaveBeenCalledWith(
      'https://runtime.example.test/browser?desktop_session=eds_runtime_secret&token=raw',
      expect.objectContaining({
        customerId: 'david-poku',
        runtimeKey: 'browser',
        displayLabel: 'Business Browser',
        sourcePointer: 'broker:browser_open_url:david-poku',
        auditId: 'audit_launch_surface',
      })
    );
    expect(result.runtimeSurface).toMatchObject({
      surfaceUri: 'evaos-runtime-surface://surface-browser-live/',
      partition: 'evaos-runtime-browser-live',
      customerId: 'david-poku',
      runtimeKey: 'browser',
    });
    expect(JSON.stringify(result)).not.toMatch(/launch_url|eds_runtime_secret|desktop_session|token=raw|Bearer/i);
  });

  it('fails closed when a Business Browser action returns a remote plaintext surface URL', async () => {
    const fetchImpl = fetchMock();
    const createRuntimeSurface = vi.fn();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser'])))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'attached',
          customer_id: 'david-poku',
          message: 'Browser attached.',
          launch_url: 'http://runtime.example.test/browser',
          source_pointer: 'broker:browser_open_url:david-poku',
          audit_id: 'audit_plaintext_surface',
          backend_enforced: true,
          browser: browserRuntimeResponse({
            source_pointer: 'broker:runtime_status:browser',
            audit_id: 'audit_browser_after_launch',
          }),
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.launchBusinessBrowser({ customerId: 'david-poku' }, { createRuntimeSurface })
    ).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker did not return a safe runtime launch target.',
    });
    expect(createRuntimeSurface).not.toHaveBeenCalled();
  });

  it('fails closed when browser action proof reuses runtime_status evidence', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser'])))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'opened',
          customer_id: 'david-poku',
          source_pointer: 'broker:runtime_status:browser',
          audit_id: 'audit_open_123',
          backend_enforced: true,
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.openBusinessBrowserUrl({ customerId: 'david-poku', url: 'https://workspace.example.test/app' })
    ).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker did not return browser action enforcement proof.',
    });
  });

  it('fails closed when browser action returns unscoped nested runtime status', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser'])))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'opened',
          customer_id: 'david-poku',
          source_pointer: 'broker:browser_open_url:david-poku',
          audit_id: 'audit_open_123',
          backend_enforced: true,
          browser: browserRuntimeResponse({
            customer_id: undefined,
            source_pointer: 'broker:runtime_status:browser',
            audit_id: 'audit_browser_after_open',
          }),
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.openBusinessBrowserUrl({ customerId: 'david-poku', url: 'https://workspace.example.test/app' })
    ).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker did not return browser runtime customer proof.',
    });
  });

  it('sends stop through the browser_stop action contract', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser'])))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'stopped',
          customer_id: 'david-poku',
          message: 'Browser stopped.',
          source_pointer: 'broker:browser_stop:david-poku',
          audit_id: 'audit_stop_123',
          backend_enforced: true,
        })
      );
    const client = authenticatedClient(fetchImpl);

    const result = await client.stopBusinessBrowser({ customerId: 'david-poku' });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(requestBody(fetchImpl.mock.calls[2])).toEqual({
      action: 'browser_stop',
      customer_id: 'david-poku',
    });
    expect(result).toMatchObject({
      status: 'stopped',
      message: 'Browser stopped.',
      sourcePointer: 'broker:browser_stop:david-poku',
      auditId: 'audit_stop_123',
      backendEnforced: true,
    });
  });

  it('rejects unsafe browser URLs before broker dispatch', async () => {
    const fetchImpl = fetchMock();
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.openBusinessBrowserUrl({
        customerId: 'david-poku',
        url: 'https://workspace.example.test/app?desktop_session=eds_secret_for_test',
      })
    ).rejects.toMatchObject({
      code: 'invalid_browser_url',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
