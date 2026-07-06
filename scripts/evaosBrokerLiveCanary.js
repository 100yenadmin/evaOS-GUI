#!/usr/bin/env node

const DEFAULT_ENDPOINT = 'https://rhfojelkgtwcxnrfhtlj.supabase.co/functions/v1/desktop-runtime-session';
const REQUIRED_BROKER_SURFACES = Object.freeze([
  Object.freeze({ surface: 'evaos', runtime: 'openclaw' }),
  Object.freeze({ surface: 'hermes', runtime: 'hermes' }),
  Object.freeze({ surface: 'mission-control', runtime: 'paperclip' }),
  Object.freeze({ surface: 'shared-browser', runtime: 'browser' }),
  Object.freeze({ surface: 'terminal', runtime: 'terminal' }),
]);

const DENIED_RUNTIME_PATTERN =
  /(denied|blocked|forbidden|unauthorized|expired|revoked|permission|mac_connector_material_missing|internal server error|internal_server_error|server_error)/i;
const INTERNAL_BROKER_CANARY_CUSTOMER_IDS = new Set(['evaos-support', 'golden', 'internal', 'support', 'support-vm']);
const SECRET_FIELD_PATTERN =
  /(authorization|bearer|token|secret|password|credential|desktop[_-]?session|access[_-]?token|refresh[_-]?token|api[_-]?key|service[_-]?role|provider[_-]?grant|grant[_-]?handle)/i;
