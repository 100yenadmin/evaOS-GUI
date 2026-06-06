/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getEvaosAgentDisplayName } from './evaosAgentPresentation';

type EvaosNativeAgentIdentity = {
  agent_type?: string;
  agent_source?: string;
  backend?: string;
  name?: string;
  is_preset?: boolean;
  handshake?: unknown;
  native_companion_status?: string;
  nativeCompanionStatus?: string;
};

export type EvaosNativeAgentStatus = 'usable' | 'repair_required';

export type EvaosNativeAgentAvailability = {
  isNativeDependent: boolean;
  key: string;
  displayName: string;
  status: EvaosNativeAgentStatus;
  statusLabelKey: string;
  summaryKey: string;
  reasonKey: string;
  reasonParams?: Record<string, string>;
  repairRoute: string;
  repairActionLabelKey: string;
  sourceStatus?: string;
};

const NATIVE_DEPENDENT_AGENT_KEYS = new Set(['openclaw', 'openclaw-gateway', 'hermes']);
const READY_NATIVE_STATUSES = new Set(['ready', 'paired', 'usable', 'healthy']);
const REPAIR_NATIVE_STATUSES = new Set([
  'not_installed',
  'not_paired',
  'pairing_required',
  'device_identity_changed',
  'permission_needed',
  'tcc_required',
  'unavailable',
  'offline',
  'stale',
]);

function nativeAgentKey(agent: EvaosNativeAgentIdentity): string {
  return (agent.backend || agent.agent_type || '').trim().toLowerCase();
}

function readRecordValue(input: unknown, key: string): unknown {
  return input && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined;
}

function readString(input: unknown, key: string): string | undefined {
  const value = readRecordValue(input, key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNestedString(input: unknown, path: string[]): string | undefined {
  let current = input;
  for (const key of path) {
    current = readRecordValue(current, key);
  }
  return typeof current === 'string' && current.trim() ? current.trim() : undefined;
}

function readNativeStatus(agent: EvaosNativeAgentIdentity): string | undefined {
  const directStatus = agent.native_companion_status || agent.nativeCompanionStatus;
  if (directStatus) return directStatus;

  const handshake = agent.handshake;
  return (
    readString(handshake, 'native_companion_status') ||
    readString(handshake, 'nativeCompanionStatus') ||
    readNestedString(handshake, ['native_companion', 'status']) ||
    readNestedString(handshake, ['nativeCompanion', 'status']) ||
    readNestedString(handshake, ['evaos_native_companion', 'status']) ||
    readNestedString(handshake, ['evaosNativeCompanion', 'status'])
  );
}

export function isEvaosNativeDependentAgent(agent: EvaosNativeAgentIdentity): boolean {
  return NATIVE_DEPENDENT_AGENT_KEYS.has(nativeAgentKey(agent));
}

export function resolveEvaosNativeAvailabilitySource(
  selectedAgent: EvaosNativeAgentIdentity | undefined,
  effectiveAgentType: string | undefined,
  availableAgents: EvaosNativeAgentIdentity[] | undefined
): EvaosNativeAgentIdentity | undefined {
  const selectedKey = selectedAgent ? nativeAgentKey(selectedAgent) : undefined;
  const effectiveKey = effectiveAgentType?.trim().toLowerCase();
  const targetKey = effectiveKey || selectedKey;
  if (!targetKey) return selectedAgent;

  const selectedHasNativeProof = selectedAgent ? Boolean(readNativeStatus(selectedAgent)) : false;
  if (selectedAgent && isEvaosNativeDependentAgent(selectedAgent) && selectedHasNativeProof) {
    return selectedAgent;
  }

  const detectedRuntime = availableAgents?.find((agent) => {
    if (agent.is_preset) return false;
    return nativeAgentKey(agent) === targetKey;
  });

  return detectedRuntime ?? selectedAgent;
}

export function getEvaosNativeAgentAvailability(agent: EvaosNativeAgentIdentity): EvaosNativeAgentAvailability {
  const key = nativeAgentKey(agent);
  const displayName = getEvaosAgentDisplayName({
    agent_type: agent.agent_type || key,
    agent_source: agent.agent_source,
    backend: agent.backend,
    name: agent.name || key || 'Agent',
  });
  const isNativeDependent = isEvaosNativeDependentAgent(agent);

  if (!isNativeDependent) {
    return {
      isNativeDependent: false,
      key,
      displayName,
      status: 'usable',
      statusLabelKey: 'settings.agentManagement.detected',
      summaryKey: 'settings.agentManagement.nativeNotRequiredSummary',
      reasonKey: 'settings.agentManagement.nativeNotRequiredReason',
      repairRoute: '/native-companion',
      repairActionLabelKey: 'settings.agentManagement.goToChat',
    };
  }

  const sourceStatus = readNativeStatus(agent)?.trim().toLowerCase();
  if (sourceStatus && READY_NATIVE_STATUSES.has(sourceStatus)) {
    return {
      isNativeDependent: true,
      key,
      displayName,
      status: 'usable',
      statusLabelKey: 'settings.agentManagement.nativePaired',
      summaryKey: 'settings.agentManagement.nativePairedSummary',
      reasonKey: 'settings.agentManagement.nativeStatusReason',
      reasonParams: { status: sourceStatus },
      repairRoute: '/native-companion',
      repairActionLabelKey: 'settings.agentManagement.goToChat',
      sourceStatus,
    };
  }

  const reasonKey = sourceStatus
    ? REPAIR_NATIVE_STATUSES.has(sourceStatus)
      ? 'settings.agentManagement.nativeStatusReason'
      : 'settings.agentManagement.nativeStatusNotUsableReason'
    : 'settings.agentManagement.nativePairingProofMissing';

  return {
    isNativeDependent: true,
    key,
    displayName,
    status: 'repair_required',
    statusLabelKey: 'settings.agentManagement.nativeRepairRequired',
    summaryKey: 'settings.agentManagement.nativeRepairSummary',
    reasonKey,
    reasonParams: sourceStatus ? { status: sourceStatus } : undefined,
    repairRoute: '/native-companion',
    repairActionLabelKey: 'settings.agentManagement.nativeRepairAction',
    sourceStatus,
  };
}

export function isEvaosNativeAgentRepairRequired(agent: EvaosNativeAgentIdentity): boolean {
  return getEvaosNativeAgentAvailability(agent).status === 'repair_required';
}
