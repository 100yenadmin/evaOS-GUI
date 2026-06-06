#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const DEFAULT_ARTIFACT_ROOT =
  process.env.AIONUI_SMOKE_ARTIFACT_ROOT || '/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/38-local-shell-smoke';

const PROOF_STAGES = {
  SHELL_SMOKE: 'shell-smoke',
  PRODUCT_LOADED_STATE: 'product-loaded-state',
};

const ROUTE_CHECKS = [
  {
    name: 'mission-control',
    hash: '/mission-control',
    title: 'Mission Control',
    proofStage: PROOF_STAGES.SHELL_SMOKE,
    settledMarkers: ['Mission Control', 'RC parity gated', 'RC parity proof', 'No runtime evidence loaded yet.'],
    loadedStateRequiredMarkers: ['desktop session card', 'broker source pointer', 'current audit id'],
    expected: [
      'RC parity gated',
      'RC parity proof',
      'Sign in required',
      'Sign in to evaOS to connect this desktop shell.',
      'No runtime evidence loaded yet.',
    ],
    forbidden: ['Root PR #15', 'Stack approval', 'ship public beta', 'ready to ship'],
  },
  {
    name: 'agent-settings-remote-guardrail',
    hash: '/settings/agent',
    title: 'Agent',
    proofStage: PROOF_STAGES.SHELL_SMOKE,
    settledMarkers: ['Local Agents', 'Aion CLI is the built-in agent', 'Detect Custom Agent'],
    loadedStateRequiredMarkers: ['local agent inventory result', 'remote guardrail copy'],
    expected: ['Local Agents', 'Aion CLI is the built-in agent', 'Detect Custom Agent'],
    forbidden: ['Root PR #15', 'Stack approval', 'Remote Agents', 'Allow insecure', 'Handshake', 'Connect remote'],
  },
  {
    name: 'native-companion-boundary',
    hash: '/native-companion',
    title: 'Mac & iPhone',
    proofStage: PROOF_STAGES.SHELL_SMOKE,
    settledMarkers: [
      'Mac & iPhone',
      'Native companion status matrix',
      'Native companion boundary',
      'RC native canary contract',
      'evaos-workbench-beta',
      'Boundary clean',
    ],
    loadedStateRequiredMarkers: [
      'native companion status matrix',
      'open-native handoff',
      'deep-link policy',
      'RC native canary contract',
    ],
    expected: [
      'Mac & iPhone',
      'Native companion status matrix',
      'Native companion boundary',
      'Not installed',
      'Not paired',
      'Permission needed',
      'Ready',
      'Unavailable',
      'Open-native handoff',
      'Open native companion',
      'RC native canary contract',
      'Status source: native-companion:ready',
      'AionUi shell is local trust authority: false',
      'Renderer receives native secrets: false',
      'Deep-link scheme: evaos-workbench-beta',
      'evaos-workbench-beta',
      'Renderer receives callback secrets: false',
      'Boundary clean',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant', 'access_token', 'refresh_token'],
  },
];

const BROKER_GUARDED_ROUTE_CHECKS = [
  {
    name: 'people-access-broker-guard',
    hash: '/people-access',
    screenshotName: 'people-access-broker-guard',
    expected: ['evaOS Workbench Beta'],
    forbidden: ['People Access', 'Fixture Owner', 'member rows', 'desktop_session', 'Bearer', 'provider_grant'],
  },
  {
    name: 'approval-center-broker-guard',
    hash: '/approval-center',
    screenshotName: 'approval-center-broker-guard',
    expected: ['evaOS Workbench Beta'],
    forbidden: ['Approval Center', 'approval request rows', 'desktop_session', 'Bearer', 'provider_grant'],
  },
  {
    name: 'connected-apps-broker-guard',
    hash: '/connected-apps',
    screenshotName: 'connected-apps-broker-guard',
    expected: ['evaOS Workbench Beta'],
    forbidden: ['Connected Apps', 'Google Workspace', 'desktop_session', 'Bearer', 'provider_grant', 'grant_handle'],
  },
  {
    name: 'business-browser-broker-guard',
    hash: '/business-browser',
    screenshotName: 'business-browser-broker-guard',
    expected: ['evaOS Workbench Beta'],
    forbidden: ['Business Browser', 'fixture.example.test', 'desktop_session', 'Bearer', 'provider_grant'],
  },
  {
    name: 'company-brain-broker-guard',
    hash: '/company-brain',
    screenshotName: 'company-brain-broker-guard',
    expected: ['evaOS Workbench Beta'],
    forbidden: ['Company Brain', 'Renewal fixture brief', 'desktop_session', 'Bearer', 'provider_grant'],
  },
  {
    name: 'webui-beta-guardrail',
    hash: '/settings/webui',
    screenshotName: 'webui-beta-guardrail',
    expected: ['evaOS Workbench Beta'],
    forbidden: [
      'WebUI',
      'Enable WebUI',
      'Allow Remote Access',
      '24/7 Remote Assistant',
      'Initial Password',
      'Username:',
      'desktop_session',
      'Bearer',
      'provider_grant',
    ],
  },
];

const LOCAL_PRODUCT_ROUTE_CHECKS = [
  {
    name: 'mission-control-loaded-fixture',
    hash: '/mission-control',
    title: 'Mission Control',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Mission Control',
      'Session active',
      'LOADED RUNTIMES',
      '5 of 5',
      'fixture-audit-browser-running',
      'local-fixture:runtime:openclaw',
    ],
    loadedStateRequiredMarkers: ['desktop session card', 'broker source pointer', 'current audit id'],
    action: 'click-mission-control-check',
    isolateRendererState: true,
    expected: [
      'Mission Control',
      'Runtime, customer session, and agent status from evaOS broker evidence.',
      'Acme Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'admin@100yen.org',
      'LOADED RUNTIMES',
      '5 of 5',
      'Customer browser session',
      'OpenClaw workspace is accepting customer-scoped agent work',
      'Hermes dashboard sync completed',
      'Paperclip queue is waiting',
      'Customer VM shell is offline',
      'fixture.example.test/dashboard',
      'fixture-audit-browser-running',
      'local-fixture:runtime:openclaw',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant', 'grant_handle', 'access_token', 'refresh_token'],
  },
  {
    name: 'mission-control-switch-clears-fixture',
    hash: '/mission-control',
    title: 'Mission Control',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Mission Control',
      'Denied Browser Fixture Co',
      'account policy lacks open_business_browser',
      'fixture-audit-browser-denied-policy',
    ],
    loadedStateRequiredMarkers: ['mission-control stale-state clearing', 'runtime denied source pointer'],
    action: 'click-mission-control-switch-clears',
    isolateRendererState: true,
    expected: [
      'Mission Control',
      'Denied Browser Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'account policy lacks open_business_browser',
      'Source: local-fixture:business-browser:denied',
      'fixture-audit-browser-denied-policy',
    ],
    forbidden: [
      'fixture-audit-browser-running',
      'fixture.example.test/dashboard',
      'desktop_session',
      'Bearer',
      'provider_grant',
      'grant_handle',
      'access_token',
      'refresh_token',
    ],
  },
  {
    name: 'people-access-loaded-fixture',
    hash: '/people-access',
    title: 'People Access',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'People Access',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Fixture Owner',
      'fixture-audit-people-policy',
    ],
    loadedStateRequiredMarkers: ['member rows', 'role badges', 'account policy audit id'],
    action: 'click-load-default-customer',
    isolateRendererState: true,
    expected: [
      'People Access',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Acme Fixture Co',
      'Fixture Owner',
      'Fixture Admin',
      'pending-member@example.test',
      '6 of 6',
      'Seat limit reached',
      'Seat limit reached. Add seats before inviting another member.',
      'Backend enforced',
      'Audit: fixture-audit-people-policy',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant', 'grant_handle', 'access_token', 'refresh_token'],
  },
  {
    name: 'people-access-switch-clears-fixture',
    hash: '/people-access',
    title: 'People Access',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'People Access',
      'Denied Browser Fixture Co',
      'People Access denied for wrong customer fixture',
      'fixture-audit-people-denied-policy',
    ],
    loadedStateRequiredMarkers: ['people stale-state clearing', 'account policy audit id'],
    action: 'click-people-access-switch-clears',
    isolateRendererState: true,
    expected: [
      'People Access',
      'Denied Browser Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'People Access denied for wrong customer fixture',
      'Route denied',
      'Audit: fixture-audit-people-denied-policy',
    ],
    forbidden: [
      'Fixture Owner',
      'Fixture Admin',
      'pending-member@example.test',
      'fixture-audit-people-policy',
      'desktop_session',
      'Bearer',
      'provider_grant',
      'grant_handle',
      'access_token',
      'refresh_token',
    ],
  },
  {
    name: 'connected-apps-loaded-fixture',
    hash: '/connected-apps',
    title: 'Connected Apps',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Connected Apps',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Google Workspace',
      'fixture-audit-providers',
    ],
    loadedStateRequiredMarkers: ['provider profile cards', 'grant/revoke status badges', 'provider source pointer'],
    action: 'click-load-default-customer',
    isolateRendererState: true,
    expected: [
      'Connected Apps',
      'Brokered provider status, grants, and revocation',
      'Acme Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Google Workspace',
      'Slack',
      'Notion',
      'GitHub',
      'Linear',
      'Ready',
      'Needs login',
      'Needs reconnection',
      'Revoked',
      'Approval required',
      'auditable handle',
      'local-fixture:provider_profiles',
      'fixture-audit-providers',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant', 'grant_handle', 'access_token', 'refresh_token'],
  },
  {
    name: 'approval-center-deny-fixture',
    hash: '/approval-center',
    title: 'Approval Center',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Approval Center',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'ops-review@example.test',
      'fixture-audit-approval-deny',
    ],
    loadedStateRequiredMarkers: ['approval request rows', 'deny/approve policy source', 'decision audit id'],
    action: 'click-approval-center-deny',
    isolateRendererState: true,
    expected: [
      'Approval Center',
      'Human decisions for risky agent actions',
      'Acme Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Fixture approval request',
      'ops-review@example.test',
      'fixture-dest-email',
      'Source: local-fixture:approval-center:request:fixture-approval-email-1',
      'Audit: fixture-audit-approval-request',
      'Approval denied. openclaw: denied Audit fixture-audit-approval-deny.',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant', 'grant_handle', 'access_token', 'refresh_token'],
  },
  {
    name: 'business-browser-loaded-fixture',
    hash: '/business-browser',
    title: 'Business Browser',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Business Browser',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Business Browser Fixture',
      'fixture.example.test/dashboard',
      'fixture-audit-browser-running',
    ],
    loadedStateRequiredMarkers: ['browser runtime status', 'current URL summary', 'browser audit id'],
    action: 'click-load-default-customer',
    isolateRendererState: true,
    expected: [
      'Business Browser',
      'Brokered browser and VM runtime state',
      'Acme Fixture Co',
      'Denied Browser Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Business Browser Fixture',
      'fixture.example.test/dashboard',
      'Source: local-fixture:business-browser:running',
      'fixture-audit-browser-running',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant', 'grant_handle', 'access_token', 'refresh_token'],
  },
  {
    name: 'business-browser-launch-fixture',
    hash: '/business-browser',
    title: 'Business Browser',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Business Browser',
      'Synthetic browser launch requested',
      'local-fixture:business-browser:launching',
      'fixture-audit-browser-launch',
    ],
    loadedStateRequiredMarkers: ['browser runtime status', 'current URL summary', 'browser audit id'],
    action: 'click-business-browser-launch',
    isolateRendererState: true,
    expected: [
      'Business Browser',
      'Acme Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Synthetic browser launch requested',
      'Source: local-fixture:business-browser:launching',
      'fixture-audit-browser-launch',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant', 'grant_handle', 'access_token', 'refresh_token'],
  },
  {
    name: 'business-browser-stop-fixture',
    hash: '/business-browser',
    title: 'Business Browser',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Business Browser',
      'Synthetic browser stop completed',
      'local-fixture:business-browser:stopped',
      'fixture-audit-browser-stop',
    ],
    loadedStateRequiredMarkers: ['browser runtime status', 'current URL summary', 'browser audit id'],
    action: 'click-business-browser-stop',
    isolateRendererState: true,
    expected: [
      'Business Browser',
      'Acme Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Synthetic browser stop completed',
      'Source: local-fixture:business-browser:stopped',
      'fixture-audit-browser-stop',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant', 'grant_handle', 'access_token', 'refresh_token'],
  },
  {
    name: 'business-browser-denied-fixture',
    hash: '/business-browser',
    title: 'Business Browser',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Business Browser',
      'Denied Browser Fixture Co',
      'Route denied',
      'account policy lacks open_business_browser',
      'fixture-audit-browser-denied-policy',
    ],
    loadedStateRequiredMarkers: ['browser runtime status', 'current URL summary', 'browser audit id'],
    action: 'click-business-browser-denied-customer',
    isolateRendererState: true,
    expected: [
      'Business Browser',
      'Denied Browser Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Route denied',
      'account policy lacks open_business_browser',
      'Source: local-fixture:business-browser:denied',
      'fixture-audit-browser-denied-policy',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant', 'grant_handle', 'access_token', 'refresh_token'],
  },
  {
    name: 'business-browser-offline-fixture',
    hash: '/business-browser',
    title: 'Business Browser',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Business Browser',
      'Offline Browser Fixture Co',
      'Synthetic browser runtime is offline',
      'fixture-audit-browser-offline',
    ],
    loadedStateRequiredMarkers: ['browser runtime status', 'offline browser audit id'],
    action: 'click-business-browser-offline-customer',
    isolateRendererState: true,
    expected: [
      'Business Browser',
      'Offline Browser Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Offline Browser Fixture',
      'Synthetic browser runtime is offline',
      'Source: local-fixture:business-browser:offline',
      'fixture-audit-browser-offline',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant', 'grant_handle', 'access_token', 'refresh_token'],
  },
  {
    name: 'business-browser-failed-fixture',
    hash: '/business-browser',
    title: 'Business Browser',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Business Browser',
      'Failed Browser Fixture Co',
      'Synthetic browser launch failed safely',
      'fixture-audit-browser-failed',
    ],
    loadedStateRequiredMarkers: ['browser runtime status', 'failed browser audit id'],
    action: 'click-business-browser-failed-customer',
    isolateRendererState: true,
    expected: [
      'Business Browser',
      'Failed Browser Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Failed Browser Fixture',
      'Synthetic browser launch failed safely',
      'Source: local-fixture:business-browser:failed',
      'fixture-audit-browser-failed',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant', 'grant_handle', 'access_token', 'refresh_token'],
  },
  {
    name: 'connected-apps-switch-clears-fixture',
    hash: '/connected-apps',
    title: 'Connected Apps',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Connected Apps',
      'Denied Browser Fixture Co',
      'Connected Apps denied for wrong customer fixture',
      'fixture-audit-provider-denied',
    ],
    loadedStateRequiredMarkers: ['provider stale-state clearing', 'provider denied source pointer'],
    action: 'click-connected-apps-switch-clears',
    isolateRendererState: true,
    expected: [
      'Connected Apps',
      'Denied Browser Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Connected Apps denied for wrong customer fixture',
      'Route denied',
      'Source: local-fixture:provider_profiles:denied',
      'fixture-audit-provider-denied',
    ],
    forbidden: [
      'fixture-audit-providers',
      'local-fixture:provider:google_workspace',
      'workspace@example.test',
      'desktop_session',
      'Bearer',
      'provider_grant',
      'grant_handle',
      'access_token',
      'refresh_token',
    ],
  },
  {
    name: 'business-browser-switch-clears-fixture',
    hash: '/business-browser',
    title: 'Business Browser',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Business Browser',
      'Denied Browser Fixture Co',
      'Route denied',
      'account policy lacks open_business_browser',
      'fixture-audit-browser-denied-policy',
    ],
    loadedStateRequiredMarkers: ['browser stale-state clearing', 'browser denied source pointer'],
    action: 'click-business-browser-switch-clears',
    isolateRendererState: true,
    expected: [
      'Business Browser',
      'Denied Browser Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Route denied',
      'account policy lacks open_business_browser',
      'Source: local-fixture:business-browser:denied',
      'fixture-audit-browser-denied-policy',
    ],
    forbidden: [
      'fixture-audit-browser-running',
      'fixture.example.test/dashboard',
      'desktop_session',
      'Bearer',
      'provider_grant',
      'grant_handle',
      'access_token',
      'refresh_token',
    ],
  },
  {
    name: 'company-brain-loaded-fixture',
    hash: '/company-brain',
    title: 'Company Brain',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Company Brain',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Northstar Fixture Account',
      'Renewal fixture brief',
      'local-fixture:company-brain:query:fixture-company-renewal',
      'fixture-audit-company-directory',
    ],
    loadedStateRequiredMarkers: [
      'account directory rows',
      'account 360 panel',
      'query answer source pointer',
      'directory source pointer',
    ],
    action: 'click-load-company-brain',
    isolateRendererState: true,
    expected: [
      'Company Brain',
      'Org-scoped account directory, account brief, timeline, query, and exception evidence.',
      'Acme Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Northstar Fixture Account',
      'Atlas Fixture Account',
      'Signal Error Fixture Account',
      'Source local-fixture:company-brain:directory',
      'Renewal fixture brief',
      'Fixture kickoff call',
      'Synthetic ingest still running',
      'Source local-fixture:company-brain:account-360:fixture-company-renewal',
      'Brief source local-fixture:company-brain:brief:fixture-company-renewal',
      'Source local-fixture:company-brain:query:fixture-company-renewal',
      'fixture-audit-company-directory',
      'fixture-audit-policy',
    ],
    forbidden: [
      'desktop_session',
      'Bearer',
      'provider_grant',
      'grant_handle',
      'access_token',
      'refresh_token',
      'raw_embedding',
      'raw_prompt',
    ],
  },
  {
    name: 'company-brain-switch-clears-fixture',
    hash: '/company-brain',
    title: 'Company Brain',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Company Brain',
      'Denied Browser Fixture Co',
      'Company Brain denied for wrong customer fixture',
      'fixture-audit-company-denied',
    ],
    loadedStateRequiredMarkers: ['company-brain stale-state clearing', 'company-brain denied source pointer'],
    action: 'click-company-brain-switch-clears',
    isolateRendererState: true,
    expected: [
      'Company Brain',
      'Denied Browser Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Company Brain denied for wrong customer fixture',
      'Route denied',
      'Source local-fixture:company-brain:denied',
      'fixture-audit-company-denied',
    ],
    forbidden: [
      'Northstar Fixture Account',
      'Renewal fixture brief',
      'fixture-audit-company-directory',
      'local-fixture:company-brain:query:fixture-company-renewal',
      'desktop_session',
      'Bearer',
      'provider_grant',
      'grant_handle',
      'access_token',
      'refresh_token',
      'raw_embedding',
      'raw_prompt',
    ],
  },
  {
    name: 'terminal-loaded-fixture',
    hash: '/terminal',
    title: 'Terminal',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Terminal',
      'Acme Fixture Co',
      'Customer VM shell is offline in this local fixture',
      'fixture-audit-runtime-terminal-offline',
    ],
    loadedStateRequiredMarkers: ['terminal runtime status', 'terminal source pointer', 'terminal audit id'],
    action: 'click-load-default-customer',
    isolateRendererState: true,
    expected: [
      'Terminal',
      'Customer VM shell runtime status from evaOS broker evidence',
      'Acme Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Customer VM shell is offline in this local fixture',
      'Source: local-fixture:runtime:terminal-offline',
      'Audit: fixture-audit-runtime-terminal-offline',
      'Fail-closed until evaOS broker returns customer-scoped Terminal evidence.',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant', 'grant_handle', 'access_token', 'refresh_token'],
  },
  {
    name: 'terminal-switch-clears-fixture',
    hash: '/terminal',
    title: 'Terminal',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Terminal',
      'Denied Browser Fixture Co',
      'Terminal denied for wrong customer fixture',
      'fixture-audit-runtime-terminal-denied',
    ],
    loadedStateRequiredMarkers: ['terminal stale-state clearing', 'terminal denied source pointer'],
    action: 'click-terminal-switch-clears',
    isolateRendererState: true,
    expected: [
      'Terminal',
      'Denied Browser Fixture Co',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Terminal denied for wrong customer fixture',
      'Source: local-fixture:runtime:terminal-denied',
      'Audit: fixture-audit-runtime-terminal-denied',
    ],
    forbidden: [
      'fixture-audit-runtime-terminal-offline',
      'local-fixture:runtime:terminal-offline',
      'desktop_session',
      'Bearer',
      'provider_grant',
      'grant_handle',
      'access_token',
      'refresh_token',
    ],
  },
  {
    name: 'native-companion-boundary-fixture',
    hash: '/native-companion',
    title: 'Mac & iPhone',
    proofStage: PROOF_STAGES.PRODUCT_LOADED_STATE,
    settledMarkers: [
      'Mac & iPhone',
      'Native companion status matrix',
      'Native companion boundary',
      'evaos-workbench-beta',
      'Boundary clean',
    ],
    loadedStateRequiredMarkers: [
      'native companion status matrix',
      'open-native handoff',
      'deep-link policy',
      'RC native canary contract',
    ],
    isolateRendererState: true,
    expected: [
      'Mac & iPhone',
      'Native companion status matrix',
      'Native companion boundary',
      'Not installed',
      'Not paired',
      'Permission needed',
      'Ready',
      'Unavailable',
      'Open-native handoff',
      'Open native companion',
      'Handoff target: evaos-workbench-beta://native-companion/status',
      'Status source: native-companion:ready',
      'AionUi shell is local trust authority: false',
      'Renderer receives native secrets: false',
      'Deep-link scheme: evaos-workbench-beta',
      'Renderer receives callback secrets: false',
      'exact RC candidate passes native adapter, release, rollback, and support gates',
      'connector-kill-switch',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant', 'grant_handle', 'access_token', 'refresh_token'],
  },
];

