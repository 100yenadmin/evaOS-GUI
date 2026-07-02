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

  it('accepts the normalized provider profile shape used by Workbench views', () => {
    const proof = providerCanary.summarizeProviderHubResponse(
      {
        ...providerHub,
        customerId: 'cus_123',
        activeProviderKey: 'google_workspace',
        sourcePointer: 'broker:provider_profiles:cus_123',
        auditId: 'audit_provider_list',
        provider_profiles: [
          {
            providerKey: 'google_workspace',
            status: 'connected',
            customerAccountId: 'acct_123',
            hasConnectionProof: true,
            hasBrokeredGrant: true,
            lastValidatedAt: '2026-06-03T12:00:00.000Z',
            sourcePointer: 'broker:provider_profile:google_workspace',
            auditId: 'audit_google_workspace',
          },
          {
            providerKey: 'slack',
            status: 'needs_login',
            customerAccountId: 'acct_123',
            sourcePointer: 'broker:provider_profile:slack',
            auditId: 'audit_slack',
          },
        ],
      },
      {
        customerId: 'cus_123',
        customerAccountId: 'acct_123',
        requiredStates: ['connected', 'needs_login'],
      }
    );

    expect(proof).toMatchObject({
      schema: 'evaos-provider-hub-live-canary/v1',
      activeProviderKey: 'google_workspace',
      profileCount: 2,
      statesPresent: ['connected', 'needs_login'],
      profiles: [
        {
          providerKey: 'google_workspace',
          hasConnectionProof: true,
          hasBrokeredGrant: false,
          declaredConnectionProof: true,
          declaredBrokeredGrant: true,
          lastValidatedAt: '2026-06-03T12:00:00.000Z',
        },
        {
          providerKey: 'slack',
        },
      ],
    });
    expect(JSON.stringify(proof)).not.toMatch(/epg_|grantHandle|grant_handle/i);
  });

  it('uses the same provider key/status normalizers as Workbench broker views', () => {
    const proof = providerCanary.summarizeProviderHubResponse(
      {
        ...providerHub,
        provider_profiles: [
          providerProfile('google_workspace', 'needs_auth'),
          providerProfile('slack', 'disconnected'),
          providerProfile('notion', 'coming_soon'),
          providerProfile('linear', 'failed'),
        ],
      },
      {
        customerId: 'cus_123',
        customerAccountId: 'acct_123',
        requiredStates: ['needs_login', 'revoked', 'planned', 'error'],
      }
    );

    expect(proof).toMatchObject({
      statesPresent: ['error', 'needs_login', 'planned', 'revoked'],
      profiles: [
        { providerKey: 'google_workspace', status: 'needs_login' },
        { providerKey: 'slack', status: 'revoked' },
        { providerKey: 'notion', status: 'planned' },
        { providerKey: 'linear', status: 'error' },
      ],
    });
  });

  it('ignores unsupported provider rows while requiring known fixture states', () => {
    const proof = providerCanary.summarizeProviderHubResponse(
      {
        ...providerHub,
        provider_profiles: [
          {
            provider_key: 'unsupported_provider_for_test',
            status: 'connected',
            active: true,
            source_pointer: 'broker:provider_profile:unsupported',
            audit_id: 'audit_unsupported_123',
            last_validated_at: '2026-06-03T12:00:00.000Z',
          },
          providerProfile('google_workspace', 'connected'),
          providerProfile('slack', 'expired'),
        ],
      },
      {
        customerId: 'cus_123',
        customerAccountId: 'acct_123',
        requiredStates: ['connected', 'expired'],
      }
    );

    expect(proof).toMatchObject({
      profileCount: 2,
      ignoredUnsupportedProfileCount: 1,
      statesPresent: ['connected', 'expired'],
      profiles: [{ providerKey: 'google_workspace' }, { providerKey: 'slack' }],
    });
    expect(JSON.stringify(proof)).not.toMatch(/unsupported_provider_for_test|audit_unsupported_123/i);
  });

  it('does not accept bare normalized connection booleans as proof for connected providers', () => {
    expect(() =>
      providerCanary.summarizeProviderHubResponse(
        {
          ...providerHub,
          provider_profiles: [
            {
              providerKey: 'google_workspace',
              status: 'connected',
              customerAccountId: 'acct_123',
              hasConnectionProof: true,
              hasBrokeredGrant: true,
              sourcePointer: 'broker:provider_profile:google_workspace',
              auditId: 'audit_google_workspace',
            },
          ],
        },
        {
          customerId: 'cus_123',
          customerAccountId: 'acct_123',
          requiredStates: ['connected'],
        }
      )
    ).toThrow(/did not include connection proof/);
  });

  it('reports malformed provider profile shapes without exposing sensitive keys or values', () => {
    let message = '';
    try {
      providerCanary.summarizeProviderHubResponse(
        {
          ...providerHub,
          provider_profiles: [
            {
              state: 'connected',
              provider_grant: 'epg_secret_grant_value_for_test',
              access_token: 'eds_secret_desktop_session_for_test',
              api_key: 'api_key_secret_value_for_test',
              provider_profile: {
                state: 'connected',
                refresh_token: 'eyJsecret.header.payload',
                private_key: 'private_key_secret_value_for_test',
              },
            },
          ],
        },
        {
          customerId: 'cus_123',
          customerAccountId: 'acct_123',
          requiredStates: ['connected'],
        }
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('Provider profile at index 0 failed validation');
    expect(message).toContain('rootKeys=[');
    expect(message).toContain('nestedKeys=[');
    expect(message).toContain('state');
    expect(message).not.toMatch(/provider_grant|access_token|api_key|refresh_token|private_key|epg_|eds_|eyJ/i);
  });

  it('reports provider key/status validation dimensions without exposing invalid values', () => {
    let message = '';
    try {
      providerCanary.summarizeProviderHubResponse(
        {
          ...providerHub,
          provider_profiles: [
            {
              provider_key: 'private_provider_value_for_test',
              status: 'private_status_value_for_test',
              active: true,
              access_token: 'eds_secret_desktop_session_for_test',
              source_pointer: 'broker:provider_profile:private',
              audit_id: 'audit_private',
            },
          ],
        },
        {
          customerId: 'cus_123',
          customerAccountId: 'acct_123',
          requiredStates: ['connected'],
        }
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('providerKeyPresent=true');
    expect(message).toContain('providerKeyAccepted=false');
    expect(message).toContain('statusPresent=true');
    expect(message).toContain('statusAccepted=false');
    expect(message).not.toMatch(/private_provider_value_for_test|private_status_value_for_test|access_token|eds_/i);
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
