/**
 * CLI wrapper for prepare-aioncore.
 *
 * Reads environment variables and invokes the shared module.
 *
 * Version resolution order:
 *  1. AIONUI_BACKEND_RUN_ID env (download from AionCore Manual Build artifact)
 *  2. AIONUI_BACKEND_VERSION env (for ad-hoc release overrides)
 *  3. "aioncoreVersion" field in repo-root package.json (the pin)
 *  4. 'latest' (fallback; not recommended for reproducible builds)
 *
 * Environment variables:
 *  - AIONUI_BACKEND_RUN_ID: AionCore Manual Build workflow run id
 *  - AIONUI_BACKEND_VERSION: override the pinned version
 *  - AIONUI_BACKEND_ARCH: target architecture (default: process.arch)
 *  - AIONUI_MANAGED_RESOURCES_BUNDLE: full or no-acp
 *  - GH_TOKEN / GITHUB_TOKEN: GitHub API token (for rate limiting)
 */

const path = require('path');
const { execSync } = require('child_process');
const { prepareAioncore } = require('../packages/shared-scripts/src/prepare-aioncore.js');
const { resolveAioncoreVersion } = require('./resolveAioncoreVersion.js');

const projectRoot = path.resolve(__dirname, '..');
const platform = process.platform;
// Support cross-compilation: AIONUI_BACKEND_ARCH > npm_config_target_arch > process.arch
const arch = process.env.AIONUI_BACKEND_ARCH || process.env.npm_config_target_arch || process.arch;
const version = resolveAioncoreVersion(projectRoot);

function ensureBuildSourceCommitEnv() {
  const existing = [
    process.env.EVAOS_APP_COMMIT,
    process.env.AIONUI_APP_COMMIT,
    process.env.SOURCE_COMMIT,
    process.env.WORKBENCH_SOURCE_SHA,
  ].find((value) => value?.trim())?.trim();
  let sourceCommit = existing || '';

  if (!sourceCommit) {
    try {
      sourceCommit = execSync('git rev-parse HEAD', {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {}
  }

  if (!sourceCommit) return;

  for (const name of ['EVAOS_APP_COMMIT', 'AIONUI_APP_COMMIT', 'SOURCE_COMMIT', 'WORKBENCH_SOURCE_SHA']) {
    if (!process.env[name]) {
      process.env[name] = sourceCommit;
    }
  }
}

ensureBuildSourceCommitEnv();

try {
  prepareAioncore({ projectRoot, platform, arch, version });
} catch (error) {
  console.error('❌ prepareAioncore failed:', error.message);
  process.exit(1);
}

module.exports = function () {
  try {
    return prepareAioncore({ projectRoot, platform, arch, version });
  } catch (error) {
    console.error('❌ prepareAioncore failed:', error.message);
    throw error;
  }
};
