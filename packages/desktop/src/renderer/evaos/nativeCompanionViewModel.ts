/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IEvaosNativeCompanionAction,
  IEvaosNativeCompanionActionResult,
  IEvaosNativeCompanionAgentPairingStatus,
  IEvaosNativeCompanionPermissionView,
  IEvaosNativeCompanionRepairAction,
  IEvaosNativeCompanionStatusView,
} from '@/common/evaos/bridgeTypes';

export type NativeCompanionUserState =
  | 'ready'
  | 'repair_required'
  | 'not_paired'
  | 'permission_needed'
  | 'offline'
  | 'unsupported';

export type NativeCompanionTone = 'ready' | 'attention' | 'offline' | 'neutral';

export type NativeCompanionPrimaryActionKind = 'refresh' | 'none';
export type NativeCompanionNextActionKind = 'run' | 'repair' | 'refresh' | 'reconnect' | 'copy' | 'none';

export interface NativeCompanionReadinessItem {
  label: string;
  value: string;
  tone: NativeCompanionTone;
  help: string;
}

export interface NativeCompanionRepairStep {
  title: string;
  detail: string;
  state: NativeCompanionTone;
}

export interface NativeCompanionPrimaryAction {
  kind: NativeCompanionPrimaryActionKind;
  label: string;
  disabled: boolean;
  detail: string;
}

export interface NativeCompanionNextAction {
  kind: NativeCompanionNextActionKind;
  label: string;
  title: string;
  detail: string;
  step: number;
  totalSteps: number;
  disabled: boolean;
  action?: IEvaosNativeCompanionAction;
  repairAction?: IEvaosNativeCompanionRepairAction;
  mode?: 'full-access' | 'ask-permission';
}

export interface NativeCompanionRepairViewModel {
  state: NativeCompanionUserState;
  title: string;
  summary: string;
  statusLabel: string;
  statusTone: NativeCompanionTone;
  readinessStrip: NativeCompanionReadinessItem[];
  repairSteps: NativeCompanionRepairStep[];
  primaryAction: NativeCompanionPrimaryAction;
  nextAction: NativeCompanionNextAction;
  supportText: string;
  reportedSummary?: string;
}

export interface NativeCompanionRepairViewModelInput {
  status: IEvaosNativeCompanionStatusView | null | undefined;
  loading: boolean;
  error: string | null | undefined;
  hasSelectedCustomer?: boolean;
  hasPairableCustomer?: boolean;
  brokerAuthenticated?: boolean;
  brokerSessionLoading?: boolean;
  actionResult?: IEvaosNativeCompanionActionResult | null;
  pairingPromptCopied?: boolean;
  permissionGuideDetail: string;
  prerequisiteCopy: NativeCompanionPrerequisiteCopy;
}

export type NativeCompanionPrerequisiteCopy = {
  repairWorkbenchTitle: string;
  repairWorkbenchMissingDetail: string;
  repairWorkbenchIncompatibleDetail: string;
  repairControlToolsTitle: string;
  repairControlToolsDetail: string;
  clientMissingTitle: string;
  clientMissingDetail: string;
  clientStoppedTitle: string;
  clientStoppedDetail: string;
  unenrolledTitle: string;
  unenrolledDetail: string;
  wrongControlPlaneTitle: string;
  wrongControlPlaneDetail: string;
  aclBlockedTitle: string;
  aclBlockedDetail: string;
  offlineTitle: string;
  offlineDetail: string;
  errorTitle: string;
  errorDetail: string;
  refreshSessionLabel: string;
  refreshSessionTitle: string;
  refreshSessionDetail: string;
  checkingSessionLabel: string;
  checkingSessionTitle: string;
  checkingSessionDetail: string;
  signInLabel: string;
  signInTitle: string;
  signInDetail: string;
  selectCustomerLabel: string;
  selectCustomerTitle: string;
  selectCustomerDetail: string;
  chooseMacTargetLabel: string;
  chooseMacTargetTitle: string;
  chooseMacTargetDetail: string;
};

const PAIRING_PATTERN = /\b(?:not[_ -]?paired|pairing[_ -]?required|pairing required|device identity changed)\b/i;
const OFFLINE_PATTERN = /\b(?:offline|unavailable|stale|could not be reached|status source required)\b/i;
const UNSUPPORTED_PATTERN = /\b(?:unsupported|not supported)\b/i;

