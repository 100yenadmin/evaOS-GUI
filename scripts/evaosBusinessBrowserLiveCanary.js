#!/usr/bin/env node

const { DEFAULT_ENDPOINT } = require('./evaosBrokerLiveCanary.js');

const SECRET_FIELD_PATTERN =
  /(authorization|bearer|token|secret|password|credential|desktop[_-]?session|access[_-]?token|refresh[_-]?token|api[_-]?key|service[_-]?role|provider[_-]?grant|grant[_-]?handle)/i;
const SECRET_VALUE_PATTERNS = [
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

function containsUnsafeValue(value) {
  return typeof value === 'string' && SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function assertNoUnsafeRawMaterial(value, path = '$', seen = new WeakSet()) {
  if (typeof value === 'string') {
    if (containsUnsafeValue(value)) {
      throw new Error(`Business Browser canary response exposed unsafe material at ${path}.`);
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
    if (SECRET_FIELD_PATTERN.test(key)) {
      throw new Error(`Business Browser canary response exposed unsafe field ${path}.${key}.`);
    }
    assertNoUnsafeRawMaterial(child, `${path}.${key}`, seen);
  }
}

function assertNoUnsafeProofOutput(value) {
  const text = JSON.stringify(value);
  const match = SECRET_VALUE_PATTERNS.find((pattern) => pattern.test(text));
  if (match) {
    throw new Error(`Business Browser canary proof exposed unsafe material matching ${match}.`);
  }
}

function requireEnv(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing ${key} for Business Browser live canary.`);
  }
  return value.trim();
}

function requireActionAck(env) {
  const ack = requireEnv(env, 'AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK');
  if (ack !== 'evaos-browser-test') {
    throw new Error(
      'Set AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK=evaos-browser-test before mutating a staging browser runtime.'
    );
  }
}

function parseAllowedHosts(value) {
  return String(value || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function isUnsafeHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '169.254.169.254') return true;
  if (/^127\./.test(host) || /^0\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const private172 = /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  if (private172) return true;
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  return false;
}

function normalizeTestUrl(value, allowedHostsValue) {
  const raw = safeText(value, 2_000);
  if (!raw) {
    throw new Error('Missing AIONUI_EVAOS_BUSINESS_BROWSER_TEST_URL for Business Browser live canary.');
  }
  const allowedHosts = parseAllowedHosts(allowedHostsValue);
  if (allowedHosts.length === 0) {
    throw new Error('Set AIONUI_EVAOS_BUSINESS_BROWSER_ALLOWED_HOSTS before live browser actions.');
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('AIONUI_EVAOS_BUSINESS_BROWSER_TEST_URL must be a valid http(s) URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('AIONUI_EVAOS_BUSINESS_BROWSER_TEST_URL must be a safe http(s) URL.');
  }
  if (isUnsafeHost(url.hostname) || !allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error('AIONUI_EVAOS_BUSINESS_BROWSER_TEST_URL host must be present in allowed hosts.');
  }

  const sanitized = `${url.origin}${url.pathname}`;
  if (containsUnsafeValue(sanitized)) {
    throw new Error('AIONUI_EVAOS_BUSINESS_BROWSER_TEST_URL must not contain token or session material.');
  }

  return sanitized;
}

function readNegativeBoundaryFixture(env) {
  const wrongCustomerId = safeText(
    env.AIONUI_EVAOS_BUSINESS_BROWSER_WRONG_CUSTOMER_ID ?? env.AIONUI_EVAOS_CROSS_CUSTOMER_ID,
    160
  );
  const deniedSession = safeText(
    env.AIONUI_EVAOS_BUSINESS_BROWSER_DENIED_SESSION ?? env.AIONUI_EVAOS_CROSS_CUSTOMER_SESSION,
    500
  );
  const allowNoNegative = env.AIONUI_EVAOS_BUSINESS_BROWSER_ALLOW_NO_NEGATIVE === '1';

  if (!wrongCustomerId && !deniedSession && !allowNoNegative) {
    throw new Error(
      'Business Browser live canary requires AIONUI_EVAOS_BUSINESS_BROWSER_WRONG_CUSTOMER_ID or AIONUI_EVAOS_BUSINESS_BROWSER_DENIED_SESSION. Set AIONUI_EVAOS_BUSINESS_BROWSER_ALLOW_NO_NEGATIVE=1 only for local dry runs.'
    );
  }

  return { allowNoNegative, wrongCustomerId, deniedSession };
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

async function requiredOkAction(fetchImpl, endpoint, session, body, label) {
  const result = await postBrokerAction(fetchImpl, endpoint, session, body);
  if (!result.ok) {
    throw new Error(`${label} failed HTTP ${result.httpStatus}.`);
  }
  return result.body;
}

function summarizePolicy(raw, customerId) {
  assertNoUnsafeRawMaterial(raw);
  const record = recordFromEnvelope(raw);
  if (!record) {
    throw new Error('Business Browser policy response was not an object.');
  }

  const responseCustomerId = safeText(record.customer_id ?? record.customerId ?? record.selected_customer_id);
  if (responseCustomerId && responseCustomerId !== customerId) {
    throw new Error(`Business Browser policy customer mismatch: expected ${customerId}, got ${responseCustomerId}.`);
  }

  const scopes = safeArray(record.scopes)
    .map((scope) => safeText(scope, 80))
    .filter(Boolean);
  const backendEnforced = safeBoolean(record.backend_enforced ?? record.backendEnforced);
  const auditId = safeText(record.audit_id ?? record.auditId);
  if (!scopes.includes('open_business_browser')) {
    throw new Error('Business Browser live canary requires open_business_browser in the staging policy.');
  }
  if (backendEnforced !== true || !auditId) {
    throw new Error('Business Browser policy did not prove backend enforcement.');
  }

  return {
    customerId: responseCustomerId ?? customerId,
    customerAccountId: safeText(record.customer_account_id ?? record.customerAccountId),
    membershipId: safeText(record.membership_id ?? record.membershipId),
    membershipRole: safeText(record.membership_role ?? record.membershipRole),
    hasOpenBusinessBrowser: true,
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
  return customerAccountId;
}

function summarizeBrowserRuntime(raw, request) {
  assertNoUnsafeRawMaterial(raw);
  const record = recordFromEnvelope(raw);
  if (!record) {
    throw new Error('Business Browser runtime response was not an object.');
  }

  const customerId = requireCustomerMatch(record, request.customerId, 'Business Browser runtime');
  const customerAccountId = requireCustomerAccountMatch(record, request.customerAccountId, 'Business Browser runtime');
  const runtime = safeText(record.runtime_key ?? record.runtimeKey ?? record.runtime, 80);
  if (runtime !== 'browser') {
    throw new Error(`Business Browser runtime mismatch: expected browser, got ${runtime || 'missing'}.`);
  }

  const sourcePointer = safeText(record.source_pointer ?? record.sourcePointer);
  const auditId = safeText(record.audit_id ?? record.auditId);
  const status = safeText(record.status, 80);
  if (!status) {
    throw new Error('Business Browser runtime status proof was missing.');
  }
  if (sourcePointer !== 'broker:runtime_status:browser' || !auditId) {
    throw new Error('Business Browser runtime did not include source and audit proof.');
  }

  const actions = safeArray(record.actions)
    .map((action) => safeText(action, 80))
    .filter((action) => action === 'browser_open_url' || action === 'browser_stop');
  const controlSessionActive = safeBoolean(record.control_session_active ?? record.controlSessionActive) ?? false;
  if (!controlSessionActive || !actions.includes('browser_open_url') || !actions.includes('browser_stop')) {
    throw new Error('Business Browser runtime action proof did not include active open/stop controls.');
  }

  return {
    customerId,
    customerAccountId,
    runtime,
    status,
    controlSessionActive,
    canOpenUrl: actions.includes('browser_open_url'),
    canStop: actions.includes('browser_stop'),
    actionCount: actions.length,
    sourcePointer,
    auditId,
  };
}

function summarizeBrowserActionResult(raw, request) {
  assertNoUnsafeRawMaterial(raw);
  const record = recordFromEnvelope(raw);
  if (!record) {
    throw new Error('Business Browser action response was not an object.');
  }

  const customerId = requireCustomerMatch(record, request.customerId, 'Business Browser action');
  const customerAccountId = requireCustomerAccountMatch(record, request.customerAccountId, 'Business Browser action');
  const status = safeText(record.status, 80) ?? (record.ok === true ? 'ok' : undefined);
  const backendEnforced = safeBoolean(record.backend_enforced ?? record.backendEnforced);
  const sourcePointer = safeText(record.source_pointer ?? record.sourcePointer);
  const auditId = safeText(record.audit_id ?? record.auditId);
  const expectedSourcePointer = `broker:${request.action}:${request.customerId}`;

  if (!status || backendEnforced !== true || sourcePointer !== expectedSourcePointer || !auditId) {
    throw new Error('Business Browser action did not include action source proof and audit evidence.');
  }
  if (request.action === 'browser_open_url' && status !== 'opened') {
    throw new Error('Business Browser open URL action must return opened status.');
  }
  if (request.action === 'browser_stop' && status !== 'stopped') {
    throw new Error('Business Browser stop action must return stopped status.');
  }

  const nestedRuntimeRaw = record.browser ?? record.browser_status ?? record.runtime_status ?? record.runtime;
  const nestedRuntime = nestedRuntimeRaw
    ? summarizeBrowserRuntime(nestedRuntimeRaw, {
        customerAccountId: request.customerAccountId,
        customerId: request.customerId,
      })
    : undefined;

  return {
    action: request.action,
    customerId,
    customerAccountId,
    status,
    backendEnforced: true,
    sourcePointer,
    auditId,
    nestedRuntime,
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
    record.route_denial_reason,
    record.routeDenialReason,
  ]
    .map((value) => (typeof value === 'string' ? value : ''))
    .join(' ')
    .toLowerCase();
}

function summarizeDeniedAttempt(result, actor = 'denied_member') {
  assertNoUnsafeRawMaterial(result.body);
  const record = recordFromEnvelope(result.body) ?? asRecord(result.body) ?? {};
  const routeDenied = safeBoolean(record.route_denied ?? record.routeDenied);
  const success = safeBoolean(record.success);
  const denied =
    result.httpStatus === 401 ||
    result.httpStatus === 403 ||
    routeDenied === true ||
    (result.ok === false && /denied|forbidden|permission|customer|scope|browser/.test(denialText(result.body))) ||
    (success === false && /denied|forbidden|permission|customer|scope|browser/.test(denialText(result.body)));

  if (!denied) {
    throw new Error('Business Browser negative attempt did not fail closed at the backend.');
  }

  const sourcePointer = safeText(record.source_pointer ?? record.sourcePointer);
  const auditId = safeText(record.audit_id ?? record.auditId);
  if (!sourcePointer || !auditId) {
    throw new Error('Business Browser negative attempt did not include denial source and audit evidence.');
  }
  if (!/denial|denied|wrong_customer|denied_member|business_browser_denial/i.test(sourcePointer)) {
    throw new Error('Business Browser negative attempt did not include denial source proof.');
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
  const runtime = await postBrokerAction(fetchImpl, endpoint, session, {
    action: 'runtime_status',
    customer_id: request.customerId,
    runtime: 'browser',
  });
  const open = await postBrokerAction(fetchImpl, endpoint, session, {
    action: 'browser_open_url',
    customer_id: request.customerId,
    url: request.testUrl,
  });
  const stop = await postBrokerAction(fetchImpl, endpoint, session, {
    action: 'browser_stop',
    customer_id: request.customerId,
  });

  return {
    runtime: summarizeDeniedAttempt(runtime, `${actor}:runtime`),
    open: summarizeDeniedAttempt(open, `${actor}:open`),
    stop: summarizeDeniedAttempt(stop, `${actor}:stop`),
  };
}

async function runBusinessBrowserLiveCanary(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = env.AIONUI_EVAOS_BROKER_ENDPOINT || DEFAULT_ENDPOINT;

  requireActionAck(env);
  const desktopSession = requireEnv(env, 'AIONUI_EVAOS_DESKTOP_SESSION');
  const customerId = requireEnv(env, 'AIONUI_EVAOS_CUSTOMER_ID');
  const testUrl = normalizeTestUrl(
    env.AIONUI_EVAOS_BUSINESS_BROWSER_TEST_URL,
    env.AIONUI_EVAOS_BUSINESS_BROWSER_ALLOWED_HOSTS
  );
  const negativeFixture = readNegativeBoundaryFixture(env);

  const policyRaw = await requiredOkAction(
    fetchImpl,
    endpoint,
    desktopSession,
    {
      action: 'current_customer_account_permissions',
      customer_id: customerId,
    },
    'Business Browser policy'
  );
  const policy = summarizePolicy(policyRaw, customerId);

  const beforeRaw = await requiredOkAction(
    fetchImpl,
    endpoint,
    desktopSession,
    {
      action: 'runtime_status',
      customer_id: customerId,
      runtime: 'browser',
    },
    'Business Browser runtime before action'
  );
  const before = summarizeBrowserRuntime(beforeRaw, {
    customerAccountId: policy.customerAccountId,
    customerId,
  });

  const openRaw = await requiredOkAction(
    fetchImpl,
    endpoint,
    desktopSession,
    {
      action: 'browser_open_url',
      customer_id: customerId,
      url: testUrl,
    },
    'Business Browser open URL'
  );
  const open = summarizeBrowserActionResult(openRaw, {
    action: 'browser_open_url',
    customerAccountId: policy.customerAccountId,
    customerId,
  });

  const afterOpenRaw = await requiredOkAction(
    fetchImpl,
    endpoint,
    desktopSession,
    {
      action: 'runtime_status',
      customer_id: customerId,
      runtime: 'browser',
    },
    'Business Browser runtime after open'
  );
  const afterOpen = summarizeBrowserRuntime(afterOpenRaw, {
    customerAccountId: policy.customerAccountId,
    customerId,
  });
  if (afterOpen.status !== 'running') {
    throw new Error('Business Browser post-open runtime status must be running.');
  }

  const stopRaw = await requiredOkAction(
    fetchImpl,
    endpoint,
    desktopSession,
    {
      action: 'browser_stop',
      customer_id: customerId,
    },
    'Business Browser stop'
  );
  const stop = summarizeBrowserActionResult(stopRaw, {
    action: 'browser_stop',
    customerAccountId: policy.customerAccountId,
    customerId,
  });

  const afterStopRaw = await requiredOkAction(
    fetchImpl,
    endpoint,
    desktopSession,
    {
      action: 'runtime_status',
      customer_id: customerId,
      runtime: 'browser',
    },
    'Business Browser runtime after stop'
  );
  const afterStop = summarizeBrowserRuntime(afterStopRaw, {
    customerAccountId: policy.customerAccountId,
    customerId,
  });
  if (afterStop.status !== 'stopped') {
    throw new Error('Business Browser post-stop runtime status must be stopped.');
  }

  const acceptanceProof =
    !negativeFixture.allowNoNegative && Boolean(negativeFixture.wrongCustomerId && negativeFixture.deniedSession);

  const proof = {
    schema: 'evaos-business-browser-live-proof/v1',
    customerId,
    checkedAt: new Date().toISOString(),
    dryRun: negativeFixture.allowNoNegative,
    acceptanceProof,
    customerIsolation: negativeFixture.wrongCustomerId ? 'passed' : 'not-run',
    negativeBoundary: negativeFixture.allowNoNegative ? 'not-run' : 'required',
    policy,
    before,
    open,
    afterOpen,
    stop,
    afterStop,
    wrongCustomer: undefined,
    deniedMember: undefined,
    sensitiveOutput: 'passed',
  };

  if (negativeFixture.wrongCustomerId) {
    proof.wrongCustomer = await runDeniedActionSet(
      fetchImpl,
      endpoint,
      desktopSession,
      {
        customerId: negativeFixture.wrongCustomerId,
        testUrl,
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
        customerId,
        testUrl,
      },
      'denied_member'
    );
  }

  assertNoUnsafeProofOutput(proof);
  return proof;
}

async function main() {
  const result = await runBusinessBrowserLiveCanary();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  normalizeTestUrl,
  runBusinessBrowserLiveCanary,
  summarizeBrowserActionResult,
  summarizeBrowserRuntime,
  summarizeDeniedAttempt,
};
