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
import { GOLDEN_WORKBENCH_PARITY_MANIFEST } from '../../../packages/desktop/src/renderer/evaos/__fixtures__/goldenWorkbenchParityManifest';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../..');
const installedAppProof = require('../../../scripts/evaosInstalledAppProductProof.js') as {
  DEFAULT_APP_PATH: string;
  DEFAULT_EXECUTABLE_NAME: string;
  DEFAULT_BUNDLE_ID: string;
  DEFAULT_PROTOCOL_SCHEME: string;
  assertCanonicalProofAppPath: (appPath: string, options?: { allowNonCanonicalAppPath?: boolean }) => void;
  assertDesktopProofStateClean: (state: {
    expectedAppPath: string;
    expectedBridgePath: string;
    indexedApps: Array<{ bundleId: string; path: string | null; status: string }>;
    staleIndexedApps: Array<{ bundleId: string; path: string; status: string }>;
    runningProcesses: Array<{ pid: string | null; command: string | null }>;
    staleRunningProcesses: Array<{ pid: string | null; command: string }>;
    launchAgent: { label: string; status: string; bridgePath: string | null };
    staleLaunchAgent: boolean;
  }) => void;
  assertExpectedBundle: (bundleInfo: {
    bundleId: string;
    bundleName: string;
    bundleVersion: string;
    shortVersion: string;
    protocolSchemes: string[];
  }) => void;
  assertMacBuildVersion: (value: string, label: string) => void;
  assertMacVersionString: (value: string, label: string) => void;
  artifactRootForHead: (head: string, env?: Record<string, string | undefined>) => string;
  assertExpectedProtocolHandler: (handler: { scheme: string; bundleId: string | null; evidence: string }) => void;
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
    artifactName: string;
    closeoutState: 'loaded' | 'denied' | 'repair' | 'waived';
    settledMarkers: string[];
    waitSelectors: string[];
    action?: string;
  }>;
  buildInstalledProofPreflightPlan: (options?: { expectedHead?: string }) => Array<{
    id: string;
    route: string;
    screenshot: string;
    artifactName: string;
    closeoutState: 'loaded';
    settledMarkers: string[];
    waitSelectors: string[];
  }>;
  installedExecutablePath: (appPath?: string) => string;
  markdownForInstalledProof: (report: {
    repoHead: string;
    expectedHead: string;
    appPath: string;
    executablePath: string;
    protocolHandler?: {
      scheme: string;
      bundleId: string | null;
      evidence: string;
      status: string;
    };
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
  inspectDesktopProofState: (
    appPath: string,
    execFileSyncImpl: (command: string, args: string[], options: { encoding: 'utf8'; maxBuffer?: number }) => string
  ) => {
    expectedAppPath: string;
    expectedBridgePath: string;
    indexedApps: Array<{ bundleId: string; path: string | null; status: string }>;
    staleIndexedApps: Array<{ bundleId: string; path: string; status: string }>;
    runningProcesses: Array<{ pid: string | null; command: string | null }>;
    staleRunningProcesses: Array<{ pid: string | null; command: string }>;
    launchAgent: { label: string; status: string; bridgePath: string | null };
    staleLaunchAgent: boolean;
  };
  parseAppBundlePaths: (output: string) => string[];
  parseLaunchAgentBridgePath: (output: string) => string | null;
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
    protocolHandler?: {
      scheme: string;
      bundleId: string | null;
      evidence: string;
      status: string;
    };
    failure?: {
      stage: string;
      id: string;
      route: string;
      currentHash: string;
      expectedSelectors: string[];
      screenshot: string | null;
      message: string;
    };
    plan: Array<{ id: string; route: string; screenshot: string; waitSelectors: string[] }>;
  }) => { reportPath: string; proofPath: string; takeoverPath: string };
  parseLaunchServicesProtocolHandler: (
    dump: string,
    scheme?: string
  ) => {
    scheme: string;
    bundleId: string | null;
    evidence: string;
  };
  parseRunningWorkbenchProcesses: (output: string) => Array<{ pid: string | null; command: string }>;
  readLaunchServicesProtocolHandler: (
    scheme?: string,
    execFileSyncImpl?: (command: string, args: string[], options: { encoding: 'utf8'; maxBuffer?: number }) => string
  ) => {
    scheme: string;
    bundleId: string | null;
    evidence: string;
  };
};

