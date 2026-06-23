import { createRequire } from 'node:module';
import { chmodSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const afterPack = require('../../../scripts/afterPack.js') as {
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

function writeBridgeFixture(resourcesDir: string, options: { helper?: boolean } = {}): void {
  const bridgeDir = join(resourcesDir, 'Bridge');
  mkdirSync(join(bridgeDir, 'bin'), { recursive: true });
  const bridgePath = join(bridgeDir, 'evaos-desktop-bridge');
  const peekabooPath = join(bridgeDir, 'bin', 'peekaboo');
  writeFileSync(bridgePath, '#!/bin/sh\nexit 0\n');
  chmodSync(bridgePath, 0o755);
  writeFileSync(peekabooPath, '#!/bin/sh\nexit 0\n');
  chmodSync(peekabooPath, 0o755);
  writeFileSync(join(bridgeDir, 'manifest.json'), '{"placeholder":false}\n');
  if (options.helper) {
    const helperPath = join(bridgeDir, 'bin', 'evaos-connector-helper');
    writeFileSync(helperPath, '#!/bin/sh\nexit 0\n');
    chmodSync(helperPath, 0o755);
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

  it('requires the evaOS connector binary in macOS bridge resources', () => {
    const resourcesDir = makeTempResources();
    writeBridgeFixture(resourcesDir, { helper: true });
    rmSync(join(resourcesDir, 'Bridge', 'bin', 'peekaboo'), { force: true });

    expect(() => afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin')).toThrow(/Bridge\/bin\/peekaboo/);
  });
});
