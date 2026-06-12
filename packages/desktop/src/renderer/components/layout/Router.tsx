import React, { Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { deepLink, evaosBroker } from '@/common/adapter/ipcBridge';
import AppLoader from '@renderer/components/layout/AppLoader';
import { EVAOS_BETA_WEBUI_FALLBACK_ROUTE, evaosBetaWebUIRouteElement } from '@renderer/evaos/evaosBetaShellPolicy';
import { renderEvaosRoutes } from '@renderer/evaos/evaosRoutes';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import {
  EVAOS_DESKTOP_SESSION_IMPORTED_ACTION,
  EVAOS_DESKTOP_SESSION_IMPORTED_EVENT,
} from '@renderer/hooks/system/useDeepLink';
import { TEAM_MODE_ENABLED } from '@/common/config/constants';
const Conversation = React.lazy(() => import('@renderer/pages/conversation'));
const Guid = React.lazy(() => import('@renderer/pages/guid'));
const AgentSettings = React.lazy(() => import('@renderer/pages/settings/AgentSettings'));
const AssistantSettings = React.lazy(() => import('@renderer/pages/settings/AssistantSettings'));
const CapabilitiesSettings = React.lazy(() => import('@renderer/pages/settings/CapabilitiesSettings'));
const DisplaySettings = React.lazy(() => import('@renderer/pages/settings/DisplaySettings'));
const ModeSettings = React.lazy(() => import('@renderer/pages/settings/ModeSettings'));
const SystemSettings = React.lazy(() => import('@renderer/pages/settings/SystemSettings'));
const WebuiSettings = React.lazy(() => import('@renderer/pages/settings/WebuiSettings'));
const PetSettings = React.lazy(() => import('@renderer/pages/settings/PetSettings'));
const ExtensionSettingsPage = React.lazy(() => import('@renderer/pages/settings/ExtensionSettingsPage'));
const LoginPage = React.lazy(() => import('@renderer/pages/login'));
const ComponentsShowcase = React.lazy(() => import('@renderer/pages/TestShowcase'));
const ScheduledTasksPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage'));
const TaskDetailPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage/TaskDetailPage'));
const TeamIndex = React.lazy(() => import('@renderer/pages/team'));

const withRouteFallback = (Component: React.LazyExoticComponent<React.ComponentType>) => (
  <Suspense fallback={<AppLoader />}>
    <Component />
  </Suspense>
);

const ProtectedLayout: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  if (status === 'checking') {
    return <AppLoader />;
  }

  if (status !== 'authenticated') {
    return <Navigate to='/login' replace />;
  }

  return React.cloneElement(layout);
};

const DesktopSessionImportListener: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    let disposed = false;

    const dispatchDesktopSessionImported = (source: string, confirmed = false) => {
      window.dispatchEvent(
        new CustomEvent(EVAOS_DESKTOP_SESSION_IMPORTED_EVENT, {
          detail: { source, confirmed },
        })
      );
    };

    const confirmDesktopSessionImport = async (source: string) => {
      dispatchDesktopSessionImported(source);
      try {
        const response = await evaosBroker.getSessionStatus.invoke();
        if (!disposed && response.success && response.data?.authenticated === true && !response.data.expired) {
          dispatchDesktopSessionImported(source, true);
          void navigate('/guid', { replace: true });
        }
      } catch {
        // Existing broker-session hooks will surface a safe signed-out/support state.
      }
    };

    return deepLink.received.on((payload) => {
      if (payload.action !== EVAOS_DESKTOP_SESSION_IMPORTED_ACTION) {
        return;
      }
      void confirmDesktopSessionImport(payload.params.source || 'unknown');
    });
  }, [navigate]);

  return null;
};

const PanelRoute: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  return (
    <HashRouter>
      <DesktopSessionImportListener />
      <Routes>
        <Route
          path='/login'
          element={status === 'authenticated' ? <Navigate to='/guid' replace /> : withRouteFallback(LoginPage)}
        />
        <Route element={<ProtectedLayout layout={layout} />}>
          <Route index element={<Navigate to='/guid' replace />} />
          <Route path='/guid' element={withRouteFallback(Guid)} />
          {renderEvaosRoutes()}
          <Route path='/conversation/:id' element={withRouteFallback(Conversation)} />
          <Route
            path='/team/:id'
            element={TEAM_MODE_ENABLED ? withRouteFallback(TeamIndex) : <Navigate to='/guid' replace />}
          />
          <Route path='/settings/model' element={withRouteFallback(ModeSettings)} />
          <Route path='/settings/assistants' element={withRouteFallback(AssistantSettings)} />
          <Route path='/settings/agent' element={withRouteFallback(AgentSettings)} />
          <Route path='/settings/capabilities' element={withRouteFallback(CapabilitiesSettings)} />
          {/* Legacy routes — redirect to the merged /settings/capabilities page */}
          <Route path='/settings/skills-hub' element={<Navigate to='/settings/capabilities?tab=skills' replace />} />
          <Route path='/settings/tools' element={<Navigate to='/settings/capabilities?tab=tools' replace />} />
          <Route path='/settings/display' element={withRouteFallback(DisplaySettings)} />
          <Route
            path='/settings/webui'
            element={evaosBetaWebUIRouteElement(
              withRouteFallback(WebuiSettings),
              <Navigate to={EVAOS_BETA_WEBUI_FALLBACK_ROUTE} replace />
            )}
          />
          <Route path='/settings/pet' element={withRouteFallback(PetSettings)} />
          <Route path='/settings/system' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/about' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/ext/:tabId' element={withRouteFallback(ExtensionSettingsPage)} />
          <Route path='/settings' element={<Navigate to='/settings/model' replace />} />
          <Route path='/test/components' element={withRouteFallback(ComponentsShowcase)} />
          <Route path='/scheduled' element={withRouteFallback(ScheduledTasksPage)} />
          <Route path='/scheduled/:job_id' element={withRouteFallback(TaskDetailPage)} />
        </Route>
        <Route path='*' element={<Navigate to={status === 'authenticated' ? '/guid' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
};

export default PanelRoute;