const SAFE_FALSE_SECRET_ASSERTION_FIELDS = new Set([
  'raw_secrets_stored_in_workbench',
  'rawSecretsStoredInWorkbench',
  'raw_secrets_present',
]);
const SECRET_VALUE_PATTERNS = [
  /[?&#](?:access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|grant[_-]?handle|api[_-]?key|service[_-]?role|token|secret|password|credential)=/i,
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
];

class BrokerCanaryError extends Error {
  constructor(message, proof) {
    super(message);
    this.name = 'BrokerCanaryError';
    this.proof = proof;
  }
}

function containsSecretMaterial(value) {
  return typeof value === 'string' && SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function assertNoSecretMaterial(value, path = '$', seen = new WeakSet()) {
  if (typeof value === 'string') {
    if (containsSecretMaterial(value)) {
      throw new Error(`Broker canary response exposed secret material at ${path}.`);
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
    value.forEach((item, index) => assertNoSecretMaterial(item, `${path}[${index}]`, seen));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELD_PATTERN.test(key)) {
      if (SAFE_FALSE_SECRET_ASSERTION_FIELDS.has(key) && child === false) {
        continue;
      }
      throw new Error(`Broker canary response exposed secret material at ${path}.${key}.`);
    }
    assertNoSecretMaterial(child, `${path}.${key}`, seen);
  }
}

function safeText(value) {
  return typeof value === 'string' && value.trim() && !containsSecretMaterial(value) ? value.trim() : undefined;
}

function envText(env, name) {
  return typeof env[name] === 'string' && env[name].trim() ? env[name].trim() : '';
}

function truthyEnv(env, name) {
  return /^(1|true|yes|on)$/i.test(envText(env, name));
}

function assertAllowedBrokerCanaryCustomerId(customerId) {
  const normalized = customerId.trim().toLowerCase();
  if (
    INTERNAL_BROKER_CANARY_CUSTOMER_IDS.has(normalized) ||
    /^evaos[-_]?support\b/.test(normalized) ||
    /^golden\b/.test(normalized) ||
    /^internal\b/.test(normalized)
  ) {
    throw new Error(
      `Live broker canary target ${customerId} is an internal support or golden VM target. Use a dedicated non-internal broker proof customer.`
    );
  }
}

function resolveBrokerCanaryCredentials(env) {
  const brokerDesktopSession = envText(env, 'AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION');
  const brokerCustomerId = envText(env, 'AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID');
  const defaultDesktopSession = envText(env, 'AIONUI_EVAOS_DESKTOP_SESSION');
  const defaultCustomerId = envText(env, 'AIONUI_EVAOS_CUSTOMER_ID');
  const requireBrokerSpecificTarget = truthyEnv(env, 'AIONUI_EVAOS_REQUIRE_BROKER_CANARY_TARGET');
  const brokerPairPresent = Boolean(brokerDesktopSession || brokerCustomerId);

  if (brokerPairPresent) {
    const missing = [];
    if (!brokerDesktopSession) {
      missing.push('AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION');
    }
    if (!brokerCustomerId) {
      missing.push('AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID');
    }
    if (missing.length > 0) {
      throw new Error(`Incomplete broker-specific canary credential pair: missing ${missing.join(', ')}.`);
    }
    assertAllowedBrokerCanaryCustomerId(brokerCustomerId);
    return {
      desktopSession: brokerDesktopSession,
      customerId: brokerCustomerId,
      credentialSource: 'broker-specific',
    };
  }

  if (requireBrokerSpecificTarget) {
    throw new Error(
      'Live broker canary release proof requires AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION + AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID. Refusing to fall back to release/default customer credentials.'
    );
  }

  const missing = [];
  if (!defaultDesktopSession) {
    missing.push('AIONUI_EVAOS_DESKTOP_SESSION');
  }
  if (!defaultCustomerId) {
    missing.push('AIONUI_EVAOS_CUSTOMER_ID');
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing one complete broker canary credential pair. Set AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION + AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID or AIONUI_EVAOS_DESKTOP_SESSION + AIONUI_EVAOS_CUSTOMER_ID. Missing ${missing.join(', ')}.`
    );
  }

  return {
    desktopSession: defaultDesktopSession,
    customerId: defaultCustomerId,
    credentialSource: 'default',
  };
}

function runtimeRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Broker canary response was not an object.');
  }
  if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) {
    return raw.data;
  }
  return raw;
}

function sanitizeBrokerRuntimeCanaryResponse(raw, request) {
  assertNoSecretMaterial(raw);
  const record = runtimeRecord(raw);
  const customerId = safeText(record.customer_id ?? record.customerId);
  const runtime = safeText(record.runtime_key ?? record.runtimeKey ?? record.runtime);
  const status = safeText(record.status);

  if (!customerId || customerId !== request.customerId) {
    throw new Error(
      `Broker canary customer proof mismatch: expected ${request.customerId}, got ${customerId || 'missing'}.`
    );
  }
  if (!runtime || runtime !== request.runtime) {
    throw new Error(`Broker canary runtime proof mismatch: expected ${request.runtime}, got ${runtime || 'missing'}.`);
  }
  if (!status) {
    throw new Error('Broker canary response did not include a safe runtime status.');
  }
  const sourcePointer = safeText(record.source_pointer ?? record.sourcePointer);
  const auditId = safeText(record.audit_id ?? record.auditId);
  if (!sourcePointer || !auditId) {
    throw new Error('Broker canary response did not include source and audit evidence.');
  }

  return {
    schema: 'evaos-broker-live-canary/v1',
    customerId,
    runtime,
    status,
    displayLabel: safeText(record.display_label ?? record.displayLabel),
    sourcePointer,
    auditId,
    checkedAt: new Date().toISOString(),
    secretScan: 'passed',
  };
}

function runtimeLaunchRecordForSecretScan(record) {
  const redacted = { ...record };
  delete redacted.launch_url;
  delete redacted.runtime_launch_url;
  delete redacted.url;
  return redacted;
}

function responseShapeSummary(raw) {
  try {
    const record = runtimeRecord(raw);
    assertNoSecretMaterial(runtimeLaunchRecordForSecretScan(record));
    const topLevelKeys = Object.keys(record).sort();
    const nestedShape = {};
    for (const key of [
      'runtime_status',
      'runtimeStatus',
      'runtime_surface',
      'runtimeSurface',
      'surface_status',
      'surfaceStatus',
    ]) {
      const nested = record[key];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        assertNoSecretMaterial(runtimeLaunchRecordForSecretScan(nested));
        nestedShape[key] = Object.keys(nested).sort();
      }
    }
    return {
      topLevelKeys,
      schemaVersion: safeText(record.schema_version ?? record.schemaVersion),
      status: safeText(record.status),
      code: safeText(record.code),
      error: safeText(record.error),
      message: safeText(record.message),
      customerId: safeText(record.customer_id ?? record.customerId),
      runtime: safeText(record.runtime_key ?? record.runtimeKey ?? record.runtime),
      launchMode: safeText(record.launch_mode ?? record.launchMode),
      sourcePointer: safeText(record.source_pointer ?? record.sourcePointer),
      auditId: safeText(record.audit_id ?? record.auditId),
      launchTargetPresent: Boolean(record.launch_url || record.runtime_launch_url || record.url),
      nestedShape,
      secretScan: 'passed',
    };
  } catch (error) {
    return {
      summaryUnavailable: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function classifyNonJsonResponseBody(text) {
  const value = typeof text === 'string' ? text.trim().toLowerCase() : '';
  if (!value) return 'empty';
  if (containsSecretMaterial(value)) return 'redacted_secret_like';
  if (/\bnot\s+found\b|^404\b/.test(value)) return 'not_found';
  if (/\bforbidden\b|^403\b/.test(value)) return 'forbidden';
  if (/\bunauthorized\b|^401\b/.test(value)) return 'unauthorized';
  if (/\binternal\s+server\s+error\b|^500\b/.test(value)) return 'internal_server_error';
  if (/\bbad\s+request\b|^400\b/.test(value)) return 'bad_request';
  return 'non_json';
}

async function nonOkResponseShapeSummary(response) {
  const contentType = response.headers.get('content-type') || '';
  const summary = {
    httpStatus: response.status,
    contentType: contentType.split(';', 1)[0].trim().toLowerCase() || 'unknown',
  };

  if (/json/i.test(contentType)) {
    try {
      summary.responseShape = responseShapeSummary(await response.json());
      return summary;
    } catch (error) {
      summary.responseShape = {
        summaryUnavailable: true,
        reason: error instanceof Error ? error.message : String(error),
      };
      return summary;
    }
  }

  try {
    summary.bodyClass = classifyNonJsonResponseBody(await response.text());
  } catch {
    summary.bodyClass = 'unreadable';
  }
  return summary;
}

function assertNoDeniedNestedRuntimeState(value, label, seen = new WeakSet()) {
  if (typeof value === 'string') {
    if (DENIED_RUNTIME_PATTERN.test(value)) {
      throw new Error(`Broker canary received denied runtime_launch response at ${label}.`);
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
    value.forEach((child, index) => assertNoDeniedNestedRuntimeState(child, `${label}[${index}]`, seen));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    assertNoDeniedNestedRuntimeState(child, `${label}.${key}`, seen);
  }
}

function sanitizeBrokerRuntimeLaunchCanaryResponse(raw, request) {
  const record = runtimeRecord(raw);
  assertNoSecretMaterial(runtimeLaunchRecordForSecretScan(record));
  const customerId = safeText(record.customer_id ?? record.customerId);
  const runtime = safeText(record.runtime_key ?? record.runtimeKey ?? record.runtime);
  const status = safeText(record.status);
  const launchMode = safeText(record.launch_mode ?? record.launchMode) ?? 'dashboard_surface';
  const launchTargetPresent = Boolean(record.launch_url || record.runtime_launch_url || record.url);
  const sourcePointer = safeText(record.source_pointer ?? record.sourcePointer);
  const auditId = safeText(record.audit_id ?? record.auditId);

  if (!customerId || customerId !== request.customerId) {
    throw new Error(
      `Broker launch canary customer proof mismatch: expected ${request.customerId}, got ${customerId || 'missing'}.`
    );
  }
  if (!runtime || runtime !== request.runtime) {
    throw new Error(
      `Broker launch canary runtime proof mismatch: expected ${request.runtime}, got ${runtime || 'missing'}.`
    );
  }
  if (!status) {
    throw new Error('Broker launch canary response did not include a safe runtime status.');
  }
  const statusText = [
    status,
    safeText(record.message),
    safeText(record.error),
    safeText(record.code),
    safeText(record.health_summary ?? record.healthSummary),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (DENIED_RUNTIME_PATTERN.test(statusText)) {
    throw new Error('Broker canary received denied runtime_launch response.');
  }
  for (const [key, nested] of [
    ['runtime_status', record.runtime_status ?? record.runtimeStatus],
    ['runtime_surface', record.runtime_surface ?? record.runtimeSurface],
    ['surface_status', record.surface_status ?? record.surfaceStatus],
  ]) {
    if (nested) {
      assertNoDeniedNestedRuntimeState(nested, key);
    }
  }
  if (!launchTargetPresent) {
    throw new Error('Broker launch canary response did not include a runtime launch target.');
  }
  if (!sourcePointer || !auditId) {
    throw new Error('Broker launch canary response did not include source and audit evidence.');
  }

  return {
    status,
    launchMode,
    sourcePointer,
    auditId,
    launchUrlRedacted: true,
    checkedAt: new Date().toISOString(),
    secretScan: 'passed',
  };
}

function requestedBrokerSurfaces(env) {
  const runtime = safeText(env.AIONUI_EVAOS_BROKER_RUNTIME);
  if (!runtime) {
    return REQUIRED_BROKER_SURFACES;
  }

  const surface = REQUIRED_BROKER_SURFACES.find((candidate) => candidate.runtime === runtime);
  if (surface) {
    return [surface];
  }

  return [Object.freeze({ surface: runtime, runtime })];
}

async function postBrokerRuntimeAction(fetchImpl, endpoint, desktopSession, body) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${desktopSession}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = new Error(`Broker canary failed HTTP ${response.status}.`);
    error.responseShape = await nonOkResponseShapeSummary(response);
    throw error;
  }

  return response.json();
}

async function runBrokerSurfaceCanary({ env, fetchImpl, endpoint, desktopSession, customerId, surface }) {
  const failures = [];
  const failureDetails = [];
  let statusProof;
  let launchProof;
  let rawStatus;
  let rawLaunch;

  try {
    rawStatus = await postBrokerRuntimeAction(fetchImpl, endpoint, desktopSession, {
      action: 'runtime_status',
      customer_id: customerId,
      runtime: surface.runtime,
    });
    statusProof = sanitizeBrokerRuntimeCanaryResponse(rawStatus, { customerId, runtime: surface.runtime });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`status: ${message}`);
    failureDetails.push({
      phase: 'status',
      message,
      responseShape: error?.responseShape ?? responseShapeSummary(rawStatus),
    });
  }

  try {
    rawLaunch = await postBrokerRuntimeAction(fetchImpl, endpoint, desktopSession, {
      action: 'runtime_launch',
      customer_id: customerId,
      runtime: surface.runtime,
      launch_mode: 'dashboard_surface',
    });
    launchProof = sanitizeBrokerRuntimeLaunchCanaryResponse(rawLaunch, {
      customerId,
      runtime: surface.runtime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`launch: ${message}`);
    failureDetails.push({
      phase: 'launch',
      message,
      responseShape: error?.responseShape ?? responseShapeSummary(rawLaunch),
    });
  }

  if (failures.length > 0) {
    const failure = new Error(failures.join(' | '));
    failure.details = failureDetails;
    throw failure;
  }

  return {
    surface: surface.surface,
    runtime: surface.runtime,
    status: statusProof.status,
    displayLabel: statusProof.displayLabel,
    sourcePointer: statusProof.sourcePointer,
    auditId: statusProof.auditId,
    checkedAt: statusProof.checkedAt,
    secretScan: statusProof.secretScan,
    launch: launchProof,
  };
}

async function runBrokerLiveCanary(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = env.AIONUI_EVAOS_BROKER_ENDPOINT || DEFAULT_ENDPOINT;
  const { desktopSession, customerId, credentialSource } = resolveBrokerCanaryCredentials(env);

  const surfaces = [];
  const failures = [];
  const failureDetails = [];
  for (const surface of requestedBrokerSurfaces(env)) {
    try {
      surfaces.push(
        await runBrokerSurfaceCanary({
          env,
          fetchImpl,
          endpoint,
          desktopSession,
          customerId,
          surface,
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${surface.surface}/${surface.runtime}: ${message}`);
      failureDetails.push({
        surface: surface.surface,
        runtime: surface.runtime,
        message,
        phases: Array.isArray(error?.details) ? error.details : [],
      });
    }
  }
  if (failures.length > 0) {
    throw new BrokerCanaryError(`Broker live canary failed for ${failures.length} surface(s): ${failures.join('; ')}`, {
      schema: 'evaos-broker-live-canary/v3',
      ok: false,
      customerId,
      credentialSource,
      releaseCanaryCustomerId: safeText(env.AIONUI_EVAOS_RELEASE_CANARY_CUSTOMER_ID) ?? customerId,
      requiredSurfaces: requestedBrokerSurfaces(env).map((surface) => surface.surface),
      surfaces,
      failures: failureDetails,
      checkedAt: new Date().toISOString(),
      secretScan: 'passed',
    });
  }

  return {
    schema: 'evaos-broker-live-canary/v3',
    customerId,
    credentialSource,
    releaseCanaryCustomerId: safeText(env.AIONUI_EVAOS_RELEASE_CANARY_CUSTOMER_ID) ?? customerId,
    requiredSurfaces: surfaces.map((surface) => surface.surface),
    surfaces,
    checkedAt: new Date().toISOString(),
    secretScan: 'passed',
  };
}

async function main() {
  const result = await runBrokerLiveCanary();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    if (error instanceof BrokerCanaryError && error.proof) {
      console.log(JSON.stringify(error.proof, null, 2));
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_ENDPOINT,
  REQUIRED_BROKER_SURFACES,
  assertNoSecretMaterial,
  runBrokerLiveCanary,
  sanitizeBrokerRuntimeCanaryResponse,
  sanitizeBrokerRuntimeLaunchCanaryResponse,
  resolveBrokerCanaryCredentials,
  nonOkResponseShapeSummary,
};
