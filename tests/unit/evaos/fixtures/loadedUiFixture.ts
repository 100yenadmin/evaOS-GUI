/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IEvaosApprovalCenterView,
  IEvaosBusinessBrowserActionResult,
  IEvaosBusinessBrowserView,
  IEvaosCompanyBrainAccount360View,
  IEvaosCompanyBrainDirectoryView,
  IEvaosCompanyBrainQueryResult,
  IEvaosPeopleAccessPolicyView,
  IEvaosProviderHubView,
} from '@/common/adapter/ipcBridge';

export interface EvaosLoadedUiFixture {
  mode: {
    kind: 'local-fixture';
    live: false;
    label: 'LOCAL FIXTURE - NOT LIVE BETA PROOF';
    satisfiesParentIssue67: false;
    publicBetaReleaseEnabled: false;
    issue: 80;
    parentIssue: 67;
  };
  customer: {
    customerId: string;
    customerAccountId: string;
    accountName: string;
    workspaceDomain: string;
    selectedByMembershipId: string;
  };
  people: {
    policy: IEvaosPeopleAccessPolicyView;
    members: IEvaosPeopleAccessPolicyView['members'];
    invites: IEvaosPeopleAccessPolicyView['invites'];
  };
  providers: IEvaosProviderHubView;
  approvals: IEvaosApprovalCenterView;
  companyBrain: {
    directory: IEvaosCompanyBrainDirectoryView;
    account360: IEvaosCompanyBrainAccount360View;
    query: IEvaosCompanyBrainQueryResult;
    denied: IEvaosCompanyBrainDirectoryView;
  };
  businessBrowser: {
    active: IEvaosBusinessBrowserView;
    offline: IEvaosBusinessBrowserView;
    launch: IEvaosBusinessBrowserActionResult;
    stop: IEvaosBusinessBrowserActionResult;
    denied: IEvaosBusinessBrowserView;
  };
}

const CUSTOMER_ID = 'fixture-customer-acme';
const CUSTOMER_ACCOUNT_ID = 'fixture-account-acme';
const MEMBERSHIP_ID = 'fixture-member-owner';
const NOW = '2026-06-04T10:00:00.000Z';

const peoplePolicy: IEvaosPeopleAccessPolicyView = {
  schemaVersion: 'evaos.account_policy.v1',
  customerAccountId: CUSTOMER_ACCOUNT_ID,
  selectedCustomerId: CUSTOMER_ID,
  membershipId: MEMBERSHIP_ID,
  membershipRole: 'owner',
  planCode: 'fixture-beta',
  seatLimit: 8,
  activeSeats: 4,
  invitedSeats: 2,
  scopes: [
    'manage_members',
    'manage_integrations',
    'approve_actions',
    'open_business_browser',
    'view_company_brain',
    'manage_company_brain',
  ],
  advancedSurfaces: {
    peopleAccess: true,
    providerHub: true,
    approvalCenter: true,
    companyBrain: true,
    businessBrowser: true,
  },
  members: [
    {
      memberId: MEMBERSHIP_ID,
      email: 'owner@example.test',
      displayName: 'Fixture Owner',
      role: 'owner',
      seatType: 'full',
      status: 'active',
      joinedAt: '2026-05-20T09:00:00.000Z',
      lastActiveAt: NOW,
    },
    {
      memberId: 'fixture-member-admin',
      email: 'admin@example.test',
      displayName: 'Fixture Admin',
      role: 'admin',
      seatType: 'full',
      status: 'active',
      joinedAt: '2026-05-21T09:00:00.000Z',
      lastActiveAt: '2026-06-04T09:50:00.000Z',
    },
    {
      memberId: 'fixture-member-operator',
      email: 'operator@example.test',
      displayName: 'Fixture Operator',
      role: 'member',
      seatType: 'operator',
      status: 'active',
      joinedAt: '2026-05-22T09:00:00.000Z',
      lastActiveAt: '2026-06-04T09:30:00.000Z',
    },
    {
      memberId: 'fixture-member-agent',
      email: 'agent-seat@example.test',
      displayName: 'Fixture Agent Seat',
      role: 'agent_only',
      seatType: 'agent',
      status: 'suspended',
      joinedAt: '2026-05-23T09:00:00.000Z',
    },
  ],
  invites: [
    {
      inviteId: 'fixture-invite-pending',
      email: 'pending-member@example.test',
      role: 'member',
      status: 'pending',
      invitedAt: '2026-06-03T09:00:00.000Z',
      expiresAt: '2026-06-10T09:00:00.000Z',
    },
    {
      inviteId: 'fixture-invite-expired',
      email: 'expired-admin@example.test',
      role: 'technical_admin',
      status: 'expired',
      invitedAt: '2026-05-20T09:00:00.000Z',
      expiresAt: '2026-05-27T09:00:00.000Z',
    },
  ],
  routeDenied: false,
  backendEnforced: true,
  updatedAt: NOW,
  auditId: 'fixture-audit-people-policy',
};

