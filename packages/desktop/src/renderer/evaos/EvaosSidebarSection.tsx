/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import {
  SiderApprovalCenterEntry,
  SiderBusinessBrowserEntry,
  SiderCompanyBrainEntry,
  SiderConnectedAppsEntry,
  SiderCreativeStudioEntry,
  SiderDesignWorkspaceEntry,
  SiderEvaosEntry,
  SiderHermesEntry,
  SiderHomeEntry,
  SiderMissionControlEntry,
  SiderNativeCompanionEntry,
  SiderPeopleAccessEntry,
  SiderTerminalEntry,
} from '@renderer/evaos/sidebar';
import {
  EVAOS_APPROVAL_CENTER_ENABLED,
  EVAOS_BUSINESS_BROWSER_ENABLED,
  EVAOS_COMPANY_BRAIN_ENABLED,
  EVAOS_PROVIDER_HUB_ENABLED,
} from '@/common/config/constants';

interface EvaosSidebarSectionProps {
  isMobile: boolean;
  collapsed: boolean;
  pathname: string;
  siderTooltipProps: SiderTooltipProps;
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
  onNavigate: (path: string) => void;
}

const EvaosSidebarSection: React.FC<EvaosSidebarSectionProps> = ({
  isMobile,
  collapsed,
  pathname,
  siderTooltipProps,
  canSeeHome,
  canSeeEvaos,
  canSeeHermes,
  canSeeMissionControl,
  canSeeTerminal,
  canSeePeopleAccess,
  canSeeConnectedApps,
  canSeeDesignWorkspace,
  canSeeBusinessBrowser,
  canSeeCreativeStudio,
  canSeeCompanyBrain,
  canSeeApprovalCenter,
  canSeeNativeCompanion,
  onNavigate,
}) => {
  return (
    <>
      {canSeeHome ? (
        <SiderHomeEntry
          isMobile={isMobile}
          isActive={pathname === '/home'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/home')}
        />
      ) : null}
      {EVAOS_APPROVAL_CENTER_ENABLED && canSeeApprovalCenter ? (
        <SiderApprovalCenterEntry
          isMobile={isMobile}
          isActive={pathname === '/approval-center'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/approval-center')}
        />
      ) : null}
      {canSeeDesignWorkspace ? (
        <SiderDesignWorkspaceEntry
          isMobile={isMobile}
          isActive={pathname === '/design-workspace'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/design-workspace')}
        />
      ) : null}
      {EVAOS_BUSINESS_BROWSER_ENABLED && canSeeBusinessBrowser ? (
        <SiderBusinessBrowserEntry
          isMobile={isMobile}
          isActive={pathname === '/business-browser'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/business-browser')}
        />
      ) : null}
      {canSeeCreativeStudio ? (
        <SiderCreativeStudioEntry
          isMobile={isMobile}
          isActive={pathname === '/creative-studio'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/creative-studio')}
        />
      ) : null}
      {EVAOS_PROVIDER_HUB_ENABLED && canSeeConnectedApps ? (
        <SiderConnectedAppsEntry
          isMobile={isMobile}
          isActive={pathname === '/connected-apps'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/connected-apps')}
        />
      ) : null}
      {canSeePeopleAccess ? (
        <SiderPeopleAccessEntry
          isMobile={isMobile}
          isActive={pathname === '/people-access'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/people-access')}
        />
      ) : null}
      {EVAOS_COMPANY_BRAIN_ENABLED && canSeeCompanyBrain ? (
        <SiderCompanyBrainEntry
          isMobile={isMobile}
          isActive={pathname === '/company-brain'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/company-brain')}
        />
      ) : null}
      {canSeeEvaos ? (
        <SiderEvaosEntry
          isMobile={isMobile}
          isActive={pathname === '/evaos' || pathname === '/openclaw'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/evaos')}
        />
      ) : null}
      {canSeeHermes ? (
        <SiderHermesEntry
          isMobile={isMobile}
          isActive={pathname === '/hermes'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/hermes')}
        />
      ) : null}
      {canSeeMissionControl ? (
        <SiderMissionControlEntry
          isMobile={isMobile}
          isActive={pathname === '/mission-control'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/mission-control')}
        />
      ) : null}
      {canSeeTerminal ? (
        <SiderTerminalEntry
          isMobile={isMobile}
          isActive={pathname === '/terminal'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/terminal')}
        />
      ) : null}
      {canSeeNativeCompanion ? (
        <SiderNativeCompanionEntry
          isMobile={isMobile}
          isActive={pathname === '/native-companion'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/native-companion')}
        />
      ) : null}
    </>
  );
};

export default EvaosSidebarSection;
