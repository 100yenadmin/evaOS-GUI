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
    settledMarkers: ['Mission Control', 'Public beta gated', 'Local shell smoke', 'No runtime evidence loaded yet.'],
    loadedStateRequiredMarkers: ['desktop session card', 'broker source pointer', 'current audit id'],
    expected: [
      'Public beta gated',
      'Local shell smoke',
      'Sign in required',
      'Sign in to evaOS to connect this desktop shell.',
      'No runtime evidence loaded yet.',
    ],
    forbidden: ['Root PR #15', 'Stack approval', 'ship public beta', 'ready to ship'],
  },
  {
    name: 'people-access-empty-error',
    hash: '/people-access',
    title: 'People Access',
    proofStage: PROOF_STAGES.SHELL_SMOKE,
    settledMarkers: [
      'People Access',
      'Customer context',
      'Refresh targets',
      'Sign in to evaOS before loading customer targets.',
    ],
    loadedStateRequiredMarkers: ['member rows', 'role badges', 'account policy source pointer'],
    action: 'click-refresh-targets',
    isolateRendererState: true,
    expected: [
      'People Access',
      'Members, roles, invites, and seats from the evaOS account policy plane.',
      'Customer context',
      'Refresh targets',
      'Load a customer account policy to view People Access.',
      'Sign in to evaOS before loading customer targets.',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant'],
  },
  {
    name: 'approval-center-empty-error',
    hash: '/approval-center',
    title: 'Approval Center',
    proofStage: PROOF_STAGES.SHELL_SMOKE,
    settledMarkers: [
      'Approval Center',
      'Customer context',
      'Refresh targets',
      'Sign in to evaOS before loading customer targets.',
    ],
    loadedStateRequiredMarkers: ['approval request rows', 'deny/approve policy source', 'decision audit id'],
    action: 'click-refresh-targets',
    isolateRendererState: true,
    expected: [
      'Approval Center',
      'Human decisions for risky agent actions',
      'Customer context',
      'Refresh targets',
      'Load a customer account to review pending approval requests.',
      'Sign in to evaOS before loading customer targets.',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant'],
  },
  {
    name: 'connected-apps-empty-error',
    hash: '/connected-apps',
    title: 'Connected Apps',
    proofStage: PROOF_STAGES.SHELL_SMOKE,
    settledMarkers: [
      'Connected Apps',
      'Customer context',
      'Refresh targets',
      'Sign in to evaOS before loading customer targets.',
    ],
    loadedStateRequiredMarkers: ['provider profile cards', 'grant/revoke status badges', 'provider source pointer'],
    action: 'click-refresh-targets',
    isolateRendererState: true,
    expected: [
      'Connected Apps',
      'Brokered provider status, grants, and revocation',
      'Customer context',
      'Refresh targets',
      'Load a customer account to view connected app evidence.',
      'Sign in to evaOS before loading customer targets.',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant', 'grant_handle'],
  },
  {
    name: 'business-browser-empty-error',
    hash: '/business-browser',
    title: 'Business Browser',
    proofStage: PROOF_STAGES.SHELL_SMOKE,
    settledMarkers: [
      'Business Browser',
      'Customer context',
      'Refresh targets',
      'Sign in to evaOS before loading customer targets.',
    ],
    loadedStateRequiredMarkers: ['browser runtime status', 'current URL summary', 'browser audit id'],
    action: 'click-refresh-targets',
    isolateRendererState: true,
    expected: [
      'Business Browser',
      'Brokered browser and VM runtime state',
      'Customer context',
      'Refresh targets',
      'Load a customer account to view browser runtime evidence.',
      'Sign in to evaOS before loading customer targets.',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant'],
  },
  {
    name: 'company-brain-empty-error',
    hash: '/company-brain',
    title: 'Company Brain',
    proofStage: PROOF_STAGES.SHELL_SMOKE,
    settledMarkers: [
      'Company Brain',
      'Customer context',
      'Refresh targets',
      'Sign in to evaOS before loading customer targets.',
    ],
    loadedStateRequiredMarkers: ['account directory rows', 'ingest/query status cards', 'directory source pointer'],
    action: 'click-refresh-targets',
    isolateRendererState: true,
    expected: [
      'Company Brain',
      'Org-scoped account directory, account brief, timeline, query, and exception evidence.',
      'Customer context',
      'Refresh targets',
      'Load a customer account to view Company Brain evidence.',
      'Sign in to evaOS before loading customer targets.',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant'],
  },
  {
    name: 'agent-settings-remote-guardrail',
    hash: '/settings/agent',
    title: 'Agent',
    proofStage: PROOF_STAGES.SHELL_SMOKE,
    settledMarkers: ['Local Agents', 'No local agents detected'],
    loadedStateRequiredMarkers: ['local agent inventory result', 'remote guardrail copy'],
    expected: ['Local Agents', 'No local agents detected'],
    forbidden: ['Root PR #15', 'Stack approval', 'Remote Agents', 'Allow insecure', 'Handshake', 'Connect remote'],
  },
];

const LOCAL_PRODUCT_ROUTE_CHECKS = [
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
    action: 'click-load',
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
    action: 'click-load',
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
  /autofill|Failed to load resource: net::ERR_FILE_NOT_FOUND|Failed to load initial theme|Failed to load initial color scheme|Failed to initialize language|Failed to initialize config|\[useExtensionSettingsTabs\] Failed to load tabs|\[useExtI18n\] Failed to load ext i18n|\[useCronJobsMap\] Failed to fetch jobs/;

function ensureDirs(artifactRoot) {
  const screenshotsDir = path.join(artifactRoot, 'screenshots');
  const artifactsDir = path.join(artifactRoot, 'artifacts');
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(artifactsDir, { recursive: true });
  return { screenshotsDir, artifactsDir };
}

function shellSmokeEnv(artifactsDir, env = process.env) {
  return {
    ...env,
    AIONUI_E2E_TEST: '1',
    AIONUI_DISABLE_AUTO_UPDATE: '1',
    AIONUI_DISABLE_DEVTOOLS: '1',
    AIONUI_CDP_PORT: '0',
    AIONUI_EXTENSIONS_PATH: path.join(artifactsDir, 'extensions'),
    AIONUI_EXTENSION_STATES_FILE: path.join(artifactsDir, 'extension-states.json'),
    AIONUI_EVAOS_BETA: '1',
    NODE_ENV: 'production',
  };
}

function isLocalProductFixtureMode(env = process.env) {
  return env.AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE === '1';
}

function routeChecksForEnv(env = process.env) {
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

async function isolateRendererState(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
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
  const launchEnv = shellSmokeEnv(artifactsDir, options.env || process.env);
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

    await navigate(page, '/mission-control');
    await waitForRoute(page, 'Mission Control');

    for (const check of routeChecks) {
      console.log(`[evaos-local-shell-smoke] route ${check.name} -> #${check.hash}`);
      await navigate(page, check.hash);
      if (check.isolateRendererState) {
        await isolateRendererState(page);
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
      if (check.action === 'click-load') {
        await clickLoad(page);
      } else if (check.action === 'click-load-company-brain') {
        await clickLoad(page);
        await clickFirstCompanyBrainAccount(page);
        await askCompanyBrainFixtureQuestion(page);
      } else if (check.action === 'click-business-browser-launch') {
        await clickBusinessBrowserLaunch(page);
      } else if (check.action === 'click-business-browser-stop') {
        await clickBusinessBrowserStop(page);
      } else if (check.action === 'click-business-browser-denied-customer') {
        await clickBusinessBrowserDeniedCustomer(page);
      } else if (check.action === 'click-refresh-targets') {
        await clickRefreshTargets(page);
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
  DEFAULT_ARTIFACT_ROOT,
  GLOBAL_FORBIDDEN_PATTERNS,
  LOCAL_PRODUCT_ROUTE_CHECKS,
  PROOF_STAGES,
  ROUTE_CHECKS,
  TEAM_ROUTE_CHECK,
  isLocalProductFixtureMode,
  loadPlaywrightElectron,
  relevantConsoleErrors,
  routeChecksForEnv,
  runLocalShellSmoke,
  shellSmokeEnv,
  textFindings,
};
