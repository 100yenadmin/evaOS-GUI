/**
 * Prepare aioncore binary for packaging.
 *
 * Resolution order:
 *  1. GitHub Actions artifact download when AIONUI_BACKEND_RUN_ID is set
 *  2. GitHub release download (requires version or defaults to "latest")
 *
 * Output: {projectRoot}/resources/bundled-aioncore/{platform}-{arch}/
 *   - aioncore[.exe]
 *   - manifest.json
 *   - managed-resources/...
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
const VALID_MANAGED_RESOURCES_BUNDLES = new Set(['full', 'no-acp']);
const DEFAULT_MANAGED_RESOURCES_BUNDLE = 'full';
const SOURCE_SHA_ENV_NAMES = ['EVAOS_APP_COMMIT', 'AIONUI_APP_COMMIT', 'SOURCE_COMMIT', 'WORKBENCH_SOURCE_SHA'];

const ACTIONS_ARTIFACT_TARGETS = {
  'darwin-arm64': {
    artifactName: 'aioncore-manual-macos-arm64',
    manualPlatform: 'macos-arm64',
  },
  'darwin-x64': {
    artifactName: 'aioncore-manual-macos-x64',
    manualPlatform: 'macos-x64',
  },
  'linux-arm64': {
    artifactName: 'aioncore-manual-linux-arm64',
    manualPlatform: 'linux-arm64',
  },
  'linux-x64': {
    artifactName: 'aioncore-manual-linux-x64',
    manualPlatform: 'linux-x64',
  },
  'win32-arm64': {
    artifactName: 'aioncore-manual-windows-arm64',
    manualPlatform: 'windows-arm64',
  },
  'win32-x64': {
    artifactName: 'aioncore-manual-windows-x64',
    manualPlatform: 'windows-x64',
  },
};

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

function ensureExecutableMode(filePath) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {}
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

function firstNonEmptyEnv(env, names) {
  for (const name of names) {
    const value = String(env?.[name] || '').trim();
    if (value) return value;
  }
  return null;
}

function getBuildSourceSha(env = process.env) {
  return firstNonEmptyEnv(env, SOURCE_SHA_ENV_NAMES) || firstNonEmptyEnv(env, ['GITHUB_SHA']);
}

function getBuildRunId(env = process.env) {
  return firstNonEmptyEnv(env, ['EVAOS_APP_RUN_ID', 'AIONUI_APP_RUN_ID', 'SOURCE_RUN_ID', 'GITHUB_RUN_ID']);
}

function getBinaryName(platform) {
  return platform === 'win32' ? 'aioncore.exe' : 'aioncore';
}

function normalizeVersionTag(version) {
  return version.startsWith('v') ? version : `v${version}`;
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

function getPathSegments(relativePath) {
  return String(relativePath || '')
    .split(/[\\/]+/)
    .filter(Boolean);
}

function isPrunableAcpManagedResourcePath(relativePath) {
  const segments = getPathSegments(relativePath);
  return segments.some((segment) => {
    const normalized = segment.toLowerCase().replace(/[_-]/g, '');
    return normalized === 'acp' || normalized === 'acpadapter' || normalized === 'acpadapters';
  });
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

function getPreparedResourceShape(targetDir, binaryName) {
  return {
    binary: describeRelativePath(targetDir, binaryName, { executable: true }),
    manifest: describeRelativePath(targetDir, 'manifest.json'),
    managedResources: describeFirstExistingPath(targetDir, ['managed-resources', 'managed_resources']),
    managedNodeRuntime: describeFirstExistingPath(targetDir, [
      path.join('managed-resources', 'node'),
      path.join('managed_resources', 'node'),
      'managed-node',
      'node-runtime',
    ]),
  };
}

function applyManagedResourcesBundle({ targetDir, mode = DEFAULT_MANAGED_RESOURCES_BUNDLE } = {}) {
  const normalizedMode = normalizeManagedResourcesBundle(mode);
  if (normalizedMode === 'full') {
    return {
      mode: normalizedMode,
      prunedResources: [],
    };
  }

  const managedResources = describeFirstExistingPath(targetDir, ['managed-resources', 'managed_resources']);
  if (!managedResources.present || !managedResources.relativePath) {
    return {
      mode: normalizedMode,
      prunedResources: [],
    };
  }

  const managedResourcesDir = path.join(targetDir, managedResources.relativePath);
  return {
    mode: normalizedMode,
    managedResourcesPath: managedResources.relativePath,
    sourceResources: listDirectoryRelativeEntries(managedResourcesDir),
    prunedResources: pruneAcpResourcesFromDirectory(managedResourcesDir),
    keptResources: listDirectoryRelativeEntries(managedResourcesDir),
  };
}

function getActionsTarget(platform, arch) {
  return ACTIONS_ARTIFACT_TARGETS[`${platform}-${arch}`] || null;
}

function getActionsArtifactName(platform, arch) {
  return getActionsTarget(platform, arch)?.artifactName || null;
}

function getActionsManualPlatform(platform, arch) {
  return getActionsTarget(platform, arch)?.manualPlatform || `${platform}-${arch}`;
}

function getActionsArtifactMissingMessage({ runId, platform, arch, expectedArtifactName, availableArtifactNames }) {
  const available =
    Array.isArray(availableArtifactNames) && availableArtifactNames.length > 0
      ? availableArtifactNames.join(', ')
      : '(none)';
  return [
    `AionCore run ${runId} does not contain artifact [ ${expectedArtifactName} ] required for [ ${platform}-${arch} ].`,
    `Available artifacts: ${available}.`,
    `Re-run AionCore Manual Build with platform [ ${getActionsManualPlatform(platform, arch)} ] or all.`,
  ].join(' ');
}

function prepareManagedResources(binaryPath, targetDir) {
  const bundleOut = path.join(targetDir, 'managed-resources');
  const dataDir = path.join(targetDir, '.prepare-data');

  removeDirectorySafe(bundleOut);
  removeDirectorySafe(dataDir);
  ensureDirectory(bundleOut);
  ensureDirectory(dataDir);

  console.log(`  Preparing managed resources under ${path.relative(process.cwd(), bundleOut)}`);
  execFileSync(binaryPath, ['--data-dir', dataDir, 'prepare-managed-resources', '--bundle-out', bundleOut], {
    stdio: 'inherit',
    env: {
      ...process.env,
      AIONUI_BUNDLED_MANAGED_RESOURCES: '',
    },
  });

  removeDirectorySafe(dataDir);
  return bundleOut;
}

function getManagedResourcesRuntimePlan(platform, arch, hostPlatform = process.platform, hostArch = process.arch) {
  if (platform !== hostPlatform) {
    return null;
  }

  if (arch === hostArch) {
    return {
      kind: 'target',
      platform,
      arch,
      runtimeKey: `${platform}-${arch}`,
    };
  }

  return {
    kind: 'host-compatible',
    platform,
    arch: hostArch,
    runtimeKey: `${platform}-${hostArch}`,
    targetRuntimeKey: `${platform}-${arch}`,
  };
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
    // gh CLI not available or no token - fall back to curl
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

function findAioncoreArchiveInDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (
      entry.isFile() &&
      entry.name.startsWith('aioncore-') &&
      (entry.name.endsWith('.zip') || entry.name.endsWith('.tar.gz'))
    ) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = findAioncoreArchiveInDir(fullPath);
      if (found) return found;
    }
  }
  return null;
}

function getGitHubToken() {
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
}

function githubApiGetJson(apiPath) {
  const token = getGitHubToken();

  try {
    return JSON.parse(
      execFileSync('gh', ['api', apiPath], {
        encoding: 'utf-8',
        timeout: 15000,
        env: {
          ...process.env,
          GH_TOKEN: token || process.env.GH_TOKEN,
        },
      })
    );
  } catch {
    // gh CLI not available or failed - fall back to curl.
  }

  const headers = ['-H', 'Accept: application/vnd.github+json'];
  if (token) {
    headers.push('-H', `Authorization: Bearer ${token}`);
  }

  const url = `https://api.github.com/${apiPath}`;
  const out = execFileSync('curl', ['-fsSL', ...headers, url], {
    encoding: 'utf-8',
    timeout: 15000,
  });
  return JSON.parse(out);
}

function downloadFileWithAuth(url, outputPath) {
  const token = getGitHubToken();
  const headers = ['-H', 'Accept: application/vnd.github+json'];
  if (token) {
    headers.push('-H', `Authorization: Bearer ${token}`);
  }

  try {
    execFileSync('curl', ['-L', '--fail', '--silent', '--show-error', ...headers, '-o', outputPath, url], {
      timeout: 120000,
    });
    return;
  } catch {
    // curl may be unavailable in some local environments; try gh before failing.
  }

  execFileSync('gh', ['api', url, '--output', outputPath], {
    timeout: 120000,
    env: {
      ...process.env,
      GH_TOKEN: token || process.env.GH_TOKEN,
    },
  });
}

function listActionsArtifacts(runId) {
  const response = githubApiGetJson(
    `repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}/artifacts?per_page=100`
  );
  return Array.isArray(response?.artifacts) ? response.artifacts : [];
}

function downloadAndExtractActionsArtifact(platform, arch, runId) {
  const expectedArtifactName = getActionsArtifactName(platform, arch);
  if (!expectedArtifactName) {
    throw new Error(`Unsupported AionCore Actions artifact target: ${platform}-${arch}`);
  }

  const artifacts = listActionsArtifacts(runId);
  const availableArtifactNames = artifacts
    .map((artifact) => artifact.name)
    .filter(Boolean)
    .toSorted();
  const artifact = artifacts.find((candidate) => candidate.name === expectedArtifactName);
  if (!artifact) {
    throw new Error(
      getActionsArtifactMissingMessage({
        runId,
        platform,
        arch,
        expectedArtifactName,
        availableArtifactNames,
      })
    );
  }

  const tempDir = path.join(os.tmpdir(), 'aioncore-prepare-actions', runId, `${platform}-${arch}`);
  const artifactZipPath = path.join(tempDir, `${expectedArtifactName}.zip`);
  const artifactExtractDir = path.join(tempDir, 'artifact');
  const binaryExtractDir = path.join(tempDir, 'binary');

  removeDirectorySafe(tempDir);
  ensureDirectory(tempDir);

  const downloadUrl =
    artifact.archive_download_url ||
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/artifacts/${artifact.id}/zip`;
  console.log(`  Downloading aioncore from AionCore run ${runId} artifact ${expectedArtifactName}`);
  downloadFileWithAuth(downloadUrl, artifactZipPath);
  extractArchive(artifactZipPath, artifactExtractDir, platform);

  const archivePath = findAioncoreArchiveInDir(artifactExtractDir);
  if (!archivePath) {
    throw new Error(`AionCore artifact ${expectedArtifactName} from run ${runId} does not contain an aioncore archive`);
  }

  extractArchive(archivePath, binaryExtractDir, platform);

  const binaryName = getBinaryName(platform);
  const binaryPath = findBinaryInDir(binaryExtractDir, binaryName);
  if (!binaryPath) {
    throw new Error(`Binary ${binaryName} not found in AionCore artifact ${expectedArtifactName} from run ${runId}`);
  }

  return {
    binaryPath,
    tempDir,
    artifactName: expectedArtifactName,
    archivePath,
    url: downloadUrl,
  };
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

  return { binaryPath, tempDir, url };
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
 * @returns {{ prepared: true; dir: string; sourceType: string }}
 */
