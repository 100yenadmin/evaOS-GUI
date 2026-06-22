#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const bridgeResourceDir = path.join(projectRoot, 'resources', 'Bridge');
const bridgeSourceCacheDir = path.join(projectRoot, '.cache', 'evaos-desktop-bridge-source');
const defaultBridgeSourceRepo = 'https://github.com/electricsheephq/evaos-desktop-bridge.git';
const defaultBridgeSourceRef = 'main';
const PLACEHOLDER_SOURCE = 'diagnostic-placeholder';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'evaos-beta']);

function truthy(value) {
  return TRUE_VALUES.has(
    String(value || '')
      .trim()
      .toLowerCase()
  );
}

function shouldAllowPlaceholder() {
  return truthy(process.env.EVAOS_DESKTOP_BRIDGE_ALLOW_PLACEHOLDER);
}

function shouldRequireRealBridge() {
  return (
    truthy(process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL) ||
    truthy(process.env.EVAOS_BETA_PUBLIC_RELEASE) ||
    truthy(process.env.EVAOS_BETA_REQUIRE_SIGNING)
  );
}

function sourceCandidates() {
  if (process.env.EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES === '1') {
    return [process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_DIR].filter(Boolean);
  }
  return [
    process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_DIR,
    path.resolve(projectRoot, '..', 'evaos-desktop-bridge'),
    '/Volumes/LEXAR/repos/evaos-desktop-bridge',
  ].filter(Boolean);
}

function resolveBridgeSourceDir() {
  for (const candidate of sourceCandidates()) {
    const sourceDir = path.resolve(candidate);
    if (fs.existsSync(path.join(sourceDir, 'src', 'evaos_desktop_bridge', 'cli.py'))) {
      return sourceDir;
    }
  }
  return prepareBridgeSourceCheckout();
}

function prepareBridgeSourceCheckout() {
  const repo = process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_REPO || defaultBridgeSourceRepo;
  const ref = process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_REF || defaultBridgeSourceRef;
  const cloneRepo = repoWithToken(repo);
  console.log(`evaos-desktop-bridge source was not found locally; fetching ${sanitizeRepoForLog(repo)}#${ref}`);
  fs.rmSync(bridgeSourceCacheDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(bridgeSourceCacheDir), { recursive: true });

  try {
    runGit(['clone', '--depth', '1', '--branch', ref, cloneRepo, bridgeSourceCacheDir], projectRoot, repo);
  } catch {
    fs.rmSync(bridgeSourceCacheDir, { recursive: true, force: true });
    runGit(['clone', '--depth', '1', cloneRepo, bridgeSourceCacheDir], projectRoot, repo);
    runGit(['fetch', '--depth', '1', 'origin', ref], bridgeSourceCacheDir, repo);
    runGit(['checkout', '--detach', 'FETCH_HEAD'], bridgeSourceCacheDir, repo);
  }

  if (fs.existsSync(path.join(bridgeSourceCacheDir, 'src', 'evaos_desktop_bridge', 'cli.py'))) {
    return bridgeSourceCacheDir;
  }

  throw new Error(
    [
      'evaos-desktop-bridge source was not found.',
      'Set EVAOS_DESKTOP_BRIDGE_SOURCE_DIR to a checkout that contains src/evaos_desktop_bridge/cli.py,',
      'or set EVAOS_DESKTOP_BRIDGE_SOURCE_REPO/EVAOS_DESKTOP_BRIDGE_SOURCE_REF to a reachable bridge source.',
    ].join(' ')
  );
}

function repoWithToken(repo) {
  const token = process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  if (!token || !repo.startsWith('https://github.com/')) {
    return repo;
  }
  return repo.replace('https://github.com/', `https://x-access-token:${encodeURIComponent(token)}@github.com/`);
}

function sanitizeRepoForLog(repo) {
  return repo.replace(/https:\/\/[^/@]+:[^/@]+@github\.com\//, 'https://github.com/');
}

function sanitizeCommandText(value, repo) {
  return String(value || '')
    .replaceAll(repoWithToken(repo), sanitizeRepoForLog(repo))
    .replace(/https:\/\/x-access-token:[^/@]+@github\.com\//g, 'https://github.com/');
}

function runGit(args, cwd, repoForRedaction) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stdout = sanitizeCommandText(error.stdout, repoForRedaction).trim();
    const stderr = sanitizeCommandText(error.stderr, repoForRedaction).trim();
    if (stdout) console.error(stdout);
    if (stderr) console.error(stderr);
    error.message = sanitizeCommandText(error.message, repoForRedaction);
    throw error;
  }
}

function gitValue(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

function copyDirectory(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    filter: (sourcePath) => !sourcePath.includes(`${path.sep}__pycache__${path.sep}`),
  });
}

