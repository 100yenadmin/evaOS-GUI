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

describe('build-with-builder', () => {
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
    const tempDir = mkdtempSync(join(tmpdir(), 'aionui-build-test-'));
    const hookPath = join(tempDir, 'hook.cjs');
    const callsPath = join(tempDir, 'prepare-calls.json');

    writeFileSync(
      hookPath,
      `
const childProcess = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const originalLoad = Module._load;

function recordPrepareCall(options) {
  const callsPath = process.env.AIONUI_PREPARE_CALLS_FILE;
  const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, 'utf8')) : [];
  calls.push(options ?? null);
  fs.writeFileSync(callsPath, JSON.stringify(calls));
  return { prepared: true, dir: 'mock-bundled-aioncore', sourceType: 'mock' };
}

function readManagedResourcesBundle() {
  return process.env.AIONUI_MANAGED_RESOURCES_BUNDLE || 'full';
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

// Satisfy build-with-builder's output checks without clobbering real build
// artifacts: out/ lives in the actual repo (the script resolves it from its
// own __dirname), so only create empty placeholders when nothing is there.
function ensurePlaceholder(relativePath) {
  const target = path.join(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, '');
  }
}

childProcess.execSync = function mockedExecSync(command) {
  const commandText = String(command);
  if (commandText.includes('electron-vite build')) {
    ensurePlaceholder('out/main/index.js');
    ensurePlaceholder('out/renderer/index.html');
  }
  return Buffer.from('');
};
`,
      'utf8'
    );

    try {
      const result = spawnSync(process.execPath, ['scripts/build-with-builder.js', ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          AIONUI_PREPARE_CALLS_FILE: callsPath,
          EVAOS_APP_COMMIT: 'test-candidate-sha',
          EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR: tempDir,
          EVAOS_SKIP_BUILD_CLEANUP: '1',
          NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${hookPath}`].filter(Boolean).join(' '),
        },
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(existsSync(tempDir)).toBe(true);

      const calls = JSON.parse(readFileSync(callsPath, 'utf8')) as Array<{
        arch?: string;
        env?: Record<string, string | undefined>;
      } | null>;
      expect(calls).toContainEqual(expect.objectContaining({ arch: expectedArch }));
      expect(calls).toContainEqual(
        expect.objectContaining({
          env: expect.objectContaining({
            EVAOS_APP_COMMIT: 'test-candidate-sha',
            AIONUI_APP_COMMIT: 'test-candidate-sha',
          }),
        })
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.each([
    { prepareFails: false, expectedStatus: 0 },
    { prepareFails: true, expectedStatus: 1 },
  ])(
    'removes its owned Python runtime after desktop bridge preparation (failure=$prepareFails)',
    ({ prepareFails, expectedStatus }) => {
      const tempDir = mkdtempSync(join(tmpdir(), 'aionui-runtime-cleanup-test-'));
      const hookPath = join(tempDir, 'hook.cjs');
      const lifecyclePath = join(tempDir, 'runtime-lifecycle.json');

      writeFileSync(
        hookPath,
        `
const childProcess = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const originalLoad = Module._load;

function recordPrepareCall() {
  return { prepared: true, dir: 'mock-bundled-aioncore', sourceType: 'mock' };
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (request.endsWith('packages/shared-scripts/src/prepare-aioncore.js')) {
    return { prepareAioncore: recordPrepareCall, readManagedResourcesBundle: () => 'no-acp' };
  }
  if (request.endsWith('/resolveAioncoreVersion.js') || request === './resolveAioncoreVersion.js') {
    return { resolveAioncoreVersion: () => 'v-test' };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function writeLifecycle(update) {
  const file = process.env.EVAOS_RUNTIME_LIFECYCLE_FILE;
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...current, ...update }));
}

function ensurePlaceholder(relativePath) {
  const target = path.join(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) fs.writeFileSync(target, '');
}

childProcess.execFileSync = function mockedExecFileSync(command, args, options) {
  if (!String(command).endsWith('prepareEvaosDesktopBridgePythonRuntime.sh')) return Buffer.from('');
  const tempRoot = options.env.RUNNER_TEMP;
  const runtimeDir = path.join(tempRoot, 'prepared-python');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(args[1], 'EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR=' + runtimeDir + '\\n');
  writeLifecycle({ tempRoot, runtimeDir });
  return Buffer.from('');
};

childProcess.execSync = function mockedExecSync(command) {
  const commandText = String(command);
  if (commandText.includes('electron-vite build')) {
    ensurePlaceholder('out/main/index.js');
    ensurePlaceholder('out/renderer/index.html');
  }
  if (commandText.includes('prepareEvaosDesktopBridgeResource.js')) {
    writeLifecycle({ runtimeExistsDuringPrepare: fs.existsSync(process.env.EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR) });
    if (process.env.EVAOS_FORCE_BRIDGE_PREPARE_FAILURE === '1') throw new Error('forced bridge prepare failure');
  }
  return Buffer.from('');
};
`,
        'utf8'
      );

      try {
        const result = spawnSync(process.execPath, ['scripts/build-with-builder.js', 'auto', '--mac', '--arm64'], {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            EVAOS_APP_COMMIT: 'test-candidate-sha',
            EVAOS_FORCE_BRIDGE_PREPARE_FAILURE: prepareFails ? '1' : '0',
            EVAOS_RUNTIME_LIFECYCLE_FILE: lifecyclePath,
            EVAOS_SKIP_BUILD_CLEANUP: '1',
            NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${hookPath}`].filter(Boolean).join(' '),
          },
        });

        expect(result.status, result.stderr || result.stdout).toBe(expectedStatus);
        const lifecycle = JSON.parse(readFileSync(lifecyclePath, 'utf8')) as {
          tempRoot: string;
          runtimeExistsDuringPrepare: boolean;
        };
        expect(lifecycle.runtimeExistsDuringPrepare).toBe(true);
        expect(existsSync(lifecycle.tempRoot)).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  );
});