const providers: IEvaosProviderHubView = {
  schemaVersion: 'evaos.provider_hub.v1',
  customerId: CUSTOMER_ID,
  customerAccountId: CUSTOMER_ACCOUNT_ID,
  membershipId: MEMBERSHIP_ID,
  membershipRole: 'owner',
  routeDenied: false,
  backendEnforced: true,
  activeProviderKey: 'google_workspace',
  summaryText: '5 local fixture provider states',
  sourcePointer: 'fixture:providers',
  auditId: 'fixture-audit-providers',
  policyAuditId: peoplePolicy.auditId,
  profiles: [
    {
      providerKey: 'google_workspace',
      title: 'Google Workspace',
      subtitle: 'Synthetic mail, calendar, and Drive state',
      status: 'connected',
      active: true,
      rawSecretsStoredInWorkbench: false,
      approvalRequired: false,
      capabilities: ['mail.read', 'calendar.read', 'drive.read'],
      usageSummary: 'Connected with brokered fixture proof',
      customerAccountId: CUSTOMER_ACCOUNT_ID,
      ownerKind: 'member',
      ownerUserId: 'fixture-member-admin',
      grantedScopes: ['mail.read', 'calendar.read'],
      expiresAt: '2026-06-11T10:00:00.000Z',
      accountLabel: 'workspace@example.test',
      lastCheckedAt: NOW,
      sourcePointer: 'fixture:provider:google_workspace',
      auditId: 'fixture-audit-provider-google',
      lastValidatedAt: NOW,
      hasConnectionProof: true,
      hasBrokeredGrant: true,
      summaryText: 'Ready',
    },
    {
      providerKey: 'slack',
      title: 'Slack',
      subtitle: 'Synthetic workspace needs auth',
      status: 'needs_login',
      active: false,
      rawSecretsStoredInWorkbench: false,
      approvalRequired: false,
      capabilities: ['channels.read'],
      grantedScopes: [],
      accountLabel: 'Needs authentication',
      lastCheckedAt: NOW,
      sourcePointer: 'fixture:provider:slack',
      auditId: 'fixture-audit-provider-slack',
      hasConnectionProof: false,
      hasBrokeredGrant: false,
      summaryText: 'Needs auth',
    },
    {
      providerKey: 'notion',
      title: 'Notion',
      subtitle: 'Synthetic workspace expired',
      status: 'expired',
      active: false,
      rawSecretsStoredInWorkbench: false,
      approvalRequired: false,
      capabilities: ['pages.read'],
      grantedScopes: ['pages.read'],
      expiresAt: '2026-06-01T10:00:00.000Z',
      sourcePointer: 'fixture:provider:notion',
      auditId: 'fixture-audit-provider-notion',
      hasConnectionProof: true,
      hasBrokeredGrant: false,
      summaryText: 'Expired',
    },
    {
      providerKey: 'github',
      title: 'GitHub',
      subtitle: 'Synthetic org access revoked',
      status: 'revoked',
      active: false,
      rawSecretsStoredInWorkbench: false,
      approvalRequired: false,
      capabilities: ['issues.read'],
      grantedScopes: [],
      sourcePointer: 'fixture:provider:github',
      auditId: 'fixture-audit-provider-github',
      hasConnectionProof: false,
      hasBrokeredGrant: false,
      summaryText: 'Revoked',
    },
    {
      providerKey: 'linear',
      title: 'Linear',
      subtitle: 'Synthetic approval required',
      status: 'approval_required',
      active: false,
      rawSecretsStoredInWorkbench: false,
      approvalRequired: true,
      capabilities: ['issues.write'],
      grantedScopes: ['issues.read'],
      accountLabel: 'Product fixture workspace',
      sourcePointer: 'fixture:provider:linear',
      auditId: 'fixture-audit-provider-linear',
      hasConnectionProof: true,
      hasBrokeredGrant: false,
      summaryText: 'Approval required',
    },
  ],
};

