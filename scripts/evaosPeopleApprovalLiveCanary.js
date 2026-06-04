#!/usr/bin/env node

const { DEFAULT_ENDPOINT } = require('./evaosBrokerLiveCanary.js');

const DENIED_STATUSES = new Set(['denied', 'rejected', 'blocked']);
const SECRET_OUTPUT_PATTERNS = [
  /\beds_[A-Za-z0-9_-]{8,}\b/,
  /\bepg_[A-Za-z0-9_-]{8,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/i,
  /\baccess[_-]?token\b/i,
  /\brefresh[_-]?token\b/i,
  /\bdesktop[_-]?session\b/i,
  /\bprovider[_-]?grant\b/i,
  /\bgrant[_-]?handle\b/i,
];

function safeText(value, maxLength = 220) {
  return typeof value === 'string' && value.trim() && value.trim().length <= maxLength ? value.trim() : undefined;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function recordFromEnvelope(raw) {
  const record = asRecord(raw);
  if (!record) return undefined;
  return asRecord(record.data) ?? record;
}

function safeBoolean(value) {
  return typeof value === 'boolean' ? value : undefined;
}

function deniedStatus(value) {
  const status = safeText(value, 60)?.toLowerCase();
  return status && DENIED_STATUSES.has(status) ? status : undefined;
}

function assertNoUnsafeProofOutput(value) {
  const text = JSON.stringify(value);
  const match = SECRET_OUTPUT_PATTERNS.find((pattern) => pattern.test(text));
  if (match) {
    throw new Error(`People/Approval canary proof exposed unsafe material matching ${match}.`);
  }
}

function requireEnv(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing ${key} for People/Approval live canary.`);
  }
  return value.trim();
}

function requireAck(env) {
  const ack = requireEnv(env, 'AIONUI_EVAOS_APPROVAL_DENY_ACK');
  if (ack !== 'evaos-deny-test') {
    throw new Error('Set AIONUI_EVAOS_APPROVAL_DENY_ACK=evaos-deny-test before mutating a staging approval.');
  }
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

async function postBrokerAction(fetchImpl, endpoint, session, body) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return {
    ok: response.ok,
    httpStatus: response.status,
    body: await parseResponseBody(response),
  };
}

function summarizePolicy(raw, actor, customerId) {
  const record = recordFromEnvelope(raw);
  if (!record) {
    throw new Error(`${actor} policy response was not an object.`);
  }
  const responseCustomerId = safeText(record.customer_id ?? record.customerId);
  if (responseCustomerId && responseCustomerId !== customerId) {
    throw new Error(`${actor} policy customer mismatch: expected ${customerId}, got ${responseCustomerId}.`);
  }
  const scopes = Array.isArray(record.scopes) ? record.scopes.map((scope) => safeText(scope, 80)).filter(Boolean) : [];

  return {
    actor,
    customerId: responseCustomerId ?? customerId,
    membershipId: safeText(record.membership_id ?? record.membershipId),
    membershipRole: safeText(record.membership_role ?? record.membershipRole),
    hasApproveActions: scopes.includes('approve_actions'),
    hasManageMembers: scopes.includes('manage_members'),
    backendEnforced: safeBoolean(record.backend_enforced ?? record.backendEnforced),
    auditId: safeText(record.audit_id ?? record.auditId),
  };
}

function denialText(raw) {
  const record = recordFromEnvelope(raw) ?? asRecord(raw) ?? {};
  return [
    record.code,
    record.error_code,
    record.error,
    asRecord(record.error)?.code,
    asRecord(record.error)?.message,
    record.message,
    record.msg,
  ]
    .map((value) => (typeof value === 'string' ? value : ''))
    .join(' ')
    .toLowerCase();
}

function summarizeRequesterDenyAttempt(result, actor = 'requester') {
  const denied =
    result.httpStatus === 401 ||
    result.httpStatus === 403 ||
    (result.ok === false && /denied|forbidden|permission|approve|requester/.test(denialText(result.body))) ||
    (recordFromEnvelope(result.body)?.success === false &&
      /denied|forbidden|permission|approve|requester/.test(denialText(result.body)));

  if (!denied) {
    throw new Error('Requester deny attempt did not fail closed at the backend.');
  }

  const record = recordFromEnvelope(result.body) ?? asRecord(result.body) ?? {};
  return {
    actor,
    backendDenied: true,
    httpStatus: result.httpStatus,
    code: safeText(record.code ?? record.error_code ?? asRecord(record.error)?.code, 120),
    sourcePointer: safeText(record.source_pointer ?? record.sourcePointer),
    auditId: safeText(record.audit_id ?? record.auditId),
  };
}

function approvalRecord(raw, approvalId) {
  const record = recordFromEnvelope(raw);
  const request =
    asRecord(record?.request) ?? asRecord(record?.approval) ?? asRecord(record?.resolved_request) ?? record;
  if (!request) {
    throw new Error('Approval request response was not an object.');
  }

  const responseApprovalId = safeText(request.approval_id ?? request.approvalId ?? request.id);
  if (responseApprovalId !== approvalId) {
    throw new Error(`Approval id mismatch: expected ${approvalId}, got ${responseApprovalId || 'missing'}.`);
  }

  return request;
}

function summarizeApprovalRequest(raw, approvalId, approverPolicy, expectedRequesterMembershipId) {
  const request = approvalRecord(raw, approvalId);
  const requesterMembershipId = safeText(request.requester_membership_id ?? request.requesterMembershipId);
  const sourcePointer = safeText(request.source_pointer ?? request.sourcePointer);
  const auditId = safeText(request.audit_id ?? request.auditId);

  if (!requesterMembershipId) {
    throw new Error('Approval request did not include requester membership evidence.');
  }
  if (expectedRequesterMembershipId && requesterMembershipId !== expectedRequesterMembershipId) {
    throw new Error(
      `Approval requester membership mismatch: expected ${expectedRequesterMembershipId}, got ${requesterMembershipId}.`
    );
  }
  if (approverPolicy.membershipId && approverPolicy.membershipId === requesterMembershipId) {
    throw new Error('Approver fixture is also the requester; deny canary requires separate memberships.');
  }
  if (!sourcePointer || !auditId) {
    throw new Error('Approval request did not include source pointer and audit evidence.');
  }

  return {
    approvalId,
    requesterMembershipId,
    toolName: safeText(request.tool_name ?? request.toolName, 120),
    riskClass: safeText(request.risk_class ?? request.riskClass, 60),
    sourcePointer,
    auditId,
    destinationProof: asRecord(request.destination_proof ?? request.destinationProof),
  };
}

function summarizeApproverDecision(raw, approvalId) {
  const record = recordFromEnvelope(raw);
  if (!record) {
    throw new Error('Approver deny response was not an object.');
  }

  const status = deniedStatus(record.status);
  const runtimeResult = asRecord(record.runtime_result ?? record.runtimeResult ?? record.result);
  const runtimeStatus = deniedStatus(runtimeResult?.status);
  const responseApprovalId = safeText(record.approval_id ?? record.approvalId ?? record.id);
  const sourcePointer = safeText(record.source_pointer ?? record.sourcePointer ?? runtimeResult?.source_pointer);
  const auditId = safeText(record.audit_id ?? record.auditId ?? runtimeResult?.audit_id);
  const runtimeSourcePointer = safeText(runtimeResult?.source_pointer ?? runtimeResult?.sourcePointer);
  const runtimeAuditId = safeText(runtimeResult?.audit_id ?? runtimeResult?.auditId);

  if (responseApprovalId !== approvalId || !status || !runtimeStatus || !sourcePointer || !auditId) {
    throw new Error('Approver deny response did not include backend decision proof.');
  }
  if (safeBoolean(record.backend_enforced ?? record.backendEnforced) !== true) {
    throw new Error('Approver deny response did not prove backend enforcement.');
  }
  if (!runtimeSourcePointer || !runtimeAuditId) {
    throw new Error('Approver deny response did not include runtime audit proof.');
  }

  return {
    actor: 'approver',
    approvalId: responseApprovalId,
    decision: 'deny',
    status,
    backendEnforced: true,
    sourcePointer,
    auditId,
    runtime: safeText(runtimeResult?.runtime, 80),
    runtimeStatus,
    runtimeSourcePointer,
    runtimeAuditId,
  };
}

async function requiredOkAction(fetchImpl, endpoint, session, body, label) {
  const result = await postBrokerAction(fetchImpl, endpoint, session, body);
  if (!result.ok) {
    throw new Error(`${label} failed HTTP ${result.httpStatus}.`);
  }
  return result.body;
}

async function optionalDeniedMemberProof(fetchImpl, endpoint, env, customerId) {
  const deniedSession = env.AIONUI_EVAOS_DENIED_SESSION;
  if (!deniedSession) return undefined;

  const policyRaw = await requiredOkAction(
    fetchImpl,
    endpoint,
    deniedSession,
    {
      action: 'current_customer_account_permissions',
      customer_id: customerId,
    },
    'Denied member policy'
  );
  const policy = summarizePolicy(policyRaw, 'denied_member', customerId);

  const approvalListAttempt = await postBrokerAction(fetchImpl, endpoint, deniedSession, {
    action: 'provider_approval_requests',
    customer_id: customerId,
    limit: 1,
  });

  return {
    policy,
    approvalRouteDenied: summarizeRequesterDenyAttempt(approvalListAttempt, 'denied_member'),
  };
}

async function runPeopleApprovalLiveCanary(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = env.AIONUI_EVAOS_BROKER_ENDPOINT || DEFAULT_ENDPOINT;

  requireAck(env);
  const customerId = requireEnv(env, 'AIONUI_EVAOS_CUSTOMER_ID');
  const approvalId = requireEnv(env, 'AIONUI_EVAOS_APPROVAL_ID');
  const requesterSession = requireEnv(env, 'AIONUI_EVAOS_REQUESTER_SESSION');
  const approverSession = requireEnv(env, 'AIONUI_EVAOS_APPROVER_SESSION');
  const expectedRequesterMembershipId = safeText(env.AIONUI_EVAOS_REQUESTER_MEMBERSHIP_ID, 120);
  const reason = safeText(env.AIONUI_EVAOS_APPROVAL_DENY_REASON, 220) ?? 'evaOS staging approval deny canary.';

  const requesterPolicyRaw = await requiredOkAction(
    fetchImpl,
    endpoint,
    requesterSession,
    {
      action: 'current_customer_account_permissions',
      customer_id: customerId,
    },
    'Requester policy'
  );
  const requesterPolicy = summarizePolicy(requesterPolicyRaw, 'requester', customerId);

  const approverPolicyRaw = await requiredOkAction(
    fetchImpl,
    endpoint,
    approverSession,
    {
      action: 'current_customer_account_permissions',
      customer_id: customerId,
    },
    'Approver policy'
  );
  const approverPolicy = summarizePolicy(approverPolicyRaw, 'approver', customerId);

  if (!approverPolicy.hasApproveActions) {
    throw new Error('Approver fixture does not have approve_actions.');
  }

  const requesterDenyAttempt = await postBrokerAction(fetchImpl, endpoint, requesterSession, {
    action: 'provider_approval_decide',
    customer_id: customerId,
    approval_id: approvalId,
    decision: 'deny',
    scope: 'this-call',
    reason,
  });

  const approvalRaw = await requiredOkAction(
    fetchImpl,
    endpoint,
    approverSession,
    {
      action: 'provider_approval_request',
      customer_id: customerId,
      approval_id: approvalId,
    },
    'Approval request'
  );
  const approval = summarizeApprovalRequest(approvalRaw, approvalId, approverPolicy, expectedRequesterMembershipId);

  const decisionRaw = await requiredOkAction(
    fetchImpl,
    endpoint,
    approverSession,
    {
      action: 'provider_approval_decide',
      customer_id: customerId,
      approval_id: approvalId,
      decision: 'deny',
      scope: 'this-call',
      request_source_pointer: approval.sourcePointer,
      request_audit_id: approval.auditId,
      ...(approval.destinationProof ? { destination_proof: approval.destinationProof } : {}),
      reason,
    },
    'Approver deny decision'
  );

  const proof = {
    schema: 'evaos-people-approval-live-canary/v1',
    customerId,
    approvalId,
    checkedAt: new Date().toISOString(),
    requester: {
      policy: requesterPolicy,
      denyAttempt: summarizeRequesterDenyAttempt(requesterDenyAttempt),
    },
    approver: {
      policy: approverPolicy,
      approval,
      denyDecision: summarizeApproverDecision(decisionRaw, approvalId),
    },
    deniedMember: await optionalDeniedMemberProof(fetchImpl, endpoint, env, customerId),
    sensitiveOutput: 'passed',
  };

  assertNoUnsafeProofOutput(proof);
  return proof;
}

async function main() {
  const result = await runPeopleApprovalLiveCanary();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  runPeopleApprovalLiveCanary,
  summarizeApproverDecision,
  summarizeApprovalRequest,
  summarizeRequesterDenyAttempt,
};
