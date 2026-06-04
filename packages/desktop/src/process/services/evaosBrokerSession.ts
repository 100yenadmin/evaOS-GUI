/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IEvaosAccountPolicyRole,
  IEvaosAccountPolicyScope,
  IEvaosApprovalCenterRequest,
  IEvaosApprovalCenterView,
  IEvaosApprovalDecisionResult,
  IEvaosApprovalDenyRequest,
  IEvaosApprovalDestinationPreview,
  IEvaosApprovalDestinationProof,
  IEvaosApprovalPreviewKind,
  IEvaosApprovalRequestView,
  IEvaosApprovalRiskClass,
  IEvaosApprovalRuntimeResult,
  IEvaosBusinessBrowserActionResult,
  IEvaosBusinessBrowserOpenUrlRequest,
  IEvaosBusinessBrowserRequest,
  IEvaosBusinessBrowserView,
  IEvaosBrokerSessionStatus,
  IEvaosCompanyBrainAccount360View,
  IEvaosCompanyBrainAccountRequest,
  IEvaosCompanyBrainAccountSummaryView,
  IEvaosCompanyBrainBriefView,
  IEvaosCompanyBrainCitationView,
  IEvaosCompanyBrainDirectoryRequest,
  IEvaosCompanyBrainDirectoryView,
  IEvaosCompanyBrainExceptionSeverity,
  IEvaosCompanyBrainExceptionView,
  IEvaosCompanyBrainIngestionState,
  IEvaosCompanyBrainIntegrationHealthView,
  IEvaosCompanyBrainQueryRequest,
  IEvaosCompanyBrainQueryResult,
  IEvaosCompanyBrainTimelineEntryView,
  IEvaosPeopleAccessInviteMemberRequest,
  IEvaosPeopleAccessInviteView,
  IEvaosPeopleAccessMemberView,
  IEvaosPeopleAccessMutationResult,
  IEvaosPeopleAccessPolicyRequest,
  IEvaosPeopleAccessPolicyView,
  IEvaosProviderActionRequest,
  IEvaosProviderActionResult,
  IEvaosProviderAgentRuntime,
  IEvaosProviderHubRequest,
  IEvaosProviderHubView,
  IEvaosProviderKey,
  IEvaosProviderProfileView,
  IEvaosProviderStatus,
  IEvaosRuntimeKey,
  IEvaosRuntimeStatusRequest,
  IEvaosRuntimeStatusView,
  IEvaosSafeUrlSummary,
} from '@/common/adapter/ipcBridge';
import { createHash } from 'crypto';

export const EVAOS_DESKTOP_RUNTIME_SESSION_ENDPOINT =
  'https://rhfojelkgtwcxnrfhtlj.supabase.co/functions/v1/desktop-runtime-session';

const VALID_RUNTIME_KEYS: ReadonlySet<IEvaosRuntimeKey> = new Set([
  'openclaw',
  'hermes',
  'paperclip',
  'browser',
  'terminal',
  'opendesign',
  'creative_studio',
]);

const RUNTIME_LABELS: Record<IEvaosRuntimeKey, string> = {
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  paperclip: 'Paperclip',
  browser: 'Business Browser',
  terminal: 'Terminal',
  opendesign: 'Open Design',
  creative_studio: 'Creative Studio',
};

const VALID_PROVIDER_KEYS: ReadonlySet<IEvaosProviderKey> = new Set([
  'openai_codex',
  'openclaw',
  'hermes',
  'google_workspace',
  'pipedream',
  'slack',
  'notion',
  'linear',
  'github',
]);

const PROVIDER_LABELS: Record<IEvaosProviderKey, string> = {
  openai_codex: 'Codex Desktop',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  google_workspace: 'Google Workspace',
  pipedream: 'Pipedream Connection Service',
  slack: 'Slack',
  notion: 'Notion',
  linear: 'Linear',
  github: 'GitHub',
};

const VALID_PROVIDER_STATUSES: ReadonlySet<IEvaosProviderStatus> = new Set([
  'connected',
  'needs_login',
  'approval_required',
  'planned',
  'revoked',
  'expired',
  'error',
]);

const VALID_PROVIDER_AGENT_RUNTIMES: ReadonlySet<IEvaosProviderAgentRuntime> = new Set(['openclaw', 'hermes']);
const PROVIDER_CONNECTION_PROOF_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BUSINESS_BROWSER_DEFAULT_URL = 'https://chatgpt.com/codex';

const SECRET_FIELD_PATTERN =
  /(authorization|bearer|token|secret|password|credential|desktop[_-]?session|access[_-]?token|refresh[_-]?token|api[_-]?key|service[_-]?role|provider[_-]?grant|grant[_-]?handle)/i;
