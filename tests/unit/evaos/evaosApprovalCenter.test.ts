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
      AIONUI_EVAOS_DESKTOP_SESSION: 'eds_approval_secret_for_test',
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
      membership_id: 'mem_approver',
      email: 'approver@example.test',
      membership_role: 'admin',
      status: 'active',
    },
  ],
};

function policyPayload(scopes: string[], membershipId = 'mem_approver') {
  return {
    schema_version: 'evaos.account_policy.v1',
    customer_account_id: 'acct_123',
    selected_customer_id: 'david-poku',
    membership_id: membershipId,
    membership_role: 'admin',
    scopes,
    advanced_surfaces: {},
    backend_enforced: true,
    audit_id: 'audit_policy_123',
  };
}

const approvalPayload = {
  approval_id: 'approval-email-1',
  owner_id: 'owner_123',
  agent_id: 'agent_email',
  requester_membership_id: 'mem_requester',
  tool_name: 'gmail.send',
  risk_class: 'critical',
  action_payload: {
    actual_recipient_email: 'attacker@example.net',
    recipient_email: 'customer@example.test',
    subject: 'Wire instructions',
    body: 'Please send the payment.',
    display_name: 'Trusted Vendor',
    access_token: 'raw-token-should-not-render',
  },
  allow_always_supported: true,
  created_at: '2026-06-03T11:59:00.000Z',
  expires_at: '2026-06-03T12:10:00.000Z',
  source_pointer: 'approval:approval-email-1',
  audit_id: 'audit_request_123',
};

