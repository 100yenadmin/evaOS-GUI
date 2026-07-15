#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');
const { bridgeWrapperScript } = require('./prepareEvaosDesktopBridgeResource');
const {
  PUBLIC_ATTESTATION_ENVELOPE_FIELDS,
  verifyMacControlPublicAttestation,
} = require('./evaosMacControlSignedProof');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKBENCH_BRIDGE_SOURCE_DIR = 'resources/evaos-beta/bridge/src/evaos_desktop_bridge';
const committedBridgeSourceIdentityCache = new Map();

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on', 'evaos-beta']);
const LIVE_CANARY_VERIFIER_SHA256 = '701828332e3c35497294359980944e7021064384a6a0304157af7885897462bd';
const FUNCTIONAL_SMOKE_SHAPE_RUN_SHA256 = '7d3bc23e52e3e342782b2903664572b15754782db4e67155cdb869c4c8d93d3b';

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
const MACOS_UPDATE_MINIMUM_SYSTEM_VERSION = '24.0.0';
const RC_PROOF_MANIFEST_NAME = 'evaos-beta-rc-proof.json';
const BROKER_LIVE_CANARY_PROOF_NAME = 'broker-runtime-status.json';
const BUSINESS_BROWSER_LIVE_CANARY_PROOF_NAME = 'business-browser.json';
const MAC_CONTROL_LIVE_CANARY_PROOF_NAME = 'mac-control-runtime.json';
const MAC_CONTROL_NEGATIVE_PROOF_NAME = 'mac-control-runtime-negative.json';
const MAC_CONTROL_DEPLOYED_PROBE_NAME = 'mac-control-deployed-route.json';
const MAC_CONTROL_PROVISION_PROOF_NAME = 'mac-control-session-provisioning.json';
const MAC_CONTROL_CLEANUP_PROOF_NAME = 'mac-control-session-cleanup.json';
const RELEASE_ASSET_EXTS = new Set(['.exe', '.msi', '.dmg', '.deb', '.zip', '.yml']);
const RELEASE_PROVENANCE_GITHUB_WORKFLOW = 'github-release-workflow';
const RELEASE_PROVENANCE_LOCAL_SIGNED_DMG_FALLBACK = 'local-signed-dmg-fallback';
const LOCAL_SIGNED_DMG_FALLBACK_ACK = 'evaos-local-signed-dmg';
const PEEKABOO_PACKAGE_VERSION = '3.8.0';
const PEEKABOO_SOURCE_SHA256 = '4a5c7e28c263c84e406aa1853ef62cad3042b13f40a7a9e044ec74ec42933383';
const PEEKABOO_LICENSE_PATH = 'licenses/Peekaboo-LICENSE.txt';
const PYTHON_RUNTIME_VERSION = '3.12.13';
const PYTHON_RUNTIME_SOURCE_SHA256 = {
  arm64: '5a30271f8d345a5b02b0c9e4e31e0f1e1455a8e4a04fba95cd9762472abc3b17',
  x64: 'cd369e76973c3179bc578230d8615ab621968ed758c5e32f636eecef4ad79894',
};
const PYTHON_RUNTIME_SOURCE_URL = {
  arm64:
    'https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython-3.12.13+20260510-aarch64-apple-darwin-install_only.tar.gz',
  x64: 'https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython-3.12.13+20260510-x86_64-apple-darwin-install_only.tar.gz',
};
const PYTHON_RUNTIME_LICENSE_PATH = 'licenses/CPython-LICENSE.txt';
const PYTHON_RUNTIME_LICENSE_SHA256 = '3b2f81fe21d181c499c59a256c8e1968455d6689d269aa85373bfb6af41da3bf';
const PYTHON_RUNTIME_PACKAGES = [
  ['pyobjc-core', '12.2.1', 'a64232bb27ed101d4adc7d42b0e64a6d3331aac7bee7861c037a6777a163f10b'],
  ['pyobjc-framework-Cocoa', '12.2.1', '28b9b8bab1c36efb94744786918752d0c1842f5fbb67e7d5ca97b5f736512080'],
  ['pyobjc-framework-Quartz', '12.2.1', 'de9c8cca7e95290c8d540466af11c7cdfe3a5458e6f56c34006d5b45243f9ed9'],
  [
    'pyobjc-framework-ApplicationServices',
    '12.2.1',
    'f519ced13888d03410cd7da1f08fc56ee2944099e607216cef7ca26ecfdef61b',
  ],
  ['pyobjc-framework-CoreText', '12.2.1', 'ac2ead13dfa4379a1566129d0e8a8ea778a2bcac9ac360a583360fd4f1ba39c6'],
].map(([name, version, sha256]) => ({ name, version, sha256 }));
const REQUIRED_RC_PROOF_CHECKS = [
  {
    id: 'macos-arm64-dmg-codesign',
    evidence: 'codesign-dmg-macos-arm64.txt',
    requiredText: ['valid on disk'],
  },
  {
    id: 'macos-arm64-dmg-stapler',
    evidence: 'stapler-dmg-macos-arm64.txt',
    requiredText: ['The validate action worked'],
  },
  {
    id: 'macos-arm64-dmg-gatekeeper',
    evidence: 'spctl-dmg-macos-arm64.txt',
    requiredText: ['accepted'],
  },
  {
    id: 'macos-arm64-codesign',
    evidence: 'codesign-macos-arm64.txt',
    requiredText: ['valid on disk', 'satisfies its Designated Requirement'],
  },
  {
    id: 'macos-arm64-app-stapler',
    evidence: 'stapler-macos-arm64.txt',
    requiredText: ['The validate action worked'],
  },
  {
    id: 'macos-arm64-gatekeeper',
    evidence: 'spctl-macos-arm64.txt',
    requiredText: ['accepted'],
  },
  {
    id: 'macos-arm64-updater-zip-trust',
    evidence: 'updater-zip-macos-arm64.json',
    requiredText: [
      'evaos-updater-zip-trust/v2',
      '"bundleId": "com.evaos.workbench"',
      '"productName": "evaOS Workbench"',
      '"shortVersion":',
      '"bundleVersion":',
      '"codesignVerified": true',
      '"staplerVerified": true',
      '"gatekeeperVerified": true',
    ],
  },
  {
    id: 'macos-arm64-updater-zip-codesign',
    evidence: 'codesign-updater-zip-macos-arm64.txt',
    requiredText: ['valid on disk', 'satisfies its Designated Requirement'],
  },
  {
    id: 'macos-arm64-updater-zip-stapler',
    evidence: 'stapler-updater-zip-macos-arm64.txt',
    requiredText: ['The validate action worked'],
  },
  {
    id: 'macos-arm64-updater-zip-gatekeeper',
    evidence: 'spctl-updater-zip-macos-arm64.txt',
    requiredText: ['accepted'],
  },
  {
    id: 'install-smoke',
    evidence: 'install-smoke.md',
    requiredText: ['PASS', '/Applications/evaOS Workbench.app', 'released fallback app'],
  },
  {
    id: 'installed-candidate-pre-canary',
    evidence: 'installed-candidate-pre-canary.json',
    requiredText: [
      '"ok": true',
      'packaged_bridge_source_integrity_verified',
      '"source_integrity_valid": true',
      'com.evaos.workbench',
    ],
  },
  {
    id: 'installed-candidate-connector',
    evidence: 'installed-candidate-connector.json',
    requiredText: [
      '"ok": true',
      'control_start.bridge_status',
      'control_start.full_access',
      'control_start.ask_permission',
      'control_start.stop',
      'control_start.kill_switch',
      'control_cleanup.local_kill_switch',
      '"source_commit_under_test"',
      '"candidate_binding"',
    ],
  },
  {
    id: 'launch-smoke',
    evidence: 'launch-smoke.md',
    requiredText: ['PASS', 'evaOS Workbench', 'evaos-workbench', 'no upstream AionUi feed'],
  },
  {
    id: 'protocol-identity',
    evidence: 'protocol-identity.md',
    requiredText: ['PASS', 'evaos-workbench', 'com.evaos.workbench'],
  },
  {
    id: 'installed-app-path-hygiene',
    evidence: 'installed-app-path-hygiene.md',
    requiredText: [
      'PASS',
      'exact app path',
      '/Applications/evaOS Workbench.app',
      'no stale indexed Workbench apps',
      'no stale running Workbench apps',
      'Computer Use exact path rule',
      'OpenClaw bridge tools',
    ],
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
      'candidate app rolled back',
      'released fallback app launched',
      'data/cache disposition',
      'protocol handler state',
      'evaos-workbench',
      'com.evaos.workbench',
      'broker login/session',
    ],
  },
  {
    id: 'support-notes',
    evidence: 'support-notes.md',
    requiredText: ['100yenadmin/evaOS-GUI', 'released macOS app remains the fallback'],
  },
];
const RC_RELEASE_ASSETS_REFERENCE_NAME = 'release-assets-reference.json';
const REQUIRED_BROKER_LIVE_CANARY_SURFACES = Object.freeze([
  Object.freeze({ surface: 'evaos', runtime: 'openclaw' }),
  Object.freeze({ surface: 'hermes', runtime: 'hermes' }),
  Object.freeze({ surface: 'mission-control', runtime: 'paperclip' }),
  Object.freeze({ surface: 'shared-browser', runtime: 'browser' }),
  Object.freeze({ surface: 'terminal', runtime: 'terminal' }),
]);
// Suffix-based by design: launch URLs must be represented only by explicit redaction booleans.
const LIVE_CANARY_SECRET_FIELD_PATTERN =
  /(authorization|bearer|token|secret|password|credential|desktop[_-]?session|access[_-]?token|refresh[_-]?token|api[_-]?key|service[_-]?role|provider[_-]?grant|grant[_-]?handle|launch[_-]?url|runtime[_-]?launch[_-]?url)$/i;
