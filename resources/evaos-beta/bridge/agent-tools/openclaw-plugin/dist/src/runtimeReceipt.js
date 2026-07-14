import { createPublicKey, verify } from 'node:crypto';
export const MAC_CONTROL_RUNTIME_RECEIPT_PATH = '/api/v1/evaos/mac-control/runtime-receipt';
const CONTEXT_SCHEMA = 'evaos.mac_control_execution_context.v1';
const CONTRACT_SCHEMA = 'evaos.mac_control_runtime_contract.v2';
const CONNECTOR_REQUEST_SCHEMA = 'evaos.mac_control.canary_request.v1';
const CONNECTOR_RESPONSE_SCHEMA = 'evaos.mac_control.runtime_receipt_envelope.v1';
const RECEIPT_NAMESPACE = 'evaos-mac-control-receipt-v1';
const CONTEXT_TTL_SECONDS = 60;
const CLOCK_SKEW_SECONDS = 5;
const MAX_REQUEST_BYTES = 4096;
const MAX_CONNECTOR_RESPONSE_BYTES = 65536;
const CONTEXT_FIELDS = [
  'schema_version',
  'key_id',
  'runtime',
  'customer_id',
  'customer_vm_id',
  'binding_id',
  'binding_version',
  'issued_at',
  'expires_at',
  'context_id',
];
const RESPONSE_FIELDS = ['schema', 'receiptBase64', 'signature', 'keyId', 'namespace'];
const HEADER = {
  context: 'x-evaos-mac-control-execution-context',
  contextSignature: 'x-evaos-mac-control-execution-context-signature',
  contextKeyId: 'x-evaos-mac-control-execution-context-key-id',
  contract: 'x-evaos-mac-control-contract',
  customer: 'x-evaos-mac-control-customer',
  grantState: 'x-evaos-mac-control-grant-state',
  connectorUrl: 'x-evaos-desktop-bridge-url',
  connectorToken: 'x-evaos-desktop-bridge-token',
  connectorTokenLast4: 'x-evaos-desktop-bridge-token-last4',
  bindingId: 'x-evaos-mac-control-binding-id',
  bindingVersion: 'x-evaos-mac-control-binding-version',
  bindingExpiresAt: 'x-evaos-mac-control-binding-expires-at',
};
/** Register the one exact, gateway-authenticated Mac-control receipt route. */
export function registerMacControlRuntimeReceiptRoute(api) {
  api.registerHttpRoute({
    path: MAC_CONTROL_RUNTIME_RECEIPT_PATH,
    auth: 'gateway',
    match: 'exact',
    handler: createMacControlRuntimeReceiptHandler(),
  });
}
/** Build the receipt route handler; dependency overrides exist only for focused tests. */
export function createMacControlRuntimeReceiptHandler(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const replayCache = options.replayCache ?? new Map();
  return async (request, response) => {
    if ((request.method ?? 'GET').toUpperCase() !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendError(response, 405, 'method_not_allowed');
      return true;
    }
    const publicRequest = await readPublicRequest(request);
    if (!publicRequest.ok) {
      sendError(response, publicRequest.status, 'invalid_request');
      return true;
    }
    const authority = verifyAuthority(request.headers, env, now());
    if (!authority.ok) {
      sendError(response, authority.status, authority.code);
      return true;
    }
    pruneReplayCache(replayCache, now());
    if (replayCache.has(authority.value.context.context_id)) {
      sendError(response, 409, 'execution_context_replayed');
      return true;
    }
    replayCache.set(authority.value.context.context_id, authority.value.context.expires_at * 1000);
    const connectorBody = {
      schema: CONNECTOR_REQUEST_SCHEMA,
      challenge: publicRequest.value.challenge,
      runRef: publicRequest.value.runRef,
      executionContext: {
        payload: authority.value.contextPayload,
        signature: authority.value.contextSignature,
        keyId: authority.value.contextKeyId,
      },
      binding: {
        bindingId: authority.value.bindingId,
        bindingVersion: authority.value.bindingVersion,
        bindingExpiresAt: authority.value.bindingExpiresAt,
      },
    };
    let connectorResponse;
    try {
      connectorResponse = await fetchImpl(`${authority.value.connectorUrl}/v1/canary/mac-control`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authority.value.connectorToken}`,
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(connectorBody),
      });
    } catch {
      sendError(response, 502, 'connector_unavailable');
      return true;
    }
    if (!connectorResponse.ok) {
      sendError(
        response,
        connectorResponse.status >= 400 && connectorResponse.status < 500 ? 409 : 502,
        'connector_rejected_canary'
      );
      return true;
    }
    let rawConnectorResponse;
    try {
      rawConnectorResponse = await connectorResponse.text();
    } catch {
      sendError(response, 502, 'connector_response_invalid');
      return true;
    }
    const sanitized = validateConnectorEnvelope(rawConnectorResponse, authority.value);
    if (!sanitized.ok) {
      sendError(response, 502, 'connector_response_invalid');
      return true;
    }
    sendJson(response, 200, sanitized.value);
    return true;
  };
}
async function readPublicRequest(request) {
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(typeof chunk === 'string' ? chunk : chunk);
      total += buffer.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        return { ok: false, status: 413 };
      }
      chunks.push(buffer);
    }
  } catch {
    return { ok: false, status: 400 };
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return { ok: false, status: 400 };
  }
  if (!isRecord(body) || !hasExactKeys(body, ['challenge', 'runRef'])) {
    return { ok: false, status: 400 };
  }
  if (
    typeof body.challenge !== 'string' ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(body.challenge) ||
    decodeBase64Url(body.challenge)?.byteLength === undefined ||
    typeof body.runRef !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(body.runRef)
  ) {
    return { ok: false, status: 400 };
  }
  const challengeBytes = decodeBase64Url(body.challenge);
  if (!challengeBytes || challengeBytes.byteLength < 24 || challengeBytes.byteLength > 96) {
    return { ok: false, status: 400 };
  }
  return { ok: true, value: { challenge: body.challenge, runRef: body.runRef } };
}
function verifyAuthority(headers, env, nowMs) {
  const expectedKeyId = env.EVAOS_MAC_CONTROL_EXECUTION_CONTEXT_KEY_ID;
  const publicKeyBase64 = env.EVAOS_MAC_CONTROL_EXECUTION_CONTEXT_PUBLIC_KEY_B64;
  if (!expectedKeyId || !publicKeyBase64 || !validKeyId(expectedKeyId)) {
    return { ok: false, status: 503, code: 'execution_context_verifier_unavailable' };
  }
  const rawPublicKey = decodeCanonicalBase64(publicKeyBase64);
  if (!rawPublicKey || rawPublicKey.byteLength !== 32) {
    return { ok: false, status: 503, code: 'execution_context_verifier_unavailable' };
  }
  const contextPayload = readHeader(headers, HEADER.context);
  const contextSignature = readHeader(headers, HEADER.contextSignature);
  const contextKeyId = readHeader(headers, HEADER.contextKeyId);
  if (!contextPayload || !contextSignature || !contextKeyId) {
    return { ok: false, status: 401, code: 'execution_context_missing' };
  }
  if (contextKeyId !== expectedKeyId) {
    return { ok: false, status: 401, code: 'execution_context_key_unknown' };
  }
  const payloadBytes = decodeBase64Url(contextPayload);
  const signatureBytes = decodeBase64Url(contextSignature);
  if (!payloadBytes || !signatureBytes || signatureBytes.byteLength !== 64) {
    return { ok: false, status: 401, code: 'execution_context_malformed' };
  }
  try {
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const publicKey = createPublicKey({
      key: Buffer.concat([spkiPrefix, rawPublicKey]),
      format: 'der',
      type: 'spki',
    });
    if (!verify(null, payloadBytes, publicKey, signatureBytes)) {
      return { ok: false, status: 401, code: 'execution_context_signature_invalid' };
    }
  } catch {
    return { ok: false, status: 401, code: 'execution_context_signature_invalid' };
  }
  let parsed;
  try {
    parsed = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    return { ok: false, status: 401, code: 'execution_context_malformed' };
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, CONTEXT_FIELDS)) {
    return { ok: false, status: 401, code: 'execution_context_malformed' };
  }
  const context = parsed;
  if (
    context.schema_version !== CONTEXT_SCHEMA ||
    context.key_id !== expectedKeyId ||
    context.key_id !== contextKeyId ||
    context.runtime !== 'openclaw' ||
    !validOpaqueId(context.customer_id, 160) ||
    !validOpaqueId(context.customer_vm_id, 160) ||
    !validOpaqueId(context.binding_id, 160) ||
    !validBindingVersion(context.binding_version) ||
    !Number.isInteger(context.issued_at) ||
    !Number.isInteger(context.expires_at) ||
    !validContextId(context.context_id)
  ) {
    return { ok: false, status: 401, code: 'execution_context_malformed' };
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    context.issued_at > nowSeconds + CLOCK_SKEW_SECONDS ||
    context.issued_at < nowSeconds - CONTEXT_TTL_SECONDS ||
    context.expires_at <= nowSeconds ||
    context.expires_at <= context.issued_at ||
    context.expires_at > context.issued_at + CONTEXT_TTL_SECONDS
  ) {
    return { ok: false, status: 401, code: 'execution_context_expired' };
  }
  const contract = readHeader(headers, HEADER.contract);
  const customer = readHeader(headers, HEADER.customer);
  const grantState = readHeader(headers, HEADER.grantState);
  const connectorUrlHeader = readHeader(headers, HEADER.connectorUrl);
  const connectorToken = readHeader(headers, HEADER.connectorToken);
  const connectorTokenLast4 = readHeader(headers, HEADER.connectorTokenLast4);
  const bindingId = readHeader(headers, HEADER.bindingId);
  const bindingVersion = readHeader(headers, HEADER.bindingVersion);
  const bindingExpiresAt = readHeader(headers, HEADER.bindingExpiresAt);
  const connectorUrl = connectorUrlHeader ? validConnectorUrl(connectorUrlHeader) : undefined;
  const bindingExpiryMs = bindingExpiresAt ? Date.parse(bindingExpiresAt) : Number.NaN;
  if (
    contract !== CONTRACT_SCHEMA ||
    grantState !== 'active' ||
    customer !== context.customer_id ||
    bindingId !== context.binding_id ||
    bindingVersion !== context.binding_version ||
    !bindingExpiresAt ||
    !Number.isFinite(bindingExpiryMs) ||
    context.expires_at * 1000 > bindingExpiryMs ||
    !connectorUrl ||
    !connectorToken ||
    connectorToken.length < 24 ||
    connectorToken.length > 512 ||
    connectorToken.trim() !== connectorToken ||
    !connectorTokenLast4 ||
    connectorTokenLast4 !== connectorToken.slice(-4)
  ) {
    return { ok: false, status: 401, code: 'execution_context_scope_mismatch' };
  }
  return {
    ok: true,
    value: {
      context,
      contextPayload,
      contextSignature,
      contextKeyId,
      connectorUrl,
      connectorToken,
      bindingId,
      bindingVersion,
      bindingExpiresAt,
    },
  };
}
function validateConnectorEnvelope(raw, authority) {
  if (Buffer.from(raw).byteLength > MAX_CONNECTOR_RESPONSE_BYTES) {
    return { ok: false };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, RESPONSE_FIELDS)) {
    return { ok: false };
  }
  if (
    parsed.schema !== CONNECTOR_RESPONSE_SCHEMA ||
    parsed.namespace !== RECEIPT_NAMESPACE ||
    typeof parsed.receiptBase64 !== 'string' ||
    parsed.receiptBase64.length < 32 ||
    parsed.receiptBase64.length > 32768 ||
    typeof parsed.signature !== 'string' ||
    parsed.signature.length > 8192 ||
    typeof parsed.keyId !== 'string' ||
    !validKeyId(parsed.keyId)
  ) {
    return { ok: false };
  }
  const receiptBytes = decodeBase64Url(parsed.receiptBase64);
  if (!receiptBytes || receiptBytes.byteLength > 24576 || !validSshSignature(parsed.signature)) {
    return { ok: false };
  }
  const receiptText = receiptBytes.toString('utf8');
  const forbiddenValues = [
    authority.connectorToken,
    authority.connectorUrl,
    authority.context.customer_id,
    authority.context.customer_vm_id,
    authority.context.binding_id,
    authority.contextPayload,
    authority.contextSignature,
  ];
  if (
    forbiddenValues.some((value) => value.length > 0 && receiptText.includes(value)) ||
    /https?:\/\//i.test(receiptText) ||
    /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}\b/.test(receiptText) ||
    /(?:\/tmp\/|\/private\/var\/folders\/)/i.test(receiptText) ||
    /"(?:token|secret|authorization|connector_url|customer_id|customer_vm_id|binding_id)"\s*:/i.test(receiptText)
  ) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}
function validConnectorUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (
    parsed.protocol !== 'http:' ||
    parsed.port !== '8765' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    !isTailnetIpv4(parsed.hostname)
  ) {
    return undefined;
  }
  return parsed.origin;
}
function isTailnetIpv4(value) {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    return false;
  }
  return Number(parts[0]) === 100 && Number(parts[1]) >= 64 && Number(parts[1]) <= 127;
}
function readHeader(headers, name) {
  const value = headers[name] ?? headers[canonicalHeaderName(name)];
  if (Array.isArray(value)) {
    return value.length === 1 ? strictString(value[0]) : undefined;
  }
  return strictString(value);
}
function canonicalHeaderName(name) {
  return name
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join('-');
}
function strictString(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value && !value.includes(',')
    ? value
    : undefined;
}
function validOpaqueId(value, maxLength) {
  return typeof value === 'string' && new RegExp(`^[A-Za-z0-9][A-Za-z0-9._:@-]{0,${maxLength - 1}}$`).test(value);
}
function validBindingVersion(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value);
}
function validKeyId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}
function validContextId(value) {
  return typeof value === 'string' && decodeBase64Url(value)?.byteLength === 16;
}
function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.toString('base64url') === value ? decoded : undefined;
  } catch {
    return undefined;
  }
}
function decodeCanonicalBase64(value) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.toString('base64') === value ? decoded : undefined;
  } catch {
    return undefined;
  }
}
function validSshSignature(value) {
  return /^-----BEGIN SSH SIGNATURE-----\n(?:[A-Za-z0-9+/=]{1,76}\n)+-----END SSH SIGNATURE-----\n?$/.test(value);
}
function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function pruneReplayCache(cache, nowMs) {
  for (const [contextId, expiresAt] of cache) {
    if (expiresAt <= nowMs) {
      cache.delete(contextId);
    }
  }
}
function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}
function sendError(response, status, code) {
  sendJson(response, status, { ok: false, error: { code } });
}
