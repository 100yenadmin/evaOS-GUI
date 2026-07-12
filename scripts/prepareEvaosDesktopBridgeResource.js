#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const bridgeResourceDir = path.join(projectRoot, 'resources', 'Bridge');
const bridgeSourceCacheDir = path.join(projectRoot, '.cache', 'evaos-desktop-bridge-source');
const defaultBridgeSourceRepo = 'https://github.com/electricsheephq/evaos-desktop-bridge.git';
const defaultBridgeSourceRef = 'main';
const PLACEHOLDER_SOURCE = 'diagnostic-placeholder';
const PEEKABOO_LICENSE_RELATIVE_PATH = 'licenses/Peekaboo-LICENSE.txt';
const DEFAULT_REQUIRED_PEEKABOO_VERSION = '3.8.0';
const PAYLOAD_MANIFEST_FILENAME = 'payload-manifest.json';
const RESOURCE_MANIFEST_FILENAME = 'manifest.json';

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

function resolvePinnedBridgeConfiguration(env = process.env, strictRelease = shouldRequireRealBridge()) {
  const payloadDir = String(env.EVAOS_DESKTOP_BRIDGE_PAYLOAD_DIR || '').trim();
  const expectedPayloadSha256 = String(env.EVAOS_DESKTOP_BRIDGE_PAYLOAD_SHA256 || '')
    .trim()
    .toLowerCase();
  const expectedManifestSha256 = String(env.EVAOS_DESKTOP_BRIDGE_MANIFEST_SHA256 || '')
    .trim()
    .toLowerCase();
  if (!payloadDir) {
    if (strictRelease) {
      throw new Error(
        'Release builds require a pinned self-contained Desktop Bridge payload; the legacy host-Python source wrapper is not releaseable.'
      );
    }
    return undefined;
  }
  if (!expectedPayloadSha256) {
    throw new Error('Pinned Desktop Bridge payload preparation requires EVAOS_DESKTOP_BRIDGE_PAYLOAD_SHA256.');
  }
  if (!expectedManifestSha256) {
    throw new Error('Pinned Desktop Bridge payload preparation requires EVAOS_DESKTOP_BRIDGE_MANIFEST_SHA256.');
  }
  return { payloadDir, expectedPayloadSha256, expectedManifestSha256 };
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
    return isMachOFile(filePath);
  } catch {
    return false;
  }
}

