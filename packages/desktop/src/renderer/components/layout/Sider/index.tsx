import classNames from 'classnames';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePreviewContext } from '@renderer/pages/conversation/Preview/context/PreviewContext';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { clearEvaosCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { useThemeContext } from '@renderer/hooks/context/ThemeContext';
import { openEvaosSupportEmail } from '@renderer/utils/platform';
import {
  EVAOS_CUSTOMER_CONTEXT_CHANGED_EVENT,
  EVAOS_DESKTOP_SESSION_CLEARED_EVENT,
} from '@renderer/hooks/useEvaosBrokerSessionStatus';
import { useAllCronJobs } from '@renderer/pages/cron/useCronJobs';
import { useTeamCreatedRedirect } from '@renderer/pages/team/hooks/useTeamCreatedRedirect';
import EvaosSidebarSection from '@renderer/evaos/EvaosSidebarSection';
import { useEvaosSidebarState } from '@renderer/evaos/useEvaosSidebarState';
import { SiderTerminalEntry } from '@renderer/evaos/sidebar';
import { TEAM_MODE_ENABLED } from '@/common/config/constants';
import { evaosBroker } from '@/common/adapter/ipcBridge';
import { SiderScheduledEntry, SiderSearchEntry, SiderSupportEntry, SiderToolbar } from './SiderNav';
import SiderFooter from './SiderFooter';
import CronJobSiderSection from './CronJobSiderSection';
import TeamSiderSection from './TeamSiderSection';
import siderStyles from './Sider.module.css';

const WorkspaceGroupedHistory = React.lazy(() => import('@renderer/pages/conversation/GroupedHistory'));
const SettingsSider = React.lazy(() => import('@renderer/pages/settings/components/SettingsSider'));

function getEvaosBrokerSignInError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'evaOS sign-in could not start. Check the desktop broker connection.';
}

interface SiderProps {
  onSessionClick?: () => void;
  collapsed?: boolean;
}

