const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MANIFEST_RELATIVE_PATH = 'contracts/core-source-files.v1.json';
const MANIFEST_SCHEMA = 'evaos-mac-connector-core-source/v1';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function utf8Sort(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function assertSafeRelativePath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`${label} contains an unsafe relative path: ${String(value)}`);
  }
  return value;
}

function walkFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const metadata = fs.lstatSync(entryPath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Connector core contains a forbidden symbolic link: ${entryPath}`);
      }
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      } else {
        throw new Error(`Connector core contains an unsupported filesystem entry: ${entryPath}`);
      }
    }
  }
  return files;
}

function loadCoreSourceManifest(coreRoot) {
  const root = path.resolve(coreRoot);
  const manifestPath = path.join(root, ...MANIFEST_RELATIVE_PATH.split('/'));
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (
    manifest.schema !== MANIFEST_SCHEMA ||
    manifest.owner !== '100yenadmin/evaOS-GUI' ||
    manifest.sourcePath !== 'packages/mac-connector-core' ||
    manifest.status !== 'canonical' ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  ) {
    throw new Error('Connector-core source manifest identity is invalid.');
  }

  const sourcePaths = new Set();
  const destinations = new Set();
  let previousPath;
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Connector-core source manifest contains an invalid file entry.');
    }
    const sourcePath = assertSafeRelativePath(entry.path, 'Connector-core source manifest');
    if (sourcePaths.has(sourcePath)) {
      throw new Error(`Connector-core source manifest repeats a file: ${sourcePath}`);
    }
    if (previousPath !== undefined && utf8Sort(previousPath, sourcePath) >= 0) {
      throw new Error('Connector-core source manifest files must be strictly sorted by UTF-8 path bytes.');
    }
    previousPath = sourcePath;
    sourcePaths.add(sourcePath);
    if (entry.destination !== null) {
      const destination = assertSafeRelativePath(entry.destination, 'Connector-core source manifest destination');
      if (!destination.startsWith('src/evaos_desktop_bridge/')) {
        throw new Error(`Connector-core Python destination escapes the generated package: ${destination}`);
      }
      if (destinations.has(destination)) {
        throw new Error(`Connector-core source manifest repeats a destination: ${destination}`);
      }
      destinations.add(destination);
    }
    if (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) {
      throw new Error(`Connector-core source manifest has an invalid mode: ${sourcePath}`);
    }
    if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`Connector-core source manifest has an invalid digest: ${sourcePath}`);
    }
  }

  return { root, manifest, manifestBytes, manifestPath };
}

function coreSourceIdentity(coreRoot) {
  const loaded = loadCoreSourceManifest(coreRoot);
  const listed = new Set(loaded.manifest.files.map((entry) => entry.path));
  const actual = [];
  for (const ownedRoot of ['native', 'python/evaos_desktop_bridge']) {
    const absoluteRoot = path.join(loaded.root, ...ownedRoot.split('/'));
    if (!fs.existsSync(absoluteRoot)) {
      throw new Error(`Connector-core owned source root is missing: ${ownedRoot}`);
    }
    const rootMetadata = fs.lstatSync(absoluteRoot);
    if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
      throw new Error(`Connector-core owned source root is not a real directory: ${ownedRoot}`);
    }
    for (const filePath of walkFiles(absoluteRoot)) {
      actual.push(path.relative(loaded.root, filePath).split(path.sep).join('/'));
    }
  }
  actual.sort(utf8Sort);
  if (actual.length !== listed.size || actual.some((relative) => !listed.has(relative))) {
    const unlisted = actual.filter((relative) => !listed.has(relative));
    const missing = [...listed].filter((relative) => !actual.includes(relative));
    throw new Error(
      `Connector-core source manifest drift (unlisted=${unlisted.join(',') || 'none'}; missing=${missing.join(',') || 'none'}).`
    );
  }

  const digest = crypto.createHash('sha256');
  for (const entry of loaded.manifest.files) {
    const absolute = path.join(loaded.root, ...entry.path.split('/'));
    const metadata = fs.lstatSync(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Connector-core manifest entry is not a regular file: ${entry.path}`);
    }
    const mode = metadata.mode & 0o777;
    if (mode !== entry.mode) {
      throw new Error(`Connector-core source mode mismatch for ${entry.path}: ${mode} != ${entry.mode}`);
    }
    const bytes = fs.readFileSync(absolute);
    const actualSha = sha256(bytes);
    if (actualSha !== entry.sha256) {
      throw new Error(`Connector-core source digest mismatch for ${entry.path}.`);
    }
    digest.update(entry.path);
    digest.update('\0');
    digest.update(bytes);
    digest.update('\0');
  }

  return {
    ...loaded,
    coreSourceSha256: digest.digest('hex'),
    sourceManifestSha256: sha256(loaded.manifestBytes),
  };
}

function copyCorePythonSource(coreRoot, resourceRoot) {
  const identity = coreSourceIdentity(coreRoot);
  const targetRoot = path.resolve(resourceRoot);
  for (const entry of identity.manifest.files) {
    if (entry.destination === null) continue;
    const source = path.join(identity.root, ...entry.path.split('/'));
    const destination = path.join(targetRoot, ...entry.destination.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, entry.mode);
  }
  verifyGeneratedCoreSource(identity.root, targetRoot);
  return identity;
}

function verifyGeneratedCoreSource(coreRoot, resourceRoot) {
  const identity = coreSourceIdentity(coreRoot);
  const targetRoot = path.resolve(resourceRoot);
  const expected = identity.manifest.files.filter((entry) => entry.destination !== null);
  const generatedSourceRoot = path.join(targetRoot, 'src');
  const actual = walkFiles(generatedSourceRoot)
    .map((filePath) => path.relative(targetRoot, filePath).split(path.sep).join('/'))
    .sort(utf8Sort);
  const expectedPaths = expected.map((entry) => entry.destination).sort(utf8Sort);
  if (actual.length !== expectedPaths.length || actual.some((relative, index) => relative !== expectedPaths[index])) {
    throw new Error('Generated connector-core Python source set does not match the explicit manifest.');
  }
  for (const entry of expected) {
    const destination = path.join(targetRoot, ...entry.destination.split('/'));
    const metadata = fs.lstatSync(destination);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== entry.mode) {
      throw new Error(`Generated connector-core source metadata mismatch: ${entry.destination}`);
    }
    if (sha256(fs.readFileSync(destination)) !== entry.sha256) {
      throw new Error(`Generated connector-core source digest mismatch: ${entry.destination}`);
    }
  }
  return identity;
}

module.exports = {
  MANIFEST_RELATIVE_PATH,
  MANIFEST_SCHEMA,
  assertSafeRelativePath,
  copyCorePythonSource,
  coreSourceIdentity,
  loadCoreSourceManifest,
  verifyGeneratedCoreSource,
};
