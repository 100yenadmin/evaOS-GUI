/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import type {
  IEvaosNativeCompanionActionRequest,
  IEvaosNativeCompanionActionResult,
  IEvaosNativeCompanionOpenResult,
  IEvaosNativeCompanionRepairAction,
  IEvaosNativeCompanionRepairActionResult,
  IEvaosNativeCompanionStatusView,
  IEvaosWorkbenchDiagnosticPacketRequest,
  IEvaosWorkbenchDiagnosticPacketV1,
} from '@/common/evaos/bridgeTypes';

interface EvaosNativeCompanionStatusState {
  status: IEvaosNativeCompanionStatusView | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  openReleasedWorkbench: () => Promise<IEvaosNativeCompanionOpenResult>;
  openRepairAction: (action: IEvaosNativeCompanionRepairAction) => Promise<IEvaosNativeCompanionRepairActionResult>;
  runAction: (request: IEvaosNativeCompanionActionRequest) => Promise<IEvaosNativeCompanionActionResult>;
  getDiagnosticPacket: (
    request: IEvaosWorkbenchDiagnosticPacketRequest
  ) => Promise<IEvaosWorkbenchDiagnosticPacketV1 | null>;
}

export function useEvaosNativeCompanionStatus(enabled = true): EvaosNativeCompanionStatusState {
  const [status, setStatus] = useState<IEvaosNativeCompanionStatusView | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setStatus(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await ipcBridge.evaosNativeCompanion.getStatus.invoke();
      if (!response.success || !response.data) {
        setStatus(null);
        setError(response.msg || 'Workbench connector status failed safely.');
        return;
      }
      setStatus(response.data);
    } catch {
      setStatus(null);
      setError('Workbench connector status could not be reached.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

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
      const response = await ipcBridge.evaosNativeCompanion.runAction.invoke(request);
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
      return response.data;
    },
    []
  );

  const getDiagnosticPacket = useCallback(
    async (request: IEvaosWorkbenchDiagnosticPacketRequest): Promise<IEvaosWorkbenchDiagnosticPacketV1 | null> => {
      try {
        const response = await ipcBridge.evaosNativeCompanion.getDiagnosticPacket.invoke(request);
        if (!response.success || !response.data) {
          return null;
        }
        return response.data;
      } catch {
        return null;
      }
    },
    []
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    status,
    loading,
    error,
    refresh,
    openReleasedWorkbench,
    openRepairAction,
    runAction,
    getDiagnosticPacket,
  };
}
