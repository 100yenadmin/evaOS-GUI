/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense } from 'react';
import { Navigate, Route } from 'react-router-dom';
import AppLoader from '@renderer/components/layout/AppLoader';
import { EvaosRuntimeRouteGuard } from '@renderer/components/layout/EvaosRuntimeRouteGuard';
import {
  EVAOS_APPROVAL_CENTER_ENABLED,
  EVAOS_BUSINESS_BROWSER_ENABLED,
  EVAOS_COMPANY_BRAIN_ENABLED,
  EVAOS_PROVIDER_HUB_ENABLED,
} from '@/common/config/constants';

const ApprovalCenter = React.lazy(() => import('@renderer/pages/approval-center'));
const BusinessBrowser = React.lazy(() => import('@renderer/pages/business-browser'));
const CompanyBrain = React.lazy(() => import('@renderer/pages/company-brain'));
const ConnectedApps = React.lazy(() => import('@renderer/pages/connected-apps'));
const CreativeStudio = React.lazy(() => import('@renderer/pages/creative-studio'));
const BetaReadiness = React.lazy(() => import('@renderer/pages/mission-control'));
const DesignWorkspace = React.lazy(() => import('@renderer/pages/design-workspace'));
const EvaosDashboard = React.lazy(() => import('@renderer/pages/evaos-dashboard'));
const HermesDashboard = React.lazy(() => import('@renderer/pages/hermes-dashboard'));
const Home = React.lazy(() => import('@renderer/pages/home'));
const MissionControl = React.lazy(() => import('@renderer/pages/paperclip-mission-control'));
const NativeCompanion = React.lazy(() => import('@renderer/pages/native-companion'));
const PeopleAccess = React.lazy(() => import('@renderer/pages/people-access'));
const Terminal = React.lazy(() => import('@renderer/pages/terminal'));

const withRouteFallback = (Component: React.LazyExoticComponent<React.ComponentType>) => (
  <Suspense fallback={<AppLoader />}>
    <Component />
  </Suspense>
);

const withEvaosRuntimeRouteGuard = (routePath: string, Component: React.LazyExoticComponent<React.ComponentType>) => (
  <EvaosRuntimeRouteGuard routePath={routePath}>{withRouteFallback(Component)}</EvaosRuntimeRouteGuard>
);

export function renderEvaosRoutes(): React.ReactNode {
  return (
    <>
      <Route path='/openclaw' element={<Navigate to='/evaos' replace />} />
      <Route path='/home' element={withEvaosRuntimeRouteGuard('/home', Home)} />
      <Route path='/evaos' element={withEvaosRuntimeRouteGuard('/evaos', EvaosDashboard)} />
      <Route path='/hermes' element={withEvaosRuntimeRouteGuard('/hermes', HermesDashboard)} />
      <Route path='/mission-control' element={withEvaosRuntimeRouteGuard('/mission-control', MissionControl)} />
      <Route path='/design-workspace' element={withEvaosRuntimeRouteGuard('/design-workspace', DesignWorkspace)} />
      <Route path='/beta-readiness' element={withEvaosRuntimeRouteGuard('/beta-readiness', BetaReadiness)} />
      <Route path='/terminal' element={withEvaosRuntimeRouteGuard('/terminal', Terminal)} />
      <Route path='/native-companion' element={withEvaosRuntimeRouteGuard('/native-companion', NativeCompanion)} />
      <Route
        path='/approval-center'
        element={
          EVAOS_APPROVAL_CENTER_ENABLED ? (
            withEvaosRuntimeRouteGuard('/approval-center', ApprovalCenter)
          ) : (
            <Navigate to='/guid' replace />
          )
        }
      />
      <Route
        path='/connected-apps'
        element={
          EVAOS_PROVIDER_HUB_ENABLED ? (
            withEvaosRuntimeRouteGuard('/connected-apps', ConnectedApps)
          ) : (
            <Navigate to='/guid' replace />
          )
        }
      />
      <Route
        path='/business-browser'
        element={
          EVAOS_BUSINESS_BROWSER_ENABLED ? (
            withEvaosRuntimeRouteGuard('/business-browser', BusinessBrowser)
          ) : (
            <Navigate to='/guid' replace />
          )
        }
      />
      <Route path='/creative-studio' element={withEvaosRuntimeRouteGuard('/creative-studio', CreativeStudio)} />
      <Route
        path='/company-brain'
        element={
          EVAOS_COMPANY_BRAIN_ENABLED ? (
            withEvaosRuntimeRouteGuard('/company-brain', CompanyBrain)
          ) : (
            <Navigate to='/guid' replace />
          )
        }
      />
      <Route path='/people-access' element={withEvaosRuntimeRouteGuard('/people-access', PeopleAccess)} />
    </>
  );
}
