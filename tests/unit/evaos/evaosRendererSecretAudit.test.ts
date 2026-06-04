/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');

describe('evaOS renderer secret audit', () => {
  it('passes for current evaOS trust-surface renderer pages', () => {
    expect(() =>
      execFileSync('node', ['scripts/evaosRendererSecretAudit.js'], {
        cwd: repoRoot,
        encoding: 'utf8',
      })
    ).not.toThrow();
  });
});
