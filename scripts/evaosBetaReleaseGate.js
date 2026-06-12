#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on', 'evaos-beta']);

const REQUIRED_PUBLIC_BETA_CODE_SIGNING_ENV = [
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
];

const REQUIRED_APPLE_ID_NOTARIZATION_ENV = [
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

const REQUIRED_API_KEY_NOTARIZATION_ENV = [
  {
    name: 'appleApiKey',
    aliases: ['appleApiKey', 'APPLE_API_KEY'],
    description: 'absolute path to App Store Connect API key for notarization',
  },
  {
    name: 'appleApiKeyId',
    aliases: ['appleApiKeyId', 'APPLE_API_KEY_ID'],
    description: 'App Store Connect API key id for notarization',
  },
];

const API_KEY_ISSUER_ENV = {
  name: 'appleApiIssuer',
  aliases: ['appleApiIssuer', 'APPLE_API_ISSUER'],
  description: 'App Store Connect issuer UUID for team API keys',
};

const API_KEY_INDIVIDUAL_ACK_ENV = {
  name: 'APPLE_API_INDIVIDUAL_KEY',
  aliases: ['APPLE_API_INDIVIDUAL_KEY', 'appleApiIndividualKey'],
  description: 'legacy individual App Store Connect API key acknowledgement; not accepted for CI public beta releases',
};

const KEYCHAIN_PROFILE_NOTARIZATION_ENV = {
  name: 'NOTARY_PROFILE',
  aliases: ['NOTARY_PROFILE', 'KEYCHAIN_PROFILE', 'keychainProfile'],
  description: 'notarytool keychain profile for notarization',
};

const REQUIRED_PUBLIC_BETA_SIGNING_ENV = [
  ...REQUIRED_PUBLIC_BETA_CODE_SIGNING_ENV,
  ...REQUIRED_APPLE_ID_NOTARIZATION_ENV,
];
const RELEASE_MANIFEST_NAME = 'evaos-beta-release-manifest.json';
const RC_PROOF_MANIFEST_NAME = 'evaos-beta-rc-proof.json';
const RELEASE_ASSET_EXTS = new Set(['.exe', '.msi', '.dmg', '.deb', '.zip', '.yml']);
const REQUIRED_RC_PROOF_CHECKS = [
  {
    id: 'macos-arm64-codesign',
    evidence: 'codesign-macos-arm64.txt',
    requiredText: ['valid on disk', 'satisfies its Designated Requirement'],
  },
  {
    id: 'macos-arm64-gatekeeper',
    evidence: 'spctl-macos-arm64.txt',
    requiredText: ['accepted'],
  },
  {
    id: 'install-smoke',
    evidence: 'install-smoke.md',
    requiredText: ['PASS', '/Applications/evaOS Workbench Beta.app', 'released fallback app'],
  },
  {
    id: 'launch-smoke',
    evidence: 'launch-smoke.md',
    requiredText: ['PASS', 'evaOS Workbench Beta', 'no upstream AionUi feed'],
  },
  {
    id: 'updater-feed-audit',
    evidence: 'updater-feed-audit.md',
    requiredText: ['PASS', '100yenadmin/evaOS-GUI', 'iOfficeAI/AionUi blocked'],
  },
  {
    id: 'rollback-smoke',
    evidence: 'rollback-smoke.md',
    requiredText: [
      'PASS',
      'beta app absent',
      'released fallback app launched',
      'data/cache disposition',
      'protocol handler state',
      'broker login/session',
    ],
  },
  {
    id: 'support-notes',
    evidence: 'support-notes.md',
    requiredText: ['100yenadmin/evaOS-GUI', 'released macOS app remains the fallback'],
  },
];

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

function hasAny(entries, env) {
  return entries.some((entry) => Boolean(getEnvValue(env, entry)));
}

function hasIndividualApiKeyAck(env) {
  return normalizeBoolean(getEnvValue(env, API_KEY_INDIVIDUAL_ACK_ENV));
}

function formatMissingApiKeyIssuer(env) {
  if (getEnvValue(env, API_KEY_ISSUER_ENV)) {
    return [];
  }
  return [`${API_KEY_ISSUER_ENV.name} (${API_KEY_ISSUER_ENV.description})`];
}

function formatMissingNotarizationEnv(env) {
  const apiKeyMissing = formatMissing(REQUIRED_API_KEY_NOTARIZATION_ENV, env);
  const apiKeyIssuerMissing = apiKeyMissing.length === 0 ? formatMissingApiKeyIssuer(env) : [];
  const hasApiKeyInput =
    hasAny(REQUIRED_API_KEY_NOTARIZATION_ENV, env) ||
    Boolean(getEnvValue(env, API_KEY_ISSUER_ENV)) ||
    hasIndividualApiKeyAck(env);

  if (hasApiKeyInput) {
    return [...apiKeyMissing, ...apiKeyIssuerMissing];
  }

  if (getEnvValue(env, KEYCHAIN_PROFILE_NOTARIZATION_ENV)) {
    return [];
  }

  const appleIdMissing = formatMissing(REQUIRED_APPLE_ID_NOTARIZATION_ENV, env);
  if (appleIdMissing.length === 0) {
    return [];
  }

  if (apiKeyMissing.length === 0 && apiKeyIssuerMissing.length === 0) {
    return [];
  }

  const hasAppleIdInput = hasAny(REQUIRED_APPLE_ID_NOTARIZATION_ENV, env);
  if (hasAppleIdInput && !hasApiKeyInput) {
    return appleIdMissing;
  }

  return [
    `Apple ID notarization path missing: ${appleIdMissing.join(', ')}`,
    `API key notarization path missing: ${[...apiKeyMissing, ...apiKeyIssuerMissing].join(', ')}`,
  ];
}

function assertPublicBetaReleaseSigningEnv(env = process.env) {
  const missing = [...formatMissing(REQUIRED_PUBLIC_BETA_CODE_SIGNING_ENV, env), ...formatMissingNotarizationEnv(env)];
  if (missing.length > 0) {
    throw new Error(`evaOS public beta release requires signing and notarization inputs: ${missing.join(', ')}`);
  }
}

function assertPublicBetaNotarizationEnv(env = process.env) {
  const missing = formatMissingNotarizationEnv(env);
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
  return /(^|-)dev($|[-.])/.test(tag);
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

function getTopLevelYamlSection(text, sectionName) {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${sectionName}:`);
  if (start === -1) {
    return '';
  }

  const section = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && !line.startsWith(' ') && !line.startsWith('-') && !line.startsWith('#')) {
      break;
    }
    section.push(line);
  }
  return section.join('\n');
}

function collectReleaseConfigIssues(rootDir = process.cwd()) {
  const issues = [];
  const packageJson = readJson(rootDir, 'package.json');
  const builder = readText(rootDir, 'packages/desktop/electron-builder.yml');
  const macBuilder = getTopLevelYamlSection(builder, 'mac');
  const winBuilder = getTopLevelYamlSection(builder, 'win');
  const linuxBuilder = getTopLevelYamlSection(builder, 'linux');
  const buildRelease = readText(rootDir, '.github/workflows/build-and-release.yml');
  const prChecks = readText(rootDir, '.github/workflows/pr-checks.yml');
  const distribute = readText(rootDir, '.github/workflows/release-distribute.yml');
  const rcCanary = readText(rootDir, '.github/workflows/evaos-beta-rc-canary.yml');
  const reusableBuild = readText(rootDir, '.github/workflows/_build-reusable.yml');
  const afterSign = readText(rootDir, 'scripts/afterSign.js');
  const prepareAssets = readText(rootDir, 'scripts/prepare-release-assets.sh');
  const rollbackDoc = readText(rootDir, 'docs/evaos/public-beta-packaging-rollback.md');
  const changelog = readText(rootDir, 'CHANGELOG.md');
  const desktopIndex = readText(rootDir, 'packages/desktop/src/index.ts');
  const betaSafety = readText(rootDir, 'packages/desktop/src/process/evaosBetaSafety.ts');
  const webManifest = readText(rootDir, 'public/manifest.webmanifest');
  const rendererHtml = readText(rootDir, 'packages/desktop/src/renderer/index.html');
  const titlebar = readText(rootDir, 'packages/desktop/src/renderer/components/layout/Titlebar/index.tsx');
  const layout = readText(rootDir, 'packages/desktop/src/renderer/components/layout/Layout.tsx');
  const missionControl = readText(rootDir, 'packages/desktop/src/renderer/pages/mission-control/index.tsx');
  const channelModal = readText(
    rootDir,
    'packages/desktop/src/renderer/components/settings/SettingsModal/contents/channels/ChannelModalContent.tsx'
  );
  const tray = readText(rootDir, 'packages/desktop/src/process/utils/tray.ts');
  const about = readText(
    rootDir,
    'packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx'
  );
  const commonEn = readText(rootDir, 'packages/desktop/src/renderer/services/i18n/locales/en-US/common.json');
  const loginEn = readText(rootDir, 'packages/desktop/src/renderer/services/i18n/locales/en-US/login.json');
  const conversationEn = readText(
    rootDir,
    'packages/desktop/src/renderer/services/i18n/locales/en-US/conversation.json'
  );
  const settingsEn = readText(rootDir, 'packages/desktop/src/renderer/services/i18n/locales/en-US/settings.json');

  if (!String(packageJson.version || '').includes('evaos-beta')) {
    issues.push('package.json: version must contain evaos-beta');
  }
  if (packageJson.productName !== 'evaOS Workbench Beta') {
    issues.push('package.json: productName must be evaOS Workbench Beta');
  }

  requireText(builder, 'appId: com.evaos.workbench.beta', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'productName: evaOS Workbench Beta', 'packages/desktop/electron-builder.yml', issues);
  if (/^executableName:/m.test(builder)) {
    issues.push(
      'packages/desktop/electron-builder.yml: top-level executableName must be omitted so macOS bundle filename stays evaOS Workbench Beta.app'
    );
  }
  if (/^\s+executableName:/m.test(macBuilder)) {
    issues.push(
      'packages/desktop/electron-builder.yml: mac.executableName must be omitted so macOS bundle filename stays evaOS Workbench Beta.app'
    );
  }
  requireText(
    macBuilder,
    'notarize: false',
    'packages/desktop/electron-builder.yml',
    issues,
    'mac.notarize false so afterSign owns app notarization'
  );
  requireText(
    winBuilder,
    'executableName: EvaOSWorkbenchBeta',
    'packages/desktop/electron-builder.yml',
    issues,
    'win executableName EvaOSWorkbenchBeta'
  );
  requireText(
    linuxBuilder,
    'executableName: EvaOSWorkbenchBeta',
    'packages/desktop/electron-builder.yml',
    issues,
    'linux executableName EvaOSWorkbenchBeta'
  );
  requireText(builder, 'evaos-workbench-beta', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'owner: 100yenadmin', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'repo: evaOS-GUI', 'packages/desktop/electron-builder.yml', issues);
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
  requireText(distribute, '*"-dev"', '.github/workflows/release-distribute.yml', issues, 'terminal dev tag rejection');
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
  requireText(distribute, 'rc_proof_run_id', '.github/workflows/release-distribute.yml', issues);
  requireText(distribute, 'evaOS Beta RC Canary', '.github/workflows/release-distribute.yml', issues);
  requireText(
    distribute,
    'scripts/evaosBetaReleaseGate.js verify-rc-proof',
    '.github/workflows/release-distribute.yml',
    issues
  );

  requireText(rcCanary, 'name: evaOS Beta RC Canary', '.github/workflows/evaos-beta-rc-canary.yml', issues);
  requireText(rcCanary, 'workflow_dispatch:', '.github/workflows/evaos-beta-rc-canary.yml', issues);
  requireText(rcCanary, 'evaos-beta-rc', '.github/workflows/evaos-beta-rc-canary.yml', issues);
  requireText(rcCanary, 'fallback_release_repo', '.github/workflows/evaos-beta-rc-canary.yml', issues);
  requireText(rcCanary, 'broker_session_proof_ref', '.github/workflows/evaos-beta-rc-canary.yml', issues);
  requireText(
    rcCanary,
    "if (name === 'bundled-aioncore') continue;",
    '.github/workflows/evaos-beta-rc-canary.yml',
    issues,
    'compiled backend binary excluded from shell feed/support grep'
  );
  requireText(
    rcCanary,
    'scripts/evaosBetaReleaseGate.js verify-rc-proof',
    '.github/workflows/evaos-beta-rc-canary.yml',
    issues
  );
  requireText(rcCanary, 'actions/upload-artifact', '.github/workflows/evaos-beta-rc-canary.yml', issues);

  requireText(reusableBuild, 'assert-public-release-env', '.github/workflows/_build-reusable.yml', issues);
  requireText(reusableBuild, 'EVAOS_BETA_REQUIRE_SIGNING', '.github/workflows/_build-reusable.yml', issues);
  requireText(reusableBuild, 'appleApiKey', '.github/workflows/_build-reusable.yml', issues);
  requireText(reusableBuild, 'APPLE_API_KEY_ID', '.github/workflows/_build-reusable.yml', issues);
  requireText(reusableBuild, 'APPLE_API_ISSUER', '.github/workflows/_build-reusable.yml', issues);
  requireText(
    reusableBuild,
    'Preflight macOS notarization credentials',
    '.github/workflows/_build-reusable.yml',
    issues
  );
  requireText(
    reusableBuild,
    'Notarization failed during public beta release',
    '.github/workflows/_build-reusable.yml',
    issues
  );
  requireText(reusableBuild, 'Validate macOS app staple inside DMG', '.github/workflows/_build-reusable.yml', issues);
  requireText(
    reusableBuild,
    'xcrun stapler validate "$APP_PATH"',
    '.github/workflows/_build-reusable.yml',
    issues,
    'mounted app stapler validation'
  );

  requireText(afterSign, 'assertPublicBetaNotarizationEnv', 'scripts/afterSign.js', issues);
  requireText(afterSign, 'buildAppNotarytoolSubmitArgs', 'scripts/afterSign.js', issues);
  requireText(afterSign, 'EVAOS_APP_NOTARY_PROCESS_TIMEOUT_MS', 'scripts/afterSign.js', issues);
  requireText(afterSign, 'getNotarizationOptions', 'scripts/afterSign.js', issues);
  if (afterSign.includes('@electron/notarize')) {
    issues.push('scripts/afterSign.js: afterSign must use the bounded evaOS notarytool path, not @electron/notarize');
  }
  requireText(afterSign, 'module.exports = afterSign', 'scripts/afterSign.js', issues);
  requireText(afterSign, 'stapleAndValidateApp', 'scripts/afterSign.js', issues);
  requireText(afterSign, 'stapler', 'scripts/afterSign.js', issues, 'app-level stapler command');
  requireText(afterSign, '--type', 'scripts/afterSign.js', issues, 'app-level Gatekeeper execute assessment');
  requireText(afterSign, 'appleApiKey', 'scripts/afterSign.js', issues);
  requireText(afterSign, 'EVAOS_BETA_REQUIRE_SIGNING', 'scripts/afterSign.js', issues);
  requireText(afterSign, 'Ad-hoc signing is not allowed', 'scripts/afterSign.js', issues);

  requireText(prChecks, "'evaos/**'", '.github/workflows/pr-checks.yml', issues, 'EVAOS stacked PR branch trigger');

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

  requireText(webManifest, '"name": "evaOS Workbench Beta"', 'public/manifest.webmanifest', issues);
  requireText(webManifest, '"short_name": "evaOS Beta"', 'public/manifest.webmanifest', issues);
  requireText(rendererHtml, 'content="evaOS Workbench Beta"', 'packages/desktop/src/renderer/index.html', issues);
  requireText(rendererHtml, '<title>evaOS Workbench Beta</title>', 'packages/desktop/src/renderer/index.html', issues);
  requireText(titlebar, "const appTitle = useMemo(() => 'evaOS Workbench Beta', []);", 'Titlebar/index.tsx', issues);
  requireText(layout, '>evaOS Workbench Beta</div>', 'Layout.tsx', issues);
  requireText(missionControl, 'Start evaOS Workbench Beta locally', 'mission-control/index.tsx', issues);
  requireText(missionControl, 'evaOS Workbench Beta is the beta shell candidate', 'mission-control/index.tsx', issues);
  if (missionControl.includes('AionUi is the evaOS beta shell candidate')) {
    issues.push('mission-control/index.tsx: public beta gate still exposes upstream AionUi shell copy');
  }
  requireText(channelModal, 'Chat with evaOS Workbench Beta assistant via Telegram', 'ChannelModalContent.tsx', issues);
  requireText(channelModal, 'interact with evaOS Workbench Beta from IM apps', 'ChannelModalContent.tsx', issues);
  requireText(tray, "tray.setToolTip('evaOS Workbench Beta');", 'tray.ts', issues);
  requireText(commonEn, 'Show evaOS Workbench Beta', 'en-US/common.json', issues);
  requireText(commonEn, 'About evaOS Workbench Beta', 'en-US/common.json', issues);
  requireText(commonEn, 'evaOS Workbench Beta installation is incomplete', 'en-US/common.json', issues);
  requireText(loginEn, 'evaOS Workbench Beta - Sign In', 'en-US/login.json', issues);
  requireText(loginEn, '"brand": "evaOS Workbench Beta"', 'en-US/login.json', issues);
  requireText(conversationEn, 'What can evaOS Workbench Beta do?', 'en-US/conversation.json', issues);
  requireText(settingsEn, 'Launch evaOS Workbench Beta automatically', 'en-US/settings.json', issues);
  requireText(settingsEn, 'Beta Repository', 'en-US/settings.json', issues);

  requireText(about, 'evaOS Workbench Beta', 'AboutModalContent.tsx', issues);
  requireText(about, 'https://github.com/100yenadmin/evaOS-GUI', 'AboutModalContent.tsx', issues);
  if (about.includes('https://github.com/iOfficeAI/AionUi') || about.includes('https://www.aionui.com')) {
    issues.push('AboutModalContent.tsx: upstream AionUi support or website link is not allowed in beta About screen');
  }

  requireText(betaSafety, "EVAOS_BETA_DEFAULT_GITHUB_REPO = '100yenadmin/evaOS-GUI'", 'evaosBetaSafety.ts', issues);
  requireText(betaSafety, 'getEvaosBetaBackendGithubRepo', 'evaosBetaSafety.ts', issues);
  requireText(desktopIndex, 'getEvaosBetaBackendGithubRepo', 'packages/desktop/src/index.ts', issues);
  requireText(
    desktopIndex,
    'process.env.AIONUI_GITHUB_REPO = betaBackendGithubRepo',
    'packages/desktop/src/index.ts',
    issues,
    'aioncore GitHub repo process env override for evaOS beta'
  );

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
    releaseWorkflow: env.EVAOS_BETA_RELEASE_WORKFLOW || env.GITHUB_WORKFLOW || '',
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

function requireExistingRelativeFile(rootDir, relativePath, label) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('..')) {
    throw new Error(`${label} must be a safe relative path.`);
  }

  const filePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} is missing: ${relativePath}`);
  }

  return filePath;
}

