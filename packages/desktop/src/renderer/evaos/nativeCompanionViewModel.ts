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
}

const PAIRING_PATTERN = /\b(?:not[_ -]?paired|pairing[_ -]?required|pairing required|device identity changed)\b/i;
const OFFLINE_PATTERN = /\b(?:offline|unavailable|stale|could not be reached|status source required)\b/i;
const UNSUPPORTED_PATTERN = /\b(?:unsupported|not supported)\b/i;

export function getNativeCompanionRepairViewModel(
  input: NativeCompanionRepairViewModelInput
): NativeCompanionRepairViewModel {
  const state = collapseNativeCompanionState(input);
  const statusTone = toneForState(state);
  const reportedSummary = safeReportedSummary(input);

  return {
    state,
    title: titleForState(state, input.loading),
    summary: summaryForState(state, input.loading),
    statusLabel: labelForState(state, input.loading),
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

  if (hasBlockingReadinessActionResult(input.actionResult) || hasBlockingStatusError(status)) return 'repair_required';
  if (status.readiness === 'ready' && connectorServiceReady(status) && permissionsReady(status)) return 'ready';
  if (!status.releasedWorkbench.installed && !status.bridgeCli.installed) return 'unsupported';
  if (PAIRING_PATTERN.test(haystack)) return 'not_paired';
  if (permissionsNeedRepair(status.bridgeCli.permissions) || permissionsNeedRepair(status.customerMac.permissions)) {
    return 'permission_needed';
  }
  if (status.readiness === 'unavailable' || OFFLINE_PATTERN.test(haystack)) return 'offline';
  if (UNSUPPORTED_PATTERN.test(haystack)) return 'unsupported';
  return 'repair_required';
}

function titleForState(state: NativeCompanionUserState, loading: boolean): string {
  if (loading) return 'Checking Mac control';
  switch (state) {
    case 'ready':
      return 'Mac control is ready';
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

function summaryForState(state: NativeCompanionUserState, loading: boolean): string {
  if (loading) return 'Checking the Workbench connector before evaOS or Hermes uses local Mac control.';
  switch (state) {
    case 'ready':
      return 'Local Workbench connector proof is ready. Pair evaOS/OpenClaw or Hermes with a scoped prompt before an agent uses Mac control. Agent pairing proof is present only after setup/audit evidence confirms it.';
    case 'not_paired':
      return 'This Mac must be paired again before evaOS or Hermes chat can use Mac control.';
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

function labelForState(state: NativeCompanionUserState, loading: boolean): string {
  return loading ? 'checking' : state;
}

function toneForState(state: NativeCompanionUserState): NativeCompanionTone {
  if (state === 'ready') return 'ready';
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
      label: 'Pairing',
      value: pairingValue(status, state),
      tone: pairingTone(status, state),
      help: 'Workbench creates a scoped prompt/code for the agent; the VM must connect through the broker-owned plugin.',
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
      title: 'Pair the agent to this Mac',
      detail: pairingStepDetail(status, state),
      state: state === 'ready' || state === 'not_paired' ? pairingTone(status, state) : 'neutral',
    },
    {
      title: 'Test Mac control',
      detail: 'Run a setup check and one approved low-impact action from evaOS/OpenClaw and Hermes.',
      state:
        state === 'ready' && normalizeAgentPairingStatus(status?.agentPairingStatus) === 'agent_paired'
          ? 'ready'
          : 'neutral',
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

  if (!connectorServiceReady(status)) {
    return {
      kind: 'run',
      action: 'connector_start',
      label: 'Turn On Mac Access',
      title: 'Turn on Mac access',
      detail: 'Start the local Workbench connector before creating an agent pairing code.',
      step: 1,
      totalSteps,
      disabled: false,
    };
  }

  if (!permissionsReady(status)) {
    const repairAction = firstMissingPermissionAction(status);
    return {
      kind: 'repair',
      repairAction,
      label: repairAction === 'screen_recording' ? 'Open Screen Recording' : 'Open Accessibility',
      title: 'Allow screen and control',
      detail: 'Grant the missing macOS permission, then return here and refresh status.',
      step: 2,
      totalSteps,
      disabled: false,
    };
  }

  if (actionResult?.sourcePointer === 'native-companion:pairing-broker-session-required') {
    return {
      kind: 'reconnect',
      label: 'Reconnect Workbench',
      title: 'Reconnect Workbench session',
      detail: 'Sign in to evaOS again so Workbench can create a scoped agent pairing code for the selected customer.',
      step: 3,
      totalSteps,
      disabled: false,
    };
  }

  if (input.brokerSessionLoading) {
    return {
      kind: 'none',
      label: 'Checking session',
      title: 'Checking Workbench session',
      detail: 'Workbench is checking the evaOS broker session before agent pairing.',
      step: 3,
      totalSteps,
      disabled: true,
    };
  }

  if (input.brokerAuthenticated === false) {
    return {
      kind: 'reconnect',
      label: 'Reconnect Workbench',
      title: 'Reconnect Workbench session',
      detail: 'Sign in to evaOS so Workbench can create a scoped agent pairing code for this Mac.',
      step: 3,
      totalSteps,
      disabled: false,
    };
  }

  if (!input.hasSelectedCustomer) {
    return {
      kind: 'none',
      label: 'Select customer',
      title: 'Choose a customer',
      detail: 'Select the customer this Mac should pair with before creating an agent pairing code.',
      step: 3,
      totalSteps,
      disabled: true,
    };
  }

  if (input.hasPairableCustomer === false) {
    return {
      kind: 'none',
      label: 'Choose Mac target',
      title: 'Choose a Mac-control customer',
      detail:
        'The selected account is not a VM-backed Mac-control target. Choose a customer target before creating an agent pairing code.',
      step: 3,
      totalSteps,
      disabled: true,
    };
  }

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

  if (hasBlockingReadinessActionResult(actionResult)) {
    return {
      kind: 'run',
      action: 'setup_check',
      label: 'Run Setup Check',
      title: 'Repair pairing proof',
      detail: safeActionDetail(
        actionResult?.message,
        'Workbench could not finish the previous Mac control step. Run setup check before creating another pairing prompt.'
      ),
      step: 3,
      totalSteps,
      disabled: false,
    };
  }

  return {
    kind: 'run',
    action: 'create_pairing_prompt',
    label: 'Create Pairing Prompt',
    title: 'Pair evaOS/OpenClaw or Hermes',
    detail: pairingReady
      ? 'Create a scoped prompt/code and give it to the agent so the VM connects through the broker-owned plugin.'
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
  if (connectorServiceReady(status)) return 'Ready';
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
  if (!permissionsNeedRepair(status.bridgeCli.permissions) && !permissionsNeedRepair(status.customerMac.permissions)) {
    return 'Granted';
  }
  return 'Needs permission';
}

function permissionsTone(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState,
  loading: boolean
): NativeCompanionTone {
  if (loading) return 'neutral';
  if (!status || state === 'offline' || state === 'unsupported') return 'offline';
  return permissionsValue(status, state, loading) === 'Granted' ? 'ready' : 'attention';
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
    return 'Agent pairing proof is present. Continue with evaOS/OpenClaw and Hermes live proof through the shared Workbench connector.';
  }
  if (state === 'ready' && normalizeAgentPairingStatus(status?.agentPairingStatus) === 'pairing_prompt_created') {
    return 'Prompt created. Paste it into evaOS/OpenClaw or Hermes, then run the setup check to confirm agent proof.';
  }
  if (state === 'ready') {
    return 'Create a scoped pairing prompt for evaOS/OpenClaw or Hermes; do not expose public Mac, VNC, SSH, or browser debug ports.';
  }
  if (state === 'not_paired') {
    return 'Pairing and trust claims stay inside Workbench. The agent must use the broker-owned connector plugin with the prompt/code.';
  }
  return 'After connector and permission repair, create a scoped agent pairing prompt.';
}

function pairingValue(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState
): string {
  if (state === 'not_paired') return 'Pair this Mac';
  if (state !== 'ready') return state === 'offline' || state === 'unsupported' ? 'Unavailable' : 'Repair needed';
  switch (normalizeAgentPairingStatus(status?.agentPairingStatus)) {
    case 'agent_paired':
      return 'Agent paired';
    case 'pairing_prompt_created':
      return 'Prompt created';
    case 'proof_failed':
      return 'Proof failed';
    case 'ready_for_agent_pairing':
    case 'not_ready':
      return 'Ready to pair';
  }
}

function pairingTone(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState
): NativeCompanionTone {
  if (state === 'offline' || state === 'unsupported') return 'offline';
  if (state !== 'ready') return 'attention';
  return normalizeAgentPairingStatus(status?.agentPairingStatus) === 'agent_paired' ? 'ready' : 'attention';
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
  if (actionResult?.agentPairingStatus) return actionResult.agentPairingStatus;
  if (actionResult?.pairing?.setupPrompt) return 'pairing_prompt_created';
  return normalizeAgentPairingStatus(status?.agentPairingStatus);
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
  return !permissionsNeedRepair(status.bridgeCli.permissions) && !permissionsNeedRepair(status.customerMac.permissions);
}

function canCreatePairingPrompt(
  input: NativeCompanionRepairViewModelInput,
  status: IEvaosNativeCompanionStatusView | null | undefined
): boolean {
  if (!status || input.loading || !input.hasSelectedCustomer) return false;
  if (input.hasPairableCustomer === false) return false;
  if (input.brokerSessionLoading || input.brokerAuthenticated === false) return false;
  if (input.actionResult?.sourcePointer === 'native-companion:pairing-broker-session-required') return false;
  if (hasBlockingReadinessActionResult(input.actionResult)) return false;
  if (!status.bridgeCli.installed) return false;
  return connectorServiceReady(status) && permissionsReady(status);
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
  if (!status) return 'Refresh Mac control status before creating a pairing prompt.';
  if (!status.bridgeCli.installed) return 'Workbench connector tools are not installed.';
  if (!connectorServiceReady(status)) return 'Turn on Mac Access before creating a pairing prompt.';
  if (!permissionsReady(status)) return 'Grant Accessibility and Screen Recording before creating a pairing prompt.';
  if (input.actionResult?.sourcePointer === 'native-companion:pairing-broker-session-required') {
    return 'Reconnect Workbench before creating a pairing prompt.';
  }
  if (input.brokerSessionLoading) return 'Workbench is checking the broker session.';
  if (input.brokerAuthenticated === false) return 'Reconnect Workbench before creating a pairing prompt.';
  if (!input.hasSelectedCustomer) return 'Choose a customer before creating a pairing prompt.';
  if (input.hasPairableCustomer === false) {
    return 'Choose a VM-backed Mac-control customer before creating a pairing prompt.';
  }
  if (hasBlockingReadinessActionResult(input.actionResult)) {
    return safeActionDetail(input.actionResult.message, 'Run setup check before creating another pairing prompt.');
  }
  return 'Create a scoped prompt/code after Workbench confirms local connector, permissions, session, and customer.';
}

function safeActionDetail(message: string | undefined, fallback: string): string {
  const cleaned = (message ?? '')
    .replace(/https?:\/\/[^\s"')]+/gi, '[redacted-url]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[redacted-ip]')
    .replace(
      /\b(?:access[_-]?token|refresh[_-]?token|connector[_-]?token|desktop[_-]?session|provider[_-]?grant|bearer|secret)\b[^\s,.;)]*/gi,
      '[redacted-secret]'
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
