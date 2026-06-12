/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import type {
  IEvaosNativeCompanionOpenResult,
  IEvaosNativeCompanionRepairAction,
  IEvaosNativeCompanionRepairActionResult,
  IEvaosNativeCompanionStatusView,
} from '@/common/evaos/bridgeTypes';

interface EvaosNativeCompanionStatusState {
  status: IEvaosNativeCompanionStatusView | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  openReleasedWorkbench: () => Promise<IEvaosNativeCompanionOpenResult>;
  openRepairAction: (action: IEvaosNativeCompanionRepairAction) => Promise<IEvaosNativeCompanionRepairActionResult>;
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
        setError(response.msg || 'Native companion status failed safely.');
        return;
      }
      setStatus(response.data);
    } catch {
      setStatus(null);
      setError('Native companion status could not be reached.');
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
  };
}
