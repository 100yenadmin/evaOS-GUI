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
      AIONUI_EVAOS_DESKTOP_SESSION: 'eds_provider_hub_secret_for_test',
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

const connectedGoogleProfile = {
  provider_key: 'google_workspace',
  title: 'Google Workspace',
  subtitle: 'Email, calendar, and Drive',
  status: 'connected',
  active: false,
  capabilities: ['gmail', 'calendar'],
  usage_summary: 'Used for customer inbox triage',
  grant_id: 'grant_google_workspace_sales',
  grant_handle: 'epg_google_broker_handle_for_test',
  revoke_handle: 'epg_google_revoke_handle_for_test',
  customer_account_id: 'acct_123',
  owner_kind: 'user',
  owner_user_id: 'usr_123',
  granted_scopes: ['gmail.readonly', 'calendar.readonly'],
  expires_at: '2026-06-10T12:00:00.000Z',
  display: {
    account_label: 'sales@example.test',
    last_checked_at: '2026-06-03T11:50:00.000Z',
  },
  last_validated_at: '2026-06-03T11:51:00.000Z',
  source_pointer: 'broker:provider_grant:grant_google_workspace_sales',
  audit_id: 'audit_google_123',
  access_token: 'raw-provider-token-should-not-render',
};

function providerProfilesResponse(profiles: unknown[]) {
  return {
    customer_id: 'david-poku',
    active_provider_key: 'google_workspace',
    provider_profiles: profiles,
    source_pointer: 'broker:provider_profiles:david-poku',
    audit_id: 'audit_provider_list_123',
    backend_enforced: true,
  };
}

