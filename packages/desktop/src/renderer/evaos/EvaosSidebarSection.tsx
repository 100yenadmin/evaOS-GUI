/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import {
  SiderBusinessBrowserEntry,
  SiderCompanyBrainEntry,
  SiderConnectedAppsEntry,
  SiderCreativeStudioEntry,
  SiderDesignWorkspaceEntry,
  SiderEvaosEntry,
  SiderHermesEntry,
  SiderMissionControlEntry,
  SiderNativeCompanionEntry,
  SiderPeopleAccessEntry,
} from '@renderer/evaos/sidebar';
import { Down, Right } from '@icon-park/react';
import classNames from 'classnames';
import {
  EVAOS_BUSINESS_BROWSER_ENABLED,
  EVAOS_COMPANY_BRAIN_ENABLED,
  EVAOS_PROVIDER_HUB_ENABLED,
} from '@/common/config/constants';

type EvaosSidebarGroup = 'primary' | 'admin';

interface EvaosSidebarSectionProps {
  group?: EvaosSidebarGroup;
  isMobile: boolean;
  collapsed: boolean;
  pathname: string;
  siderTooltipProps: SiderTooltipProps;
  canSeeEvaos: boolean;
  canSeeHermes: boolean;
  canSeeMissionControl: boolean;
  canSeePeopleAccess: boolean;
  canSeeConnectedApps: boolean;
  canSeeDesignWorkspace: boolean;
  canSeeBusinessBrowser: boolean;
  canSeeCreativeStudio: boolean;
  canSeeCompanyBrain: boolean;
  canSeeNativeCompanion: boolean;
  onNavigate: (path: string) => void;
}

const EvaosSidebarSection: React.FC<EvaosSidebarSectionProps> = ({
  group = 'primary',
  isMobile,
  collapsed,
  pathname,
  siderTooltipProps,
  canSeeEvaos,
  canSeeHermes,
  canSeeMissionControl,
  canSeePeopleAccess,
  canSeeConnectedApps,
  canSeeDesignWorkspace,
  canSeeBusinessBrowser,
  canSeeCreativeStudio,
  canSeeCompanyBrain,
  canSeeNativeCompanion,
  onNavigate,
}) => {
  const designIsActive = pathname === '/design-workspace' || pathname === '/creative-studio';
  const adminIsActive =
    pathname === '/connected-apps' ||
    pathname === '/people-access' ||
    pathname === '/company-brain' ||
    pathname === '/native-companion';
  const [designOpen, setDesignOpen] = useState(designIsActive);
  const [adminOpen, setAdminOpen] = useState(adminIsActive);
  const canSeeDesignSection = canSeeDesignWorkspace || canSeeCreativeStudio;
  const canSeeAdminSection =
    (EVAOS_PROVIDER_HUB_ENABLED && canSeeConnectedApps) ||
    canSeePeopleAccess ||
    (EVAOS_COMPANY_BRAIN_ENABLED && canSeeCompanyBrain) ||
    canSeeNativeCompanion;

  useEffect(() => {
    if (designIsActive) {
      setDesignOpen(true);
    }
  }, [designIsActive]);

  useEffect(() => {
    if (adminIsActive) {
      setAdminOpen(true);
    }
  }, [adminIsActive]);

  if (group === 'admin') {
    if (!canSeeAdminSection) {
      return null;
    }

    if (collapsed) {
      return (
        <>
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
    }

    return (
      <>
        <SidebarGroupToggle
          label='Admin'
          isOpen={adminOpen}
          isMobile={isMobile}
          onClick={() => setAdminOpen((open) => !open)}
        />
        {adminOpen ? (
          <>
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
        ) : null}
      </>
    );
  }

  return (
    <>
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
      {EVAOS_BUSINESS_BROWSER_ENABLED && canSeeBusinessBrowser ? (
        <SiderBusinessBrowserEntry
          isMobile={isMobile}
          isActive={pathname === '/business-browser'}
          collapsed={collapsed}
          siderTooltipProps={siderTooltipProps}
          onClick={() => onNavigate('/business-browser')}
        />
      ) : null}
      {canSeeDesignSection ? (
        collapsed ? (
          <>
            {canSeeDesignWorkspace ? (
              <SiderDesignWorkspaceEntry
                isMobile={isMobile}
                isActive={pathname === '/design-workspace'}
                collapsed={collapsed}
                siderTooltipProps={siderTooltipProps}
                onClick={() => onNavigate('/design-workspace')}
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
          </>
        ) : (
          <>
            <SidebarGroupToggle
              label='Design'
              isOpen={designOpen}
              isMobile={isMobile}
              onClick={() => setDesignOpen((open) => !open)}
            />
            {designOpen ? (
              <>
                {canSeeDesignWorkspace ? (
                  <SiderDesignWorkspaceEntry
                    isMobile={isMobile}
                    isActive={pathname === '/design-workspace'}
                    collapsed={collapsed}
                    siderTooltipProps={siderTooltipProps}
                    onClick={() => onNavigate('/design-workspace')}
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
              </>
            ) : null}
          </>
        )
      ) : null}
    </>
  );
};

const SidebarGroupToggle: React.FC<{
  label: string;
  isOpen: boolean;
  isMobile: boolean;
  onClick: () => void;
}> = ({ label, isOpen, isMobile, onClick }) => (
  <button
    type='button'
    aria-expanded={isOpen}
    aria-label={`${label} section`}
    data-testid={`evaos-sidebar-${label.toLowerCase()}-toggle`}
    className={classNames(
      'box-border group h-30px w-full flex items-center justify-start gap-8px pl-10px pr-8px rd-0.5rem cursor-pointer shrink-0 transition-all text-t-secondary border-0 bg-transparent hover:bg-fill-3 active:bg-fill-4',
      isMobile && 'sider-action-btn-mobile'
    )}
    onClick={(event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    }}
  >
    <span className='collapsed-hidden text-t-secondary text-12px font-[600] uppercase tracking-1px leading-20px'>
      {label}
    </span>
    <span className='ml-auto flex size-18px items-center justify-center text-t-tertiary'>
      {isOpen ? (
        <Down theme='outline' size='12' fill='currentColor' />
      ) : (
        <Right theme='outline' size='12' fill='currentColor' />
      )}
    </span>
  </button>
);

export default EvaosSidebarSection;
