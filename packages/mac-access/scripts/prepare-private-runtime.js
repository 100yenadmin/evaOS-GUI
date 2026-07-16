#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  copyCorePythonSource,
  coreSourceIdentity,
  verifyGeneratedCoreSource,
} = require('../../mac-connector-core/scripts/coreManifest');
const {
  assertVendoredBridgeSourceMatchesHead,
  installPythonRuntime,
  verifyPythonRuntimeInventory,
  writePythonRuntimeInventory,
} = require('../../../scripts/prepareEvaosDesktopBridgeResource');

const repositoryRoot = path.resolve(__dirname, '../../..');
const coreRoot = path.join(repositoryRoot, 'packages', 'mac-connector-core');
const schema = 'evaos-mac-access-private-runtime/v1';

function repositoryCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function clean(outputRoot) {
  fs.rmSync(path.resolve(outputRoot), { recursive: true, force: true });
}

function withRequiredRuntime(callback) {
  const previous = process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL;
  process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL = '1';
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL;
    else process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL = previous;
  }
}

function removeRuntimeDevelopmentArtifacts(destination, version) {
  const pythonMinor = version.split('.').slice(0, 2).join('.');
  const pythonLibrary = path.join(destination, 'python', 'lib', `python${pythonMinor}`);
  for (const developmentOnlyPath of [
    path.join(pythonLibrary, 'test'),
    path.join(pythonLibrary, 'site-packages', 'PyObjCTest'),
  ]) {
    fs.rmSync(developmentOnlyPath, { recursive: true, force: true });
  }

  const pending = [path.join(destination, 'python')];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory() && (entry.name === '__pycache__' || entry.name.endsWith('.dSYM'))) {
        fs.rmSync(entryPath, { recursive: true, force: true });
      } else if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.pyc')) {
        fs.rmSync(entryPath, { force: true });
      }
    }
  }
}

function prepare(outputRoot) {
  const destination = path.resolve(outputRoot);
  assertVendoredBridgeSourceMatchesHead();
  clean(destination);
  fs.mkdirSync(destination, { recursive: true });

  const identity = copyCorePythonSource(coreRoot, destination);
  const runtime = withRequiredRuntime(() =>
    installPythonRuntime(process.env.EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR, destination)
  );
  if (!runtime) throw new Error('Mac Access requires an embedded private Python runtime.');
  removeRuntimeDevelopmentArtifacts(destination, runtime.version);
  Object.assign(runtime, writePythonRuntimeInventory(destination));

  const manifest = {
    schema,
    owner: '100yenadmin/evaOS-GUI',
    product: 'evaOS Mac Access',
    repositoryCommit: repositoryCommit(),
    connectorCore: {
      sourcePath: 'packages/mac-connector-core',
      coreSourceSha256: identity.coreSourceSha256,
      sourceManifestSha256: identity.sourceManifestSha256,
    },
    runtime,
  };
  fs.writeFileSync(path.join(destination, 'SOURCE.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  verify(destination);
  return manifest;
}

function verify(outputRoot) {
  const destination = path.resolve(outputRoot);
  const manifestPath = path.join(destination, 'SOURCE.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const identity = coreSourceIdentity(coreRoot);
  if (
    manifest.schema !== schema ||
    manifest.owner !== '100yenadmin/evaOS-GUI' ||
    manifest.product !== 'evaOS Mac Access' ||
    manifest.repositoryCommit !== repositoryCommit() ||
    manifest.connectorCore?.sourcePath !== 'packages/mac-connector-core' ||
    manifest.connectorCore?.coreSourceSha256 !== identity.coreSourceSha256 ||
    manifest.connectorCore?.sourceManifestSha256 !== identity.sourceManifestSha256
  ) {
    throw new Error('Mac Access private-runtime source manifest is invalid or drifted.');
  }
  verifyGeneratedCoreSource(coreRoot, destination);
  verifyPythonRuntimeInventory(destination, manifest.runtime);
  const pythonMinor = manifest.runtime.version.split('.').slice(0, 2).join('.');
  for (const forbiddenPath of [
    path.join(destination, 'python', 'lib', `python${pythonMinor}`, 'test'),
    path.join(destination, 'python', 'lib', `python${pythonMinor}`, 'site-packages', 'PyObjCTest'),
  ]) {
    if (fs.existsSync(forbiddenPath)) {
      throw new Error(`Mac Access private runtime contains development-only payload: ${forbiddenPath}`);
    }
  }
  const expectedTopLevel = new Set([
    'SOURCE.json',
    'licenses',
    'python',
    'python-runtime-inventory.json',
    'src',
  ]);
  const unexpected = fs.readdirSync(destination).filter((entry) => !expectedTopLevel.has(entry));
  if (unexpected.length > 0) {
    throw new Error(`Mac Access private runtime contains unexpected top-level entries: ${unexpected.join(', ')}`);
  }
  return manifest;
}

function main() {
  const [operation, outputRoot] = process.argv.slice(2);
  if (!['prepare', 'verify', 'clean'].includes(operation) || !outputRoot) {
    throw new Error('usage: prepare-private-runtime.js prepare|verify|clean /absolute/output/path');
  }
  if (operation === 'prepare') prepare(outputRoot);
  else if (operation === 'verify') verify(outputRoot);
  else clean(outputRoot);
}

if (require.main === module) main();

module.exports = {
  clean,
  prepare,
  removeRuntimeDevelopmentArtifacts,
  repositoryCommit,
  schema,
  verify,
};