export function getNativeCompanionRepairViewModel(
  input: NativeCompanionRepairViewModelInput
): NativeCompanionRepairViewModel {
  const state = collapseNativeCompanionState(input);
  const statusTone = toneForState(state, input.status);
  const reportedSummary = safeReportedSummary(input);

  return {
    state,
    title: titleForState(state, input.loading, input.status, input.prerequisiteCopy),
    summary: summaryForState(state, input.loading, input.status, input.prerequisiteCopy),
    statusLabel: labelForState(state, input.loading, input.status),
    statusTone,
    readinessStrip: readinessStripForState(input.status, state, input.loading),
    repairSteps: repairStepsForState(input.status, state),
    primaryAction: primaryActionForState(state, input.loading),
    nextAction: nextActionForState(input, state),
    supportText:
      'Need help? Use Report to support. Support diagnostics can reveal audit IDs and canary status without exposing secrets.',
    reportedSummary,
  };
}

export function collapseNativeCompanionState(input: NativeCompanionRepairViewModelInput): NativeCompanionUserState {
  const { status, error } = input;
  if (!status) return 'offline';
  const haystack = statusText(status, error);

  if (localMacAccessReady(status)) return 'ready';
  if (hasBlockingReadinessActionResult(input.actionResult) || hasBlockingStatusError(status)) return 'repair_required';
  if (!status.releasedWorkbench.installed && !status.bridgeCli.installed) return 'unsupported';
  if (PAIRING_PATTERN.test(haystack)) return 'not_paired';
  if (permissionsNeedRepair(status.bridgeCli.permissions) || permissionsNeedRepair(status.customerMac.permissions)) {
    return 'permission_needed';
  }
  if (status.readiness === 'unavailable' || OFFLINE_PATTERN.test(haystack)) return 'offline';
  if (UNSUPPORTED_PATTERN.test(haystack)) return 'unsupported';
  return 'repair_required';
}

function titleForState(
  state: NativeCompanionUserState,
  loading: boolean,
  status: IEvaosNativeCompanionStatusView | null | undefined,
  copy: NativeCompanionPrerequisiteCopy
): string {
  if (loading) return 'Checking Mac control';
  const prerequisite = blockingPrerequisite(status, copy);
  if (prerequisite) return prerequisite.title;
  if (state !== 'ready' && secureConnectorLinkRequired(status)) return 'Connect secure Mac link';
  switch (state) {
    case 'ready':
      return runtimeToolsReady(status) ? 'Mac control is ready' : 'This Mac is locally ready';
    case 'not_paired':
      return 'Pair this Mac';
    case 'permission_needed':
      return 'Allow Mac control';
    case 'offline':
      return 'Reconnect Mac control';
    case 'unsupported':
      return 'Set up Mac control';
    case 'repair_required':
      return 'Repair Mac access';
  }
}

function summaryForState(
  state: NativeCompanionUserState,
  loading: boolean,
  status: IEvaosNativeCompanionStatusView | null | undefined,
  copy: NativeCompanionPrerequisiteCopy
): string {
  if (loading) return 'Checking the Workbench connector before evaOS or Hermes uses local Mac control.';
  const prerequisite = blockingPrerequisite(status, copy);
  if (prerequisite) return prerequisite.summary;
  if (state !== 'ready' && secureConnectorLinkRequired(status)) {
    return 'Local Mac permissions and connector status are ready, but this Mac still needs the broker-owned private connector link before Workbench can connect Mac control.';
  }
  switch (state) {
    case 'ready':
      return runtimeToolsReady(status)
        ? 'End-to-end broker and runtime tool proof is ready for evaOS/OpenClaw and Hermes Mac control.'
        : 'Local Workbench connector and macOS permissions are ready, but Jane/OpenClaw and Hermes are not proven end to end. Run the setup check before treating Mac control as ready.';
    case 'not_paired':
      return 'This Mac needs a fresh Workbench connector grant before evaOS or Hermes chat can use Mac control.';
    case 'permission_needed':
      return 'macOS Accessibility or Screen Recording needs attention before approved local-control actions can run.';
    case 'offline':
      return 'Mac control status is offline or stale. Refresh the status or use the support repair path before starting local-control chat.';
    case 'unsupported':
      return 'Mac control is not available on this Mac yet. Use setup or support before continuing.';
    case 'repair_required':
      return 'Workbench connector is installed, but Mac access needs repair before evaOS or Hermes can use local control.';
  }
}

function labelForState(
  state: NativeCompanionUserState,
  loading: boolean,
  status: IEvaosNativeCompanionStatusView | null | undefined
): string {
  if (loading) return 'checking';
  if (state === 'ready' && !runtimeToolsReady(status)) return 'local ready';
  return state;
}

function toneForState(
  state: NativeCompanionUserState,
  status: IEvaosNativeCompanionStatusView | null | undefined
): NativeCompanionTone {
  if (state === 'ready') return runtimeToolsReady(status) ? 'ready' : 'attention';
  if (state === 'offline' || state === 'unsupported') return 'offline';
  return 'attention';
}

