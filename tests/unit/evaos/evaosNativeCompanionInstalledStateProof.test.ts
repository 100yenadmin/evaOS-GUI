/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../..');
const stateProof = require('../../../scripts/evaosNativeCompanionInstalledStateProof.js') as {
  STATE_MATRIX: Array<{
    state: string;
    settledResult: string;
    screenshot: string;
    markers: string[];
  }>;
  artifactRootForHead: (head: string, env?: Record<string, string | undefined>) => string;
  planEntryForState: (entry: { state: string; settledResult: string; screenshot: string; markers: string[] }) => {
    id: string;
    manifestRowId: string;
    route: string;
    screenshot: string;
    artifactName: string;
    closeoutState: 'loaded' | 'repair';
    waitSelectors: string[];
  };
};

describe('evaOS native companion installed state proof', () => {
  it('exposes a package script for the installed native state matrix', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

    expect(packageJson.scripts['evaos:native-companion-state-proof']).toBe(
      'node scripts/evaosNativeCompanionInstalledStateProof.js'
    );
  });

  it('covers the #179 required installed state matrix with explicit fixture labels', () => {
    expect(stateProof.STATE_MATRIX.map((entry) => entry.state)).toEqual([
      'ready',
      'not_paired',
      'permission_needed',
      'offline',
    ]);

    for (const entry of stateProof.STATE_MATRIX) {
      expect(entry.markers).toContain('Mac & iPhone');
      expect(entry.markers).toContain('LOCAL FIXTURE - NOT LIVE BETA PROOF');
      expect(entry.markers).toContain('Boundary clean');
      expect(entry.screenshot).toMatch(/^native-companion-.+\.png$/);
    }
  });

  it('builds a one-route installed-app proof plan per native state', () => {
    const notPaired = stateProof.STATE_MATRIX.find((entry) => entry.state === 'not_paired');
    expect(notPaired).toBeTruthy();

    const plan = stateProof.planEntryForState(notPaired!);

    expect(plan).toMatchObject({
      id: 'native-companion-not_paired',
      manifestRowId: 'native-companion',
      route: '/native-companion',
      screenshot: 'native-companion-not-paired.png',
      artifactName: 'screenshots/native-companion-not-paired.png',
      closeoutState: 'repair',
    });
    expect(plan.waitSelectors).toEqual(
      expect.arrayContaining(['body:has-text("Pair this Mac")', 'body:has-text("LOCAL FIXTURE - NOT LIVE BETA PROOF")'])
    );
  });

  it('keeps native state matrix artifacts on Lexar by default', () => {
    expect(stateProof.artifactRootForHead('e2299d79907cf8e17bfc9b13c9e95e0ef751aa90')).toBe(
      '/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/native-companion-state-matrix/current-head-e2299d79907c'
    );
  });
});
