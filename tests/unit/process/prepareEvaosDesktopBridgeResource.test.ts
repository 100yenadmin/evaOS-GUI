import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

type PeekabooVersionRunner = (filePath: string, args: string[], options: Record<string, unknown>) => string;

type PythonRuntimeMetadata = {
  version: string;
  sourceSha256: string;
  sourceUrl: string;
  architecture: string;
  packages: Array<{ name: string; version: string; sha256: string }>;
  license: string;
  licensePath: string;
  licenseSha256: string;
  inventoryPath: string;
  inventorySha256: string;
  inventoryEntryCount: number;
};

const bridgeResource = require('../../../scripts/prepareEvaosDesktopBridgeResource.js') as {
  bridgeManifest: (input: {
    requestedSourceRef?: string;
    sourcePath: string;
    sourceCommit?: string;
    sourceBranch?: string;
    sourceProvenance?: Record<string, unknown>;
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
  installPythonRuntime: (sourcePath?: string, resourceDir?: string) => PythonRuntimeMetadata | undefined;
  writePythonRuntimeInventory: (resourceDir: string) => {
    inventoryPath: string;
    inventorySha256: string;
    inventoryEntryCount: number;
  };
  verifyPythonRuntimeInventory: (resourceDir: string, metadata: PythonRuntimeMetadata) => boolean;
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
  sourceCandidates: () => string[];
  vendoredBridgeSourceMetadata: (sourceDir?: string) => Record<string, unknown>;
};
const { copyDir } = require('builder-util/out/fs') as {
  copyDir: (source: string, destination: string) => Promise<void>;
};

describe('prepareEvaosDesktopBridgeResource', () => {
  it('isolates the packaged desktop bridge wrapper from ambient Python paths', () => {
    const wrapper = bridgeResource.bridgeWrapperScript();

    expect(wrapper).toContain('PYTHON_BIN="$BRIDGE_DIR/python/bin/python3"');
    expect(wrapper).toContain('bundled Python runtime is missing');
    expect(wrapper).toContain('unset PYTHONHOME');
    expect(wrapper).toContain('unset PYTHONUSERBASE');
    expect(wrapper).toContain('export PYTHONNOUSERSITE=1');
    expect(wrapper).toContain('export PYTHONPATH="$BRIDGE_DIR/src"');
    expect(wrapper).toContain('CACHE_ROOT="$HOME/Library/Caches/evaos-desktop-bridge"');
    expect(wrapper).toContain('export PYTHONPYCACHEPREFIX="$CACHE_ROOT/pycache"');
    expect(wrapper).toContain('exec "$PYTHON_BIN" -P -m evaos_desktop_bridge.cli "$@"');
    expect(wrapper).not.toContain('${PYTHONPATH:+:$PYTHONPATH}');
    expect(wrapper).not.toContain('site-packages');
    expect(wrapper).not.toContain('/opt/homebrew/bin/python3');
    expect(wrapper).not.toContain('/usr/local/bin/python3');
    expect(wrapper).not.toContain('/usr/bin/python3');
    expect(wrapper).not.toContain('Install Python 3');
  });

  it('requires a bundled Python runtime for strict release packaging', () => {
    const previousRequireReal = process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL;
    const previousRuntimeDir = process.env.EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR;
    try {
      process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL = '1';
      delete process.env.EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR;

      expect(() => bridgeResource.installPythonRuntime()).toThrow(/bundled Python runtime/);
    } finally {
      restoreEnv('EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL', previousRequireReal);
      restoreEnv('EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR', previousRuntimeDir);
    }
  });

  it('preserves relative Python runtime symlinks and inventory through electron-builder copying', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-python-runtime-'));
    const sourceDir = join(dir, 'source');
    const resourceDir = join(dir, 'Bridge');
    const packagedResourceDir = join(dir, 'PackagedBridge');
    const versionedExecutable = join(sourceDir, 'bin', 'python3.12');
    try {
      mkdirSync(join(sourceDir, 'bin'), { recursive: true });
      mkdirSync(join(sourceDir, 'include', 'python3.12'), { recursive: true });
      mkdirSync(join(sourceDir, 'lib', 'python3.12'), { recursive: true });
      mkdirSync(join(sourceDir, 'lib', 'python3.12', '__pycache__'), { recursive: true });
      writeFileSync(versionedExecutable, '#!/bin/sh\necho "Python 3.12.13"\n');
      chmodSync(versionedExecutable, 0o755);
      symlinkSync('python3.12', join(sourceDir, 'bin', 'python3'));
      writeFileSync(join(sourceDir, 'include', 'python3.12', 'Python.h'), '# Python\n');
      writeFileSync(join(sourceDir, 'include', 'python3.12', 'abstract.h'), '# abstract\n');
      writeFileSync(join(sourceDir, 'lib', 'python3.12', 'LICENSE.txt'), 'Python Software Foundation License\n');
      writeFileSync(join(sourceDir, 'lib', 'python3.12', '__pycache__', 'ignored.cpython-312.pyc'), 'cache');

      const metadata = bridgeResource.installPythonRuntime(sourceDir, resourceDir);
      expect(metadata).toMatchObject({
        version: '3.12.13',
        inventoryPath: 'python-runtime-inventory.json',
        inventoryEntryCount: 10,
        inventorySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(readlinkSync(join(resourceDir, 'python', 'bin', 'python3'))).toBe('python3.12');

      const inventory = JSON.parse(readFileSync(join(resourceDir, 'python-runtime-inventory.json'), 'utf8')) as {
        schema: string;
        entries: Array<{ path: string; type: string; mode: number; target?: string; sha256?: string }>;
      };
      expect(inventory.schema).toBe('evaos-python-runtime-inventory/v1');
      expect(inventory.entries.map(({ path }) => path)).toEqual(inventory.entries.map(({ path }) => path).toSorted());
      expect(inventory.entries.some(({ path }) => path.split('/').includes('__pycache__'))).toBe(false);
      expect(inventory.entries).toEqual(
        expect.arrayContaining([
          {
            path: 'bin',
            type: 'directory',
            mode: 0o755,
          },
          {
            path: 'bin/python3',
            type: 'symlink',
            mode: 0o777,
            target: 'python3.12',
          },
          expect.objectContaining({
            path: 'bin/python3.12',
            type: 'file',
            mode: 0o755,
            sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          }),
        ])
      );
      expect(bridgeResource.verifyPythonRuntimeInventory(resourceDir, metadata!)).toBe(true);
      await copyDir(resourceDir, packagedResourceDir);
      expect(bridgeResource.verifyPythonRuntimeInventory(packagedResourceDir, metadata!)).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('rejects a bundled Python runtime whose directory mode changes after inventory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-python-runtime-directory-tamper-'));
    const sourceDir = join(dir, 'source');
    const resourceDir = join(dir, 'Bridge');
    try {
      mkdirSync(join(sourceDir, 'bin'), { recursive: true });
      mkdirSync(join(sourceDir, 'lib', 'python3.12'), { recursive: true });
      writeFileSync(join(sourceDir, 'bin', 'python3.12'), '#!/bin/sh\necho "Python 3.12.13"\n');
      chmodSync(join(sourceDir, 'bin', 'python3.12'), 0o755);
      symlinkSync('python3.12', join(sourceDir, 'bin', 'python3'));
      writeFileSync(join(sourceDir, 'lib', 'python3.12', 'LICENSE.txt'), 'Python Software Foundation License\n');

      const metadata = bridgeResource.installPythonRuntime(sourceDir, resourceDir);
      expect(metadata).toBeDefined();
      chmodSync(join(resourceDir, 'python', 'lib'), 0o700);

      expect(() => bridgeResource.verifyPythonRuntimeInventory(resourceDir, metadata!)).toThrow(/inventory.*mismatch/i);
    } finally {
      chmodSync(join(resourceDir, 'python', 'lib'), 0o755);
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('rejects a non-traversable bundled Python runtime directory before inventory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-python-runtime-directory-mode-'));
    const resourceDir = join(dir, 'Bridge');
    const blockedDir = join(resourceDir, 'python', 'blocked');
    try {
      mkdirSync(blockedDir, { recursive: true });
      chmodSync(blockedDir, 0o600);

      expect(() => bridgeResource.writePythonRuntimeInventory(resourceDir)).toThrow(
        /directory.*owner-readable and owner-executable/i
      );
    } finally {
      chmodSync(blockedDir, 0o755);
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('rejects a non-traversable bundled Python runtime root before inventory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-python-runtime-root-mode-'));
    const resourceDir = join(dir, 'Bridge');
    const runtimeDir = join(resourceDir, 'python');
    try {
      mkdirSync(runtimeDir, { recursive: true });
      chmodSync(runtimeDir, 0o600);

      expect(() => bridgeResource.writePythonRuntimeInventory(resourceDir)).toThrow(
        /directory.*owner-readable and owner-executable/i
      );
    } finally {
      chmodSync(runtimeDir, 0o755);
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('rejects a bundled Python runtime that changes after its inventory is written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-python-runtime-tamper-'));
    const sourceDir = join(dir, 'source');
    const resourceDir = join(dir, 'Bridge');
    const versionedExecutable = join(sourceDir, 'bin', 'python3.12');
    try {
      mkdirSync(join(sourceDir, 'bin'), { recursive: true });
      mkdirSync(join(sourceDir, 'lib', 'python3.12'), { recursive: true });
      writeFileSync(versionedExecutable, '#!/bin/sh\necho "Python 3.12.13"\n');
      chmodSync(versionedExecutable, 0o755);
      symlinkSync('python3.12', join(sourceDir, 'bin', 'python3'));
      writeFileSync(join(sourceDir, 'lib', 'python3.12', 'LICENSE.txt'), 'Python Software Foundation License\n');

      const metadata = bridgeResource.installPythonRuntime(sourceDir, resourceDir);
      expect(metadata).toBeDefined();
      writeFileSync(join(resourceDir, 'python', 'lib', 'python3.12', 'LICENSE.txt'), 'tampered\n');

      expect(() => bridgeResource.verifyPythonRuntimeInventory(resourceDir, metadata!)).toThrow(/inventory.*mismatch/i);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('detects native Mach-O executables before release packaging trusts a control helper', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-bridge-mach-o-'));
    const script = join(dir, 'peekaboo.sh');
    try {
      for (const [index, magic] of ['cffaedfe', 'cafebabe', 'bebafeca', 'bfbafeca'].entries()) {
        const machO = join(dir, `peekaboo-${index}`);
        writeFileSync(machO, Buffer.from(`${magic}00000000`, 'hex'));
        chmodSync(machO, 0o755);
        expect(bridgeResource.isMachOExecutable(machO)).toBe(true);
      }
      writeFileSync(script, '#!/bin/sh\nexit 0\n');
      chmodSync(script, 0o755);

      expect(bridgeResource.isMachOExecutable(script)).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('uses the evaOS-GUI-owned vendored bridge despite deprecated source overrides', () => {
    const previousSourceDir = process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_DIR;
    const previousSourceRef = process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_REF;
    const previousDisableDefault = process.env.EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES;

    try {
      delete process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_DIR;
      delete process.env.EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES;
      process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_REF = '8cdc02cee0f1e5d53ae430a942848c721762b00a';

      expect(bridgeResource.sourceCandidates()).toEqual([join(process.cwd(), 'resources', 'evaos-beta', 'bridge')]);

      process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_DIR = '/tmp/development-bridge';

      expect(bridgeResource.sourceCandidates()).toEqual([join(process.cwd(), 'resources', 'evaos-beta', 'bridge')]);
    } finally {
      restoreEnv('EVAOS_DESKTOP_BRIDGE_SOURCE_DIR', previousSourceDir);
      restoreEnv('EVAOS_DESKTOP_BRIDGE_SOURCE_REF', previousSourceRef);
      restoreEnv('EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES', previousDisableDefault);
    }
  });

  it('records owned bridge provenance and the current Workbench focus identity', () => {
    const metadata = bridgeResource.vendoredBridgeSourceMetadata();
    const adapter = readFileSync(
      join(
        process.cwd(),
        'resources',
        'evaos-beta',
        'bridge',
        'src',
        'evaos_desktop_bridge',
        'adapters',
        'customer_mac.py'
      ),
      'utf8'
    );

    expect(metadata).toMatchObject({
      schema: 'evaos-workbench-vendored-bridge-source/v1',
      owner: '100yenadmin/evaOS-GUI',
      status: 'vendored',
      importedCommit: '9e3b7332a88fbdea22291923bfd10dd37494d92d',
    });
    expect(metadata.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(adapter).toContain('WORKBENCH_CANONICAL_APP_PATH = Path("/Applications/evaOS Workbench.app")');
    expect(adapter).not.toContain('WORKBENCH_CANONICAL_APP_PATH = Path("/Applications/evaOS.app")');
  });

  it('routes current and legacy aliases only to the current Workbench app', () => {
    const sourceDir = join(process.cwd(), 'resources', 'evaos-beta', 'bridge', 'src');
    const script = [
      'from pathlib import Path',
      'from tempfile import TemporaryDirectory',
      'from evaos_desktop_bridge.adapters.customer_mac import CustomerMacObserver',
      'with TemporaryDirectory() as state:',
      '    observer = CustomerMacObserver(state_dir=Path(state), platform_name="Darwin")',
      '    for alias in ("EvaDesktop", "evaOS", "evaOS Workbench", "com.evaos.workbench"):',
      '        result = observer.app_focus(app_name=alias, dry_run=True)',
      '        assert result.ok, (alias, result.errors)',
      '        assert result.data["app_path"] == "/Applications/evaOS Workbench.app", (alias, result.data)',
      '        assert result.data["process_name"] == "evaOS Workbench", (alias, result.data)',
      'print("ok")',
    ].join('\n');

    expect(
      execFileSync('python3', ['-B', '-c', script], {
        encoding: 'utf8',
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: sourceDir },
      }).trim()
    ).toBe('ok');
  });

  it('rejects an external bridge source in every build mode', () => {
    expect(() => bridgeResource.vendoredBridgeSourceMetadata('/tmp/external-bridge')).toThrow(
      /evaOS-GUI-owned vendored bridge source/
    );
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