function readinessStripForState(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState,
  loading: boolean
): NativeCompanionReadinessItem[] {
  return [
    {
      label: 'Connector',
      value: connectorValue(status, state, loading),
      tone: connectorTone(status, state, loading),
      help: 'Secure local connector status reported by Workbench.',
    },
    {
      label: 'Agent runtime',
      value: pairingValue(status, state),
      tone: pairingTone(status, state),
      help: 'End-to-end broker grant and runtime tool proof for evaOS/OpenClaw and Hermes.',
    },
    {
      label: 'Permissions',
      value: permissionsValue(status, state, loading),
      tone: permissionsTone(status, state, loading),
      help: 'Accessibility and Screen Recording readiness for approved local-control actions.',
    },
  ];
}

function repairStepsForState(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState
): NativeCompanionRepairStep[] {
  return [
    {
      title: 'Turn on Mac access',
      detail: connectorStepDetail(status, state),
      state: connectorTone(status, state, false),
    },
    {
      title: 'Allow screen and control',
      detail: permissionsStepDetail(status, state),
      state: permissionsTone(status, state, false),
    },
    {
      title: 'Connect Mac control',
      detail: pairingStepDetail(status, state),
      state: state === 'ready' || state === 'not_paired' ? pairingTone(status, state) : 'neutral',
    },
    {
      title: 'Test Mac control',
      detail: 'Run a setup check and one approved low-impact action from evaOS/OpenClaw and Hermes.',
      state: state === 'ready' && runtimeToolsReady(status) ? 'ready' : 'neutral',
    },
    {
      title: 'Stop or revoke access',
      detail: 'Stop active control after testing, or use the kill switch if agent control should fail closed.',
      state: status?.controlSession?.active ? 'attention' : state === 'ready' ? 'ready' : 'neutral',
    },
  ];
}

function primaryActionForState(state: NativeCompanionUserState, loading: boolean): NativeCompanionPrimaryAction {
  if (loading) {
    return {
      kind: 'none',
      label: 'Checking...',
      disabled: true,
      detail: 'Mac control status is still loading.',
    };
  }

  if (state === 'ready' || state === 'offline') {
    return {
      kind: 'refresh',
      label: 'Refresh status',
      disabled: false,
      detail: 'Refresh the read-only Mac control proof.',
    };
  }

  return {
    kind: 'refresh',
    label: 'Check again',
    disabled: false,
    detail: 'Refresh Mac control status after repairing macOS permissions or pairing.',
  };
}

function brokerCustomerNextAction(
  input: NativeCompanionRepairViewModelInput,
  actionResult: IEvaosNativeCompanionActionResult | null,
  totalSteps: number,
  step: number
): NativeCompanionNextAction | undefined {
  const copy = input.prerequisiteCopy;
  if (
    actionResult?.sourcePointer === 'native-companion:pairing-broker-session-required' ||
    actionResult?.sourcePointer === 'native-companion:connector-grant-broker-session-required' ||
    actionResult?.sourcePointer === 'native-companion:secure-network-enrollment-broker-session-required'
  ) {
    return {
      kind: 'reconnect',
      label: copy.refreshSessionLabel,
      title: copy.refreshSessionTitle,
      detail: copy.refreshSessionDetail,
      step,
      totalSteps,
      disabled: false,
    };
  }

  if (input.brokerSessionLoading) {
    return {
      kind: 'none',
      label: copy.checkingSessionLabel,
      title: copy.checkingSessionTitle,
      detail: copy.checkingSessionDetail,
      step,
      totalSteps,
      disabled: true,
    };
  }

  if (input.brokerAuthenticated === false) {
    return {
      kind: 'reconnect',
      label: copy.signInLabel,
      title: copy.signInTitle,
      detail: copy.signInDetail,
      step,
      totalSteps,
      disabled: false,
    };
  }

  if (!input.hasSelectedCustomer) {
    return {
      kind: 'none',
      label: copy.selectCustomerLabel,
      title: copy.selectCustomerTitle,
      detail: copy.selectCustomerDetail,
      step,
      totalSteps,
      disabled: true,
    };
  }

  if (input.hasPairableCustomer === false) {
    return {
      kind: 'none',
      label: copy.chooseMacTargetLabel,
      title: copy.chooseMacTargetTitle,
      detail: copy.chooseMacTargetDetail,
      step,
      totalSteps,
      disabled: true,
    };
  }

  return undefined;
}

