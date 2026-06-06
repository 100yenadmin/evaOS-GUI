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
  canSeeMissionControl: boolean;
  canSeeTerminal: boolean;
  canSeePeopleAccess: boolean;
  canSeeConnectedApps: boolean;
  canSeeBusinessBrowser: boolean;
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
  canSeeMissionControl,
  canSeeTerminal,
  canSeePeopleAccess,
  canSeeConnectedApps,
  canSeeBusinessBrowser,
  canSeeCompanyBrain,
  canSeeApprovalCenter,
  canSeeNativeCompanion,
  onNavigate,
}) => {
  return (
    <>
      {canSeeMissionControl ? (
        <>
          <SiderMissionControlEntry
            isMobile={isMobile}
            isActive={pathname === '/mission-control'}
            collapsed={collapsed}
            siderTooltipProps={siderTooltipProps}
            onClick={() => onNavigate('/mission-control')}
          />
          {canSeeTerminal ? (
            <SiderTerminalEntry
              isMobile={isMobile}
              isActive={pathname === '/terminal'}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={() => onNavigate('/terminal')}
            />
          ) : null}
        </>
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
      {EVAOS_PROVIDER_HUB_ENABLED && canSeeConnectedApps ? (
        <SiderConnectedAppsEntry
          isMobile={isMobile}
          isActive={pathname === '/connected-apps'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/connected-apps')}
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
      {EVAOS_COMPANY_BRAIN_ENABLED && canSeeCompanyBrain ? (
        <SiderCompanyBrainEntry
          isMobile={isMobile}
          isActive={pathname === '/company-brain'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/company-brain')}
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
