/**
 * Prepare aioncore binary for packaging.
 *
 * Resolution order:
 *  1. GitHub release download (requires version or defaults to "latest")
 *
 * Output: {projectRoot}/resources/bundled-aioncore/{platform}-{arch}/aioncore[.exe]
 *
 * @module prepare-aioncore
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GITHUB_OWNER = 'iOfficeAI';
const GITHUB_REPO = 'AionCore';
const MANIFEST_SCHEMA = 'aioncore-bundle/v2';
const MANAGED_RESOURCE_MARKERS = ['managed-resources', 'managed_resources'];
const MANAGED_NODE_RUNTIME_MARKERS = ['managed-node', 'node-runtime'];
const VALID_MANAGED_RESOURCES_BUNDLES = new Set(['full', 'no-acp']);
const DEFAULT_MANAGED_RESOURCES_BUNDLE = 'full';
const ACP_MANAGED_RESOURCE_RE = /(^|[-_])(?:claude|codex)(?:$|[-_])/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function removeDirectorySafe(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function copyFileSafe(sourcePath, targetPath) {
  ensureDirectory(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function copyDirectorySafe(sourcePath, targetPath) {
  removeDirectorySafe(targetPath);
  ensureDirectory(path.dirname(targetPath));
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

function ensureExecutableMode(filePath) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {}
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

function getBinaryName(platform) {
  return platform === 'win32' ? 'aioncore.exe' : 'aioncore';
}

function normalizeVersionTag(version) {
  return version.startsWith('v') ? version : `v${version}`;
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeManagedResourcesBundle(value) {
  const mode = String(value || DEFAULT_MANAGED_RESOURCES_BUNDLE).trim();
  if (!VALID_MANAGED_RESOURCES_BUNDLES.has(mode)) {
    throw new Error(
      `Invalid AIONUI_MANAGED_RESOURCES_BUNDLE "${mode}". Expected one of: ${[...VALID_MANAGED_RESOURCES_BUNDLES].join(
        ', '
      )}`
    );
  }
  return mode;
}

function readManagedResourcesBundle({ env = process.env } = {}) {
  return normalizeManagedResourcesBundle(env.AIONUI_MANAGED_RESOURCES_BUNDLE);
}

function getManifestManagedResourcesBundle(manifest) {
  const raw = manifest?.managedResourcesBundle;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof raw.mode === 'string') return raw.mode;
  return null;
}

function describeRelativePath(rootDir, relativePath, { executable = false } = {}) {
  const absolutePath = path.join(rootDir, relativePath);
  try {
    const stats = fs.statSync(absolutePath);
    const result = {
      present: true,
      relativePath,
      type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
    };

    if (executable) {
      if (process.platform === 'win32') {
        result.executable = stats.isFile();
      } else {
        try {
          fs.accessSync(absolutePath, fs.constants.X_OK);
          result.executable = true;
        } catch {
          result.executable = false;
        }
      }
    }

    return result;
  } catch {
    return { present: false, relativePath };
  }
}

function describeFirstExistingPath(rootDir, candidates) {
  for (const candidate of candidates) {
    const description = describeRelativePath(rootDir, candidate);
    if (description.present) return description;
  }

  return { present: false, candidates };
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function findFirstDirectoryByMarkers(rootDir, markers) {
  if (!isDirectory(rootDir)) return null;

  const markerSet = new Set(markers);
  const queue = [rootDir];
  while (queue.length > 0) {
    const currentDir = queue.shift();
    const entries = fs
      .readdirSync(currentDir, { withFileTypes: true })
      .toSorted((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const absolutePath = path.join(currentDir, entry.name);
      if (markerSet.has(entry.name)) return absolutePath;
      queue.push(absolutePath);
    }
  }

  return null;
}

function getUniqueSearchRoots(binaryPath, extractDir) {
  const roots = [];
  for (const candidate of [path.dirname(binaryPath), extractDir]) {
    if (candidate && !roots.includes(candidate)) roots.push(candidate);
  }
  return roots;
}

function copyFirstRuntimeDirectory(searchRoots, markers, targetDir) {
  for (const searchRoot of searchRoots) {
    const sourceDir = findFirstDirectoryByMarkers(searchRoot, markers);
    if (!sourceDir) continue;

    const targetName = path.basename(sourceDir);
    copyDirectorySafe(sourceDir, path.join(targetDir, targetName));
    return targetName;
  }

  return null;
}

function copyManagedRuntimeResources({ binaryPath, extractDir, targetDir }) {
  const searchRoots = getUniqueSearchRoots(binaryPath, extractDir);
  const copied = [];
  const managedResources = copyFirstRuntimeDirectory(searchRoots, MANAGED_RESOURCE_MARKERS, targetDir);
  if (managedResources) copied.push(managedResources);

  const managedNodeRuntime = copyFirstRuntimeDirectory(searchRoots, MANAGED_NODE_RUNTIME_MARKERS, targetDir);
  if (managedNodeRuntime) copied.push(managedNodeRuntime);

  return copied;
}

function getPathSegments(relativePath) {
  return relativePath.split(/[\\/]+/).filter(Boolean);
}

function hasAcpResourceContext(segments) {
  return segments.some((segment) => {
    const normalized = segment.toLowerCase().replace(/[_-]/g, '');
    return normalized === 'acp' || normalized === 'acpadapter' || normalized === 'acpadapters';
  });
}

function hasClaudeOrCodexSegment(segments) {
  return segments.some((segment) => {
    const stem = segment.toLowerCase().replace(/\.[^.]+$/, '');
    return ACP_MANAGED_RESOURCE_RE.test(stem);
  });
}

function isPrunableAcpManagedResourcePath(relativePath) {
  const segments = getPathSegments(relativePath);
  return hasAcpResourceContext(segments) && hasClaudeOrCodexSegment(segments);
}

function listDirectoryRelativeEntries(rootDir, relativeDir = '') {
  if (!isDirectory(rootDir)) return [];

  const entries = [];
  const dirEntries = fs.readdirSync(rootDir, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name));
  for (const entry of dirEntries) {
    const absolutePath = path.join(rootDir, entry.name);
    const relativePath = path.join(relativeDir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      entries.push(`${relativePath}/`);
      entries.push(...listDirectoryRelativeEntries(absolutePath, relativePath));
    } else {
      entries.push(relativePath);
    }
  }

  return entries;
}

function pruneAcpResourcesFromDirectory(rootDir, relativeDir = '') {
  if (!isDirectory(rootDir)) return [];

  const pruned = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    const relativePath = path.join(relativeDir, entry.name);
    const normalizedRelativePath = relativePath.replace(/\\/g, '/');
    if (isPrunableAcpManagedResourcePath(normalizedRelativePath)) {
      fs.rmSync(absolutePath, { recursive: true, force: true });
      pruned.push(`${normalizedRelativePath}${entry.isDirectory() ? '/' : ''}`);
      continue;
    }

    if (entry.isDirectory()) {
      pruned.push(...pruneAcpResourcesFromDirectory(absolutePath, relativePath));
    }
  }

  return pruned;
}

function applyManagedResourcesBundle({ targetDir, mode = DEFAULT_MANAGED_RESOURCES_BUNDLE } = {}) {
  const normalizedMode = normalizeManagedResourcesBundle(mode);
  if (normalizedMode === 'full') {
    return {
      mode: normalizedMode,
      prunedResources: [],
    };
  }

  const managedResources = describeFirstExistingPath(targetDir, MANAGED_RESOURCE_MARKERS);
  if (!managedResources.present || !managedResources.relativePath) {
    return {
      mode: normalizedMode,
      prunedResources: [],
    };
  }

  return {
    mode: normalizedMode,
    managedResourcesPath: managedResources.relativePath,
    sourceResources: listDirectoryRelativeEntries(path.join(targetDir, managedResources.relativePath)),
    prunedResources: pruneAcpResourcesFromDirectory(path.join(targetDir, managedResources.relativePath)),
    keptResources: listDirectoryRelativeEntries(path.join(targetDir, managedResources.relativePath)),
  };
}

function getPreparedResourceShape(targetDir, binaryName) {
  return {
    binary: describeRelativePath(targetDir, binaryName, { executable: true }),
    manifest: describeRelativePath(targetDir, 'manifest.json'),
    managedResources: describeFirstExistingPath(targetDir, MANAGED_RESOURCE_MARKERS),
    managedNodeRuntime: describeFirstExistingPath(targetDir, MANAGED_NODE_RUNTIME_MARKERS),
  };
}

function getTargetPaths(projectRoot, platform, arch) {
  const runtimeKey = `${platform}-${arch}`;
  const targetDir = path.join(projectRoot, 'resources', 'bundled-aioncore', runtimeKey);
  const binaryName = getBinaryName(platform);

  return {
    runtimeKey,
    targetDir,
    binaryName,
    targetBinaryPath: path.join(targetDir, binaryName),
    manifestPath: path.join(targetDir, 'manifest.json'),
  };
}

function getExpectedPresence(manifest, key) {
  if (!manifest.resourceShape || !Object.prototype.hasOwnProperty.call(manifest.resourceShape, key)) {
    return null;
  }

  return Boolean(manifest.resourceShape[key]?.present);
}

/**
 * Validate an existing prepared AionCore directory for manifest-aware reuse.
 *
 * @param {object} options - Reuse validation options.
 * @param {string} options.projectRoot - Project root directory.
 * @param {string} options.platform - Target platform.
 * @param {string} options.arch - Target architecture.
 * @param {string} options.version - Already resolved release tag.
 * @returns {{reusable: boolean, reasons: string[], manifest: object | null, dir: string}}
 */
