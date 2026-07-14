/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type {
  IEvaosNativeCompanionActionRequest,
  IEvaosNativeCompanionActionResult,
  IEvaosNativeCompanionOpenResult,
  IEvaosNativeCompanionRepairAction,
  IEvaosNativeCompanionRepairActionResult,
  IEvaosNativeCompanionStatusView,
  IEvaosPrivateNetworkAuthorityDiagnostic,
  IEvaosPrivateNetworkAuthorityDiagnosticReason,
  IEvaosWorkbenchDiagnosticPacketRequest,
  IEvaosWorkbenchDiagnosticPacketV1,
} from '@/common/evaos/bridgeTypes';

interface EvaosNativeCompanionStatusState {
  status: IEvaosNativeCompanionStatusView | null;
  loading: boolean;
  error: string | null;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  openReleasedWorkbench: () => Promise<IEvaosNativeCompanionOpenResult>;
  openRepairAction: (action: IEvaosNativeCompanionRepairAction) => Promise<IEvaosNativeCompanionRepairActionResult>;
  runAction: (request: IEvaosNativeCompanionActionRequest) => Promise<IEvaosNativeCompanionActionResult>;
  getDiagnosticPacket: (
    request: IEvaosWorkbenchDiagnosticPacketRequest
  ) => Promise<IEvaosWorkbenchDiagnosticPacketV1 | null>;
}

export const NATIVE_COMPANION_STATUS_POLL_MS = 5_000;

const SAFE_AUTHORITY_DIAGNOSTIC_REASONS = new Set<IEvaosPrivateNetworkAuthorityDiagnosticReason>([
  'ready',
  'mac_node_missing',
  'mac_node_offline',
  'mac_node_expired',
  'vm_node_missing',
  'vm_node_offline',
  'vm_node_expired',
  'grant_binding_mismatch',
  'policy_unavailable',
  'policy_hash_mismatch',
  'authority_unavailable',
  'broker_session_expired',
  'local_evidence_unavailable',
  'local_scope_unavailable',
  'authority_proof_invalid',
]);

function safeAuthorityDiagnostic(value: unknown): IEvaosPrivateNetworkAuthorityDiagnostic | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.classification !== 'observed' &&
      candidate.classification !== 'unavailable' &&
      candidate.classification !== 'stale') ||
    typeof candidate.reason !== 'string' ||
    !SAFE_AUTHORITY_DIAGNOSTIC_REASONS.has(candidate.reason as IEvaosPrivateNetworkAuthorityDiagnosticReason)
  ) {
    return undefined;
  }
  const auditId =
    typeof candidate.auditId === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(candidate.auditId)
      ? candidate.auditId
      : undefined;
  return {
    classification: candidate.classification,
    reason: candidate.reason as IEvaosPrivateNetworkAuthorityDiagnosticReason,
    auditId,
  };
}

function safeRendererStatus(status: IEvaosNativeCompanionStatusView): IEvaosNativeCompanionStatusView {
  return {
    ...status,
    privateNetworkAuthority: safeAuthorityDiagnostic(status.privateNetworkAuthority),
  };
}

function safeRendererDiagnosticPacket(packet: IEvaosWorkbenchDiagnosticPacketV1): IEvaosWorkbenchDiagnosticPacketV1 {
  return {
    ...packet,
    brokerGrant: {
      ...packet.brokerGrant,
      privateNetworkAuthority: safeAuthorityDiagnostic(packet.brokerGrant.privateNetworkAuthority),
    },
  };
}

