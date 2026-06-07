/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../..');
const installedAppProof = require('../../../scripts/evaosInstalledAppProductProof.js') as {
  DEFAULT_APP_PATH: string;
  DEFAULT_EXECUTABLE_NAME: string;
  DEFAULT_BUNDLE_ID: string;
  DEFAULT_PROTOCOL_SCHEME: string;
  artifactRootForHead: (head: string, env?: Record<string, string | undefined>) => string;
  assertNoUnsafeProofText: (value: unknown) => void;
  buildInstalledProofPlan: (
    plan?: Array<{
      id: string;
      route: string;
      screenshot: string;
      waitSelectors: string[];
      action?: string;
    }>,
    options?: { expectedHead?: string }
  ) => Array<{
    id: string;
    route: string;
    screenshot: string;
    waitSelectors: string[];
    action?: string;
  }>;
  installedExecutablePath: (appPath?: string) => string;
  markdownForInstalledProof: (report: {
    repoHead: string;
    expectedHead: string;
    appPath: string;
    executablePath: string;
    bundleInfo: {
      bundleId: string;
      bundleName: string;
      bundleVersion: string;
      shortVersion: string;
      protocolSchemes: string[];
    };
    screenshots: Array<{ id: string; route: string; screenshot: string; status: string }>;
  }) => string;
  readInfoPlist: (
    appPath: string,
    execFileSyncImpl?: (command: string, args: string[], options: { encoding: 'utf8' }) => string
  ) => {
    bundleId: string;
    bundleName: string;
    bundleVersion: string;
    shortVersion: string;
    protocolSchemes: string[];
  };
  runProofPlanAction: (page: unknown, action?: string) => Promise<void>;
  writeDryRunProofFiles: (options: {
    artifactRoot: string;
    repoHead: string;
    expectedHead: string;
    appPath: string;
    executablePath: string;
    bundleInfo: {
      bundleId: string;
      bundleName: string;
      bundleVersion: string;
      shortVersion: string;
      protocolSchemes: string[];
    };
    plan: Array<{ id: string; route: string; screenshot: string; waitSelectors: string[] }>;
  }) => { reportPath: string; proofPath: string; takeoverPath: string };
};

