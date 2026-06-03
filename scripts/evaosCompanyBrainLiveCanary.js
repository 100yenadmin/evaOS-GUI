#!/usr/bin/env node

const { DEFAULT_ENDPOINT } = require('./evaosBrokerLiveCanary.js');

const VALID_INGESTION_STATES = new Set(['ready', 'empty', 'ingesting', 'error']);
const UNSAFE_FIELD_PATTERN =
  /(authorization|bearer|token|secret|password|credential|desktop[_-]?session|access[_-]?token|refresh[_-]?token|api[_-]?key|service[_-]?role|provider[_-]?grant|grant[_-]?handle|raw[_-]?prompt|raw[_-]?embedding)/i;
const UNSAFE_VALUE_PATTERNS = [
  /\beds_[A-Za-z0-9_-]{8,}\b/,
  /\bepg_[A-Za-z0-9_-]{8,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/i,
  /\bsk_(?:live|test)_[A-Za-z0-9]{8,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\b(?:rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b/,
  /\bgh[opusr]_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bglpat-[A-Za-z0-9_-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
  /\baccess[_-]?token\b/i,
  /\brefresh[_-]?token\b/i,
  /\bdesktop[_-]?session\b/i,
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

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function requireEnv(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing ${key} for Company Brain live canary.`);
  }
  return value.trim();
}

function parseRequiredIngestionStates(value) {
  const states = String(value || '')
    .split(',')
    .map((state) => state.trim())
    .filter(Boolean);

  for (const state of states) {
    if (!VALID_INGESTION_STATES.has(state)) {
      throw new Error(`Unsupported Company Brain ingestion state: ${state}`);
    }
  }

  return states;
}

function readNegativeBoundaryFixture(env) {
  const wrongCustomerId = safeText(
    env.AIONUI_EVAOS_COMPANY_BRAIN_WRONG_CUSTOMER_ID ?? env.AIONUI_EVAOS_CROSS_ORG_CUSTOMER_ID,
    160
  );
  const deniedSession = safeText(
    env.AIONUI_EVAOS_COMPANY_BRAIN_DENIED_SESSION ?? env.AIONUI_EVAOS_CROSS_ORG_SESSION,
    500
  );
  const allowNoNegative = env.AIONUI_EVAOS_COMPANY_BRAIN_ALLOW_NO_NEGATIVE === '1';

  if (!wrongCustomerId && !deniedSession && !allowNoNegative) {
    throw new Error(
      'Company Brain live canary requires AIONUI_EVAOS_COMPANY_BRAIN_WRONG_CUSTOMER_ID or AIONUI_EVAOS_COMPANY_BRAIN_DENIED_SESSION. Set AIONUI_EVAOS_COMPANY_BRAIN_ALLOW_NO_NEGATIVE=1 only for local dry runs.'
    );
  }

  return { allowNoNegative, wrongCustomerId, deniedSession };
}

function containsUnsafeValue(value) {
  return typeof value === 'string' && UNSAFE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function assertNoUnsafeRawMaterial(value, path = '$', seen = new WeakSet()) {
  if (typeof value === 'string') {
    if (containsUnsafeValue(value)) {
      throw new Error(`Company Brain canary response exposed unsafe material at ${path}.`);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUnsafeRawMaterial(item, `${path}[${index}]`, seen));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_FIELD_PATTERN.test(key)) {
      throw new Error(`Company Brain canary response exposed unsafe field ${path}.${key}.`);
    }
    assertNoUnsafeRawMaterial(child, `${path}.${key}`, seen);
  }
}

function assertNoUnsafeProofOutput(value) {
  const text = JSON.stringify(value);
  const match = UNSAFE_VALUE_PATTERNS.find((pattern) => pattern.test(text));
  if (match) {
    throw new Error(`Company Brain canary proof exposed unsafe material matching ${match}.`);
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

async function postBrokerAction(fetchImpl, endpoint, desktopSession, body) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${desktopSession}`,
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

async function requiredOkAction(fetchImpl, endpoint, desktopSession, body, label) {
  const result = await postBrokerAction(fetchImpl, endpoint, desktopSession, body);
  if (!result.ok) {
    throw new Error(`${label} failed HTTP ${result.httpStatus}.`);
  }
  return result.body;
}

function summarizePolicy(raw, customerId) {
  assertNoUnsafeRawMaterial(raw);
  const record = recordFromEnvelope(raw);
  if (!record) {
    throw new Error('Company Brain policy response was not an object.');
  }

  const responseCustomerId = safeText(record.customer_id ?? record.customerId ?? record.selected_customer_id);
  if (responseCustomerId && responseCustomerId !== customerId) {
    throw new Error(`Company Brain policy customer mismatch: expected ${customerId}, got ${responseCustomerId}.`);
  }

  const scopes = safeArray(record.scopes)
    .map((scope) => safeText(scope, 80))
    .filter(Boolean);
  const backendEnforced = safeBoolean(record.backend_enforced ?? record.backendEnforced);
  const auditId = safeText(record.audit_id ?? record.auditId);
  if (!scopes.includes('view_company_brain')) {
    throw new Error('Company Brain live canary requires view_company_brain in the staging policy.');
  }
  if (backendEnforced !== true || !auditId) {
    throw new Error('Company Brain policy did not prove backend enforcement.');
  }

  return {
    customerId: responseCustomerId ?? customerId,
    customerAccountId: safeText(record.customer_account_id ?? record.customerAccountId),
    membershipId: safeText(record.membership_id ?? record.membershipId),
    membershipRole: safeText(record.membership_role ?? record.membershipRole),
    hasViewCompanyBrain: true,
    backendEnforced: true,
    auditId,
  };
}

function requireCustomerMatch(record, expectedCustomerId, context) {
  const customerId = safeText(record.customer_id ?? record.customerId);
  if (customerId !== expectedCustomerId) {
    throw new Error(`${context} customer mismatch: expected ${expectedCustomerId}, got ${customerId || 'missing'}.`);
  }
  return customerId;
}

function requireCustomerAccountMatch(record, expectedCustomerAccountId, context) {
  const customerAccountId = safeText(record.customer_account_id ?? record.customerAccountId);
  if (expectedCustomerAccountId && customerAccountId !== expectedCustomerAccountId) {
    throw new Error(
      `${context} customer account mismatch: expected ${expectedCustomerAccountId}, got ${
        customerAccountId || 'missing'
      }.`
    );
  }
  if (!customerAccountId) {
    throw new Error(`${context} did not include customer account proof.`);
  }
  return customerAccountId;
}

function requireBackendProof(record, schemaVersion, context) {
  const responseSchema = safeText(record.schema_version ?? record.schemaVersion);
  const backendEnforced = safeBoolean(record.backend_enforced ?? record.backendEnforced);
  const sourcePointer = safeText(record.source_pointer ?? record.sourcePointer);
  const auditId = safeText(record.audit_id ?? record.auditId);

  if (responseSchema !== schemaVersion || backendEnforced !== true || !sourcePointer || !auditId) {
    throw new Error(`${context} did not include schema, backend, source, and audit proof.`);
  }

  return { backendEnforced: true, sourcePointer, auditId };
}

function safeIngestionState(value) {
  const state = safeText(value, 60);
  return state && VALID_INGESTION_STATES.has(state) ? state : undefined;
}

function accountIdFrom(value) {
  const record = asRecord(value);
  return record ? safeText(record.account_id ?? record.accountId ?? record.id, 160) : undefined;
}

function collectIngestionStates(...values) {
  const states = new Set();
  for (const value of values) {
    const record = asRecord(value);
    if (!record) continue;
    const state = safeIngestionState(record.ingestion_state ?? record.ingestionState ?? record.status);
    if (state) states.add(state);
    const integration = asRecord(record.integration_health ?? record.integrationHealth);
    const integrationState = safeIngestionState(integration?.state ?? integration?.status);
    if (integrationState) states.add(integrationState);
  }
  return [...states].sort();
}

function summarizeDirectory(raw, policy, request) {
  assertNoUnsafeRawMaterial(raw);
  const record = recordFromEnvelope(raw);
  if (!record) {
    throw new Error('Company Brain directory response was not an object.');
  }
  if (safeBoolean(record.route_denied ?? record.routeDenied) === true) {
    throw new Error('Company Brain directory route was denied for the positive fixture.');
  }

  const customerId = requireCustomerMatch(record, request.customerId, 'Company Brain directory');
  const customerAccountId = requireCustomerAccountMatch(record, policy.customerAccountId, 'Company Brain directory');
  const backendProof = requireBackendProof(record, 'evaos.company_brain.directory.v1', 'Company Brain directory');
  const accounts = safeArray(record.accounts ?? record.directory ?? record.items);
  const expectedAccount = accounts.find((account) => accountIdFrom(account) === request.accountId);
  if (!expectedAccount) {
    throw new Error(`Company Brain directory did not include expected account ${request.accountId}.`);
  }

  const expectedAccountRecord = asRecord(expectedAccount) ?? {};
  const accountCustomerAccountId = safeText(
    expectedAccountRecord.customer_account_id ?? expectedAccountRecord.customerAccountId
  );
  if (accountCustomerAccountId !== policy.customerAccountId) {
    throw new Error('Company Brain directory account row did not include matching customer account proof.');
  }
  const accountSourcePointer = safeText(expectedAccountRecord.source_pointer ?? expectedAccountRecord.sourcePointer);
  const accountAuditId = safeText(expectedAccountRecord.audit_id ?? expectedAccountRecord.auditId);
  if (!accountSourcePointer || !accountAuditId) {
    throw new Error('Company Brain directory account row did not include source and audit proof.');
  }

  return {
    customerId,
    customerAccountId,
    backendEnforced: backendProof.backendEnforced,
    ingestionState: safeIngestionState(record.ingestion_state ?? record.ingestionState) ?? 'empty',
    integrationHealthState: safeIngestionState(
      asRecord(record.integration_health ?? record.integrationHealth)?.state ??
        asRecord(record.integration_health ?? record.integrationHealth)?.status
    ),
    accountCount: accounts.length,
    expectedAccountPresent: true,
    expectedAccountSourcePointer: accountSourcePointer,
    expectedAccountAuditId: accountAuditId,
    sourcePointer: backendProof.sourcePointer,
    auditId: backendProof.auditId,
  };
}

function summarizeAccount360(raw, policy, request) {
  assertNoUnsafeRawMaterial(raw);
  const record = recordFromEnvelope(raw);
  if (!record) {
    throw new Error('Company Brain account 360 response was not an object.');
  }

  const customerId = requireCustomerMatch(record, request.customerId, 'Company Brain account 360');
  const customerAccountId = requireCustomerAccountMatch(record, policy.customerAccountId, 'Company Brain account 360');
  const account = asRecord(record.account) ?? record;
  const accountId = accountIdFrom(record) ?? accountIdFrom(account);
  if (accountId !== request.accountId) {
    throw new Error(
      `Company Brain account 360 mismatch: expected ${request.accountId}, got ${accountId || 'missing'}.`
    );
  }

  const backendProof = requireBackendProof(record, 'evaos.company_brain.account_360.v1', 'Company Brain account 360');
  return {
    customerId,
    customerAccountId,
    accountId,
    backendEnforced: backendProof.backendEnforced,
    ingestionState:
      safeIngestionState(record.ingestion_state ?? record.ingestionState) ??
      safeIngestionState(account.ingestion_state ?? account.ingestionState) ??
      'empty',
    briefPresent: Boolean(asRecord(record.brief)),
    timelineCount: safeArray(record.timeline ?? record.events).length,
    exceptionCount: safeArray(record.exceptions).length,
    sourcePointer: backendProof.sourcePointer,
    auditId: backendProof.auditId,
  };
}

function summarizeQuery(raw, policy, request) {
  assertNoUnsafeRawMaterial(raw);
  const record = recordFromEnvelope(raw);
  if (!record) {
    throw new Error('Company Brain query response was not an object.');
  }

  const customerId = requireCustomerMatch(record, request.customerId, 'Company Brain query');
  const customerAccountId = requireCustomerAccountMatch(record, policy.customerAccountId, 'Company Brain query');
  const accountId = safeText(record.account_id ?? record.accountId, 160);
  if (accountId !== request.accountId) {
    throw new Error(
      `Company Brain query account mismatch: expected ${request.accountId}, got ${accountId || 'missing'}.`
    );
  }

  const status = safeText(record.status, 80);
  const answer = safeText(record.answer, 20_000);
  if (status !== 'answered' || !answer) {
    throw new Error('Company Brain query must return answered status and answer proof.');
  }

  const backendProof = requireBackendProof(record, 'evaos.company_brain.query.v1', 'Company Brain query');
  return {
    customerId,
    customerAccountId,
    accountId,
    status,
    answerLength: answer?.length ?? 0,
    citationCount: safeArray(record.citations).length,
    sourcePointer: backendProof.sourcePointer,
    auditId: backendProof.auditId,
    backendEnforced: backendProof.backendEnforced,
  };
}

function summarizeCompanyBrainProof(raw, request) {
  const policy = summarizePolicy(raw.policy, request.customerId);
  const directory = summarizeDirectory(raw.directory, policy, request);
  const account360 = summarizeAccount360(raw.account360, policy, request);
  const query = summarizeQuery(raw.query, policy, request);
  const ingestionStatesPresent = collectIngestionStates(
    raw.directory,
    ...safeArray(recordFromEnvelope(raw.directory)?.accounts),
    raw.account360,
    asRecord(recordFromEnvelope(raw.account360)?.account)
  );
  const missingIngestionStates = request.requiredIngestionStates.filter(
    (state) => !ingestionStatesPresent.includes(state)
  );
  if (missingIngestionStates.length > 0) {
    throw new Error(`Company Brain canary missing ingestion states: ${missingIngestionStates.join(', ')}`);
  }

  const proof = {
    schema: 'evaos-company-brain-live-canary/v1',
    customerId: request.customerId,
    customerAccountId: policy.customerAccountId,
    accountId: request.accountId,
    policy,
    directory,
    account360,
    query,
    requiredIngestionStates: request.requiredIngestionStates,
    ingestionStatesPresent,
    sensitiveOutput: 'passed',
  };
  assertNoUnsafeProofOutput(proof);
  return proof;
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
    record.route_denial_reason,
    record.routeDenialReason,
  ]
    .map((value) => (typeof value === 'string' ? value : ''))
    .join(' ')
    .toLowerCase();
}

function summarizeDeniedAttempt(result, actor = 'wrong_customer') {
  assertNoUnsafeRawMaterial(result.body);
  const record = recordFromEnvelope(result.body) ?? asRecord(result.body) ?? {};
  const routeDenied = safeBoolean(record.route_denied ?? record.routeDenied);
  const success = safeBoolean(record.success);
  const denied =
    result.httpStatus === 401 ||
    result.httpStatus === 403 ||
    routeDenied === true ||
    (result.ok === false && /denied|forbidden|permission|customer|org|scope/.test(denialText(result.body))) ||
    (success === false && /denied|forbidden|permission|customer|org|scope/.test(denialText(result.body)));

  if (!denied) {
    throw new Error('Company Brain negative attempt did not fail closed at the backend.');
  }

  const sourcePointer = safeText(record.source_pointer ?? record.sourcePointer);
  const auditId = safeText(record.audit_id ?? record.auditId);
  if (!sourcePointer || !auditId) {
    throw new Error('Company Brain negative attempt did not include denial source and audit evidence.');
  }

  return {
    actor,
    backendDenied: true,
    httpStatus: result.httpStatus,
    code: safeText(record.code ?? record.error_code ?? asRecord(record.error)?.code, 120),
    sourcePointer,
    auditId,
  };
}

async function runDeniedActionSet(fetchImpl, endpoint, session, request, actor) {
  const directory = await postBrokerAction(fetchImpl, endpoint, session, {
    action: 'company_brain_directory',
    customer_id: request.customerId,
  });
  const account360 = await postBrokerAction(fetchImpl, endpoint, session, {
    action: 'company_brain_account_360',
    customer_id: request.customerId,
    account_id: request.accountId,
  });
  const query = await postBrokerAction(fetchImpl, endpoint, session, {
    action: 'company_brain_query',
    customer_id: request.customerId,
    account_id: request.accountId,
    query: request.queryText,
  });

  return {
    directory: summarizeDeniedAttempt(directory, `${actor}:directory`),
    account360: summarizeDeniedAttempt(account360, `${actor}:account360`),
    query: summarizeDeniedAttempt(query, `${actor}:query`),
  };
}

async function runCompanyBrainLiveCanary(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = env.AIONUI_EVAOS_BROKER_ENDPOINT || DEFAULT_ENDPOINT;
  const desktopSession = requireEnv(env, 'AIONUI_EVAOS_DESKTOP_SESSION');
  const customerId = requireEnv(env, 'AIONUI_EVAOS_CUSTOMER_ID');
  const accountId = requireEnv(env, 'AIONUI_EVAOS_COMPANY_BRAIN_ACCOUNT_ID');
  const queryText = requireEnv(env, 'AIONUI_EVAOS_COMPANY_BRAIN_QUERY');
  const requiredIngestionStates = parseRequiredIngestionStates(
    env.AIONUI_EVAOS_COMPANY_BRAIN_REQUIRED_INGESTION_STATES
  );
  const negativeFixture = readNegativeBoundaryFixture(env);

  const policy = await requiredOkAction(
    fetchImpl,
    endpoint,
    desktopSession,
    {
      action: 'current_customer_account_permissions',
      customer_id: customerId,
    },
    'Company Brain policy'
  );
  const directory = await requiredOkAction(
    fetchImpl,
    endpoint,
    desktopSession,
    {
      action: 'company_brain_directory',
      customer_id: customerId,
    },
    'Company Brain directory'
  );
  const account360 = await requiredOkAction(
    fetchImpl,
    endpoint,
    desktopSession,
    {
      action: 'company_brain_account_360',
      customer_id: customerId,
      account_id: accountId,
    },
    'Company Brain account 360'
  );
  const query = await requiredOkAction(
    fetchImpl,
    endpoint,
    desktopSession,
    {
      action: 'company_brain_query',
      customer_id: customerId,
      account_id: accountId,
      query: queryText,
    },
    'Company Brain query'
  );

  const proof = {
    schema: 'evaos-company-brain-live-proof/v1',
    customerId,
    accountId,
    checkedAt: new Date().toISOString(),
    dryRun: negativeFixture.allowNoNegative,
    acceptanceProof: !negativeFixture.allowNoNegative,
    negativeBoundary: negativeFixture.allowNoNegative ? 'not-run' : 'required',
    companyBrain: summarizeCompanyBrainProof(
      { policy, directory, account360, query },
      { customerId, accountId, requiredIngestionStates }
    ),
    crossOrgDenial: undefined,
    deniedMember: undefined,
    sensitiveOutput: 'passed',
  };

  if (negativeFixture.wrongCustomerId) {
    proof.crossOrgDenial = await runDeniedActionSet(
      fetchImpl,
      endpoint,
      desktopSession,
      {
        accountId,
        customerId: negativeFixture.wrongCustomerId,
        queryText,
      },
      'wrong_customer'
    );
  }

  if (negativeFixture.deniedSession) {
    proof.deniedMember = await runDeniedActionSet(
      fetchImpl,
      endpoint,
      negativeFixture.deniedSession,
      {
        accountId,
        customerId,
        queryText,
      },
      'denied_member'
    );
  }

  assertNoUnsafeProofOutput(proof);
  return proof;
}

async function main() {
  const result = await runCompanyBrainLiveCanary();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  parseRequiredIngestionStates,
  runCompanyBrainLiveCanary,
  summarizeCompanyBrainProof,
  summarizeDeniedAttempt,
};
