#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
  DEFAULT_APP_PATH,
  captureInstalledAppProof,
  gitHead,
  installedExecutablePath,
  shortHead,
} = require('./evaosInstalledAppProductProof.js');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ARTIFACT_BASE = '/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/native-companion-state-matrix';

const STATE_MATRIX = [
  {
    state: 'ready',
    settledResult: 'loaded',
    screenshot: 'native-companion-ready.png',
    markers: [
      'Mac & iPhone',
      'Mac & iPhone are ready',
      'Native companion proof is ready',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Boundary clean',
    ],
  },
  {
    state: 'not_paired',
    settledResult: 'repair required',
    screenshot: 'native-companion-not-paired.png',
    markers: [
      'Mac & iPhone',
      'Pair this Mac',
      'This Mac must be paired again',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Boundary clean',
    ],
  },
  {
    state: 'permission_needed',
    settledResult: 'repair required',
    screenshot: 'native-companion-permission-needed.png',
    markers: [
      'Mac & iPhone',
      'Allow Mac control',
      'macOS Accessibility or Screen Recording needs attention',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Boundary clean',
    ],
  },
  {
    state: 'offline',
    settledResult: 'offline',
    screenshot: 'native-companion-offline.png',
    markers: [
      'Mac & iPhone',
      'Reconnect native companion',
      'Native status is offline or stale',
      'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      'Boundary clean',
    ],
  },
];

function artifactRootForHead(head, env = process.env) {
  if (env.EVAOS_NATIVE_COMPANION_STATE_PROOF_ROOT) {
    return env.EVAOS_NATIVE_COMPANION_STATE_PROOF_ROOT;
  }
  return path.join(DEFAULT_ARTIFACT_BASE, `current-head-${shortHead(head)}`);
}

function planEntryForState(entry) {
  return {
    id: `native-companion-${entry.state}`,
    manifestRowId: 'native-companion',
    route: '/native-companion',
    screenshot: entry.screenshot,
    artifactName: `screenshots/${entry.screenshot}`,
    closeoutState: entry.settledResult === 'loaded' ? 'loaded' : 'repair',
    settledMarkers: entry.markers,
    waitSelectors: entry.markers.map((marker) => `body:has-text(${JSON.stringify(marker)})`),
  };
}

function restoreEnv(savedEnv) {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function writeMatrixReport({ artifactRoot, repoHead, expectedHead, results }) {
  fs.mkdirSync(artifactRoot, { recursive: true });
  const report = {
    schema: 'evaos-native-companion-installed-state-proof/v1',
    generatedAt: new Date().toISOString(),
    repoHead,
    expectedHead,
    expectedShortHead: shortHead(expectedHead),
    fixtureGate: {
      AIONUI_E2E_TEST: '1',
      AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE: '1',
      stateEnv: 'AIONUI_EVAOS_NATIVE_COMPANION_STATUS_FIXTURE',
    },
    routes: results,
  };
  const reportPath = path.join(artifactRoot, 'native-companion-state-proof-report.json');
  const proofPath = path.join(artifactRoot, 'proof.md');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(
    proofPath,
    [
      '# Native Companion Installed State Matrix',
      '',
      `Generated: ${report.generatedAt}`,
      `Expected commit: \`${shortHead(expectedHead)}\``,
      `Repo head: \`${shortHead(repoHead)}\``,
      '',
      '## Scope',
      '',
      'These screenshots are installed-app fixture proof, not live native readiness proof. The fixture is gated by `AIONUI_E2E_TEST=1` and `AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE=1`.',
      '',
      '## States',
      '',
      ...results.map(
        (result) =>
          `- \`${result.state}\` -> \`${result.screenshotPath}\` (${result.settledResult}; ${result.artifactRoot})`
      ),
      '',
    ].join('\n')
  );
  return { reportPath, proofPath };
}

async function captureNativeCompanionInstalledStateProof(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const repoHead = options.repoHead || gitHead(repoRoot);
  const expectedHead = options.expectedHead || process.env.EVAOS_INSTALLED_APP_PROOF_EXPECTED_HEAD || repoHead;
  const artifactRoot = options.artifactRoot || artifactRootForHead(expectedHead, process.env);
  const appPath = options.appPath || DEFAULT_APP_PATH;
  const executablePath = options.executablePath || installedExecutablePath(appPath);
  const timeout = options.timeout;
  const savedEnv = {
    AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE: process.env.AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE,
    AIONUI_EVAOS_NATIVE_COMPANION_STATUS_FIXTURE: process.env.AIONUI_EVAOS_NATIVE_COMPANION_STATUS_FIXTURE,
    EVAOS_INSTALLED_APP_PROOF_ROOT: process.env.EVAOS_INSTALLED_APP_PROOF_ROOT,
  };

  const results = [];
  try {
    for (const entry of STATE_MATRIX) {
      const stateRoot = path.join(artifactRoot, entry.state);
      process.env.AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE = '1';
      process.env.AIONUI_EVAOS_NATIVE_COMPANION_STATUS_FIXTURE = entry.state;
      process.env.EVAOS_INSTALLED_APP_PROOF_ROOT = stateRoot;

      const plan = [planEntryForState(entry)];
      const proof = await captureInstalledAppProof({
        repoRoot,
        repoHead,
        expectedHead,
        artifactRoot: stateRoot,
        appPath,
        executablePath,
        timeout,
        plan,
      });

      results.push({
        state: entry.state,
        settledResult: entry.settledResult,
        artifactRoot: stateRoot,
        proofPath: proof.files.proofPath,
        reportPath: proof.files.reportPath,
        screenshotPath: path.join(stateRoot, 'artifacts', 'screenshots', entry.screenshot),
      });
    }
  } finally {
    restoreEnv(savedEnv);
  }

  const files = writeMatrixReport({ artifactRoot, repoHead, expectedHead, results });
  return { artifactRoot, results, files };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--app') options.appPath = argv[++index];
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
    'Usage: node scripts/evaosNativeCompanionInstalledStateProof.js [--app <path>] [--expected-head <sha>]',
    '',
    'Captures installed-app Mac & iPhone screenshots for ready, not_paired, permission_needed, and offline',
    'using the gated local product fixture native-companion status source.',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }
  const result = await captureNativeCompanionInstalledStateProof(options);
  console.log(`[evaos-native-companion-state-proof] wrote ${result.files.reportPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[evaos-native-companion-state-proof] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  STATE_MATRIX,
  artifactRootForHead,
  captureNativeCompanionInstalledStateProof,
  planEntryForState,
};
