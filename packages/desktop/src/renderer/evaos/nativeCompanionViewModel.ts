/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IEvaosNativeCompanionPermissionView, IEvaosNativeCompanionStatusView } from '@/common/evaos/bridgeTypes';

export type NativeCompanionUserState =
  | 'ready'
  | 'repair_required'
  | 'not_paired'
  | 'permission_needed'
  | 'offline'
  | 'unsupported';

export type NativeCompanionTone = 'ready' | 'attention' | 'offline' | 'neutral';

export type NativeCompanionPrimaryActionKind = 'open_released_workbench' | 'refresh' | 'none';

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

export interface NativeCompanionRepairViewModel {
  state: NativeCompanionUserState;
  title: string;
  summary: string;
  statusLabel: string;
  statusTone: NativeCompanionTone;
  readinessStrip: NativeCompanionReadinessItem[];
  repairSteps: NativeCompanionRepairStep[];
  primaryAction: NativeCompanionPrimaryAction;
  supportText: string;
  reportedSummary?: string;
}

export interface NativeCompanionRepairViewModelInput {
  status: IEvaosNativeCompanionStatusView | null | undefined;
  loading: boolean;
  error: string | null | undefined;
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
    primaryAction: primaryActionForState(input.status, state, input.loading),
    supportText:
      'Need help? Open Advanced diagnostics for audit IDs, boundary proof, and canary status before contacting support.',
    reportedSummary,
  };
}

export function collapseNativeCompanionState(input: NativeCompanionRepairViewModelInput): NativeCompanionUserState {
  const { status, error } = input;
  if (!status) return 'offline';
  const haystack = statusText(status, error);

  if (status.readiness === 'ready') return 'ready';
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
  if (loading) return 'Checking Mac & iPhone';
  switch (state) {
    case 'ready':
      return 'Mac & iPhone are ready';
    case 'not_paired':
      return 'Pair this Mac';
    case 'permission_needed':
      return 'Allow Mac control';
    case 'offline':
      return 'Reconnect native companion';
    case 'unsupported':
      return 'Install native companion';
    case 'repair_required':
      return 'Repair Mac access';
  }
}

function summaryForState(state: NativeCompanionUserState, loading: boolean): string {
  if (loading) return 'Checking the native companion before evaOS or Hermes uses local Mac control.';
  switch (state) {
    case 'ready':
      return 'Native companion proof is ready. evaOS and Hermes can use brokered Mac control when the native side approves it.';
    case 'not_paired':
      return 'This Mac must be paired again before evaOS or Hermes chat can use Mac control.';
    case 'permission_needed':
      return 'macOS Accessibility or Screen Recording needs attention before approved local-control actions can run.';
    case 'offline':
      return 'Native status is offline or stale. Refresh the status or use the support repair path before starting local-control chat.';
    case 'unsupported':
      return 'The native companion is not available on this Mac. Install or open the released repair fallback before continuing.';
    case 'repair_required':
      return 'Native companion is installed, but Mac access needs repair before evaOS or Hermes can use local control.';
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
      help: 'Secure local connector status reported by the native companion.',
    },
    {
      label: 'Pairing',
      value: state === 'not_paired' ? 'Pair this Mac' : state === 'ready' ? 'Ready' : 'Repair needed',
      tone: state === 'ready' ? 'ready' : state === 'offline' || state === 'unsupported' ? 'offline' : 'attention',
      help: 'Mac pairing must come from the native companion, not from the renderer.',
    },
    {
      label: 'Permissions',
      value: permissionsValue(status, state, loading),
      tone: permissionsTone(status, state, loading),
      help: 'Accessibility and Screen Recording readiness for approved local-control actions.',
    },
    {
      label: 'iPhone',
      value: iPhoneValue(status, loading),
      tone: iPhoneTone(status, loading),
      help: 'iPhone Mirroring readiness as reported by the native companion.',
    },
    {
      label: 'Trust authority',
      value: 'Native companion',
      tone: 'neutral',
      help: 'AionUi only presents status and opens the repair workflow.',
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
      title: 'Pair this Mac to evaOS',
      detail: pairingStepDetail(state),
      state: state === 'ready' ? 'ready' : state === 'not_paired' ? 'attention' : 'neutral',
    },
    {
      title: 'Connect iPhone Mirroring',
      detail: iPhoneStepDetail(status),
      state: iPhoneTone(status, false),
    },
    {
      title: 'Run a setup check',
      detail:
        'Refresh this page after the native repair completes. evaOS and Hermes stay blocked until readiness is ready.',
      state: state === 'ready' ? 'ready' : 'neutral',
    },
  ];
}

