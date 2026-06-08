/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type IEvaosRuntimeKey =
  | 'openclaw'
  | 'hermes'
  | 'paperclip'
  | 'browser'
  | 'terminal'
  | 'opendesign'
  | 'creative_studio'
  | 'team_chat';

export type IEvaosBrokerSessionState = 'missing' | 'authenticated' | 'expired';

export interface IEvaosBrokerSessionStatus {
  state: IEvaosBrokerSessionState;
  authenticated: boolean;
  expired: boolean;
  sessionKey?: string;
  sessionEpoch?: number;
  userEmail?: string;
  expiresAt?: string;
  source: 'none' | 'environment' | 'memory' | 'callback' | 'workbench-keychain';
  message: string;
}

export interface IEvaosBrokerClaimDeviceCodeRequest {
  deviceCode: string;
}

export interface IEvaosBrokerBeginDesktopAuthResult {
  authUrl: string;
  callbackUrl: string;
  fallbackDeviceCode: string;
  message: string;
}

export interface IEvaosCustomerTargetView {
  customerId: string;
  displayName: string;
  email?: string;
  status?: string;
  healthStatus?: string;
  isDefault: boolean;
}

export interface IEvaosCustomerTargetsView {
  roles: string[];
  scopes: IEvaosAccountPolicyScope[];
  isOperator: boolean;
  defaultCustomerId?: string;
  selectedCustomerId?: string;
  customers: IEvaosCustomerTargetView[];
  summaryText: string;
}

export interface IEvaosRuntimeStatusRequest {
  customerId: string;
  runtime: IEvaosRuntimeKey;
}

export type IEvaosRuntimeActionType = 'launch' | 'attach' | 'open';

export interface IEvaosRuntimeActionRequest {
  customerId: string;
  runtime: IEvaosRuntimeKey;
  action: IEvaosRuntimeActionType;
}

export interface IEvaosSafeUrlSummary {
  scheme?: string;
  host?: string;
  path?: string;
  displayText: string;
  redacted: boolean;
}

export interface IEvaosRuntimeStatusView {
  schemaVersion?: string;
  customerAccountId?: string;
  customerId: string;
  runtimeKey: IEvaosRuntimeKey;
  displayLabel: string;
  status: string;
  healthSummary?: string;
  lastCheckedAt?: string;
  roomId?: string;
  currentUrlSummary?: IEvaosSafeUrlSummary;
  owner?: string;
  authNeeded?: boolean;
  captchaNeeded?: boolean;
  waitingOnUser?: boolean;
  controlSessionActive?: boolean;
  updateAvailable?: boolean;
  lastActivityAt?: string;
  actions?: string[];
  sourcePointer?: string;
  auditId?: string;
}

export interface IEvaosRuntimeSurfaceView {
  schemaVersion: 'evaos.runtime_surface.v1';
  surfaceId: string;
  surfaceUri: string;
  customerId: string;
  runtimeKey: IEvaosRuntimeKey;
  displayLabel: string;
  status: string;
  sourcePointer?: string;
  auditId?: string;
  expiresAt?: string;
}

export interface IEvaosRuntimeActionResult {
  status: string;
  runtimeKey: IEvaosRuntimeKey;
  customerId: string;
  message?: string;
  urlSummary?: IEvaosSafeUrlSummary;
  runtimeSurface?: IEvaosRuntimeSurfaceView;
  runtimeStatus?: IEvaosRuntimeStatusView;
  expiresAt?: string;
  sourcePointer?: string;
  auditId?: string;
  backendEnforced: boolean;
}

export type IEvaosNativeCompanionReadiness = 'ready' | 'repair_required' | 'unavailable';
export type IEvaosNativeCompanionStatusValue =
  | 'ready'
  | 'available'
  | 'repair_required'
  | 'missing'
  | 'unavailable'
  | 'error';

export interface IEvaosNativeCompanionPermissionView {
  accessibility?: string;
  screenRecording?: string;
}

export interface IEvaosNativeCompanionStatusView {
  schemaVersion: 'evaos.native_companion_status.v1';
  generatedAt: string;
  readiness: IEvaosNativeCompanionReadiness;
  summaryText: string;
  sourcePointer: string;
  canOpenReleasedWorkbench: boolean;
  releasedWorkbench: {
    installed: boolean;
    running?: boolean;
    path?: string;
    bundleId?: string;
    version?: string;
    displayName?: string;
  };
  bridgeCli: {
    installed: boolean;
    status: IEvaosNativeCompanionStatusValue;
    path?: string;
    auditId?: string;
    permissions?: IEvaosNativeCompanionPermissionView;
    readOnly: boolean;
  };
  customerMac: {
    status: IEvaosNativeCompanionStatusValue;
    auditId?: string;
    deviceLabel?: string;
    permissions?: IEvaosNativeCompanionPermissionView;
    screenSharing?: string;
    killSwitchAvailable?: boolean;
    appendOnlyAuditLog?: boolean;
  };
  iPhone: {
    status: IEvaosNativeCompanionStatusValue;
    auditId?: string;
    installed?: boolean;
    running?: boolean;
    killSwitchAvailable?: boolean;
  };
  audit: {
    status: IEvaosNativeCompanionStatusValue;
    auditIds: string[];
    latestAuditId?: string;
  };
}

