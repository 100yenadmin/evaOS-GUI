/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const {
  getPreparedAioncoreReuseState,
  prepareAioncore,
} = require('../../../packages/shared-scripts/src/prepare-aioncore.js');

type RuntimeOptions = {
  arch?: string;
  managedNodeRuntimePresent?: boolean;
  managedResourcesPresent?: boolean;
  platform?: string;
  version?: string;
};

function binaryNameForPlatform(platform: string) {
  return platform === 'win32' ? 'aioncore.exe' : 'aioncore';
}

function writePreparedRuntime(projectRoot: string, options: RuntimeOptions = {}) {
  const platform = options.platform ?? 'darwin';
  const arch = options.arch ?? 'arm64';
  const version = options.version ?? 'v-test';
  const runtimeKey = `${platform}-${arch}`;
  const binaryName = binaryNameForPlatform(platform);
  const runtimeDir = join(projectRoot, 'resources', 'bundled-aioncore', runtimeKey);

  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, binaryName), '#!/bin/sh\n');
  if (platform !== 'win32') chmodSync(join(runtimeDir, binaryName), 0o755);

  if (options.managedResourcesPresent) {
    mkdirSync(join(runtimeDir, 'managed-resources'), { recursive: true });
  }

  if (options.managedNodeRuntimePresent) {
    mkdirSync(join(runtimeDir, 'managed-node'), { recursive: true });
  }

  const manifest = {
    schema: 'aioncore-bundle/v2',
    platform,
    arch,
    runtimeKey,
    version,
    requestedVersion: version,
    generatedAt: '2026-06-27T00:00:00.000Z',
    github: {
      runId: 'test-run',
      sha: 'test-sha',
      repository: '100yenadmin/evaOS-GUI',
    },
    sourceType: 'download',
    source: {
      url: 'https://example.test/aioncore.tar.gz',
    },
    files: [binaryName],
    resourceShape: {
      binary: {
        present: true,
        relativePath: binaryName,
        type: 'file',
        executable: true,
      },
      manifest: {
        present: true,
        relativePath: 'manifest.json',
        type: 'file',
      },
      managedResources: options.managedResourcesPresent
        ? {
            present: true,
            relativePath: 'managed-resources',
            type: 'directory',
          }
        : {
            present: false,
            candidates: ['managed-resources', 'managed_resources'],
          },
      managedNodeRuntime: options.managedNodeRuntimePresent
        ? {
            present: true,
            relativePath: 'managed-node',
            type: 'directory',
          }
        : {
            present: false,
            candidates: ['managed-node', 'node-runtime'],
          },
    },
  };

  writeFileSync(join(runtimeDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { binaryName, runtimeDir, runtimeKey, version };
}

describe('prepare-aioncore reuse', () => {
  it('reuses a prepared runtime when manifest and resource shape match', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'aioncore-reuse-'));
    const { runtimeDir, version } = writePreparedRuntime(projectRoot);

    try {
      const result = prepareAioncore({
        projectRoot,
        platform: 'darwin',
        arch: 'arm64',
        version,
        reusePrepared: true,
      });

      expect(result).toMatchObject({
        prepared: true,
        reused: true,
        dir: runtimeDir,
      });
      expect(readFileSync(join(runtimeDir, 'manifest.json'), 'utf8')).toContain('"schema": "aioncore-bundle/v2"');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects reuse when the requested version differs from the manifest', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'aioncore-reuse-'));
    writePreparedRuntime(projectRoot, { version: 'v-old' });

    try {
      const state = getPreparedAioncoreReuseState({
        projectRoot,
        platform: 'darwin',
        arch: 'arm64',
        version: 'v-new',
      });

      expect(state.reusable).toBe(false);
      expect(state.reasons).toContain('version mismatch: v-old != v-new');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects reuse when managed-resource presence changed after manifest write', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'aioncore-reuse-'));
    const { runtimeDir, version } = writePreparedRuntime(projectRoot, {
      managedNodeRuntimePresent: false,
      managedResourcesPresent: false,
    });
    mkdirSync(join(runtimeDir, 'managed-resources'), { recursive: true });

    try {
      const state = getPreparedAioncoreReuseState({
        projectRoot,
        platform: 'darwin',
        arch: 'arm64',
        version,
      });

      expect(state.reusable).toBe(false);
      expect(state.reasons).toContain('managedResources presence mismatch: manifest=false actual=true');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