const LOCAL_PRODUCT_MEMBER_ROUTE_CHECKS = [
  {
    name: 'mission-control-member-denied-fixture',
    hash: '/mission-control',
    title: 'evaOS Workbench Beta',
    proofStage: PROOF_STAGES.SHELL_SMOKE,
    settledMarkers: ['evaOS Workbench Beta'],
    loadedStateRequiredMarkers: ['redirected #/guid route', 'admin runtime hidden from member persona'],
    expected: ['evaOS Workbench Beta'],
    forbidden: ['Mission Control', 'Terminal', 'Eva Workspace', 'Agent Workspace'],
  },
];

const TEAM_ROUTE_CHECK = {
  name: 'team-route-redirect',
  hash: '/team/local-smoke',
  screenshotName: 'team-route-redirects-to-guid',
  expected: ['evaOS Workbench Beta'],
  forbidden: ['Team Space', 'Create team', 'team mode'],
};

const GLOBAL_FORBIDDEN_PATTERNS = [
  /\b(?:eds|epg)_[A-Za-z0-9_-]{4,}\b/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /desktop[_-]?session/i,
  /provider[_-]?grant/i,
  /authorization:\s*bearer/i,
  /jwt/i,
  /webpack compiled with errors/i,
  /vite.*error overlay/i,
  /internal server error/i,
];