function primaryActionForState(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState,
  loading: boolean
): NativeCompanionPrimaryAction {
  if (loading) {
    return {
      kind: 'none',
      label: 'Checking...',
      disabled: true,
      detail: 'Native companion status is still loading.',
    };
  }

  if (state === 'ready' || state === 'offline') {
    return {
      kind: 'refresh',
      label: 'Refresh status',
      disabled: false,
      detail: 'Refresh the read-only native status proof.',
    };
  }

  if (status?.canOpenReleasedWorkbench) {
    return {
      kind: 'open_released_workbench',
      label: primaryOpenLabel(state),
      disabled: false,
      detail:
        'Opens the released native Workbench repair fallback. Pairing and permission authority stay native-owned.',
    };
  }

  return {
    kind: 'refresh',
    label: 'Refresh status',
    disabled: false,
    detail: 'The native repair fallback is not available from this beta shell.',
  };
}

function primaryOpenLabel(state: NativeCompanionUserState): string {
  switch (state) {
    case 'not_paired':
      return 'Pair this Mac';
    case 'permission_needed':
      return 'Repair permissions';
    case 'unsupported':
      return 'Open install fallback';
    case 'repair_required':
      return 'Start repair';
    case 'ready':
    case 'offline':
      return 'Refresh status';
  }
}

function connectorValue(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState,
  loading: boolean
): string {
  if (loading) return 'Checking';
  if (!status) return 'Offline';
  if (!status.bridgeCli.installed) return state === 'unsupported' ? 'Unavailable' : 'Repair needed';
  if (status.bridgeCli.status === 'ready') return 'Ready';
  if (status.bridgeCli.status === 'error' || status.bridgeCli.status === 'unavailable') return 'Offline';
  return 'Repair needed';
}

function connectorTone(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState,
  loading: boolean
): NativeCompanionTone {
  if (loading) return 'neutral';
  if (!status || state === 'offline' || state === 'unsupported') return 'offline';
  return status.bridgeCli.status === 'ready' ? 'ready' : 'attention';
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

function iPhoneValue(status: IEvaosNativeCompanionStatusView | null | undefined, loading: boolean): string {
  if (loading) return 'Checking';
  if (!status) return 'Unavailable';
  if (!status.iPhone.installed) return 'Unavailable';
  return status.iPhone.running ? 'Running' : 'Available';
}

function iPhoneTone(status: IEvaosNativeCompanionStatusView | null | undefined, loading: boolean): NativeCompanionTone {
  if (loading) return 'neutral';
  if (!status || !status.iPhone.installed || status.iPhone.status === 'unavailable') return 'offline';
  return 'ready';
}

function connectorStepDetail(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState
): string {
  if (state === 'ready') return 'The native connector is reporting ready.';
  if (!status?.bridgeCli.installed)
    return 'Install or open the native repair fallback so the connector can report status.';
  return 'Use the repair workflow to restart or repair the secure local connector.';
}

function permissionsStepDetail(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  state: NativeCompanionUserState
): string {
  if (state === 'ready') return 'Accessibility and Screen Recording are ready.';
  if (permissionsNeedRepair(status?.bridgeCli.permissions) || permissionsNeedRepair(status?.customerMac.permissions)) {
    return 'Review macOS Accessibility and Screen Recording in the native repair workflow.';
  }
  return 'Permission proof looks present; continue with pairing and setup check.';
}

function pairingStepDetail(state: NativeCompanionUserState): string {
  if (state === 'ready') return 'This Mac is paired for native companion use.';
  if (state === 'not_paired') {
    return 'Pairing and trust claims stay inside the native companion. This shell only opens the repair workflow.';
  }
  return 'Confirm native pairing after connector and permission repair.';
}

function iPhoneStepDetail(status: IEvaosNativeCompanionStatusView | null | undefined): string {
  if (!status?.iPhone.installed) return 'Install or open Apple iPhone Mirroring when phone workflows are needed.';
  return status.iPhone.running ? 'iPhone Mirroring is running.' : 'iPhone Mirroring is available; open it when needed.';
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
    status.iPhone.status,
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
