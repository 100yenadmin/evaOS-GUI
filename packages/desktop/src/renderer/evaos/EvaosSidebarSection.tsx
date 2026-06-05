/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useEvaosCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { evaosBrokerSessionKey, useEvaosBrokerSessionStatus } from '@renderer/hooks/useEvaosBrokerSessionStatus';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { canAccessEvaosAdminRuntimes } from '@renderer/evaos/evaosRuntimeVisibility';
import {
  SiderApprovalCenterEntry,
  SiderBusinessBrowserEntry,
  SiderCompanyBrainEntry,
  SiderConnectedAppsEntry,
  SiderMissionControlEntry,
  SiderPeopleAccessEntry,
} from '@renderer/components/layout/Sider/SiderNav';
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
  onNavigate: (path: string) => void;
}

const EvaosSidebarSection: React.FC<EvaosSidebarSectionProps> = ({
  isMobile,
  collapsed,
  pathname,
  siderTooltipProps,
  onNavigate,
}) => {
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
