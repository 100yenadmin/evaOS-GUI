import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const afterPack = require('../../../scripts/afterPack.js') as {
  isMachOExecutable: (filePath: string) => boolean;
  verifyBundledResources: (resourcesDir: string, electronPlatformName: string, targetArch: string) => void;
  verifyEvaosDesktopBridgeResource: (
    resourcesDir: string,
    electronPlatformName: string,
    env?: Record<string, string | undefined>,
    targetArch?: string
  ) => void;
};
const bridgeResource = require('../../../scripts/prepareEvaosDesktopBridgeResource.js') as {
  computePayloadTreeDigest: (payloadDir: string) => { algorithm: string; sha256: string; fileCount: number };
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

function writeBridgeFixture(
  resourcesDir: string,
  options: {
    helper?: boolean;
    nativeHelpers?: boolean;
    nativeRoot?: boolean;
    pinnedPayload?: boolean;
    payloadSha256?: string;
    producerManifestSha256?: string;
  } = {}
): { manifestSha256?: string; payloadSha256?: string } {
  const bridgeDir = join(resourcesDir, 'Bridge');
  mkdirSync(join(bridgeDir, 'bin'), { recursive: true });
  const bridgePath = join(bridgeDir, 'evaos-desktop-bridge');
  const peekabooPath = join(bridgeDir, 'bin', 'peekaboo');
  if (options.nativeRoot) {
    writeMachOFixture(bridgePath);
  } else {
    writeExecutableScript(bridgePath);
  }
  if (options.nativeHelpers) {
    writeMachOFixture(peekabooPath);
  } else {
    writeExecutableScript(peekabooPath);
  }
  if (options.helper) {
    const helperPath = join(bridgeDir, 'bin', 'evaos-connector-helper');
    if (options.nativeHelpers) {
      writeMachOFixture(helperPath);
    } else {
      writeExecutableScript(helperPath);
    }
  }
  if (options.pinnedPayload) {
    const producerManifest = '{"schema_version":1}\n';
    writeFileSync(join(bridgeDir, 'payload-manifest.json'), producerManifest);
    const payload = bridgeResource.computePayloadTreeDigest(bridgeDir);
    const manifestSha256 =
      options.producerManifestSha256 || createHash('sha256').update(producerManifest).digest('hex');
    const payloadSha256 = options.payloadSha256 || payload.sha256;
    writeFileSync(
      join(bridgeDir, 'manifest.json'),
      `${JSON.stringify({
        schema: 'evaos-desktop-bridge-resource/v2',
        placeholder: false,
        producerManifest: 'payload-manifest.json',
        producerManifestSha256: manifestSha256,
        sourceCommit: '60f7e87aa373fbae5ac91b8e6c50b86cfe5e064b',
        payload: {
          algorithm: payload.algorithm,
          sha256: payloadSha256,
          fileCount: payload.fileCount,
          target: { platform: 'macos', architecture: 'arm64' },
        },
      })}\n`
    );
    return { manifestSha256, payloadSha256 };
  } else {
    writeFileSync(join(bridgeDir, 'manifest.json'), '{"placeholder":false}\n');
  }
  return {};
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
    const resourcesDir = makeTempResources();
    const identity = writeBridgeFixture(resourcesDir, { helper: true, nativeRoot: true, pinnedPayload: true });

    expect(() => afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin', strictBridgeEnv(identity))).toThrow(
      /native Mach-O executable/
    );
  });

  it('rejects a script desktop bridge for release-mode macOS builds', () => {
    const resourcesDir = makeTempResources();
    const identity = writeBridgeFixture(resourcesDir, { helper: true, nativeHelpers: true, pinnedPayload: true });

    expect(afterPack.isMachOExecutable(join(resourcesDir, 'Bridge', 'evaos-desktop-bridge'))).toBe(false);
    expect(afterPack.isMachOExecutable(join(resourcesDir, 'Bridge', 'bin', 'peekaboo'))).toBe(true);
    expect(afterPack.isMachOExecutable(join(resourcesDir, 'Bridge', 'bin', 'evaos-connector-helper'))).toBe(true);
    expect(() => afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin', strictBridgeEnv(identity))).toThrow(
      /Bridge\/evaos-desktop-bridge/
    );
  });

  it('rejects a release payload whose immutable tree digest is tampered', () => {
    const resourcesDir = makeTempResources();
    const identity = writeBridgeFixture(resourcesDir, {
      helper: true,
      nativeHelpers: true,
      nativeRoot: true,
      pinnedPayload: true,
      payloadSha256: '0'.repeat(64),
    });

    expect(() => afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin', strictBridgeEnv(identity))).toThrow(
      /immutable payload identity/
    );
  });

  it('rejects a release payload whose producer manifest digest is tampered', () => {
    const resourcesDir = makeTempResources();
    const identity = writeBridgeFixture(resourcesDir, {
      helper: true,
      nativeHelpers: true,
      nativeRoot: true,
      pinnedPayload: true,
      producerManifestSha256: '0'.repeat(64),
    });

    expect(() => afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin', strictBridgeEnv(identity))).toThrow(
      /producer manifest digest/
    );
  });

  it('rejects a release payload that differs from the configured out-of-band pin', () => {
    const resourcesDir = makeTempResources();
    const identity = writeBridgeFixture(resourcesDir, {
      helper: true,
      nativeHelpers: true,
      nativeRoot: true,
      pinnedPayload: true,
    });

    expect(() =>
      afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin', {
        EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL: '1',
        EVAOS_DESKTOP_BRIDGE_PAYLOAD_SHA256: '0'.repeat(64),
        EVAOS_DESKTOP_BRIDGE_MANIFEST_SHA256: identity.manifestSha256,
      })
    ).toThrow(/configured payload digest/);
  });

  it('accepts a pinned native desktop bridge payload for release-mode macOS builds', () => {
    const resourcesDir = makeTempResources();
    const identity = writeBridgeFixture(resourcesDir, {
      helper: true,
      nativeHelpers: true,
      nativeRoot: true,
      pinnedPayload: true,
    });

    expect(() =>
      afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin', strictBridgeEnv(identity))
    ).not.toThrow();
  });

  it('rejects an arm64 Desktop Bridge payload in an x64 Workbench package', () => {
    const resourcesDir = makeTempResources();
    const identity = writeBridgeFixture(resourcesDir, {
      helper: true,
      nativeHelpers: true,
      nativeRoot: true,
      pinnedPayload: true,
    });

    expect(() =>
      afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin', strictBridgeEnv(identity), 'x64')
    ).toThrow(/target architecture arm64.*Workbench target x64/);
  });

  it('requires the evaOS connector binary in macOS bridge resources', () => {
    const resourcesDir = makeTempResources();
    writeBridgeFixture(resourcesDir, { helper: true });
    rmSync(join(resourcesDir, 'Bridge', 'bin', 'peekaboo'), { force: true });

    expect(() => afterPack.verifyEvaosDesktopBridgeResource(resourcesDir, 'darwin')).toThrow(/Bridge\/bin\/peekaboo/);
  });
});

function strictBridgeEnv(identity: { manifestSha256?: string; payloadSha256?: string }) {
  return {
    EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL: '1',
    EVAOS_DESKTOP_BRIDGE_PAYLOAD_SHA256: identity.payloadSha256,
    EVAOS_DESKTOP_BRIDGE_MANIFEST_SHA256: identity.manifestSha256,
  };
}
