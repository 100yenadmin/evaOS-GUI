#!/usr/bin/env node

const { DEFAULT_ENDPOINT } = require('./evaosBrokerLiveCanary.js');

const DEFAULT_REQUIRED_STATES = ['connected', 'needs_login', 'expired', 'revoked', 'approval_required'];
const VALID_PROVIDER_STATUSES = new Set([
  'connected',
  'needs_login',
  'approval_required',
  'planned',
  'revoked',
  'expired',
  'error',
]);
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
  /\brevoke[_-]?handle\b/i,
];

function safeText(value, maxLength = 220) {
  return typeof value === 'string' && value.trim() && value.trim().length <= maxLength ? value.trim() : undefined;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function recordFromEnvelope(raw) {
  const record = asRecord(raw);
  if (!record) {
    throw new Error('Provider canary response was not an object.');
  }
  return asRecord(record.data) ?? record;
}

function safeBoolean(value) {
  return typeof value === 'boolean' ? value : undefined;
}

function requireEnv(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing ${key} for Provider Hub live canary.`);
  }
  return value.trim();
}

function parseRequiredStates(value) {
  const states = String(value || DEFAULT_REQUIRED_STATES.join(','))
    .split(',')
    .map((state) => state.trim())
    .filter(Boolean);

  for (const state of states) {
    if (!VALID_PROVIDER_STATUSES.has(state)) {
      throw new Error(`Unsupported provider state in AIONUI_EVAOS_PROVIDER_REQUIRED_STATES: ${state}`);
    }
  }

  return states;
}

function assertNoUnsafeProofOutput(value) {
  const text = JSON.stringify(value);
  const match = SECRET_OUTPUT_PATTERNS.find((pattern) => pattern.test(text));
  if (match) {
    throw new Error(`Provider Hub canary proof exposed unsafe material matching ${match}.`);
  }
}

async function postBrokerAction(fetchImpl, endpoint, desktopSession, body) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${desktopSession}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Provider Hub canary ${body.action} failed HTTP ${response.status}.`);
  }

  return response.json();
}

function summarizePolicy(raw, customerId) {
  const record = recordFromEnvelope(raw);
  const responseCustomerId = safeText(record.customer_id ?? record.customerId ?? record.selected_customer_id);
  if (responseCustomerId && responseCustomerId !== customerId) {
    throw new Error(`Provider policy customer mismatch: expected ${customerId}, got ${responseCustomerId}.`);
  }

  const scopes = Array.isArray(record.scopes) ? record.scopes.map((scope) => safeText(scope, 80)).filter(Boolean) : [];
  return {
    customerId: responseCustomerId ?? customerId,
    customerAccountId: safeText(record.customer_account_id ?? record.customerAccountId),
    membershipId: safeText(record.membership_id ?? record.membershipId),
    membershipRole: safeText(record.membership_role ?? record.membershipRole),
    hasManageIntegrations: scopes.includes('manage_integrations'),
    backendEnforced: safeBoolean(record.backend_enforced ?? record.backendEnforced),
    auditId: safeText(record.audit_id ?? record.auditId),
  };
}

function profileList(record) {
  const source = record.provider_profiles ?? record.profiles ?? record.providers;
  if (!Array.isArray(source)) {
    throw new Error('Provider Hub canary response did not include provider profiles.');
  }
  return source;
}

function hasOpaqueHandle(value) {
  return typeof value === 'string' && value.trim().length >= 8;
}

function summarizeProfile(raw, expectedCustomerAccountId) {
  const record = asRecord(raw);
  if (!record) {
    throw new Error('Provider profile was not an object.');
  }
  const nested = asRecord(record.provider_profile) ?? asRecord(record.profile);
  if (nested) return summarizeProfile(nested, expectedCustomerAccountId);

  const providerKey = safeText(record.provider_key ?? record.provider ?? record.key, 80);
  const status = safeText(record.status, 80);
  const customerAccountId = safeText(record.customer_account_id ?? record.customerAccountId);
  const rawSecretsStoredInWorkbench =
    safeBoolean(
      record.raw_secrets_stored_in_workbench ?? record.rawSecretsStoredInWorkbench ?? record.raw_secrets_present
    ) ?? false;
  const approvalRequired =
    status === 'approval_required' || (safeBoolean(record.approval_required ?? record.approvalRequired) ?? false);
  const hasBrokeredGrant = hasOpaqueHandle(record.grant_handle ?? record.handle);
  const lastValidatedAt = safeText(record.last_validated_at ?? record.lastValidatedAt ?? record.validated_at);
  const hasConnectionProof =
    status === 'connected' && !rawSecretsStoredInWorkbench && Boolean(lastValidatedAt || hasBrokeredGrant);
  const sourcePointer = safeText(record.source_pointer ?? record.sourcePointer);
  const auditId = safeText(record.audit_id ?? record.auditId);

  if (!providerKey || !status || !VALID_PROVIDER_STATUSES.has(status)) {
    throw new Error('Provider profile did not include a valid provider key and status.');
  }
  if (expectedCustomerAccountId && customerAccountId && customerAccountId !== expectedCustomerAccountId) {
    throw new Error(
      `Provider profile ${providerKey} belongs to ${customerAccountId}, expected ${expectedCustomerAccountId}.`
    );
  }
  if (rawSecretsStoredInWorkbench) {
    throw new Error(`Provider profile ${providerKey} reports raw secrets stored in Workbench.`);
  }
  if (!sourcePointer || !auditId) {
    throw new Error(`Provider profile ${providerKey} did not include source pointer and audit proof.`);
  }
  if (status === 'connected' && !hasConnectionProof) {
    throw new Error(`Connected provider profile ${providerKey} did not include connection proof.`);
  }

  return {
    providerKey,
    status,
    active: safeBoolean(record.active ?? record.is_active) ?? false,
    approvalRequired,
    customerAccountId,
    hasConnectionProof,
    hasBrokeredGrant,
    expiresAt: safeText(record.expires_at ?? record.expiresAt),
    lastValidatedAt,
    sourcePointer,
    auditId,
  };
}

