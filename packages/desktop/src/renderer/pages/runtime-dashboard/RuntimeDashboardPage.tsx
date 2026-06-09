/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { Button, Spin, Tag } from '@arco-design/web-react';
import { Attention, Comment, Open, Refresh, Robot, Shield } from '@icon-park/react';
import { useEvaosBrokeredCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { useFeedback } from '@/renderer/hooks/context/FeedbackContext';
import { buildEvaosSupportReportContext } from '@/renderer/evaos/supportReportContext';
import { evaosBroker, type IEvaosRuntimeStatusView } from '@/common/adapter/ipcBridge';
import type {
  IEvaosRuntimeActionResult,
  IEvaosRuntimeActionType,
  IEvaosRuntimeKey,
  IEvaosRuntimeSurfaceView,
} from '@/common/evaos/bridgeTypes';

const SECRET_TEXT_PATTERN =
  /\b(?:eds|epg)_[A-Za-z0-9_-]{4,}\b|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|grant[_-]?handle|authorization|bearer|secret|password/i;

function safeUiText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
}

function statusColor(status?: string): 'green' | 'orange' | 'red' | 'gray' | 'arcoblue' {
  const normalized = status?.toLowerCase() ?? '';
  if (/(running|active|ready|online|healthy)/.test(normalized)) return 'green';
  if (/(done|complete|completed|idle|ok|available)/.test(normalized)) return 'arcoblue';
  if (/(offline|failed|denied|blocked|error|expired|revoked)/.test(normalized)) return 'red';
  if (/(auth|captcha|waiting|repair|not_paired)/.test(normalized)) return 'orange';
  return 'gray';
}

function hasSafeAttachAction(view: IEvaosRuntimeStatusView | null): boolean {
  return hasRuntimeAction(view, [
    'attach_dashboard',
    'start_attach',
    'launch',
    'runtime_launch',
    'open_dashboard',
    'open',
  ]);
}

function hasRuntimeAction(view: IEvaosRuntimeStatusView | null, actions: string[]): boolean {
  if (!view?.actions?.length) return false;
  const available = new Set(view.actions);
  return actions.some((action) => available.has(action));
}

function runtimeSettledState(
  view: IEvaosRuntimeStatusView | null,
  error: string | null
): 'live' | 'denied' | 'repair' | 'offline' {
  if (error) return 'repair';
  const status = view?.status.toLowerCase() ?? '';
  if (/(denied|blocked|forbidden|unauthorized|expired|revoked)/.test(status)) return 'denied';
  if (/(offline|unavailable|stopped|missing)/.test(status)) return 'offline';
  if (/(repair|failed|error|degraded|auth|captcha|not_paired)/.test(status)) return 'repair';
  if (/(running|active|ready|online|healthy|done|complete|completed|idle|ok|available|waiting)/.test(status)) {
    return 'live';
  }
  return view ? 'repair' : 'offline';
}

function settledStateColor(state: 'live' | 'denied' | 'repair' | 'offline'): 'green' | 'orange' | 'red' | 'gray' {
  if (state === 'live') return 'green';
  if (state === 'repair') return 'orange';
  if (state === 'denied') return 'red';
  return 'gray';
}

function runtimeActionSummary(result: IEvaosRuntimeActionResult): string {
  const parts = [safeUiText(result.message, `${result.runtimeKey} ${result.status}.`)];
  if (result.urlSummary?.displayText) {
    parts.push(`Target ${result.urlSummary.displayText}.`);
  }
  if (result.auditId) {
    parts.push(`Audit ${result.auditId}.`);
  }
  return parts.join(' ');
}

function runtimeActionNeedsBlockerUi(result: IEvaosRuntimeActionResult): boolean {
  const text = [result.status, result.message, result.runtimeStatus?.status, result.runtimeStatus?.healthSummary]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /(denied|blocked|forbidden|unauthorized|expired|revoked|offline|unavailable|repair|not_paired|permission)/.test(
    text
  );
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
  customerId: string,
  runtimeKey: IEvaosRuntimeKey
): surface is IEvaosRuntimeSurfaceView {
  return (
    surface?.schemaVersion === 'evaos.runtime_surface.v1' &&
    surface.customerId === customerId &&
    surface.runtimeKey === runtimeKey &&
    isSafeRuntimeSurfaceUri(surface.surfaceUri) &&
    isSafeRuntimeSurfacePartition(surface.partition)
  );
}