function prepareAioncore(options) {
  const { projectRoot, platform, arch, version = 'latest', env = process.env } = options;
  const managedResourcesBundle = normalizeManagedResourcesBundle(
    options.managedResourcesBundle || readManagedResourcesBundle({ env })
  );
  const runtimeKey = `${platform}-${arch}`;
  const actionsRunId = (env.AIONUI_BACKEND_RUN_ID || '').trim();

  let tag = null;
  const resolveReleaseTag = () => {
    if (tag) return tag;
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
    return tag;
  };

  if (!actionsRunId) {
    // Resolve the actual version tag - release asset filenames include the tag.
    resolveReleaseTag();
  }

  const targetDir = path.join(projectRoot, 'resources', 'bundled-aioncore', runtimeKey);
  const binaryName = getBinaryName(platform);
  const targetBinaryPath = path.join(targetDir, binaryName);

  console.log(
    `Preparing aioncore for ${runtimeKey} (${actionsRunId ? `actions run: ${actionsRunId}` : `version: ${tag}`})`
  );

  removeDirectorySafe(targetDir);
  ensureDirectory(targetDir);

  let sourcePath = null;
  let sourceType = 'none';
  let sourceDetail = {};
  const tempDirs = [];

  // 1. Download from GitHub Actions artifacts when manual build run id is provided.
  if (actionsRunId) {
    const result = downloadAndExtractActionsArtifact(platform, arch, actionsRunId);
    sourcePath = result.binaryPath;
    tempDirs.push(result.tempDir);
    sourceType = 'actions-artifact';
    sourceDetail = {
      runId: actionsRunId,
      artifactName: result.artifactName,
      url: result.url,
    };
    console.log(`  Downloaded from GitHub Actions artifact`);
  }

  // 2. Download from GitHub releases.
  if (!sourcePath && tag) {
    try {
      const result = downloadAndExtract(platform, arch, tag);
      sourcePath = result.binaryPath;
      tempDirs.push(result.tempDir);
      sourceType = 'download';
      sourceDetail = { url: result.url };
      console.log(`  Downloaded from GitHub releases`);
    } catch (error) {
      console.warn(`  Download failed: ${error.message}`);
    }
  }

  // Write result
  if (sourcePath) {
    copyFileSafe(sourcePath, targetBinaryPath);
    ensureExecutableMode(targetBinaryPath);
    const managedResourcesPlan = getManagedResourcesRuntimePlan(platform, arch);
    if (!managedResourcesPlan) {
      throw new Error(
        `Cannot prepare managed resources for ${runtimeKey} on host ${process.platform}-${process.arch}; target platform binary is not executable on this host`
      );
    }

    let managedResourcesBinaryPath = targetBinaryPath;
    if (managedResourcesPlan.kind === 'host-compatible') {
      console.log(
        `  Target ${runtimeKey} binary is not executable on host ${process.platform}-${process.arch}; using ${managedResourcesPlan.runtimeKey} aioncore for managed resources`
      );
      let managedResourcesBinary;
      let managedResourcesSourceType = 'download';
      if (actionsRunId) {
        try {
          managedResourcesBinary = downloadAndExtractActionsArtifact(
            managedResourcesPlan.platform,
            managedResourcesPlan.arch,
            actionsRunId
          );
          managedResourcesSourceType = 'actions-artifact';
        } catch (error) {
          console.warn(
            `  Host-compatible AionCore artifact unavailable in run ${actionsRunId}; falling back to pinned release for managed resources: ${error.message}`
          );
        }
      }
      if (!managedResourcesBinary) {
        managedResourcesBinary = downloadAndExtract(
          managedResourcesPlan.platform,
          managedResourcesPlan.arch,
          resolveReleaseTag()
        );
      }
      tempDirs.push(managedResourcesBinary.tempDir);
      managedResourcesBinaryPath = managedResourcesBinary.binaryPath;
      sourceDetail = {
        ...sourceDetail,
        managedResources: {
          runtimeKey: managedResourcesPlan.runtimeKey,
          sourceType: managedResourcesSourceType,
          version: managedResourcesSourceType === 'download' ? tag : undefined,
          artifactName: managedResourcesBinary.artifactName,
          url: managedResourcesBinary.url,
        },
      };
    }

    const bundledManagedResourcesDir = prepareManagedResources(managedResourcesBinaryPath, targetDir);
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
      version: tag || `actions-run-${actionsRunId}`,
      requestedVersion: version,
      generatedAt: new Date().toISOString(),
      github: {
        runId: getBuildRunId(env),
        sha: getBuildSourceSha(env),
        repository: env.GITHUB_REPOSITORY || null,
      },
      managedResourcesBundle,
      managedResourcesBundleResult,
      sourceResourceShape,
      sourceType,
      source: sourceDetail,
      files: [binaryName, 'managed-resources/'],
      resourceShape: {
        ...resourceShape,
        manifest: { present: true, relativePath: 'manifest.json', type: 'file' },
      },
    };

    writeJson(path.join(targetDir, 'manifest.json'), manifest);
    console.log(
      `  Bundled aioncore prepared: resources/bundled-aioncore/${runtimeKey}/${binaryName} [source=${sourceType}]`
    );
    console.log(`  Bundled managed resources prepared: ${bundledManagedResourcesDir}`);
    if (managedResourcesBundle === 'no-acp') {
      console.log(
        `  AionCore managed resources bundle: no-acp (${managedResourcesBundleResult.prunedResources.length} ACP entries pruned)`
      );
    }

    for (const tempDir of tempDirs) removeDirectorySafe(tempDir);
    return {
      prepared: true,
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
  getActionsArtifactMissingMessage,
  getActionsArtifactName,
  getBuildRunId,
  getBuildSourceSha,
  getManagedResourcesRuntimePlan,
  normalizeManagedResourcesBundle,
  prepareAioncore,
  readManagedResourcesBundle,
};
