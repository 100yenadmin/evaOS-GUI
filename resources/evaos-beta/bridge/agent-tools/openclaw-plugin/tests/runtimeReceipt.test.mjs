import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runBridge } from '../dist/src/bridge.js';
import {
  MAC_CONTROL_RUNTIME_RECEIPT_PATH,
  createMacControlRuntimeReceiptHandler,
  registerMacControlRuntimeReceiptRoute,
} from '../dist/src/runtimeReceipt.js';

const NOW_MS = Date.parse('2026-07-15T00:00:00Z');
const KEY_ID = 'mac-context-test-2026-07';
const CONNECTOR_TOKEN = 'connector-token-value-at-least-24';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const env = {
  EVAOS_MAC_CONTROL_EXECUTION_CONTEXT_KEY_ID: KEY_ID,
  EVAOS_MAC_CONTROL_EXECUTION_CONTEXT_PUBLIC_KEY_B64: rawPublicKey.toString('base64'),
};

test('registers one exact gateway-authenticated runtime receipt route', () => {
  const routes = [];
  registerMacControlRuntimeReceiptRoute({ registerHttpRoute: (route) => routes.push(route) });
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, MAC_CONTROL_RUNTIME_RECEIPT_PATH);
  assert.equal(routes[0].auth, 'gateway');
  assert.equal(routes[0].match, 'exact');
});

test('does not expose or execute the removed legacy pairing-code surface', async () => {
  const packageManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const pluginManifest = JSON.parse(readFileSync(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'));
  assert.equal(packageManifest.openclaw.contracts.tools.includes('customer_mac_complete_pairing'), false);
  assert.equal(pluginManifest.contracts.tools.includes('customer_mac_complete_pairing'), false);

  const openClawResult = await runBridge('customerMacCompletePairing', {
    enrollment_code: 'must-not-be-used',
  });
  assert.equal(openClawResult.ok, false);
  assert.equal(openClawResult.errors[0].code, 'legacy_pairing_removed');

  const hermes = spawnSync(
    fileURLToPath(new URL('../../hermes-adapter/bin/evaos-desktop-bridge-command', import.meta.url)),
    ['completeEnrollment', '{"enrollment_code":"must-not-be-used"}'],
    { encoding: 'utf8', env: { PATH: process.env.PATH } }
  );
  assert.equal(hermes.status, 0);
  assert.equal(JSON.parse(hermes.stdout).errors[0].code, 'legacy_pairing_removed');
});

test('verifies server authority and forwards only the fixed connector canary contract', async () => {
  const challenge = Buffer.alloc(32, 7).toString('base64url');
  const runRef = 'rc-2.1.36-arm64';
  const authority = signedAuthority();
  const receipt = Buffer.from(
    JSON.stringify({
      schema: 'evaos.mac_control.runtime_receipt.v1',
      challenge,
      run_ref: runRef,
      binding_ref: 'sha256:binding-proof',
      customer_ref: 'sha256:customer-proof',
    })
  ).toString('base64url');
  const connectorEnvelope = {
    schema: 'evaos.mac_control.runtime_receipt_envelope.v1',
    receiptBase64: receipt,
    signature: '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n',
    keyId: 'connector-receipt-test-2026-07',
    namespace: 'evaos-mac-control-receipt-v1',
  };
  let connectorCalls = 0;
  const handler = createMacControlRuntimeReceiptHandler({
    env,
    now: () => NOW_MS,
    fetchImpl: async (url, init) => {
      connectorCalls += 1;
      assert.equal(url, 'http://100.64.10.12:8765/v1/canary/mac-control');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, `Bearer ${CONNECTOR_TOKEN}`);
      const body = JSON.parse(init.body);
      assert.deepEqual(body, {
        schema: 'evaos.mac_control.canary_request.v1',
        challenge,
        runRef,
        executionContext: {
          payload: authority.payload,
          signature: authority.signature,
          keyId: KEY_ID,
        },
        binding: {
          bindingId: 'binding-1',
          bindingVersion: '7',
          bindingExpiresAt: '2026-07-15T00:02:00.000Z',
        },
      });
      assert.equal('action' in body, false);
      assert.equal(init.body.includes(CONNECTOR_TOKEN), false);
      return fetchResponse(200, connectorEnvelope);
    },
  });
  const response = await invoke(handler, { challenge, runRef }, authority.headers);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), connectorEnvelope);
  assert.equal(response.body.includes(CONNECTOR_TOKEN), false);
  assert.equal(response.body.includes('customer-1'), false);
  assert.equal(connectorCalls, 1);
});

test('rejects methods and caller-supplied authority or action fields before connector access', async () => {
  let connectorCalls = 0;
  const handler = createMacControlRuntimeReceiptHandler({
    env,
    now: () => NOW_MS,
    fetchImpl: async () => {
      connectorCalls += 1;
      return fetchResponse(500, {});
    },
  });
  const authority = signedAuthority();
  const getResponse = await invoke(handler, {}, authority.headers, 'GET');
  assert.equal(getResponse.statusCode, 405);

  const injected = await invoke(
    handler,
    {
      challenge: Buffer.alloc(32, 1).toString('base64url'),
      runRef: 'run-1',
      action: 'customer_mac.desktop_type',
    },
    authority.headers
  );
  assert.equal(injected.statusCode, 400);
  assert.equal(connectorCalls, 0);
});