const SECRET_VALUE_PATTERNS = [
  /\beds_[A-Za-z0-9_-]{8,}\b/,
  /\bepg_[A-Za-z0-9_-]{8,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/i,
  /\bsk_(?:live|test)_[A-Za-z0-9]{8,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\b(?:rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b/,
  /\bgh[opusr]_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bglpat-[A-Za-z0-9_-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
];
const MAX_SAFE_TEXT_LENGTH = 500;

export type EvaosBrokerErrorCode =
  | 'missing_session'
  | 'expired_session'
  | 'invalid_device_code'
  | 'invalid_approval'
  | 'invalid_browser_url'
  | 'invalid_company_brain_account'
  | 'invalid_company_brain_query'
  | 'invalid_customer'
  | 'invalid_email'
  | 'invalid_role'
  | 'invalid_runtime'
  | 'invalid_provider'
  | 'action_denied'
  | 'broker_http_error'
  | 'broker_invalid_response'
  | 'broker_network_error';

export class EvaosBrokerSessionError extends Error {
  readonly code: EvaosBrokerErrorCode;
  readonly status?: number;

  constructor(code: EvaosBrokerErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'EvaosBrokerSessionError';
    this.code = code;
    this.status = status;
  }
}

export interface EvaosDesktopSession {
  accessToken: string;
  userEmail?: string;
  expiresAt?: string;
  source?: 'environment' | 'memory';
}

export type EvaosBrokerFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface EvaosBrokerSessionClientOptions {
  endpoint?: string;
  fetchImpl?: EvaosBrokerFetch;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

interface DesktopSessionClaimResponse {
  desktop_session?: unknown;
  desktop_session_expires_at?: unknown;
  expires_at?: unknown;
  email?: unknown;
}

let defaultClient: EvaosBrokerSessionClient | null = null;

export class EvaosBrokerSessionClient {
  private readonly endpoint: string;
  private readonly fetchImpl: EvaosBrokerFetch;
  private readonly now: () => Date;
  private session: EvaosDesktopSession | null;

  constructor(options: EvaosBrokerSessionClientOptions = {}) {
    this.endpoint = normalizeEndpoint(options.endpoint ?? process.env.AIONUI_EVAOS_BROKER_ENDPOINT);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.session = loadSessionFromEnvironment(options.env ?? process.env);
  }

  getSessionStatus(): IEvaosBrokerSessionStatus {
    return sessionStatus(this.session, this.now());
  }

  async claimDeviceCode(deviceCode: string): Promise<IEvaosBrokerSessionStatus> {
    const normalizedCode = normalizeDeviceCode(deviceCode);
    if (!normalizedCode) {
      throw new EvaosBrokerSessionError(
        'invalid_device_code',
        'Enter the evaOS device code from the browser sign-in page.'
      );
    }

    const raw = (await this.postJson({
      action: 'claim_desktop_device_code',
      device_code: normalizedCode,
    })) as DesktopSessionClaimResponse;

    const accessToken = safeRawSecret(raw.desktop_session);
    const expiresAt = safeIsoDate(raw.desktop_session_expires_at ?? raw.expires_at);
    if (!accessToken || !expiresAt) {
      throw new EvaosBrokerSessionError(
        'broker_invalid_response',
        'The evaOS broker did not return a usable desktop session.'
      );
    }

    this.session = {
      accessToken,
      userEmail: safeText(raw.email),
      expiresAt,
      source: 'memory',
    };

    return this.getSessionStatus();
  }

  async runtimeStatus(request: IEvaosRuntimeStatusRequest): Promise<IEvaosRuntimeStatusView> {
    const customerId = normalizeRequiredText(
      request.customerId,
      'invalid_customer',
      'Choose a customer before checking runtime status.'
    );
    const runtime = normalizeRuntime(request.runtime);
    const session = this.requireActiveSession();

    const raw = (await this.postJson(
      {
        action: 'runtime_status',
        customer_id: customerId,
        runtime,
      },
      session
    )) as unknown;

    return sanitizeRuntimeStatus(raw, { customerId, runtime });
  }

  async peopleAccessPolicy(request: IEvaosPeopleAccessPolicyRequest): Promise<IEvaosPeopleAccessPolicyView> {
    const customerId = normalizeRequiredText(
      request.customerId,
      'invalid_customer',
      'Choose a customer before loading People Access.'
    );
    const session = this.requireActiveSession();

    const [accountRaw, permissionsRaw] = await Promise.all([
      this.postJson(
        {
          action: 'current_customer_account',
          customer_id: customerId,
        },
        session
      ),
      this.postJson(
        {
          action: 'current_customer_account_permissions',
          customer_id: customerId,
        },
        session
      ),
    ]);

    return sanitizePeopleAccessPolicy(accountRaw, permissionsRaw, customerId);
  }

  async invitePeopleAccessMember(
    request: IEvaosPeopleAccessInviteMemberRequest
  ): Promise<IEvaosPeopleAccessMutationResult> {
    const customerId = normalizeRequiredText(
      request.customerId,
      'invalid_customer',
      'Choose a customer before inviting a member.'
    );
    const email = normalizeEmail(request.email);
    const role = normalizeInviteRole(request.role);
    const seatType = safeText(request.seatType, 80);
    const session = this.requireActiveSession();

    const policy = await this.peopleAccessPolicy({ customerId });
    assertPolicyScope(policy, 'manage_members', 'You do not have permission to invite members for this account.');
    assertPeopleAccessPolicyProof(policy);

    const raw = await this.postJson(
      stripUndefined({
        action: 'invite_customer_account_member',
        customer_id: customerId,
        email,
        role,
        seat_type: seatType,
      }),
      session
    );

    return sanitizePeopleAccessMutationResult(raw);
  }

  async approvalCenter(request: IEvaosApprovalCenterRequest): Promise<IEvaosApprovalCenterView> {
    const customerId = normalizeRequiredText(
      request.customerId,
      'invalid_customer',
      'Choose a customer before loading Approval Center.'
    );
    const limit = safeApprovalLimit(request.limit);
    const session = this.requireActiveSession();
    const policy = await this.peopleAccessPolicy({ customerId });

    if (!policy.scopes.includes('approve_actions')) {
      return {
        schemaVersion: 'evaos.approval_center.v1',
        customerId,
        customerAccountId: policy.customerAccountId,
        membershipId: policy.membershipId,
        membershipRole: policy.membershipRole,
        routeDenied: true,
        routeDenialReason: 'Approval Center requires the approve_actions scope for this customer account.',
        backendEnforced: policy.backendEnforced,
        requests: [],
        summaryText: 'Approval Center denied by account policy',
        policyAuditId: policy.auditId,
      };
    }
    if (policy.backendEnforced !== true || !policy.auditId) {
      return {
        schemaVersion: 'evaos.approval_center.v1',
        customerId,
        customerAccountId: policy.customerAccountId,
        membershipId: policy.membershipId,
        membershipRole: policy.membershipRole,
        routeDenied: true,
        routeDenialReason: 'Approval Center requires backend-enforced account policy proof.',
        backendEnforced: policy.backendEnforced,
        requests: [],
        summaryText: 'Approval Center denied until backend policy proof is available',
        policyAuditId: policy.auditId,
      };
    }

    const raw = await this.postJson(
      {
        action: 'provider_approval_requests',
        customer_id: customerId,
        limit,
      },
      session
    );

    return sanitizeApprovalCenter(raw, policy, customerId);
  }

  async denyApproval(request: IEvaosApprovalDenyRequest): Promise<IEvaosApprovalDecisionResult> {
    const customerId = normalizeRequiredText(
      request.customerId,
      'invalid_customer',
      'Choose a customer before denying an approval.'
    );
    const approvalId = normalizeApprovalId(request.approvalId);
    const reason = safeText(request.reason, 220);
    const session = this.requireActiveSession();

    const policy = await this.peopleAccessPolicy({ customerId });
    assertPolicyScope(policy, 'approve_actions', 'You do not have permission to deny approvals for this account.');
    assertApprovalPolicyProof(policy);

    const approvalRaw = await this.postJson(
      {
        action: 'provider_approval_request',
        customer_id: customerId,
        approval_id: approvalId,
      },
      session
    );
    const approval = sanitizeSingleApprovalRequest(approvalRaw);
    if (!approval) {
      throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
    }

    if (!policy.membershipId || !approval.requesterMembershipId) {
      throw new EvaosBrokerSessionError(
        'action_denied',
        'Approval requester and approver evidence is required before denying.'
      );
    }

    if (approval.requesterMembershipId === policy.membershipId) {
      throw new EvaosBrokerSessionError('action_denied', 'Requesters cannot deny their own approval requests.');
    }

    const raw = await this.postJson(
      stripUndefined({
        action: 'provider_approval_decide',
        customer_id: customerId,
        approval_id: approvalId,
        decision: 'deny',
        scope: 'this-call',
        destination_proof: toBrokerApprovalDestinationProof(approval.destinationProof),
        request_source_pointer: approval.sourcePointer,
        request_audit_id: approval.auditId,
        reason,
      }),
      session
    );

    return sanitizeApprovalDecisionResult(raw, approval);
  }

  async providerHub(request: IEvaosProviderHubRequest): Promise<IEvaosProviderHubView> {
    const customerId = normalizeRequiredText(
      request.customerId,
      'invalid_customer',
      'Choose a customer before loading Connected Apps.'
    );
    const session = this.requireActiveSession();
    const policy = await this.peopleAccessPolicy({ customerId });

    if (!policy.scopes.includes('manage_integrations')) {
      return {
        schemaVersion: 'evaos.provider_hub.v1',
        customerId,
        customerAccountId: policy.customerAccountId,
        membershipId: policy.membershipId,
        membershipRole: policy.membershipRole,
        routeDenied: true,
        routeDenialReason: 'Connected Apps requires the manage_integrations scope for this customer account.',
        backendEnforced: policy.backendEnforced,
        profiles: [],
        summaryText: 'Connected Apps denied by account policy',
        policyAuditId: policy.auditId,
      };
    }

    const raw = await this.postJson(
      {
        action: 'provider_profiles',
        customer_id: customerId,
      },
      session
    );

    return sanitizeProviderHub(raw, policy, customerId);
  }

  async businessBrowserStatus(request: IEvaosBusinessBrowserRequest): Promise<IEvaosBusinessBrowserView> {
    const customerId = normalizeRequiredText(
      request.customerId,
      'invalid_customer',
      'Choose a customer before loading Business Browser.'
    );
    const session = this.requireActiveSession();
    const policy = await this.peopleAccessPolicy({ customerId });

    if (!policy.scopes.includes('open_business_browser')) {
      return businessBrowserDeniedView(policy, customerId);
    }

    const raw = await this.postJson(
      {
        action: 'runtime_status',
        customer_id: customerId,
        runtime: 'browser',
      },
      session
    );
    const runtime = sanitizeBusinessBrowserRuntimeStatus(raw, policy, customerId);
    return businessBrowserViewFromRuntime(runtime, policy, customerId);
  }

  async launchBusinessBrowser(request: IEvaosBusinessBrowserRequest): Promise<IEvaosBusinessBrowserActionResult> {
    return this.businessBrowserAction(request, 'browser_open_url', BUSINESS_BROWSER_DEFAULT_URL);
  }

  async openBusinessBrowserUrl(
    request: IEvaosBusinessBrowserOpenUrlRequest
  ): Promise<IEvaosBusinessBrowserActionResult> {
    return this.businessBrowserAction(request, 'browser_open_url', normalizeBusinessBrowserUrl(request.url));
  }

  async stopBusinessBrowser(request: IEvaosBusinessBrowserRequest): Promise<IEvaosBusinessBrowserActionResult> {
    return this.businessBrowserAction(request, 'browser_stop');
  }

  async companyBrainDirectory(request: IEvaosCompanyBrainDirectoryRequest): Promise<IEvaosCompanyBrainDirectoryView> {
    const customerId = normalizeRequiredText(
      request.customerId,
      'invalid_customer',
      'Choose a customer before loading Company Brain.'
    );
    const session = this.requireActiveSession();
    const policy = await this.peopleAccessPolicy({ customerId });
    assertCompanyBrainPolicyProof(policy);

    if (!policy.scopes.includes('view_company_brain')) {
      return companyBrainDeniedDirectoryView(policy, customerId);
    }

    const raw = await this.postJson(
      {
        action: 'company_brain_directory',
        customer_id: customerId,
      },
      session
    );

    return sanitizeCompanyBrainDirectory(raw, policy, customerId);
  }

  async companyBrainAccount360(request: IEvaosCompanyBrainAccountRequest): Promise<IEvaosCompanyBrainAccount360View> {
    const customerId = normalizeRequiredText(
      request.customerId,
      'invalid_customer',
      'Choose a customer before loading Company Brain.'
    );
    const accountId = normalizeCompanyBrainAccountId(request.accountId);
    const session = this.requireActiveSession();
    const policy = await this.peopleAccessPolicy({ customerId });
    assertPolicyScope(
      policy,
      'view_company_brain',
      'You do not have permission to view Company Brain for this account.'
    );
    assertCompanyBrainPolicyProof(policy);

    const raw = await this.postJson(
      {
        action: 'company_brain_account_360',
        customer_id: customerId,
        account_id: accountId,
      },
      session
    );

    return sanitizeCompanyBrainAccount360(raw, { accountId, customerId, policy });
  }

  async companyBrainQuery(request: IEvaosCompanyBrainQueryRequest): Promise<IEvaosCompanyBrainQueryResult> {
    const customerId = normalizeRequiredText(
      request.customerId,
      'invalid_customer',
      'Choose a customer before querying Company Brain.'
    );
    const accountId = normalizeCompanyBrainAccountId(request.accountId);
    const query = normalizeCompanyBrainQuery(request.query);
    const session = this.requireActiveSession();
    const policy = await this.peopleAccessPolicy({ customerId });
    assertPolicyScope(
      policy,
      'view_company_brain',
      'You do not have permission to query Company Brain for this account.'
    );
    assertCompanyBrainPolicyProof(policy);

    const raw = await this.postJson(
      {
        action: 'company_brain_query',
        customer_id: customerId,
        account_id: accountId,
        query,
      },
      session
    );

    return sanitizeCompanyBrainQuery(raw, { accountId, customerId, policy });
  }

  async startProviderAuth(request: IEvaosProviderActionRequest): Promise<IEvaosProviderActionResult> {
    return this.providerAction(request, 'provider_auth_start');
  }

  async switchProvider(request: IEvaosProviderActionRequest): Promise<IEvaosProviderActionResult> {
    return this.providerAction(request, 'provider_switch');
  }

  async revokeProvider(request: IEvaosProviderActionRequest): Promise<IEvaosProviderActionResult> {
    return this.providerAction(request, 'provider_revoke');
  }

  async mintProviderGrant(request: IEvaosProviderActionRequest): Promise<IEvaosProviderActionResult> {
    return this.providerAction(request, 'provider_mint_grant');
  }

  async revokeSession(): Promise<IEvaosBrokerSessionStatus> {
    const session = this.session;
    this.session = null;

    if (session && !isSessionExpired(session, this.now())) {
      await this.postJson({ action: 'revoke_desktop_session' }, session).catch((): void => undefined);
    }

    return this.getSessionStatus();
  }

  private requireActiveSession(): EvaosDesktopSession {
    if (!this.session) {
      throw new EvaosBrokerSessionError('missing_session', 'Sign in to evaOS before checking runtime status.');
    }

    if (isSessionExpired(this.session, this.now())) {
      throw new EvaosBrokerSessionError('expired_session', 'Your evaOS desktop session has expired. Sign in again.');
    }

    return this.session;
  }

  private async postJson(body: Record<string, unknown>, session?: EvaosDesktopSession): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (session) {
      headers.Authorization = `Bearer ${session.accessToken}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch {
      throw new EvaosBrokerSessionError('broker_network_error', 'The evaOS broker could not be reached.');
    }

    if (!response.ok) {
      throw new EvaosBrokerSessionError('broker_http_error', brokerHttpMessage(response.status), response.status);
    }

    try {
      return await response.json();
    } catch {
      throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
    }
  }

  private async providerAction(
    request: IEvaosProviderActionRequest,
    action: 'provider_auth_start' | 'provider_switch' | 'provider_revoke' | 'provider_mint_grant'
  ): Promise<IEvaosProviderActionResult> {
    const customerId = normalizeRequiredText(
      request.customerId,
      'invalid_customer',
      'Choose a customer before changing Connected Apps.'
    );
    const providerKey = normalizeProviderKey(request.providerKey);
    const agentRuntime =
      action === 'provider_mint_grant' ? normalizeProviderAgentRuntime(request.agentRuntime ?? 'openclaw') : undefined;
    const session = this.requireActiveSession();
    const policy = await this.peopleAccessPolicy({ customerId });
    assertPolicyScope(
      policy,
      'manage_integrations',
      'You do not have permission to manage connected apps for this account.'
    );
    assertProviderPolicyProof(policy);

    if (action === 'provider_switch' || action === 'provider_mint_grant') {
      const currentHub = await this.loadProviderHubWithPolicy(customerId, policy, session);
      const profile = currentHub.profiles.find((item) => item.providerKey === providerKey);
      if (
        !profile ||
        profile.status !== 'connected' ||
        profile.rawSecretsStoredInWorkbench ||
        !profile.hasConnectionProof ||
        !hasFreshProviderConnectionProof(profile, this.now())
      ) {
        throw new EvaosBrokerSessionError(
          'action_denied',
          'Connected app action denied until the broker returns a valid connected profile.'
        );
      }
    }

    const raw = await this.postJson(
      stripUndefined({
        action,
        customer_id: customerId,
        provider_key: providerKey,
        agent_runtime: agentRuntime,
      }),
      session
    );

    return sanitizeProviderActionResult(raw, { action, customerId, providerKey, policy });
  }

  private async loadProviderHubWithPolicy(
    customerId: string,
    policy: IEvaosPeopleAccessPolicyView,
    session: EvaosDesktopSession
  ): Promise<IEvaosProviderHubView> {
    const raw = await this.postJson(
      {
        action: 'provider_profiles',
        customer_id: customerId,
      },
      session
    );
    return sanitizeProviderHub(raw, policy, customerId);
  }

  private async businessBrowserAction(
    request: IEvaosBusinessBrowserRequest,
    action: 'browser_open_url' | 'browser_stop',
    url?: string
  ): Promise<IEvaosBusinessBrowserActionResult> {
    const customerId = normalizeRequiredText(
      request.customerId,
      'invalid_customer',
      'Choose a customer before controlling Business Browser.'
    );
    const session = this.requireActiveSession();
    const policy = await this.peopleAccessPolicy({ customerId });
    assertPolicyScope(
      policy,
      'open_business_browser',
      'You do not have permission to control Business Browser for this account.'
    );
    assertBusinessBrowserPolicyProof(policy);

    const raw = await this.postJson(
      stripUndefined({
        action,
        customer_id: customerId,
        url,
      }),
      session
    );

    return sanitizeBusinessBrowserActionResult(raw, { action, customerId, policy, url });
  }
}

export function getDefaultEvaosBrokerSessionClient(): EvaosBrokerSessionClient {
  if (!defaultClient) {
    defaultClient = new EvaosBrokerSessionClient();
  }
  return defaultClient;
}

export function resetDefaultEvaosBrokerSessionClientForTests(): void {
  defaultClient = null;
}

export function evaosBrokerErrorMessage(error: unknown): string {
  if (error instanceof EvaosBrokerSessionError) {
    return error.message;
  }
  return 'The evaOS broker request failed safely.';
}

export function containsEvaosSecretMaterial(value: string): boolean {
  return containsSecretMaterial(value);
}

export function isEvaosBrokerSessionError(error: unknown): error is EvaosBrokerSessionError {
  return error instanceof EvaosBrokerSessionError;
}

function normalizeEndpoint(endpoint: string | undefined): string {
  const trimmed = endpoint?.trim();
  return trimmed || EVAOS_DESKTOP_RUNTIME_SESSION_ENDPOINT;
}

function normalizeDeviceCode(value: string): string {
  return value
    .toUpperCase()
    .split('')
    .filter((char) => /[A-Z0-9]/.test(char))
    .join('')
    .slice(0, 80);
}

function normalizeRuntime(runtime: IEvaosRuntimeKey): IEvaosRuntimeKey {
  if (VALID_RUNTIME_KEYS.has(runtime)) {
    return runtime;
  }
  throw new EvaosBrokerSessionError('invalid_runtime', 'Choose a supported evaOS runtime.');
}

function normalizeProviderKey(providerKey: IEvaosProviderKey): IEvaosProviderKey {
  if (VALID_PROVIDER_KEYS.has(providerKey)) {
    return providerKey;
  }
  throw new EvaosBrokerSessionError('invalid_provider', 'Choose a supported connected app.');
}

function normalizeRequiredText(value: string, code: EvaosBrokerErrorCode, message: string): string {
  const safe = safeText(value);
  if (!safe) {
    throw new EvaosBrokerSessionError(code, message);
  }
  return safe;
}

function sessionStatus(session: EvaosDesktopSession | null, now: Date): IEvaosBrokerSessionStatus {
  if (!session) {
    return {
      state: 'missing',
      authenticated: false,
      expired: false,
      source: 'none',
      message: 'Sign in to evaOS to connect this desktop shell.',
    };
  }

  const expired = isSessionExpired(session, now);
  return {
    state: expired ? 'expired' : 'authenticated',
    authenticated: !expired,
    expired,
    userEmail: safeText(session.userEmail),
    expiresAt: safeIsoDate(session.expiresAt),
    source: session.source ?? 'memory',
    message: expired ? 'Your evaOS desktop session has expired. Sign in again.' : 'evaOS desktop session is active.',
  };
}

function loadSessionFromEnvironment(env: Record<string, string | undefined>): EvaosDesktopSession | null {
  const accessToken = safeRawSecret(env.AIONUI_EVAOS_DESKTOP_SESSION);
  if (!accessToken) {
    return null;
  }

  return {
    accessToken,
    userEmail: safeText(env.AIONUI_EVAOS_DESKTOP_SESSION_EMAIL),
    expiresAt: safeIsoDate(env.AIONUI_EVAOS_DESKTOP_SESSION_EXPIRES_AT),
    source: 'environment',
  };
}

function isSessionExpired(session: EvaosDesktopSession, now: Date): boolean {
  const expiresAt = safeIsoDate(session.expiresAt);
  if (!expiresAt) {
    return true;
  }
  return Date.parse(expiresAt) <= now.getTime();
}

function sanitizeRuntimeStatus(
  raw: unknown,
  fallback: { customerId: string; runtime: IEvaosRuntimeKey }
): IEvaosRuntimeStatusView {
  const record = asRecord(raw);
  if (!record) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }

  const runtime = normalizeRuntimeValue(record.runtime_key) ?? normalizeRuntimeValue(record.runtime);
  const status = safeText(record.status);
  if (!runtime || !status) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }

  const displayLabel = safeText(record.display_label) ?? RUNTIME_LABELS[runtime];
  const customerId = safeText(record.customer_id) ?? fallback.customerId;

  return stripUndefined({
    schemaVersion: safeText(record.schema_version),
    customerAccountId: safeText(record.customer_account_id),
    customerId,
    runtimeKey: runtime,
    displayLabel,
    status,
    healthSummary: safeText(record.health_summary),
    lastCheckedAt: safeIsoDate(record.last_checked_at),
    roomId: safeText(record.room_id),
    currentUrlSummary: summarizeUrl(record.current_url),
    owner: safeText(record.owner),
    authNeeded: safeBoolean(record.auth_needed ?? record.needs_auth),
    captchaNeeded: safeBoolean(record.captcha_needed ?? record.needs_captcha),
    waitingOnUser: safeBoolean(record.waiting_on_user),
    controlSessionActive: safeBoolean(record.control_session_active),
    updateAvailable: safeBoolean(record.update_available),
    lastActivityAt: safeIsoDate(record.last_activity_at),
    actions: safeActionList(record.actions),
    sourcePointer: safeText(record.source_pointer),
    auditId: safeText(record.audit_id),
  });
}

const ACCOUNT_POLICY_SCHEMA_VERSION: IEvaosPeopleAccessPolicyView['schemaVersion'] = 'evaos.account_policy.v1';
const PEOPLE_ACCESS_ROUTE_SCOPE: IEvaosAccountPolicyScope = 'manage_members';

const VALID_ACCOUNT_ROLES: ReadonlySet<IEvaosAccountPolicyRole> = new Set([
  'owner',
  'admin',
  'billing_admin',
  'technical_admin',
  'manager',
  'member',
  'agent_only',
  'support',
]);

const VALID_INVITE_ROLES: ReadonlySet<IEvaosAccountPolicyRole> = new Set([
  'admin',
  'billing_admin',
  'technical_admin',
  'manager',
  'member',
  'agent_only',
  'support',
]);

const VALID_POLICY_SCOPES: ReadonlySet<IEvaosAccountPolicyScope> = new Set([
  'manage_members',
  'manage_billing',
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
]);

const APPROVAL_PAYLOAD_ALLOWLIST: ReadonlySet<string> = new Set([
  'actual_recipient_email',
  'recipient_email',
  'subject',
  'actual_recipient_id',
  'actual_channel_id',
  'recipient_id',
  'channel_id',
  'actual_url',
  'target_url',
  'url',
  'actual_file_path',
  'file_path',
  'delete_path',
  'export_destination',
  'merchant',
  'payment_target',
  'actual_payment_target',
  'amount',
  'amount_text',
  'cap',
  'secret_name',
  'secret_id',
  'budget_cap',
  'scope',
  'budget_scope',
  'permission',
  'permission_scope',
]);

function sanitizePeopleAccessPolicy(
  accountRaw: unknown,
  permissionsRaw: unknown,
  fallbackCustomerId: string
): IEvaosPeopleAccessPolicyView {
  const account = asRecord(accountRaw);
  const permissions = asRecord(permissionsRaw);
  if (!account || !permissions) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }

  const schemaVersion = safeText(permissions.schema_version ?? account.schema_version);
  const customerAccountId = safeText(permissions.customer_account_id ?? account.customer_account_id ?? account.id);
  const selectedCustomerId =
    safeText(permissions.selected_customer_id ?? permissions.customer_id ?? account.selected_customer_id) ??
    fallbackCustomerId;
  const membershipRole = normalizeAccountRoleValue(
    permissions.membership_role ?? permissions.role ?? account.membership_role
  );
  const scopes = safePolicyScopeList(permissions.scopes);

  if (
    schemaVersion !== ACCOUNT_POLICY_SCHEMA_VERSION ||
    !customerAccountId ||
    !selectedCustomerId ||
    !membershipRole ||
    !scopes
  ) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }

  const routeDenied = !scopes.includes(PEOPLE_ACCESS_ROUTE_SCOPE);
  const advancedSurfaces = safeBooleanMap(permissions.advanced_surfaces);

  return stripUndefined({
    schemaVersion: ACCOUNT_POLICY_SCHEMA_VERSION,
    customerAccountId,
    selectedCustomerId,
    membershipId: safeText(permissions.membership_id ?? account.membership_id),
    membershipRole,
    planCode: safeText(permissions.plan_code ?? account.plan_code),
    seatLimit: safeNonNegativeInteger(permissions.seat_limit ?? account.seat_limit),
    activeSeats: safeNonNegativeInteger(permissions.active_seats ?? account.active_seats),
    invitedSeats: safeNonNegativeInteger(permissions.invited_seats ?? account.invited_seats),
    scopes,
    advancedSurfaces,
    members: safePeopleAccessMembers(account.members ?? account.customer_account_memberships),
    invites: safePeopleAccessInvites(account.invites ?? account.invitations),
    routeDenied,
    routeDenialReason: routeDenied
      ? 'People Access requires the manage_members scope for this customer account.'
      : undefined,
    backendEnforced: safeBoolean(permissions.backend_enforced) ?? false,
    updatedAt: safeIsoDate(permissions.updated_at ?? account.updated_at),
    auditId: safeText(permissions.audit_id ?? account.audit_id),
  });
}

function sanitizePeopleAccessMutationResult(raw: unknown): IEvaosPeopleAccessMutationResult {
  const record = asRecord(raw);
  if (!record) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }

  const status = safeText(record.status);
  const backendEnforced = safeBoolean(record.backend_enforced);
  if (!status || backendEnforced !== true) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }

  return stripUndefined({
    status,
    message: safeText(record.message),
    inviteId: safeText(record.invite_id ?? record.invitation_id ?? record.id),
    memberId: safeText(record.member_id ?? record.membership_id),
    auditId: safeText(record.audit_id),
    backendEnforced,
  });
}

function sanitizeApprovalCenter(
  raw: unknown,
  policy: IEvaosPeopleAccessPolicyView,
  fallbackCustomerId: string
): IEvaosApprovalCenterView {
  const record = asRecord(raw);
  const source = record ? (record.requests ?? record.approvals ?? record.pending) : raw;
  if (!record || !Array.isArray(source)) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }
  const customerId = safeText(record.customer_id);
  const sourcePointer = safeText(record.source_pointer);
  const auditId = safeText(record.audit_id);
  const backendEnforced = safeBoolean(record.backend_enforced);
  if (backendEnforced !== true || !sourcePointer || !auditId || customerId !== fallbackCustomerId) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker did not return approval-list enforcement proof.'
    );
  }
  const requests = safeApprovalRequests(source);
  const summaryText = requests.length === 0 ? 'No pending approvals' : `${requests.length} pending approvals`;

  return stripUndefined({
    schemaVersion: 'evaos.approval_center.v1' as const,
    customerId,
    customerAccountId: policy.customerAccountId,
    membershipId: policy.membershipId,
    membershipRole: policy.membershipRole,
    routeDenied: false,
    backendEnforced,
    requests,
    summaryText,
    sourcePointer,
    auditId,
    policyAuditId: policy.auditId,
  });
}

function sanitizeApprovalDecisionResult(
  raw: unknown,
  fallbackRequest: IEvaosApprovalRequestView
): IEvaosApprovalDecisionResult {
  const record = asRecord(raw);
  if (!record) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }

  const status = safeText(record.status);
  if (!status || !isDeniedApprovalStatus(status)) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }
  const request = sanitizeSingleApprovalRequest(record.request ?? record.approval ?? record.resolved_request);
  const approvalId = safeText(record.approval_id ?? record.id) ?? request?.approvalId;
  const runtimeResult = sanitizeApprovalRuntimeResult(record.runtime_result ?? record.result);
  const sourcePointer = safeText(record.source_pointer) ?? runtimeResult?.sourcePointer;
  const auditId = safeText(record.audit_id) ?? runtimeResult?.auditId;
  const backendEnforced = safeBoolean(record.backend_enforced);
  if (
    approvalId !== fallbackRequest.approvalId ||
    !runtimeResult ||
    !isDeniedApprovalStatus(runtimeResult.status) ||
    !runtimeResult.sourcePointer ||
    !runtimeResult.auditId ||
    !sourcePointer ||
    !auditId ||
    backendEnforced !== true
  ) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker did not return deny enforcement proof.'
    );
  }

  return stripUndefined({
    status,
    decision: 'deny' as const,
    scope: 'this-call' as const,
    approvalId,
    request: request ?? fallbackRequest,
    runtimeResult,
    sourcePointer,
    auditId,
    backendEnforced,
  });
}

function sanitizeProviderHub(
  raw: unknown,
  policy: IEvaosPeopleAccessPolicyView,
  fallbackCustomerId: string
): IEvaosProviderHubView {
  const record = asRecord(raw);
  const source = Array.isArray(raw) ? raw : (record?.provider_profiles ?? record?.profiles ?? record?.providers);
  if (!Array.isArray(source)) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }

  const responseCustomerId = safeText(record?.customer_id);
  assertCustomerScopeMatches(responseCustomerId, policy, fallbackCustomerId, 'provider profile');

  const profiles = safeProviderProfiles(source, policy.customerAccountId);
  const backendEnforced = safeBoolean(record?.backend_enforced);
  const sourcePointer = safeText(record?.source_pointer);
  const auditId = safeText(record?.audit_id);
  if (backendEnforced !== true || !sourcePointer || !auditId) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker did not return provider profile enforcement proof.'
    );
  }
  const connectedCount = profiles.filter(
    (profile) => profile.status === 'connected' && profile.hasConnectionProof
  ).length;
  const needsAttentionCount = profiles.filter(
    (profile) =>
      profile.approvalRequired ||
      profile.rawSecretsStoredInWorkbench ||
      profile.status === 'approval_required' ||
      profile.status === 'needs_login' ||
      profile.status === 'expired' ||
      profile.status === 'error'
  ).length;

  return stripUndefined({
    schemaVersion: 'evaos.provider_hub.v1' as const,
    customerId: responseCustomerId ?? policy.selectedCustomerId ?? fallbackCustomerId,
    customerAccountId: policy.customerAccountId,
    membershipId: policy.membershipId,
    membershipRole: policy.membershipRole,
    routeDenied: false,
    backendEnforced,
    activeProviderKey: normalizeProviderKeyValue(record?.active_provider_key ?? record?.active_provider),
    profiles,
    summaryText:
      profiles.length === 0
        ? 'No connected app evidence returned'
        : `${connectedCount} ready, ${needsAttentionCount} need attention`,
    sourcePointer,
    auditId,
    policyAuditId: policy.auditId,
  });
}

function sanitizeProviderActionResult(
  raw: unknown,
  fallback: {
    action: 'provider_auth_start' | 'provider_switch' | 'provider_revoke' | 'provider_mint_grant';
    customerId: string;
    providerKey: IEvaosProviderKey;
    policy: IEvaosPeopleAccessPolicyView;
  }
): IEvaosProviderActionResult {
  const record = asRecord(raw);
  if (!record) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }

  const status = safeText(record.status);
  const providerKey =
    normalizeProviderKeyValue(record.provider_key ?? record.provider ?? record.key) ?? fallback.providerKey;
  const backendEnforced = safeBoolean(record.backend_enforced);
  const hasProfiles = Array.isArray(record.provider_profiles ?? record.profiles ?? record.providers);
  const providerHub = hasProfiles ? sanitizeProviderHub(record, fallback.policy, fallback.customerId) : undefined;
  const sourcePointer = safeProviderActionSourcePointer(record.source_pointer, fallback.action, providerKey);
  const auditId = safeText(record.audit_id);

  if (!status || backendEnforced !== true || !sourcePointer || !auditId) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker did not return provider action enforcement proof.'
    );
  }

  return stripUndefined({
    status,
    providerKey,
    message: safeText(record.message),
    authUrlSummary: summarizeUrl(record.connect_url ?? record.target_url),
    expiresAt: safeIsoDate(record.expires_at),
    providerHub,
    sourcePointer,
    auditId,
    backendEnforced,
  });
}

function businessBrowserDeniedView(
  policy: IEvaosPeopleAccessPolicyView,
  customerId: string
): IEvaosBusinessBrowserView {
  return stripUndefined({
    schemaVersion: 'evaos.browser_status.v1' as const,
    customerId,
    customerAccountId: policy.customerAccountId,
    membershipId: policy.membershipId,
    membershipRole: policy.membershipRole,
    routeDenied: true,
    routeDenialReason: 'Business Browser requires the open_business_browser scope for this customer account.',
    backendEnforced: policy.backendEnforced,
    displayLabel: 'Business Browser',
    status: 'denied',
    authNeeded: false,
    captchaNeeded: false,
    waitingOnUser: false,
    controlSessionActive: false,
    canLaunch: false,
    canOpenUrl: false,
    canStop: false,
    actions: [],
    policyAuditId: policy.auditId,
  });
}

function businessBrowserViewFromRuntime(
  runtime: IEvaosRuntimeStatusView,
  policy: IEvaosPeopleAccessPolicyView,
  fallbackCustomerId: string
): IEvaosBusinessBrowserView {
  if (runtime.runtimeKey !== 'browser') {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned the wrong runtime.');
  }
  assertCustomerScopeMatches(runtime.customerId, policy, fallbackCustomerId, 'browser runtime');

  const actions = runtime.actions ?? [];
  const status = runtime.status.toLowerCase();
  const controlSessionActive = runtime.controlSessionActive ?? false;
  const running = status === 'running' || status === 'ready' || status === 'active';

  return stripUndefined({
    schemaVersion: 'evaos.browser_status.v1' as const,
    customerId: runtime.customerId || policy.selectedCustomerId || fallbackCustomerId,
    customerAccountId: runtime.customerAccountId ?? policy.customerAccountId,
    membershipId: policy.membershipId,
    membershipRole: policy.membershipRole,
    routeDenied: false,
    backendEnforced: policy.backendEnforced,
    displayLabel: runtime.displayLabel || 'Business Browser',
    status: runtime.status,
    healthSummary: runtime.healthSummary,
    currentUrlSummary: runtime.currentUrlSummary,
    authNeeded: runtime.authNeeded ?? false,
    captchaNeeded: runtime.captchaNeeded ?? false,
    waitingOnUser: runtime.waitingOnUser ?? false,
    controlSessionActive,
    canLaunch: isBusinessBrowserActionAvailable(actions, 'launch') || !running,
    canOpenUrl: isBusinessBrowserActionAvailable(actions, 'open_url') || controlSessionActive || running,
    canStop: isBusinessBrowserActionAvailable(actions, 'stop') || controlSessionActive,
    lastCheckedAt: runtime.lastCheckedAt,
    lastActivityAt: runtime.lastActivityAt,
    actions,
    sourcePointer: runtime.sourcePointer,
    auditId: runtime.auditId,
    policyAuditId: policy.auditId,
  });
}

function sanitizeBusinessBrowserActionResult(
  raw: unknown,
  fallback: {
    action: 'browser_open_url' | 'browser_stop';
    customerId: string;
    policy: IEvaosPeopleAccessPolicyView;
    url?: string;
  }
): IEvaosBusinessBrowserActionResult {
  const record = asRecord(raw);
  if (!record) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }

  const responseCustomerId = safeText(record.customer_id);
  assertCustomerScopeMatches(responseCustomerId, fallback.policy, fallback.customerId, 'browser action');

  const status = safeText(record.status) ?? (record.ok === true ? 'ok' : undefined);
  const backendEnforced = safeBoolean(record.backend_enforced);
  const sourcePointer = safeBusinessBrowserActionSourcePointer(
    record.source_pointer,
    fallback.action,
    fallback.customerId
  );
  const auditId = safeText(record.audit_id);
  if (!status || backendEnforced !== true || !sourcePointer || !auditId) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker did not return browser action enforcement proof.'
    );
  }

  const runtime = extractBusinessBrowserRuntime(record);
  const browser = runtime
    ? businessBrowserViewFromRuntime(
        sanitizeBusinessBrowserRuntimeStatus(runtime, fallback.policy, fallback.customerId),
        fallback.policy,
        fallback.customerId
      )
    : undefined;

  return stripUndefined({
    status,
    message: safeText(record.message),
    browser,
    urlSummary: summarizeUrl(record.current_url ?? record.url ?? record.target_url ?? fallback.url),
    sourcePointer,
    auditId,
    backendEnforced,
  });
}

function extractBusinessBrowserRuntime(record: Record<string, unknown>): unknown {
  return record.browser ?? record.browser_status ?? record.runtime_status ?? record.runtime;
}

function sanitizeBusinessBrowserRuntimeStatus(
  raw: unknown,
  policy: IEvaosPeopleAccessPolicyView,
  fallbackCustomerId: string
): IEvaosRuntimeStatusView {
  const record = asRecord(raw);
  if (!record) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }

  const responseCustomerId = safeText(record.customer_id);
  if (!responseCustomerId) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker did not return browser runtime customer proof.'
    );
  }
  assertCustomerScopeMatches(responseCustomerId, policy, fallbackCustomerId, 'browser runtime');

  const responseCustomerAccountId = safeText(record.customer_account_id);
  if (responseCustomerAccountId && policy.customerAccountId && responseCustomerAccountId !== policy.customerAccountId) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker returned browser runtime evidence for a different customer account.'
    );
  }

  const sourcePointer = safeBusinessBrowserRuntimeSourcePointer(record.source_pointer);
  const auditId = safeText(record.audit_id);
  if (!sourcePointer || !auditId) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker did not return browser runtime evidence proof.'
    );
  }

  return sanitizeRuntimeStatus(raw, { customerId: fallbackCustomerId, runtime: 'browser' });
}

function companyBrainDeniedDirectoryView(
  policy: IEvaosPeopleAccessPolicyView,
  customerId: string
): IEvaosCompanyBrainDirectoryView {
  return stripUndefined({
    schemaVersion: 'evaos.company_brain.directory.v1' as const,
    customerId,
    customerAccountId: policy.customerAccountId,
    membershipId: policy.membershipId,
    membershipRole: policy.membershipRole,
    routeDenied: true,
    routeDenialReason: 'Company Brain requires the view_company_brain scope for this customer account.',
    backendEnforced: policy.backendEnforced,
    ingestionState: 'empty' as const,
    accounts: [],
    summaryText: 'Company Brain denied by account policy',
    policyAuditId: policy.auditId,
  });
}

function sanitizeCompanyBrainDirectory(
  raw: unknown,
  policy: IEvaosPeopleAccessPolicyView,
  fallbackCustomerId: string
): IEvaosCompanyBrainDirectoryView {
  const record = asRecord(raw);
  const source = Array.isArray(raw) ? raw : (record?.accounts ?? record?.directory ?? record?.items);
  if (!record || !Array.isArray(source)) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }

  const schemaVersion = safeText(record.schema_version);
  const responseCustomerId = safeText(record.customer_id);
  const responseCustomerAccountId = safeText(record.customer_account_id);
  if (!responseCustomerId || !responseCustomerAccountId) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker did not return Company Brain directory customer proof.'
    );
  }
  assertCustomerScopeMatches(responseCustomerId, policy, fallbackCustomerId, 'Company Brain directory');
  assertCustomerAccountMatches(responseCustomerAccountId, policy, 'Company Brain directory');

  const backendEnforced = safeBoolean(record.backend_enforced);
  const sourcePointer = safeExactSourcePointer(
    record.source_pointer,
    `broker:company_brain_directory:${fallbackCustomerId}`
  );
  const auditId = safeText(record.audit_id);
  if (schemaVersion !== 'evaos.company_brain.directory.v1' || backendEnforced !== true || !sourcePointer || !auditId) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker did not return Company Brain directory enforcement proof.'
    );
  }

  const integrationHealth = sanitizeCompanyBrainIntegrationHealth(record.integration_health);
  const ingestionState =
    safeCompanyBrainIngestionState(record.ingestion_state ?? integrationHealth?.state) ??
    (source.length === 0 ? 'empty' : 'ready');
  const accounts = safeCompanyBrainAccounts(source, policy.customerAccountId);

  return stripUndefined({
    schemaVersion: 'evaos.company_brain.directory.v1' as const,
    customerId: responseCustomerId ?? policy.selectedCustomerId ?? fallbackCustomerId,
    customerAccountId: responseCustomerAccountId ?? policy.customerAccountId,
    membershipId: policy.membershipId,
    membershipRole: policy.membershipRole,
    routeDenied: false,
    backendEnforced,
    ingestionState,
    integrationHealth,
    accounts,
    summaryText: companyBrainDirectorySummary(accounts.length, ingestionState),
    sourcePointer,
    auditId,
    policyAuditId: policy.auditId,
  });
}

function sanitizeCompanyBrainAccount360(
  raw: unknown,
  fallback: {
    accountId: string;
    customerId: string;
    policy: IEvaosPeopleAccessPolicyView;
  }
): IEvaosCompanyBrainAccount360View {
  const record = asRecord(raw);
  if (!record) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }

  const schemaVersion = safeText(record.schema_version);
  const responseCustomerId = safeText(record.customer_id);
  const responseCustomerAccountId = safeText(record.customer_account_id);
  if (!responseCustomerId || !responseCustomerAccountId) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker did not return Company Brain account customer proof.'
    );
  }
  assertCustomerScopeMatches(responseCustomerId, fallback.policy, fallback.customerId, 'Company Brain account');
  assertCustomerAccountMatches(responseCustomerAccountId, fallback.policy, 'Company Brain account');

  const responseAccountId = safeText(
    record.account_id ?? asRecord(record.account)?.account_id ?? asRecord(record.account)?.id
  );
  if (responseAccountId && responseAccountId !== fallback.accountId) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker returned Company Brain account evidence for a different account.'
    );
  }

  const backendEnforced = safeBoolean(record.backend_enforced);
  const sourcePointer = safeExactSourcePointer(
    record.source_pointer,
    `broker:company_brain_account_360:${fallback.accountId}`
  );
  const auditId = safeText(record.audit_id);
  if (
    schemaVersion !== 'evaos.company_brain.account_360.v1' ||
    backendEnforced !== true ||
    !sourcePointer ||
    !auditId
  ) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker did not return Company Brain account enforcement proof.'
    );
  }

  const account = sanitizeCompanyBrainAccountSummary(record.account ?? record, fallback.policy.customerAccountId);
  if (!account || account.accountId !== fallback.accountId) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }

  const ingestionState = safeCompanyBrainIngestionState(record.ingestion_state ?? account.ingestionState) ?? 'empty';

  return stripUndefined({
    schemaVersion: 'evaos.company_brain.account_360.v1' as const,
    customerId: responseCustomerId ?? fallback.policy.selectedCustomerId ?? fallback.customerId,
    customerAccountId: responseCustomerAccountId ?? fallback.policy.customerAccountId,
    membershipId: fallback.policy.membershipId,
    membershipRole: fallback.policy.membershipRole,
    routeDenied: false,
    backendEnforced,
    accountId: fallback.accountId,
    account,
    ingestionState,
    brief: sanitizeCompanyBrainBrief(record.brief, fallback.accountId),
    timeline: safeCompanyBrainTimeline(record.timeline ?? record.events),
    exceptions: safeCompanyBrainExceptions(record.exceptions),
    sourcePointer,
    auditId,
    policyAuditId: fallback.policy.auditId,
  });
}

function sanitizeCompanyBrainQuery(
  raw: unknown,
  fallback: {
    accountId: string;
    customerId: string;
    policy: IEvaosPeopleAccessPolicyView;
  }
): IEvaosCompanyBrainQueryResult {
  const record = asRecord(raw);
  if (!record) {
    throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
  }

  const schemaVersion = safeText(record.schema_version);
  const responseCustomerId = safeText(record.customer_id);
  const responseCustomerAccountId = safeText(record.customer_account_id);
  if (!responseCustomerId || !responseCustomerAccountId) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker did not return Company Brain query customer proof.'
    );
  }
  assertCustomerScopeMatches(responseCustomerId, fallback.policy, fallback.customerId, 'Company Brain query');
  assertCustomerAccountMatches(responseCustomerAccountId, fallback.policy, 'Company Brain query');

  const accountId = safeText(record.account_id);
  const status = safeText(record.status);
  const answer = safeText(record.answer, 2_000);
  const backendEnforced = safeBoolean(record.backend_enforced);
  const sourcePointer = safeExactSourcePointer(
    record.source_pointer,
    `broker:company_brain_query:${fallback.accountId}`
  );
  const auditId = safeText(record.audit_id);
  if (
    schemaVersion !== 'evaos.company_brain.query.v1' ||
    accountId !== fallback.accountId ||
    !status ||
    (status === 'answered' && !answer) ||
    backendEnforced !== true ||
    !sourcePointer ||
    !auditId
  ) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker did not return Company Brain query enforcement proof.'
    );
  }

  return stripUndefined({
    schemaVersion: 'evaos.company_brain.query.v1' as const,
    customerId: responseCustomerId ?? fallback.policy.selectedCustomerId ?? fallback.customerId,
    customerAccountId: responseCustomerAccountId ?? fallback.policy.customerAccountId,
    accountId,
    status,
    answer,
    citations: safeCompanyBrainCitations(record.citations),
    sourcePointer,
    auditId,
    backendEnforced,
  });
}

function sanitizeCompanyBrainIntegrationHealth(value: unknown): IEvaosCompanyBrainIntegrationHealthView | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const state = safeCompanyBrainIngestionState(record.state ?? record.status);
  if (!state) {
    return undefined;
  }

  return stripUndefined({
    state,
    summary: safeText(record.summary, 220),
    updatedAt: safeIsoDate(record.updated_at),
  });
}

function safeCompanyBrainAccounts(
  value: unknown,
  expectedCustomerAccountId?: string
): IEvaosCompanyBrainAccountSummaryView[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item): IEvaosCompanyBrainAccountSummaryView => {
    const account = sanitizeCompanyBrainAccountSummary(item, expectedCustomerAccountId);
    if (!account) {
      throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
    }
    return account;
  });
}

function sanitizeCompanyBrainAccountSummary(
  raw: unknown,
  expectedCustomerAccountId?: string
): IEvaosCompanyBrainAccountSummaryView | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;

  const accountId = safeText(record.account_id ?? record.id, 120);
  const name = safeText(record.name ?? record.account_name, 160);
  if (!accountId || !name) {
    return undefined;
  }

  const customerAccountId = safeText(record.customer_account_id);
  if (expectedCustomerAccountId && customerAccountId !== expectedCustomerAccountId) {
    return undefined;
  }

  const ingestionState = safeCompanyBrainIngestionState(record.ingestion_state ?? record.status) ?? 'empty';
  const sourcePointer = safeExactSourcePointer(record.source_pointer, `broker:company_brain_account:${accountId}`);
  const auditId = safeText(record.audit_id);
  if (!sourcePointer || !auditId) {
    return undefined;
  }

  return stripUndefined({
    accountId,
    name,
    domain: safeText(record.domain, 180),
    customerAccountId,
    owner: safeText(record.owner, 120),
    ingestionState,
    exceptionCount: safeNonNegativeInteger(record.exception_count ?? record.exceptions_count) ?? 0,
    lastActivityAt: safeIsoDate(record.last_activity_at),
    sourcePointer,
    auditId,
  });
}

function sanitizeCompanyBrainBrief(value: unknown, accountId: string): IEvaosCompanyBrainBriefView | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const title = safeText(record.title, 180);
  const summary = safeText(record.summary, 1_200);
  const sourcePointer = safeExactSourcePointer(record.source_pointer, `broker:company_brain_brief:${accountId}`);
  const auditId = safeText(record.audit_id);
  if (!title && !summary) {
    return undefined;
  }
  if (!sourcePointer || !auditId) {
    return undefined;
  }

  return stripUndefined({
    title,
    summary,
    updatedAt: safeIsoDate(record.updated_at),
    sourcePointer,
    auditId,
  });
}

function safeCompanyBrainTimeline(value: unknown): IEvaosCompanyBrainTimelineEntryView[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item): IEvaosCompanyBrainTimelineEntryView => {
    const entry = sanitizeCompanyBrainTimelineEntry(item);
    if (!entry) {
      throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
    }
    return entry;
  });
}

function sanitizeCompanyBrainTimelineEntry(raw: unknown): IEvaosCompanyBrainTimelineEntryView | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const entryId = safeText(record.event_id ?? record.entry_id ?? record.id, 120);
  const type = safeText(record.type, 80);
  const title = safeText(record.title, 180);
  if (!entryId || !type || !title) {
    return undefined;
  }
  const sourcePointer = safeExactSourcePointer(record.source_pointer, `broker:company_brain_timeline:${entryId}`);
  const auditId = safeText(record.audit_id);
  if (!sourcePointer || !auditId) {
    return undefined;
  }

  return stripUndefined({
    entryId,
    type,
    title,
    summary: safeText(record.summary, 500),
    occurredAt: safeIsoDate(record.occurred_at),
    sourcePointer,
    auditId,
  });
}

function safeCompanyBrainExceptions(value: unknown): IEvaosCompanyBrainExceptionView[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item): IEvaosCompanyBrainExceptionView => {
    const exception = sanitizeCompanyBrainException(item);
    if (!exception) {
      throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
    }
    return exception;
  });
}

function sanitizeCompanyBrainException(raw: unknown): IEvaosCompanyBrainExceptionView | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const exceptionId = safeText(record.exception_id ?? record.id, 120);
  const severity = safeCompanyBrainExceptionSeverity(record.severity);
  const title = safeText(record.title, 180);
  const status = safeText(record.status, 80);
  if (!exceptionId || !severity || !title || !status) {
    return undefined;
  }
  const sourcePointer = safeExactSourcePointer(record.source_pointer, `broker:company_brain_exception:${exceptionId}`);
  const auditId = safeText(record.audit_id);
  if (!sourcePointer || !auditId) {
    return undefined;
  }

  return stripUndefined({
    exceptionId,
    severity,
    title,
    summary: safeText(record.summary, 500),
    status,
    sourcePointer,
    auditId,
  });
}

function safeCompanyBrainCitations(value: unknown): IEvaosCompanyBrainCitationView[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item): IEvaosCompanyBrainCitationView => {
    const citation = sanitizeCompanyBrainCitation(item);
    if (!citation) {
      throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
    }
    return citation;
  });
}

function sanitizeCompanyBrainCitation(raw: unknown): IEvaosCompanyBrainCitationView | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const citationId = safeText(record.citation_id ?? record.id, 120);
  if (!citationId) {
    return undefined;
  }
  const sourcePointer = safeExactSourcePointer(record.source_pointer, `broker:company_brain_citation:${citationId}`);
  if (!sourcePointer) {
    return undefined;
  }

  return stripUndefined({
    citationId,
    title: safeText(record.title, 180),
    sourceType: safeText(record.source_type ?? record.type, 80),
    occurredAt: safeIsoDate(record.occurred_at),
    sourcePointer,
  });
}

function companyBrainDirectorySummary(count: number, ingestionState: IEvaosCompanyBrainIngestionState): string {
  if (count === 0) {
    return ingestionState === 'ingesting' ? 'No accounts indexed yet, ingesting' : 'No accounts indexed';
  }
  return `${count} ${count === 1 ? 'account' : 'accounts'}, ${ingestionState}`;
}

function isBusinessBrowserActionAvailable(actions: string[], capability: 'launch' | 'open_url' | 'stop'): boolean {
  const allowed = new Set(actions);
  if (capability === 'launch') {
    return allowed.has('start_attach') || allowed.has('browser_open_url') || allowed.has('open_url');
  }
  if (capability === 'open_url') {
    return allowed.has('browser_open_url') || allowed.has('open_url') || allowed.has('open');
  }
  return allowed.has('browser_stop') || allowed.has('stop_browser') || allowed.has('stop');
}

function safeProviderProfiles(value: unknown, expectedCustomerAccountId?: string): IEvaosProviderProfileView[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item): IEvaosProviderProfileView => {
    const profile = sanitizeSingleProviderProfile(item, expectedCustomerAccountId);
    if (!profile) {
      throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
    }
    return profile;
  });
}

function sanitizeSingleProviderProfile(
  raw: unknown,
  expectedCustomerAccountId?: string
): IEvaosProviderProfileView | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;

  const nested = asRecord(record.provider_profile) ?? asRecord(record.profile);
  if (nested) {
    return sanitizeSingleProviderProfile(nested, expectedCustomerAccountId);
  }

  const providerKey = normalizeProviderKeyValue(record.provider_key ?? record.provider ?? record.key);
  const rawStatus = safeText(record.status, 80);
  const status = normalizeProviderStatusValue(rawStatus);
  if (!providerKey || !status) {
    return undefined;
  }

  const customerAccountId = safeText(record.customer_account_id);
  if (customerAccountId && expectedCustomerAccountId && customerAccountId !== expectedCustomerAccountId) {
    return undefined;
  }

  const rawSecretsStoredInWorkbench =
    safeBoolean(record.raw_secrets_stored_in_workbench ?? record.raw_secrets_present) ?? false;
  const grantHandlePresent = hasOpaqueProviderHandle(record.grant_handle ?? record.handle);
  const lastValidatedAt = safeIsoDate(record.last_validated_at ?? record.validated_at);
  const display = asRecord(record.display);
  const approvalRequired =
    status === 'approval_required' || (safeBoolean(record.approval_required ?? record.requires_approval) ?? false);
  const hasConnectionProof =
    status === 'connected' && !rawSecretsStoredInWorkbench && Boolean(lastValidatedAt || grantHandlePresent);
  const hasBrokeredGrant = status === 'connected' && !rawSecretsStoredInWorkbench && grantHandlePresent;

  return stripUndefined({
    providerKey,
    title: safeText(record.title, 120) ?? PROVIDER_LABELS[providerKey],
    subtitle: safeText(record.subtitle, 180),
    status,
    active: safeBoolean(record.active ?? record.is_active) ?? false,
    rawSecretsStoredInWorkbench,
    approvalRequired,
    capabilities: safeStringList(record.capabilities, 120),
    usageSummary: safeText(record.usage_summary, 220),
    customerAccountId,
    ownerKind: safeText(record.owner_kind, 80),
    ownerUserId: safeText(record.owner_user_id, 120),
    grantedScopes: safeStringList(record.granted_scopes ?? record.scopes, 120),
    expiresAt: safeIsoDate(record.expires_at),
    accountLabel: safeText(display?.account_label ?? record.account_label, 180),
    lastCheckedAt: safeIsoDate(display?.last_checked_at ?? record.last_checked_at),
    sourcePointer: safeProviderProfileSourcePointer(record.source_pointer, providerKey),
    auditId: safeText(record.audit_id),
    lastValidatedAt,
    hasConnectionProof,
    hasBrokeredGrant,
    summaryText: providerSummaryText({ status, rawSecretsStoredInWorkbench, approvalRequired, hasConnectionProof }),
  });
}

function providerSummaryText(profile: {
  status: IEvaosProviderStatus;
  rawSecretsStoredInWorkbench: boolean;
  approvalRequired: boolean;
  hasConnectionProof: boolean;
}): string {
  if (profile.rawSecretsStoredInWorkbench) return 'Blocked';
  if (profile.approvalRequired) return 'Approval required';
  if (profile.status === 'connected' && profile.hasConnectionProof) return 'Ready';
  if (profile.status === 'connected') return 'Needs verification';
  if (profile.status === 'needs_login') return 'Needs login';
  if (profile.status === 'approval_required') return 'Approval required';
  if (profile.status === 'revoked') return 'Revoked';
  if (profile.status === 'expired') return 'Needs reconnection';
  if (profile.status === 'error') return 'Blocked';
  return 'Unavailable';
}

function safeApprovalRequests(value: unknown): IEvaosApprovalRequestView[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item): IEvaosApprovalRequestView => {
    const request = sanitizeSingleApprovalRequest(item);
    if (!request) {
      throw new EvaosBrokerSessionError('broker_invalid_response', 'The evaOS broker returned an invalid response.');
    }
    return request;
  });
}

function sanitizeSingleApprovalRequest(raw: unknown): IEvaosApprovalRequestView | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;

  const requestRecord = asRecord(record.request) ?? asRecord(record.approval) ?? asRecord(record.resolved_request);
  if (requestRecord) {
    return sanitizeSingleApprovalRequest(requestRecord);
  }

  const approvalId = safeText(record.approval_id ?? record.request_id ?? record.id);
  const agentId = safeText(record.agent_id);
  const toolName = safeText(record.tool_name ?? record.tool);
  const riskClass = safeApprovalRiskClass(record.risk_class);
  const createdAt = safeIsoDate(record.created_at);
  if (!approvalId || !agentId || !toolName || !riskClass || !createdAt) {
    return undefined;
  }

  const sourcePointer = safeText(record.source_pointer) ?? `approval:${approvalId}`;
  const payload = safeApprovalPayload(record.action_payload ?? record.payload);
  const destinationPreview = approvalDestinationPreview(toolName, payload);
  const destinationProof = approvalDestinationProof(destinationPreview, sourcePointer);
  const allowAlwaysSupported = safeBoolean(record.allow_always_supported) ?? false;
  const requesterMembershipId = safeText(record.requester_membership_id);
  const canAllowOnce = destinationPreview.actionable && Boolean(destinationProof);
  const canAllowAlways =
    allowAlwaysSupported && canAllowOnce && destinationPreview.kind !== 'budget' && !destinationPreview.warning;
  const canDeny = Boolean(requesterMembershipId);
  const availableDecisions = [
    ...(canAllowOnce ? (['allow-once'] as const) : []),
    ...(canAllowAlways ? (['allow-always'] as const) : []),
    ...(canDeny ? (['deny'] as const) : []),
  ];

  return stripUndefined({
    approvalId,
    ownerId: safeText(record.owner_id),
    agentId,
    requesterMembershipId,
    toolName,
    riskClass,
    destinationPreview,
    destinationProof,
    allowAlwaysSupported,
    availableDecisions,
    canAllowOnce,
    canAllowAlways,
    canDeny,
    createdAt,
    expiresAt: safeIsoDate(record.expires_at),
    sourcePointer,
    auditId: safeText(record.audit_id),
    nextAction: approvalNextAction(destinationPreview, riskClass),
  });
}

function sanitizeApprovalRuntimeResult(value: unknown): IEvaosApprovalRuntimeResult | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const status = safeText(record.status);
  if (!status) return undefined;
  return stripUndefined({
    status,
    runtime: safeText(record.runtime),
    sourcePointer: safeText(record.source_pointer),
    auditId: safeText(record.audit_id),
  });
}

function approvalDestinationPreview(
  toolName: string,
  payload: Record<string, string>
): IEvaosApprovalDestinationPreview {
  const tokens = toolName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.some((token) => token === 'gmail' || token === 'email' || token === 'mail')) {
    const recipient = firstPayloadValue(payload, ['actual_recipient_email', 'recipient_email']);
    if (recipient && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return stripUndefined({
        kind: 'email_recipient' as const,
        primary: recipient,
        secondary: firstPayloadValue(payload, ['subject']),
        actionable: true,
      });
    }
    return missingApprovalDestination('Missing actual recipient email.');
  }

  if (tokens.some((token) => token === 'slack' || token === 'message' || token === 'chat')) {
    const target = firstPayloadValue(payload, [
      'actual_recipient_id',
      'actual_channel_id',
      'recipient_id',
      'channel_id',
    ]);
    if (target) {
      return stripUndefined({
        kind: 'message_recipient' as const,
        primary: target,
        actionable: true,
      });
    }
    return missingApprovalDestination('Missing actual message recipient or channel.');
  }

  if (tokens.some((token) => token === 'browser' || token === 'fetch' || token === 'url' || token === 'http')) {
    const url = safeApprovalUrl(firstPayloadValue(payload, ['actual_url', 'target_url', 'url']));
    if (url) {
      return stripUndefined({
        kind: 'url' as const,
        primary: url,
        secondary: new URL(url).host,
        actionable: true,
      });
    }
    return missingApprovalDestination('Missing actual HTTP or HTTPS URL.');
  }

  if (tokens.some((token) => token === 'file' || token === 'delete' || token === 'export')) {
    const path = firstPayloadValue(payload, ['actual_file_path', 'file_path', 'delete_path', 'export_destination']);
    if (path) {
      return {
        kind: 'file_path',
        primary: path,
        actionable: true,
      };
    }
    return missingApprovalDestination('Missing actual file path.');
  }

  if (tokens.some((token) => token === 'purchase' || token === 'payment' || token === 'billing')) {
    const target = firstPayloadValue(payload, ['merchant', 'payment_target', 'actual_payment_target']);
    const amount = firstPayloadValue(payload, ['amount', 'amount_text', 'cap']);
    if (target || amount) {
      return stripUndefined({
        kind: 'purchase' as const,
        primary: target ?? amount ?? 'payment target',
        secondary: amount,
        actionable: true,
      });
    }
    return missingApprovalDestination('Missing purchase or payment target.');
  }

  if (tokens.some((token) => token === 'secret' || token === 'credential')) {
    const secretName = firstPayloadValue(payload, ['secret_name', 'secret_id']);
    if (secretName) {
      return {
        kind: 'secret_name',
        primary: secretName,
        actionable: true,
      };
    }
    return missingApprovalDestination('Missing secret name.');
  }

  if (tokens.some((token) => token === 'budget' || token === 'cap')) {
    const cap = firstPayloadValue(payload, ['cap', 'budget_cap', 'amount']);
    const scope = firstPayloadValue(payload, ['scope', 'budget_scope']);
    if (cap || scope) {
      return stripUndefined({
        kind: 'budget' as const,
        primary: cap ?? scope ?? 'budget change',
        secondary: scope,
        actionable: true,
      });
    }
    return missingApprovalDestination('Missing budget scope.');
  }

  const permission = firstPayloadValue(payload, ['permission', 'permission_scope', 'scope']);
  if (permission) {
    return {
      kind: 'permission',
      primary: permission,
      actionable: true,
    };
  }

  return missingApprovalDestination('Missing actual destination details.');
}

function approvalDestinationProof(
  preview: IEvaosApprovalDestinationPreview,
  sourcePointer: string
): IEvaosApprovalDestinationProof | undefined {
  if (!preview.actionable || preview.kind === 'missing_destination') {
    return undefined;
  }

  const fingerprint = stableApprovalFingerprint([
    preview.kind,
    fingerprintComponent(preview.primary, preview.kind),
    fingerprintComponent(preview.secondary ?? '', preview.kind),
  ]);
  const summary = preview.secondary
    ? `${preview.kind}: ${preview.primary} (${preview.secondary})`
    : `${preview.kind}: ${preview.primary}`;

  return {
    kind: preview.kind,
    fingerprint,
    summary: summary.slice(0, 220),
    source: 'aionui_preview',
    sourcePointer,
  };
}

function toBrokerApprovalDestinationProof(
  proof: IEvaosApprovalDestinationProof | undefined
): Record<string, unknown> | undefined {
  if (!proof) {
    return undefined;
  }
  return stripUndefined({
    kind: proof.kind,
    fingerprint: proof.fingerprint,
    summary: proof.summary,
    source: proof.source,
    source_pointer: proof.sourcePointer,
  });
}

function approvalNextAction(preview: IEvaosApprovalDestinationPreview, riskClass: IEvaosApprovalRiskClass): string {
  if (!preview.actionable) {
    return 'Approval request is missing actual destination details; deny or ask the runtime to resubmit.';
  }
  if (riskClass === 'critical') {
    return 'Critical action. Verify the actual destination before deciding.';
  }
  if (riskClass === 'warning') {
    return 'Review the actual destination before deciding.';
  }
  return 'Confirm the destination matches the intended action.';
}

function missingApprovalDestination(warning: string): IEvaosApprovalDestinationPreview {
  return {
    kind: 'missing_destination',
    primary: 'Missing destination',
    warning,
    actionable: false,
  };
}

function safeApprovalPayload(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = safeApprovalPayloadKey(rawKey);
    if (!key || !APPROVAL_PAYLOAD_ALLOWLIST.has(key)) continue;
    const valueText =
      typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean'
        ? safeApprovalPayloadText(String(rawValue), 500)
        : undefined;
    if (valueText) {
      result[key] = valueText;
    }
  }
  return result;
}

function safeApprovalPayloadKey(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80 || !/^[a-z0-9_.-]+$/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function safeApprovalPayloadText(value: string, maxLength: number): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return undefined;
  }
  return trimmed;
}

function firstPayloadValue(payload: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (value) return value;
  }
  return undefined;
}

function safeApprovalRiskClass(value: unknown): IEvaosApprovalRiskClass | undefined {
  const riskClass = safeText(value, 40);
  return riskClass === 'critical' || riskClass === 'warning' || riskClass === 'info' ? riskClass : undefined;
}

function safeApprovalLimit(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 100 ? value : 50;
}

function normalizeApprovalId(value: string): string {
  const text = safeText(value, 120);
  if (!text) {
    throw new EvaosBrokerSessionError('invalid_approval', 'Choose an approval request before deciding.');
  }
  return text;
}

function safeApprovalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined;
    }
    if (url.username || url.password || containsSecretMaterial(value)) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function isDeniedApprovalStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === 'denied' || normalized === 'rejected' || normalized === 'blocked';
}

function fingerprintComponent(value: string, kind: IEvaosApprovalPreviewKind): string {
  if (kind === 'email_recipient') {
    const parts = value.split('@');
    return parts.length === 2 ? `${parts[0]}@${parts[1].toLowerCase()}` : value;
  }
  if (kind === 'url') {
    try {
      const url = new URL(value);
      url.protocol = url.protocol.toLowerCase();
      url.hostname = url.hostname.toLowerCase();
      return url.toString();
    } catch {
      return value.toLowerCase();
    }
  }
  return value;
}

function stableApprovalFingerprint(parts: string[]): string {
  return `dest-${createHash('sha256').update(parts.join('|')).digest('hex')}`;
}

function assertPolicyScope(
  policy: IEvaosPeopleAccessPolicyView,
  scope: IEvaosAccountPolicyScope,
  message: string
): void {
  if (!policy.scopes.includes(scope)) {
    throw new EvaosBrokerSessionError('action_denied', message);
  }
}

function assertPeopleAccessPolicyProof(policy: IEvaosPeopleAccessPolicyView): void {
  if (policy.backendEnforced !== true || !policy.auditId) {
    throw new EvaosBrokerSessionError(
      'action_denied',
      'People Access actions require backend-enforced account policy proof.'
    );
  }
}

function assertProviderPolicyProof(policy: IEvaosPeopleAccessPolicyView): void {
  if (policy.backendEnforced !== true || !policy.auditId) {
    throw new EvaosBrokerSessionError(
      'action_denied',
      'Connected app actions require backend-enforced account policy proof.'
    );
  }
}

function assertApprovalPolicyProof(policy: IEvaosPeopleAccessPolicyView): void {
  if (policy.backendEnforced !== true || !policy.auditId) {
    throw new EvaosBrokerSessionError(
      'action_denied',
      'Approval decisions require backend-enforced account policy proof.'
    );
  }
}

function assertBusinessBrowserPolicyProof(policy: IEvaosPeopleAccessPolicyView): void {
  if (policy.backendEnforced !== true || !policy.auditId) {
    throw new EvaosBrokerSessionError(
      'action_denied',
      'Business Browser actions require backend-enforced account policy proof.'
    );
  }
}

function assertCompanyBrainPolicyProof(policy: IEvaosPeopleAccessPolicyView): void {
  if (policy.backendEnforced !== true || !policy.auditId) {
    throw new EvaosBrokerSessionError(
      'action_denied',
      'Company Brain access requires backend-enforced account policy proof.'
    );
  }
}

function assertCustomerScopeMatches(
  responseCustomerId: string | undefined,
  policy: IEvaosPeopleAccessPolicyView,
  fallbackCustomerId: string,
  context: string
): void {
  if (!responseCustomerId) {
    return;
  }

  const allowedCustomerIds = new Set([fallbackCustomerId, policy.selectedCustomerId].filter(Boolean));
  if (!allowedCustomerIds.has(responseCustomerId)) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      `The evaOS broker returned ${context} evidence for a different customer.`
    );
  }
}

function assertCustomerAccountMatches(
  responseCustomerAccountId: string | undefined,
  policy: IEvaosPeopleAccessPolicyView,
  context: string
): void {
  if (responseCustomerAccountId && policy.customerAccountId && responseCustomerAccountId !== policy.customerAccountId) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      `The evaOS broker returned ${context} evidence for a different customer account.`
    );
  }
}

function hasFreshProviderConnectionProof(profile: IEvaosProviderProfileView, now: Date): boolean {
  if (profile.status !== 'connected' || profile.rawSecretsStoredInWorkbench || !profile.hasConnectionProof) {
    return false;
  }

  const validatedAt = profile.lastValidatedAt ? Date.parse(profile.lastValidatedAt) : NaN;
  if (!Number.isFinite(validatedAt)) {
    return false;
  }

  const nowMs = now.getTime();
  if (validatedAt > nowMs + 60_000 || nowMs - validatedAt > PROVIDER_CONNECTION_PROOF_MAX_AGE_MS) {
    return false;
  }

  const expiresAt = profile.expiresAt ? Date.parse(profile.expiresAt) : NaN;
  return !Number.isFinite(expiresAt) || expiresAt > nowMs;
}

function normalizeEmail(value: string): string {
  const text = safeText(value, 254)?.toLowerCase();
  if (!text || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    throw new EvaosBrokerSessionError('invalid_email', 'Enter a valid invite email address.');
  }
  return text;
}

function normalizeInviteRole(value: IEvaosAccountPolicyRole): IEvaosAccountPolicyRole {
  if (VALID_INVITE_ROLES.has(value)) {
    return value;
  }
  throw new EvaosBrokerSessionError('invalid_role', 'Choose a supported People Access role.');
}

function normalizeAccountRoleValue(value: unknown): IEvaosAccountPolicyRole | undefined {
  const role = safeText(value, 80);
  return role && VALID_ACCOUNT_ROLES.has(role as IEvaosAccountPolicyRole)
    ? (role as IEvaosAccountPolicyRole)
    : undefined;
}

function safePolicyScopeList(value: unknown): IEvaosAccountPolicyScope[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const scopes = value
    .map((item) => safeText(item, 80))
    .filter((item): item is IEvaosAccountPolicyScope =>
      Boolean(item && VALID_POLICY_SCOPES.has(item as IEvaosAccountPolicyScope))
    );

  return [...new Set(scopes)];
}

function safePeopleAccessMembers(value: unknown): IEvaosPeopleAccessMemberView[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): IEvaosPeopleAccessMemberView[] => {
    const record = asRecord(item);
    if (!record) return [];
    const memberId = safeText(record.member_id ?? record.membership_id ?? record.id);
    const role = normalizeAccountRoleValue(record.role ?? record.membership_role ?? record.seat_type);
    if (!memberId || !role) return [];

    return [
      stripUndefined({
        memberId,
        email: safeEmailText(record.email ?? record.user_email),
        displayName: safeText(record.display_name ?? record.name),
        role,
        seatType: safeText(record.seat_type),
        status: safeText(record.status) ?? 'active',
        joinedAt: safeIsoDate(record.joined_at ?? record.created_at),
        lastActiveAt: safeIsoDate(record.last_active_at),
      }),
    ];
  });
}

function safePeopleAccessInvites(value: unknown): IEvaosPeopleAccessInviteView[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): IEvaosPeopleAccessInviteView[] => {
    const record = asRecord(item);
    if (!record) return [];
    const inviteId = safeText(record.invite_id ?? record.invitation_id ?? record.id);
    const email = safeEmailText(record.email ?? record.invited_email);
    const role = normalizeAccountRoleValue(record.role ?? record.membership_role ?? record.seat_type);
    if (!inviteId || !email || !role) return [];

    return [
      stripUndefined({
        inviteId,
        email,
        role,
        status: safeText(record.status) ?? 'pending',
        expiresAt: safeIsoDate(record.expires_at),
        invitedAt: safeIsoDate(record.invited_at ?? record.created_at),
      }),
    ];
  });
}

function safeEmailText(value: unknown): string | undefined {
  const text = safeText(value, 254)?.toLowerCase();
  return text && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : undefined;
}

function safeBooleanMap(value: unknown): Record<string, boolean> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }

  const result: Record<string, boolean> = {};
  for (const [key, raw] of Object.entries(record)) {
    const safeKey = safeText(key, 80);
    if (!safeKey || typeof raw !== 'boolean') continue;
    result[safeKey] = raw;
  }
  return result;
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

function normalizeRuntimeValue(value: unknown): IEvaosRuntimeKey | undefined {
  const text = safeText(value);
  if (!text) {
    return undefined;
  }
  return VALID_RUNTIME_KEYS.has(text as IEvaosRuntimeKey) ? (text as IEvaosRuntimeKey) : undefined;
}

function normalizeProviderKeyValue(value: unknown): IEvaosProviderKey | undefined {
  const text = safeText(value, 120);
  if (!text) {
    return undefined;
  }
  return VALID_PROVIDER_KEYS.has(text as IEvaosProviderKey) ? (text as IEvaosProviderKey) : undefined;
}

function normalizeProviderStatusValue(value: unknown): IEvaosProviderStatus | undefined {
  const text = safeText(value, 80)?.toLowerCase();
  if (!text) {
    return undefined;
  }
  const aliases: Record<string, IEvaosProviderStatus> = {
    needs_auth: 'needs_login',
    needs_input: 'needs_login',
    unavailable: 'planned',
    coming_soon: 'planned',
    disconnected: 'revoked',
    blocked: 'error',
    failed: 'error',
  };
  const normalized = aliases[text] ?? text;
  return VALID_PROVIDER_STATUSES.has(normalized as IEvaosProviderStatus)
    ? (normalized as IEvaosProviderStatus)
    : undefined;
}

function normalizeProviderAgentRuntime(value: unknown): IEvaosProviderAgentRuntime {
  const text = safeText(value, 80);
  if (text && VALID_PROVIDER_AGENT_RUNTIMES.has(text as IEvaosProviderAgentRuntime)) {
    return text as IEvaosProviderAgentRuntime;
  }
  throw new EvaosBrokerSessionError('invalid_provider', 'Choose a supported provider grant runtime.');
}

function normalizeBusinessBrowserUrl(value: string): string {
  if (typeof value !== 'string' || containsSecretMaterial(value)) {
    throw new EvaosBrokerSessionError('invalid_browser_url', 'Enter a safe http(s) URL for Business Browser.');
  }

  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    if (url.username || url.password) {
      throw new Error('embedded credentials');
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    throw new EvaosBrokerSessionError('invalid_browser_url', 'Enter a safe http(s) URL for Business Browser.');
  }
}

function normalizeCompanyBrainAccountId(value: string): string {
  const text = safeText(value, 120);
  if (!text || !/^[a-z0-9_.:-]+$/i.test(text)) {
    throw new EvaosBrokerSessionError(
      'invalid_company_brain_account',
      'Choose a Company Brain account before loading details.'
    );
  }
  return text;
}

function normalizeCompanyBrainQuery(value: string): string {
  const text = safeText(value, 500);
  if (!text || text.length < 3) {
    throw new EvaosBrokerSessionError('invalid_company_brain_query', 'Enter a Company Brain question.');
  }
  return text;
}

function summarizeUrl(value: unknown): IEvaosSafeUrlSummary | undefined {
  if (typeof value === 'string') {
    return summarizeUrlString(value);
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const displaySummary = summarizePossiblySchemalessUrl(record.display_text ?? record.displayText);
  if (displaySummary?.host) {
    return {
      ...displaySummary,
      redacted: true,
    };
  }

  const host = safeUrlHost(record.host);
  const path = safeUrlPath(record.path);
  const displayText = host ? `${host}${path ?? ''}` : displaySummary?.displayText;
  if (!displayText && !host) {
    return undefined;
  }

  return stripUndefined({
    scheme: safeUrlScheme(record.scheme),
    host,
    path,
    displayText,
    redacted: true,
  });
}

function summarizePossiblySchemalessUrl(value: unknown): IEvaosSafeUrlSummary | undefined {
  const text = safeText(value);
  if (!text) {
    return undefined;
  }

  const looksUrlLike =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^[^/\s?#]+\.[^/\s?#]+(?::\d+)?(?:[/?#].*)?$/i.test(text);
  if (!looksUrlLike && !/[?#]/.test(text)) {
    return {
      displayText: text,
      redacted: false,
    };
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  return summarizeUrlString(candidate);
}

function summarizeUrlString(value: string): IEvaosSafeUrlSummary | undefined {
  if (containsSecretMaterial(value)) {
    try {
      const url = new URL(value);
      const path = url.pathname === '/' ? '' : url.pathname;
      return stripUndefined({
        scheme: safeText(url.protocol.replace(/:$/, '')),
        host: safeText(url.host),
        path: safeText(path),
        displayText: `${url.host}${path}`,
        redacted: true,
      });
    } catch {
      return undefined;
    }
  }

  try {
    const url = new URL(value);
    const path = url.pathname === '/' ? '' : url.pathname;
    return stripUndefined({
      scheme: safeText(url.protocol.replace(/:$/, '')),
      host: safeText(url.host),
      path: safeText(path),
      displayText: `${url.host}${path}`,
      redacted: Boolean(url.search || url.hash),
    });
  } catch {
    const trimmed = value.trim();
    const queryless = trimmed.split(/[?#]/, 1)[0];
    const text = safeText(queryless);
    return text
      ? {
          displayText: text,
          redacted: queryless !== trimmed,
        }
      : undefined;
  }
}

function safeUrlScheme(value: unknown): string | undefined {
  const scheme = safeText(value, 20)?.toLowerCase().replace(/:$/, '');
  return scheme === 'http' || scheme === 'https' ? scheme : undefined;
}

function safeUrlHost(value: unknown): string | undefined {
  const host = safeText(value, 200);
  if (!host || /[/?#]/.test(host) || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) {
    return undefined;
  }
  return host;
}

function safeUrlPath(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const queryless = value.trim().split(/[?#]/, 1)[0];
  const path = safeText(queryless, 300);
  if (!path) {
    return undefined;
  }
  return path.startsWith('/') ? path : `/${path}`;
}

function safeActionList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const actions = value.map((item) => safeText(item, 80)).filter((item): item is string => Boolean(item));

  return actions.length > 0 ? actions : undefined;
}

function safeStringList(value: unknown, maxLength = 120): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result = value.map((item) => safeText(item, maxLength)).filter((item): item is string => Boolean(item));
  return [...new Set(result)];
}

function safeProviderProfileSourcePointer(value: unknown, providerKey: IEvaosProviderKey): string | undefined {
  const text = safeText(value, 180);
  if (!text) {
    return undefined;
  }

  const expectedProfilePointer = `broker:provider_profile:${providerKey}`;
  if (text === expectedProfilePointer) {
    return text;
  }

  return undefined;
}

function safeProviderActionSourcePointer(
  value: unknown,
  action: 'provider_auth_start' | 'provider_switch' | 'provider_revoke' | 'provider_mint_grant',
  providerKey: IEvaosProviderKey
): string | undefined {
  const text = safeText(value, 180);
  if (!text) {
    return undefined;
  }

  const expectedActionPointer = `broker:${action}:${providerKey}`;
  return text === expectedActionPointer ? text : undefined;
}

function safeBusinessBrowserActionSourcePointer(
  value: unknown,
  action: 'browser_open_url' | 'browser_stop',
  customerId: string
): string | undefined {
  const text = safeText(value, 220);
  if (!text) {
    return undefined;
  }

  const expectedActionPointer = `broker:${action}:${customerId}`;
  return text === expectedActionPointer ? text : undefined;
}

function safeBusinessBrowserRuntimeSourcePointer(value: unknown): string | undefined {
  const text = safeText(value, 220);
  if (!text) {
    return undefined;
  }

  return text === 'broker:runtime_status:browser' ? text : undefined;
}

function safeExactSourcePointer(value: unknown, expected: string): string | undefined {
  const text = safeText(value, 220);
  if (!text) {
    return undefined;
  }

  return text === expected ? text : undefined;
}

function safeCompanyBrainIngestionState(value: unknown): IEvaosCompanyBrainIngestionState | undefined {
  const text = safeText(value, 80)?.toLowerCase();
  if (text === 'ready' || text === 'empty' || text === 'ingesting' || text === 'error') {
    return text;
  }
  if (text === 'running' || text === 'indexing' || text === 'pending') {
    return 'ingesting';
  }
  if (text === 'failed' || text === 'blocked') {
    return 'error';
  }
  return undefined;
}

function safeCompanyBrainExceptionSeverity(value: unknown): IEvaosCompanyBrainExceptionSeverity | undefined {
  const text = safeText(value, 80)?.toLowerCase();
  if (text === 'critical' || text === 'warning' || text === 'info') {
    return text;
  }
  if (text === 'error' || text === 'high') {
    return 'critical';
  }
  return undefined;
}

function hasOpaqueProviderHandle(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function safeText(value: unknown, maxLength = MAX_SAFE_TEXT_LENGTH): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || containsSecretMaterial(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function safeIsoDate(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : undefined;
  if (!text || containsSecretMaterial(text)) {
    return undefined;
  }
  const time = Date.parse(text);
  if (!Number.isFinite(time)) {
    return undefined;
  }
  return new Date(time).toISOString();
}

function safeRawSecret(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function containsSecretMaterial(value: string): boolean {
  return SECRET_FIELD_PATTERN.test(value) || SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stripUndefined<T extends Record<string, unknown>>(record: T): T {
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) {
      delete record[key];
    }
  }
  return record;
}

function brokerHttpMessage(status: number): string {
  if (status === 401 || status === 403) {
    return 'The evaOS broker denied this desktop session. Sign in again.';
  }
  if (status === 404) {
    return 'The evaOS broker endpoint was not found.';
  }
  if (status >= 500) {
    return 'The evaOS broker is temporarily unavailable.';
  }
  return 'The evaOS broker rejected the request.';
}
