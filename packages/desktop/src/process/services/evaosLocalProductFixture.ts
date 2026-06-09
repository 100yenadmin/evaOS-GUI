/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IEvaosBrokerSessionStatus,
  IEvaosBusinessBrowserActionResult,
  IEvaosBusinessBrowserOpenUrlRequest,
  IEvaosBusinessBrowserRequest,
  IEvaosBusinessBrowserView,
  IEvaosAccountPolicyScope,
  IEvaosApprovalCenterRequest,
  IEvaosApprovalCenterView,
  IEvaosApprovalDecisionResult,
  IEvaosApprovalDenyRequest,
  IEvaosRuntimeStatusRequest,
  IEvaosRuntimeStatusView,
  IEvaosRuntimeSurfaceView,
  IEvaosRuntimeActionRequest,
  IEvaosRuntimeActionResult,
  IEvaosSafeUrlSummary,
  IEvaosCompanyBrainAccount360View,
  IEvaosCompanyBrainAccountRequest,
  IEvaosCompanyBrainAccountSummaryView,
  IEvaosCompanyBrainDirectoryRequest,
  IEvaosCompanyBrainDirectoryView,
  IEvaosCompanyBrainQueryRequest,
  IEvaosCompanyBrainQueryResult,
  IEvaosCustomerTargetsView,
  IEvaosPeopleAccessPolicyRequest,
  IEvaosPeopleAccessPolicyView,
  IEvaosProviderActionRequest,
  IEvaosProviderActionResult,
  IEvaosProviderApprovalRequest,
  IEvaosProviderHubRequest,
  IEvaosProviderHubView,
} from '@/common/evaos/bridgeTypes';

const CUSTOMER_ID = 'fixture-customer-acme';
const BROWSER_DENIED_CUSTOMER_ID = 'fixture-customer-browser-denied';
const BROWSER_OFFLINE_CUSTOMER_ID = 'fixture-customer-browser-offline';
const BROWSER_FAILED_CUSTOMER_ID = 'fixture-customer-browser-failed';
const CUSTOMER_ACCOUNT_ID = 'fixture-account-acme';
const MEMBERSHIP_ID = 'fixture-member-owner';
const NOW = '2026-06-04T10:00:00.000Z';
const FIXTURE_LABEL = 'LOCAL FIXTURE - NOT LIVE BETA PROOF';
const BUSINESS_BROWSER_FIXTURE_URL = 'https://browser.fixture.example.test/workspace';
type EvaosLocalProductFixturePersona = 'owner' | 'member';
type EvaosRuntimeFixture = Pick<IEvaosRuntimeStatusView, 'displayLabel' | 'status'> & Partial<IEvaosRuntimeStatusView>;
const OWNER_FIXTURE_SCOPES: IEvaosAccountPolicyScope[] = [
  'manage_members',
  'manage_integrations',
  'approve_actions',
  'open_business_browser',
  'use_creative_studio',
  'use_design_workspace',
  'view_company_brain',
  'manage_company_brain',
  'assign_agents',
  'access_openclaw_dashboard',
  'access_hermes_dashboard',
  'access_terminal',
  'access_technical_diagnostics',
];
const MEMBER_FIXTURE_SCOPES: IEvaosAccountPolicyScope[] = [
  'open_business_browser',
  'use_creative_studio',
  'use_design_workspace',
];

export function isEvaosLocalProductFixtureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AIONUI_E2E_TEST === '1' && env.AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE === '1';
}

export function evaosLocalProductFixturePersona(env: NodeJS.ProcessEnv = process.env): EvaosLocalProductFixturePersona {
  return env.AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE_PERSONA === 'member' ? 'member' : 'owner';
}

