/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IEvaosBusinessBrowserActionResult,
  IEvaosBusinessBrowserOpenUrlRequest,
  IEvaosBusinessBrowserRequest,
  IEvaosBusinessBrowserView,
  IEvaosSafeUrlSummary,
  IEvaosCompanyBrainAccount360View,
  IEvaosCompanyBrainAccountRequest,
  IEvaosCompanyBrainAccountSummaryView,
  IEvaosCompanyBrainDirectoryRequest,
  IEvaosCompanyBrainDirectoryView,
  IEvaosCompanyBrainQueryRequest,
  IEvaosCompanyBrainQueryResult,
  IEvaosCustomerTargetsView,
  IEvaosProviderActionRequest,
  IEvaosProviderActionResult,
  IEvaosProviderApprovalRequest,
  IEvaosProviderHubRequest,
  IEvaosProviderHubView,
} from '@/common/adapter/ipcBridge';

const CUSTOMER_ID = 'fixture-customer-acme';
const BROWSER_DENIED_CUSTOMER_ID = 'fixture-customer-browser-denied';
const CUSTOMER_ACCOUNT_ID = 'fixture-account-acme';
const MEMBERSHIP_ID = 'fixture-member-owner';
const NOW = '2026-06-04T10:00:00.000Z';
const FIXTURE_LABEL = 'LOCAL FIXTURE - NOT LIVE BETA PROOF';

export function isEvaosLocalProductFixtureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AIONUI_E2E_TEST === '1' && env.AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE === '1';
}

export function evaosLocalProductFixtureCustomerTargets(): IEvaosCustomerTargetsView {
  return clone({
    roles: ['owner'],
    isOperator: true,
    defaultCustomerId: CUSTOMER_ID,
    selectedCustomerId: CUSTOMER_ID,
    customers: [
      {
        customerId: CUSTOMER_ID,
        displayName: 'Acme Fixture Co',
        email: 'owner@example.test',
        status: 'active',
        healthStatus: 'ready',
        isDefault: true,
      },
      {
        customerId: BROWSER_DENIED_CUSTOMER_ID,
        displayName: 'Denied Browser Fixture Co',
        email: 'agent-only@example.test',
        status: 'active',
        healthStatus: 'ready',
        isDefault: false,
      },
    ],
    summaryText: `${FIXTURE_LABEL}: 2 customer targets loaded`,
  });
}

export function evaosLocalProductFixtureProviderHub(request: IEvaosProviderHubRequest): IEvaosProviderHubView {
  if (request.customerId !== CUSTOMER_ID) {
    return clone({
      schemaVersion: 'evaos.provider_hub.v1',
      customerId: request.customerId,
      customerAccountId: CUSTOMER_ACCOUNT_ID,
      membershipId: MEMBERSHIP_ID,
      membershipRole: 'owner',
      routeDenied: true,
      routeDenialReason: `${FIXTURE_LABEL}: customer target is not available in the local fixture.`,
      backendEnforced: true,
      profiles: [],
      summaryText: `${FIXTURE_LABEL}: Connected Apps denied for wrong customer fixture`,
      sourcePointer: 'local-fixture:provider_profiles:denied',
      auditId: 'fixture-audit-provider-denied',
      policyAuditId: 'fixture-audit-policy',
    });
  }

  return clone(providerHub);
}