function getPreparedAioncoreReuseState(options) {
  const { projectRoot, platform, arch, version, managedResourcesBundle = DEFAULT_MANAGED_RESOURCES_BUNDLE } = options;
  const expectedManagedResourcesBundle = normalizeManagedResourcesBundle(managedResourcesBundle);
  const { runtimeKey, targetDir, binaryName, manifestPath } = getTargetPaths(projectRoot, platform, arch);
  const reasons = [];
  const manifest = readJsonIfExists(manifestPath);

  if (!manifest) {
    reasons.push('manifest missing or unreadable');
    return { reusable: false, reasons, manifest: null, dir: targetDir };
  }

  const actualShape = getPreparedResourceShape(targetDir, binaryName);

  if (manifest.schema !== MANIFEST_SCHEMA) {
    reasons.push(`schema mismatch: ${manifest.schema || 'missing'} != ${MANIFEST_SCHEMA}`);
  }
  if (manifest.platform !== platform)
    reasons.push(`platform mismatch: ${manifest.platform || 'missing'} != ${platform}`);
  if (manifest.arch !== arch) reasons.push(`arch mismatch: ${manifest.arch || 'missing'} != ${arch}`);
  if (manifest.runtimeKey && manifest.runtimeKey !== runtimeKey) {
    reasons.push(`runtimeKey mismatch: ${manifest.runtimeKey} != ${runtimeKey}`);
  }
  if (manifest.version !== version) reasons.push(`version mismatch: ${manifest.version || 'missing'} != ${version}`);
  try {
    const manifestManagedResourcesBundle = getManifestManagedResourcesBundle(manifest);
    if (!manifestManagedResourcesBundle) {
      reasons.push('manifest missing managedResourcesBundle');
    } else {
      const actualManagedResourcesBundle = normalizeManagedResourcesBundle(manifestManagedResourcesBundle);
      if (actualManagedResourcesBundle !== expectedManagedResourcesBundle) {
        reasons.push(
          `managedResourcesBundle mismatch: ${actualManagedResourcesBundle} != ${expectedManagedResourcesBundle}`
        );
      }
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }
  if (!actualShape.binary.present) reasons.push(`binary missing: ${binaryName}`);
  if (actualShape.binary.present && actualShape.binary.executable === false) {
    reasons.push(`binary is not executable: ${binaryName}`);
  }
  if (!actualShape.manifest.present) reasons.push('manifest missing');

  for (const key of ['managedResources', 'managedNodeRuntime']) {
    const expectedPresence = getExpectedPresence(manifest, key);
    if (expectedPresence === null) {
      reasons.push(`manifest missing resourceShape.${key}`);
      continue;
    }
    if (expectedPresence !== actualShape[key].present) {
      reasons.push(`${key} presence mismatch: manifest=${expectedPresence} actual=${actualShape[key].present}`);
    }
  }

  return { reusable: reasons.length === 0, reasons, manifest, dir: targetDir };
}

// ---------------------------------------------------------------------------
// Source resolvers
// ---------------------------------------------------------------------------

/**
 * Resolve the actual version tag when "latest" is requested.
 * Uses GitHub API via `gh` CLI (needs GH_TOKEN in CI) or falls back to
 * `curl` with an optional Authorization header (GITHUB_TOKEN / GH_TOKEN).
 */
function resolveLatestTag() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

  // 1. Try gh CLI (honours GH_TOKEN automatically)
  try {
    const out = execSync(`gh api repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest --jq .tag_name`, {
      encoding: 'utf-8',
      timeout: 15000,
    }).trim();
    if (out) return out;
  } catch {
    // gh CLI not available or no token — fall back to curl
  }

  // 2. Curl with optional token to avoid rate-limit 403
  try {
    const authArgs = token ? ['-H', `Authorization: token ${token}`] : [];
    const args = ['-fsSL', ...authArgs, `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`];
    const out = execFileSync('curl', args, { encoding: 'utf-8', timeout: 15000 });
    const tag = JSON.parse(out).tag_name;
    if (tag) return tag;
  } catch {
    // network issue or rate-limited
  }

  return null;
}

