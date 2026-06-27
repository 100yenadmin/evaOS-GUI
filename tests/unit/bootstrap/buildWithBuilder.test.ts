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

describe('build-with-builder', () => {
  function readJsonIfExists<T>(filePath: string, fallback: T): T {
    return existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : fallback;
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
  return { prepared: true, dir: 'mock-bundled-aioncore', sourceType: 'mock' };
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === './prepareAioncore' || request.endsWith('/prepareAioncore')) {
    return recordPrepareCall;
  }

  if (request.endsWith('packages/shared-scripts/src/prepare-aioncore.js')) {
    return { prepareAioncore: recordPrepareCall };
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
        ...process.env,
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
    },
    {
      args: ['auto', '--mac', '--x64'],
      expectedArch: 'x64',
    },
  ])('prepares bundled AionCore for $expectedArch with args $args', ({ args, expectedArch }) => {
    const { callsPath, result, tempDir } = runBuildWithHook(args);

    try {
      expect(result.status, result.stderr || result.stdout).toBe(0);

      const calls = JSON.parse(readFileSync(callsPath, 'utf8')) as Array<{ arch?: string } | null>;
      expect(calls).toContainEqual(expect.objectContaining({ arch: expectedArch }));
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

      const generatedConfig = readFileSync(thinShellConfigPath, 'utf8');
      expect(generatedConfig).not.toContain('from: resources/bundled-aioncore');
      expect(generatedConfig).not.toContain('from: resources/hub');
      expect(generatedConfig).not.toContain('from: resources/Bridge');
      expect(generatedConfig).toContain('from: public');
      expect(generatedConfig).toContain('from: resources/app.png');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects thin-shell when release flags are set', () => {
    const { result, tempDir } = runBuildWithHook(
      ['arm64', '--mac', 'dir', '--arm64', '--packaging-profile=thin-shell'],
      { EVAOS_FINALIZE_MAC_DMG: 'true' }
    );

    try {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('EVAOS_PACKAGING_PROFILE=thin-shell is UI-shell proof only');
      expect(result.stderr).toContain('EVAOS_FINALIZE_MAC_DMG');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
