import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

type PeekabooVersionRunner = (filePath: string, args: string[], options: Record<string, unknown>) => string;

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
  computePayloadTreeDigest: (payloadDir: string) => {
    algorithm: 'sha256-tree-v1';
    sha256: string;
    fileCount: number;
  };
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
  peekabooIdentity: (filePath: string, execute?: PeekabooVersionRunner) => { version: string; sourceSha256: string };
  preparePinnedBridgePayload: (
    payloadDir: string,
    resourceDir: string,
    expectedPayloadSha256: string,
    expectedManifestSha256: string
  ) => Record<string, unknown>;
  resolvePinnedBridgeConfiguration: (
    env: Record<string, string | undefined>,
    strictRelease: boolean
  ) => { payloadDir: string; expectedPayloadSha256: string; expectedManifestSha256: string } | undefined;
  shouldCloneBridgeRefAsBranch: (ref: string) => boolean;
  sourceCandidates: () => string[];
};

describe('prepareEvaosDesktopBridgeResource', () => {
  it('computes the producer sha256-tree-v1 digest without trusting its manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-bridge-payload-digest-'));
    const bridgeContents = Buffer.from('cffaedfe0c00000100000000', 'hex');
    const licenseContents = 'bridge license\n';
    try {
      mkdirSync(join(dir, 'licenses'), { recursive: true });
      writeFileSync(join(dir, 'evaos-desktop-bridge'), bridgeContents);
      chmodSync(join(dir, 'evaos-desktop-bridge'), 0o775);
      writeFileSync(join(dir, 'licenses', 'LICENSE'), licenseContents);
      chmodSync(join(dir, 'licenses', 'LICENSE'), 0o664);
      writeFileSync(join(dir, 'payload-manifest.json'), '{"untrusted":true}\n');

      const bridgeSha = createHash('sha256').update(bridgeContents).digest('hex');
      const licenseSha = createHash('sha256').update(licenseContents).digest('hex');
      const records = [
        `${['evaos-desktop-bridge', '0755', bridgeSha].join('\0')}\n`,
        `${['licenses/LICENSE', '0644', licenseSha].join('\0')}\n`,
      ].join('');

      expect(bridgeResource.computePayloadTreeDigest(dir)).toEqual({
        algorithm: 'sha256-tree-v1',
        sha256: createHash('sha256').update(records).digest('hex'),
        fileCount: 2,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('copies a pinned self-contained payload and records its immutable identity', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-bridge-payload-copy-'));
    const payloadDir = join(dir, 'payload');
    const resourceDir = join(dir, 'Bridge');
    try {
      const { manifestSha256, payloadSha256, sourceCommit } = writePinnedPayloadFixture(payloadDir);

      expect(
        bridgeResource.preparePinnedBridgePayload(payloadDir, resourceDir, payloadSha256, manifestSha256)
      ).toMatchObject({
        schema: 'evaos-desktop-bridge-resource/v2',
        placeholder: false,
        sourceCommit,
        producerManifest: 'payload-manifest.json',
        producerManifestSha256: manifestSha256,
        bundledTools: {
          peekaboo: {
            version: '3.8.0',
            license: 'MIT',
            licensePath: 'licenses/Peekaboo-LICENSE.txt',
          },
        },
        payload: {
          algorithm: 'sha256-tree-v1',
          sha256: payloadSha256,
          target: { platform: 'macos', architecture: 'arm64' },
        },
      });

      expect(existsSync(join(resourceDir, 'evaos-desktop-bridge'))).toBe(true);
      expect(existsSync(join(resourceDir, '_internal', 'runtime.dat'))).toBe(true);
      expect(existsSync(join(resourceDir, 'payload-manifest.json'))).toBe(true);
      expect(JSON.parse(readFileSync(join(resourceDir, 'manifest.json'), 'utf8'))).toMatchObject({
        sourceCommit,
        payload: { sha256: payloadSha256 },
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('rejects a payload that differs from the approved out-of-band digest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-bridge-payload-pin-'));
    try {
      const payloadDir = join(dir, 'payload');
      const { manifestSha256 } = writePinnedPayloadFixture(payloadDir);

      expect(() =>
        bridgeResource.preparePinnedBridgePayload(payloadDir, join(dir, 'Bridge'), '0'.repeat(64), manifestSha256)
      ).toThrow(/approved release pin/);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('rejects a pinned payload whose root executable is a script', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-bridge-payload-script-'));
    try {
      const payloadDir = join(dir, 'payload');
      const { manifestSha256, payloadSha256 } = writePinnedPayloadFixture(payloadDir, { rootMachO: false });

      expect(() =>
        bridgeResource.preparePinnedBridgePayload(payloadDir, join(dir, 'Bridge'), payloadSha256, manifestSha256)
      ).toThrow(/root executable must be an arm64 Mach-O executable/);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('rejects symbolic links in an otherwise pinned payload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-bridge-payload-symlink-'));
    try {
      writeFileSync(join(dir, 'target'), 'unexpected external target');
      symlinkSync(join(dir, 'target'), join(dir, 'link'));

      expect(() => bridgeResource.computePayloadTreeDigest(dir)).toThrow(/must not contain symbolic links/);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('rejects a manifest-only mutation against the out-of-band manifest digest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-bridge-manifest-pin-'));
    try {
      const payloadDir = join(dir, 'payload');
      const { manifestSha256, payloadSha256 } = writePinnedPayloadFixture(payloadDir);
      const manifestPath = join(payloadDir, 'payload-manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.toolchain.python = 'unexpected-python';
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      expect(() =>
        bridgeResource.preparePinnedBridgePayload(payloadDir, join(dir, 'Bridge'), payloadSha256, manifestSha256)
      ).toThrow(/manifest digest/);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('refuses the legacy host-Python wrapper path for strict release preparation', () => {
    expect(() =>
      bridgeResource.resolvePinnedBridgeConfiguration(
        { EVAOS_DESKTOP_BRIDGE_SOURCE_REF: '60f7e87aa373fbae5ac91b8e6c50b86cfe5e064b' },
        true
      )
    ).toThrow(/self-contained Desktop Bridge payload/);
  });

  it('requires an out-of-band digest whenever a pinned payload is configured', () => {
    expect(() =>
      bridgeResource.resolvePinnedBridgeConfiguration(
        { EVAOS_DESKTOP_BRIDGE_PAYLOAD_DIR: '/tmp/evaos-desktop-bridge-payload' },
        false
      )
    ).toThrow(/EVAOS_DESKTOP_BRIDGE_PAYLOAD_SHA256/);
  });

  it('requires a separate manifest digest for a pinned payload', () => {
    expect(() =>
      bridgeResource.resolvePinnedBridgeConfiguration(
        {
          EVAOS_DESKTOP_BRIDGE_PAYLOAD_DIR: '/tmp/evaos-desktop-bridge-payload',
          EVAOS_DESKTOP_BRIDGE_PAYLOAD_SHA256: '1'.repeat(64),
        },
        false
      )
    ).toThrow(/EVAOS_DESKTOP_BRIDGE_MANIFEST_SHA256/);
  });

  it('keeps the legacy source wrapper available only for non-release development', () => {
    expect(bridgeResource.resolvePinnedBridgeConfiguration({}, false)).toBeUndefined();
  });

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
    const contents = 'portable-test-peekaboo-3.8.0';
    const execute = vi.fn<PeekabooVersionRunner>().mockReturnValue('Peekaboo 3.8.0 (main/ad01285)\n');
    const previousRequiredVersion = process.env.EVAOS_REQUIRED_PEEKABOO_VERSION;
    try {
      writeFileSync(executable, contents);
      process.env.EVAOS_REQUIRED_PEEKABOO_VERSION = '3.8.0';

      expect(bridgeResource.peekabooIdentity(executable, execute)).toEqual({
        version: '3.8.0',
        sourceSha256: createHash('sha256').update(contents).digest('hex'),
      });
      expect(execute).toHaveBeenCalledWith(executable, ['--version'], expect.objectContaining({ encoding: 'utf8' }));
    } finally {
      restoreEnv('EVAOS_REQUIRED_PEEKABOO_VERSION', previousRequiredVersion);
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('rejects a bundled Peekaboo version that differs from the release pin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-peekaboo-version-'));
    const executable = join(dir, 'peekaboo');
    const execute = vi.fn<PeekabooVersionRunner>().mockReturnValue('Peekaboo 3.7.1\n');
    const previousRequiredVersion = process.env.EVAOS_REQUIRED_PEEKABOO_VERSION;
    try {
      writeFileSync(executable, 'portable-test-peekaboo-3.7.1');
      process.env.EVAOS_REQUIRED_PEEKABOO_VERSION = '3.8.0';

      expect(() => bridgeResource.peekabooIdentity(executable, execute)).toThrow(
        /does not match required version 3\.8\.0/
      );
    } finally {
      restoreEnv('EVAOS_REQUIRED_PEEKABOO_VERSION', previousRequiredVersion);
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('rejects a copied Peekaboo binary that differs from the pinned source digest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-peekaboo-digest-'));
    const executable = join(dir, 'peekaboo');
    const execute = vi.fn<PeekabooVersionRunner>().mockReturnValue('Peekaboo 3.8.0\n');
    const previousRequiredDigest = process.env.EVAOS_REQUIRED_PEEKABOO_SOURCE_SHA256;
    try {
      writeFileSync(executable, 'portable-test-peekaboo-wrong-digest');
      process.env.EVAOS_REQUIRED_PEEKABOO_SOURCE_SHA256 = '0'.repeat(64);

      expect(() => bridgeResource.peekabooIdentity(executable, execute)).toThrow(
        /does not match required source digest/
      );
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

function writePinnedPayloadFixture(
  payloadDir: string,
  options: { rootMachO?: boolean } = {}
): { manifestSha256: string; payloadSha256: string; sourceCommit: string } {
  const sourceCommit = '60f7e87aa373fbae5ac91b8e6c50b86cfe5e064b';
  const machO = Buffer.from('cffaedfe0c00000100000000', 'hex');
  const license = 'MIT License\n\nPermission is hereby granted\n';
  mkdirSync(join(payloadDir, '_internal'), { recursive: true });
  mkdirSync(join(payloadDir, 'bin'), { recursive: true });
  mkdirSync(join(payloadDir, 'licenses'), { recursive: true });
  for (const relativePath of ['bin/peekaboo', 'bin/evaos-connector-helper']) {
    writeFileSync(join(payloadDir, relativePath), machO);
    chmodSync(join(payloadDir, relativePath), 0o755);
  }
  writeFileSync(join(payloadDir, 'evaos-desktop-bridge'), options.rootMachO === false ? '#!/bin/sh\nexit 0\n' : machO);
  chmodSync(join(payloadDir, 'evaos-desktop-bridge'), 0o755);
  writeFileSync(join(payloadDir, '_internal', 'runtime.dat'), 'private runtime\n');
  writeFileSync(join(payloadDir, 'licenses', 'Peekaboo-LICENSE.txt'), license);

  const payload = bridgeResource.computePayloadTreeDigest(payloadDir);
  const sha256 = (relativePath: string) =>
    createHash('sha256')
      .update(readFileSync(join(payloadDir, relativePath)))
      .digest('hex');
  writeFileSync(
    join(payloadDir, 'payload-manifest.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        artifact: {
          id: 'evaos-desktop-bridge-macos-arm64',
          format: 'onedir',
          root_executable: 'evaos-desktop-bridge',
        },
        target: { platform: 'macos', architecture: 'arm64' },
        source: {
          repository: 'electricsheephq/evaos-desktop-bridge',
          commit: sourceCommit,
          version: '0.7.0',
        },
        toolchain: {
          python: '3.12.12',
          freezer: { name: 'pyinstaller', version: '6.16.0' },
          dependencies: [{ name: 'pyobjc-core', version: '11.1' }],
        },
        files: {
          root_executable: { path: 'evaos-desktop-bridge', sha256: sha256('evaos-desktop-bridge') },
          peekaboo: {
            path: 'bin/peekaboo',
            sha256: sha256('bin/peekaboo'),
            version: '3.8.0',
            license: 'MIT',
            license_path: 'licenses/Peekaboo-LICENSE.txt',
            license_sha256: sha256('licenses/Peekaboo-LICENSE.txt'),
          },
          connector_helper: {
            path: 'bin/evaos-connector-helper',
            sha256: sha256('bin/evaos-connector-helper'),
          },
          licenses: [
            {
              name: 'Peekaboo',
              path: 'licenses/Peekaboo-LICENSE.txt',
              sha256: sha256('licenses/Peekaboo-LICENSE.txt'),
            },
          ],
        },
        payload: {
          algorithm: payload.algorithm,
          sha256: payload.sha256,
          file_count: payload.fileCount,
        },
        signing: {
          state: 'unsigned',
          inputs: ['evaos-desktop-bridge', 'bin/peekaboo', 'bin/evaos-connector-helper'],
        },
      },
      null,
      2
    )}\n`
  );
  return {
    manifestSha256: createHash('sha256')
      .update(readFileSync(join(payloadDir, 'payload-manifest.json')))
      .digest('hex'),
    payloadSha256: payload.sha256,
    sourceCommit,
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