const approvals: IEvaosApprovalCenterView = {
  schemaVersion: 'evaos.approval_center.v1',
  customerId: CUSTOMER_ID,
  customerAccountId: CUSTOMER_ACCOUNT_ID,
  membershipId: MEMBERSHIP_ID,
  membershipRole: 'owner',
  routeDenied: false,
  backendEnforced: true,
  summaryText: '3 local fixture approval examples',
  sourcePointer: 'fixture:approvals',
  auditId: 'fixture-audit-approvals',
  policyAuditId: peoplePolicy.auditId,
  requests: [
    {
      approvalId: 'fixture-approval-requested',
      ownerId: 'fixture-owner',
      agentId: 'fixture-agent-sales',
      requesterMembershipId: 'fixture-member-operator',
      toolName: 'gmail.send',
      riskClass: 'critical',
      destinationPreview: {
        kind: 'email_recipient',
        primary: 'customer@example.test',
        secondary: 'Renewal follow-up',
        bodyExcerpt: 'Synthetic renewal message preview.',
        actionable: true,
      },
      destinationProof: {
        kind: 'email_recipient',
        fingerprint: 'dest-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        summary: 'Fixture email destination proof',
        source: 'local-fixture',
        sourcePointer: 'fixture:approval:requested',
      },
      allowAlwaysSupported: true,
      availableDecisions: ['allow-once', 'allow-always', 'deny'],
      canAllowOnce: true,
      canAllowAlways: true,
      canDeny: true,
      createdAt: '2026-06-04T09:55:00.000Z',
      expiresAt: '2026-06-04T10:15:00.000Z',
      sourcePointer: 'fixture:approval:requested',
      auditId: 'fixture-audit-approval-requested',
      nextAction: 'Review synthetic recipient and choose a fixture decision.',
    },
    {
      approvalId: 'fixture-approval-approved',
      agentId: 'fixture-agent-research',
      requesterMembershipId: 'fixture-member-admin',
      toolName: 'linear.issue.create',
      riskClass: 'warning',
      destinationPreview: {
        kind: 'permission',
        primary: 'Create synthetic Linear issue',
        secondary: 'Product Reality fixture board',
        actionable: false,
      },
      allowAlwaysSupported: false,
      availableDecisions: [],
      canAllowOnce: false,
      canAllowAlways: false,
      canDeny: false,
      createdAt: '2026-06-04T09:10:00.000Z',
      sourcePointer: 'fixture:approval:approved',
      auditId: 'fixture-audit-approval-approved',
      nextAction: 'Approved in fixture audit trail.',
    },
    {
      approvalId: 'fixture-approval-denied',
      agentId: 'fixture-agent-browser',
      requesterMembershipId: 'fixture-member-agent',
      toolName: 'browser.open_url',
      riskClass: 'info',
      destinationPreview: {
        kind: 'url',
        primary: 'https://fixture.example.test/research',
        actionable: false,
      },
      allowAlwaysSupported: false,
      availableDecisions: [],
      canAllowOnce: false,
      canAllowAlways: false,
      canDeny: false,
      createdAt: '2026-06-04T08:40:00.000Z',
      sourcePointer: 'fixture:approval:denied',
      auditId: 'fixture-audit-approval-denied',
      nextAction: 'Denied in fixture audit trail.',
    },
  ],
};

