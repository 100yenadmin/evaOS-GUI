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
    launchAgent: { label: string; status: string; bridgePath: string | null; pid?: string | null };
    staleLaunchAgent: boolean;
    bridgeListener?: {
      port: string;
      status: string;
      expectedBridgePath: string;
      owners: Array<{
        pid: string;
        command: string | null;
        cwd?: string | null;
        parentPid?: string | null;
        parentCommand?: string | null;
        parentExecutable?: string | null;
        matchesExpectedBridge: boolean;
        ownershipSource?: string;
      }>;
      staleOwners: Array<{
        pid: string;
        command: string | null;
        cwd?: string | null;
        parentPid?: string | null;
        parentCommand?: string | null;
        parentExecutable?: string | null;
        matchesExpectedBridge: boolean;
        ownershipSource?: string;
      }>;
    };
    staleBridgeListener?: boolean;
  }) => void;
  assertInstalledAppTrustStateClean: (state: {
    codesign: { ok: boolean; stderr?: string; error?: string };
    spctl: { ok: boolean; stderr?: string; error?: string };
    pythonCacheFiles: string[];
    receiptVerifier: {
      path: string;
      present: boolean;
      native: boolean;
      codesign: { ok: boolean };
      architecture: { ok: boolean; output?: string };
    };
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
    launchAgent: { label: string; status: string; bridgePath: string | null; pid?: string | null };
    staleLaunchAgent: boolean;
    bridgeListener: {
      port: string;
      status: string;
      expectedBridgePath: string;
      owners: Array<{
        pid: string;
        command: string | null;
        cwd?: string | null;
        parentPid?: string | null;
        parentCommand?: string | null;
        parentExecutable?: string | null;
        matchesExpectedBridge: boolean;
        ownershipSource?: string;
      }>;
      staleOwners: Array<{
        pid: string;
        command: string | null;
        cwd?: string | null;
        parentPid?: string | null;
        parentCommand?: string | null;
        parentExecutable?: string | null;
        matchesExpectedBridge: boolean;
        ownershipSource?: string;
      }>;
    };
    staleBridgeListener: boolean;
  };
  inspectInstalledAppTrustState: (
    appPath: string,
    execFileSyncImpl: (command: string, args: string[], options: { encoding: 'utf8' }) => string
  ) => {
    codesign: { ok: boolean; command: string; output?: string; stderr?: string; error?: string };
    spctl: { ok: boolean; command: string; output?: string; stderr?: string; error?: string };
    pythonCacheFiles: string[];
    receiptVerifier: {
      path: string;
      present: boolean;
      native: boolean;
      codesign: { ok: boolean };
      architecture: { ok: boolean; output?: string };
    };
  };
  parseAppBundlePaths: (output: string) => string[];
  parseBridgeListenerPids: (output: string) => string[];
  parseLaunchAgentBridgePath: (output: string) => string | null;
  parseLaunchAgentPid: (output: string) => string | null;
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

function argsEqual(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function exactLaunchAgentPythonListenerExec(command: string, args: string[]): string {
  if (command === '/usr/bin/mdfind' && args.length === 1 && args[0].startsWith('kMDItemCFBundleIdentifier == ')) {
    return '/Applications/evaOS Workbench.app\n';
  }
  if (command === '/bin/ps') {
    if (argsEqual(args, ['-axo', 'pid=,command='])) return '';
    if (argsEqual(args, ['-p', '18016', '-o', 'command='])) {
      return '/opt/homebrew/Cellar/python/3.14/bin/Python -S -m evaos_desktop_bridge.host.cli serve --host 100.64.0.4 --port 8765\n';
    }
  }
  if (command === '/usr/sbin/lsof' && argsEqual(args, ['-nP', '-iTCP:8765', '-sTCP:LISTEN', '-t'])) {
    return '18016\n';
  }
  if (command === '/usr/bin/id' && argsEqual(args, ['-u'])) return '501\n';
  if (command === '/bin/launchctl' && argsEqual(args, ['print', 'gui/501/com.electricsheep.evaos-desktop-bridge'])) {
    return [
      'gui/501/com.electricsheep.evaos-desktop-bridge = {',
      '  state = running',
      '  program = /Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
      '  arguments = {',
      '    /Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
      '    serve',
      '    --host',
      '    100.64.0.4',
      '    --port',
      '    8765',
      '  }',
      '  pid = 18016',
      '}',
    ].join('\n');
  }
  throw new Error(`unexpected command ${command} ${args.join(' ')}`);
}

function homebrewLaunchAgentNoListenerExec(command: string, args: string[]): string {
  if (command === '/usr/bin/mdfind' && args.length === 1 && args[0].startsWith('kMDItemCFBundleIdentifier == ')) {
    return '/Applications/evaOS Workbench.app\n';
  }
  if (command === '/bin/ps' && argsEqual(args, ['-axo', 'pid=,command='])) return '';
  if (command === '/usr/sbin/lsof' && argsEqual(args, ['-nP', '-iTCP:8765', '-sTCP:LISTEN', '-t'])) return '';
  if (command === '/usr/bin/id' && argsEqual(args, ['-u'])) return '501\n';
  if (command === '/bin/launchctl' && argsEqual(args, ['print', 'gui/501/com.electricsheep.evaos-desktop-bridge'])) {
    return [
      'gui/501/com.electricsheep.evaos-desktop-bridge = {',
      '  state = waiting',
      '  program = /opt/homebrew/bin/evaos-desktop-bridge',
      '}',
    ].join('\n');
  }
  throw new Error(`unexpected command ${command} ${args.join(' ')}`);
}

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

    const outOfScopeForMacControlRelease = new Set(['approvals', 'design-workspace', 'creative-studio']);
    expect(proofPlan.map((entry) => entry.id)).toEqual(
      GOLDEN_WORKBENCH_PARITY_MANIFEST.filter((row) => !outOfScopeForMacControlRelease.has(row.id)).map(
        (row) => row.proofTarget.planId
      )
    );

    const byId = new Map(proofPlan.map((entry) => [entry.id, entry]));
    for (const skippedId of outOfScopeForMacControlRelease) {
      const skippedPlanId = GOLDEN_WORKBENCH_PARITY_MANIFEST.find((row) => row.id === skippedId)?.proofTarget.planId;
      expect(skippedPlanId ? byId.has(skippedPlanId) : false).toBe(false);
    }
    expect(byId.get('mac-iphone')).toMatchObject({
      id: 'mac-iphone',
      route: '/native-companion',
      screenshot: '06-mac-iphone.png',
      artifactName: 'screenshots/06-mac-iphone.png',
      action: 'click-native-companion-advanced-diagnostics',
      closeoutState: 'repair',
      settledMarkers: ['Mac & iPhone', 'Mac control', 'Native companion status matrix', 'Boundary clean'],
    });
    expect(byId.get('mac-iphone')?.waitSelectors).toEqual(
      expect.arrayContaining([
        'body:has-text("Mac & iPhone")',
        'body:has-text("Mac control")',
        'body:has-text("Native companion status matrix")',
        'body:has-text("Boundary clean")',
      ])
    );
    expect(byId.get('new-chat-landing')).toMatchObject({
      route: '/home',
      hashRoute: '/guid',
    });
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

  it('loads Company Brain before waiting for lazy directory proof markers', async () => {
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

    await installedAppProof.runProofPlanAction(fakePage, 'click-company-brain-load');

    expect(events).toEqual(['button:^Load$', 'first', 'button-wait:visible:25000', 'click', 'wait:25000']);
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

  it('falls back to XML plist parsing when PlistBuddy is unavailable', () => {
    const appPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-linux-plist-')), 'evaOS Workbench.app');
    const contentsDir = path.join(appPath, 'Contents');
    fs.mkdirSync(contentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(contentsDir, 'Info.plist'),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '<key>CFBundleIdentifier</key><string>com.evaos.workbench</string>',
        '<key>CFBundleName</key><string>evaOS Workbench</string>',
        '<key>CFBundleVersion</key><string>2.1.23</string>',
        '<key>CFBundleShortVersionString</key><string>2.1.23</string>',
        '<key>CFBundleURLTypes</key>',
        '<array><dict><key>CFBundleURLSchemes</key><array><string>evaos-workbench</string></array></dict></array>',
        '</dict>',
        '</plist>',
        '',
      ].join('\n'),
      'utf8'
    );
    const missingPlistBuddy = Object.assign(new Error('spawnSync /usr/libexec/PlistBuddy ENOENT'), {
      code: 'ENOENT',
      path: '/usr/libexec/PlistBuddy',
    });
    const fakeExec = () => {
      throw missingPlistBuddy;
    };

    expect(installedAppProof.readInfoPlist(appPath, fakeExec)).toEqual({
      bundleId: 'com.evaos.workbench',
      bundleName: 'evaOS Workbench',
      bundleVersion: '2.1.23',
      shortVersion: '2.1.23',
      protocolSchemes: ['evaos-workbench'],
    });
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
    expect(
      installedAppProof.parseLaunchAgentBridgePath(
        'program = /Applications/evaOS.app/Contents/Resources/Bridge/evaos-desktop-bridge\n'
      )
    ).toBe('/Applications/evaOS.app/Contents/Resources/Bridge/evaos-desktop-bridge');
    expect(installedAppProof.parseLaunchAgentBridgePath('program = /opt/homebrew/bin/evaos-desktop-bridge\n')).toBe(
      '/opt/homebrew/bin/evaos-desktop-bridge'
    );
    expect(
      installedAppProof.parseLaunchAgentBridgePath('program = /opt/homebrew/bin/evaos-desktop-bridge-helper\n')
    ).toBeNull();
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

  it('fails desktop proof hygiene when port 8765 is owned by a non-candidate bridge process', () => {
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
          bridgePath: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
        },
        staleLaunchAgent: false,
        bridgeListener: {
          port: '8765',
          status: 'listening',
          expectedBridgePath: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
          owners: [
            {
              pid: '17959',
              command:
                '/opt/homebrew/Cellar/python/3.14/bin/Python -S -m evaos_desktop_bridge.host.cli serve --port 8765',
              matchesExpectedBridge: false,
            },
          ],
          staleOwners: [
            {
              pid: '17959',
              command:
                '/opt/homebrew/Cellar/python/3.14/bin/Python -S -m evaos_desktop_bridge.host.cli serve --port 8765',
              matchesExpectedBridge: false,
            },
          ],
        },
        staleBridgeListener: true,
      })
    ).toThrow(/Port 8765 is owned by a non-candidate bridge process/);
  });

  it('fails desktop proof hygiene when a non-candidate LaunchAgent is loaded without an active listener', () => {
    const state = installedAppProof.inspectDesktopProofState(
      '/Applications/evaOS Workbench.app',
      homebrewLaunchAgentNoListenerExec
    );

    expect(state.bridgeListener).toMatchObject({ status: 'not-listening', staleOwners: [] });
    expect(state.launchAgent.bridgePath).toBe('/opt/homebrew/bin/evaos-desktop-bridge');
    expect(state.staleLaunchAgent).toBe(true);
    expect(() => installedAppProof.assertDesktopProofStateClean(state)).toThrow(
      /Workbench bridge LaunchAgent points to \/opt\/homebrew\/bin\/evaos-desktop-bridge/
    );
  });

  it('fails desktop proof hygiene when the expected bridge owner has no live listener', () => {
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
          bridgePath: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
        },
        staleLaunchAgent: false,
        bridgeListener: {
          port: '8765',
          status: 'not-listening',
          expectedBridgePath: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
          owners: [],
          staleOwners: [],
        },
        staleBridgeListener: false,
      })
    ).toThrow(/No live Workbench bridge listener/);
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
        if (args[0] === '-p') {
          return '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge serve --port 8765\n';
        }
        return [
          '6195 /Volumes/LEXAR/Codex/aionui-rd/old/evaOS Workbench Beta.app/Contents/MacOS/evaOS Workbench Beta',
          '6201 /Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench',
        ].join('\n');
      }
      if (command === '/usr/sbin/lsof') return '6203\n';
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
    expect(state.bridgeListener).toMatchObject({
      port: '8765',
      status: 'listening',
      staleOwners: [],
    });
  });

  it('summarizes stale listener ownership from macOS lsof and ps output', () => {
    const fakeExec = (command: string, args: string[]) => {
      if (command === '/usr/bin/mdfind') return '/Applications/evaOS Workbench.app\n';
      if (command === '/bin/ps') {
        if (args[0] === '-p') {
          return '/opt/homebrew/Cellar/python/3.14/bin/Python -S -m evaos_desktop_bridge.host.cli serve --port 8765\n';
        }
        return '';
      }
      if (command === '/usr/sbin/lsof') return '17959\nnot-a-pid\n';
      if (command === '/usr/bin/id') return '501\n';
      if (command === '/bin/launchctl') {
        return 'program = /Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge\n';
      }
      throw new Error(`unexpected command ${command}`);
    };

    const state = installedAppProof.inspectDesktopProofState('/Applications/evaOS Workbench.app', fakeExec);

    expect(installedAppProof.parseBridgeListenerPids('17959\nnot-a-pid\n')).toEqual(['17959']);
    expect(state.staleBridgeListener).toBe(true);
    expect(state.bridgeListener.staleOwners).toEqual([
      expect.objectContaining({
        pid: '17959',
        matchesExpectedBridge: false,
      }),
    ]);
  });

  it('accepts a Python listener when launchd owns the exact installed bridge program', () => {
    const state = installedAppProof.inspectDesktopProofState(
      '/Applications/evaOS Workbench.app',
      exactLaunchAgentPythonListenerExec
    );

    expect(installedAppProof.parseLaunchAgentPid('  pid = 18016')).toBe('18016');
    expect(installedAppProof.parseLaunchAgentPid('18016 0 com.electricsheep.evaos-desktop-bridge')).toBe('18016');
    expect(installedAppProof.parseLaunchAgentPid('- 0 com.electricsheep.evaos-desktop-bridge')).toBeNull();
    expect(state.staleBridgeListener).toBe(false);
    expect(state.bridgeListener.owners).toEqual([
      expect.objectContaining({
        pid: '18016',
        matchesExpectedBridge: true,
        ownershipSource: 'launchagent-program',
      }),
    ]);
    expect(state.bridgeListener.staleOwners).toEqual([]);
  });

  it('accepts a Python listener spawned by the exact signed Workbench app from the bundled bridge cwd', () => {
    const fakeExec = (command: string, args: string[]): string => {
      if (command === '/usr/bin/mdfind' && args.length === 1 && args[0].startsWith('kMDItemCFBundleIdentifier == ')) {
        return '/Applications/evaOS Workbench.app\n';
      }
      if (command === '/usr/sbin/lsof' && argsEqual(args, ['-nP', '-iTCP:8765', '-sTCP:LISTEN', '-t'])) {
        return '44784\n';
      }
      if (command === '/usr/sbin/lsof' && argsEqual(args, ['-a', '-p', '44784', '-d', 'cwd', '-Fn'])) {
        return 'p44784\nn/Applications/evaOS Workbench.app/Contents/Resources/Bridge\n';
      }
      if (command === '/bin/ps') {
        if (argsEqual(args, ['-axo', 'pid=,command='])) return '';
        if (argsEqual(args, ['-p', '44784', '-o', 'command='])) {
          return '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/python/bin/python3 -I -B -c import runpy, sys; source_root = sys.argv.pop(1); module = sys.argv.pop(1); sys.path.insert(0, source_root); runpy.run_module(module, run_name="__main__", alter_sys=True) /Applications/evaOS Workbench.app/Contents/Resources/Bridge/src evaos_desktop_bridge.host.cli serve --host 100.64.0.4 --port 8765\n';
        }
        if (argsEqual(args, ['-p', '44784', '-o', 'ppid='])) return '85316\n';
        if (argsEqual(args, ['-p', '85316', '-o', 'command='])) {
          return '/Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench\n';
        }
        if (argsEqual(args, ['-p', '85316', '-o', 'comm='])) {
          return '/Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench\n';
        }
      }
      if (command === '/usr/bin/id' && argsEqual(args, ['-u'])) return '501\n';
      if (
        command === '/bin/launchctl' &&
        argsEqual(args, ['print', 'gui/501/com.electricsheep.evaos-desktop-bridge'])
      ) {
        return 'Bad request. Could not find service.';
      }
      throw new Error(`unexpected command ${command} ${args.join(' ')}`);
    };

    const state = installedAppProof.inspectDesktopProofState('/Applications/evaOS Workbench.app', fakeExec);

    expect(state.staleBridgeListener).toBe(false);
    expect(state.bridgeListener.owners).toEqual([
      expect.objectContaining({
        pid: '44784',
        command:
          '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/python/bin/python3 -I -B -c import runpy, sys; source_root = sys.argv.pop(1); module = sys.argv.pop(1); sys.path.insert(0, source_root); runpy.run_module(module, run_name="__main__", alter_sys=True) /Applications/evaOS Workbench.app/Contents/Resources/Bridge/src evaos_desktop_bridge.host.cli serve --host [redacted-host] --port [redacted-port]',
        cwd: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge',
        parentPid: '85316',
        parentCommand: '/Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench',
        parentExecutable: '/Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench',
        matchesExpectedBridge: true,
        ownershipSource: 'workbench-child-cwd',
      }),
    ]);
    expect(state.bridgeListener.staleOwners).toEqual([]);
  });

  it('rejects a packaged Python command when the bridge invocation is only a later argument substring', () => {
    const expectedBridgePath = '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge';
    const bootstrap =
      'import runpy, sys; source_root = sys.argv.pop(1); module = sys.argv.pop(1); sys.path.insert(0, source_root); runpy.run_module(module, run_name="__main__", alter_sys=True)';
    const misleadingCommand = [
      '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/python/bin/python3',
      '-I -B -c print(0)',
      `-c ${bootstrap}`,
      '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/src',
      'evaos_desktop_bridge.host.cli serve',
    ].join(' ');

    expect(installedAppProof.commandLooksLikeBridgeServer(misleadingCommand, expectedBridgePath)).toBe(false);
  });

  it('keeps a Workbench-mentioned wrapper parent stale when its executable is not the signed Workbench app', () => {
    const fakeExec = (command: string, args: string[]): string => {
      if (command === '/usr/bin/mdfind' && args.length === 1 && args[0].startsWith('kMDItemCFBundleIdentifier == ')) {
        return '/Applications/evaOS Workbench.app\n';
      }
      if (command === '/usr/sbin/lsof' && argsEqual(args, ['-nP', '-iTCP:8765', '-sTCP:LISTEN', '-t'])) {
        return '44784\n';
      }
      if (command === '/usr/sbin/lsof' && argsEqual(args, ['-a', '-p', '44784', '-d', 'cwd', '-Fn'])) {
        return 'p44784\nn/Applications/evaOS Workbench.app/Contents/Resources/Bridge\n';
      }
      if (command === '/bin/ps') {
        if (argsEqual(args, ['-axo', 'pid=,command='])) return '';
        if (argsEqual(args, ['-p', '44784', '-o', 'command='])) {
          return '/opt/homebrew/bin/python3 -S -m evaos_desktop_bridge.host.cli serve --host 100.64.0.4 --port 8765\n';
        }
        if (argsEqual(args, ['-p', '44784', '-o', 'ppid='])) return '85316\n';
        if (argsEqual(args, ['-p', '85316', '-o', 'command='])) {
          return '/bin/sh -c "/Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench --pretend-parent"\n';
        }
        if (argsEqual(args, ['-p', '85316', '-o', 'comm='])) return '/bin/sh\n';
      }
      if (command === '/usr/bin/id' && argsEqual(args, ['-u'])) return '501\n';
      if (
        command === '/bin/launchctl' &&
        argsEqual(args, ['print', 'gui/501/com.electricsheep.evaos-desktop-bridge'])
      ) {
        return 'Bad request. Could not find service.';
      }
      throw new Error(`unexpected command ${command} ${args.join(' ')}`);
    };

    const state = installedAppProof.inspectDesktopProofState('/Applications/evaOS Workbench.app', fakeExec);

    expect(state.staleBridgeListener).toBe(true);
    expect(state.bridgeListener.staleOwners).toEqual([
      expect.objectContaining({
        pid: '44784',
        command:
          '/opt/homebrew/bin/python3 -S -m evaos_desktop_bridge.host.cli serve --host [redacted-host] --port [redacted-port]',
        parentCommand: '/bin/sh -c "/Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench --pretend-parent"',
        parentExecutable: '/bin/sh',
        matchesExpectedBridge: false,
      }),
    ]);
  });

  it('keeps ambient Python stale even when it uses the exact packaged bootstrap and arguments', () => {
    const fakeExec = (command: string, args: string[]): string => {
      if (command === '/usr/bin/mdfind' && args.length === 1 && args[0].startsWith('kMDItemCFBundleIdentifier == ')) {
        return '/Applications/evaOS Workbench.app\n';
      }
      if (command === '/usr/sbin/lsof' && argsEqual(args, ['-nP', '-iTCP:8765', '-sTCP:LISTEN', '-t'])) {
        return '4242\n';
      }
      if (command === '/usr/sbin/lsof' && argsEqual(args, ['-a', '-p', '4242', '-d', 'cwd', '-Fn'])) {
        return 'p4242\nn/Applications/evaOS Workbench.app/Contents/Resources/Bridge\n';
      }
      if (command === '/bin/ps') {
        if (argsEqual(args, ['-axo', 'pid=,command='])) return '';
        if (argsEqual(args, ['-p', '4242', '-o', 'command='])) {
          return '/usr/bin/python3 -I -B -c import runpy, sys; source_root = sys.argv.pop(1); module = sys.argv.pop(1); sys.path.insert(0, source_root); runpy.run_module(module, run_name="__main__", alter_sys=True) /Applications/evaOS Workbench.app/Contents/Resources/Bridge/src evaos_desktop_bridge.host.cli serve --port 8765\n';
        }
        if (argsEqual(args, ['-p', '4242', '-o', 'ppid='])) return '85316\n';
        if (argsEqual(args, ['-p', '85316', '-o', 'command='])) {
          return '/Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench\n';
        }
        if (argsEqual(args, ['-p', '85316', '-o', 'comm='])) {
          return '/Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench\n';
        }
      }
      if (command === '/usr/bin/id' && argsEqual(args, ['-u'])) return '501\n';
      if (
        command === '/bin/launchctl' &&
        argsEqual(args, ['print', 'gui/501/com.electricsheep.evaos-desktop-bridge'])
      ) {
        return 'Bad request. Could not find service.';
      }
      throw new Error(`unexpected command ${command} ${args.join(' ')}`);
    };

    const state = installedAppProof.inspectDesktopProofState('/Applications/evaOS Workbench.app', fakeExec);

    expect(state.staleBridgeListener).toBe(true);
    expect(state.bridgeListener.staleOwners).toEqual([
      expect.objectContaining({
        pid: '4242',
        command:
          '/usr/bin/python3 -I -B -c import runpy, sys; source_root = sys.argv.pop(1); module = sys.argv.pop(1); sys.path.insert(0, source_root); runpy.run_module(module, run_name="__main__", alter_sys=True) /Applications/evaOS Workbench.app/Contents/Resources/Bridge/src evaos_desktop_bridge.host.cli serve --port [redacted-port]',
        cwd: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge',
        parentExecutable: '/Applications/evaOS Workbench.app/Contents/MacOS/evaOS Workbench',
        matchesExpectedBridge: false,
      }),
    ]);
  });

  it('keeps the listener stale when launchd owns the expected bridge but a different PID listens', () => {
    const mismatchedExec = (command: string, args: string[]): string => {
      if (command === '/usr/sbin/lsof' && argsEqual(args, ['-nP', '-iTCP:8765', '-sTCP:LISTEN', '-t'])) {
        return '99999\n';
      }
      if (command === '/bin/ps' && argsEqual(args, ['-p', '99999', '-o', 'command='])) {
        return '/usr/bin/python -m something_else\n';
      }
      return exactLaunchAgentPythonListenerExec(command, args);
    };

    const state = installedAppProof.inspectDesktopProofState('/Applications/evaOS Workbench.app', mismatchedExec);

    expect(state.staleBridgeListener).toBe(true);
    expect(state.bridgeListener.staleOwners).toEqual([
      expect.objectContaining({
        pid: '99999',
        matchesExpectedBridge: false,
      }),
    ]);
  });

  it('fails installed-app trust when Python cache files mutate the signed bridge bundle', () => {
    const tempApp = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-app-trust-'));
    const bridgeRoot = path.join(tempApp, 'Contents/Resources/Bridge/src/evaos_desktop_bridge/__pycache__');
    fs.mkdirSync(bridgeRoot, { recursive: true });
    fs.writeFileSync(path.join(bridgeRoot, 'qa_canary.cpython-314.pyc'), 'cache');

    const trust = installedAppProof.inspectInstalledAppTrustState(tempApp, () => '');

    expect(trust.pythonCacheFiles).toEqual(['src/evaos_desktop_bridge/__pycache__/qa_canary.cpython-314.pyc']);
    expect(() => installedAppProof.assertInstalledAppTrustStateClean(trust)).toThrow(/Python cache files/);
  });

  it('fails installed-app trust when codesign or Gatekeeper rejects the candidate', () => {
    const tempApp = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-app-codesign-'));
    fs.mkdirSync(path.join(tempApp, 'Contents/Resources/Bridge'), { recursive: true });
    const fakeExec = (command: string) => {
      if (command === '/usr/bin/codesign') {
        const error = new Error('codesign failed') as Error & { stderr: string };
        error.stderr = '/Applications/evaOS Workbench.app: a sealed resource is missing or invalid';
        throw error;
      }
      return '';
    };

    const trust = installedAppProof.inspectInstalledAppTrustState(tempApp, fakeExec);

    expect(trust.codesign.ok).toBe(false);
    expect(() => installedAppProof.assertInstalledAppTrustStateClean(trust)).toThrow(/codesign verification failed/);
  });

  it('fails installed-app trust when the signed native receipt verifier is absent', () => {
    const tempApp = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-app-receipt-verifier-'));
    fs.mkdirSync(path.join(tempApp, 'Contents/Resources/Bridge'), { recursive: true });

    const trust = installedAppProof.inspectInstalledAppTrustState(tempApp, () => '');

    expect(trust.receiptVerifier.present).toBe(false);
    expect(() => installedAppProof.assertInstalledAppTrustStateClean(trust)).toThrow(/receipt verifier is missing/);
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
    expect(fs.readFileSync(files.takeoverPath, 'utf8')).toContain('Mac-control-scoped installed proof row');
    expect(fs.readFileSync(files.takeoverPath, 'utf8')).not.toContain('every golden Workbench parity row');
    expect(fs.readFileSync(files.takeoverPath, 'utf8')).toContain('Intentionally out of scope');
    expect(fs.readFileSync(files.takeoverPath, 'utf8')).toContain('`approvals`');
    expect(fs.readFileSync(files.takeoverPath, 'utf8')).toContain('visible first-party agent Mac-control tool calls');
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