export function evaosLocalProductFixtureProviderAction(
  request: IEvaosProviderActionRequest | IEvaosProviderApprovalRequest,
  action:
    | 'provider_auth_start'
    | 'provider_switch'
    | 'provider_revoke'
    | 'provider_mint_grant'
    | 'provider_approval_request'
): IEvaosProviderActionResult {
  const providerHub = evaosLocalProductFixtureProviderHub({ customerId: request.customerId });
  const provider = providerHub.profiles.find((item) => item.providerKey === request.providerKey);

  if (!provider || providerHub.routeDenied) {
    return clone({
      status: 'denied',
      providerKey: request.providerKey,
      message: `${FIXTURE_LABEL}: provider action denied by local fixture policy.`,
      providerHub,
      sourcePointer: `local-fixture:${action}:denied`,
      auditId: 'fixture-audit-provider-action-denied',
      backendEnforced: true,
    });
  }

  const statusByAction = {
    provider_auth_start: 'pending',
    provider_switch: 'switched',
    provider_revoke: 'revoked',
    provider_mint_grant: 'granted',
    provider_approval_request: 'pending',
  } as const;

  const messageByAction = {
    provider_auth_start: `${FIXTURE_LABEL}: auth handoff prepared without raw OAuth secrets.`,
    provider_switch: `${FIXTURE_LABEL}: active provider changed.`,
    provider_revoke: `${FIXTURE_LABEL}: provider access disconnected.`,
    provider_mint_grant: `${FIXTURE_LABEL}: opaque agent access handle minted.`,
    provider_approval_request: `${FIXTURE_LABEL}: provider approval request opened.`,
  } as const;

  return clone({
    status: statusByAction[action],
    providerKey: request.providerKey,
    message: messageByAction[action],
    authUrlSummary:
      action === 'provider_auth_start'
        ? {
            scheme: 'https',
            host: 'auth-fixture.example.test',
            path: '/oauth/start',
            displayText: 'auth-fixture.example.test/oauth/start',
            redacted: true,
          }
        : undefined,
    providerHub,
    sourcePointer: `local-fixture:${action}:${request.providerKey}`,
    auditId: `fixture-audit-${action}-${request.providerKey}`,
    backendEnforced: true,
  });
}

export function evaosLocalProductFixtureBusinessBrowserStatus(
  request: IEvaosBusinessBrowserRequest
): IEvaosBusinessBrowserView {
  if (request.customerId === BROWSER_DENIED_CUSTOMER_ID) {
    return clone(deniedBusinessBrowser(request.customerId));
  }

  if (request.customerId !== CUSTOMER_ID) {
    return clone(
      deniedBusinessBrowser(
        request.customerId,
        `${FIXTURE_LABEL}: customer target is not available in the local fixture.`,
        'fixture-audit-browser-wrong-customer-policy'
      )
    );
  }

  return clone(activeBusinessBrowser);
}

export function evaosLocalProductFixtureBusinessBrowserAction(
  request: IEvaosBusinessBrowserRequest | IEvaosBusinessBrowserOpenUrlRequest,
  action: 'browser_launch' | 'browser_open_url' | 'browser_stop'
): IEvaosBusinessBrowserActionResult {
  const current = evaosLocalProductFixtureBusinessBrowserStatus({ customerId: request.customerId });

  if (current.routeDenied) {
    return clone({
      status: 'denied',
      message: `${FIXTURE_LABEL}: Business Browser action denied by local fixture policy.`,
      browser: current,
      sourcePointer: `local-fixture:business-browser:${action}:denied`,
      auditId: 'fixture-audit-browser-action-denied',
      backendEnforced: true,
    });
  }

  if (action === 'browser_launch') {
    return clone({
      status: 'launching',
      message: `${FIXTURE_LABEL}: Synthetic browser launch requested.`,
      browser: browserView('launching', {
        healthSummary: `${FIXTURE_LABEL}: Synthetic browser launch requested.`,
        controlSessionActive: false,
        canLaunch: false,
        canOpenUrl: false,
        canStop: false,
        actions: ['browser_launch'],
        sourcePointer: 'local-fixture:business-browser:launching',
        auditId: 'fixture-audit-browser-launch',
      }),
      sourcePointer: 'local-fixture:business-browser:launch',
      auditId: 'fixture-audit-browser-launch',
      backendEnforced: true,
    });
  }

  if (action === 'browser_stop') {
    return clone({
      status: 'stopped',
      message: `${FIXTURE_LABEL}: Synthetic browser stop completed.`,
      browser: stoppedBusinessBrowser,
      sourcePointer: 'local-fixture:business-browser:stop',
      auditId: 'fixture-audit-browser-stop',
      backendEnforced: true,
    });
  }

  const urlSummary = safeUrlSummary('url' in request ? request.url : undefined);
  return clone({
    status: 'opened',
    message: `${FIXTURE_LABEL}: Synthetic browser URL opened.`,
    browser: browserView('running', {
      healthSummary: `${FIXTURE_LABEL}: Synthetic browser runtime state with brokered URL action proof.`,
      currentUrlSummary: urlSummary,
      lastActivityAt: NOW,
      sourcePointer: 'local-fixture:business-browser:open-url',
      auditId: 'fixture-audit-browser-open-url',
    }),
    urlSummary,
    sourcePointer: 'local-fixture:business-browser:open-url',
    auditId: 'fixture-audit-browser-open-url',
    backendEnforced: true,
  });
}