const IGNORED_CONSOLE_ERROR_PATTERN =
  /autofill|Failed to load resource: net::ERR_FILE_NOT_FOUND|Failed to load initial theme|Failed to load initial color scheme|Failed to initialize language|Failed to initialize config|Failed to load assistants|\[GuidPage\] Failed to load MCP catalog|\[useExtensionSettingsTabs\] Failed to load tabs|\[useExtI18n\] Failed to load ext i18n|\[useCronJobsMap\] Failed to fetch jobs/;

function ensureDirs(artifactRoot) {
  const screenshotsDir = path.join(artifactRoot, 'screenshots');
  const artifactsDir = path.join(artifactRoot, 'artifacts');
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(artifactsDir, { recursive: true });
  return { screenshotsDir, artifactsDir };
}

function shellSmokeEnv(artifactsDir, env = process.env, repoRoot = process.cwd()) {
  return {
    ...env,
    AIONUI_E2E_TEST: '1',
    AIONUI_DISABLE_AUTO_UPDATE: '1',
    AIONUI_DISABLE_DEVTOOLS: '1',
    AIONUI_CDP_PORT: '0',
    AIONUI_BACKEND_BUNDLED_DIR: path.join(repoRoot, 'resources', 'bundled-aioncore'),
    AIONUI_EXTENSIONS_PATH: path.join(artifactsDir, 'extensions'),
    AIONUI_EXTENSION_STATES_FILE: path.join(artifactsDir, 'extension-states.json'),
    AIONUI_EVAOS_BETA: '1',
    NODE_ENV: 'production',
  };
}

