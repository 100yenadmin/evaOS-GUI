/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  NativeCompanionActionEnginePrerequisite,
  NativeCompanionBridgeRuntimePrerequisite,
  NativeCompanionPrerequisites,
  NativeCompanionPrivateNetworkPrerequisite,
} from './bridgeTypes';

export type NativeCompanionPrerequisiteEvidence = {
  bridgeRuntime: {
    installed: boolean;
    commandSucceeded?: boolean;
    compatible?: boolean;
  };
  privateNetwork?: {
    clientInstalled?: boolean;
    clientRunning?: boolean;
    enrolled?: boolean;
    correctControlPlane?: boolean;
    aclAllowed?: boolean;
    online?: boolean;
  };
  actionEngine?: {
    cuaAvailable?: boolean;
    cuaActiveForActions?: boolean;
    peekabooAvailable?: boolean;
    nativeFallbackAvailable?: boolean;
  };
};

export function classifyNativeCompanionBridgeRuntime(
  evidence: NativeCompanionPrerequisiteEvidence['bridgeRuntime']
): NativeCompanionBridgeRuntimePrerequisite {
  if (!evidence.installed) return 'missing';
  if (evidence.commandSucceeded !== true) return 'error';
  if (evidence.compatible === false) return 'incompatible';
  return evidence.compatible === true ? 'ready' : 'error';
}

export function classifyNativeCompanionPrivateNetwork(
  evidence: NativeCompanionPrerequisiteEvidence['privateNetwork']
): NativeCompanionPrivateNetworkPrerequisite {
  if (!evidence) return 'error';
  if (evidence.clientInstalled === false) return 'client_missing';
  if (evidence.clientInstalled !== true) return 'error';
  if (evidence.clientRunning === false) return 'client_stopped';
  if (evidence.clientRunning !== true) return 'error';
  if (evidence.enrolled === false) return 'unenrolled';
  if (evidence.enrolled !== true) return 'error';
  if (evidence.correctControlPlane === false) return 'wrong_control_plane';
  if (evidence.correctControlPlane !== true) return 'error';
  if (evidence.aclAllowed === false) return 'acl_blocked';
  if (evidence.aclAllowed !== true) return 'error';
  if (evidence.online === false) return 'offline';
  return evidence.online === true ? 'online' : 'error';
}

export function classifyNativeCompanionActionEngine(
  evidence: NativeCompanionPrerequisiteEvidence['actionEngine']
): NativeCompanionActionEnginePrerequisite {
  if (evidence?.cuaAvailable === true && evidence.cuaActiveForActions === true) return 'cua_ready';
  if (evidence?.peekabooAvailable === true) return 'peekaboo_ready';
  if (evidence?.nativeFallbackAvailable === true) return 'native_fallback_ready';
  return 'unavailable';
}

export function classifyNativeCompanionPrerequisites(
  evidence: NativeCompanionPrerequisiteEvidence
): NativeCompanionPrerequisites {
  return {
    bridgeRuntime: classifyNativeCompanionBridgeRuntime(evidence.bridgeRuntime),
    privateNetwork: classifyNativeCompanionPrivateNetwork(evidence.privateNetwork),
    actionEngine: classifyNativeCompanionActionEngine(evidence.actionEngine),
  };
}
