#!/usr/bin/env node

const DEFAULT_ENDPOINT = 'https://rhfojelkgtwcxnrfhtlj.supabase.co/functions/v1/desktop-runtime-session';

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
];

function containsSecretMaterial(value) {
  return (
    typeof value === 'string' &&
    (SECRET_FIELD_PATTERN.test(value) || SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value)))
  );
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
    if (containsSecretMaterial(key)) {
      throw new Error(`Broker canary response exposed secret material at ${path}.${key}.`);
    }
    assertNoSecretMaterial(child, `${path}.${key}`, seen);
  }
}

function safeText(value) {
  return typeof value === 'string' && value.trim() && !containsSecretMaterial(value) ? value.trim() : undefined;
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

  return {
    schema: 'evaos-broker-live-canary/v1',
    customerId,
    runtime,
    status,
    displayLabel: safeText(record.display_label ?? record.displayLabel),
    sourcePointer: safeText(record.source_pointer ?? record.sourcePointer),
    auditId: safeText(record.audit_id ?? record.auditId),
    checkedAt: new Date().toISOString(),
    secretScan: 'passed',
  };
}

async function runBrokerLiveCanary(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = env.AIONUI_EVAOS_BROKER_ENDPOINT || DEFAULT_ENDPOINT;
  const desktopSession = env.AIONUI_EVAOS_DESKTOP_SESSION;
  const customerId = env.AIONUI_EVAOS_CUSTOMER_ID;
  const runtime = env.AIONUI_EVAOS_RUNTIME || 'browser';

  if (!desktopSession) {
    throw new Error('Missing AIONUI_EVAOS_DESKTOP_SESSION for live broker canary.');
  }
  if (!customerId) {
    throw new Error('Missing AIONUI_EVAOS_CUSTOMER_ID for live broker canary.');
  }

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${desktopSession}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'runtime_status',
      customer_id: customerId,
      runtime,
    }),
  });

  if (!response.ok) {
    throw new Error(`Broker canary failed HTTP ${response.status}.`);
  }

  const raw = await response.json();
  return sanitizeBrokerRuntimeCanaryResponse(raw, { customerId, runtime });
}

async function main() {
  const result = await runBrokerLiveCanary();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_ENDPOINT,
  assertNoSecretMaterial,
  runBrokerLiveCanary,
  sanitizeBrokerRuntimeCanaryResponse,
};