function isMachOFile(filePath) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  try {
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

function bridgeManifest({ sourcePath, sourceCommit, sourceBranch, placeholder, placeholderReason, bundledTools }) {
  const manifest = {
    schema: 'evaos-desktop-bridge-resource/v1',
    requestedSourceRef: selectedBridgeSourceRef(),
    sourcePath,
    sourceCommit,
    sourceBranch,
    placeholder,
    generatedAt: new Date().toISOString(),
  };
  if (bundledTools !== undefined) {
    manifest.bundledTools = bundledTools;
  }
  if (placeholderReason !== undefined) {
    manifest.placeholderReason = placeholderReason;
  }
  return manifest;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function payloadRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function listPayloadFiles(payloadDir, relativeDir = '') {
  const currentDir = path.join(payloadDir, relativeDir);
  const files = [];
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    const absolutePath = path.join(payloadDir, relativePath);
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Desktop Bridge payload must not contain symbolic links: ${payloadRelativePath(relativePath)}`);
    }
    if (stat.isDirectory()) {
      files.push(...listPayloadFiles(payloadDir, relativePath));
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`Desktop Bridge payload contains a non-regular file: ${payloadRelativePath(relativePath)}`);
    }
    if (![PAYLOAD_MANIFEST_FILENAME, RESOURCE_MANIFEST_FILENAME].includes(payloadRelativePath(relativePath))) {
      files.push({ absolutePath, relativePath: payloadRelativePath(relativePath), stat });
    }
  }
  return files;
}

function computePayloadTreeDigest(payloadDir) {
  const files = listPayloadFiles(payloadDir).toSorted((left, right) =>
    Buffer.compare(Buffer.from(left.relativePath, 'utf8'), Buffer.from(right.relativePath, 'utf8'))
  );
  const records = files
    .map(({ absolutePath, relativePath, stat }) => {
      const normalizedMode = stat.mode & 0o111 ? '0755' : '0644';
      return `${relativePath}\0${normalizedMode}\0${sha256File(absolutePath)}\n`;
    })
    .join('');
  return {
    algorithm: 'sha256-tree-v1',
    sha256: crypto.createHash('sha256').update(records).digest('hex'),
    fileCount: files.length,
  };
}

function requireSha256(value, description) {
  const digest = String(value || '')
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`Desktop Bridge payload requires a valid ${description} SHA-256 digest.`);
  }
  return digest;
}

function isExactVersionIdentity(value) {
  const version = String(value || '').trim();
  return (
    Boolean(version) &&
    !/[<>=~*^/\\]/.test(version) &&
    !/^(latest|main|master|head|dev|development|local)$/i.test(version)
  );
}

function resolvePayloadFile(payloadDir, relativePath, description) {
  const normalized = payloadRelativePath(String(relativePath || '').trim());
  if (!normalized || path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Desktop Bridge payload has an invalid ${description} path.`);
  }
  const payloadRoot = path.resolve(payloadDir);
  const absolutePath = path.resolve(payloadRoot, normalized);
  if (!absolutePath.startsWith(`${payloadRoot}${path.sep}`)) {
    throw new Error(`Desktop Bridge payload ${description} escapes the payload root.`);
  }
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Desktop Bridge payload ${description} must be a regular file: ${normalized}`);
  }
  return { absolutePath, relativePath: normalized };
}

function isArm64MachOFile(filePath) {
  if (!isMachOFile(filePath)) return false;
  const header = fs.readFileSync(filePath).subarray(0, 12);
  if (header.length < 12) return false;
  const magic = header.subarray(0, 4).toString('hex');
  if (magic === 'cffaedfe') return header.readUInt32LE(4) === 0x0100000c;
  if (magic === 'feedfacf') return header.readUInt32BE(4) === 0x0100000c;
  return false;
}

function isArm64MachOExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return isArm64MachOFile(filePath);
  } catch {
    return false;
  }
}

function verifyPayloadFile(payloadDir, entry, expectedPath, description, options = {}) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Desktop Bridge payload manifest is missing ${description}.`);
  }
  const resolved = resolvePayloadFile(payloadDir, entry.path, description);
  if (expectedPath && resolved.relativePath !== expectedPath) {
    throw new Error(`Desktop Bridge payload ${description} must use ${expectedPath}.`);
  }
  const expectedSha256 = requireSha256(entry.sha256, `${description} file`);
  const actualSha256 = sha256File(resolved.absolutePath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Desktop Bridge payload ${description} digest does not match its manifest.`);
  }
  if (options.arm64MachO && !isArm64MachOExecutable(resolved.absolutePath)) {
    throw new Error(`Desktop Bridge payload ${description} must be an arm64 Mach-O executable.`);
  }
  return { ...resolved, sha256: actualSha256 };
}

function validatePinnedBridgePayload(payloadDir, expectedPayloadSha256, expectedManifestSha256) {
  if (fs.existsSync(path.join(payloadDir, RESOURCE_MANIFEST_FILENAME))) {
    throw new Error(`Desktop Bridge producer payload must not contain reserved ${RESOURCE_MANIFEST_FILENAME}.`);
  }
  const manifestPath = path.join(payloadDir, PAYLOAD_MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Desktop Bridge payload is missing ${PAYLOAD_MANIFEST_FILENAME}.`);
  }
  const pinnedManifestSha256 = requireSha256(expectedManifestSha256, 'out-of-band manifest');
  if (sha256File(manifestPath) !== pinnedManifestSha256) {
    throw new Error('Desktop Bridge payload manifest digest does not match the approved release pin.');
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Desktop Bridge payload manifest is unreadable: ${error.message}`);
  }

  if (manifest.schema_version !== 1) throw new Error('Desktop Bridge payload schema_version must be 1.');
  if (
    manifest.artifact?.id !== 'evaos-desktop-bridge-macos-arm64' ||
    manifest.artifact?.format !== 'onedir' ||
    manifest.artifact?.root_executable !== 'evaos-desktop-bridge'
  ) {
    throw new Error('Desktop Bridge payload artifact identity is not the approved macOS arm64 one-directory shape.');
  }
  if (manifest.target?.platform !== 'macos' || manifest.target?.architecture !== 'arm64') {
    throw new Error('Desktop Bridge payload target must be macos/arm64.');
  }
  if (
    manifest.source?.repository !== 'electricsheephq/evaos-desktop-bridge' ||
    !/^[0-9a-f]{40}$/i.test(String(manifest.source?.commit || '')) ||
    !String(manifest.source?.version || '').trim()
  ) {
    throw new Error('Desktop Bridge payload source identity is incomplete or mutable.');
  }
  if (
    !isExactVersionIdentity(manifest.toolchain?.python) ||
    !String(manifest.toolchain?.freezer?.name || '').trim() ||
    !isExactVersionIdentity(manifest.toolchain?.freezer?.version)
  ) {
    throw new Error('Desktop Bridge payload toolchain identity is incomplete.');
  }
  const dependencies = manifest.toolchain?.dependencies;
  if (
    !Array.isArray(dependencies) ||
    dependencies.length === 0 ||
    dependencies.some(
      (dependency) =>
        !String(dependency?.name || '').trim() ||
        !isExactVersionIdentity(dependency?.version) ||
        !/^[0-9a-f]{64}$/i.test(String(dependency?.sha256 || ''))
    )
  ) {
    throw new Error('Desktop Bridge payload toolchain dependency lock is incomplete or mutable.');
  }

  const expectedSha256 = requireSha256(expectedPayloadSha256, 'out-of-band payload');
  const recordedSha256 = requireSha256(manifest.payload?.sha256, 'manifest payload');
  if (manifest.payload?.algorithm !== 'sha256-tree-v1' || recordedSha256 !== expectedSha256) {
    throw new Error('Desktop Bridge payload identity does not match the approved release pin.');
  }
  const actualPayload = computePayloadTreeDigest(payloadDir);
  if (actualPayload.sha256 !== expectedSha256 || actualPayload.fileCount !== manifest.payload?.file_count) {
    throw new Error('Desktop Bridge payload tree does not match its immutable manifest identity.');
  }

  verifyPayloadFile(payloadDir, manifest.files?.root_executable, 'evaos-desktop-bridge', 'root executable', {
    arm64MachO: true,
  });
  const peekaboo = manifest.files?.peekaboo;
  const requiredPeekabooVersion =
    String(process.env.EVAOS_REQUIRED_PEEKABOO_VERSION || '').trim() || DEFAULT_REQUIRED_PEEKABOO_VERSION;
  if (
    peekaboo?.version !== requiredPeekabooVersion ||
    peekaboo?.license !== 'MIT' ||
    peekaboo?.license_path !== PEEKABOO_LICENSE_RELATIVE_PATH ||
    requireSha256(peekaboo?.license_sha256, 'Peekaboo license') !==
      requireSha256(
        manifest.files?.licenses?.find((license) => license?.path === PEEKABOO_LICENSE_RELATIVE_PATH)?.sha256,
        'recorded Peekaboo license'
      )
  ) {
    throw new Error(
      'Desktop Bridge payload Peekaboo version or license identity does not match the approved contract.'
    );
  }
  verifyPayloadFile(payloadDir, peekaboo, 'bin/peekaboo', 'Peekaboo executable', {
    arm64MachO: true,
  });
  verifyPayloadFile(payloadDir, manifest.files?.connector_helper, 'bin/evaos-connector-helper', 'connector helper', {
    arm64MachO: true,
  });
  if (!Array.isArray(manifest.files?.licenses) || manifest.files.licenses.length === 0) {
    throw new Error('Desktop Bridge payload must include at least one recorded license.');
  }
  for (const [index, license] of manifest.files.licenses.entries()) {
    if (
      !String(license?.component || '').trim() ||
      !isExactVersionIdentity(license?.version) ||
      !String(license?.license || '').trim() ||
      !String(license?.name || '').trim() ||
      !String(license?.path || '').startsWith('licenses/')
    ) {
      throw new Error(`Desktop Bridge payload license ${index + 1} has invalid identity.`);
    }
    verifyPayloadFile(payloadDir, license, undefined, `license ${index + 1}`);
  }
  const requiredLicenseComponents = ['CPython', 'PyInstaller', 'PyObjC', 'evaos-desktop-bridge', 'Peekaboo'];
  const licenseComponents = Array.isArray(manifest.toolchain?.license_components)
    ? manifest.toolchain.license_components
    : [];
  for (const component of requiredLicenseComponents) {
    const componentIdentity = licenseComponents.find((entry) => entry?.component === component);
    const licenseFile = manifest.files.licenses.find((entry) => entry?.component === component);
    if (
      !componentIdentity ||
      !licenseFile ||
      !isExactVersionIdentity(componentIdentity.version) ||
      !String(componentIdentity.license || '').trim() ||
      !String(componentIdentity.path || '').startsWith('licenses/') ||
      componentIdentity.version !== licenseFile.version ||
      componentIdentity.license !== licenseFile.license ||
      componentIdentity.path !== licenseFile.path
    ) {
      throw new Error(`Desktop Bridge payload license coverage is incomplete for ${component}.`);
    }
  }
  const machOFiles = listPayloadFiles(payloadDir)
    .filter(({ absolutePath }) => isMachOFile(absolutePath))
    .map(({ absolutePath, relativePath }) => {
      if (!isArm64MachOFile(absolutePath)) {
        throw new Error(`Desktop Bridge payload contains a non-arm64 Mach-O file: ${relativePath}`);
      }
      return relativePath;
    })
    .toSorted((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')));
  const signingInputs = Array.isArray(manifest.signing?.inputs) ? [...manifest.signing.inputs] : [];
  signingInputs.sort((left, right) =>
    Buffer.compare(Buffer.from(String(left), 'utf8'), Buffer.from(String(right), 'utf8'))
  );
  if (
    manifest.signing?.state !== 'unsigned' ||
    signingInputs.length !== machOFiles.length ||
    signingInputs.some((input, index) => input !== machOFiles[index])
  ) {
    throw new Error('Desktop Bridge payload signing inputs do not match the complete Mach-O closure.');
  }
  return { manifest, payload: actualPayload };
}

function preparePinnedBridgePayload(payloadDir, resourceDir, expectedPayloadSha256, expectedManifestSha256) {
  const sourceDir = path.resolve(payloadDir);
  const targetDir = path.resolve(resourceDir);
  const validated = validatePinnedBridgePayload(sourceDir, expectedPayloadSha256, expectedManifestSha256);
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true, preserveTimestamps: true });
  const copiedPayload = computePayloadTreeDigest(targetDir);
  if (copiedPayload.sha256 !== validated.payload.sha256 || copiedPayload.fileCount !== validated.payload.fileCount) {
    throw new Error('Copied Desktop Bridge payload does not match its verified source identity.');
  }
  const resourceManifest = {
    schema: 'evaos-desktop-bridge-resource/v2',
    placeholder: false,
    producerManifest: PAYLOAD_MANIFEST_FILENAME,
    producerManifestSha256: requireSha256(expectedManifestSha256, 'out-of-band manifest'),
    sourceCommit: validated.manifest.source.commit,
    sourceVersion: validated.manifest.source.version,
    bundledTools: {
      peekaboo: {
        version: validated.manifest.files.peekaboo.version,
        sourceSha256: validated.manifest.files.peekaboo.sha256,
        license: validated.manifest.files.peekaboo.license,
        licensePath: validated.manifest.files.peekaboo.license_path,
        licenseSha256: validated.manifest.files.peekaboo.license_sha256,
      },
    },
    payload: {
      algorithm: copiedPayload.algorithm,
      sha256: copiedPayload.sha256,
      fileCount: copiedPayload.fileCount,
      target: validated.manifest.target,
      rootSha256: validated.manifest.files.root_executable.sha256,
    },
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(targetDir, RESOURCE_MANIFEST_FILENAME), `${JSON.stringify(resourceManifest, null, 2)}\n`);
  return resourceManifest;
}

function peekabooIdentity(filePath, execute = execFileSync) {
  const output = execute(filePath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const match = output.match(/\bPeekaboo\s+([0-9]+\.[0-9]+\.[0-9]+)\b/i);
  if (!match) {
    throw new Error('Bundled Peekaboo did not report a semantic version.');
  }
  const version = match[1];
  const requiredVersion = String(process.env.EVAOS_REQUIRED_PEEKABOO_VERSION || '').trim();
  if (requiredVersion && version !== requiredVersion) {
    throw new Error(`Bundled Peekaboo version ${version} does not match required version ${requiredVersion}.`);
  }
  const sourceSha256 = sha256File(filePath);
  const requiredSourceSha256 = String(process.env.EVAOS_REQUIRED_PEEKABOO_SOURCE_SHA256 || '')
    .trim()
    .toLowerCase();
  if (requiredSourceSha256 && sourceSha256 !== requiredSourceSha256) {
    throw new Error(`Bundled Peekaboo source digest ${sourceSha256} does not match required source digest.`);
  }
  return {
    version,
    sourceSha256,
  };
}

function installPeekabooLicense(sourcePath = process.env.EVAOS_PEEKABOO_LICENSE, resourceDir = bridgeResourceDir) {
  const source = String(sourcePath || '').trim();
  if (!source) {
    if (String(process.env.EVAOS_REQUIRED_PEEKABOO_VERSION || '').trim()) {
      throw new Error('Pinned Peekaboo packaging requires EVAOS_PEEKABOO_LICENSE.');
    }
    return undefined;
  }
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error('Configured Peekaboo license file does not exist.');
  }
  const contents = fs.readFileSync(source, 'utf8');
  if (!contents.startsWith('MIT License') || !contents.includes('Permission is hereby granted')) {
    throw new Error('Configured Peekaboo license file does not contain the expected MIT notice.');
  }
  const target = path.join(resourceDir, ...PEEKABOO_LICENSE_RELATIVE_PATH.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return {
    license: 'MIT',
    licensePath: PEEKABOO_LICENSE_RELATIVE_PATH,
    licenseSha256: sha256File(target),
  };
}

function peekabooBundleMetadata(binaryPath, resourceDir = bridgeResourceDir) {
  if (!binaryPath) return undefined;
  const peekaboo = peekabooIdentity(binaryPath);
  const peekabooLicense = installPeekabooLicense(undefined, resourceDir);
  if (peekabooLicense) Object.assign(peekaboo, peekabooLicense);
  return { peekaboo };
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
  const payloadConfiguration = resolvePinnedBridgeConfiguration();
  if (payloadConfiguration) {
    preparePinnedBridgePayload(
      payloadConfiguration.payloadDir,
      bridgeResourceDir,
      payloadConfiguration.expectedPayloadSha256,
      payloadConfiguration.expectedManifestSha256
    );
    console.log(`Prepared pinned evaOS Desktop Bridge payload at ${bridgeResourceDir}`);
    return;
  }

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
  const bundledTools = peekabooBundleMetadata(peekabooBinary);

  const manifest = bridgeManifest({
    sourcePath: bridgeSourceDir,
    sourceCommit: gitValue(bridgeSourceDir, ['rev-parse', 'HEAD']),
    sourceBranch: gitValue(bridgeSourceDir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    placeholder: false,
    bundledTools,
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
  computePayloadTreeDigest,
  installPeekabooLicense,
  isMachOExecutable,
  peekabooBundleMetadata,
  peekabooIdentity,
  preparePinnedBridgePayload,
  resolvePinnedBridgeConfiguration,
  resolveBridgeSourceDir,
  shouldCloneBridgeRefAsBranch,
  sourceCandidates,
};