export interface IEvaosNativeCompanionOpenResult {
  opened: boolean;
  message: string;
  path?: string;
}

export interface IEvaosBusinessBrowserRequest {
  customerId: string;
}

export interface IEvaosBusinessBrowserOpenUrlRequest {
  customerId: string;
  url: string;
}

export interface IEvaosBusinessBrowserView {
  schemaVersion: 'evaos.browser_status.v1';
  customerId: string;
  customerAccountId?: string;
  membershipId?: string;
  membershipRole?: IEvaosAccountPolicyRole;
  routeDenied: boolean;
  routeDenialReason?: string;
  backendEnforced: boolean;
  displayLabel: string;
  status: string;
  healthSummary?: string;
  currentUrlSummary?: IEvaosSafeUrlSummary;
  authNeeded: boolean;
  captchaNeeded: boolean;
  waitingOnUser: boolean;
  controlSessionActive: boolean;
  canLaunch: boolean;
  canOpenUrl: boolean;
  canStop: boolean;
  lastCheckedAt?: string;
  lastActivityAt?: string;
  actions: string[];
  sourcePointer?: string;
  auditId?: string;
  policyAuditId?: string;
}

export interface IEvaosBusinessBrowserActionResult {
  status: string;
  message?: string;
  browser?: IEvaosBusinessBrowserView;
  urlSummary?: IEvaosSafeUrlSummary;
  runtimeSurface?: IEvaosRuntimeSurfaceView;
  sourcePointer?: string;
  auditId?: string;
  backendEnforced: boolean;
}

export type IEvaosCompanyBrainIngestionState = 'ready' | 'empty' | 'ingesting' | 'error';
export type IEvaosCompanyBrainExceptionSeverity = 'critical' | 'warning' | 'info';

export interface IEvaosCompanyBrainDirectoryRequest {
  customerId: string;
}

export interface IEvaosCompanyBrainAccountRequest {
  customerId: string;
  accountId: string;
}

export interface IEvaosCompanyBrainQueryRequest {
  customerId: string;
  accountId: string;
  query: string;
}

export interface IEvaosCompanyBrainIntegrationHealthView {
  state: IEvaosCompanyBrainIngestionState;
  summary?: string;
  updatedAt?: string;
}

export interface IEvaosCompanyBrainAccountSummaryView {
  accountId: string;
  name: string;
  domain?: string;
  customerAccountId?: string;
  owner?: string;
  ingestionState: IEvaosCompanyBrainIngestionState;
  exceptionCount: number;
  lastActivityAt?: string;
  sourcePointer?: string;
  auditId?: string;
}

export interface IEvaosCompanyBrainDirectoryView {
  schemaVersion: 'evaos.company_brain.directory.v1';
  customerId: string;
  customerAccountId?: string;
  membershipId?: string;
  membershipRole?: IEvaosAccountPolicyRole;
  routeDenied: boolean;
  routeDenialReason?: string;
  backendEnforced: boolean;
  ingestionState: IEvaosCompanyBrainIngestionState;
  integrationHealth?: IEvaosCompanyBrainIntegrationHealthView;
  accounts: IEvaosCompanyBrainAccountSummaryView[];
  summaryText: string;
  sourcePointer?: string;
  auditId?: string;
  policyAuditId?: string;
}

export interface IEvaosCompanyBrainBriefView {
  title?: string;
  summary?: string;
  updatedAt?: string;
  sourcePointer?: string;
  auditId?: string;
}

export interface IEvaosCompanyBrainTimelineEntryView {
  entryId: string;
  type: string;
  title: string;
  summary?: string;
  occurredAt?: string;
  sourcePointer?: string;
  auditId?: string;
}

export interface IEvaosCompanyBrainExceptionView {
  exceptionId: string;
  severity: IEvaosCompanyBrainExceptionSeverity;
  title: string;
  summary?: string;
  status: string;
  sourcePointer?: string;
  auditId?: string;
}

