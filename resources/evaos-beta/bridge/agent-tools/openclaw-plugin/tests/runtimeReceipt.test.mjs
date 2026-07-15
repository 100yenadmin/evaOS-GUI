import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { runBridge } from '../dist/src/bridge.js';
import {
  MAC_CONTROL_RUNTIME_RECEIPT_PATH,
  createMacControlRuntimeReceiptHandler,
  registerMacControlRuntimeReceiptRoute,
} from '../dist/src/runtimeReceipt.js';

const NOW_MS = Date.parse('2026-07-15T00:00:00Z');
const execFileAsync = promisify(execFile);
const KEY_ID = 'mac-context-test-2026-07';
const RECEIPT_KEY_ID = 'connector-receipt-test-2026-07';
const RECEIPT_NAMESPACE = 'evaos-mac-control-receipt-v1';
const PUBLIC_ATTESTATION_NAMESPACE = 'evaos-mac-control-public-attestation-v1';
const CONNECTOR_TOKEN = 'connector-token-value-at-least-24';
const EXPECTED_COMMIT = 'a'.repeat(40);
const EXPECTED_SOURCE_SHA256 = 'b'.repeat(64);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const { privateKey: receiptPrivateKey, publicKey: receiptPublicKey } = generateKeyPairSync('ed25519');
const rawReceiptPublicKey = receiptPublicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const env = {
  EVAOS_MAC_CONTROL_CONTEXT_KEY_ID: KEY_ID,
  EVAOS_MAC_CONTROL_CONTEXT_PUBLIC_KEY: rawPublicKey.toString('base64url'),
  EVAOS_MAC_CONTROL_RECEIPT_KEY_ID: RECEIPT_KEY_ID,
  EVAOS_MAC_CONTROL_RECEIPT_PUBLIC_KEY: rawReceiptPublicKey.toString('base64url'),
  EVAOS_MAC_CONTROL_EXPECTED_SOURCE_COMMIT: EXPECTED_COMMIT,
  EVAOS_MAC_CONTROL_EXPECTED_SOURCE_SHA256: EXPECTED_SOURCE_SHA256,
  EVAOS_MAC_CONTROL_EXPECTED_APP_VERSION: '2.1.36',
  EVAOS_MAC_CONTROL_EXPECTED_APP_BUILD: '2.1.36',
};
const expectedCandidate = {
  sourceCommit: EXPECTED_COMMIT,
  sourceSha256: EXPECTED_SOURCE_SHA256,
  appVersion: '2.1.36',
  appBuild: '2.1.36',
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
    ['completeEnrollment', '-'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, input: '{"enrollment_code":"must-not-be-used"}' }
  );
  assert.equal(hermes.status, 0);
  assert.equal(JSON.parse(hermes.stdout).errors[0].code, 'legacy_pairing_removed');
});

