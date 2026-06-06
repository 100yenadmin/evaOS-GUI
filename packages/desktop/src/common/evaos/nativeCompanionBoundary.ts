/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EVAOS_BETA_IDENTITY } from './betaIdentity';

export type EvaosTrustOwner =
  | 'aionui-shell'
  | 'evaos-broker'
  | 'evaos-native-companion'
  | 'released-workbench-fallback';

export interface EvaosBoundaryCapability {
  id: string;
  owner: EvaosTrustOwner;
  shellMay: readonly string[];
  shellMustNot: readonly string[];
  proofRequired: readonly string[];
}

export type EvaosNativeCompanionStatusKey =
  | 'not_installed'
  | 'not_paired'
  | 'permission_needed'
  | 'ready'
  | 'unavailable';

export type EvaosNativeCompanionStatusSeverity = 'blocked' | 'warning' | 'ready';

export interface EvaosNativeCompanionStatusScenario {
  key: EvaosNativeCompanionStatusKey;
  label: string;
  severity: EvaosNativeCompanionStatusSeverity;
  summary: string;
  statusSource: string;
  evidence: readonly string[];
  handoff: {
    label: string;
    owner: EvaosTrustOwner;
    enabled: boolean;
    target: string;
  };
}

export interface EvaosLocalActionBoundaryDecision {
  allowed: boolean;
  reason: string;
}

export interface EvaosNativeCompanionCanary {
  id: string;
  command: string;
  requiredArtifact: string;
  forbidsSkips: boolean;
}

export const EVAOS_NATIVE_COMPANION_BOUNDARY_VERSION = '2026-06-06.rc-parity';

export const EVAOS_NATIVE_COMPANION_CANARIES = [
  {
    id: 'pre-canary-bridge-peekaboo',
    command:
      'PYTHONPATH=src python3 -m evaos_desktop_bridge.pre_canary --json --control-surface bridge-peekaboo',
    requiredArtifact: 'qa-report.json',
    forbidsSkips: true,
  },
  {
    id: 'connector-all',
    command:
      'PYTHONPATH=src python3 -m evaos_desktop_bridge.qa_canary --surface connector --suite all --operator-ack-live-control',
    requiredArtifact: 'qa-report.json',
    forbidsSkips: true,
  },
  {
    id: 'openclaw-all',
    command:
      'PYTHONPATH=src python3 -m evaos_desktop_bridge.qa_canary --surface openclaw --suite all --operator-ack-live-control',
    requiredArtifact: 'qa-report.json',
    forbidsSkips: true,
  },
  {
    id: 'hermes-all',
    command:
      'PYTHONPATH=src python3 -m evaos_desktop_bridge.qa_canary --surface hermes --suite all --operator-ack-live-control',
    requiredArtifact: 'qa-report.json',
    forbidsSkips: true,
  },
  {
    id: 'connector-kill-switch',
    command:
      'PYTHONPATH=src python3 -m evaos_desktop_bridge.qa_canary --surface connector --suite kill_switch --operator-ack-live-control',
    requiredArtifact: 'qa-report.json',
    forbidsSkips: true,
  },
] satisfies readonly EvaosNativeCompanionCanary[];

export const EVAOS_FORBIDDEN_LOCAL_TRUST_ACTIONS = [
  'mac-pairing-authority',
  'mac-tcc-prompting',
  'local-input-control',
  'screen-recording-control',
  'secure-callback-exchange',
  'signed-helper-install',
  'local-machine-audit-write',
  'local-credential-vault',
] as const;

