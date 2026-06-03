/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const browserCanary = require('../../../scripts/evaosBusinessBrowserLiveCanary.js') as {
  runBusinessBrowserLiveCanary: (options: {
    env: Record<string, string | undefined>;
    fetchImpl: typeof fetch;
  }) => Promise<Record<string, unknown>>;
  summarizeBrowserActionResult: (
    raw: unknown,
    request: { action: 'browser_open_url' | 'browser_stop'; customerId: string; customerAccountId?: string }
  ) => Record<string, unknown>;
  summarizeBrowserRuntime: (
    raw: unknown,
    request: { customerId: string; customerAccountId?: string }
  ) => Record<string, unknown>;
  normalizeTestUrl: (value: string, allowedHosts?: string) => string;
  summarizeDeniedAttempt: (result: { ok: boolean; httpStatus: number; body: unknown }) => Record<string, unknown>;
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const env = {
  AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK: 'evaos-browser-test',
  AIONUI_EVAOS_DESKTOP_SESSION: 'eds_business_browser_session_for_test',
  AIONUI_EVAOS_CUSTOMER_ID: 'cus_123',
  AIONUI_EVAOS_BUSINESS_BROWSER_TEST_URL: 'https://workspace.example.test/app?view=alpha#fragment',
  AIONUI_EVAOS_BUSINESS_BROWSER_ALLOWED_HOSTS: 'workspace.example.test',
  AIONUI_EVAOS_BUSINESS_BROWSER_WRONG_CUSTOMER_ID: 'cus_other',
  AIONUI_EVAOS_BUSINESS_BROWSER_DENIED_SESSION: 'eds_denied_browser_session_for_test',
  AIONUI_EVAOS_BROKER_ENDPOINT: 'https://broker.example.test/runtime',
};

const policy = {
  customer_id: 'cus_123',
  customer_account_id: 'acct_123',
  membership_id: 'mem_admin',
  membership_role: 'admin',
  scopes: ['open_business_browser'],
  backend_enforced: true,
  audit_id: 'audit_policy_123',
};

const runtime = {
  schema_version: 'desktop-runtime-session/v1',
  customer_id: 'cus_123',
  customer_account_id: 'acct_123',
  runtime_key: 'browser',
  display_label: 'Business Browser',
  status: 'running',
  health_summary: 'Browser is ready',
  control_session_active: true,
  actions: ['browser_open_url', 'browser_stop'],
  source_pointer: 'broker:runtime_status:browser',
  audit_id: 'audit_runtime_123',
  last_checked_at: '2026-06-03T12:00:00.000Z',
};

const openResult = {
  status: 'opened',
  customer_id: 'cus_123',
  customer_account_id: 'acct_123',
  current_url: 'https://workspace.example.test/app',
  source_pointer: 'broker:browser_open_url:cus_123',
  audit_id: 'audit_open_123',
  backend_enforced: true,
  browser: {
    ...runtime,
    audit_id: 'audit_runtime_after_open',
  },
};

const stopResult = {
  status: 'stopped',
  customer_id: 'cus_123',
  customer_account_id: 'acct_123',
  source_pointer: 'broker:browser_stop:cus_123',
  audit_id: 'audit_stop_123',
  backend_enforced: true,
};

const denied = {
  code: 'action_denied',
  message: 'Business Browser denied by account policy.',
  source_pointer: 'broker:business_browser_denial:denied_member',
  audit_id: 'audit_denied_123',
};

describe('evaOS Business Browser live canary', () => {
  it('fails closed before network without explicit browser action acknowledgement', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      browserCanary.runBusinessBrowserLiveCanary({
        env: {
          ...env,
          AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK: 'nope',
        },
        fetchImpl,
      })
    ).rejects.toThrow(/AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK=evaos-browser-test/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('summarizes runtime and action proof without exposing URLs, sessions, or tokens', () => {
    expect(
      browserCanary.summarizeBrowserRuntime(runtime, { customerId: 'cus_123', customerAccountId: 'acct_123' })
    ).toMatchObject({
      customerId: 'cus_123',
      customerAccountId: 'acct_123',
      runtime: 'browser',
      status: 'running',
      sourcePointer: 'broker:runtime_status:browser',
      auditId: 'audit_runtime_123',
      canOpenUrl: true,
      canStop: true,
    });

    const proof = browserCanary.summarizeBrowserActionResult(openResult, {
      action: 'browser_open_url',
      customerId: 'cus_123',
      customerAccountId: 'acct_123',
    });

    expect(proof).toMatchObject({
      action: 'browser_open_url',
      status: 'opened',
      customerId: 'cus_123',
      sourcePointer: 'broker:browser_open_url:cus_123',
      auditId: 'audit_open_123',
      backendEnforced: true,
      nestedRuntime: {
        auditId: 'audit_runtime_after_open',
      },
    });
    expect(JSON.stringify(proof)).not.toMatch(/eds_|access_token|desktop_session/i);
  });

  it('rejects action proof that reuses runtime_status source evidence', () => {
    expect(() =>
      browserCanary.summarizeBrowserActionResult(
        {
          ...openResult,
          source_pointer: 'broker:runtime_status:browser',
        },
        { action: 'browser_open_url', customerId: 'cus_123', customerAccountId: 'acct_123' }
      )
    ).toThrow(/action source proof/);
  });

  it('rejects browser action statuses that do not prove the requested transition', () => {
    expect(() =>
      browserCanary.summarizeBrowserActionResult(
        {
          ...openResult,
          status: 'queued',
        },
        { action: 'browser_open_url', customerId: 'cus_123', customerAccountId: 'acct_123' }
      )
    ).toThrow(/open URL action must return opened/);

    expect(() =>
      browserCanary.summarizeBrowserActionResult(
        {
          ...stopResult,
          status: 'noop',
        },
        { action: 'browser_stop', customerId: 'cus_123', customerAccountId: 'acct_123' }
      )
    ).toThrow(/stop action must return stopped/);
  });

  it('rejects runtime proof without a concrete status', () => {
    expect(() =>
      browserCanary.summarizeBrowserRuntime(
        {
          ...runtime,
          status: undefined,
        },
        { customerId: 'cus_123', customerAccountId: 'acct_123' }
      )
    ).toThrow(/runtime status proof/);
  });

  it('rejects runtime proof that cannot open or stop the browser', () => {
    expect(() =>
      browserCanary.summarizeBrowserRuntime(
        {
          ...runtime,
          control_session_active: false,
          actions: ['browser_open_url'],
        },
        { customerId: 'cus_123', customerAccountId: 'acct_123' }
      )
    ).toThrow(/runtime action proof/);
  });

  it('requires denial source and audit proof for negative attempts', () => {
    expect(
      browserCanary.summarizeDeniedAttempt({
        ok: false,
        httpStatus: 403,
        body: denied,
      })
    ).toMatchObject({
      backendDenied: true,
      httpStatus: 403,
      sourcePointer: 'broker:business_browser_denial:denied_member',
      auditId: 'audit_denied_123',
    });

    expect(() =>
      browserCanary.summarizeDeniedAttempt({
        ok: false,
        httpStatus: 403,
        body: {
          code: 'action_denied',
          message: 'Denied.',
        },
      })
    ).toThrow(/source and audit evidence/);

    expect(() =>
      browserCanary.summarizeDeniedAttempt({
        ok: false,
        httpStatus: 403,
        body: {
          code: 'action_denied',
          message: 'Denied.',
          source_pointer: 'broker:runtime_status:browser',
          audit_id: 'audit_denied_123',
        },
      })
    ).toThrow(/denial source proof/);
  });

  it('requires an explicit safe URL host allowlist for live browser actions', () => {
    expect(
      browserCanary.normalizeTestUrl('https://workspace.example.test/app?token=redacted', 'workspace.example.test')
    ).toBe('https://workspace.example.test/app');
    expect(() => browserCanary.normalizeTestUrl('https://127.0.0.1/admin', 'workspace.example.test')).toThrow(
      /allowed hosts/
    );
    expect(() => browserCanary.normalizeTestUrl('https://169.254.169.254/latest', 'workspace.example.test')).toThrow(
      /allowed hosts/
    );
    expect(() => browserCanary.normalizeTestUrl('https://evil.example.test/app', 'workspace.example.test')).toThrow(
      /allowed hosts/
    );
  });

  it('opens, verifies, stops, and proves customer plus denied-session isolation for runtime and actions', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(policy))
      .mockResolvedValueOnce(jsonResponse(runtime))
      .mockResolvedValueOnce(jsonResponse(openResult))
      .mockResolvedValueOnce(
        jsonResponse({
          ...runtime,
          audit_id: 'audit_runtime_after_open',
        })
      )
      .mockResolvedValueOnce(jsonResponse(stopResult))
      .mockResolvedValueOnce(
        jsonResponse({
          ...runtime,
          status: 'stopped',
          audit_id: 'audit_runtime_after_stop',
        })
      )
      .mockResolvedValueOnce(jsonResponse(denied, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse(denied, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse(denied, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse(denied, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse(denied, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse(denied, { status: 403 }));

    const proof = await browserCanary.runBusinessBrowserLiveCanary({
      env,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(12);
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer eds_business_browser_session_for_test',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[2][1]?.body))).toMatchObject({
      action: 'browser_open_url',
      customer_id: 'cus_123',
      url: 'https://workspace.example.test/app',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[4][1]?.body))).toMatchObject({
      action: 'browser_stop',
      customer_id: 'cus_123',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[6][1]?.body))).toMatchObject({
      action: 'runtime_status',
      customer_id: 'cus_other',
      runtime: 'browser',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[7][1]?.body))).toMatchObject({
      action: 'browser_open_url',
      customer_id: 'cus_other',
      url: 'https://workspace.example.test/app',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[8][1]?.body))).toMatchObject({
      action: 'browser_stop',
      customer_id: 'cus_other',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[9][1]?.body))).toMatchObject({
      action: 'runtime_status',
      customer_id: 'cus_123',
      runtime: 'browser',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[10][1]?.body))).toMatchObject({
      action: 'browser_open_url',
      customer_id: 'cus_123',
      url: 'https://workspace.example.test/app',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[11][1]?.body))).toMatchObject({
      action: 'browser_stop',
      customer_id: 'cus_123',
    });
    expect(proof).toMatchObject({
      schema: 'evaos-business-browser-live-proof/v1',
      customerId: 'cus_123',
      acceptanceProof: true,
      customerIsolation: 'passed',
      before: {
        status: 'running',
      },
      open: {
        status: 'opened',
      },
      stop: {
        status: 'stopped',
      },
      wrongCustomer: {
        runtime: {
          backendDenied: true,
        },
        open: {
          backendDenied: true,
        },
        stop: {
          backendDenied: true,
        },
      },
      deniedMember: {
        runtime: {
          backendDenied: true,
        },
        open: {
          backendDenied: true,
        },
        stop: {
          backendDenied: true,
        },
      },
      sensitiveOutput: 'passed',
    });
    expect(JSON.stringify(proof)).not.toMatch(/eds_|access_token|desktop_session|Bearer/i);
  });

  it('labels explicit no-negative bypass output as dry-run only', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(policy))
      .mockResolvedValueOnce(jsonResponse(runtime))
      .mockResolvedValueOnce(jsonResponse(openResult))
      .mockResolvedValueOnce(jsonResponse(runtime))
      .mockResolvedValueOnce(jsonResponse(stopResult))
      .mockResolvedValueOnce(jsonResponse({ ...runtime, status: 'stopped' }));

    const proof = await browserCanary.runBusinessBrowserLiveCanary({
      env: {
        ...env,
        AIONUI_EVAOS_BUSINESS_BROWSER_WRONG_CUSTOMER_ID: undefined,
        AIONUI_EVAOS_BUSINESS_BROWSER_DENIED_SESSION: undefined,
        AIONUI_EVAOS_BUSINESS_BROWSER_ALLOW_NO_NEGATIVE: '1',
      },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(proof).toMatchObject({
      dryRun: true,
      acceptanceProof: false,
      customerIsolation: 'not-run',
      negativeBoundary: 'not-run',
    });
  });

  it('marks denied-session-only proof as non-acceptance because customer isolation was not run', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(policy))
      .mockResolvedValueOnce(jsonResponse(runtime))
      .mockResolvedValueOnce(jsonResponse(openResult))
      .mockResolvedValueOnce(jsonResponse(runtime))
      .mockResolvedValueOnce(jsonResponse(stopResult))
      .mockResolvedValueOnce(jsonResponse({ ...runtime, status: 'stopped' }))
      .mockResolvedValueOnce(jsonResponse(denied, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse(denied, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse(denied, { status: 403 }));

    const proof = await browserCanary.runBusinessBrowserLiveCanary({
      env: {
        ...env,
        AIONUI_EVAOS_BUSINESS_BROWSER_WRONG_CUSTOMER_ID: undefined,
      },
      fetchImpl,
    });

    expect(proof).toMatchObject({
      acceptanceProof: false,
      customerIsolation: 'not-run',
      deniedMember: {
        runtime: {
          backendDenied: true,
        },
      },
    });
  });
});