function summarizeProviderHubResponse(raw, request) {
  const record = recordFromEnvelope(raw);
  const customerId = safeText(record.customer_id ?? record.customerId);
  if (customerId && customerId !== request.customerId) {
    throw new Error(`Provider Hub customer mismatch: expected ${request.customerId}, got ${customerId}.`);
  }
  if (safeBoolean(record.backend_enforced ?? record.backendEnforced) !== true) {
    throw new Error('Provider Hub response did not prove backend enforcement.');
  }
  const sourcePointer = safeText(record.source_pointer ?? record.sourcePointer);
  const auditId = safeText(record.audit_id ?? record.auditId);
  if (!sourcePointer || !auditId) {
    throw new Error('Provider Hub response did not include source pointer and audit proof.');
  }

  const profiles = profileList(record).map((profile) => summarizeProfile(profile, request.customerAccountId));
  const statesPresent = [...new Set(profiles.map((profile) => profile.status))].sort();
  const missingStates = request.requiredStates.filter((state) => !statesPresent.includes(state));
  if (missingStates.length > 0) {
    throw new Error(`Provider Hub canary missing required provider states: ${missingStates.join(', ')}`);
  }

  const proof = {
    schema: 'evaos-provider-hub-live-canary/v1',
    customerId: customerId ?? request.customerId,
    customerAccountId: request.customerAccountId,
    activeProviderKey: safeText(record.active_provider_key ?? record.activeProviderKey ?? record.active_provider, 80),
    backendEnforced: true,
    sourcePointer,
    auditId,
    requiredStates: request.requiredStates,
    statesPresent,
    profileCount: profiles.length,
    profiles,
    sensitiveOutput: 'passed',
  };
  assertNoUnsafeProofOutput(proof);
  return proof;
}

async function runProviderHubLiveCanary(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = env.AIONUI_EVAOS_BROKER_ENDPOINT || DEFAULT_ENDPOINT;
  const desktopSession = requireEnv(env, 'AIONUI_EVAOS_DESKTOP_SESSION');
  const customerId = requireEnv(env, 'AIONUI_EVAOS_CUSTOMER_ID');
  const requiredStates = parseRequiredStates(env.AIONUI_EVAOS_PROVIDER_REQUIRED_STATES);

  const policyRaw = await postBrokerAction(fetchImpl, endpoint, desktopSession, {
    action: 'current_customer_account_permissions',
    customer_id: customerId,
  });
  const policy = summarizePolicy(policyRaw, customerId);
  if (!policy.hasManageIntegrations) {
    throw new Error('Provider Hub live canary requires manage_integrations in the staging policy.');
  }

  const providerRaw = await postBrokerAction(fetchImpl, endpoint, desktopSession, {
    action: 'provider_profiles',
    customer_id: customerId,
  });
  const providerHub = summarizeProviderHubResponse(providerRaw, {
    customerId,
    customerAccountId: env.AIONUI_EVAOS_PROVIDER_CUSTOMER_ACCOUNT_ID || policy.customerAccountId,
    requiredStates,
  });

  return {
    schema: 'evaos-provider-hub-live-proof/v1',
    customerId,
    checkedAt: new Date().toISOString(),
    policy,
    providerHub,
    sensitiveOutput: 'passed',
  };
}

async function main() {
  const result = await runProviderHubLiveCanary();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_REQUIRED_STATES,
  parseRequiredStates,
  runProviderHubLiveCanary,
  summarizeProviderHubResponse,
};
