#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const MAC_CONTROL_PROOF_NAMES = Object.freeze([
  'mac-control-runtime.json',
  'mac-control-runtime-negative.json',
  'mac-control-deployed-route.json',
  'mac-control-session-provisioning.json',
  'mac-control-session-provisioning.stdout.json',
  'mac-control-session-cleanup.json',
  'mac-control-session-cleanup.stdout.json',
]);
const MAC_CONTROL_RUNTIME_NEGATIVE_PROOF_CONTRACT = Object.freeze({
  schema: 'evaos.mac_control.runtime_receipt_negative_proof.v1',
  fields: ['schema', 'sourceHeadSha', 'sourceRunId', 'assertions'],
  nested: {
    assertions: {
      fields: ['forgedContextRejected', 'expiredContextRejected', 'replayRejected', 'authorityRedacted'],
    },
  },
});
const MAC_CONTROL_PROOF_CONTRACTS = Object.freeze({
  'mac-control-runtime.json': {
    schema: 'evaos.mac_control.public_runtime_attestation_envelope.v1',
    fields: ['schema', 'attestationBase64', 'signature', 'keyId', 'namespace'],
  },
  'mac-control-runtime-negative.json': MAC_CONTROL_RUNTIME_NEGATIVE_PROOF_CONTRACT,
  'mac-control-deployed-route.json': {
    schema: 'evaos.mac_control.deployed_route_probe.v1',
    fields: ['schema', 'sourceHeadSha', 'sourceRunId', 'checkedAt', 'assertions'],
    nested: {
      assertions: {
        fields: [
          'gatewayAuthRequired',
          'postOnly',
          'exactMatch',
          'strictBody',
          'callerAuthorityBodyRejected',
          'sensitiveOutputAbsent',
        ],
      },
    },
  },
  'mac-control-session-provisioning.json': {
    schema: 'evaos-mac-control-canary-session-provision/v1',
    fields: [
      'schema',
      'accountConfigured',
      'customerConfigured',
      'activeMembershipVerified',
      'stagingMarkerVerified',
      'sessionMinted',
      'sessionExpiryPresent',
      'sensitiveOutput',
    ],
  },
  'mac-control-session-provisioning.stdout.json': {
    schema: 'evaos-mac-control-canary-session-provision/v1',
    fields: [
      'schema',
      'accountConfigured',
      'customerConfigured',
      'activeMembershipVerified',
      'stagingMarkerVerified',
      'sessionMinted',
      'sessionExpiryPresent',
      'sensitiveOutput',
    ],
  },
  'mac-control-session-cleanup.json': {
    schema: 'evaos-mac-control-canary-session-cleanup/v1',
    fields: ['schema', 'sessionRevoked', 'sensitiveOutput'],
  },
  'mac-control-session-cleanup.stdout.json': {
    schema: 'evaos-mac-control-canary-session-cleanup/v1',
    fields: ['schema', 'sessionRevoked', 'sensitiveOutput'],
  },
});
const FORBIDDEN_NORMALIZED_FIELDS = new Set([
  'accountemail',
  'accesstoken',
  'apikey',
  'authorization',
  'authkey',
  'bindingid',
  'challenge',
  'connectorurl',
  'connectortoken',
  'contextpayload',
  'contextsignature',
  'cookie',
  'credential',
  'customerid',
  'desktopsession',
  'endpoint',
  'executioncontext',
  'launchurl',
  'password',
  'privatekey',
  'receiptbase64',
  'refreshtoken',
  'servicerolekey',
  'session',
  'signature',
]);
const FORBIDDEN_VALUE =
  /\beds_[A-Za-z0-9_-]{8,}\b|\bBearer\s+|\beyJ[A-Za-z0-9_-]{8,}\.|https?:\/\/|[?&]session=|\S+@\S+|-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|SSH SIGNATURE)-----/i;
