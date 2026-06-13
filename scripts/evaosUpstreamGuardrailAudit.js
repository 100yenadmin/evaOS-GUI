#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

const fs = require('node:fs');
const path = require('node:path');

const EVAOS_UPSTREAM_ALIGNMENT_TARGET = Object.freeze({
  targetTag: 'v2.1.18',
  targetSha: 'ddd20d3',
  defaultImportRange: 'v2.1.12..v2.1.18',
  optionalMainCommit: '57aa0d0',
  optionalMainCommitScope: 'voice-stt-only',
});

const EVAOS_UPSTREAM_IMPORT_SEAMS = Object.freeze([
  {
    id: 'route-contribution',
    owner: 'evaos-shell',
    protectedPaths: [
      'packages/desktop/src/renderer/components/layout/Router.tsx',
      'packages/desktop/src/renderer/evaos/evaosRoutes.tsx',
      'packages/desktop/src/renderer/evaos/evaosRuntimeVisibility.ts',
    ],
  },
  {
    id: 'sidebar-contribution',
    owner: 'evaos-shell',
    protectedPaths: ['packages/desktop/src/renderer/evaos/EvaosSidebarSection.tsx'],
  },
  {
    id: 'footer-account-context',
    owner: 'evaos-shell',
    protectedPaths: [
      'packages/desktop/src/renderer/components/layout/Sider/index.tsx',
      'packages/desktop/src/renderer/components/layout/Sider/SiderFooter.tsx',
      'packages/desktop/src/renderer/components/layout/Titlebar/index.tsx',
    ],
  },
  {
    id: 'deep-link-session-adapter',
    owner: 'evaos-broker',
    protectedPaths: ['packages/desktop/src/process/utils/deepLink.ts'],
  },
  {
    id: 'update-feed-provider',
    owner: 'evaos-release',
    protectedPaths: ['packages/desktop/src/process/evaosBetaSafety.ts'],
  },
  {
    id: 'ipc-namespace-registration',
    owner: 'evaos-broker',
    protectedPaths: [
      'packages/desktop/src/common/adapter/ipcBridge.ts',
      'packages/desktop/src/process/bridge/index.ts',
      'packages/desktop/src/process/bridge/evaosBrokerBridge.ts',
    ],
  },
  {
    id: 'native-connector-boundary',
    owner: 'evaos-native',
    protectedPaths: [
      'packages/desktop/src/common/evaos/nativeCompanionBoundary.ts',
      'packages/desktop/src/renderer/evaos/nativeCompanionViewModel.ts',
    ],
  },
  {
    id: 'release-identity',
    owner: 'evaos-release',
    protectedPaths: [
      'package.json',
      '.github/workflows/_build-reusable.yml',
      '.github/workflows/build-and-release.yml',
      '.github/workflows/release-distribute.yml',
      'packages/desktop/src/common/evaos/betaIdentity.ts',
      'packages/desktop/electron-builder.yml',
      'scripts/afterSign.js',
      'scripts/evaosBetaReleaseGate.js',
      'scripts/prepare-release-assets.sh',
      'scripts/verify-release-assets.sh',
    ],
  },
  {
    id: 'voice-native-boundary',
    owner: 'evaos-native',
    protectedPaths: [
      'entitlements.plist',
      'packages/desktop/src/renderer/services/SpeechToTextService.ts',
      'packages/desktop/src/renderer/hooks/system/useSpeechInput.ts',
    ],
  },
  {
    id: 'team-runtime',
    owner: 'evaos-shell',
    protectedPaths: [
      'packages/desktop/src/common/config/constants.ts',
      'packages/desktop/src/renderer/pages/team/TeamPage.tsx',
      'packages/desktop/src/renderer/pages/conversation/runtime/conversationRuntimeViewStore.ts',
      'packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx',
      'packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx',
    ],
  },
  {
    id: 'assistant-governance',
    owner: 'evaos-shell',
    protectedPaths: [
      'packages/desktop/src/process/utils/migrateAssistants.ts',
      'packages/desktop/src/renderer/pages/guid/GuidPage.tsx',
      'packages/desktop/src/renderer/pages/settings/AssistantSettings/index.tsx',
      'packages/desktop/src/renderer/evaos/evaosAssistantPresentation.ts',
    ],
  },
  {
    id: 'aioncore-runtime-pin',
    owner: 'evaos-release',
    protectedPaths: ['package.json', 'scripts/prepareAioncore.js', 'packages/shared-scripts/src/prepare-aioncore.js'],
  },
]);

