/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@arco-design/web-react';
import { ArrowCircleLeft, CloseOne, Comment, Login, Moon, SettingTwo, SunOne } from '@icon-park/react';
import classNames from 'classnames';
import { iconColors } from '@renderer/styles/colors';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import type { IEvaosCustomerTargetView } from '@/common/evaos/bridgeTypes';
import packageJson from '../../../../../../../package.json';

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ === 'undefined' ? packageJson.version : __APP_VERSION__;
const EVAOS_CHANNEL_LABEL = 'controlled beta';

type FooterAction = 'settings' | 'support' | 'sign-in' | 'sign-out' | 'theme';
type FooterActionHandlers = Partial<Record<FooterAction, () => void>>;

const FOOTER_ACTION_ATTRIBUTE = 'data-evaos-footer-action';

function isPointInsideRect(event: MouseEvent, rect: DOMRect): boolean {
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

function actionFromElement(element: Element | null, footer: HTMLDivElement): FooterAction | null {
  const actionElement = element?.closest?.(`[${FOOTER_ACTION_ATTRIBUTE}]`);
  if (!actionElement || !footer.contains(actionElement)) return null;
  return actionElement.getAttribute(FOOTER_ACTION_ATTRIBUTE) as FooterAction | null;
}

function actionFromPoint(event: MouseEvent, footer: HTMLDivElement): FooterAction | null {
  if (!isPointInsideRect(event, footer.getBoundingClientRect())) return null;

  const elementAtPoint =
    typeof document.elementFromPoint === 'function' ? document.elementFromPoint(event.clientX, event.clientY) : null;
  const pointedAction = actionFromElement(elementAtPoint, footer);
  if (pointedAction) return pointedAction;

  const actions = Array.from(footer.querySelectorAll<HTMLElement>(`[${FOOTER_ACTION_ATTRIBUTE}]`));
  const hit = actions.find((element) => isPointInsideRect(event, element.getBoundingClientRect()));
  return hit?.getAttribute(FOOTER_ACTION_ATTRIBUTE) as FooterAction | null;
}

function isFooterActionEventTarget(event: MouseEvent, footer: HTMLDivElement): boolean {
  const target = event.target instanceof Element ? event.target : null;
  return Boolean(actionFromElement(target, footer));
}

function useFooterActionCapture(ref: React.RefObject<HTMLDivElement | null>, handlers: FooterActionHandlers): void {
  const handlersRef = useRef(handlers);
  const lastActivationRef = useRef<{ action: FooterAction; at: number } | null>(null);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const footer = ref.current;
    if (!footer) return;

    const handleFooterAction = (event: MouseEvent) => {
      if (isFooterActionEventTarget(event, footer)) return;

      const action = actionFromPoint(event, footer);
      if (!action) return;

      const handler = handlersRef.current[action];
      if (!handler) return;

      const now = Date.now();
      const lastActivation = lastActivationRef.current;
      if (lastActivation?.action === action && now - lastActivation.at < 350) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      lastActivationRef.current = { action, at: now };
      event.preventDefault();
      event.stopPropagation();
      handler();
    };

    document.addEventListener('pointerup', handleFooterAction, true);
    document.addEventListener('mouseup', handleFooterAction, true);
    document.addEventListener('click', handleFooterAction, true);
    return () => {
      document.removeEventListener('pointerup', handleFooterAction, true);
      document.removeEventListener('mouseup', handleFooterAction, true);
      document.removeEventListener('click', handleFooterAction, true);
    };
  }, [ref]);
}

interface SiderFooterProps {
  isMobile: boolean;
  isSettings: boolean;
  collapsed?: boolean;
  theme: string;
  siderTooltipProps: SiderTooltipProps;
  onSettingsClick: () => void;
  onSupportClick?: () => void;
  onThemeToggle: () => void;
  accountLabel?: string | null;
  selectedCustomerId?: string;
  selectedCustomerLabel?: string;
  customerTargets?: IEvaosCustomerTargetView[];
  canSwitchCustomers?: boolean;
  onCustomerChange?: (customerId: string) => void;
  showLogout?: boolean;
  onLogoutClick?: () => void;
  showSignIn?: boolean;
  onSignInClick?: () => void;
  signInError?: string | null;
}