function copyOptionalBinary(name, targetDir) {
  const explicit = process.env[`EVAOS_${name.toUpperCase()}_BIN`];
  const candidates = [explicit, findOnPath(name)].filter(Boolean);

  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const destination = path.join(targetDir, path.basename(name));
    fs.copyFileSync(candidate, destination);
    fs.chmodSync(destination, 0o755);
    return destination;
  }
  return undefined;
}

function findOnPath(command) {
  try {
    return execFileSync('which', [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

function writeWrapper() {
  const wrapperPath = path.join(bridgeResourceDir, 'evaos-desktop-bridge');
  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh
set -eu

BRIDGE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if [ -n "\${EVAOS_DESKTOP_BRIDGE_PYTHON:-}" ] && [ -x "\${EVAOS_DESKTOP_BRIDGE_PYTHON:-}" ]; then
  PYTHON_BIN="$EVAOS_DESKTOP_BRIDGE_PYTHON"
else
  PYTHON_BIN=""
  for candidate in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
    if [ -x "$candidate" ]; then
      PYTHON_BIN="$candidate"
      break
    fi
  done
fi

if [ -z "$PYTHON_BIN" ]; then
  echo "evaos-desktop-bridge: python3 was not found. Install Python 3 or contact Electric Sheep support." >&2
  exit 127
fi

export PYTHONPATH="$BRIDGE_DIR/src\${PYTHONPATH:+:$PYTHONPATH}"
export PATH="$BRIDGE_DIR/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1
exec "$PYTHON_BIN" -m evaos_desktop_bridge.cli "$@"
`
  );
  fs.chmodSync(wrapperPath, 0o755);
}

function writePlaceholderWrapper(reason) {
  const wrapperPath = path.join(bridgeResourceDir, 'evaos-desktop-bridge');
  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh
set -eu

if [ "\${1:-}" = "--version" ] || [ "\${1:-}" = "version" ]; then
  echo "evaos-desktop-bridge diagnostic-placeholder"
  exit 0
fi

echo "evaos-desktop-bridge diagnostic placeholder: ${escapeForShellDoubleQuotes(reason)}" >&2
echo "This PR/build artifact is not valid for Mac pairing release proof. Configure EVAOS_DESKTOP_BRIDGE_SOURCE_DIR or EVAOS_DESKTOP_BRIDGE_SOURCE_TOKEN for a real release build." >&2
exit 78
`
  );
  fs.chmodSync(wrapperPath, 0o755);
}

function escapeForShellDoubleQuotes(value) {
  return String(value || 'bridge source unavailable')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

function writeManifest(manifest) {
  fs.writeFileSync(path.join(bridgeResourceDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function preparePlaceholderBridgeResource(error) {
  if (shouldRequireRealBridge() || !shouldAllowPlaceholder()) {
    throw error;
  }

  const reason = sanitizeCommandText(error?.message || 'bridge source unavailable', defaultBridgeSourceRepo);
  console.warn('::warning::Using evaOS desktop bridge diagnostic placeholder for non-release build smoke.');
  fs.rmSync(bridgeResourceDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(bridgeResourceDir, 'bin'), { recursive: true });
  writePlaceholderWrapper(reason);
  writeManifest({
    schema: 'evaos-desktop-bridge-resource/v1',
    sourcePath: PLACEHOLDER_SOURCE,
    sourceCommit: undefined,
    sourceBranch: undefined,
    placeholder: true,
    placeholderReason: reason,
    generatedAt: new Date().toISOString(),
  });
  console.log(`Prepared evaOS desktop bridge diagnostic placeholder at ${bridgeResourceDir}`);
}

function removePycache(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        removePycache(fullPath);
      }
    }
  }
}

function main() {
  let bridgeSourceDir;
  try {
    bridgeSourceDir = resolveBridgeSourceDir();
  } catch (error) {
    preparePlaceholderBridgeResource(error);
    return;
  }
  const bridgePackageSource = path.join(bridgeSourceDir, 'src', 'evaos_desktop_bridge');
  const bridgePackageTarget = path.join(bridgeResourceDir, 'src', 'evaos_desktop_bridge');
  const bridgeBinDir = path.join(bridgeResourceDir, 'bin');

  fs.rmSync(bridgeResourceDir, { recursive: true, force: true });
  fs.mkdirSync(bridgeBinDir, { recursive: true });
  copyDirectory(bridgePackageSource, bridgePackageTarget);
  removePycache(bridgeResourceDir);
  writeWrapper();
  copyOptionalBinary('peekaboo', bridgeBinDir);

  const manifest = {
    schema: 'evaos-desktop-bridge-resource/v1',
    sourcePath: bridgeSourceDir,
    sourceCommit: gitValue(bridgeSourceDir, ['rev-parse', 'HEAD']),
    sourceBranch: gitValue(bridgeSourceDir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    placeholder: false,
    generatedAt: new Date().toISOString(),
  };
  writeManifest(manifest);

  console.log(`Prepared evaOS desktop bridge resource from ${bridgeSourceDir}`);
  console.log(`Bridge resource: ${bridgeResourceDir}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveBridgeSourceDir,
};