const FORBIDDEN_NORMALIZED_FIELD_FRAGMENTS = Object.freeze([
  'authorization',
  'cookie',
  'signature',
  'token',
  'credential',
  'password',
  'secret',
  'keymaterial',
  'receiptbase64',
  'contextpayload',
  'executioncontext',
  'connectorurl',
  'desktopsession',
  'launchurl',
]);
const ALLOWED_PUBLIC_KEY_IDENTIFIER_FIELDS = new Set(['contextkeyid', 'keyid', 'publickeyid', 'receiptkeyid']);

function normalizedProofFieldName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]/g, '');
}

function assertMacControlProofSanitized(value, location = '$') {
  if (typeof value === 'string' && FORBIDDEN_VALUE.test(value)) {
    throw new Error(`Mac-control proof contains forbidden sensitive material at ${location}.`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertMacControlProofSanitized(entry, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizedProofFieldName(key);
    if (
      FORBIDDEN_NORMALIZED_FIELDS.has(normalizedKey) ||
      FORBIDDEN_NORMALIZED_FIELD_FRAGMENTS.some((fragment) => normalizedKey.includes(fragment)) ||
      (normalizedKey.includes('key') && !ALLOWED_PUBLIC_KEY_IDENTIFIER_FIELDS.has(normalizedKey)) ||
      /private.*key/.test(normalizedKey)
    ) {
      throw new Error(`Mac-control proof contains forbidden field ${key} at ${location}.`);
    }
    assertMacControlProofSanitized(entry, `${location}.${key}`);
  }
}

function assertExactProofContract(value, contract, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Mac-control proof contract requires an object at ${location}.`);
  }
  const allowedFields = new Set(contract.fields);
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new Error(`Mac-control proof contains forbidden unexpected field ${key} at ${location}.`);
    }
  }
  for (const key of contract.fields) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`Mac-control proof contract is missing field ${key} at ${location}.`);
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    const nestedContract = contract.nested?.[key];
    if (nestedContract) {
      assertExactProofContract(entry, nestedContract, `${location}.${key}`);
    } else if (entry && typeof entry === 'object') {
      throw new Error(`Mac-control proof contains forbidden structured field ${key} at ${location}.`);
    }
  }
}

function assertSensitiveOutputPassed(value, contract, location) {
  if (contract.fields.includes('sensitiveOutput') && value.sensitiveOutput !== 'passed') {
    throw new Error(`Mac-control proof did not pass the sensitive-output contract in ${location}.`);
  }
}

function assertPublicAttestationEnvelopeSanitized(value, location) {
  const contract = MAC_CONTROL_PROOF_CONTRACTS['mac-control-runtime.json'];
  assertExactProofContract(value, contract, location);
  assertMacControlProofSanitized({ schema: value.schema, keyId: value.keyId, namespace: value.namespace }, location);
  if (
    typeof value.attestationBase64 !== 'string' ||
    value.attestationBase64.length < 32 ||
    value.attestationBase64.length > 32768 ||
    !/^[A-Za-z0-9_-]+$/.test(value.attestationBase64)
  ) {
    throw new Error(`Mac-control proof contains invalid public attestation bytes at ${location}.`);
  }
  const attestationBytes = Buffer.from(value.attestationBase64, 'base64url');
  if (
    attestationBytes.byteLength === 0 ||
    attestationBytes.byteLength > 16384 ||
    attestationBytes.toString('base64url') !== value.attestationBase64
  ) {
    throw new Error(`Mac-control proof contains noncanonical public attestation bytes at ${location}.`);
  }
  let attestation;
  try {
    attestation = JSON.parse(attestationBytes.toString('utf8'));
  } catch {
    throw new Error(`Mac-control proof contains invalid public attestation JSON at ${location}.`);
  }
  const attestationContract = {
    fields: [
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
    ],
    nested: {
      connectorCandidate: {
        fields: ['sourceCommit', 'sourceSha256', 'appVersion', 'appBuild'],
      },
    },
  };
  assertExactProofContract(attestation, attestationContract, `${location}.decodedAttestation`);
  if (attestation.schema !== 'evaos.mac_control.public_runtime_attestation.v1') {
    throw new Error(`Mac-control proof contains an unexpected public attestation schema at ${location}.`);
  }
  assertMacControlProofSanitized(attestation, `${location}.decodedAttestation`);
  if (
    typeof value.signature !== 'string' ||
    value.signature.length > 8192 ||
    !/^-----BEGIN SSH SIGNATURE-----\n(?:[A-Za-z0-9+/=]{1,76}\n)+-----END SSH SIGNATURE-----\n$/.test(value.signature)
  ) {
    throw new Error(`Mac-control proof contains an invalid public attestation signature at ${location}.`);
  }
}

function scanMacControlProofDirectory(proofDir, options = {}) {
  const resolvedProofDir = path.resolve(String(proofDir || ''));
  const allowPartial = options.allowPartial === true;
  const missing = [];
  const existing = [];

  for (const proofName of MAC_CONTROL_PROOF_NAMES) {
    if (fs.existsSync(path.join(resolvedProofDir, proofName))) {
      existing.push(proofName);
    } else {
      missing.push(proofName);
    }
  }

  let scanned = 0;
  const parsedProofs = new Map();
  for (const proofName of existing) {
    const proofPath = path.join(resolvedProofDir, proofName);
    const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
    const contract = MAC_CONTROL_PROOF_CONTRACTS[proofName];
    if (!contract || proof.schema !== contract.schema) {
      throw new Error(`Mac-control proof has an unexpected schema in ${proofName}.`);
    }
    if (proofName === 'mac-control-runtime.json') {
      assertPublicAttestationEnvelopeSanitized(proof, proofName);
    } else {
      assertMacControlProofSanitized(proof, proofName);
      assertExactProofContract(proof, contract, proofName);
    }
    assertSensitiveOutputPassed(proof, contract, proofName);
    parsedProofs.set(proofName, proof);
    scanned += 1;
  }

  if (allowPartial) {
    return { ok: true, scanned, missing };
  }
  if (missing.length > 0) {
    throw new Error(`Mac-control proof is missing required artifacts: ${missing.join(', ')}.`);
  }

  const cleanupProof = parsedProofs.get('mac-control-session-cleanup.json');
  if (cleanupProof.sessionRevoked !== true) {
    throw new Error('Mac-control proof did not prove temporary session revocation.');
  }
  return { ok: true, scanned };
}

function parseScanArguments(args) {
  let allowPartial = false;
  let proofDir = '';
  for (const arg of args) {
    if (arg === '--allow-partial') {
      allowPartial = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown Mac-control proof scanner option: ${arg}.`);
    } else if (proofDir) {
      throw new Error('Mac-control proof scanner accepts exactly one proof directory.');
    } else {
      proofDir = arg;
    }
  }
  if (!proofDir) throw new Error('Mac-control proof directory is required.');
  return { allowPartial, proofDir };
}

if (require.main === module) {
  const { allowPartial, proofDir } = parseScanArguments(process.argv.slice(2));
  const result = scanMacControlProofDirectory(proofDir, { allowPartial });
  if (allowPartial) {
    const missing = result.missing.length > 0 ? result.missing.join(', ') : '(none)';
    process.stdout.write(
      `Mac-control partial proof scan inspected ${result.scanned} existing allowlisted artifact(s).\n` +
        `Mac-control partial proof scan missing allowlisted artifacts: ${missing}.\n`
    );
  }
}

module.exports = {
  MAC_CONTROL_PROOF_NAMES,
  MAC_CONTROL_RUNTIME_NEGATIVE_PROOF_CONTRACT,
  assertMacControlProofSanitized,
  normalizedProofFieldName,
  scanMacControlProofDirectory,
};
