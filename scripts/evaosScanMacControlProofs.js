#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const MAC_CONTROL_PROOF_NAMES = Object.freeze([
  'mac-control-runtime.json',
  'mac-control-runtime-negative.json',
  'mac-control-session-provisioning.json',
  'mac-control-session-provisioning.stdout.json',
  'mac-control-session-cleanup.json',
  'mac-control-session-cleanup.stdout.json',
]);
const MAC_CONTROL_PROOF_CONTRACTS = Object.freeze({
  'mac-control-runtime.json': {
    schema: 'evaos.mac_control.runtime_proof.v2',
    fields: [
      'ok',
      'schema',
      'proofKind',
      'tool',
      'outcome',
      'runRef',
      'executedAt',
      'bindingRef',
      'bindingVersion',
      'sessionRef',
      'expiresAt',
      'auditRef',
      'sourcePointer',
      'candidate',
    ],
    nested: {
      candidate: {
        fields: ['sourceCommit', 'sourceSha256', 'appVersion', 'appBuild'],
      },
    },
  },
  'mac-control-runtime-negative.json': {
    schema: 'evaos.mac_control.runtime_receipt_negative_proof.v1',
    fields: ['schema', 'sourceHeadSha', 'sourceRunId', 'assertions'],
    nested: {
      assertions: {
        fields: ['forgedContextRejected', 'expiredContextRejected', 'replayRejected', 'authorityRedacted'],
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

function scanMacControlProofDirectory(proofDir) {
  const resolvedProofDir = path.resolve(String(proofDir || ''));
  let scanned = 0;
  for (const proofName of MAC_CONTROL_PROOF_NAMES) {
    const proofPath = path.join(resolvedProofDir, proofName);
    if (!fs.existsSync(proofPath)) {
      throw new Error(`Mac-control proof is missing required artifact ${proofName}.`);
    }
    const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
    assertMacControlProofSanitized(proof, proofName);
    const contract = MAC_CONTROL_PROOF_CONTRACTS[proofName];
    if (!contract || proof.schema !== contract.schema) {
      throw new Error(`Mac-control proof has an unexpected schema in ${proofName}.`);
    }
    assertExactProofContract(proof, contract, proofName);
    scanned += 1;
  }
  const cleanupPath = path.join(resolvedProofDir, 'mac-control-session-cleanup.json');
  const cleanupProof = JSON.parse(fs.readFileSync(cleanupPath, 'utf8'));
  if (
    cleanupProof.schema !== 'evaos-mac-control-canary-session-cleanup/v1' ||
    cleanupProof.sessionRevoked !== true ||
    cleanupProof.sensitiveOutput !== 'passed'
  ) {
    throw new Error('Mac-control proof did not prove temporary session revocation.');
  }
  return { ok: true, scanned };
}

if (require.main === module) {
  const proofDir = process.argv[2];
  if (!proofDir) throw new Error('Mac-control proof directory is required.');
  scanMacControlProofDirectory(proofDir);
}

module.exports = {
  MAC_CONTROL_PROOF_NAMES,
  assertMacControlProofSanitized,
  normalizedProofFieldName,
  scanMacControlProofDirectory,
};
