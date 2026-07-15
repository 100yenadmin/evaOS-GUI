#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  copyCorePythonSource,
  coreSourceIdentity,
  verifyGeneratedCoreSource,
} = require('../packages/mac-connector-core/scripts/coreManifest');

const projectRoot = path.resolve(__dirname, '..');
const bridgeResourceDir = process.env.EVAOS_DESKTOP_BRIDGE_RESOURCE_DIR
  ? path.resolve(process.env.EVAOS_DESKTOP_BRIDGE_RESOURCE_DIR)
  : path.join(projectRoot, 'resources', 'Bridge');
const vendoredBridgeSourceDir = path.join(projectRoot, 'packages', 'mac-connector-core');
const vendoredBridgeProvenancePath = path.join(vendoredBridgeSourceDir, 'contracts', 'core-source-files.v1.json');
const bridgeWrapperSourcePath = path.join(vendoredBridgeSourceDir, 'native', 'evaos-desktop-bridge.sh');
const PLACEHOLDER_SOURCE = 'diagnostic-placeholder';
const PEEKABOO_LICENSE_RELATIVE_PATH = 'licenses/Peekaboo-LICENSE.txt';
const PYTHON_LICENSE_RELATIVE_PATH = 'licenses/CPython-LICENSE.txt';
const PYTHON_RUNTIME_INVENTORY_RELATIVE_PATH = 'python-runtime-inventory.json';
const PYTHON_RUNTIME_INVENTORY_SCHEMA = 'evaos-python-runtime-inventory/v1';
const BRIDGE_WRAPPER_METADATA_SCHEMA = 'evaos-workbench-bridge-wrapper/v1';
const ED25519_VERIFIER_METADATA_SCHEMA = 'evaos-workbench-ed25519-verifier/v1';
const ED25519_VERIFIER_NAME = 'evaos-ed25519-verify';
const ED25519_VERIFIER_SOURCE = path.join(vendoredBridgeSourceDir, 'native', 'EvaOSEd25519Verify.swift');
const ED25519_VERIFIER_MAIN_SOURCE = path.join(vendoredBridgeSourceDir, 'native', 'main.swift');

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'evaos-beta']);
const MACHO_MAGICS = new Set([
  'feedface',
  'feedfacf',
  'cefaedfe',
  'cffaedfe',
  'cafebabe',
  'bebafeca',
  'cafebabf',
  'bfbafeca',
]);

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

function selectedBridgeSourceRef(sourceCommit) {
  return String(process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_REF || sourceCommit || '').trim();
}

function isFullCommitSha(ref) {
  return /^[0-9a-f]{40}$/i.test(String(ref || '').trim());
}

function sourceCandidates() {
  if (process.env.EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES === '1') {
    return [];
  }
  return [vendoredBridgeSourceDir];
}

function resolveBridgeSourceDir() {
  for (const candidate of sourceCandidates()) {
    const sourceDir = path.resolve(candidate);
    if (fs.existsSync(path.join(sourceDir, 'python', 'evaos_desktop_bridge', 'host', 'cli.py'))) {
      return sourceDir;
    }
  }
  throw new Error(
    [
      'The evaOS-GUI-owned Workbench bridge source is missing.',
      `Expected python/evaos_desktop_bridge/host/cli.py under ${vendoredBridgeSourceDir}.`,
      'Release builds do not fetch the deprecated external bridge repository.',
    ].join(' ')
  );
}

function gitValue(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

function assertVendoredBridgeSourceMatchesHead(runGit = execFileSync) {
  const sourcePath = path.relative(projectRoot, vendoredBridgeSourceDir).split(path.sep).join('/');
  let status;
  try {
    status = runGit(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--', sourcePath],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
  } catch (error) {
    throw new Error(`Unable to verify the vendored Workbench bridge against the evaOS-GUI HEAD: ${error.message}`);
  }
  const releaseRelevantStatus = String(status || '')
    .split('\0')
    .filter(Boolean)
    .filter((record) => {
      if (!record.startsWith('!! ')) return true;
      const ignoredPath = record.slice(3).replace(/\\/g, '/');
      return !ignoredPath.split('/').includes('__pycache__');
    });
  if (releaseRelevantStatus.length > 0) {
    throw new Error('Release builds require the canonical connector-core source and manifest to match HEAD.');
  }
  return true;
}

function copyDirectory(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (sourcePath) => !path.relative(source, sourcePath).split(path.sep).includes('__pycache__'),
  });
}

