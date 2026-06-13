/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { Button, Input, Spin, Tag } from '@arco-design/web-react';
import { Attention, Browser, CloseOne, Open, Refresh, Shield } from '@icon-park/react';
import { useEvaosBrokeredCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { isEvaosSupportDiagnosticsEnabled } from '@/renderer/evaos/supportDiagnostics';
import {
  evaosBusinessBrowser,
  type IEvaosBusinessBrowserActionResult,
  type IEvaosBusinessBrowserView,
} from '@/common/adapter/ipcBridge';
import type { IEvaosRuntimeSurfaceView } from '@/common/evaos/bridgeTypes';

const SECRET_TEXT_PATTERN =
  /\b(?:eds|epg)_[A-Za-z0-9_-]{4,}\b|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|grant[_-]?handle|authorization|bearer|secret|password/i;

function safeUiText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
}

function sharedBrowserUiText(value: unknown, fallback: string): string {
  return safeUiText(value, fallback).replace(/\bBusiness Browser\b/g, 'Shared Browser');
}

function statusColor(view: IEvaosBusinessBrowserView): 'green' | 'orange' | 'red' | 'gray' {
  const status = view.status.toLowerCase();
  if (view.routeDenied) return 'orange';
  if (status === 'running' || status === 'ready' || status === 'active') return 'green';
  if (view.authNeeded || view.captchaNeeded || view.waitingOnUser) return 'orange';
  if (status === 'error' || status === 'failed' || status === 'denied') return 'red';
  return 'gray';
}

function actionSummary(result: IEvaosBusinessBrowserActionResult): string {
  const parts = [sharedBrowserUiText(result.message, `Shared Browser ${result.status}.`)];
  if (result.urlSummary?.displayText) {
    parts.push(`URL ${result.urlSummary.displayText}.`);
  }
  if (result.auditId) {
    parts.push(`Audit ${result.auditId}.`);
  }
  return parts.join(' ');
}

function isSafeRuntimeSurfaceUri(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'evaos-runtime-surface:' && Boolean(parsed.hostname || parsed.pathname);
  } catch {
    return false;
  }
}

function runtimeSurfaceMatches(
  surface: IEvaosRuntimeSurfaceView | undefined,
  customerId: string
): surface is IEvaosRuntimeSurfaceView {
  return (
    surface?.schemaVersion === 'evaos.runtime_surface.v1' &&
    surface.customerId === customerId &&
    surface.runtimeKey === 'browser' &&
    isSafeRuntimeSurfaceUri(surface.surfaceUri) &&
    isSafeRuntimeSurfacePartition(surface.partition)
  );
}

function isSafeRuntimeSurfacePartition(value: unknown): value is string {
  return typeof value === 'string' && /^evaos-runtime-[a-z0-9_-]{1,120}$/i.test(value);
}

function hasBrowserAutoAttachAction(view: IEvaosBusinessBrowserView): boolean {
  return view.actions.some((action) => action === 'start_attach' || action === 'browser_launch');
}

function canAutoAttachBrowserSurface(view: IEvaosBusinessBrowserView): boolean {
  if (view.canLaunch && hasBrowserAutoAttachAction(view)) {
    return true;
  }
  const status = view.status.toLowerCase();
  const activeBrowser = /(running|active|ready|online|healthy)/.test(status) || view.controlSessionActive;
  return view.canLaunch && activeBrowser;
}