const Sider: React.FC<SiderProps> = ({ onSessionClick, collapsed = false }) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const location = useLocation();
  const { pathname, search, hash } = location;

  const navigate = useNavigate();
  const { closePreview } = usePreviewContext();
  const { logout, user } = useAuth();
  const { theme, setTheme } = useThemeContext();
  const [isBatchMode, setIsBatchMode] = useState(false);
  const { jobs: cronJobs } = useAllCronJobs();
  const evaosSidebarState = useEvaosSidebarState();
  const [brokerSignInError, setBrokerSignInError] = useState<string | null>(null);
  useTeamCreatedRedirect();
  const isSettings = pathname.startsWith('/settings');
  const lastNonSettingsPathRef = useRef('/evaos');
  const showLogout = evaosSidebarState.brokerAuthenticated;
  const showBrokerSignIn = !evaosSidebarState.brokerAuthenticated;

  useEffect(() => {
    if (!pathname.startsWith('/settings')) {
      lastNonSettingsPathRef.current = `${pathname}${search}${hash}`;
    }
  }, [pathname, search, hash]);

  const handleNewChat = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
    Promise.resolve(navigate('/guid', { state: { resetAssistant: true } })).catch((error) => {
      console.error('Navigation failed:', error);
    });
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleSettingsClick = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    if (isSettings) {
      const target = lastNonSettingsPathRef.current || '/guid';
      Promise.resolve(navigate(target)).catch((error) => {
        console.error('Navigation failed:', error);
      });
    } else {
      Promise.resolve(navigate('/settings/model')).catch((error) => {
        console.error('Navigation failed:', error);
      });
    }
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleConversationSelect = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
  };

  const handleScheduledClick = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
    Promise.resolve(navigate('/scheduled')).catch((error) => {
      console.error('Navigation failed:', error);
    });
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleEvaosNavigate = useCallback(
    (path: string) => {
      cleanupSiderTooltips();
      blurActiveElement();
      closePreview();
      setIsBatchMode(false);
      Promise.resolve(navigate(path)).catch((error) => {
        console.error('Navigation failed:', error);
      });
      if (onSessionClick) {
        onSessionClick();
      }
    },
    [closePreview, navigate, onSessionClick]
  );

  const handleQuickThemeToggle = () => {
    void setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handleSupportClick = useCallback(() => {
    void openEvaosSupportEmail({ subject: 'evaOS Workbench Beta support' }).catch((error) => {
      console.error('evaOS support link failed:', error);
    });
  }, []);

  const handleBeginDesktopAuth = useCallback(async () => {
    cleanupSiderTooltips();
    blurActiveElement();
    setBrokerSignInError(null);
    try {
      const response = await evaosBroker.beginDesktopAuth.invoke();
      if (!response.success) {
        setBrokerSignInError(response.msg || 'evaOS sign-in could not start. Check the desktop broker connection.');
      }
    } catch (error) {
      setBrokerSignInError(getEvaosBrokerSignInError(error));
      console.error('evaOS broker sign-in failed:', error);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setBrokerSignInError(null);
    try {
      await evaosBroker.revokeSession.invoke();
    } catch (error) {
      console.error('evaOS broker session revoke failed:', error);
    } finally {
      clearEvaosCustomerContext();
      window.dispatchEvent(new CustomEvent(EVAOS_DESKTOP_SESSION_CLEARED_EVENT, { detail: { source: 'footer' } }));
    }
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
      return; // logout 失败时不执行后续操作
    }
    if (onSessionClick) {
      onSessionClick();
    }
  }, [closePreview, logout, onSessionClick]);

  const handleCustomerChange = useCallback(
    async (customerId: string) => {
      const previousCustomerId = evaosSidebarState.selectedCustomerId;
      if (!customerId || customerId === previousCustomerId) {
        evaosSidebarState.selectCustomer(customerId);
        return;
      }

      cleanupSiderTooltips();
      blurActiveElement();
      closePreview();
      setBrokerSignInError(null);

      if (previousCustomerId) {
        try {
          const response = await evaosBroker.clearCustomerRuntimeState.invoke({ customerId: previousCustomerId });
          if (!response.success) {
            console.error('evaOS customer runtime state clear failed:', response.msg);
            return;
          }
        } catch (error) {
          console.error('evaOS customer runtime state clear failed:', error);
          return;
        }
      }

      evaosSidebarState.selectCustomer(customerId);
      window.dispatchEvent(
        new CustomEvent(EVAOS_CUSTOMER_CONTEXT_CHANGED_EVENT, {
          detail: {
            source: 'footer',
            previousCustomerId,
            selectedCustomerId: customerId,
          },
        })
      );
      if (onSessionClick) {
        onSessionClick();
      }
    },
    [closePreview, evaosSidebarState, onSessionClick]
  );

  useEffect(() => {
    if (!showLogout) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        handleLogout();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleLogout, showLogout]);

  const handleCronNavigate = (path: string) => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    Promise.resolve(navigate(path)).catch(console.error);
    if (onSessionClick) onSessionClick();
  };

  const tooltipEnabled = collapsed && !isMobile;
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);

  const workspaceHistoryProps = {
    collapsed,
    tooltipEnabled,
    onSessionClick,
    batchMode: isBatchMode,
    onBatchModeChange: setIsBatchMode,
  };

  return (
    <div className='size-full flex flex-col'>
      {/* Main content area */}
      <div className='flex-1 min-h-0 overflow-hidden'>
        {isSettings ? (
          <Suspense fallback={<div className='size-full' />}>
            <SettingsSider collapsed={collapsed} tooltipEnabled={tooltipEnabled} />
          </Suspense>
        ) : (
          <div className='size-full flex flex-col gap-2px'>
            <SiderToolbar
              isMobile={isMobile}
              isBatchMode={isBatchMode}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onNewChat={handleNewChat}
              onToggleBatchMode={() => setIsBatchMode((prev) => !prev)}
            />
            {/* Search entry */}
            <SiderSearchEntry
              isMobile={isMobile}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onConversationSelect={handleConversationSelect}
              onSessionClick={onSessionClick}
            />
            <EvaosSidebarSection
              group='primary'
              isMobile={isMobile}
              collapsed={collapsed}
              pathname={pathname}
              siderTooltipProps={siderTooltipProps}
              canSeeEvaos={evaosSidebarState.canSeeEvaos}
              canSeeHermes={evaosSidebarState.canSeeHermes}
              canSeeMissionControl={evaosSidebarState.canSeeMissionControl}
              canSeePeopleAccess={evaosSidebarState.canSeePeopleAccess}
              canSeeConnectedApps={evaosSidebarState.canSeeConnectedApps}
              canSeeDesignWorkspace={evaosSidebarState.canSeeDesignWorkspace}
              canSeeBusinessBrowser={evaosSidebarState.canSeeBusinessBrowser}
              canSeeCreativeStudio={evaosSidebarState.canSeeCreativeStudio}
              canSeeCompanyBrain={evaosSidebarState.canSeeCompanyBrain}
              canSeeNativeCompanion={evaosSidebarState.canSeeNativeCompanion}
              onNavigate={handleEvaosNavigate}
            />
            {/* Scheduled tasks nav entry - fixed above scroll */}
            <SiderScheduledEntry
              isMobile={isMobile}
              isActive={pathname === '/scheduled'}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleScheduledClick}
            />
            {evaosSidebarState.canSeeTerminal ? (
              <SiderTerminalEntry
                isMobile={isMobile}
                isActive={pathname === '/terminal'}
                collapsed={collapsed}
                siderTooltipProps={siderTooltipProps}
                onClick={() => handleEvaosNavigate('/terminal')}
              />
            ) : null}
            <SiderSupportEntry
              isMobile={isMobile}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleSupportClick}
            />
            <EvaosSidebarSection
              group='admin'
              isMobile={isMobile}
              collapsed={collapsed}
              pathname={pathname}
              siderTooltipProps={siderTooltipProps}
              canSeeEvaos={evaosSidebarState.canSeeEvaos}
              canSeeHermes={evaosSidebarState.canSeeHermes}
              canSeeMissionControl={evaosSidebarState.canSeeMissionControl}
              canSeePeopleAccess={evaosSidebarState.canSeePeopleAccess}
              canSeeConnectedApps={evaosSidebarState.canSeeConnectedApps}
              canSeeDesignWorkspace={evaosSidebarState.canSeeDesignWorkspace}
              canSeeBusinessBrowser={evaosSidebarState.canSeeBusinessBrowser}
              canSeeCreativeStudio={evaosSidebarState.canSeeCreativeStudio}
              canSeeCompanyBrain={evaosSidebarState.canSeeCompanyBrain}
              canSeeNativeCompanion={evaosSidebarState.canSeeNativeCompanion}
              onNavigate={handleEvaosNavigate}
            />
            {/* Divider between fixed top nav and scrollable content area */}
            <div
              className={classNames(
                'shrink-0 mt-6px mb-2px h-1px bg-[var(--color-border-2)]',
                collapsed ? 'mx-6px' : 'mx-10px'
              )}
            />
            {/* Scrollable content: pinned → team/cron (slot) → projects → conversations */}
            <div className={classNames('flex-1 min-h-0 overflow-y-auto', siderStyles.scrollArea)}>
              <Suspense fallback={<div className='min-h-200px' />}>
                <WorkspaceGroupedHistory
                  {...workspaceHistoryProps}
                  afterPinnedContent={
                    <>
                      {TEAM_MODE_ENABLED ? (
                        <TeamSiderSection
                          collapsed={collapsed}
                          pathname={pathname}
                          siderTooltipProps={siderTooltipProps}
                          onSessionClick={onSessionClick}
                        />
                      ) : null}
                      {!collapsed && (
                        <CronJobSiderSection jobs={cronJobs} pathname={pathname} onNavigate={handleCronNavigate} />
                      )}
                    </>
                  }
                />
              </Suspense>
            </div>
          </div>
        )}
      </div>
      {/* Footer */}
      <SiderFooter
        isMobile={isMobile}
        isSettings={isSettings}
        collapsed={collapsed}
        theme={theme}
        siderTooltipProps={siderTooltipProps}
        onSettingsClick={handleSettingsClick}
        onThemeToggle={handleQuickThemeToggle}
        accountLabel={user?.username ?? evaosSidebarState.accountLabel}
        selectedCustomerId={evaosSidebarState.selectedCustomerId}
        selectedCustomerLabel={evaosSidebarState.selectedCustomerLabel}
        customerTargets={evaosSidebarState.customerTargets}
        canSwitchCustomers={evaosSidebarState.canSwitchCustomers}
        onCustomerChange={handleCustomerChange}
        showLogout={showLogout}
        onLogoutClick={handleLogout}
        showSignIn={showBrokerSignIn}
        onSignInClick={handleBeginDesktopAuth}
        signInError={brokerSignInError}
      />
    </div>
  );
};

export default Sider;