function directorySha256(sourceDir) {
  const source = path.resolve(sourceDir);
  const entries = [];
  const pending = [source];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '__pycache__') continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        entries.push(entryPath);
      } else {
        throw new Error(`Vendored Workbench bridge contains an unsupported filesystem entry: ${entryPath}`);
      }
    }
  }
  const hash = crypto.createHash('sha256');
  for (const entryPath of entries.sort((left, right) =>
    Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
  )) {
    const relativePath = path.relative(source, entryPath).split(path.sep).join('/');
    hash.update(relativePath);
    hash.update('\0');
    hash.update(fs.readFileSync(entryPath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function verifyWorkbenchBridgeIdentity(bridgePackageDir) {
  const packageDir = path.resolve(bridgePackageDir);
  const adapterPath = path.join(packageDir, 'adapters', 'customer_mac.py');
  const adapter = fs.readFileSync(adapterPath, 'utf8');
  const requiredIdentity = [
    'WORKBENCH_CANONICAL_APP_PATH = Path("/Applications/evaOS Workbench.app")',
    'WORKBENCH_PROCESS_NAME = "evaOS Workbench"',
    '"com.evaos.workbench",',
  ];
  for (const requiredText of requiredIdentity) {
    if (adapter.split(requiredText).length !== 2) {
      throw new Error(`Vendored Workbench bridge identity is missing or ambiguous: ${requiredText}`);
    }
  }
  if (adapter.includes('WORKBENCH_CANONICAL_APP_PATH = Path("/Applications/evaOS.app")')) {
    throw new Error('Vendored Workbench bridge still targets the legacy /Applications/evaOS.app bundle.');
  }
  return { sourceSha256: directorySha256(packageDir) };
}

function verifyWorkbenchBridgeSourceRoot(sourceRoot) {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const rootMetadata = fs.lstatSync(resolvedSourceRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error('Packaged Workbench bridge src root must be a real directory.');
  }
  const entries = fs.readdirSync(resolvedSourceRoot, { withFileTypes: true });
  if (
    entries.length !== 1 ||
    entries[0].name !== 'evaos_desktop_bridge' ||
    !entries[0].isDirectory() ||
    entries[0].isSymbolicLink()
  ) {
    throw new Error('Packaged Workbench bridge src root contains unexpected importable entries.');
  }
  return verifyWorkbenchBridgeIdentity(path.join(resolvedSourceRoot, 'evaos_desktop_bridge'));
}

function vendoredBridgeSourceMetadata(sourceDir = vendoredBridgeSourceDir) {
  const resolvedSourceDir = path.resolve(sourceDir);
  if (resolvedSourceDir !== path.resolve(vendoredBridgeSourceDir)) {
    throw new Error('Workbench builds require the evaOS-GUI-owned vendored bridge source.');
  }

  const provenance = JSON.parse(fs.readFileSync(vendoredBridgeProvenancePath, 'utf8'));
  const identity = coreSourceIdentity(resolvedSourceDir);
  if (
    provenance.schema !== 'evaos-mac-connector-core-source/v1' ||
    provenance.owner !== '100yenadmin/evaOS-GUI' ||
    provenance.sourcePath !== 'packages/mac-connector-core' ||
    provenance.status !== 'canonical' ||
    !isFullCommitSha(provenance.provenance?.importedCommit)
  ) {
    throw new Error('Connector-core source manifest is missing required ownership provenance.');
  }

  return {
    schema: provenance.schema,
    owner: provenance.owner,
    sourcePath: provenance.sourcePath,
    status: provenance.status,
    importedFrom: provenance.provenance.importedFrom,
    importedCommit: provenance.provenance.importedCommit,
    dependencyStatus: provenance.provenance.dependencyStatus,
    ...verifyWorkbenchBridgeIdentity(path.join(resolvedSourceDir, 'python', 'evaos_desktop_bridge')),
    coreSourceSha256: identity.coreSourceSha256,
    sourceManifestSha256: identity.sourceManifestSha256,
  };
}

function pythonRuntimeInventoryEntries(runtimeDir) {
  const resolvedRuntimeDir = path.resolve(runtimeDir);
  const runtimeMetadata = fs.lstatSync(resolvedRuntimeDir);
  const runtimeMode = runtimeMetadata.mode & 0o777;
  if (!runtimeMetadata.isDirectory() || (runtimeMode & 0o500) !== 0o500) {
    throw new Error('Bundled Python runtime directory must be owner-readable and owner-executable: .');
  }
  const entries = [];
  const pending = [resolvedRuntimeDir];

  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const relativePath = path.relative(resolvedRuntimeDir, entryPath).split(path.sep).join('/');
      if (!relativePath || relativePath.startsWith('../') || path.posix.isAbsolute(relativePath)) {
        throw new Error(`Bundled Python runtime inventory contains an unsafe path: ${entryPath}`);
      }

      if (entry.isDirectory()) {
        const metadata = fs.lstatSync(entryPath);
        const mode = metadata.mode & 0o777;
        if ((mode & 0o500) !== 0o500) {
          throw new Error(
            `Bundled Python runtime directory must be owner-readable and owner-executable: ${relativePath}`
          );
        }
        entries.push({
          path: relativePath,
          type: 'directory',
          mode,
        });
        pending.push(entryPath);
        continue;
      }

      const metadata = fs.lstatSync(entryPath);
      if (metadata.isSymbolicLink()) {
        const target = fs.readlinkSync(entryPath);
        const resolvedTarget = path.resolve(path.dirname(entryPath), target);
        if (
          path.isAbsolute(target) ||
          (resolvedTarget !== resolvedRuntimeDir && !resolvedTarget.startsWith(`${resolvedRuntimeDir}${path.sep}`))
        ) {
          throw new Error(`Bundled Python runtime inventory contains an unsafe symlink: ${relativePath} -> ${target}`);
        }
        entries.push({ path: relativePath, type: 'symlink', mode: 0o777, target });
      } else if (metadata.isFile()) {
        const contents = fs.readFileSync(entryPath);
        const inventoryEntry = {
          path: relativePath,
          type: 'file',
          mode: metadata.mode & 0o777,
          size: metadata.size,
          sha256: crypto.createHash('sha256').update(contents).digest('hex'),
        };
        if (MACHO_MAGICS.has(contents.subarray(0, 4).toString('hex'))) {
          // Developer ID signing mutates Mach-O signature bytes after afterPack.
          // The pre-sign verifier still binds the exact digest; distribution
          // verification binds the same path/type/mode and signed architecture.
          inventoryEntry.signedMachO = true;
        }
        entries.push(inventoryEntry);
      } else {
        throw new Error(`Bundled Python runtime inventory contains an unsupported entry: ${relativePath}`);
      }
    }
  }

  return entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

function writePythonRuntimeInventory(resourceDir = bridgeResourceDir) {
  const runtimeDir = path.join(resourceDir, 'python');
  if (!fs.existsSync(runtimeDir)) {
    throw new Error(`Bundled Python runtime inventory source is missing: ${runtimeDir}`);
  }
  const inventory = {
    schema: PYTHON_RUNTIME_INVENTORY_SCHEMA,
    entries: pythonRuntimeInventoryEntries(runtimeDir),
  };
  const inventoryPath = path.join(resourceDir, PYTHON_RUNTIME_INVENTORY_RELATIVE_PATH);
  const inventoryBytes = `${JSON.stringify(inventory, null, 2)}\n`;
  fs.writeFileSync(inventoryPath, inventoryBytes);
  return {
    inventoryPath: PYTHON_RUNTIME_INVENTORY_RELATIVE_PATH,
    inventorySha256: crypto.createHash('sha256').update(inventoryBytes).digest('hex'),
    inventoryEntryCount: inventory.entries.length,
  };
}

function verifyPythonRuntimeInventory(resourceDir, metadata) {
  if (
    metadata?.inventoryPath !== PYTHON_RUNTIME_INVENTORY_RELATIVE_PATH ||
    !/^[0-9a-f]{64}$/i.test(String(metadata?.inventorySha256 || '')) ||
    !Number.isSafeInteger(metadata?.inventoryEntryCount) ||
    metadata.inventoryEntryCount < 1
  ) {
    throw new Error('Bundled Python runtime inventory metadata is missing or invalid.');
  }

  const inventoryPath = path.join(resourceDir, PYTHON_RUNTIME_INVENTORY_RELATIVE_PATH);
  if (!fs.existsSync(inventoryPath)) {
    throw new Error(`Bundled Python runtime inventory is missing: ${inventoryPath}`);
  }
  const inventoryBytes = fs.readFileSync(inventoryPath);
  if (crypto.createHash('sha256').update(inventoryBytes).digest('hex') !== metadata.inventorySha256) {
    throw new Error('Bundled Python runtime inventory digest mismatch.');
  }

  let inventory;
  try {
    inventory = JSON.parse(inventoryBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Bundled Python runtime inventory is not valid JSON: ${error.message}`);
  }
  if (
    inventory?.schema !== PYTHON_RUNTIME_INVENTORY_SCHEMA ||
    !Array.isArray(inventory.entries) ||
    inventory.entries.length !== metadata.inventoryEntryCount
  ) {
    throw new Error('Bundled Python runtime inventory metadata mismatch.');
  }

  const actualEntries = pythonRuntimeInventoryEntries(path.join(resourceDir, 'python'));
  if (JSON.stringify(inventory.entries) !== JSON.stringify(actualEntries)) {
    throw new Error('Bundled Python runtime inventory content mismatch.');
  }
  return true;
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

function ed25519VerifierBuildArgs(sourcePath, outputPath, architecture) {
  const targetArchitecture = architecture === 'x64' ? 'x86_64' : architecture;
  if (!['arm64', 'x86_64'].includes(targetArchitecture)) {
    throw new Error(`Unsupported evaOS Ed25519 verifier architecture: ${architecture}`);
  }
  return [
    'swiftc',
    '-O',
    '-whole-module-optimization',
    '-target',
    `${targetArchitecture}-apple-macos15.0`,
    '-o',
    outputPath,
    ...(Array.isArray(sourcePath) ? sourcePath : [sourcePath]),
  ];
}

function buildEd25519Verifier({
  sourcePath = ED25519_VERIFIER_SOURCE,
  targetDir = path.join(bridgeResourceDir, 'bin'),
  architecture = process.env.EVAOS_REQUIRED_PYTHON_RUNTIME_ARCH || process.arch,
  runCommand = execFileSync,
} = {}) {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error('The evaOS Ed25519 verifier Swift source is missing.');
  }
  if (process.platform !== 'darwin') {
    if (shouldRequireRealBridge()) {
      throw new Error('Release builds require macOS to compile the bundled Ed25519 verifier.');
    }
    return undefined;
  }
  fs.mkdirSync(targetDir, { recursive: true });
  const outputPath = path.join(targetDir, ED25519_VERIFIER_NAME);
  const sourcePaths =
    path.resolve(sourcePath) === path.resolve(ED25519_VERIFIER_SOURCE)
      ? [sourcePath, ED25519_VERIFIER_MAIN_SOURCE]
      : [sourcePath];
  for (const verifierSource of sourcePaths) {
    if (!fs.existsSync(verifierSource) || !fs.statSync(verifierSource).isFile()) {
      throw new Error('The evaOS Ed25519 verifier Swift source is missing.');
    }
  }
  const args = ed25519VerifierBuildArgs(sourcePaths, outputPath, architecture);
  runCommand('xcrun', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  fs.chmodSync(outputPath, 0o755);
  requireMachOReleaseBinary(outputPath, 'bundled Ed25519 verifier');
  const expectedArch = architecture === 'x64' ? 'x86_64' : architecture;
  const actualArch = String(
    runCommand('lipo', ['-archs', outputPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  ).trim();
  if (actualArch !== expectedArch) {
    throw new Error(`Bundled Ed25519 verifier architecture ${actualArch} does not match ${expectedArch}.`);
  }
  return {
    schema: ED25519_VERIFIER_METADATA_SCHEMA,
    path: `bin/${ED25519_VERIFIER_NAME}`,
    architecture,
    minimumMacOS: '15.0',
    sourceSha256: sha256File(sourcePath),
  };
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
  return fs.readFileSync(bridgeWrapperSourcePath, 'utf8');
}

function installPythonRuntime(
  sourcePath = process.env.EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR,
  resourceDir = bridgeResourceDir
) {
  if (!sourcePath) {
    if (shouldRequireRealBridge()) {
      throw new Error('Release builds require a bundled Python runtime via EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR.');
    }
    return undefined;
  }

  const sourceDir = path.resolve(sourcePath);
  const sourceExecutable = path.join(sourceDir, 'bin', 'python3');
  if (!fs.existsSync(sourceExecutable)) {
    throw new Error(`Bundled Python runtime is missing bin/python3: ${sourceDir}`);
  }
  fs.accessSync(sourceExecutable, fs.constants.X_OK);

  const versionOutput = execFileSync(sourceExecutable, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const versionMatch = versionOutput.match(/^Python\s+(\d+\.\d+\.\d+)$/);
  if (!versionMatch) {
    throw new Error(`Bundled Python runtime reported an unexpected version: ${versionOutput}`);
  }
  const version = versionMatch[1];
  const requiredVersion = String(process.env.EVAOS_REQUIRED_PYTHON_RUNTIME_VERSION || '').trim();
  if (requiredVersion && version !== requiredVersion) {
    throw new Error(`Bundled Python runtime ${version} does not match required version ${requiredVersion}.`);
  }

  const licenseSource = path.join(sourceDir, 'lib', `python${version.split('.').slice(0, 2).join('.')}`, 'LICENSE.txt');
  if (!fs.existsSync(licenseSource)) {
    throw new Error(`Bundled Python runtime is missing its CPython license: ${licenseSource}`);
  }

  const targetDir = path.join(resourceDir, 'python');
  copyDirectory(sourceDir, targetDir);
  const licenseTarget = path.join(resourceDir, ...PYTHON_LICENSE_RELATIVE_PATH.split('/'));
  fs.mkdirSync(path.dirname(licenseTarget), { recursive: true });
  fs.copyFileSync(licenseSource, licenseTarget);
  const inventoryMetadata = writePythonRuntimeInventory(resourceDir);

  const sourceSha256 = String(process.env.EVAOS_REQUIRED_PYTHON_RUNTIME_SHA256 || '').trim();
  const sourceUrl = String(process.env.EVAOS_REQUIRED_PYTHON_RUNTIME_SOURCE_URL || '').trim();
  const architecture = String(process.env.EVAOS_REQUIRED_PYTHON_RUNTIME_ARCH || '').trim();
  let packages = [];
  const packagesJson = String(process.env.EVAOS_REQUIRED_PYTHON_RUNTIME_PACKAGES_JSON || '').trim();
  if (packagesJson) {
    try {
      packages = JSON.parse(packagesJson);
    } catch (error) {
      throw new Error(`Bundled Python runtime package provenance is not valid JSON: ${error.message}`);
    }
  }
  if (shouldRequireRealBridge()) {
    if (!/^[0-9a-f]{64}$/i.test(sourceSha256) || !sourceUrl || !['arm64', 'x64'].includes(architecture)) {
      throw new Error('Release builds require pinned bundled Python runtime source and architecture provenance.');
    }
    if (
      !Array.isArray(packages) ||
      packages.length < 5 ||
      packages.some(
        (entry) =>
          !entry ||
          typeof entry.name !== 'string' ||
          typeof entry.version !== 'string' ||
          !/^[0-9a-f]{64}$/i.test(String(entry.sha256 || ''))
      )
    ) {
      throw new Error('Release builds require pinned bundled PyObjC package provenance.');
    }
  }
  return {
    version,
    sourceSha256,
    sourceUrl,
    architecture,
    packages,
    license: 'Python-2.0',
    licensePath: PYTHON_LICENSE_RELATIVE_PATH,
    licenseSha256: sha256File(licenseTarget),
    ...inventoryMetadata,
  };
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

function bridgeWrapperMetadata(filePath) {
  return {
    schema: BRIDGE_WRAPPER_METADATA_SCHEMA,
    path: 'evaos-desktop-bridge',
    sourceSha256: sha256File(filePath),
  };
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
echo "This PR/build artifact is not valid for Mac pairing release proof. Restore the evaOS-GUI-owned vendored Workbench bridge source." >&2
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

function bridgeManifest({
  requestedSourceRef,
  sourcePath,
  sourceCommit,
  sourceBranch,
  sourceProvenance,
  placeholder,
  placeholderReason,
  bundledTools,
}) {
  const manifest = {
    schema: 'evaos-desktop-bridge-resource/v1',
    requestedSourceRef: String(requestedSourceRef || sourceCommit || '').trim(),
    sourcePath,
    sourceCommit,
    sourceBranch,
    placeholder,
  };
  if (bundledTools !== undefined) {
    manifest.bundledTools = bundledTools;
  }
  if (placeholderReason !== undefined) {
    manifest.placeholderReason = placeholderReason;
  }
  if (sourceProvenance !== undefined) {
    manifest.sourceProvenance = sourceProvenance;
  }
  return manifest;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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

  const reason = String(error?.message || 'bridge source unavailable').replace(
    /https:\/\/x-access-token:[^/@]+@github\.com\//g,
    'https://github.com/'
  );
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
  const bridgePackageTarget = path.join(bridgeResourceDir, 'src', 'evaos_desktop_bridge');
  const bridgeBinDir = path.join(bridgeResourceDir, 'bin');

  if (shouldRequireRealBridge()) {
    assertVendoredBridgeSourceMatchesHead();
  }
  const sourceProvenance = vendoredBridgeSourceMetadata(bridgeSourceDir);
  const sourceRepositoryRoot =
    path.resolve(bridgeSourceDir) === path.resolve(vendoredBridgeSourceDir) ? projectRoot : bridgeSourceDir;
  const sourceCommit = gitValue(sourceRepositoryRoot, ['rev-parse', 'HEAD']);
  const requestedSourceRef = selectedBridgeSourceRef(sourceCommit);
  if (shouldRequireRealBridge() && (!isFullCommitSha(sourceCommit) || requestedSourceRef !== sourceCommit)) {
    throw new Error(
      'Release builds require the vendored Workbench bridge manifest to match the exact evaOS-GUI commit.'
    );
  }

  fs.rmSync(bridgeResourceDir, { recursive: true, force: true });
  fs.mkdirSync(bridgeBinDir, { recursive: true });
  copyCorePythonSource(bridgeSourceDir, bridgeResourceDir);
  removePycache(bridgeResourceDir);
  const pythonRuntime = installPythonRuntime();
  const bridgeExecutable = writeBridgeExecutable();
  const ed25519Verifier = buildEd25519Verifier({ targetDir: bridgeBinDir });
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
  const bundledTools = {
    ...(peekabooBundleMetadata(peekabooBinary) || {}),
    bridgeWrapper: bridgeWrapperMetadata(bridgeExecutable),
  };
  if (pythonRuntime) bundledTools.python = pythonRuntime;
  if (ed25519Verifier) bundledTools.ed25519Verifier = ed25519Verifier;

  const manifest = bridgeManifest({
    requestedSourceRef,
    sourcePath:
      path.resolve(bridgeSourceDir) === path.resolve(vendoredBridgeSourceDir)
        ? 'packages/mac-connector-core'
        : bridgeSourceDir,
    sourceCommit,
    sourceBranch: gitValue(sourceRepositoryRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
    sourceProvenance,
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
  assertVendoredBridgeSourceMatchesHead,
  directorySha256,
  bridgeManifest,
  bridgeWrapperMetadata,
  bridgeWrapperScript,
  buildEd25519Verifier,
  ed25519VerifierBuildArgs,
  installPythonRuntime,
  installPeekabooLicense,
  isMachOExecutable,
  peekabooBundleMetadata,
  peekabooIdentity,
  resolveBridgeSourceDir,
  sourceCandidates,
  vendoredBridgeSourceMetadata,
  verifyGeneratedCoreSource,
  verifyPythonRuntimeInventory,
  verifyWorkbenchBridgeIdentity,
  verifyWorkbenchBridgeSourceRoot,
  writePythonRuntimeInventory,
};
