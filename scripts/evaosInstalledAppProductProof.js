#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { GOLDEN_WORKBENCH_INSTALLED_PROOF_MANIFEST } = require('./evaosInstalledProofManifest.js');
const { SETTLED_SHELL_SCREENSHOT_PLAN } = require('./evaosSettledShellSmokePlan.js');

const DEFAULT_APP_PATH = '/Applications/evaOS Workbench Beta.app';
const DEFAULT_EXECUTABLE_NAME = 'evaOS Workbench Beta';
const DEFAULT_BUNDLE_ID = 'com.evaos.workbench.beta';
const DEFAULT_PROTOCOL_SCHEME = 'evaos-workbench-beta';
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ARTIFACT_BASE = '/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/67-real-admin-product-reality-pass';
const REPORT_SCHEMA = 'evaos-installed-app-product-proof/v1';
const DEFAULT_TIMEOUT_MS = 25_000;

const UNSAFE_PROOF_PATTERNS = [
  { name: 'desktop_session', pattern: /desktop_session/i },
  { name: 'Bearer', pattern: /Bearer\s+[A-Za-z0-9._~+/=-]+/i },
  { name: 'provider_grant', pattern: /provider_grant/i },
  { name: 'grant_handle', pattern: /grant_handle/i },
  { name: 'access_token', pattern: /access_token/i },
  { name: 'refresh_token', pattern: /refresh_token/i },
  { name: 'api_key', pattern: /api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]{8,}/i },
  { name: 'tokenized_url', pattern: /[?&](token|jwt|desktop_session|access_token|refresh_token)=/i },
];

function shortHead(head) {
  return String(head || '')
    .trim()
    .slice(0, 12);
}

function installedExecutablePath(appPath = DEFAULT_APP_PATH) {
  return path.join(appPath, 'Contents', 'MacOS', DEFAULT_EXECUTABLE_NAME);
}

function artifactRootForHead(head, env = process.env) {
  if (env.EVAOS_INSTALLED_APP_PROOF_ROOT) {
    return env.EVAOS_INSTALLED_APP_PROOF_ROOT;
  }

  return path.join(DEFAULT_ARTIFACT_BASE, `current-head-${shortHead(head)}`, 'installed-app-proof');
}

function gitHead(repoRoot = DEFAULT_REPO_ROOT) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function packageVersion(repoRoot = DEFAULT_REPO_ROOT) {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version || 'unknown';
}

function plistPathForApp(appPath) {
  return path.join(appPath, 'Contents', 'Info.plist');
}

function plistPrint(appPath, key, execFileSyncImpl = execFileSync) {
  return String(
    execFileSyncImpl('/usr/libexec/PlistBuddy', ['-c', key, plistPathForApp(appPath)], { encoding: 'utf8' })
  ).trim();
}

function parsePlistArrayOutput(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== 'Array {' && line !== '}')
    .map((line) => line.replace(/^"|"$/g, ''));
}

function readInfoPlist(appPath, execFileSyncImpl = execFileSync) {
  const schemes = parsePlistArrayOutput(
    plistPrint(appPath, 'Print:CFBundleURLTypes:0:CFBundleURLSchemes', execFileSyncImpl)
  );

  return {
    bundleId: plistPrint(appPath, 'Print:CFBundleIdentifier', execFileSyncImpl),
    bundleName: plistPrint(appPath, 'Print:CFBundleName', execFileSyncImpl),
    bundleVersion: plistPrint(appPath, 'Print:CFBundleVersion', execFileSyncImpl),
    shortVersion: plistPrint(appPath, 'Print:CFBundleShortVersionString', execFileSyncImpl),
    protocolSchemes: schemes,
  };
}

