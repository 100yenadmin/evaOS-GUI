#!/usr/bin/env node

const { createHash, createPublicKey, timingSafeEqual, verify } = require('node:crypto');

const PUBLIC_ATTESTATION_SCHEMA = 'evaos.mac_control.public_runtime_attestation.v1';
const PUBLIC_ATTESTATION_ENVELOPE_SCHEMA = 'evaos.mac_control.public_runtime_attestation_envelope.v1';
const PUBLIC_ATTESTATION_NAMESPACE = 'evaos-mac-control-public-attestation-v1';
const PUBLIC_ATTESTATION_ENVELOPE_FIELDS = Object.freeze([
  'schema',
  'attestationBase64',
  'signature',
  'keyId',
  'namespace',
]);
const PUBLIC_ATTESTATION_FIELDS = Object.freeze([
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
]);
const CONNECTOR_CANDIDATE_FIELDS = Object.freeze(['sourceCommit', 'sourceSha256', 'appVersion', 'appBuild']);
const MAX_ATTESTATION_BYTES = 16 * 1024;
const MAX_SIGNATURE_BYTES = 16 * 1024;

function verifyMacControlPublicAttestation(envelope, options = {}) {
  if (!isPlainObject(envelope) || !hasExactKeys(envelope, PUBLIC_ATTESTATION_ENVELOPE_FIELDS)) {
    throw new Error('Mac-control public attestation envelope is invalid.');
  }
  const expectedKeyId = String(options.keyId || '').trim();
  const encodedPublicKey = String(options.publicKey || '').trim();
  if (
    envelope.schema !== PUBLIC_ATTESTATION_ENVELOPE_SCHEMA ||
    envelope.namespace !== PUBLIC_ATTESTATION_NAMESPACE ||
    typeof envelope.keyId !== 'string' ||
    envelope.keyId !== expectedKeyId ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(expectedKeyId) ||
    typeof envelope.signature !== 'string' ||
    envelope.signature.length > MAX_SIGNATURE_BYTES
  ) {
    throw new Error('Mac-control public attestation trust anchor does not match.');
  }

  const publicKey = decodeCanonicalBase64Url(encodedPublicKey, 32);
  const attestationBytes = decodeCanonicalBase64Url(envelope.attestationBase64, MAX_ATTESTATION_BYTES);
  if (!publicKey || publicKey.byteLength !== 32 || !attestationBytes) {
    throw new Error('Mac-control public attestation encoding is invalid.');
  }

  let attestation;
  try {
    attestation = JSON.parse(attestationBytes.toString('utf8'));
  } catch {
    throw new Error('Mac-control public attestation payload is invalid.');
  }
  if (
    !isPlainObject(attestation) ||
    !hasExactKeys(attestation, PUBLIC_ATTESTATION_FIELDS) ||
    attestation.schema !== PUBLIC_ATTESTATION_SCHEMA ||
    attestation.keyId !== expectedKeyId ||
    attestation.namespace !== PUBLIC_ATTESTATION_NAMESPACE ||
    !isPlainObject(attestation.connectorCandidate) ||
    !hasExactKeys(attestation.connectorCandidate, CONNECTOR_CANDIDATE_FIELDS)
  ) {
    throw new Error('Mac-control public attestation contract is invalid.');
  }
  const canonical = canonicalJson(attestation);
  if (!canonical || !timingSafeBufferEqual(attestationBytes, Buffer.from(canonical, 'utf8'))) {
    throw new Error('Mac-control public attestation payload is not canonical.');
  }
  if (!verifySshSignature(attestationBytes, envelope.signature, publicKey, PUBLIC_ATTESTATION_NAMESPACE)) {
    throw new Error('Mac-control public attestation signature is invalid.');
  }
  return attestation;
}

function verifySshSignature(message, armor, pinnedPublicKey, expectedNamespace) {
  const decoded = decodeSshSignatureArmor(armor);
  if (!decoded) return false;
  try {
    const reader = sshReader(decoded);
    if (reader.readRaw(6).toString('ascii') !== 'SSHSIG' || reader.readUInt32() !== 1) return false;
    const publicKeyBlob = reader.readString();
    const namespace = reader.readString().toString('utf8');
    const reserved = reader.readString();
    const hashAlgorithm = reader.readString().toString('ascii');
    const signatureBlob = reader.readString();
    if (!reader.done() || namespace !== expectedNamespace || reserved.byteLength !== 0) return false;

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
      !timingSafeBufferEqual(embeddedPublicKey, pinnedPublicKey) ||
      (hashAlgorithm !== 'sha256' && hashAlgorithm !== 'sha512')
    ) {
      return false;
    }

    const digest = createHash(hashAlgorithm).update(message).digest();
    const signedData = Buffer.concat([
      Buffer.from('SSHSIG', 'ascii'),
      encodeSshString(Buffer.from(namespace, 'utf8')),
      encodeSshString(Buffer.alloc(0)),
      encodeSshString(Buffer.from(hashAlgorithm, 'ascii')),
      encodeSshString(digest),
    ]);
    const publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), embeddedPublicKey]),
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
  if (!match) return undefined;
  const lines = match[1].split('\n').filter(Boolean);
  if (lines.length === 0 || lines.some((line) => line.length > 76 || !/^[A-Za-z0-9+/=]+$/.test(line))) {
    return undefined;
  }
  const joined = lines.join('');
  const decoded = Buffer.from(joined, 'base64');
  return decoded.toString('base64') === joined ? decoded : undefined;
}

function decodeCanonicalBase64Url(value, maxBytes) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxBytes * 2 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return undefined;
  }
  const decoded = Buffer.from(value, 'base64url');
  return decoded.byteLength > 0 && decoded.byteLength <= maxBytes && decoded.toString('base64url') === value
    ? decoded
    : undefined;
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
      if (offset + 4 > buffer.byteLength) throw new Error('invalid SSH signature integer');
      const result = buffer.readUInt32BE(offset);
      offset += 4;
      return result;
    },
    readString() {
      const length = this.readUInt32();
      if (length > MAX_SIGNATURE_BYTES) throw new Error('oversized SSH signature field');
      return this.readRaw(length);
    },
    done() {
      return offset === buffer.byteLength;
    },
  };
}

function encodeSshString(value) {
  const buffer = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(buffer.byteLength, 0);
  return Buffer.concat([length, buffer]);
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

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])])
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  const required = [...expected].sort();
  return keys.length === required.length && keys.every((key, index) => key === required[index]);
}

module.exports = {
  CONNECTOR_CANDIDATE_FIELDS,
  PUBLIC_ATTESTATION_ENVELOPE_FIELDS,
  PUBLIC_ATTESTATION_ENVELOPE_SCHEMA,
  PUBLIC_ATTESTATION_FIELDS,
  PUBLIC_ATTESTATION_NAMESPACE,
  PUBLIC_ATTESTATION_SCHEMA,
  verifyMacControlPublicAttestation,
};