export function evaosLocalProductFixtureCompanyBrainDirectory(
  request: IEvaosCompanyBrainDirectoryRequest
): IEvaosCompanyBrainDirectoryView {
  if (request.customerId !== CUSTOMER_ID) {
    return clone({
      schemaVersion: 'evaos.company_brain.directory.v1',
      customerId: request.customerId,
      customerAccountId: CUSTOMER_ACCOUNT_ID,
      membershipId: MEMBERSHIP_ID,
      membershipRole: 'owner',
      routeDenied: true,
      routeDenialReason: `${FIXTURE_LABEL}: wrong customer fixture is denied for Company Brain.`,
      backendEnforced: true,
      ingestionState: 'empty',
      accounts: [],
      summaryText: `${FIXTURE_LABEL}: Company Brain denied for wrong customer fixture`,
      sourcePointer: 'local-fixture:company-brain:denied',
      auditId: 'fixture-audit-company-denied',
      policyAuditId: 'fixture-audit-policy',
    });
  }

  return clone(companyBrainDirectory);
}

export function evaosLocalProductFixtureCompanyBrainAccount360(
  request: IEvaosCompanyBrainAccountRequest
): IEvaosCompanyBrainAccount360View {
  if (request.customerId !== CUSTOMER_ID) {
    return clone(companyBrainDeniedAccount360(request));
  }

  const account = companyBrainAccounts.find((item) => item.accountId === request.accountId);
  if (!account) {
    return clone(companyBrainDeniedAccount360(request, `${FIXTURE_LABEL}: account fixture is not available.`));
  }

  return clone({
    schemaVersion: 'evaos.company_brain.account_360.v1',
    customerId: CUSTOMER_ID,
    customerAccountId: CUSTOMER_ACCOUNT_ID,
    membershipId: MEMBERSHIP_ID,
    membershipRole: 'owner',
    routeDenied: false,
    backendEnforced: true,
    accountId: account.accountId,
    account,
    ingestionState: account.ingestionState,
    brief: {
      title:
        account.accountId === 'fixture-company-renewal' ? 'Renewal fixture brief' : `${account.name} fixture brief`,
      summary:
        account.accountId === 'fixture-company-renewal'
          ? `${FIXTURE_LABEL}: Northstar has one renewal risk, one open ingest exception, and no raw source text exposed.`
          : `${FIXTURE_LABEL}: ${account.name} has synthetic Company Brain account evidence.`,
      updatedAt: NOW,
      sourcePointer: `local-fixture:company-brain:brief:${account.accountId}`,
      auditId: `fixture-audit-company-brief-${account.accountId}`,
    },
    timeline: [
      {
        entryId: `fixture-timeline-${account.accountId}`,
        type: 'meeting',
        title: 'Fixture kickoff call',
        summary: `${FIXTURE_LABEL}: account timeline loaded from sanitized broker fixture.`,
        occurredAt: NOW,
        sourcePointer: `local-fixture:company-brain:timeline:${account.accountId}`,
        auditId: `fixture-audit-company-timeline-${account.accountId}`,
      },
    ],
    exceptions:
      account.exceptionCount > 0
        ? [
            {
              exceptionId: `fixture-exception-${account.accountId}`,
              severity: account.ingestionState === 'error' ? 'warning' : 'info',
              title: 'Synthetic ingest still running',
              summary: `${FIXTURE_LABEL}: exception visibility is loaded without raw embeddings.`,
              status: 'open',
              sourcePointer: `local-fixture:company-brain:exception:${account.accountId}`,
              auditId: `fixture-audit-company-exception-${account.accountId}`,
            },
          ]
        : [],
    sourcePointer: `local-fixture:company-brain:account-360:${account.accountId}`,
    auditId: 'fixture-audit-company-account360',
    policyAuditId: 'fixture-audit-policy',
  });
}