function businessBrowserSupportBlockerMessage(
  view: IEvaosBusinessBrowserView,
  selectedCustomerLabel: string
): string | null {
  if (view.routeDenied || canAutoAttachBrowserSurface(view)) {
    return null;
  }
  const route = 'Route /business-browser';
  const customer = safeUiText(selectedCustomerLabel, view.customerId || 'selected customer');
  const parts = [`${route} for ${customer} is blocked: broker did not provide a browser runtime surface handle.`];
  const status = safeUiText(view.status, 'unknown');
  parts.push(`Status ${status}.`);
  const healthSummary = sharedBrowserUiText(view.healthSummary, '');
  if (healthSummary) {
    parts.push(healthSummary);
  }
  const sourcePointer = safeUiText(view.sourcePointer, '');
  if (sourcePointer) {
    parts.push(`Source ${sourcePointer}.`);
  }
  const auditId = safeUiText(view.auditId ?? view.policyAuditId, '');
  if (auditId) {
    parts.push(`Audit ${auditId}.`);
  }
  return parts.join(' ');
}

const BusinessBrowserPage: React.FC = () => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [browserView, setBrowserView] = useState<IEvaosBusinessBrowserView | null>(null);
  const [runtimeSurface, setRuntimeSurface] = useState<IEvaosRuntimeSurfaceView | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [openUrl, setOpenUrl] = useState('');
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<'launch' | 'openUrl' | 'stop' | null>(null);
  const { customerContext } = useEvaosBrokeredCustomerContext();
  const selectedCustomerRef = useRef<string | undefined>(customerContext.selectedCustomerId);
  const previousSelectedCustomerRef = useRef<string | undefined>(customerContext.selectedCustomerId);
  const requestEpochRef = useRef(0);
  const actionEpochRef = useRef(0);
  const activeActionRef = useRef(false);
  const autoLoadKeyRef = useRef<string | null>(null);
  const autoLaunchKeyRef = useRef<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const showDiagnostics = isEvaosSupportDiagnosticsEnabled();

  useEffect(() => {
    const nextSelectedCustomerId = customerContext.selectedCustomerId;
    const previousSelectedCustomerId = previousSelectedCustomerRef.current;
    selectedCustomerRef.current = nextSelectedCustomerId;
    if (previousSelectedCustomerId === nextSelectedCustomerId) {
      return;
    }
    previousSelectedCustomerRef.current = nextSelectedCustomerId;
    requestEpochRef.current += 1;
    actionEpochRef.current += 1;
    activeActionRef.current = false;
    autoLoadKeyRef.current = null;
    autoLaunchKeyRef.current = null;
    setBrowserView(null);
    setRuntimeSurface(null);
    setBrowserError(null);
    setActionStatus(null);
    setActionError(null);
    setActionTarget(null);
    setLoadingStatus(false);
  }, [customerContext.selectedCustomerId]);

  const isCurrentRequest = useCallback((epoch: number, customerId: string) => {
    return requestEpochRef.current === epoch && selectedCustomerRef.current === customerId;
  }, []);

  const isSelectedCustomer = useCallback((customerId: string) => {
    return selectedCustomerRef.current === customerId;
  }, []);

  const selectCustomer = useCallback(
    (customerId: string) => {
      selectedCustomerRef.current = customerId;
      requestEpochRef.current += 1;
      actionEpochRef.current += 1;
      activeActionRef.current = false;
      autoLoadKeyRef.current = null;
      autoLaunchKeyRef.current = null;
      customerContext.selectCustomer(customerId);
      setBrowserView(null);
      setRuntimeSurface(null);
      setBrowserError(null);
      setActionStatus(null);
      setActionError(null);
      setActionTarget(null);
      setLoadingStatus(false);
    },
    [customerContext]
  );

  const refreshCustomerTargets = useCallback(async () => {
    requestEpochRef.current += 1;
    actionEpochRef.current += 1;
    activeActionRef.current = false;
    autoLoadKeyRef.current = null;
    autoLaunchKeyRef.current = null;
    selectedCustomerRef.current = undefined;
    setBrowserView(null);
    setRuntimeSurface(null);
    setBrowserError(null);
    setActionStatus(null);
    setActionError(null);
    setActionTarget(null);
    setLoadingStatus(false);
    await customerContext.refreshTargets();
  }, [customerContext]);

  const loadStatus = useCallback(
    async (options: { resetActionStatus?: boolean } = {}) => {
      const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
      if (options.resetActionStatus !== false) {
        setActionStatus(null);
        setActionError(null);
      }
      if (!selectedCustomerId) {
        setBrowserView(null);
        setRuntimeSurface(null);
        setBrowserError('Choose a customer before loading Shared Browser.');
        return;
      }

      const requestEpoch = requestEpochRef.current + 1;
      requestEpochRef.current = requestEpoch;
      selectedCustomerRef.current = selectedCustomerId;
      setLoadingStatus(true);
      setBrowserError(null);
      try {
        const response = await evaosBusinessBrowser.getStatus.invoke({ customerId: selectedCustomerId });
        if (!isCurrentRequest(requestEpoch, selectedCustomerId)) {
          return;
        }
        if (!response.success || !response.data) {
          setBrowserView(null);
          setRuntimeSurface(null);
          setBrowserError(sharedBrowserUiText(response.msg, 'Shared Browser failed closed.'));
          return;
        }
        if (response.data.customerId !== selectedCustomerId) {
          setBrowserView(null);
          setRuntimeSurface(null);
          setBrowserError('Shared Browser broker returned evidence for a different customer.');
          return;
        }
        if (response.data.routeDenied) {
          setRuntimeSurface(null);
        }
        setBrowserView(response.data);
      } catch {
        if (!isCurrentRequest(requestEpoch, selectedCustomerId)) {
          return;
        }
        setBrowserView(null);
        setRuntimeSurface(null);
        setBrowserError('Shared Browser broker request failed closed.');
      } finally {
        if (isCurrentRequest(requestEpoch, selectedCustomerId)) {
          setLoadingStatus(false);
        }
      }
    },
    [customerContext.selectedCustomerId, isCurrentRequest]
  );

  const clearLoadedStatusForTargetChange = useCallback(
    (customerId: string) => {
      selectCustomer(customerId);
    },
    [selectCustomer]
  );

  const selectedCustomerLabel =
    customerContext.selectedTarget?.displayName ?? customerContext.selectedCustomerId ?? 'No customer selected';
  const actionInFlight = actionTarget !== null;
  const supportBlockerMessage =
    browserView && !runtimeSurface ? businessBrowserSupportBlockerMessage(browserView, selectedCustomerLabel) : null;
  const showLoadedSurfaceChrome = showDiagnostics || !runtimeSurface;
  const showHeader = showLoadedSurfaceChrome || Boolean(browserError || actionError);
  const showActionStatus = Boolean(actionStatus) && (showDiagnostics || !runtimeSurface);

  const runBrowserAction = useCallback(
    async (action: 'launch' | 'openUrl' | 'stop') => {
      const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
      setActionStatus(null);
      setActionError(null);
      if (activeActionRef.current) {
        return;
      }
      if (!browserView || browserView.routeDenied || !selectedCustomerId) {
        setActionError('Action denied by account policy.');
        return;
      }
      if (action === 'openUrl' && !openUrl.trim()) {
        setActionError('Enter a URL before opening Shared Browser.');
        return;
      }

      const actionEpoch = actionEpochRef.current + 1;
      actionEpochRef.current = actionEpoch;
      activeActionRef.current = true;
      const isCurrentAction = () => actionEpochRef.current === actionEpoch && isSelectedCustomer(selectedCustomerId);

      setActionTarget(action);
      try {
        const response =
          action === 'openUrl'
            ? await evaosBusinessBrowser.openUrl.invoke({ customerId: selectedCustomerId, url: openUrl })
            : await evaosBusinessBrowser[action].invoke({ customerId: selectedCustomerId });
        if (!isCurrentAction()) {
          return;
        }
        if (!response.success || !response.data) {
          setActionError(safeUiText(response.msg, 'Backend denied the browser action.'));
          return;
        }
        if (response.data.browser) {
          if (response.data.browser.customerId !== selectedCustomerId) {
            setBrowserView(null);
            setRuntimeSurface(null);
            setActionError('Shared Browser broker returned evidence for a different customer.');
            return;
          }
          setBrowserView(response.data.browser);
        } else {
          if (action === 'stop') {
            setRuntimeSurface(null);
          }
          await loadStatus({ resetActionStatus: false });
          if (!isCurrentAction()) {
            return;
          }
        }
        if (action === 'stop') {
          setRuntimeSurface(null);
        } else if (runtimeSurfaceMatches(response.data.runtimeSurface, selectedCustomerId)) {
          setRuntimeSurface(response.data.runtimeSurface);
        } else if (response.data.runtimeSurface) {
          setRuntimeSurface(null);
          setActionError('Shared Browser broker returned an invalid runtime surface handle.');
          return;
        } else if (action === 'launch' || (action === 'openUrl' && !runtimeSurface)) {
          setActionError('Shared Browser broker action did not return a runtime surface handle.');
          return;
        }
        setActionStatus(actionSummary(response.data));
      } catch {
        if (!isCurrentAction()) {
          return;
        }
        setActionError('Backend denied the browser action.');
      } finally {
        if (actionEpochRef.current === actionEpoch) {
          activeActionRef.current = false;
          setActionTarget(null);
        }
      }
    },
    [browserView, customerContext.selectedCustomerId, isSelectedCustomer, loadStatus, openUrl, runtimeSurface]
  );

  useEffect(() => {
    const selectedCustomerId = customerContext.selectedCustomerId;
    if (
      customerContext.loading ||
      !customerContext.loaded ||
      !selectedCustomerId ||
      browserView ||
      browserError ||
      loadingStatus
    ) {
      return;
    }
    if (autoLoadKeyRef.current === selectedCustomerId) {
      return;
    }
    autoLoadKeyRef.current = selectedCustomerId;
    void loadStatus({ resetActionStatus: false });
  }, [
    browserError,
    browserView,
    customerContext.loaded,
    customerContext.loading,
    customerContext.selectedCustomerId,
    loadStatus,
    loadingStatus,
  ]);

  useEffect(() => {
    const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
    if (
      !selectedCustomerId ||
      !browserView ||
      browserView.customerId !== selectedCustomerId ||
      runtimeSurface ||
      browserView.routeDenied ||
      !browserView.canLaunch ||
      !canAutoAttachBrowserSurface(browserView) ||
      actionTarget ||
      actionError ||
      activeActionRef.current
    ) {
      return;
    }
    const autoLaunchKey = [
      selectedCustomerId,
      browserView.auditId ?? browserView.lastCheckedAt ?? browserView.status ?? 'unknown',
    ].join(':');
    if (autoLaunchKeyRef.current === autoLaunchKey) {
      return;
    }
    autoLaunchKeyRef.current = autoLaunchKey;
    void runBrowserAction('launch');
  }, [actionError, actionTarget, browserView, customerContext.selectedCustomerId, runBrowserAction, runtimeSurface]);

  return (
    <div
      className={classNames(
        'w-full h-full min-h-0 box-border overflow-hidden',
        isMobile ? 'px-12px py-12px' : 'px-16px py-16px'
      )}
    >
      <div className='mx-auto flex h-full min-h-0 w-full max-w-none box-border flex-col gap-12px'>
        {showHeader ? (
          <header className='flex flex-wrap items-center justify-between gap-12px'>
            <div className='min-w-0'>
              <div className='flex flex-wrap items-center gap-8px'>
                <h1 className='m-0 text-22px leading-28px font-bold text-t-primary max-sm:text-20px'>Shared Browser</h1>
                {browserView || runtimeSurface ? (
                  <Tag color={runtimeSurface ? 'green' : statusColor(browserView)}>
                    {runtimeSurface ? 'loaded' : browserView?.status}
                  </Tag>
                ) : null}
              </div>
              {!runtimeSurface ? (
                <p className='m-0 mt-3px max-w-880px truncate text-13px leading-20px text-t-secondary'>
                  {customerContext.loading
                    ? 'Loading customer targets...'
                    : browserError || actionError || browserView?.healthSummary || 'Opening Shared Browser'}
                </p>
              ) : null}
            </div>
            <div className='flex shrink-0 flex-wrap items-center gap-8px'>
              {browserError || actionError || !runtimeSurface ? (
                <Button
                  type='primary'
                  icon={<Refresh theme='outline' size='16' />}
                  loading={loadingStatus || actionInFlight}
                  disabled={actionInFlight || !customerContext.selectedCustomerId}
                  onClick={() => void loadStatus()}
                >
                  Retry
                </Button>
              ) : null}
              {showDiagnostics ? (
                <Button type='secondary' onClick={() => setAdvancedOpen((open) => !open)}>
                  Diagnostics
                </Button>
              ) : null}
            </div>
          </header>
        ) : null}

        {loadingStatus ? (
          <div className='flex min-h-0 flex-1 items-center justify-center rounded-8px border border-dashed border-[var(--color-border-2)] bg-fill-1'>
            <Spin />
          </div>
        ) : browserView ? (
          <>
            {browserView.routeDenied ? (
              <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
                <div className='flex items-start gap-10px text-[rgb(var(--warning-6))]'>
                  <Attention theme='outline' size='18' className='mt-2px shrink-0' />
                  <div className='min-w-0'>
                    <h2 className='m-0 text-15px font-semibold leading-22px'>Route denied</h2>
                    <p className='m-0 mt-4px text-13px leading-20px'>
                      {sharedBrowserUiText(
                        browserView.routeDenialReason,
                        'This customer account does not allow Shared Browser.'
                      )}
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            {showActionStatus ? (
              <p className='m-0 rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px text-13px leading-20px text-[rgb(var(--success-6))]'>
                {actionStatus}
              </p>
            ) : null}
            {actionError ? (
              <p className='m-0 rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px text-13px leading-20px text-[rgb(var(--warning-6))]'>
                {actionError}
              </p>
            ) : null}

            {runtimeSurface ? (
              <section
                className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1'
                data-testid='evaos-business-browser-surface-container'
              >
                {showDiagnostics ? (
                  <div className='flex shrink-0 items-center justify-between gap-12px border-0 border-b border-solid border-[var(--color-border-2)] px-14px py-10px'>
                    <div className='min-w-0'>
                      <div className='truncate text-13px font-semibold leading-20px text-t-primary'>
                        {sharedBrowserUiText(runtimeSurface.displayLabel, 'Shared Browser')}
                      </div>
                      <div className='mt-1px truncate text-11px leading-16px text-t-tertiary'>
                        {selectedCustomerLabel}
                      </div>
                    </div>
                  </div>
                ) : null}
                <webview
                  data-testid='evaos-business-browser-surface'
                  src={runtimeSurface.surfaceUri}
                  partition={runtimeSurface.partition}
                  className='block h-full min-h-0 w-full flex-1 border-0'
                  style={{ display: 'flex', height: '100%', width: '100%' }}
                />
              </section>
            ) : (
              <section className='flex min-h-0 flex-1 items-center justify-center rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-24px text-center'>
                <div className='max-w-620px'>
                  <span className='mx-auto flex size-42px items-center justify-center rounded-8px bg-fill-3 text-t-primary'>
                    <Browser theme='outline' size='22' />
                  </span>
                  <h2 className='m-0 mt-14px text-20px font-semibold leading-26px text-t-primary'>
                    {supportBlockerMessage ? 'Shared Browser support blocker' : 'Shared Browser not attached'}
                  </h2>
                  <p className='m-0 mt-8px text-13px leading-20px text-t-secondary'>
                    {supportBlockerMessage ??
                      actionError ??
                      browserError ??
                      'Opening Shared Browser. The app will attach automatically when the browser is available.'}
                  </p>
                  {!browserView.routeDenied ? (
                    <div className='mt-14px flex justify-center gap-8px'>
                      {supportBlockerMessage ? (
                        <Button
                          type='primary'
                          icon={<Refresh theme='outline' size='15' />}
                          loading={loadingStatus}
                          disabled={actionInFlight || loadingStatus}
                          onClick={() => void loadStatus()}
                        >
                          Retry status
                        </Button>
                      ) : (
                        <Button
                          type='primary'
                          icon={<Refresh theme='outline' size='15' />}
                          loading={actionInFlight}
                          disabled={actionInFlight || !browserView.canLaunch}
                          onClick={() => void runBrowserAction('launch')}
                        >
                          Retry
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              </section>
            )}

            {showDiagnostics ? (
              <section className='shrink-0 rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px'>
                <button
                  type='button'
                  aria-expanded={advancedOpen}
                  className='flex w-full cursor-pointer items-center justify-between border-0 bg-transparent p-0 text-left'
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  <span>
                    <span className='block text-13px font-semibold leading-20px text-t-primary'>
                      Advanced diagnostics
                    </span>
                    <span className='block text-11px leading-16px text-t-secondary'>
                      Customer targets, broker actions, URL open controls, and policy evidence.
                    </span>
                  </span>
                  <Tag color={advancedOpen ? 'arcoblue' : 'gray'}>{advancedOpen ? 'Open' : 'Collapsed'}</Tag>
                </button>

                {advancedOpen ? (
                  <div className='mt-12px flex flex-col gap-12px'>
                    <div className='flex flex-wrap items-center justify-between gap-10px'>
                      <div className='min-w-0'>
                        <div className='text-13px font-medium leading-20px text-t-primary'>Customer context</div>
                        <div className='mt-2px truncate text-12px leading-18px text-t-secondary'>
                          {customerContext.loading ? 'Loading customer targets...' : selectedCustomerLabel}
                        </div>
                      </div>
                      <div className='flex shrink-0 flex-wrap gap-8px'>
                        <Button
                          size='small'
                          loading={customerContext.loading}
                          disabled={actionInFlight}
                          onClick={() => void refreshCustomerTargets()}
                        >
                          Refresh targets
                        </Button>
                        <Button
                          size='small'
                          loading={loadingStatus || customerContext.loading}
                          disabled={actionInFlight || !customerContext.selectedCustomerId}
                          onClick={() => void loadStatus()}
                        >
                          Check status
                        </Button>
                      </div>
                    </div>
                    <div className='flex flex-wrap gap-8px'>
                      {customerContext.targets.length === 0 ? (
                        <Tag color={customerContext.error ? 'orange' : 'gray'}>
                          {customerContext.error ?? customerContext.summaryText}
                        </Tag>
                      ) : (
                        customerContext.targets.map((target) => (
                          <Button
                            key={target.customerId}
                            size='small'
                            type={target.customerId === customerContext.selectedCustomerId ? 'primary' : 'secondary'}
                            disabled={actionInFlight}
                            onClick={() => clearLoadedStatusForTargetChange(target.customerId)}
                          >
                            {target.displayName}
                          </Button>
                        ))
                      )}
                    </div>
                    <section className='grid grid-cols-1 gap-10px md:grid-cols-4'>
                      <SummaryTile label='Status' value={browserView.status} />
                      <SummaryTile label='Control' value={browserView.controlSessionActive ? 'active' : 'inactive'} />
                      <SummaryTile label='Current URL' value={browserView.currentUrlSummary?.displayText ?? '-'} />
                      <SummaryTile label='Audit' value={browserView.auditId ?? browserView.policyAuditId ?? '-'} />
                    </section>

                    <section className='grid grid-cols-1 gap-12px lg:grid-cols-[minmax(0,1fr)_340px]'>
                      <article className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
                        <div className='flex flex-wrap items-start justify-between gap-12px'>
                          <div className='min-w-0'>
                            <div className='flex flex-wrap items-center gap-6px'>
                              <Tag color={statusColor(browserView)}>{browserView.status}</Tag>
                              {browserView.authNeeded ? <Tag color='orange'>auth needed</Tag> : null}
                              {browserView.captchaNeeded ? <Tag color='orange'>captcha</Tag> : null}
                              {browserView.waitingOnUser ? <Tag color='orange'>waiting</Tag> : null}
                            </div>
                            <h2 className='m-0 mt-10px text-17px font-semibold leading-24px text-t-primary'>
                              {sharedBrowserUiText(browserView.displayLabel, 'Shared Browser')}
                            </h2>
                            <p className='m-0 mt-4px text-13px leading-20px text-t-secondary'>
                              {sharedBrowserUiText(browserView.healthSummary, 'No runtime health summary returned.')}
                            </p>
                          </div>
                          <div className='flex max-w-full flex-wrap justify-end gap-8px'>
                            <Button
                              icon={<Browser theme='outline' size='15' />}
                              disabled={actionInFlight || browserView.routeDenied || !browserView.canLaunch}
                              loading={actionTarget === 'launch'}
                              onClick={() => void runBrowserAction('launch')}
                            >
                              Launch
                            </Button>
                            <Button
                              status='danger'
                              icon={<CloseOne theme='outline' size='15' />}
                              disabled={actionInFlight || browserView.routeDenied || !browserView.canStop}
                              loading={actionTarget === 'stop'}
                              onClick={() => void runBrowserAction('stop')}
                            >
                              Stop
                            </Button>
                          </div>
                        </div>
                      </article>

                      <aside className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
                        <div className='flex items-center gap-8px'>
                          <span className='flex size-30px items-center justify-center rounded-8px bg-fill-3 text-t-primary'>
                            <Open theme='outline' size='17' />
                          </span>
                          <h2 className='m-0 text-16px font-semibold leading-22px text-t-primary'>Open URL</h2>
                        </div>
                        <div className='mt-12px flex flex-col gap-8px'>
                          <Input
                            aria-label='Open URL'
                            value={openUrl}
                            placeholder='https://example.com/work'
                            disabled={actionInFlight || browserView.routeDenied || !browserView.canOpenUrl}
                            onChange={setOpenUrl}
                            onPressEnter={() => void runBrowserAction('openUrl')}
                          />
                          <Button
                            type='primary'
                            icon={<Open theme='outline' size='15' />}
                            disabled={
                              actionInFlight || browserView.routeDenied || !browserView.canOpenUrl || !openUrl.trim()
                            }
                            loading={actionTarget === 'openUrl'}
                            onClick={() => void runBrowserAction('openUrl')}
                          >
                            Open
                          </Button>
                        </div>
                      </aside>
                    </section>

                    <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
                      <div className='flex items-center gap-8px'>
                        <Shield theme='outline' size='17' />
                        <h2 className='m-0 text-16px font-semibold leading-22px text-t-primary'>Policy evidence</h2>
                      </div>
                      <div className='mt-10px grid grid-cols-1 gap-8px text-12px leading-18px text-t-secondary md:grid-cols-3'>
                        <span>Account: {browserView.customerAccountId ?? '-'}</span>
                        <span>Customer: {browserView.customerId}</span>
                        <span>Source: {browserView.sourcePointer ?? '-'}</span>
                      </div>
                    </section>
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        ) : (
          <div className='rounded-8px border border-dashed border-[var(--color-border-2)] bg-fill-1 p-16px text-13px leading-20px text-t-secondary'>
            Load a customer account to view browser runtime evidence.
          </div>
        )}
      </div>
    </div>
  );
};

const SummaryTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px'>
    <div className='text-12px leading-18px text-t-secondary'>{label}</div>
    <div className='mt-4px truncate text-15px font-semibold leading-22px text-t-primary'>{value}</div>
  </div>
);

export default BusinessBrowserPage;