test('does not advertise or execute remote Mac-control start', async () => {
  const packageManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const pluginManifest = JSON.parse(readFileSync(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'));
  assert.equal(packageManifest.openclaw.contracts.tools.includes('desktop_control_start'), false);
  assert.equal(pluginManifest.contracts.tools.includes('desktop_control_start'), false);

  const openClawResult = await runBridge('customerMacControlStart', { mode: 'full-access' });
  assert.equal(openClawResult.ok, false);
  assert.equal(openClawResult.errors[0].code, 'control_start_local_only');

  const hermes = spawnSync(
    fileURLToPath(new URL('../../hermes-adapter/bin/evaos-desktop-bridge-command', import.meta.url)),
    ['customerMacControlStart', '-'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, input: '{"mode":"full-access"}' }
  );
  assert.equal(hermes.status, 0);
  assert.equal(JSON.parse(hermes.stdout).errors[0].code, 'control_start_local_only');
});

test('Hermes reads params from stdin and never executes connector env files', () => {
  const wrapper = fileURLToPath(new URL('../../hermes-adapter/bin/evaos-desktop-bridge-command', import.meta.url));
  const argvPayload = spawnSync(wrapper, ['customerMacStatus', '{}'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.equal(argvPayload.status, 2);
  assert.match(argvPayload.stderr, /standard input|Pass JSON parameters/);

  const directory = mkdtempSync(join(tmpdir(), 'evaos-hermes-env-'));
  const envFile = join(directory, 'connector.env');
  const marker = join(directory, 'must-not-exist');
  try {
    writeFileSync(
      envFile,
      `EVAOS_DESKTOP_BRIDGE_URL=$(touch ${marker})\nEVAOS_DESKTOP_BRIDGE_TOKEN=test-token-value-at-least-24\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
    chmodSync(envFile, 0o600);
    const result = spawnSync(wrapper, ['customerMacStatus'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        EVAOS_DESKTOP_BRIDGE_ENV_FILE: envFile,
      },
    });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Hermes decodes inert shell-quoted connector values exactly', async () => {
  const wrapper = fileURLToPath(new URL('../../hermes-adapter/bin/evaos-desktop-bridge-command', import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), 'evaos-hermes-quoted-env-'));
  const envFile = join(directory, 'connector.env');
  const token = 'quoted connector token at least 24';
  let authorization = '';
  const server = createServer((request, response) => {
    authorization = String(request.headers.authorization || '');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok":true,"schema":"evaos.desktop_bridge.response.v1"}');
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.equal(typeof address, 'object');
    writeFileSync(
      envFile,
      `EVAOS_DESKTOP_BRIDGE_URL='http://127.0.0.1:${address.port}'\nEVAOS_DESKTOP_BRIDGE_TOKEN='${token}'\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
    chmodSync(envFile, 0o600);
    const completed = await execFileAsync(wrapper, ['customerMacStatus'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        EVAOS_DESKTOP_BRIDGE_ENV_FILE: envFile,
      },
      timeout: 5_000,
    });
    assert.equal(JSON.parse(completed.stdout).ok, true);
    assert.equal(authorization, `Bearer ${token}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Hermes accepts export-form env files without overriding explicit connector credentials', async () => {
  const wrapper = fileURLToPath(new URL('../../hermes-adapter/bin/evaos-desktop-bridge-command', import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), 'evaos-hermes-export-env-'));
  const envFile = join(directory, 'connector.env');
  const fileToken = 'file connector token at least 24';
  const explicitToken = 'explicit connector token at least 24';
  const authorizations = [];
  const server = createServer((request, response) => {
    authorizations.push(String(request.headers.authorization || ''));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok":true,"schema":"evaos.desktop_bridge.response.v1"}');
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.equal(typeof address, 'object');
    const explicitUrl = `http://127.0.0.1:${address.port}`;

    writeFileSync(
      envFile,
      `export EVAOS_DESKTOP_BRIDGE_URL='http://127.0.0.1:1'\nexport EVAOS_DESKTOP_BRIDGE_TOKEN='${fileToken}'\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
    const urlPreserved = await execFileAsync(wrapper, ['customerMacStatus'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        EVAOS_DESKTOP_BRIDGE_ENV_FILE: envFile,
        EVAOS_DESKTOP_BRIDGE_URL: explicitUrl,
      },
      timeout: 5_000,
    });
    assert.equal(JSON.parse(urlPreserved.stdout).ok, true);

    writeFileSync(
      envFile,
      `export EVAOS_DESKTOP_BRIDGE_URL='${explicitUrl}'\nexport EVAOS_DESKTOP_BRIDGE_TOKEN='${fileToken}'\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
    const tokenPreserved = await execFileAsync(wrapper, ['customerMacStatus'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        EVAOS_DESKTOP_BRIDGE_ENV_FILE: envFile,
        EVAOS_DESKTOP_BRIDGE_TOKEN: explicitToken,
      },
      timeout: 5_000,
    });
    assert.equal(JSON.parse(tokenPreserved.stdout).ok, true);
    assert.deepEqual(authorizations, [`Bearer ${fileToken}`, `Bearer ${explicitToken}`]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects caller-supplied local payload file paths', async () => {
  const message = await runBridge('codexSendVisibleMessage', {
    thread_id: 'thread-1',
    message_file: '/etc/passwd',
  });
  assert.equal(message.ok, false);
  assert.equal(message.errors[0].code, 'payload_file_reserved');

  const value = await runBridge('desktopSetValue', {
    snapshot_id: 'snapshot-1',
    element_id: 'element-1',
    value_file: '/etc/passwd',
  });
  assert.equal(value.ok, false);
  assert.equal(value.errors[0].code, 'payload_file_reserved');
});

test('verifies server authority and forwards only the fixed connector canary contract', async () => {
  const challenge = Buffer.alloc(32, 7).toString('base64url');
  const runRef = 'rc-2.1.36-arm64';
  const authority = signedAuthority();
  const receipt = validReceipt(authority, challenge, runRef);
  const connectorEnvelope = signedConnectorEnvelope(receipt);
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
  const envelope = JSON.parse(response.body);
  assert.deepEqual(envelope, connectorEnvelope.publicAttestation);
  const attestation = JSON.parse(Buffer.from(envelope.attestationBase64, 'base64url'));
  assert.deepEqual(attestation, {
    schema: 'evaos.mac_control.public_runtime_attestation.v1',
    keyId: RECEIPT_KEY_ID,
    namespace: PUBLIC_ATTESTATION_NAMESPACE,
    proofKind: 'selected_binding_direct_mac_control',
    runtime: 'openclaw',
    tool: 'customer_mac.desktop_hotkey',
    outcome: 'succeeded',
    runRef,
    executedAt: '2026-07-15T00:00:10Z',
    authorityIssuedAt: Math.floor(NOW_MS / 1000),
    authorityExpiresAt: Math.floor(NOW_MS / 1000) + 50,
    contextKeyId: KEY_ID,
    controlState: 'ready_unchanged',
    auditRecorded: true,
    privateReceiptSha256: sha256(canonicalBytes(receipt)),
    connectorCandidate: {
      sourceCommit: EXPECTED_COMMIT,
      sourceSha256: EXPECTED_SOURCE_SHA256,
      appVersion: '2.1.36',
      appBuild: '2.1.36',
    },
  });
  assert.equal(response.body.includes('receiptBase64'), false);
  assert.equal(response.body.includes('SSH SIGNATURE'), true);
  assert.equal(response.body.includes(CONNECTOR_TOKEN), false);
  assert.equal(response.body.includes('customer-1'), false);
  for (const field of ['challenge', 'bindingRef', 'sessionRef', 'auditRef', 'customerRef', 'vmRef']) {
    assert.equal(field in attestation, false);
  }
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

test('preflights the pinned receipt verifier before connector execution', async () => {
  let connectorCalls = 0;
  const { EVAOS_MAC_CONTROL_RECEIPT_PUBLIC_KEY: _missing, ...incompleteEnv } = env;
  const handler = createMacControlRuntimeReceiptHandler({
    env: incompleteEnv,
    now: () => NOW_MS,
    fetchImpl: async () => {
      connectorCalls += 1;
      return fetchResponse(500, {});
    },
  });
  const response = await invoke(
    handler,
    { challenge: Buffer.alloc(32, 8).toString('base64url'), runRef: 'missing-receipt-verifier' },
    signedAuthority().headers
  );
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error.code, 'receipt_verifier_unavailable');
  assert.equal(connectorCalls, 0);
});

test('bounds connector IO by a sanitized deadline before signed authority expires', async () => {
  const authority = signedAuthority();
  let connectorCalls = 0;
  const handler = createMacControlRuntimeReceiptHandler({
    env,
    now: () => NOW_MS,
    connectorTimeoutMs: 20,
    fetchImpl: async (_url, init) => {
      connectorCalls += 1;
      return await new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('must not escape')), { once: true });
      });
    },
  });
  const response = await invoke(
    handler,
    { challenge: Buffer.alloc(32, 12).toString('base64url'), runRef: 'connector-timeout' },
    authority.headers
  );
  assert.equal(response.statusCode, 502);
  assert.equal(JSON.parse(response.body).error.code, 'connector_unavailable');
  assert.equal(response.body.includes('must not escape'), false);
  assert.equal(response.body.includes(CONNECTOR_TOKEN), false);
  assert.equal(connectorCalls, 1);
});

test('keeps the connector deadline active through response body consumption', async () => {
  const authority = signedAuthority();
  let connectorCalls = 0;
  const handler = createMacControlRuntimeReceiptHandler({
    env,
    now: () => NOW_MS,
    connectorTimeoutMs: 20,
    fetchImpl: async (_url, init) => {
      connectorCalls += 1;
      return {
        ok: true,
        status: 200,
        text: async () =>
          await new Promise((_resolve, reject) => {
            if (init.signal.aborted) {
              reject(new Error('body deadline elapsed'));
              return;
            }
            init.signal.addEventListener('abort', () => reject(new Error('body deadline elapsed')), { once: true });
          }),
      };
    },
  });
  const outcome = await Promise.race([
    invoke(
      handler,
      { challenge: Buffer.alloc(32, 13).toString('base64url'), runRef: 'connector-body-timeout' },
      authority.headers
    ),
    new Promise((resolve) => setTimeout(() => resolve('handler_did_not_settle'), 250)),
  ]);
  assert.notEqual(outcome, 'handler_did_not_settle');
  assert.equal(outcome.statusCode, 502);
  assert.equal(JSON.parse(outcome.body).error.code, 'connector_response_invalid');
  assert.equal(outcome.body.includes('body deadline elapsed'), false);
  assert.equal(connectorCalls, 1);
});

test('cancels a rejected streaming connector response before returning', async () => {
  const authority = signedAuthority();
  let canceled = false;
  let textCalled = false;
  const handler = createMacControlRuntimeReceiptHandler({
    env,
    now: () => NOW_MS,
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      body: {
        async *[Symbol.asyncIterator]() {
          throw new Error('rejected body must not be consumed');
        },
        async cancel() {
          canceled = true;
        },
      },
      text: async () => {
        textCalled = true;
        return 'must not be read';
      },
    }),
  });
  const response = await invoke(
    handler,
    { challenge: Buffer.alloc(32, 15).toString('base64url'), runRef: 'connector-rejected-stream' },
    authority.headers
  );
  assert.equal(response.statusCode, 502);
  assert.equal(JSON.parse(response.body).error.code, 'connector_rejected_canary');
  assert.equal(canceled, true);
  assert.equal(textCalled, false);
  assert.equal(response.body.includes('must not'), false);
});

test('rejects an oversized streaming connector body before reading beyond the cap', async () => {
  const authority = signedAuthority();
  let textCalled = false;
  let chunksRead = 0;
  const handler = createMacControlRuntimeReceiptHandler({
    env,
    now: () => NOW_MS,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      body: {
        async *[Symbol.asyncIterator]() {
          chunksRead += 1;
          yield Buffer.alloc(40_000, 0x61);
          chunksRead += 1;
          yield Buffer.alloc(30_000, 0x62);
          throw new Error('must stop before a third chunk');
        },
      },
      text: async () => {
        textCalled = true;
        return '';
      },
    }),
  });
  const response = await invoke(
    handler,
    { challenge: Buffer.alloc(32, 14).toString('base64url'), runRef: 'connector-body-oversized' },
    authority.headers
  );
  assert.equal(response.statusCode, 502);
  assert.equal(JSON.parse(response.body).error.code, 'connector_response_invalid');
  assert.equal(response.body.includes('third chunk'), false);
  assert.equal(chunksRead, 2);
  assert.equal(textCalled, false);
});

