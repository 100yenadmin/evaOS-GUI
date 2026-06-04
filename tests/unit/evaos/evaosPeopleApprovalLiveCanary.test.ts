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
const peopleApprovalCanary = require('../../../scripts/evaosPeopleApprovalLiveCanary.js') as {
  runPeopleApprovalLiveCanary: (options: {
    env: Record<string, string | undefined>;
    fetchImpl: typeof fetch;
  }) => Promise<Record<string, unknown>>;
  summarizeApproverDecision: (raw: unknown, approvalId: string) => Record<string, unknown>;
  summarizeRequesterDenyAttempt: (result: {
    ok: boolean;
    httpStatus: number;
    body: unknown;
  }) => Record<string, unknown>;
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const env = {
  AIONUI_EVAOS_APPROVAL_DENY_ACK: 'evaos-deny-test',
  AIONUI_EVAOS_CUSTOMER_ID: 'cus_123',
  AIONUI_EVAOS_APPROVAL_ID: 'approval_123',
  AIONUI_EVAOS_REQUESTER_SESSION: 'eds_requester_session_for_test',
  AIONUI_EVAOS_APPROVER_SESSION: 'eds_approver_session_for_test',
  AIONUI_EVAOS_REQUESTER_MEMBERSHIP_ID: 'mem_requester',
  AIONUI_EVAOS_BROKER_ENDPOINT: 'https://broker.example.test/runtime',
};

const requesterPolicy = {
  customer_id: 'cus_123',
  membership_id: 'mem_requester',
  membership_role: 'operator',
  scopes: ['use_agents'],
  backend_enforced: true,
  audit_id: 'audit_policy_requester',
};

const approverPolicy = {
  customer_id: 'cus_123',
  membership_id: 'mem_approver',
  membership_role: 'admin',
  scopes: ['use_agents', 'approve_actions', 'manage_members'],
  backend_enforced: true,
  audit_id: 'audit_policy_approver',
};

const approval = {
  approval_id: 'approval_123',
  requester_membership_id: 'mem_requester',
  tool_name: 'gmail.send',
  risk_class: 'critical',
  source_pointer: 'approval:approval_123',
  audit_id: 'audit_request_123',
  destination_proof: {
    kind: 'email_recipient',
    fingerprint: 'fingerprint_123',
    summary: 'email_recipient: customer@example.test',
    source: 'aionui_preview',
    source_pointer: 'approval:approval_123',
  },
};

const denyResult = {
  status: 'denied',
  approval_id: 'approval_123',
  runtime_result: {
    status: 'denied',
    runtime: 'openclaw',
    source_pointer: 'approval-result:approval_123',
    audit_id: 'audit_result_123',
    provider_grant_handle: 'epg_should_not_render',
  },
  source_pointer: 'approval-decision:approval_123',
  audit_id: 'audit_decision_123',
  backend_enforced: true,
};

describe('evaOS People/Approval live canary', () => {
  it('fails closed without explicit deny-test acknowledgement', async () => {
    await expect(
      peopleApprovalCanary.runPeopleApprovalLiveCanary({
        env: { ...env, AIONUI_EVAOS_APPROVAL_DENY_ACK: 'nope' },
        fetchImpl: vi.fn<typeof fetch>(),
      })
    ).rejects.toThrow(/AIONUI_EVAOS_APPROVAL_DENY_ACK=evaos-deny-test/);
  });

  it('summarizes requester backend denial without treating approval denial as success', () => {
    expect(
      peopleApprovalCanary.summarizeRequesterDenyAttempt({
        ok: false,
        httpStatus: 403,
        body: {
          code: 'action_denied',
          message: 'Requesters cannot deny their own approval requests.',
          audit_id: 'audit_denied_123',
        },
      })
    ).toMatchObject({
      actor: 'requester',
      backendDenied: true,
      httpStatus: 403,
      code: 'action_denied',
      auditId: 'audit_denied_123',
    });

    expect(() =>
      peopleApprovalCanary.summarizeRequesterDenyAttempt({
        ok: true,
        httpStatus: 200,
        body: denyResult,
      })
    ).toThrow(/did not fail closed/);
  });

  it('requires backend and runtime audit proof for approver deny decisions', () => {
    expect(peopleApprovalCanary.summarizeApproverDecision(denyResult, 'approval_123')).toMatchObject({
      actor: 'approver',
      approvalId: 'approval_123',
      decision: 'deny',
      backendEnforced: true,
      sourcePointer: 'approval-decision:approval_123',
      auditId: 'audit_decision_123',
      runtimeSourcePointer: 'approval-result:approval_123',
      runtimeAuditId: 'audit_result_123',
    });

    expect(() =>
      peopleApprovalCanary.summarizeApproverDecision(
        {
          ...denyResult,
          backend_enforced: false,
        },
        'approval_123'
      )
    ).toThrow(/backend enforcement/);
  });

  it('runs requester denial then approver denial without printing sessions or provider grants', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(requesterPolicy))
      .mockResolvedValueOnce(jsonResponse(approverPolicy))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: 'action_denied',
            message: 'Requesters cannot deny their own approval requests.',
            audit_id: 'audit_denied_123',
          },
          { status: 403 }
        )
      )
      .mockResolvedValueOnce(jsonResponse(approval))
      .mockResolvedValueOnce(jsonResponse(denyResult));

    const proof = await peopleApprovalCanary.runPeopleApprovalLiveCanary({
      env,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer eds_requester_session_for_test',
      'Content-Type': 'application/json',
    });
    expect(fetchImpl.mock.calls[1][1]?.headers).toMatchObject({
      Authorization: 'Bearer eds_approver_session_for_test',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[4][1]?.body))).toMatchObject({
      action: 'provider_approval_decide',
      approval_id: 'approval_123',
      decision: 'deny',
      request_source_pointer: 'approval:approval_123',
      request_audit_id: 'audit_request_123',
    });
    expect(proof).toMatchObject({
      schema: 'evaos-people-approval-live-canary/v1',
      customerId: 'cus_123',
      approvalId: 'approval_123',
      requester: {
        denyAttempt: {
          backendDenied: true,
        },
      },
      approver: {
        denyDecision: {
          backendEnforced: true,
          runtimeAuditId: 'audit_result_123',
        },
      },
      sensitiveOutput: 'passed',
    });
    expect(JSON.stringify(proof)).not.toMatch(/eds_|epg_|provider_grant|access_token|desktop_session|Bearer/i);
  });
});
