/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');
const scriptPath = join(repoRoot, 'scripts/prepareEvaosDesktopBridgeResource.js');
const { RELEASE_ENV_FLAGS } = require(join(repoRoot, 'scripts/packagingProfile.js')) as {
  RELEASE_ENV_FLAGS: string[];
};
const bridgeScript = require(scriptPath) as {
  sanitizeCommandText: (value: string, repo: string) => string;
  sourceCandidates: () => string[];
};
const tempDirs: string[] = [];
const BRIDGE_ENV_FLAGS = [
  ...RELEASE_ENV_FLAGS,
  'EVAOS_DESKTOP_BRIDGE_ALLOW_PLACEHOLDER',
  'EVAOS_DESKTOP_BRIDGE_CACHE_DIR',
  'EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES',
  'EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL',
  'EVAOS_DESKTOP_BRIDGE_RESOURCE_DIR',
  'EVAOS_DESKTOP_BRIDGE_SOURCE_DIR',
  'EVAOS_DESKTOP_BRIDGE_SOURCE_REF',
  'EVAOS_DESKTOP_BRIDGE_SOURCE_REPO',
  'EVAOS_DESKTOP_BRIDGE_SOURCE_TOKEN',
  'EVAOS_PACKAGING_PROFILE',
  'GH_TOKEN',
  'GITHUB_TOKEN',
];

function createTempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runGitFixture(args: string[], cwd: string) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function createBridgeSourceFixture() {
  const sourceDir = createTempDir('evaos-bridge-source-');
  const packageDir = join(sourceDir, 'src/evaos_desktop_bridge');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, '__init__.py'), '');
  writeFileSync(join(packageDir, 'cli.py'), 'def main():\n    print("ok")\n');

  runGitFixture(['init'], sourceDir);
  runGitFixture(['config', 'user.email', 'codex@example.test'], sourceDir);
  runGitFixture(['config', 'user.name', 'Codex Test'], sourceDir);
  runGitFixture(['add', '.'], sourceDir);
  runGitFixture(['commit', '-m', 'bridge fixture'], sourceDir);

  const commit = runGitFixture(['rev-parse', 'HEAD'], sourceDir);
  return { commit, sourceDir };
}

function appendBridgeSourceCommit(sourceDir: string) {
  writeFileSync(join(sourceDir, 'src/evaos_desktop_bridge', 'extra.py'), 'VALUE = 1\n');
  runGitFixture(['add', '.'], sourceDir);
  runGitFixture(['commit', '-m', 'bridge fixture update'], sourceDir);
  return runGitFixture(['rev-parse', 'HEAD'], sourceDir);
}

function sanitizedProcessEnv() {
  const env = { ...process.env };
  for (const name of BRIDGE_ENV_FLAGS) {
    delete env[name];
  }
  return env;
}

function expectExecutableWhenSupported(filePath: string) {
  expect(existsSync(filePath)).toBe(true);
  if (process.platform !== 'win32') {
    expect(statSync(filePath).mode & 0o111).toBeGreaterThan(0);
  }
}