test('rejects forged signatures and re-signed wrong release claims', async (t) => {
  const challenge = Buffer.alloc(32, 9).toString('base64url');
  const runRef = 'receipt-tamper';
  const authority = signedAuthority();
  const valid = validReceipt(authority, challenge, runRef);
  const cases = [
    [
      'forged signature',
      () => {
        const envelope = signedConnectorEnvelope(valid);
        envelope.privateReceipt.signature = sshSignature(canonicalBytes({ ...valid, runRef: 'other-run' }));
        return envelope;
      },
    ],
    [
      'wrong release candidate',
      () =>
        signedConnectorEnvelope({
          ...valid,
          candidate: { ...valid.candidate, sourceCommit: 'd'.repeat(40) },
        }),
    ],
    [
      'launcher wrapper substituted for the active packaged connector program',
      () =>
        signedConnectorEnvelope({
          ...valid,
          candidate: {
            ...valid.candidate,
            owner: {
              ...valid.candidate.owner,
              programPath: {
                kind: 'path',
                value: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
              },
            },
          },
        }),
    ],
    [
      'forged public attestation',
      () => {
        const envelope = signedConnectorEnvelope(valid);
        envelope.publicAttestation.signature = sshSignature(
          canonicalBytes({ ...publicAttestation(valid), outcome: 'failed' }),
          PUBLIC_ATTESTATION_NAMESPACE
        );
        return envelope;
      },
    ],
    [
      'public attestation paired with another private receipt',
      () => {
        const envelope = signedConnectorEnvelope(valid);
        envelope.publicAttestation = signedConnectorEnvelope({
          ...valid,
          auditRecordDigest: 'd'.repeat(64),
        }).publicAttestation;
        return envelope;
      },
    ],
  ];
  for (const [name, envelope] of cases) {
    await t.test(name, async () => {
      const handler = createMacControlRuntimeReceiptHandler({
        env,
        now: () => NOW_MS,
        fetchImpl: async () => fetchResponse(200, envelope()),
      });
      const response = await invoke(handler, { challenge, runRef }, authority.headers);
      assert.equal(response.statusCode, 502);
      assert.equal(JSON.parse(response.body).error.code, 'connector_response_invalid');
    });
  }
});

