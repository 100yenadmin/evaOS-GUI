import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';

import { createMacControlRuntimeReceiptHandler } from '../dist/src/runtimeReceipt.js';

const [outputPath, sourceHeadSha, sourceRunId] = process.argv.slice(2);
if (!outputPath || !/^[0-9a-f]{40}$/i.test(sourceHeadSha || '') || !/^\d+$/.test(sourceRunId || '')) {
  throw new Error('Runtime-receipt negative proof requires output path and exact GitHub source provenance.');
}

const nowMs = Date.now();
const nowSeconds = Math.floor(nowMs / 1000);
const contextKeyId = 'runtime-receipt-negative-context';
const receiptKeyId = 'runtime-receipt-negative-receipt';
const connectorToken = 'negative-proof-connector-token-value';
const customerId = 'negative-proof-customer';
const customerVmId = 'negative-proof-vm';
const bindingId = 'negative-proof-binding';
const bindingVersion = '7';
const connectorUrl = 'http://100.64.10.12:8765';
const { privateKey: contextPrivateKey, publicKey: contextPublicKey } = generateKeyPairSync('ed25519');
const { publicKey: receiptPublicKey } = generateKeyPairSync('ed25519');
const rawContextPublicKey = contextPublicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const rawReceiptPublicKey = receiptPublicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const verifierEnv = {
  EVAOS_MAC_CONTROL_CONTEXT_KEY_ID: contextKeyId,
  EVAOS_MAC_CONTROL_CONTEXT_PUBLIC_KEY: rawContextPublicKey.toString('base64url'),
  EVAOS_MAC_CONTROL_RECEIPT_KEY_ID: receiptKeyId,
  EVAOS_MAC_CONTROL_RECEIPT_PUBLIC_KEY: rawReceiptPublicKey.toString('base64url'),
  EVAOS_MAC_CONTROL_EXPECTED_SOURCE_COMMIT: sourceHeadSha.toLowerCase(),
  EVAOS_MAC_CONTROL_EXPECTED_SOURCE_SHA256: 'b'.repeat(64),
  EVAOS_MAC_CONTROL_EXPECTED_APP_VERSION: '2.1.36',
  EVAOS_MAC_CONTROL_EXPECTED_APP_BUILD: '2.1.36',
};