function nextActionForState(
  input: NativeCompanionRepairViewModelInput,
  state: NativeCompanionUserState
): NativeCompanionNextAction {
  const totalSteps = 5;
  const status = input.status;
  const actionResult = input.actionResult ?? null;
  const agentPairingStatus = effectiveAgentPairingStatus(status, actionResult);
  const pairingReady = canCreatePairingPrompt(input, status);

  if (input.loading) {
    return {
      kind: 'none',
      label: 'Checking...',
      title: 'Checking Mac control',
      detail: 'Workbench is reading connector, permission, and pairing status.',
      step: 1,
      totalSteps,
      disabled: true,
    };
  }

  if (!status || state === 'offline') {
    return {
      kind: 'refresh',
      label: 'Refresh status',
      title: 'Reconnect Mac control',
      detail: 'Workbench cannot read current Mac control status. Refresh before pairing or agent control.',
      step: 1,
      totalSteps,
      disabled: false,
    };
  }

  if (state === 'unsupported' || !status.bridgeCli.installed) {
    return {
      kind: 'refresh',
      label: 'Check again',
      title: 'Set up Mac control',
      detail: 'Workbench connector tools are not available yet. Use support if this keeps happening.',
      step: 1,
      totalSteps,
      disabled: false,
    };
  }

  const packagedPrerequisite = blockingPackagedPrerequisite(status, input.prerequisiteCopy);
  if (packagedPrerequisite) {
    return packagedPrerequisite.action;
  }

  if (!permissionsReady(status)) {
    const repairAction = firstMissingPermissionAction(status);
    return {
      kind: 'repair',
      repairAction,
      label: repairAction === 'screen_recording' ? 'Open Screen Recording' : 'Open Accessibility',
      title: 'Allow screen and control',
      detail: input.permissionGuideDetail,
      step: 2,
      totalSteps,
      disabled: false,
    };
  }

  const networkPrerequisite = blockingPrivateNetworkPrerequisite(status, input.prerequisiteCopy);
  if (networkPrerequisite) {
    if (status.prerequisites?.privateNetwork !== 'unenrolled') {
      return networkPrerequisite.action;
    }
    if (actionResult?.sourcePointer === 'native-companion:secure-network-enrollment-submitted') {
      return {
        ...networkPrerequisite.action,
        kind: 'none',
        action: undefined,
        disabled: true,
      };
    }
    const brokerGate = brokerCustomerNextAction(input, actionResult, totalSteps, 1);
    return brokerGate ?? networkPrerequisite.action;
  }

  if (!connectorServiceReady(status)) {
    return {
      kind: 'run',
      action: 'connector_start',
      label: 'Turn On Mac Access',
      title: 'Turn on Mac access',
      detail: 'Start the local Workbench connector before connecting Mac control.',
      step: 1,
      totalSteps,
      disabled: false,
    };
  }

  const brokerGate = brokerCustomerNextAction(input, actionResult, totalSteps, 3);
  if (brokerGate) return brokerGate;

  if (agentPairingStatus === 'agent_paired') {
    if (status.controlSession?.active) {
      return {
        kind: 'run',
        action: 'control_stop',
        label: 'Stop Control',
        title: 'Agent control is active',
        detail: 'Stop the active control session when testing is complete.',
        step: 4,
        totalSteps,
        disabled: false,
      };
    }
    return {
      kind: 'run',
      action: 'control_start',
      mode: 'full-access',
      label: 'Start Full Access',
      title: 'Start approved agent control',
      detail: 'Start a visible Full Access session so evaOS/OpenClaw or Hermes can operate this Mac.',
      step: 4,
      totalSteps,
      disabled: false,
    };
  }

  if (actionResult?.sourcePointer === 'native-companion:pairing-registration-failed') {
    const createPromptStatus = { ...status, agentPairingStatus: 'ready_for_agent_pairing' as const };
    const createPromptAction = nextActionForState(
      { ...input, status: createPromptStatus, actionResult: null, pairingPromptCopied: false },
      state
    );
    return {
      ...createPromptAction,
      detail: safeActionDetail(actionResult.message, createPromptAction.detail),
    };
  }

  if (actionResult?.pairing?.setupPrompt && !input.pairingPromptCopied) {
    return {
      kind: 'copy',
      label: 'Copy Pairing Prompt',
      title: 'Copy the pairing prompt',
      detail: 'Paste the prompt into evaOS/OpenClaw or Hermes. It contains only a scoped code, not connector secrets.',
      step: 3,
      totalSteps,
      disabled: false,
    };
  }

  if (agentPairingStatus === 'pairing_prompt_created' || input.pairingPromptCopied) {
    return {
      kind: 'run',
      action: 'setup_check',
      label: 'Run Setup Check',
      title: 'Confirm agent pairing',
      detail: 'After the agent reports pairing complete, run setup check to confirm broker and audit proof.',
      step: 4,
      totalSteps,
      disabled: false,
    };
  }

  if (agentPairingStatus === 'proof_failed') {
    return {
      kind: 'run',
      action: 'setup_check',
      label: 'Run Setup Check',
      title: 'Retry agent proof',
      detail: 'Retry setup check after the agent finishes pairing or after support repairs the VM-side connector.',
      step: 4,
      totalSteps,
      disabled: false,
    };
  }

  if (hasBlockingReadinessActionResult(actionResult) && !macPairingPrerequisitesReady(status)) {
    return {
      kind: 'run',
      action: 'setup_check',
      label: 'Run Setup Check',
      title: 'Repair pairing proof',
      detail: safeActionDetail(
        actionResult?.message,
        'Workbench could not finish the previous Mac control step. Run setup check before connecting Mac control.'
      ),
      step: 3,
      totalSteps,
      disabled: false,
    };
  }

  return {
    kind: 'run',
    action: 'ensure_customer_mac_connector_grant',
    label: 'Connect Mac Control',
    title: 'Connect Mac control',
    detail: pairingReady
      ? 'Connect this signed-in Workbench session to the selected evaOS/OpenClaw and Hermes agent context.'
      : disabledPairingPromptReason(input, status),
    step: 3,
    totalSteps,
    disabled: !pairingReady,
  };
}