function isSafeRuntimeSurfacePartition(value: unknown): value is string {
  return typeof value === 'string' && /^evaos-runtime-[a-z0-9_-]{1,120}$/i.test(value);
}

function missingRuntimeSurfaceMessage(runtimeKey: IEvaosRuntimeKey, title: string): string {
  if (runtimeKey === 'terminal') {
    return 'Terminal broker did not return a VM shell runtime surface. Backend runtime_launch must return a customer-scoped launch_url or opaque runtimeSurface handle.';
  }
  return `${title} broker attach did not return a runtime surface handle.`;
}

type RuntimeDashboardPageProps = {
  runtimeKey: IEvaosRuntimeKey;
  title: string;
  subtitle: string;
  issueRef?: string;
};

const RuntimeDashboardPage: React.FC<RuntimeDashboardPageProps> = ({ runtimeKey, title, subtitle, issueRef }) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [statusView, setStatusView] = useState<IEvaosRuntimeStatusView | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<IEvaosRuntimeActionType | null>(null);
  const [runtimeSurface, setRuntimeSurface] = useState<IEvaosRuntimeSurfaceView | null>(null);
  const { customerContext } = useEvaosBrokeredCustomerContext();
  const selectedCustomerRef = useRef<string | undefined>(customerContext.selectedCustomerId);
  const requestEpochRef = useRef(0);
  const autoAttachKeyRef = useRef<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { openFeedback } = useFeedback();

  const clearRuntimeEvidence = useCallback(() => {
    autoAttachKeyRef.current = null;
    setStatusView(null);
    setRuntimeError(null);
    setActionStatus(null);
    setActionError(null);
    setActionTarget(null);
    setRuntimeSurface(null);
    setLoadingStatus(false);
  }, []);

  useEffect(() => {
    selectedCustomerRef.current = customerContext.selectedCustomerId;
    requestEpochRef.current += 1;
    clearRuntimeEvidence();
  }, [clearRuntimeEvidence, customerContext.selectedCustomerId]);

  const isCurrentRequest = useCallback((epoch: number, customerId: string) => {
    return requestEpochRef.current === epoch && selectedCustomerRef.current === customerId;
  }, []);

  const selectCustomer = useCallback(
    (customerId: string) => {
      selectedCustomerRef.current = customerId;
      requestEpochRef.current += 1;
      customerContext.selectCustomer(customerId);
      clearRuntimeEvidence();
    },
    [clearRuntimeEvidence, customerContext]
  );

  const refreshCustomerTargets = useCallback(async () => {
    selectedCustomerRef.current = undefined;
    requestEpochRef.current += 1;
    clearRuntimeEvidence();
    await customerContext.refreshTargets();
  }, [clearRuntimeEvidence, customerContext]);

  const loadRuntimeStatus = useCallback(async () => {
    const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
    setActionStatus(null);
    setActionError(null);
    if (!selectedCustomerId) {
      setStatusView(null);
      setRuntimeError(`Choose a customer before loading ${title} runtime evidence.`);
      return;
    }

    const requestEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = requestEpoch;
    selectedCustomerRef.current = selectedCustomerId;
    setLoadingStatus(true);
    setRuntimeError(null);
    try {
      const response = await evaosBroker.runtimeStatus.invoke({
        customerId: selectedCustomerId,
        runtime: runtimeKey,
      });
      if (!isCurrentRequest(requestEpoch, selectedCustomerId)) return;
      if (!response.success || !response.data) {
        setStatusView(null);
        setRuntimeError(safeUiText(response.msg, `${title} runtime evidence failed closed.`));
        return;
      }
      if (response.data.customerId !== selectedCustomerId || response.data.runtimeKey !== runtimeKey) {
        setStatusView(null);
        setRuntimeSurface(null);
        setRuntimeError(`${title} broker returned evidence for a different runtime or customer.`);
        return;
      }
      setStatusView(response.data);
      if (runtimeSettledState(response.data, null) !== 'live') {
        setRuntimeSurface(null);
      }
    } catch {
      if (!isCurrentRequest(requestEpoch, selectedCustomerId)) return;
      setStatusView(null);
      setRuntimeError(`${title} broker request failed closed.`);
    } finally {
      if (isCurrentRequest(requestEpoch, selectedCustomerId)) {
        setLoadingStatus(false);
      }
    }
  }, [customerContext.selectedCustomerId, isCurrentRequest, runtimeKey, title]);

  useEffect(() => {
    if (customerContext.loading || !customerContext.selectedCustomerId) {
      return;
    }
    void loadRuntimeStatus();
  }, [customerContext.loading, customerContext.selectedCustomerId, loadRuntimeStatus]);

  const runRuntimeAction = useCallback(
    async (action: IEvaosRuntimeActionType) => {
      const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
      setActionStatus(null);
      setActionError(null);
      if (!selectedCustomerId) {
        setActionError(`Choose a customer before opening ${title}.`);
        return;
      }

      const requestEpoch = requestEpochRef.current + 1;
      requestEpochRef.current = requestEpoch;
      selectedCustomerRef.current = selectedCustomerId;
      setActionTarget(action);
      try {
        const response = await evaosBroker.runtimeAction.invoke({
          customerId: selectedCustomerId,
          runtime: runtimeKey,
          action,
        });
        if (!isCurrentRequest(requestEpoch, selectedCustomerId)) return;
        if (!response.success || !response.data) {
          setActionError(safeUiText(response.msg, `${title} runtime action failed closed.`));
          return;
        }
        if (response.data.runtimeKey !== runtimeKey || response.data.customerId !== selectedCustomerId) {
          setActionError(`${title} broker returned action evidence for a different runtime or customer.`);
          return;
        }
        if (response.data.runtimeStatus) {
          setStatusView(response.data.runtimeStatus);
        }
        if (runtimeSurfaceMatches(response.data.runtimeSurface, selectedCustomerId, runtimeKey)) {
          setRuntimeSurface(response.data.runtimeSurface);
        } else if (response.data.runtimeSurface) {
          setRuntimeSurface(null);
          setActionError(`${title} broker returned an invalid runtime surface handle.`);
          return;
        } else if (action === 'attach') {
          if (runtimeActionNeedsBlockerUi(response.data)) {
            setRuntimeSurface(null);
            setActionError(runtimeActionSummary(response.data));
            return;
          }
          setRuntimeSurface(null);
          setActionError(missingRuntimeSurfaceMessage(runtimeKey, title));
          return;
        }
        setActionStatus(runtimeActionSummary(response.data));
      } catch {
        if (!isCurrentRequest(requestEpoch, selectedCustomerId)) return;
        setActionError(`${title} runtime action failed closed.`);
      } finally {
        if (isCurrentRequest(requestEpoch, selectedCustomerId)) {
          setActionTarget(null);
        }
      }
    },
    [customerContext.selectedCustomerId, isCurrentRequest, runtimeKey, title]
  );

  const selectedCustomerLabel =
    customerContext.selectedTarget?.displayName ?? customerContext.selectedCustomerId ?? 'No customer selected';
  const statusText = safeUiText(statusView?.status, runtimeError ? 'blocked' : 'waiting');
  const healthText = runtimeError ?? safeUiText(statusView?.healthSummary, subtitle);
  const settledState = runtimeSettledState(statusView, runtimeError);
  const actionsAllowedByState = settledState !== 'denied' && settledState !== 'offline';
  const canRequestBrokerRuntimeAction =
    Boolean(customerContext.selectedCustomerId) &&
    customerContext.loaded &&
    !loadingStatus &&
    !runtimeError &&
    actionsAllowedByState &&
    Boolean(statusView);
  const canAttachRuntime =
    canRequestBrokerRuntimeAction &&
    (!statusView?.actions?.length ||
      hasRuntimeAction(statusView, ['attach_dashboard', 'start_attach', 'launch', 'runtime_launch']));
  const canOpenRuntime =
    canRequestBrokerRuntimeAction && hasRuntimeAction(statusView, ['open_dashboard', 'open']) && !canAttachRuntime;
  const attachAvailable = canRequestBrokerRuntimeAction || (actionsAllowedByState && hasSafeAttachAction(statusView));
  const supportReportContext = useMemo(
    () =>
      buildEvaosSupportReportContext({
        surface: `runtime:${runtimeKey}`,
        runtimeKey,
        issueRef,
        settledState: runtimeSurface ? 'loaded' : settledState,
        status: runtimeSurface?.status ?? statusText,
        healthSummary: runtimeSurface ? selectedCustomerLabel : healthText,
        blocker: actionError ?? runtimeError,
        sourcePointer: runtimeSurface?.sourcePointer ?? statusView?.sourcePointer,
        auditIds: [runtimeSurface?.auditId, statusView?.auditId],
        customer: {
          selectedCustomerId: customerContext.selectedCustomerId,
          selectedCustomerLabel,
          summaryText: customerContext.summaryText,
          roles: customerContext.roles,
          scopes: customerContext.scopes,
        },
      }),
    [
      actionError,
      customerContext.roles,
      customerContext.scopes,
      customerContext.selectedCustomerId,
      customerContext.summaryText,
      healthText,
      issueRef,
      runtimeError,
      runtimeKey,
      runtimeSurface,
      selectedCustomerLabel,
      settledState,
      statusText,
      statusView?.auditId,
      statusView?.sourcePointer,
    ]
  );
  const openSupportReport = useCallback(async () => {
    try {
      await openFeedback(supportReportContext);
    } catch (error) {
      console.error('[RuntimeDashboardPage] Failed to open evaOS support report:', error);
    }
  }, [openFeedback, supportReportContext]);

  useEffect(() => {
    const selectedCustomerId = customerContext.selectedCustomerId;
    if (!selectedCustomerId || !canAttachRuntime || runtimeSurface || actionTarget || actionError) {
      return;
    }
    const autoAttachKey = [
      selectedCustomerId,
      runtimeKey,
      statusView?.auditId ?? statusView?.lastCheckedAt ?? statusView?.status ?? 'unknown',
    ].join(':');
    if (autoAttachKeyRef.current === autoAttachKey) {
      return;
    }
    autoAttachKeyRef.current = autoAttachKey;
    void runRuntimeAction('attach');
  }, [
    actionError,
    actionTarget,
    canAttachRuntime,
    customerContext.selectedCustomerId,
    runRuntimeAction,
    runtimeKey,
    runtimeSurface,
    statusView?.auditId,
    statusView?.lastCheckedAt,
    statusView?.status,
  ]);

  return (
    <div
      className={classNames(
        'w-full h-full min-h-0 box-border overflow-hidden',
        isMobile ? 'px-12px py-12px' : 'px-16px py-16px'
      )}
    >
      <div className='mx-auto flex h-full min-h-0 w-full max-w-none box-border flex-col gap-12px'>
        <header className='flex flex-wrap items-center justify-between gap-12px'>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-8px'>
              <h1 className='m-0 text-22px leading-28px font-bold text-t-primary max-sm:text-20px'>{title}</h1>
              <Tag color={settledStateColor(settledState)}>{runtimeSurface ? 'attached' : settledState}</Tag>
              <Tag color={statusColor(statusText)}>{statusText}</Tag>
            </div>
            <p className='m-0 mt-3px max-w-880px truncate text-13px leading-20px text-t-secondary'>
              {loadingStatus ? `Loading ${title}...` : runtimeSurface ? selectedCustomerLabel : healthText}
            </p>
          </div>
          <div className='flex shrink-0 flex-wrap items-center gap-8px'>
            <Button
              type='secondary'
              icon={<Comment theme='outline' size='16' />}
              onClick={() => void openSupportReport()}
            >
              Report to support
            </Button>
            {actionError || runtimeError ? (
              <Button
                type='primary'
                icon={<Refresh theme='outline' size='16' />}
                loading={loadingStatus || actionTarget !== null}
                disabled={!customerContext.selectedCustomerId}
                onClick={() => (runtimeSurface ? void runRuntimeAction('attach') : void loadRuntimeStatus())}
              >
                Retry
              </Button>
            ) : null}
            <Button type='secondary' onClick={() => setAdvancedOpen((open) => !open)}>
              Diagnostics
            </Button>
          </div>
        </header>

        <main
          className='flex min-h-0 flex-1 flex-col overflow-hidden'
          data-testid={`evaos-runtime-dashboard-${runtimeKey}`}
        >
          {runtimeSurface ? (
            <section
              className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1'
              data-testid={`evaos-runtime-surface-container-${runtimeKey}`}
            >
              <div className='flex shrink-0 items-center justify-between gap-12px border-0 border-b border-solid border-[var(--color-border-2)] px-14px py-10px'>
                <div className='min-w-0'>
                  <div className='truncate text-13px font-semibold leading-20px text-t-primary'>
                    {safeUiText(runtimeSurface.displayLabel, title)}
                  </div>
                  <div className='mt-1px truncate text-11px leading-16px text-t-tertiary'>{selectedCustomerLabel}</div>
                </div>
                <Tag color='green'>{safeUiText(runtimeSurface.status, 'attached')}</Tag>
              </div>
              <webview
                data-testid={`evaos-runtime-surface-${runtimeKey}`}
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
                  {loadingStatus || actionTarget ? <Spin size={18} /> : <Robot theme='outline' size='22' />}
                </span>
                <h2 className='m-0 mt-14px text-20px font-semibold leading-26px text-t-primary'>
                  {loadingStatus || actionTarget ? `Opening ${title}` : `${title} not attached`}
                </h2>
                <p className='m-0 mt-8px text-13px leading-20px text-t-secondary'>
                  {actionError ??
                    runtimeError ??
                    (customerContext.selectedCustomerId
                      ? 'Waiting for a brokered runtime surface. The app will attach automatically when the runtime is available.'
                      : `Choose a customer before opening ${title}.`)}
                </p>
                {canAttachRuntime || canOpenRuntime || actionError || runtimeError ? (
                  <div className='mt-14px flex justify-center gap-8px'>
                    <Button
                      type='primary'
                      icon={<Open theme='outline' size='15' />}
                      loading={actionTarget !== null}
                      disabled={!customerContext.selectedCustomerId || actionTarget !== null}
                      onClick={() => void runRuntimeAction(canOpenRuntime && !canAttachRuntime ? 'open' : 'attach')}
                    >
                      Retry
                    </Button>
                  </div>
                ) : null}
              </div>
            </section>
          )}
        </main>

        <section className='shrink-0 rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px'>
          <button
            type='button'
            aria-expanded={advancedOpen}
            className='flex w-full cursor-pointer items-center justify-between border-0 bg-transparent p-0 text-left'
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <span>
              <span className='block text-13px font-semibold leading-20px text-t-primary'>Advanced diagnostics</span>
              <span className='block text-11px leading-16px text-t-secondary'>
                Customer targets, broker actions, source, and audit evidence.
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
                  <Button size='small' loading={customerContext.loading} onClick={() => void refreshCustomerTargets()}>
                    Refresh targets
                  </Button>
                  <Button
                    size='small'
                    loading={loadingStatus}
                    disabled={!customerContext.selectedCustomerId}
                    onClick={() => void loadRuntimeStatus()}
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
                      onClick={() => selectCustomer(target.customerId)}
                    >
                      {target.displayName}
                    </Button>
                  ))
                )}
              </div>
              <div className='grid grid-cols-1 gap-8px text-12px leading-18px text-t-secondary sm:grid-cols-2 lg:grid-cols-3'>
                <EvidenceRow label='Customer' value={statusView?.customerId} />
                <EvidenceRow label='Account' value={statusView?.customerAccountId} />
                <EvidenceRow label='Owner' value={statusView?.owner} />
                <EvidenceRow label='Runtime' value={statusView?.runtimeKey} />
                <EvidenceRow label='Source' value={statusView?.sourcePointer} />
                <EvidenceRow label='Audit' value={statusView?.auditId} />
              </div>
              <div className='flex items-start gap-8px text-12px leading-18px text-t-secondary'>
                {attachAvailable ? (
                  <Open theme='outline' size='15' className='mt-1px shrink-0' />
                ) : (
                  <Shield theme='outline' size='15' className='mt-1px shrink-0' />
                )}
                <span>
                  {attachAvailable
                    ? 'Broker action available. This route can request a broker-enforced runtime action for the selected customer.'
                    : 'Runtime action blocked. No raw dashboard URL is exposed in renderer state.'}
                </span>
              </div>
              {actionStatus ? <div className='text-12px leading-18px text-t-secondary'>{actionStatus}</div> : null}
              {actionError ? (
                <div className='text-12px leading-18px text-[rgb(var(--danger-6))]'>{actionError}</div>
              ) : null}
              {runtimeError || statusColor(statusText) === 'red' ? (
                <div className='flex items-start gap-8px text-12px leading-18px text-[rgb(var(--warning-6))]'>
                  <Attention theme='outline' size='15' className='mt-1px shrink-0' />
                  <span>Fail-closed until evaOS broker returns customer-scoped {title} evidence.</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
};

const EvidenceRow: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div className='rounded-8px bg-fill-2 px-10px py-8px'>
    <div className='text-10px font-semibold uppercase tracking-1px text-t-tertiary'>{label}</div>
    <div className='mt-3px break-words text-t-primary'>{safeUiText(value, 'none')}</div>
  </div>
);

export default RuntimeDashboardPage;