const EVAOS_UPSTREAM_CANARY_BUCKETS = Object.freeze([
  {
    id: 'shell-routing',
    requiredProof: 'route/sidebar/footer smoke plus customer switch clearing',
    pathGlobs: [
      'packages/desktop/src/renderer/components/layout/Router.tsx',
      'packages/desktop/src/renderer/components/layout/Sider/**',
      'packages/desktop/src/renderer/components/layout/Titlebar/**',
      'packages/desktop/src/renderer/evaos/**',
    ],
  },
  {
    id: 'broker-ipc',
    requiredProof: 'broker session, runtime action/status, renderer secret audit',
    pathGlobs: [
      'packages/desktop/src/common/adapter/ipcBridge.ts',
      'packages/desktop/src/process/bridge/**',
      'packages/desktop/src/process/utils/deepLink.ts',
    ],
  },
  {
    id: 'release-identity',
    requiredProof: 'beta release gate, updater/feed audit, no upstream AionUi feed',
    pathGlobs: [
      'package.json',
      'packages/desktop/src/common/evaos/betaIdentity.ts',
      'packages/desktop/src/process/evaosBetaSafety.ts',
      'packages/desktop/electron-builder.yml',
      '.github/workflows/**',
      'scripts/afterSign.js',
      'scripts/evaosBetaReleaseGate.js',
      'scripts/prepare-release-assets.sh',
      'scripts/verify-release-assets.sh',
    ],
  },
  {
    id: 'native-connector',
    requiredProof: 'Mac & iPhone connector boundary, local trust, and repair/status smoke',
    pathGlobs: [
      'packages/desktop/src/common/evaos/nativeCompanionBoundary.ts',
      'packages/desktop/src/renderer/evaos/nativeCompanionViewModel.ts',
      'packages/desktop/src/renderer/evaos/useEvaosNativeCompanionStatus.ts',
      'packages/desktop/src/process/bridge/evaosNativeCompanionBridge.ts',
      'packages/desktop/src/renderer/pages/native-companion/**',
    ],
  },
  {
    id: 'native-voice',
    requiredProof: 'signed app microphone permission proof and native boundary audit',
    pathGlobs: [
      'entitlements.plist',
      'packages/desktop/src/renderer/services/SpeechToTextService.ts',
      'packages/desktop/src/renderer/services/speech/**',
      'packages/desktop/src/renderer/hooks/system/useSpeechInput.ts',
      'packages/desktop/src/renderer/hooks/system/useLiveTranscriptInsertion.ts',
    ],
  },
  {
    id: 'runtime-team',
    requiredProof: 'conversation runtime, send/cancel, team create/send/cancel smoke',
    pathGlobs: [
      'packages/desktop/src/common/types/team/**',
      'packages/desktop/src/common/adapter/teamMapper.ts',
      'packages/desktop/src/renderer/pages/team/**',
      'packages/desktop/src/renderer/pages/conversation/runtime/**',
      'packages/desktop/src/renderer/pages/conversation/platforms/acp/**',
      'packages/desktop/src/renderer/pages/conversation/platforms/aionrs/**',
    ],
  },
  {
    id: 'assistant-governance',
    requiredProof: 'assistant settings, New Chat catalog, evaOS assistant presentation',
    pathGlobs: [
      'packages/desktop/src/process/utils/migrateAssistants.ts',
      'packages/desktop/src/common/types/agent/**',
      'packages/desktop/src/common/utils/presetAssistantResources.ts',
      'packages/desktop/src/renderer/hooks/assistant/**',
      'packages/desktop/src/renderer/pages/guid/**',
      'packages/desktop/src/renderer/pages/settings/AssistantSettings/**',
    ],
  },
  {
    id: 'aioncore-runtime',
    requiredProof: 'AionCore bundled runtime startup and managed resource packaging proof',
    pathGlobs: [
      'package.json',
      'scripts/prepareAioncore.js',
      'packages/shared-scripts/src/prepare-aioncore.js',
      '.github/workflows/_build-reusable.yml',
      '.github/workflows/build-manual.yml',
    ],
  },
]);

