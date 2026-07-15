import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
export const MAC_CONTROL_RUNTIME_RECEIPT_PATH = '/api/v1/evaos/mac-control/runtime-receipt';
const CONTEXT_SCHEMA = 'evaos.mac_control_execution_context.v1';
const CONTRACT_SCHEMA = 'evaos.mac_control_runtime_contract.v2';
const CONNECTOR_REQUEST_SCHEMA = 'evaos.mac_control.canary_request.v1';
const CONNECTOR_RESPONSE_SCHEMA = 'evaos.mac_control.runtime_receipt_bundle.v2';
const PRIVATE_RECEIPT_ENVELOPE_SCHEMA = 'evaos.mac_control.runtime_receipt_envelope.v1';
const RECEIPT_SCHEMA = 'evaos.mac_control.runtime_receipt.v1';
const RECEIPT_NAMESPACE = 'evaos-mac-control-receipt-v1';
const PUBLIC_ATTESTATION_SCHEMA = 'evaos.mac_control.public_runtime_attestation.v1';
const PUBLIC_ATTESTATION_ENVELOPE_SCHEMA = 'evaos.mac_control.public_runtime_attestation_envelope.v1';
const PUBLIC_ATTESTATION_NAMESPACE = 'evaos-mac-control-public-attestation-v1';
const PUBLIC_PROOF_KIND = 'selected_binding_direct_mac_control';
const DEPLOYED_NEGATIVE_PROBE_SCHEMA = 'evaos.mac_control.deployed_negative_probe.v1';
const DEPLOYED_NEGATIVE_PROBE_MODE = 'deployed-staging';
const DEPLOYED_NEGATIVE_PROBE_ENV_MODE = 'staging';
const CONTEXT_TTL_SECONDS = 60;
const CLOCK_SKEW_SECONDS = 5;
const DEFAULT_CONNECTOR_TIMEOUT_MS = 10_000;
const AUTHORITY_DEADLINE_SAFETY_MS = 250;
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
const RESPONSE_FIELDS = ['schema', 'privateReceipt', 'publicAttestation'];
const PRIVATE_RECEIPT_ENVELOPE_FIELDS = ['schema', 'receiptBase64', 'signature', 'keyId', 'namespace'];
const PUBLIC_ATTESTATION_ENVELOPE_FIELDS = ['schema', 'attestationBase64', 'signature', 'keyId', 'namespace'];
const RECEIPT_FIELDS = [
  'schema',
  'keyId',
  'namespace',
  'executedAt',
  'runtime',
  'challenge',
  'runRef',
  'contextKeyId',
  'executionContextDigest',
  'contextRef',
  'contextIssuedAt',
  'contextExpiresAt',
  'customerRef',
  'vmRef',
  'bindingRef',
  'bindingVersion',
  'bindingExpiresAt',
  'sessionRef',
  'controlStateBefore',
  'controlStateAfter',
  'controlStateBeforeDigest',
  'controlStateAfterDigest',
  'candidate',
  'action',
  'actionArgsDigest',
  'auditId',
  'auditTimestamp',
  'auditRecordDigest',
];
const CONTROL_STATE_FIELDS = ['active', 'generation', 'killSwitch', 'mode', 'ready', 'takeoverActive'];
const CANDIDATE_FIELDS = [
  'sourceCommit',
  'sourceSha256',
  'sourcePath',
  'sourceOwner',
  'status',
  'appPath',
  'appVersion',
  'appBuild',
  'appBundleId',
  'appName',
  'executable',
  'argv0',
  'owner',
];
const OWNER_FIELDS = [
  'label',
  'classification',
  'bundleId',
  'sourceCommit',
  'programPath',
  'appPath',
  'manifestPath',
  'plistPath',
];
const PATH_FIELDS = ['kind', 'value'];
const ACTION_FIELDS = ['command', 'args'];
const ACTION_ARGS_FIELDS = ['keys', 'dryRun'];
const PUBLIC_ATTESTATION_FIELDS = [
  'schema',
  'keyId',
  'namespace',
  'proofKind',
  'runtime',
  'tool',
  'outcome',
  'runRef',
  'executedAt',
  'authorityIssuedAt',
  'authorityExpiresAt',
  'contextKeyId',
  'controlState',
  'auditRecorded',
  'privateReceiptSha256',
  'connectorCandidate',
];
const PUBLIC_CANDIDATE_FIELDS = ['sourceCommit', 'sourceSha256', 'appVersion', 'appBuild'];
const DEPLOYED_NEGATIVE_PROBE_REQUEST_FIELDS = ['proofMode', 'expectedCandidate'];
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
  const configuredConnectorTimeoutMs = options.connectorTimeoutMs ?? DEFAULT_CONNECTOR_TIMEOUT_MS;
  return async (request, response) => {
    if ((request.method ?? 'GET').toUpperCase() !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendError(response, 405, 'method_not_allowed');
      return true;
    }
    const parsedRequest = await readRuntimeReceiptRequest(request);
    if (!parsedRequest.ok) {
      sendError(response, parsedRequest.status, 'invalid_request');
      return true;
    }
    const authority = verifyAuthority(request.headers, env, now());
    if (!authority.ok) {
      sendError(response, authority.status, authority.code);
      return true;
    }
    if (
      parsedRequest.value.kind === 'deployed-negative-probe' &&
      env.EVAOS_MAC_CONTROL_DEPLOYED_NEGATIVE_PROBE_MODE !== DEPLOYED_NEGATIVE_PROBE_ENV_MODE
    ) {
      sendError(response, 403, 'deployed_negative_probe_disabled');
      return true;
    }
    const receiptVerifier = loadReceiptVerifierConfig(env);
    if (!receiptVerifier.ok) {
      sendError(response, 503, 'receipt_verifier_unavailable');
      return true;
    }
    const deadlineNow = now();
    const remainingAuthorityMs =
      Math.min(authority.value.context.expires_at * 1000, Date.parse(authority.value.bindingExpiresAt)) -
      deadlineNow -
      AUTHORITY_DEADLINE_SAFETY_MS;
    if (remainingAuthorityMs <= 0) {
      sendError(response, 401, 'execution_context_expired');
      return true;
    }
    if (parsedRequest.value.kind === 'deployed-negative-probe') {
      if (!candidateMatchesVerifier(parsedRequest.value.value.expectedCandidate, receiptVerifier.value)) {
        sendError(response, 409, 'deployed_negative_probe_candidate_mismatch');
        return true;
      }
      const proof = createDeployedNegativeProbeProof(
        request.headers,
        authority.value,
        receiptVerifier.value,
        env,
        replayCache,
        deadlineNow
      );
      if (!proof) {
        sendError(response, 500, 'deployed_negative_probe_failed');
        return true;
      }
      sendJson(response, 200, proof);
      return true;
    }
    const publicRequest = parsedRequest.value.value;
    const connectorTimeoutMs = Math.max(1, Math.min(configuredConnectorTimeoutMs, remainingAuthorityMs));
    const claim = claimExecutionContext(replayCache, authority.value.context, now());
    if (!claim.ok) {
      sendError(response, claim.status, claim.code);
      return true;
    }
    const connectorBody = {
      schema: CONNECTOR_REQUEST_SCHEMA,
      challenge: publicRequest.challenge,
      runRef: publicRequest.runRef,
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
    let rawConnectorResponse;
    const controller = new AbortController();
    const connectorTimeout = setTimeout(() => controller.abort(), connectorTimeoutMs);
    try {
      connectorResponse = await fetchImpl(`${authority.value.connectorUrl}/v1/canary/mac-control`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authority.value.connectorToken}`,
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(connectorBody),
        signal: controller.signal,
      });
      if (!connectorResponse.ok) {
        await cancelConnectorResponseBody(connectorResponse);
        sendError(
          response,
          connectorResponse.status >= 400 && connectorResponse.status < 500 ? 409 : 502,
          'connector_rejected_canary'
        );
        return true;
      }
      rawConnectorResponse = await readBoundedConnectorResponse(connectorResponse);
    } catch {
      sendError(response, 502, connectorResponse ? 'connector_response_invalid' : 'connector_unavailable');
      return true;
    } finally {
      clearTimeout(connectorTimeout);
    }
    const sanitized = validateConnectorEnvelope(
      rawConnectorResponse,
      authority.value,
      publicRequest,
      receiptVerifier.value
    );
    if (!sanitized.ok) {
      sendError(response, 502, 'connector_response_invalid');
      return true;
    }
    sendJson(response, 200, sanitized.value);
    return true;
  };
}
async function cancelConnectorResponseBody(response) {
  try {
    await response.body?.cancel?.();
  } catch {
    // Preserve the sanitized connector rejection even if stream cleanup fails.
  }
}
async function readRuntimeReceiptRequest(request) {
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
  if (!isRecord(body)) {
    return { ok: false, status: 400 };
  }
  if (hasExactKeys(body, ['challenge', 'runRef'])) {
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
    return { ok: true, value: { kind: 'receipt', value: { challenge: body.challenge, runRef: body.runRef } } };
  }
  if (!hasExactKeys(body, DEPLOYED_NEGATIVE_PROBE_REQUEST_FIELDS)) {
    return { ok: false, status: 400 };
  }
  const expectedCandidate = body.expectedCandidate;
  if (
    body.proofMode !== DEPLOYED_NEGATIVE_PROBE_MODE ||
    !isRecord(expectedCandidate) ||
    !hasExactKeys(expectedCandidate, PUBLIC_CANDIDATE_FIELDS) ||
    typeof expectedCandidate.sourceCommit !== 'string' ||
    !/^[0-9a-f]{40}$/.test(expectedCandidate.sourceCommit) ||
    typeof expectedCandidate.sourceSha256 !== 'string' ||
    !validSha256(expectedCandidate.sourceSha256) ||
    typeof expectedCandidate.appVersion !== 'string' ||
    !validReleaseValue(expectedCandidate.appVersion) ||
    typeof expectedCandidate.appBuild !== 'string' ||
    !validReleaseValue(expectedCandidate.appBuild)
  ) {
    return { ok: false, status: 400 };
  }
  return {
    ok: true,
    value: {
      kind: 'deployed-negative-probe',
      value: { proofMode: DEPLOYED_NEGATIVE_PROBE_MODE, expectedCandidate: expectedCandidate },
    },
  };
}
function candidateMatchesVerifier(candidate, verifier) {
  return (
    candidate.sourceCommit === verifier.expectedSourceCommit &&
    candidate.sourceSha256 === verifier.expectedSourceSha256 &&
    candidate.appVersion === verifier.expectedAppVersion &&
    candidate.appBuild === verifier.expectedAppBuild
  );
}
function createDeployedNegativeProbeProof(headers, authority, verifier, env, replayCache, nowMs) {
  const forgedSignature = Buffer.alloc(64).toString('base64url');
  const forgedHeaders = {
    ...headers,
    [HEADER.contextSignature]: forgedSignature,
    [canonicalHeaderName(HEADER.contextSignature)]: forgedSignature,
  };
  const forged = verifyAuthority(forgedHeaders, env, nowMs);
  const expired = verifyAuthority(headers, env, authority.context.expires_at * 1000);
  const firstClaim = claimExecutionContext(replayCache, authority.context, nowMs);
  const replay = claimExecutionContext(replayCache, authority.context, nowMs);
  if (
    forged.ok ||
    forged.status !== 401 ||
    forged.code !== 'execution_context_signature_invalid' ||
    expired.ok ||
    expired.status !== 401 ||
    expired.code !== 'execution_context_expired' ||
    !firstClaim.ok ||
    replay.ok ||
    replay.status !== 409 ||
    replay.code !== 'execution_context_replayed'
  ) {
    return undefined;
  }
  return {
    schema: DEPLOYED_NEGATIVE_PROBE_SCHEMA,
    proofMode: DEPLOYED_NEGATIVE_PROBE_MODE,
    candidate: {
      sourceCommit: verifier.expectedSourceCommit,
      sourceSha256: verifier.expectedSourceSha256,
      appVersion: verifier.expectedAppVersion,
      appBuild: verifier.expectedAppBuild,
    },
    classifications: {
      forgedSignature: {
        rejected: true,
        httpStatus: forged.status,
        code: forged.code,
      },
      expiredContext: {
        rejected: true,
        httpStatus: expired.status,
        code: expired.code,
      },
      replay: {
        firstAccepted: true,
        secondRejected: true,
        httpStatus: replay.status,
        code: replay.code,
      },
    },
    connectorActionAttempted: false,
    sensitiveOutputAbsent: true,
  };
}
function verifyAuthority(headers, env, nowMs) {
  const expectedKeyId = env.EVAOS_MAC_CONTROL_CONTEXT_KEY_ID;
  const publicKeyBase64 = env.EVAOS_MAC_CONTROL_CONTEXT_PUBLIC_KEY;
  if (!expectedKeyId || !publicKeyBase64 || !validKeyId(expectedKeyId)) {
    return { ok: false, status: 503, code: 'execution_context_verifier_unavailable' };
  }
  const rawPublicKey = decodeBase64Url(publicKeyBase64);
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
function loadReceiptVerifierConfig(env) {
  const keyId = env.EVAOS_MAC_CONTROL_RECEIPT_KEY_ID;
  const encodedPublicKey = env.EVAOS_MAC_CONTROL_RECEIPT_PUBLIC_KEY;
  const expectedSourceCommit = env.EVAOS_MAC_CONTROL_EXPECTED_SOURCE_COMMIT;
  const expectedSourceSha256 = env.EVAOS_MAC_CONTROL_EXPECTED_SOURCE_SHA256;
  const expectedAppVersion = env.EVAOS_MAC_CONTROL_EXPECTED_APP_VERSION;
  const expectedAppBuild = env.EVAOS_MAC_CONTROL_EXPECTED_APP_BUILD;
  if (
    !keyId ||
    !validKeyId(keyId) ||
    !encodedPublicKey ||
    !expectedSourceCommit ||
    !/^[0-9a-f]{40}$/.test(expectedSourceCommit) ||
    !expectedSourceSha256 ||
    !validSha256(expectedSourceSha256) ||
    !expectedAppVersion ||
    !validReleaseValue(expectedAppVersion) ||
    !expectedAppBuild ||
    !validReleaseValue(expectedAppBuild)
  ) {
    return { ok: false };
  }
  const publicKey = decodeBase64Url(encodedPublicKey);
  if (!publicKey || publicKey.byteLength !== 32) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      keyId,
      publicKey,
      expectedSourceCommit,
      expectedSourceSha256,
      expectedAppVersion,
      expectedAppBuild,
    },
  };
}
function validateConnectorEnvelope(raw, authority, request, verifier) {
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
  const privateReceipt = parsed.privateReceipt;
  const publicAttestation = parsed.publicAttestation;
  if (
    parsed.schema !== CONNECTOR_RESPONSE_SCHEMA ||
    !isRecord(privateReceipt) ||
    !hasExactKeys(privateReceipt, PRIVATE_RECEIPT_ENVELOPE_FIELDS) ||
    !isRecord(publicAttestation) ||
    !hasExactKeys(publicAttestation, PUBLIC_ATTESTATION_ENVELOPE_FIELDS) ||
    privateReceipt.schema !== PRIVATE_RECEIPT_ENVELOPE_SCHEMA ||
    privateReceipt.namespace !== RECEIPT_NAMESPACE ||
    typeof privateReceipt.receiptBase64 !== 'string' ||
    privateReceipt.receiptBase64.length < 32 ||
    privateReceipt.receiptBase64.length > 32768 ||
    typeof privateReceipt.signature !== 'string' ||
    privateReceipt.signature.length > 8192 ||
    privateReceipt.keyId !== verifier.keyId
  ) {
    return { ok: false };
  }
  const receiptBytes = decodeBase64Url(privateReceipt.receiptBase64);
  if (!receiptBytes || receiptBytes.byteLength > 24576 || !validSshSignature(privateReceipt.signature)) {
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
  if (!verifySshSignature(receiptBytes, privateReceipt.signature, verifier.publicKey, RECEIPT_NAMESPACE)) {
    return { ok: false };
  }
  const expectedAttestation = validateReceipt(receiptBytes, authority, request, verifier);
  if (!expectedAttestation.ok) {
    return { ok: false };
  }
  return validatePublicAttestationEnvelope(publicAttestation, expectedAttestation.value, authority, verifier);
}
async function readBoundedConnectorResponse(response) {
  if (response.body) {
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(typeof chunk === 'string' ? chunk : chunk);
      total += buffer.byteLength;
      if (total > MAX_CONNECTOR_RESPONSE_BYTES) {
        throw new Error('connector response exceeds the bounded receipt envelope size');
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const raw = await response.text();
  if (Buffer.from(raw).byteLength > MAX_CONNECTOR_RESPONSE_BYTES) {
    throw new Error('connector response exceeds the bounded receipt envelope size');
  }
  return raw;
}
function validateReceipt(receiptBytes, authority, request, verifier) {
  let parsed;
  try {
    parsed = JSON.parse(receiptBytes.toString('utf8'));
  } catch {
    return { ok: false };
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, RECEIPT_FIELDS)) {
    return { ok: false };
  }
  const canonical = canonicalJson(parsed);
  if (!canonical || !timingSafeBufferEqual(Buffer.from(receiptBytes), Buffer.from(canonical, 'utf8'))) {
    return { ok: false };
  }
  const contextPayload = decodeBase64Url(authority.contextPayload);
  const before = parsed.controlStateBefore;
  const after = parsed.controlStateAfter;
  const candidate = parsed.candidate;
  const action = parsed.action;
  if (
    !contextPayload ||
    parsed.schema !== RECEIPT_SCHEMA ||
    parsed.keyId !== verifier.keyId ||
    parsed.namespace !== RECEIPT_NAMESPACE ||
    parsed.runtime !== 'openclaw' ||
    parsed.challenge !== request.challenge ||
    parsed.runRef !== request.runRef ||
    parsed.contextKeyId !== authority.contextKeyId ||
    parsed.contextIssuedAt !== authority.context.issued_at ||
    parsed.contextExpiresAt !== authority.context.expires_at ||
    parsed.bindingVersion !== authority.context.binding_version ||
    parsed.bindingExpiresAt !== authority.bindingExpiresAt ||
    parsed.executionContextDigest !== saltedHash(request.challenge, contextPayload) ||
    parsed.contextRef !== saltedHash(request.challenge, authority.context.context_id) ||
    parsed.customerRef !== saltedHash(request.challenge, authority.context.customer_id) ||
    parsed.vmRef !== saltedHash(request.challenge, authority.context.customer_vm_id) ||
    parsed.bindingRef !== saltedHash(request.challenge, authority.context.binding_id) ||
    !isRecord(before) ||
    !isRecord(after) ||
    !validControlState(before) ||
    !validControlState(after) ||
    canonicalJson(before) !== canonicalJson(after) ||
    parsed.sessionRef !==
      saltedHash(request.challenge, `${authority.context.binding_id}\0${String(before.generation)}`) ||
    parsed.controlStateBeforeDigest !== sha256Hex(canonicalJsonBytes(before)) ||
    parsed.controlStateAfterDigest !== sha256Hex(canonicalJsonBytes(after)) ||
    !validCandidate(candidate, verifier) ||
    !validReceiptAction(action) ||
    parsed.actionArgsDigest !== sha256Hex(canonicalJsonBytes(action.args)) ||
    typeof parsed.auditId !== 'string' ||
    !/^audit-[0-9A-Za-z_-]{8,128}$/.test(parsed.auditId) ||
    typeof parsed.auditRecordDigest !== 'string' ||
    !validSha256(parsed.auditRecordDigest)
  ) {
    return { ok: false };
  }
  const executedAt = parseUtcTimestamp(parsed.executedAt);
  const auditTimestamp = parseUtcTimestamp(parsed.auditTimestamp);
  const bindingExpiresAt = parseUtcTimestamp(parsed.bindingExpiresAt);
  if (
    executedAt === undefined ||
    auditTimestamp === undefined ||
    bindingExpiresAt === undefined ||
    executedAt < (authority.context.issued_at - CLOCK_SKEW_SECONDS) * 1000 ||
    executedAt > authority.context.expires_at * 1000 ||
    auditTimestamp < (authority.context.issued_at - CLOCK_SKEW_SECONDS) * 1000 ||
    auditTimestamp > executedAt + CLOCK_SKEW_SECONDS * 1000 ||
    authority.context.expires_at * 1000 > bindingExpiresAt
  ) {
    return { ok: false };
  }
  const typedCandidate = candidate;
  return {
    ok: true,
    value: {
      schema: PUBLIC_ATTESTATION_SCHEMA,
      keyId: verifier.keyId,
      namespace: PUBLIC_ATTESTATION_NAMESPACE,
      proofKind: PUBLIC_PROOF_KIND,
      runtime: 'openclaw',
      tool: 'customer_mac.desktop_hotkey',
      outcome: 'succeeded',
      runRef: request.runRef,
      executedAt: parsed.executedAt,
      authorityIssuedAt: authority.context.issued_at,
      authorityExpiresAt: authority.context.expires_at,
      contextKeyId: authority.contextKeyId,
      controlState: 'ready_unchanged',
      auditRecorded: true,
      privateReceiptSha256: sha256Hex(receiptBytes),
      connectorCandidate: {
        sourceCommit: typedCandidate.sourceCommit,
        sourceSha256: typedCandidate.sourceSha256,
        appVersion: typedCandidate.appVersion,
        appBuild: typedCandidate.appBuild,
      },
    },
  };
}
function validatePublicAttestationEnvelope(value, expected, authority, verifier) {
  if (
    value.schema !== PUBLIC_ATTESTATION_ENVELOPE_SCHEMA ||
    value.namespace !== PUBLIC_ATTESTATION_NAMESPACE ||
    value.keyId !== verifier.keyId ||
    typeof value.attestationBase64 !== 'string' ||
    value.attestationBase64.length < 32 ||
    value.attestationBase64.length > 24576 ||
    typeof value.signature !== 'string' ||
    value.signature.length > 8192 ||
    !validSshSignature(value.signature)
  ) {
    return { ok: false };
  }
  const attestationBytes = decodeBase64Url(value.attestationBase64);
  if (!attestationBytes || attestationBytes.byteLength > 16384) {
    return { ok: false };
  }
  const attestationText = attestationBytes.toString('utf8');
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
    forbiddenValues.some((forbidden) => forbidden.length > 0 && attestationText.includes(forbidden)) ||
    /https?:\/\//i.test(attestationText) ||
    /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}\b/.test(attestationText) ||
    /(?:\/tmp\/|\/private\/var\/folders\/)/i.test(attestationText) ||
    /"(?:challenge|token|secret|authorization|connector_url|customer_id|customer_vm_id|binding_id|bindingRef|sessionRef|auditRef)"\s*:/i.test(
      attestationText
    )
  ) {
    return { ok: false };
  }
  let attestation;
  try {
    attestation = JSON.parse(attestationText);
  } catch {
    return { ok: false };
  }
  if (
    !isRecord(attestation) ||
    !hasExactKeys(attestation, PUBLIC_ATTESTATION_FIELDS) ||
    !isRecord(attestation.connectorCandidate) ||
    !hasExactKeys(attestation.connectorCandidate, PUBLIC_CANDIDATE_FIELDS) ||
    canonicalJson(attestation) !== attestationText ||
    canonicalJson(attestation) !== canonicalJson(expected) ||
    !verifySshSignature(attestationBytes, value.signature, verifier.publicKey, PUBLIC_ATTESTATION_NAMESPACE)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      schema: PUBLIC_ATTESTATION_ENVELOPE_SCHEMA,
      attestationBase64: value.attestationBase64,
      signature: value.signature,
      keyId: verifier.keyId,
      namespace: PUBLIC_ATTESTATION_NAMESPACE,
    },
  };
}
function validControlState(value) {
  return (
    hasExactKeys(value, CONTROL_STATE_FIELDS) &&
    value.active === true &&
    Number.isInteger(value.generation) &&
    value.generation >= 0 &&
    value.killSwitch === false &&
    value.mode === 'full_access' &&
    value.ready === true &&
    value.takeoverActive === false
  );
}
function validCandidate(value, verifier) {
  if (!isRecord(value) || !hasExactKeys(value, CANDIDATE_FIELDS)) {
    return false;
  }
  const owner = value.owner;
  if (!isRecord(owner) || !hasExactKeys(owner, OWNER_FIELDS)) {
    return false;
  }
  return (
    value.sourceCommit === verifier.expectedSourceCommit &&
    value.sourceSha256 === verifier.expectedSourceSha256 &&
    value.sourcePath === 'packages/mac-connector-core' &&
    value.sourceOwner === '100yenadmin/evaOS-GUI' &&
    value.status === 'canonical' &&
    value.appPath === '/Applications/evaOS Workbench.app' &&
    value.appVersion === verifier.expectedAppVersion &&
    value.appBuild === verifier.expectedAppBuild &&
    value.appBundleId === 'com.evaos.workbench' &&
    value.appName === 'evaOS Workbench' &&
    typeof value.executable === 'string' &&
    /^\/Applications\/evaOS Workbench\.app\/Contents\/Resources\/Bridge\/python\/bin\/python3(?:\.12)?$/.test(
      value.executable
    ) &&
    value.argv0 ===
      '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/src/evaos_desktop_bridge/host/cli.py' &&
    owner.label === 'com.electricsheep.evaos-desktop-bridge' &&
    owner.classification === 'workbench_bundle' &&
    owner.bundleId === 'com.evaos.workbench' &&
    owner.sourceCommit === verifier.expectedSourceCommit &&
    validPathClaim(
      owner.programPath,
      '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/src/evaos_desktop_bridge/host/cli.py'
    ) &&
    validPathClaim(owner.appPath, '/Applications/evaOS Workbench.app') &&
    validPathClaim(owner.manifestPath, '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/manifest.json') &&
    isRecord(owner.plistPath) &&
    hasExactKeys(owner.plistPath, PATH_FIELDS) &&
    owner.plistPath.kind === 'path' &&
    typeof owner.plistPath.value === 'string' &&
    owner.plistPath.value.endsWith('/Library/LaunchAgents/com.electricsheep.evaos-desktop-bridge.plist')
  );
}
function validPathClaim(value, expected) {
  return isRecord(value) && hasExactKeys(value, PATH_FIELDS) && value.kind === 'path' && value.value === expected;
}
function validReceiptAction(value) {
  return (
    isRecord(value) &&
    hasExactKeys(value, ACTION_FIELDS) &&
    value.command === 'customer_mac.desktop_hotkey' &&
    isRecord(value.args) &&
    hasExactKeys(value.args, ACTION_ARGS_FIELDS) &&
    value.args.keys === 'escape' &&
    value.args.dryRun === false
  );
}
function verifySshSignature(message, armor, pinnedPublicKey, expectedNamespace) {
  const decoded = decodeSshSignatureArmor(armor);
  if (!decoded) {
    return false;
  }
  try {
    const reader = sshReader(decoded);
    if (reader.readRaw(6).toString('ascii') !== 'SSHSIG' || reader.readUInt32() !== 1) {
      return false;
    }
    const publicKeyBlob = reader.readString();
    const namespace = reader.readString().toString('utf8');
    const reserved = reader.readString();
    const hashAlgorithm = reader.readString().toString('ascii');
    const signatureBlob = reader.readString();
    if (!reader.done() || namespace !== expectedNamespace || reserved.byteLength !== 0) {
      return false;
    }
    const publicKeyReader = sshReader(publicKeyBlob);
    const publicKeyAlgorithm = publicKeyReader.readString().toString('ascii');
    const embeddedPublicKey = publicKeyReader.readString();
    const signatureReader = sshReader(signatureBlob);
    const signatureAlgorithm = signatureReader.readString().toString('ascii');
    const signature = signatureReader.readString();
    if (
      !publicKeyReader.done() ||
      !signatureReader.done() ||
      publicKeyAlgorithm !== 'ssh-ed25519' ||
      signatureAlgorithm !== 'ssh-ed25519' ||
      embeddedPublicKey.byteLength !== 32 ||
      signature.byteLength !== 64 ||
      !timingSafeBufferEqual(embeddedPublicKey, Buffer.from(pinnedPublicKey)) ||
      (hashAlgorithm !== 'sha256' && hashAlgorithm !== 'sha512')
    ) {
      return false;
    }
    const digest = createHash(hashAlgorithm).update(Buffer.from(message)).digest();
    const signedData = Buffer.concat([
      Buffer.from('SSHSIG', 'ascii'),
      encodeSshString(Buffer.from(namespace, 'utf8')),
      encodeSshString(Buffer.alloc(0)),
      encodeSshString(Buffer.from(hashAlgorithm, 'ascii')),
      encodeSshString(digest),
    ]);
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const publicKey = createPublicKey({
      key: Buffer.concat([spkiPrefix, embeddedPublicKey]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, signedData, publicKey, signature);
  } catch {
    return false;
  }
}
function decodeSshSignatureArmor(value) {
  const match = /^-----BEGIN SSH SIGNATURE-----\n([A-Za-z0-9+/=\n]+)-----END SSH SIGNATURE-----\n?$/.exec(value);
  if (!match) {
    return undefined;
  }
  const lines = match[1].split('\n').filter((line) => line.length > 0);
  if (lines.length === 0 || lines.some((line) => line.length > 76 || !/^[A-Za-z0-9+/=]+$/.test(line))) {
    return undefined;
  }
  const decoded = decodeCanonicalBase64(lines.join(''));
  return decoded ? Buffer.from(decoded) : undefined;
}
function sshReader(value) {
  const buffer = Buffer.from(value);
  let offset = 0;
  return {
    readRaw(length) {
      if (!Number.isInteger(length) || length < 0 || offset + length > buffer.byteLength) {
        throw new Error('invalid SSH signature field');
      }
      const result = buffer.subarray(offset, offset + length);
      offset += length;
      return result;
    },
    readUInt32() {
      if (offset + 4 > buffer.byteLength) {
        throw new Error('invalid SSH signature integer');
      }
      const result = buffer.readUInt32BE(offset);
      offset += 4;
      return result;
    },
    readString() {
      const length = this.readUInt32();
      if (length > MAX_CONNECTOR_RESPONSE_BYTES) {
        throw new Error('oversized SSH signature field');
      }
      return this.readRaw(length);
    },
    done() {
      return offset === buffer.byteLength;
    },
  };
}
function encodeUInt32(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32BE(value, 0);
  return output;
}
function encodeSshString(value) {
  const buffer = Buffer.from(value);
  return Buffer.concat([encodeUInt32(buffer.byteLength), buffer]);
}
function timingSafeBufferEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer);
}
function canonicalJson(value) {
  try {
    return JSON.stringify(sortJson(value));
  } catch {
    return undefined;
  }
}
function canonicalJsonBytes(value) {
  const encoded = canonicalJson(value);
  if (encoded === undefined) {
    throw new Error('value is not canonical JSON');
  }
  return Buffer.from(encoded, 'utf8');
}
function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])])
  );
}
function sha256Hex(value) {
  return createHash('sha256').update(Buffer.from(value)).digest('hex');
}
function saltedHash(challenge, value) {
  return sha256Hex(
    Buffer.concat([
      Buffer.from(challenge, 'ascii'),
      Buffer.from([0]),
      typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value),
    ])
  );
}
function parseUtcTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function validSha256(value) {
  return /^[0-9a-f]{64}$/.test(value);
}
function validReleaseValue(value) {
  return /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(value);
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
  const expected = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function claimExecutionContext(cache, context, nowMs) {
  pruneReplayCache(cache, nowMs);
  if (cache.has(context.context_id)) {
    return { ok: false, status: 409, code: 'execution_context_replayed' };
  }
  cache.set(context.context_id, context.expires_at * 1000);
  return { ok: true };
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