export interface IEvaosCompanyBrainAccount360View {
  schemaVersion: 'evaos.company_brain.account_360.v1';
  customerId: string;
  customerAccountId?: string;
  membershipId?: string;
  membershipRole?: IEvaosAccountPolicyRole;
  routeDenied: boolean;
  routeDenialReason?: string;
  backendEnforced: boolean;
  accountId: string;
  account: IEvaosCompanyBrainAccountSummaryView;
  ingestionState: IEvaosCompanyBrainIngestionState;
  brief?: IEvaosCompanyBrainBriefView;
  timeline: IEvaosCompanyBrainTimelineEntryView[];
  exceptions: IEvaosCompanyBrainExceptionView[];
  sourcePointer?: string;
  auditId?: string;
  policyAuditId?: string;
}

export interface IEvaosCompanyBrainCitationView {
  citationId: string;
  title?: string;
  sourceType?: string;
  occurredAt?: string;
  sourcePointer?: string;
}

export interface IEvaosCompanyBrainQueryResult {
  schemaVersion: 'evaos.company_brain.query.v1';
  customerId: string;
  customerAccountId?: string;
  accountId: string;
  status: string;
  answer?: string;
  citations: IEvaosCompanyBrainCitationView[];
  sourcePointer?: string;
  auditId?: string;
  backendEnforced: boolean;
}

export type IEvaosAccountPolicyRole =
  | 'owner'
  | 'admin'
  | 'billing_admin'
  | 'technical_admin'
  | 'manager'
  | 'member'
  | 'agent_only'
  | 'support';

export type IEvaosAccountPolicyScope =
  | 'manage_members'
  | 'manage_billing'
  | 'manage_integrations'
  | 'approve_actions'
  | 'open_business_browser'
  | 'use_creative_studio'
  | 'use_design_workspace'
  | 'view_company_brain'
  | 'manage_company_brain'
  | 'assign_agents'
  | 'access_openclaw_dashboard'
  | 'access_hermes_dashboard'
  | 'access_terminal'
  | 'access_technical_diagnostics';

export interface IEvaosPeopleAccessPolicyRequest {
  customerId: string;
}

export interface IEvaosPeopleAccessMemberView {
  memberId: string;
  email?: string;
  displayName?: string;
  role: IEvaosAccountPolicyRole;
  seatType?: string;
  status: string;
  joinedAt?: string;
  lastActiveAt?: string;
}

export interface IEvaosPeopleAccessInviteView {
  inviteId: string;
  email: string;
  role: IEvaosAccountPolicyRole;
  status: string;
  expiresAt?: string;
  invitedAt?: string;
}

export interface IEvaosPeopleAccessPolicyView {
  schemaVersion: 'evaos.account_policy.v1';
  customerAccountId: string;
  selectedCustomerId: string;
  membershipId?: string;
  membershipRole: IEvaosAccountPolicyRole;
  planCode?: string;
  seatLimit?: number;
  activeSeats?: number;
  invitedSeats?: number;
  scopes: IEvaosAccountPolicyScope[];
  advancedSurfaces: Record<string, boolean>;
  members: IEvaosPeopleAccessMemberView[];
  invites: IEvaosPeopleAccessInviteView[];
  routeDenied: boolean;
  routeDenialReason?: string;
  backendEnforced: boolean;
  updatedAt?: string;
  auditId?: string;
}

export interface IEvaosPeopleAccessInviteMemberRequest {
  customerId: string;
  email: string;
  role: IEvaosAccountPolicyRole;
  seatType?: string;
}

export interface IEvaosPeopleAccessMutationResult {
  status: string;
  message?: string;
  inviteId?: string;
  memberId?: string;
  auditId?: string;
  backendEnforced: boolean;
}

export type IEvaosProviderKey =
  | 'openai_codex'
  | 'openclaw'
  | 'hermes'
  | 'google_workspace'
  | 'pipedream'
  | 'slack'
  | 'notion'
  | 'linear'
  | 'github';

export type IEvaosProviderStatus =
  | 'connected'
  | 'needs_login'
  | 'approval_required'
  | 'planned'
  | 'revoked'
  | 'expired'
  | 'error';
export type IEvaosProviderAgentRuntime = 'openclaw' | 'hermes';

export interface IEvaosProviderHubRequest {
  customerId: string;
}

export interface IEvaosProviderActionRequest {
  customerId: string;
  providerKey: IEvaosProviderKey;
  agentRuntime?: IEvaosProviderAgentRuntime;
}

export type IEvaosProviderApprovalRequestedAction = 'provider_mint_grant' | 'provider_revoke';

