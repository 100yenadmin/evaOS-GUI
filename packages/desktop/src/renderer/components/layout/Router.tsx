import React, { Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppLoader from '@renderer/components/layout/AppLoader';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import {
  BUILTIN_SETTINGS_TAB_IDS,
  canAccessWorkbenchRoute,
  getDefaultSettingsPath,
  getWorkbenchRouteFallback,
  useWorkbenchPolicy,
} from '@renderer/hooks/context/WorkbenchPolicyContext';
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

const GuardedRoute: React.FC<{ pathname: string; element: React.ReactElement }> = ({ pathname, element }) => {
  const { policy } = useWorkbenchPolicy();

  if (!canAccessWorkbenchRoute(pathname, policy)) {
    return <Navigate to={getWorkbenchRouteFallback(pathname, BUILTIN_SETTINGS_TAB_IDS, policy)} replace />;
  }

  return element;
};

const SettingsIndexRedirect: React.FC = () => {
  const { policy } = useWorkbenchPolicy();
  return <Navigate to={getDefaultSettingsPath(BUILTIN_SETTINGS_TAB_IDS, policy)} replace />;
};

const LegacySettingsRedirect: React.FC<{ pathname: string; allowedTo: string }> = ({ pathname, allowedTo }) => {
  const { policy } = useWorkbenchPolicy();
  const to = canAccessWorkbenchRoute(pathname, policy)
    ? allowedTo
    : getWorkbenchRouteFallback(pathname, BUILTIN_SETTINGS_TAB_IDS, policy);

  return <Navigate to={to} replace />;
};

const PanelRoute: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  return (
    <HashRouter>
      <Routes>
        <Route
          path='/login'
          element={status === 'authenticated' ? <Navigate to='/guid' replace /> : withRouteFallback(LoginPage)}
        />
        <Route element={<ProtectedLayout layout={layout} />}>
          <Route index element={<Navigate to='/guid' replace />} />
          <Route path='/guid' element={withRouteFallback(Guid)} />
          <Route path='/conversation/:id' element={withRouteFallback(Conversation)} />
          <Route
            path='/team/:id'
            element={
              TEAM_MODE_ENABLED ? (
                <GuardedRoute pathname='/team/:id' element={withRouteFallback(TeamIndex)} />
              ) : (
                <Navigate to='/guid' replace />
              )
            }
          />
          <Route
            path='/settings/model'
            element={<GuardedRoute pathname='/settings/model' element={withRouteFallback(ModeSettings)} />}
          />
          <Route
            path='/settings/assistants'
            element={<GuardedRoute pathname='/settings/assistants' element={withRouteFallback(AssistantSettings)} />}
          />
          <Route
            path='/settings/agent'
            element={<GuardedRoute pathname='/settings/agent' element={withRouteFallback(AgentSettings)} />}
          />
          <Route
            path='/settings/capabilities'
            element={
              <GuardedRoute pathname='/settings/capabilities' element={withRouteFallback(CapabilitiesSettings)} />
            }
          />
          {/* Legacy routes — redirect to the merged /settings/capabilities page */}
          <Route
            path='/settings/skills-hub'
            element={
              <LegacySettingsRedirect pathname='/settings/skills-hub' allowedTo='/settings/capabilities?tab=skills' />
            }
          />
          <Route
            path='/settings/tools'
            element={<LegacySettingsRedirect pathname='/settings/tools' allowedTo='/settings/capabilities?tab=tools' />}
          />
          <Route
            path='/settings/display'
            element={<GuardedRoute pathname='/settings/display' element={withRouteFallback(DisplaySettings)} />}
          />
          <Route
            path='/settings/webui'
            element={<GuardedRoute pathname='/settings/webui' element={withRouteFallback(WebuiSettings)} />}
          />
          <Route
            path='/settings/pet'
            element={<GuardedRoute pathname='/settings/pet' element={withRouteFallback(PetSettings)} />}
          />
          <Route
            path='/settings/system'
            element={<GuardedRoute pathname='/settings/system' element={withRouteFallback(SystemSettings)} />}
          />
          <Route
            path='/settings/about'
            element={<GuardedRoute pathname='/settings/about' element={withRouteFallback(SystemSettings)} />}
          />
          <Route
            path='/settings/ext/:tabId'
            element={
              <GuardedRoute pathname='/settings/ext/:tabId' element={withRouteFallback(ExtensionSettingsPage)} />
            }
          />
          <Route path='/settings' element={<SettingsIndexRedirect />} />
          <Route
            path='/test/components'
            element={<GuardedRoute pathname='/test/components' element={withRouteFallback(ComponentsShowcase)} />}
          />
          <Route
            path='/scheduled'
            element={<GuardedRoute pathname='/scheduled' element={withRouteFallback(ScheduledTasksPage)} />}
          />
          <Route
            path='/scheduled/:job_id'
            element={<GuardedRoute pathname='/scheduled/:job_id' element={withRouteFallback(TaskDetailPage)} />}
          />
        </Route>
        <Route path='*' element={<Navigate to={status === 'authenticated' ? '/guid' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
};

export default PanelRoute;
