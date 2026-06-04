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
const providerCanary = require('../../../scripts/evaosProviderHubLiveCanary.js') as {
  DEFAULT_REQUIRED_STATES: string[];
  parseRequiredStates: (value?: string) => string[];
  runProviderHubLiveCanary: (options: {
    env: Record<string, string | undefined>;
    fetchImpl: typeof fetch;
  }) => Promise<Record<string, unknown>>;
  summarizeProviderHubResponse: (
    raw: unknown,
    request: { customerId: string; customerAccountId?: string; requiredStates: string[] }
  ) => Record<string, unknown>;
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const policy = {
  customer_id: 'cus_123',
  customer_account_id: 'acct_123',
  membership_id: 'mem_admin',
  membership_role: 'admin',
  scopes: ['manage_integrations'],
  backend_enforced: true,
  audit_id: 'audit_policy_123',
};

function providerProfile(provider_key: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    provider_key,
    status,
    customer_account_id: 'acct_123',
    source_pointer: `broker:provider_profile:${provider_key}`,
    audit_id: `audit_${provider_key}`,
    ...(status === 'connected'
      ? {
          grant_handle: `epg_${provider_key}_handle_for_test`,
          last_validated_at: '2026-06-03T12:00:00.000Z',
        }
      : {}),
    ...overrides,
  };
}

const providerHub = {
  customer_id: 'cus_123',
  active_provider_key: 'google_workspace',
  backend_enforced: true,
  source_pointer: 'broker:provider_profiles:cus_123',
  audit_id: 'audit_provider_list',
  provider_profiles: [
    providerProfile('google_workspace', 'connected'),
    providerProfile('slack', 'needs_login'),
    providerProfile('notion', 'expired'),
    providerProfile('github', 'revoked'),
    providerProfile('linear', 'approval_required', { approval_required: true }),
  ],
};

describe('evaOS Provider Hub live canary', () => {
  it('parses required provider states and rejects unsupported states', () => {
    expect(providerCanary.parseRequiredStates(undefined)).toEqual(providerCanary.DEFAULT_REQUIRED_STATES);
    expect(providerCanary.parseRequiredStates('connected,expired')).toEqual(['connected', 'expired']);
    expect(() => providerCanary.parseRequiredStates('connected,raw_secret')).toThrow(/Unsupported provider state/);
  });

  it('summarizes required provider states without exposing grant handles', () => {
    const proof = providerCanary.summarizeProviderHubResponse(providerHub, {
      customerId: 'cus_123',
      customerAccountId: 'acct_123',
      requiredStates: ['connected', 'needs_login', 'expired', 'revoked', 'approval_required'],
    });

    expect(proof).toMatchObject({
      schema: 'evaos-provider-hub-live-canary/v1',
      customerId: 'cus_123',
      backendEnforced: true,
      profileCount: 5,
      statesPresent: ['approval_required', 'connected', 'expired', 'needs_login', 'revoked'],
      sensitiveOutput: 'passed',
    });
    expect(JSON.stringify(proof)).not.toMatch(/epg_|grant_handle|provider_grant|access_token|desktop_session|Bearer/i);
  });

  it('fails closed when required provider states are absent', () => {
    expect(() =>
      providerCanary.summarizeProviderHubResponse(
        {
          ...providerHub,
          provider_profiles: [providerProfile('google_workspace', 'connected')],
        },
        {
          customerId: 'cus_123',
          customerAccountId: 'acct_123',
          requiredStates: ['connected', 'expired'],
        }
      )
    ).toThrow(/missing required provider states: expired/);
  });

  it('fails closed when provider profiles report raw Workbench secrets', () => {
    expect(() =>
      providerCanary.summarizeProviderHubResponse(
        {
          ...providerHub,
          provider_profiles: [providerProfile('linear', 'connected', { raw_secrets_stored_in_workbench: true })],
        },
        {
          customerId: 'cus_123',
          customerAccountId: 'acct_123',
          requiredStates: ['connected'],
        }
      )
    ).toThrow(/raw secrets stored in Workbench/);
  });

  it('runs permissions and provider profile checks without printing the desktop session', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(policy))
      .mockResolvedValueOnce(jsonResponse(providerHub));

    const proof = await providerCanary.runProviderHubLiveCanary({
      env: {
        AIONUI_EVAOS_DESKTOP_SESSION: 'eds_provider_session_for_test',
        AIONUI_EVAOS_CUSTOMER_ID: 'cus_123',
        AIONUI_EVAOS_BROKER_ENDPOINT: 'https://broker.example.test/runtime',
      },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer eds_provider_session_for_test',
      'Content-Type': 'application/json',
    });
    expect(proof).toMatchObject({
      schema: 'evaos-provider-hub-live-proof/v1',
      customerId: 'cus_123',
      providerHub: {
        profileCount: 5,
      },
      sensitiveOutput: 'passed',
    });
    expect(JSON.stringify(proof)).not.toContain('eds_provider_session_for_test');
  });
});