const REQUIRED_MARKERS = Object.freeze([
  {
    seamId: 'route-contribution',
    filePath: 'packages/desktop/src/renderer/components/layout/Router.tsx',
    markers: [
      { label: 'evaOS route contribution remains mounted', text: 'renderEvaosRoutes()' },
      { label: 'desktop session listener remains mounted', text: '<DesktopSessionImportListener />' },
      { label: 'desktop session import action remains handled', text: 'EVAOS_DESKTOP_SESSION_IMPORTED_ACTION' },
      {
        label: 'team route remains controlled by shell constant',
        text: 'TEAM_MODE_ENABLED ? withRouteFallback(TeamIndex)',
      },
    ],
  },
  {
    seamId: 'route-contribution',
    filePath: 'packages/desktop/src/renderer/evaos/evaosRoutes.tsx',
    markers: [
      {
        label: 'legacy OpenClaw route redirects to evaOS',
        text: "<Route path='/openclaw' element={<Navigate to='/evaos' replace />} />",
      },
      {
        label: 'home route stays on chat landing',
        text: "<Route path='/home' element={<Navigate to='/guid' replace />} />",
      },
      { label: 'shared browser route remains registered', text: "path='/business-browser'" },
      { label: 'Mac and iPhone route remains registered', text: "path='/native-companion'" },
    ],
  },
  {
    seamId: 'route-contribution',
    filePath: 'packages/desktop/src/renderer/evaos/evaosRuntimeVisibility.ts',
    markers: [
      { label: 'browser visible label stays Shared Browser', text: "title: 'Shared Browser'" },
      { label: 'browser internal route key stays stable', text: "routePath: '/business-browser'" },
      { label: 'terminal route policy remains broker scoped', text: "routePath: '/terminal'" },
      { label: 'terminal entitlement remains explicit', text: "requiredScopes: ['access_terminal']" },
    ],
  },
  {
    seamId: 'sidebar-contribution',
    filePath: 'packages/desktop/src/renderer/evaos/EvaosSidebarSection.tsx',
    markers: [
      { label: 'evaOS sidebar entry remains contributed', text: 'SiderEvaosEntry' },
      { label: 'Hermes sidebar entry remains contributed', text: 'SiderHermesEntry' },
      { label: 'Mission Control sidebar entry remains contributed', text: 'SiderMissionControlEntry' },
      { label: 'Shared Browser sidebar entry remains contributed', text: 'SiderBusinessBrowserEntry' },
      { label: 'Design group remains collapsed under evaOS shell', text: "label='Design'" },
      { label: 'Admin group remains collapsed under evaOS shell', text: "label='Admin'" },
    ],
  },
  {
    seamId: 'footer-account-context',
    filePath: 'packages/desktop/src/renderer/components/layout/Sider/index.tsx',
    markers: [
      { label: 'customer switch clears broker runtime state first', text: 'clearCustomerRuntimeState.invoke' },
      { label: 'customer switch emits selected customer context', text: 'selectedCustomerId: customerId' },
      { label: 'footer account block remains rendered from sidebar', text: '<SiderFooter' },
      { label: 'footer owns customer switch callback', text: 'onCustomerChange={handleCustomerChange}' },
    ],
  },
  {
    seamId: 'footer-account-context',
    filePath: 'packages/desktop/src/renderer/components/layout/Sider/SiderFooter.tsx',
    markers: [
      { label: 'customer selector remains accessible', text: "aria-label='Selected customer'" },
      { label: 'customer selector keeps change callback', text: 'onCustomerChange' },
      { label: 'footer retains controlled beta version label', text: "const EVAOS_CHANNEL_LABEL = 'controlled beta'" },
    ],
  },
  {
    seamId: 'footer-account-context',
    filePath: 'packages/desktop/src/renderer/components/layout/Titlebar/index.tsx',
    markers: [
      {
        label: 'titlebar keeps evaOS beta identity',
        text: "const appTitle = useMemo(() => 'evaOS Workbench Beta', []);",
      },
      {
        label: 'team titlebar affordance remains controlled by shell constant',
        text: 'const isTeamRoute = TEAM_MODE_ENABLED && /^\\/team\\/[^/]+/.test(location.pathname);',
      },
    ],
  },
  {
    seamId: 'deep-link-session-adapter',
    filePath: 'packages/desktop/src/process/utils/deepLink.ts',
    markers: [
      {
        label: 'desktop session import action remains evaOS namespaced',
        text: "EVAOS_DESKTOP_SESSION_IMPORTED_ACTION = 'evaos-auth/session-imported'",
      },
      { label: 'renderer secret params are stripped for beta links', text: 'stripRendererSecretDeepLinkParams' },
      { label: 'desktop session param is treated as renderer secret', text: "'desktop_session'" },
      { label: 'broker client owns desktop session import', text: 'getDefaultEvaosBrokerSessionClient' },
    ],
  },
  {
    seamId: 'update-feed-provider',
    filePath: 'packages/desktop/src/process/evaosBetaSafety.ts',
    markers: [
      {
        label: 'evaOS beta update repo stays evaOS GUI',
        text: "EVAOS_BETA_DEFAULT_GITHUB_REPO = '100yenadmin/evaOS-GUI'",
      },
      { label: 'update repo allowlist remains explicit', text: 'EVAOS_BETA_ALLOWED_UPDATE_REPOS' },
      { label: 'backend update repo remains gated', text: 'getEvaosBetaBackendGithubRepo' },
    ],
  },
  {
    seamId: 'ipc-namespace-registration',
    filePath: 'packages/desktop/src/common/adapter/ipcBridge.ts',
    markers: [
      {
        label: 'runtime surface protocol remains opaque to renderer',
        text: "EVAOS_RUNTIME_SURFACE_PROTOCOL = 'evaos-runtime-surface:'",
      },
      { label: 'evaOS IPC bridge provider wrapper remains present', text: 'function buildEvaosProvider' },
      { label: 'evaOS Electron callback namespace remains present', text: 'subscribe.callback-${name}${id}' },
      { label: 'external open requests are mapped through validator', text: 'toOpenExternalBody' },
      {
        label: 'openExternal stays behind shell API adapter',
        text: "openExternal: httpPost<void, string>('/api/shell/open-external', toOpenExternalBody)",
      },
      { label: 'broker namespace remains registered', text: 'export const evaosBroker' },
      { label: 'People & Access namespace remains registered', text: 'export const evaosPeopleAccess' },
      { label: 'provider hub namespace remains registered', text: 'export const evaosProviderHub' },
      { label: 'Shared Browser namespace remains registered', text: 'export const evaosBusinessBrowser' },
      { label: 'native companion namespace remains registered', text: 'export const evaosNativeCompanion' },
    ],
  },
  {
    seamId: 'ipc-namespace-registration',
    filePath: 'packages/desktop/src/process/bridge/index.ts',
    markers: [
      { label: 'broker bridge remains initialized', text: 'initEvaosBrokerBridge();' },
      { label: 'People & Access bridge remains initialized', text: 'initEvaosPeopleAccessBridge();' },
      { label: 'provider hub bridge remains initialized', text: 'initEvaosProviderHubBridge();' },
      { label: 'Shared Browser bridge remains initialized', text: 'initEvaosBusinessBrowserBridge();' },
      { label: 'native companion bridge remains initialized', text: 'initEvaosNativeCompanionBridge();' },
      { label: 'external link bridge remains initialized', text: 'initEvaosExternalLinkBridge();' },
    ],
  },
  {
    seamId: 'ipc-namespace-registration',
    filePath: 'packages/desktop/src/process/bridge/evaosBrokerBridge.ts',
    markers: [
      { label: 'renderer-safe broker payload guard remains exported', text: 'assertEvaosRendererSafePayload' },
      { label: 'customer runtime surfaces clear on customer switch', text: 'clearEvaosRuntimeSurfacesForCustomer' },
      { label: 'runtime launch owns surface handle creation', text: 'createEvaosRuntimeSurface' },
      { label: 'runtime surfaces clear on broker logout', text: 'clearEvaosRuntimeSurfaces' },
    ],
  },
  {
    seamId: 'native-connector-boundary',
    filePath: 'packages/desktop/src/common/evaos/nativeCompanionBoundary.ts',
    markers: [
      { label: 'native boundary version remains explicit', text: 'EVAOS_NATIVE_COMPANION_BOUNDARY_VERSION' },
      { label: 'native connector trust owner stays native', text: 'evaos-native-companion' },
      { label: 'local input control remains forbidden in renderer', text: 'local-input-control' },
    ],
  },
  {
    seamId: 'native-connector-boundary',
    filePath: 'packages/desktop/src/renderer/evaos/nativeCompanionViewModel.ts',
    markers: [
      { label: 'user-facing copy says Mac control', text: 'Mac control' },
      { label: 'user-facing copy says Workbench connector', text: 'Workbench connector' },
    ],
  },
  {
    seamId: 'release-identity',
    filePath: 'package.json',
    markers: [
      { label: 'package name remains evaOS beta', text: '"name": "evaos-workbench-beta"' },
      { label: 'product name remains evaOS Workbench Beta', text: '"productName": "evaOS Workbench Beta"' },
      { label: 'author remains Electric Sheep', text: '"name": "Electric Sheep"' },
      { label: 'evaOS guardrail script remains registered', text: '"evaos:upstream-guardrails"' },
    ],
  },
  {
    seamId: 'release-identity',
    filePath: '.github/workflows/_build-reusable.yml',
    markers: [
      { label: 'reusable build keeps local DMG finalization input', text: 'macos_dmg_finalization' },
      { label: 'workflow keeps installer-only artifact control', text: 'upload_installers_only' },
    ],
  },
  {
    seamId: 'release-identity',
    filePath: '.github/workflows/build-and-release.yml',
    markers: [
      { label: 'release workflow keeps beta acknowledgement', text: 'beta_release_ack' },
      {
        label: 'release workflow keeps Apple Silicon-only artifact pattern',
        text: 'macos-arm64)\n              patterns=(\n                --pattern "*arm64*.dmg"',
      },
      {
        label: 'release workflow keeps local signed DMG manifest registration',
        text: 'register-local-signed-dmg-manifest',
      },
    ],
  },
  {
    seamId: 'release-identity',
    filePath: '.github/workflows/release-distribute.yml',
    markers: [
      { label: 'distribution workflow keeps beta acknowledgement', text: 'beta_distribution_ack' },
      { label: 'distribution refuses non-evaOS beta tags', text: 'Refusing to distribute non-evaOS beta tag' },
      {
        label: 'distribution keeps Apple Silicon-only artifact pattern',
        text: 'macos-arm64)\n              patterns=(\n                --pattern "*arm64*.dmg"',
      },
    ],
  },
  {
    seamId: 'release-identity',
    filePath: 'packages/desktop/src/common/evaos/betaIdentity.ts',
    markers: [
      { label: 'product name remains evaOS Workbench Beta', text: "productName: 'evaOS Workbench Beta'" },
      { label: 'bundle id remains beta isolated', text: "appId: 'com.evaos.workbench.beta'" },
      { label: 'protocol scheme remains beta isolated', text: "protocolScheme: 'evaos-workbench-beta'" },
    ],
  },
  {
    seamId: 'release-identity',
    filePath: 'packages/desktop/electron-builder.yml',
    markers: [
      { label: 'electron bundle id remains beta isolated', text: 'appId: com.evaos.workbench.beta' },
      { label: 'electron product name remains evaOS Workbench Beta', text: 'productName: evaOS Workbench Beta' },
      { label: 'electron protocol remains beta isolated', text: 'evaos-workbench-beta' },
      { label: 'built-in notarization stays disabled for custom release owner', text: 'notarize: false' },
    ],
  },
  {
    seamId: 'release-identity',
    filePath: 'scripts/evaosBetaReleaseGate.js',
    markers: [
      { label: 'release gate blocks upstream AionUi feed', text: 'no upstream AionUi feed' },
      { label: 'release gate refuses upstream assets', text: 'Refusing to distribute upstream AionUi asset' },
      { label: 'release gate emits beta manifest identity', text: 'upstreamFeedAllowed: false' },
    ],
  },
  {
    seamId: 'release-identity',
    filePath: 'scripts/prepare-release-assets.sh',
    markers: [{ label: 'prepare assets refuses upstream branding', text: 'Refusing upstream-branded beta asset' }],
  },
  {
    seamId: 'release-identity',
    filePath: 'scripts/verify-release-assets.sh',
    markers: [{ label: 'verify assets keeps evaOS beta package checks', text: 'evaOS Workbench Beta' }],
  },
  {
    seamId: 'voice-native-boundary',
    filePath: 'entitlements.plist',
    markers: [
      {
        label: 'library validation exception remains explicit',
        text: 'com.apple.security.cs.disable-library-validation',
      },
    ],
  },
]);

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function globToRegExp(pattern) {
  const normalized = normalizePath(pattern);
  let source = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const nextChar = normalized[index + 1];
    if (char === '*' && nextChar === '*') {
      source += '.*';
      index += 1;
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

function classifyEvaosUpstreamSeamPaths(changedPaths) {
  const normalizedPaths = changedPaths.map(normalizePath);
  return EVAOS_UPSTREAM_CANARY_BUCKETS.map((bucket) => {
    const matchers = bucket.pathGlobs.map(globToRegExp);
    const matchedPaths = normalizedPaths.filter((changedPath) => matchers.some((matcher) => matcher.test(changedPath)));
    return matchedPaths.length > 0 ? { ...bucket, matchedPaths } : null;
  }).filter(Boolean);
}

function readClassifyPathsFromCli(args) {
  if (args.length > 0) {
    return args;
  }
  if (process.stdin.isTTY) {
    return [];
  }
  return fs
    .readFileSync(0, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function collectEvaosUpstreamGuardrailIssuesFromFiles(files) {
  const normalizedFiles = new Map(
    Object.entries(files).map(([filePath, content]) => [normalizePath(filePath), content])
  );
  const issues = [];

  for (const requirement of REQUIRED_MARKERS) {
    const content = normalizedFiles.get(requirement.filePath);
    if (content === undefined) continue;

    for (const marker of requirement.markers) {
      if (!content.includes(marker.text)) {
        issues.push(
          `${requirement.seamId}: ${requirement.filePath} is missing ${marker.label} marker (${marker.text})`
        );
      }
    }
  }

  return issues;
}

function collectEvaosUpstreamGuardrailIssues(rootDir = process.cwd()) {
  const files = {};
  const issues = [];

  for (const requirement of REQUIRED_MARKERS) {
    const absolutePath = path.join(rootDir, requirement.filePath);
    try {
      files[requirement.filePath] = fs.readFileSync(absolutePath, 'utf8');
    } catch (error) {
      issues.push(`${requirement.seamId}: ${requirement.filePath} could not be read (${error.message})`);
    }
  }

  return [...issues, ...collectEvaosUpstreamGuardrailIssuesFromFiles(files)];
}

function runCli() {
  const rootDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  if (process.argv[2] === '--classify') {
    const changedPaths = readClassifyPathsFromCli(process.argv.slice(3));
    if (changedPaths.length === 0) {
      console.error(
        'Usage: node scripts/evaosUpstreamGuardrailAudit.js --classify <changed-path> [...]\n' +
          'Or pipe newline-delimited paths on stdin.'
      );
      process.exitCode = 2;
      return;
    }
    const classifications = classifyEvaosUpstreamSeamPaths(changedPaths);
    if (classifications.length === 0) {
      console.log('No evaOS protected seam canary buckets matched.');
      return;
    }
    for (const classification of classifications) {
      console.log(`${classification.id}: ${classification.requiredProof}`);
      for (const matchedPath of classification.matchedPaths) {
        console.log(`- ${matchedPath}`);
      }
    }
    return;
  }

  const issues = collectEvaosUpstreamGuardrailIssues(rootDir);

  if (issues.length > 0) {
    console.error('evaOS upstream guardrail audit failed:');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `evaOS upstream guardrail audit passed for ${EVAOS_UPSTREAM_ALIGNMENT_TARGET.targetTag} (${EVAOS_UPSTREAM_ALIGNMENT_TARGET.targetSha}).`
  );
}

module.exports = {
  EVAOS_UPSTREAM_ALIGNMENT_TARGET,
  EVAOS_UPSTREAM_CANARY_BUCKETS,
  EVAOS_UPSTREAM_IMPORT_SEAMS,
  classifyEvaosUpstreamSeamPaths,
  collectEvaosUpstreamGuardrailIssues,
  collectEvaosUpstreamGuardrailIssuesFromFiles,
};

if (require.main === module) {
  runCli();
}