function isLocalProductFixtureMode(env = process.env) {
  return env.AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE === '1';
}

function isLocalProductMemberPersona(env = process.env) {
  return env.AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE_PERSONA === 'member';
}

function routeChecksForEnv(env = process.env) {
  if (isLocalProductFixtureMode(env) && isLocalProductMemberPersona(env)) {
    return LOCAL_PRODUCT_MEMBER_ROUTE_CHECKS;
  }
  return isLocalProductFixtureMode(env) ? LOCAL_PRODUCT_ROUTE_CHECKS : ROUTE_CHECKS;
}

function textFindings(route, text, expected, forbidden, minLength = 80) {
  const findings = [];

  if (text.trim().length < minLength) {
    findings.push({ route, message: `Route body is too short (${text.trim().length} chars), possible blank shell.` });
  }
  for (const snippet of expected) {
    if (!text.includes(snippet)) {
      findings.push({ route, message: `Missing expected text: ${snippet}` });
    }
  }
  for (const snippet of forbidden) {
    if (text.includes(snippet)) {
      findings.push({ route, message: `Forbidden text is visible: ${snippet}` });
    }
  }
  for (const pattern of GLOBAL_FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) {
      findings.push({ route, message: `Global forbidden pattern matched: ${pattern}` });
    }
  }

  return findings;
}

