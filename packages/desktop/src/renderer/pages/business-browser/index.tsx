/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import classNames from 'classnames';
import { Button, Input, Spin, Tag } from '@arco-design/web-react';
import { Attention, Browser, CloseOne, Open, Refresh, Shield } from '@icon-park/react';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import {
  evaosBusinessBrowser,
  type IEvaosBusinessBrowserActionResult,
  type IEvaosBusinessBrowserView,
} from '@/common/adapter/ipcBridge';

const SECRET_TEXT_PATTERN =
  /\b(?:eds|epg)_[A-Za-z0-9_-]{4,}\b|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|grant[_-]?handle|authorization|bearer|secret|password/i;

function safeUiText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
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
  const parts = [safeUiText(result.message, `Business Browser ${result.status}.`)];
  if (result.urlSummary?.displayText) {
    parts.push(`URL ${result.urlSummary.displayText}.`);
  }
  if (result.auditId) {
    parts.push(`Audit ${result.auditId}.`);
  }
  return parts.join(' ');
}

const BusinessBrowserPage: React.FC = () => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [customerId, setCustomerId] = useState('');
  const [browserView, setBrowserView] = useState<IEvaosBusinessBrowserView | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [openUrl, setOpenUrl] = useState('');
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<'launch' | 'openUrl' | 'stop' | null>(null);

  const handleCustomerChange = useCallback((value: string) => {
    setCustomerId(value);
    setBrowserView(null);
    setBrowserError(null);
    setActionStatus(null);
    setActionError(null);
  }, []);

  const loadStatus = useCallback(
    async (options: { resetActionStatus?: boolean } = {}) => {
      const trimmedCustomerId = customerId.trim();
      if (options.resetActionStatus !== false) {
        setActionStatus(null);
        setActionError(null);
      }
      if (!trimmedCustomerId) {
        setBrowserView(null);
        setBrowserError('Choose a customer before loading Business Browser.');
        return;
      }

      setLoadingStatus(true);
      setBrowserError(null);
      try {
        const response = await evaosBusinessBrowser.getStatus.invoke({ customerId: trimmedCustomerId });
        if (!response.success || !response.data) {
          setBrowserView(null);
          setBrowserError(safeUiText(response.msg, 'Business Browser failed closed.'));
          return;
        }
        setBrowserView(response.data);
      } catch {
        setBrowserView(null);
        setBrowserError('Business Browser broker request failed closed.');
      } finally {
        setLoadingStatus(false);
      }
    },
    [customerId]
  );

  const runBrowserAction = useCallback(
    async (action: 'launch' | 'openUrl' | 'stop') => {
      const trimmedCustomerId = customerId.trim();
      setActionStatus(null);
      setActionError(null);
      if (!browserView || browserView.routeDenied) {
        setActionError('Action denied by account policy.');
        return;
      }
      if (action === 'openUrl' && !openUrl.trim()) {
        setActionError('Enter a URL before opening Business Browser.');
        return;
      }

      setActionTarget(action);
      try {
        const response =
          action === 'openUrl'
            ? await evaosBusinessBrowser.openUrl.invoke({ customerId: trimmedCustomerId, url: openUrl })
            : await evaosBusinessBrowser[action].invoke({ customerId: trimmedCustomerId });
        if (!response.success || !response.data) {
          setActionError(safeUiText(response.msg, 'Backend denied the browser action.'));
          return;
        }
        if (response.data.browser) {
          setBrowserView(response.data.browser);
        } else {
          await loadStatus({ resetActionStatus: false });
        }
        setActionStatus(actionSummary(response.data));
      } catch {
        setActionError('Backend denied the browser action.');
      } finally {
        setActionTarget(null);
      }
    },
    [browserView, customerId, loadStatus, openUrl]
  );

  return (
    <div
      className={classNames(
        'w-full min-h-full box-border overflow-y-auto',
        isMobile ? 'px-16px py-14px' : 'px-12px py-24px md:px-40px md:py-32px'
      )}
    >
      <div className='mx-auto flex w-full max-w-1040px box-border flex-col gap-16px'>
        <header className='flex flex-wrap items-start justify-between gap-12px'>
          <div className='min-w-0'>
            <h1 className='m-0 text-28px leading-34px font-bold text-t-primary max-sm:text-24px'>Business Browser</h1>
            <p className='m-0 mt-4px max-w-720px text-14px leading-22px text-t-secondary'>
              Brokered browser and VM runtime state for this customer account.
            </p>
          </div>
          <Button
            type='primary'
            icon={<Refresh theme='outline' size='16' />}
            loading={loadingStatus}
            onClick={() => void loadStatus()}
          >
            Refresh
          </Button>
        </header>

        <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
          <label className='block text-13px font-medium leading-20px text-t-primary' htmlFor='browser-customer-id'>
            Customer context
          </label>
          <div className='mt-8px flex gap-8px max-[520px]:flex-col'>
            <Input
              id='browser-customer-id'
              value={customerId}
              placeholder='Customer ID or slug'
              onChange={handleCustomerChange}
              onPressEnter={() => void loadStatus()}
            />
            <Button className='shrink-0' loading={loadingStatus} onClick={() => void loadStatus()}>
              Load
            </Button>
          </div>
          {browserError ? (
            <p className='m-0 mt-8px text-12px leading-18px text-[rgb(var(--warning-6))]'>{browserError}</p>
          ) : null}
        </section>

        {loadingStatus ? (
          <div className='flex min-h-220px items-center justify-center rounded-8px border border-dashed border-[var(--color-border-2)] bg-fill-1'>
            <Spin />
          </div>
        ) : browserView ? (
          <>
            <section className='grid grid-cols-1 gap-10px md:grid-cols-4'>
              <SummaryTile label='Status' value={browserView.status} />
              <SummaryTile label='Control' value={browserView.controlSessionActive ? 'active' : 'inactive'} />
              <SummaryTile label='Current URL' value={browserView.currentUrlSummary?.displayText ?? '-'} />
              <SummaryTile label='Audit' value={browserView.auditId ?? browserView.policyAuditId ?? '-'} />
            </section>

            {browserView.routeDenied ? (
              <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
                <div className='flex items-start gap-10px text-[rgb(var(--warning-6))]'>
                  <Attention theme='outline' size='18' className='mt-2px shrink-0' />
                  <div className='min-w-0'>
                    <h2 className='m-0 text-15px font-semibold leading-22px'>Route denied</h2>
                    <p className='m-0 mt-4px text-13px leading-20px'>
                      {browserView.routeDenialReason ?? 'This customer account does not allow Business Browser.'}
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            {actionStatus ? (
              <p className='m-0 rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px text-13px leading-20px text-[rgb(var(--success-6))]'>
                {actionStatus}
              </p>
            ) : null}
            {actionError ? (
              <p className='m-0 rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px text-13px leading-20px text-[rgb(var(--warning-6))]'>
                {actionError}
              </p>
            ) : null}

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
                      {browserView.displayLabel}
                    </h2>
                    <p className='m-0 mt-4px text-13px leading-20px text-t-secondary'>
                      {browserView.healthSummary ?? 'No runtime health summary returned.'}
                    </p>
                  </div>
                  <div className='flex max-w-full flex-wrap justify-end gap-8px'>
                    <Button
                      icon={<Browser theme='outline' size='15' />}
                      disabled={browserView.routeDenied || !browserView.canLaunch}
                      loading={actionTarget === 'launch'}
                      onClick={() => void runBrowserAction('launch')}
                    >
                      Launch
                    </Button>
                    <Button
                      status='danger'
                      icon={<CloseOne theme='outline' size='15' />}
                      disabled={browserView.routeDenied || !browserView.canStop}
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
                    onChange={setOpenUrl}
                    onPressEnter={() => void runBrowserAction('openUrl')}
                  />
                  <Button
                    type='primary'
                    icon={<Open theme='outline' size='15' />}
                    disabled={browserView.routeDenied || !browserView.canOpenUrl || !openUrl.trim()}
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
