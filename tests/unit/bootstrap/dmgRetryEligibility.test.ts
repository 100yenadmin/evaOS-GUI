/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const { hasCompletedAfterPack, markCompletedAfterPack } = require('../../../scripts/dmgRetryEligibility.js') as {
  hasCompletedAfterPack: (appOutDir: string) => boolean;
  markCompletedAfterPack: (appOutDir: string) => void;
};

describe('DMG retry eligibility', () => {
  it('rejects a partial app until afterPack completes successfully', () => {
    const appOutDir = mkdtempSync(join(tmpdir(), 'evaos-after-pack-'));
    mkdirSync(join(appOutDir, 'evaOS Workbench.app'));

    try {
      expect(hasCompletedAfterPack(appOutDir)).toBe(false);
      markCompletedAfterPack(appOutDir);
      expect(hasCompletedAfterPack(appOutDir)).toBe(true);
    } finally {
      rmSync(appOutDir, { recursive: true, force: true });
    }
  });
});
