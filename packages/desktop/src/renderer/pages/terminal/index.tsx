/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { Button, Spin, Tag } from '@arco-design/web-react';
import { Attention, Refresh, Terminal } from '@icon-park/react';
import { useEvaosBrokeredCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { evaosBroker, type IEvaosRuntimeStatusView } from '@/common/adapter/ipcBridge';

const SECRET_TEXT_PATTERN =
  /(eds_|epg_|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|authorization|bearer|secret|password)/i;

function safeUiText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
}

function statusColor(status?: string): 'green' | 'orange' | 'gray' | 'arcoblue' {
  const normalized = status?.toLowerCase() ?? '';
  if (/(running|active|ready|online|healthy)/.test(normalized)) return 'green';
  if (/(done|complete|completed|idle|ok|available)/.test(normalized)) return 'arcoblue';
  if (/(offline|failed|denied|blocked|error)/.test(normalized)) return 'orange';
  return 'gray';
}

const TerminalPage: React.FC = () => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [statusView, setStatusView] = useState<IEvaosRuntimeStatusView | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [loadingTerminal, setLoadingTerminal] = useState(false);
  const { customerContext } = useEvaosBrokeredCustomerContext();
  const selectedCustomerRef = useRef<string | undefined>(customerContext.selectedCustomerId);
  const requestEpochRef = useRef(0);

  const clearTerminalEvidence = useCallback(() => {
    setStatusView(null);
    setTerminalError(null);
    setLoadingTerminal(false);
  }, []);

  useEffect(() => {
    selectedCustomerRef.current = customerContext.selectedCustomerId;
    requestEpochRef.current += 1;
    clearTerminalEvidence();
  }, [clearTerminalEvidence, customerContext.selectedCustomerId]);

  const isCurrentRequest = useCallback((epoch: number, customerId: string) => {
    return requestEpochRef.current === epoch && selectedCustomerRef.current === customerId;
  }, []);

  const selectCustomer = useCallback(
    (customerId: string) => {
      selectedCustomerRef.current = customerId;
      requestEpochRef.current += 1;
      customerContext.selectCustomer(customerId);
      clearTerminalEvidence();
    },
    [clearTerminalEvidence, customerContext]
  );

  const refreshCustomerTargets = useCallback(async () => {
    selectedCustomerRef.current = undefined;
    requestEpochRef.current += 1;
    clearTerminalEvidence();
    await customerContext.refreshTargets();
  }, [clearTerminalEvidence, customerContext]);

  const loadTerminalStatus = useCallback(async () => {
    const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
    if (!selectedCustomerId) {
      setStatusView(null);
      setTerminalError('Choose a customer before loading Terminal runtime evidence.');
      return;
    }

    const requestEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = requestEpoch;
    selectedCustomerRef.current = selectedCustomerId;
    setLoadingTerminal(true);
    setTerminalError(null);
    try {
      const response = await evaosBroker.runtimeStatus.invoke({
        customerId: selectedCustomerId,
        runtime: 'terminal',
      });
      if (!isCurrentRequest(requestEpoch, selectedCustomerId)) return;
      if (!response.success || !response.data) {
        setStatusView(null);
        setTerminalError(safeUiText(response.msg, 'Terminal runtime evidence failed closed.'));
        return;
      }
      if (response.data.customerId !== selectedCustomerId || response.data.runtimeKey !== 'terminal') {
        setStatusView(null);
        setTerminalError('Terminal broker returned evidence for a different runtime or customer.');
        return;
      }
      setStatusView(response.data);
    } catch {
      if (!isCurrentRequest(requestEpoch, selectedCustomerId)) return;
      setStatusView(null);
      setTerminalError('Terminal broker request failed closed.');
    } finally {
      if (isCurrentRequest(requestEpoch, selectedCustomerId)) {
        setLoadingTerminal(false);
      }
    }
  }, [customerContext.selectedCustomerId, isCurrentRequest]);

  const selectedCustomerLabel =
    customerContext.selectedTarget?.displayName ?? customerContext.selectedCustomerId ?? 'No customer selected';
  const statusText = safeUiText(statusView?.status, terminalError ? 'blocked' : 'waiting');
  const healthText =
    terminalError ??
    safeUiText(statusView?.healthSummary, 'Load a customer account to view Terminal runtime evidence.');

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
            <h1 className='m-0 text-28px leading-34px font-bold text-t-primary max-sm:text-24px'>Terminal</h1>
            <p className='m-0 mt-4px max-w-720px text-14px leading-22px text-t-secondary'>
              Customer VM shell runtime status from evaOS broker evidence. AionUi does not execute VM commands or hold
              local trust authority.
            </p>
          </div>
          <Button
            type='primary'
            icon={<Refresh theme='outline' size='16' />}
            loading={loadingTerminal}
            disabled={!customerContext.selectedCustomerId}
            onClick={() => void loadTerminalStatus()}
          >
            Load
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
                loading={loadingTerminal}
                disabled={!customerContext.selectedCustomerId}
                onClick={() => void loadTerminalStatus()}
              >
                Check terminal
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
            {customerContext.summaryText}. Terminal evidence clears on customer switch before a new broker check.
          </p>
        </section>

        <section
          className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'
          data-testid='evaos-terminal-status'
        >
          <div className='flex flex-wrap items-start justify-between gap-12px'>
            <div className='flex min-w-0 items-start gap-10px'>
              <span className='mt-1px flex size-38px shrink-0 items-center justify-center rounded-8px bg-fill-3 text-t-primary'>
                <Terminal theme='outline' size='20' />
              </span>
              <div className='min-w-0'>
                <div className='flex flex-wrap items-center gap-8px'>
                  <h2 className='m-0 text-18px font-semibold leading-24px text-t-primary'>
                    {safeUiText(statusView?.displayLabel, 'Customer VM shell runtime')}
                  </h2>
                  <Tag color={statusColor(statusText)}>{statusText}</Tag>
                </div>
                <p className='m-0 mt-6px text-13px leading-20px text-t-secondary'>
                  {loadingTerminal ? (
                    <span className='inline-flex items-center gap-8px'>
                      <Spin size={14} />
                      Loading Terminal runtime evidence
                    </span>
                  ) : (
                    healthText
                  )}
                </p>
              </div>
            </div>
            <Tag color='gray'>Issue #108</Tag>
          </div>

          <div className='mt-14px grid grid-cols-1 gap-8px text-12px leading-18px text-t-secondary sm:grid-cols-2'>
            <EvidenceRow label='Customer' value={statusView?.customerId} />
            <EvidenceRow label='Account' value={statusView?.customerAccountId} />
            <EvidenceRow label='Owner' value={statusView?.owner} />
            <EvidenceRow label='Runtime' value={statusView?.runtimeKey} />
            <EvidenceRow label='Source' value={statusView?.sourcePointer} />
            <EvidenceRow label='Audit' value={statusView?.auditId} />
          </div>

          {terminalError || statusColor(statusText) === 'orange' ? (
            <div className='mt-12px flex items-start gap-8px text-12px leading-18px text-[rgb(var(--warning-6))]'>
              <Attention theme='outline' size='15' className='mt-1px shrink-0' />
              <span>Fail-closed until evaOS broker returns customer-scoped Terminal evidence.</span>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
};

const EvidenceRow: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div className='min-w-0'>
    <span className='text-t-tertiary'>{label}: </span>
    <span className='break-words text-t-secondary'>{safeUiText(value, '-')}</span>
  </div>
);

export default TerminalPage;
