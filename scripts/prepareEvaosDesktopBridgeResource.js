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
const MACHO_MAGICS = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'cafebabf']);

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

function selectedBridgeSourceRef() {
  return String(process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_REF || '').trim() || defaultBridgeSourceRef;
}

function isMutableBridgeSourceRef(ref) {
  const normalized = String(ref || '')
    .trim()
    .toLowerCase();
  return !normalized || normalized === 'main' || normalized === 'master' || normalized === 'head';
}

function isFullCommitSha(ref) {
  return /^[0-9a-f]{40}$/i.test(String(ref || '').trim());
}

function shouldCloneBridgeRefAsBranch(ref) {
  return !isFullCommitSha(ref);
}

function sourceCandidates() {
  if (process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_DIR) {
    return [process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_DIR];
  }
  if (process.env.EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES === '1') {
    return [];
  }
  if (process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_REF) {
    return [];
  }
  return [path.resolve(projectRoot, '..', 'evaos-desktop-bridge'), '/Volumes/LEXAR/repos/evaos-desktop-bridge'].filter(
    Boolean
  );
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
  const ref = selectedBridgeSourceRef();
  if (shouldRequireRealBridge() && isMutableBridgeSourceRef(ref)) {
    throw new Error(
      [
        'Release builds require a pinned evaos-desktop-bridge source ref.',
        'Set EVAOS_DESKTOP_BRIDGE_SOURCE_REF to an approved tag or commit SHA, not main/master/HEAD.',
      ].join(' ')
    );
  }
  const cloneRepo = repoWithToken(repo);
  console.log(`evaos-desktop-bridge source was not found locally; fetching ${sanitizeRepoForLog(repo)}#${ref}`);
  fs.rmSync(bridgeSourceCacheDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(bridgeSourceCacheDir), { recursive: true });

  if (shouldCloneBridgeRefAsBranch(ref)) {
    try {
      runGit(['clone', '--depth', '1', '--branch', ref, cloneRepo, bridgeSourceCacheDir], projectRoot, repo);
    } catch {
      fs.rmSync(bridgeSourceCacheDir, { recursive: true, force: true });
      runGit(['clone', '--depth', '1', cloneRepo, bridgeSourceCacheDir], projectRoot, repo);
      runGit(['fetch', '--depth', '1', 'origin', ref], bridgeSourceCacheDir, repo);
      runGit(['checkout', '--detach', 'FETCH_HEAD'], bridgeSourceCacheDir, repo);
    }
  } else {
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

function isMachOExecutable(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    const header = fs.readFileSync(filePath, { encoding: null, flag: 'r' }).subarray(0, 4).toString('hex');
    return MACHO_MAGICS.has(header);
  } catch {
    return false;
  }
}

function requireMachOReleaseBinary(filePath, description) {
  if (isMachOExecutable(filePath)) return;
  throw new Error(
    `Release builds require ${description} to be a native Mach-O executable, not a shell/Python fallback: ${filePath}`
  );
}

function writeConnectorHelperWrapper(targetDir) {
  const helperPath = path.join(targetDir, 'evaos-connector-helper');
  fs.writeFileSync(
    helperPath,
    `#!/bin/sh
set -eu

HELPER_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -x "$HELPER_DIR/peekaboo" ]; then
  exec "$HELPER_DIR/peekaboo" "$@"
fi

for candidate in /opt/homebrew/bin/peekaboo /usr/local/bin/peekaboo; do
  if [ -x "$candidate" ]; then
    exec "$candidate" "$@"
  fi
done

echo "evaos-connector-helper: bundled peekaboo was not found. Rebuild evaOS Workbench with Bridge/bin/peekaboo or install the Workbench connector package." >&2
exit 127
`
  );
  fs.chmodSync(helperPath, 0o755);
  return helperPath;
}

function writePeekabooFallbackWrapper(targetDir) {
  const peekabooPath = path.join(targetDir, 'peekaboo');
  fs.writeFileSync(
    peekabooPath,
    `#!/bin/sh
set -eu

for candidate in /opt/homebrew/bin/peekaboo /usr/local/bin/peekaboo; do
  if [ -x "$candidate" ]; then
    exec "$candidate" "$@"
  fi
done

echo "peekaboo: bundled helper binary was not found. Rebuild evaOS Workbench with Bridge/bin/peekaboo or install the Workbench connector package." >&2
exit 127
`
  );
  fs.chmodSync(peekabooPath, 0o755);
  return peekabooPath;
}

function findOnPath(command) {
  try {
    return execFileSync('which', [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

function bridgeWrapperScript() {
  return `#!/bin/sh
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

unset PYTHONHOME
unset PYTHONUSERBASE
export PYTHONNOUSERSITE=1
export PYTHONPATH="$BRIDGE_DIR/src"
export PATH="$BRIDGE_DIR/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1

CACHE_ROOT="\${EVAOS_DESKTOP_BRIDGE_CACHE_DIR:-}"
if [ -z "$CACHE_ROOT" ]; then
  if [ -n "\${HOME:-}" ]; then
    CACHE_ROOT="$HOME/Library/Caches/evaos-desktop-bridge"
  else
    CACHE_ROOT="/tmp/evaos-desktop-bridge-cache"
  fi
fi
mkdir -p "$CACHE_ROOT/pycache" 2>/dev/null || true
export PYTHONPYCACHEPREFIX="$CACHE_ROOT/pycache"

exec "$PYTHON_BIN" -S -m evaos_desktop_bridge.cli "$@"
`;
}

function writeWrapper() {
  const wrapperPath = path.join(bridgeResourceDir, 'evaos-desktop-bridge');
  fs.writeFileSync(wrapperPath, bridgeWrapperScript());
  fs.chmodSync(wrapperPath, 0o755);
}

function writeBridgeExecutable() {
  const wrapperPath = path.join(bridgeResourceDir, 'evaos-desktop-bridge');
  writeWrapper();
  return wrapperPath;
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

function bridgeManifest({ sourcePath, sourceCommit, sourceBranch, placeholder, placeholderReason }) {
  const manifest = {
    schema: 'evaos-desktop-bridge-resource/v1',
    requestedSourceRef: selectedBridgeSourceRef(),
    sourcePath,
    sourceCommit,
    sourceBranch,
    placeholder,
    generatedAt: new Date().toISOString(),
  };
  if (placeholderReason !== undefined) {
    manifest.placeholderReason = placeholderReason;
  }
  return manifest;
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
  writeManifest(
    bridgeManifest({
      sourcePath: PLACEHOLDER_SOURCE,
      sourceCommit: undefined,
      sourceBranch: undefined,
      placeholder: true,
      placeholderReason: reason,
    })
  );
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
  const bridgeExecutable = writeBridgeExecutable();
  const peekabooBinary = copyOptionalBinary('peekaboo', bridgeBinDir);
  const helperPath = path.join(bridgeBinDir, 'evaos-connector-helper');
  if (peekabooBinary && shouldRequireRealBridge()) {
    requireMachOReleaseBinary(peekabooBinary, 'bundled Peekaboo helper');
    fs.copyFileSync(peekabooBinary, helperPath);
    fs.chmodSync(helperPath, 0o755);
  } else if (!peekabooBinary) {
    if (shouldRequireRealBridge()) {
      throw new Error('Release builds require EVAOS_PEEKABOO_BIN or a PATH-resolved native Mach-O Peekaboo binary.');
    }
    writePeekabooFallbackWrapper(bridgeBinDir);
    writeConnectorHelperWrapper(bridgeBinDir);
  } else {
    writeConnectorHelperWrapper(bridgeBinDir);
  }
  if (shouldRequireRealBridge()) {
    requireMachOReleaseBinary(path.join(bridgeBinDir, 'peekaboo'), 'bundled Peekaboo helper');
    requireMachOReleaseBinary(helperPath, 'bundled evaOS connector helper');
  }

  const manifest = bridgeManifest({
    sourcePath: bridgeSourceDir,
    sourceCommit: gitValue(bridgeSourceDir, ['rev-parse', 'HEAD']),
    sourceBranch: gitValue(bridgeSourceDir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    placeholder: false,
  });
  writeManifest(manifest);

  console.log(`Prepared evaOS desktop bridge resource from ${bridgeSourceDir}`);
  console.log(`Bridge resource: ${bridgeResourceDir}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  bridgeManifest,
  bridgeWrapperScript,
  isMachOExecutable,
  resolveBridgeSourceDir,
  shouldCloneBridgeRefAsBranch,
  sourceCandidates,
};
