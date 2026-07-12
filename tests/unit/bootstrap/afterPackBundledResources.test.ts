import { createRequire } from 'node:module';
import { chmodSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const afterPack = require('../../../scripts/afterPack.js') as {
  isMachOExecutable: (filePath: string) => boolean;
  verifyBundledResources: (resourcesDir: string, electronPlatformName: string, targetArch: string) => void;
  verifyEvaosDesktopBridgeResource: (resourcesDir: string, electronPlatformName: string) => void;
};

const tempDirs: string[] = [];

function makeTempResources(): string {
  const dir = mkdtempSync(join(tmpdir(), 'evaos-afterpack-'));
  tempDirs.push(dir);
  return dir;
}

function writeRuntimeFixture(resourcesDir: string, runtimeKey: string, options: { nodePath?: string } = {}): string {
  const runtimeDir = join(resourcesDir, 'bundled-aioncore', runtimeKey);
  mkdirSync(join(runtimeDir, 'managed-resources'), { recursive: true });
  writeFileSync(join(runtimeDir, runtimeKey.startsWith('win32-') ? 'aioncore.exe' : 'aioncore'), '');
  writeFileSync(join(runtimeDir, 'manifest.json'), '{}');
  if (options.nodePath) {
    const nodePath = join(runtimeDir, 'managed-resources', 'node', options.nodePath);
    mkdirSync(join(nodePath, '..'), { recursive: true });
    writeFileSync(nodePath, '');
  }
  return runtimeDir;
}

function writeExecutableScript(path: string): void {
  writeFileSync(path, '#!/bin/sh\nexit 0\n');
  chmodSync(path, 0o755);
}

function writeMachOFixture(path: string): void {
  writeFileSync(path, Buffer.from('cffaedfe00000000', 'hex'));
  chmodSync(path, 0o755);
}

function writeBridgeFixture(resourcesDir: string, options: { helper?: boolean; nativeHelpers?: boolean } = {}): void {
  const bridgeDir = join(resourcesDir, 'Bridge');
  mkdirSync(join(bridgeDir, 'bin'), { recursive: true });
  const bridgePath = join(bridgeDir, 'evaos-desktop-bridge');
  const peekabooPath = join(bridgeDir, 'bin', 'peekaboo');
  writeExecutableScript(bridgePath);
  if (options.nativeHelpers) {
    writeMachOFixture(peekabooPath);
  } else {
    writeExecutableScript(peekabooPath);
  }
  writeFileSync(join(bridgeDir, 'manifest.json'), '{"placeholder":false}\n');
  if (options.helper) {
    const helperPath = join(bridgeDir, 'bin', 'evaos-connector-helper');
    if (options.nativeHelpers) {
      writeMachOFixture(helperPath);
    } else {
      writeExecutableScript(helperPath);
    }
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('afterPack bundled resource verification', () => {
  it('passes for non-Windows managed Node runtime layout', () => {
    const resourcesDir = makeTempResources();
    writeRuntimeFixture(resourcesDir, 'darwin-arm64', {
      nodePath: join('node-v24.11.0-darwin-arm64', 'bin', 'node'),
    });

    expect(() => afterPack.verifyBundledResources(resourcesDir, 'darwin', 'arm64')).not.toThrow();
  });

  it('reports missing non-Windows managed Node runtime executable', () => {
    const resourcesDir = makeTempResources();
    writeRuntimeFixture(resourcesDir, 'linux-x64');
    mkdirSync(
      join(resourcesDir, 'bundled-aioncore', 'linux-x64', 'managed-resources', 'node', 'node-v24.11.0-linux-x64'),
      {
        recursive: true,
      }
    );

    expect(() => afterPack.verifyBundledResources(resourcesDir, 'linux', 'x64')).toThrow(
      /bundled-aioncore\/linux-x64\/managed-resources\/node\/\*\/bin\/node/
    );
  });

  it('checks Windows managed Node runtime at the version root', () => {
    const resourcesDir = makeTempResources();
    writeRuntimeFixture(resourcesDir, 'win32-x64', {
      nodePath: join('node-v24.11.0-win32-x64', 'node.exe'),
    });

    expect(() => afterPack.verifyBundledResources(resourcesDir, 'win32', 'x64')).not.toThrow();
  });

  it('rejects forbidden Claude/Codex ACP resources in no-acp packages', () => {
    const resourcesDir = makeTempResources();
    const runtimeDir = writeRuntimeFixture(resourcesDir, 'darwin-arm64', {
      nodePath: join('node-v24.11.0-darwin-arm64', 'bin', 'node'),
    });
    mkdirSync(join(runtimeDir, 'managed-resources', 'acp', 'codex-acp', '0.14.0'), { recursive: true });
    writeFileSync(join(runtimeDir, 'managed-resources', 'acp', 'codex-acp', '0.14.0', 'package.json'), '{}');
    writeFileSync(
      join(runtimeDir, 'manifest.json'),
      JSON.stringify({
        managedResourcesBundle: 'no-acp',
        managedResourcesBundleResult: {
          mode: 'no-acp',
          managedResourcesPath: 'managed-resources',
          prunedResources: ['acp/codex-acp/'],
        },
      })
    );

    expect(() => afterPack.verifyBundledResources(resourcesDir, 'darwin', 'arm64')).toThrow(
      /forbidden no-acp managed resource/
    );
  });

  it('rejects any other ACP adapter resource in no-acp packages', () => {
    const resourcesDir = makeTempResources();
    const runtimeDir = writeRuntimeFixture(resourcesDir, 'darwin-arm64', {
      nodePath: join('node-v24.11.0-darwin-arm64', 'bin', 'node'),
    });
    mkdirSync(join(runtimeDir, 'managed-resources', 'acp', 'gemini-acp', '1.0.0'), { recursive: true });
    writeFileSync(join(runtimeDir, 'managed-resources', 'acp', 'gemini-acp', '1.0.0', 'package.json'), '{}');
    writeFileSync(
      join(runtimeDir, 'manifest.json'),
      JSON.stringify({
        managedResourcesBundle: 'no-acp',
        managedResourcesBundleResult: {
          mode: 'no-acp',
          managedResourcesPath: 'managed-resources',
          prunedResources: ['acp/'],
        },
      })
    );

    expect(() => afterPack.verifyBundledResources(resourcesDir, 'darwin', 'arm64')).toThrow(
      /forbidden no-acp managed resource/
    );
  });

  it('requires the evaOS connector helper in macOS bridge resources', () => {
    const resourcesDir = makeTempResources();
    writeBridgeFixture(resourcesDir);

    expect(() => afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin')).toThrow(
      /Bridge\/bin\/evaos-connector-helper/
    );
  });

  it('accepts macOS bridge resources that include the connector helper', () => {
    const resourcesDir = makeTempResources();
    writeBridgeFixture(resourcesDir, { helper: true });

    expect(() => afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin')).not.toThrow();
  });

  it('rejects script control helper resources for release-mode macOS builds', () => {
    const previous = process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL;
    const resourcesDir = makeTempResources();
    writeBridgeFixture(resourcesDir, { helper: true });

    try {
      process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL = '1';

      expect(() => afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin')).toThrow(
        /native Mach-O executable/
      );
    } finally {
      restoreEnv('EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL', previous);
    }
  });

  it('rejects a script desktop bridge for release-mode macOS builds', () => {
    const previous = process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL;
    const resourcesDir = makeTempResources();
    writeBridgeFixture(resourcesDir, { helper: true, nativeHelpers: true });

    try {
      process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL = '1';

      expect(afterPack.isMachOExecutable(join(resourcesDir, 'Bridge', 'evaos-desktop-bridge'))).toBe(false);
      expect(afterPack.isMachOExecutable(join(resourcesDir, 'Bridge', 'bin', 'peekaboo'))).toBe(true);
      expect(afterPack.isMachOExecutable(join(resourcesDir, 'Bridge', 'bin', 'evaos-connector-helper'))).toBe(true);
      expect(() => afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin')).toThrow(
        /Bridge\/evaos-desktop-bridge/
      );
    } finally {
      restoreEnv('EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL', previous);
    }
  });

  it('requires the evaOS connector binary in macOS bridge resources', () => {
    const resourcesDir = makeTempResources();
    writeBridgeFixture(resourcesDir, { helper: true });
    rmSync(join(resourcesDir, 'Bridge', 'bin', 'peekaboo'), { force: true });

    expect(() => afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin')).toThrow(/Bridge\/bin\/peekaboo/);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