test('fails closed for missing, forged, unknown, malformed, expired, and cross-binding contexts', async (t) => {
  const challenge = Buffer.alloc(32, 2).toString('base64url');
  const cases = [
    ['missing', () => ({ ...signedAuthority().headers, 'x-evaos-mac-control-execution-context': undefined })],
    [
      'forged',
      () => ({
        ...signedAuthority().headers,
        'x-evaos-mac-control-execution-context-signature': Buffer.alloc(64, 9).toString('base64url'),
      }),
    ],
    [
      'unknown key',
      () => signedAuthority().headers,
      { ...env, EVAOS_MAC_CONTROL_EXECUTION_CONTEXT_KEY_ID: 'unknown-key' },
    ],
    ['malformed', () => signedAuthority({ extra: 'not-allowed' }).headers],
    [
      'expired',
      () =>
        signedAuthority({ issued_at: Math.floor(NOW_MS / 1000) - 70, expires_at: Math.floor(NOW_MS / 1000) - 10 })
          .headers,
    ],
    ['cross binding', () => ({ ...signedAuthority().headers, 'x-evaos-mac-control-binding-id': 'binding-2' })],
  ];

  for (const [name, makeHeaders, caseEnv = env] of cases) {
    await t.test(name, async () => {
      let connectorCalls = 0;
      const handler = createMacControlRuntimeReceiptHandler({
        env: caseEnv,
        now: () => NOW_MS,
        fetchImpl: async () => {
          connectorCalls += 1;
          return fetchResponse(500, {});
        },
      });
      const response = await invoke(handler, { challenge, runRef: `run-${name.replaceAll(' ', '-')}` }, makeHeaders());
      assert.notEqual(response.statusCode, 200);
      assert.equal(connectorCalls, 0);
      assert.equal(response.body.includes(CONNECTOR_TOKEN), false);
    });
  }
});

test('burns a verified execution context before connector IO and rejects replay', async () => {
  const authority = signedAuthority();
  let connectorCalls = 0;
  const envelope = {
    schema: 'evaos.mac_control.runtime_receipt_envelope.v1',
    receiptBase64: Buffer.from('{"schema":"evaos.mac_control.runtime_receipt.v1","binding_ref":"sha256:ok"}').toString(
      'base64url'
    ),
    signature: '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n',
    keyId: 'connector-receipt-test-2026-07',
    namespace: 'evaos-mac-control-receipt-v1',
  };
  const handler = createMacControlRuntimeReceiptHandler({
    env,
    now: () => NOW_MS,
    fetchImpl: async () => {
      connectorCalls += 1;
      return fetchResponse(200, envelope);
    },
  });
  const body = { challenge: Buffer.alloc(32, 3).toString('base64url'), runRef: 'replay-proof' };
  assert.equal((await invoke(handler, body, authority.headers)).statusCode, 200);
  const replay = await invoke(handler, body, authority.headers);
  assert.equal(replay.statusCode, 409);
  assert.equal(JSON.parse(replay.body).error.code, 'execution_context_replayed');
  assert.equal(connectorCalls, 1);
});

test('rejects a connector receipt that contains raw authority without reflecting it', async () => {
  const authority = signedAuthority();
  const leakingReceipt = Buffer.from(
    JSON.stringify({ schema: 'evaos.mac_control.runtime_receipt.v1', customer_id: 'customer-1' })
  ).toString('base64url');
  const handler = createMacControlRuntimeReceiptHandler({
    env,
    now: () => NOW_MS,
    fetchImpl: async () =>
      fetchResponse(200, {
        schema: 'evaos.mac_control.runtime_receipt_envelope.v1',
        receiptBase64: leakingReceipt,
        signature: '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n',
        keyId: 'connector-receipt-test-2026-07',
        namespace: 'evaos-mac-control-receipt-v1',
      }),
  });
  const response = await invoke(
    handler,
    { challenge: Buffer.alloc(32, 4).toString('base64url'), runRef: 'secret-scan' },
    authority.headers
  );
  assert.equal(response.statusCode, 502);
  assert.equal(response.body.includes('customer-1'), false);
  assert.equal(response.body.includes(CONNECTOR_TOKEN), false);
});

function signedAuthority(overrides = {}) {
  const now = Math.floor(NOW_MS / 1000);
  const context = {
    schema_version: 'evaos.mac_control_execution_context.v1',
    key_id: KEY_ID,
    runtime: 'openclaw',
    customer_id: 'customer-1',
    customer_vm_id: '82000000-0000-4000-8000-000000000001',
    binding_id: 'binding-1',
    binding_version: '7',
    issued_at: now,
    expires_at: now + 50,
    context_id: Buffer.alloc(16, 5).toString('base64url'),
    ...overrides,
  };
  const payloadBytes = Buffer.from(JSON.stringify(context));
  const payload = payloadBytes.toString('base64url');
  const signature = sign(null, payloadBytes, privateKey).toString('base64url');
  return {
    payload,
    signature,
    headers: {
      'x-evaos-mac-control-execution-context': payload,
      'x-evaos-mac-control-execution-context-signature': signature,
      'x-evaos-mac-control-execution-context-key-id': KEY_ID,
      'x-evaos-mac-control-contract': 'evaos.mac_control_runtime_contract.v2',
      'x-evaos-mac-control-customer': 'customer-1',
      'x-evaos-mac-control-grant-state': 'active',
      'x-evaos-desktop-bridge-url': 'http://100.64.10.12:8765',
      'x-evaos-desktop-bridge-token': CONNECTOR_TOKEN,
      'x-evaos-desktop-bridge-token-last4': CONNECTOR_TOKEN.slice(-4),
      'x-evaos-mac-control-binding-id': 'binding-1',
      'x-evaos-mac-control-binding-version': '7',
      'x-evaos-mac-control-binding-expires-at': '2026-07-15T00:02:00.000Z',
    },
  };
}

async function invoke(handler, body, headers, method = 'POST') {
  const request = Readable.from([JSON.stringify(body)]);
  request.method = method;
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