function assertExpectedBundle(bundleInfo) {
  if (bundleInfo.bundleId !== DEFAULT_BUNDLE_ID) {
    throw new Error(`Installed app bundle id ${bundleInfo.bundleId} does not match ${DEFAULT_BUNDLE_ID}.`);
  }
  if (!bundleInfo.protocolSchemes.includes(DEFAULT_PROTOCOL_SCHEME)) {
    throw new Error(`Installed app protocol schemes do not include ${DEFAULT_PROTOCOL_SCHEME}.`);
  }
}

function normalizeWaitSelector(selector) {
  return String(selector).replace(/^body:text\((.*)\)$/, 'body:has-text($1)');
}

function markerSelector(marker) {
  return `body:has-text(${JSON.stringify(marker)})`;
}

function markerFromWaitSelector(selector) {
  const match = String(selector).match(/^body:has-text\("(.+)"\)$/);
  return match ? match[1] : null;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function screenshotPlanById() {
  return new Map(SETTLED_SHELL_SCREENSHOT_PLAN.map((entry) => [entry.id, entry]));
}

function normalizeInstalledProofEntries(plan, options = {}) {
  const expectedShortHead = shortHead(options.expectedHead);
  const screenshotEntriesById = screenshotPlanById();
  const isCustomPlan = Array.isArray(plan);
  const sourcePlan = isCustomPlan ? plan : GOLDEN_WORKBENCH_INSTALLED_PROOF_MANIFEST;

  return sourcePlan.map((entry) => {
    const screenshotEntry = screenshotEntriesById.get(entry.id);
    const baseWaitSelectors = isCustomPlan ? entry.waitSelectors || [] : screenshotEntry?.waitSelectors || [];
    const settledMarkers = Array.isArray(entry.settledMarkers)
      ? [...entry.settledMarkers]
      : baseWaitSelectors.map(normalizeWaitSelector).map(markerFromWaitSelector).filter(Boolean);
    const markerSelectors = settledMarkers.map(markerSelector);
    const waitSelectors = uniqueStrings([...baseWaitSelectors.map(normalizeWaitSelector), ...markerSelectors]);

    if (entry.id === 'settings-about' && expectedShortHead) {
      const commitSelector = normalizeWaitSelector(`body:text("${expectedShortHead}")`);
      if (!waitSelectors.includes(commitSelector)) {
        waitSelectors.push(commitSelector);
      }
      if (!settledMarkers.includes(expectedShortHead)) {
        settledMarkers.push(expectedShortHead);
      }
    }

    return {
      manifestRowId: entry.manifestRowId || entry.id,
      id: entry.id,
      route: entry.route,
      screenshot: entry.screenshot,
      artifactName: entry.artifactName || `screenshots/${entry.screenshot}`,
      action: entry.action || (isCustomPlan ? undefined : screenshotEntry?.action),
      closeoutState: entry.closeoutState || 'loaded',
      settledMarkers,
      waitSelectors,
    };
  });
}

function buildInstalledProofPlan(plan, options = {}) {
  return normalizeInstalledProofEntries(plan, options);
}

function buildInstalledProofPreflightPlan(options = {}) {
  const expectedShortHead = shortHead(options.expectedHead);
  const settledMarkers = uniqueStrings(['About', 'Build identity', expectedShortHead]);

  return [
    {
      manifestRowId: 'exact-candidate-preflight',
      id: 'settings-about-current-candidate',
      route: '/settings/about',
      screenshot: 'preflight-settings-about.png',
      artifactName: 'screenshots/preflight-settings-about.png',
      closeoutState: 'loaded',
      settledMarkers,
      waitSelectors: settledMarkers.map(markerSelector),
    },
  ];
}

function assertNoUnsafeProofText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const { name, pattern } of UNSAFE_PROOF_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`Unsafe proof output contains ${name}.`);
    }
  }
}

function ensureProofDirs(artifactRoot) {
  fs.mkdirSync(path.join(artifactRoot, 'artifacts', 'screenshots'), { recursive: true });
}