export const EVAOS_NATIVE_COMPANION_STATUS_MATRIX = [
  {
    key: 'not_installed',
    label: 'Not installed',
    severity: 'blocked',
    summary:
      'No native companion is registered for this Mac. Use the released Workbench fallback until setup proof exists.',
    statusSource: 'native-companion:missing',
    evidence: ['No native companion id', 'No helper identity', 'No local audit source'],
    handoff: {
      label: 'Install released Workbench fallback',
      owner: 'released-workbench-fallback',
      enabled: false,
      target: 'support://released-workbench-fallback',
    },
  },
  {
    key: 'not_paired',
    label: 'Not paired',
    severity: 'blocked',
    summary: 'The Mac is not paired to evaOS. Pairing codes and trust claims must come from the native companion.',
    statusSource: 'native-companion:pairing-required',
    evidence: ['Pairing audit missing', 'Broker pairing session missing'],
    handoff: {
      label: 'Open native pairing handoff',
      owner: 'evaos-native-companion',
      enabled: false,
      target: 'evaos-workbench-beta://native-companion/pair',
    },
  },
  {
    key: 'permission_needed',
    label: 'Permission needed',
    severity: 'warning',
    summary:
      'Accessibility or Screen Recording permission is missing. AionUi can show this status but cannot grant it.',
    statusSource: 'native-companion:tcc-required',
    evidence: ['Accessibility not ready', 'Screen Recording not ready', 'Permission audit missing'],
    handoff: {
      label: 'Open native permission handoff',
      owner: 'evaos-native-companion',
      enabled: false,
      target: 'evaos-workbench-beta://native-companion/permissions',
    },
  },
  {
    key: 'ready',
    label: 'Ready',
    severity: 'ready',
    summary: 'Native companion reports Mac connector readiness. AionUi may display proof and request brokered actions.',
    statusSource: 'native-companion:ready',
    evidence: ['Native companion id present', 'Helper identity verified', 'Append-only audit source present'],
    handoff: {
      label: 'Open native companion',
      owner: 'evaos-native-companion',
      enabled: true,
      target: 'evaos-workbench-beta://native-companion/status',
    },
  },
  {
    key: 'unavailable',
    label: 'Unavailable',
    severity: 'blocked',
    summary: 'Native status is offline or stale. Local control and device readiness must fail closed.',
    statusSource: 'native-companion:unavailable',
    evidence: ['Status source offline', 'Last proof is stale', 'Local action requests blocked'],
    handoff: {
      label: 'Use support and rollback path',
      owner: 'released-workbench-fallback',
      enabled: false,
      target: 'support://native-companion-unavailable',
    },
  },
] satisfies readonly EvaosNativeCompanionStatusScenario[];

export const EVAOS_NATIVE_COMPANION_BOUNDARY = {
  version: EVAOS_NATIVE_COMPANION_BOUNDARY_VERSION,
  shell: {
    owner: 'aionui-shell',
    role: 'presentation-and-workflow-composition',
    isLocalTrustAuthority: false,
    rendererReceivesNativeSecrets: false,
    rendererReceivesSessionTokens: false,
    allowedResponsibilities: [
      'render broker-provided status and proof metadata',
      'request native-companion actions through evaOS broker contracts',
      'show native-companion unavailable, denied, pending, and failed states',
      'launch evaOS beta deep links after main-process validation',
    ],
  },
  brokerCapabilities: [
    {
      id: 'desktop-session',
      owner: 'evaos-broker',
      shellMay: ['show session status', 'request session refresh', 'clear local shell session view'],
      shellMustNot: ['mint desktop sessions', 'store raw session tokens in renderer', 'log broker credentials'],
      proofRequired: ['backend_enforced', 'audit_id', 'customer_account_id'],
    },
    {
      id: 'business-browser-runtime',
      owner: 'evaos-broker',
      shellMay: ['render runtime state', 'request browser open/stop through broker actions'],
      shellMustNot: ['control a customer VM directly', 'reuse state across customers', 'expose runtime credentials'],
      proofRequired: ['backend_enforced', 'audit_id', 'source_pointer', 'customer_id', 'customer_account_id'],
    },
  ] satisfies readonly EvaosBoundaryCapability[],
  nativeCompanionCapabilities: [
    {
      id: 'mac-pairing-authority',
      owner: 'evaos-native-companion',
      shellMay: ['show pairing status', 'open broker-provided pairing handoff'],
      shellMustNot: ['issue pairing codes', 'trust a renderer-created pairing claim', 'write native pairing state'],
      proofRequired: ['native_companion_id', 'pairing_audit_id', 'broker_session_id'],
    },
    {
      id: 'mac-tcc-prompting',
      owner: 'evaos-native-companion',
      shellMay: ['show required permission state', 'link to documented setup/recovery path'],
      shellMustNot: ['prompt or bypass TCC directly', 'claim Accessibility or Screen Recording permission'],
      proofRequired: ['native_permission_status', 'native_permission_audit_id'],
    },
    {
      id: 'local-input-control',
      owner: 'evaos-native-companion',
      shellMay: ['request an audited local-control action through broker/native companion'],
      shellMustNot: ['send keystrokes', 'move pointer', 'drive local UI directly from renderer or generic IPC'],
      proofRequired: ['backend_enforced', 'native_action_audit_id', 'operator_ack'],
    },
    {
      id: 'screen-recording-control',
      owner: 'evaos-native-companion',
      shellMay: ['display native-provided status/screenshot metadata after authorization'],
      shellMustNot: ['capture screen pixels', 'stream screen content', 'persist screenshots without native audit'],
      proofRequired: ['native_capture_audit_id', 'customer_account_id', 'retention_policy'],
    },
    {
      id: 'secure-callback-exchange',
      owner: 'evaos-native-companion',
      shellMay: ['parse the evaOS beta protocol scheme', 'hand callback params to broker-owned claim flows'],
      shellMustNot: [
        'accept callback secrets in renderer',
        'complete OAuth/provider grants locally',
        'cache callback tokens',
      ],
      proofRequired: ['validated_protocol_scheme', 'broker_claim_audit_id'],
    },
    {
      id: 'signed-helper-install',
      owner: 'evaos-native-companion',
      shellMay: ['show helper installed/version/health status'],
      shellMustNot: ['install privileged helpers', 'ad-hoc sign helper code', 'mutate launch services or daemons'],
      proofRequired: ['helper_team_id', 'helper_bundle_id', 'codesign_verification', 'notarization_status'],
    },
    {
      id: 'local-machine-audit-write',
      owner: 'evaos-native-companion',
      shellMay: ['display audit ids and evidence links returned by broker/native companion'],
      shellMustNot: ['invent local audit events', 'mark local actions approved', 'write native audit truth'],
      proofRequired: ['append_only_native_audit_id', 'broker_decision_id'],
    },
    {
      id: 'local-credential-vault',
      owner: 'evaos-native-companion',
      shellMay: ['show connected/expired/revoked status from broker/provider hub'],
      shellMustNot: ['store provider secrets', 'read keychain items', 'decrypt native callbacks or grants'],
      proofRequired: ['broker_grant_id', 'provider_audit_id'],
    },
  ] satisfies readonly EvaosBoundaryCapability[],
  rcCanaries: EVAOS_NATIVE_COMPANION_CANARIES,
  releasedWorkbenchFallback: {
    owner: 'released-workbench-fallback',
    requiredUntil: 'exact RC candidate passes native adapter, release, rollback, and support gates',
  },
  callbackPolicy: {
    acceptedProtocolScheme: EVAOS_BETA_IDENTITY.protocolScheme,
    mainProcessValidatesScheme: true,
    rendererReceivesCallbackSecrets: false,
    sessionCacheOwner: 'evaos-broker',
  },
  betaReleaseNote:
    'evaOS Workbench Beta is a shell/workflow compositor. Mac pairing, TCC/local control, secure callbacks, signed helpers, local credential custody, and local machine audit authority remain in the evaOS native companion and broker-backed Workbench fallback until exact-candidate native canaries pass.',
} as const;

