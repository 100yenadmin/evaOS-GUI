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
  SiderPeopleAccessEntry,
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
  onNavigate: (path: string) => void;
}

const EvaosSidebarSection: React.FC<EvaosSidebarSectionProps> = ({
  isMobile,
  collapsed,
  pathname,
  siderTooltipProps,
  canSeeMissionControl,
  onNavigate,
}) => {
  return (
    <>
      {canSeeMissionControl ? (
        <SiderMissionControlEntry
          isMobile={isMobile}
          isActive={pathname === '/mission-control'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/mission-control')}
        />
      ) : null}
      <SiderPeopleAccessEntry
        isMobile={isMobile}
        isActive={pathname === '/people-access'}
        collapsed={collapsed}
        siderTooltipProps={siderTooltipProps}
        onClick={() => onNavigate('/people-access')}
      />
      {EVAOS_PROVIDER_HUB_ENABLED ? (
        <SiderConnectedAppsEntry
          isMobile={isMobile}
          isActive={pathname === '/connected-apps'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/connected-apps')}
        />
      ) : null}
      {EVAOS_BUSINESS_BROWSER_ENABLED ? (
        <SiderBusinessBrowserEntry
          isMobile={isMobile}
          isActive={pathname === '/business-browser'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/business-browser')}
        />
      ) : null}
      {EVAOS_COMPANY_BRAIN_ENABLED ? (
        <SiderCompanyBrainEntry
          isMobile={isMobile}
          isActive={pathname === '/company-brain'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/company-brain')}
        />
      ) : null}
      {EVAOS_APPROVAL_CENTER_ENABLED ? (
        <SiderApprovalCenterEntry
          isMobile={isMobile}
          isActive={pathname === '/approval-center'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/approval-center')}
        />
      ) : null}
    </>
  );
};

export default EvaosSidebarSection;
