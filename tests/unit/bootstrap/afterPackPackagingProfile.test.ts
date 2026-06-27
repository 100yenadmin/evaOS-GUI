/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');
const afterPack = require(join(repoRoot, 'scripts/afterPack.js')) as (context: {
  arch: string;
  appOutDir: string;
  electronPlatformName: string;
  packager?: { appInfo?: { productFilename?: string } };
}) => Promise<void>;

function createLinuxContext() {
  const tempDir = mkdtempSync(join(tmpdir(), 'aionui-afterpack-test-'));
  const appOutDir = join(tempDir, 'app');
  mkdirSync(join(appOutDir, 'resources'), { recursive: true });

  return {
    appOutDir,
    context: {
      arch: process.arch,
      appOutDir,
      electronPlatformName: 'linux',
      packager: { appInfo: { productFilename: 'AionUi' } },
    },
    tempDir,
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value == null) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe('afterPack packaging profile guard', () => {
  it('fails closed for full-resource profiles when bundled runtime resources are missing', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    delete process.env.EVAOS_PACKAGING_PROFILE;
    const { context, tempDir } = createLinuxContext();

    try {
      await expect(afterPack(context)).rejects.toThrow(
        'Packaged app is missing required resource(s): bundled-aioncore'
      );
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('allows thin-shell to skip bundled runtime resource verification', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    process.env.EVAOS_PACKAGING_PROFILE = 'thin-shell';
    const { context, tempDir } = createLinuxContext();

    try {
      await expect(afterPack(context)).resolves.toBeUndefined();
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects thin-shell when release flags are set', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    const oldReleaseFlag = process.env.EVAOS_FINALIZE_MAC_DMG;
    process.env.EVAOS_PACKAGING_PROFILE = 'thin-shell';
    process.env.EVAOS_FINALIZE_MAC_DMG = 'true';
    const { context, tempDir } = createLinuxContext();

    try {
      await expect(afterPack(context)).rejects.toThrow('EVAOS_FINALIZE_MAC_DMG');
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      restoreEnv('EVAOS_FINALIZE_MAC_DMG', oldReleaseFlag);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
