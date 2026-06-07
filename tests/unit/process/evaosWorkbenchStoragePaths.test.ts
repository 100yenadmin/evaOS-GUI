/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { registerPlatformServices, type IPlatformServices } from '@/common/platform';
import { getConfigPath, getDataPath, getTempPath } from '@/process/utils/utils';

const makePlatformServices = (paths: { userData: string; home: string; temp: string }): IPlatformServices => ({
  paths: {
    getDataDir: () => paths.userData,
    getTempDir: () => paths.temp,
    getHomeDir: () => paths.home,
    getLogsDir: () => path.join(paths.userData, 'logs'),
    getAppPath: () => '/Applications/evaOS Workbench Beta.app',
    isPackaged: () => true,
    getSystemPath: () => null,
    getName: () => 'evaOS Workbench Beta',
    getVersion: () => '0.6.28',
    needsCliSafeSymlinks: () => true,
  },
  worker: {
    fork: () => {
      throw new Error('worker not available in storage path tests');
    },
  },
  power: { preventSleep: () => null, allowSleep: () => {}, preventDisplaySleep: () => null },
  notification: { send: () => {} },
  network: { fetch: (input, init) => fetch(input, init) },
});

describe('evaOS Workbench storage path defaults', () => {
  let tempRoot: string;

  beforeEach(() => {
    const scratchRoot = path.join(os.tmpdir(), 'evaos-workbench-storage-tests');
    mkdirSync(scratchRoot, { recursive: true });
    tempRoot = mkdtempSync(path.join(scratchRoot, 'evaos-workbench-storage-'));
    registerPlatformServices(
      makePlatformServices({
        userData: path.join(tempRoot, 'Application Support', 'evaOS Workbench Beta'),
        home: path.join(tempRoot, 'home'),
        temp: path.join(tempRoot, 'tmp'),
      })
    );
    mkdirSync(path.join(tempRoot, 'home'), { recursive: true });
    mkdirSync(path.join(tempRoot, 'tmp'), { recursive: true });
  });

  afterEach(() => {
    registerPlatformServices(
      makePlatformServices({
        userData: path.join(os.tmpdir(), 'evaos-workbench-test-reset'),
        home: os.homedir(),
        temp: os.tmpdir(),
      })
    );
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('uses evaOS-owned CLI-safe data and config symlinks instead of legacy AionUi names', () => {
    const dataPath = getDataPath();
    const configPath = getConfigPath();

    expect(dataPath).toBe(path.join(tempRoot, 'home', '.evaos-workbench'));
    expect(configPath).toBe(path.join(tempRoot, 'home', '.evaos-workbench-config'));
    expect(dataPath).not.toContain('.aionui');
    expect(configPath).not.toContain('.aionui');
  });

  it('uses evaOS-owned temp directory naming', () => {
    expect(getTempPath()).toBe(path.join(tempRoot, 'tmp', 'evaos-workbench'));
  });
});
