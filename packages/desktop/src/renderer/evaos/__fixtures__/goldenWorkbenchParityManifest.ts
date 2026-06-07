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
  testId?: string;
  waiverIssue?: string;
}

const ISSUE_180_AUTH_FOOTER = 'https://github.com/100yenadmin/evaOS-GUI/issues/180';
const ISSUE_181_RUNTIME_ROUTES = 'https://github.com/100yenadmin/evaOS-GUI/issues/181';
const ISSUE_182_BRANDING = 'https://github.com/100yenadmin/evaOS-GUI/issues/182';

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
    sidebarSection: 'Home',
    sidebarLabel: 'Home',
    requiredRole: 'signed-in-user',
    statusRequirement: 'waived-until-session-center-or-equivalent-home-route-exists',
    waiverIssue: ISSUE_181_RUNTIME_ROUTES,
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
    sidebarLabel: 'Approval Center',
    requiredRole: 'member-with-scope',
    statusRequirement: 'broker-policy-scope:approve_actions',
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
    statusRequirement: 'waived-until-renderer-route-and-sidebar-entry-exist',
    waiverIssue: ISSUE_181_RUNTIME_ROUTES,
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
    statusRequirement: 'external-runtime-catalog',
    waiverIssue: ISSUE_181_RUNTIME_ROUTES,
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
    sidebarLabel: 'People Access',
    requiredRole: 'member-with-scope',
    statusRequirement: 'broker-policy-scope:manage_members',
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
    testId: 'tests/unit/evaos/NativeCompanionPage.dom.test.tsx',
  },
  {
    id: 'footer',
    oldSourceRefs: ['SidebarView.swift: safeAreaInset(edge: .bottom)', 'DesktopSession.swift: DesktopSession'],
    oldSurface: 'sidebar footer account, version, sign-in/sign-out, and customer target switcher',
    requiredRole: 'signed-in-user',
    statusRequirement: 'waived-for-full-auth-footer-customer-switcher-parity',
    testId: 'tests/unit/evaos/SiderRouteVisibility.dom.test.tsx',
    waiverIssue: ISSUE_180_AUTH_FOOTER,
  },
  {
    id: 'branding',
    oldSourceRefs: [
      'AppBrand.swift: visibleName/bundleDisplayName/version/update URLs',
      'SidebarView.swift: SidebarBrandHeader',
    ],
    oldSurface: 'evaOS Workbench brand, release identity, update feed, and sidebar wordmark',
    requiredRole: 'public-brand-surface',
    statusRequirement: 'waived-for-full-branding-path-theme-support-cleanup',
    testId: 'tests/unit/process/evaosBetaReleaseGate.test.ts',
    waiverIssue: ISSUE_182_BRANDING,
  },
] as const satisfies readonly GoldenWorkbenchParityManifestRow[];
