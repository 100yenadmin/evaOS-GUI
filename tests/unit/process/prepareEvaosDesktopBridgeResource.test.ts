import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const bridgeResource = require('../../../scripts/prepareEvaosDesktopBridgeResource.js') as {
  bridgeManifest: (input: {
    sourcePath: string;
    sourceCommit?: string;
    sourceBranch?: string;
    placeholder: boolean;
    placeholderReason?: string;
    bundledTools?: {
      peekaboo: {
        version: string;
        sourceSha256: string;
        license?: string;
        licensePath?: string;
        licenseSha256?: string;
      };
    };
  }) => Record<string, unknown>;
  bridgeWrapperScript: () => string;
  isMachOExecutable: (filePath: string) => boolean;
  installPeekabooLicense: (
    sourcePath?: string,
    resourceDir?: string
  ) =>
    | {
        license: string;
        licensePath: string;
        licenseSha256: string;
      }
    | undefined;
  peekabooBundleMetadata: (
    binaryPath?: string,
    resourceDir?: string
  ) => { peekaboo: Record<string, string> } | undefined;
  peekabooIdentity: (filePath: string) => { version: string; sourceSha256: string };
  shouldCloneBridgeRefAsBranch: (ref: string) => boolean;
  sourceCandidates: () => string[];
};

