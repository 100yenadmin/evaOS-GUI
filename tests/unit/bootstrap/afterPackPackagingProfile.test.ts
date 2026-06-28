/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');
const DEFAULT_BRIDGE_SOURCE_REF = '207f6528461ecae51c39efd2654733c1b07d39a4';
const { RELEASE_ENV_FLAGS } = require(join(repoRoot, 'scripts/packagingProfile.js')) as {
  RELEASE_ENV_FLAGS: string[];
};
const afterPack = require(join(repoRoot, 'scripts/afterPack.js')) as (context: {
  arch: string;
  appOutDir: string;
  electronPlatformName: string;
  packager?: { appInfo?: { productFilename?: string } };
}) => Promise<void>;
const BRIDGE_ENV_FLAGS = Array.from(
  new Set([...RELEASE_ENV_FLAGS, 'appleId', 'APPLE_ID', 'EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL', 'EVAOS_PACKAGING_PROFILE'])
);
const ORIGINAL_BRIDGE_ENV = new Map(BRIDGE_ENV_FLAGS.map((name) => [name, process.env[name]]));

function clearBridgeTestEnv() {
  for (const name of BRIDGE_ENV_FLAGS) {
    delete process.env[name];
  }
}

function restoreBridgeTestEnv() {
  for (const [name, value] of ORIGINAL_BRIDGE_ENV.entries()) {
    restoreEnv(name, value);
  }
}

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

function createDarwinContext(arch = process.arch) {
  const tempDir = mkdtempSync(join(tmpdir(), 'aionui-afterpack-darwin-test-'));
  const appOutDir = join(tempDir, 'mac-arm64');
  mkdirSync(join(appOutDir, 'AionUi.app', 'Contents', 'Resources'), { recursive: true });

  return {
    appOutDir,
    context: {
      arch,
      appOutDir,
      electronPlatformName: 'darwin',
      packager: { appInfo: { productFilename: 'AionUi' } },
    },
    resourcesDir: join(appOutDir, 'AionUi.app', 'Contents', 'Resources'),
    tempDir,
  };
}

function createLinuxAionCoreResources(appOutDir: string, manifest: Record<string, unknown> = {}) {
  const runtimeDir = join(appOutDir, 'resources', 'bundled-aioncore', `linux-${process.arch}`);
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, 'aioncore'), '');
  writeFileSync(join(runtimeDir, 'manifest.json'), JSON.stringify(manifest));
  return runtimeDir;
}

function createCompleteHubResources(appOutDir: string) {
  createCompleteHubResourcesIn(join(appOutDir, 'resources'));
}

function createCompleteHubResourcesIn(resourcesDir: string) {
  const hubDir = join(resourcesDir, 'hub');
  mkdirSync(hubDir, { recursive: true });
  writeFileSync(join(hubDir, 'index.json'), '{"extensions":{}}');
  writeFileSync(join(hubDir, 'manifest.json'), '{"extensions":[]}');
  writeFileSync(join(hubDir, 'extension.zip'), '');
}

function writeExecutableFile(filePath: string, contents: string | Buffer = '#!/bin/sh\nexit 0\n') {
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
}

function createMachOHeader(arch: string) {
  const cpuType = arch === 'arm64' ? 0x0100000c : arch === 'arm64_32' ? 0x0200000c : 0x01000007;
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  buffer.writeUInt32LE(cpuType, 4);
  return buffer;
}

function createDarwinAionCoreResources(resourcesDir: string, arch = process.arch) {
  const runtimeDir = join(resourcesDir, 'bundled-aioncore', `darwin-${arch}`);
  mkdirSync(runtimeDir, { recursive: true });
  writeExecutableFile(join(runtimeDir, 'aioncore'));
  writeFileSync(
    join(runtimeDir, 'manifest.json'),
    JSON.stringify({
      runtimeKey: `darwin-${arch}`,
      managedResourcesBundle: 'full',
      managedResourcesBundleResult: {
        mode: 'full',
        prunedResources: [],
      },
      resourceShape: {
        managedResources: { present: false },
        managedNodeRuntime: { present: false },
      },
    })
  );
}