export function evaosLocalProductFixtureSessionStatus(env: NodeJS.ProcessEnv = process.env): IEvaosBrokerSessionStatus {
  const persona = evaosLocalProductFixturePersona(env);
  return clone({
    state: 'authenticated',
    authenticated: true,
    expired: false,
    sessionKey: `evaos-local-fixture-${persona}`,
    sessionEpoch: 1,
    userEmail: persona === 'member' ? 'member@example.test' : 'admin@100yen.org',
    expiresAt: '2026-06-11T10:00:00.000Z',
    source: 'memory',
    message: `${FIXTURE_LABEL}: ${persona} desktop session active for local proof.`,
  });
}

export function evaosLocalProductFixtureCustomerTargets(
  env: NodeJS.ProcessEnv = process.env
): IEvaosCustomerTargetsView {
  const persona = evaosLocalProductFixturePersona(env);
  return clone({
    roles: persona === 'member' ? ['member'] : ['owner'],
    scopes: persona === 'member' ? MEMBER_FIXTURE_SCOPES : OWNER_FIXTURE_SCOPES,
    isOperator: persona === 'owner',
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
      {
        customerId: BROWSER_OFFLINE_CUSTOMER_ID,
        displayName: 'Offline Browser Fixture Co',
        email: 'offline@example.test',
        status: 'active',
        healthStatus: 'offline',
        isDefault: false,
      },
      {
        customerId: BROWSER_FAILED_CUSTOMER_ID,
        displayName: 'Failed Browser Fixture Co',
        email: 'failed@example.test',
        status: 'active',
        healthStatus: 'needs_attention',
        isDefault: false,
      },
    ],
    summaryText: `${FIXTURE_LABEL}: 4 customer targets loaded for ${persona} persona`,
  });
}

