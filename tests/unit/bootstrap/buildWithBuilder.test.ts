/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');
const thinShellConfigPath = join(repoRoot, 'out/electron-builder.thin-shell.yml');
const { RELEASE_ENV_FLAGS } = require(join(repoRoot, 'scripts/packagingProfile.js')) as {
  RELEASE_ENV_FLAGS: string[];
};
const ambientBuildEnvKeys = [
  ...RELEASE_ENV_FLAGS,
  'AIONUI_MANAGED_RESOURCES_BUNDLE',
  'appleId',
  'APPLE_ID',
  'EVAOS_DESKTOP_BRIDGE_ALLOW_PLACEHOLDER',
  'EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL',
  'EVAOS_DESKTOP_BRIDGE_SOURCE_DIR',
  'EVAOS_DESKTOP_BRIDGE_SOURCE_REF',
  'EVAOS_DESKTOP_BRIDGE_SOURCE_REPO',
  'EVAOS_PACKAGING_PROFILE',
];

describe('build-with-builder', () => {
  function readJsonIfExists<T>(filePath: string, fallback: T): T {
    return existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : fallback;
  }

  function sanitizedProcessEnv() {
    const env = { ...process.env };
    for (const key of ambientBuildEnvKeys) {
      delete env[key];
    }
    return env;
  }

  function runBuildWithHook(args: string[], env: Record<string, string> = {}) {
    const tempDir = mkdtempSync(join(tmpdir(), 'aionui-build-test-'));
    const hookPath = join(tempDir, 'hook.cjs');
    const callsPath = join(tempDir, 'prepare-calls.json');
    const execCallsPath = join(tempDir, 'exec-calls.json');

    writeFileSync(
      hookPath,
      `
const childProcess = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const originalLoad = Module._load;

function appendJson(filePath, value) {
  const values = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : [];
  values.push(value);
  fs.writeFileSync(filePath, JSON.stringify(values));
}

function recordPrepareCall(options) {
  appendJson(process.env.AIONUI_PREPARE_CALLS_FILE, options ?? null);
  const reused = process.env.AIONUI_PREPARE_REUSED === '1';
  return {
    prepared: true,
    reused,
    dir: path.join(process.cwd(), 'resources/bundled-aioncore', options?.platform + '-' + options?.arch),
    sourceType: 'mock',
  };
}

function readManagedResourcesBundle({ env = process.env } = {}) {
  const value = env.AIONUI_MANAGED_RESOURCES_BUNDLE || 'full';
  if (value !== 'full' && value !== 'no-acp') throw new Error('Invalid AIONUI_MANAGED_RESOURCES_BUNDLE');
  return value;
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === './prepareAioncore' || request.endsWith('/prepareAioncore')) {
    return recordPrepareCall;
  }

  if (request.endsWith('packages/shared-scripts/src/prepare-aioncore.js')) {
    return { prepareAioncore: recordPrepareCall, readManagedResourcesBundle };
  }

  if (request === './resolveAioncoreVersion.js' || request.endsWith('/resolveAioncoreVersion.js')) {
    return { resolveAioncoreVersion: () => 'v-test' };
  }

  return originalLoad.call(this, request, parent, isMain);
};

childProcess.execSync = function mockedExecSync(command) {
  const commandText = String(command);
  appendJson(process.env.AIONUI_EXEC_CALLS_FILE, commandText);
  if (commandText.includes('electron-vite build')) {
    fs.mkdirSync(path.join(process.cwd(), 'out/main'), { recursive: true });
    fs.mkdirSync(path.join(process.cwd(), 'out/renderer'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), 'out/main/index.js'), '');
    fs.writeFileSync(path.join(process.cwd(), 'out/renderer/index.html'), '');
  }
  return Buffer.from('');
};
`,
      'utf8'
    );

    const result = spawnSync(process.execPath, ['scripts/build-with-builder.js', ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...sanitizedProcessEnv(),
        ...env,
        AIONUI_PREPARE_CALLS_FILE: callsPath,
        AIONUI_EXEC_CALLS_FILE: execCallsPath,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${hookPath}`].filter(Boolean).join(' '),
      },
    });

    return { callsPath, execCallsPath, result, tempDir };
  }

  it.each([
    {
      args: ['arm64', '--win', '--arm64'],
      expectedArch: 'arm64',
      expectedBridgePrep: false,
    },
    {
      args: ['auto', '--mac', '--x64'],
      expectedArch: 'x64',
      expectedBridgePrep: true,
    },
  ])('prepares bundled AionCore for $expectedArch with args $args', ({ args, expectedArch, expectedBridgePrep }) => {
    const { callsPath, execCallsPath, result, tempDir } = runBuildWithHook(args);

    try {
      expect(result.status, result.stderr || result.stdout).toBe(0);

      const calls = JSON.parse(readFileSync(callsPath, 'utf8')) as Array<{
        arch?: string;
        reusePrepared?: boolean;
      } | null>;
      expect(calls).toContainEqual(
        expect.objectContaining({ arch: expectedArch, managedResourcesBundle: 'full', reusePrepared: true })
      );
      expect(result.stdout).toContain('AionCore prepared: resources/bundled-aioncore');
      expect(result.stdout).toContain('Managed resources bundle: full');

      const execCalls = readJsonIfExists<string[]>(execCallsPath, []);
      expect(execCalls).toContainEqual(expect.stringContaining('node scripts/prepareHubResources.js'));
      if (expectedBridgePrep) {
        expect(execCalls).toContainEqual(expect.stringContaining('node scripts/prepareEvaosDesktopBridgeResource.js'));
      } else {
        expect(execCalls).not.toContainEqual(
          expect.stringContaining('node scripts/prepareEvaosDesktopBridgeResource.js')
        );
        expect(result.stdout).toContain('Non-macOS build target: skipping evaOS desktop Bridge resource preparation');
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('logs when bundled AionCore is reused from a prepared manifest', () => {
    const { callsPath, result, tempDir } = runBuildWithHook(['arm64', '--mac', 'dir', '--arm64'], {
      AIONUI_PREPARE_REUSED: '1',
    });

    try {
      expect(result.status, result.stderr || result.stdout).toBe(0);

      const calls = JSON.parse(readFileSync(callsPath, 'utf8')) as Array<{
        arch?: string;
        reusePrepared?: boolean;
      } | null>;
      expect(calls).toContainEqual(
        expect.objectContaining({ arch: 'arm64', managedResourcesBundle: 'full', reusePrepared: true })
      );
      expect(result.stdout).toContain('AionCore reused from prepared manifest: resources/bundled-aioncore');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses a generated thin-shell builder config and skips runtime resource preparation', () => {
    rmSync(thinShellConfigPath, { force: true });
    const { callsPath, execCallsPath, result, tempDir } = runBuildWithHook([
      'arm64',
      '--mac',
      'dir',
      '--arm64',
      '--packaging-profile=thin-shell',
    ]);

    try {
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain('Packaging profile: thin-shell');
      expect(result.stdout).toContain('skipping AionCore, hub, and Bridge resource preparation');
      expect(readJsonIfExists(callsPath, [])).toEqual([]);

      const execCalls = readJsonIfExists<string[]>(execCallsPath, []);
      expect(execCalls).toContainEqual(expect.stringContaining('--config out/electron-builder.thin-shell.yml'));
      expect(execCalls).not.toContainEqual(expect.stringContaining('node scripts/prepareHubResources.js'));
      expect(execCalls).not.toContainEqual(
        expect.stringContaining('node scripts/prepareEvaosDesktopBridgeResource.js')
      );

      const generatedConfig = readFileSync(thinShellConfigPath, 'utf8');
      expect(generatedConfig).not.toContain('from: resources/bundled-aioncore');
      expect(generatedConfig).not.toContain('from: resources/hub');
      expect(generatedConfig).not.toContain('from: resources/Bridge');
      expect(generatedConfig).toContain('from: public');
      expect(generatedConfig).toContain('from: resources/app.png');
    } finally {
      rmSync(thinShellConfigPath, { force: true });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('passes no-acp managed-resource bundle mode into AionCore preparation', () => {
    const { callsPath, result, tempDir } = runBuildWithHook(['arm64', '--mac', 'dir', '--arm64'], {
      AIONUI_MANAGED_RESOURCES_BUNDLE: 'no-acp',
    });

    try {
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain('Managed resources bundle: no-acp');

      const calls = JSON.parse(readFileSync(callsPath, 'utf8')) as Array<{
        managedResourcesBundle?: string;
        reusePrepared?: boolean;
      } | null>;
      expect(calls).toContainEqual(expect.objectContaining({ managedResourcesBundle: 'no-acp', reusePrepared: true }));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects invalid managed-resource bundle modes before packaging', () => {
    const { result, tempDir } = runBuildWithHook(['arm64', '--mac', 'dir', '--arm64'], {
      AIONUI_MANAGED_RESOURCES_BUNDLE: 'lite',
    });

    try {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Invalid AIONUI_MANAGED_RESOURCES_BUNDLE');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.each([
    { profile: 'thin-shell', releaseFlag: 'EVAOS_FINALIZE_MAC_DMG' },
    { profile: 'thin-shell', releaseFlag: 'EVAOS_BETA_PUBLIC_RELEASE' },
    { profile: 'thin-shell', releaseFlag: 'EVAOS_BETA_REQUIRE_SIGNING' },
    { profile: 'functional-smoke', releaseFlag: 'EVAOS_BETA_REQUIRE_SIGNING' },
    { profile: 'functional-smoke', releaseFlag: 'appleId' },
    { profile: 'functional-smoke', releaseFlag: 'TEAM_ID' },
  ])('rejects $profile when release flag $releaseFlag is set', ({ profile, releaseFlag }) => {
    const { result, tempDir } = runBuildWithHook(
      ['arm64', '--mac', 'dir', '--arm64', `--packaging-profile=${profile}`],
      { [releaseFlag]: 'true' }
    );

    try {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`EVAOS_PACKAGING_PROFILE=${profile} is smoke proof only`);
      expect(result.stderr).toContain(releaseFlag);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
