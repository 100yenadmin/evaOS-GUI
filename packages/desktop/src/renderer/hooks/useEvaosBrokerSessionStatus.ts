/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { evaosBroker } from '@/common/adapter/ipcBridge';
import type { IEvaosBrokerSessionStatus } from '@/common/evaos/bridgeTypes';
import { EVAOS_DESKTOP_SESSION_IMPORTED_EVENT } from './system/useDeepLink';

export const EVAOS_DESKTOP_SESSION_CLEARED_EVENT = 'evaos:desktop-session-cleared';

interface EvaosBrokerSessionStatusState {
  session: IEvaosBrokerSessionStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function evaosBrokerSessionKey(session: IEvaosBrokerSessionStatus | null): string | undefined {
  if (!session?.authenticated || session.expired) return undefined;
  const fallbackKey = [session.state, session.source, session.userEmail, session.expiresAt].filter(Boolean).join('|');
  return session.sessionKey ?? (fallbackKey || 'active');
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

  useEffect(() => {
    if (!enabled) return undefined;
    const handleDesktopSessionChanged = () => {
      void refresh();
    };
    window.addEventListener(EVAOS_DESKTOP_SESSION_IMPORTED_EVENT, handleDesktopSessionChanged);
    window.addEventListener(EVAOS_DESKTOP_SESSION_CLEARED_EVENT, handleDesktopSessionChanged);
    return () => {
      window.removeEventListener(EVAOS_DESKTOP_SESSION_IMPORTED_EVENT, handleDesktopSessionChanged);
      window.removeEventListener(EVAOS_DESKTOP_SESSION_CLEARED_EVENT, handleDesktopSessionChanged);
    };
  }, [enabled, refresh]);

  return {
    session,
    loading,
    error,
    refresh,
  };
}