const assertions = {
  forgedContextRejected: await proveForgedContextRejected(),
  expiredContextRejected: await proveExpiredContextRejected(),
  replayRejected: await proveReplayRejected(),
  authorityRedacted: await proveAuthorityRedacted(),
};
assert.deepEqual(assertions, {
  forgedContextRejected: true,
  expiredContextRejected: true,
  replayRejected: true,
  authorityRedacted: true,
});

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      schema: 'evaos.mac_control.runtime_receipt_negative_proof.v1',
      sourceHeadSha: sourceHeadSha.toLowerCase(),
      sourceRunId,
      assertions,
    },
    null,
    2
  )}\n`,
  { encoding: 'utf8', mode: 0o600, flag: 'wx' }
);

async function proveForgedContextRejected() {
  let connectorCalls = 0;
  const authority = signedAuthority({ contextIdByte: 1 });
  authority.headers['x-evaos-mac-control-execution-context-signature'] = Buffer.alloc(64, 9).toString('base64url');
  const handler = createMacControlRuntimeReceiptHandler({
    env: verifierEnv,
    now: () => nowMs,
    fetchImpl: async () => {
      connectorCalls += 1;
      return fetchResponse(500, {});
    },
  });
  const response = await invoke(handler, requestBody(1), authority.headers);
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).error.code, 'execution_context_signature_invalid');
  assert.equal(connectorCalls, 0);
  assertAuthorityRedacted(response.body, authority);
  return true;
}

async function proveExpiredContextRejected() {
  let connectorCalls = 0;
  const authority = signedAuthority({
    issuedAt: nowSeconds - 70,
    expiresAt: nowSeconds - 10,
    contextIdByte: 2,
  });
  const handler = createMacControlRuntimeReceiptHandler({
    env: verifierEnv,
    now: () => nowMs,
    fetchImpl: async () => {
      connectorCalls += 1;
      return fetchResponse(500, {});
    },
  });
  const response = await invoke(handler, requestBody(2), authority.headers);
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).error.code, 'execution_context_expired');
  assert.equal(connectorCalls, 0);
  assertAuthorityRedacted(response.body, authority);
  return true;
}

async function proveReplayRejected() {
  let connectorCalls = 0;
  const authority = signedAuthority({ contextIdByte: 3 });
  const handler = createMacControlRuntimeReceiptHandler({
    env: verifierEnv,
    now: () => nowMs,
    fetchImpl: async () => {
      connectorCalls += 1;
      return fetchResponse(503, {});
    },
  });
  const body = requestBody(3);
  const first = await invoke(handler, body, authority.headers);
  const replay = await invoke(handler, body, authority.headers);
  assert.equal(first.statusCode, 502);
  assert.equal(JSON.parse(first.body).error.code, 'connector_rejected_canary');
  assert.equal(replay.statusCode, 409);
  assert.equal(JSON.parse(replay.body).error.code, 'execution_context_replayed');
  assert.equal(connectorCalls, 1);
  assertAuthorityRedacted(first.body, authority);
  assertAuthorityRedacted(replay.body, authority);
  return true;
}

async function proveAuthorityRedacted() {
  const authority = signedAuthority({ contextIdByte: 4 });
  const leakingReceipt = Buffer.from(
    JSON.stringify({
      schema: 'evaos.mac_control.runtime_receipt.v1',
      customer_id: customerId,
      connector_token: connectorToken,
    })
  );
  const handler = createMacControlRuntimeReceiptHandler({
    env: verifierEnv,
    now: () => nowMs,
    fetchImpl: async () =>
      fetchResponse(200, {
        schema: 'evaos.mac_control.runtime_receipt_bundle.v2',
        privateReceipt: {
          schema: 'evaos.mac_control.runtime_receipt_envelope.v1',
          receiptBase64: leakingReceipt.toString('base64url'),
          signature: '-----BEGIN SSH SIGNATURE-----\nQUFBQQ==\n-----END SSH SIGNATURE-----\n',
          keyId: receiptKeyId,
          namespace: 'evaos-mac-control-receipt-v1',
        },
        publicAttestation: {
          schema: 'evaos.mac_control.public_runtime_attestation_envelope.v1',
          attestationBase64: Buffer.from('{}').toString('base64url'),
          signature: '-----BEGIN SSH SIGNATURE-----\nQUFBQQ==\n-----END SSH SIGNATURE-----\n',
          keyId: receiptKeyId,
          namespace: 'evaos-mac-control-public-attestation-v1',
        },
      }),
  });
  const response = await invoke(handler, requestBody(4), authority.headers);
  assert.equal(response.statusCode, 502);
  assert.equal(JSON.parse(response.body).error.code, 'connector_response_invalid');
  assertAuthorityRedacted(response.body, authority);
  return true;
}

function signedAuthority({ issuedAt = nowSeconds, expiresAt = nowSeconds + 50, contextIdByte }) {
  const context = {
    schema_version: 'evaos.mac_control_execution_context.v1',
    key_id: contextKeyId,
    runtime: 'openclaw',
    customer_id: customerId,
    customer_vm_id: customerVmId,
    binding_id: bindingId,
    binding_version: bindingVersion,
    issued_at: issuedAt,
    expires_at: expiresAt,
    context_id: Buffer.alloc(16, contextIdByte).toString('base64url'),
  };
  const payloadBytes = Buffer.from(JSON.stringify(context));
  const payload = payloadBytes.toString('base64url');
  const signature = sign(null, payloadBytes, contextPrivateKey).toString('base64url');
  return {
    payload,
    signature,
    headers: {
      'x-evaos-mac-control-execution-context': payload,
      'x-evaos-mac-control-execution-context-signature': signature,
      'x-evaos-mac-control-execution-context-key-id': contextKeyId,
      'x-evaos-mac-control-contract': 'evaos.mac_control_runtime_contract.v2',
      'x-evaos-mac-control-customer': customerId,
      'x-evaos-mac-control-grant-state': 'active',
      'x-evaos-desktop-bridge-url': connectorUrl,
      'x-evaos-desktop-bridge-token': connectorToken,
      'x-evaos-desktop-bridge-token-last4': connectorToken.slice(-4),
      'x-evaos-mac-control-binding-id': bindingId,
      'x-evaos-mac-control-binding-version': bindingVersion,
      'x-evaos-mac-control-binding-expires-at': new Date(nowMs + 120_000).toISOString(),
    },
  };
}

function requestBody(fill) {
  return {
    challenge: Buffer.alloc(32, fill).toString('base64url'),
    runRef: `gha:${sourceRunId}:${Buffer.alloc(12, fill).toString('hex')}`,
  };
}

function assertAuthorityRedacted(body, authority) {
  for (const forbidden of [
    connectorToken,
    connectorUrl,
    customerId,
    customerVmId,
    bindingId,
    authority.payload,
    authority.signature,
  ]) {
    assert.equal(body.includes(forbidden), false);
  }
}

async function invoke(handler, body, headers) {
  const request = Readable.from([JSON.stringify(body)]);
  request.method = 'POST';
  request.headers = headers;
  const response = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value = '') {
      this.body = value;
    },
  };
  await handler(request, response);
  return response;
}

function fetchResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}