const directory: IEvaosCompanyBrainDirectoryView = {
  schemaVersion: 'evaos.company_brain.directory.v1',
  customerId: CUSTOMER_ID,
  customerAccountId: CUSTOMER_ACCOUNT_ID,
  membershipId: MEMBERSHIP_ID,
  membershipRole: 'owner',
  routeDenied: false,
  backendEnforced: true,
  ingestionState: 'ingesting',
  integrationHealth: {
    state: 'ingesting',
    summary: 'Fixture Drive index is ingesting 14 synthetic files',
    updatedAt: NOW,
  },
  accounts: [
    {
      accountId: 'fixture-account-renewal',
      name: 'Northstar Fixture Account',
      domain: 'northstar.example.test',
      customerAccountId: CUSTOMER_ACCOUNT_ID,
      owner: 'Fixture Sales',
      ingestionState: 'ready',
      exceptionCount: 1,
      lastActivityAt: '2026-06-04T09:20:00.000Z',
      sourcePointer: 'fixture:company-brain:account:renewal',
      auditId: 'fixture-audit-company-account-renewal',
    },
    {
      accountId: 'fixture-account-ingesting',
      name: 'Atlas Fixture Account',
      domain: 'atlas.example.test',
      customerAccountId: CUSTOMER_ACCOUNT_ID,
      owner: 'Fixture Success',
      ingestionState: 'ingesting',
      exceptionCount: 0,
      sourcePointer: 'fixture:company-brain:account:ingesting',
      auditId: 'fixture-audit-company-account-ingesting',
    },
  ],
  summaryText: '2 fixture accounts, ingesting',
  sourcePointer: 'fixture:company-brain:directory',
  auditId: 'fixture-audit-company-directory',
  policyAuditId: peoplePolicy.auditId,
};

const account360: IEvaosCompanyBrainAccount360View = {
  schemaVersion: 'evaos.company_brain.account_360.v1',
  customerId: CUSTOMER_ID,
  customerAccountId: CUSTOMER_ACCOUNT_ID,
  membershipId: MEMBERSHIP_ID,
  membershipRole: 'owner',
  routeDenied: false,
  backendEnforced: true,
  accountId: 'fixture-account-renewal',
  account: directory.accounts[0],
  ingestionState: 'ready',
  brief: {
    title: 'Renewal fixture brief',
    summary: 'Synthetic account brief with one open onboarding exception.',
    updatedAt: NOW,
    sourcePointer: 'fixture:company-brain:brief',
    auditId: 'fixture-audit-company-brief',
  },
  timeline: [
    {
      entryId: 'fixture-timeline-kickoff',
      type: 'meeting',
      title: 'Fixture kickoff call',
      summary: 'Customer asked for loaded local UI proof.',
      occurredAt: '2026-06-03T15:00:00.000Z',
      sourcePointer: 'fixture:company-brain:timeline:kickoff',
      auditId: 'fixture-audit-company-timeline',
    },
  ],
  exceptions: [
    {
      exceptionId: 'fixture-exception-ingest',
      severity: 'warning',
      title: 'Synthetic ingest still running',
      summary: 'Some fixture documents remain in ingesting state.',
      status: 'open',
      sourcePointer: 'fixture:company-brain:exception:ingest',
      auditId: 'fixture-audit-company-exception',
    },
  ],
  sourcePointer: 'fixture:company-brain:account360',
  auditId: 'fixture-audit-company-account360',
  policyAuditId: peoplePolicy.auditId,
};

const companyBrainQuery: IEvaosCompanyBrainQueryResult = {
  schemaVersion: 'evaos.company_brain.query.v1',
  customerId: CUSTOMER_ID,
  customerAccountId: CUSTOMER_ACCOUNT_ID,
  accountId: 'fixture-account-renewal',
  status: 'error',
  answer: 'Fixture query error: local Company Brain source is intentionally synthetic.',
  citations: [
    {
      citationId: 'fixture-citation-brief',
      title: 'Synthetic renewal brief',
      sourceType: 'local-fixture',
      occurredAt: NOW,
      sourcePointer: 'fixture:company-brain:citation:brief',
    },
  ],
  sourcePointer: 'fixture:company-brain:query',
  auditId: 'fixture-audit-company-query',
  backendEnforced: true,
};

const deniedCompanyBrain: IEvaosCompanyBrainDirectoryView = {
  schemaVersion: 'evaos.company_brain.directory.v1',
  customerId: CUSTOMER_ID,
  customerAccountId: CUSTOMER_ACCOUNT_ID,
  membershipId: 'fixture-member-agent',
  membershipRole: 'agent_only',
  routeDenied: true,
  routeDenialReason: 'Fixture denial: account policy lacks view_company_brain.',
  backendEnforced: true,
  ingestionState: 'empty',
  accounts: [],
  summaryText: 'Company Brain denied by local fixture policy',
  policyAuditId: 'fixture-audit-company-denied-policy',
};