export function canEvaosShellPerformLocalTrustAction(actionId: string): EvaosLocalActionBoundaryDecision {
  if ((EVAOS_FORBIDDEN_LOCAL_TRUST_ACTIONS as readonly string[]).includes(actionId)) {
    return {
      allowed: false,
      reason: `${actionId} is native-companion owned; AionUi may only request or render broker/native proof.`,
    };
  }

  return {
    allowed: false,
    reason: 'Unknown local trust actions fail closed until the native companion contract explicitly allows them.',
  };
}

export function getEvaosNativeCompanionBoundaryViolations(): string[] {
  const violations: string[] = [];

  if (EVAOS_NATIVE_COMPANION_BOUNDARY.shell.isLocalTrustAuthority) {
    violations.push('AionUi shell is marked as local trust authority.');
  }

  if (EVAOS_NATIVE_COMPANION_BOUNDARY.shell.rendererReceivesNativeSecrets) {
    violations.push('Renderer is allowed to receive native secrets.');
  }

  if (EVAOS_NATIVE_COMPANION_BOUNDARY.shell.rendererReceivesSessionTokens) {
    violations.push('Renderer is allowed to receive session tokens.');
  }

  for (const capability of EVAOS_NATIVE_COMPANION_BOUNDARY.nativeCompanionCapabilities) {
    if (capability.owner !== 'evaos-native-companion') {
      violations.push(`${capability.id} is not owned by the native companion.`);
    }
    if (capability.proofRequired.length === 0) {
      violations.push(`${capability.id} has no proof requirements.`);
    }
  }

  for (const actionId of EVAOS_FORBIDDEN_LOCAL_TRUST_ACTIONS) {
    const capability = EVAOS_NATIVE_COMPANION_BOUNDARY.nativeCompanionCapabilities.find(
      (entry) => entry.id === actionId
    );
    if (!capability) {
      violations.push(`${actionId} is forbidden but missing from native-companion capabilities.`);
    }
  }

  if (EVAOS_NATIVE_COMPANION_BOUNDARY.callbackPolicy.rendererReceivesCallbackSecrets) {
    violations.push('Renderer is allowed to receive callback secrets.');
  }

  if (EVAOS_NATIVE_COMPANION_BOUNDARY.callbackPolicy.acceptedProtocolScheme !== EVAOS_BETA_IDENTITY.protocolScheme) {
    violations.push('Callback protocol scheme is not aligned with evaOS beta identity.');
  }

  return violations;
}
