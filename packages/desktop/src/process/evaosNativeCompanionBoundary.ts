/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EVAOS_BETA_IDENTITY } from './evaosBetaSafety';

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

export interface EvaosLocalActionBoundaryDecision {
  allowed: boolean;
  reason: string;
}

export const EVAOS_NATIVE_COMPANION_BOUNDARY_VERSION = '2026-06-04.issue-11';

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
  releasedWorkbenchFallback: {
    owner: 'released-workbench-fallback',
    requiredUntil: 'signed beta passes issue #12 packaging, rollback, and support gates',
  },
  callbackPolicy: {
    acceptedProtocolScheme: EVAOS_BETA_IDENTITY.protocolScheme,
    mainProcessValidatesScheme: true,
    rendererReceivesCallbackSecrets: false,
    sessionCacheOwner: 'evaos-broker',
  },
  betaReleaseNote:
    'evaOS Workbench Beta is a shell/workflow compositor. Mac pairing, TCC/local control, secure callbacks, signed helpers, local credential custody, and local machine audit authority remain in the evaOS native companion and broker-backed Workbench fallback.',
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
