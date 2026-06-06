/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { getManagedResourcesRuntimePlan } = require(
  resolve(__dirname, '../../../packages/shared-scripts/src/prepare-aioncore.js')
) as {
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
};

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
