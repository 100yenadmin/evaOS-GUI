/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const retryEligibility = require('../../../scripts/dmgRetryEligibility.js') as {
  clearDmgRetryCompletionMarkers: (appOutDir: string) => void;
  clearDmgRetryCompletionMarkersInDirectory?: (outDir: string) => void;
  clearCompletedAfterPack: (appOutDir: string) => void;
  hasCompletedAfterSign: (appOutDir: string) => boolean;
  isDmgRetryEligible: (appOutDir: string, options?: { multiArch?: boolean }) => boolean;
  markCompletedAfterPack: (appOutDir: string) => void;
  markCompletedAfterSign: (appOutDir: string) => void;
  withAfterSignCompletion: <T>(appOutDir: string, operation: () => Promise<T>) => Promise<T>;
};

describe('DMG retry eligibility', () => {
  it('requires both packaging hooks before retrying a partial app', () => {
    const appOutDir = mkdtempSync(join(tmpdir(), 'evaos-after-pack-'));
    mkdirSync(join(appOutDir, 'evaOS Workbench.app'));

    try {
      expect(retryEligibility.isDmgRetryEligible(appOutDir)).toBe(false);
      retryEligibility.markCompletedAfterPack(appOutDir);
      expect(retryEligibility.isDmgRetryEligible(appOutDir)).toBe(false);
      retryEligibility.markCompletedAfterSign(appOutDir);
      expect(retryEligibility.isDmgRetryEligible(appOutDir)).toBe(true);
    } finally {
      rmSync(appOutDir, { recursive: true, force: true });
    }
  });

  it('clears stale completion from both packaging hooks', () => {
    const appOutDir = mkdtempSync(join(tmpdir(), 'evaos-packaging-hooks-'));

    try {
      retryEligibility.markCompletedAfterPack(appOutDir);
      retryEligibility.markCompletedAfterSign(appOutDir);
      retryEligibility.clearDmgRetryCompletionMarkers(appOutDir);
      expect(retryEligibility.hasCompletedAfterSign(appOutDir)).toBe(false);
      expect(retryEligibility.isDmgRetryEligible(appOutDir)).toBe(false);
    } finally {
      rmSync(appOutDir, { recursive: true, force: true });
    }
  });

  it('clears stale retry markers from every prior macOS app output', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'evaos-stale-packaging-'));
    const appOutDirs = [join(outDir, 'mac-arm64'), join(outDir, 'mac-x64')];

    try {
      expect(retryEligibility.clearDmgRetryCompletionMarkersInDirectory).toBeTypeOf('function');
      if (!retryEligibility.clearDmgRetryCompletionMarkersInDirectory) return;

      for (const appOutDir of appOutDirs) {
        mkdirSync(appOutDir, { recursive: true });
        retryEligibility.markCompletedAfterPack(appOutDir);
        retryEligibility.markCompletedAfterSign(appOutDir);
      }

      retryEligibility.clearDmgRetryCompletionMarkersInDirectory(outDir);
      expect(appOutDirs.every((appOutDir) => !retryEligibility.isDmgRetryEligible(appOutDir))).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('disables single-app DMG retry for multi-architecture builds', () => {
    const appOutDir = mkdtempSync(join(tmpdir(), 'evaos-multi-arch-packaging-'));

    try {
      retryEligibility.markCompletedAfterPack(appOutDir);
      retryEligibility.markCompletedAfterSign(appOutDir);
      expect(retryEligibility.isDmgRetryEligible(appOutDir)).toBe(true);
      expect(retryEligibility.isDmgRetryEligible(appOutDir, { multiArch: true })).toBe(false);
    } finally {
      rmSync(appOutDir, { recursive: true, force: true });
    }
  });

  it('records afterSign completion only after a successful operation', async () => {
    const appOutDir = mkdtempSync(join(tmpdir(), 'evaos-after-sign-success-'));

    try {
      await expect(retryEligibility.withAfterSignCompletion(appOutDir, async () => 'verified')).resolves.toBe(
        'verified'
      );
      expect(retryEligibility.hasCompletedAfterSign(appOutDir)).toBe(true);
    } finally {
      rmSync(appOutDir, { recursive: true, force: true });
    }
  });

  it('leaves afterSign incomplete when the operation fails', async () => {
    const appOutDir = mkdtempSync(join(tmpdir(), 'evaos-after-sign-failure-'));

    try {
      await expect(
        retryEligibility.withAfterSignCompletion(appOutDir, async () => {
          throw new Error('notarization failed');
        })
      ).rejects.toThrow('notarization failed');
      expect(retryEligibility.hasCompletedAfterSign(appOutDir)).toBe(false);
    } finally {
      rmSync(appOutDir, { recursive: true, force: true });
    }
  });
});
