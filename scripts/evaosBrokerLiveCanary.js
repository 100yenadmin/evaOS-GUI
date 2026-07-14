#!/usr/bin/env node

const DEFAULT_ENDPOINT = 'https://rhfojelkgtwcxnrfhtlj.supabase.co/functions/v1/desktop-runtime-session';
const REQUIRED_BROKER_SURFACES = Object.freeze([
  Object.freeze({ surface: 'evaos', runtime: 'openclaw' }),
  Object.freeze({ surface: 'hermes', runtime: 'hermes' }),
  Object.freeze({ surface: 'mission-control', runtime: 'paperclip' }),
  Object.freeze({ surface: 'shared-browser', runtime: 'browser' }),
  Object.freeze({ surface: 'terminal', runtime: 'terminal' }),
]);
const MAC_CONTROL_CANARY_ACK = 'evaos-mac-control-canary';
const MAC_CONTROL_RUNTIME = 'openclaw';
const MAC_CONTROL_REQUIRED_CAPABILITY_GROUPS = Object.freeze([
  Object.freeze(['customer_mac_status']),
  Object.freeze(['customer_mac_snapshot', 'desktop_see']),
  Object.freeze(['customer_mac_ax_tree', 'desktop_control', 'desktop_control_status']),
]);
const MAC_CONTROL_SAFE_REASON_CODES = new Set([
  'acl_stale',
  'binding_ambiguous',
  'binding_authority_unavailable',
  'binding_expired',
  'binding_missing',
  'binding_replay_conflict',
  'callback_rejected',
  'connector_secret_missing',
  'device_revoked',
  'grant_revoked',
  'headscale_acl_stale',
  'invalid_configuration',
  'invalid_response',
  'mac_connector_material_missing',
  'mac_node_offline',
  'mac_node_unpaired',
  'missing_required_capability',
  'runtime_launch_blocked',
  'selected_customer_scope_mismatch',
  'selected_scope_not_ready',
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

class MacControlCanaryError extends Error {
  constructor(message, proof, reason = 'invalid_response') {
    super(message);
    this.name = 'MacControlCanaryError';
    this.proof = proof;
    this.reason = reason;
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

function resolveMacControlCanaryConfig(env) {
  if (envText(env, 'AIONUI_EVAOS_MAC_CONTROL_CANARY_ACK') !== MAC_CONTROL_CANARY_ACK) {
    throw new Error(`Mac-control live canary requires acknowledgement ${MAC_CONTROL_CANARY_ACK}.`);
  }

  const names = [
    'AIONUI_EVAOS_MAC_CONTROL_CANARY_DESKTOP_SESSION',
    'AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID',
    'AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT',
    'AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST',
  ];
  const missing = names.filter((name) => !envText(env, name));
  if (missing.length > 0) {
    throw new Error(`Missing dedicated Mac-control canary configuration: ${missing.join(', ')}.`);
  }

  const customerId = envText(env, 'AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID');
  assertAllowedBrokerCanaryCustomerId(customerId);
  const endpoint = envText(env, 'AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT');
  let endpointUrl;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new Error('Dedicated Mac-control canary endpoint must be an absolute HTTPS URL.');
  }
  if (endpointUrl.protocol !== 'https:') {
    throw new Error('Dedicated Mac-control canary endpoint must be an absolute HTTPS URL.');
  }

  const expectedCallbackHostInput = envText(
    env,
    'AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST'
  ).toLowerCase();
  let expectedCallbackUrl;
  try {
    expectedCallbackUrl = new URL(`https://${expectedCallbackHostInput}`);
  } catch {
    throw new Error('Dedicated Mac-control canary callback host is invalid.');
  }
  if (
    !/^[a-z0-9.-]+$/.test(expectedCallbackUrl.hostname) ||
    expectedCallbackUrl.hostname.includes('..') ||
    expectedCallbackUrl.username ||
    expectedCallbackUrl.password ||
    expectedCallbackUrl.pathname !== '/' ||
    expectedCallbackUrl.search ||
    expectedCallbackUrl.hash
  ) {
    throw new Error('Dedicated Mac-control canary callback host is invalid.');
  }
  const expectedCallbackHost = expectedCallbackUrl.host.toLowerCase();

  return {
    desktopSession: envText(env, 'AIONUI_EVAOS_MAC_CONTROL_CANARY_DESKTOP_SESSION'),
    customerId,
    endpoint: endpointUrl.toString(),
    expectedCallbackHost,
  };
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

function macControlLaunchUrlStructureForSecretScan(launchUrl) {
  return {
    protocol: launchUrl.protocol,
    host: launchUrl.host,
    pathname: launchUrl.pathname,
    hash: launchUrl.hash,
    query: [...launchUrl.searchParams.entries()].map(([key, value]) => ({
      [key]: key === 'session' ? '[redacted]' : value,
    })),
  };
}

function macControlReason(value, fallback = 'runtime_launch_blocked') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return MAC_CONTROL_SAFE_REASON_CODES.has(normalized) ? normalized : fallback;
}

function macControlFailure(reason, message, extras = {}) {
  const error = new Error(message);
  error.reason = macControlReason(reason, 'invalid_response');
  Object.assign(error, extras);
  return error;
}

function asPlainRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function macControlCapabilitiesReady(capabilities) {
  const available = new Set(
    Array.isArray(capabilities) ? capabilities.filter((value) => typeof value === 'string') : []
  );
  return MAC_CONTROL_REQUIRED_CAPABILITY_GROUPS.every((group) => group.some((capability) => available.has(capability)));
}

function sanitizeMacControlRuntimeLaunchCanaryResponse(raw, request, now = Date.now()) {
  const record = runtimeRecord(raw);
  assertNoSecretMaterial(runtimeLaunchRecordForSecretScan(record));

  if (safeText(record.customer_id ?? record.customerId) !== request.customerId) {
    throw macControlFailure('selected_customer_scope_mismatch', 'Mac-control launch customer mismatch.');
  }
  if (safeText(record.runtime_key ?? record.runtimeKey ?? record.runtime) !== request.runtime) {
    throw macControlFailure('invalid_response', 'Mac-control launch runtime mismatch.');
  }
  if (safeText(record.status) !== 'attached') {
    throw macControlFailure(record.code ?? record.error_code ?? record.error, 'Mac-control launch was not attached.');
  }
  if (safeText(record.launch_mode ?? record.launchMode) !== 'mac_control_tools') {
    throw macControlFailure('invalid_response', 'Mac-control launch mode mismatch.');
  }

  const selected = asPlainRecord(record.mac_control ?? record.macControl);
  const runtimeStatus = asPlainRecord(record.runtime_status ?? record.runtimeStatus);
  const selectedFromStatus = asPlainRecord(runtimeStatus?.mac_control ?? runtimeStatus?.macControl);
  if (!selected || !selectedFromStatus) {
    throw macControlFailure('binding_missing', 'Mac-control launch omitted selected-binding readiness.');
  }
  if (
    selected.schema_version !== 'evaos.mac_control_runtime_readiness.v1' ||
    selected.required !== true ||
    selected.customer_id !== request.customerId ||
    selected.runtime !== request.runtime
  ) {
    throw macControlFailure('invalid_response', 'Mac-control selected-binding readiness schema mismatch.');
  }
  if (selectedFromStatus.customer_id !== request.customerId || selectedFromStatus.runtime !== request.runtime) {
    throw macControlFailure(
      'selected_customer_scope_mismatch',
      'Mac-control runtime-status binding customer scope mismatch.'
    );
  }
  if (
    selectedFromStatus.schema_version !== 'evaos.mac_control_runtime_readiness.v1' ||
    selectedFromStatus.required !== true
  ) {
    throw macControlFailure('invalid_response', 'Mac-control runtime-status binding readiness schema mismatch.');
  }
  if (selected.tools_ready !== true || runtimeStatus?.tools_ready !== true || selectedFromStatus.tools_ready !== true) {
    throw macControlFailure('selected_scope_not_ready', 'Mac-control selected binding is not tools-ready.');
  }
  if (selected.grant_state !== 'active' || selectedFromStatus.grant_state !== 'active') {
    throw macControlFailure(
      selected.grant_state === 'revoked' ? 'grant_revoked' : 'selected_scope_not_ready',
      'Mac-control selected grant is not active.'
    );
  }
  if (!macControlCapabilitiesReady(selected.allowed_capabilities)) {
    throw macControlFailure(
      'missing_required_capability',
      'Mac-control selected binding is missing a required capability group.'
    );
  }

  const bindingId = safeText(selected.binding_id);
  const nestedBindingId = safeText(selectedFromStatus.binding_id);
  if (!bindingId || !nestedBindingId) {
    throw macControlFailure('binding_missing', 'Mac-control selected binding ID is missing.');
  }
  if (bindingId !== nestedBindingId) {
    throw macControlFailure('binding_replay_conflict', 'Mac-control selected binding ID mismatch.');
  }
  const bindingVersion = safeText(selected.binding_version);
  const nestedBindingVersion = safeText(selectedFromStatus.binding_version);
  if (!bindingVersion || !nestedBindingVersion) {
    throw macControlFailure('binding_missing', 'Mac-control selected binding version is missing.');
  }
  if (bindingVersion !== nestedBindingVersion) {
    throw macControlFailure('binding_replay_conflict', 'Mac-control selected binding version mismatch.');
  }
  const bindingExpiresAt = safeText(selected.binding_expires_at);
  const nestedBindingExpiresAt = safeText(selectedFromStatus.binding_expires_at);
  if (!bindingExpiresAt || !nestedBindingExpiresAt) {
    throw macControlFailure('binding_missing', 'Mac-control selected binding expiry is missing.');
  }
  if (bindingExpiresAt !== nestedBindingExpiresAt) {
    throw macControlFailure('binding_replay_conflict', 'Mac-control selected binding expiry mismatch.');
  }
  const bindingExpiry = Date.parse(bindingExpiresAt);
  if (!Number.isFinite(bindingExpiry) || bindingExpiry <= now) {
    throw macControlFailure('binding_expired', 'Mac-control selected binding is expired.');
  }

  const launchUrlText = record.launch_url ?? record.runtime_launch_url ?? record.url;
  let launchUrl;
  try {
    launchUrl = new URL(String(launchUrlText || ''));
  } catch {
    throw macControlFailure('invalid_response', 'Mac-control launch target is invalid.');
  }
  assertNoSecretMaterial(macControlLaunchUrlStructureForSecretScan(launchUrl));
  const launchQueryKeys = [...launchUrl.searchParams.keys()];
  const exactQueryMultiset =
    launchQueryKeys.length === 2 &&
    launchUrl.searchParams.getAll('customer_id').length === 1 &&
    launchUrl.searchParams.getAll('session').length === 1;
  if (!exactQueryMultiset) {
    throw macControlFailure(
      'invalid_response',
      'Mac-control launch target requires exactly one customer_id and one session query parameter.'
    );
  }
  if (
    launchUrl.protocol !== 'https:' ||
    launchUrl.host.toLowerCase() !== request.expectedCallbackHost ||
    launchUrl.pathname !== '/auth/callback' ||
    launchUrl.username ||
    launchUrl.password ||
    launchUrl.hash ||
    launchUrl.searchParams.get('customer_id') !== request.customerId ||
    !launchUrl.searchParams.get('session')
  ) {
    throw macControlFailure(
      'invalid_response',
      'Mac-control launch target did not match the dedicated staging callback.'
    );
  }
  if (!safeText(record.source_pointer ?? record.sourcePointer) || !safeText(record.audit_id ?? record.auditId)) {
    throw macControlFailure('invalid_response', 'Mac-control launch omitted source or audit evidence.');
  }

  return {
    launchUrl: launchUrl.toString(),
    assertions: {
      attached: true,
      toolsReady: true,
      activeGrant: true,
      requiredCapabilityGroups: true,
      bindingIdPresent: true,
      bindingIdMatched: true,
      bindingVersionPresent: true,
      bindingVersionMatched: true,
      bindingExpiryPresent: true,
      bindingExpiryMatched: true,
      bindingExpiryValid: true,
      expectedLaunchTarget: true,
    },
  };
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

function macControlProofSource(env) {
  const sourceHeadSha = /^[0-9a-f]{40}$/i.test(envText(env, 'GITHUB_SHA')) ? envText(env, 'GITHUB_SHA') : undefined;
  const sourceRunId = /^\d+$/.test(envText(env, 'GITHUB_RUN_ID')) ? envText(env, 'GITHUB_RUN_ID') : undefined;
  return {
    ...(sourceHeadSha ? { sourceHeadSha } : {}),
    ...(sourceRunId ? { sourceRunId } : {}),
  };
}

function splitCombinedSetCookie(value) {
  return String(value || '').split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/);
}

function responseSetCookieHeaders(headers) {
  if (headers && typeof headers.getSetCookie === 'function') {
    const values = headers.getSetCookie();
    if (Array.isArray(values) && values.length > 0) return values;
  }
  const combined = headers?.get?.('set-cookie') || '';
  return combined ? splitCombinedSetCookie(combined) : [];
}

function hasLiveProxySessionCookie(headers, now) {
  for (const header of responseSetCookieHeaders(headers)) {
    const parts = String(header)
      .split(';')
      .map((part) => part.trim());
    const separator = parts[0].indexOf('=');
    if (separator < 1 || parts[0].slice(0, separator).trim().toLowerCase() !== 'evaos_session') continue;
    let value = parts[0].slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!value || value.toLowerCase() === 'deleted') continue;

    const attributes = new Map();
    for (const part of parts.slice(1)) {
      const index = part.indexOf('=');
      const name = (index === -1 ? part : part.slice(0, index)).trim().toLowerCase();
      const attributeValue = index === -1 ? '' : part.slice(index + 1).trim();
      if (name) attributes.set(name, attributeValue);
    }
    if (attributes.has('max-age')) {
      const maxAge = Number(attributes.get('max-age'));
      if (!Number.isFinite(maxAge) || maxAge <= 0) continue;
    }
    if (attributes.has('expires')) {
      const expiresAt = Date.parse(attributes.get('expires'));
      if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
    }
    return true;
  }
  return false;
}

function failedMacControlProof(env, reason, extras = {}) {
  return {
    schema: 'evaos-mac-control-live-canary/v1',
    ok: false,
    runtime: MAC_CONTROL_RUNTIME,
    launchMode: 'mac_control_tools',
    reason: macControlReason(reason, 'invalid_response'),
    ...macControlProofSource(env),
    ...(Number.isInteger(extras.httpStatus) ? { httpStatus: extras.httpStatus } : {}),
    secretScan: 'passed',
  };
}

async function postMacControlRuntimeLaunch(fetchImpl, config) {
  const response = await fetchImpl(config.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.desktopSession}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'runtime_launch',
      customer_id: config.customerId,
      runtime: MAC_CONTROL_RUNTIME,
      launch_mode: 'mac_control_tools',
    }),
  });

  if (!response.ok) {
    let body;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    const record = asPlainRecord(body);
    throw macControlFailure(
      record?.code ?? record?.error_code ?? record?.reason,
      'Mac-control runtime launch was blocked.',
      {
        httpStatus: response.status,
      }
    );
  }
  return response.json();
}

