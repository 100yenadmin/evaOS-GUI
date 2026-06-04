#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const DEFAULT_ARTIFACT_ROOT =
  process.env.AIONUI_SMOKE_ARTIFACT_ROOT || '/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/38-local-shell-smoke';

const ROUTE_CHECKS = [
  {
    name: 'mission-control',
    hash: '/mission-control',
    title: 'Mission Control',
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
    action: 'click-refresh-targets',
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
    action: 'click-load',
    expected: [
      'Approval Center',
      'Human decisions for risky agent actions',
      'Load a customer account to review pending approval requests.',
      'Choose a customer before loading approvals.',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant'],
  },
  {
    name: 'connected-apps-empty-error',
    hash: '/connected-apps',
    title: 'Connected Apps',
    action: 'click-refresh-targets',
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
    action: 'click-load',
    expected: [
      'Business Browser',
      'Brokered browser and VM runtime state',
      'Load a customer account to view browser runtime evidence.',
      'Choose a customer before loading Business Browser.',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant'],
  },
  {
    name: 'company-brain-empty-error',
    hash: '/company-brain',
    title: 'Company Brain',
    action: 'click-load',
    expected: [
      'Company Brain',
      'Org-scoped account directory, account brief, timeline, query, and exception evidence.',
      'Load a customer account to view Company Brain evidence.',
      'Choose a customer before loading Company Brain.',
    ],
    forbidden: ['desktop_session', 'Bearer', 'provider_grant'],
  },
  {
    name: 'agent-settings-remote-guardrail',
    hash: '/settings/agent',
    title: 'Agent',
    expected: ['Local Agents', 'No local agents detected'],
    forbidden: ['Root PR #15', 'Stack approval', 'Remote Agents', 'Allow insecure', 'Handshake', 'Connect remote'],
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
  /autofill|Failed to load resource: net::ERR_FILE_NOT_FOUND|\[useExtensionSettingsTabs\] Failed to load tabs|\[useExtI18n\] Failed to load ext i18n|\[useCronJobsMap\] Failed to fetch jobs/;

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
  await loadButton.click();
  await page.waitForTimeout(250);
}

async function clickRefreshTargets(page) {
  const refreshTargetsButton = page.getByRole('button', { name: /^Refresh targets$/ }).first();
  await refreshTargetsButton.click();
  await page.waitForTimeout(350);
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

async function waitForRoute(page, title) {
  await page.waitForFunction((expectedTitle) => document.body.innerText.includes(expectedTitle), title, {
    timeout: 30000,
  });
  await page.waitForTimeout(450);
}

async function routeScreenshot(page, screenshotsDir, routeName) {
  const screenshotPath = path.join(screenshotsDir, `${routeName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

function writeProof({ artifactRoot, artifactsDir, report }) {
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
      'Command:',
      '',
      '```bash',
      'npm run evaos:local-shell-smoke',
      '```',
      '',
      '## Routes',
      '',
      ...report.routes.map((result) => `- ${result.route}: ${result.screenshotPath}`),
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
  const consoleMessages = [];
  const pageErrors = [];
  const results = [];
  const findings = [];

  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: shellSmokeEnv(artifactsDir, options.env || process.env),
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

    for (const check of ROUTE_CHECKS) {
      console.log(`[evaos-local-shell-smoke] route ${check.name} -> #${check.hash}`);
      await navigate(page, check.hash);
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
      } else if (check.action === 'click-refresh-targets') {
        await clickRefreshTargets(page);
      }
      const text = await page.locator('body').innerText({ timeout: 10000 });
      findings.push(...textFindings(check.name, text, check.expected, check.forbidden));
      const screenshotPath = await routeScreenshot(page, screenshotsDir, check.name);
      results.push({
        route: check.name,
        hash: check.hash,
        screenshotPath,
        textLength: text.trim().length,
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
  ROUTE_CHECKS,
  TEAM_ROUTE_CHECK,
  loadPlaywrightElectron,
  relevantConsoleErrors,
  runLocalShellSmoke,
  shellSmokeEnv,
  textFindings,
};