describe('evaOS installed app product proof', () => {
  it('exposes a package script for agents to run the installed-app proof', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

    expect(packageJson.scripts['evaos:installed-app-proof']).toBe('node scripts/evaosInstalledAppProductProof.js');
  });

  it('pins the installed macOS beta app identity and executable path', () => {
    expect(installedAppProof.DEFAULT_APP_PATH).toBe('/Applications/evaOS Workbench Beta.app');
    expect(installedAppProof.DEFAULT_EXECUTABLE_NAME).toBe('evaOS Workbench Beta');
    expect(installedAppProof.DEFAULT_BUNDLE_ID).toBe('com.evaos.workbench.beta');
    expect(installedAppProof.DEFAULT_PROTOCOL_SCHEME).toBe('evaos-workbench-beta');
    expect(installedAppProof.installedExecutablePath()).toBe(
      '/Applications/evaOS Workbench Beta.app/Contents/MacOS/evaOS Workbench Beta'
    );
  });

  it('creates the current-head #67 artifact root on Lexar by default', () => {
    expect(installedAppProof.artifactRootForHead('2fb812c12ddfcba9e25511bc06b136862ae9130f')).toBe(
      '/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/67-real-admin-product-reality-pass/current-head-2fb812c12ddf/installed-app-proof'
    );
    expect(
      installedAppProof.artifactRootForHead('2fb812c12ddf', {
        EVAOS_INSTALLED_APP_PROOF_ROOT: '/Volumes/LEXAR/Codex/custom-proof',
      })
    ).toBe('/Volumes/LEXAR/Codex/custom-proof');
  });

  it('adds the expected commit marker to About proof so stale installed apps fail', () => {
    const proofPlan = installedAppProof.buildInstalledProofPlan(
      [
        {
          id: 'settings-about',
          route: '/settings/about',
          screenshot: '05-settings-about.png',
          waitSelectors: ['body:text("Build identity")'],
        },
        {
          id: 'mission-control',
          route: '/mission-control',
          screenshot: '09-mission-control.png',
          waitSelectors: ['body:text("Mission Control")'],
        },
      ],
      { expectedHead: '2fb812c12ddfcba9e25511bc06b136862ae9130f' }
    );

    expect(proofPlan.find((entry) => entry.id === 'settings-about')?.waitSelectors).toContain(
      'body:text("2fb812c12ddf")'
    );
    expect(proofPlan.find((entry) => entry.id === 'mission-control')?.waitSelectors).not.toContain(
      'body:text("2fb812c12ddf")'
    );
  });

  it('preserves route settle actions so hidden diagnostics can be opened before proof waits', () => {
    const proofPlan = installedAppProof.buildInstalledProofPlan([
      {
        id: 'mac-iphone',
        route: '/native-companion',
        screenshot: '06-mac-iphone.png',
        action: 'click-native-companion-advanced-diagnostics',
        waitSelectors: ['body:text("Mac & iPhone")', 'body:text("Native companion status matrix")'],
      },
      {
        id: 'mission-control',
        route: '/mission-control',
        screenshot: '09-mission-control.png',
        waitSelectors: ['body:text("Mission Control")'],
      },
    ]);

    expect(proofPlan.find((entry) => entry.id === 'mac-iphone')?.action).toBe(
      'click-native-companion-advanced-diagnostics'
    );
    expect(proofPlan.find((entry) => entry.id === 'mission-control')?.action).toBeUndefined();
  });

  it('opens native companion advanced diagnostics before waiting for hidden proof markers', async () => {
    const events: string[] = [];
    const fakePage = {
      getByRole(role: string, roleOptions: { name: RegExp }) {
        events.push(`${role}:${roleOptions.name.source}`);
        return {
          first() {
            events.push('first');
            return {
              async waitFor(waitOptions: { state: string; timeout: number }) {
                events.push(`button-wait:${waitOptions.state}:${waitOptions.timeout}`);
              },
              async click() {
                events.push('click');
              },
            };
          },
        };
      },
      async waitForFunction(predicate: () => boolean, _args: unknown, options: { timeout: number }) {
        expect(predicate()).toBe(false);
        events.push(`wait:${options.timeout}`);
      },
    };

    await installedAppProof.runProofPlanAction(fakePage, 'click-native-companion-advanced-diagnostics');

    expect(events).toEqual([
      'button:Advanced diagnostics',
      'first',
      'button-wait:visible:25000',
      'click',
      'wait:25000',
    ]);
    await expect(installedAppProof.runProofPlanAction(fakePage, 'unknown-action')).rejects.toThrow(/unknown-action/);
  });

  it('reads the installed app plist identity without shelling through raw strings', () => {
    const calls: string[][] = [];
    const fakeExec = (_command: string, args: string[]) => {
      calls.push(args);
      const key = args[1];
      if (key === 'Print:CFBundleIdentifier') return 'com.evaos.workbench.beta\n';
      if (key === 'Print:CFBundleName') return 'evaOS Workbench Beta\n';
      if (key === 'Print:CFBundleVersion') return '2.1.12-evaos-beta.0\n';
      if (key === 'Print:CFBundleShortVersionString') return '2.1.12-evaos-beta.0\n';
      if (key === 'Print:CFBundleURLTypes:0:CFBundleURLSchemes') return 'Array {\n    evaos-workbench-beta\n}\n';
      throw new Error(`unexpected key ${key}`);
    };

    expect(installedAppProof.readInfoPlist('/Applications/evaOS Workbench Beta.app', fakeExec)).toEqual({
      bundleId: 'com.evaos.workbench.beta',
      bundleName: 'evaOS Workbench Beta',
      bundleVersion: '2.1.12-evaos-beta.0',
      shortVersion: '2.1.12-evaos-beta.0',
      protocolSchemes: ['evaos-workbench-beta'],
    });
    expect(calls.every((args) => args.at(-1) === '/Applications/evaOS Workbench Beta.app/Contents/Info.plist')).toBe(
      true
    );
  });

  it('blocks proof reports that contain session, provider, or token material', () => {
    expect(() => installedAppProof.assertNoUnsafeProofText({ ok: 'Commit 2fb812c12ddf' })).not.toThrow();
    expect(() => installedAppProof.assertNoUnsafeProofText({ bad: 'Bearer abc123' })).toThrow(/Bearer/);
    expect(() => installedAppProof.assertNoUnsafeProofText({ bad: 'desktop_session=secret' })).toThrow(
      /desktop_session/
    );
    expect(() => installedAppProof.assertNoUnsafeProofText({ bad: 'grant_handle=secret' })).toThrow(/grant_handle/);
  });

  it('writes dry-run proof files without secrets for a rerunnable handoff', () => {
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-installed-proof-'));
    const bundleInfo = {
      bundleId: 'com.evaos.workbench.beta',
      bundleName: 'evaOS Workbench Beta',
      bundleVersion: '2.1.12-evaos-beta.0',
      shortVersion: '2.1.12-evaos-beta.0',
      protocolSchemes: ['evaos-workbench-beta'],
    };
    const files = installedAppProof.writeDryRunProofFiles({
      artifactRoot,
      repoHead: '2fb812c12ddfcba9e25511bc06b136862ae9130f',
      expectedHead: '2fb812c12ddfcba9e25511bc06b136862ae9130f',
      appPath: '/Applications/evaOS Workbench Beta.app',
      executablePath: '/Applications/evaOS Workbench Beta.app/Contents/MacOS/evaOS Workbench Beta',
      bundleInfo,
      plan: [
        {
          id: 'settings-about',
          route: '/settings/about',
          screenshot: '05-settings-about.png',
          waitSelectors: ['body:text("Build identity")', 'body:text("2fb812c12ddf")'],
        },
      ],
    });

    expect(files.reportPath).toBe(path.join(artifactRoot, 'artifacts/installed-app-product-proof-report.json'));
    expect(fs.readFileSync(files.proofPath, 'utf8')).toContain('Expected commit: `2fb812c12ddf`');
    expect(fs.readFileSync(files.takeoverPath, 'utf8')).toContain('Run from `/Volumes/LEXAR/repos');
    installedAppProof.assertNoUnsafeProofText(fs.readFileSync(files.reportPath, 'utf8'));
  });
});