/**
 * Build the release asset filename for the given platform/arch/tag.
 *
 * Expected asset naming convention:
 *   aioncore-v0.1.0-aarch64-apple-darwin.tar.gz
 */
function getAssetName(platform, arch, tag) {
  const archMap = { x64: 'x86_64', arm64: 'aarch64' };
  const platformMap = {
    darwin: 'apple-darwin',
    linux: 'unknown-linux-gnu',
    win32: 'pc-windows-msvc',
  };
  const normalizedArch = archMap[arch];
  const normalizedPlatform = platformMap[platform];
  if (!normalizedArch || !normalizedPlatform) return null;
  const ext = platform === 'win32' ? '.zip' : '.tar.gz';
  return `aioncore-${tag}-${normalizedArch}-${normalizedPlatform}${ext}`;
}

function getDownloadUrl(assetName, tag) {
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tag}/${assetName}`;
}

function downloadFile(url, outputPath) {
  console.log(`  Downloading aioncore from ${url}`);
  if (process.platform === 'win32') {
    const ps = `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${outputPath.replace(/'/g, "''")}'`;
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      timeout: 120000,
    });
    return;
  }
  try {
    execFileSync('curl', ['-L', '--fail', '--silent', '--show-error', '-o', outputPath, url], { timeout: 120000 });
  } catch {
    execFileSync('wget', ['-q', '-O', outputPath, url], { timeout: 120000 });
  }
}

function extractArchive(archivePath, outputDir, platform) {
  ensureDirectory(outputDir);
  if (platform === 'win32' || archivePath.endsWith('.zip')) {
    if (platform === 'win32') {
      const ps = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outputDir.replace(/'/g, "''")}' -Force`;
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    } else {
      execFileSync('unzip', ['-o', archivePath, '-d', outputDir]);
    }
  } else {
    execFileSync('tar', ['-xzf', archivePath, '-C', outputDir]);
  }
}