test('verifies a real OpenSSH SSHSIG over the exact canonical receipt bytes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'evaos-runtime-receipt-'));
  try {
    const keyPath = join(root, 'receipt-key');
    const keygen = spawnSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyPath], {
      encoding: 'utf8',
    });
    assert.equal(keygen.status, 0, keygen.stderr);
    const publicLine = readFileSync(`${keyPath}.pub`, 'utf8').trim().split(/\s+/);
    assert.equal(publicLine[0], 'ssh-ed25519');
    const publicBlob = Buffer.from(publicLine[1], 'base64');
    const actualPublicKey = publicBlob.subarray(-32);
    assert.equal(actualPublicKey.length, 32);

    const challenge = Buffer.alloc(32, 10).toString('base64url');
    const runRef = 'real-openssh-signature';
    const authority = signedAuthority();
    const receipt = validReceipt(authority, challenge, runRef);
    const receiptBytes = canonicalBytes(receipt);
    const signed = spawnSync('/usr/bin/ssh-keygen', ['-Y', 'sign', '-q', '-f', keyPath, '-n', RECEIPT_NAMESPACE, '-'], {
      input: receiptBytes,
    });
    assert.equal(signed.status, 0, signed.stderr.toString('utf8'));
    const attestation = publicAttestation(receipt);
    const attestationBytes = canonicalBytes(attestation);
    const publicSigned = spawnSync(
      '/usr/bin/ssh-keygen',
      ['-Y', 'sign', '-q', '-f', keyPath, '-n', PUBLIC_ATTESTATION_NAMESPACE, '-'],
      { input: attestationBytes }
    );
    assert.equal(publicSigned.status, 0, publicSigned.stderr.toString('utf8'));
    const envelope = {
      schema: 'evaos.mac_control.runtime_receipt_bundle.v2',
      privateReceipt: {
        schema: 'evaos.mac_control.runtime_receipt_envelope.v1',
        receiptBase64: receiptBytes.toString('base64url'),
        signature: signed.stdout.toString('ascii'),
        keyId: RECEIPT_KEY_ID,
        namespace: RECEIPT_NAMESPACE,
      },
      publicAttestation: {
        schema: 'evaos.mac_control.public_runtime_attestation_envelope.v1',
        attestationBase64: attestationBytes.toString('base64url'),
        signature: publicSigned.stdout.toString('ascii'),
        keyId: RECEIPT_KEY_ID,
        namespace: PUBLIC_ATTESTATION_NAMESPACE,
      },
    };
    const handler = createMacControlRuntimeReceiptHandler({
      env: { ...env, EVAOS_MAC_CONTROL_RECEIPT_PUBLIC_KEY: actualPublicKey.toString('base64url') },
      now: () => NOW_MS,
      fetchImpl: async () => fetchResponse(200, envelope),
    });
    const response = await invoke(handler, { challenge, runRef }, authority.headers);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(JSON.parse(response.body).schema, 'evaos.mac_control.public_runtime_attestation_envelope.v1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
    ['unknown key', () => signedAuthority().headers, { ...env, EVAOS_MAC_CONTROL_CONTEXT_KEY_ID: 'unknown-key' }],
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

test('classifies deployed staging negatives from the actual signed authority without connector access', async () => {
  const authority = signedAuthority();
  let connectorCalls = 0;
  const handler = createMacControlRuntimeReceiptHandler({
    env: { ...env, EVAOS_MAC_CONTROL_DEPLOYED_NEGATIVE_PROBE_MODE: 'staging' },
    now: () => NOW_MS,
    fetchImpl: async () => {
      connectorCalls += 1;
      return fetchResponse(500, {});
    },
  });
  const response = await invoke(handler, { proofMode: 'deployed-staging', expectedCandidate }, authority.headers);

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(JSON.parse(response.body), {
    schema: 'evaos.mac_control.deployed_negative_probe.v1',
    proofMode: 'deployed-staging',
    candidate: expectedCandidate,
    classifications: {
      forgedSignature: {
        rejected: true,
        httpStatus: 401,
        code: 'execution_context_signature_invalid',
      },
      expiredContext: {
        rejected: true,
        httpStatus: 401,
        code: 'execution_context_expired',
      },
      replay: {
        firstAccepted: true,
        secondRejected: true,
        httpStatus: 409,
        code: 'execution_context_replayed',
      },
    },
    connectorActionAttempted: false,
    sensitiveOutputAbsent: true,
  });
  assert.equal(connectorCalls, 0);
  for (const forbidden of [
    CONNECTOR_TOKEN,
    authority.payload,
    authority.signature,
    authority.context.customer_id,
    authority.context.customer_vm_id,
    authority.context.binding_id,
    authority.headers['x-evaos-desktop-bridge-url'],
  ]) {
    assert.equal(response.body.includes(forbidden), false);
  }
});

test('rejects the deployed negative probe outside exact staging mode after validating authority', async () => {
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
  const body = { proofMode: 'deployed-staging', expectedCandidate };
  const disabled = await invoke(handler, body, authority.headers);
  assert.equal(disabled.statusCode, 403);
  assert.equal(JSON.parse(disabled.body).error.code, 'deployed_negative_probe_disabled');

  const forged = await invoke(handler, body, {
    ...authority.headers,
    'x-evaos-mac-control-execution-context-signature': Buffer.alloc(64, 9).toString('base64url'),
  });
  assert.equal(forged.statusCode, 401);
  assert.equal(JSON.parse(forged.body).error.code, 'execution_context_signature_invalid');
  assert.equal(connectorCalls, 0);
});

test('requires the caller candidate to match the verifier environment before the deployed probe runs', async () => {
  let connectorCalls = 0;
  const handler = createMacControlRuntimeReceiptHandler({
    env: { ...env, EVAOS_MAC_CONTROL_DEPLOYED_NEGATIVE_PROBE_MODE: 'staging' },
    now: () => NOW_MS,
    fetchImpl: async () => {
      connectorCalls += 1;
      return fetchResponse(500, {});
    },
  });
  const response = await invoke(
    handler,
    {
      proofMode: 'deployed-staging',
      expectedCandidate: { ...expectedCandidate, sourceCommit: 'd'.repeat(40) },
    },
    signedAuthority().headers
  );
  assert.equal(response.statusCode, 409);
  assert.equal(JSON.parse(response.body).error.code, 'deployed_negative_probe_candidate_mismatch');
  assert.equal(connectorCalls, 0);
});

test('burns a verified execution context before connector IO and rejects replay', async () => {
  const authority = signedAuthority();
  const body = { challenge: Buffer.alloc(32, 3).toString('base64url'), runRef: 'replay-proof' };
  let connectorCalls = 0;
  const envelope = signedConnectorEnvelope(validReceipt(authority, body.challenge, body.runRef));
  const handler = createMacControlRuntimeReceiptHandler({
    env,
    now: () => NOW_MS,
    fetchImpl: async () => {
      connectorCalls += 1;
      return fetchResponse(200, envelope);
    },
  });
  assert.equal((await invoke(handler, body, authority.headers)).statusCode, 200);
  const replay = await invoke(handler, body, authority.headers);
  assert.equal(replay.statusCode, 409);
  assert.equal(JSON.parse(replay.body).error.code, 'execution_context_replayed');
  assert.equal(connectorCalls, 1);
});

test('rejects a connector receipt that contains raw authority without reflecting it', async () => {
  const authority = signedAuthority();
  const leakingReceipt = { schema: 'evaos.mac_control.runtime_receipt.v1', customer_id: 'customer-1' };
  const handler = createMacControlRuntimeReceiptHandler({
    env,
    now: () => NOW_MS,
    fetchImpl: async () => fetchResponse(200, signedConnectorEnvelope(leakingReceipt)),
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

test('dedicated negative-proof runner emits only mechanically observed assertions', () => {
  const root = mkdtempSync(join(tmpdir(), 'evaos-runtime-receipt-negative-'));
  try {
    const outputPath = join(root, 'negative-proof.json');
    const sourceHeadSha = 'd'.repeat(40);
    const sourceRunId = '123456789';
    const completed = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../scripts/runtime-receipt-negative-proof.mjs', import.meta.url)),
        outputPath,
        sourceHeadSha,
        sourceRunId,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(completed.status, 0, completed.stderr);
    assert.equal(completed.stdout, '');
    assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8')), {
      schema: 'evaos.mac_control.runtime_receipt_negative_proof.v1',
      sourceHeadSha,
      sourceRunId,
      assertions: {
        forgedContextRejected: true,
        expiredContextRejected: true,
        replayRejected: true,
        authorityRedacted: true,
      },
    });
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
    context,
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

function validReceipt(authority, challenge, runRef, overrides = {}) {
  const controlState = {
    active: true,
    generation: 7,
    killSwitch: false,
    mode: 'full_access',
    ready: true,
    takeoverActive: false,
  };
  const actionArgs = { keys: 'escape', dryRun: false };
  const auditId = 'audit-runtime-receipt-1234';
  return {
    schema: 'evaos.mac_control.runtime_receipt.v1',
    keyId: RECEIPT_KEY_ID,
    namespace: RECEIPT_NAMESPACE,
    executedAt: '2026-07-15T00:00:10Z',
    runtime: 'openclaw',
    challenge,
    runRef,
    contextKeyId: KEY_ID,
    executionContextDigest: saltedHash(challenge, Buffer.from(authority.payload, 'base64url')),
    contextRef: saltedHash(challenge, authority.context.context_id),
    contextIssuedAt: authority.context.issued_at,
    contextExpiresAt: authority.context.expires_at,
    customerRef: saltedHash(challenge, authority.context.customer_id),
    vmRef: saltedHash(challenge, authority.context.customer_vm_id),
    bindingRef: saltedHash(challenge, authority.context.binding_id),
    bindingVersion: authority.context.binding_version,
    bindingExpiresAt: authority.headers['x-evaos-mac-control-binding-expires-at'],
    sessionRef: saltedHash(challenge, `${authority.context.binding_id}\0${controlState.generation}`),
    controlStateBefore: controlState,
    controlStateAfter: controlState,
    controlStateBeforeDigest: sha256(canonicalBytes(controlState)),
    controlStateAfterDigest: sha256(canonicalBytes(controlState)),
    candidate: {
      sourceCommit: EXPECTED_COMMIT,
      sourceSha256: EXPECTED_SOURCE_SHA256,
      sourcePath: 'resources/evaos-beta/bridge',
      sourceOwner: '100yenadmin/evaOS-GUI',
      status: 'vendored',
      appPath: '/Applications/evaOS Workbench.app',
      appVersion: '2.1.36',
      appBuild: '2.1.36',
      appBundleId: 'com.evaos.workbench',
      appName: 'evaOS Workbench',
      executable: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/python/bin/python3.12',
      argv0: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/src/evaos_desktop_bridge/cli.py',
      owner: {
        label: 'com.electricsheep.evaos-desktop-bridge',
        classification: 'workbench_bundle',
        bundleId: 'com.evaos.workbench',
        sourceCommit: EXPECTED_COMMIT,
        programPath: {
          kind: 'path',
          value: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/src/evaos_desktop_bridge/cli.py',
        },
        appPath: { kind: 'path', value: '/Applications/evaOS Workbench.app' },
        manifestPath: {
          kind: 'path',
          value: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/manifest.json',
        },
        plistPath: {
          kind: 'path',
          value: '/Users/test/Library/LaunchAgents/com.electricsheep.evaos-desktop-bridge.plist',
        },
      },
    },
    action: { command: 'customer_mac.desktop_hotkey', args: actionArgs },
    actionArgsDigest: sha256(canonicalBytes(actionArgs)),
    auditId,
    auditTimestamp: '2026-07-15T00:00:09Z',
    auditRecordDigest: 'c'.repeat(64),
    ...overrides,
  };
}

function signedConnectorEnvelope(receipt) {
  const receiptBytes = canonicalBytes(receipt);
  const attestation = publicAttestation(receipt);
  const attestationBytes = canonicalBytes(attestation);
  return {
    schema: 'evaos.mac_control.runtime_receipt_bundle.v2',
    privateReceipt: {
      schema: 'evaos.mac_control.runtime_receipt_envelope.v1',
      receiptBase64: receiptBytes.toString('base64url'),
      signature: sshSignature(receiptBytes, RECEIPT_NAMESPACE),
      keyId: RECEIPT_KEY_ID,
      namespace: RECEIPT_NAMESPACE,
    },
    publicAttestation: {
      schema: 'evaos.mac_control.public_runtime_attestation_envelope.v1',
      attestationBase64: attestationBytes.toString('base64url'),
      signature: sshSignature(attestationBytes, PUBLIC_ATTESTATION_NAMESPACE),
      keyId: RECEIPT_KEY_ID,
      namespace: PUBLIC_ATTESTATION_NAMESPACE,
    },
  };
}

function publicAttestation(receipt) {
  return {
    schema: 'evaos.mac_control.public_runtime_attestation.v1',
    keyId: RECEIPT_KEY_ID,
    namespace: PUBLIC_ATTESTATION_NAMESPACE,
    proofKind: 'selected_binding_direct_mac_control',
    runtime: 'openclaw',
    tool: 'customer_mac.desktop_hotkey',
    outcome: 'succeeded',
    runRef: receipt.runRef,
    executedAt: receipt.executedAt,
    authorityIssuedAt: receipt.contextIssuedAt,
    authorityExpiresAt: receipt.contextExpiresAt,
    contextKeyId: receipt.contextKeyId,
    controlState: 'ready_unchanged',
    auditRecorded: true,
    privateReceiptSha256: sha256(canonicalBytes(receipt)),
    connectorCandidate: {
      sourceCommit: receipt.candidate.sourceCommit,
      sourceSha256: receipt.candidate.sourceSha256,
      appVersion: receipt.candidate.appVersion,
      appBuild: receipt.candidate.appBuild,
    },
  };
}

function sshSignature(message, namespace = RECEIPT_NAMESPACE) {
  const algorithm = Buffer.from('ssh-ed25519');
  const namespaceBytes = Buffer.from(namespace);
  const hashAlgorithm = Buffer.from('sha512');
  const digest = createHash('sha512').update(message).digest();
  const signedData = Buffer.concat([
    Buffer.from('SSHSIG'),
    sshString(namespaceBytes),
    sshString(Buffer.alloc(0)),
    sshString(hashAlgorithm),
    sshString(digest),
  ]);
  const signature = sign(null, signedData, receiptPrivateKey);
  const publicKeyBlob = Buffer.concat([sshString(algorithm), sshString(rawReceiptPublicKey)]);
  const signatureBlob = Buffer.concat([sshString(algorithm), sshString(signature)]);
  const binary = Buffer.concat([
    Buffer.from('SSHSIG'),
    uint32(1),
    sshString(publicKeyBlob),
    sshString(namespaceBytes),
    sshString(Buffer.alloc(0)),
    sshString(hashAlgorithm),
    sshString(signatureBlob),
  ]);
  const encoded = binary
    .toString('base64')
    .match(/.{1,70}/g)
    .join('\n');
  return `-----BEGIN SSH SIGNATURE-----\n${encoded}\n-----END SSH SIGNATURE-----\n`;
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function sshString(value) {
  return Buffer.concat([uint32(value.length), value]);
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(sortJson(value)));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])])
  );
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function saltedHash(challenge, value) {
  return sha256(
    Buffer.concat([
      Buffer.from(challenge, 'ascii'),
      Buffer.from([0]),
      typeof value === 'string' ? Buffer.from(value, 'utf8') : value,
    ])
  );
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