function relevantConsoleErrors(consoleMessages) {
  return consoleMessages.filter(
    (message) => message.type === 'error' && !IGNORED_CONSOLE_ERROR_PATTERN.test(message.text)
  );
}

function isMissingPlaywrightError(error) {
  return (
    error &&
    error.code === 'MODULE_NOT_FOUND' &&
    typeof error.message === 'string' &&
    error.message.includes('playwright')
  );
}

function loadPlaywrightElectron(repoRoot, requirePlaywright) {
  const requireFromRepo = requirePlaywright || createRequire(path.join(repoRoot, 'package.json'));

  try {
    const playwright = requireFromRepo('playwright');
    if (!playwright || !playwright._electron) {
      throw new Error('The repo Playwright dependency does not expose _electron.');
    }
    return playwright._electron;
  } catch (error) {
    if (isMissingPlaywrightError(error)) {
      const setupError = new Error(
        [
          'evaOS local shell smoke requires Playwright from the repo dependencies.',
          `Repo: ${repoRoot}`,
          'Run from a dependency-ready checkout, or install dependencies before running `npm run evaos:local-shell-smoke`.',
        ].join('\n')
      );
      setupError.code = 'AIONUI_SMOKE_PLAYWRIGHT_MISSING';
      setupError.cause = error;
      throw setupError;
    }
    throw error;
  }
}

async function clickLoad(page) {
  const loadButton = page.getByRole('button', { name: /^Load$/ }).first();
  await loadButton.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Load' && !button.disabled
      ),
    { timeout: 10000 }
  );
  await loadButton.click();
  await page.waitForTimeout(250);
}

async function clickLoadDefaultCustomer(page) {
  await clickCustomerTarget(page, 'Acme Fixture Co');
  await clickLoad(page);
}

async function clickRefreshTargets(page) {
  const refreshTargetsButton = page.getByRole('button', { name: /^Refresh targets$/ }).first();
  await refreshTargetsButton.click();
  await page.waitForTimeout(350);
}

async function clickFirstCompanyBrainAccount(page) {
  const viewButton = page.getByRole('button', { name: /^View$/ }).first();
  await viewButton.waitFor({ state: 'visible', timeout: 10000 });
  await viewButton.click();
  await page.waitForFunction(() => document.body.innerText.includes('Renewal fixture brief'), { timeout: 10000 });
}

async function askCompanyBrainFixtureQuestion(page) {
  const queryInput = page.getByLabel('Ask Company Brain');
  await queryInput.fill('What needs attention?');
  await page.getByRole('button', { name: /^Ask$/ }).click();
  await page.waitForFunction(
    () => document.body.innerText.includes('local-fixture:company-brain:query:fixture-company-renewal'),
    { timeout: 10000 }
  );
  await page
    .getByText('Source local-fixture:company-brain:query:fixture-company-renewal')
    .scrollIntoViewIfNeeded({ timeout: 10000 });
}

async function clickBusinessBrowserLaunch(page) {
  await clickLoad(page);
  const stopButton = page.getByRole('button', { name: /^Stop$/ }).first();
  if (await stopButton.isEnabled().catch(() => false)) {
    await stopButton.click();
    await page.waitForFunction(() => document.body.innerText.includes('Synthetic browser stop completed'), {
      timeout: 10000,
    });
  }
  const launchButton = page.getByRole('button', { name: /^Launch$/ }).first();
  await launchButton.waitFor({ state: 'visible', timeout: 10000 });
  await launchButton.click();
  await page.waitForFunction(() => document.body.innerText.includes('Synthetic browser launch requested'), {
    timeout: 10000,
  });
}

async function clickBusinessBrowserStop(page) {
  await clickLoad(page);
  const stopButton = page.getByRole('button', { name: /^Stop$/ }).first();
  await stopButton.waitFor({ state: 'visible', timeout: 10000 });
  await stopButton.click();
  await page.waitForFunction(() => document.body.innerText.includes('Synthetic browser stop completed'), {
    timeout: 10000,
  });
}

async function clickBusinessBrowserDeniedCustomer(page) {
  const deniedCustomerButton = page.getByRole('button', { name: /^Denied Browser Fixture Co$/ }).first();
  await deniedCustomerButton.waitFor({ state: 'visible', timeout: 10000 });
  await deniedCustomerButton.click();
  await clickLoad(page);
  await page.waitForFunction(() => document.body.innerText.includes('account policy lacks open_business_browser'), {
    timeout: 10000,
  });
}

