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
  defaultImportRange: 'v2.1.13..v2.1.18',
  optionalMainCommit: '57aa0d0',
  optionalMainCommitScope: 'voice-stt-only',
});

const EVAOS_UPSTREAM_IMPORT_SEAMS = Object.freeze([
  {
    id: 'route-contribution',
    owner: 'evaos-shell',
    protectedPaths: [
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
    protectedPaths: ['packages/desktop/src/common/evaos/betaIdentity.ts', 'packages/desktop/electron-builder.yml'],
  },
]);

const REQUIRED_MARKERS = Object.freeze([
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
      { label: 'external open requests are mapped through validator', text: 'toOpenExternalBody' },
      {
        label: 'openExternal stays behind shell API adapter',
        text: "openExternal: httpPost<void, string>('/api/shell/open-external', toOpenExternalBody)",
      },
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
]);

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
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
  EVAOS_UPSTREAM_IMPORT_SEAMS,
  collectEvaosUpstreamGuardrailIssues,
  collectEvaosUpstreamGuardrailIssuesFromFiles,
};

if (require.main === module) {
  runCli();
}
