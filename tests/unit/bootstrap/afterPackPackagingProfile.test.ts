/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

function createLinuxAionCoreResources(appOutDir: string) {
  const runtimeDir = join(appOutDir, 'resources', 'bundled-aioncore', `linux-${process.arch}`);
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, 'aioncore'), '');
  writeFileSync(join(runtimeDir, 'manifest.json'), '{}');
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

  it('fails closed for functional-smoke when hub resources are missing', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    process.env.EVAOS_PACKAGING_PROFILE = 'functional-smoke';
    const { appOutDir, context, tempDir } = createLinuxContext();
    createLinuxAionCoreResources(appOutDir);

    try {
      await expect(afterPack(context)).rejects.toThrow('hub');
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.each([
    { profile: 'thin-shell', releaseFlag: 'EVAOS_FINALIZE_MAC_DMG' },
    { profile: 'thin-shell', releaseFlag: 'EVAOS_BETA_PUBLIC_RELEASE' },
    { profile: 'thin-shell', releaseFlag: 'EVAOS_BETA_REQUIRE_SIGNING' },
    { profile: 'functional-smoke', releaseFlag: 'EVAOS_BETA_REQUIRE_SIGNING' },
    { profile: 'functional-smoke', releaseFlag: 'appleIdPassword' },
    { profile: 'functional-smoke', releaseFlag: 'teamId' },
  ])('rejects $profile when release flag $releaseFlag is set', async ({ profile, releaseFlag }) => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    const oldReleaseFlag = process.env[releaseFlag];
    process.env.EVAOS_PACKAGING_PROFILE = profile;
    process.env[releaseFlag] = 'true';
    const { context, tempDir } = createLinuxContext();

    try {
      await expect(afterPack(context)).rejects.toThrow(releaseFlag);
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      restoreEnv(releaseFlag, oldReleaseFlag);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