async function clickBusinessBrowserOfflineCustomer(page) {
  await clickCustomerTarget(page, 'Offline Browser Fixture Co');
  await clickLoad(page);
  await page.waitForFunction(() => document.body.innerText.includes('Synthetic browser runtime is offline'), {
    timeout: 10000,
  });
}

async function clickBusinessBrowserFailedCustomer(page) {
  await clickCustomerTarget(page, 'Failed Browser Fixture Co');
  await clickLoad(page);
  await page.waitForFunction(() => document.body.innerText.includes('Synthetic browser launch failed safely'), {
    timeout: 10000,
  });
}

async function clickMissionControlCheck(page, expectedMarker = 'fixture-audit-browser-running') {
  await page.waitForFunction(() => document.body.innerText.includes('Customer context'), {
    timeout: 20000,
  });
  const checkButton = page
    .locator('button')
    .filter({ hasText: /^Check$/ })
    .first();
  await checkButton.waitFor({ state: 'visible', timeout: 10000 });
  await checkButton.click();
  await page.waitForFunction((marker) => document.body.innerText.includes(marker), expectedMarker, { timeout: 10000 });
}

async function clickMissionControlSwitchClears(page) {
  await clickMissionControlCheck(page);
  await clickCustomerTarget(page, 'Denied Browser Fixture Co');
  await waitForStaleMarkersCleared(page, 'mission-control-switch-clears-fixture', [
    'fixture-audit-browser-running',
    'fixture.example.test/dashboard',
  ]);
  await clickMissionControlCheck(page, 'fixture-audit-browser-denied-policy');
  await page.waitForFunction(() => document.body.innerText.includes('account policy lacks open_business_browser'), {
    timeout: 10000,
  });
}

async function clickCustomerTarget(page, name) {
  const customerButton = page.getByRole('button', { name: new RegExp(`^${name}$`) }).first();
  await customerButton.waitFor({ state: 'visible', timeout: 10000 });
  await customerButton.click();
  await page.waitForTimeout(250);
}

async function waitForStaleMarkersCleared(page, route, staleMarkers) {
  try {
    await page.waitForFunction(
      (markers) => markers.every((marker) => !document.body.innerText.includes(marker)),
      staleMarkers,
      { timeout: 10000 }
    );
  } catch (error) {
    const text = await bodyText(page, 2000);
    const visibleMarkers = staleMarkers.filter((marker) => text.includes(marker));
    throw new Error(`${route} did not clear stale customer evidence: ${visibleMarkers.join(', ')}`);
  }
}

async function clickPeopleAccessSwitchClears(page) {
  await clickLoadDefaultCustomer(page);
  await page.waitForFunction(() => document.body.innerText.includes('fixture-audit-people-policy'), {
    timeout: 10000,
  });
  await clickCustomerTarget(page, 'Denied Browser Fixture Co');
  await waitForStaleMarkersCleared(page, 'people-access-switch-clears-fixture', [
    'Fixture Owner',
    'Fixture Admin',
    'pending-member@example.test',
    'fixture-audit-people-policy',
  ]);
  await clickLoad(page);
  await page.waitForFunction(
    () => document.body.innerText.includes('People Access denied for wrong customer fixture'),
    {
      timeout: 10000,
    }
  );
}

async function clickConnectedAppsSwitchClears(page) {
  await clickLoadDefaultCustomer(page);
  await page.waitForFunction(() => document.body.innerText.includes('fixture-audit-providers'), { timeout: 10000 });
  await clickCustomerTarget(page, 'Denied Browser Fixture Co');
  await waitForStaleMarkersCleared(page, 'connected-apps-switch-clears-fixture', [
    'fixture-audit-providers',
    'local-fixture:provider:google_workspace',
    'workspace@example.test',
  ]);
  await clickLoad(page);
  await page.waitForFunction(
    () => document.body.innerText.includes('Connected Apps denied for wrong customer fixture'),
    {
      timeout: 10000,
    }
  );
}

async function clickApprovalCenterDeny(page) {
  await clickLoadDefaultCustomer(page);
  await page.waitForFunction(() => document.body.innerText.includes('fixture-audit-approval-request'), {
    timeout: 10000,
  });
  const denyButton = page.getByRole('button', { name: /^Deny$/ }).first();
  await denyButton.waitFor({ state: 'visible', timeout: 10000 });
  await denyButton.click();
  await page.waitForFunction(() => document.body.innerText.includes('fixture-audit-approval-deny'), {
    timeout: 10000,
  });
}

async function clickBusinessBrowserSwitchClears(page) {
  await clickLoadDefaultCustomer(page);
  await page.waitForFunction(() => document.body.innerText.includes('fixture-audit-browser-running'), {
    timeout: 10000,
  });
  await clickCustomerTarget(page, 'Denied Browser Fixture Co');
  await waitForStaleMarkersCleared(page, 'business-browser-switch-clears-fixture', [
    'fixture-audit-browser-running',
    'fixture.example.test/dashboard',
  ]);
  await clickLoad(page);
  await page.waitForFunction(() => document.body.innerText.includes('account policy lacks open_business_browser'), {
    timeout: 10000,
  });
}

async function clickTerminalSwitchClears(page) {
  await clickLoadDefaultCustomer(page);
  await page.waitForFunction(() => document.body.innerText.includes('fixture-audit-runtime-terminal-offline'), {
    timeout: 10000,
  });
  await clickCustomerTarget(page, 'Denied Browser Fixture Co');
  await waitForStaleMarkersCleared(page, 'terminal-switch-clears-fixture', [
    'fixture-audit-runtime-terminal-offline',
    'local-fixture:runtime:terminal-offline',
  ]);
  await clickLoad(page);
  await page.waitForFunction(() => document.body.innerText.includes('fixture-audit-runtime-terminal-denied'), {
    timeout: 10000,
  });
}

