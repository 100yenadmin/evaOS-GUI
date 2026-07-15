import { createHash, createPublicKey, verify } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import canonicalize from 'canonicalize';
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

function assertValidUnicodeString(text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        throw new Error('RFC 8785 forbids lone surrogate code points');
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new Error('RFC 8785 forbids lone surrogate code points');
    }
  }
}

function assertValidUnicode(value: unknown): void {
  if (typeof value === 'string') assertValidUnicodeString(value);
  else if (Array.isArray(value)) value.forEach(assertValidUnicode);
  else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assertValidUnicodeString(key);
      assertValidUnicode(child);
    }
  }
}

function canonicalizeJcs(value: unknown): string {
  assertValidUnicode(value);
  const serialized = canonicalize(value);
  if (serialized === undefined) throw new Error('RFC 8785 canonicalization rejected the contract value');
  return serialized;
}

type AuditGoldenRecord = {
  payload: { sequence: number; previous_record_sha256: string | null } & Record<string, unknown>;
  canonical_payload_utf8: string;
  record_sha256: string;
};

function verifiesAnchoredAuditRecords(
  records: AuditGoldenRecord[],
  anchor: { sequence: number; recordSha256: string } | null
): boolean {
  let previousDigest: string | null = null;
  for (const [index, record] of records.entries()) {
    const canonical = canonicalizeJcs(record.payload);
    if (record.payload.sequence !== index + 1) return false;
    if (record.payload.previous_record_sha256 !== previousDigest) return false;
    if (canonical !== record.canonical_payload_utf8) return false;
    if (createHash('sha256').update(canonical).digest('hex') !== record.record_sha256) return false;
    previousDigest = record.record_sha256;
  }
  if (anchor === null) return true;
  return records.at(-1)?.payload.sequence === anchor.sequence && previousDigest === anchor.recordSha256;
}

function verifiesAuditChainGolden(value: unknown): boolean {
  const parsed = auditChainGoldenSchema.safeParse(value);
  if (!parsed.success) return false;
  return verifiesAnchoredAuditRecords(parsed.data.records as unknown as AuditGoldenRecord[], null);
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

  it('uses RFC 8785 number, escaping, UTF-16 ordering, and Unicode validity rules', () => {
    expect(canonicalizeJcs({ numbers: [Number('333333333.33333329'), 1e30, 4.5, 0.002, 1e-27] })).toBe(
      '{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}'
    );
    expect(canonicalizeJcs({ '€': 'Euro', '\r': 'CR', '1': 'one', '\u0080': 'control', '😀': 'emoji' })).toBe(
      '{"\\r":"CR","1":"one","":"control","€":"Euro","😀":"emoji"}'
    );
    expect(() => canonicalizeJcs({ invalid: '\ud800' })).toThrow('lone surrogate');
  });

  it('keeps authority, status, and audit fixtures on one selected binding', () => {
    const broker = commandAuthorityGoldenSchema.parse(
      readJson(path.join(validRoot, 'authority/command-authority-golden.json'))
    );
    const status = localStatusSchema.parse(readJson(path.join(validRoot, 'state/local-status.json')));
    const audit = readJson(path.join(validRoot, 'audit/audit-event.json')) as {
      binding_fingerprint_sha256: string;
    };
    expect(audit.binding_fingerprint_sha256).toBe(broker.payload.binding.binding_fingerprint_sha256);
    expect(audit.binding_fingerprint_sha256).toBe(status.access.binding?.binding_fingerprint_sha256);
  });

  it('verifies the standalone audit event record digest', () => {
    const event = readJson(path.join(validRoot, 'audit/audit-event.json')) as Record<string, unknown>;
    const { record_sha256: recordSha256, ...payload } = event;
    expect(createHash('sha256').update(canonicalizeJcs(payload)).digest('hex')).toBe(recordSha256);
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

    const tamperedStatus = structuredClone(localStatus);
    if (tamperedStatus.relay_authorization.rollback_authorization === null) {
      throw new Error('Expected rollback authorization fixture');
    }
    tamperedStatus.relay_authorization.rollback_authorization.payload.expires_at = '2026-07-15T10:30:00Z';
    expect(localStatusSchema.safeParse(tamperedStatus).success).toBe(false);
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

  it('rejects a rehashed golden result that is not causally bound to its decision', () => {
    const vector = structuredClone(readJson(path.join(validRoot, 'audit/audit-chain-golden.json'))) as {
      records: AuditGoldenRecord[];
    };
    vector.records[1].payload.command_id = 'unrelated-command';
    vector.records[1].canonical_payload_utf8 = canonicalizeJcs(vector.records[1].payload);
    vector.records[1].record_sha256 = createHash('sha256')
      .update(vector.records[1].canonical_payload_utf8)
      .digest('hex');
    expect(auditChainGoldenSchema.safeParse(vector).success).toBe(false);
    expect(verifiesAuditChainGolden(vector)).toBe(false);
  });

  it('rejects deletion of an audit record from a persisted chain', () => {
    const vector = structuredClone(readJson(path.join(validRoot, 'audit/audit-chain-golden.json'))) as {
      records: unknown[];
    };
    vector.records.splice(0, 1);
    expect(verifiesAuditChainGolden(vector)).toBe(false);
  });

  it('rejects valid-tail truncation and whole-journal replacement against the protected anchor', () => {
    const vector = structuredClone(readJson(path.join(validRoot, 'audit/audit-chain-golden.json'))) as {
      records: AuditGoldenRecord[];
    };
    const anchor = {
      sequence: vector.records[1].payload.sequence,
      recordSha256: vector.records[1].record_sha256,
    };
    expect(verifiesAnchoredAuditRecords(vector.records, anchor)).toBe(true);
    expect(verifiesAnchoredAuditRecords(vector.records.slice(0, 1), anchor)).toBe(false);

    const replacement = structuredClone(vector.records);
    replacement[0].payload.reason_code = 'denied_access_off';
    replacement[0].payload.outcome = 'denied';
    replacement[0].canonical_payload_utf8 = canonicalizeJcs(replacement[0].payload);
    replacement[0].record_sha256 = createHash('sha256').update(replacement[0].canonical_payload_utf8).digest('hex');
    replacement[1].payload.previous_record_sha256 = replacement[0].record_sha256;
    replacement[1].canonical_payload_utf8 = canonicalizeJcs(replacement[1].payload);
    replacement[1].record_sha256 = createHash('sha256').update(replacement[1].canonical_payload_utf8).digest('hex');
    expect(verifiesAnchoredAuditRecords(replacement, null)).toBe(true);
    expect(verifiesAnchoredAuditRecords(replacement, anchor)).toBe(false);
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