export interface IEvaosProviderApprovalRequest {
  customerId: string;
  providerKey: IEvaosProviderKey;
  requestedAction: IEvaosProviderApprovalRequestedAction;
  agentRuntime?: IEvaosProviderAgentRuntime;
}

export interface IEvaosProviderProfileView {
  providerKey: IEvaosProviderKey;
  title: string;
  subtitle?: string;
  status: IEvaosProviderStatus;
  active: boolean;
  rawSecretsStoredInWorkbench: boolean;
  approvalRequired: boolean;
  capabilities: string[];
  usageSummary?: string;
  customerAccountId?: string;
  ownerKind?: string;
  ownerUserId?: string;
  grantedScopes: string[];
  expiresAt?: string;
  accountLabel?: string;
  lastCheckedAt?: string;
  sourcePointer?: string;
  auditId?: string;
  lastValidatedAt?: string;
  hasConnectionProof: boolean;
  hasBrokeredGrant: boolean;
  summaryText: string;
}

export interface IEvaosProviderHubView {
  schemaVersion: 'evaos.provider_hub.v1';
  customerId: string;
  customerAccountId?: string;
  membershipId?: string;
  membershipRole?: IEvaosAccountPolicyRole;
  routeDenied: boolean;
  routeDenialReason?: string;
  backendEnforced: boolean;
  activeProviderKey?: IEvaosProviderKey;
  profiles: IEvaosProviderProfileView[];
  summaryText: string;
  sourcePointer?: string;
  auditId?: string;
  policyAuditId?: string;
}

export interface IEvaosProviderActionResult {
  status: string;
  providerKey: IEvaosProviderKey;
  message?: string;
  authUrlSummary?: IEvaosSafeUrlSummary;
  expiresAt?: string;
  providerHub?: IEvaosProviderHubView;
  sourcePointer?: string;
  auditId?: string;
  backendEnforced: boolean;
}

export type IEvaosApprovalDecision = 'allow-once' | 'allow-always' | 'deny';
export type IEvaosApprovalScope = 'this-call' | 'this-agent';
export type IEvaosApprovalRiskClass = 'critical' | 'warning' | 'info';
export type IEvaosApprovalPreviewKind =
  | 'email_recipient'
  | 'message_recipient'
  | 'url'
  | 'file_path'
  | 'purchase'
  | 'secret_name'
  | 'budget'
  | 'permission'
  | 'missing_destination';

export interface IEvaosApprovalDestinationPreview {
  kind: IEvaosApprovalPreviewKind;
  primary: string;
  secondary?: string;
  bodyExcerpt?: string;
  warning?: string;
  actionable: boolean;
}

export interface IEvaosApprovalDestinationProof {
  kind: IEvaosApprovalPreviewKind;
  fingerprint: string;
  summary: string;
  source: string;
  sourcePointer?: string;
}

export interface IEvaosApprovalRuntimeResult {
  status: string;
  runtime?: string;
  sourcePointer?: string;
  auditId?: string;
}

export interface IEvaosApprovalRequestView {
  approvalId: string;
  ownerId?: string;
  agentId: string;
  requesterMembershipId?: string;
  toolName: string;
  riskClass: IEvaosApprovalRiskClass;
  destinationPreview: IEvaosApprovalDestinationPreview;
  destinationProof?: IEvaosApprovalDestinationProof;
  allowAlwaysSupported: boolean;
  availableDecisions: IEvaosApprovalDecision[];
  canAllowOnce: boolean;
  canAllowAlways: boolean;
  canDeny: boolean;
  createdAt: string;
  expiresAt?: string;
  sourcePointer: string;
  auditId?: string;
  nextAction: string;
}

export interface IEvaosApprovalCenterRequest {
  customerId: string;
  limit?: number;
}

export interface IEvaosApprovalCenterView {
  schemaVersion: 'evaos.approval_center.v1';
  customerId: string;
  customerAccountId?: string;
  membershipId?: string;
  membershipRole?: IEvaosAccountPolicyRole;
  routeDenied: boolean;
  routeDenialReason?: string;
  backendEnforced: boolean;
  requests: IEvaosApprovalRequestView[];
  summaryText: string;
  sourcePointer?: string;
  auditId?: string;
  policyAuditId?: string;
}

export interface IEvaosApprovalDenyRequest {
  customerId: string;
  approvalId: string;
  reason?: string;
}

export interface IEvaosApprovalDecisionResult {
  status: string;
  decision: IEvaosApprovalDecision;
  scope: IEvaosApprovalScope;
  approvalId: string;
  request?: IEvaosApprovalRequestView;
  runtimeResult?: IEvaosApprovalRuntimeResult;
  sourcePointer?: string;
  auditId?: string;
  backendEnforced: boolean;
}
