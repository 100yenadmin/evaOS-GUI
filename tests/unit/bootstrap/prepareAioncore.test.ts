/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { applyManagedResourcesBundle, getManagedResourcesRuntimePlan, normalizeManagedResourcesBundle } = require(
  resolve(__dirname, '../../../packages/shared-scripts/src/prepare-aioncore.js')
) as {
  applyManagedResourcesBundle: (options: { targetDir: string; mode: 'full' | 'no-acp' }) => {
    mode: 'full' | 'no-acp';
    prunedResources: string[];
    keptResources?: string[];
  };
  getManagedResourcesRuntimePlan: (
    platform: string,
    arch: string,
    hostPlatform?: string,
    hostArch?: string
  ) => {
    kind: 'target' | 'host-compatible';
    platform: string;
    arch: string;
    runtimeKey: string;
    targetRuntimeKey?: string;
  } | null;
  normalizeManagedResourcesBundle: (value?: string) => 'full' | 'no-acp';
};

const { getBuildRunId, getBuildSourceSha } = require(
  resolve(__dirname, '../../../packages/shared-scripts/src/prepare-aioncore.js')
) as {
  getBuildRunId: (env?: Record<string, string | undefined>) => string | null;
  getBuildSourceSha: (env?: Record<string, string | undefined>) => string | null;
};

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'evaos-prepare-aioncore-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('prepareAioncore managed resources runtime plan', () => {
  it('uses the target binary when target platform and arch match the host', () => {
    expect(getManagedResourcesRuntimePlan('win32', 'x64', 'win32', 'x64')).toEqual({
      kind: 'target',
      platform: 'win32',
      arch: 'x64',
      runtimeKey: 'win32-x64',
    });
  });

  it('uses a host-compatible same-platform binary for cross-arch managed resources', () => {
    expect(getManagedResourcesRuntimePlan('win32', 'arm64', 'win32', 'x64')).toEqual({
      kind: 'host-compatible',
      platform: 'win32',
      arch: 'x64',
      runtimeKey: 'win32-x64',
      targetRuntimeKey: 'win32-arm64',
    });
  });

  it('fails closed when the target platform differs from the host platform', () => {
    expect(getManagedResourcesRuntimePlan('win32', 'arm64', 'darwin', 'arm64')).toBeNull();
  });
});

describe('prepareAioncore managed resources bundle', () => {
  it('validates managed resource bundle modes', () => {
    expect(normalizeManagedResourcesBundle()).toBe('full');
    expect(normalizeManagedResourcesBundle('no-acp')).toBe('no-acp');
    expect(() => normalizeManagedResourcesBundle('thin-shell')).toThrow(/Invalid AIONUI_MANAGED_RESOURCES_BUNDLE/);
  });

  it('prunes only Claude/Codex ACP managed resources in no-acp mode', () => {
    const targetDir = makeTempDir();
    mkdirSync(resolve(targetDir, 'managed-resources', 'acp', 'codex-acp', '0.14.0'), { recursive: true });
    mkdirSync(resolve(targetDir, 'managed-resources', 'acp', 'claude-agent-acp', '0.39.0'), { recursive: true });
    mkdirSync(resolve(targetDir, 'managed-resources', 'node', 'node-v24.11.0-darwin-arm64', 'bin'), {
      recursive: true,
    });
    writeFileSync(resolve(targetDir, 'managed-resources', 'acp', 'codex-acp', '0.14.0', 'package.json'), '{}');
    writeFileSync(resolve(targetDir, 'managed-resources', 'acp', 'claude-agent-acp', '0.39.0', 'package.json'), '{}');
    writeFileSync(resolve(targetDir, 'managed-resources', 'node', 'node-v24.11.0-darwin-arm64', 'bin', 'node'), '');

    const result = applyManagedResourcesBundle({ targetDir, mode: 'no-acp' });

    expect(result.prunedResources).toEqual(['acp/claude-agent-acp/', 'acp/codex-acp/']);
    expect(result.keptResources).toContain('node/');
    expect(result.keptResources).toContain('node/node-v24.11.0-darwin-arm64/bin/node');
  });
});

describe('prepareAioncore source provenance', () => {
  it('prefers the checked-out app commit over the workflow commit', () => {
    expect(
      getBuildSourceSha({
        EVAOS_APP_COMMIT: 'candidate-sha',
        GITHUB_SHA: 'workflow-sha',
      })
    ).toBe('candidate-sha');
  });

  it('falls back to GitHub workflow metadata when no candidate override exists', () => {
    expect(getBuildSourceSha({ GITHUB_SHA: 'workflow-sha' })).toBe('workflow-sha');
    expect(getBuildRunId({ GITHUB_RUN_ID: '12345' })).toBe('12345');
  });
});