/** Returns customer-scoped native companion state and rejects stale refresh results after customer switches. */
export function useEvaosNativeCompanionStatus(enabled = true, customerId?: string): EvaosNativeCompanionStatusState {
  const scopeKey = customerId ?? '';
  const [scopedStatus, setScopedStatus] = useState<{
    scopeKey: string;
    status: IEvaosNativeCompanionStatusView;
  } | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const currentScopeRef = useRef<string | undefined>(enabled ? scopeKey : undefined);
  currentScopeRef.current = enabled ? scopeKey : undefined;
  const refreshInFlightScopesRef = useRef(new Set<string>());
  const queuedForegroundScopesRef = useRef(new Set<string>());
  const bootstrapGrantRef = useRef<{ scopeKey: string; grantId: string } | null>(null);

  const refresh = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!enabled) {
        setScopedStatus(null);
        setLoading(false);
        setError(null);
        return;
      }
      if (refreshInFlightScopesRef.current.has(scopeKey)) {
        if (!options.silent) queuedForegroundScopesRef.current.add(scopeKey);
        return;
      }

      refreshInFlightScopesRef.current.add(scopeKey);
      if (!options.silent) setLoading(true);
      setError(null);
      try {
        const bootstrapGrantId =
          bootstrapGrantRef.current?.scopeKey === scopeKey ? bootstrapGrantRef.current.grantId : undefined;
        const response = await ipcBridge.evaosNativeCompanion.getStatus.invoke({
          customerId,
          ...(bootstrapGrantId ? { bootstrapGrantId } : {}),
        });
        if (currentScopeRef.current !== scopeKey) return;
        if (!response.success || !response.data) {
          setScopedStatus(null);
          setError(response.msg || 'Workbench connector status failed safely.');
          return;
        }
        const safeStatus = safeRendererStatus(response.data);
        if (bootstrapGrantId && safeStatus.activeMacControlScopeId === bootstrapGrantId) {
          bootstrapGrantRef.current = null;
        }
        setScopedStatus({ scopeKey, status: safeStatus });
      } catch {
        if (currentScopeRef.current === scopeKey) {
          setScopedStatus(null);
          setError('Workbench connector status could not be reached.');
        }
      } finally {
        if (currentScopeRef.current === scopeKey) setLoading(false);
        refreshInFlightScopesRef.current.delete(scopeKey);
        if (queuedForegroundScopesRef.current.delete(scopeKey) && currentScopeRef.current === scopeKey) {
          void refresh();
        }
      }
    },
    [customerId, enabled, scopeKey]
  );

  const openReleasedWorkbench = useCallback(async () => {
    const response = await ipcBridge.evaosNativeCompanion.openReleasedWorkbench.invoke();
    if (!response.success || !response.data) {
      return {
        opened: false,
        message: response.msg || 'Released evaOS Workbench could not be opened.',
      };
    }
    return response.data;
  }, []);

  const openRepairAction = useCallback(async (action: IEvaosNativeCompanionRepairAction) => {
    const response = await ipcBridge.evaosNativeCompanion.openRepairAction.invoke({ action });
    if (!response.success || !response.data) {
      return {
        opened: false,
        message: response.msg || 'Native repair action could not be opened.',
      };
    }
    return response.data;
  }, []);

  const runAction = useCallback(
    async (request: IEvaosNativeCompanionActionRequest): Promise<IEvaosNativeCompanionActionResult> => {
      let response: Awaited<ReturnType<(typeof ipcBridge.evaosNativeCompanion.runAction)['invoke']>>;
      try {
        response = await ipcBridge.evaosNativeCompanion.runAction.invoke(request);
      } catch {
        return {
          action: request.action,
          status: 'failed',
          message: 'Workbench connector action could not be reached.',
          sourcePointer:
            request.action === 'secure_network_enroll'
              ? 'native-companion:secure-network-enrollment-action-unreachable'
              : 'native-companion:action-unreachable',
          auditIds: [],
          refreshRecommended: true,
        };
      }
      if (!response.success || !response.data) {
        return {
          action: request.action,
          status: 'failed',
          message: response.msg || 'Workbench connector action failed safely.',
          sourcePointer: 'native-companion:action-failed',
          auditIds: [],
          refreshRecommended: true,
        };
      }
      if (
        response.data.action === 'secure_network_enroll' &&
        response.data.status === 'succeeded' &&
        request.customerId === customerId &&
        typeof response.data.bootstrapGrantId === 'string' &&
        /^[A-Za-z0-9._:-]{1,160}$/.test(response.data.bootstrapGrantId)
      ) {
        bootstrapGrantRef.current = { scopeKey, grantId: response.data.bootstrapGrantId };
      }
      return response.data;
    },
    [customerId, scopeKey]
  );

  const getDiagnosticPacket = useCallback(
    async (request: IEvaosWorkbenchDiagnosticPacketRequest): Promise<IEvaosWorkbenchDiagnosticPacketV1 | null> => {
      try {
        const response = await ipcBridge.evaosNativeCompanion.getDiagnosticPacket.invoke(request);
        if (!response.success || !response.data) {
          return null;
        }
        return safeRendererDiagnosticPacket(response.data);
      } catch {
        return null;
      }
    },
    []
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    const interval = window.setInterval(() => {
      void refresh({ silent: true });
    }, NATIVE_COMPANION_STATUS_POLL_MS);
    return () => window.clearInterval(interval);
  }, [enabled, refresh]);

  return {
    status: enabled && scopedStatus?.scopeKey === scopeKey ? scopedStatus.status : null,
    loading,
    error,
    refresh,
    openReleasedWorkbench,
    openRepairAction,
    runAction,
    getDiagnosticPacket,
  };
}
