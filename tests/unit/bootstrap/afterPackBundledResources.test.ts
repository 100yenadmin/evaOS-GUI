import { createRequire } from 'node:module';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const afterPack = require('../../../scripts/afterPack.js') as {
  isMachOExecutable: (filePath: string) => boolean;
  verifyBundledResources: (resourcesDir: string, electronPlatformName: string, targetArch: string) => void;
  verifyEvaosDesktopBridgeResource: (resourcesDir: string, electronPlatformName: string, targetArch?: string) => void;
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
  writeFileSync(path, Buffer.from('cffaedfe0c000001', 'hex'));
  chmodSync(path, 0o755);
}

function writeBridgeFixture(resourcesDir: string, options: { helper?: boolean; nativeHelpers?: boolean } = {}): void {
  const bridgeDir = join(resourcesDir, 'Bridge');
  mkdirSync(join(bridgeDir, 'bin'), { recursive: true });
  mkdirSync(join(bridgeDir, 'python', 'bin'), { recursive: true });
  mkdirSync(join(bridgeDir, 'licenses'), { recursive: true });
  const bridgePath = join(bridgeDir, 'evaos-desktop-bridge');
  const peekabooPath = join(bridgeDir, 'bin', 'peekaboo');
  writeExecutableScript(bridgePath);
  if (options.nativeHelpers) {
    writeMachOFixture(peekabooPath);
  } else {
    writeExecutableScript(peekabooPath);
  }
  if (options.nativeHelpers) {
    writeMachOFixture(join(bridgeDir, 'python', 'bin', 'python3.12'));
  } else {
    writeExecutableScript(join(bridgeDir, 'python', 'bin', 'python3.12'));
  }
  symlinkSync('python3.12', join(bridgeDir, 'python', 'bin', 'python3'));
  writeFileSync(join(bridgeDir, 'licenses', 'CPython-LICENSE.txt'), 'Python Software Foundation License\n');
  writeFileSync(
    join(bridgeDir, 'manifest.json'),
    JSON.stringify({
      placeholder: false,
      bundledTools: {
        python: {
          version: '3.12.13',
          sourceSha256: '5a30271f8d345a5b02b0c9e4e31e0f1e1455a8e4a04fba95cd9762472abc3b17',
          sourceUrl: 'https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython.tar.gz',
          architecture: 'arm64',
          packages: [
            {
              name: 'pyobjc-core',
              version: '12.2.1',
              sha256: 'a64232bb27ed101d4adc7d42b0e64a6d3331aac7bee7861c037a6777a163f10b',
            },
            {
              name: 'pyobjc-framework-Cocoa',
              version: '12.2.1',
              sha256: '28b9b8bab1c36efb94744786918752d0c1842f5fbb67e7d5ca97b5f736512080',
            },
            {
              name: 'pyobjc-framework-Quartz',
              version: '12.2.1',
              sha256: 'de9c8cca7e95290c8d540466af11c7cdfe3a5458e6f56c34006d5b45243f9ed9',
            },
            {
              name: 'pyobjc-framework-ApplicationServices',
              version: '12.2.1',
              sha256: 'f519ced13888d03410cd7da1f08fc56ee2944099e607216cef7ca26ecfdef61b',
            },
            {
              name: 'pyobjc-framework-CoreText',
              version: '12.2.1',
              sha256: 'ac2ead13dfa4379a1566129d0e8a8ea778a2bcac9ac360a583360fd4f1ba39c6',
            },
          ],
          licensePath: 'licenses/CPython-LICENSE.txt',
        },
      },
    }) + '\n'
  );
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

  it('requires the self-contained Python runtime in macOS bridge resources', () => {
    const resourcesDir = makeTempResources();
    writeBridgeFixture(resourcesDir, { helper: true });
    rmSync(join(resourcesDir, 'Bridge', 'python'), { force: true, recursive: true });

    expect(() => afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin')).toThrow(
      /Bridge\/python\/bin\/python3/
    );
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

  it('accepts native control helper resources for release-mode macOS builds', () => {
    const previous = process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL;
    const resourcesDir = makeTempResources();
    writeBridgeFixture(resourcesDir, { helper: true, nativeHelpers: true });

    try {
      process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL = '1';

      expect(afterPack.isMachOExecutable(join(resourcesDir, 'Bridge', 'evaos-desktop-bridge'))).toBe(false);
      expect(afterPack.isMachOExecutable(join(resourcesDir, 'Bridge', 'bin', 'peekaboo'))).toBe(true);
      expect(afterPack.isMachOExecutable(join(resourcesDir, 'Bridge', 'bin', 'evaos-connector-helper'))).toBe(true);
      expect(() => afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin', 'arm64')).not.toThrow();
    } finally {
      restoreEnv('EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL', previous);
    }
  });

  it('rejects a bundled Python runtime that does not match the target architecture', () => {
    const previous = process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL;
    const resourcesDir = makeTempResources();
    writeBridgeFixture(resourcesDir, { helper: true, nativeHelpers: true });

    try {
      process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL = '1';
      expect(() => afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin', 'x64')).toThrow(
        /target architecture x64/
      );
    } finally {
      restoreEnv('EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL', previous);
    }
  });

  it('rejects a non-relocatable bundled Python launcher symlink', () => {
    const previous = process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL;
    const resourcesDir = makeTempResources();
    writeBridgeFixture(resourcesDir, { helper: true, nativeHelpers: true });
    const pythonPath = join(resourcesDir, 'Bridge', 'python', 'bin', 'python3');
    rmSync(pythonPath);
    symlinkSync('/tmp/build-machine/python3.12', pythonPath);

    try {
      process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL = '1';
      expect(() => afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin', 'arm64')).toThrow(
        /python3|launcher symlink/
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