export function canCreateNativeCompanionPairingPrompt(input: NativeCompanionRepairViewModelInput): boolean {
  return canCreatePairingPrompt(input, input.status);
}

function connectorValue(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState,
  loading: boolean
): string {
  if (loading) return 'Checking';
  if (!status) return 'Offline';
  if (!status.bridgeCli.installed) return state === 'unsupported' ? 'Unavailable' : 'Repair needed';
  if (connectorServiceReady(status)) return 'Ready on this Mac';
  if (
    status.bridgeCli.status === 'error' ||
    status.bridgeCli.status === 'unavailable' ||
    status.connectorService?.status === 'error' ||
    status.connectorService?.status === 'unavailable'
  ) {
    return 'Offline';
  }
  return 'Repair needed';
}

function connectorTone(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState,
  loading: boolean
): NativeCompanionTone {
  if (loading) return 'neutral';
  if (!status || state === 'offline' || state === 'unsupported') return 'offline';
  return connectorServiceReady(status) ? 'ready' : 'attention';
}

function permissionsValue(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState,
  loading: boolean
): string {
  if (loading) return 'Checking';
  if (!status || state === 'offline' || state === 'unsupported') return 'Unavailable';
  if (permissionsReady(status)) return 'Granted on this Mac';
  return 'Needs permission';
}

function permissionsTone(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState,
  loading: boolean
): NativeCompanionTone {
  if (loading) return 'neutral';
  if (!status || state === 'offline' || state === 'unsupported') return 'offline';
  return permissionsValue(status, state, loading) === 'Granted on this Mac' ? 'ready' : 'attention';
}

function connectorStepDetail(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState
): string {
  if (state === 'ready') return 'Workbench connector is reporting ready locally.';
  if (!status?.bridgeCli.installed) return 'Set up Mac control so the connector can report status.';
  if (!connectorServiceReady(status)) {
    return 'Turn on Mac access so the Workbench connector is running and reachable.';
  }
  return 'Use the repair workflow to restart or repair the secure local connector.';
}

function permissionsStepDetail(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState
): string {
  if (state === 'ready') return 'Accessibility and Screen Recording are ready.';
  if (permissionsNeedRepair(status?.bridgeCli.permissions) || permissionsNeedRepair(status?.customerMac.permissions)) {
    return 'Review macOS Accessibility and Screen Recording for Workbench.';
  }
  return 'Permission proof looks present; continue with pairing and setup check.';
}

function pairingStepDetail(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState
): string {
  if (state === 'ready' && normalizeAgentPairingStatus(status?.agentPairingStatus) === 'agent_paired') {
    return 'Account-scoped connector grant is active. Continue with evaOS/OpenClaw and Hermes live proof through the shared Workbench connector.';
  }
  if (state === 'ready' && normalizeAgentPairingStatus(status?.agentPairingStatus) === 'pairing_prompt_created') {
    return 'Prompt created. Paste it into evaOS/OpenClaw or Hermes, then run the setup check to confirm agent proof.';
  }
  if (status?.pairingCapable === false) {
    return disabledPairingCapabilityReason(status);
  }
  if (state === 'ready') {
    return 'Connect Mac control through the account-scoped broker grant; do not expose public Mac, VNC, SSH, or browser debug ports.';
  }
  if (state === 'not_paired') {
    return 'Connector trust stays inside Workbench. First-party agents must use the broker-owned connector grant.';
  }
  return 'After connector and permission repair, connect Mac control for the selected customer.';
}