function createCompleteBridgeResources(
  resourcesDir: string,
  manifest: Record<string, unknown> = { placeholder: false },
  helperArch?: string
) {
  const bridgeDir = join(resourcesDir, 'Bridge');
  const helperContents = helperArch ? createMachOHeader(helperArch) : undefined;
  mkdirSync(join(bridgeDir, 'bin'), { recursive: true });
  writeExecutableFile(join(bridgeDir, 'evaos-desktop-bridge'));
  writeExecutableFile(join(bridgeDir, 'bin', 'peekaboo'), helperContents);
  writeExecutableFile(join(bridgeDir, 'bin', 'evaos-connector-helper'), helperContents);
  writeFileSync(
    join(bridgeDir, 'manifest.json'),
    JSON.stringify({
      schema: 'evaos-desktop-bridge-resource/v1',
      sourceCommit: DEFAULT_BRIDGE_SOURCE_REF,
      ...manifest,
    })
  );
}

function restoreEnv(name: string, value: string | undefined) {
  if (value == null) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

const itDarwinExecutable = process.platform === 'win32' ? it.skip : it;

describe('afterPack packaging profile guard', () => {
  beforeEach(() => {
    clearBridgeTestEnv();
  });

  afterEach(() => {
    restoreBridgeTestEnv();
  });

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

  itDarwinExecutable('verifies real evaOS desktop Bridge resources for macOS functional-smoke builds', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    process.env.EVAOS_PACKAGING_PROFILE = 'functional-smoke';
    const { context, resourcesDir, tempDir } = createDarwinContext();
    createDarwinAionCoreResources(resourcesDir);
    createCompleteHubResourcesIn(resourcesDir);
    createCompleteBridgeResources(resourcesDir);

    try {
      await expect(afterPack(context)).resolves.toBeUndefined();
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  itDarwinExecutable('rejects executable Bridge resource directories in macOS functional-smoke builds', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    process.env.EVAOS_PACKAGING_PROFILE = 'functional-smoke';
    const { context, resourcesDir, tempDir } = createDarwinContext();
    createDarwinAionCoreResources(resourcesDir);
    createCompleteHubResourcesIn(resourcesDir);
    createCompleteBridgeResources(resourcesDir);
    rmSync(join(resourcesDir, 'Bridge', 'evaos-desktop-bridge'));
    mkdirSync(join(resourcesDir, 'Bridge', 'evaos-desktop-bridge'));

    try {
      await expect(afterPack(context)).rejects.toThrow('Packaged resource is not a file');
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  itDarwinExecutable('fails closed when macOS non-thin packages omit Bridge resources', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    process.env.EVAOS_PACKAGING_PROFILE = 'functional-smoke';
    const { context, resourcesDir, tempDir } = createDarwinContext();
    createDarwinAionCoreResources(resourcesDir);
    createCompleteHubResourcesIn(resourcesDir);

    try {
      await expect(afterPack(context)).rejects.toThrow('evaOS desktop bridge resource');
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  itDarwinExecutable('rejects diagnostic placeholder Bridge resources in functional-smoke builds', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    process.env.EVAOS_PACKAGING_PROFILE = 'functional-smoke';
    const { context, resourcesDir, tempDir } = createDarwinContext();
    createDarwinAionCoreResources(resourcesDir);
    createCompleteHubResourcesIn(resourcesDir);
    createCompleteBridgeResources(resourcesDir, { placeholder: true });

    try {
      await expect(afterPack(context)).rejects.toThrow('diagnostic placeholder');
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  itDarwinExecutable('rejects stale Bridge manifests that do not match the expected source ref', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    process.env.EVAOS_PACKAGING_PROFILE = 'functional-smoke';
    const { context, resourcesDir, tempDir } = createDarwinContext();
    createDarwinAionCoreResources(resourcesDir);
    createCompleteHubResourcesIn(resourcesDir);
    createCompleteBridgeResources(resourcesDir, {
      placeholder: false,
      sourceCommit: '0000000000000000000000000000000000000000',
    });

    try {
      await expect(afterPack(context)).rejects.toThrow('does not match expected ref');
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  itDarwinExecutable('requires native Mach-O Bridge helpers for release-like builds', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    const oldAppleId = process.env.appleId;
    process.env.EVAOS_PACKAGING_PROFILE = 'full';
    process.env.appleId = 'release@example.test';
    const { context, resourcesDir, tempDir } = createDarwinContext();
    createDarwinAionCoreResources(resourcesDir);
    createCompleteHubResourcesIn(resourcesDir);
    createCompleteBridgeResources(resourcesDir);

    try {
      await expect(afterPack(context)).rejects.toThrow('native Mach-O executable');
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      restoreEnv('appleId', oldAppleId);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  itDarwinExecutable('requires matching-architecture Mach-O Bridge helpers for release-like builds', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    const oldAppleId = process.env.appleId;
    const wrongArch = process.arch === 'arm64' ? 'x64' : 'arm64';
    process.env.EVAOS_PACKAGING_PROFILE = 'full';
    process.env.appleId = 'release@example.test';
    const { context, resourcesDir, tempDir } = createDarwinContext();
    createDarwinAionCoreResources(resourcesDir);
    createCompleteHubResourcesIn(resourcesDir);
    createCompleteBridgeResources(resourcesDir, { placeholder: false }, wrongArch);

    try {
      await expect(afterPack(context)).rejects.toThrow(`to contain ${process.arch} Mach-O code`);
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      restoreEnv('appleId', oldAppleId);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  itDarwinExecutable('rejects ARM64_32 Mach-O Bridge helpers for arm64 release-like builds', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    const oldAppleId = process.env.appleId;
    process.env.EVAOS_PACKAGING_PROFILE = 'full';
    process.env.appleId = 'release@example.test';
    const { context, resourcesDir, tempDir } = createDarwinContext('arm64');
    createDarwinAionCoreResources(resourcesDir, 'arm64');
    createCompleteHubResourcesIn(resourcesDir);
    createCompleteBridgeResources(resourcesDir, { placeholder: false }, 'arm64_32');

    try {
      await expect(afterPack(context)).rejects.toThrow('to contain arm64 Mach-O code');
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      restoreEnv('appleId', oldAppleId);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  itDarwinExecutable('accepts matching-architecture Mach-O Bridge helpers for release-like builds', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    const oldAppleId = process.env.appleId;
    process.env.EVAOS_PACKAGING_PROFILE = 'full';
    process.env.appleId = 'release@example.test';
    const { context, resourcesDir, tempDir } = createDarwinContext();
    createDarwinAionCoreResources(resourcesDir);
    createCompleteHubResourcesIn(resourcesDir);
    createCompleteBridgeResources(resourcesDir, { placeholder: false }, process.arch);

    try {
      await expect(afterPack(context)).resolves.toBeUndefined();
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      restoreEnv('appleId', oldAppleId);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('allows no-acp managed-resource bundles when required runtime resources are present', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    process.env.EVAOS_PACKAGING_PROFILE = 'functional-smoke';
    const { appOutDir, context, tempDir } = createLinuxContext();
    const runtimeDir = createLinuxAionCoreResources(appOutDir, {
      runtimeKey: `linux-${process.arch}`,
      managedResourcesBundle: 'no-acp',
      managedResourcesBundleResult: {
        mode: 'no-acp',
        managedResourcesPath: 'managed-resources',
        sourceResources: ['acp/', 'acp/claude/', 'acp/codex-cli/', 'acp/gemini/'],
        prunedResources: ['acp/claude/', 'acp/codex-cli/'],
        keptResources: ['acp/', 'acp/gemini/'],
      },
      sourceResourceShape: {
        managedNodeRuntime: { present: true, relativePath: 'managed-node' },
      },
      resourceShape: {
        managedResources: { present: true, relativePath: 'managed-resources' },
        managedNodeRuntime: { present: true, relativePath: 'managed-node' },
      },
    });
    mkdirSync(join(runtimeDir, 'managed-node'), { recursive: true });
    mkdirSync(join(runtimeDir, 'managed-resources', 'acp', 'gemini'), { recursive: true });
    createCompleteHubResources(appOutDir);

    try {
      await expect(afterPack(context)).resolves.toBeUndefined();
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails closed when the AionCore manifest declares managed Node but packaging drops it', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    process.env.EVAOS_PACKAGING_PROFILE = 'functional-smoke';
    const { appOutDir, context, tempDir } = createLinuxContext();
    createLinuxAionCoreResources(appOutDir, {
      runtimeKey: `linux-${process.arch}`,
      managedResourcesBundle: 'no-acp',
      managedResourcesBundleResult: {
        mode: 'no-acp',
        managedResourcesPath: 'managed-resources',
        sourceResources: [],
        prunedResources: [],
        keptResources: [],
      },
      sourceResourceShape: {
        managedNodeRuntime: { present: true, relativePath: 'managed-node' },
      },
      resourceShape: {
        managedNodeRuntime: { present: true, relativePath: 'managed-node' },
      },
    });
    createCompleteHubResources(appOutDir);

    try {
      await expect(afterPack(context)).rejects.toThrow('managed-node');
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails closed when no-acp manifest records non-ACP managed-resource pruning', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    process.env.EVAOS_PACKAGING_PROFILE = 'functional-smoke';
    const { appOutDir, context, tempDir } = createLinuxContext();
    createLinuxAionCoreResources(appOutDir, {
      runtimeKey: `linux-${process.arch}`,
      managedResourcesBundle: 'no-acp',
      managedResourcesBundleResult: {
        mode: 'no-acp',
        managedResourcesPath: 'managed-resources',
        sourceResources: ['tools/', 'tools/codex.json'],
        prunedResources: ['tools/codex.json'],
        keptResources: ['tools/'],
      },
      resourceShape: {
        managedNodeRuntime: { present: false },
      },
    });
    createCompleteHubResources(appOutDir);

    try {
      await expect(afterPack(context)).rejects.toThrow('unexpected non-ACP managed-resource prune');
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails closed when no-acp kept managed resources are missing from the package', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    process.env.EVAOS_PACKAGING_PROFILE = 'functional-smoke';
    const { appOutDir, context, tempDir } = createLinuxContext();
    createLinuxAionCoreResources(appOutDir, {
      runtimeKey: `linux-${process.arch}`,
      managedResourcesBundle: 'no-acp',
      managedResourcesBundleResult: {
        mode: 'no-acp',
        managedResourcesPath: 'managed-resources',
        sourceResources: ['acp/', 'acp/claude/', 'acp/gemini/'],
        prunedResources: ['acp/claude/'],
        keptResources: ['acp/', 'acp/gemini/'],
      },
      resourceShape: {
        managedResources: { present: true, relativePath: 'managed-resources' },
        managedNodeRuntime: { present: false },
      },
    });
    mkdirSync(join(appOutDir, 'resources', 'bundled-aioncore', `linux-${process.arch}`, 'managed-resources', 'acp'), {
      recursive: true,
    });
    createCompleteHubResources(appOutDir);

    try {
      await expect(afterPack(context)).rejects.toThrow('managed-resources/acp/gemini');
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses normalized no-acp manifest mode when checking pruned managed resources', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    process.env.EVAOS_PACKAGING_PROFILE = 'functional-smoke';
    const { appOutDir, context, tempDir } = createLinuxContext();
    const runtimeDir = createLinuxAionCoreResources(appOutDir, {
      runtimeKey: `linux-${process.arch}`,
      managedResourcesBundle: ' no-acp ',
      managedResourcesBundleResult: {
        mode: 'no-acp',
        managedResourcesPath: 'managed-resources',
        sourceResources: ['acp/', 'acp/claude/', 'acp/gemini/'],
        prunedResources: ['acp/claude/'],
        keptResources: ['acp/', 'acp/gemini/'],
      },
      resourceShape: {
        managedResources: { present: true, relativePath: 'managed-resources' },
        managedNodeRuntime: { present: false },
      },
    });
    mkdirSync(join(runtimeDir, 'managed-resources', 'acp', 'claude'), { recursive: true });
    mkdirSync(join(runtimeDir, 'managed-resources', 'acp', 'gemini'), { recursive: true });
    createCompleteHubResources(appOutDir);

    try {
      await expect(afterPack(context)).rejects.toThrow('pruned managed resource still packaged');
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails closed when no-acp ACP agent resources are packaged but omitted from manifest inventory', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    process.env.EVAOS_PACKAGING_PROFILE = 'functional-smoke';
    const { appOutDir, context, tempDir } = createLinuxContext();
    const runtimeDir = createLinuxAionCoreResources(appOutDir, {
      runtimeKey: `linux-${process.arch}`,
      managedResourcesBundle: 'no-acp',
      managedResourcesBundleResult: {
        mode: 'no-acp',
        managedResourcesPath: 'managed-resources',
        sourceResources: ['acp/', 'acp/gemini/'],
        prunedResources: [],
        keptResources: ['acp/', 'acp/gemini/'],
      },
      resourceShape: {
        managedResources: { present: true, relativePath: 'managed-resources' },
        managedNodeRuntime: { present: false },
      },
    });
    mkdirSync(join(runtimeDir, 'managed-resources', 'acp', 'claude'), { recursive: true });
    mkdirSync(join(runtimeDir, 'managed-resources', 'acp', 'gemini'), { recursive: true });
    createCompleteHubResources(appOutDir);

    try {
      await expect(afterPack(context)).rejects.toThrow('forbidden no-acp managed resource');
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails closed when no-acp ACP agent resources are packaged but managedResourcesPath is omitted', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    process.env.EVAOS_PACKAGING_PROFILE = 'functional-smoke';
    const { appOutDir, context, tempDir } = createLinuxContext();
    const runtimeDir = createLinuxAionCoreResources(appOutDir, {
      runtimeKey: `linux-${process.arch}`,
      managedResourcesBundle: 'no-acp',
      managedResourcesBundleResult: {
        mode: 'no-acp',
        sourceResources: ['acp/', 'acp/gemini/'],
        prunedResources: [],
        keptResources: ['acp/', 'acp/gemini/'],
      },
      resourceShape: {
        managedResources: { present: true, relativePath: 'managed-resources' },
        managedNodeRuntime: { present: false },
      },
    });
    mkdirSync(join(runtimeDir, 'managed-resources', 'acp', 'claude'), { recursive: true });
    mkdirSync(join(runtimeDir, 'managed-resources', 'acp', 'gemini'), { recursive: true });
    createCompleteHubResources(appOutDir);

    try {
      await expect(afterPack(context)).rejects.toThrow('managed-resources/acp/claude');
    } finally {
      restoreEnv('EVAOS_PACKAGING_PROFILE', oldProfile);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails closed when hub resources are incomplete', async () => {
    const oldProfile = process.env.EVAOS_PACKAGING_PROFILE;
    process.env.EVAOS_PACKAGING_PROFILE = 'functional-smoke';
    const { appOutDir, context, tempDir } = createLinuxContext();
    createLinuxAionCoreResources(appOutDir, {
      runtimeKey: `linux-${process.arch}`,
      managedResourcesBundle: 'full',
      managedResourcesBundleResult: {
        mode: 'full',
        prunedResources: [],
      },
      resourceShape: {
        managedNodeRuntime: { present: false },
      },
    });
    mkdirSync(join(appOutDir, 'resources', 'hub'), { recursive: true });
    writeFileSync(join(appOutDir, 'resources', 'hub', 'index.json'), '{}');
    writeFileSync(join(appOutDir, 'resources', 'hub', 'manifest.json'), '{}');

    try {
      await expect(afterPack(context)).rejects.toThrow('hub/*.zip');
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