function safeReportForPlan(options) {
  const plan = normalizeInstalledProofEntries(options.plan, { expectedHead: options.expectedHead });
  const preflightPlan = buildInstalledProofPreflightPlan({ expectedHead: options.expectedHead });
  const appStat =
    fs.existsSync(options.appPath) && fs.statSync(options.appPath).isDirectory()
      ? {
          mtimeMs: fs.statSync(options.appPath).mtimeMs,
          size: fs.statSync(options.appPath).size,
        }
      : null;

  return {
    schema: REPORT_SCHEMA,
    mode: options.mode || 'dry-run',
    generatedAt: new Date().toISOString(),
    repoHead: options.repoHead,
    expectedHead: options.expectedHead,
    expectedShortHead: shortHead(options.expectedHead),
    appPath: options.appPath,
    executablePath: options.executablePath,
    appStat,
    packageVersion: options.packageVersion || 'unknown',
    bundleInfo: options.bundleInfo,
    screenshots: plan.map((entry) => ({
      id: entry.id,
      route: entry.route,
      screenshot: entry.artifactName,
      artifactName: entry.artifactName,
      closeoutState: entry.closeoutState,
      status: options.screenshotStatus || 'pending',
    })),
    preflightAssertions: preflightPlan.map((entry) => ({
      id: entry.id,
      manifestRowId: entry.manifestRowId,
      route: entry.route,
      artifactName: entry.artifactName,
      closeoutState: entry.closeoutState,
      settledMarkers: entry.settledMarkers,
      waitSelectors: entry.waitSelectors,
      status: options.screenshotStatus || 'pending',
    })),
    parityAssertions: plan.map((entry) => ({
      id: entry.id,
      manifestRowId: entry.manifestRowId,
      route: entry.route,
      artifactName: entry.artifactName,
      closeoutState: entry.closeoutState,
      settledMarkers: entry.settledMarkers,
      waitSelectors: entry.waitSelectors,
      status: options.screenshotStatus || 'pending',
    })),
    failure: options.failure || null,
  };
}

function markdownForInstalledProof(report) {
  return [
    '# Installed App Product Proof',
    '',
    `Schema: \`${REPORT_SCHEMA}\``,
    `Mode: \`${report.mode || 'live'}\``,
    `Expected commit: \`${shortHead(report.expectedHead)}\``,
    `Repo head: \`${shortHead(report.repoHead)}\``,
    `App path: \`${report.appPath}\``,
    `Executable: \`${report.executablePath}\``,
    '',
    '## Bundle Identity',
    '',
    `- Bundle ID: \`${report.bundleInfo.bundleId}\``,
    `- Bundle name: \`${report.bundleInfo.bundleName}\``,
    `- Bundle version: \`${report.bundleInfo.bundleVersion}\``,
    `- Short version: \`${report.bundleInfo.shortVersion}\``,
    `- Protocol schemes: \`${report.bundleInfo.protocolSchemes.join('`, `')}\``,
    '',
    '## Exact Candidate Preflight',
    '',
    ...(report.preflightAssertions || []).map(
      (entry) => `- \`${entry.id}\` -> \`${entry.artifactName}\` (${entry.closeoutState}, ${entry.status})`
    ),
    '',
    '## Parity Assertions',
    '',
    ...(report.parityAssertions || report.screenshots).map(
      (shot) =>
        `- \`${shot.id}\` -> \`${shot.artifactName || shot.screenshot}\` (${shot.closeoutState}, ${shot.status})`
    ),
    '',
    ...(report.failure
      ? [
          '## Failure',
          '',
          `- Stage: \`${report.failure.stage}\``,
          `- ID: \`${report.failure.id}\``,
          `- Route: \`${report.failure.route}\``,
          `- Current hash: \`${report.failure.currentHash}\``,
          `- Screenshot: \`${report.failure.screenshot || 'none'}\``,
          `- Message: ${report.failure.message}`,
          '',
        ]
      : []),
    '## Safety',
    '',
    'Reports intentionally omit environment values, renderer state dumps, tokenized URLs, provider grants, and raw credentials.',
    '',
  ].join('\n');
}