function pairingValue(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState
): string {
  if (state === 'not_paired') return 'Connect this Mac';
  if (state !== 'ready') return state === 'offline' || state === 'unsupported' ? 'Unavailable' : 'Repair needed';
  if (status?.pairingCapable === false) return 'Agent setup needed';
  if (runtimeToolsReady(status)) return 'End-to-end ready';
  switch (normalizeAgentPairingStatus(status?.agentPairingStatus)) {
    case 'agent_paired':
      return 'Grant active; test needed';
    case 'pairing_prompt_created':
      return 'Prompt created';
    case 'proof_failed':
      return 'Proof failed';
    case 'ready_for_agent_pairing':
    case 'not_ready':
      return 'Ready to connect';
  }
}

function pairingTone(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState
): NativeCompanionTone {
  if (state === 'offline' || state === 'unsupported') return 'offline';
  if (state !== 'ready') return 'attention';
  return runtimeToolsReady(status) ? 'ready' : 'attention';
}

function normalizeAgentPairingStatus(
  status: IEvaosNativeCompanionAgentPairingStatus | undefined
): IEvaosNativeCompanionAgentPairingStatus {
  return status ?? 'ready_for_agent_pairing';
}

function effectiveAgentPairingStatus(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  actionResult: IEvaosNativeCompanionActionResult | null
): IEvaosNativeCompanionAgentPairingStatus {
  if (actionResultCanDriveAgentPairing(status, actionResult)) {
    if (actionResult?.agentPairingStatus) return actionResult.agentPairingStatus;
    if (actionResult?.pairing?.setupPrompt) return 'pairing_prompt_created';
  }
  return normalizeAgentPairingStatus(status?.agentPairingStatus);
}

function actionResultCanDriveAgentPairing(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  actionResult: IEvaosNativeCompanionActionResult | null | undefined
): boolean {
  if (!actionResult) return false;
  if (!macPairingPrerequisitesReady(status)) return false;
  return actionResult.status === 'succeeded';
}

function runtimeToolsReady(status: IEvaosNativeCompanionStatusView | null | undefined): boolean {
  return status?.runtimeToolReadiness === 'tools_ready';
}

function connectorServiceReady(status: IEvaosNativeCompanionStatusView | null | undefined): boolean {
  if (!status) return false;
  return (
    status.connectorService?.status === 'ready' &&
    status.connectorService?.running === true &&
    status.connectorService?.reachable === true
  );
}

function permissionsReady(status: IEvaosNativeCompanionStatusView | null | undefined): boolean {
  if (!status) return false;
  if (status.readiness === 'ready' && status.customerMac.status === 'ready') return true;
  return !permissionsNeedRepair(status.bridgeCli.permissions) && !permissionsNeedRepair(status.customerMac.permissions);
}

function canCreatePairingPrompt(
  input: NativeCompanionRepairViewModelInput,
  status: IEvaosNativeCompanionStatusView | null | undefined
): boolean {
  if (!status || input.loading || !input.hasSelectedCustomer) return false;
  if (input.hasPairableCustomer === false) return false;
  if (status.pairingCapable === false) return false;
  if (input.brokerSessionLoading || input.brokerAuthenticated === false) return false;
  if (input.actionResult?.sourcePointer === 'native-companion:pairing-broker-session-required') return false;
  if (hasBlockingReadinessActionResult(input.actionResult) && !macPairingPrerequisitesReady(status)) return false;
  if (!status.bridgeCli.installed) return false;
  return connectorServiceReady(status) && permissionsReady(status);
}

function localMacAccessReady(status: IEvaosNativeCompanionStatusView | null | undefined): boolean {
  const prerequisites = status?.prerequisites;
  if (
    prerequisites &&
    (prerequisites.bridgeRuntime !== 'ready' ||
      prerequisites.privateNetwork !== 'online' ||
      prerequisites.actionEngine === 'unavailable')
  ) {
    return false;
  }
  return (
    status?.bridgeCli.installed === true &&
    status.bridgeCli.status !== 'error' &&
    connectorServiceReady(status) &&
    permissionsReady(status)
  );
}

type BlockingPrerequisite = {
  title: string;
  summary: string;
  action: NativeCompanionNextAction;
};

function blockingPrerequisite(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  copy: NativeCompanionPrerequisiteCopy
): BlockingPrerequisite | undefined {
  const packaged = blockingPackagedPrerequisite(status, copy);
  if (packaged) return packaged;
  if (!permissionsReady(status)) return undefined;
  return blockingPrivateNetworkPrerequisite(status, copy);
}