function assertTextMarkers(filePath, requiredText, label) {
  const text = fs.readFileSync(filePath, 'utf8');
  const missing = requiredText.filter((needle) => !text.includes(needle));
  if (missing.length > 0) {
    throw new Error(`${label} evidence ${filePath} is missing required text: ${missing.join(', ')}`);
  }
}

function assertSameStringArray(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    throw new Error(`${label} requiredText must match the built-in RC proof gate markers.`);
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (actual[i] !== expected[i]) {
      throw new Error(`${label} requiredText must match the built-in RC proof gate markers.`);
    }
  }
}

function assertConcreteBlockedReason(reason, label) {
  const normalized = String(reason || '').trim();
  if (normalized.length < 20) {
    throw new Error(`${label} blocker must include a concrete reason.`);
  }
  if (/replace with|placeholder|exact reason|out of beta scope/i.test(normalized)) {
    throw new Error(`${label} blocker must replace the template placeholder with concrete evidence.`);
  }
}

function writeRcProofTemplate(proofDir, tag) {
  assertPublicDistributionTag(tag);
  fs.mkdirSync(proofDir, { recursive: true });

  const manifest = {
    schema: 'evaos-beta-rc-proof/v1',
    tag,
    repository: '100yenadmin/evaOS-GUI',
    releaseAssetsDir: 'release-assets',
    trustedManifestPath: 'trusted-manifest/evaos-beta-release-manifest.json',
    macosX64: {
      status: 'blocked',
      reason:
        'Replace with pass plus codesign/spctl evidence, or keep blocked with the exact reason x64 is out of beta scope.',
    },
    checks: REQUIRED_RC_PROOF_CHECKS.map((check) => ({
      id: check.id,
      status: 'pending',
      evidence: check.evidence,
      requiredText: check.requiredText,
    })),
  };

  writeJson(path.join(proofDir, RC_PROOF_MANIFEST_NAME), manifest);

  for (const check of REQUIRED_RC_PROOF_CHECKS) {
    const templatePath = path.join(proofDir, check.evidence);
    if (fs.existsSync(templatePath)) continue;
    fs.writeFileSync(
      templatePath,
      [
        `# ${check.id}`,
        '',
        'Status: pending',
        '',
        'Replace this template with command output or a short smoke transcript.',
        `Required text markers: ${check.requiredText.join(', ')}`,
        '',
      ].join('\n')
    );
  }

  return manifest;
}