describe('EvaosBrokerSessionClient provider hub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed without broker calls when Connected Apps loads without a desktop session', async () => {
    const fetchImpl = fetchMock();
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await expect(client.providerHub({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'missing_session',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns route denial without listing providers when manage_integrations is absent', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['view_company_brain'])));
    const client = authenticatedClient(fetchImpl);

    const hub = await client.providerHub({ customerId: 'david-poku' });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(hub).toMatchObject({
      schemaVersion: 'evaos.provider_hub.v1',
      routeDenied: true,
      routeDenialReason: 'Connected Apps requires the manage_integrations scope for this customer account.',
      profiles: [],
      summaryText: 'Connected Apps denied by account policy',
      policyAuditId: 'audit_policy_123',
    });
  });

  it('sanitizes broker provider states without exposing handles or raw provider secrets', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations', 'approve_actions'])))
      .mockResolvedValueOnce(
        jsonResponse(
          providerProfilesResponse([
            connectedGoogleProfile,
            {
              provider_key: 'slack',
              title: 'Slack',
              status: 'approval_required',
              display: { account_label: 'workspace.example' },
              source_pointer: 'broker:provider_profile:slack',
              audit_id: 'audit_slack_123',
            },
            {
              provider_key: 'notion',
              status: 'expired',
              grant_id: 'grant_notion',
              source_pointer: 'broker:provider_profile:notion',
              audit_id: 'audit_notion_123',
            },
            {
              provider_key: 'github',
              status: 'revoked',
              grant_id: 'grant_github',
              source_pointer: 'broker:provider_profile:github',
              audit_id: 'audit_github_123',
            },
            {
              provider_key: 'pipedream',
              status: 'connected',
              source_pointer: 'broker:provider_profile:pipedream',
              audit_id: 'audit_pipedream_123',
            },
            {
              provider_key: 'linear',
              status: 'connected',
              raw_secrets_stored_in_workbench: true,
              grant_handle: 'epg_linear_handle_for_test',
              source_pointer: 'broker:provider_profile:linear',
              audit_id: 'audit_linear_123',
            },
          ])
        )
      );
    const client = authenticatedClient(fetchImpl);

    const hub = await client.providerHub({ customerId: 'david-poku' });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(requestBody(fetchImpl.mock.calls[2])).toEqual({
      action: 'provider_profiles',
      customer_id: 'david-poku',
    });
    expect(hub.routeDenied).toBe(false);
    expect(hub.profiles).toHaveLength(6);
    expect(hub.profiles[0]).toMatchObject({
      providerKey: 'google_workspace',
      status: 'connected',
      accountLabel: 'sales@example.test',
      hasConnectionProof: true,
      hasBrokeredGrant: true,
      summaryText: 'Ready',
    });
    expect(hub.profiles[0].sourcePointer).toBeUndefined();
    expect(hub.profiles[1]).toMatchObject({
      providerKey: 'slack',
      status: 'approval_required',
      approvalRequired: true,
      sourcePointer: 'broker:provider_profile:slack',
      summaryText: 'Approval required',
    });
    expect(hub.profiles[2]).toMatchObject({
      providerKey: 'notion',
      status: 'expired',
      summaryText: 'Needs reconnection',
    });
    expect(hub.profiles[3]).toMatchObject({
      providerKey: 'github',
      status: 'revoked',
      summaryText: 'Revoked',
    });
    expect(hub.profiles[4]).toMatchObject({
      providerKey: 'pipedream',
      status: 'connected',
      hasConnectionProof: false,
      summaryText: 'Needs verification',
    });
    expect(hub.profiles[5]).toMatchObject({
      providerKey: 'linear',
      rawSecretsStoredInWorkbench: true,
      hasConnectionProof: false,
      summaryText: 'Blocked',
    });
    expect(JSON.stringify(hub)).not.toMatch(
      /\b(?:eds|epg)_[A-Za-z0-9_-]+\b|access_token|raw-provider-token|provider_grant|grant_google|grantId|grant_handle|revoke_handle|desktop_session|Bearer/i
    );
  });

  it('fails closed when provider profile list lacks broker enforcement proof', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(
        jsonResponse({
          customer_id: 'david-poku',
          provider_profiles: [connectedGoogleProfile],
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(client.providerHub({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker did not return provider profile enforcement proof.',
    });
  });

  it('fails closed when provider profile evidence belongs to a different customer', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(
        jsonResponse({
          ...providerProfilesResponse([connectedGoogleProfile]),
          customer_id: 'other-customer',
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(client.providerHub({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker returned provider profile evidence for a different customer.',
    });
  });

  it('fails closed when provider profile row belongs to a different customer account', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(
        jsonResponse(
          providerProfilesResponse([
            {
              ...connectedGoogleProfile,
              customer_account_id: 'acct_other',
            },
          ])
        )
      );
    const client = authenticatedClient(fetchImpl);

    await expect(client.providerHub({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
    });
  });

  it('fails closed instead of rendering empty state when provider list schema is malformed', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(jsonResponse({ ok: true, provider_count: 1 }));
    const client = authenticatedClient(fetchImpl);

    await expect(client.providerHub({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
    });
  });

  it('fails closed instead of dropping malformed provider rows from non-empty lists', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(
        jsonResponse(
          providerProfilesResponse([
            {
              ...connectedGoogleProfile,
              provider_key: '',
            },
          ])
        )
      );
    const client = authenticatedClient(fetchImpl);

    await expect(client.providerHub({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
    });
  });

  it('redacts provider auth URLs and requires backend action proof', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(
        jsonResponse({
          provider_key: 'google_workspace',
          status: 'pending',
          message: 'Auth handoff prepared.',
          connect_url: 'https://auth.example.test/oauth/start?access_token=raw-token-should-not-render#frag',
          expires_at: '2026-06-03T12:05:00.000Z',
          source_pointer: 'broker:provider_auth_start:google_workspace',
          audit_id: 'audit_auth_123',
          backend_enforced: true,
          provider_profiles: [connectedGoogleProfile],
        })
      );
    const client = authenticatedClient(fetchImpl);

    const result = await client.startProviderAuth({ customerId: 'david-poku', providerKey: 'google_workspace' });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(requestBody(fetchImpl.mock.calls[2])).toEqual({
      action: 'provider_auth_start',
      customer_id: 'david-poku',
      provider_key: 'google_workspace',
    });
    expect(result).toMatchObject({
      status: 'pending',
      providerKey: 'google_workspace',
      authUrlSummary: {
        host: 'auth.example.test',
        path: '/oauth/start',
        displayText: 'auth.example.test/oauth/start',
        redacted: true,
      },
      auditId: 'audit_auth_123',
      backendEnforced: true,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /raw-token|access_token|connect_url|\bepg_[A-Za-z0-9_-]+\b|grant_handle|Bearer/i
    );
  });

  it('opens allowlisted provider auth URLs from the main process without returning raw URLs', async () => {
    const fetchImpl = fetchMock();
    const openAuthUrl = vi.fn(async () => undefined);
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(
        jsonResponse({
          provider_key: 'google_workspace',
          status: 'pending',
          message: 'Auth handoff prepared.',
          connect_url: 'https://connect.pipedream.com/oauth/start?token=short-lived-provider-token#state',
          expires_at: '2026-06-03T12:05:00.000Z',
          source_pointer: 'broker:provider_auth_start:google_workspace',
          audit_id: 'audit_auth_123',
          backend_enforced: true,
          provider_profiles: [connectedGoogleProfile],
        })
      );
    const client = authenticatedClient(fetchImpl);

    const result = await client.startProviderAuth(
      { customerId: 'david-poku', providerKey: 'google_workspace' },
      { openAuthUrl }
    );

    expect(openAuthUrl).toHaveBeenCalledWith(
      'https://connect.pipedream.com/oauth/start?token=short-lived-provider-token#state'
    );
    expect(result.authUrlSummary).toEqual({
      scheme: 'https',
      host: 'connect.pipedream.com',
      path: '/oauth/start',
      displayText: 'connect.pipedream.com/oauth/start',
      redacted: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/short-lived-provider-token|connect_url|target_url|access_token/i);
  });

  it('fails closed instead of opening non-Pipedream provider auth URLs', async () => {
    const fetchImpl = fetchMock();
    const openAuthUrl = vi.fn(async () => undefined);
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(
        jsonResponse({
          provider_key: 'google_workspace',
          status: 'pending',
          connect_url: 'https://evil.example.test/oauth/start?token=short-lived-provider-token',
          source_pointer: 'broker:provider_auth_start:google_workspace',
          audit_id: 'audit_auth_123',
          backend_enforced: true,
          provider_profiles: [connectedGoogleProfile],
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.startProviderAuth({ customerId: 'david-poku', providerKey: 'google_workspace' }, { openAuthUrl })
    ).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker did not return an approved provider auth handoff URL.',
    });
    expect(openAuthUrl).not.toHaveBeenCalled();
  });

  it('fails closed when provider action proof lacks its own audit id', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(
        jsonResponse({
          provider_key: 'google_workspace',
          status: 'pending',
          source_pointer: 'broker:provider_auth_start:google_workspace',
          backend_enforced: true,
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.startProviderAuth({ customerId: 'david-poku', providerKey: 'google_workspace' })
    ).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker did not return provider action enforcement proof.',
    });
  });

  it('fails closed when provider action proof uses provider-list source pointer', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(
        jsonResponse({
          provider_key: 'google_workspace',
          status: 'pending',
          source_pointer: 'broker:provider_profiles:david-poku',
          audit_id: 'audit_auth_123',
          backend_enforced: true,
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.startProviderAuth({ customerId: 'david-poku', providerKey: 'google_workspace' })
    ).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker did not return provider action enforcement proof.',
    });
  });

  it('denies provider mutations before action RPCs when policy proof is not backend-enforced', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'], { backend_enforced: false })));
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.startProviderAuth({ customerId: 'david-poku', providerKey: 'google_workspace' })
    ).rejects.toMatchObject({
      code: 'action_denied',
      message: 'Connected app actions require backend-enforced account policy proof.',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('denies provider mutations before action RPCs when policy audit proof is missing', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'], { audit_id: undefined })));
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.revokeProvider({ customerId: 'david-poku', providerKey: 'google_workspace' })
    ).rejects.toMatchObject({
      code: 'action_denied',
      message: 'Connected app actions require backend-enforced account policy proof.',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('denies switch and grant minting for expired or revoked provider profiles before mutation RPCs', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(
        jsonResponse(
          providerProfilesResponse([
            {
              provider_key: 'google_workspace',
              status: 'expired',
              grant_id: 'grant_google_workspace_sales',
              source_pointer: 'broker:provider_profile:google_workspace',
              audit_id: 'audit_google_123',
            },
          ])
        )
      );
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.mintProviderGrant({ customerId: 'david-poku', providerKey: 'google_workspace', agentRuntime: 'openclaw' })
    ).rejects.toMatchObject({
      code: 'action_denied',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    fetchImpl.mockReset();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(
        jsonResponse(
          providerProfilesResponse([
            {
              provider_key: 'google_workspace',
              status: 'revoked',
              grant_id: 'grant_google_workspace_sales',
              source_pointer: 'broker:provider_profile:google_workspace',
              audit_id: 'audit_google_123',
            },
          ])
        )
      );

    await expect(
      client.switchProvider({ customerId: 'david-poku', providerKey: 'google_workspace' })
    ).rejects.toMatchObject({
      code: 'action_denied',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('denies switch and grant minting when connected profile has only grant id without proof', async () => {
    const weakConnectedProfile = {
      provider_key: 'google_workspace',
      status: 'connected',
      grant_id: 'grant_google_workspace_sales',
      source_pointer: 'broker:provider_profile:google_workspace',
      audit_id: 'audit_google_123',
    };
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(jsonResponse(providerProfilesResponse([weakConnectedProfile])));
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.mintProviderGrant({ customerId: 'david-poku', providerKey: 'google_workspace', agentRuntime: 'openclaw' })
    ).rejects.toMatchObject({
      code: 'action_denied',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    fetchImpl.mockReset();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(jsonResponse(providerProfilesResponse([weakConnectedProfile])));

    await expect(
      client.switchProvider({ customerId: 'david-poku', providerKey: 'google_workspace' })
    ).rejects.toMatchObject({
      code: 'action_denied',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('denies switch and grant minting when connected proof is stale or only handle-shaped', async () => {
    const handleOnlyProfile = {
      ...connectedGoogleProfile,
      last_validated_at: undefined,
    };
    const staleProfile = {
      ...connectedGoogleProfile,
      last_validated_at: '2026-06-01T11:00:00.000Z',
    };
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(jsonResponse(providerProfilesResponse([handleOnlyProfile])));
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.mintProviderGrant({ customerId: 'david-poku', providerKey: 'google_workspace', agentRuntime: 'openclaw' })
    ).rejects.toMatchObject({
      code: 'action_denied',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    fetchImpl.mockReset();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(jsonResponse(providerProfilesResponse([staleProfile])));

    await expect(
      client.switchProvider({ customerId: 'david-poku', providerKey: 'google_workspace' })
    ).rejects.toMatchObject({
      code: 'action_denied',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('mints brokered grants only after connected proof and never exposes raw grant handles', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_integrations'])))
      .mockResolvedValueOnce(jsonResponse(providerProfilesResponse([connectedGoogleProfile])))
      .mockResolvedValueOnce(
        jsonResponse({
          provider_key: 'google_workspace',
          status: 'granted',
          message: 'Grant minted.',
          source_pointer: 'broker:provider_mint_grant:google_workspace',
          audit_id: 'audit_mint_123',
          backend_enforced: true,
          grant_handle: 'epg_new_handle_for_test',
          provider_profiles: [connectedGoogleProfile],
        })
      );
    const client = authenticatedClient(fetchImpl);

    const result = await client.mintProviderGrant({
      customerId: 'david-poku',
      providerKey: 'google_workspace',
      agentRuntime: 'hermes',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(requestBody(fetchImpl.mock.calls[2])).toEqual({
      action: 'provider_profiles',
      customer_id: 'david-poku',
    });
    expect(requestBody(fetchImpl.mock.calls[3])).toEqual({
      action: 'provider_mint_grant',
      customer_id: 'david-poku',
      provider_key: 'google_workspace',
      agent_runtime: 'hermes',
    });
    expect(result).toMatchObject({
      status: 'granted',
      providerKey: 'google_workspace',
      auditId: 'audit_mint_123',
      backendEnforced: true,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /\bepg_[A-Za-z0-9_-]+\b|grant_handle|access_token|refresh_token|Bearer/i
    );
  });
});
