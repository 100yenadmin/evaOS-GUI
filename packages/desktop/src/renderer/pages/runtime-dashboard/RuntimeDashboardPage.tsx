/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { Button, Spin, Tag } from '@arco-design/web-react';
import { Attention, Open, Refresh, Robot, Shield } from '@icon-park/react';
import { useEvaosBrokeredCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
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
    isSafeRuntimeSurfaceUri(surface.surfaceUri)
  );
}

function runtimeSurfacePartition(surface: IEvaosRuntimeSurfaceView): string {
  const safeSurface = surface.surfaceId.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80);
  return `evaos-runtime-${safeSurface}`;
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

  const clearRuntimeEvidence = useCallback(() => {
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
  const canAttachRuntime =
    actionsAllowedByState &&
    hasRuntimeAction(statusView, ['attach_dashboard', 'start_attach', 'launch', 'runtime_launch']);
  const canOpenRuntime = actionsAllowedByState && hasRuntimeAction(statusView, ['open_dashboard', 'open']);
  const attachAvailable = actionsAllowedByState && hasSafeAttachAction(statusView);

  return (
    <div
      className={classNames(
        'w-full min-h-full box-border overflow-y-auto',
        isMobile ? 'px-16px py-14px' : 'px-12px py-24px md:px-40px md:py-32px'
      )}
    >
      <div className='mx-auto flex w-full max-w-980px box-border flex-col gap-16px'>
        <header className='flex flex-wrap items-start justify-between gap-12px'>
          <div className='min-w-0'>
            <h1 className='m-0 text-28px leading-34px font-bold text-t-primary max-sm:text-24px'>{title}</h1>
            <p className='m-0 mt-4px max-w-720px text-14px leading-22px text-t-secondary'>{subtitle}</p>
          </div>
          <Button
            type='primary'
            icon={<Refresh theme='outline' size='16' />}
            loading={loadingStatus}
            disabled={!customerContext.selectedCustomerId}
            onClick={() => void loadRuntimeStatus()}
          >
            Check
          </Button>
        </header>

        <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
          <div className='flex flex-wrap items-center justify-between gap-10px'>
            <div className='min-w-0'>
              <div className='text-13px font-medium leading-20px text-t-primary'>Customer context</div>
              <div className='mt-2px truncate text-12px leading-18px text-t-secondary'>
                {customerContext.loading ? 'Loading customer targets...' : selectedCustomerLabel}
              </div>
            </div>
            <div className='flex shrink-0 flex-wrap gap-8px'>
              <Button loading={customerContext.loading} onClick={() => void refreshCustomerTargets()}>
                Refresh targets
              </Button>
              <Button
                loading={loadingStatus}
                disabled={!customerContext.selectedCustomerId}
                onClick={() => void loadRuntimeStatus()}
              >
                Load status
              </Button>
            </div>
          </div>
          <div className='mt-10px flex flex-wrap gap-8px'>
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
          <p className='m-0 mt-8px text-12px leading-18px text-t-secondary'>
            {customerContext.summaryText}. Runtime evidence clears on customer switch before a new broker check.
          </p>
        </section>

        <section
          className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'
          data-testid={`evaos-runtime-dashboard-${runtimeKey}`}
        >
          <div className='flex flex-wrap items-start justify-between gap-12px'>
            <div className='flex min-w-0 items-start gap-10px'>
              <span className='mt-1px flex size-38px shrink-0 items-center justify-center rounded-8px bg-fill-3 text-t-primary'>
                <Robot theme='outline' size='20' />
              </span>
              <div className='min-w-0'>
                <div className='flex flex-wrap items-center gap-8px'>
                  <h2 className='m-0 text-18px font-semibold leading-24px text-t-primary'>
                    {safeUiText(statusView?.displayLabel, title)}
                  </h2>
                  <Tag color={settledStateColor(settledState)}>{settledState}</Tag>
                  <Tag color={statusColor(statusText)}>{statusText}</Tag>
                  {issueRef ? <Tag color='gray'>{issueRef}</Tag> : null}
                </div>
                <div className='m-0 mt-6px text-13px leading-20px text-t-secondary'>
                  {loadingStatus ? (
                    <span className='inline-flex items-center gap-8px'>
                      <Spin size={14} />
                      Loading {title} runtime evidence
                    </span>
                  ) : (
                    healthText
                  )}
                </div>
              </div>
            </div>
            <Tag color={attachAvailable ? 'green' : 'orange'}>
              {attachAvailable ? 'Broker action available' : 'Runtime action blocked'}
            </Tag>
          </div>

          <div className='mt-14px grid grid-cols-1 gap-8px text-12px leading-18px text-t-secondary sm:grid-cols-2'>
            <EvidenceRow label='Customer' value={statusView?.customerId} />
            <EvidenceRow label='Account' value={statusView?.customerAccountId} />
            <EvidenceRow label='Owner' value={statusView?.owner} />
            <EvidenceRow label='Runtime' value={statusView?.runtimeKey} />
            <EvidenceRow label='Source' value={statusView?.sourcePointer} />
            <EvidenceRow label='Audit' value={statusView?.auditId} />
          </div>

          <div className='mt-12px flex items-start gap-8px text-12px leading-18px text-t-secondary'>
            {attachAvailable ? (
              <Open theme='outline' size='15' className='mt-1px shrink-0' />
            ) : (
              <Shield theme='outline' size='15' className='mt-1px shrink-0' />
            )}
            <span>
              {attachAvailable
                ? 'Broker evidence says this runtime has a safe open or attach action.'
                : 'Runtime launch remains blocked until evaOS broker returns a safe runtime action. No raw dashboard URL is exposed in renderer state.'}
            </span>
          </div>

          <div className='mt-12px flex flex-wrap items-center gap-8px'>
            {canAttachRuntime ? (
              <Button
                type='primary'
                icon={<Open theme='outline' size='15' />}
                loading={actionTarget === 'attach'}
                disabled={!customerContext.selectedCustomerId || actionTarget !== null}
                onClick={() => void runRuntimeAction('attach')}
              >
                Start / Attach
              </Button>
            ) : null}
            {canOpenRuntime ? (
              <Button
                type={canAttachRuntime ? 'secondary' : 'primary'}
                icon={<Open theme='outline' size='15' />}
                loading={actionTarget === 'open'}
                disabled={!customerContext.selectedCustomerId || actionTarget !== null}
                onClick={() => void runRuntimeAction('open')}
              >
                Open
              </Button>
            ) : null}
          </div>

          {actionStatus ? <div className='mt-10px text-12px leading-18px text-t-secondary'>{actionStatus}</div> : null}

          {actionError ? (
            <div className='mt-10px text-12px leading-18px text-[rgb(var(--danger-6))]'>{actionError}</div>
          ) : null}

          {runtimeError || statusColor(statusText) === 'red' ? (
            <div className='mt-12px flex items-start gap-8px text-12px leading-18px text-[rgb(var(--warning-6))]'>
              <Attention theme='outline' size='15' className='mt-1px shrink-0' />
              <span>Fail-closed until evaOS broker returns customer-scoped {title} evidence.</span>
            </div>
          ) : null}
        </section>

        {runtimeSurface ? (
          <section
            className='min-h-640px overflow-hidden rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1'
            data-testid={`evaos-runtime-surface-container-${runtimeKey}`}
          >
            <div className='flex items-center justify-between gap-12px border-0 border-b border-solid border-[var(--color-border-2)] px-14px py-10px'>
              <div className='min-w-0'>
                <div className='truncate text-13px font-semibold leading-20px text-t-primary'>
                  {safeUiText(runtimeSurface.displayLabel, title)}
                </div>
                <div className='mt-1px truncate text-11px leading-16px text-t-tertiary'>Brokered runtime surface</div>
              </div>
              <Tag color='green'>{safeUiText(runtimeSurface.status, 'attached')}</Tag>
            </div>
            <webview
              data-testid={`evaos-runtime-surface-${runtimeKey}`}
              src={runtimeSurface.surfaceUri}
              partition={runtimeSurfacePartition(runtimeSurface)}
              className='block h-600px w-full border-0'
              allowpopups={false}
            />
          </section>
        ) : null}
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
