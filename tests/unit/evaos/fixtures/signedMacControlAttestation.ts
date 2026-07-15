import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

export const TEST_RECEIPT_KEY_ID = 'staging-connector-receipt-v1';
export const TEST_CONTEXT_KEY_ID = 'staging-ws-proxy-context-v1';
export const PUBLIC_ATTESTATION_NAMESPACE = 'evaos-mac-control-public-attestation-v1';

type Candidate = {
  sourceCommit: string;
  sourceSha256: string;
  appVersion: string;
  appBuild: string;
};

type FixtureOptions = {
  runRef: string;
  executedAt: string;
  authorityIssuedAt: number;
  authorityExpiresAt: number;
  candidate: Candidate;
  privateReceiptSha256?: string;
  keyId?: string;
  contextKeyId?: string;
  keyPair?: { privateKey: KeyObject; publicKey: KeyObject };
  attestationOverrides?: Record<string, unknown>;
  envelopeOverrides?: Record<string, unknown>;
};

export function signedMacControlAttestation(options: FixtureOptions) {
  const keyPair = options.keyPair ?? generateKeyPairSync('ed25519');
  const keyId = options.keyId ?? TEST_RECEIPT_KEY_ID;
  const contextKeyId = options.contextKeyId ?? TEST_CONTEXT_KEY_ID;
  const attestation = {
    schema: 'evaos.mac_control.public_runtime_attestation.v1',
    keyId,
    namespace: PUBLIC_ATTESTATION_NAMESPACE,
    proofKind: 'selected_binding_direct_mac_control',
    runtime: 'openclaw',
    tool: 'customer_mac.desktop_hotkey',
    outcome: 'succeeded',
    runRef: options.runRef,
    executedAt: options.executedAt,
    authorityIssuedAt: options.authorityIssuedAt,
    authorityExpiresAt: options.authorityExpiresAt,
    contextKeyId,
    controlState: 'ready_unchanged',
    auditRecorded: true,
    privateReceiptSha256: options.privateReceiptSha256 ?? 'f'.repeat(64),
    connectorCandidate: options.candidate,
    ...options.attestationOverrides,
  };
  const attestationBytes = canonicalBytes(attestation);
  const rawPublicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return {
    envelope: {
      schema: 'evaos.mac_control.public_runtime_attestation_envelope.v1',
      attestationBase64: attestationBytes.toString('base64url'),
      signature: sshSignature(attestationBytes, keyPair.privateKey, rawPublicKey),
      keyId,
      namespace: PUBLIC_ATTESTATION_NAMESPACE,
      ...options.envelopeOverrides,
    },
    attestation,
    keyPair,
    trust: {
      receiptKeyId: keyId,
      receiptPublicKey: rawPublicKey.toString('base64url'),
      contextKeyId,
    },
  };
}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(sortJson(value)));
}

function sshSignature(message: Buffer, privateKey: KeyObject, rawPublicKey: Buffer): string {
  const algorithm = Buffer.from('ssh-ed25519');
  const namespace = Buffer.from(PUBLIC_ATTESTATION_NAMESPACE);
  const hashAlgorithm = Buffer.from('sha512');
  const digest = createHash('sha512').update(message).digest();
  const signedData = Buffer.concat([
    Buffer.from('SSHSIG'),
    sshString(namespace),
    sshString(Buffer.alloc(0)),
    sshString(hashAlgorithm),
    sshString(digest),
  ]);
  const signature = sign(null, signedData, privateKey);
  const publicKeyBlob = Buffer.concat([sshString(algorithm), sshString(rawPublicKey)]);
  const signatureBlob = Buffer.concat([sshString(algorithm), sshString(signature)]);
  const binary = Buffer.concat([
    Buffer.from('SSHSIG'),
    uint32(1),
    sshString(publicKeyBlob),
    sshString(namespace),
    sshString(Buffer.alloc(0)),
    sshString(hashAlgorithm),
    sshString(signatureBlob),
  ]);
  const encoded = binary
    .toString('base64')
    .match(/.{1,70}/g)!
    .join('\n');
  return `-----BEGIN SSH SIGNATURE-----\n${encoded}\n-----END SSH SIGNATURE-----\n`;
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function sshString(value: Buffer): Buffer {
  return Buffer.concat([uint32(value.length), value]);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .toSorted()
      .map((key) => [key, sortJson(record[key])])
  );
}
