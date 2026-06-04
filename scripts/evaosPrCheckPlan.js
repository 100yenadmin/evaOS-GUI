#!/usr/bin/env node

const WINDOWS_REQUIRED_PATTERNS = [
  /^\.github\/workflows\/(?:pr-checks|_build-reusable|build-and-release|release-distribute)\.ya?ml$/,
  /^\.github\/actions\/checkout-pr\//,
  /^bun\.lockb?$/,
  /^package-lock\.json$/,
  /^packages\/desktop\/electron-builder\.ya?ml$/,
  /^packages\/desktop\/electron\.vite\.config\.ts$/,
  /^packages\/desktop\/src\/process\//,
  /^packages\/desktop\/src\/preload\//,
  /^packages\/desktop\/src\/common\//,
  /^packages\/desktop\/src\/index\.ts$/,
  /^packages\/desktop\/src\/sentry\.ts$/,
  /^scripts\/build-with-builder\.js$/,
];

function normalizeFilePath(value) {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(text);
}

function requiresWindowsChecks(filePath) {
  return WINDOWS_REQUIRED_PATTERNS.some((pattern) => pattern.test(filePath));
}

function planPrChecks(changedFiles, options = {}) {
  const reasons = [];
  const seen = new Set();

  if (normalizeBoolean(options.runWindowsChecks)) {
    reasons.push('manual override');
  }

  for (const rawFile of changedFiles) {
    const file = normalizeFilePath(rawFile);
    if (!file || seen.has(file)) continue;
    seen.add(file);

    if (requiresWindowsChecks(file)) {
      reasons.push(file);
    }
  }

  return {
    runWindowsChecks: reasons.length > 0,
    reasons,
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
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const plan = planPrChecks(changedFiles, {
    runWindowsChecks: process.env.RUN_WINDOWS_CHECKS,
  });

  if (command === 'github-output') {
    console.log(`run_windows_checks=${plan.runWindowsChecks ? 'true' : 'false'}`);
    console.log(`windows_reasons_json=${JSON.stringify(plan.reasons)}`);
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
  planPrChecks,
  requiresWindowsChecks,
};