async function clickCompanyBrainSwitchClears(page) {
  await clickLoadDefaultCustomer(page);
  await clickFirstCompanyBrainAccount(page);
  await askCompanyBrainFixtureQuestion(page);
  await clickCustomerTarget(page, 'Denied Browser Fixture Co');
  await waitForStaleMarkersCleared(page, 'company-brain-switch-clears-fixture', [
    'Northstar Fixture Account',
    'Renewal fixture brief',
    'fixture-audit-company-directory',
    'local-fixture:company-brain:query:fixture-company-renewal',
  ]);
  await clickLoad(page);
  await page.waitForFunction(
    () => document.body.innerText.includes('Company Brain denied for wrong customer fixture'),
    {
      timeout: 10000,
    }
  );
}

async function bodyText(page, timeout = 1500) {
  return page
    .locator('body')
    .innerText({ timeout })
    .catch(() => '');
}

async function resolveMainWindow(app) {
  const deadline = Date.now() + 30000;
  let candidate = await app.firstWindow();

  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      const text = await bodyText(page);
      if (text.includes('Mission Control') || text.includes('AionUi')) {
        return page;
      }
      if (text.trim().length > 0) {
        candidate = page;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return candidate;
}

async function navigate(page, hash) {
  await page.evaluate((nextHash) => {
    window.location.hash = nextHash;
  }, hash);
}

async function isolateRendererState(page, hash) {
  const baseUrl = page.url().split('#')[0];
  await page.goto(`${baseUrl}#${hash.replace(/^#?/, '')}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(350);
}

async function waitForRoute(page, title) {
  await page.waitForFunction((expectedTitle) => document.body.innerText.includes(expectedTitle), title, {
    timeout: 30000,
  });
  await page.waitForTimeout(450);
}

async function waitForSettledMarkers(page, markers) {
  for (const marker of markers) {
    await page.waitForFunction((expectedMarker) => document.body.innerText.includes(expectedMarker), marker, {
      timeout: 10000,
    });
  }
  await page.waitForTimeout(250);
}

async function routeScreenshot(page, screenshotsDir, routeName) {
  const screenshotPath = path.join(screenshotsDir, `${routeName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

function writeProof({ artifactRoot, artifactsDir, report }) {
  const hasProductLoadedState = report.routes.some((result) => result.proofStage === PROOF_STAGES.PRODUCT_LOADED_STATE);
  fs.writeFileSync(path.join(artifactsDir, 'local-shell-smoke-report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(artifactRoot, 'proof.md'),
    [
      '# Local AionUi Shell Smoke Proof',
      '',
      `Generated: ${report.generatedAt}`,
      '',
      `Repo: ${report.repoRoot}`,
      '',
      `Result: ${report.passed ? 'PASS' : 'FAIL'}`,
      '',
      '## Validation',
      '',
      'Scenario canary: interactive local AionUi shell smoke.',
      '',
      hasProductLoadedState
        ? 'Proof stage: mixed shell-smoke and fixture-backed product-loaded-state.'
        : 'Proof stage: shell-smoke. These screenshots prove route launch, guardrails, and honest empty/error copy only.',
      hasProductLoadedState
        ? 'Product-loaded screenshots wait for route-specific fixture markers and do not prove live backend readiness.'
        : 'They do not prove product loaded state until fixture-backed screenshots wait for route-specific loaded markers.',
      '',
      'Command:',
      '',
      '```bash',
      'npm run evaos:local-shell-smoke',
      '```',
      '',
      '## Routes',
      '',
      ...report.routes.map((result) => {
        const markerLabel =
          result.proofStage === PROOF_STAGES.PRODUCT_LOADED_STATE ? 'loaded markers' : 'loaded markers pending';
        return `- ${result.route}: ${result.screenshotPath} (${result.proofStage}; ${markerLabel}: ${result.loadedStateRequiredMarkers.join(
          ', '
        )})`;
      }),
      '',
      '## Findings',
      '',
      ...(report.findings.length === 0
        ? ['- No launch, blank-page, unsafe-surface, or honest-state blockers found by this smoke.']
        : report.findings.map((finding) => `- ${finding.route}: ${finding.message}`)),
      '',
      '## Console',
      '',
      `- Captured ${report.consoleMessages.length} console messages and ${report.pageErrors.length} page errors.`,
    ].join('\n')
  );
}

async function runLocalShellSmoke(options = {}) {
  const repoRoot = options.repoRoot || process.env.AIONUI_SMOKE_REPO_ROOT || process.cwd();
  const artifactRoot = options.artifactRoot || DEFAULT_ARTIFACT_ROOT;
  const { screenshotsDir, artifactsDir } = ensureDirs(artifactRoot);
  const electron = options.electron?._electron || options.electron || loadPlaywrightElectron(repoRoot);
  const launchEnv = shellSmokeEnv(artifactsDir, options.env || process.env, repoRoot);
  const routeChecks = options.routeChecks || routeChecksForEnv(launchEnv);
  const consoleMessages = [];
  const pageErrors = [];
  const results = [];
  const findings = [];

  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: launchEnv,
  });

  try {
    const page = await resolveMainWindow(app);
    await page.setViewportSize({ width: 1440, height: 1000 });
    page.on('console', (message) => {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
      });
    });
    page.on('pageerror', (error) => {
      pageErrors.push({ message: error.message, stack: error.stack });
    });

    for (const check of routeChecks) {
      console.log(`[evaos-local-shell-smoke] route ${check.name} -> #${check.hash}`);
      await navigate(page, check.hash);
      if (check.isolateRendererState) {
        await isolateRendererState(page, check.hash);
      }
      try {
        await waitForRoute(page, check.title);
      } catch (error) {
        const timeoutText = await bodyText(page, 2000);
        const timeoutPath = path.join(screenshotsDir, `${check.name}-timeout.png`);
        await page.screenshot({ path: timeoutPath, fullPage: true }).catch(() => undefined);
        findings.push({
          route: check.name,
          message: `Timed out waiting for "${check.title}". URL=${page.url()} text=${timeoutText.slice(
            0,
            500
          )} screenshot=${timeoutPath}`,
        });
        throw error;
      }
      try {
        if (check.action === 'click-load') {
          await clickLoad(page);
        } else if (check.action === 'click-load-default-customer') {
          await clickLoadDefaultCustomer(page);
        } else if (check.action === 'click-load-company-brain') {
          await clickLoadDefaultCustomer(page);
          await clickFirstCompanyBrainAccount(page);
          await askCompanyBrainFixtureQuestion(page);
        } else if (check.action === 'click-business-browser-launch') {
          await clickBusinessBrowserLaunch(page);
        } else if (check.action === 'click-business-browser-stop') {
          await clickBusinessBrowserStop(page);
        } else if (check.action === 'click-business-browser-denied-customer') {
          await clickBusinessBrowserDeniedCustomer(page);
        } else if (check.action === 'click-business-browser-offline-customer') {
          await clickBusinessBrowserOfflineCustomer(page);
        } else if (check.action === 'click-business-browser-failed-customer') {
          await clickBusinessBrowserFailedCustomer(page);
        } else if (check.action === 'click-approval-center-deny') {
          await clickApprovalCenterDeny(page);
        } else if (check.action === 'click-mission-control-check') {
          await clickMissionControlCheck(page);
        } else if (check.action === 'click-mission-control-switch-clears') {
          await clickMissionControlSwitchClears(page);
        } else if (check.action === 'click-people-access-switch-clears') {
          await clickPeopleAccessSwitchClears(page);
        } else if (check.action === 'click-connected-apps-switch-clears') {
          await clickConnectedAppsSwitchClears(page);
        } else if (check.action === 'click-business-browser-switch-clears') {
          await clickBusinessBrowserSwitchClears(page);
        } else if (check.action === 'click-terminal-switch-clears') {
          await clickTerminalSwitchClears(page);
        } else if (check.action === 'click-company-brain-switch-clears') {
          await clickCompanyBrainSwitchClears(page);
        } else if (check.action === 'click-refresh-targets') {
          await clickRefreshTargets(page);
        }
      } catch (error) {
        const actionText = await bodyText(page, 2500).catch(() => '');
        const actionPath = path.join(screenshotsDir, `${check.name}-action-failed.png`);
        await page.screenshot({ path: actionPath, fullPage: true }).catch(() => undefined);
        throw new Error(
          `${check.name} action ${check.action ?? 'none'} failed. URL=${page.url()} screenshot=${actionPath} text=${actionText.slice(
            0,
            800
          )}`,
          { cause: error }
        );
      }
      await waitForSettledMarkers(page, check.settledMarkers);
      const text = await page.locator('body').innerText({ timeout: 10000 });
      findings.push(...textFindings(check.name, text, check.expected, check.forbidden));
      const screenshotPath = await routeScreenshot(page, screenshotsDir, check.name);
      results.push({
        route: check.name,
        hash: check.hash,
        screenshotPath,
        textLength: text.trim().length,
        proofStage: check.proofStage,
        settledMarkers: check.settledMarkers,
        loadedStateRequiredMarkers: check.loadedStateRequiredMarkers,
      });
    }

    if (!isLocalProductFixtureMode(launchEnv)) {
      for (const check of BROKER_GUARDED_ROUTE_CHECKS) {
        console.log(`[evaos-local-shell-smoke] guarded route ${check.name} -> #${check.hash}`);
        await navigate(page, check.hash);
        await page.waitForURL(/#\/guid/, { timeout: 8000 });
        await page.waitForTimeout(450);
        const text = await page.locator('body').innerText({ timeout: 10000 });
        findings.push(...textFindings(check.name, text, check.expected, check.forbidden));
        const screenshotPath = await routeScreenshot(page, screenshotsDir, check.screenshotName);
        results.push({
          route: check.name,
          hash: check.hash,
          screenshotPath,
          textLength: text.trim().length,
          proofStage: PROOF_STAGES.SHELL_SMOKE,
          settledMarkers: check.expected,
          loadedStateRequiredMarkers: ['redirected #/guid route', 'broker session required'],
        });
      }
    }

    await navigate(page, TEAM_ROUTE_CHECK.hash);
    await page.waitForURL(/#\/guid/, { timeout: 8000 });
    const teamRedirectText = await page.locator('body').innerText({ timeout: 10000 });
    findings.push(
      ...textFindings(TEAM_ROUTE_CHECK.name, teamRedirectText, TEAM_ROUTE_CHECK.expected, TEAM_ROUTE_CHECK.forbidden)
    );
    const teamRedirectPath = await routeScreenshot(page, screenshotsDir, TEAM_ROUTE_CHECK.screenshotName);
    results.push({
      route: TEAM_ROUTE_CHECK.name,
      hash: TEAM_ROUTE_CHECK.hash,
      screenshotPath: teamRedirectPath,
      textLength: teamRedirectText.trim().length,
      proofStage: PROOF_STAGES.SHELL_SMOKE,
      settledMarkers: TEAM_ROUTE_CHECK.expected,
      loadedStateRequiredMarkers: ['redirected #/guid route', 'beta shell fallback copy'],
    });

    for (const error of pageErrors) {
      findings.push({ route: 'runtime', message: `Page error: ${error.message}` });
    }
    for (const message of relevantConsoleErrors(consoleMessages).slice(0, 20)) {
      findings.push({ route: 'console', message: `Console error: ${message.text}` });
    }

    const report = {
      generatedAt: new Date().toISOString(),
      repoRoot,
      artifactRoot,
      routes: results,
      consoleMessages,
      pageErrors,
      findings,
      passed: findings.length === 0,
    };
    writeProof({ artifactRoot, artifactsDir, report });
    return report;
  } finally {
    await app.close();
  }
}

async function main() {
  const report = await runLocalShellSmoke();
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    if (error?.code === 'AIONUI_SMOKE_PLAYWRIGHT_MISSING') {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  BROKER_GUARDED_ROUTE_CHECKS,
  DEFAULT_ARTIFACT_ROOT,
  GLOBAL_FORBIDDEN_PATTERNS,
  LOCAL_PRODUCT_MEMBER_ROUTE_CHECKS,
  LOCAL_PRODUCT_ROUTE_CHECKS,
  PROOF_STAGES,
  ROUTE_CHECKS,
  TEAM_ROUTE_CHECK,
  isLocalProductFixtureMode,
  isLocalProductMemberPersona,
  loadPlaywrightElectron,
  relevantConsoleErrors,
  routeChecksForEnv,
  runLocalShellSmoke,
  shellSmokeEnv,
  textFindings,
};