function blockingPackagedPrerequisite(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  copy: NativeCompanionPrerequisiteCopy
): BlockingPrerequisite | undefined {
  const prerequisites = status?.prerequisites;
  if (!prerequisites) return undefined;
  if (prerequisites.bridgeRuntime !== 'ready') {
    return {
      title: copy.repairWorkbenchTitle,
      summary:
        prerequisites.bridgeRuntime === 'missing'
          ? copy.repairWorkbenchMissingDetail
          : copy.repairWorkbenchIncompatibleDetail,
      action: {
        kind: 'none',
        label: copy.repairWorkbenchTitle,
        title: copy.repairWorkbenchTitle,
        detail:
          prerequisites.bridgeRuntime === 'missing'
            ? copy.repairWorkbenchMissingDetail
            : copy.repairWorkbenchIncompatibleDetail,
        step: 1,
        totalSteps: 5,
        disabled: true,
      },
    };
  }
  if (prerequisites.actionEngine === 'unavailable') {
    return {
      title: copy.repairControlToolsTitle,
      summary: copy.repairControlToolsDetail,
      action: {
        kind: 'none',
        label: copy.repairControlToolsTitle,
        title: copy.repairControlToolsTitle,
        detail: copy.repairControlToolsDetail,
        step: 1,
        totalSteps: 5,
        disabled: true,
      },
    };
  }
  return undefined;
}

function blockingPrivateNetworkPrerequisite(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  copy: NativeCompanionPrerequisiteCopy
): BlockingPrerequisite | undefined {
  const privateNetwork = status?.prerequisites?.privateNetwork;
  if (!privateNetwork || privateNetwork === 'online') return undefined;
  const baseAction = {
    step: 1,
    totalSteps: 5,
  };
  switch (privateNetwork) {
    case 'client_missing':
      return {
        title: copy.clientMissingTitle,
        summary: copy.clientMissingDetail,
        action: {
          ...baseAction,
          kind: 'repair',
          repairAction: 'secure_network_install',
          label: copy.clientMissingTitle,
          title: copy.clientMissingTitle,
          detail: copy.clientMissingDetail,
          disabled: false,
        },
      };
    case 'client_stopped':
      return {
        title: copy.clientStoppedTitle,
        summary: copy.clientStoppedDetail,
        action: {
          ...baseAction,
          kind: 'repair',
          repairAction: 'secure_network_open',
          label: copy.clientStoppedTitle,
          title: copy.clientStoppedTitle,
          detail: copy.clientStoppedDetail,
          disabled: false,
        },
      };
    case 'unenrolled':
      return {
        title: copy.unenrolledTitle,
        summary: copy.unenrolledDetail,
        action: {
          ...baseAction,
          kind: 'run',
          action: 'secure_network_enroll',
          label: copy.unenrolledTitle,
          title: copy.unenrolledTitle,
          detail: copy.unenrolledDetail,
          disabled: false,
        },
      };
    case 'wrong_control_plane':
      return {
        title: copy.wrongControlPlaneTitle,
        summary: copy.wrongControlPlaneDetail,
        action: {
          ...baseAction,
          kind: 'none',
          label: copy.wrongControlPlaneTitle,
          title: copy.wrongControlPlaneTitle,
          detail: copy.wrongControlPlaneDetail,
          disabled: true,
        },
      };
    case 'acl_blocked':
      return {
        title: copy.aclBlockedTitle,
        summary: copy.aclBlockedDetail,
        action: {
          ...baseAction,
          kind: 'none',
          label: copy.aclBlockedTitle,
          title: copy.aclBlockedTitle,
          detail: copy.aclBlockedDetail,
          disabled: true,
        },
      };
    case 'offline':
      return {
        title: copy.offlineTitle,
        summary: copy.offlineDetail,
        action: {
          ...baseAction,
          kind: 'refresh',
          label: copy.offlineTitle,
          title: copy.offlineTitle,
          detail: copy.offlineDetail,
          disabled: false,
        },
      };
    case 'error':
      return {
        title: copy.errorTitle,
        summary: copy.errorDetail,
        action: {
          ...baseAction,
          kind: 'none',
          label: copy.errorTitle,
          title: copy.errorTitle,
          detail: copy.errorDetail,
          disabled: true,
        },
      };
  }
}

function macPairingPrerequisitesReady(status: IEvaosNativeCompanionStatusView | null | undefined): boolean {
  return localMacAccessReady(status);
}

function hasBlockingStatusError(status: IEvaosNativeCompanionStatusView): boolean {
  return (
    status.bridgeCli.status === 'error' ||
    status.connectorService?.status === 'error' ||
    status.customerMac.status === 'error' ||
    status.controlSession?.status === 'error' ||
    status.audit.status === 'error'
  );
}

function hasBlockingReadinessActionResult(
  actionResult: IEvaosNativeCompanionActionResult | null | undefined
): actionResult is IEvaosNativeCompanionActionResult {
  if (!actionResult || actionResult.status === 'succeeded') return false;
  if (actionResult.action === 'control_start') return false;
  if (actionResult.action === 'create_pairing_prompt') return false;
  return true;
}

