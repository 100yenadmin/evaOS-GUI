/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Navigate } from 'react-router-dom';
import AppLoader from '@renderer/components/layout/AppLoader';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useEvaosCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { evaosBrokerSessionKey, useEvaosBrokerSessionStatus } from '@renderer/hooks/useEvaosBrokerSessionStatus';
import { evaosRouteAllowsMissingBroker, evaosRuntimeRouteDecision } from '@renderer/evaos/evaosRuntimeVisibility';

interface EvaosRuntimeRouteGuardProps {
  routePath: string;
  children: React.ReactNode;
}

export const EvaosRuntimeRouteGuard: React.FC<EvaosRuntimeRouteGuardProps> = ({ routePath, children }) => {
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

  if (status === 'checking' && !brokerAuthenticated) {
    return <AppLoader />;
  }

  if (!shellAuthenticated) {
    return <Navigate to='/login' replace />;
  }

  if (brokerSessionStatus.loading) {
    return <AppLoader />;
  }

  if (!brokerAuthenticated) {
    if (evaosRouteAllowsMissingBroker(routePath)) {
      return <>{children}</>;
    }

    return (
      <Navigate to='/guid' replace state={{ evaosRouteDenied: 'broker_session_required', evaosRoutePath: routePath }} />
    );
  }

  if (customerContext.loading || !customerContext.loaded) {
    if (evaosRouteAllowsMissingBroker(routePath)) {
      return <>{children}</>;
    }
    return <AppLoader />;
  }

  const decision = evaosRuntimeRouteDecision(routePath, {
    authenticated: shellAuthenticated,
    roles: customerContext.roles,
    scopes: customerContext.scopes,
    isOperator: customerContext.isOperator,
    userEmail: brokerSessionStatus.session?.userEmail ?? user?.username,
  });

  if (!decision.allowed) {
    return (
      <Navigate
        to={decision.fallbackPath}
        replace
        state={{ evaosRouteDenied: decision.reason, evaosRoutePath: routePath }}
      />
    );
  }

  return <>{children}</>;
};
