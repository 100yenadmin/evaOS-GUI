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
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  EVAOS_NATIVE_COMPANION_CANARIES,
  EVAOS_PACKAGED_BRIDGE_COMMAND,
} from '../../../packages/desktop/src/common/evaos/nativeCompanionBoundary';

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
  assertVendoredBridgeSourceMatchesHead: (
    runGit?: (command: string, args: string[], options: Record<string, unknown>) => string
  ) => boolean;
  directorySha256: (sourceDir: string) => string;
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
  bridgeWrapperMetadata: (filePath: string) => { schema: string; path: string; sourceSha256: string };
  bridgeWrapperScript: () => string;
  buildEd25519Verifier: (options?: {
    sourcePath?: string;
    targetDir?: string;
    architecture?: string;
  }) => { path: string; architecture: string; minimumMacOS: string; sourceSha256: string } | undefined;
  ed25519VerifierBuildArgs: (sourcePath: string, outputPath: string, architecture: string) => string[];
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
  it('pins the native verifier to the selected architecture and macOS 15', () => {
    expect(bridgeResource.ed25519VerifierBuildArgs('/source.swift', '/output', 'arm64')).toEqual([
      'swiftc',
      '-O',
      '-whole-module-optimization',
      '-target',
      'arm64-apple-macos15.0',
      '-o',
      '/output',
      '/source.swift',
    ]);
    expect(bridgeResource.ed25519VerifierBuildArgs('/source.swift', '/output', 'x64')).toContain(
      'x86_64-apple-macos15.0'
    );
    expect(() => bridgeResource.ed25519VerifierBuildArgs('/source.swift', '/output', 'universal')).toThrow(
      /Unsupported evaOS Ed25519 verifier architecture/
    );
  });

  it.skipIf(process.platform !== 'darwin')(
    'builds a native verifier that accepts valid Ed25519 vectors only',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'evaos-ed25519-verifier-'));
      try {
        const metadata = bridgeResource.buildEd25519Verifier({
          targetDir: dir,
          architecture: process.arch,
        });
        expect(metadata).toMatchObject({
          path: 'bin/evaos-ed25519-verify',
          architecture: process.arch,
          minimumMacOS: '15.0',
        });
        const executable = join(dir, 'evaos-ed25519-verify');
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const message = Buffer.from('evaos-native-ed25519-vector');
        const signature = sign(null, message, privateKey);
        const publicKeyRaw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
        const request = (signatureBytes: Buffer) =>
          Buffer.from(
            JSON.stringify({
              publicKey: publicKeyRaw.toString('base64'),
              message: message.toString('base64'),
              signature: signatureBytes.toString('base64'),
            })
          );

        expect(spawnSync(executable, { input: request(signature) }).status).toBe(0);
        const forged = Buffer.from(signature);
        forged[0] ^= 1;
        expect(spawnSync(executable, { input: request(forged) }).status).toBe(3);
        expect(spawnSync(executable, { input: Buffer.from('{}') }).status).toBe(2);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000
  );

  it('isolates the packaged desktop bridge wrapper from ambient Python paths', () => {
    const wrapper = bridgeResource.bridgeWrapperScript();

    expect(wrapper).toContain('PYTHON_BIN="$BRIDGE_DIR/python/bin/python3"');
    expect(wrapper).toContain('bundled Python runtime is missing');
    expect(wrapper).toContain('unset PYTHONHOME');
    expect(wrapper).toContain('unset PYTHONUSERBASE');
    expect(wrapper).toContain('export PYTHONNOUSERSITE=1');
    expect(wrapper).toContain('unset PYTHONPATH');
    expect(wrapper).toContain('CACHE_ROOT="$HOME/Library/Caches/evaos-desktop-bridge"');
    expect(wrapper).toContain('export PYTHONPYCACHEPREFIX="$CACHE_ROOT/pycache"');
    expect(wrapper).toContain('PYTHON_MODULE="evaos_desktop_bridge.pre_canary"');
    expect(wrapper).toContain('PYTHON_MODULE="evaos_desktop_bridge.qa_canary"');
    expect(wrapper).toContain(
      'exec "$PYTHON_BIN" -I -B -c "$PYTHON_BOOTSTRAP" "$BRIDGE_DIR/src" "$PYTHON_MODULE" "$@"'
    );
    expect(wrapper).not.toContain('export PYTHONPATH=');
    expect(wrapper).not.toContain('${PYTHONPATH:+:$PYTHONPATH}');
    expect(wrapper).not.toContain('site-packages');
    expect(wrapper).not.toContain('/opt/homebrew/bin/python3');
    expect(wrapper).not.toContain('/usr/local/bin/python3');
    expect(wrapper).not.toContain('/usr/bin/python3');
    expect(wrapper).not.toContain('Install Python 3');
  });

  it('executes the packaged bridge in isolated mode without loading injected startup modules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-bridge-wrapper-isolation-'));
    const markerPath = join(dir, 'sitecustomize-loaded');
    try {
      const bridgeDir = join(dir, 'Bridge');
      const packageDir = join(bridgeDir, 'src', 'evaos_desktop_bridge');
      mkdirSync(join(bridgeDir, 'python', 'bin'), { recursive: true });
      mkdirSync(packageDir, { recursive: true });
      symlinkSync(
        execFileSync('which', ['python3'], { encoding: 'utf8' }).trim(),
        join(bridgeDir, 'python', 'bin', 'python3')
      );
      writeFileSync(join(packageDir, '__init__.py'), '');
      writeFileSync(
        join(packageDir, 'cli.py'),
        [
          'import json',
          'import os',
          'import sys',
          'print(json.dumps({"argv": sys.argv, "pythonpath": os.environ.get("PYTHONPATH")}))',
        ].join('\n')
      );
      writeFileSync(
        join(bridgeDir, 'src', 'sitecustomize.py'),
        `from pathlib import Path\nPath(${JSON.stringify(markerPath)}).write_text("loaded")\n`
      );
      const wrapperPath = join(bridgeDir, 'evaos-desktop-bridge');
      writeFileSync(wrapperPath, bridgeResource.bridgeWrapperScript());
      chmodSync(wrapperPath, 0o755);

      const payload = JSON.parse(
        execFileSync(wrapperPath, ['first', 'second'], {
          encoding: 'utf8',
          env: { ...process.env, PYTHONPATH: join(bridgeDir, 'src') },
        })
      );
      expect(payload.argv[0]).toMatch(/evaos_desktop_bridge\/cli\.py$/);
      expect(payload.argv.slice(1)).toEqual(['first', 'second']);
      expect(payload.pythonpath).toBeNull();
      expect(() => readFileSync(markerPath)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exports RC canaries through the installed Workbench bridge and bundled Python', () => {
    expect(EVAOS_PACKAGED_BRIDGE_COMMAND).toBe(
      '"/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge"'
    );
    expect(EVAOS_NATIVE_COMPANION_CANARIES.map((canary) => canary.id)).toEqual([
      'pre-canary-bridge-peekaboo',
      'connector-all',
      'connector-kill-switch',
    ]);
    for (const canary of EVAOS_NATIVE_COMPANION_CANARIES) {
      expect(canary.command).toContain('--artifact-dir "${EVAOS_CANARY_ARTIFACT_DIR:');
      expect(canary.command).toContain('${EVAOS_WORKBENCH_EXPECTED_VERSION:');
      expect(canary.command).toContain('${EVAOS_WORKBENCH_EXPECTED_SOURCE_COMMIT:');
      expect(canary.command).not.toContain('PYTHONPATH=');
      expect(canary.command).not.toMatch(/\bpython3\b/);
      if (canary.id !== 'pre-canary-bridge-peekaboo') {
        expect(canary.command).toContain(`${EVAOS_PACKAGED_BRIDGE_COMMAND} qa-canary `);
        expect(canary.command).toContain('EVAOS_LIVE_CANARY_RECEIPT_KEY_ID="${EVAOS_LIVE_CANARY_RECEIPT_KEY_ID:');
        expect(canary.command).toContain(
          'EVAOS_LIVE_CANARY_RECEIPT_PUBLIC_KEY="${EVAOS_LIVE_CANARY_RECEIPT_PUBLIC_KEY:'
        );
        expect(canary.command).toContain('EVAOS_LIVE_CANARY_CONTEXT_KEY_ID="${EVAOS_LIVE_CANARY_CONTEXT_KEY_ID:');
        expect(canary.command).toContain('--connector-url "${EVAOS_DESKTOP_BRIDGE_URL:');
        expect(canary.command).toContain('--version-under-test');
        expect(canary.command).toContain('--build-under-test');
        expect(canary.command).toContain('--source-commit-under-test');
        expect(canary.command).toContain('--selected-binding-proof "${EVAOS_MAC_CONTROL_LIVE_CANARY_PROOF:');
        expect(canary.command).toContain('--selected-binding-proof-run-id "${EVAOS_MAC_CONTROL_LIVE_CANARY_RUN_ID:');
        expect(canary.command).toContain('${EVAOS_WORKBENCH_EXPECTED_BUILD:');
      } else {
        expect(canary.command).toMatch(
          /^"\/Applications\/evaOS Workbench\.app\/Contents\/Resources\/Bridge\/evaos-desktop-bridge" pre-canary /
        );
        expect(canary.command).toContain('${EVAOS_WORKBENCH_EXPECTED_BUILD:');
        expect(canary.command).toContain('--expected-source-commit');
      }
      expect(canary.requiredArtifact).toBe('qa-report.json');
      expect(canary.forbidsSkips).toBe(true);
    }
  });

  it('captures pre-canary failures as sanitized check summaries before preserving the exit code', () => {
    const workflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'evaos-beta-rc-canary.yml'), 'utf8');
    const sanitizerCommand = 'node - "$PRE_CANARY_REPORT" <<\'NODE\'';
    const sanitizerStart = workflow.indexOf(sanitizerCommand);
    const sanitizerBodyStart = workflow.indexOf('\n', sanitizerStart) + 1;
    const sanitizerBodyEnd = workflow.indexOf('\n          NODE', sanitizerBodyStart);
    const sanitizerScript = workflow
      .slice(sanitizerBodyStart, sanitizerBodyEnd)
      .split('\n')
      .map((line) => line.replace(/^ {10}/, ''))
      .join('\n');
    const failureBlock = workflow.slice(
      workflow.indexOf('PRE_CANARY_EXIT=$?'),
      workflow.indexOf('TOKEN_FILE="$HOME/Library/Application Support/evaos-desktop-bridge/connector.token"')
    );

    expect(failureBlock).toContain('PRE_CANARY_EXIT=$?');
    expect(workflow).toContain('--canary-artifact-root "$RUNNER_TEMP"');
    expect(failureBlock).toContain('Pre-canary exit code: $PRE_CANARY_EXIT');
    expect(failureBlock).toContain('Pre-canary sanitized check: ${JSON.stringify(check)}');
    expect(failureBlock).toContain('exit "$PRE_CANARY_EXIT"');
    expect(failureBlock.indexOf('exit "$PRE_CANARY_EXIT"')).toBeLessThan(
      failureBlock.indexOf('cp "$PRE_CANARY_REPORT" "$PROOF_DIR/installed-candidate-pre-canary.json"')
    );
    expect(failureBlock).not.toMatch(/\.evidence|\.inventory/);
    expect(sanitizerStart).toBeGreaterThan(-1);
    expect(sanitizerBodyEnd).toBeGreaterThan(sanitizerBodyStart);

    const reportDir = mkdtempSync(join(tmpdir(), 'evaos-pre-canary-sanitizer-'));
    try {
      const reportPath = join(reportDir, 'qa-report.json');
      writeFileSync(
        reportPath,
        JSON.stringify({
          checks: [
            {
              code: 'unsafe/code',
              status: 'fail',
              message:
                'Authorization: Bearer fixture-secret eyJhbGciOiJIUzI1NiJ9.fixture.signature 2001:db8::1 /tmp/private path\n' +
                'x'.repeat(300),
              evidence: 'raw-evidence',
            },
          ],
          inventory: { registered_paths: ['/tmp/private'] },
        })
      );
      const sanitized = spawnSync(process.execPath, ['-', reportPath], {
        encoding: 'utf8',
        input: sanitizerScript,
      });
      expect(sanitized.status).toBe(0);
      expect(sanitized.stderr).toContain('invalid_check_code');
      expect(sanitized.stderr).toContain('Installed candidate did not satisfy this pre-canary check.');
      expect(sanitized.stderr).not.toMatch(
        /fixture-secret|eyJhbGciOiJIUzI1NiJ9|2001:db8::1|\/tmp\/private|raw-evidence|x{20}/
      );

      writeFileSync(reportPath, '{"checks":[{"message":"token malformed-secret"}');
      const malformed = spawnSync(process.execPath, ['-', reportPath], {
        encoding: 'utf8',
        input: sanitizerScript,
      });
      expect(malformed.status).toBe(1);
      expect(malformed.stderr).toBe('');
      expect(malformed.stdout).toBe('');
    } finally {
      rmSync(reportDir, { recursive: true, force: true });
    }
  });

  it('rejects dirty or untracked vendored bridge bytes in strict provenance checks', () => {
    expect(() =>
      bridgeResource.assertVendoredBridgeSourceMatchesHead(
        () => ' M resources/evaos-beta/bridge/src/evaos_desktop_bridge/cli.py\0'
      )
    ).toThrow(/match HEAD/);
    expect(() =>
      bridgeResource.assertVendoredBridgeSourceMatchesHead(
        () => '?? resources/evaos-beta/bridge/src/evaos_desktop_bridge/injected.py\0'
      )
    ).toThrow(/match HEAD/);
    expect(() =>
      bridgeResource.assertVendoredBridgeSourceMatchesHead(
        () => '!! resources/evaos-beta/bridge/src/evaos_desktop_bridge/.env\0'
      )
    ).toThrow(/match HEAD/);
    expect(
      bridgeResource.assertVendoredBridgeSourceMatchesHead(
        () => '!! resources/evaos-beta/bridge/src/evaos_desktop_bridge/__pycache__/\0'
      )
    ).toBe(true);
    expect(bridgeResource.assertVendoredBridgeSourceMatchesHead(() => '')).toBe(true);
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
      importedCommit: '908e3cad8c5f11dca739bbfc2c697c3e6d52f79e',
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
      '    for focus_method in (observer.app_focus, observer.desktop_focus_app):',
      '        for alias in ("EvaDesktop", "evaOS", "evaOS Workbench", "evaOS Workbench Beta", "com.evaos.workbench", "com.evaos.workbench.beta", "/Applications/evaOS Workbench.app"):',
      '            result = focus_method(app_name=alias, dry_run=True)',
      '            assert result.ok, (focus_method.__name__, alias, result.errors)',
      '            assert result.data["app_path"] == "/Applications/evaOS Workbench.app", (focus_method.__name__, alias, result.data)',
      '            assert result.data["process_name"] == "evaOS Workbench", (focus_method.__name__, alias, result.data)',
      '    def unexpected_runner(*_args, **_kwargs):',
      '        raise AssertionError("legacy app path reached a command runner")',
      '    guarded = CustomerMacObserver(state_dir=Path(state), platform_name="Darwin", runner=unexpected_runner)',
      '    for focus_method in (guarded.app_focus, guarded.desktop_focus_app):',
      '        for legacy_path in ("/Applications/evaOS.app", "file:///Applications/evaOS.app", "/Applications/EvaDesktop.app", "/Applications/evaOS Workbench Beta.app", "file:///tmp/evaOS%20Workbench%20Beta.app"):',
      '            blocked = focus_method(app_name=legacy_path, dry_run=False)',
      '            assert not blocked.ok, (focus_method.__name__, legacy_path, blocked.data)',
      '            assert blocked.errors[0]["code"] == "legacy_workbench_app_blocked", (focus_method.__name__, legacy_path, blocked.errors)',
      'print("ok")',
    ].join('\n');

    expect(
      execFileSync('python3', ['-B', '-c', script], {
        encoding: 'utf8',
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: sourceDir },
      }).trim()
    ).toBe('ok');
  });

  it('retains the authenticated readiness and bounded diagnostics P0 fixes', () => {
    const sourceDir = join(process.cwd(), 'resources', 'evaos-beta', 'bridge', 'src');
    const script = [
      'from evaos_desktop_bridge import cli as bridge_cli, connector_server',
      'from pathlib import Path',
      'calls = []',
      'bridge_cli._connector_plist_path = lambda: None',
      'bridge_cli._connector_plist_host = lambda _path: None',
      'bridge_cli._tailscale_ip = lambda *args, **kwargs: None',
      'def fake_get(host, path, *, authorization=None, timeout_seconds=1.0):',
      '    calls.append((path, timeout_seconds, authorization is not None))',
      '    if path == "/health":',
      '        return {"outcome": "complete", "status_code": 200, "status_line": "HTTP/1.1 200 OK", "json": {"service": "evaos-desktop-bridge-connector"}}',
      '    return {"outcome": "complete", "status_code": 200, "status_line": "HTTP/1.1 200 OK", "json": {"schema": "evaos.desktop_bridge.diagnostics.v1", "connector": {"ready": {"schema": "evaos.desktop_bridge.ready.v1", "ok": True, "ready": True}}}}',
      'bridge_cli._connector_http_get = fake_get',
      'health = bridge_cli._connector_loopback_health(connector_token="fixture-token")',
      'assert health["ready"] is True, health',
      'assert health["authenticated"] is True, health',
      'assert calls == [("/health", 1.0, False), ("/v1/diagnostics", 5.0, True)], calls',
      'service_status = {"ok": False, "ready": False, "token_present": True, "loaded": True, "running": False, "managed_by": "offline", "health": {"reachable": True, "ready": False, "authenticated": False, "host": "127.0.0.1", "error": "connector_diagnostics_timeout"}}',
      'service_calls = 0',
      'def fake_status(**_kwargs):',
      '    global service_calls',
      '    service_calls += 1',
      '    return service_status',
      'bridge_cli._connector_service_status = fake_status',
      'bridge_cli.build_diagnostics_payload = lambda **_kwargs: {"connector": {}}',
      'bridge_cli.build_ready_payload = lambda **_kwargs: {"ok": True, "ready": True, "blockers": []}',
      'diagnostics = bridge_cli._build_cli_diagnostics_payload(token="fixture-token")',
      'readiness = diagnostics["connector"]["ready"]',
      'assert service_calls == 1, service_calls',
      'assert readiness["ready"] is False, readiness',
      'assert [item["code"] for item in readiness["blockers"]] == ["connector_diagnostics_timeout"], readiness',
      'needs_login = bridge_cli._private_network_evidence({"BackendState": "NeedsLogin", "Self": {"Online": False}})',
      'assert needs_login["client_installed"] is True, needs_login',
      'assert needs_login["client_running"] is True, needs_login',
      'assert needs_login["enrolled"] is False, needs_login',
      'for backend_state in ("Stopped", "NoState"):',
      '    stopped = bridge_cli._private_network_evidence({"BackendState": backend_state})',
      '    assert stopped["client_running"] is False, (backend_state, stopped)',
      'assert bridge_cli._classify_bridge_owner(program_path=Path("/Applications/evaOS Workbench.app/Contents/Resources/Bridge/python"), app_path=Path("/Applications/evaOS Workbench.app"), bundle_id="com.evaos.workbench", ready=True) == "workbench_bundle"',
      'for legacy_path, legacy_bundle_id in (("/Applications/EvaDesktop.app", "com.electricsheephq.EvaDesktop"), ("/Applications/evaOS Workbench Beta.app", "com.evaos.workbench.beta")):',
      '    assert bridge_cli._classify_bridge_owner(program_path=Path(legacy_path) / "Contents/Resources/Bridge/python", app_path=Path(legacy_path), bundle_id=legacy_bundle_id, ready=True) == "legacy_bundle"',
      'connector_server.public_packaged_bridge_candidate = lambda **_kwargs: {"schema": "evaos.workbench.bridge_candidate.v1", "ok": True}',
      'candidate_status = connector_server._candidate_bound_command_response("status", {"ok": True, "data": {"ready": True}})',
      'assert candidate_status["candidate"] == {"schema": "evaos.workbench.bridge_candidate.v1", "ok": True}, candidate_status',
      'assert "candidate" not in connector_server._candidate_bound_command_response("capabilities", {"ok": True}), candidate_status',
      'print("ok")',
    ].join('\n');

    expect(
      execFileSync('python3', ['-B', '-c', script], {
        encoding: 'utf8',
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: sourceDir },
      }).trim()
    ).toBe('ok');
  });

  it('uses the current Workbench identity for packaged pre-canary inventory', () => {
    const sourceDir = join(process.cwd(), 'resources', 'evaos-beta', 'bridge', 'src');
    const script = [
      'from evaos_desktop_bridge import pre_canary',
      'from pathlib import Path',
      'from tempfile import TemporaryDirectory',
      'assert pre_canary.DEFAULT_CANONICAL_PATH == "/Applications/evaOS Workbench.app"',
      'assert pre_canary.DEFAULT_BUNDLE_ID == "com.evaos.workbench"',
      'current = pre_canary.AppBundle(path=pre_canary.DEFAULT_CANONICAL_PATH, bundle_id=pre_canary.DEFAULT_BUNDLE_ID, version="2.1.36", build="2.1.36", team_id=pre_canary.DEFAULT_TEAM_ID)',
      'current_process = pre_canary.ProcessInfo(pid=1, command="/Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench", path=pre_canary.DEFAULT_CANONICAL_PATH, kind="workbench")',
      'inventory = pre_canary.WorkbenchInventory(registered_paths=(pre_canary.DEFAULT_CANONICAL_PATH,), app_bundles=(current,), processes=(current_process,))',
      'report = pre_canary.evaluate_inventory(inventory, expected_version="2.1.36", expected_build="2.1.36")',
      'assert report.ok, report.to_dict()',
      'assert pre_canary._workbench_app_path_from_command(current_process.command) == pre_canary.DEFAULT_CANONICAL_PATH',
      'with TemporaryDirectory() as inventory_root:',
      '    canonical = Path(inventory_root) / "evaOS Workbench.app"',
      '    canonical.mkdir()',
      '    removed = Path(inventory_root) / "removed-updater-extract" / "evaOS Workbench.app"',
      '    removed_parent = Path(inventory_root) / "removed-parent"',
      '    removed_parent.write_text("not a directory", encoding="utf-8")',
      '    removed_below_file = removed_parent / "evaOS Workbench.app"',
      '    existing_duplicate = Path(inventory_root) / "fallback-extract" / "evaOS Workbench.app"',
      '    pre_canary._read_app_bundle = lambda path: pre_canary.AppBundle(path=path, bundle_id=pre_canary.DEFAULT_BUNDLE_ID, version="2.1.36", build="2.1.36", team_id=pre_canary.DEFAULT_TEAM_ID)',
      '    pre_canary._process_inventory = lambda: (pre_canary.ProcessInfo(pid=2, command=f"{canonical}/Contents/MacOS/evaOS Workbench", path=str(canonical), kind="workbench"),)',
      '    pre_canary._mdfind_bundle_paths = lambda _bundle_id: (str(canonical), str(removed), str(removed_below_file))',
      '    filtered_inventory = pre_canary.gather_inventory(canonical_path=str(canonical), artifact_roots=())',
      '    assert filtered_inventory.registered_paths == (str(canonical),), filtered_inventory.to_dict()',
      '    filtered_report = pre_canary.evaluate_inventory(filtered_inventory, canonical_path=str(canonical), expected_version="2.1.36", expected_build="2.1.36")',
      '    assert filtered_report.ok, filtered_report.to_dict()',
      '    existing_duplicate.mkdir(parents=True)',
      '    pre_canary._mdfind_bundle_paths = lambda _bundle_id: (str(canonical), str(removed), str(removed_below_file), str(existing_duplicate), str(existing_duplicate))',
      '    duplicate_inventory = pre_canary.gather_inventory(canonical_path=str(canonical), artifact_roots=())',
      '    assert str(removed) not in duplicate_inventory.registered_paths, duplicate_inventory.to_dict()',
      '    assert str(removed_below_file) not in duplicate_inventory.registered_paths, duplicate_inventory.to_dict()',
      '    assert duplicate_inventory.registered_paths == (str(canonical), str(existing_duplicate)), duplicate_inventory.to_dict()',
      '    duplicate_report = pre_canary.evaluate_inventory(duplicate_inventory, canonical_path=str(canonical))',
      '    assert not duplicate_report.ok, duplicate_report.to_dict()',
      '    assert "duplicate_registered_workbench_app" in {check.code for check in duplicate_report.checks}',
      'with TemporaryDirectory() as artifact_dir:',
      '    report_path = pre_canary._write_report(report.to_dict(), Path(artifact_dir))',
      '    assert report_path.name == "qa-report.json" and report_path.is_file()',
      '    for backup_name in ("evaOS Workbench Beta.app.20260613-012540", "evaOS Workbench Beta.before-staging.20260623014850.app"):',
      '        backup = Path(artifact_dir) / backup_name',
      '        backup.mkdir()',
      '        assert str(backup) in pre_canary._artifact_workbench_bundle_paths(artifact_roots=(artifact_dir,))',
      '        command = f"{backup}/Contents/MacOS/evaOS Workbench Beta"',
      '        assert pre_canary._workbench_app_path_from_command(command) == str(backup), command',
      '        backup_inventory = pre_canary.WorkbenchInventory(registered_paths=(pre_canary.DEFAULT_CANONICAL_PATH,), app_bundles=(current, pre_canary.AppBundle(path=str(backup))), processes=(current_process,))',
      '        backup_report = pre_canary.evaluate_inventory(backup_inventory)',
      '        assert not backup_report.ok, backup_report.to_dict()',
      '        assert "stale_workbench_app_bundle_present" in {check.code for check in backup_report.checks}',
      'for legacy in (pre_canary.AppBundle(path="/Applications/evaOS.app", bundle_id="com.electricsheephq.EvaDesktop"), pre_canary.AppBundle(path="/Applications/evaOS Workbench Beta.app", bundle_id="com.evaos.workbench.beta")):',
      '    legacy_inventory = pre_canary.WorkbenchInventory(registered_paths=(pre_canary.DEFAULT_CANONICAL_PATH, legacy.path), app_bundles=(current, legacy), processes=(current_process,))',
      '    legacy_report = pre_canary.evaluate_inventory(legacy_inventory)',
      '    assert not legacy_report.ok, legacy_report.to_dict()',
      '    assert "stale_workbench_app_bundle_present" in {check.code for check in legacy_report.checks}',
      'print("ok")',
    ].join('\n');

    expect(
      execFileSync('python3', ['-B', '-c', script], {
        encoding: 'utf8',
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: sourceDir },
      }).trim()
    ).toBe('ok');
  });

  it('binds pre-canary and QA reports to the exact installed Workbench source manifest', () => {
    const sourceDir = join(process.cwd(), 'resources', 'evaos-beta', 'bridge', 'src');
    const script = [
      'import base64',
      'import json',
      'import os',
      'import subprocess',
      'from pathlib import Path',
      'from tempfile import TemporaryDirectory',
      'from evaos_desktop_bridge import pre_canary, qa_canary, receipt_canary',
      'from evaos_desktop_bridge.candidate_identity import source_tree_sha256',
      'commit = "0123456789abcdef0123456789abcdef01234567"',
      'with TemporaryDirectory() as root:',
      '    bridge = Path(root) / "Bridge"',
      '    module_file = bridge / "src" / "evaos_desktop_bridge" / "pre_canary.py"',
      '    module_file.parent.mkdir(parents=True)',
      '    module_file.write_text("# fixture module\\n", encoding="utf-8")',
      '    (module_file.parent / "__init__.py").write_text("", encoding="utf-8")',
      '    source_sha256 = source_tree_sha256(module_file.parent)',
      '    manifest = {"placeholder": False, "sourceCommit": commit, "requestedSourceRef": commit, "sourcePath": "resources/evaos-beta/bridge", "sourceProvenance": {"schema": "evaos-workbench-vendored-bridge-source/v1", "owner": "100yenadmin/evaOS-GUI", "status": "vendored", "importedCommit": "908e3cad8c5f11dca739bbfc2c697c3e6d52f79e", "sourceSha256": source_sha256}}',
      '    (bridge / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")',
      '    binding = pre_canary.packaged_bridge_source_binding(commit, module_file=module_file)',
      '    assert binding["ok"] is True, binding',
      '    mismatch = pre_canary.packaged_bridge_source_binding("f" * 40, module_file=module_file)',
      '    assert mismatch["ok"] is False and mismatch["reason"] == "packaged_bridge_source_binding_mismatch", mismatch',
      '    invalid = pre_canary.packaged_bridge_source_binding("not-a-commit", module_file=module_file)',
      '    assert invalid["ok"] is False and invalid["reason"] == "expected_source_commit_invalid", invalid',
      '    module_file.write_text("# tampered fixture module\\n", encoding="utf-8")',
      '    tampered = pre_canary.packaged_bridge_source_binding(commit, module_file=module_file)',
      '    assert tampered["ok"] is False and tampered["reason"] == "packaged_bridge_source_integrity_mismatch", tampered',
      '    artifact_dir = Path(root) / "proof"',
      '    reports = qa_canary.write_reports(artifact_dir=artifact_dir, run_id="qa-fixture", started_at="2026-07-15T00:00:00Z", version_under_test="2.1.36", build_under_test="2.1.36", source_commit_under_test=commit, candidate_binding=binding, surface="connector", connector_url="http://127.0.0.1:8765", results=[])',
      '    report = json.loads(reports["json"].read_text(encoding="utf-8"))',
      '    assert report["source_commit_under_test"] == commit, report',
      '    assert report["build_under_test"] == "2.1.36", report',
      '    assert report["candidate_binding"]["ok"] is True, report',
      '    bridge_root = "/Applications/evaOS Workbench.app/Contents/Resources/Bridge"',
      '    cli_path = bridge_root + "/src/evaos_desktop_bridge/cli.py"',
      '    connector_payload = {"ok": True, "schema": "evaos.desktop_bridge.diagnostics.v1", "service": "evaos-desktop-bridge-connector", "process": {"executable": bridge_root + "/python/bin/python3.12", "argv0": cli_path}, "bridge": {"candidate": {"schema": "evaos.workbench.bridge_candidate.v1", "ok": True, "source_commit": commit, "source_sha256": source_sha256, "source_path": "resources/evaos-beta/bridge", "owner": "100yenadmin/evaOS-GUI", "status": "vendored", "app_path": "/Applications/evaOS Workbench.app", "app_version": "2.1.36", "app_build": "2.1.36", "app_bundle_id": "com.evaos.workbench", "app_name": "evaOS Workbench"}}, "connector": {"owner": {"label": "com.electricsheep.evaos-desktop-bridge", "program_path": {"kind": "path", "value": cli_path}, "app_path": {"kind": "path", "value": "/Applications/evaOS Workbench.app"}, "source_commit": commit, "manifest_path": {"kind": "path", "value": bridge_root + "/manifest.json"}, "bundle_id": "com.evaos.workbench", "classification": "workbench_bundle"}}}',
      '    connector_binding = qa_canary.evaluate_connector_candidate_identity(connector_payload, expected_source_commit=commit, expected_source_sha256=source_sha256, expected_version="2.1.36", expected_build="2.1.36")',
      '    assert connector_binding["ok"] is True, connector_binding',
      '    def assert_connector_rejected(mutator):',
      '        changed = json.loads(json.dumps(connector_payload))',
      '        mutator(changed)',
      '        rejected = qa_canary.evaluate_connector_candidate_identity(changed, expected_source_commit=commit, expected_source_sha256=source_sha256, expected_version="2.1.36", expected_build="2.1.36")',
      '        assert rejected["ok"] is False, rejected',
      '    assert_connector_rejected(lambda payload: payload.pop("process"))',
      '    assert_connector_rejected(lambda payload: payload["process"].__setitem__("executable", "/opt/homebrew/bin/python3"))',
      '    assert_connector_rejected(lambda payload: payload["process"].__setitem__("executable", "/Applications/evaOS Workbench.app.evil/Contents/Resources/Bridge/python/bin/python3"))',
      '    assert_connector_rejected(lambda payload: payload["process"].__setitem__("argv0", "/tmp/evaos_desktop_bridge/cli.py"))',
      '    assert_connector_rejected(lambda payload: payload["connector"].pop("owner"))',
      '    assert_connector_rejected(lambda payload: payload["connector"]["owner"].__setitem__("classification", "global_cli"))',
      '    assert_connector_rejected(lambda payload: payload["connector"]["owner"].__setitem__("classification", "legacy_bundle"))',
      '    assert_connector_rejected(lambda payload: payload["connector"]["owner"].__setitem__("source_commit", "f" * 40))',
      '    assert_connector_rejected(lambda payload: payload["connector"]["owner"].__setitem__("program_path", {"kind": "path", "value": "/tmp/cli.py"}))',
      '    assert_connector_rejected(lambda payload: payload["connector"]["owner"].__setitem__("app_path", {"kind": "path", "value": "/Applications/evaOS Workbench.app/../Other.app"}))',
      '    assert_connector_rejected(lambda payload: payload["connector"]["owner"].__setitem__("manifest_path", {"kind": "path", "value": "/tmp/manifest.json"}))',
      '    selected_proof_path = Path(root) / "mac-control-runtime.json"',
      '    signer_dir = Path(root) / "signer"',
      '    signer_dir.mkdir(mode=0o700)',
      '    signer_path = signer_dir / "receipt_ed25519"',
      '    subprocess.run(["/usr/bin/ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(signer_path)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)',
      '    os.chmod(signer_path, 0o600)',
      '    public_blob = base64.b64decode(signer_path.with_suffix(".pub").read_text(encoding="ascii").split()[1])',
      '    receipt_key_id = "staging-connector-receipt-v1"',
      '    context_key_id = "staging-ws-proxy-context-v1"',
      '    signer_config = receipt_canary.CanaryConfig(context_key_id=context_key_id, context_public_key=b"p" * 32, receipt_key_id=receipt_key_id, receipt_private_key=signer_path)',
      '    private_receipt = {"runRef": "gha:12345:" + "1" * 24, "executedAt": "2026-07-15T00:00:00Z", "contextIssuedAt": 1784073600, "contextExpiresAt": 1784073660, "contextKeyId": context_key_id, "candidate": {"sourceCommit": commit, "sourceSha256": source_sha256, "appVersion": "2.1.36", "appBuild": "2.1.36"}}',
      '    public_attestation = receipt_canary.build_public_attestation(private_receipt, signer_config)',
      '    selected_proof = receipt_canary.public_attestation_envelope(public_attestation, receipt_canary.sign_public_attestation(public_attestation, signer_config), signer_config)',
      '    selected_proof_path.write_text(json.dumps(selected_proof), encoding="utf-8")',
      '    os.environ["EVAOS_LIVE_CANARY_CONTEXT_KEY_ID"] = context_key_id',
      '    os.environ["EVAOS_LIVE_CANARY_RECEIPT_KEY_ID"] = receipt_key_id',
      '    os.environ["EVAOS_LIVE_CANARY_RECEIPT_PUBLIC_KEY"] = base64.urlsafe_b64encode(public_blob[-32:]).decode("ascii").rstrip("=")',
      '    selected_binding = qa_canary.selected_binding_proof_binding(selected_proof_path, expected_source_commit=commit, expected_source_run_id="12345", expected_source_sha256=source_sha256, expected_version="2.1.36", expected_build="2.1.36", verification_time_seconds=1784073630)',
      '    assert selected_binding["ok"] is True, selected_binding',
      '    assert qa_canary.selected_binding_proof_binding(selected_proof_path, expected_source_commit=commit, expected_source_run_id="54321", expected_source_sha256=source_sha256, expected_version="2.1.36", expected_build="2.1.36", verification_time_seconds=1784073630)["ok"] is False',
      '    assert qa_canary.selected_binding_proof_binding(selected_proof_path, expected_source_commit=commit, expected_source_run_id="12345", expected_source_sha256=source_sha256, expected_version="2.1.36", expected_build="2.1.36", verification_time_seconds=1784073660)["ok"] is True',
      '    assert qa_canary.selected_binding_proof_binding(selected_proof_path, expected_source_commit=commit, expected_source_run_id="12345", expected_source_sha256=source_sha256, expected_version="2.1.36", expected_build="2.1.36", verification_time_seconds=1784077201)["ok"] is False',
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
    const unrelatedEnvSha = '8cdc02cee0f1e5d53ae430a942848c721762b00a';

    try {
      process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_REF = unrelatedEnvSha;

      expect(
        bridgeResource.bridgeManifest({
          requestedSourceRef: bridgeSha,
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
        requestedSourceRef: '',
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