export function evaosLocalProductFixtureCompanyBrainQuery(
  request: IEvaosCompanyBrainQueryRequest
): IEvaosCompanyBrainQueryResult {
  const account = companyBrainAccounts.find((item) => item.accountId === request.accountId);
  if (request.customerId !== CUSTOMER_ID || !account) {
    return clone({
      schemaVersion: 'evaos.company_brain.query.v1',
      customerId: request.customerId,
      customerAccountId: CUSTOMER_ACCOUNT_ID,
      accountId: request.accountId,
      status: 'denied',
      answer: `${FIXTURE_LABEL}: Company Brain query was denied by local fixture policy.`,
      citations: [],
      sourcePointer: 'local-fixture:company-brain:query:denied',
      auditId: 'fixture-audit-company-query-denied',
      backendEnforced: true,
    });
  }

  return clone({
    schemaVersion: 'evaos.company_brain.query.v1',
    customerId: CUSTOMER_ID,
    customerAccountId: CUSTOMER_ACCOUNT_ID,
    accountId: request.accountId,
    status: 'answered',
    answer: `${FIXTURE_LABEL}: ${account.name} needs renewal follow-up and ingest exception review.`,
    citations: [
      {
        citationId: 'fixture-citation-renewal',
        title: 'Fixture kickoff call',
        sourceType: 'meeting',
        occurredAt: NOW,
        sourcePointer: `local-fixture:company-brain:citation:${request.accountId}`,
      },
    ],
    sourcePointer: `local-fixture:company-brain:query:${request.accountId}`,
    auditId: 'fixture-audit-company-query',
    backendEnforced: true,
  });
}

const providerHub: IEvaosProviderHubView = {
  schemaVersion: 'evaos.provider_hub.v1',
  customerId: CUSTOMER_ID,
  customerAccountId: CUSTOMER_ACCOUNT_ID,
  membershipId: MEMBERSHIP_ID,
  membershipRole: 'owner',
  routeDenied: false,
  backendEnforced: true,
  activeProviderKey: 'google_workspace',
  summaryText: `${FIXTURE_LABEL}: 5 provider states loaded`,
  sourcePointer: 'local-fixture:provider_profiles',
  auditId: 'fixture-audit-providers',
  policyAuditId: 'fixture-audit-policy',
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
      sourcePointer: 'local-fixture:provider:google_workspace',
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
      sourcePointer: 'local-fixture:provider:slack',
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
      sourcePointer: 'local-fixture:provider:notion',
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
      sourcePointer: 'local-fixture:provider:github',
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
      sourcePointer: 'local-fixture:provider:linear',
      auditId: 'fixture-audit-provider-linear',
      hasConnectionProof: true,
      hasBrokeredGrant: false,
      summaryText: 'Approval required',
    },
  ],
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
    healthSummary: `${FIXTURE_LABEL}: Synthetic browser runtime state.`,
    authNeeded: false,
    captchaNeeded: false,
    waitingOnUser: false,
    controlSessionActive: status === 'running',
    canLaunch: status !== 'running',
    canOpenUrl: status === 'running',
    canStop: status === 'running',
    lastCheckedAt: NOW,
    actions: status === 'running' ? ['browser_open_url', 'browser_stop'] : ['browser_launch'],
    sourcePointer: `local-fixture:business-browser:${status}`,
    auditId: `fixture-audit-browser-${status}`,
    policyAuditId: 'fixture-audit-policy',
    ...overrides,
  };
}

const activeBusinessBrowser = browserView('running', {
  currentUrlSummary: {
    scheme: 'https',
    host: 'fixture.example.test',
    path: '/dashboard',
    displayText: 'fixture.example.test/dashboard',
    redacted: false,
  },
  lastActivityAt: '2026-06-04T09:58:00.000Z',
  auditId: 'fixture-audit-browser-running',
});

const stoppedBusinessBrowser = browserView('stopped', {
  healthSummary: `${FIXTURE_LABEL}: Synthetic browser runtime stopped cleanly.`,
  controlSessionActive: false,
  canLaunch: true,
  canOpenUrl: false,
  canStop: false,
  actions: ['browser_launch'],
  sourcePointer: 'local-fixture:business-browser:stopped',
  auditId: 'fixture-audit-browser-stop',
});

