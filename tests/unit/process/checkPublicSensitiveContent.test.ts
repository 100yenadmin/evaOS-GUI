/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

const scanner = require('../../../scripts/security/check-public-sensitive-content.js') as {
  scanPath: (filePath: string) => Array<{ ruleId: string; message: string }>;
  scanText: (input: {
    filePath: string;
    text: string;
  }) => Array<{ line: number; ruleId: string; message: string; preview: string }>;
};

describe('check-public-sensitive-content', () => {
  const fakeAppleEmail = 'developer@example.com';
  const fakeAppleTeamId = 'AB12CD34EF';
  const fakeOpenAiKey = ['sk', 'abc123def456ghi789jkl012'].join('-');

  it('flags public Apple account defaults without echoing the sensitive value', () => {
    const findings = scanner.scanText({
      filePath: 'mobile/eas.json',
      text: ['{', `  "appleId": "${fakeAppleEmail}",`, `  "appleTeamId": "${fakeAppleTeamId}"`, '}'].join('\n'),
    });

    expect(findings.map((finding) => finding.ruleId)).toEqual([
      'hardcoded-apple-account-id',
      'hardcoded-apple-team-id',
    ]);
    expect(findings.map((finding) => finding.line)).toEqual([2, 3]);
    expect(JSON.stringify(findings)).not.toContain(fakeAppleEmail);
    expect(JSON.stringify(findings)).not.toContain(fakeAppleTeamId);
  });

  it('flags encrypted PKCS#8 private key headers', () => {
    expect(
      scanner.scanText({
        filePath: 'docs/private-key.md',
        text: ['-----BEGIN ENCRYPTED', 'PRIVATE KEY-----'].join(' '),
      })
    ).toEqual([
      expect.objectContaining({
        line: 1,
        ruleId: 'private-key-material',
      }),
    ]);
  });

  it('allows known fake provider-key fixtures only in exact test files', () => {
    expect(
      scanner.scanText({
        filePath: 'tests/unit/common/protocolDetector.test.ts',
        text: `expect(guessProtocolFromKey('${fakeOpenAiKey}')).toBe('openai');`,
      })
    ).toEqual([]);

    expect(
      scanner.scanText({
        filePath: 'packages/desktop/src/common/leak.ts',
        text: `export const apiKey = '${fakeOpenAiKey}';`,
      })
    ).toEqual([
      expect.objectContaining({
        line: 1,
        ruleId: 'openai-api-key',
      }),
    ]);
  });

  it('flags risky tracked file names before content inspection', () => {
    expect(scanner.scanPath('config/service-account.prod.json')).toEqual([
      expect.objectContaining({
        ruleId: 'risky-tracked-file-name',
      }),
    ]);
    expect(scanner.scanPath('tests/unit/common/protocolDetector.test.ts')).toEqual([]);
  });
});