describe('EvaosBrokerSessionClient Approval Center', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed without broker calls when Approval Center loads without a desktop session', async () => {
    const fetchImpl = fetchMock();
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await expect(client.approvalCenter({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'missing_session',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns route denial without listing approvals when approve_actions is absent', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['manage_members'])));
    const client = authenticatedClient(fetchImpl);

    const center = await client.approvalCenter({ customerId: 'david-poku' });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(center).toMatchObject({
      schemaVersion: 'evaos.approval_center.v1',
      routeDenied: true,
      routeDenialReason: 'Approval Center requires the approve_actions scope for this customer account.',
      requests: [],
      summaryText: 'Approval Center denied by account policy',
      policyAuditId: 'audit_policy_123',
    });
  });

  it('returns route denial without listing approvals when backend policy proof is missing', async () => {
    const fetchImpl = fetchMock();
    fetchImpl.mockResolvedValueOnce(jsonResponse(accountPayload)).mockResolvedValueOnce(
      jsonResponse({
        ...policyPayload(['approve_actions']),
        backend_enforced: false,
        audit_id: '',
      })
    );
    const client = authenticatedClient(fetchImpl);

    const center = await client.approvalCenter({ customerId: 'david-poku' });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(center).toMatchObject({
      schemaVersion: 'evaos.approval_center.v1',
      routeDenied: true,
      routeDenialReason: 'Approval Center requires backend-enforced account policy proof.',
      requests: [],
      summaryText: 'Approval Center denied until backend policy proof is available',
      backendEnforced: false,
    });
    expect(center.policyAuditId).toBeUndefined();
  });

  it('lists approvals with actual-destination proof and no renderer-visible secrets', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['approve_actions'])))
      .mockResolvedValueOnce(
        jsonResponse({
          customer_id: 'david-poku',
          source_pointer: 'approvals:pending',
          audit_id: 'audit_list_123',
          requests: [approvalPayload],
        })
      );
    const client = authenticatedClient(fetchImpl);

    const center = await client.approvalCenter({ customerId: 'david-poku', limit: 7 });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(requestBody(fetchImpl.mock.calls[2])).toEqual({
      action: 'provider_approval_requests',
      customer_id: 'david-poku',
      limit: 7,
    });
    expect(center.routeDenied).toBe(false);
    expect(center.requests).toHaveLength(1);
    expect(center.requests[0]).toMatchObject({
      approvalId: 'approval-email-1',
      agentId: 'agent_email',
      requesterMembershipId: 'mem_requester',
      toolName: 'gmail.send',
      riskClass: 'critical',
      destinationPreview: {
        kind: 'email_recipient',
        primary: 'attacker@example.net',
        secondary: 'Wire instructions',
        actionable: true,
      },
      canDeny: true,
      canAllowOnce: true,
      canAllowAlways: true,
      sourcePointer: 'approval:approval-email-1',
      auditId: 'audit_request_123',
    });
    expect(center.requests[0].destinationProof?.fingerprint).toMatch(/^dest-[a-f0-9]{64}$/);
    expect(JSON.stringify(center)).not.toMatch(
      /eds_|epg_|access_token|raw-token|display_name|Please send|desktop_session|provider_grant|Bearer/i
    );
  });

  it('fails closed instead of rendering empty state when approval list schema is malformed', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['approve_actions'])))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          approval_count: 1,
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(client.approvalCenter({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
    });
  });

  it('fails closed instead of dropping malformed approval rows from non-empty lists', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['approve_actions'])))
      .mockResolvedValueOnce(
        jsonResponse({
          requests: [
            {
              ...approvalPayload,
              approval_id: '',
            },
          ],
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(client.approvalCenter({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
    });
  });

  it('allows deny for malformed destination rows while keeping allow decisions fail-closed', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['approve_actions'])))
      .mockResolvedValueOnce(
        jsonResponse({
          requests: [
            {
              ...approvalPayload,
              action_payload: {
                display_name: 'Looks safe',
              },
            },
          ],
        })
      );
    const client = authenticatedClient(fetchImpl);

    const center = await client.approvalCenter({ customerId: 'david-poku' });

    expect(center.requests[0]).toMatchObject({
      destinationPreview: {
        kind: 'missing_destination',
        actionable: false,
      },
      canDeny: true,
      canAllowOnce: false,
      canAllowAlways: false,
      availableDecisions: ['deny'],
    });
    expect(center.requests[0].destinationProof).toBeUndefined();
  });

  it('fails credential-bearing URL approval rows closed as deny-only missing destinations', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['approve_actions'])))
      .mockResolvedValueOnce(
        jsonResponse({
          requests: [
            {
              ...approvalPayload,
              tool_name: 'browser.fetch',
              action_payload: {
                actual_url: 'https://user:password@example.test/path',
              },
            },
            {
              ...approvalPayload,
              approval_id: 'approval-url-query',
              source_pointer: 'approval:approval-url-query',
              tool_name: 'browser.fetch',
              action_payload: {
                actual_url: 'https://example.test/path?access_token=raw-token',
              },
            },
          ],
        })
      );
    const client = authenticatedClient(fetchImpl);

    const center = await client.approvalCenter({ customerId: 'david-poku' });

    expect(center.requests).toHaveLength(2);
    for (const request of center.requests) {
      expect(request).toMatchObject({
        destinationPreview: {
          kind: 'missing_destination',
          actionable: false,
        },
        canDeny: true,
        canAllowOnce: false,
        canAllowAlways: false,
        availableDecisions: ['deny'],
      });
      expect(JSON.stringify(request)).not.toMatch(/password|access_token|raw-token/i);
    }
  });

  it('denies requester self-decisions before posting the decision mutation', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['approve_actions'], 'mem_requester')))
      .mockResolvedValueOnce(jsonResponse(approvalPayload));
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.denyApproval({ customerId: 'david-poku', approvalId: 'approval-email-1' })
    ).rejects.toMatchObject({
      code: 'action_denied',
      message: 'Requesters cannot deny their own approval requests.',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('fails closed before posting deny decisions when requester evidence is missing', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['approve_actions'])))
      .mockResolvedValueOnce(
        jsonResponse({
          ...approvalPayload,
          requester_membership_id: undefined,
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.denyApproval({ customerId: 'david-poku', approvalId: 'approval-email-1' })
    ).rejects.toMatchObject({
      code: 'action_denied',
      message: 'Approval requester and approver evidence is required before denying.',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('fails closed before fetching approval details when deny policy proof is missing', async () => {
    const fetchImpl = fetchMock();
    fetchImpl.mockResolvedValueOnce(jsonResponse(accountPayload)).mockResolvedValueOnce(
      jsonResponse({
        ...policyPayload(['approve_actions']),
        backend_enforced: false,
        audit_id: '',
      })
    );
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.denyApproval({ customerId: 'david-poku', approvalId: 'approval-email-1' })
    ).rejects.toMatchObject({
      code: 'action_denied',
      message: 'Approval decisions require backend-enforced account policy proof.',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not accept generic requester ids as membership evidence for deny decisions', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['approve_actions'])))
      .mockResolvedValueOnce(
        jsonResponse({
          ...approvalPayload,
          requester_membership_id: undefined,
          requester_id: 'user_requester_not_membership',
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.denyApproval({ customerId: 'david-poku', approvalId: 'approval-email-1' })
    ).rejects.toMatchObject({
      code: 'action_denied',
      message: 'Approval requester and approver evidence is required before denying.',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not copy backend decision or runtime message text into renderer metadata', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['approve_actions'])))
      .mockResolvedValueOnce(jsonResponse(approvalPayload))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'denied',
          approval_id: 'approval-email-1',
          message: 'Sensitive backend detail should not render.',
          runtime_result: {
            status: 'denied',
            runtime: 'openclaw',
            message: 'Sensitive runtime detail should not render.',
            source_pointer: 'approval-result:approval-email-1',
            audit_id: 'audit_result_123',
          },
          source_pointer: 'approval-decision:approval-email-1',
          audit_id: 'audit_decision_123',
          backend_enforced: true,
        })
      );
    const client = authenticatedClient(fetchImpl);

    const result = await client.denyApproval({ customerId: 'david-poku', approvalId: 'approval-email-1' });

    expect(JSON.stringify(result)).not.toMatch(/Sensitive backend detail|Sensitive runtime detail/);
    expect(result.runtimeResult).toMatchObject({
      status: 'denied',
      runtime: 'openclaw',
      sourcePointer: 'approval-result:approval-email-1',
      auditId: 'audit_result_123',
    });
  });

  it('fails closed before posting deny decisions when approver membership evidence is missing', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(
        jsonResponse({
          ...policyPayload(['approve_actions']),
          membership_id: '',
        })
      )
      .mockResolvedValueOnce(jsonResponse(approvalPayload));
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.denyApproval({ customerId: 'david-poku', approvalId: 'approval-email-1' })
    ).rejects.toMatchObject({
      code: 'action_denied',
      message: 'Approval requester and approver evidence is required before denying.',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('posts broker deny decisions with audit evidence and renders runtime result metadata only', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['approve_actions'])))
      .mockResolvedValueOnce(jsonResponse(approvalPayload))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'denied',
          approval_id: 'approval-email-1',
          message: 'Request denied.',
          runtime_result: {
            status: 'denied',
            runtime: 'openclaw',
            source_pointer: 'approval-result:approval-email-1',
            audit_id: 'audit_result_123',
            provider_grant_handle: 'epg_should_not_render',
          },
          source_pointer: 'approval-decision:approval-email-1',
          audit_id: 'audit_decision_123',
          backend_enforced: true,
        })
      );
    const client = authenticatedClient(fetchImpl);

    const result = await client.denyApproval({
      customerId: 'david-poku',
      approvalId: 'approval-email-1',
      reason: 'No longer needed.',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(requestBody(fetchImpl.mock.calls[2])).toEqual({
      action: 'provider_approval_request',
      customer_id: 'david-poku',
      approval_id: 'approval-email-1',
    });
    const decisionBody = requestBody(fetchImpl.mock.calls[3]);
    expect(decisionBody).toMatchObject({
      action: 'provider_approval_decide',
      customer_id: 'david-poku',
      approval_id: 'approval-email-1',
      decision: 'deny',
      scope: 'this-call',
      request_source_pointer: 'approval:approval-email-1',
      request_audit_id: 'audit_request_123',
      reason: 'No longer needed.',
    });
    expect(decisionBody.destination_proof).toMatchObject({
      kind: 'email_recipient',
      summary: 'email_recipient: attacker@example.net (Wire instructions)',
      source_pointer: 'approval:approval-email-1',
    });
    expect(result).toMatchObject({
      status: 'denied',
      decision: 'deny',
      scope: 'this-call',
      approvalId: 'approval-email-1',
      runtimeResult: {
        status: 'denied',
        runtime: 'openclaw',
        sourcePointer: 'approval-result:approval-email-1',
        auditId: 'audit_result_123',
      },
      sourcePointer: 'approval-decision:approval-email-1',
      auditId: 'audit_decision_123',
      backendEnforced: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/eds_|epg_|provider_grant|access_token|desktop_session|Bearer/i);
  });

  it('fails closed when deny responses lack backend runtime and audit proof', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['approve_actions'])))
      .mockResolvedValueOnce(jsonResponse(approvalPayload))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'denied',
          approval_id: 'approval-email-1',
          message: 'Looks denied but lacks runtime/audit enforcement proof.',
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.denyApproval({ customerId: 'david-poku', approvalId: 'approval-email-1' })
    ).rejects.toMatchObject({
      code: 'broker_invalid_response',
      message: 'The evaOS broker did not return deny enforcement proof.',
    });
  });
});
