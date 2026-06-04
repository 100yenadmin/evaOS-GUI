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
      AIONUI_EVAOS_DESKTOP_SESSION: 'eds_people_access_secret_for_test',
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
      membership_id: 'mem_owner',
      email: 'OWNER@EXAMPLE.TEST',
      membership_role: 'owner',
      seat_type: 'owner',
      status: 'active',
      joined_at: '2026-06-01T10:00:00.000Z',
      access_token: 'should-not-render',
    },
    {
      membership_id: 'mem_employee',
      email: 'employee@example.test',
      membership_role: 'member',
      seat_type: 'member',
      status: 'active',
    },
  ],
  invites: [
    {
      invite_id: 'inv_123',
      email: 'new@example.test',
      role: 'member',
      status: 'pending',
      expires_at: '2026-06-10T10:00:00.000Z',
    },
  ],
};

function policyPayload(scopes: string[]) {
  return {
    schema_version: 'evaos.account_policy.v1',
    customer_account_id: 'acct_123',
    selected_customer_id: 'david-poku',
    membership_id: 'mem_admin',
    membership_role: 'admin',
    plan_code: 'biz',
    seat_limit: 3,
    active_seats: 2,
    invited_seats: 1,
    scopes,
    advanced_surfaces: {
      openclaw_dashboard: false,
      hermes_dashboard: false,
      terminal: false,
      technical_diagnostics: false,
    },
    backend_enforced: true,
    updated_at: '2026-06-03T11:00:00.000Z',
    audit_id: 'audit_policy_123',
    provider_grant_handle: 'epg_should_not_render',
  };
}

describe('EvaosBrokerSessionClient People Access policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads account and permissions snapshots without exposing secrets', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(
        jsonResponse(
          policyPayload([
            'manage_members',
            'manage_integrations',
            'approve_actions',
            'open_business_browser',
            'view_company_brain',
          ])
        )
      );
    const client = authenticatedClient(fetchImpl);

    const policy = await client.peopleAccessPolicy({ customerId: 'david-poku' });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchImpl.mock.calls[0])).toEqual({
      action: 'current_customer_account',
      customer_id: 'david-poku',
    });
    expect(requestBody(fetchImpl.mock.calls[1])).toEqual({
      action: 'current_customer_account_permissions',
      customer_id: 'david-poku',
    });
    expect(policy).toMatchObject({
      schemaVersion: 'evaos.account_policy.v1',
      customerAccountId: 'acct_123',
      selectedCustomerId: 'david-poku',
      membershipRole: 'admin',
      planCode: 'biz',
      seatLimit: 3,
      activeSeats: 2,
      invitedSeats: 1,
      scopes: [
        'manage_members',
        'manage_integrations',
        'approve_actions',
        'open_business_browser',
        'view_company_brain',
      ],
      routeDenied: false,
      backendEnforced: true,
      auditId: 'audit_policy_123',
    });
    expect(policy.members).toHaveLength(2);
    expect(policy.members[0]).toMatchObject({
      memberId: 'mem_owner',
      email: 'owner@example.test',
      role: 'owner',
      status: 'active',
    });
    expect(policy.invites[0]).toMatchObject({
      inviteId: 'inv_123',
      email: 'new@example.test',
      role: 'member',
      status: 'pending',
    });
    expect(JSON.stringify(policy)).not.toMatch(/eds_|epg_|access_token|provider_grant|desktop_session|Bearer/i);
  });

  it('parses canonical support memberships without exposing support as a local trust authority', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse({
          ...accountPayload,
          members: [
            {
              membership_id: 'mem_support',
              email: 'support@example.test',
              membership_role: 'support',
              status: 'active',
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_members'])));
    const client = authenticatedClient(fetchImpl);

    const policy = await client.peopleAccessPolicy({ customerId: 'david-poku' });

    expect(policy.members).toEqual([
      {
        memberId: 'mem_support',
        email: 'support@example.test',
        role: 'support',
        status: 'active',
      },
    ]);
  });

  it('fails closed without broker calls when People Access loads without a desktop session', async () => {
    const fetchImpl = fetchMock();
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await expect(client.peopleAccessPolicy({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'missing_session',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when the account policy schema is malformed', async () => {
    const fetchImpl = fetchMock();
    fetchImpl.mockResolvedValueOnce(jsonResponse(accountPayload)).mockResolvedValueOnce(
      jsonResponse({
        ...policyPayload(['manage_members']),
        schema_version: 'not.account_policy',
      })
    );
    const client = authenticatedClient(fetchImpl);

    await expect(client.peopleAccessPolicy({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
    });
  });

  it('marks the People Access route denied when manage_members is absent', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser', 'view_company_brain'])));
    const client = authenticatedClient(fetchImpl);

    const policy = await client.peopleAccessPolicy({ customerId: 'david-poku' });

    expect(policy.routeDenied).toBe(true);
    expect(policy.routeDenialReason).toContain('manage_members');
  });

  it('rejects invalid invite input before checking policy or calling invite RPCs', async () => {
    const fetchImpl = fetchMock();
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.invitePeopleAccessMember({
        customerId: 'david-poku',
        email: 'not-an-email',
        role: 'member',
      })
    ).rejects.toMatchObject({
      code: 'invalid_email',
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      client.invitePeopleAccessMember({
        customerId: 'david-poku',
        email: 'new@example.test',
        role: 'owner',
      })
    ).rejects.toMatchObject({
      code: 'invalid_role',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('denies invite actions locally when policy lacks manage_members and does not call the invite RPC', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser'])));
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.invitePeopleAccessMember({
        customerId: 'david-poku',
        email: 'employee@example.test',
        role: 'member',
      })
    ).rejects.toMatchObject({
      code: 'action_denied',
      message: 'You do not have permission to invite members for this account.',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('surfaces backend denial when policy allows the action but the invite RPC rejects it', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_members'])))
      .mockResolvedValueOnce(jsonResponse({ error: 'denied' }, { status: 403 }));
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.invitePeopleAccessMember({
        customerId: 'david-poku',
        email: 'new@example.test',
        role: 'member',
      })
    ).rejects.toMatchObject({
      code: 'broker_http_error',
      status: 403,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(requestBody(fetchImpl.mock.calls[2])).toEqual({
      action: 'invite_customer_account_member',
      customer_id: 'david-poku',
      email: 'new@example.test',
      role: 'member',
    });
  });
});