function disabledPairingPromptReason(
  input: NativeCompanionRepairViewModelInput,
  status: IEvaosNativeCompanionStatusView | null | undefined
): string {
  if (input.loading) return 'Workbench is still checking Mac control status.';
  if (!status) return 'Refresh Mac control status before connecting Mac control.';
  if (!status.bridgeCli.installed) return 'Workbench connector tools are not installed.';
  if (!connectorServiceReady(status)) return 'Turn on Mac Access before connecting Mac control.';
  if (!permissionsReady(status)) return 'Grant Accessibility and Screen Recording before connecting Mac control.';
  if (status.pairingCapable === false) return disabledPairingCapabilityReason(status);
  if (input.actionResult?.sourcePointer === 'native-companion:pairing-broker-session-required') {
    return 'Refresh the Workbench session before connecting Mac control.';
  }
  if (input.brokerSessionLoading) return 'Workbench is checking the broker session.';
  if (input.brokerAuthenticated === false) return 'Sign in to Workbench before connecting Mac control.';
  if (!input.hasSelectedCustomer) return 'Choose a customer before connecting Mac control.';
  if (input.hasPairableCustomer === false) {
    return 'Choose a VM-backed Mac-control customer before connecting Mac control.';
  }
  if (hasBlockingReadinessActionResult(input.actionResult)) {
    return safeActionDetail(input.actionResult.message, 'Run setup check before connecting Mac control.');
  }
  return 'Connect after Workbench confirms local connector, permissions, session, and customer.';
}

function disabledPairingCapabilityReason(status: IEvaosNativeCompanionStatusView): string {
  switch (status.pairingBlockedReason) {
    case 'bundled_bridge_required':
      return 'Install the current Workbench build with the bundled Mac connector before connecting Mac control.';
    case 'secure_network_link_required':
      return 'Connect this Mac to the broker-owned private connector link before connecting Mac control.';
    case 'connector_service_not_ready':
      return 'Turn on Mac Access before connecting Mac control.';
    default:
      return 'Workbench needs a bundled connector and secure network link before connecting Mac control.';
  }
}

function secureConnectorLinkRequired(status: IEvaosNativeCompanionStatusView | null | undefined): boolean {
  return status?.pairingCapable === false && status.pairingBlockedReason === 'secure_network_link_required';
}

function safeActionDetail(message: string | undefined, fallback: string): string {
  const cleaned = (message ?? '')
    .replace(/https?:\/\/[^\s"')]+/gi, '[redacted-url]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[redacted-ip]')
    .replace(
      /\b(?:access[_-]?token|refresh[_-]?token|connector[_-]?token|desktop[_-]?session|provider[_-]?grant|bearer|secret)\b[^\s,.;)]*/gi,
      '[redacted]'
    )
    .trim();
  return cleaned || fallback;
}

function firstMissingPermissionAction(status: IEvaosNativeCompanionStatusView): IEvaosNativeCompanionRepairAction {
  if (
    status.bridgeCli.permissions?.accessibility === 'granted' &&
    status.customerMac.permissions?.accessibility === 'granted'
  ) {
    return 'screen_recording';
  }
  return 'accessibility';
}

function permissionsNeedRepair(permissions: IEvaosNativeCompanionPermissionView | undefined): boolean {
  if (!permissions) return false;
  return [permissions.accessibility, permissions.screenRecording]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .some((value) => !/^(granted|ready|available|ok)$/i.test(value.trim()));
}

function safeReportedSummary(input: NativeCompanionRepairViewModelInput): string | undefined {
  const text = input.status?.summaryText || input.error || undefined;
  if (!text) return undefined;
  return text
    .replace(/\bNOT_PAIRED\b/gi, 'pairing required')
    .replace(/\bnative companion\b/gi, 'Workbench connector')
    .replace(/\bnative bridge\b/gi, 'Workbench connector')
    .replace(/\breleased Workbench\b/gi, 'advanced repair fallback')
    .replace(
      /\b(?:access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|bearer|secret)\b/gi,
      '[redacted]'
    );
}

function statusText(status: IEvaosNativeCompanionStatusView, error: string | null | undefined): string {
  return [
    status.readiness,
    status.summaryText,
    status.sourcePointer,
    status.bridgeCli.status,
    status.customerMac.status,
    status.audit.status,
    status.bridgeCli.permissions?.accessibility,
    status.bridgeCli.permissions?.screenRecording,
    status.customerMac.permissions?.accessibility,
    status.customerMac.permissions?.screenRecording,
    error,
  ]
    .filter(Boolean)
    .join('\n');
}