async function runMacControlLiveCanary(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  let config;
  try {
    config = resolveMacControlCanaryConfig(env);
    const raw = await postMacControlRuntimeLaunch(fetchImpl, config);
    const launch = sanitizeMacControlRuntimeLaunchCanaryResponse(
      raw,
      {
        customerId: config.customerId,
        runtime: MAC_CONTROL_RUNTIME,
        expectedCallbackHost: config.expectedCallbackHost,
      },
      now()
    );
    const callback = await fetchImpl(launch.launchUrl, { method: 'GET', redirect: 'manual' });
    const callbackAccepted = callback.status === 302 && callback.headers.get('location') === '/ui/';
    const proxySessionAccepted = hasLiveProxySessionCookie(callback.headers, now());
    if (!callbackAccepted || !proxySessionAccepted) {
      throw macControlFailure('callback_rejected', 'Mac-control proxy callback did not accept the staged session.', {
        httpStatus: callback.status,
      });
    }

    return {
      schema: 'evaos-mac-control-live-canary/v1',
      ok: true,
      runtime: MAC_CONTROL_RUNTIME,
      launchMode: 'mac_control_tools',
      reason: 'ready',
      httpStatus: callback.status,
      ...macControlProofSource(env),
      assertions: {
        ...launch.assertions,
        callbackAccepted: true,
        proxySessionAccepted: true,
      },
      secretScan: 'passed',
    };
  } catch (error) {
    if (error instanceof MacControlCanaryError) throw error;
    const reason = macControlReason(error?.reason, config ? 'invalid_response' : 'invalid_configuration');
    throw new MacControlCanaryError(
      'Mac-control live canary failed.',
      failedMacControlProof(env, reason, { httpStatus: error?.httpStatus }),
      reason
    );
  }
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
  const result = process.argv.includes('--mac-control') ? await runMacControlLiveCanary() : await runBrokerLiveCanary();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    if ((error instanceof BrokerCanaryError || error instanceof MacControlCanaryError) && error.proof) {
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
  MAC_CONTROL_CANARY_ACK,
  runBrokerLiveCanary,
  runMacControlLiveCanary,
  sanitizeBrokerRuntimeCanaryResponse,
  sanitizeBrokerRuntimeLaunchCanaryResponse,
  sanitizeMacControlRuntimeLaunchCanaryResponse,
  resolveBrokerCanaryCredentials,
  resolveMacControlCanaryConfig,
  nonOkResponseShapeSummary,
};