describe('prepareEvaosDesktopBridgeResource', () => {
  it('isolates the packaged desktop bridge wrapper from ambient Python paths', () => {
    const wrapper = bridgeResource.bridgeWrapperScript();

    expect(wrapper).toContain('unset PYTHONHOME');
    expect(wrapper).toContain('unset PYTHONUSERBASE');
    expect(wrapper).toContain('export PYTHONNOUSERSITE=1');
    expect(wrapper).toContain('export PYTHONPATH="$BRIDGE_DIR/src"');
    expect(wrapper).toContain('CACHE_ROOT="$HOME/Library/Caches/evaos-desktop-bridge"');
    expect(wrapper).toContain('export PYTHONPYCACHEPREFIX="$CACHE_ROOT/pycache"');
    expect(wrapper).toContain('exec "$PYTHON_BIN" -S -m evaos_desktop_bridge.cli "$@"');
    expect(wrapper).not.toContain('${PYTHONPATH:+:$PYTHONPATH}');
    expect(wrapper).not.toContain('site-packages');
  });

  it('detects native Mach-O executables before release packaging trusts a control helper', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-bridge-mach-o-'));
    const machO = join(dir, 'peekaboo');
    const script = join(dir, 'peekaboo.sh');
    try {
      writeFileSync(machO, Buffer.from('cffaedfe00000000', 'hex'));
      chmodSync(machO, 0o755);
      writeFileSync(script, '#!/bin/sh\nexit 0\n');
      chmodSync(script, 0o755);

      expect(bridgeResource.isMachOExecutable(machO)).toBe(true);
      expect(bridgeResource.isMachOExecutable(script)).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('does not use local mutable bridge checkouts when a source ref is pinned', () => {
    const previousSourceDir = process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_DIR;
    const previousSourceRef = process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_REF;
    const previousDisableDefault = process.env.EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES;

    try {
      delete process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_DIR;
      delete process.env.EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES;
      process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_REF = '8cdc02cee0f1e5d53ae430a942848c721762b00a';

      expect(bridgeResource.sourceCandidates()).toEqual([]);

      process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_DIR = '/Volumes/LEXAR/repos/evaos-desktop-bridge';

      expect(bridgeResource.sourceCandidates()).toEqual(['/Volumes/LEXAR/repos/evaos-desktop-bridge']);
    } finally {
      restoreEnv('EVAOS_DESKTOP_BRIDGE_SOURCE_DIR', previousSourceDir);
      restoreEnv('EVAOS_DESKTOP_BRIDGE_SOURCE_REF', previousSourceRef);
      restoreEnv('EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES', previousDisableDefault);
    }
  });

  it('records the requested bridge source ref in packaged resource manifests', () => {
    const previousSourceRef = process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_REF;
    const bridgeSha = '60f7e87aa373fbae5ac91b8e6c50b86cfe5e064b';

    try {
      process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_REF = bridgeSha;

      expect(
        bridgeResource.bridgeManifest({
          sourcePath: '/tmp/evaos-desktop-bridge',
          sourceCommit: bridgeSha,
          sourceBranch: 'HEAD',
          placeholder: false,
        })
      ).toMatchObject({
        requestedSourceRef: bridgeSha,
        sourceCommit: bridgeSha,
        placeholder: false,
      });

      expect(
        bridgeResource.bridgeManifest({
          sourcePath: 'diagnostic-placeholder',
          placeholder: true,
          placeholderReason: 'source unavailable',
        })
      ).toMatchObject({
        requestedSourceRef: bridgeSha,
        sourceCommit: undefined,
        placeholder: true,
        placeholderReason: 'source unavailable',
      });
    } finally {
      restoreEnv('EVAOS_DESKTOP_BRIDGE_SOURCE_REF', previousSourceRef);
    }
  });

  it('records the exact bundled Peekaboo identity without mutable paths', () => {
    const manifest = bridgeResource.bridgeManifest({
      sourcePath: '/tmp/evaos-desktop-bridge',
      sourceCommit: '60f7e87aa373fbae5ac91b8e6c50b86cfe5e064b',
      sourceBranch: 'HEAD',
      placeholder: false,
      bundledTools: {
        peekaboo: {
          version: '3.8.0',
          sourceSha256: '4a5c7e28c263c84e406aa1853ef62cad3042b13f40a7a9e044ec74ec42933383',
        },
      },
    });

    expect(manifest).toMatchObject({
      bundledTools: {
        peekaboo: {
          version: '3.8.0',
          sourceSha256: '4a5c7e28c263c84e406aa1853ef62cad3042b13f40a7a9e044ec74ec42933383',
        },
      },
    });
    expect(JSON.stringify(manifest)).not.toContain('/opt/homebrew');
  });

  it('does not try to clone a full bridge commit SHA as a branch name', () => {
    expect(bridgeResource.shouldCloneBridgeRefAsBranch('60f7e87aa373fbae5ac91b8e6c50b86cfe5e064b')).toBe(false);
    expect(bridgeResource.shouldCloneBridgeRefAsBranch('evaos-workbench-v0.6.27')).toBe(true);
  });

  it('derives the bundled Peekaboo version and digest from the copied executable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-peekaboo-identity-'));
    const executable = join(dir, 'peekaboo');
    const contents = '#!/bin/sh\necho "Peekaboo 3.8.0 (main/ad01285)"\n';
    const previousRequiredVersion = process.env.EVAOS_REQUIRED_PEEKABOO_VERSION;
    try {
      writeFileSync(executable, contents);
      chmodSync(executable, 0o755);
      process.env.EVAOS_REQUIRED_PEEKABOO_VERSION = '3.8.0';

      expect(bridgeResource.peekabooIdentity(executable)).toEqual({
        version: '3.8.0',
        sourceSha256: createHash('sha256').update(contents).digest('hex'),
      });
    } finally {
      restoreEnv('EVAOS_REQUIRED_PEEKABOO_VERSION', previousRequiredVersion);
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('rejects a bundled Peekaboo version that differs from the release pin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-peekaboo-version-'));
    const executable = join(dir, 'peekaboo');
    const previousRequiredVersion = process.env.EVAOS_REQUIRED_PEEKABOO_VERSION;
    try {
      writeFileSync(executable, '#!/bin/sh\necho "Peekaboo 3.7.1"\n');
      chmodSync(executable, 0o755);
      process.env.EVAOS_REQUIRED_PEEKABOO_VERSION = '3.8.0';

      expect(() => bridgeResource.peekabooIdentity(executable)).toThrow(/does not match required version 3\.8\.0/);
    } finally {
      restoreEnv('EVAOS_REQUIRED_PEEKABOO_VERSION', previousRequiredVersion);
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('rejects a copied Peekaboo binary that differs from the pinned source digest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-peekaboo-digest-'));
    const executable = join(dir, 'peekaboo');
    const previousRequiredDigest = process.env.EVAOS_REQUIRED_PEEKABOO_SOURCE_SHA256;
    try {
      writeFileSync(executable, '#!/bin/sh\necho "Peekaboo 3.8.0"\n');
      chmodSync(executable, 0o755);
      process.env.EVAOS_REQUIRED_PEEKABOO_SOURCE_SHA256 = '0'.repeat(64);

      expect(() => bridgeResource.peekabooIdentity(executable)).toThrow(/does not match required source digest/);
    } finally {
      restoreEnv('EVAOS_REQUIRED_PEEKABOO_SOURCE_SHA256', previousRequiredDigest);
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('copies the Peekaboo MIT notice into the bundled resource and records its digest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-peekaboo-license-'));
    const source = join(dir, 'LICENSE');
    const resourceDir = join(dir, 'Bridge');
    const contents = [
      'MIT License',
      '',
      'Copyright (c) 2025 Peter Steinberger',
      '',
      'Permission is hereby granted, free of charge, to any person obtaining a copy',
    ].join('\n');
    try {
      writeFileSync(source, contents);

      expect(bridgeResource.installPeekabooLicense(source, resourceDir)).toEqual({
        license: 'MIT',
        licensePath: 'licenses/Peekaboo-LICENSE.txt',
        licenseSha256: createHash('sha256').update(contents).digest('hex'),
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('rejects a non-MIT notice for the pinned Peekaboo release', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-peekaboo-license-invalid-'));
    const source = join(dir, 'LICENSE');
    try {
      writeFileSync(source, 'unexpected license text');
      expect(() => bridgeResource.installPeekabooLicense(source, join(dir, 'Bridge'))).toThrow(
        /does not contain the expected MIT notice/
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('omits tool identity for a non-release fallback wrapper', () => {
    expect(bridgeResource.peekabooBundleMetadata(undefined)).toBeUndefined();
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
