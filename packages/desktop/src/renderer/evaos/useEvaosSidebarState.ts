/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useEvaosCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { evaosBrokerSessionKey, useEvaosBrokerSessionStatus } from '@renderer/hooks/useEvaosBrokerSessionStatus';
import {
  canAccessEvaosAdminRuntimes,
  evaosRouteAllowsMissingBroker,
  evaosRuntimeRouteDecision,
} from '@renderer/evaos/evaosRuntimeVisibility';
import type { IEvaosCustomerTargetView } from '@/common/evaos/bridgeTypes';

interface EvaosSidebarState {
  accountLabel?: string;
  selectedCustomerId?: string;
  selectedCustomerLabel?: string;
  customerTargets: IEvaosCustomerTargetView[];
  canSwitchCustomers: boolean;
  selectCustomer: (customerId: string) => void;
  brokerAuthenticated: boolean;
  canSeeHome: boolean;
  canSeeEvaos: boolean;
  canSeeHermes: boolean;
  canSeeMissionControl: boolean;
  canSeeTerminal: boolean;
  canSeePeopleAccess: boolean;
  canSeeConnectedApps: boolean;
  canSeeDesignWorkspace: boolean;
  canSeeBusinessBrowser: boolean;
  canSeeCreativeStudio: boolean;
  canSeeCompanyBrain: boolean;
  canSeeApprovalCenter: boolean;
  canSeeNativeCompanion: boolean;
}

export function useEvaosSidebarState(): EvaosSidebarState {
  const { status, user } = useAuth();
  const webAuthenticated = status === 'authenticated';
  const brokerSessionStatus = useEvaosBrokerSessionStatus(true);
  const brokerAuthenticated =
    brokerSessionStatus.session?.authenticated === true && !brokerSessionStatus.session.expired;
  const shellAuthenticated = webAuthenticated || brokerAuthenticated;
  const customerContext = useEvaosCustomerContext(
    brokerAuthenticated,
    evaosBrokerSessionKey(brokerSessionStatus.session),
    brokerSessionStatus.loading ? { clearOnUnauthenticated: false } : undefined
  );

  const routeContext = useMemo(
    () => ({
      authenticated: shellAuthenticated,
      roles: customerContext.roles,
      scopes: customerContext.scopes,
      isOperator: customerContext.isOperator,
      userEmail: brokerSessionStatus.session?.userEmail ?? user?.username,
    }),
    [
      brokerSessionStatus.session?.userEmail,
      customerContext.isOperator,
      customerContext.roles,
      customerContext.scopes,
      shellAuthenticated,
      user?.username,
    ]
  );

  const brokerPolicyContext = useMemo(
    () => ({
      ...routeContext,
      authenticated: shellAuthenticated,
    }),
    [routeContext, shellAuthenticated]
  );

  const canSeeRepairableRoute = useMemo(() => {
    return (routePath: string): boolean => {
      if (!shellAuthenticated || brokerSessionStatus.loading) return false;
      if (!brokerAuthenticated) return true;
      return customerContext.loaded && evaosRuntimeRouteDecision(routePath, routeContext).allowed;
    };
  }, [brokerAuthenticated, brokerSessionStatus.loading, customerContext.loaded, routeContext, shellAuthenticated]);

  const canSeeMissionControl = useMemo(() => {
    if (!shellAuthenticated || brokerSessionStatus.loading) return false;
    if (!brokerAuthenticated) return true;
    return customerContext.loaded && evaosRuntimeRouteDecision('/mission-control', routeContext).allowed;
  }, [brokerAuthenticated, brokerSessionStatus.loading, customerContext.loaded, routeContext, shellAuthenticated]);

  const canSeeNativeCompanion = useMemo(() => {
    if (!shellAuthenticated || brokerSessionStatus.loading) return false;
    if (!brokerAuthenticated) return true;
    return customerContext.loaded && evaosRuntimeRouteDecision('/native-companion', routeContext).allowed;
  }, [brokerAuthenticated, brokerSessionStatus.loading, customerContext.loaded, routeContext, shellAuthenticated]);

  const canSeeBrokeredRoute = useMemo(() => {
    return (routePath: string): boolean => {
      if (!shellAuthenticated || brokerSessionStatus.loading) {
        return false;
      }
      if (!brokerAuthenticated) return evaosRouteAllowsMissingBroker(routePath);
      if (!customerContext.loaded) return false;
      return evaosRuntimeRouteDecision(routePath, routeContext).allowed;
    };
  }, [brokerAuthenticated, brokerSessionStatus.loading, customerContext.loaded, routeContext, shellAuthenticated]);

  const canSwitchCustomers =
    brokerAuthenticated && canAccessEvaosAdminRuntimes(brokerPolicyContext) && customerContext.targets.length > 1;

  return {
    accountLabel: brokerSessionStatus.session?.authenticated
      ? (brokerSessionStatus.session.userEmail ?? user?.username)
      : user?.username,
    selectedCustomerId: customerContext.selectedCustomerId,
    selectedCustomerLabel: customerContext.selectedTarget?.displayName ?? customerContext.selectedCustomerId,
    customerTargets: customerContext.targets,
    canSwitchCustomers,
    selectCustomer: customerContext.selectCustomer,
    brokerAuthenticated,
    canSeeHome: shellAuthenticated,
    canSeeEvaos: canSeeRepairableRoute('/evaos'),
    canSeeHermes: canSeeRepairableRoute('/hermes'),
    canSeeMissionControl,
    canSeeTerminal: canSeeBrokeredRoute('/terminal'),
    canSeePeopleAccess: canSeeBrokeredRoute('/people-access'),
    canSeeConnectedApps: canSeeBrokeredRoute('/connected-apps'),
    canSeeDesignWorkspace: canSeeBrokeredRoute('/design-workspace'),
    canSeeBusinessBrowser: canSeeBrokeredRoute('/business-browser'),
    canSeeCreativeStudio: canSeeBrokeredRoute('/creative-studio'),
    canSeeCompanyBrain: canSeeBrokeredRoute('/company-brain'),
    canSeeApprovalCenter: canSeeBrokeredRoute('/approval-center'),
    canSeeNativeCompanion,
  };
}
