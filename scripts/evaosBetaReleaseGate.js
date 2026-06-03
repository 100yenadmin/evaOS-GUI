#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on', 'evaos-beta']);

const REQUIRED_PUBLIC_BETA_SIGNING_ENV = [
  {
    name: 'BUILD_CERTIFICATE_BASE64',
    aliases: ['BUILD_CERTIFICATE_BASE64'],
    description: 'base64 encoded Developer ID certificate',
  },
  {
    name: 'P12_PASSWORD',
    aliases: ['P12_PASSWORD'],
    description: 'Developer ID certificate password',
  },
  {
    name: 'identity',
    aliases: ['identity', 'IDENTITY', 'CSC_NAME'],
    description: 'Developer ID Application signing identity',
  },
  {
    name: 'appleId',
    aliases: ['appleId', 'APPLE_ID'],
    description: 'Apple ID used for notarization',
  },
  {
    name: 'appleIdPassword',
    aliases: ['appleIdPassword', 'APPLE_ID_PASSWORD'],
    description: 'Apple app-specific password used for notarization',
  },
  {
    name: 'teamId',
    aliases: ['teamId', 'TEAM_ID'],
    description: 'Apple Developer Team ID',
  },
];

const REQUIRED_NOTARIZATION_ENV = REQUIRED_PUBLIC_BETA_SIGNING_ENV.filter((entry) =>
  ['appleId', 'appleIdPassword', 'teamId'].includes(entry.name)
);
const RELEASE_MANIFEST_NAME = 'evaos-beta-release-manifest.json';
const RELEASE_ASSET_EXTS = new Set(['.exe', '.msi', '.dmg', '.deb', '.zip', '.yml']);

function normalizeBoolean(value) {
  return TRUTHY_VALUES.has(
    String(value || '')
      .trim()
      .toLowerCase()
  );
}

function isStrictPublicBetaReleaseEnv(env = process.env) {
  return normalizeBoolean(env.EVAOS_BETA_PUBLIC_RELEASE) || normalizeBoolean(env.EVAOS_BETA_REQUIRE_SIGNING);
}