function deniedBusinessBrowser(
  customerId: string,
  reason = `${FIXTURE_LABEL}: account policy lacks open_business_browser for this fixture customer.`,
  policyAuditId = 'fixture-audit-browser-denied-policy'
): IEvaosBusinessBrowserView {
  return browserView('denied', {
    customerId,
    membershipId: 'fixture-member-agent',
    membershipRole: 'agent_only',
    routeDenied: true,
    routeDenialReason: reason,
    healthSummary: `${FIXTURE_LABEL}: Business Browser denied by local fixture policy.`,
    controlSessionActive: false,
    canLaunch: false,
    canOpenUrl: false,
    canStop: false,
    actions: [],
    sourcePointer: 'local-fixture:business-browser:denied',
    auditId: undefined,
    policyAuditId,
  });
}

function safeUrlSummary(rawUrl: string | undefined): IEvaosSafeUrlSummary {
  try {
    const parsed = new URL(rawUrl || 'https://fixture.example.test/dashboard');
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return {
      scheme: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      path,
      displayText: `${parsed.hostname}${path}`,
      redacted: parsed.search.length > 0 || parsed.hash.length > 0 || parsed.username.length > 0,
    };
  } catch {
    return {
      scheme: 'https',
      host: 'fixture.example.test',
      path: '/dashboard',
      displayText: 'fixture.example.test/dashboard',
      redacted: true,
    };
  }
}

const companyBrainAccounts: IEvaosCompanyBrainAccountSummaryView[] = [
  {
    accountId: 'fixture-company-renewal',
    name: 'Northstar Fixture Account',
    domain: 'northstar.example.test',
    customerAccountId: CUSTOMER_ACCOUNT_ID,
    owner: 'customer-success',
    ingestionState: 'ready',
    exceptionCount: 1,
    lastActivityAt: NOW,
    sourcePointer: 'local-fixture:company-brain:account:renewal',
    auditId: 'fixture-audit-company-account-renewal',
  },
  {
    accountId: 'fixture-company-ingesting',
    name: 'Atlas Fixture Account',
    domain: 'atlas.example.test',
    customerAccountId: CUSTOMER_ACCOUNT_ID,
    owner: 'operations',
    ingestionState: 'ingesting',
    exceptionCount: 0,
    lastActivityAt: NOW,
    sourcePointer: 'local-fixture:company-brain:account:ingesting',
    auditId: 'fixture-audit-company-account-ingesting',
  },
  {
    accountId: 'fixture-company-error',
    name: 'Signal Error Fixture Account',
    domain: 'signal-error.example.test',
    customerAccountId: CUSTOMER_ACCOUNT_ID,
    owner: 'support',
    ingestionState: 'error',
    exceptionCount: 2,
    lastActivityAt: NOW,
    sourcePointer: 'local-fixture:company-brain:account:error',
    auditId: 'fixture-audit-company-account-error',
  },
];

const companyBrainDirectory: IEvaosCompanyBrainDirectoryView = {
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
    summary: `${FIXTURE_LABEL}: directory, account brief, query, and exception fixture loaded`,
    updatedAt: NOW,
  },
  accounts: companyBrainAccounts,
  summaryText: `${FIXTURE_LABEL}: 3 Company Brain accounts loaded`,
  sourcePointer: 'local-fixture:company-brain:directory',
  auditId: 'fixture-audit-company-directory',
  policyAuditId: 'fixture-audit-policy',
};

function companyBrainDeniedAccount360(
  request: IEvaosCompanyBrainAccountRequest,
  reason = `${FIXTURE_LABEL}: wrong customer fixture is denied for Company Brain.`
): IEvaosCompanyBrainAccount360View {
  return {
    schemaVersion: 'evaos.company_brain.account_360.v1',
    customerId: request.customerId,
    customerAccountId: CUSTOMER_ACCOUNT_ID,
    membershipId: MEMBERSHIP_ID,
    membershipRole: 'owner',
    routeDenied: true,
    routeDenialReason: reason,
    backendEnforced: true,
    accountId: request.accountId,
    account: {
      accountId: request.accountId,
      name: 'Denied Fixture Account',
      ingestionState: 'empty',
      exceptionCount: 0,
    },
    ingestionState: 'empty',
    timeline: [],
    exceptions: [],
    sourcePointer: 'local-fixture:company-brain:account-360:denied',
    auditId: 'fixture-audit-company-account360-denied',
    policyAuditId: 'fixture-audit-policy',
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