function takeoverMarkdown(report) {
  return [
    '# Takeover',
    '',
    'Run from `/Volumes/LEXAR/repos/AionUi-business-browser-context` or a current-head Lexar worktree after installing a fresh macOS beta candidate.',
    '',
    '```bash',
    `EVAOS_INSTALLED_APP_PROOF_EXPECTED_HEAD=${report.expectedHead} npm run evaos:installed-app-proof`,
    '```',
    '',
    'A pass means the installed app bundle identity matched, the About page exposed the expected commit, and every golden Workbench parity row reached its required loaded, denied, or repair state before screenshot capture.',
    '',
  ].join('\n');
}

function writeReportFiles(artifactRoot, report) {
  ensureProofDirs(artifactRoot);
  assertNoUnsafeProofText(report);

  const reportPath = path.join(artifactRoot, 'artifacts', 'installed-app-product-proof-report.json');
  const proofPath = path.join(artifactRoot, 'proof.md');
  const takeoverPath = path.join(artifactRoot, 'takeover.md');

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(proofPath, markdownForInstalledProof(report));
  fs.writeFileSync(takeoverPath, takeoverMarkdown(report));

  assertNoUnsafeProofText(fs.readFileSync(reportPath, 'utf8'));
  assertNoUnsafeProofText(fs.readFileSync(proofPath, 'utf8'));
  assertNoUnsafeProofText(fs.readFileSync(takeoverPath, 'utf8'));

  return { reportPath, proofPath, takeoverPath };
}

function writeDryRunProofFiles(options) {
  const report = safeReportForPlan({ ...options, mode: 'dry-run', screenshotStatus: 'pending' });
  return writeReportFiles(options.artifactRoot, report);
}

async function resolveMainWindow(electronApp) {
  const existing = electronApp.windows().find((page) => !page.url().startsWith('devtools://'));
  if (existing) {
    await existing.waitForLoadState('domcontentloaded');
    return existing;
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const page = await electronApp.waitForEvent('window', { timeout: 1_000 }).catch(() => null);
    if (page && !page.url().startsWith('devtools://')) {
      await page.waitForLoadState('domcontentloaded');
      return page;
    }
  }

  throw new Error('Failed to resolve installed app renderer window.');
}

async function runProofPlanAction(page, action, timeout = DEFAULT_TIMEOUT_MS) {
  if (!action) return;

  if (action === 'click-native-companion-advanced-diagnostics') {
    const advancedButton = page.getByRole('button', { name: /Advanced diagnostics/i }).first();
    await advancedButton.waitFor({ state: 'visible', timeout });
    await advancedButton.click();
    await page.waitForFunction(
      () => Boolean(globalThis.document?.body?.innerText?.includes('Native companion status matrix')),
      undefined,
      { timeout }
    );
    return;
  }

  throw new Error(`Installed app proof action is not allowlisted: ${action}`);
}

async function captureProofEntry(page, entry, artifactRoot, timeout) {
  await page.evaluate((route) => {
    window.location.hash = route.startsWith('#') ? route : `#${route}`;
  }, entry.route);
  await page.waitForLoadState('domcontentloaded');
  await runProofPlanAction(page, entry.action, timeout);

  for (const selector of entry.waitSelectors) {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout });
  }

  const screenshotPath = path.join(artifactRoot, 'artifacts', 'screenshots', entry.screenshot);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  return {
    id: entry.id,
    manifestRowId: entry.manifestRowId,
    route: entry.route,
    screenshot: entry.artifactName,
    artifactName: entry.artifactName,
    closeoutState: entry.closeoutState,
    settledMarkers: entry.settledMarkers,
    waitSelectors: entry.waitSelectors,
    status: 'passed',
  };
}