function getEnvValue(env, entry) {
  for (const key of entry.aliases) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function formatMissing(entries, env) {
  return entries.filter((entry) => !getEnvValue(env, entry)).map((entry) => `${entry.name} (${entry.description})`);
}

function assertPublicBetaReleaseSigningEnv(env = process.env) {
  const missing = formatMissing(REQUIRED_PUBLIC_BETA_SIGNING_ENV, env);
  if (missing.length > 0) {
    throw new Error(`evaOS public beta release requires signing and notarization inputs: ${missing.join(', ')}`);
  }
}

function assertPublicBetaNotarizationEnv(env = process.env) {
  const missing = formatMissing(REQUIRED_NOTARIZATION_ENV, env);
  if (missing.length > 0) {
    throw new Error(`evaOS public beta release requires notarization inputs: ${missing.join(', ')}`);
  }
}

function readText(rootDir, relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function readJson(rootDir, relativePath) {
  return JSON.parse(readText(rootDir, relativePath));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listReleaseAssetFiles(outputDir) {
  return fs
    .readdirSync(outputDir)
    .filter((name) => name !== RELEASE_MANIFEST_NAME)
    .filter((name) => RELEASE_ASSET_EXTS.has(path.extname(name)))
    .toSorted();
}

function isEvaosBetaTag(tag) {
  return /^evaos-beta-v?\d+\.\d+\.\d+/.test(tag);
}

function betaTagVersion(tag) {
  let version = String(tag || '').replace(/^evaos-beta-/, '');
  if (version.startsWith('v')) {
    version = version.slice(1);
  }
  return version;
}

function hasEvaosBetaVersionMarker(tag) {
  return betaTagVersion(tag).includes('evaos-beta');
}

function isDevBetaTag(tag) {
  return /(^|-)dev-/.test(tag) || /-dev\./.test(tag);
}

function assertEvaosBetaReleaseTag(tag) {
  if (!isEvaosBetaTag(tag)) {
    throw new Error(`Refusing to distribute non-evaOS beta tag: ${tag}`);
  }
  if (!hasEvaosBetaVersionMarker(tag)) {
    throw new Error(`Refusing to distribute tag without evaos-beta version marker: ${tag}`);
  }
}

function assertPublicDistributionTag(tag) {
  assertEvaosBetaReleaseTag(tag);
  if (isDevBetaTag(tag)) {
    throw new Error(`Refusing to distribute development beta tag: ${tag}`);
  }
}

function requireText(text, needle, relativePath, issues, reason) {
  if (!text.includes(needle)) {
    issues.push(`${relativePath}: missing ${reason || needle}`);
  }
}

function collectReleaseConfigIssues(rootDir = process.cwd()) {
  const issues = [];
  const packageJson = readJson(rootDir, 'package.json');
  const builder = readText(rootDir, 'packages/desktop/electron-builder.yml');
  const buildRelease = readText(rootDir, '.github/workflows/build-and-release.yml');
  const distribute = readText(rootDir, '.github/workflows/release-distribute.yml');
  const reusableBuild = readText(rootDir, '.github/workflows/_build-reusable.yml');
  const afterSign = readText(rootDir, 'scripts/afterSign.js');
  const prepareAssets = readText(rootDir, 'scripts/prepare-release-assets.sh');
  const rollbackDoc = readText(rootDir, 'docs/evaos/public-beta-packaging-rollback.md');
  const changelog = readText(rootDir, 'CHANGELOG.md');
  const about = readText(
    rootDir,
    'packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx'
  );

  if (!String(packageJson.version || '').includes('evaos-beta')) {
    issues.push('package.json: version must contain evaos-beta');
  }
  if (packageJson.productName !== 'evaOS Workbench Beta') {
    issues.push('package.json: productName must be evaOS Workbench Beta');
  }

  requireText(builder, 'appId: com.evaos.workbench.beta', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'productName: evaOS Workbench Beta', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'executableName: EvaOSWorkbenchBeta', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'evaos-workbench-beta', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'owner: 100yenadmin', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'repo: AionUi', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'publishAutoUpdate: false', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'releaseType: draft', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'resources/evaos-beta/app.png', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'resources/evaos-beta/app.icns', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'resources/evaos-beta/app.ico', 'packages/desktop/electron-builder.yml', issues);

  requireText(buildRelease, 'workflow_dispatch:', '.github/workflows/build-and-release.yml', issues);
  requireText(buildRelease, "beta_release_ack == 'evaos-beta'", '.github/workflows/build-and-release.yml', issues);
  requireText(
    buildRelease,
    "vars.EVAOS_BETA_RELEASE_PUBLISH_ENABLED == 'true'",
    '.github/workflows/build-and-release.yml',
    issues
  );
  requireText(buildRelease, 'EVAOS_BETA_RELEASE_BRANCH', '.github/workflows/build-and-release.yml', issues);
  requireText(
    buildRelease,
    'scripts/evaosBetaReleaseGate.js audit-config',
    '.github/workflows/build-and-release.yml',
    issues
  );
  requireText(
    buildRelease,
    'scripts/evaosBetaReleaseGate.js write-manifest',
    '.github/workflows/build-and-release.yml',
    issues
  );
  requireText(
    buildRelease,
    'scripts/verify-release-assets.sh release-assets',
    '.github/workflows/build-and-release.yml',
    issues
  );
  requireText(
    buildRelease,
    'actions/upload-artifact',
    '.github/workflows/build-and-release.yml',
    issues,
    'trusted release manifest artifact upload'
  );

  requireText(distribute, "beta_distribution_ack == 'evaos-beta'", '.github/workflows/release-distribute.yml', issues);
  requireText(
    distribute,
    "vars.EVAOS_BETA_RELEASE_PUBLISH_ENABLED == 'true'",
    '.github/workflows/release-distribute.yml',
    issues
  );
  requireText(distribute, 'evaos-beta-*', '.github/workflows/release-distribute.yml', issues);
  requireText(
    distribute,
    'Refusing to distribute non-evaOS beta tag',
    '.github/workflows/release-distribute.yml',
    issues
  );
  requireText(
    distribute,
    'Refusing to distribute upstream AionUi asset',
    '.github/workflows/release-distribute.yml',
    issues
  );
  requireText(
    distribute,
    'Refusing to distribute development beta tag',
    '.github/workflows/release-distribute.yml',
    issues
  );
  requireText(distribute, 'merge-base --is-ancestor', '.github/workflows/release-distribute.yml', issues);
  requireText(
    distribute,
    'scripts/evaosBetaReleaseGate.js verify-manifest',
    '.github/workflows/release-distribute.yml',
    issues
  );
  requireText(
    distribute,
    'gh run download',
    '.github/workflows/release-distribute.yml',
    issues,
    'trusted release manifest artifact download'
  );
  requireText(distribute, 'EVAOS_BETA_TRUSTED_MANIFEST_PATH', '.github/workflows/release-distribute.yml', issues);
  requireText(distribute, 'scripts/verify-release-assets.sh dist', '.github/workflows/release-distribute.yml', issues);

  requireText(reusableBuild, 'assert-public-release-env', '.github/workflows/_build-reusable.yml', issues);
  requireText(reusableBuild, 'EVAOS_BETA_REQUIRE_SIGNING', '.github/workflows/_build-reusable.yml', issues);
  requireText(
    reusableBuild,
    'Notarization failed during public beta release',
    '.github/workflows/_build-reusable.yml',
    issues
  );

  requireText(afterSign, 'assertPublicBetaNotarizationEnv', 'scripts/afterSign.js', issues);
  requireText(afterSign, 'EVAOS_BETA_REQUIRE_SIGNING', 'scripts/afterSign.js', issues);
  requireText(afterSign, 'Ad-hoc signing is not allowed', 'scripts/afterSign.js', issues);

  requireText(prepareAssets, 'Refusing upstream-branded beta asset', 'scripts/prepare-release-assets.sh', issues);
  requireText(
    prepareAssets,
    'Refusing beta asset without evaOS beta identity marker',
    'scripts/prepare-release-assets.sh',
    issues
  );

  requireText(rollbackDoc, 'com.evaos.workbench.beta', 'docs/evaos/public-beta-packaging-rollback.md', issues);
  requireText(rollbackDoc, 'Rollback', 'docs/evaos/public-beta-packaging-rollback.md', issues);
  requireText(rollbackDoc, 'Support', 'docs/evaos/public-beta-packaging-rollback.md', issues);
  requireText(rollbackDoc, 'Operator rollback proof commands', 'docs/evaos/public-beta-packaging-rollback.md', issues);
  requireText(rollbackDoc, 'lsregister -dump', 'docs/evaos/public-beta-packaging-rollback.md', issues);

  requireText(changelog, 'Public Beta Packaging', 'CHANGELOG.md', issues);
  requireText(changelog, 'real macOS signing/notarization', 'CHANGELOG.md', issues);
  requireText(changelog, 'validates release provenance', 'CHANGELOG.md', issues);

  requireText(about, 'evaOS Workbench Beta', 'AboutModalContent.tsx', issues);
  requireText(about, 'https://github.com/100yenadmin/AionUi', 'AboutModalContent.tsx', issues);
  if (about.includes('https://github.com/iOfficeAI/AionUi') || about.includes('https://www.aionui.com')) {
    issues.push('AboutModalContent.tsx: upstream AionUi support or website link is not allowed in beta About screen');
  }

  return issues;
}

function assertReleaseConfig(rootDir = process.cwd()) {
  const issues = collectReleaseConfigIssues(rootDir);
  if (issues.length > 0) {
    throw new Error(`evaOS beta release config audit failed:\n- ${issues.join('\n- ')}`);
  }
  return true;
}

function createReleaseManifest(outputDir, tag, env = process.env) {
  assertEvaosBetaReleaseTag(tag);

  const assets = listReleaseAssetFiles(outputDir).map((name) => {
    const filePath = path.join(outputDir, name);
    return {
      name,
      size: fs.statSync(filePath).size,
      sha256: sha256File(filePath),
    };
  });

  const manifest = {
    schema: 'evaos-beta-release-manifest/v1',
    tag,
    developmentTag: isDevBetaTag(tag),
    repository: env.GITHUB_REPOSITORY || '',
    releaseWorkflow: env.GITHUB_WORKFLOW || '',
    releaseRunId: env.GITHUB_RUN_ID || '',
    releaseRunAttempt: env.GITHUB_RUN_ATTEMPT || '',
    releaseCommit: env.EVAOS_BETA_RELEASE_COMMIT || env.GITHUB_SHA || '',
    releaseBranch: env.EVAOS_BETA_RELEASE_BRANCH || '',
    publicBeta: normalizeBoolean(env.EVAOS_BETA_RELEASE_PUBLISH_ENABLED),
    signing: {
      required: true,
      macos: {
        developerIdRequired: true,
        notarizationRequired: true,
        adHocAllowed: false,
      },
    },
    updater: {
      publishAutoUpdate: false,
      upstreamFeedAllowed: false,
    },
    assets,
  };

  writeJson(path.join(outputDir, RELEASE_MANIFEST_NAME), manifest);
  return manifest;
}

function readManifest(outputDir) {
  return JSON.parse(fs.readFileSync(path.join(outputDir, RELEASE_MANIFEST_NAME), 'utf8'));
}

function readManifestFile(manifestPath) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function canonicalManifestJson(manifest) {
  return JSON.stringify(manifest);
}

function selectTrustedManifest(outputDir, env = process.env) {
  const releaseManifest = readManifest(outputDir);
  const trustedManifestPath = env.EVAOS_BETA_TRUSTED_MANIFEST_PATH || '';

  if (!trustedManifestPath) {
    return releaseManifest;
  }

  const trustedManifest = readManifestFile(trustedManifestPath);
  if (canonicalManifestJson(releaseManifest) !== canonicalManifestJson(trustedManifest)) {
    throw new Error(
      `Release manifest ${path.join(outputDir, RELEASE_MANIFEST_NAME)} does not match trusted workflow artifact ${trustedManifestPath}.`
    );
  }

  return trustedManifest;
}

function verifyGitHubRun(manifest, env = process.env) {
  if (normalizeBoolean(env.EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY)) return;

  if (!manifest.releaseRunId) {
    throw new Error('Release manifest is missing releaseRunId.');
  }

  const repo = manifest.repository || env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new Error('Release manifest is missing repository.');
  }

  const runJson = execFileSync(
    'gh',
    ['run', 'view', String(manifest.releaseRunId), '--repo', repo, '--json', 'conclusion,headSha,workflowName,event'],
    { encoding: 'utf8' }
  );
  const run = JSON.parse(runJson);
  if (run.conclusion !== 'success') {
    throw new Error(`Release workflow run ${manifest.releaseRunId} did not succeed.`);
  }
  if (run.workflowName !== 'Build and Release') {
    throw new Error(`Release manifest references unexpected workflow: ${run.workflowName}`);
  }
  if (run.event !== 'workflow_dispatch') {
    throw new Error(`Release workflow run was not manually dispatched: ${run.event}`);
  }
  if (manifest.releaseCommit && run.headSha !== manifest.releaseCommit) {
    throw new Error(
      `Release workflow run head ${run.headSha} does not match manifest commit ${manifest.releaseCommit}.`
    );
  }
}

function verifyReleaseManifest(outputDir, tag, env = process.env) {
  assertPublicDistributionTag(tag);

  const manifest = selectTrustedManifest(outputDir, env);
  if (manifest.schema !== 'evaos-beta-release-manifest/v1') {
    throw new Error(`Unexpected release manifest schema: ${manifest.schema}`);
  }
  if (manifest.tag !== tag) {
    throw new Error(`Release manifest tag ${manifest.tag} does not match requested tag ${tag}.`);
  }
  if (env.GITHUB_REPOSITORY && manifest.repository !== env.GITHUB_REPOSITORY) {
    throw new Error(`Release manifest repository ${manifest.repository} does not match ${env.GITHUB_REPOSITORY}.`);
  }
  if (manifest.releaseWorkflow !== 'Build and Release') {
    throw new Error(`Release manifest was not produced by Build and Release: ${manifest.releaseWorkflow}`);
  }
  if (!manifest.publicBeta) {
    throw new Error('Release manifest was not produced with public beta publishing enabled.');
  }
  if (!manifest.signing?.required || !manifest.signing?.macos?.notarizationRequired) {
    throw new Error('Release manifest does not require macOS signing/notarization.');
  }
  if (manifest.signing?.macos?.adHocAllowed) {
    throw new Error('Release manifest allows ad-hoc signing for public beta.');
  }

  const expectedCommit = env.EXPECTED_RELEASE_COMMIT || '';
  if (expectedCommit && manifest.releaseCommit !== expectedCommit) {
    throw new Error(`Release manifest commit ${manifest.releaseCommit} does not match tag commit ${expectedCommit}.`);
  }

  const manifestAssets = new Map((manifest.assets || []).map((asset) => [asset.name, asset]));
  const actualAssets = listReleaseAssetFiles(outputDir);
  if (!actualAssets.some((name) => name.endsWith('.dmg'))) {
    throw new Error('Release manifest verification requires at least one macOS DMG asset.');
  }
  if (!actualAssets.some((name) => name.endsWith('.zip'))) {
    throw new Error('Release manifest verification requires at least one macOS ZIP asset.');
  }
  if (!actualAssets.some((name) => name.endsWith('.yml'))) {
    throw new Error('Release manifest verification requires updater metadata.');
  }

  for (const actual of actualAssets) {
    const asset = manifestAssets.get(actual);
    if (!asset) {
      throw new Error(`Release manifest does not list asset: ${actual}`);
    }
    const filePath = path.join(outputDir, actual);
    const size = fs.statSync(filePath).size;
    const sha256 = sha256File(filePath);
    if (asset.size !== size || asset.sha256 !== sha256) {
      throw new Error(`Release asset does not match manifest checksum: ${actual}`);
    }
  }

  for (const name of manifestAssets.keys()) {
    if (!actualAssets.includes(name)) {
      throw new Error(`Release manifest lists missing asset: ${name}`);
    }
  }

  verifyGitHubRun(manifest, env);
  return true;
}

function main() {
  const command = process.argv[2] || 'audit-config';

  if (command === 'audit-config') {
    assertReleaseConfig(process.cwd());
    console.log('evaOS beta release config audit passed.');
    return;
  }

  if (command === 'assert-public-release-env') {
    if (!isStrictPublicBetaReleaseEnv(process.env)) {
      console.log('evaOS public beta signing enforcement is disabled for this smoke build.');
      return;
    }
    assertPublicBetaReleaseSigningEnv(process.env);
    console.log('evaOS public beta signing/notarization inputs are present.');
    return;
  }

  if (command === 'write-manifest') {
    const outputDir = process.argv[3];
    const tag = process.argv[4] || process.env.TAG_NAME || '';
    if (!outputDir || !tag) {
      throw new Error('Usage: evaosBetaReleaseGate.js write-manifest <release-assets-dir> <tag>');
    }
    createReleaseManifest(outputDir, tag, process.env);
    console.log(`Wrote ${path.join(outputDir, RELEASE_MANIFEST_NAME)}.`);
    return;
  }

  if (command === 'verify-manifest') {
    const outputDir = process.argv[3];
    const tag = process.argv[4] || process.env.TAG_NAME || '';
    if (!outputDir || !tag) {
      throw new Error('Usage: evaosBetaReleaseGate.js verify-manifest <release-assets-dir> <tag>');
    }
    verifyReleaseManifest(outputDir, tag, process.env);
    console.log('evaOS beta release manifest verification passed.');
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  REQUIRED_PUBLIC_BETA_SIGNING_ENV,
  assertPublicBetaNotarizationEnv,
  assertPublicBetaReleaseSigningEnv,
  assertReleaseConfig,
  assertPublicDistributionTag,
  collectReleaseConfigIssues,
  createReleaseManifest,
  getEnvValue,
  isStrictPublicBetaReleaseEnv,
  verifyReleaseManifest,
  normalizeBoolean,
};
