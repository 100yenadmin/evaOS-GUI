import { createHash, createPublicKey, verify } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  auditChainGoldenSchema,
  commandAuthorityGoldenSchema,
  localStatusSchema,
  MAC_ACCESS_IDENTITIES,
  rollbackAuthorizationGoldenSchema,
} from '../../packages/mac-connector-core/contracts/v1';

const contractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../packages/mac-connector-core/contracts/v1'
);
const validRoot = path.join(contractRoot, 'fixtures/valid');
const goldenRoot = path.join(contractRoot, 'golden');

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function canonicalizeJcs(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeJcs).join(',')}]`;
  return `{${Object.entries(value)
    // oxlint-disable-next-line unicorn/no-array-sort -- Object.entries returns a fresh array required for JCS key order.
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeJcs(item)}`)
    .join(',')}}`;
}

function verifiesAuditChainGolden(value: unknown): boolean {
  const parsed = auditChainGoldenSchema.safeParse(value);
  if (!parsed.success) return false;

  let previousDigest: string | null = null;
  for (const [index, record] of parsed.data.records.entries()) {
    const canonical = canonicalizeJcs(record.payload);
    if (record.payload.sequence !== index + 1) return false;
    if (record.payload.previous_record_sha256 !== previousDigest) return false;
    if (canonical !== record.canonical_payload_utf8) return false;
    if (createHash('sha256').update(canonical).digest('hex') !== record.record_sha256) return false;
    previousDigest = record.record_sha256;
  }
  return true;
}