async function captureFailureProof(page, entry, artifactRoot, stage, error) {
  const failureScreenshot = `screenshots/${entry.id}-failure.png`;
  const screenshotPath = path.join(artifactRoot, 'artifacts', failureScreenshot);
  let currentHash = 'unavailable';

  if (page) {
    currentHash = await page.evaluate(() => window.location.hash).catch(() => 'unavailable');
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  }

  return {
    stage,
    id: entry.id,
    manifestRowId: entry.manifestRowId,
    route: entry.route,
    currentHash,
    expectedSelectors: entry.waitSelectors,
    screenshot: failureScreenshot,
    message: error?.message || String(error),
  };
}

async function captureInstalledAppProof(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const repoHead = options.repoHead || gitHead(repoRoot);
  const expectedHead = options.expectedHead || process.env.EVAOS_INSTALLED_APP_PROOF_EXPECTED_HEAD || repoHead;
  const appPath = options.appPath || DEFAULT_APP_PATH;
  const executablePath = options.executablePath || installedExecutablePath(appPath);
  const artifactRoot = options.artifactRoot || artifactRootForHead(expectedHead, process.env);
  const timeout = Number(options.timeout || process.env.EVAOS_INSTALLED_APP_PROOF_TIMEOUT || DEFAULT_TIMEOUT_MS);

  if (!fs.existsSync(appPath)) {
    throw new Error(`Installed app not found: ${appPath}`);
  }
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Installed app executable not found: ${executablePath}`);
  }

  const bundleInfo = options.bundleInfo || readInfoPlist(appPath);
  assertExpectedBundle(bundleInfo);

  const preflightPlan = buildInstalledProofPreflightPlan({ expectedHead });
  const proofPlan = buildInstalledProofPlan(undefined, { expectedHead });
  ensureProofDirs(artifactRoot);

  const { _electron: electron } = require('playwright');
  let electronApp;
  try {
    electronApp = await electron.launch({
      executablePath,
      cwd: path.dirname(executablePath),
      env: {
        ...process.env,
        AIONUI_DISABLE_AUTO_UPDATE: '1',
        AIONUI_DISABLE_DEVTOOLS: '1',
        AIONUI_E2E_TEST: '1',
        AIONUI_CDP_PORT: '0',
        EVAOS_INSTALLED_APP_PROOF: '1',
        NODE_ENV: 'production',
      },
      timeout: 60_000,
    });
  } catch (error) {
    const failure = {
      stage: 'launch',
      id: 'installed-app-launch',
      route: 'app-launch',
      currentHash: 'unavailable',
      expectedSelectors: [],
      screenshot: null,
      message: error?.message || String(error),
    };
    const report = safeReportForPlan({
      mode: 'live',
      repoHead,
      expectedHead,
      appPath,
      executablePath,
      packageVersion: packageVersion(repoRoot),
      bundleInfo,
      plan: proofPlan,
      screenshotStatus: 'not-started',
      failure,
    });
    const files = writeReportFiles(artifactRoot, report);
    throw new Error(`Installed app proof failed during launch; wrote ${files.reportPath}: ${failure.message}`);
  }

  const screenshots = [];
  const preflightAssertions = [];
  let failure = null;

  try {
    const page = await resolveMainWindow(electronApp);
    await page.setViewportSize({ width: 1440, height: 1000 });

    for (const entry of preflightPlan) {
      try {
        preflightAssertions.push(await captureProofEntry(page, entry, artifactRoot, timeout));
      } catch (error) {
        failure = await captureFailureProof(page, entry, artifactRoot, 'preflight', error);
        break;
      }
    }

    if (!failure) {
      for (const entry of proofPlan) {
        try {
          screenshots.push(await captureProofEntry(page, entry, artifactRoot, timeout));
        } catch (error) {
          failure = await captureFailureProof(page, entry, artifactRoot, 'parity', error);
          break;
        }
      }
    }
  } finally {
    await electronApp.close().catch(() => undefined);
  }

  const report = {
    schema: REPORT_SCHEMA,
    mode: 'live',
    generatedAt: new Date().toISOString(),
    repoHead,
    expectedHead,
    expectedShortHead: shortHead(expectedHead),
    appPath,
    executablePath,
    appStat: {
      mtimeMs: fs.statSync(appPath).mtimeMs,
      size: fs.statSync(appPath).size,
    },
    packageVersion: packageVersion(repoRoot),
    bundleInfo,
    screenshots,
    preflightAssertions,
    parityAssertions: screenshots.map((entry) => ({
      id: entry.id,
      manifestRowId: entry.manifestRowId,
      route: entry.route,
      artifactName: entry.artifactName,
      closeoutState: entry.closeoutState,
      settledMarkers: entry.settledMarkers,
      waitSelectors: entry.waitSelectors,
      status: entry.status,
    })),
    failure,
  };

  const files = writeReportFiles(artifactRoot, report);
  if (failure) {
    throw new Error(
      `Installed app proof failed during ${failure.stage} for ${failure.id}; wrote ${files.reportPath}: ${failure.message}`
    );
  }
  return { artifactRoot, report, files };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--app') options.appPath = argv[++index];
    else if (arg === '--artifact-root') options.artifactRoot = argv[++index];
    else if (arg === '--repo-root') options.repoRoot = argv[++index];
    else if (arg === '--expected-head') options.expectedHead = argv[++index];
    else if (arg === '--timeout') options.timeout = Number(argv[++index]);
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function helpText() {
  return [
    'Usage: node scripts/evaosInstalledAppProductProof.js [--dry-run] [--app <path>] [--expected-head <sha>]',
    '',
    'Captures settled screenshots from /Applications/evaOS Workbench Beta.app and fails if the About page',
    'does not show the expected current commit.',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const repoHead = gitHead(repoRoot);
  const expectedHead = options.expectedHead || process.env.EVAOS_INSTALLED_APP_PROOF_EXPECTED_HEAD || repoHead;
  const appPath = options.appPath || DEFAULT_APP_PATH;
  const executablePath = installedExecutablePath(appPath);
  const artifactRoot = options.artifactRoot || artifactRootForHead(expectedHead, process.env);

  if (options.dryRun) {
    const bundleInfo = fs.existsSync(appPath)
      ? readInfoPlist(appPath)
      : {
          bundleId: DEFAULT_BUNDLE_ID,
          bundleName: DEFAULT_EXECUTABLE_NAME,
          bundleVersion: packageVersion(repoRoot),
          shortVersion: packageVersion(repoRoot),
          protocolSchemes: [DEFAULT_PROTOCOL_SCHEME],
        };
    assertExpectedBundle(bundleInfo);
    const plan = buildInstalledProofPlan(undefined, { expectedHead });
    const files = writeDryRunProofFiles({
      artifactRoot,
      repoHead,
      expectedHead,
      appPath,
      executablePath,
      bundleInfo,
      plan,
      packageVersion: packageVersion(repoRoot),
    });
    console.log(`[evaos-installed-app-proof] dry-run wrote ${files.reportPath}`);
    return;
  }

  const result = await captureInstalledAppProof({
    ...options,
    repoHead,
    expectedHead,
    appPath,
    executablePath,
    artifactRoot,
  });
  console.log(`[evaos-installed-app-proof] wrote ${result.files.reportPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[evaos-installed-app-proof] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_APP_PATH,
  DEFAULT_EXECUTABLE_NAME,
  DEFAULT_BUNDLE_ID,
  DEFAULT_PROTOCOL_SCHEME,
  REPORT_SCHEMA,
  UNSAFE_PROOF_PATTERNS,
  artifactRootForHead,
  assertNoUnsafeProofText,
  buildInstalledProofPlan,
  buildInstalledProofPreflightPlan,
  captureInstalledAppProof,
  gitHead,
  installedExecutablePath,
  markdownForInstalledProof,
  packageVersion,
  parsePlistArrayOutput,
  readInfoPlist,
  runProofPlanAction,
  shortHead,
  writeDryRunProofFiles,
};
