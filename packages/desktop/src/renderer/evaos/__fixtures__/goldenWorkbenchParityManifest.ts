/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IEvaosRuntimeKey } from '@/common/evaos/bridgeTypes';

export const GOLDEN_WORKBENCH_RELEASE_BASELINE = {
  releaseTag: 'evaos-workbench-v0.6.27',
  releaseUrl: 'https://github.com/electricsheephq/evaos-desktop-bridge/releases/tag/evaos-workbench-v0.6.27',
  sourceCheckout: '/Volumes/LEXAR/repos/evaos-desktop-bridge',
} as const;

export type GoldenWorkbenchSidebarSection =
  | 'Home'
  | 'Workspaces'
  | 'Business Admin'
  | 'Technical Dashboards'
  | 'Settings';

export type GoldenWorkbenchRequiredRole =
  | 'signed-in-user'
  | 'owner-or-admin'
  | 'member-with-scope'
  | 'support-operator'
  | 'public-brand-surface';

export type GoldenWorkbenchProofCloseoutState = 'loaded' | 'denied' | 'repair' | 'waived';

export interface GoldenWorkbenchProofTarget {
  closeoutState: GoldenWorkbenchProofCloseoutState;
  planId: string;
  screenshot: string;
  artifactName: string;
  settledMarkers: readonly string[];
}

export interface GoldenWorkbenchParityManifestRow {
  id: string;
  oldSourceRefs: readonly string[];
  oldSurface?: string;
  expectedRoute?: string;
  sidebarSection?: GoldenWorkbenchSidebarSection;
  sidebarLabel?: string;
  runtimeKey?: IEvaosRuntimeKey;
  requiredRole: GoldenWorkbenchRequiredRole;
  statusRequirement: string;
  proofTarget: GoldenWorkbenchProofTarget;
  testId?: string;
  waiverIssue?: string;
}

export const GOLDEN_WORKBENCH_PARITY_REQUIRED_IDS = [
  'home',
  'approvals',
  'design-workspace',
  'business-browser',
  'creative-studio',
  'connected-apps',
  'people-access',
  'company-brain',
  'evaos-dashboard',
  'hermes-dashboard',
  'mission-control',
  'terminal',
  'native-companion',
  'footer',
  'branding',
] as const;

