/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { evaosBroker, type IEvaosBrokerSessionStatus } from '@/common/adapter/ipcBridge';

interface EvaosBrokerSessionStatusState {
  session: IEvaosBrokerSessionStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function evaosBrokerSessionKey(session: IEvaosBrokerSessionStatus | null): string | undefined {
  if (!session?.authenticated || session.expired) return undefined;
  return [session.state, session.source, session.userEmail, session.expiresAt].filter(Boolean).join('|') || 'active';
}

export function useEvaosBrokerSessionStatus(enabled = true): EvaosBrokerSessionStatusState {
  const [session, setSession] = useState<IEvaosBrokerSessionStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setSession(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await evaosBroker.getSessionStatus.invoke();
      if (!response.success || !response.data) {
        setSession(null);
        setError('The evaOS broker session check failed safely.');
        return;
      }
      setSession(response.data);
    } catch {
      setSession(null);
      setError('The evaOS broker could not be reached.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    session,
    loading,
    error,
    refresh,
  };
}