function runPrepare(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...sanitizedProcessEnv(),
      ...env,
    },
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('prepareEvaosDesktopBridgeResource', () => {
  it('copies a real bridge source tree and writes executable wrappers plus manifest', () => {
    const { commit, sourceDir } = createBridgeSourceFixture();
    const resourceDir = join(createTempDir('evaos-bridge-resource-'), 'Bridge');
    const result = runPrepare({
      EVAOS_DESKTOP_BRIDGE_SOURCE_DIR: sourceDir,
      EVAOS_DESKTOP_BRIDGE_RESOURCE_DIR: resourceDir,
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(existsSync(join(resourceDir, 'src/evaos_desktop_bridge/cli.py'))).toBe(true);
    expectExecutableWhenSupported(join(resourceDir, 'evaos-desktop-bridge'));
    expectExecutableWhenSupported(join(resourceDir, 'bin/peekaboo'));
    expectExecutableWhenSupported(join(resourceDir, 'bin/evaos-connector-helper'));

    const manifest = JSON.parse(readFileSync(join(resourceDir, 'manifest.json'), 'utf8')) as {
      placeholder?: boolean;
      requestedSourceRef?: string;
      sourceCommit?: string;
      sourcePath?: string;
    };
    expect(manifest.placeholder).toBe(false);
    expect(manifest.requestedSourceRef).toBe('207f6528461ecae51c39efd2654733c1b07d39a4');
    expect(manifest.sourceCommit).toBe(commit);
    expect(manifest.sourcePath).not.toBe(sourceDir);
    expect(isAbsolute(manifest.sourcePath || '')).toBe(false);
  });

  it('writes a diagnostic placeholder only when explicitly allowed for non-release package smoke', () => {
    const resourceDir = join(createTempDir('evaos-bridge-placeholder-'), 'Bridge');
    const missingRepo = pathToFileURL(join(createTempDir('evaos-missing-bridge-repo-'), 'missing.git')).href;
    const result = runPrepare({
      EVAOS_DESKTOP_BRIDGE_ALLOW_PLACEHOLDER: '1',
      EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES: '1',
      EVAOS_DESKTOP_BRIDGE_RESOURCE_DIR: resourceDir,
      EVAOS_DESKTOP_BRIDGE_SOURCE_REPO: missingRepo,
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toContain('diagnostic placeholder');
    expectExecutableWhenSupported(join(resourceDir, 'evaos-desktop-bridge'));

    const manifest = JSON.parse(readFileSync(join(resourceDir, 'manifest.json'), 'utf8')) as {
      placeholder?: boolean;
      placeholderReason?: string;
      sourcePath?: string;
    };
    const wrapper = readFileSync(join(resourceDir, 'evaos-desktop-bridge'), 'utf8');
    expect(manifest.placeholder).toBe(true);
    expect(manifest.sourcePath).toBe('diagnostic-placeholder');
    expect(manifest.placeholderReason).toBe('bridge-source-unavailable');
    expect(JSON.stringify(manifest)).not.toContain(missingRepo);
    expect(wrapper).not.toContain(missingRepo);
  });

  it('accepts truthy strings when disabling default local Bridge candidates', () => {
    const oldDisableDefaultCandidates = process.env.EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES;
    try {
      process.env.EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES = 'true';
      delete process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_DIR;
      delete process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_REF;

      expect(bridgeScript.sourceCandidates()).toEqual([]);
    } finally {
      if (oldDisableDefaultCandidates == null) {
        delete process.env.EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES;
      } else {
        process.env.EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES = oldDisableDefaultCandidates;
      }
    }
  });

  it('rejects placeholder fallback for functional-smoke builds', () => {
    const resourceDir = join(createTempDir('evaos-bridge-functional-smoke-'), 'Bridge');
    const missingRepo = pathToFileURL(join(createTempDir('evaos-missing-bridge-repo-'), 'missing.git')).href;
    const result = runPrepare({
      EVAOS_DESKTOP_BRIDGE_ALLOW_PLACEHOLDER: '1',
      EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES: '1',
      EVAOS_DESKTOP_BRIDGE_RESOURCE_DIR: resourceDir,
      EVAOS_DESKTOP_BRIDGE_SOURCE_REPO: missingRepo,
      EVAOS_PACKAGING_PROFILE: 'functional-smoke',
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(resourceDir, 'manifest.json'))).toBe(false);
  });

  it.each(['main', 'refs/heads/main', 'origin/main', 'develop', 'v-test-bridge'])(
    'rejects non-SHA bridge ref %s for release-like proof lanes',
    (sourceRef) => {
      const resourceDir = join(createTempDir('evaos-bridge-release-ref-'), 'Bridge');
      const result = runPrepare({
        EVAOS_DESKTOP_BRIDGE_ALLOW_PLACEHOLDER: '1',
        EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES: '1',
        EVAOS_DESKTOP_BRIDGE_RESOURCE_DIR: resourceDir,
        EVAOS_DESKTOP_BRIDGE_SOURCE_REF: sourceRef,
        EVAOS_PACKAGING_PROFILE: 'functional-smoke',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('requires a pinned evaos-desktop-bridge source ref');
    }
  );

  it('rejects release-like local source checkouts that do not match the requested pinned ref', () => {
    const { commit, sourceDir } = createBridgeSourceFixture();
    appendBridgeSourceCommit(sourceDir);
    const resourceDir = join(createTempDir('evaos-bridge-local-mismatch-'), 'Bridge');
    const result = runPrepare({
      EVAOS_DESKTOP_BRIDGE_RESOURCE_DIR: resourceDir,
      EVAOS_DESKTOP_BRIDGE_SOURCE_DIR: sourceDir,
      EVAOS_DESKTOP_BRIDGE_SOURCE_REF: commit,
      EVAOS_PACKAGING_PROFILE: 'functional-smoke',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not match local source checkout');
  });

  it('records tag refs separately from the resolved source commit for non-proof local packaging', () => {
    const { commit, sourceDir } = createBridgeSourceFixture();
    runGitFixture(['tag', 'v-test-bridge'], sourceDir);
    const resourceDir = join(createTempDir('evaos-bridge-tag-ref-'), 'Bridge');
    const result = runPrepare({
      EVAOS_DESKTOP_BRIDGE_RESOURCE_DIR: resourceDir,
      EVAOS_DESKTOP_BRIDGE_SOURCE_DIR: sourceDir,
      EVAOS_DESKTOP_BRIDGE_SOURCE_REF: 'v-test-bridge',
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const manifest = JSON.parse(readFileSync(join(resourceDir, 'manifest.json'), 'utf8')) as {
      requestedSourceRef?: string;
      sourceCommit?: string;
    };
    expect(manifest.requestedSourceRef).toBe('v-test-bridge');
    expect(manifest.sourceCommit).toBe(commit);
  });

  it('resets cached source origin to the configured clean repo after checkout', () => {
    const { commit, sourceDir } = createBridgeSourceFixture();
    const resourceDir = join(createTempDir('evaos-bridge-origin-resource-'), 'Bridge');
    const cacheDir = join(createTempDir('evaos-bridge-origin-cache-'), 'source');
    const result = runPrepare({
      EVAOS_DESKTOP_BRIDGE_CACHE_DIR: cacheDir,
      EVAOS_DESKTOP_BRIDGE_RESOURCE_DIR: resourceDir,
      EVAOS_DESKTOP_BRIDGE_SOURCE_REPO: sourceDir,
      EVAOS_DESKTOP_BRIDGE_SOURCE_REF: commit,
      EVAOS_PACKAGING_PROFILE: 'functional-smoke',
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const originUrl = runGitFixture(['config', '--get', 'remote.origin.url'], cacheDir);
    expect(originUrl).toBe(sourceDir);
  });

  it('redacts bridge source tokens from command text', () => {
    const oldToken = process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_TOKEN;
    process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_TOKEN = 'super-secret-token';
    try {
      const repo = 'https://github.com/electricsheephq/evaos-desktop-bridge.git';
      const sanitized = bridgeScript.sanitizeCommandText(
        'fatal: https://x-access-token:super-secret-token@github.com/electricsheephq/evaos-desktop-bridge.git failed',
        repo
      );
      expect(sanitized).not.toContain('super-secret-token');
      expect(sanitized).toContain('https://github.com/electricsheephq/evaos-desktop-bridge.git');
    } finally {
      if (oldToken == null) {
        delete process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_TOKEN;
      } else {
        process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_TOKEN = oldToken;
      }
    }
  });
});