export const GOLDEN_WORKBENCH_PARITY_MANIFEST = [
  {
    id: 'home',
    oldSourceRefs: ['SidebarView.swift: homeSidebarRows', 'ContentView.swift: SidebarSelection.sessionCenter'],
    oldSurface: 'SessionCenterView home dashboard',
    expectedRoute: '/home',
    sidebarSection: 'Home',
    sidebarLabel: 'Home',
    requiredRole: 'signed-in-user',
    statusRequirement: 'session-center-route-plus-sidebar-entry',
    proofTarget: {
      closeoutState: 'loaded',
      planId: 'home',
      screenshot: '00-home.png',
      artifactName: 'screenshots/00-home.png',
      settledMarkers: ['Home', 'evaOS Workbench Beta'],
    },
    testId: 'tests/unit/evaos/SiderRouteVisibility.dom.test.tsx',
  },
  {
    id: 'approvals',
    oldSourceRefs: [
      'SidebarView.swift: FeatureSidebarRow(title: "Approvals")',
      'ContentView.swift: SidebarSelection.approvalCenter',
      'RuntimeSessionBrokerClient.swift: pendingApprovals/decideApproval',
    ],
    expectedRoute: '/approval-center',
    sidebarSection: 'Home',
    sidebarLabel: 'Approvals',
    requiredRole: 'member-with-scope',
    statusRequirement: 'broker-policy-scope:approve_actions',
    proofTarget: {
      closeoutState: 'loaded',
      planId: 'approvals',
      screenshot: '17-approvals.png',
      artifactName: 'screenshots/17-approvals.png',
      settledMarkers: ['Approval Center', 'Human decisions for risky agent actions'],
    },
    testId: 'tests/unit/evaos/ApprovalCenterPage.dom.test.tsx',
  },
  {
    id: 'design-workspace',
    oldSourceRefs: [
      'RuntimeDefinition.swift: RuntimeKey.openDesign',
      'SidebarView.swift: model.visibleWorkspaceRuntimes',
    ],
    expectedRoute: '/design-workspace',
    sidebarSection: 'Workspaces',
    sidebarLabel: 'Design Workspace',
    runtimeKey: 'opendesign',
    requiredRole: 'member-with-scope',
    statusRequirement: 'workspace-route-plus-sidebar-entry',
    proofTarget: {
      closeoutState: 'loaded',
      planId: 'design-workspace',
      screenshot: '12-design-workspace.png',
      artifactName: 'screenshots/12-design-workspace.png',
      settledMarkers: ['Design Workspace', 'OpenDesign workspace'],
    },
    testId: 'tests/unit/evaos/evaosRoutes.dom.test.tsx',
  },
  {
    id: 'business-browser',
    oldSourceRefs: [
      'RuntimeDefinition.swift: RuntimeKey.liveBrowser',
      'RuntimeDetailView.swift: Stop Browser toolbar action',
      'RuntimeSessionBrokerClient.swift: openSharedBrowserURL/stopSharedBrowser',
    ],
    expectedRoute: '/business-browser',
    sidebarSection: 'Workspaces',
    sidebarLabel: 'Business Browser',
    runtimeKey: 'browser',
    requiredRole: 'member-with-scope',
    statusRequirement: 'broker-policy-scope:open_business_browser',
    proofTarget: {
      closeoutState: 'loaded',
      planId: 'business-browser',
      screenshot: '11-business-browser.png',
      artifactName: 'screenshots/11-business-browser.png',
      settledMarkers: ['Business Browser', 'Brokered browser and VM runtime state'],
    },
    testId: 'tests/unit/evaos/BusinessBrowserPage.dom.test.tsx',
  },
  {
    id: 'creative-studio',
    oldSourceRefs: [
      'RuntimeDefinition.swift: RuntimeKey.creativeStudio',
      'RuntimeDefinition.swift: externalURL(for: .creativeStudio)',
    ],
    oldSurface: 'https://www.comfy.org/cloud',
    expectedRoute: '/creative-studio',
    sidebarSection: 'Workspaces',
    sidebarLabel: 'Creative Studio',
    runtimeKey: 'creative_studio',
    requiredRole: 'member-with-scope',
    statusRequirement: 'external-runtime-route-plus-sidebar-entry',
    proofTarget: {
      closeoutState: 'loaded',
      planId: 'creative-studio',
      screenshot: '13-creative-studio.png',
      artifactName: 'screenshots/13-creative-studio.png',
      settledMarkers: ['Creative Studio', 'External creative generation workspace'],
    },
    testId: 'tests/unit/evaos/evaosRoutes.dom.test.tsx',
  },
  {
    id: 'connected-apps',
    oldSourceRefs: [
      'SidebarView.swift: FeatureSidebarRow(title: "Connected Apps")',
      'ContentView.swift: SidebarSelection.providersHub',
      'RuntimeSessionBrokerClient.swift: providerProfiles/connectProvider',
    ],
    expectedRoute: '/connected-apps',
    sidebarSection: 'Business Admin',
    sidebarLabel: 'Connected Apps',
    requiredRole: 'member-with-scope',
    statusRequirement: 'broker-policy-scope:manage_integrations',
    proofTarget: {
      closeoutState: 'loaded',
      planId: 'connected-apps',
      screenshot: '14-connected-apps.png',
      artifactName: 'screenshots/14-connected-apps.png',
      settledMarkers: ['Connected Apps', 'Brokered provider status, grants, and revocation'],
    },
    testId: 'tests/unit/evaos/ConnectedAppsPage.dom.test.tsx',
  },
  {
    id: 'people-access',
    oldSourceRefs: [
      'SidebarView.swift: FeatureSidebarRow(title: "People & Access")',
      'RuntimeSessionBrokerClient.swift: customerTargets',
    ],
    expectedRoute: '/people-access',
    sidebarSection: 'Business Admin',
    sidebarLabel: 'People & Access',
    requiredRole: 'member-with-scope',
    statusRequirement: 'broker-policy-scope:manage_members',
    proofTarget: {
      closeoutState: 'loaded',
      planId: 'people-access',
      screenshot: '15-people-and-access.png',
      artifactName: 'screenshots/15-people-and-access.png',
      settledMarkers: ['People Access', 'Load a customer account'],
    },
    testId: 'tests/unit/evaos/PeopleAccessPage.dom.test.tsx',
  },
  {
    id: 'company-brain',
    oldSourceRefs: [
      'SidebarView.swift: FeatureSidebarRow(title: "Company Brain")',
      'RuntimeSessionBrokerClient.swift: capabilityEndpoint',
    ],
    expectedRoute: '/company-brain',
    sidebarSection: 'Business Admin',
    sidebarLabel: 'Company Brain',
    requiredRole: 'member-with-scope',
    statusRequirement: 'broker-policy-scope:view_company_brain-or-manage_company_brain',
    proofTarget: {
      closeoutState: 'loaded',
      planId: 'company-brain',
      screenshot: '16-company-brain.png',
      artifactName: 'screenshots/16-company-brain.png',
      settledMarkers: ['Company Brain', 'Org-scoped account directory'],
    },
    testId: 'tests/unit/evaos/CompanyBrainPage.dom.test.tsx',
  },
  {
    id: 'evaos-dashboard',
    oldSourceRefs: [
      'RuntimeDefinition.swift: RuntimeKey.openclaw',
      'RuntimeDetailView.swift: RuntimeToolbar',
      'RuntimeWebView.swift: RuntimeWebViewDeck',
    ],
    expectedRoute: '/evaos',
    sidebarSection: 'Technical Dashboards',
    sidebarLabel: 'evaOS',
    runtimeKey: 'openclaw',
    requiredRole: 'owner-or-admin',
    statusRequirement: 'admin-runtime-plus-brokered-dashboard-evidence',
    proofTarget: {
      closeoutState: 'denied',
      planId: 'evaos',
      screenshot: '07-evaos.png',
      artifactName: 'screenshots/07-evaos.png',
      settledMarkers: ['evaOS', 'Primary evaOS agent workspace', 'Customer context'],
    },
    testId: 'tests/unit/evaos/evaosRuntimeVisibility.test.ts',
  },
  {
    id: 'hermes-dashboard',
    oldSourceRefs: [
      'RuntimeDefinition.swift: RuntimeKey.hermes',
      'RuntimeDetailView.swift: RuntimeToolbar',
      'RuntimeWebView.swift: RuntimeWebViewDeck',
    ],
    expectedRoute: '/hermes',
    sidebarSection: 'Technical Dashboards',
    sidebarLabel: 'Hermes',
    runtimeKey: 'hermes',
    requiredRole: 'owner-or-admin',
    statusRequirement: 'admin-runtime-plus-brokered-dashboard-evidence',
    proofTarget: {
      closeoutState: 'denied',
      planId: 'hermes',
      screenshot: '08-hermes.png',
      artifactName: 'screenshots/08-hermes.png',
      settledMarkers: ['Hermes', 'Hermes agent dashboard', 'Customer context'],
    },
    testId: 'tests/unit/evaos/evaosRuntimeVisibility.test.ts',
  },
  {
    id: 'mission-control',
    oldSourceRefs: [
      'RuntimeDefinition.swift: RuntimeKey.missionControl',
      'SidebarView.swift: visibleTechnicalDashboardRuntimes',
      'RuntimeSessionBrokerClient.swift: runtimeStatus',
    ],
    expectedRoute: '/mission-control',
    sidebarSection: 'Technical Dashboards',
    sidebarLabel: 'Mission Control',
    runtimeKey: 'paperclip',
    requiredRole: 'owner-or-admin',
    statusRequirement: 'admin-runtime-with-missing-broker-repair-visibility',
    proofTarget: {
      closeoutState: 'loaded',
      planId: 'mission-control',
      screenshot: '09-mission-control.png',
      artifactName: 'screenshots/09-mission-control.png',
      settledMarkers: ['Mission Control', 'Paperclip mission queue', 'Customer context'],
    },
    testId: 'tests/unit/evaos/MissionControlPage.dom.test.tsx',
  },
  {
    id: 'terminal',
    oldSourceRefs: ['RuntimeDefinition.swift: RuntimeKey.terminal', 'RuntimeDetailView.swift: RuntimeToolbar'],
    expectedRoute: '/terminal',
    sidebarSection: 'Technical Dashboards',
    sidebarLabel: 'Terminal',
    runtimeKey: 'terminal',
    requiredRole: 'owner-or-admin',
    statusRequirement: 'admin-runtime-scope:access_terminal',
    proofTarget: {
      closeoutState: 'denied',
      planId: 'terminal',
      screenshot: '10-terminal.png',
      artifactName: 'screenshots/10-terminal.png',
      settledMarkers: ['Terminal'],
    },
    testId: 'tests/unit/evaos/TerminalPage.dom.test.tsx',
  },
  {
    id: 'native-companion',
    oldSourceRefs: [
      'SidebarView.swift: Section(AppBrand.bridgeSectionTitle)',
      'BridgePanelView.swift: setupSection',
      'AppBrand.swift: macAndIPhoneTitle',
    ],
    expectedRoute: '/native-companion',
    sidebarSection: 'Settings',
    sidebarLabel: 'Mac & iPhone',
    requiredRole: 'support-operator',
    statusRequirement: 'read-only-native-status-plus-released-workbench-repair-handoff',
    proofTarget: {
      closeoutState: 'repair',
      planId: 'mac-iphone',
      screenshot: '06-mac-iphone.png',
      artifactName: 'screenshots/06-mac-iphone.png',
      settledMarkers: ['Mac & iPhone', 'MAC & IPHONE REPAIR', 'Boundary clean'],
    },
    testId: 'tests/unit/evaos/NativeCompanionPage.dom.test.tsx',
  },
  {
    id: 'footer',
    oldSourceRefs: ['SidebarView.swift: safeAreaInset(edge: .bottom)', 'DesktopSession.swift: DesktopSession'],
    oldSurface: 'sidebar footer account, version, sign-in/sign-out, and customer target switcher',
    requiredRole: 'signed-in-user',
    statusRequirement: 'broker-session-footer-plus-customer-switcher-clearing',
    proofTarget: {
      closeoutState: 'loaded',
      planId: 'sidebar-footer',
      screenshot: '01-sidebar-footer.png',
      artifactName: 'screenshots/01-sidebar-footer.png',
      settledMarkers: ['evaOS Workbench Beta', 'New Chat', 'Settings'],
    },
    testId: 'tests/unit/evaos/SiderRouteVisibility.dom.test.tsx',
  },
  {
    id: 'branding',
    oldSourceRefs: [
      'AppBrand.swift: visibleName/bundleDisplayName/version/update URLs',
      'SidebarView.swift: SidebarBrandHeader',
    ],
    oldSurface: 'evaOS Workbench brand, release identity, update feed, and sidebar wordmark',
    requiredRole: 'public-brand-surface',
    statusRequirement: 'beta-owned-branding-path-theme-support-cleanup',
    proofTarget: {
      closeoutState: 'loaded',
      planId: 'settings-about',
      screenshot: '05-settings-about.png',
      artifactName: 'screenshots/05-settings-about.png',
      settledMarkers: ['evaOS Workbench Beta', 'Build identity', 'controlled beta'],
    },
    testId: 'tests/unit/process/evaosBetaReleaseGate.test.ts',
  },
] as const satisfies readonly GoldenWorkbenchParityManifestRow[];
