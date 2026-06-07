#!/usr/bin/env node

// evaOS finish-line PRs are macOS-first until the controlled 1.0 release.
// Windows/Linux compatibility hardening stays on manual, release, or scheduled
// workflows so routine parity work does not wait on non-target platforms.
const WINDOWS_REQUIRED_PATTERNS = [];

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

  if (normalizeBoolean(options.runWindowsChecks)) {
    reasons.push('manual override');
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