const SiderFooter: React.FC<SiderFooterProps> = ({
  isMobile,
  isSettings,
  collapsed = false,
  theme,
  siderTooltipProps,
  onSettingsClick,
  onSupportClick,
  onThemeToggle,
  accountLabel,
  selectedCustomerId,
  selectedCustomerLabel,
  customerTargets = [],
  canSwitchCustomers = false,
  onCustomerChange,
  showLogout = false,
  onLogoutClick,
  showSignIn = false,
  onSignInClick,
  signInError,
}) => {
  const { t } = useTranslation();
  const footerRef = useRef<HTMLDivElement | null>(null);

  const settingsIcon = isSettings ? (
    <ArrowCircleLeft
      theme='outline'
      size='16'
      fill='currentColor'
      className='block leading-none'
      style={{ lineHeight: 0 }}
    />
  ) : (
    <SettingTwo
      theme='outline'
      size='16'
      fill='currentColor'
      className='block leading-none'
      style={{ lineHeight: 0 }}
    />
  );
  const showThemeToggle = isSettings && !collapsed;
  const themeTooltip = theme === 'dark' ? t('settings.lightMode') : t('settings.darkMode');
  const showAccountBlock = !collapsed && (accountLabel || selectedCustomerLabel || selectedCustomerId);
  const canRenderCustomerSelect =
    canSwitchCustomers && selectedCustomerId && customerTargets.length > 1 && Boolean(onCustomerChange);

  const footerActionHandlers = {
    settings: onSettingsClick,
    ...(onSupportClick ? { support: onSupportClick } : {}),
    ...(showSignIn && onSignInClick ? { 'sign-in': onSignInClick } : {}),
    ...(showLogout && onLogoutClick ? { 'sign-out': onLogoutClick } : {}),
    ...(showThemeToggle ? { theme: onThemeToggle } : {}),
  };
  useFooterActionCapture(footerRef, footerActionHandlers);

  const activateFromKeyboard = useCallback((event: React.KeyboardEvent<HTMLElement>, handler: () => void) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handler();
  }, []);

  return (
    <div
      ref={footerRef}
      className='shrink-0 sider-footer mt-auto pt-8px pb-8px border-t border-solid border-[var(--color-border-2)] border-l-0 border-r-0 border-b-0'
    >
      {showAccountBlock ? (
        <div className='mb-8px px-10px text-11px leading-16px text-t-secondary'>
          <div className='flex items-center justify-between gap-6px'>
            <div className='font-medium text-t-tertiary'>Viewing</div>
            <div className='text-10px leading-14px text-t-tertiary'>{EVAOS_CHANNEL_LABEL}</div>
          </div>
          {accountLabel ? <div className='truncate text-t-primary'>{accountLabel}</div> : null}
          {canRenderCustomerSelect ? (
            <select
              aria-label='Selected customer'
              value={selectedCustomerId}
              onChange={(event) => onCustomerChange?.(event.currentTarget.value)}
              className='mt-4px h-26px w-full min-w-0 rd-6px border border-solid border-[var(--color-border-2)] bg-fill-1 px-6px text-11px text-t-primary outline-none'
            >
              {customerTargets.map((target) => (
                <option key={target.customerId} value={target.customerId}>
                  {target.displayName}
                </option>
              ))}
            </select>
          ) : selectedCustomerLabel ? (
            <div className='mt-2px truncate text-t-secondary'>{selectedCustomerLabel}</div>
          ) : null}
          <div className='mt-3px truncate text-10px leading-14px text-t-tertiary'>v{APP_VERSION}</div>
        </div>
      ) : null}
      <div className={classNames('flex', collapsed ? 'flex-col gap-2px' : 'items-center gap-2px')}>
        <Tooltip {...siderTooltipProps} content={isSettings ? t('common.back') : t('common.settings')} position='right'>
          <div
            role='button'
            tabIndex={0}
            aria-label={isSettings ? t('common.back') : t('common.settings')}
            data-evaos-footer-action='settings'
            onClick={onSettingsClick}
            onKeyDown={(event) => activateFromKeyboard(event, onSettingsClick)}
            className={classNames(
              'group h-34px flex items-center rd-0.5rem cursor-pointer transition-colors',
              collapsed ? 'w-full justify-center' : 'flex-1 min-w-0 justify-start gap-8px pl-10px pr-8px',
              isMobile && 'sider-footer-btn-mobile',
              {
                'bg-fill-3': isSettings,
                'hover:bg-fill-3 active:bg-fill-4': !isSettings,
              }
            )}
          >
            <span className='size-22px flex items-center justify-center shrink-0 text-t-secondary'>{settingsIcon}</span>
            <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px truncate'>
              {isSettings ? t('common.back') : t('common.settings')}
            </span>
          </div>
        </Tooltip>
        {onSupportClick ? (
          <Tooltip {...siderTooltipProps} content='Support' position='right'>
            <button
              type='button'
              aria-label='Support'
              data-evaos-footer-action='support'
              onClick={onSupportClick}
              className={classNames(
                'border-0 bg-transparent h-32px flex items-center rd-0.5rem cursor-pointer transition-colors hover:bg-[rgba(var(--primary-6),0.14)] active:bg-fill-2',
                collapsed ? 'w-full justify-center' : 'flex-1 min-w-0 justify-start gap-10px px-14px',
                isMobile && 'sider-footer-btn-mobile'
              )}
            >
              <span className='size-20px flex items-center justify-center shrink-0'>
                <Comment
                  theme='outline'
                  size='16'
                  fill={iconColors.primary}
                  className='block leading-none'
                  style={{ lineHeight: 0 }}
                />
              </span>
              <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px truncate'>
                Support
              </span>
            </button>
          </Tooltip>
        ) : null}
        {showLogout && onLogoutClick && (
          <Tooltip {...siderTooltipProps} content='Sign out' position='right'>
            <button
              type='button'
              aria-label='Sign out'
              data-evaos-footer-action='sign-out'
              onClick={onLogoutClick}
              className={classNames(
                'border-0 bg-transparent h-32px flex items-center rd-0.5rem cursor-pointer transition-colors hover:bg-[rgba(var(--primary-6),0.14)] active:bg-fill-2',
                collapsed ? 'w-full justify-center' : 'flex-1 min-w-0 justify-start gap-10px px-14px',
                isMobile && 'sider-footer-btn-mobile'
              )}
            >
              <span className='size-20px flex items-center justify-center shrink-0'>
                <CloseOne
                  theme='outline'
                  size='16'
                  fill={iconColors.primary}
                  className='block leading-none'
                  style={{ lineHeight: 0 }}
                />
              </span>
              <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px truncate'>
                Sign out
              </span>
            </button>
          </Tooltip>
        )}
        {showSignIn && onSignInClick && (
          <div className={classNames('flex min-w-0 flex-col gap-4px', collapsed ? 'w-full' : 'flex-1')}>
            <Tooltip {...siderTooltipProps} content='Sign In' position='right'>
              <button
                type='button'
                aria-label='Sign In'
                data-evaos-footer-action='sign-in'
                onClick={onSignInClick}
                className={classNames(
                  'border-0 bg-transparent h-32px flex items-center rd-0.5rem cursor-pointer transition-colors hover:bg-[rgba(var(--primary-6),0.14)] active:bg-fill-2',
                  collapsed ? 'w-full justify-center' : 'w-full min-w-0 justify-start gap-10px px-14px',
                  isMobile && 'sider-footer-btn-mobile'
                )}
              >
                {collapsed ? (
                  <span className='size-20px flex items-center justify-center shrink-0'>
                    <Login
                      theme='outline'
                      size='16'
                      fill={iconColors.primary}
                      className='block leading-none'
                      style={{ lineHeight: 0 }}
                    />
                  </span>
                ) : null}
                <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px truncate'>
                  Sign In
                </span>
              </button>
            </Tooltip>
            {!collapsed && signInError ? (
              <div className='collapsed-hidden px-8px text-10px leading-14px text-warning-6'>{signInError}</div>
            ) : null}
          </div>
        )}
        {/* Theme toggle — lightweight icon button, only while inside Settings page (not in collapsed mode) */}
        {showThemeToggle && (
          <Tooltip {...siderTooltipProps} content={themeTooltip} position='right'>
            <div
              role='button'
              tabIndex={0}
              data-evaos-footer-action='theme'
              onClick={onThemeToggle}
              onKeyDown={(event) => activateFromKeyboard(event, onThemeToggle)}
              className={classNames(
                'h-32px w-40px shrink-0 flex items-center justify-center cursor-pointer rd-0.5rem transition-colors text-t-secondary hover:bg-fill-2 hover:text-t-primary active:bg-fill-3',
                isMobile && 'sider-footer-btn-mobile'
              )}
              aria-label={themeTooltip}
            >
              <span className='w-28px h-28px flex items-center justify-center shrink-0'>
                {theme === 'dark' ? (
                  <SunOne theme='outline' size='18' fill='currentColor' className='block leading-none' />
                ) : (
                  <Moon theme='outline' size='18' fill='currentColor' className='block leading-none' />
                )}
              </span>
            </div>
          </Tooltip>
        )}
      </div>
    </div>
  );
};

export default SiderFooter;