export function evaosLocalProductFixturePeopleAccessPolicy(
  request: IEvaosPeopleAccessPolicyRequest
): IEvaosPeopleAccessPolicyView {
  if (request.customerId !== CUSTOMER_ID) {
    return clone({
      schemaVersion: 'evaos.account_policy.v1',
      customerAccountId: CUSTOMER_ACCOUNT_ID,
      selectedCustomerId: request.customerId,
      membershipId: 'fixture-member-agent',
      membershipRole: 'agent_only',
      planCode: 'fixture-beta',
      seatLimit: 8,
      activeSeats: 0,
      invitedSeats: 0,
      scopes: [],
      advancedSurfaces: {
        peopleAccess: false,
        providerHub: false,
        approvalCenter: false,
        companyBrain: false,
        businessBrowser: false,
      },
      members: [],
      invites: [],
      routeDenied: true,
      routeDenialReason: `${FIXTURE_LABEL}: People Access denied for wrong customer fixture.`,
      backendEnforced: true,
      updatedAt: NOW,
      auditId: 'fixture-audit-people-denied-policy',
    });
  }

  return clone(peoplePolicy);
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

export function evaosLocalProductFixtureApprovalCenter(request: IEvaosApprovalCenterRequest): IEvaosApprovalCenterView {
  if (request.customerId !== CUSTOMER_ID) {
    return clone({
      schemaVersion: 'evaos.approval_center.v1',
      customerId: request.customerId,
      customerAccountId: CUSTOMER_ACCOUNT_ID,
      membershipId: 'fixture-member-agent',
      membershipRole: 'agent_only',
      routeDenied: true,
      routeDenialReason: `${FIXTURE_LABEL}: Approval Center denied for wrong customer fixture.`,
      backendEnforced: true,
      requests: [],
      summaryText: `${FIXTURE_LABEL}: Approval Center denied by local fixture policy`,
      sourcePointer: 'local-fixture:approval-center:denied',
      auditId: undefined,
      policyAuditId: 'fixture-audit-approval-denied-policy',
    });
  }

  return clone(approvalCenter);
}

export function evaosLocalProductFixtureDenyApproval(request: IEvaosApprovalDenyRequest): IEvaosApprovalDecisionResult {
  const center = evaosLocalProductFixtureApprovalCenter({ customerId: request.customerId });
  const approval = center.requests.find((item) => item.approvalId === request.approvalId);

  if (!approval || center.routeDenied) {
    return clone({
      status: 'denied',
      decision: 'deny',
      scope: 'this-call',
      approvalId: request.approvalId,
      sourcePointer: 'local-fixture:approval-center:deny:denied',
      auditId: 'fixture-audit-approval-deny-denied',
      backendEnforced: true,
    });
  }

  return clone({
    status: 'denied',
    decision: 'deny',
    scope: 'this-call',
    approvalId: approval.approvalId,
    request: approval,
    runtimeResult: {
      status: 'denied',
      runtime: 'openclaw',
      sourcePointer: `local-fixture:approval-center:decision:${approval.approvalId}`,
      auditId: 'fixture-audit-approval-deny',
    },
    sourcePointer: `local-fixture:approval-center:deny:${approval.approvalId}`,
    auditId: 'fixture-audit-approval-deny',
    backendEnforced: true,
  });
}

export function evaosLocalProductFixtureBusinessBrowserStatus(
  request: IEvaosBusinessBrowserRequest
): IEvaosBusinessBrowserView {
  if (request.customerId === BROWSER_DENIED_CUSTOMER_ID) {
    return clone(deniedBusinessBrowser(request.customerId));
  }

  if (request.customerId === BROWSER_OFFLINE_CUSTOMER_ID) {
    return clone(offlineBusinessBrowser);
  }

  if (request.customerId === BROWSER_FAILED_CUSTOMER_ID) {
    return clone(failedBusinessBrowser);
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

export function evaosLocalProductFixtureRuntimeStatus(request: IEvaosRuntimeStatusRequest): IEvaosRuntimeStatusView {
  if (request.runtime === 'browser') {
    return businessBrowserToRuntimeStatus(
      evaosLocalProductFixtureBusinessBrowserStatus({ customerId: request.customerId })
    );
  }

  const runtimeByKey: Record<string, EvaosRuntimeFixture> = {
    openclaw: {
      displayLabel: 'evaOS',
      status: 'running',
      healthSummary: `${FIXTURE_LABEL}: evaOS workspace is accepting customer-scoped agent work.`,
      owner: 'operations',
      lastActivityAt: '2026-06-04T09:57:00.000Z',
      sourcePointer: 'local-fixture:runtime:openclaw',
      auditId: 'fixture-audit-runtime-openclaw',
      actions: ['attach_dashboard'],
    },
    hermes: {
      displayLabel: 'Hermes',
      status: 'done',
      healthSummary: `${FIXTURE_LABEL}: Hermes dashboard sync completed for the selected customer.`,
      owner: 'operations',
      lastActivityAt: '2026-06-04T09:54:00.000Z',
      sourcePointer: 'local-fixture:runtime:hermes',
      auditId: 'fixture-audit-runtime-hermes',
      actions: ['attach_dashboard'],
    },
    paperclip: {
      displayLabel: 'Paperclip',
      status: 'waiting',
      healthSummary: `${FIXTURE_LABEL}: Paperclip queue is waiting on the next approved task.`,
      owner: 'operations',
      sourcePointer: 'local-fixture:runtime:paperclip',
      auditId: 'fixture-audit-runtime-paperclip',
      actions: ['attach_dashboard'],
    },
    terminal: {
      displayLabel: 'Terminal',
      status: 'offline',
      healthSummary: `${FIXTURE_LABEL}: Customer VM shell is offline in this local fixture.`,
      owner: 'support',
      sourcePointer: 'local-fixture:runtime:terminal-offline',
      auditId: 'fixture-audit-runtime-terminal-offline',
    },
    opendesign: {
      displayLabel: 'Design Workspace',
      status: 'running',
      healthSummary: `${FIXTURE_LABEL}: OpenDesign workspace is ready for the selected customer.`,
      owner: 'product',
      sourcePointer: 'local-fixture:runtime:opendesign',
      auditId: 'fixture-audit-runtime-opendesign',
      actions: ['attach_dashboard'],
    },
    creative_studio: {
      displayLabel: 'Creative Studio',
      status: 'running',
      healthSummary: `${FIXTURE_LABEL}: Creative Studio external workspace is ready to open.`,
      owner: 'product',
      sourcePointer: 'local-fixture:runtime:creative_studio',
      auditId: 'fixture-audit-runtime-creative-studio',
      actions: ['open_dashboard'],
    },
  };

  if (request.runtime === 'paperclip' && request.customerId !== CUSTOMER_ID) {
    return clone({
      schemaVersion: 'evaos.runtime_status.v1',
      customerId: request.customerId,
      customerAccountId: CUSTOMER_ACCOUNT_ID,
      runtimeKey: 'paperclip',
      displayLabel: 'Paperclip',
      status: 'denied',
      healthSummary: `${FIXTURE_LABEL}: Paperclip denied for wrong customer fixture.`,
      owner: 'operations',
      lastCheckedAt: NOW,
      actions: [],
      sourcePointer: 'local-fixture:denied-runtime:paperclip',
      auditId: 'fixture-audit-denied-runtime-paperclip',
    });
  }

  if (request.runtime === 'terminal' && request.customerId !== CUSTOMER_ID) {
    return clone({
      schemaVersion: 'evaos.runtime_status.v1',
      customerId: request.customerId,
      customerAccountId: CUSTOMER_ACCOUNT_ID,
      runtimeKey: 'terminal',
      displayLabel: 'Terminal',
      status: 'denied',
      healthSummary: `${FIXTURE_LABEL}: Terminal denied for wrong customer fixture.`,
      owner: 'support',
      lastCheckedAt: NOW,
      actions: [],
      sourcePointer: 'local-fixture:runtime:terminal-denied',
      auditId: 'fixture-audit-runtime-terminal-denied',
    });
  }

  const selected: EvaosRuntimeFixture = runtimeByKey[request.runtime] ?? {
    displayLabel: request.runtime,
    status: 'offline',
    healthSummary: `${FIXTURE_LABEL}: Runtime is not configured in this local fixture.`,
    sourcePointer: `local-fixture:runtime:${request.runtime}:missing`,
    auditId: `fixture-audit-runtime-${request.runtime}-missing`,
  };

  return clone({
    schemaVersion: 'evaos.runtime_status.v1',
    customerId: request.customerId,
    customerAccountId: CUSTOMER_ACCOUNT_ID,
    runtimeKey: request.runtime,
    lastCheckedAt: NOW,
    actions: [],
    ...selected,
  });
}

export function evaosLocalProductFixtureRuntimeAction(request: IEvaosRuntimeActionRequest): IEvaosRuntimeActionResult {
  const runtimeStatus = evaosLocalProductFixtureRuntimeStatus({
    customerId: request.customerId,
    runtime: request.runtime,
  });
  const sourcePointer = `local-fixture:runtime-action:${request.runtime}:${request.action}`;
  const auditId = `fixture-audit-runtime-action-${request.runtime}-${request.action}`;
  const normalizedStatus = runtimeStatus.status.toLowerCase();

  if (normalizedStatus === 'denied') {
    return clone({
      status: 'denied',
      runtimeKey: request.runtime,
      customerId: request.customerId,
      message: `${FIXTURE_LABEL}: runtime action denied by local fixture policy.`,
      runtimeStatus,
      sourcePointer,
      auditId,
      backendEnforced: true,
    });
  }

  if (/(offline|failed|error)/.test(normalizedStatus)) {
    return clone({
      status: 'offline',
      runtimeKey: request.runtime,
      customerId: request.customerId,
      message: `${FIXTURE_LABEL}: runtime action blocked until repair restores the workspace.`,
      runtimeStatus,
      sourcePointer,
      auditId,
      backendEnforced: true,
    });
  }

  return clone({
    status: 'opened',
    runtimeKey: request.runtime,
    customerId: request.customerId,
    message: `${FIXTURE_LABEL}: opened ${runtimeStatus.displayLabel} through brokered runtime action proof.`,
    urlSummary:
      request.runtime === 'creative_studio'
        ? safeUrlSummary('https://www.comfy.org/cloud')
        : safeUrlSummary(`https://${request.runtime}.fixture.example.test/workspace`),
    runtimeSurface: {
      schemaVersion: 'evaos.runtime_surface.v1',
      surfaceId: `fixture-${request.customerId}-${request.runtime}`,
      surfaceUri: `evaos-runtime-surface://fixture-${request.customerId}-${request.runtime}/`,
      partition: `evaos-runtime-fixture-${request.customerId}-${request.runtime}`,
      customerId: request.customerId,
      runtimeKey: request.runtime,
      displayLabel: runtimeStatus.displayLabel,
      status: 'attached',
      sourcePointer,
      auditId,
    },
    runtimeStatus,
    sourcePointer,
    auditId,
    backendEnforced: true,
  });
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
    const sourcePointer = 'local-fixture:business-browser:launch';
    const auditId = 'fixture-audit-browser-launch';
    return clone({
      status: 'attached',
      message: `${FIXTURE_LABEL}: Synthetic browser surface attached.`,
      browser: browserView('running', {
        customerId: request.customerId,
        healthSummary: `${FIXTURE_LABEL}: Synthetic browser runtime surface attached.`,
        controlSessionActive: true,
        canLaunch: true,
        canOpenUrl: true,
        canStop: true,
        currentUrlSummary: safeUrlSummary(BUSINESS_BROWSER_FIXTURE_URL),
        actions: ['browser_open_url', 'browser_stop'],
        sourcePointer,
        auditId,
      }),
      runtimeSurface: browserRuntimeSurface(request.customerId, sourcePointer, auditId),
      urlSummary: safeUrlSummary(BUSINESS_BROWSER_FIXTURE_URL),
      sourcePointer,
      auditId,
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
  const sourcePointer = 'local-fixture:business-browser:open-url';
  const auditId = 'fixture-audit-browser-open-url';
  return clone({
    status: 'opened',
    message: `${FIXTURE_LABEL}: Synthetic browser URL opened.`,
    browser: browserView('running', {
      customerId: request.customerId,
      healthSummary: `${FIXTURE_LABEL}: Synthetic browser runtime state with brokered URL action proof.`,
      currentUrlSummary: urlSummary,
      lastActivityAt: NOW,
      sourcePointer,
      auditId,
    }),
    urlSummary,
    runtimeSurface: browserRuntimeSurface(request.customerId, sourcePointer, auditId),
    sourcePointer,
    auditId,
    backendEnforced: true,
  });
}

function browserRuntimeSurface(customerId: string, sourcePointer: string, auditId: string): IEvaosRuntimeSurfaceView {
  return {
    schemaVersion: 'evaos.runtime_surface.v1',
    surfaceId: `fixture-${customerId}-browser`,
    surfaceUri: `evaos-runtime-surface://fixture-${customerId}-browser/`,
    partition: `evaos-runtime-fixture-${customerId}-browser`,
    customerId,
    runtimeKey: 'browser',
    displayLabel: 'Business Browser',
    status: 'attached',
    sourcePointer,
    auditId,
  };
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

const peoplePolicy: IEvaosPeopleAccessPolicyView = {
  schemaVersion: 'evaos.account_policy.v1',
  customerAccountId: CUSTOMER_ACCOUNT_ID,
  selectedCustomerId: CUSTOMER_ID,
  membershipId: MEMBERSHIP_ID,
  membershipRole: 'owner',
  planCode: 'fixture-beta',
  seatLimit: 6,
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

const approvalCenter: IEvaosApprovalCenterView = {
  schemaVersion: 'evaos.approval_center.v1',
  customerId: CUSTOMER_ID,
  customerAccountId: CUSTOMER_ACCOUNT_ID,
  membershipId: MEMBERSHIP_ID,
  membershipRole: 'owner',
  routeDenied: false,
  backendEnforced: true,
  requests: [
    {
      approvalId: 'fixture-approval-email-1',
      ownerId: 'fixture-owner',
      agentId: 'fixture-agent-email',
      requesterMembershipId: 'fixture-member-requester',
      toolName: 'gmail.send',
      riskClass: 'critical',
      destinationPreview: {
        kind: 'email_recipient',
        primary: 'ops-review@example.test',
        secondary: 'Fixture approval request',
        actionable: true,
      },
      destinationProof: {
        kind: 'email_recipient',
        fingerprint: 'fixture-dest-email',
        summary: 'email_recipient: ops-review@example.test',
        source: 'local_fixture',
        sourcePointer: 'local-fixture:approval-center:destination',
      },
      allowAlwaysSupported: true,
      availableDecisions: ['allow-once', 'allow-always', 'deny'],
      canAllowOnce: true,
      canAllowAlways: true,
      canDeny: true,
      createdAt: '2026-06-04T09:40:00.000Z',
      expiresAt: '2026-06-04T10:40:00.000Z',
      sourcePointer: 'local-fixture:approval-center:request:fixture-approval-email-1',
      auditId: 'fixture-audit-approval-request',
      nextAction: 'Critical action. Verify the actual destination before deciding.',
    },
  ],
  summaryText: `${FIXTURE_LABEL}: 1 pending approval request`,
  sourcePointer: 'local-fixture:approval-center:list',
  auditId: 'fixture-audit-approval-list',
  policyAuditId: 'fixture-audit-policy',
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

const offlineBusinessBrowser = browserView('offline', {
  customerId: BROWSER_OFFLINE_CUSTOMER_ID,
  displayLabel: 'Offline Browser Fixture',
  healthSummary: `${FIXTURE_LABEL}: Synthetic browser runtime is offline.`,
  controlSessionActive: false,
  canLaunch: true,
  canOpenUrl: false,
  canStop: false,
  actions: ['browser_launch'],
  sourcePointer: 'local-fixture:business-browser:offline',
  auditId: 'fixture-audit-browser-offline',
});

const failedBusinessBrowser = browserView('failed', {
  customerId: BROWSER_FAILED_CUSTOMER_ID,
  displayLabel: 'Failed Browser Fixture',
  healthSummary: `${FIXTURE_LABEL}: Synthetic browser launch failed safely.`,
  controlSessionActive: false,
  canLaunch: true,
  canOpenUrl: false,
  canStop: false,
  actions: ['browser_launch'],
  sourcePointer: 'local-fixture:business-browser:failed',
  auditId: 'fixture-audit-browser-failed',
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

function businessBrowserToRuntimeStatus(view: IEvaosBusinessBrowserView): IEvaosRuntimeStatusView {
  return {
    schemaVersion: 'evaos.runtime_status.v1',
    customerId: view.customerId,
    customerAccountId: view.customerAccountId,
    runtimeKey: 'browser',
    displayLabel: view.displayLabel,
    status: view.status,
    healthSummary: view.routeDenied ? (view.routeDenialReason ?? view.healthSummary) : view.healthSummary,
    lastCheckedAt: view.lastCheckedAt,
    lastActivityAt: view.lastActivityAt,
    currentUrlSummary: view.currentUrlSummary,
    owner: view.membershipRole,
    authNeeded: view.authNeeded,
    captchaNeeded: view.captchaNeeded,
    waitingOnUser: view.waitingOnUser,
    controlSessionActive: view.controlSessionActive,
    actions: view.actions,
    sourcePointer: view.sourcePointer,
    auditId: view.auditId ?? view.policyAuditId,
  };
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