describe('evaOS Mac Access canonical cryptographic contracts', () => {
  it('freezes designated-requirement bytes and digests', () => {
    const pairs = [
      [MAC_ACCESS_IDENTITIES.appDesignatedRequirement, MAC_ACCESS_IDENTITIES.appDesignatedRequirementSha256],
      [MAC_ACCESS_IDENTITIES.helperDesignatedRequirement, MAC_ACCESS_IDENTITIES.helperDesignatedRequirementSha256],
      [
        MAC_ACCESS_IDENTITIES.connectorDesignatedRequirement,
        MAC_ACCESS_IDENTITIES.connectorDesignatedRequirementSha256,
      ],
      [
        MAC_ACCESS_IDENTITIES.workbenchDesignatedRequirement,
        MAC_ACCESS_IDENTITIES.workbenchDesignatedRequirementSha256,
      ],
      [
        MAC_ACCESS_IDENTITIES.legacyWorkbenchDesignatedRequirement,
        MAC_ACCESS_IDENTITIES.legacyWorkbenchDesignatedRequirementSha256,
      ],
    ] as const;
    for (const [requirement, digest] of pairs) {
      expect(createHash('sha256').update(requirement).digest('hex')).toBe(digest);
    }
  });

  it('verifies the cross-language command authorization golden vector', () => {
    const vector = commandAuthorityGoldenSchema.parse(
      readJson(path.join(validRoot, 'authority/command-authority-golden.json'))
    );
    const canonical = canonicalizeJcs(vector.payload);
    expect(canonical).toBe(vector.canonical_payload_utf8);
    expect(createHash('sha256').update(canonical).digest('hex')).toBe(vector.payload_sha256);
    const publicKey = createPublicKey({
      key: Buffer.from(vector.public_key_spki_base64url, 'base64url'),
      format: 'der',
      type: 'spki',
    });
    expect(verify(null, Buffer.from(canonical), publicKey, Buffer.from(vector.signature_base64url, 'base64url'))).toBe(
      true
    );
  });

  it('verifies the two-record audit-chain golden vector', () => {
    expect(verifiesAuditChainGolden(readJson(path.join(validRoot, 'audit/audit-chain-golden.json')))).toBe(true);
  });

  it('verifies the exact-target rollback authorization golden vector', () => {
    const vector = rollbackAuthorizationGoldenSchema.parse(
      readJson(path.join(goldenRoot, 'rollback-authorization-golden.json'))
    );
    const canonical = canonicalizeJcs(vector.payload);
    expect(canonical).toBe(vector.canonical_payload_utf8);
    expect(createHash('sha256').update(canonical).digest('hex')).toBe(vector.payload_sha256);
    const publicKey = createPublicKey({
      key: Buffer.from(vector.public_key_spki_base64url, 'base64url'),
      format: 'der',
      type: 'spki',
    });
    expect(verify(null, Buffer.from(canonical), publicKey, Buffer.from(vector.signature_base64url, 'base64url'))).toBe(
      true
    );

    const {
      canonical_payload_utf8: _canonicalPayload,
      public_key_spki_base64url: _publicKey,
      ...signedVector
    } = vector;
    const localStatus = localStatusSchema.parse(readJson(path.join(validRoot, 'state/local-status.json')));
    expect(localStatus.relay_authorization.rollback_authorization).toEqual(signedVector);
  });

  it('rejects rollback payload, digest, signature, and key substitution', () => {
    const vector = rollbackAuthorizationGoldenSchema.parse(
      readJson(path.join(goldenRoot, 'rollback-authorization-golden.json'))
    );
    const publicKey = createPublicKey({
      key: Buffer.from(vector.public_key_spki_base64url, 'base64url'),
      format: 'der',
      type: 'spki',
    });
    const tamperedPayload = {
      ...vector.payload,
      target: { ...vector.payload.target, source_commit: 'cccccccccccccccccccccccccccccccccccccccc' },
    };
    const tamperedCanonical = canonicalizeJcs(tamperedPayload);
    expect(createHash('sha256').update(tamperedCanonical).digest('hex')).not.toBe(vector.payload_sha256);
    expect(
      verify(null, Buffer.from(tamperedCanonical), publicKey, Buffer.from(vector.signature_base64url, 'base64url'))
    ).toBe(false);

    const tamperedSignature = Buffer.from(vector.signature_base64url, 'base64url');
    tamperedSignature[0] ^= 1;
    expect(verify(null, Buffer.from(vector.canonical_payload_utf8), publicKey, tamperedSignature)).toBe(false);

    const commandVector = commandAuthorityGoldenSchema.parse(
      readJson(path.join(validRoot, 'authority/command-authority-golden.json'))
    );
    const wrongKey = createPublicKey({
      key: Buffer.from(commandVector.public_key_spki_base64url, 'base64url'),
      format: 'der',
      type: 'spki',
    });
    expect(
      verify(
        null,
        Buffer.from(vector.canonical_payload_utf8),
        wrongKey,
        Buffer.from(vector.signature_base64url, 'base64url')
      )
    ).toBe(false);
  });

  it('rejects an edited audit payload whose record digest is unchanged', () => {
    const vector = structuredClone(readJson(path.join(validRoot, 'audit/audit-chain-golden.json'))) as {
      records: Array<{ payload: { reason_code: string } }>;
    };
    vector.records[0].payload.reason_code = 'tampered_reason';
    expect(verifiesAuditChainGolden(vector)).toBe(false);
  });

  it('rejects deletion of an audit record from a persisted chain', () => {
    const vector = structuredClone(readJson(path.join(validRoot, 'audit/audit-chain-golden.json'))) as {
      records: unknown[];
    };
    vector.records.splice(0, 1);
    expect(verifiesAuditChainGolden(vector)).toBe(false);
  });

  it('rejects reordered audit records', () => {
    const vector = structuredClone(readJson(path.join(validRoot, 'audit/audit-chain-golden.json'))) as {
      records: unknown[];
    };
    vector.records.reverse();
    expect(verifiesAuditChainGolden(vector)).toBe(false);
  });

  it('rejects a previous-record digest mismatch', () => {
    const vector = structuredClone(readJson(path.join(validRoot, 'audit/audit-chain-golden.json'))) as {
      records: Array<{ payload: { previous_record_sha256: string | null } }>;
    };
    vector.records[1].payload.previous_record_sha256 = '0'.repeat(64);
    expect(verifiesAuditChainGolden(vector)).toBe(false);
  });
});