const LIVE_CANARY_SECRET_VALUE_PATTERNS = [
  /\beds_[A-Za-z0-9_-]{8,}\b/,
  /\bepg_[A-Za-z0-9_-]{8,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/i,
  /[?&#](?:access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|grant[_-]?handle|api[_-]?key|service[_-]?role|token|secret|password|credential)=/i,
];
const MAC_CONTROL_RUNTIME_PROOF_FIELDS = PUBLIC_ATTESTATION_ENVELOPE_FIELDS;

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

function requiresMacControlLiveCanaryProof(tagOrVersion) {
  const version = betaTagVersion(tagOrVersion);
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(version);
  if (!match) {
    throw new Error(`Could not determine release version from ${tagOrVersion}.`);
  }
  const candidate = match.slice(1).map(Number);
  const minimum = [2, 1, 36];
  for (let index = 0; index < minimum.length; index += 1) {
    if (candidate[index] > minimum[index]) return true;
    if (candidate[index] < minimum[index]) return false;
  }
  return true;
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

function rejectText(text, needle, relativePath, issues, reason) {
  if (text.includes(needle)) {
    issues.push(`${relativePath}: forbidden ${reason || needle}`);
  }
}

function getWorkflowCallInputValues(workflowText, jobId, inputName) {
  const lines = String(workflowText || '').split(/\r?\n/);
  const jobHeader = new RegExp(`^  ${jobId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(?:#.*)?$`);
  const nextJobHeader = /^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/;
  const withHeader = /^    with:\s*(?:#.*)?$/;
  const escapedInputName = inputName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inputLine = new RegExp(`^      ${escapedInputName}:\\s*([^#]*?)\\s*(?:#.*)?$`);
  const jobStart = lines.findIndex((line) => jobHeader.test(line));
  if (jobStart === -1) return [];

  let jobEnd = lines.length;
  for (let index = jobStart + 1; index < lines.length; index += 1) {
    if (nextJobHeader.test(lines[index])) {
      jobEnd = index;
      break;
    }
  }

  const withStart = lines.findIndex((line, index) => index > jobStart && index < jobEnd && withHeader.test(line));
  if (withStart === -1) return [];

  const values = [];
  for (let index = withStart + 1; index < jobEnd; index += 1) {
    const line = lines[index];
    if (/^    \S/.test(line) && !/^    #/.test(line)) break;
    const match = line.match(inputLine);
    if (!match) continue;
    values.push(match[1].trim().replace(/^(['"])(.*)\1$/, '$2'));
  }
  return values;
}

function collectBuildReleaseWorkflowIssues(workflowText) {
  const values = getWorkflowCallInputValues(workflowText, 'build-pipeline', 'managed_resources_bundle');
  if (values.length === 1 && values[0] === 'no-acp') return [];
  return [
    '.github/workflows/build-and-release.yml: jobs.build-pipeline.with.managed_resources_bundle must be exactly no-acp',
  ];
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

function getWorkflowJobRunner(workflow, jobName) {
  const lines = String(workflow || '').split(/\r?\n/);
  const jobStart = lines.findIndex((line) => line === `  ${jobName}:`);
  if (jobStart === -1) {
    return '';
  }

  for (let index = jobStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(line)) {
      break;
    }
    const runner = line.match(/^ {4}runs-on:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/);
    if (runner) {
      return runner[1];
    }
  }

  return '';
}

function getWorkflowJobBlock(workflow, jobName) {
  const lines = String(workflow || '').split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start === -1) return '';
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function getWorkflowJobIfExpression(workflow, jobName) {
  const lines = getWorkflowJobBlock(workflow, jobName).split(/\r?\n/);
  const start = lines.findIndex((line) => /^ {4}if:\s*/.test(line));
  if (start === -1) return '';
  const headerValue = lines[start]
    .replace(/^ {4}if:\s*/, '')
    .replace(/\s+#.*$/, '')
    .trim();
  if (headerValue && headerValue !== '|' && headerValue !== '>') {
    return headerValue.replace(/^(['"])(.*)\1$/, '$2').replace(/\s+/g, ' ');
  }
  const expressionLines = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^ {4}\S/.test(line) && !/^ {4}#/.test(line)) break;
    if (/^\s*#/.test(line) || !line.trim()) continue;
    expressionLines.push(line.trim());
  }
  return expressionLines.join(' ').replace(/\s+/g, ' ');
}

function getWorkflowNamedStepBlocks(jobBlock, stepName) {
  const lines = String(jobBlock || '').split(/\r?\n/);
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^ {6}- name:\s*(.+?)\s*$/);
    if (!match) continue;
    const name = match[1].replace(/^(['"])(.*)\1$/, '$2');
    if (name === stepName) starts.push(index);
  }
  return starts.map((start) => {
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^ {6}-\s+/.test(lines[index])) {
        end = index;
        break;
      }
    }
    return lines.slice(start, end).join('\n');
  });
}

function getWorkflowStepBlocks(jobBlock) {
  const lines = String(jobBlock || '').split(/\r?\n/);
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^ {6}-\s+/.test(lines[index])) starts.push(index);
  }
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? lines.length;
    return lines.slice(start, end).join('\n');
  });
}

function getWorkflowStepPropertyNames(stepBlock) {
  return String(stepBlock || '')
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(/^(?: {6}- | {8})(?:(['"])([A-Za-z0-9_-]+)\1|([A-Za-z0-9_-]+))\s*:/);
      if (match) return [match[2] || match[3]];
      if (/^(?: {6}- | {8})(?!#)\S/.test(line)) return ['__unparsed_workflow_property__'];
      return [];
    });
}

function getWorkflowStepScalarValues(stepBlock, property) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const binding = new RegExp(`^ {8}${escapedProperty}:\\s*(.*?)\\s*$`);
  return String(stepBlock || '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.match(binding))
    .filter(Boolean)
    .map((match) => match[1].trim().replace(/^(['"])(.*)\1$/, '$2'));
}

function getWorkflowStepPropertyBlock(stepBlock, property, blockScalar = false) {
  const lines = String(stepBlock || '').split(/\r?\n/);
  const header = blockScalar ? new RegExp(`^ {8}${property}:\\s*\\|\\s*$`) : new RegExp(`^ {8}${property}:\\s*$`);
  const start = lines.findIndex((line) => header.test(line));
  if (start === -1) return '';
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {8}\S/.test(lines[index]) && !/^ {8}#/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function getExecutableBlockLines(block) {
  return String(block || '')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !/^\s*#/.test(line))
    .map((line) => line.trim());
}

function getWorkflowStepEnvValues(stepBlock, key) {
  const envBlock = getWorkflowStepPropertyBlock(stepBlock, 'env');
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const binding = new RegExp(`^ {10}${escapedKey}:\\s*(.*?)\\s*$`);
  return String(envBlock || '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.match(binding))
    .filter(Boolean)
    .map((match) => match[1].trim().replace(/^(['"])(.*)\1$/, '$2'));
}

function getWorkflowStepEnvKeys(stepBlock) {
  const envBlock = getWorkflowStepPropertyBlock(stepBlock, 'env');
  return String(envBlock || '')
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(/^ {10}(?:(['"])([A-Za-z0-9_-]+)\1|([A-Za-z0-9_-]+))\s*:/);
      if (match) return [match[2] || match[3]];
      if (/^ {10}(?!#)\S/.test(line)) return ['__unparsed_workflow_env__'];
      return [];
    });
}

function executableWorkflowText(workflow) {
  return String(workflow || '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

function collectFunctionalSmokeConfigIssues(workflow) {
  const jobs = getTopLevelYamlSection(workflow, 'jobs');
  const issues = [];
  if (getWorkflowJobRunner(jobs, 'macos-arm64-app') !== 'macos-15') {
    issues.push('.github/workflows/workbench-functional-smoke.yml: macos-arm64-app must run on macos-15');
  }
  if (!String(workflow || '').includes('[[ ! "$WORKBENCH_SMOKE_BRIDGE_REF" =~ ^[0-9a-fA-F]{40}$ ]]')) {
    issues.push('.github/workflows/workbench-functional-smoke.yml: bridge ref must be a full immutable commit SHA');
  }
  const appJob = getWorkflowJobBlock(jobs, 'macos-arm64-app');
  const shapeSteps = getWorkflowNamedStepBlocks(appJob, 'Verify functional-smoke artifact shape');
  const shapeStep = shapeSteps.length === 1 ? shapeSteps[0] : '';
  const shapeStepIds = getWorkflowStepScalarValues(shapeStep, 'id');
  const shapeStepShellValues = getWorkflowStepScalarValues(shapeStep, 'shell');
  const shapeRunBlock = getWorkflowStepPropertyBlock(shapeStep, 'run', true);
  const shapeRunSha256 = createHash('sha256').update(shapeRunBlock.replace(/\r\n/g, '\n')).digest('hex');
  const shapeRunLines = getExecutableBlockLines(shapeRunBlock);
  const shapeAppPathAssignments = shapeRunLines.filter((line) => line.startsWith('APP_PATH='));
  const shapeAppPathOutputs = shapeRunLines.filter((line) => line.includes('app_path='));
  const verifyIdSteps = getWorkflowStepBlocks(appJob).filter((step) =>
    getWorkflowStepScalarValues(step, 'id').includes('verify')
  );
  const probeSteps = getWorkflowNamedStepBlocks(appJob, 'Verify packaged PyObjC imports without bytecode writes');
  const probeStep = probeSteps.length === 1 ? probeSteps[0] : '';
  const probeRun = getWorkflowStepPropertyBlock(probeStep, 'run', true);
  const probeRunLines = getExecutableBlockLines(probeRun);
  const expectedProbeRunLines = [
    'run: |',
    'set -euo pipefail',
    'BRIDGE_PYTHON="$WORKBENCH_APP_PATH/Contents/Resources/Bridge/python/bin/python3"',
    'test -x "$BRIDGE_PYTHON"',
    `env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin "$BRIDGE_PYTHON" -I -B -c ` +
      `'import ApplicationServices, Cocoa, CoreText, Quartz'`,
  ];
  const appPathBindings = getWorkflowStepEnvValues(probeStep, 'WORKBENCH_APP_PATH');
  const probeShellValues = getWorkflowStepScalarValues(probeStep, 'shell');
  if (
    shapeSteps.length !== 1 ||
    shapeStepIds.length !== 1 ||
    shapeStepIds[0] !== 'verify' ||
    verifyIdSteps.length !== 1 ||
    JSON.stringify(getWorkflowStepPropertyNames(shapeStep)) !== JSON.stringify(['name', 'id', 'shell', 'env', 'run']) ||
    JSON.stringify(getWorkflowStepEnvKeys(shapeStep)) !== JSON.stringify(['WORKBENCH_SMOKE_SHA']) ||
    shapeStepShellValues.length !== 1 ||
    shapeStepShellValues[0] !== '/usr/bin/env -u BASH_ENV /bin/bash --noprofile --norc -eo pipefail {0}' ||
    shapeRunSha256 !== FUNCTIONAL_SMOKE_SHAPE_RUN_SHA256 ||
    JSON.stringify(shapeAppPathAssignments) !==
      JSON.stringify([`APP_PATH="$(find out -type d -name '*.app' -print -quit)"`]) ||
    JSON.stringify(shapeAppPathOutputs) !== JSON.stringify(['echo "app_path=$APP_PATH" >> "$GITHUB_OUTPUT"']) ||
    probeSteps.length !== 1 ||
    JSON.stringify(getWorkflowStepPropertyNames(probeStep)) !== JSON.stringify(['name', 'shell', 'env', 'run']) ||
    JSON.stringify(getWorkflowStepEnvKeys(probeStep)) !== JSON.stringify(['WORKBENCH_APP_PATH']) ||
    probeShellValues.length !== 1 ||
    probeShellValues[0] !== '/usr/bin/env -u BASH_ENV /bin/bash --noprofile --norc -eo pipefail {0}' ||
    appPathBindings.length !== 1 ||
    appPathBindings[0] !== '${{ steps.verify.outputs.app_path }}' ||
    JSON.stringify(probeRunLines) !== JSON.stringify(expectedProbeRunLines)
  ) {
    issues.push(
      '.github/workflows/workbench-functional-smoke.yml: packaged PyObjC import probe must disable bytecode writes with -B'
    );
  }
  return issues;
}

function collectPublicationWorkflowIssues({ buildRelease = '', distribute = '', reusableBuild = '' } = {}) {
  const issues = [];
  const workflowEntries = [
    ['.github/workflows/build-and-release.yml', buildRelease],
    ['.github/workflows/release-distribute.yml', distribute],
    ['.github/workflows/_build-reusable.yml', reusableBuild],
  ];
  for (const [file, workflow] of workflowEntries) {
    const executable = executableWorkflowText(workflow);
    if (executable.includes('vars.EVAOS_BETA_RELEASE_PUBLISH_ENABLED')) {
      issues.push(`${file}: executable publication paths must not use vars.EVAOS_BETA_RELEASE_PUBLISH_ENABLED`);
    }
    if (!executable.includes('vars.EVAOS_BETA_RELEASE_V2136_PUBLISH_ENABLED')) {
      issues.push(`${file}: executable publication paths must use vars.EVAOS_BETA_RELEASE_V2136_PUBLISH_ENABLED`);
    }
  }

  const requiredBranchGuard =
    "github.ref_type == 'branch' && github.ref == format('refs/heads/{0}', vars.EVAOS_BETA_RELEASE_BRANCH)";
  const requiredPublishGuard = "vars.EVAOS_BETA_RELEASE_V2136_PUBLISH_ENABLED == 'true'";
  const expectedBuildJobConditions = {
    'create-tag':
      `${requiredPublishGuard} && ${requiredBranchGuard} && ` + "(inputs.macos_dmg_finalization || 'local') == 'ci'",
    release:
      `always() && ${requiredPublishGuard} && ${requiredBranchGuard} && ` +
      "needs.build-pipeline.result == 'success' && needs.create-tag.result == 'success' && " +
      "(inputs.macos_dmg_finalization || 'local') == 'ci' && ( " +
      "needs.pack-web-cli.result == 'success' || " +
      "(inputs.release_target_platforms || vars.EVAOS_RELEASE_TARGET_PLATFORMS || 'all') == 'macos' || " +
      "(inputs.release_target_platforms || vars.EVAOS_RELEASE_TARGET_PLATFORMS || 'all') == 'macos-arm64' || " +
      "(inputs.release_target_platforms || vars.EVAOS_RELEASE_TARGET_PLATFORMS || 'all') == 'windows' )",
    'register-local-signed-dmg-manifest':
      "github.event.inputs.beta_release_ack == 'evaos-beta' && " +
      `${requiredPublishGuard} && ${requiredBranchGuard} && ` +
      "inputs.release_operation == 'register-local-signed-dmg-manifest'",
  };
  for (const jobName of ['create-tag', 'release', 'register-local-signed-dmg-manifest']) {
    const jobIfExpression = getWorkflowJobIfExpression(buildRelease, jobName);
    if (!jobIfExpression.includes(requiredPublishGuard)) {
      issues.push(
        `.github/workflows/build-and-release.yml: jobs.${jobName} must require vars.EVAOS_BETA_RELEASE_V2136_PUBLISH_ENABLED`
      );
    }
    if (!jobIfExpression.includes(requiredBranchGuard)) {
      issues.push(
        `.github/workflows/build-and-release.yml: jobs.${jobName} must require a branch ref matching vars.EVAOS_BETA_RELEASE_BRANCH`
      );
    }
    if (jobIfExpression !== expectedBuildJobConditions[jobName]) {
      issues.push(
        `.github/workflows/build-and-release.yml: jobs.${jobName} publication condition must match the audited allowlist`
      );
    }
  }
  const distributeIfExpression = getWorkflowJobIfExpression(distribute, 'distribute');
  const expectedDistributeCondition =
    "github.event.inputs.beta_distribution_ack == 'evaos-beta' && " +
    `${requiredPublishGuard} && ${requiredBranchGuard}`;
  if (!distributeIfExpression.includes(requiredPublishGuard)) {
    issues.push(
      '.github/workflows/release-distribute.yml: jobs.distribute must require vars.EVAOS_BETA_RELEASE_V2136_PUBLISH_ENABLED'
    );
  }
  if (!distributeIfExpression.includes(requiredBranchGuard)) {
    issues.push(
      '.github/workflows/release-distribute.yml: jobs.distribute must require a branch ref matching vars.EVAOS_BETA_RELEASE_BRANCH'
    );
  }
  if (distributeIfExpression !== expectedDistributeCondition) {
    issues.push(
      '.github/workflows/release-distribute.yml: jobs.distribute publication condition must match the audited allowlist'
    );
  }
  return issues;
}

function collectReleaseDistributeWorkflowIssues(workflow) {
  const issues = [];
  const distributeJob = getWorkflowJobBlock(workflow, 'distribute');
  const rcProofSteps = getWorkflowNamedStepBlocks(distributeJob, 'Validate release candidate proof');
  if (rcProofSteps.length !== 1) {
    issues.push(
      '.github/workflows/release-distribute.yml: jobs.distribute must contain exactly one Validate release candidate proof step'
    );
  } else {
    const rcProofRunLines = getExecutableBlockLines(getWorkflowStepPropertyBlock(rcProofSteps[0], 'run', true));
    const expectedRcProofLines = [
      'RUN_JSON=$(gh run view "$RC_PROOF_RUN_ID" --repo "${{ github.repository }}" --json conclusion,event,workflowName,headSha,createdAt)',
      'node - "$RUN_JSON" "$EXPECTED_RELEASE_COMMIT" <<\'NODE\'',
      'const expectedHead = process.argv[3];',
      'if (run.headSha !== expectedHead) {',
      'throw new Error(`RC proof head ${run.headSha} does not match release commit ${expectedHead}.`);',
      "const createdAt = Date.parse(run.createdAt || '');",
      'const ageMs = Date.now() - createdAt;',
      'if (!Number.isFinite(createdAt) || ageMs < -5 * 60 * 1000 || ageMs > 24 * 60 * 60 * 1000) {',
      "throw new Error(`RC proof run is outside the 24-hour publication window: ${run.createdAt || 'missing'}.`);",
    ];
    const expectedReleaseCommitValues = getWorkflowStepEnvValues(rcProofSteps[0], 'EXPECTED_RELEASE_COMMIT');
    if (
      expectedReleaseCommitValues.length !== 1 ||
      expectedReleaseCommitValues[0] !== '${{ steps.provenance.outputs.tag_commit }}' ||
      expectedRcProofLines.some((line) => !rcProofRunLines.includes(line))
    ) {
      issues.push(
        '.github/workflows/release-distribute.yml: Validate release candidate proof must bind the selected successful RC run headSha to the exact release commit'
      );
    }
  }
  const steps = getWorkflowNamedStepBlocks(distributeJob, 'Validate live broker surface proof');
  if (steps.length !== 1) {
    return [
      '.github/workflows/release-distribute.yml: jobs.distribute must contain exactly one Validate live broker surface proof step',
    ];
  }
  const runBlock = getWorkflowStepPropertyBlock(steps[0], 'run', true);
  const runLines = getExecutableBlockLines(runBlock);
  const proofShellValues = getWorkflowStepScalarValues(steps[0], 'shell');
  const expectedProofEnvKeys = [
    'GH_TOKEN',
    'LIVE_CANARY_PROOF_RUN_ID',
    'TAG',
    'EXPECTED_RELEASE_COMMIT',
    'EVAOS_LIVE_CANARY_EXPECTED_CUSTOMER_ID',
    'EVAOS_LIVE_CANARY_EXPECTED_RELEASE_CANARY_CUSTOMER_ID',
    'EVAOS_LIVE_CANARY_MAX_PROOF_AGE_HOURS',
    'EVAOS_LIVE_CANARY_EXPECTED_SOURCE_HEAD_SHA',
    'EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID',
    'EVAOS_LIVE_CANARY_CONTEXT_KEY_ID',
    'EVAOS_LIVE_CANARY_RECEIPT_KEY_ID',
    'EVAOS_LIVE_CANARY_RECEIPT_PUBLIC_KEY',
  ];
  if (
    JSON.stringify(getWorkflowStepPropertyNames(steps[0])) !== JSON.stringify(['name', 'shell', 'env', 'run']) ||
    JSON.stringify(getWorkflowStepEnvKeys(steps[0])) !== JSON.stringify(expectedProofEnvKeys) ||
    proofShellValues.length !== 1 ||
    proofShellValues[0] !== '/usr/bin/env -u BASH_ENV /bin/bash --noprofile --norc -eo pipefail {0}' ||
    runLines.length !== 2 ||
    runLines[0] !== 'run: |' ||
    runLines[1] !== '/bin/bash scripts/evaosValidateLiveCanaryProofRun.sh'
  ) {
    issues.push(
      '.github/workflows/release-distribute.yml: Validate live broker surface proof must execute only the dedicated verifier script'
    );
  }
  for (const [key, expectedValue] of [
    ['LIVE_CANARY_PROOF_RUN_ID', '${{ github.event.inputs.live_canary_proof_run_id }}'],
    ['TAG', '${{ steps.version.outputs.tag }}'],
    ['EXPECTED_RELEASE_COMMIT', '${{ steps.provenance.outputs.tag_commit }}'],
    ['EVAOS_LIVE_CANARY_MAX_PROOF_AGE_HOURS', '24'],
    ['EVAOS_LIVE_CANARY_EXPECTED_SOURCE_HEAD_SHA', '${{ steps.provenance.outputs.tag_commit }}'],
    ['EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID', '${{ github.event.inputs.live_canary_proof_run_id }}'],
    ['EVAOS_LIVE_CANARY_CONTEXT_KEY_ID', '${{ vars.EVAOS_MAC_CONTROL_CONTEXT_KEY_ID }}'],
    ['EVAOS_LIVE_CANARY_RECEIPT_KEY_ID', '${{ vars.EVAOS_MAC_CONTROL_RECEIPT_KEY_ID }}'],
    ['EVAOS_LIVE_CANARY_RECEIPT_PUBLIC_KEY', '${{ vars.EVAOS_MAC_CONTROL_RECEIPT_PUBLIC_KEY }}'],
  ]) {
    const values = getWorkflowStepEnvValues(steps[0], key);
    if (values.length !== 1 || values[0] !== expectedValue) {
      issues.push(
        key === 'EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID'
          ? '.github/workflows/release-distribute.yml: Validate live broker surface proof must bind the selected proof run id through its env block'
          : `.github/workflows/release-distribute.yml: Validate live broker surface proof env block is missing ${key}: ${expectedValue}`
      );
    }
  }
  return issues;
}

function collectRcCanaryWorkflowIssues(workflow) {
  const issues = [];
  const workflowText = String(workflow || '');
  const unsafeUpdaterCommandSubstitution =
    /(?:^|\n)\s*(?:ZIP_NAME|EXPECTED_SHA)\s*=\s*\$\(\s*node(?:\s|$)[\s\S]{0,500}?<<-?\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?/;
  if (unsafeUpdaterCommandSubstitution.test(workflowText)) {
    issues.push(
      '.github/workflows/evaos-beta-rc-canary.yml: macOS Bash 3.2 must not wrap updater ZIP Node heredocs in command substitution'
    );
  }
  const installerBlocks = Array.from(
    String(workflow || '').matchAll(/^ {10}install_app_from_dmg\(\) \{\n([\s\S]*?)^ {10}\}$/gm),
    (match) => match[1]
  );
  if (installerBlocks.length === 0 || installerBlocks.some((block) => /\$\{?extract_dir\}?/.test(block))) {
    issues.push(
      '.github/workflows/evaos-beta-rc-canary.yml: install_app_from_dmg must not reference the ZIP-only extract_dir variable under nounset'
    );
  }
  const installedCandidateStep = getWorkflowNamedStepBlocks(workflow, 'Launch beta and audit feed isolation');
  if (installedCandidateStep.length !== 1) {
    issues.push(
      '.github/workflows/evaos-beta-rc-canary.yml: must contain exactly one Launch beta and audit feed isolation step'
    );
  } else {
    const runLines = getExecutableBlockLines(getWorkflowStepPropertyBlock(installedCandidateStep[0], 'run', true));
    if (
      !runLines.includes('--suite control_start \\') ||
      !runLines.includes('--operator-ack-live-control \\') ||
      runLines.some((line) => line.includes('--suite candidate'))
    ) {
      issues.push(
        '.github/workflows/evaos-beta-rc-canary.yml: installed candidate must run the operator-acknowledged local control_start suite'
      );
    }
  }
  return issues;
}

function writeExecutableAuditStub(filePath, lines) {
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, { mode: 0o755 });
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runLiveCanaryVerifierBehaviorProbe(verifierPath, mode, bashPath) {
  const auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-canary-verifier-audit-'));
  const binDir = path.join(auditRoot, 'bin');
  const stateDir = path.join(auditRoot, 'state');
  const markers = Object.fromEntries(
    ['requires', 'view', 'metadata-invoked', 'metadata-passed', 'download', 'verify-invoked', 'verify-passed'].map(
      (name) => [name, path.join(stateDir, name)]
    )
  );
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  try {
    writeExecutableAuditStub(path.join(binDir, 'node'), [
      '#!/bin/bash',
      'set -euo pipefail',
      `REAL_NODE=${shellSingleQuote(process.execPath)}`,
      'if [ "${1:-}" = "scripts/evaosBetaReleaseGate.js" ] && [ "${2:-}" = "requires-mac-control-proof" ]; then',
      `  touch ${shellSingleQuote(markers.requires)}`,
      "  printf 'true\\n'",
      '  exit 0',
      'fi',
      'if [ "${1:-}" = "-" ]; then',
      `  test -f ${shellSingleQuote(markers.view)}`,
      `  touch ${shellSingleQuote(markers['metadata-invoked'])}`,
      '  "$REAL_NODE" "$@"',
      `  touch ${shellSingleQuote(markers['metadata-passed'])}`,
      '  exit 0',
      'fi',
      'if [ "${1:-}" = "scripts/evaosBetaReleaseGate.js" ] && [ "${2:-}" = "verify-live-canary-proof" ]; then',
      `  test -f ${shellSingleQuote(markers.download)}`,
      `  touch ${shellSingleQuote(markers['verify-invoked'])}`,
      mode === 'final-verifier-failure' ? '  exit 73' : `  touch ${shellSingleQuote(markers['verify-passed'])}`,
      'fi',
      mode === 'final-verifier-failure' ? 'exit 73' : 'exit 0',
    ]);
    writeExecutableAuditStub(path.join(binDir, 'gh'), [
      '#!/bin/bash',
      'set -euo pipefail',
      'if [ "${1:-} ${2:-}" = "run view" ]; then',
      `  touch ${shellSingleQuote(markers.view)}`,
      `  printf '%s\\n' '${
        {
          'invalid-conclusion':
            '{"conclusion":"failure","event":"workflow_dispatch","workflowName":"evaOS Live Canary Proof","headSha":"0123456789abcdef0123456789abcdef01234567"}',
          'invalid-event':
            '{"conclusion":"success","event":"push","workflowName":"evaOS Live Canary Proof","headSha":"0123456789abcdef0123456789abcdef01234567"}',
          'invalid-workflow':
            '{"conclusion":"success","event":"workflow_dispatch","workflowName":"Unexpected Workflow","headSha":"0123456789abcdef0123456789abcdef01234567"}',
          'invalid-head':
            '{"conclusion":"success","event":"workflow_dispatch","workflowName":"evaOS Live Canary Proof","headSha":"ffffffffffffffffffffffffffffffffffffffff"}',
        }[mode] ||
        '{"conclusion":"success","event":"workflow_dispatch","workflowName":"evaOS Live Canary Proof","headSha":"0123456789abcdef0123456789abcdef01234567"}'
      }'`,
      '  exit 0',
      'fi',
      'if [ "${1:-} ${2:-}" = "run download" ]; then',
      ...(mode.startsWith('invalid-') ? [] : [`  test -f ${shellSingleQuote(markers['metadata-passed'])}`]),
      `  touch ${shellSingleQuote(markers.download)}`,
      '  output_dir=""',
      '  while [ "$#" -gt 0 ]; do',
      '    if [ "$1" = "--dir" ]; then',
      '      shift',
      '      output_dir="${1:-}"',
      '    fi',
      '    shift',
      '  done',
      '  test -n "$output_dir"',
      '  mkdir -p "$output_dir/packet"',
      '  : > "$output_dir/packet/broker-runtime-status.json"',
      '  : > "$output_dir/packet/mac-control-runtime.json"',
      '  : > "$output_dir/packet/mac-control-deployed-route.json"',
      `  printf '%s\\n' 'Run live canaries: true' 'Run follow-up canaries: none' 'Run Mac-control canary: true' > "$output_dir/packet/proof-run.md"`,
      '  exit 0',
      'fi',
      'exit 1',
    ]);

    let succeeded = false;
    try {
      execFileSync(bashPath, [verifierPath], {
        cwd: auditRoot,
        env: {
          PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
          HOME: auditRoot,
          TMPDIR: auditRoot,
          LANG: 'C',
          LC_ALL: 'C',
          LIVE_CANARY_PROOF_RUN_ID: '123456789',
          GITHUB_REPOSITORY: 'fixture/evaos-gui',
          TAG: 'evaos-beta-v2.1.36-evaos-beta',
          EXPECTED_RELEASE_COMMIT: '0123456789abcdef0123456789abcdef01234567',
        },
        encoding: 'utf8',
        timeout: 15_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      succeeded = true;
    } catch {
      succeeded = false;
    }
    const has = (name) => fs.existsSync(markers[name]);
    if (mode.startsWith('invalid-')) {
      return !succeeded && has('requires') && has('view') && has('metadata-invoked') && !has('metadata-passed');
    }
    if (mode === 'final-verifier-failure') {
      return (
        !succeeded &&
        has('requires') &&
        has('view') &&
        has('metadata-passed') &&
        has('download') &&
        has('verify-invoked') &&
        !has('verify-passed')
      );
    }
    return (
      succeeded &&
      has('requires') &&
      has('view') &&
      has('metadata-passed') &&
      has('download') &&
      has('verify-invoked') &&
      has('verify-passed')
    );
  } catch {
    return false;
  } finally {
    fs.rmSync(auditRoot, { recursive: true, force: true });
  }
}

const liveCanaryVerifierBehaviorCache = new Map();

function resolveLiveCanaryVerifierAuditBash(
  candidates = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/bin/bash']
) {
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      execFileSync(candidate, ['-c', '(( BASH_VERSINFO[0] >= 4 ))'], {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 2_000,
      });
      return candidate;
    } catch {
      // Keep looking: the verifier uses mapfile, which Apple Bash 3.2 does not provide.
    }
  }
  return '';
}

function collectLiveCanaryVerifierBehaviorIssues(rootDir = process.cwd()) {
  const issue =
    'scripts/evaosValidateLiveCanaryProofRun.sh: isolated behavior probe must execute the live-canary proof verifier';
  const verifierPath = path.join(rootDir, 'scripts/evaosValidateLiveCanaryProofRun.sh');
  if (!fs.existsSync(verifierPath)) return [issue];
  const verifierSource = fs.readFileSync(verifierPath, 'utf8').replace(/\r\n/g, '\n');
  const verifierSha256 = createHash('sha256').update(verifierSource).digest('hex');
  if (verifierSha256 !== LIVE_CANARY_VERIFIER_SHA256) return [issue];
  if (process.platform === 'win32') return [];
  const bashPath = resolveLiveCanaryVerifierAuditBash();
  if (!bashPath) return [];

  const cacheKey = `${process.platform}:${verifierSha256}`;
  if (liveCanaryVerifierBehaviorCache.has(cacheKey)) {
    return liveCanaryVerifierBehaviorCache.get(cacheKey) ? [] : [issue];
  }
  const passed = [
    'success',
    'invalid-conclusion',
    'invalid-event',
    'invalid-workflow',
    'invalid-head',
    'final-verifier-failure',
  ].every((mode) => runLiveCanaryVerifierBehaviorProbe(verifierPath, mode, bashPath));
  liveCanaryVerifierBehaviorCache.set(cacheKey, passed);
  return passed ? [] : [issue];
}

function collectReleaseConfigIssues(rootDir = process.cwd()) {
  const issues = [];
  const packageJson = readJson(rootDir, 'package.json');
  const builder = readText(rootDir, 'packages/desktop/electron-builder.yml');
  const macBuilder = getTopLevelYamlSection(builder, 'mac');
  const winBuilder = getTopLevelYamlSection(builder, 'win');
  const linuxBuilder = getTopLevelYamlSection(builder, 'linux');
  const buildRelease = readText(rootDir, '.github/workflows/build-and-release.yml');
  const buildManual = readText(rootDir, '.github/workflows/build-manual.yml');
  const prChecks = readText(rootDir, '.github/workflows/pr-checks.yml');
  const distribute = readText(rootDir, '.github/workflows/release-distribute.yml');
  const rcCanary = readText(rootDir, '.github/workflows/evaos-beta-rc-canary.yml');
  const localSignedDmgManifest = readText(rootDir, '.github/workflows/evaos-beta-local-signed-dmg-manifest.yml');
  const reusableBuild = readText(rootDir, '.github/workflows/_build-reusable.yml');
  const functionalSmoke = readText(rootDir, '.github/workflows/workbench-functional-smoke.yml');
  const liveCanaryVerifier = readText(rootDir, 'scripts/evaosValidateLiveCanaryProofRun.sh');
  const pythonRuntimePrep = readText(rootDir, 'scripts/prepareEvaosDesktopBridgePythonRuntime.sh');
  const afterSign = readText(rootDir, 'scripts/afterSign.js');
  const dmgFinalizer = readText(rootDir, 'scripts/evaosFinalizeMacDmg.js');
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

  issues.push(...collectPublicationWorkflowIssues({ buildRelease, distribute, reusableBuild }));
  issues.push(...collectReleaseDistributeWorkflowIssues(distribute));
  issues.push(...collectRcCanaryWorkflowIssues(rcCanary));

  if (String(packageJson.version || '').includes('evaos-beta')) {
    issues.push('package.json: stable Mac release version must not contain evaos-beta');
  }
  if (packageJson.productName !== 'evaOS Workbench') {
    issues.push('package.json: productName must be evaOS Workbench');
  }

  requireText(builder, 'appId: com.evaos.workbench', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'productName: evaOS Workbench', 'packages/desktop/electron-builder.yml', issues);
  rejectText(builder, 'appId: com.evaos.workbench.beta', 'packages/desktop/electron-builder.yml', issues);
  rejectText(builder, 'productName: evaOS Workbench Beta', 'packages/desktop/electron-builder.yml', issues);
  rejectText(builder, 'evaos-workbench-beta', 'packages/desktop/electron-builder.yml', issues);
  if (/^executableName:/m.test(builder)) {
    issues.push(
      'packages/desktop/electron-builder.yml: top-level executableName must be omitted so macOS bundle filename stays evaOS Workbench.app'
    );
  }
  if (/^\s+executableName:/m.test(macBuilder)) {
    issues.push(
      'packages/desktop/electron-builder.yml: mac.executableName must be omitted so macOS bundle filename stays evaOS Workbench.app'
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
    'executableName: EvaOSWorkbench',
    'packages/desktop/electron-builder.yml',
    issues,
    'win executableName EvaOSWorkbench'
  );
  requireText(
    linuxBuilder,
    'executableName: EvaOSWorkbench',
    'packages/desktop/electron-builder.yml',
    issues,
    'linux executableName EvaOSWorkbench'
  );
  requireText(builder, 'evaos-workbench', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'owner: 100yenadmin', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'repo: evaOS-GUI', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'publishAutoUpdate: false', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'releaseType: draft', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'resources/evaos-beta/app.png', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'resources/evaos-beta/app.icns', 'packages/desktop/electron-builder.yml', issues);
  requireText(builder, 'resources/evaos-beta/app.ico', 'packages/desktop/electron-builder.yml', issues);
  requireText(
    builder,
    'out/main/builtin-mcp-image-gen.js',
    'packages/desktop/electron-builder.yml',
    issues,
    'builtin image MCP script unpacked'
  );
  requireText(
    builder,
    'out/main/builtin-mcp-evaos-mac-control.js',
    'packages/desktop/electron-builder.yml',
    issues,
    'builtin evaOS Mac-control MCP script unpacked'
  );

  requireText(buildRelease, 'workflow_dispatch:', '.github/workflows/build-and-release.yml', issues);
  requireText(buildRelease, "beta_release_ack == 'evaos-beta'", '.github/workflows/build-and-release.yml', issues);
  requireText(
    buildRelease,
    "vars.EVAOS_BETA_RELEASE_V2136_PUBLISH_ENABLED == 'true'",
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
    'register-local-signed-dmg-manifest',
    '.github/workflows/build-and-release.yml',
    issues,
    'visible local-signed DMG manifest registration operation'
  );
  requireText(
    buildRelease,
    'manifest_release_target_platforms',
    '.github/workflows/build-and-release.yml',
    issues,
    'macOS-default target platform input for local manifest registration'
  );
  requireText(
    buildRelease,
    'macos-arm64',
    '.github/workflows/build-and-release.yml',
    issues,
    'Apple-Silicon-only release target profile'
  );
  requireText(
    buildRelease,
    '"os":"macos-15"',
    '.github/workflows/build-and-release.yml',
    issues,
    'macOS release packaging must use a Sequoia runner for the native control helper'
  );
  requireText(
    reusableBuild,
    "minimumSystemVersion: '24.0.0'",
    '.github/workflows/_build-reusable.yml',
    issues,
    'macOS updater metadata must gate on the Darwin 24 kernel floor for macOS 15'
  );
  requireText(
    reusableBuild,
    'Write macOS x64 updater metadata',
    '.github/workflows/_build-reusable.yml',
    issues,
    'staged macOS x64 updater metadata must declare the supported system floor'
  );
  requireText(
    prepareAssets,
    "minimumSystemVersion: '24.0.0'",
    'scripts/prepare-release-assets.sh',
    issues,
    'prepared macOS updater metadata must preserve the Darwin 24 kernel floor for macOS 15'
  );
  issues.push(...collectBuildReleaseWorkflowIssues(buildRelease));
  requireText(
    buildManual,
    '"os":"macos-15"',
    '.github/workflows/build-manual.yml',
    issues,
    'manual macOS packaging must use a Sequoia runner for the native control helper'
  );
  issues.push(...collectFunctionalSmokeConfigIssues(functionalSmoke));
  issues.push(...collectLiveCanaryVerifierBehaviorIssues(rootDir));
  requireText(
    buildRelease,
    'EVAOS_BETA_RELEASE_PROVENANCE_MODE: local-signed-dmg-fallback',
    '.github/workflows/build-and-release.yml',
    issues,
    'local-signed DMG fallback provenance writing'
  );
  requireText(
    buildRelease,
    'evaos-local-signed-dmg',
    '.github/workflows/build-and-release.yml',
    issues,
    'local-signed DMG fallback acknowledgement'
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
    "vars.EVAOS_BETA_RELEASE_V2136_PUBLISH_ENABLED == 'true'",
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
  requireText(distribute, 'macos-arm64', '.github/workflows/release-distribute.yml', issues);
  requireText(distribute, 'rc_proof_run_id', '.github/workflows/release-distribute.yml', issues);
  requireText(distribute, 'evaOS Beta RC Canary', '.github/workflows/release-distribute.yml', issues);
  requireText(
    distribute,
    'scripts/evaosBetaReleaseGate.js verify-rc-proof',
    '.github/workflows/release-distribute.yml',
    issues
  );
  requireText(
    distribute,
    'EVAOS_BETA_RC_RELEASE_ASSETS_DIR: dist',
    '.github/workflows/release-distribute.yml',
    issues,
    'verifier-side downloaded updater ZIP binding'
  );
  requireText(distribute, 'live_canary_proof_run_id', '.github/workflows/release-distribute.yml', issues);
  requireText(
    distribute,
    'live_canary_expected_customer_id',
    '.github/workflows/release-distribute.yml',
    issues,
    'broker live canary customer override input'
  );
  requireText(liveCanaryVerifier, 'evaOS Live Canary Proof', 'scripts/evaosValidateLiveCanaryProofRun.sh', issues);
  requireText(
    liveCanaryVerifier,
    '.github/workflows/evaos-live-canary-proof.yml',
    'scripts/evaosValidateLiveCanaryProofRun.sh',
    issues
  );
  requireText(
    liveCanaryVerifier,
    'headSha',
    'scripts/evaosValidateLiveCanaryProofRun.sh',
    issues,
    'live canary head SHA binding'
  );
  requireText(
    liveCanaryVerifier,
    'broker-runtime-status.json',
    'scripts/evaosValidateLiveCanaryProofRun.sh',
    issues,
    'live broker-surface proof artifact'
  );
  requireText(
    liveCanaryVerifier,
    'mac-control-runtime.json',
    'scripts/evaosValidateLiveCanaryProofRun.sh',
    issues,
    'selected-binding Mac-control proof artifact'
  );
  requireText(
    liveCanaryVerifier,
    'requires-mac-control-proof',
    'scripts/evaosValidateLiveCanaryProofRun.sh',
    issues,
    'version-bounded Mac-control release proof gate'
  );
  requireText(
    liveCanaryVerifier,
    'EVAOS_REQUIRE_MAC_CONTROL_LIVE_CANARY_PROOF="$MAC_CONTROL_PROOF_REQUIRED"',
    'scripts/evaosValidateLiveCanaryProofRun.sh',
    issues,
    'version-bounded Mac-control proof verifier input'
  );
  requireText(
    distribute,
    'EVAOS_LIVE_CANARY_EXPECTED_SOURCE_HEAD_SHA',
    '.github/workflows/release-distribute.yml',
    issues,
    'Mac-control proof source-head binding'
  );
  requireText(
    distribute,
    'EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID',
    '.github/workflows/release-distribute.yml',
    issues,
    'Mac-control proof source-run binding'
  );
  requireText(
    distribute,
    'EVAOS_LIVE_CANARY_EXPECTED_CUSTOMER_ID',
    '.github/workflows/release-distribute.yml',
    issues,
    'live canary expected customer binding'
  );
  requireText(
    distribute,
    'AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID',
    '.github/workflows/release-distribute.yml',
    issues,
    'broker live canary customer variable binding'
  );
  requireText(
    distribute,
    'EVAOS_LIVE_CANARY_EXPECTED_RELEASE_CANARY_CUSTOMER_ID',
    '.github/workflows/release-distribute.yml',
    issues,
    'live canary expected release-customer binding'
  );
  requireText(
    distribute,
    'EVAOS_LIVE_CANARY_MAX_PROOF_AGE_HOURS',
    '.github/workflows/release-distribute.yml',
    issues,
    'live canary proof freshness binding'
  );
  requireText(
    liveCanaryVerifier,
    'Run live canaries: true',
    'scripts/evaosValidateLiveCanaryProofRun.sh',
    issues,
    'live canary run input binding'
  );
  requireText(
    liveCanaryVerifier,
    'Run follow-up canaries:',
    'scripts/evaosValidateLiveCanaryProofRun.sh',
    issues,
    'live canary follow-up disposition marker'
  );
  requireText(
    liveCanaryVerifier,
    'Run Mac-control canary: true',
    'scripts/evaosValidateLiveCanaryProofRun.sh',
    issues,
    'required Mac-control canary disposition marker'
  );
  requireText(
    liveCanaryVerifier,
    'scripts/evaosBetaReleaseGate.js verify-live-canary-proof',
    'scripts/evaosValidateLiveCanaryProofRun.sh',
    issues
  );

  requireText(rcCanary, 'name: evaOS Beta RC Canary', '.github/workflows/evaos-beta-rc-canary.yml', issues);
  requireText(rcCanary, 'workflow_dispatch:', '.github/workflows/evaos-beta-rc-canary.yml', issues);
  requireText(rcCanary, 'evaos-beta-rc', '.github/workflows/evaos-beta-rc-canary.yml', issues);
  requireText(rcCanary, 'macos-arm64', '.github/workflows/evaos-beta-rc-canary.yml', issues);
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
  requireText(
    rcCanary,
    'release-assets-reference.json',
    '.github/workflows/evaos-beta-rc-canary.yml',
    issues,
    'lightweight RC proof release asset checksum reference'
  );
  requireText(
    rcCanary,
    'updater-zip-macos-arm64.json',
    '.github/workflows/evaos-beta-rc-canary.yml',
    issues,
    'updater ZIP trust proof bound to the release manifest checksum'
  );
  requireText(
    rcCanary,
    'evaos-updater-zip-trust/v2',
    '.github/workflows/evaos-beta-rc-canary.yml',
    issues,
    'updater ZIP trust proof schema'
  );
  for (const identityField of ['CFBundleIdentifier', 'CFBundleName', 'CFBundleShortVersionString', 'CFBundleVersion']) {
    requireText(
      rcCanary,
      identityField,
      '.github/workflows/evaos-beta-rc-canary.yml',
      issues,
      `updater ZIP ${identityField} binding`
    );
  }
  requireText(
    rcCanary,
    'codesign --verify --deep --strict',
    '.github/workflows/evaos-beta-rc-canary.yml',
    issues,
    'updater ZIP extracted app codesign verification'
  );
  requireText(
    rcCanary,
    'pre-canary',
    '.github/workflows/evaos-beta-rc-canary.yml',
    issues,
    'installed candidate pre-canary invocation'
  );
  requireText(
    rcCanary,
    '--suite control_start',
    '.github/workflows/evaos-beta-rc-canary.yml',
    issues,
    'installed connector local control-start invocation'
  );
  requireText(
    rcCanary,
    '--operator-ack-live-control',
    '.github/workflows/evaos-beta-rc-canary.yml',
    issues,
    'installed connector local control-start operator acknowledgement'
  );
  requireText(
    rcCanary,
    'installed-candidate-connector.json',
    '.github/workflows/evaos-beta-rc-canary.yml',
    issues,
    'installed connector candidate proof artifact'
  );
  requireText(
    rcCanary,
    'cp release-assets/evaos-beta-release-manifest.json',
    '.github/workflows/evaos-beta-rc-canary.yml',
    issues,
    'RC proof should copy the manifest instead of embedding release asset bytes'
  );
  requireText(rcCanary, 'actions/upload-artifact', '.github/workflows/evaos-beta-rc-canary.yml', issues);
  requireText(
    localSignedDmgManifest,
    'Register evaOS Beta Local-Signed DMG Manifest',
    '.github/workflows/evaos-beta-local-signed-dmg-manifest.yml',
    issues
  );
  requireText(
    localSignedDmgManifest,
    'evaos-local-signed-dmg',
    '.github/workflows/evaos-beta-local-signed-dmg-manifest.yml',
    issues
  );
  requireText(
    localSignedDmgManifest,
    'EVAOS_BETA_RELEASE_PROVENANCE_MODE: local-signed-dmg-fallback',
    '.github/workflows/evaos-beta-local-signed-dmg-manifest.yml',
    issues
  );
  requireText(
    localSignedDmgManifest,
    'macos-arm64',
    '.github/workflows/evaos-beta-local-signed-dmg-manifest.yml',
    issues,
    'Apple-Silicon-only local-signed DMG manifest registration profile'
  );
  requireText(
    localSignedDmgManifest,
    'source_ci_workflow',
    '.github/workflows/evaos-beta-local-signed-dmg-manifest.yml',
    issues,
    'local-signed DMG provenance should record the actual source workflow'
  );
  requireText(
    localSignedDmgManifest,
    'scripts/evaosBetaReleaseGate.js verify-manifest',
    '.github/workflows/evaos-beta-local-signed-dmg-manifest.yml',
    issues
  );

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
  requireText(
    reusableBuild,
    'timeout-minutes: 45',
    '.github/workflows/_build-reusable.yml',
    issues,
    'bounded macOS release packaging step'
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
  requireText(afterSign, 'buildAppNotarytoolInfoArgs', 'scripts/afterSign.js', issues);
  requireText(afterSign, 'EVAOS_APP_NOTARY_PROCESS_TIMEOUT_MS', 'scripts/afterSign.js', issues);
  requireText(afterSign, 'EVAOS_APP_NOTARY_COMMAND_PROCESS_TIMEOUT_MS', 'scripts/afterSign.js', issues);
  requireText(afterSign, 'EVAOS_APP_NOTARY_POLL_INTERVAL_MS', 'scripts/afterSign.js', issues);
  requireText(afterSign, 'EVAOS_APP_TRUST_PROCESS_TIMEOUT_MS', 'scripts/afterSign.js', issues);
  requireText(afterSign, "killSignal: 'SIGKILL'", 'scripts/afterSign.js', issues, 'hard-kill bounded Apple commands');
  requireText(afterSign, 'notarytool info', 'scripts/afterSign.js', issues, 'app notarization status polling');
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
  requireText(
    afterSign,
    'assertMacControlHelperSignatures',
    'scripts/afterSign.js',
    issues,
    'strict beta release validates bundled Mac-control helper code identity'
  );
  requireText(
    afterSign,
    'TeamIdentifier=',
    'scripts/afterSign.js',
    issues,
    'strict beta release rejects bundled Mac-control helpers signed by the wrong team'
  );
  requireText(dmgFinalizer, 'buildDmgCodesignArgs', 'scripts/evaosFinalizeMacDmg.js', issues);
  requireText(dmgFinalizer, 'shouldCodesignDmg', 'scripts/evaosFinalizeMacDmg.js', issues);
  requireText(dmgFinalizer, 'EVAOS_DMG_CODESIGN', 'scripts/evaosFinalizeMacDmg.js', issues);
  requireText(dmgFinalizer, 'EVAOS_DMG_CODESIGN_MODE', 'scripts/evaosFinalizeMacDmg.js', issues);
  requireText(dmgFinalizer, 'verify-existing', 'scripts/evaosFinalizeMacDmg.js', issues);
  requireText(dmgFinalizer, 'EVAOS_DMG_CODESIGN_PROCESS_TIMEOUT_MS', 'scripts/evaosFinalizeMacDmg.js', issues);
  requireText(
    dmgFinalizer,
    'dmg_staged_for_local_finalization',
    'scripts/evaosFinalizeMacDmg.js',
    issues,
    'DMG signing opt-out stages artifacts for local finalization instead of notarizing unsigned DMGs'
  );
  requireText(dmgFinalizer, 'EVAOS_DMG_CODESIGN_KEYCHAIN', 'scripts/evaosFinalizeMacDmg.js', issues);
  requireText(
    reusableBuild,
    'macos_dmg_finalization',
    '.github/workflows/_build-reusable.yml',
    issues,
    'macOS DMG finalization mode input'
  );
  requireText(
    reusableBuild,
    'dmg_staged_for_local_finalization',
    '.github/workflows/_build-reusable.yml',
    issues,
    'macOS app-notarized DMG staging status'
  );
  requireText(reusableBuild, 'dmg_codesign_timeout', '.github/workflows/_build-reusable.yml', issues);
  requireText(reusableBuild, 'dmg_primary_signature_missing', '.github/workflows/_build-reusable.yml', issues);
  requireText(
    reusableBuild,
    'Install evaOS Mac-control helper',
    '.github/workflows/_build-reusable.yml',
    issues,
    'macOS release build must provide a native bundled control helper'
  );
  requireText(
    reusableBuild,
    'EVAOS_PEEKABOO_BIN',
    '.github/workflows/_build-reusable.yml',
    issues,
    'macOS release build exports the native Peekaboo helper for packaging'
  );
  requireText(
    reusableBuild,
    "PEEKABOO_VERSION: '3.8.0'",
    '.github/workflows/_build-reusable.yml',
    issues,
    'stable Peekaboo fallback version pin'
  );
  requireText(
    reusableBuild,
    '5be06117ed861ac7a87ea1d1e552122db4231bf2cd618ec516d77c66acd39620',
    '.github/workflows/_build-reusable.yml',
    issues,
    'published Peekaboo 3.8.0 asset digest'
  );
  requireText(
    reusableBuild,
    '4a5c7e28c263c84e406aa1853ef62cad3042b13f40a7a9e044ec74ec42933383',
    '.github/workflows/_build-reusable.yml',
    issues,
    'Peekaboo 3.8.0 extracted binary source digest'
  );
  requireText(
    reusableBuild,
    'shasum -a 256 -c',
    '.github/workflows/_build-reusable.yml',
    issues,
    'Peekaboo asset digest verification before packaging'
  );
  requireText(
    reusableBuild,
    'EVAOS_PEEKABOO_LICENSE=$PEEKABOO_LICENSE',
    '.github/workflows/_build-reusable.yml',
    issues,
    'Peekaboo license notice exported for packaging'
  );
  requireText(
    reusableBuild,
    'EVAOS_REQUIRED_PEEKABOO_SOURCE_SHA256=$PEEKABOO_BINARY_SHA256',
    '.github/workflows/_build-reusable.yml',
    issues,
    'Peekaboo source digest exported for packaging verification'
  );
  requireText(
    reusableBuild,
    "PYTHON_RUNTIME_VERSION: '3.12.13'",
    '.github/workflows/_build-reusable.yml',
    issues,
    'self-contained desktop bridge Python runtime version pin'
  );
  requireText(
    pythonRuntimePrep,
    'EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR=$runtime_dir',
    'scripts/prepareEvaosDesktopBridgePythonRuntime.sh',
    issues,
    'verified desktop bridge Python runtime exported for packaging'
  );
  requireText(
    pythonRuntimePrep,
    'EVAOS_REQUIRED_PYTHON_RUNTIME_SHA256=$runtime_sha256',
    'scripts/prepareEvaosDesktopBridgePythonRuntime.sh',
    issues,
    'desktop bridge Python runtime source digest exported for manifest provenance'
  );
  requireText(
    pythonRuntimePrep,
    'PYTHON_RUNTIME_LICENSE_SHA256:=3b2f81fe21d181c499c59a256c8e1968455d6689d269aa85373bfb6af41da3bf',
    'scripts/prepareEvaosDesktopBridgePythonRuntime.sh',
    issues,
    'downloaded CPython license must match the pinned release bytes before packaging'
  );
  requireText(
    pythonRuntimePrep,
    'import ApplicationServices, Cocoa, CoreText, Quartz',
    'scripts/prepareEvaosDesktopBridgePythonRuntime.sh',
    issues,
    'bundled runtime must prove direct Accessibility dependencies without host packages'
  );
  requireText(
    pythonRuntimePrep,
    '--no-index',
    'scripts/prepareEvaosDesktopBridgePythonRuntime.sh',
    issues,
    'bundled PyObjC install must be offline from verified wheels'
  );
  requireText(
    pythonRuntimePrep,
    '-I -m pip check',
    'scripts/prepareEvaosDesktopBridgePythonRuntime.sh',
    issues,
    'bundled PyObjC dependencies must form a complete installed closure'
  );
  requireText(
    pythonRuntimePrep,
    'distributions(path=[sys.argv[1]])',
    'scripts/prepareEvaosDesktopBridgePythonRuntime.sh',
    issues,
    'bundled PyObjC closure must be scoped to the packaged site-packages directory'
  );
  requireText(
    pythonRuntimePrep,
    'EVAOS_REQUIRED_PYTHON_RUNTIME_PACKAGES_JSON=$packages_json',
    'scripts/prepareEvaosDesktopBridgePythonRuntime.sh',
    issues,
    'bundled PyObjC package hashes must be recorded in the bridge manifest'
  );
  requireText(
    pythonRuntimePrep,
    'a64232bb27ed101d4adc7d42b0e64a6d3331aac7bee7861c037a6777a163f10b',
    'scripts/prepareEvaosDesktopBridgePythonRuntime.sh',
    issues,
    'pinned PyObjC core wheel digest'
  );
  requireText(
    functionalSmoke,
    'prepareEvaosDesktopBridgePythonRuntime.sh arm64',
    '.github/workflows/workbench-functional-smoke.yml',
    issues,
    'functional smoke must build the same pinned self-contained Python runtime'
  );
  requireText(
    functionalSmoke,
    'BUNDLED_PEEKABOO_LICENSE_SHA256',
    '.github/workflows/workbench-functional-smoke.yml',
    issues,
    'functional smoke validates packaged Peekaboo identity and license notice'
  );
  requireText(distribute, 'local_signed_dmg_fallback_ack', '.github/workflows/release-distribute.yml', issues);
  requireText(rcCanary, 'local_signed_dmg_fallback_ack', '.github/workflows/evaos-beta-rc-canary.yml', issues);
  const dmgSigningKeychainSection = dmgFinalizer.split('const NOTARY_KEYCHAIN_ENV')[0] || '';
  if (dmgSigningKeychainSection.includes('NOTARY_KEYCHAIN') || dmgSigningKeychainSection.includes('RELEASE_KEYCHAIN')) {
    issues.push(
      'scripts/evaosFinalizeMacDmg.js: DMG codesign keychain aliases must not reuse NOTARY_KEYCHAIN or RELEASE_KEYCHAIN'
    );
  }

  requireText(prChecks, "'evaos/**'", '.github/workflows/pr-checks.yml', issues, 'EVAOS stacked PR branch trigger');

  requireText(prepareAssets, 'Refusing upstream-branded beta asset', 'scripts/prepare-release-assets.sh', issues);
  requireText(
    prepareAssets,
    'macos-arm64',
    'scripts/prepare-release-assets.sh',
    issues,
    'Apple-Silicon-only release asset preparation profile'
  );
  requireText(
    prepareAssets,
    'Refusing beta asset without evaOS beta identity marker',
    'scripts/prepare-release-assets.sh',
    issues
  );

  requireText(rollbackDoc, 'com.evaos.workbench', 'docs/evaos/public-beta-packaging-rollback.md', issues);
  requireText(rollbackDoc, 'Rollback', 'docs/evaos/public-beta-packaging-rollback.md', issues);
  requireText(rollbackDoc, 'Support', 'docs/evaos/public-beta-packaging-rollback.md', issues);
  requireText(rollbackDoc, 'Operator rollback proof commands', 'docs/evaos/public-beta-packaging-rollback.md', issues);
  requireText(rollbackDoc, 'lsregister -dump', 'docs/evaos/public-beta-packaging-rollback.md', issues);

  requireText(changelog, 'Stable Packaging', 'CHANGELOG.md', issues);
  requireText(changelog, 'real macOS signing/notarization', 'CHANGELOG.md', issues);
  requireText(changelog, 'validates release provenance', 'CHANGELOG.md', issues);

  requireText(webManifest, '"name": "evaOS Workbench"', 'public/manifest.webmanifest', issues);
  requireText(webManifest, '"short_name": "evaOS"', 'public/manifest.webmanifest', issues);
  requireText(rendererHtml, 'content="evaOS Workbench"', 'packages/desktop/src/renderer/index.html', issues);
  requireText(rendererHtml, '<title>evaOS Workbench</title>', 'packages/desktop/src/renderer/index.html', issues);
  requireText(titlebar, "const appTitle = useMemo(() => 'evaOS Workbench', []);", 'Titlebar/index.tsx', issues);
  requireText(layout, '>evaOS Workbench</div>', 'Layout.tsx', issues);
  rejectText(titlebar, 'evaOS Workbench Beta', 'Titlebar/index.tsx', issues);
  rejectText(layout, 'evaOS Workbench Beta', 'Layout.tsx', issues);
  requireText(missionControl, 'Start evaOS Workbench locally', 'mission-control/index.tsx', issues);
  requireText(missionControl, 'evaOS Workbench is the Mac shell candidate', 'mission-control/index.tsx', issues);
  if (missionControl.includes('AionUi is the evaOS beta shell candidate')) {
    issues.push('mission-control/index.tsx: public beta gate still exposes upstream AionUi shell copy');
  }
  requireText(channelModal, 'Chat with evaOS Workbench assistant via Telegram', 'ChannelModalContent.tsx', issues);
  requireText(channelModal, 'interact with evaOS Workbench from IM apps', 'ChannelModalContent.tsx', issues);
  requireText(tray, "tray.setToolTip('evaOS Workbench');", 'tray.ts', issues);
  requireText(commonEn, 'Show evaOS Workbench', 'en-US/common.json', issues);
  requireText(commonEn, 'About evaOS Workbench', 'en-US/common.json', issues);
  requireText(commonEn, 'evaOS Workbench installation is incomplete', 'en-US/common.json', issues);
  requireText(loginEn, 'evaOS Workbench - Sign In', 'en-US/login.json', issues);
  requireText(loginEn, '"brand": "evaOS Workbench"', 'en-US/login.json', issues);
  requireText(conversationEn, 'What can evaOS Workbench do?', 'en-US/conversation.json', issues);
  requireText(settingsEn, 'Launch evaOS Workbench automatically', 'en-US/settings.json', issues);
  requireText(settingsEn, 'Repository', 'en-US/settings.json', issues);

  requireText(about, 'evaOS Workbench', 'AboutModalContent.tsx', issues);
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
  const releaseProvenance = releaseProvenanceFromEnv(env);
  if (releaseProvenance.mode === RELEASE_PROVENANCE_LOCAL_SIGNED_DMG_FALLBACK) {
    releaseProvenance.finalizedDmgs = finalizedDmgProvenanceFromAssets(assets);
  }
  const releaseRunId =
    releaseProvenance.mode === RELEASE_PROVENANCE_LOCAL_SIGNED_DMG_FALLBACK
      ? releaseProvenance.sourceCiRunId
      : env.GITHUB_RUN_ID || '';

  const manifest = {
    schema: 'evaos-beta-release-manifest/v1',
    tag,
    developmentTag: isDevBetaTag(tag),
    repository: env.GITHUB_REPOSITORY || '',
    releaseWorkflow: env.EVAOS_BETA_RELEASE_WORKFLOW || env.GITHUB_WORKFLOW || '',
    releaseRunId,
    releaseRunAttempt: env.GITHUB_RUN_ATTEMPT || '',
    releaseCommit: env.EVAOS_BETA_RELEASE_COMMIT || env.GITHUB_SHA || '',
    releaseBranch: env.EVAOS_BETA_RELEASE_BRANCH || '',
    releaseTargetPlatforms: env.EVAOS_RELEASE_TARGET_PLATFORMS || 'all',
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
    releaseProvenance,
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

function splitCsvEnv(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function defaultLocalDmgSourceArtifacts(env = process.env) {
  return env.EVAOS_RELEASE_TARGET_PLATFORMS === 'macos-arm64'
    ? 'macos-build-arm64'
    : 'macos-build-arm64,macos-build-x64';
}

function finalizedDmgProvenanceFromAssets(assets) {
  const finalizedDmgs = {};
  for (const asset of assets || []) {
    if (!asset.name?.endsWith('.dmg')) continue;
    const arch = asset.name.includes('arm64') ? 'arm64' : asset.name.includes('x64') ? 'x64' : asset.name;
    finalizedDmgs[arch] = {
      assetName: asset.name,
      sha256: asset.sha256,
      size: asset.size,
    };
  }
  return finalizedDmgs;
}

function releaseProvenanceFromEnv(env = process.env) {
  const mode = env.EVAOS_BETA_RELEASE_PROVENANCE_MODE || RELEASE_PROVENANCE_GITHUB_WORKFLOW;
  if (mode === RELEASE_PROVENANCE_GITHUB_WORKFLOW) {
    return {
      mode,
      sourceCiRunId: env.GITHUB_RUN_ID || '',
      sourceCiWorkflow: env.EVAOS_BETA_RELEASE_WORKFLOW || env.GITHUB_WORKFLOW || '',
      sourceCiConclusion: env.EVAOS_BETA_RELEASE_RUN_CONCLUSION || '',
      sourceCiHeadSha: env.EVAOS_BETA_RELEASE_COMMIT || env.GITHUB_SHA || '',
      sourceCiHeadBranch: env.EVAOS_BETA_RELEASE_BRANCH || '',
    };
  }

  if (mode !== RELEASE_PROVENANCE_LOCAL_SIGNED_DMG_FALLBACK) {
    throw new Error(`Unsupported evaOS beta release provenance mode: ${mode}`);
  }

  return {
    mode,
    sourceCiRunId: env.EVAOS_BETA_LOCAL_DMG_SOURCE_RUN_ID || env.GITHUB_RUN_ID || '',
    sourceCiWorkflow: env.EVAOS_BETA_LOCAL_DMG_SOURCE_WORKFLOW || 'Build and Release',
    sourceCiConclusion: env.EVAOS_BETA_LOCAL_DMG_SOURCE_CONCLUSION || '',
    sourceCiHeadSha: env.EVAOS_BETA_LOCAL_DMG_SOURCE_SHA || env.EVAOS_BETA_RELEASE_COMMIT || env.GITHUB_SHA || '',
    sourceCiHeadBranch: env.EVAOS_BETA_LOCAL_DMG_SOURCE_BRANCH || env.EVAOS_BETA_RELEASE_BRANCH || '',
    sourceArtifactNames: splitCsvEnv(env.EVAOS_BETA_LOCAL_DMG_SOURCE_ARTIFACTS || defaultLocalDmgSourceArtifacts(env)),
    fallbackReason: env.EVAOS_BETA_LOCAL_DMG_FALLBACK_REASON || 'ci-dmg-codesign-timeout',
    localFinalizationProofRef: env.EVAOS_BETA_LOCAL_DMG_FINALIZATION_PROOF_REF || '',
    dmgNotarizationSubmissionIds: splitCsvEnv(env.EVAOS_BETA_LOCAL_DMG_NOTARY_SUBMISSION_IDS),
  };
}

function isLocalSignedDmgFallbackManifest(manifest) {
  return manifest.releaseProvenance?.mode === RELEASE_PROVENANCE_LOCAL_SIGNED_DMG_FALLBACK;
}

function localSignedDmgFallbackAcked(env = process.env) {
  return (
    env.EVAOS_BETA_LOCAL_SIGNED_DMG_FALLBACK_ACK === LOCAL_SIGNED_DMG_FALLBACK_ACK ||
    env.LOCAL_SIGNED_DMG_FALLBACK_ACK === LOCAL_SIGNED_DMG_FALLBACK_ACK
  );
}

function assertNonSecretProofRef(value, label) {
  const text = String(value || '').trim();
  if (text.length < 8) {
    throw new Error(`${label} must include a non-secret proof reference.`);
  }
  if (/Bearer\s+|eyJ[a-zA-Z0-9_-]+\.|password|secret|token/i.test(text)) {
    throw new Error(`${label} must not contain token or secret-looking material.`);
  }
}

function assertNotarySubmissionIds(ids, label) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error(`${label} must include at least one Apple notarization submission id.`);
  }
  for (const id of ids) {
    if (!/^[0-9a-f-]{24,}$/i.test(String(id))) {
      throw new Error(`${label} contains an invalid Apple notarization submission id: ${id}`);
    }
  }
}

function verifyReleaseProvenance(manifest, env = process.env) {
  if (!isLocalSignedDmgFallbackManifest(manifest)) {
    verifyGitHubRun(manifest, env);
    return;
  }

  if (!localSignedDmgFallbackAcked(env)) {
    throw new Error(
      `Local signed DMG fallback manifests require EVAOS_BETA_LOCAL_SIGNED_DMG_FALLBACK_ACK=${LOCAL_SIGNED_DMG_FALLBACK_ACK}.`
    );
  }

  const provenance = manifest.releaseProvenance || {};
  assertNonSecretProofRef(provenance.sourceCiRunId, 'Local signed DMG source run id');
  assertNonSecretProofRef(provenance.sourceCiHeadSha, 'Local signed DMG source SHA');
  assertNonSecretProofRef(provenance.sourceCiWorkflow, 'Local signed DMG source workflow');
  assertNonSecretProofRef(provenance.sourceCiHeadBranch, 'Local signed DMG source branch');
  assertNonSecretProofRef(provenance.fallbackReason, 'Local signed DMG fallback reason');
  assertNonSecretProofRef(provenance.localFinalizationProofRef, 'Local signed DMG finalization proof reference');
  assertNotarySubmissionIds(provenance.dmgNotarizationSubmissionIds, 'Local signed DMG notarization submission ids');
  if (!['failure', 'cancelled', 'success'].includes(String(provenance.sourceCiConclusion || ''))) {
    throw new Error('Local signed DMG source conclusion must be failure, cancelled, or success.');
  }

  if (!Array.isArray(provenance.sourceArtifactNames) || provenance.sourceArtifactNames.length === 0) {
    throw new Error('Local signed DMG manifest must list source artifact names.');
  }
  if (!provenance.finalizedDmgs || Object.keys(provenance.finalizedDmgs).length === 0) {
    throw new Error('Local signed DMG manifest must record finalized DMG checksums.');
  }

  if (manifest.releaseRunId && manifest.releaseRunId !== provenance.sourceCiRunId) {
    throw new Error('Local signed DMG manifest releaseRunId must match releaseProvenance.sourceCiRunId.');
  }
  if (manifest.releaseCommit && manifest.releaseCommit !== provenance.sourceCiHeadSha) {
    throw new Error('Local signed DMG manifest releaseCommit must match releaseProvenance.sourceCiHeadSha.');
  }

  if (!normalizeBoolean(env.EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY)) {
    const repo = manifest.repository || env.GITHUB_REPOSITORY;
    const runJson = execFileSync(
      'gh',
      [
        'run',
        'view',
        String(provenance.sourceCiRunId),
        '--repo',
        repo,
        '--json',
        'conclusion,headSha,headBranch,workflowName,event',
      ],
      { encoding: 'utf8' }
    );
    const run = JSON.parse(runJson);
    if (run.workflowName !== provenance.sourceCiWorkflow) {
      throw new Error(`Local signed DMG source run workflow mismatch: ${run.workflowName}`);
    }
    if (provenance.sourceCiConclusion && run.conclusion !== provenance.sourceCiConclusion) {
      throw new Error(`Local signed DMG source run conclusion ${run.conclusion} does not match manifest.`);
    }
    if (run.event !== 'workflow_dispatch') {
      throw new Error(`Local signed DMG source run was not manually dispatched: ${run.event}`);
    }
    if (run.headSha !== provenance.sourceCiHeadSha) {
      throw new Error(`Local signed DMG source run head ${run.headSha} does not match manifest.`);
    }
    if (provenance.sourceCiHeadBranch && run.headBranch !== provenance.sourceCiHeadBranch) {
      throw new Error(`Local signed DMG source run branch ${run.headBranch} does not match manifest.`);
    }
  }
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

function assertReleaseManifestMetadata(manifest, tag, env = process.env) {
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
}

function releaseTargetPlatformsForManifest(manifest, env = process.env) {
  return env.EVAOS_RELEASE_TARGET_PLATFORMS || manifest.releaseTargetPlatforms || 'all';
}

function assertReleaseManifestAssetList(manifest, env = process.env) {
  const releaseTargetPlatforms = releaseTargetPlatformsForManifest(manifest, env);
  const assetNames = (manifest.assets || []).map((asset) => asset.name).filter(Boolean);
  if (releaseTargetPlatforms === 'windows') {
    if (!assetNames.some((name) => name.endsWith('.exe') || name.endsWith('.msi'))) {
      throw new Error('Release manifest verification for windows requires at least one Windows installer asset.');
    }
  } else if (!assetNames.some((name) => name.endsWith('.dmg'))) {
    throw new Error('Release manifest verification requires at least one macOS DMG asset.');
  }
  if (!assetNames.some((name) => name.endsWith('.yml'))) {
    throw new Error('Release manifest verification requires updater metadata.');
  }
}

function metadataAssetRefs(outputDir, metadataName, metadataText) {
  const metadataPath = path.join(outputDir, metadataName);
  let text = metadataText;
  if (text === undefined) {
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Release manifest verification is missing updater metadata: ${metadataName}.`);
    }
    text = fs.readFileSync(metadataPath, 'utf8');
  }
  const refs = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:-\s*)?(?:path|url):\s*(.+?)\s*$/);
    if (!match) continue;
    let ref = match[1].trim().replace(/^['"]|['"]$/g, '');
    if (/^https?:\/\//i.test(ref)) {
      try {
        ref = path.basename(new URL(ref).pathname);
      } catch {
        throw new Error(`${metadataName} has an invalid updater URL: ${ref}`);
      }
    }
    if (ref) refs.push(ref);
  }
  if (refs.length === 0) {
    throw new Error(`${metadataName} has no path/url updater asset reference.`);
  }
  return refs;
}

function assertUpdaterMetadataRefs(outputDir, metadataName, options = {}) {
  const metadataPath = path.join(outputDir, metadataName);
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Release manifest verification is missing updater metadata: ${metadataName}.`);
  }
  const metadataText = fs.readFileSync(metadataPath, 'utf8');
  if (options.minimumSystemVersion) {
    const match = metadataText.match(/^minimumSystemVersion:\s*['"]?([^'"\s]+)['"]?\s*$/m);
    if (!match || match[1] !== options.minimumSystemVersion) {
      throw new Error(
        `${metadataName} must declare minimumSystemVersion ${options.minimumSystemVersion} for the supported macOS floor.`
      );
    }
  }
  const refs = metadataAssetRefs(outputDir, metadataName, metadataText);
  for (const ref of refs) {
    if (options.requiredExtension && !ref.endsWith(options.requiredExtension)) {
      throw new Error(
        `${metadataName} must reference ${options.requiredExtension} for Electron auto-update; got ${ref}.`
      );
    }
    if (options.namePattern && !options.namePattern.test(ref)) {
      throw new Error(`${metadataName} points to an unexpected updater asset: ${ref}.`);
    }
    const filePath = path.join(outputDir, ref);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`${metadataName} references a missing updater asset: ${ref}.`);
    }
  }
}

function assertMacosAutoUpdateMetadata(outputDir, releaseTargetPlatforms) {
  if (releaseTargetPlatforms === 'windows') return;

  if (releaseTargetPlatforms === 'all' || releaseTargetPlatforms === 'macos') {
    assertUpdaterMetadataRefs(outputDir, 'latest-mac.yml', {
      requiredExtension: '.zip',
      namePattern: /(mac-x64|darwin-x64|x64)/,
      minimumSystemVersion: MACOS_UPDATE_MINIMUM_SYSTEM_VERSION,
    });
  }

  if (
    releaseTargetPlatforms === 'all' ||
    releaseTargetPlatforms === 'macos' ||
    releaseTargetPlatforms === 'macos-arm64'
  ) {
    assertUpdaterMetadataRefs(outputDir, 'latest-arm64-mac.yml', {
      requiredExtension: '.zip',
      namePattern: /(mac-arm64|darwin-arm64|arm64)/,
      minimumSystemVersion: MACOS_UPDATE_MINIMUM_SYSTEM_VERSION,
    });
  }
}

function committedBridgeSourceIdentity(expectedSourceCommit, runGit = execFileSync, rootDir = PROJECT_ROOT) {
  const commit = String(expectedSourceCommit || '').trim();
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error('macOS release verification requires an exact 40-character evaOS-GUI commit.');
  }
  const cacheKey = runGit === execFileSync ? `${path.resolve(rootDir)}\0${commit.toLowerCase()}` : undefined;
  const cached = cacheKey ? committedBridgeSourceIdentityCache.get(cacheKey) : undefined;
  if (cached) {
    return { sourceSha256: cached.sourceSha256, sourcePaths: [...cached.sourcePaths] };
  }

  let resolvedCommit;
  let treeOutput;
  try {
    resolvedCommit = String(
      runGit('git', ['rev-parse', '--verify', `${commit}^{commit}`], {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    ).trim();
    treeOutput = runGit('git', ['ls-tree', '-r', '-z', '--full-tree', commit, '--', WORKBENCH_BRIDGE_SOURCE_DIR], {
      cwd: rootDir,
      encoding: null,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`Unable to read the committed Workbench bridge source tree: ${error.message}`);
  }
  if (resolvedCommit.toLowerCase() !== commit.toLowerCase()) {
    throw new Error(`Workbench bridge source commit resolved to ${resolvedCommit}, expected ${commit}.`);
  }

  const records = Buffer.isBuffer(treeOutput) ? treeOutput.toString('utf8') : String(treeOutput || '');
  const sourceFiles = [];
  for (const record of records.split('\0').filter(Boolean)) {
    const separator = record.indexOf('\t');
    const header = separator >= 0 ? record.slice(0, separator) : '';
    const filePath = separator >= 0 ? record.slice(separator + 1) : '';
    const [mode, type, objectId] = header.split(' ');
    const prefix = `${WORKBENCH_BRIDGE_SOURCE_DIR}/`;
    if (
      !['100644', '100755'].includes(mode) ||
      type !== 'blob' ||
      !/^[0-9a-f]{40,64}$/i.test(objectId || '') ||
      !filePath.startsWith(prefix)
    ) {
      throw new Error(`Committed Workbench bridge source tree contains an unsupported entry: ${record}`);
    }
    const relativePath = filePath.slice(prefix.length);
    if (!relativePath || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`Committed Workbench bridge source path is invalid: ${filePath}`);
    }
    let contents;
    try {
      contents = runGit('git', ['cat-file', 'blob', objectId], {
        cwd: rootDir,
        encoding: null,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new Error(`Unable to read committed Workbench bridge source blob ${objectId}: ${error.message}`);
    }
    sourceFiles.push({ relativePath, contents: Buffer.isBuffer(contents) ? contents : Buffer.from(contents) });
  }
  if (sourceFiles.length === 0) {
    throw new Error(`Commit ${commit} does not contain the Workbench bridge source tree.`);
  }
  sourceFiles.sort((left, right) =>
    Buffer.compare(Buffer.from(left.relativePath, 'utf8'), Buffer.from(right.relativePath, 'utf8'))
  );
  const digest = createHash('sha256');
  for (const sourceFile of sourceFiles) {
    digest.update(sourceFile.relativePath);
    digest.update('\0');
    digest.update(sourceFile.contents);
    digest.update('\0');
  }
  const identity = {
    sourceSha256: digest.digest('hex'),
    sourcePaths: sourceFiles.map((sourceFile) => sourceFile.relativePath),
  };
  if (cacheKey) {
    committedBridgeSourceIdentityCache.set(cacheKey, {
      sourceSha256: identity.sourceSha256,
      sourcePaths: Object.freeze([...identity.sourcePaths]),
    });
  }
  return identity;
}

function inspectMacosZipBridgePayload(zipPath, expectedSourceCommit, committedSourceIdentity, expectedAppVersion) {
  const expectedEd25519VerifierSourceSha256 = createHash('sha256')
    .update(
      fs.readFileSync(
        path.join(PROJECT_ROOT, 'resources', 'evaos-beta', 'bridge', 'native', 'EvaOSEd25519Verify.swift')
      )
    )
    .digest('hex');
  const script = [
    'import hashlib',
    'import json',
    'import pathlib',
    'import plistlib',
    'import posixpath',
    'import stat',
    'import sys',
    'import zipfile',
    'path = pathlib.Path(sys.argv[1])',
    'expected_python_arch = "arm64" if "arm64" in path.name else "x64"',
    `expected_source_sha256 = "${PEEKABOO_SOURCE_SHA256}"`,
    `expected_version = "${PEEKABOO_PACKAGE_VERSION}"`,
    `expected_license_path = "${PEEKABOO_LICENSE_PATH}"`,
    `expected_python_version = "${PYTHON_RUNTIME_VERSION}"`,
    `expected_python_source_sha256 = ${JSON.stringify(PYTHON_RUNTIME_SOURCE_SHA256)}`,
    `expected_python_source_url = ${JSON.stringify(PYTHON_RUNTIME_SOURCE_URL)}`,
    `expected_python_license_path = "${PYTHON_RUNTIME_LICENSE_PATH}"`,
    `expected_python_license_sha256 = "${PYTHON_RUNTIME_LICENSE_SHA256}"`,
    `expected_python_packages = ${JSON.stringify(PYTHON_RUNTIME_PACKAGES)}`,
    `expected_bridge_wrapper_sha256 = "${createHash('sha256').update(bridgeWrapperScript()).digest('hex')}"`,
    `expected_source_commit = ${JSON.stringify(String(expectedSourceCommit || ''))}`,
    `expected_bridge_source_sha256 = ${JSON.stringify(committedSourceIdentity.sourceSha256)}`,
    `expected_bridge_source_paths = ${JSON.stringify(committedSourceIdentity.sourcePaths)}`,
    `expected_app_version = ${JSON.stringify(String(expectedAppVersion || ''))}`,
    `expected_ed25519_verifier_source_sha256 = ${JSON.stringify(expectedEd25519VerifierSourceSha256)}`,
    'macho_magics = {"feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "cafebabf", "bebafeca", "bfbafeca"}',
    'expected_cpu_types = {"arm64": 0x0100000c, "x64": 0x01000007}',
    'def thin_macho_cpu(data):',
    '    if len(data) < 8:',
    '        return None',
    '    magic = data[:4].hex()',
    '    if magic in {"cffaedfe", "cefaedfe"}:',
    '        return int.from_bytes(data[4:8], "little")',
    '    if magic in {"feedfacf", "feedface"}:',
    '        return int.from_bytes(data[4:8], "big")',
    '    return None',
    'def macho_has_arch(data, expected_arch):',
    '    expected_cpu = expected_cpu_types[expected_arch]',
    '    thin_cpu = thin_macho_cpu(data)',
    '    if thin_cpu is not None:',
    '        return thin_cpu == expected_cpu',
    '    if len(data) < 8:',
    '        return False',
    '    magic = data[:4].hex()',
    '    fat_shapes = {"cafebabe": ("big", 20, False), "bebafeca": ("little", 20, False), "cafebabf": ("big", 32, True), "bfbafeca": ("little", 32, True)}',
    '    if magic not in fat_shapes:',
    '        return False',
    '    byteorder, record_size, is_fat64 = fat_shapes[magic]',
    '    count = int.from_bytes(data[4:8], byteorder)',
    '    if count <= 0 or count > 64 or 8 + count * record_size > len(data):',
    '        return False',
    '    for index in range(count):',
    '        record = 8 + index * record_size',
    '        cpu_type = int.from_bytes(data[record:record + 4], byteorder)',
    '        if is_fat64:',
    '            offset = int.from_bytes(data[record + 8:record + 16], byteorder)',
    '            size = int.from_bytes(data[record + 16:record + 24], byteorder)',
    '        else:',
    '            offset = int.from_bytes(data[record + 8:record + 12], byteorder)',
    '            size = int.from_bytes(data[record + 12:record + 16], byteorder)',
    '        if cpu_type == expected_cpu and size >= 8 and offset + size <= len(data):',
    '            if thin_macho_cpu(data[offset:offset + size]) == expected_cpu:',
    '                return True',
    '    return False',
    'def safe_zip_name(name):',
    '    normalized = name[:-1] if name.endswith("/") else name',
    '    parts = normalized.split("/")',
    '    return bool(normalized) and not normalized.startswith("/") and "\\\\" not in normalized and all(part not in {"", ".", ".."} for part in parts)',
    'def app_root_for_name(name):',
    '    parts = name.split("/")',
    '    for index, part in enumerate(parts[:-1]):',
    '        if part.endswith(".app") and parts[index + 1] == "Contents":',
    '            return "/".join(parts[:index + 1])',
    '    return None',
    'def zip_mode(info):',
    '    return ((info.external_attr >> 16) & 0xffff) if info.create_system == 3 else 0',
    'def regular_executable(info):',
    '    mode = zip_mode(info)',
    '    return stat.S_ISREG(mode) and bool(stat.S_IMODE(mode) & 0o111)',
    'def sha256_info(archive, info):',
    '    digest = hashlib.sha256()',
    '    with archive.open(info) as stream:',
    '        while True:',
    '            chunk = stream.read(1024 * 1024)',
    '            if not chunk:',
    '                break',
    '            digest.update(chunk)',
    '    return digest.hexdigest()',
    'def safe_symlink_target(relative_path, target):',
    '    if not target or posixpath.isabs(target) or "\\\\" in target:',
    '        return False',
    '    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(relative_path), target))',
    '    return resolved != ".." and not resolved.startswith("../")',
    'result = {"zipLayoutValid": False, "singleAppRoot": False, "infoPlistValid": False, "bundleIdentifierValid": False, "productNameValid": False, "shortVersionValid": False, "bundleVersionValid": False, "hasBridgeExecutable": False, "hasBridgeManifest": False, "hasPeekaboo": False, "hasConnectorHelper": False, "hasEd25519Verifier": False, "hasPeekabooLicense": False, "executableModesValid": False, "bridgeWrapperValid": False, "bridgeSourceTreeExact": False, "bridgeSourceDigestValid": False, "bridgeCommitBindingValid": False, "peekabooMachO": False, "connectorHelperMachO": False, "ed25519VerifierMachO": False, "ed25519VerifierArchValid": False, "ed25519VerifierManifestValid": False, "manifestPlaceholderFalse": False, "manifestSourceDigestValid": False, "manifestLicenseMetadataValid": False, "licenseDigestValid": False, "licenseNoticeValid": False, "hasPythonRuntime": False, "hasPythonLauncher": False, "pythonLauncherValid": False, "pythonRuntimeMachO": False, "pythonRuntimeArchValid": False, "hasPythonLicense": False, "pythonManifestValid": False, "pythonLicenseDigestValid": False, "hasPythonControlModules": False, "pythonObjcArchValid": False, "pythonInventoryValid": False, "hasPythonStdlibSentinel": False, "hasPythonNativeSentinels": False, "pythonNativeSentinelsExecutable": False}',
    'with zipfile.ZipFile(path) as archive:',
    '    infos = archive.infolist()',
    '    names = [info.filename for info in infos]',
    '    safe_layout = len(infos) <= 200000 and sum(info.file_size for info in infos) <= 4 * 1024 * 1024 * 1024 and len(names) == len(set(names)) and all(safe_zip_name(name.rstrip("/")) for name in names)',
    '    app_roots = {root for name in names if (root := app_root_for_name(name))}',
    '    result["zipLayoutValid"] = safe_layout',
    '    result["singleAppRoot"] = safe_layout and app_roots == {"evaOS Workbench.app"}',
    '    entries = {}',
    '    if result["singleAppRoot"]:',
    '        app_root = "evaOS Workbench.app"',
    '        info_path = f"{app_root}/Contents/Info.plist"',
    '        info_matches = [info for info in infos if info.filename == info_path]',
    '        info_plist = {}',
    '        if len(info_matches) == 1 and stat.S_ISREG(zip_mode(info_matches[0])):',
    '            try:',
    '                parsed_info = plistlib.loads(archive.read(info_matches[0]))',
    '                info_plist = parsed_info if isinstance(parsed_info, dict) else {}',
    '            except (plistlib.InvalidFileException, ValueError, TypeError):',
    '                info_plist = {}',
    '        result["infoPlistValid"] = bool(info_plist)',
    '        result["bundleIdentifierValid"] = info_plist.get("CFBundleIdentifier") == "com.evaos.workbench"',
    '        result["productNameValid"] = info_plist.get("CFBundleName") == "evaOS Workbench"',
    '        result["shortVersionValid"] = info_plist.get("CFBundleShortVersionString") == expected_app_version',
    '        result["bundleVersionValid"] = info_plist.get("CFBundleVersion") == expected_app_version',
    '        bridge_prefix = f"{app_root}/Contents/Resources/Bridge/"',
    '        for info in infos:',
    '            if info.filename.startswith(bridge_prefix) and not info.is_dir():',
    '                suffix = info.filename[len(bridge_prefix):]',
    '                if suffix:',
    '                    entries[suffix] = info',
    '    result["hasBridgeExecutable"] = "evaos-desktop-bridge" in entries',
    '    result["hasBridgeManifest"] = "manifest.json" in entries',
    '    result["hasPeekaboo"] = "bin/peekaboo" in entries',
    '    result["hasConnectorHelper"] = "bin/evaos-connector-helper" in entries',
    '    result["hasEd25519Verifier"] = "bin/evaos-ed25519-verify" in entries',
    '    result["hasPeekabooLicense"] = expected_license_path in entries',
    '    result["hasPythonRuntime"] = "python/bin/python3.12" in entries',
    '    result["hasPythonLauncher"] = "python/bin/python3" in entries',
    '    result["hasPythonLicense"] = expected_python_license_path in entries',
    '    executable_paths = ["evaos-desktop-bridge", "bin/peekaboo", "bin/evaos-connector-helper", "bin/evaos-ed25519-verify", "python/bin/python3.12"]',
    '    result["executableModesValid"] = all(name in entries and regular_executable(entries[name]) for name in executable_paths)',
    '    control_module_paths = {"python/lib/python3.12/site-packages/ApplicationServices/__init__.py", "python/lib/python3.12/site-packages/Cocoa/__init__.py", "python/lib/python3.12/site-packages/CoreText/__init__.py", "python/lib/python3.12/site-packages/Quartz/__init__.py", "python/lib/python3.12/site-packages/objc/__init__.py"}',
    '    result["hasPythonControlModules"] = control_module_paths.issubset(entries)',
    '    manifest = {}',
    '    if result["hasBridgeManifest"]:',
    '        try:',
    '            manifest = json.loads(archive.read(entries["manifest.json"]))',
    '        except (json.JSONDecodeError, UnicodeDecodeError):',
    '            manifest = {}',
    '    peekaboo = manifest.get("bundledTools", {}).get("peekaboo", {}) if isinstance(manifest, dict) else {}',
    '    python_runtime = manifest.get("bundledTools", {}).get("python", {}) if isinstance(manifest, dict) else {}',
    '    bridge_wrapper = manifest.get("bundledTools", {}).get("bridgeWrapper", {}) if isinstance(manifest, dict) else {}',
    '    ed25519_verifier = manifest.get("bundledTools", {}).get("ed25519Verifier", {}) if isinstance(manifest, dict) else {}',
    '    source_provenance = manifest.get("sourceProvenance", {}) if isinstance(manifest, dict) else {}',
    '    result["manifestPlaceholderFalse"] = manifest.get("placeholder") is False if isinstance(manifest, dict) else False',
    '    imported_commit = str(source_provenance.get("importedCommit", ""))',
    '    result["bridgeCommitBindingValid"] = manifest.get("sourceCommit") == expected_source_commit and manifest.get("requestedSourceRef") == expected_source_commit and manifest.get("sourcePath") == "resources/evaos-beta/bridge" and source_provenance.get("schema") == "evaos-workbench-vendored-bridge-source/v1" and source_provenance.get("owner") == "100yenadmin/evaOS-GUI" and source_provenance.get("status") == "vendored" and len(imported_commit) == 40 and all(char in "0123456789abcdefABCDEF" for char in imported_commit)',
    '    if result["hasBridgeExecutable"]:',
    '        wrapper_sha256 = sha256_info(archive, entries["evaos-desktop-bridge"])',
    '        result["bridgeWrapperValid"] = bridge_wrapper.get("schema") == "evaos-workbench-bridge-wrapper/v1" and bridge_wrapper.get("path") == "evaos-desktop-bridge" and bridge_wrapper.get("sourceSha256") == wrapper_sha256 == expected_bridge_wrapper_sha256',
    '    bridge_source_prefix = "src/evaos_desktop_bridge/"',
    '    bridge_source_entries = []',
    '    bridge_source_layout_valid = not any(suffix.startswith("src/") and not suffix.startswith(bridge_source_prefix) for suffix in entries)',
    '    for suffix, info in entries.items():',
    '        if not suffix.startswith(bridge_source_prefix):',
    '            continue',
    '        relative_path = suffix[len(bridge_source_prefix):]',
    '        if not relative_path or "__pycache__" in relative_path.split("/") or not stat.S_ISREG(zip_mode(info)):',
    '            bridge_source_layout_valid = False',
    '            continue',
    '        bridge_source_entries.append((relative_path, info))',
    '    actual_bridge_source_paths = sorted(relative_path for relative_path, _info in bridge_source_entries)',
    '    result["bridgeSourceTreeExact"] = bridge_source_layout_valid and actual_bridge_source_paths == expected_bridge_source_paths',
    '    if result["bridgeSourceTreeExact"]:',
    '        bridge_source_hash = hashlib.sha256()',
    '        for relative_path, info in sorted(bridge_source_entries, key=lambda item: item[0]):',
    '            bridge_source_hash.update(relative_path.encode("utf-8"))',
    '            bridge_source_hash.update(b"\\0")',
    '            bridge_source_hash.update(archive.read(info))',
    '            bridge_source_hash.update(b"\\0")',
    '        packaged_bridge_source_sha256 = bridge_source_hash.hexdigest()',
    '        result["bridgeSourceDigestValid"] = source_provenance.get("sourceSha256") == packaged_bridge_source_sha256 == expected_bridge_source_sha256',
    '    result["manifestSourceDigestValid"] = peekaboo.get("version") == expected_version and peekaboo.get("sourceSha256") == expected_source_sha256',
    '    result["ed25519VerifierManifestValid"] = ed25519_verifier.get("schema") == "evaos-workbench-ed25519-verifier/v1" and ed25519_verifier.get("path") == "bin/evaos-ed25519-verify" and ed25519_verifier.get("architecture") == expected_python_arch and ed25519_verifier.get("minimumMacOS") == "15.0" and ed25519_verifier.get("sourceSha256") == expected_ed25519_verifier_source_sha256',
    '    result["manifestLicenseMetadataValid"] = peekaboo.get("license") == "MIT" and peekaboo.get("licensePath") == expected_license_path',
    '    result["pythonManifestValid"] = python_runtime.get("version") == expected_python_version and python_runtime.get("architecture") == expected_python_arch and python_runtime.get("sourceSha256") == expected_python_source_sha256[expected_python_arch] and python_runtime.get("sourceUrl") == expected_python_source_url[expected_python_arch] and python_runtime.get("license") == "Python-2.0" and python_runtime.get("licensePath") == expected_python_license_path and python_runtime.get("licenseSha256") == expected_python_license_sha256 and python_runtime.get("packages") == expected_python_packages',
    '    if result["hasPeekaboo"]:',
    '        result["peekabooMachO"] = archive.read(entries["bin/peekaboo"])[:4].hex() in macho_magics',
    '    if result["hasConnectorHelper"]:',
    '        result["connectorHelperMachO"] = archive.read(entries["bin/evaos-connector-helper"])[:4].hex() in macho_magics',
    '    if result["hasEd25519Verifier"]:',
    '        ed25519_verifier_bytes = archive.read(entries["bin/evaos-ed25519-verify"])',
    '        result["ed25519VerifierMachO"] = ed25519_verifier_bytes[:4].hex() in macho_magics',
    '        result["ed25519VerifierArchValid"] = macho_has_arch(ed25519_verifier_bytes, expected_python_arch)',
    '    if result["hasPythonRuntime"]:',
    '        python_bytes = archive.read(entries["python/bin/python3.12"])',
    '        result["pythonRuntimeMachO"] = python_bytes[:4].hex() in macho_magics',
    '        result["pythonRuntimeArchValid"] = macho_has_arch(python_bytes, expected_python_arch)',
    '    if result["hasPythonLauncher"]:',
    '        launcher_info = entries["python/bin/python3"]',
    '        launcher_bytes = archive.read(launcher_info)',
    '        launcher_mode = zip_mode(launcher_info)',
    '        result["pythonLauncherValid"] = stat.S_ISLNK(launcher_mode) and launcher_bytes == b"python3.12"',
    '    native_paths = {"python/lib/python3.12/site-packages/objc/_objc.cpython-312-darwin.so", "python/lib/python3.12/site-packages/Foundation/_Foundation.cpython-312-darwin.so", "python/lib/python3.12/site-packages/Quartz/CoreGraphics/_coregraphics.cpython-312-darwin.so", "python/lib/python3.12/site-packages/HIServices/_HIServices.cpython-312-darwin.so", "python/lib/python3.12/site-packages/CoreText/_manual.cpython-312-darwin.so"}',
    '    result["hasPythonNativeSentinels"] = native_paths.issubset(entries)',
    '    if result["hasPythonNativeSentinels"]:',
    '        result["pythonNativeSentinelsExecutable"] = all(regular_executable(entries[name]) for name in native_paths)',
    '        result["pythonObjcArchValid"] = all(macho_has_arch(archive.read(entries[name]), expected_python_arch) for name in native_paths)',
    '    result["hasPythonStdlibSentinel"] = "python/lib/python3.12/encodings/__init__.py" in entries',
    '    inventory_info = entries.get("python-runtime-inventory.json")',
    '    if inventory_info is not None and isinstance(python_runtime, dict):',
    '        inventory_bytes = archive.read(inventory_info)',
    '        try:',
    '            inventory = json.loads(inventory_bytes)',
    '        except (json.JSONDecodeError, UnicodeDecodeError):',
    '            inventory = {}',
    '        declared_entries = inventory.get("entries", []) if isinstance(inventory, dict) else []',
    '        metadata_valid = inventory.get("schema") == "evaos-python-runtime-inventory/v1" and python_runtime.get("inventoryPath") == "python-runtime-inventory.json" and python_runtime.get("inventorySha256") == hashlib.sha256(inventory_bytes).hexdigest() and python_runtime.get("inventoryEntryCount") == len(declared_entries)',
    '        declared_paths = [entry.get("path") for entry in declared_entries if isinstance(entry, dict)]',
    '        actual_python = {}',
    '        python_prefix = f"{bridge_prefix}python/"',
    '        python_root_valid = False',
    '        normalized_python_collision = False',
    '        for info in infos:',
    '            if info.filename == python_prefix:',
    '                root_mode = zip_mode(info)',
    '                python_root_valid = info.is_dir() and stat.S_ISDIR(root_mode) and (stat.S_IMODE(root_mode) & 0o500) == 0o500',
    '                continue',
    '            if info.filename == python_prefix.rstrip("/"):',
    '                normalized_python_collision = True',
    '                continue',
    '            if not info.filename.startswith(python_prefix):',
    '                continue',
    '            relative_path = info.filename[len(python_prefix):].rstrip("/") if info.is_dir() else info.filename[len(python_prefix):]',
    '            if relative_path:',
    '                if relative_path in actual_python:',
    '                    normalized_python_collision = True',
    '                actual_python[relative_path] = info',
    '        inventory_valid = metadata_valid and python_root_valid and not normalized_python_collision and len(declared_paths) == len(declared_entries) and declared_paths == sorted(declared_paths) and len(declared_paths) == len(set(declared_paths)) and set(declared_paths) == set(actual_python)',
    '        if inventory_valid:',
    '            for declared in declared_entries:',
    '                relative_path = declared["path"]',
    '                if not safe_zip_name(relative_path):',
    '                    inventory_valid = False',
    '                    break',
    '                info = actual_python[relative_path]',
    '                mode = zip_mode(info)',
    '                declared_type = declared.get("type")',
    '                if declared_type == "directory":',
    '                    if declared.get("mode") != stat.S_IMODE(mode) or not info.is_dir() or not stat.S_ISDIR(mode) or (stat.S_IMODE(mode) & 0o500) != 0o500:',
    '                        inventory_valid = False',
    '                        break',
    '                elif declared_type == "file":',
    '                    declared_sha256 = declared.get("sha256")',
    '                    declared_size = declared.get("size")',
    '                    if declared.get("mode") != stat.S_IMODE(mode) or not stat.S_ISREG(mode) or not isinstance(declared_size, int) or declared_size < 0 or not isinstance(declared_sha256, str) or len(declared_sha256) != 64:',
    '                        inventory_valid = False',
    '                        break',
    '                    # Developer ID signing changes Mach-O bytes after the exact pre-sign afterPack inventory check.',
    '                    # At distribution time, bind these entries by path/type/mode plus the expected architecture slice.',
    '                    if declared.get("signedMachO") is True:',
    '                        signed_bytes = archive.read(info)',
    '                        if signed_bytes[:4].hex() not in macho_magics or not macho_has_arch(signed_bytes, expected_python_arch):',
    '                            inventory_valid = False',
    '                            break',
    '                    elif declared.get("signedMachO") is not None or declared_size != info.file_size or declared_sha256 != sha256_info(archive, info):',
    '                        inventory_valid = False',
    '                        break',
    '                elif declared_type == "symlink":',
    '                    try:',
    '                        target = archive.read(info).decode("utf-8")',
    '                    except UnicodeDecodeError:',
    '                        target = ""',
    '                    if not stat.S_ISLNK(mode) or declared.get("target") != target or not safe_symlink_target(relative_path, target):',
    '                        inventory_valid = False',
    '                        break',
    '                else:',
    '                    inventory_valid = False',
    '                    break',
    '        result["pythonInventoryValid"] = inventory_valid',
    '    if result["hasPeekabooLicense"]:',
    '        license_bytes = archive.read(entries[expected_license_path])',
    '        result["licenseDigestValid"] = hashlib.sha256(license_bytes).hexdigest() == peekaboo.get("licenseSha256")',
    '        try:',
    '            license_text = license_bytes.decode("utf-8")',
    '        except UnicodeDecodeError:',
    '            license_text = ""',
    '        result["licenseNoticeValid"] = license_text.startswith("MIT License") and "Permission is hereby granted" in license_text',
    '    if result["hasPythonLicense"]:',
    '        python_license_bytes = archive.read(entries[expected_python_license_path])',
    '        result["pythonLicenseDigestValid"] = hashlib.sha256(python_license_bytes).hexdigest() == expected_python_license_sha256',
    'print(json.dumps(result))',
  ].join('\n');
  try {
    return JSON.parse(execFileSync('python3', ['-c', script, zipPath], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to inspect macOS ZIP payload ${path.basename(zipPath)}: ${message}`);
  }
}

function assertZipBridgeProbe(probe, key, zipName, label) {
  if (!probe[key]) {
    throw new Error(`${zipName} is missing or has invalid bundled evaOS desktop bridge ${label}.`);
  }
}

function macosZipAssetNames(outputDir, releaseTargetPlatforms) {
  if (releaseTargetPlatforms === 'windows') return [];
  const names = listReleaseAssetFiles(outputDir).filter((name) => name.endsWith('.zip'));
  if (releaseTargetPlatforms === 'macos-arm64') {
    return names.filter((name) => /mac-arm64|darwin-arm64|arm64/.test(name));
  }
  return names.filter((name) => /-mac-|darwin-|arm64|x64/.test(name));
}

function assertMacosZipBridgePayload(outputDir, releaseTargetPlatforms, expectedSourceCommit, expectedAppVersion) {
  const zipNames = macosZipAssetNames(outputDir, releaseTargetPlatforms);
  if (releaseTargetPlatforms !== 'windows' && zipNames.length === 0) {
    throw new Error('Release manifest verification requires a macOS ZIP payload for Electron auto-update.');
  }

  const committedSourceIdentity =
    releaseTargetPlatforms === 'windows' ? undefined : committedBridgeSourceIdentity(expectedSourceCommit);
  for (const zipName of zipNames) {
    const probe = inspectMacosZipBridgePayload(
      path.join(outputDir, zipName),
      expectedSourceCommit,
      committedSourceIdentity,
      expectedAppVersion
    );
    assertZipBridgeProbe(probe, 'zipLayoutValid', zipName, 'safe ZIP layout');
    assertZipBridgeProbe(probe, 'singleAppRoot', zipName, 'exactly one .app root');
    assertZipBridgeProbe(probe, 'infoPlistValid', zipName, 'canonical Info.plist');
    assertZipBridgeProbe(probe, 'bundleIdentifierValid', zipName, 'bundle identifier');
    assertZipBridgeProbe(probe, 'productNameValid', zipName, 'product name');
    assertZipBridgeProbe(probe, 'shortVersionValid', zipName, 'tag-bound short version');
    assertZipBridgeProbe(probe, 'bundleVersionValid', zipName, 'tag-bound bundle version');
    assertZipBridgeProbe(probe, 'hasBridgeExecutable', zipName, 'executable');
    assertZipBridgeProbe(probe, 'hasBridgeManifest', zipName, 'manifest');
    assertZipBridgeProbe(probe, 'bridgeWrapperValid', zipName, 'canonical launcher digest');
    assertZipBridgeProbe(probe, 'bridgeSourceTreeExact', zipName, 'exact committed GUI source tree');
    assertZipBridgeProbe(probe, 'bridgeSourceDigestValid', zipName, 'GUI-owned Python source digest');
    assertZipBridgeProbe(probe, 'bridgeCommitBindingValid', zipName, 'exact GUI commit binding');
    assertZipBridgeProbe(probe, 'hasPeekaboo', zipName, 'Peekaboo binary');
    assertZipBridgeProbe(probe, 'peekabooMachO', zipName, 'Peekaboo binary Mach-O shape');
    assertZipBridgeProbe(probe, 'hasConnectorHelper', zipName, 'connector helper');
    assertZipBridgeProbe(probe, 'executableModesValid', zipName, 'executable ZIP mode');
    assertZipBridgeProbe(probe, 'connectorHelperMachO', zipName, 'connector helper Mach-O shape');
    assertZipBridgeProbe(probe, 'hasEd25519Verifier', zipName, 'Ed25519 verifier');
    assertZipBridgeProbe(probe, 'ed25519VerifierMachO', zipName, 'Ed25519 verifier Mach-O shape');
    assertZipBridgeProbe(probe, 'ed25519VerifierArchValid', zipName, 'Ed25519 verifier architecture');
    assertZipBridgeProbe(probe, 'ed25519VerifierManifestValid', zipName, 'Ed25519 verifier manifest identity');
    assertZipBridgeProbe(probe, 'hasPeekabooLicense', zipName, 'Peekaboo license');
    assertZipBridgeProbe(probe, 'manifestPlaceholderFalse', zipName, 'non-placeholder manifest');
    assertZipBridgeProbe(probe, 'manifestSourceDigestValid', zipName, 'Peekaboo source digest');
    assertZipBridgeProbe(probe, 'manifestLicenseMetadataValid', zipName, 'Peekaboo license metadata');
    assertZipBridgeProbe(probe, 'licenseDigestValid', zipName, 'Peekaboo license digest');
    assertZipBridgeProbe(probe, 'licenseNoticeValid', zipName, 'Peekaboo license notice');
    assertZipBridgeProbe(probe, 'hasPythonRuntime', zipName, 'bundled Python runtime');
    assertZipBridgeProbe(probe, 'hasPythonLauncher', zipName, 'bundled Python launcher');
    assertZipBridgeProbe(probe, 'pythonLauncherValid', zipName, 'relocatable bundled Python launcher');
    assertZipBridgeProbe(probe, 'pythonRuntimeMachO', zipName, 'bundled Python runtime Mach-O shape');
    assertZipBridgeProbe(probe, 'pythonRuntimeArchValid', zipName, 'bundled Python runtime architecture');
    assertZipBridgeProbe(probe, 'hasPythonLicense', zipName, 'CPython license');
    assertZipBridgeProbe(probe, 'pythonManifestValid', zipName, 'bundled Python runtime provenance');
    assertZipBridgeProbe(probe, 'pythonLicenseDigestValid', zipName, 'CPython license digest');
    assertZipBridgeProbe(probe, 'hasPythonControlModules', zipName, 'bundled PyObjC control modules');
    assertZipBridgeProbe(probe, 'hasPythonStdlibSentinel', zipName, 'Python stdlib sentinel');
    assertZipBridgeProbe(probe, 'hasPythonNativeSentinels', zipName, 'PyObjC native sentinel');
    assertZipBridgeProbe(probe, 'pythonNativeSentinelsExecutable', zipName, 'PyObjC native sentinel executable mode');
    assertZipBridgeProbe(probe, 'pythonObjcArchValid', zipName, 'bundled PyObjC native runtime architecture');
    assertZipBridgeProbe(probe, 'pythonInventoryValid', zipName, 'Python runtime inventory');
  }
}

function verifyReleaseManifest(outputDir, tag, env = process.env) {
  assertPublicDistributionTag(tag);

  const manifest = selectTrustedManifest(outputDir, env);
  assertReleaseManifestMetadata(manifest, tag, env);
  assertReleaseManifestAssetList(manifest, env);

  const manifestAssets = new Map((manifest.assets || []).map((asset) => [asset.name, asset]));
  const actualAssets = listReleaseAssetFiles(outputDir);
  const releaseTargetPlatforms = releaseTargetPlatformsForManifest(manifest, env);
  if (releaseTargetPlatforms === 'windows') {
    if (!actualAssets.some((name) => name.endsWith('.exe') || name.endsWith('.msi'))) {
      throw new Error('Release manifest verification for windows requires at least one Windows installer asset.');
    }
  } else if (!actualAssets.some((name) => name.endsWith('.dmg'))) {
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

  assertMacosAutoUpdateMetadata(outputDir, releaseTargetPlatforms);
  assertMacosZipBridgePayload(outputDir, releaseTargetPlatforms, manifest.releaseCommit, versionFromPublicBetaTag(tag));
  verifyReleaseProvenance(manifest, env);
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

function assertLiveCanaryNoSecretMaterial(value, label = '$', seen = new WeakSet()) {
  if (typeof value === 'string') {
    if (LIVE_CANARY_SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new Error(`Live broker canary proof contains secret material at ${label}.`);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((child, index) => assertLiveCanaryNoSecretMaterial(child, `${label}[${index}]`, seen));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (LIVE_CANARY_SECRET_FIELD_PATTERN.test(key)) {
      if (key === 'secretScan' && child === 'passed') {
        continue;
      }
      if (key === 'launchUrlRedacted' && child === true) {
        continue;
      }
      throw new Error(`Live broker canary proof contains secret material field at ${label}.${key}.`);
    }
    assertLiveCanaryNoSecretMaterial(child, `${label}.${key}`, seen);
  }
}

function assertLiveCanarySafeText(value, label) {
  const text = String(value || '').trim();
  if (!text) {
    throw new Error(`Live broker canary proof is missing ${label}.`);
  }
  assertLiveCanaryNoSecretMaterial(text, label);
  return text;
}

function assertLiveCanaryPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Unexpected ${label} schema: not an object`);
  }
  return value;
}

function hasExactLiveCanaryFields(value, fields) {
  const keys = Object.keys(value);
  return keys.length === fields.length && keys.every((field) => fields.includes(field));
}

function optionalLiveCanarySafeText(value, label) {
  const text = String(value || '').trim();
  if (!text) {
    return undefined;
  }
  assertLiveCanaryNoSecretMaterial(text, label);
  return text;
}

function assertLiveCanaryNotDenied(value, label) {
  const text = String(value || '').toLowerCase();
  if (
    /(denied|blocked|forbidden|unauthorized|expired|revoked|permission|mac_connector_material_missing|internal server error|internal_server_error|server_error)/.test(
      text
    )
  ) {
    throw new Error(`Live broker canary proof has denied status for ${label}.`);
  }
}

function liveCanaryVerificationOptions(env = process.env) {
  const maxAgeRaw = String(env.EVAOS_LIVE_CANARY_MAX_PROOF_AGE_HOURS || '24').trim();
  const maxAgeHours = Number.parseFloat(maxAgeRaw);
  const expectedCustomerId = optionalLiveCanarySafeText(
    env.EVAOS_LIVE_CANARY_EXPECTED_CUSTOMER_ID ||
      env.AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID ||
      env.AIONUI_EVAOS_CUSTOMER_ID ||
      env.AIONUI_EVAOS_RELEASE_CANARY_CUSTOMER_ID,
    'expectedCustomerId'
  );
  const expectedReleaseCanaryCustomerId = optionalLiveCanarySafeText(
    env.EVAOS_LIVE_CANARY_EXPECTED_RELEASE_CANARY_CUSTOMER_ID || env.AIONUI_EVAOS_RELEASE_CANARY_CUSTOMER_ID,
    'expectedReleaseCanaryCustomerId'
  );
  if (!expectedCustomerId) {
    throw new Error('Live broker canary proof requires EVAOS_LIVE_CANARY_EXPECTED_CUSTOMER_ID.');
  }
  return {
    expectedCustomerId,
    expectedReleaseCanaryCustomerId,
    maxAgeHours: Number.isFinite(maxAgeHours) && maxAgeHours > 0 ? maxAgeHours : 24,
    now: new Date(),
  };
}

function assertLiveCanaryFresh(checkedAt, label, options) {
  const text = assertLiveCanarySafeText(checkedAt, label);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Live broker canary proof has invalid timestamp for ${label}.`);
  }
  const ageMs = options.now.getTime() - timestamp;
  const maxAgeMs = options.maxAgeHours * 60 * 60 * 1000;
  if (ageMs < -5 * 60 * 1000) {
    throw new Error(`Live broker canary proof timestamp is in the future for ${label}.`);
  }
  if (ageMs > maxAgeMs) {
    throw new Error(`Live broker canary proof is stale for ${label}.`);
  }
}

function assertLiveCanaryCustomerId(customerId, label, expectedCustomerId) {
  const text = assertLiveCanarySafeText(customerId, label);
  if (expectedCustomerId && text !== expectedCustomerId) {
    throw new Error(`Live broker canary proof customer mismatch for ${label}.`);
  }
  return text;
}

function assertBusinessBrowserSourceAudit(record, label) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`Business Browser live proof is missing ${label}.`);
  }
  assertLiveCanarySafeText(record.sourcePointer, `${label}.sourcePointer`);
  assertLiveCanarySafeText(record.auditId, `${label}.auditId`);
}

function assertBusinessBrowserRuntimeProof(record, label, customerId, expectedStatus) {
  assertBusinessBrowserSourceAudit(record, label);
  assertLiveCanaryCustomerId(record.customerId, `${label}.customerId`, customerId);
  assertLiveCanaryNotDenied(record.status, `${label}.status`);
  if (expectedStatus && record.status !== expectedStatus) {
    throw new Error(`Business Browser live proof ${label} must have status ${expectedStatus}.`);
  }
  if (record.runtime !== 'browser') {
    throw new Error(`Business Browser live proof ${label} must use browser runtime.`);
  }
  if (record.canOpenUrl !== true || record.canStop !== true) {
    throw new Error(`Business Browser live proof ${label} must include open and stop controls.`);
  }
}

function assertBusinessBrowserActionProof(record, label, customerId, expectedStatus) {
  assertBusinessBrowserSourceAudit(record, label);
  assertLiveCanaryCustomerId(record.customerId, `${label}.customerId`, customerId);
  assertLiveCanaryNotDenied(record.status, `${label}.status`);
  if (record.status !== expectedStatus) {
    throw new Error(`Business Browser live proof ${label} must have status ${expectedStatus}.`);
  }
  if (record.backendEnforced !== true) {
    throw new Error(`Business Browser live proof ${label} must prove backend enforcement.`);
  }
}

function assertBusinessBrowserDeniedProof(record, label) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`Business Browser live proof is missing ${label}.`);
  }
  for (const action of ['runtime', 'open', 'stop']) {
    const proof = record[action];
    assertBusinessBrowserSourceAudit(proof, `${label}.${action}`);
    if (proof.backendDenied !== true) {
      throw new Error(`Business Browser live proof ${label}.${action} must fail closed.`);
    }
  }
}

function verifyBusinessBrowserLiveCanaryProof(proofDir, customerId, options) {
  const proofPath = requireExistingRelativeFile(
    proofDir,
    BUSINESS_BROWSER_LIVE_CANARY_PROOF_NAME,
    'Business Browser live canary proof'
  );
  const proof = readManifestFile(proofPath);

  assertLiveCanaryPlainObject(proof, 'Business Browser live proof');
  if (proof.schema !== 'evaos-business-browser-live-proof/v1') {
    throw new Error(`Unexpected Business Browser live proof schema: ${proof.schema}`);
  }
  assertLiveCanaryNoSecretMaterial(proof);
  assertLiveCanaryCustomerId(proof.customerId, 'businessBrowser.customerId', customerId);
  assertLiveCanaryFresh(proof.checkedAt, 'businessBrowser.checkedAt', options);
  if (proof.dryRun === true || proof.acceptanceProof !== true) {
    throw new Error('Business Browser live proof must be a non-dry-run acceptance proof.');
  }
  if (proof.sensitiveOutput !== 'passed') {
    throw new Error('Business Browser live proof must pass sensitive output scanning.');
  }
  if (proof.customerIsolation !== 'passed' || proof.negativeBoundary !== 'required') {
    throw new Error('Business Browser live proof must include customer isolation and negative-boundary proof.');
  }

  const policy = proof.policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error('Business Browser live proof is missing policy.');
  }
  assertLiveCanaryCustomerId(policy.customerId, 'businessBrowser.policy.customerId', customerId);
  assertLiveCanarySafeText(policy.auditId, 'businessBrowser.policy.auditId');
  if (policy.hasOpenBusinessBrowser !== true || policy.backendEnforced !== true) {
    throw new Error('Business Browser live proof must prove broker policy authorization.');
  }

  assertBusinessBrowserRuntimeProof(proof.before, 'businessBrowser.before', customerId);
  assertBusinessBrowserActionProof(proof.open, 'businessBrowser.open', customerId, 'opened');
  assertBusinessBrowserRuntimeProof(proof.afterOpen, 'businessBrowser.afterOpen', customerId, 'running');
  assertBusinessBrowserActionProof(proof.stop, 'businessBrowser.stop', customerId, 'stopped');
  assertBusinessBrowserRuntimeProof(proof.afterStop, 'businessBrowser.afterStop', customerId, 'stopped');
  assertBusinessBrowserDeniedProof(proof.wrongCustomer, 'businessBrowser.wrongCustomer');
  assertBusinessBrowserDeniedProof(proof.deniedMember, 'businessBrowser.deniedMember');
}

function verifyBrokerLiveCanaryProof(proofDir, env = process.env) {
  const options = liveCanaryVerificationOptions(env);
  const proofPath = requireExistingRelativeFile(proofDir, BROKER_LIVE_CANARY_PROOF_NAME, 'Live broker canary proof');
  const proof = readManifestFile(proofPath);

  assertLiveCanaryPlainObject(proof, 'live broker canary proof');
  if (proof.schema !== 'evaos-broker-live-canary/v3') {
    throw new Error(`Unexpected live broker canary schema: ${proof.schema}`);
  }
  assertLiveCanaryNoSecretMaterial(proof);
  const proofCustomerId = assertLiveCanaryCustomerId(proof.customerId, 'customerId', options.expectedCustomerId);
  assertLiveCanaryCustomerId(
    proof.releaseCanaryCustomerId,
    'releaseCanaryCustomerId',
    options.expectedReleaseCanaryCustomerId || proofCustomerId
  );
  assertLiveCanaryFresh(proof.checkedAt, 'checkedAt', options);
  if (proof.secretScan !== 'passed') {
    throw new Error('Live broker canary proof must pass secret scanning.');
  }
  if (!Array.isArray(proof.surfaces)) {
    throw new Error('Live broker canary proof must include surfaces.');
  }

  const requiredSurfaceNames = new Set(REQUIRED_BROKER_LIVE_CANARY_SURFACES.map((surface) => surface.surface));
  const surfaces = new Map();
  for (const surface of proof.surfaces) {
    assertLiveCanaryPlainObject(surface, 'live broker canary surface');
    const surfaceName = assertLiveCanarySafeText(surface.surface, 'surface.surface');
    if (!requiredSurfaceNames.has(surfaceName)) {
      throw new Error(`Live broker canary proof includes unknown surface: ${surfaceName}`);
    }
    if (surfaces.has(surfaceName)) {
      throw new Error(`Live broker canary proof includes duplicate surface: ${surfaceName}`);
    }
    surfaces.set(surfaceName, surface);
  }
  for (const required of REQUIRED_BROKER_LIVE_CANARY_SURFACES) {
    const surface = surfaces.get(required.surface);
    if (!surface) {
      throw new Error(`Live broker canary proof is missing required surface: ${required.surface}`);
    }
    if (surface.runtime !== required.runtime) {
      throw new Error(
        `Live broker canary surface ${required.surface} must use runtime ${required.runtime}, got ${surface.runtime || 'missing'}.`
      );
    }
    assertLiveCanaryNotDenied(surface.status, required.surface);
    assertLiveCanarySafeText(surface.sourcePointer, `${required.surface}.sourcePointer`);
    assertLiveCanarySafeText(surface.auditId, `${required.surface}.auditId`);
    assertLiveCanaryFresh(surface.checkedAt, `${required.surface}.checkedAt`, options);
    if (surface.secretScan !== 'passed') {
      throw new Error(`Live broker canary surface ${required.surface} must pass secret scanning.`);
    }

    const launch = surface.launch;
    if (!launch || typeof launch !== 'object' || Array.isArray(launch)) {
      throw new Error(`Live broker canary surface ${required.surface} is missing launch proof.`);
    }
    assertLiveCanaryNotDenied(launch.status, `${required.surface}.launch`);
    if (launch.launchMode !== 'dashboard_surface') {
      throw new Error(`Live broker canary surface ${required.surface} must use dashboard_surface launch mode.`);
    }
    if (launch.launchUrlRedacted !== true) {
      throw new Error(`Live broker canary surface ${required.surface} must redact launch URL.`);
    }
    assertLiveCanarySafeText(launch.sourcePointer, `${required.surface}.launch.sourcePointer`);
    assertLiveCanarySafeText(launch.auditId, `${required.surface}.launch.auditId`);
    assertLiveCanaryFresh(launch.checkedAt, `${required.surface}.launch.checkedAt`, options);
    if (launch.secretScan !== 'passed') {
      throw new Error(`Live broker canary launch ${required.surface} must pass secret scanning.`);
    }
  }

  const businessBrowserProofPath = path.join(proofDir, BUSINESS_BROWSER_LIVE_CANARY_PROOF_NAME);
  if (fs.existsSync(businessBrowserProofPath)) {
    verifyBusinessBrowserLiveCanaryProof(proofDir, proofCustomerId, options);
  }

  if (normalizeBoolean(env.EVAOS_REQUIRE_MAC_CONTROL_LIVE_CANARY_PROOF)) {
    verifyMacControlLiveCanaryProof(proofDir, env, options);
  }

  return true;
}

function verifyMacControlLiveCanaryProof(proofDir, env = process.env, verificationOptions = {}) {
  const proofPath = requireExistingRelativeFile(
    proofDir,
    MAC_CONTROL_LIVE_CANARY_PROOF_NAME,
    'Mac-control live canary proof'
  );
  const proof = readManifestFile(proofPath);
  assertLiveCanaryPlainObject(proof, 'Mac-control live canary proof');

  const allowedTopLevelFields = new Set(MAC_CONTROL_RUNTIME_PROOF_FIELDS);
  for (const field of Object.keys(proof)) {
    if (!allowedTopLevelFields.has(field)) {
      throw new Error(`Mac-control live canary proof contains forbidden field: ${field}.`);
    }
  }
  assertLiveCanaryNoSecretMaterial(proof, 'macControl');

  if (Object.keys(proof).length !== allowedTopLevelFields.size) {
    throw new Error('Mac-control live canary proof is missing required signed-attestation fields.');
  }

  const expectedHeadSha = String(env.EVAOS_LIVE_CANARY_EXPECTED_SOURCE_HEAD_SHA || '').trim();
  const expectedRunId = String(env.EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID || '').trim();
  const receiptKeyId = String(env.EVAOS_LIVE_CANARY_RECEIPT_KEY_ID || '').trim();
  const receiptPublicKey = String(env.EVAOS_LIVE_CANARY_RECEIPT_PUBLIC_KEY || '').trim();
  const expectedContextKeyId = String(env.EVAOS_LIVE_CANARY_CONTEXT_KEY_ID || '').trim();
  if (!/^[0-9a-f]{40}$/i.test(expectedHeadSha)) {
    throw new Error('Mac-control live canary proof requires EVAOS_LIVE_CANARY_EXPECTED_SOURCE_HEAD_SHA.');
  }
  if (!/^\d+$/.test(expectedRunId)) {
    throw new Error('Mac-control live canary proof requires EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(expectedContextKeyId)) {
    throw new Error('Mac-control live canary proof requires EVAOS_LIVE_CANARY_CONTEXT_KEY_ID.');
  }
  let attestation;
  try {
    attestation = verifyMacControlPublicAttestation(proof, {
      keyId: receiptKeyId,
      publicKey: receiptPublicKey,
    });
  } catch {
    throw new Error('Mac-control live canary public attestation signature is invalid.');
  }
  assertLiveCanaryNoSecretMaterial(attestation, 'macControlAttestation');
  if (
    attestation.proofKind !== 'selected_binding_direct_mac_control' ||
    attestation.runtime !== 'openclaw' ||
    attestation.tool !== 'customer_mac.desktop_hotkey' ||
    attestation.outcome !== 'succeeded' ||
    attestation.controlState !== 'ready_unchanged' ||
    attestation.auditRecorded !== true ||
    attestation.contextKeyId !== expectedContextKeyId
  ) {
    throw new Error('Mac-control live canary release gate requires a successful signed direct-control attestation.');
  }
  if (!new RegExp(`^gha:${expectedRunId}:[0-9a-f]{24}$`).test(String(attestation.runRef || ''))) {
    throw new Error('Mac-control live canary proof run does not match the selected proof run.');
  }

  const executedAtText = String(attestation.executedAt || '');
  const executedAt = Date.parse(executedAtText);
  const authorityIssuedAtMs = Number.isSafeInteger(attestation.authorityIssuedAt)
    ? attestation.authorityIssuedAt * 1000
    : Number.NaN;
  const authorityExpiresAtMs = Number.isSafeInteger(attestation.authorityExpiresAt)
    ? attestation.authorityExpiresAt * 1000
    : Number.NaN;
  const maxAgeRaw = String(env.EVAOS_LIVE_CANARY_MAX_PROOF_AGE_HOURS || '24').trim();
  const configuredMaxAgeHours = Number.parseFloat(maxAgeRaw);
  const maxAgeHours =
    Number.isFinite(verificationOptions.maxAgeHours) && verificationOptions.maxAgeHours > 0
      ? verificationOptions.maxAgeHours
      : Number.isFinite(configuredMaxAgeHours) && configuredMaxAgeHours > 0
        ? configuredMaxAgeHours
        : 24;
  const configuredVerificationNow =
    verificationOptions.now instanceof Date ? verificationOptions.now.getTime() : Number.NaN;
  const verificationNow = Number.isFinite(configuredVerificationNow) ? configuredVerificationNow : Date.now();
  const receiptAgeMs = verificationNow - executedAt;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(executedAtText) ||
    !Number.isFinite(executedAt) ||
    !Number.isFinite(authorityIssuedAtMs) ||
    !Number.isFinite(authorityExpiresAtMs) ||
    receiptAgeMs < -5_000 ||
    receiptAgeMs > maxAgeHours * 60 * 60 * 1000 ||
    authorityExpiresAtMs <= authorityIssuedAtMs ||
    authorityExpiresAtMs - authorityIssuedAtMs > 60_000 ||
    executedAt < authorityIssuedAtMs - 5_000 ||
    executedAt > authorityExpiresAtMs ||
    !/^[0-9a-f]{64}$/.test(String(attestation.privateReceiptSha256 || ''))
  ) {
    throw new Error('Mac-control live canary signed attestation fields are invalid.');
  }

  assertLiveCanaryPlainObject(attestation.connectorCandidate, 'Mac-control live canary candidate');
  const candidateFields = ['sourceCommit', 'sourceSha256', 'appVersion', 'appBuild'];
  if (
    Object.keys(attestation.connectorCandidate).length !== candidateFields.length ||
    Object.keys(attestation.connectorCandidate).some((field) => !candidateFields.includes(field))
  ) {
    throw new Error('Mac-control live canary candidate fields do not match the required release contract.');
  }
  const expectedSourceSha256 = committedBridgeSourceIdentity(expectedHeadSha).sourceSha256;
  const expectedVersion = packageVersionAtCommit(expectedHeadSha);
  if (
    attestation.connectorCandidate.sourceCommit !== expectedHeadSha ||
    attestation.connectorCandidate.sourceSha256 !== expectedSourceSha256 ||
    attestation.connectorCandidate.appVersion !== expectedVersion ||
    attestation.connectorCandidate.appBuild !== expectedVersion
  ) {
    throw new Error('Mac-control live canary candidate does not match the exact release commit.');
  }

  const negativePath = requireExistingRelativeFile(
    proofDir,
    MAC_CONTROL_NEGATIVE_PROOF_NAME,
    'Mac-control runtime-receipt negative proof'
  );
  const negativeProof = readManifestFile(negativePath);
  assertLiveCanaryPlainObject(negativeProof, 'Mac-control runtime-receipt negative proof');
  assertLiveCanaryNoSecretMaterial(negativeProof, 'macControlNegative');
  const negativeFields = [
    'schema',
    'proofMode',
    'sourceRunId',
    'candidate',
    'classifications',
    'connectorActionAttempted',
    'sensitiveOutputAbsent',
  ];
  if (
    !hasExactLiveCanaryFields(negativeProof, negativeFields) ||
    negativeProof.schema !== 'evaos.mac_control.deployed_negative_probe.v1' ||
    negativeProof.proofMode !== 'deployed-staging' ||
    String(negativeProof.sourceRunId || '') !== expectedRunId ||
    negativeProof.connectorActionAttempted !== false ||
    negativeProof.sensitiveOutputAbsent !== true
  ) {
    throw new Error('Mac-control runtime-receipt negative proof does not match the exact release run.');
  }
  assertLiveCanaryPlainObject(negativeProof.candidate, 'Mac-control runtime-receipt negative candidate');
  if (
    !hasExactLiveCanaryFields(negativeProof.candidate, candidateFields) ||
    negativeProof.candidate.sourceCommit !== expectedHeadSha ||
    negativeProof.candidate.sourceSha256 !== expectedSourceSha256 ||
    negativeProof.candidate.appVersion !== expectedVersion ||
    negativeProof.candidate.appBuild !== expectedVersion
  ) {
    throw new Error('Mac-control runtime-receipt negative candidate does not match the exact release commit.');
  }
  assertLiveCanaryPlainObject(negativeProof.classifications, 'Mac-control runtime-receipt negative classifications');
  const negativeClassifications = ['forgedSignature', 'expiredContext', 'replay'];
  if (!hasExactLiveCanaryFields(negativeProof.classifications, negativeClassifications)) {
    throw new Error('Mac-control runtime-receipt negative classifications are incomplete.');
  }
  const forgedSignature = assertLiveCanaryPlainObject(
    negativeProof.classifications.forgedSignature,
    'Mac-control forged-signature classification'
  );
  const expiredContext = assertLiveCanaryPlainObject(
    negativeProof.classifications.expiredContext,
    'Mac-control expired-context classification'
  );
  const replay = assertLiveCanaryPlainObject(negativeProof.classifications.replay, 'Mac-control replay classification');
  if (
    !hasExactLiveCanaryFields(forgedSignature, ['rejected', 'httpStatus', 'code']) ||
    forgedSignature.rejected !== true ||
    forgedSignature.httpStatus !== 401 ||
    forgedSignature.code !== 'execution_context_signature_invalid' ||
    !hasExactLiveCanaryFields(expiredContext, ['rejected', 'httpStatus', 'code']) ||
    expiredContext.rejected !== true ||
    expiredContext.httpStatus !== 401 ||
    expiredContext.code !== 'execution_context_expired' ||
    !hasExactLiveCanaryFields(replay, ['firstAccepted', 'secondRejected', 'httpStatus', 'code']) ||
    replay.firstAccepted !== true ||
    replay.secondRejected !== true ||
    replay.httpStatus !== 409 ||
    replay.code !== 'execution_context_replayed'
  ) {
    throw new Error('Mac-control runtime-receipt negative classifications are incomplete.');
  }

  const deployedProbePath = requireExistingRelativeFile(
    proofDir,
    MAC_CONTROL_DEPLOYED_PROBE_NAME,
    'Mac-control deployed route probe'
  );
  const deployedProbe = readManifestFile(deployedProbePath);
  assertLiveCanaryPlainObject(deployedProbe, 'Mac-control deployed route probe');
  assertLiveCanaryNoSecretMaterial(deployedProbe, 'macControlDeployedRoute');
  const deployedProbeFields = ['schema', 'sourceHeadSha', 'sourceRunId', 'checkedAt', 'assertions'];
  if (
    Object.keys(deployedProbe).length !== deployedProbeFields.length ||
    Object.keys(deployedProbe).some((field) => !deployedProbeFields.includes(field)) ||
    deployedProbe.schema !== 'evaos.mac_control.deployed_route_probe.v1' ||
    deployedProbe.sourceHeadSha !== expectedHeadSha ||
    String(deployedProbe.sourceRunId || '') !== expectedRunId
  ) {
    throw new Error('Mac-control deployed route probe does not match the exact release run.');
  }
  assertLiveCanaryFresh(deployedProbe.checkedAt, 'macControlDeployedRoute.checkedAt', {
    now: new Date(verificationNow),
    maxAgeHours,
  });
  assertLiveCanaryPlainObject(deployedProbe.assertions, 'Mac-control deployed route assertions');
  const deployedAssertions = [
    'gatewayAuthRequired',
    'postOnly',
    'exactMatch',
    'strictBody',
    'callerAuthorityBodyRejected',
    'sensitiveOutputAbsent',
  ];
  if (
    Object.keys(deployedProbe.assertions).length !== deployedAssertions.length ||
    Object.keys(deployedProbe.assertions).some((field) => !deployedAssertions.includes(field)) ||
    deployedAssertions.some((field) => deployedProbe.assertions[field] !== true)
  ) {
    throw new Error('Mac-control deployed route assertions are incomplete.');
  }

  const provisionPath = requireExistingRelativeFile(
    proofDir,
    MAC_CONTROL_PROVISION_PROOF_NAME,
    'Mac-control provisioning proof'
  );
  const provisionProof = readManifestFile(provisionPath);
  assertLiveCanaryPlainObject(provisionProof, 'Mac-control provisioning proof');
  const allowedProvisionFields = new Set([
    'schema',
    'accountConfigured',
    'customerConfigured',
    'activeMembershipVerified',
    'stagingMarkerVerified',
    'sessionMinted',
    'sessionExpiryPresent',
    'sensitiveOutput',
  ]);
  for (const field of Object.keys(provisionProof)) {
    if (!allowedProvisionFields.has(field)) {
      throw new Error(`Mac-control provisioning proof contains forbidden field: ${field}.`);
    }
  }
  assertLiveCanaryNoSecretMaterial(provisionProof, 'macControlProvisioning');
  if (
    provisionProof.schema !== 'evaos-mac-control-canary-session-provision/v1' ||
    provisionProof.accountConfigured !== true ||
    provisionProof.customerConfigured !== true ||
    provisionProof.activeMembershipVerified !== true ||
    provisionProof.stagingMarkerVerified !== true ||
    provisionProof.sessionMinted !== true ||
    provisionProof.sessionExpiryPresent !== true ||
    provisionProof.sensitiveOutput !== 'passed'
  ) {
    throw new Error('Mac-control provisioning proof must prove the database-backed staging marker and session mint.');
  }

  const cleanupPath = requireExistingRelativeFile(
    proofDir,
    MAC_CONTROL_CLEANUP_PROOF_NAME,
    'Mac-control cleanup proof'
  );
  const cleanupProof = readManifestFile(cleanupPath);
  assertLiveCanaryPlainObject(cleanupProof, 'Mac-control cleanup proof');
  const allowedCleanupFields = new Set(['schema', 'sessionRevoked', 'sensitiveOutput']);
  for (const field of Object.keys(cleanupProof)) {
    if (!allowedCleanupFields.has(field)) {
      throw new Error(`Mac-control cleanup proof contains forbidden field: ${field}.`);
    }
  }
  assertLiveCanaryNoSecretMaterial(cleanupProof, 'macControlCleanup');
  if (
    cleanupProof.schema !== 'evaos-mac-control-canary-session-cleanup/v1' ||
    cleanupProof.sessionRevoked !== true ||
    cleanupProof.sensitiveOutput !== 'passed'
  ) {
    throw new Error('Mac-control cleanup proof must prove that the temporary session was revoked.');
  }

  return true;
}

function assertRcProofDoesNotEmbedReleaseAssets(proofDir) {
  const embedded = [];

  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      if (stat.isDirectory()) {
        walk(file);
        continue;
      }
      if (!stat.isFile()) continue;
      if (['.dmg', '.zip', '.exe', '.msi', '.deb'].includes(path.extname(name).toLowerCase())) {
        embedded.push(path.relative(proofDir, file));
      }
    }
  }

  walk(proofDir);

  if (embedded.length > 0) {
    throw new Error(`RC proof packet must not embed release asset bytes: ${embedded.join(', ')}`);
  }
}

function assertRcReleaseAssetsReference(referencePath, tag, releaseManifest) {
  const reference = readManifestFile(referencePath);
  if (reference.schema !== 'evaos-beta-release-assets-reference/v1') {
    throw new Error(`Unexpected RC release assets reference schema: ${reference.schema}`);
  }
  if (reference.tag !== tag) {
    throw new Error(`RC release assets reference tag ${reference.tag} does not match requested tag ${tag}.`);
  }
  if (reference.repository !== releaseManifest.repository) {
    throw new Error(`RC release assets reference repository ${reference.repository} does not match release manifest.`);
  }
  if (String(reference.releaseRunId || '') !== String(releaseManifest.releaseRunId || '')) {
    throw new Error(`RC release assets reference run id ${reference.releaseRunId} does not match release manifest.`);
  }
  if (String(reference.releaseCommit || '') !== String(releaseManifest.releaseCommit || '')) {
    throw new Error(`RC release assets reference commit ${reference.releaseCommit} does not match release manifest.`);
  }

  const manifestAssets = new Map((releaseManifest.assets || []).map((asset) => [asset.name, asset]));
  const referencedAssets = new Map((reference.assets || []).map((asset) => [asset.name, asset]));
  if (manifestAssets.size === 0 || referencedAssets.size === 0) {
    throw new Error('RC release assets reference must list release asset names, sizes, and SHA256 values.');
  }

  for (const [name, asset] of manifestAssets.entries()) {
    const referenceAsset = referencedAssets.get(name);
    if (!referenceAsset) {
      throw new Error(`RC release assets reference is missing asset: ${name}`);
    }
    if (referenceAsset.size !== asset.size || referenceAsset.sha256 !== asset.sha256) {
      throw new Error(`RC release assets reference does not match manifest checksum: ${name}`);
    }
  }

  for (const name of referencedAssets.keys()) {
    if (!manifestAssets.has(name)) {
      throw new Error(`RC release assets reference lists unknown asset: ${name}`);
    }
  }
}

function assertRcUpdaterZipTrustProof(proofPath, tag, releaseManifest, releaseAssetsDir, releaseAssetBytesDir) {
  const proof = readManifestFile(proofPath);
  if (proof.schema !== 'evaos-updater-zip-trust/v2') {
    throw new Error(`Unexpected updater ZIP trust proof schema: ${proof.schema}`);
  }
  if (proof.tag !== tag || proof.releaseCommit !== releaseManifest.releaseCommit) {
    throw new Error('Updater ZIP trust proof is not bound to the RC tag and release commit.');
  }
  if (
    typeof proof.assetName !== 'string' ||
    !proof.assetName.endsWith('.zip') ||
    path.basename(proof.assetName) !== proof.assetName ||
    !/arm64/i.test(proof.assetName) ||
    !/^[0-9a-f]{64}$/i.test(String(proof.sha256 || ''))
  ) {
    throw new Error('Updater ZIP trust proof must identify the exact arm64 ZIP and SHA256.');
  }
  const manifestAsset = (releaseManifest.assets || []).find((asset) => asset.name === proof.assetName);
  if (!manifestAsset || manifestAsset.sha256 !== proof.sha256) {
    throw new Error('Updater ZIP trust proof checksum does not match the trusted release manifest.');
  }
  if (!fs.existsSync(releaseAssetBytesDir) || !fs.statSync(releaseAssetBytesDir).isDirectory()) {
    throw new Error('RC proof verification requires the downloaded release asset directory.');
  }
  const updaterZipPath = path.join(releaseAssetBytesDir, proof.assetName);
  let updaterZipStat;
  try {
    updaterZipStat = fs.lstatSync(updaterZipPath);
  } catch {
    throw new Error(`Updater ZIP trust proof asset is missing from the verified release asset set: ${proof.assetName}`);
  }
  if (!updaterZipStat.isFile() || updaterZipStat.isSymbolicLink()) {
    throw new Error(`Updater ZIP trust proof asset must be a regular file: ${proof.assetName}`);
  }
  if (sha256File(updaterZipPath) !== proof.sha256) {
    throw new Error('Updater ZIP bytes do not match the updater ZIP trust proof checksum.');
  }
  const updaterZipRefs = [
    ...new Set(
      metadataAssetRefs(releaseAssetsDir, 'latest-arm64-mac.yml').filter(
        (assetName) => assetName.endsWith('.zip') && /arm64/i.test(assetName)
      )
    ),
  ];
  if (updaterZipRefs.length !== 1 || updaterZipRefs[0] !== proof.assetName) {
    throw new Error('Updater ZIP trust proof does not match latest-arm64-mac.yml.');
  }
  const expectedVersion = versionFromPublicBetaTag(tag);
  if (
    proof.appName !== 'evaOS Workbench.app' ||
    proof.bundleId !== 'com.evaos.workbench' ||
    proof.productName !== 'evaOS Workbench' ||
    proof.shortVersion !== expectedVersion ||
    proof.bundleVersion !== expectedVersion ||
    proof.codesignVerified !== true ||
    proof.staplerVerified !== true ||
    proof.gatekeeperVerified !== true
  ) {
    throw new Error(
      'Updater ZIP trust proof must bind the exact app, bundle, product, tag version, codesign, stapler, and Gatekeeper checks.'
    );
  }
}

function versionFromPublicBetaTag(tag) {
  const match = String(tag || '').match(/^evaos-beta-v?(\d+\.\d+\.\d+)-evaos-beta(?:\.\d+)?$/);
  if (!match) {
    throw new Error(`Unable to derive candidate version from public beta tag: ${tag}`);
  }
  return match[1];
}

function packageVersionAtCommit(commit) {
  if (!/^[0-9a-f]{40}$/i.test(String(commit || ''))) {
    throw new Error('Package version lookup requires an exact release commit.');
  }
  let manifest;
  try {
    manifest = JSON.parse(
      execFileSync('git', ['show', `${commit}:package.json`], {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      })
    );
  } catch {
    throw new Error(`Unable to read package.json from release commit ${commit}.`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))) {
    throw new Error(`Release commit ${commit} does not contain a valid package version.`);
  }
  return manifest.version;
}

function assertRcInstalledCandidatePreCanaryProof(proofPath, tag, releaseManifest) {
  const proof = readManifestFile(proofPath);
  const expectedVersion = versionFromPublicBetaTag(tag);
  const expectedSourceIdentity = committedBridgeSourceIdentity(releaseManifest.releaseCommit);
  const summary = proof.summary && typeof proof.summary === 'object' ? proof.summary : {};
  const binding =
    summary.bridge_source_binding && typeof summary.bridge_source_binding === 'object'
      ? summary.bridge_source_binding
      : {};
  const appBundles = Array.isArray(proof.inventory?.app_bundles) ? proof.inventory.app_bundles : [];
  const canonical = appBundles.find((bundle) => bundle?.path === '/Applications/evaOS Workbench.app');
  const checkCodes = new Set(Array.isArray(proof.checks) ? proof.checks.map((check) => check?.code) : []);
  if (
    proof.ok !== true ||
    summary.canonical_path !== '/Applications/evaOS Workbench.app' ||
    summary.bundle_id !== 'com.evaos.workbench' ||
    summary.expected_version !== expectedVersion ||
    typeof summary.expected_build !== 'string' ||
    !/^\d+(?:\.\d+){0,2}$/.test(summary.expected_build) ||
    summary.expected_source_commit !== releaseManifest.releaseCommit ||
    binding.ok !== true ||
    binding.source_commit !== releaseManifest.releaseCommit ||
    binding.requested_source_ref !== releaseManifest.releaseCommit ||
    binding.source_path !== 'resources/evaos-beta/bridge' ||
    binding.owner !== '100yenadmin/evaOS-GUI' ||
    binding.status !== 'vendored' ||
    binding.app_path !== '/Applications/evaOS Workbench.app' ||
    binding.app_version !== expectedVersion ||
    binding.app_build !== summary.expected_build ||
    binding.app_bundle_id !== 'com.evaos.workbench' ||
    binding.app_name !== 'evaOS Workbench' ||
    binding.source_integrity_valid !== true ||
    !/^[0-9a-f]{64}$/i.test(String(binding.actual_source_sha256 || '')) ||
    binding.actual_source_sha256 !== binding.source_sha256 ||
    binding.actual_source_sha256 !== expectedSourceIdentity.sourceSha256 ||
    !canonical ||
    canonical.bundle_id !== 'com.evaos.workbench' ||
    canonical.version !== expectedVersion ||
    canonical.build !== summary.expected_build ||
    !checkCodes.has('packaged_bridge_source_integrity_verified')
  ) {
    throw new Error(
      'Installed candidate pre-canary proof is not bound to the trusted release commit and app identity.'
    );
  }
}

function assertRcInstalledCandidateConnectorProof(proofPath, tag, releaseManifest) {
  const proof = readManifestFile(proofPath);
  const expectedVersion = versionFromPublicBetaTag(tag);
  const expectedSourceIdentity = committedBridgeSourceIdentity(releaseManifest.releaseCommit);
  const binding = proof.candidate_binding && typeof proof.candidate_binding === 'object' ? proof.candidate_binding : {};
  const local = binding.local && typeof binding.local === 'object' ? binding.local : {};
  const connector = binding.connector && typeof binding.connector === 'object' ? binding.connector : {};
  const selected =
    binding.selected_binding && typeof binding.selected_binding === 'object' ? binding.selected_binding : {};
  const results = Array.isArray(proof.results) ? proof.results : [];
  const expectedResults = [
    { id: 'control_start.bridge_status', command: 'desktop_bridge_status' },
    { id: 'control_start.full_access', command: 'local_workbench_control_start', mode: 'full-access' },
    { id: 'control_start.ask_permission', command: 'local_workbench_control_start', mode: 'ask-permission' },
    { id: 'control_start.stop', command: 'desktop_control_stop' },
    { id: 'control_start.kill_switch', command: 'desktop_kill_switch' },
    { id: 'control_cleanup.local_kill_switch', command: 'desktop_kill_switch' },
  ];
  const requiredStatuses = expectedResults.map((expected) => ({
    expected,
    matches: results.filter((result) => result?.id === expected.id),
  }));
  const summary = proof.summary && typeof proof.summary === 'object' ? proof.summary : {};
  if (
    proof.source_commit_under_test !== releaseManifest.releaseCommit ||
    proof.version_under_test !== expectedVersion ||
    typeof proof.build_under_test !== 'string' ||
    !/^\d+(?:\.\d+){0,2}$/.test(proof.build_under_test) ||
    binding.ok !== true ||
    local.ok !== true ||
    connector.ok !== true ||
    local.source_commit !== releaseManifest.releaseCommit ||
    connector.source_commit !== releaseManifest.releaseCommit ||
    local.actual_source_sha256 !== connector.source_sha256 ||
    connector.source_sha256 !== expectedSourceIdentity.sourceSha256 ||
    !/^[0-9a-f]{64}$/i.test(String(connector.source_sha256 || '')) ||
    local.app_path !== '/Applications/evaOS Workbench.app' ||
    connector.app_path !== '/Applications/evaOS Workbench.app' ||
    local.app_version !== expectedVersion ||
    connector.app_version !== expectedVersion ||
    local.app_build !== proof.build_under_test ||
    connector.app_build !== proof.build_under_test ||
    connector.app_bundle_id !== 'com.evaos.workbench' ||
    connector.app_name !== 'evaOS Workbench' ||
    selected.ok !== null ||
    selected.reason !== 'selected_binding_proof_not_required_for_suite' ||
    results.length !== expectedResults.length ||
    summary.total !== expectedResults.length ||
    summary.passed !== expectedResults.length ||
    summary.failed !== 0 ||
    summary.skipped !== 0 ||
    requiredStatuses.some(({ expected, matches }) => {
      const result = matches[0];
      return (
        matches.length !== 1 ||
        result.ok !== true ||
        result.status !== 'passed' ||
        result.command !== expected.command ||
        (expected.mode && result.params_redacted?.mode !== expected.mode)
      );
    })
  ) {
    throw new Error('Installed candidate connector proof is not bound to the trusted release commit and app identity.');
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
    releaseAssetsReferencePath: `release-assets/${RC_RELEASE_ASSETS_REFERENCE_NAME}`,
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
  const releaseManifest = readManifestFile(path.join(resolvedReleaseAssetsDir, RELEASE_MANIFEST_NAME));
  const releaseAssetBytesDir = path.resolve(env.EVAOS_BETA_RC_RELEASE_ASSETS_DIR || 'release-assets');

  const trustedManifestRelativePath = manifest.trustedManifestPath || '';
  const trustedManifestPath = requireExistingRelativeFile(
    proofDir,
    trustedManifestRelativePath,
    'RC proof trusted release manifest'
  );
  const trustedManifest = readManifestFile(trustedManifestPath);
  if (canonicalManifestJson(releaseManifest) !== canonicalManifestJson(trustedManifest)) {
    throw new Error(`RC proof release manifest does not match trusted workflow artifact ${trustedManifestPath}.`);
  }
  assertReleaseManifestMetadata(trustedManifest, tag, env);
  assertReleaseManifestAssetList(trustedManifest, {
    ...env,
    EVAOS_RELEASE_TARGET_PLATFORMS: trustedManifest.releaseTargetPlatforms || '',
  });
  verifyReleaseProvenance(trustedManifest, env);

  const releaseAssetsReferenceRelativePath =
    manifest.releaseAssetsReferencePath || path.join(releaseAssetsDir, RC_RELEASE_ASSETS_REFERENCE_NAME);
  const releaseAssetsReferencePath = requireExistingRelativeFile(
    proofDir,
    releaseAssetsReferenceRelativePath,
    'RC proof release assets reference'
  );
  assertRcReleaseAssetsReference(releaseAssetsReferencePath, tag, trustedManifest);
  assertRcProofDoesNotEmbedReleaseAssets(proofDir);

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
    if (required.id === 'macos-arm64-updater-zip-trust') {
      assertRcUpdaterZipTrustProof(filePath, tag, trustedManifest, resolvedReleaseAssetsDir, releaseAssetBytesDir);
    } else if (required.id === 'installed-candidate-pre-canary') {
      assertRcInstalledCandidatePreCanaryProof(filePath, tag, trustedManifest);
    } else if (required.id === 'installed-candidate-connector') {
      assertRcInstalledCandidateConnectorProof(filePath, tag, trustedManifest);
    }
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

  if (command === 'verify-live-canary-proof') {
    const proofDir = process.argv[3];
    if (!proofDir) {
      throw new Error('Usage: evaosBetaReleaseGate.js verify-live-canary-proof <proof-dir>');
    }
    verifyBrokerLiveCanaryProof(proofDir);
    console.log('evaOS live broker canary proof verification passed.');
    return;
  }

  if (command === 'requires-mac-control-proof') {
    const tagOrVersion = process.argv[3];
    if (!tagOrVersion) {
      throw new Error('Usage: evaosBetaReleaseGate.js requires-mac-control-proof <tag-or-version>');
    }
    console.log(requiresMacControlLiveCanaryProof(tagOrVersion) ? 'true' : 'false');
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
  assertMacosAutoUpdateMetadata,
  REQUIRED_PUBLIC_BETA_SIGNING_ENV,
  assertPublicBetaNotarizationEnv,
  assertPublicBetaReleaseSigningEnv,
  assertReleaseConfig,
  assertPublicDistributionTag,
  collectFunctionalSmokeConfigIssues,
  collectBuildReleaseWorkflowIssues,
  collectPublicationWorkflowIssues,
  collectRcCanaryWorkflowIssues,
  collectReleaseDistributeWorkflowIssues,
  committedBridgeSourceIdentity,
  collectLiveCanaryVerifierBehaviorIssues,
  resolveLiveCanaryVerifierAuditBash,
  collectReleaseConfigIssues,
  createReleaseManifest,
  getEnvValue,
  isLocalSignedDmgFallbackManifest,
  isStrictPublicBetaReleaseEnv,
  LOCAL_SIGNED_DMG_FALLBACK_ACK,
  MACOS_UPDATE_MINIMUM_SYSTEM_VERSION,
  metadataAssetRefs,
  releaseProvenanceFromEnv,
  RELEASE_PROVENANCE_GITHUB_WORKFLOW,
  RELEASE_PROVENANCE_LOCAL_SIGNED_DMG_FALLBACK,
  verifyBrokerLiveCanaryProof,
  verifyMacControlLiveCanaryProof,
  verifyReleaseManifest,
  verifyRcProof,
  normalizeBoolean,
  requiresMacControlLiveCanaryProof,
  writeRcProofTemplate,
};