describe('evaOS installed app product proof', () => {
  it('exposes a package script for agents to run the installed-app proof', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

    expect(packageJson.scripts['evaos:installed-app-proof']).toBe('node scripts/evaosInstalledAppProductProof.js');
  });

  it('pins the installed macOS beta app identity and executable path', () => {
    expect(installedAppProof.DEFAULT_APP_PATH).toBe('/Applications/evaOS Workbench.app');
    expect(installedAppProof.DEFAULT_EXECUTABLE_NAME).toBe('evaOS Workbench');
    expect(installedAppProof.DEFAULT_BUNDLE_ID).toBe('com.evaos.workbench');
    expect(installedAppProof.DEFAULT_PROTOCOL_SCHEME).toBe('evaos-workbench');
    expect(installedAppProof.installedExecutablePath()).toBe(
      '/Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench'
    );
  });

  it('rejects bundle-id-only or stale beta app targets before Computer Use proof starts', () => {
    expect(() => installedAppProof.assertCanonicalProofAppPath('com.evaos.workbench.beta')).toThrow(
      /absolute \.app path/
    );
    expect(() =>
      installedAppProof.assertCanonicalProofAppPath('/Volumes/LEXAR/Codex/old/evaOS Workbench Beta.app')
    ).toThrow(/Release proof must target \/Applications\/evaOS Workbench\.app/);
    expect(() => installedAppProof.assertCanonicalProofAppPath('/Applications/evaOS Workbench.app')).not.toThrow();
    expect(() =>
      installedAppProof.assertCanonicalProofAppPath('/Applications/evaOS Workbench Beta.app', {
        allowNonCanonicalAppPath: true,
      })
    ).not.toThrow();
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
      'body:has-text("2fb812c12ddf")'
    );
    expect(proofPlan.find((entry) => entry.id === 'mission-control')?.waitSelectors).not.toContain(
      'body:has-text("2fb812c12ddf")'
    );
  });

  it('normalizes body text waits to the installed Playwright selector syntax', () => {
    const proofPlan = installedAppProof.buildInstalledProofPlan([
      {
        id: 'home',
        route: '/home',
        screenshot: '00-home.png',
        waitSelectors: ['body:text("evaOS Workbench")', 'body:has-text("Home")', '[data-testid="ready"]'],
      },
    ]);

    expect(proofPlan[0].waitSelectors).toEqual([
      'body:has-text("evaOS Workbench")',
      'body:has-text("Home")',
      '[data-testid="ready"]',
    ]);
  });

  it('builds installed proof from golden parity manifest rows instead of screenshot-only targets', () => {
    const proofPlan = installedAppProof.buildInstalledProofPlan(undefined, {
      expectedHead: '2fb812c12ddfcba9e25511bc06b136862ae9130f',
    });

    expect(proofPlan.map((entry) => entry.id)).toEqual(
      GOLDEN_WORKBENCH_PARITY_MANIFEST.map((row) => row.proofTarget.planId)
    );

    const byId = new Map(proofPlan.map((entry) => [entry.id, entry]));
    expect(byId.get('mac-iphone')).toMatchObject({
      id: 'mac-iphone',
      route: '/native-companion',
      screenshot: '06-mac-iphone.png',
      artifactName: 'screenshots/06-mac-iphone.png',
      closeoutState: 'repair',
      settledMarkers: ['Mac & iPhone', 'Mac control repair', 'Boundary clean'],
    });
    expect(byId.get('mac-iphone')?.waitSelectors).toEqual(
      expect.arrayContaining([
        'body:has-text("Mac & iPhone")',
        'body:has-text("Mac control repair")',
        'body:has-text("Boundary clean")',
      ])
    );
    expect(byId.get('settings-about')?.waitSelectors).toContain('body:has-text("2fb812c12ddf")');
  });

  it('runs exact-candidate About preflight before golden parity rows can blame product routes', () => {
    const preflight = installedAppProof.buildInstalledProofPreflightPlan({
      expectedHead: '2fb812c12ddfcba9e25511bc06b136862ae9130f',
    });

    expect(preflight).toEqual([
      expect.objectContaining({
        id: 'settings-about-current-candidate',
        route: '/settings/about',
        screenshot: 'preflight-settings-about.png',
        artifactName: 'screenshots/preflight-settings-about.png',
        closeoutState: 'loaded',
        settledMarkers: expect.arrayContaining(['About', 'Build identity', '2fb812c12ddf']),
        waitSelectors: expect.arrayContaining([
          'body:has-text("About")',
          'body:has-text("Build identity")',
          'body:has-text("2fb812c12ddf")',
        ]),
      }),
    ]);
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
      if (key === 'Print:CFBundleIdentifier') return 'com.evaos.workbench\n';
      if (key === 'Print:CFBundleName') return 'evaOS Workbench\n';
      if (key === 'Print:CFBundleVersion') return '2.1.18-evaos-beta.0\n';
      if (key === 'Print:CFBundleShortVersionString') return '2.1.18-evaos-beta.0\n';
      if (key === 'Print:CFBundleURLTypes:0:CFBundleURLSchemes') return 'Array {\n    evaos-workbench\n}\n';
      throw new Error(`unexpected key ${key}`);
    };

    expect(installedAppProof.readInfoPlist('/Applications/evaOS Workbench.app', fakeExec)).toEqual({
      bundleId: 'com.evaos.workbench',
      bundleName: 'evaOS Workbench',
      bundleVersion: '2.1.18-evaos-beta.0',
      shortVersion: '2.1.18-evaos-beta.0',
      protocolSchemes: ['evaos-workbench'],
    });
    expect(calls.every((args) => args.at(-1) === '/Applications/evaOS Workbench.app/Contents/Info.plist')).toBe(true);
  });

  it('requires macOS plist versions to stay numeric while beta labels live in release metadata', () => {
    expect(() => installedAppProof.assertMacVersionString('2.1.23', 'CFBundleShortVersionString')).not.toThrow();
    expect(() => installedAppProof.assertMacBuildVersion('28121317549', 'CFBundleVersion')).not.toThrow();
    expect(() => installedAppProof.assertMacBuildVersion('20260625.1', 'CFBundleVersion')).not.toThrow();
    expect(() => installedAppProof.assertMacVersionString('2.1.23-evaos-beta.0', 'CFBundleShortVersionString')).toThrow(
      /three period-separated integers/
    );
    expect(() => installedAppProof.assertMacBuildVersion('2.1.23-evaos-beta.0', 'CFBundleVersion')).toThrow(
      /numeric components/
    );
  });

  it('fails bundle assertions for stale beta identity or non-numeric macOS versions', () => {
    expect(() =>
      installedAppProof.assertExpectedBundle({
        bundleId: 'com.evaos.workbench',
        bundleName: 'evaOS Workbench',
        bundleVersion: '28121317549',
        shortVersion: '2.1.23',
        protocolSchemes: ['evaos-workbench'],
      })
    ).not.toThrow();

    expect(() =>
      installedAppProof.assertExpectedBundle({
        bundleId: 'com.evaos.workbench.beta',
        bundleName: 'evaOS Workbench Beta',
        bundleVersion: '2.1.23-evaos-beta.0',
        shortVersion: '2.1.23-evaos-beta.0',
        protocolSchemes: ['evaos-workbench-beta'],
      })
    ).toThrow(/bundle id/);
  });

  it('parses indexed app bundle paths even when old backup names extend past .app', () => {
    expect(
      installedAppProof.parseAppBundlePaths(
        [
          '/Applications/evaOS Workbench.app',
          '/Volumes/LEXAR/Codex/aionui-rd/app-backups/evaOS Workbench Beta.before-staging.20260623014850.app',
          '/Volumes/LEXAR/Codex/evaos-rc-artifacts/backup-installed-apps/evaOS Workbench Beta.app.20260613-012540',
          '/Volumes/LEXAR/Codex/not-an-app.txt',
        ].join('\n')
      )
    ).toEqual([
      '/Applications/evaOS Workbench.app',
      '/Volumes/LEXAR/Codex/aionui-rd/app-backups/evaOS Workbench Beta.before-staging.20260623014850.app',
      '/Volumes/LEXAR/Codex/evaos-rc-artifacts/backup-installed-apps/evaOS Workbench Beta.app.20260613-012540',
    ]);
  });

  it('detects stale running extracted Workbench apps before blaming product behavior', () => {
    expect(
      installedAppProof.parseRunningWorkbenchProcesses(
        [
          '6195 /Volumes/LEXAR/Codex/aionui-rd/old/evaOS Workbench Beta.app/Contents/MacOS/evaOS Workbench Beta',
          '6201 /Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench',
          '6202 /bin/zsh -lc rg "evaOS Workbench"',
        ].join('\n')
      )
    ).toEqual([
      {
        pid: '6195',
        command: '/Volumes/LEXAR/Codex/aionui-rd/old/evaOS Workbench Beta.app/Contents/MacOS/evaOS Workbench Beta',
      },
      {
        pid: '6201',
        command: '/Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench',
      },
    ]);
  });

  it('parses the active bridge LaunchAgent path from launchctl output', () => {
    expect(
      installedAppProof.parseLaunchAgentBridgePath(
        'program = /Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge\n'
      )
    ).toBe('/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge');
  });

  it('fails desktop proof hygiene for Spotlight duplicates, stale processes, or stale bridge paths', () => {
    expect(() =>
      installedAppProof.assertDesktopProofStateClean({
        expectedAppPath: '/Applications/evaOS Workbench.app',
        expectedBridgePath: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
        indexedApps: [],
        staleIndexedApps: [
          {
            bundleId: 'com.evaos.workbench.beta',
            path: '/Volumes/LEXAR/Codex/aionui-rd/old/evaOS Workbench Beta.app',
            status: 'indexed',
          },
        ],
        runningProcesses: [],
        staleRunningProcesses: [],
        launchAgent: {
          label: 'com.electricsheep.evaos-desktop-bridge',
          status: 'loaded',
          bridgePath: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
        },
        staleLaunchAgent: false,
      })
    ).toThrow(/Spotlight indexes stale Workbench app bundles/);

    expect(() =>
      installedAppProof.assertDesktopProofStateClean({
        expectedAppPath: '/Applications/evaOS Workbench.app',
        expectedBridgePath: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
        indexedApps: [],
        staleIndexedApps: [],
        runningProcesses: [],
        staleRunningProcesses: [
          {
            pid: '6195',
            command: '/Volumes/LEXAR/Codex/aionui-rd/old/evaOS Workbench Beta.app/Contents/MacOS/evaOS Workbench Beta',
          },
        ],
        launchAgent: {
          label: 'com.electricsheep.evaos-desktop-bridge',
          status: 'loaded',
          bridgePath: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
        },
        staleLaunchAgent: false,
      })
    ).toThrow(/Stale Workbench app processes/);

    expect(() =>
      installedAppProof.assertDesktopProofStateClean({
        expectedAppPath: '/Applications/evaOS Workbench.app',
        expectedBridgePath: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
        indexedApps: [],
        staleIndexedApps: [],
        runningProcesses: [],
        staleRunningProcesses: [],
        launchAgent: {
          label: 'com.electricsheep.evaos-desktop-bridge',
          status: 'loaded',
          bridgePath:
            '/Volumes/LEXAR/Codex/aionui-rd/old/evaOS Workbench Beta.app/Contents/Resources/Bridge/evaos-desktop-bridge',
        },
        staleLaunchAgent: true,
      })
    ).toThrow(/LaunchAgent points/);
  });

  it('summarizes desktop proof hygiene from macOS system inventories', () => {
    const fakeExec = (command: string, args: string[]) => {
      if (command === '/usr/bin/mdfind' && args[0].includes('com.evaos.workbench.beta')) {
        return '/Volumes/LEXAR/Codex/aionui-rd/old/evaOS Workbench Beta.app\n';
      }
      if (command === '/usr/bin/mdfind') {
        return '/Applications/evaOS Workbench.app\n';
      }
      if (command === '/bin/ps') {
        return [
          '6195 /Volumes/LEXAR/Codex/aionui-rd/old/evaOS Workbench Beta.app/Contents/MacOS/evaOS Workbench Beta',
          '6201 /Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench',
        ].join('\n');
      }
      if (command === '/usr/bin/id') return '501\n';
      if (command === '/bin/launchctl') {
        return 'program = /Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge\n';
      }
      throw new Error(`unexpected command ${command}`);
    };

    const state = installedAppProof.inspectDesktopProofState('/Applications/evaOS Workbench.app', fakeExec);

    expect(state.staleIndexedApps).toEqual([
      {
        bundleId: 'com.evaos.workbench.beta',
        path: '/Volumes/LEXAR/Codex/aionui-rd/old/evaOS Workbench Beta.app',
        status: 'indexed',
      },
    ]);
    expect(state.staleRunningProcesses).toEqual([
      {
        pid: '6195',
        command: '/Volumes/LEXAR/Codex/aionui-rd/old/evaOS Workbench Beta.app/Contents/MacOS/evaOS Workbench Beta',
      },
    ]);
    expect(state.staleLaunchAgent).toBe(false);
  });

  it('parses LaunchServices protocol handler ownership for the beta scheme', () => {
    const dump = [
      '---------------------------------------------------------------------------------',
      'handlerpref id:             tg (0x1c)',
      'all roles:                  ru.keepcoder.telegram',
      '---------------------------------------------------------------------------------',
      'handlerpref id:             evaos-workbench (0x20)',
      'unknown:                    evaos-workbench',
      'all roles:                  com.evaos.workbench',
      '---------------------------------------------------------------------------------',
    ].join('\n');

    expect(installedAppProof.parseLaunchServicesProtocolHandler(dump)).toEqual({
      scheme: 'evaos-workbench',
      bundleId: 'com.evaos.workbench',
      evidence: 'handlerpref id: evaos-workbench; all roles: com.evaos.workbench',
    });
  });

  it('uses a larger LaunchServices dump buffer for installed-app proof on busy Macs', () => {
    const calls: Array<{ args: string[]; maxBuffer?: number }> = [];
    const fakeExec = (_command: string, args: string[], options: { encoding: 'utf8'; maxBuffer?: number }) => {
      calls.push({ args, maxBuffer: options.maxBuffer });
      return [
        '---------------------------------------------------------------------------------',
        'handlerpref id:             evaos-workbench (0x20)',
        'all roles:                  com.evaos.workbench',
        '---------------------------------------------------------------------------------',
      ].join('\n');
    };

    expect(installedAppProof.readLaunchServicesProtocolHandler('evaos-workbench', fakeExec)).toMatchObject({
      bundleId: 'com.evaos.workbench',
    });
    expect(calls).toEqual([
      {
        args: ['-dump'],
        maxBuffer: expect.any(Number),
      },
    ]);
    expect(calls[0].maxBuffer).toBeGreaterThan(1024 * 1024);
  });

  it('fails installed proof when LaunchServices maps the beta scheme to raw Electron', () => {
    expect(() =>
      installedAppProof.assertExpectedProtocolHandler({
        scheme: 'evaos-workbench',
        bundleId: 'com.github.Electron',
        evidence:
          'handlerpref id: evaos-workbench; all roles: com.github.Electron; path: /Volumes/LEXAR/repos/AionUi/node_modules/.bun/electron@37.10.3/node_modules/electron/dist/Electron.app',
      })
    ).toThrow(/raw Electron/);

    expect(() =>
      installedAppProof.assertExpectedProtocolHandler({
        scheme: 'evaos-workbench',
        bundleId: 'com.evaos.workbench',
        evidence: 'handlerpref id: evaos-workbench; all roles: com.evaos.workbench',
      })
    ).not.toThrow();
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
      bundleId: 'com.evaos.workbench',
      bundleName: 'evaOS Workbench',
      bundleVersion: '2.1.18-evaos-beta.0',
      shortVersion: '2.1.18-evaos-beta.0',
      protocolSchemes: ['evaos-workbench'],
    };
    const files = installedAppProof.writeDryRunProofFiles({
      artifactRoot,
      repoHead: '2fb812c12ddfcba9e25511bc06b136862ae9130f',
      expectedHead: '2fb812c12ddfcba9e25511bc06b136862ae9130f',
      appPath: '/Applications/evaOS Workbench.app',
      executablePath: '/Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench',
      bundleInfo,
      protocolHandler: {
        scheme: 'evaos-workbench',
        bundleId: 'com.evaos.workbench',
        evidence: 'handlerpref id: evaos-workbench; all roles: com.evaos.workbench',
        status: 'passed',
      },
      plan: [
        {
          id: 'settings-about',
          route: '/settings/about',
          screenshot: '05-settings-about.png',
          waitSelectors: ['body:has-text("Build identity")', 'body:has-text("2fb812c12ddf")'],
        },
      ],
    });

    expect(files.reportPath).toBe(path.join(artifactRoot, 'artifacts/installed-app-product-proof-report.json'));
    const report = JSON.parse(fs.readFileSync(files.reportPath, 'utf8'));
    expect(report.screenshots).toEqual([
      expect.objectContaining({
        id: 'settings-about',
        artifactName: 'screenshots/05-settings-about.png',
        closeoutState: 'loaded',
      }),
    ]);
    expect(report.parityAssertions).toEqual([
      expect.objectContaining({
        id: 'settings-about',
        route: '/settings/about',
        artifactName: 'screenshots/05-settings-about.png',
        closeoutState: 'loaded',
        settledMarkers: ['Build identity', '2fb812c12ddf'],
        status: 'pending',
      }),
    ]);
    expect(report.preflightAssertions).toEqual([
      expect.objectContaining({
        id: 'settings-about-current-candidate',
        route: '/settings/about',
        artifactName: 'screenshots/preflight-settings-about.png',
        settledMarkers: ['About', 'Build identity', '2fb812c12ddf'],
        status: 'pending',
      }),
    ]);
    expect(report.protocolHandler).toEqual({
      scheme: 'evaos-workbench',
      bundleId: 'com.evaos.workbench',
      evidence: 'handlerpref id: evaos-workbench; all roles: com.evaos.workbench',
      status: 'passed',
    });
    expect(fs.readFileSync(files.proofPath, 'utf8')).toContain('Expected commit: `2fb812c12ddf`');
    expect(fs.readFileSync(files.proofPath, 'utf8')).toContain('## Protocol Handler');
    expect(fs.readFileSync(files.proofPath, 'utf8')).toContain('- Handler bundle: `com.evaos.workbench`');
    expect(fs.readFileSync(files.proofPath, 'utf8')).toContain('## Exact Candidate Preflight');
    expect(fs.readFileSync(files.proofPath, 'utf8')).toContain('## Parity Assertions');
    expect(fs.readFileSync(files.takeoverPath, 'utf8')).toContain('Run from `/Volumes/LEXAR/repos');
    installedAppProof.assertNoUnsafeProofText(fs.readFileSync(files.reportPath, 'utf8'));
  });

  it('writes an explicit failure packet when the installed app cannot launch', () => {
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-installed-proof-launch-failure-'));
    const bundleInfo = {
      bundleId: 'com.evaos.workbench',
      bundleName: 'evaOS Workbench',
      bundleVersion: '2.1.18-evaos-beta.0',
      shortVersion: '2.1.18-evaos-beta.0',
      protocolSchemes: ['evaos-workbench'],
    };
    const files = installedAppProof.writeDryRunProofFiles({
      artifactRoot,
      repoHead: '2fb812c12ddfcba9e25511bc06b136862ae9130f',
      expectedHead: '2fb812c12ddfcba9e25511bc06b136862ae9130f',
      appPath: '/Applications/evaOS Workbench.app',
      executablePath: '/Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench',
      bundleInfo,
      protocolHandler: {
        scheme: 'evaos-workbench',
        bundleId: 'com.github.Electron',
        evidence:
          'handlerpref id: evaos-workbench; all roles: com.github.Electron; path: /Volumes/LEXAR/repos/AionUi/node_modules/.bun/electron@37.10.3/node_modules/electron/dist/Electron.app',
        status: 'failed',
      },
      plan: [],
      failure: {
        stage: 'launch',
        id: 'installed-app-launch',
        route: 'app-launch',
        currentHash: 'unavailable',
        expectedSelectors: [],
        screenshot: null,
        message: 'Process failed to launch!',
      },
    });

    const report = JSON.parse(fs.readFileSync(files.reportPath, 'utf8'));
    expect(report.failure).toMatchObject({
      stage: 'launch',
      id: 'installed-app-launch',
      route: 'app-launch',
      message: 'Process failed to launch!',
    });
    expect(fs.readFileSync(files.proofPath, 'utf8')).toContain('## Failure');
    expect(fs.readFileSync(files.proofPath, 'utf8')).toContain('`launch`');
    installedAppProof.assertNoUnsafeProofText(fs.readFileSync(files.reportPath, 'utf8'));
  });
});
