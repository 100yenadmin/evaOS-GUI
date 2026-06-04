#!/usr/bin/env node

const { DEFAULT_ENDPOINT, assertNoSecretMaterial } = require('./evaosBrokerLiveCanary.js');

const CANARY_ACTIONS = [
  { action: 'current_customer_account' },
  { action: 'current_customer_account_permissions' },
  { action: 'provider_profiles' },
  { action: 'provider_approval_requests', body: { limit: 5 } },
  { action: 'runtime_status', body: { runtime: 'browser' } },
  { action: 'company_brain_directory' },
];

function safeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function recordFromEnvelope(raw) {
  const record = asRecord(raw);
  if (!record) {
    throw new Error('Trust-surface canary response was not an object.');
  }
  return asRecord(record.data) ?? record;
}

function countRows(record) {
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) return value.length;
  }
  return undefined;
}

function summarizeTrustSurfaceResponse(raw, request) {
  assertNoSecretMaterial(raw);
  const record = recordFromEnvelope(raw);
  const customerId = safeText(record.customer_id ?? record.customerId ?? record.selected_customer_id);
  const customerAccountId = safeText(record.customer_account_id ?? record.customerAccountId);

  if (customerId && customerId !== request.customerId) {
    throw new Error(
      `Trust-surface canary customer mismatch for ${request.action}: expected ${request.customerId}, got ${customerId}.`
    );
  }

  return {
    action: request.action,
    customerId: customerId ?? request.customerId,
    customerAccountId,
    schemaVersion: safeText(record.schema_version ?? record.schemaVersion),
    status: safeText(record.status),
    routeDenied: typeof record.route_denied === 'boolean' ? record.route_denied : undefined,
    backendEnforced: typeof record.backend_enforced === 'boolean' ? record.backend_enforced : undefined,
    sourcePointer: safeText(record.source_pointer ?? record.sourcePointer),
    auditId: safeText(record.audit_id ?? record.auditId),
    rowCount: countRows(record),
    secretScan: 'passed',
  };
}

async function postBrokerAction(fetchImpl, endpoint, desktopSession, customerId, actionSpec) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${desktopSession}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: actionSpec.action,
      customer_id: customerId,
      ...(actionSpec.body ?? {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Trust-surface canary ${actionSpec.action} failed HTTP ${response.status}.`);
  }

  return response.json();
}

async function runTrustSurfaceLiveCanary(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = env.AIONUI_EVAOS_BROKER_ENDPOINT || DEFAULT_ENDPOINT;
  const desktopSession = env.AIONUI_EVAOS_DESKTOP_SESSION;
  const customerId = env.AIONUI_EVAOS_CUSTOMER_ID;

  if (!desktopSession) {
    throw new Error('Missing AIONUI_EVAOS_DESKTOP_SESSION for live trust-surface canary.');
  }
  if (!customerId) {
    throw new Error('Missing AIONUI_EVAOS_CUSTOMER_ID for live trust-surface canary.');
  }

  const results = [];
  for (const actionSpec of CANARY_ACTIONS) {
    const raw = await postBrokerAction(fetchImpl, endpoint, desktopSession, customerId, actionSpec);
    results.push(summarizeTrustSurfaceResponse(raw, { action: actionSpec.action, customerId }));
  }

  return {
    schema: 'evaos-trust-surface-live-canary/v1',
    customerId,
    checkedAt: new Date().toISOString(),
    actionCount: results.length,
    results,
  };
}

async function main() {
  const result = await runTrustSurfaceLiveCanary();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  CANARY_ACTIONS,
  runTrustSurfaceLiveCanary,
  summarizeTrustSurfaceResponse,
};