function browserView(status: string, overrides: Partial<IEvaosBusinessBrowserView> = {}): IEvaosBusinessBrowserView {
  return {
    schemaVersion: 'evaos.browser_status.v1',
    customerId: CUSTOMER_ID,
    customerAccountId: CUSTOMER_ACCOUNT_ID,
    membershipId: MEMBERSHIP_ID,
    membershipRole: 'owner',
    routeDenied: false,
    backendEnforced: true,
    displayLabel: 'Business Browser Fixture',
    status,
    healthSummary: 'Synthetic browser runtime state',
    authNeeded: false,
    captchaNeeded: false,
    waitingOnUser: false,
    controlSessionActive: status === 'running',
    canLaunch: status !== 'running',
    canOpenUrl: status === 'running',
    canStop: status === 'running',
    lastCheckedAt: NOW,
    actions: status === 'running' ? ['browser_open_url', 'browser_stop'] : ['browser_launch'],
    sourcePointer: `fixture:business-browser:${status}`,
    auditId: `fixture-audit-browser-${status}`,
    policyAuditId: peoplePolicy.auditId,
    ...overrides,
  };
}

const activeBrowser = browserView('running', {
  currentUrlSummary: {
    scheme: 'https',
    host: 'fixture.example.test',
    path: '/dashboard',
    displayText: 'fixture.example.test/dashboard',
    redacted: false,
  },
  lastActivityAt: '2026-06-04T09:58:00.000Z',
});

const offlineBrowser = browserView('offline', {
  healthSummary: 'Synthetic browser runtime is offline',
  controlSessionActive: false,
  canLaunch: true,
  canOpenUrl: false,
  canStop: false,
  actions: ['browser_launch'],
});

const stoppedBrowser = browserView('stopped', {
  healthSummary: 'Synthetic browser runtime stopped cleanly',
  controlSessionActive: false,
  canLaunch: true,
  canOpenUrl: false,
  canStop: false,
  actions: ['browser_launch'],
});

const deniedBrowser = browserView('denied', {
  membershipId: 'fixture-member-agent',
  membershipRole: 'agent_only',
  routeDenied: true,
  routeDenialReason: 'Fixture denial: account policy lacks open_business_browser.',
  healthSummary: 'Business Browser denied by local fixture policy',
  controlSessionActive: false,
  canLaunch: false,
  canOpenUrl: false,
  canStop: false,
  actions: [],
  sourcePointer: undefined,
  auditId: undefined,
  policyAuditId: 'fixture-audit-browser-denied-policy',
});

const fixture: EvaosLoadedUiFixture = {
  mode: {
    kind: 'local-fixture',
    live: false,
    label: 'LOCAL FIXTURE - NOT LIVE BETA PROOF',
    satisfiesParentIssue67: false,
    publicBetaReleaseEnabled: false,
    issue: 80,
    parentIssue: 67,
  },
  customer: {
    customerId: CUSTOMER_ID,
    customerAccountId: CUSTOMER_ACCOUNT_ID,
    accountName: 'Acme Fixture Co',
    workspaceDomain: 'acme.example.test',
    selectedByMembershipId: MEMBERSHIP_ID,
  },
  people: {
    policy: peoplePolicy,
    members: peoplePolicy.members,
    invites: peoplePolicy.invites,
  },
  providers,
  approvals,
  companyBrain: {
    directory,
    account360,
    query: companyBrainQuery,
    denied: deniedCompanyBrain,
  },
  businessBrowser: {
    active: activeBrowser,
    offline: offlineBrowser,
    launch: {
      status: 'launching',
      message: 'Synthetic browser launch requested.',
      browser: browserView('launching', {
        controlSessionActive: false,
        canLaunch: false,
        canOpenUrl: false,
        canStop: true,
        actions: ['browser_stop'],
      }),
      sourcePointer: 'fixture:business-browser:launch',
      auditId: 'fixture-audit-browser-launch',
      backendEnforced: true,
    },
    stop: {
      status: 'stopped',
      message: 'Synthetic browser stop completed.',
      browser: stoppedBrowser,
      sourcePointer: 'fixture:business-browser:stop',
      auditId: 'fixture-audit-browser-stop',
      backendEnforced: true,
    },
    denied: deniedBrowser,
  },
};

export function createEvaosLoadedUiFixture(): EvaosLoadedUiFixture {
  return structuredClone(fixture);
}