function findBinaryInDir(dir, binaryName) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === binaryName) return fullPath;
    if (entry.isDirectory()) {
      const found = findBinaryInDir(fullPath, binaryName);
      if (found) return found;
    }
  }
  return null;
}

function downloadAndExtract(platform, arch, tag) {
  const assetName = getAssetName(platform, arch, tag);
  if (!assetName) {
    throw new Error(`Unsupported aioncore target: ${platform}-${arch}`);
  }

  const url = getDownloadUrl(assetName, tag);
  const tempDir = path.join(os.tmpdir(), 'aioncore-prepare', tag, `${platform}-${arch}`);
  const archivePath = path.join(tempDir, assetName);
  const extractDir = path.join(tempDir, 'extracted');

  removeDirectorySafe(tempDir);
  ensureDirectory(tempDir);

  downloadFile(url, archivePath);
  extractArchive(archivePath, extractDir, platform);

  const binaryName = getBinaryName(platform);
  const binaryPath = findBinaryInDir(extractDir, binaryName);
  if (!binaryPath) {
    throw new Error(`Binary ${binaryName} not found in downloaded archive`);
  }

  return { binaryPath, extractDir, tempDir, url };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Prepare aioncore binary for packaging.
 *
 * @param {object} options - Configuration options
 * @param {string} options.projectRoot - Project root directory
 * @param {string} options.platform - Target platform (process.platform)
 * @param {string} options.arch - Target architecture (process.arch)
 * @param {string} options.version - Backend version (default: 'latest')
 * @param {boolean} options.reusePrepared - Reuse a matching prepared manifest when present.
 * @param {object} options.env - Environment metadata for CI provenance and managed-resource bundle selection.
 * @param {'full'|'no-acp'} options.managedResourcesBundle - Managed resource bundle mode.
 * @returns {{ prepared: true; reused: boolean; dir: string; sourceType: string }}
 */
function prepareAioncore(options) {
  const { projectRoot, platform, arch, version = 'latest', reusePrepared = false, env = process.env } = options;
  const managedResourcesBundle = normalizeManagedResourcesBundle(
    options.managedResourcesBundle || readManagedResourcesBundle({ env })
  );
  const { runtimeKey, targetDir, binaryName, targetBinaryPath } = getTargetPaths(projectRoot, platform, arch);

  // Resolve the actual version tag — asset filenames include the tag
  let tag;
  if (version === 'latest') {
    const resolved = resolveLatestTag();
    if (!resolved) {
      throw new Error('Failed to resolve latest aioncore release tag from GitHub API');
    }
    tag = resolved;
    console.log(`Resolved aioncore "latest" → ${tag}`);
  } else {
    tag = normalizeVersionTag(version);
  }

  if (reusePrepared) {
    const reuseState = getPreparedAioncoreReuseState({
      projectRoot,
      platform,
      arch,
      version: tag,
      managedResourcesBundle,
    });
    if (reuseState.reusable) {
      console.log(`Reusing prepared aioncore for ${runtimeKey} (version: ${tag})`);
      return {
        prepared: true,
        reused: true,
        dir: targetDir,
        sourceType: reuseState.manifest.sourceType || 'reuse',
        managedResourcesBundle,
      };
    }

    console.log(`Prepared aioncore reuse unavailable for ${runtimeKey}: ${reuseState.reasons.join('; ')}`);
  }

  console.log(`Preparing aioncore for ${runtimeKey} (version: ${tag})`);

  removeDirectorySafe(targetDir);
  ensureDirectory(targetDir);

  let sourcePath = null;
  let sourceType = 'none';
  let sourceDetail = {};
  let tempDir = null;

  // 1. Download from GitHub releases
  if (!sourcePath) {
    try {
      const result = downloadAndExtract(platform, arch, tag);
      sourcePath = result.binaryPath;
      tempDir = result.tempDir;
      sourceType = 'download';
      sourceDetail = { url: result.url, extractDir: result.extractDir };
      console.log(`  Downloaded from GitHub releases`);
    } catch (error) {
      console.warn(`  Download failed: ${error.message}`);
    }
  }

  // Write result
  if (sourcePath) {
    copyFileSafe(sourcePath, targetBinaryPath);
    ensureExecutableMode(targetBinaryPath);
    const copiedResourcePaths = copyManagedRuntimeResources({
      binaryPath: sourcePath,
      extractDir: sourceDetail.extractDir,
      targetDir,
    });
    const sourceResourceShape = getPreparedResourceShape(targetDir, binaryName);
    const managedResourcesBundleResult = applyManagedResourcesBundle({
      targetDir,
      mode: managedResourcesBundle,
    });
    const resourceShape = getPreparedResourceShape(targetDir, binaryName);

    // The release tag is the authoritative version — the aioncore
    // binary does not expose a --version flag (it has --app-version which
    // takes a value, not a self-report).
    const manifest = {
      schema: MANIFEST_SCHEMA,
      platform,
      arch,
      runtimeKey,
      version: tag,
      requestedVersion: version,
      generatedAt: new Date().toISOString(),
      github: {
        runId: env.GITHUB_RUN_ID || null,
        sha: env.GITHUB_SHA || null,
        repository: env.GITHUB_REPOSITORY || null,
      },
      managedResourcesBundle,
      managedResourcesBundleResult,
      sourceResourceShape,
      sourceType,
      source: { url: sourceDetail.url },
      files: [binaryName, ...copiedResourcePaths],
      resourceShape: {
        ...resourceShape,
        manifest: { present: true, relativePath: 'manifest.json', type: 'file' },
      },
    };

    writeJson(path.join(targetDir, 'manifest.json'), manifest);
    console.log(
      `  Bundled aioncore prepared: resources/bundled-aioncore/${runtimeKey}/${binaryName} [source=${sourceType}]`
    );

    if (tempDir) removeDirectorySafe(tempDir);
    return {
      prepared: true,
      reused: false,
      dir: targetDir,
      sourceType,
      managedResourcesBundle,
      prunedResources: managedResourcesBundleResult.prunedResources,
    };
  }

  throw new Error(`aioncore binary not found for ${runtimeKey} (tag: ${tag})`);
}

module.exports = {
  DEFAULT_MANAGED_RESOURCES_BUNDLE,
  VALID_MANAGED_RESOURCES_BUNDLES,
  applyManagedResourcesBundle,
  getPreparedAioncoreReuseState,
  normalizeManagedResourcesBundle,
  prepareAioncore,
  readManagedResourcesBundle,
};
