/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useEvaosCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { evaosBrokerSessionKey, useEvaosBrokerSessionStatus } from '@renderer/hooks/useEvaosBrokerSessionStatus';
import { canAccessEvaosAdminRuntimes } from '@renderer/evaos/evaosRuntimeVisibility';

interface EvaosSidebarState {
  canSeeMissionControl: boolean;
}

export function useEvaosSidebarState(): EvaosSidebarState {
  const { status, user } = useAuth();
  const brokerSessionStatus = useEvaosBrokerSessionStatus(status === 'authenticated');
  const brokerAuthenticated =
    status === 'authenticated' &&
    brokerSessionStatus.session?.authenticated === true &&
    !brokerSessionStatus.session.expired;
  const customerContext = useEvaosCustomerContext(
    brokerAuthenticated,
    evaosBrokerSessionKey(brokerSessionStatus.session)
  );

  const canSeeMissionControl = useMemo(() => {
    if (status !== 'authenticated' || brokerSessionStatus.loading) return false;
    if (!brokerAuthenticated) return true;
    return (
      customerContext.loaded &&
      canAccessEvaosAdminRuntimes({
        authenticated: status === 'authenticated',
        roles: customerContext.roles,
        isOperator: customerContext.isOperator,
        userEmail: brokerSessionStatus.session?.userEmail ?? user?.username,
      })
    );
  }, [
    brokerAuthenticated,
    brokerSessionStatus.loading,
    brokerSessionStatus.session?.userEmail,
    customerContext.isOperator,
    customerContext.loaded,
    customerContext.roles,
    status,
    user?.username,
  ]);

  return { canSeeMissionControl };
}