function verifyRcProof(proofDir, tag, env = process.env) {
  const manifestPath = requireExistingRelativeFile(proofDir, RC_PROOF_MANIFEST_NAME, 'RC proof manifest');
  const manifest = readManifestFile(manifestPath);

  if (manifest.schema !== 'evaos-beta-rc-proof/v1') {
    throw new Error(`Unexpected RC proof schema: ${manifest.schema}`);
  }
  assertPublicDistributionTag(tag);
  if (manifest.tag !== tag) {
    throw new Error(`RC proof tag ${manifest.tag} does not match requested tag ${tag}.`);
  }
  if (manifest.repository !== '100yenadmin/evaOS-GUI') {
    throw new Error(`RC proof repository must be 100yenadmin/evaOS-GUI, got ${manifest.repository}.`);
  }

  const releaseAssetsDir = manifest.releaseAssetsDir || 'release-assets';
  if (path.isAbsolute(releaseAssetsDir) || releaseAssetsDir.includes('..')) {
    throw new Error('releaseAssetsDir must be a safe relative path.');
  }
  const resolvedReleaseAssetsDir = path.join(proofDir, releaseAssetsDir);
  if (!fs.existsSync(resolvedReleaseAssetsDir) || !fs.statSync(resolvedReleaseAssetsDir).isDirectory()) {
    throw new Error(`RC proof release assets directory is missing: ${releaseAssetsDir}`);
  }
  requireExistingRelativeFile(resolvedReleaseAssetsDir, RELEASE_MANIFEST_NAME, 'RC proof release manifest');

  const trustedManifestRelativePath = manifest.trustedManifestPath || '';
  const trustedManifestPath = requireExistingRelativeFile(
    proofDir,
    trustedManifestRelativePath,
    'RC proof trusted release manifest'
  );
  verifyReleaseManifest(resolvedReleaseAssetsDir, tag, {
    ...env,
    EVAOS_BETA_TRUSTED_MANIFEST_PATH: trustedManifestPath,
  });

  const checksById = new Map((manifest.checks || []).map((check) => [check.id, check]));
  for (const required of REQUIRED_RC_PROOF_CHECKS) {
    const check = checksById.get(required.id);
    if (!check) {
      throw new Error(`RC proof is missing check: ${required.id}`);
    }
    if (check.evidence !== required.evidence) {
      throw new Error(`RC proof check ${required.id} evidence path must be ${required.evidence}.`);
    }
    assertSameStringArray(check.requiredText, required.requiredText, required.id);
    if (check.status !== 'pass') {
      throw new Error(`RC proof check ${required.id} must be pass, got ${check.status || 'missing'}.`);
    }
    const filePath = requireExistingRelativeFile(proofDir, required.evidence, `RC proof ${required.id}`);
    assertTextMarkers(filePath, required.requiredText, required.id);
  }

  if (manifest.macosX64?.status === 'blocked') {
    assertConcreteBlockedReason(manifest.macosX64.reason, 'macOS x64');
  } else if (manifest.macosX64?.status === 'pass') {
    const codesignPath = requireExistingRelativeFile(proofDir, 'codesign-macos-x64.txt', 'macOS x64 codesign proof');
    assertTextMarkers(codesignPath, ['valid on disk', 'satisfies its Designated Requirement'], 'macos-x64-codesign');
    const spctlPath = requireExistingRelativeFile(proofDir, 'spctl-macos-x64.txt', 'macOS x64 Gatekeeper proof');
    assertTextMarkers(spctlPath, ['accepted'], 'macos-x64-gatekeeper');
  } else {
    throw new Error('macOS x64 proof must be pass with codesign/spctl evidence or blocked with a concrete reason.');
  }

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

  if (command === 'write-rc-proof-template') {
    const proofDir = process.argv[3];
    const tag = process.argv[4] || process.env.TAG_NAME || '';
    if (!proofDir || !tag) {
      throw new Error('Usage: evaosBetaReleaseGate.js write-rc-proof-template <proof-dir> <tag>');
    }
    writeRcProofTemplate(proofDir, tag);
    console.log(`Wrote ${path.join(proofDir, RC_PROOF_MANIFEST_NAME)}.`);
    return;
  }

  if (command === 'verify-rc-proof') {
    const proofDir = process.argv[3];
    const tag = process.argv[4] || process.env.TAG_NAME || '';
    if (!proofDir || !tag) {
      throw new Error('Usage: evaosBetaReleaseGate.js verify-rc-proof <proof-dir> <tag>');
    }
    verifyRcProof(proofDir, tag, process.env);
    console.log('evaOS beta release candidate proof verification passed.');
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
  verifyRcProof,
  normalizeBoolean,
  writeRcProofTemplate,
};
