#!/usr/bin/env node

// evaOS Workbench PR checks are macOS-first and risk-gated. Routine docs,
// renderer, and non-release workflow changes should not pay packaged-app cost.
const WINDOWS_REQUIRED_PATTERNS = [];

const PACKAGE_SMOKE_REQUIRED_PATTERNS = [
  /^packages\/desktop\/electron-builder\.ya?ml$/,
  /^packages\/desktop\/electron\.vite\.config\.ts$/,
  /^packages\/shared-scripts\/src\/prepare-aioncore\.js$/,
  /^scripts\/(build-with-builder|afterPack|afterSign|prepareAioncore|prepareHubResources|prepareEvaosDesktopBridgeResource|rebuildNativeModules|evaosFinalizeMacDmg|evaosBetaReleaseGate|evaosPrCheckPlan|prepare-release-assets|verify-release-assets|create-mock-release-artifacts)(?:\.[cm]?[jt]s|\.sh)?$/,
  /^\.github\/workflows\/(pr-checks|workbench-functional-smoke|_build-reusable|build-and-release|evaos-beta-rc-canary|local-signed-dmg-manifest)\.ya?ml$/,
  /^package\.json$/,
  /^bun\.lock$/,
  /^resources\/evaos-beta\//,
  /^resources\/(Bridge|hub|bundled-aioncore)\//,
  /^packages\/desktop\/src\/process\/backend\/(?:index|binaryResolver)\.ts$/,
  /^packages\/desktop\/src\/process\/startup\/backend(?:InstallDiagnostics|Startup|StartupFailure)\.ts$/,
  /^packages\/desktop\/src\/process\/bridge\/updateBridge\.ts$/,
  /^packages\/desktop\/src\/process\/services\/evaos(BrokerSession|NativeCompanionStatus)\.ts$/,
  /^packages\/web-host\/src\/backend-launcher\.ts$/,
  /^packages\/web-cli\//,
];

const PACKAGE_SMOKE_SAFE_SKIP_PATTERNS = [
  /^docs\//,
  /^\.vscode\//,
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/workflows\/(?!.*(release|build|smoke|canary|sign|signed|dmg|appcast|updater|pr-checks)).+\.ya?ml$/,
  /^README(?:\.[^.]+)?$/i,
  /(^|\/).+\.test\.[cm]?[jt]sx?$/i,
  /^tests\//,
  /^packages\/desktop\/src\/renderer\//,
  /^packages\/desktop\/src\/common\/types\//,
  /^packages\/desktop\/src\/process\/(?:bridge\/(?!updateBridge\.ts$)|feedback\/|pet\/|resources\/|services\/(?!evaos(?:BrokerSession|NativeCompanionStatus)\.ts$)|utils\/).+\.[cm]?[jt]sx?$/i,
];

function normalizeFilePath(value) {
  return String(value ?? '').replace(/\r$/, '');
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(text);
}

function firstMatchingPattern(filePath, patterns) {
  return patterns.find((pattern) => pattern.test(filePath));
}

/**
 * Return true when a changed path should opt into Windows-specific PR checks.
 * The default macOS-first Workbench lane keeps this empty until a Windows risk
 * surface is identified.
 *
 * @param {string} filePath - Repository-relative path reported by GitHub.
 * @returns {boolean} Whether the path needs Windows checks.
 */
function requiresWindowsChecks(filePath) {
  return WINDOWS_REQUIRED_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Return true when a changed path is a known package/runtime surface that must
 * run the unpacked Workbench app smoke.
 *
 * @param {string} filePath - Repository-relative path reported by GitHub.
 * @returns {boolean} Whether the path requires package smoke.
 */
function requiresPackageSmoke(filePath) {
  return Boolean(firstMatchingPattern(filePath, PACKAGE_SMOKE_REQUIRED_PATTERNS));
}

/**
 * Return true when a changed path is known not to affect packaged runtime shape.
 * Unknown paths intentionally fail closed in planPrChecks.
 *
 * @param {string} filePath - Repository-relative path reported by GitHub.
 * @returns {boolean} Whether package smoke may be skipped for the path.
 */
function isSafePackageSmokeSkip(filePath) {
  return Boolean(firstMatchingPattern(filePath, PACKAGE_SMOKE_SAFE_SKIP_PATTERNS));
}

/**
 * Build the PR validation plan from changed files and manual overrides.
 *
 * @param {string[]} changedFiles - Repository-relative changed file paths.
 * @param {{runWindowsChecks?: unknown, forcePackageSmoke?: unknown}} [options] - Manual check overrides.
 * @returns {{runWindowsChecks: boolean, reasons: string[], runPackageSmoke: boolean, packageSmokeReasons: string[]}}
 * Check decisions and human-readable reasons for GitHub Actions outputs.
 */
function planPrChecks(changedFiles, options = {}) {
  const normalizedFiles = changedFiles.map(normalizeFilePath).filter((filePath) => filePath.length > 0);
  const reasons = [];
  const packageSmokeReasons = [];

  if (normalizeBoolean(options.runWindowsChecks)) {
    reasons.push('manual override');
  }

  if (normalizeBoolean(options.forcePackageSmoke)) {
    packageSmokeReasons.push('manual override');
  }

  for (const filePath of normalizedFiles) {
    if (requiresWindowsChecks(filePath)) {
      reasons.push(`${filePath}: Windows-sensitive path`);
    }

    if (requiresPackageSmoke(filePath)) {
      packageSmokeReasons.push(`${filePath}: packaged-app smoke surface`);
    } else if (!isSafePackageSmokeSkip(filePath)) {
      packageSmokeReasons.push(`${filePath}: unknown path, package smoke fails closed`);
    }
  }

  return {
    runWindowsChecks: reasons.length > 0,
    reasons,
    runPackageSmoke: packageSmokeReasons.length > 0,
    packageSmokeReasons,
  };
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
  });
}

async function main() {
  const command = process.argv[2] || 'json';
  const input = await readStdin();
  const changedFiles = input
    .split('\n')
    .map(normalizeFilePath)
    .filter((line) => line.length > 0);
  const plan = planPrChecks(changedFiles, {
    runWindowsChecks: process.env.RUN_WINDOWS_CHECKS,
    forcePackageSmoke: process.env.FORCE_PACKAGE_SMOKE,
  });

  if (command === 'github-output') {
    console.log(`run_windows_checks=${plan.runWindowsChecks ? 'true' : 'false'}`);
    console.log(`windows_reasons_json=${JSON.stringify(plan.reasons)}`);
    console.log(`run_package_smoke=${plan.runPackageSmoke ? 'true' : 'false'}`);
    console.log(`package_smoke_reasons_json=${JSON.stringify(plan.packageSmokeReasons)}`);
    return;
  }

  console.log(JSON.stringify(plan, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  isSafePackageSmokeSkip,
  planPrChecks,
  requiresPackageSmoke,
  requiresWindowsChecks,
};
