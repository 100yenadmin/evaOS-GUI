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
  BROKER_GUARDED_ROUTE_CHECKS: Array<{
    name: string;
    hash: string;
    expected: string[];
    forbidden: string[];
    requiredSelectors?: string[];
  }>;
  PROOF_STAGES: {
    SHELL_SMOKE: string;
    PRODUCT_LOADED_STATE: string;
  };
  ROUTE_CHECKS: Array<{
    name: string;
    hash: string;
    title: string;
    expected: string[];
    forbidden: string[];
    proofStage: string;
    settledMarkers: string[];
    settledAnyMarkers?: string[];
    loadedStateRequiredMarkers: string[];
    action?: string;
    isolateRendererState?: boolean;
    requiredSelectors?: string[];
  }>;
  LOCAL_PRODUCT_ROUTE_CHECKS: Array<{
    name: string;
    hash: string;
    title: string;
    expected: string[];
    forbidden: string[];
    proofStage: string;
    settledMarkers: string[];
    loadedStateRequiredMarkers: string[];
    action?: string;
    isolateRendererState?: boolean;
    requiredSelectors?: string[];
  }>;
  LOCAL_PRODUCT_MEMBER_ROUTE_CHECKS: Array<{
    name: string;
    hash: string;
    title: string;
    expected: string[];
    forbidden: string[];
    proofStage: string;
    settledMarkers: string[];
    loadedStateRequiredMarkers: string[];
  }>;
  TEAM_ROUTE_CHECK: {
    name: string;
    hash: string;
    expected: string[];
    forbidden: string[];
  };
  relevantConsoleErrors: (messages: Array<{ type: string; text: string }>) => Array<{ type: string; text: string }>;
  loadPlaywrightElectron: (repoRoot: string, requirePlaywright?: (id: string) => unknown) => unknown;
  routeChecksForEnv: (env?: NodeJS.ProcessEnv) => Array<{
    name: string;
    hash: string;
    title: string;
    expected: string[];
    forbidden: string[];
    proofStage: string;
    settledMarkers: string[];
    loadedStateRequiredMarkers: string[];
    action?: string;
    isolateRendererState?: boolean;
    requiredSelectors?: string[];
  }>;
  shellSmokeEnv: (artifactsDir: string, env?: NodeJS.ProcessEnv, repoRoot?: string) => NodeJS.ProcessEnv;
  isLocalProductMemberPersona: (env?: NodeJS.ProcessEnv) => boolean;
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
      'evaos-dashboard',
      'hermes-dashboard',
      'mission-control',
      'beta-readiness',
      'agent-settings-remote-guardrail',
      'display-settings-branding',
      'about-support-metadata',
      'native-companion-boundary',
    ]);
    expect(localShellSmoke.BROKER_GUARDED_ROUTE_CHECKS.map((check) => check.name)).toEqual([
      'people-access-broker-guard',
      'approval-center-broker-guard',
      'connected-apps-broker-guard',
      'business-browser-broker-guard',
      'company-brain-broker-guard',
      'webui-beta-guardrail',
    ]);
    expect(localShellSmoke.TEAM_ROUTE_CHECK.name).toBe('team-route-redirect');
  });

  it('marks current route screenshots as shell smoke instead of loaded-state proof', () => {
    expect(localShellSmoke.PROOF_STAGES).toEqual({
      SHELL_SMOKE: 'shell-smoke',
      PRODUCT_LOADED_STATE: 'product-loaded-state',
    });

    for (const route of localShellSmoke.ROUTE_CHECKS) {
      expect(route.proofStage).toBe(localShellSmoke.PROOF_STAGES.SHELL_SMOKE);
      expect(route.settledMarkers.length).toBeGreaterThan(0);
      expect(route.settledMarkers.every((marker) => marker === route.title || route.expected.includes(marker))).toBe(
        true
      );
      expect(route.settledMarkers.some((marker) => marker !== route.title)).toBe(true);
    }
  });

  it('requires the evaOS support affordance on shell-smoke routes', () => {
    for (const route of localShellSmoke.ROUTE_CHECKS) {
      expect(route.requiredSelectors).toContain('[data-testid="evaos-support-bubble"]');
    }

    for (const route of localShellSmoke.BROKER_GUARDED_ROUTE_CHECKS) {
      expect(route.requiredSelectors).toContain('[data-testid="evaos-support-bubble"]');
    }

    const about = localShellSmoke.ROUTE_CHECKS.find((check) => check.name === 'about-support-metadata');
    expect(about?.expected).toEqual(
      expect.arrayContaining([
        'Open ElectricSheep support',
        'Support reports include route, app version, commit, channel, redacted logs, and screenshots only when requested.',
      ])
    );
  });

  it('keeps local loaded product proof separate from default shell smoke', () => {
    expect(localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.map((check) => check.name)).toEqual([
      'mission-control-loaded-fixture',
      'mission-control-switch-clears-fixture',
      'people-access-loaded-fixture',
      'people-access-switch-clears-fixture',
      'connected-apps-loaded-fixture',
      'approval-center-deny-fixture',
      'business-browser-loaded-fixture',
      'business-browser-launch-fixture',
      'business-browser-stop-fixture',
      'business-browser-denied-fixture',
      'business-browser-offline-fixture',
      'business-browser-failed-fixture',
      'connected-apps-switch-clears-fixture',
      'business-browser-switch-clears-fixture',
      'company-brain-loaded-fixture',
      'company-brain-switch-clears-fixture',
      'terminal-loaded-fixture',
      'terminal-switch-clears-fixture',
      'native-companion-boundary-fixture',
    ]);

    const missionControlLoaded = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'mission-control-loaded-fixture'
    );
    expect(missionControlLoaded?.proofStage).toBe(localShellSmoke.PROOF_STAGES.PRODUCT_LOADED_STATE);
    expect(missionControlLoaded?.action).toBe('click-mission-control-check');
    expect(missionControlLoaded?.expected).toEqual(
      expect.arrayContaining([
        'LOADED RUNTIMES',
        '5 of 5',
        'Customer browser session',
        'fixture-audit-browser-running',
        'local-fixture:runtime:openclaw',
      ])
    );

    const missionControlSwitch = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'mission-control-switch-clears-fixture'
    );
    expect(missionControlSwitch).toEqual(
      expect.objectContaining({
        action: 'click-mission-control-switch-clears',
        loadedStateRequiredMarkers: ['mission-control stale-state clearing', 'runtime denied source pointer'],
        forbidden: expect.arrayContaining(['fixture-audit-browser-running', 'fixture.example.test/dashboard']),
      })
    );

    const peopleAccessLoaded = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'people-access-loaded-fixture'
    );
    expect(peopleAccessLoaded?.proofStage).toBe(localShellSmoke.PROOF_STAGES.PRODUCT_LOADED_STATE);
    expect(peopleAccessLoaded?.action).toBe('click-load-default-customer');
    expect(peopleAccessLoaded?.expected).toEqual(
      expect.arrayContaining([
        'LOCAL FIXTURE - NOT LIVE BETA PROOF',
        'Fixture Owner',
        'Fixture Admin',
        'pending-member@example.test',
        'Audit: fixture-audit-people-policy',
      ])
    );
    expect(peopleAccessLoaded?.forbidden).toEqual(
      expect.arrayContaining(['desktop_session', 'provider_grant', 'grant_handle'])
    );

    const peopleAccessSwitch = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'people-access-switch-clears-fixture'
    );
    expect(peopleAccessSwitch).toEqual(
      expect.objectContaining({
        action: 'click-people-access-switch-clears',
        loadedStateRequiredMarkers: ['people stale-state clearing', 'account policy audit id'],
        forbidden: expect.arrayContaining([
          'Fixture Owner',
          'pending-member@example.test',
          'fixture-audit-people-policy',
        ]),
      })
    );

    const connectedAppsLoaded = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'connected-apps-loaded-fixture'
    );
    expect(connectedAppsLoaded?.proofStage).toBe(localShellSmoke.PROOF_STAGES.PRODUCT_LOADED_STATE);
    expect(connectedAppsLoaded?.action).toBe('click-load-default-customer');
    expect(connectedAppsLoaded?.expected).toEqual(
      expect.arrayContaining([
        'LOCAL FIXTURE - NOT LIVE BETA PROOF',
        'Google Workspace',
        'Slack',
        'Notion',
        'GitHub',
        'Linear',
        'local-fixture:provider_profiles',
        'fixture-audit-providers',
      ])
    );
    expect(connectedAppsLoaded?.forbidden).toEqual(
      expect.arrayContaining(['desktop_session', 'provider_grant', 'grant_handle'])
    );

    const approvalCenterDeny = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'approval-center-deny-fixture'
    );
    expect(approvalCenterDeny).toEqual(
      expect.objectContaining({
        action: 'click-approval-center-deny',
        loadedStateRequiredMarkers: ['approval request rows', 'deny/approve policy source', 'decision audit id'],
        expected: expect.arrayContaining([
          'Fixture approval request',
          'ops-review@example.test',
          'fixture-dest-email',
          'Audit: fixture-audit-approval-request',
          'Approval denied. openclaw: denied Audit fixture-audit-approval-deny.',
        ]),
        forbidden: expect.arrayContaining(['desktop_session', 'provider_grant', 'grant_handle']),
      })
    );

    const businessBrowserLoaded = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'business-browser-loaded-fixture'
    );
    expect(businessBrowserLoaded?.proofStage).toBe(localShellSmoke.PROOF_STAGES.PRODUCT_LOADED_STATE);
    expect(businessBrowserLoaded?.action).toBe('click-load-default-customer');
    expect(businessBrowserLoaded?.expected).toEqual(
      expect.arrayContaining([
        'LOCAL FIXTURE - NOT LIVE BETA PROOF',
        'Business Browser Fixture',
        'fixture.example.test/dashboard',
        'Source: local-fixture:business-browser:running',
        'fixture-audit-browser-running',
      ])
    );
    expect(businessBrowserLoaded?.loadedStateRequiredMarkers).toEqual([
      'browser runtime status',
      'current URL summary',
      'browser audit id',
    ]);

    const businessBrowserLaunch = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'business-browser-launch-fixture'
    );
    expect(businessBrowserLaunch?.action).toBe('click-business-browser-launch');
    expect(businessBrowserLaunch?.expected).toEqual(
      expect.arrayContaining([
        'Synthetic browser launch requested',
        'Source: local-fixture:business-browser:launching',
        'fixture-audit-browser-launch',
      ])
    );

    const businessBrowserStop = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'business-browser-stop-fixture'
    );
    expect(businessBrowserStop?.action).toBe('click-business-browser-stop');
    expect(businessBrowserStop?.expected).toEqual(
      expect.arrayContaining([
        'Synthetic browser stop completed',
        'Source: local-fixture:business-browser:stopped',
        'fixture-audit-browser-stop',
      ])
    );

    const businessBrowserDenied = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'business-browser-denied-fixture'
    );
    expect(businessBrowserDenied?.action).toBe('click-business-browser-denied-customer');
    expect(businessBrowserDenied?.expected).toEqual(
      expect.arrayContaining([
        'Denied Browser Fixture Co',
        'Route denied',
        'account policy lacks open_business_browser',
        'Source: local-fixture:business-browser:denied',
        'fixture-audit-browser-denied-policy',
      ])
    );

    const businessBrowserOffline = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'business-browser-offline-fixture'
    );
    expect(businessBrowserOffline).toEqual(
      expect.objectContaining({
        action: 'click-business-browser-offline-customer',
        expected: expect.arrayContaining([
          'Offline Browser Fixture Co',
          'Synthetic browser runtime is offline',
          'fixture-audit-browser-offline',
        ]),
      })
    );

    const businessBrowserFailed = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'business-browser-failed-fixture'
    );
    expect(businessBrowserFailed).toEqual(
      expect.objectContaining({
        action: 'click-business-browser-failed-customer',
        expected: expect.arrayContaining([
          'Failed Browser Fixture Co',
          'Synthetic browser launch failed safely',
          'fixture-audit-browser-failed',
        ]),
      })
    );

    const connectedAppsSwitch = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'connected-apps-switch-clears-fixture'
    );
    expect(connectedAppsSwitch).toEqual(
      expect.objectContaining({
        action: 'click-connected-apps-switch-clears',
        loadedStateRequiredMarkers: ['provider stale-state clearing', 'provider denied source pointer'],
        forbidden: expect.arrayContaining(['fixture-audit-providers', 'local-fixture:provider:google_workspace']),
      })
    );

    const businessBrowserSwitch = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'business-browser-switch-clears-fixture'
    );
    expect(businessBrowserSwitch).toEqual(
      expect.objectContaining({
        action: 'click-business-browser-switch-clears',
        loadedStateRequiredMarkers: ['browser stale-state clearing', 'browser denied source pointer'],
        forbidden: expect.arrayContaining(['fixture-audit-browser-running', 'fixture.example.test/dashboard']),
      })
    );

    const companyBrainLoaded = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'company-brain-loaded-fixture'
    );
    expect(companyBrainLoaded?.proofStage).toBe(localShellSmoke.PROOF_STAGES.PRODUCT_LOADED_STATE);
    expect(companyBrainLoaded?.action).toBe('click-load-company-brain');
    expect(companyBrainLoaded?.expected).toEqual(
      expect.arrayContaining([
        'LOCAL FIXTURE - NOT LIVE BETA PROOF',
        'Northstar Fixture Account',
        'Atlas Fixture Account',
        'Source local-fixture:company-brain:directory',
        'Renewal fixture brief',
        'Fixture kickoff call',
        'Synthetic ingest still running',
        'Source local-fixture:company-brain:account-360:fixture-company-renewal',
        'Brief source local-fixture:company-brain:brief:fixture-company-renewal',
        'Source local-fixture:company-brain:query:fixture-company-renewal',
        'fixture-audit-company-directory',
      ])
    );
    expect(companyBrainLoaded?.loadedStateRequiredMarkers).toEqual([
      'account directory rows',
      'account 360 panel',
      'query answer source pointer',
      'directory source pointer',
    ]);

    const companyBrainSwitch = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'company-brain-switch-clears-fixture'
    );
    expect(companyBrainSwitch).toEqual(
      expect.objectContaining({
        action: 'click-company-brain-switch-clears',
        loadedStateRequiredMarkers: ['company-brain stale-state clearing', 'company-brain denied source pointer'],
        forbidden: expect.arrayContaining([
          'Northstar Fixture Account',
          'Renewal fixture brief',
          'fixture-audit-company-directory',
        ]),
      })
    );

    const terminalLoaded = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'terminal-loaded-fixture'
    );
    expect(terminalLoaded).toEqual(
      expect.objectContaining({
        action: 'click-load-default-customer',
        loadedStateRequiredMarkers: ['terminal runtime status', 'terminal source pointer', 'terminal audit id'],
        expected: expect.arrayContaining([
          'Customer VM shell is offline in this local fixture',
          'Source: local-fixture:runtime:terminal-offline',
          'Audit: fixture-audit-runtime-terminal-offline',
        ]),
      })
    );

    const terminalSwitch = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'terminal-switch-clears-fixture'
    );
    expect(terminalSwitch).toEqual(
      expect.objectContaining({
        action: 'click-terminal-switch-clears',
        loadedStateRequiredMarkers: ['terminal stale-state clearing', 'terminal denied source pointer'],
        forbidden: expect.arrayContaining([
          'fixture-audit-runtime-terminal-offline',
          'local-fixture:runtime:terminal-offline',
        ]),
      })
    );

    const nativeCompanion = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find(
      (check) => check.name === 'native-companion-boundary-fixture'
    );
    expect(nativeCompanion).toEqual(
      expect.objectContaining({
        loadedStateRequiredMarkers: [
          'native companion status matrix',
          'open-native handoff',
          'deep-link policy',
          'RC native canary contract',
        ],
        expected: expect.arrayContaining([
          'Mac & iPhone',
          'Native companion status matrix',
          'Native companion boundary',
          'Open native companion',
          'Deep-link scheme: evaos-workbench-beta',
          'Renderer receives callback secrets: false',
        ]),
      })
    );
  });

  it('selects loaded product checks only when local fixture mode is explicitly enabled', () => {
    expect(localShellSmoke.routeChecksForEnv({})).toBe(localShellSmoke.ROUTE_CHECKS);
    expect(localShellSmoke.routeChecksForEnv({ AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE: '1' })).toBe(
      localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS
    );
    expect(
      localShellSmoke.routeChecksForEnv({
        AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE: '1',
        AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE_PERSONA: 'member',
      })
    ).toBe(localShellSmoke.LOCAL_PRODUCT_MEMBER_ROUTE_CHECKS);
  });

  it('keeps member-persona visual proof focused on route denial instead of product readiness', () => {
    expect(localShellSmoke.isLocalProductMemberPersona({})).toBe(false);
    expect(localShellSmoke.isLocalProductMemberPersona({ AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE_PERSONA: 'member' })).toBe(
      true
    );
    expect(localShellSmoke.LOCAL_PRODUCT_MEMBER_ROUTE_CHECKS).toEqual([
      expect.objectContaining({
        name: 'mission-control-member-denied-fixture',
        hash: '/mission-control',
        proofStage: localShellSmoke.PROOF_STAGES.SHELL_SMOKE,
        expected: ['evaOS Workbench Beta'],
        forbidden: expect.arrayContaining(['Mission Control', 'Terminal', 'evaOS', 'Hermes']),
      }),
    ]);
  });

  it('keeps future loaded-state proof markers distinct from title-only waits', () => {
    const loadedProofMarkers = new Map([
      ['evaos-dashboard', ['broker runtime status', 'customer scoped runtime proof']],
      ['hermes-dashboard', ['broker runtime status', 'customer scoped runtime proof']],
      ['mission-control', ['paperclip runtime status', 'customer scoped runtime proof']],
      ['beta-readiness', ['desktop session card', 'broker source pointer', 'current audit id']],
      ['agent-settings-remote-guardrail', ['local agent inventory result', 'remote guardrail copy']],
      ['display-settings-branding', ['visible theme presets', 'neutral default theme card']],
      ['about-support-metadata', ['exact release candidate version', 'commit and support path']],
      [
        'native-companion-boundary',
        ['native companion status matrix', 'open-native handoff', 'deep-link policy', 'RC native canary contract'],
      ],
    ]);

    for (const route of localShellSmoke.ROUTE_CHECKS) {
      expect(route.loadedStateRequiredMarkers).toEqual(loadedProofMarkers.get(route.name));
      expect(route.loadedStateRequiredMarkers).not.toContain(route.title);
    }
  });

  it('keeps broker-required evaOS routes in guarded redirect proof for default shell smoke', () => {
    for (const route of localShellSmoke.BROKER_GUARDED_ROUTE_CHECKS) {
      expect(route.expected).toContain('evaOS Workbench Beta');
      expect(route.forbidden).toEqual(expect.arrayContaining(['desktop_session', 'Bearer', 'provider_grant']));
    }
  });

  it('points local smoke at repo managed resources through an explicit bundled backend override', () => {
    expect(localShellSmoke.shellSmokeEnv('/artifacts', {}, '/repo').AIONUI_BACKEND_BUNDLED_DIR).toBe(
      path.join('/repo', 'resources', 'bundled-aioncore')
    );
  });

  it('exercises customer-target recovery in fixture mode on product routes that depend on Workbench customer context', () => {
    for (const [routeName, action] of [
      ['people-access-loaded-fixture', 'click-load-default-customer'],
      ['approval-center-deny-fixture', 'click-approval-center-deny'],
      ['connected-apps-loaded-fixture', 'click-load-default-customer'],
      ['business-browser-loaded-fixture', 'click-load-default-customer'],
      ['company-brain-loaded-fixture', 'click-load-company-brain'],
    ] as const) {
      const route = localShellSmoke.LOCAL_PRODUCT_ROUTE_CHECKS.find((check) => check.name === routeName);
      expect(route?.action).toBe(action);
      expect(route?.isolateRendererState).toBe(true);
    }
  });

  it('keeps unsafe and overclaiming shell surfaces forbidden', () => {
    const missionControl = localShellSmoke.ROUTE_CHECKS.find((check) => check.name === 'mission-control');
    const betaReadiness = localShellSmoke.ROUTE_CHECKS.find((check) => check.name === 'beta-readiness');
    const agentSettings = localShellSmoke.ROUTE_CHECKS.find(
      (check) => check.name === 'agent-settings-remote-guardrail'
    );

    expect(missionControl?.forbidden).toEqual(
      expect.arrayContaining(['Root PR #15', 'Stack approval', 'ship public beta', 'ready to ship'])
    );
    expect(betaReadiness?.expected).toEqual(expect.arrayContaining(['RC parity gated', 'RC parity proof']));
    expect(agentSettings?.forbidden).toEqual(
      expect.arrayContaining(['Remote Agents', 'Allow insecure', 'Handshake', 'Connect remote'])
    );
    expect(agentSettings?.settledAnyMarkers).toEqual(['Paired']);
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
        { type: 'error', text: 'Failed to initialize config: TypeError: Failed to fetch' },
        { type: 'error', text: 'Failed to load assistants: TypeError: Failed to fetch' },
        { type: 'error', text: '[GuidPage] Failed to load MCP catalog: TypeError: Failed to fetch' },
        { type: 'debug', text: 'debug line' },
        { type: 'error', text: 'Unhandled route exception' },
      ])
    ).toEqual([{ type: 'error', text: 'Unhandled route exception' }]);
  });
});
