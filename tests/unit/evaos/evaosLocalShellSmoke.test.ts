/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const localShellSmoke = require('../../../scripts/evaosLocalShellSmoke.js') as {
  ROUTE_CHECKS: Array<{
    name: string;
    hash: string;
    expected: string[];
    forbidden: string[];
    action?: string;
  }>;
  TEAM_ROUTE_CHECK: {
    name: string;
    hash: string;
    expected: string[];
    forbidden: string[];
  };
  relevantConsoleErrors: (messages: Array<{ type: string; text: string }>) => Array<{ type: string; text: string }>;
  loadPlaywrightElectron: (repoRoot: string, requirePlaywright?: (id: string) => unknown) => unknown;
  shellSmokeEnv: (artifactsDir: string, env?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  textFindings: (
    route: string,
    text: string,
    expected: string[],
    forbidden: string[],
    minLength?: number
  ) => Array<{ route: string; message: string }>;
};

describe('evaOS local shell smoke', () => {
  it('covers every beta shell route required before new feature slices', () => {
    expect(localShellSmoke.ROUTE_CHECKS.map((check) => check.name)).toEqual([
      'mission-control',
      'people-access-empty-error',
      'approval-center-empty-error',
      'connected-apps-empty-error',
      'business-browser-empty-error',
      'company-brain-empty-error',
      'agent-settings-remote-guardrail',
    ]);
    expect(localShellSmoke.TEAM_ROUTE_CHECK.name).toBe('team-route-redirect');
  });

  it('exercises customer-target recovery on product routes that depend on Workbench customer context', () => {
    expect(localShellSmoke.ROUTE_CHECKS.find((check) => check.name === 'people-access-empty-error')?.action).toBe(
      'click-refresh-targets'
    );
    expect(localShellSmoke.ROUTE_CHECKS.find((check) => check.name === 'connected-apps-empty-error')?.action).toBe(
      'click-refresh-targets'
    );
  });

  it('keeps unsafe and overclaiming shell surfaces forbidden', () => {
    const missionControl = localShellSmoke.ROUTE_CHECKS.find((check) => check.name === 'mission-control');
    const agentSettings = localShellSmoke.ROUTE_CHECKS.find(
      (check) => check.name === 'agent-settings-remote-guardrail'
    );

    expect(missionControl?.forbidden).toEqual(
      expect.arrayContaining(['Root PR #15', 'Stack approval', 'ship public beta', 'ready to ship'])
    );
    expect(agentSettings?.forbidden).toEqual(
      expect.arrayContaining(['Remote Agents', 'Allow insecure', 'Handshake', 'Connect remote'])
    );
    expect(localShellSmoke.TEAM_ROUTE_CHECK.forbidden).toEqual(
      expect.arrayContaining(['Team Space', 'Create team', 'team mode'])
    );
  });

  it('flags missing honest state copy and secret markers', () => {
    const findings = localShellSmoke.textFindings(
      'connected-apps-empty-error',
      'Connected Apps desktop_session=eds_secret_example Authorization: Bearer token',
      ['Connected Apps', 'Sign in to evaOS before loading customer targets.'],
      ['desktop_session', 'Bearer'],
      10
    );

    expect(findings.map((finding) => finding.message)).toEqual(
      expect.arrayContaining([
        'Missing expected text: Sign in to evaOS before loading customer targets.',
        'Forbidden text is visible: desktop_session',
        'Forbidden text is visible: Bearer',
      ])
    );
    expect(findings.some((finding) => finding.message.includes('Global forbidden pattern matched'))).toBe(true);
  });

  it('sets a safe local beta shell environment for the Electron launch', () => {
    const artifactsDir = path.join('/Volumes/LEXAR/Codex', 'aionui-smoke-artifacts');
    const env = localShellSmoke.shellSmokeEnv(artifactsDir, { NODE_ENV: 'development' });

    expect(env).toMatchObject({
      AIONUI_E2E_TEST: '1',
      AIONUI_DISABLE_AUTO_UPDATE: '1',
      AIONUI_DISABLE_DEVTOOLS: '1',
      AIONUI_CDP_PORT: '0',
      AIONUI_EVAOS_BETA: '1',
      NODE_ENV: 'production',
    });
    expect(env.AIONUI_EXTENSIONS_PATH).toBe(path.join(artifactsDir, 'extensions'));
    expect(env.AIONUI_EXTENSION_STATES_FILE).toBe(path.join(artifactsDir, 'extension-states.json'));
  });

  it('surfaces a clear setup error when Playwright is missing', () => {
    const missingPlaywright = new Error("Cannot find module 'playwright'") as Error & {
      code?: string;
    };
    missingPlaywright.code = 'MODULE_NOT_FOUND';

    expect(() =>
      localShellSmoke.loadPlaywrightElectron('/Volumes/LEXAR/repos/AionUi', () => {
        throw missingPlaywright;
      })
    ).toThrow(/requires Playwright from the repo dependencies/);
  });

  it('loads the Electron launcher from the repo Playwright dependency', () => {
    const launcher = { launch: async () => undefined };

    expect(
      localShellSmoke.loadPlaywrightElectron('/Volumes/LEXAR/repos/AionUi', (id) => {
        expect(id).toBe('playwright');
        return { _electron: launcher };
      })
    ).toBe(launcher);
  });

  it('ignores known offline defaults but keeps real console errors visible', () => {
    expect(
      localShellSmoke.relevantConsoleErrors([
        { type: 'error', text: '[useCronJobsMap] Failed to fetch jobs' },
        { type: 'debug', text: 'debug line' },
        { type: 'error', text: 'Unhandled route exception' },
      ])
    ).toEqual([{ type: 'error', text: 'Unhandled route exception' }]);
  });
});
