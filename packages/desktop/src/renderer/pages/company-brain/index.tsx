/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { Button, Input, Spin, Tag } from '@arco-design/web-react';
import { Brain, Refresh, Search, Time } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useEvaosBrokeredCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { evaosBrokerBlockerText } from '@renderer/utils/evaosBrokerBlocker';
import { safeEvaosUiText } from '@renderer/utils/evaosSafeText';
import {
  evaosCompanyBrain,
  type IEvaosCompanyBrainAccount360View,
  type IEvaosCompanyBrainAccountSummaryView,
  type IEvaosCompanyBrainDirectoryView,
  type IEvaosCompanyBrainIngestionState,
  type IEvaosCompanyBrainQueryResult,
  type IEvaosCustomerTargetView,
} from '@/common/adapter/ipcBridge';

function targetKey(target: Pick<IEvaosCustomerTargetView, 'customerId' | 'customerAccountId'>): string {
  return `${target.customerId}:${target.customerAccountId ?? 'none'}`;
}

function isSelectedTarget(
  target: Pick<IEvaosCustomerTargetView, 'customerId' | 'customerAccountId'>,
  selectedCustomerId?: string,
  selectedCustomerAccountId?: string
): boolean {
  return target.customerId === selectedCustomerId && target.customerAccountId === selectedCustomerAccountId;
}

function statusColor(status: IEvaosCompanyBrainIngestionState): 'green' | 'orange' | 'red' | 'gray' {
  if (status === 'ready') return 'green';
  if (status === 'ingesting') return 'orange';
  if (status === 'error') return 'red';
  return 'gray';
}

function stateLabel(t: ReturnType<typeof useTranslation>['t'], status: IEvaosCompanyBrainIngestionState): string {
  return t(`evaos.companyBrain.ingestion.${status}`);
}

function accountLabel(account: IEvaosCompanyBrainAccountSummaryView): string {
  return safeEvaosUiText(account.name, safeEvaosUiText(account.domain, account.accountId));
}

const CompanyBrainPage: React.FC = () => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const { customerContext } = useEvaosBrokeredCustomerContext();
  const selectedCustomerRef = useRef<string | undefined>(customerContext.selectedCustomerId);
  const selectedCustomerAccountRef = useRef<string | undefined>(customerContext.selectedTarget?.customerAccountId);
  const requestEpochRef = useRef(0);

  const [directory, setDirectory] = useState<IEvaosCompanyBrainDirectoryView | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [account, setAccount] = useState<IEvaosCompanyBrainAccount360View | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [loadingAccountId, setLoadingAccountId] = useState<string | null>(null);
  const [queryText, setQueryText] = useState('');
  const [queryResult, setQueryResult] = useState<IEvaosCompanyBrainQueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [querying, setQuerying] = useState(false);

  const clearEvidence = useCallback(() => {
    setDirectory(null);
    setDirectoryError(null);
    setAccount(null);
    setAccountError(null);
    setLoadingAccountId(null);
    setQueryText('');
    setQueryResult(null);
    setQueryError(null);
    setQuerying(false);
    setLoadingDirectory(false);
  }, []);

  useEffect(() => {
    selectedCustomerRef.current = customerContext.selectedCustomerId;
    selectedCustomerAccountRef.current = customerContext.selectedTarget?.customerAccountId;
    requestEpochRef.current += 1;
    clearEvidence();
  }, [clearEvidence, customerContext.selectedCustomerId, customerContext.selectedTarget?.customerAccountId]);

  const isCurrentRequest = useCallback((epoch: number, customerId: string) => {
    return requestEpochRef.current === epoch && selectedCustomerRef.current === customerId;
  }, []);

  const selectCustomer = useCallback(
    (target: IEvaosCustomerTargetView) => {
      selectedCustomerRef.current = target.customerId;
      selectedCustomerAccountRef.current = target.customerAccountId;
      requestEpochRef.current += 1;
      customerContext.selectCustomer(target.customerId);
      clearEvidence();
    },
    [clearEvidence, customerContext]
  );

  const refreshCustomerTargets = useCallback(async () => {
    requestEpochRef.current += 1;
    selectedCustomerRef.current = undefined;
    selectedCustomerAccountRef.current = undefined;
    clearEvidence();
    await customerContext.refreshTargets();
  }, [clearEvidence, customerContext]);

  const loadAccount = useCallback(
    async (accountId: string, options: { preserveQuery?: boolean } = {}) => {
      const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
      const requestEpoch = requestEpochRef.current;
      if (!options.preserveQuery) {
        setQueryResult(null);
        setQueryError(null);
      }
      if (!selectedCustomerId) {
        setAccount(null);
        setAccountError(t('evaos.companyBrain.chooseCustomer'));
        return;
      }
      setLoadingAccountId(accountId);
      setAccountError(null);
      try {
        const response = await evaosCompanyBrain.getAccount360.invoke({
          customerId: selectedCustomerId,
          accountId,
        });
        if (!isCurrentRequest(requestEpoch, selectedCustomerId)) {
          return;
        }
        if (!response.success || !response.data) {
          setAccount(null);
          setAccountError(evaosBrokerBlockerText(t, response, t('evaos.companyBrain.accountFailedClosed')));
          return;
        }
        if (response.data.customerId !== selectedCustomerId || response.data.accountId !== accountId) {
          setAccount(null);
          setAccountError(t('evaos.companyBrain.differentEvidence'));
          return;
        }
        setAccount(response.data);
      } catch {
        if (isCurrentRequest(requestEpoch, selectedCustomerId)) {
          setAccount(null);
          setAccountError(t('evaos.companyBrain.accountRequestFailed'));
        }
      } finally {
        if (isCurrentRequest(requestEpoch, selectedCustomerId)) {
          setLoadingAccountId(null);
        }
      }
    },
    [customerContext.selectedCustomerId, isCurrentRequest, t]
  );

  const loadDirectory = useCallback(async () => {
    const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
    setAccount(null);
    setAccountError(null);
    setQueryResult(null);
    setQueryError(null);
    if (!selectedCustomerId) {
      setDirectory(null);
      setDirectoryError(t('evaos.companyBrain.chooseCustomer'));
      return;
    }

    const requestEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = requestEpoch;
    selectedCustomerRef.current = selectedCustomerId;
    setLoadingDirectory(true);
    setDirectoryError(null);
    try {
      const response = await evaosCompanyBrain.getDirectory.invoke({ customerId: selectedCustomerId });
      if (!isCurrentRequest(requestEpoch, selectedCustomerId)) {
        return;
      }
      if (!response.success || !response.data) {
        setDirectory(null);
        setDirectoryError(evaosBrokerBlockerText(t, response, t('evaos.companyBrain.failedClosed')));
        return;
      }
      if (response.data.customerId !== selectedCustomerId) {
        setDirectory(null);
        setDirectoryError(t('evaos.companyBrain.differentEvidence'));
        return;
      }
      setDirectory(response.data);
      if (!response.data.routeDenied && response.data.accounts[0]) {
        await loadAccount(response.data.accounts[0].accountId, { preserveQuery: true });
      }
    } catch {
      if (isCurrentRequest(requestEpoch, selectedCustomerId)) {
        setDirectory(null);
        setDirectoryError(t('evaos.companyBrain.requestFailed'));
      }
    } finally {
      if (isCurrentRequest(requestEpoch, selectedCustomerId)) {
        setLoadingDirectory(false);
      }
    }
  }, [customerContext.selectedCustomerId, isCurrentRequest, loadAccount, t]);

  const runQuery = useCallback(async () => {
    const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
    const currentAccount = account;
    const query = queryText.trim();
    setQueryResult(null);
    setQueryError(null);
    if (!selectedCustomerId || !currentAccount) {
      setQueryError(t('evaos.companyBrain.queryRequiresAccount'));
      return;
    }
    if (!currentAccount.backendEnforced || !currentAccount.auditId) {
      setQueryError(t('evaos.companyBrain.backendProofRequired'));
      return;
    }
    if (!query) {
      setQueryError(t('evaos.companyBrain.queryRequired'));
      return;
    }
    const requestEpoch = requestEpochRef.current;
    setQuerying(true);
    try {
      const response = await evaosCompanyBrain.query.invoke({
        customerId: selectedCustomerId,
        accountId: currentAccount.accountId,
        query,
      });
      if (!isCurrentRequest(requestEpoch, selectedCustomerId)) {
        return;
      }
      if (!response.success || !response.data) {
        setQueryError(evaosBrokerBlockerText(t, response, t('evaos.companyBrain.queryFailedClosed')));
        return;
      }
      if (response.data.customerId !== selectedCustomerId || response.data.accountId !== currentAccount.accountId) {
        setQueryError(t('evaos.companyBrain.differentEvidence'));
        return;
      }
      setQueryResult(response.data);
    } catch {
      if (isCurrentRequest(requestEpoch, selectedCustomerId)) {
        setQueryError(t('evaos.companyBrain.queryRequestFailed'));
      }
    } finally {
      if (isCurrentRequest(requestEpoch, selectedCustomerId)) {
        setQuerying(false);
      }
    }
  }, [account, customerContext.selectedCustomerId, isCurrentRequest, queryText, t]);

  const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
  const selectedCustomerAccountId =
    selectedCustomerAccountRef.current ?? customerContext.selectedTarget?.customerAccountId;
  const selectedTarget =
    customerContext.targets.find((target) => isSelectedTarget(target, selectedCustomerId, selectedCustomerAccountId)) ??
    customerContext.selectedTarget;
  const selectedCustomerLabel = safeEvaosUiText(
    selectedTarget?.displayName,
    selectedCustomerId ?? t('evaos.companyBrain.noCustomerSelected')
  );
  const accountProofReady = Boolean(account && account.backendEnforced && account.auditId && !account.routeDenied);

  return (
    <div
      className={classNames(
        'w-full min-h-full box-border overflow-y-auto',
        isMobile ? 'px-16px py-14px' : 'px-12px py-24px md:px-40px md:py-32px'
      )}
    >
      <div className='mx-auto flex w-full max-w-1080px box-border flex-col gap-16px'>
        <header className='flex flex-wrap items-start justify-between gap-12px'>
          <div className='min-w-0'>
            <h1 className='m-0 text-28px leading-34px font-bold text-t-primary max-sm:text-24px'>
              {t('evaos.companyBrain.title')}
            </h1>
            <p className='m-0 mt-4px max-w-720px text-14px leading-22px text-t-secondary'>
              {t('evaos.companyBrain.description')}
            </p>
          </div>
          <Button
            type='primary'
            icon={<Refresh theme='outline' size='16' />}
            loading={loadingDirectory}
            disabled={!customerContext.selectedCustomerId}
            onClick={() => void loadDirectory()}
          >
            {t('common.refresh')}
          </Button>
        </header>

        <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
          <div className='flex flex-wrap items-center justify-between gap-10px'>
            <div className='min-w-0'>
              <div className='text-13px font-medium leading-20px text-t-primary'>
                {t('evaos.shared.customerContext')}
              </div>
              <div className='mt-2px truncate text-12px leading-18px text-t-secondary'>
                {customerContext.loading ? t('evaos.shared.loadingCustomerTargets') : selectedCustomerLabel}
              </div>
            </div>
            <div className='flex shrink-0 flex-wrap gap-8px'>
              <Button loading={customerContext.loading} onClick={() => void refreshCustomerTargets()}>
                {t('evaos.shared.refreshTargets')}
              </Button>
              <Button
                loading={loadingDirectory || customerContext.loading}
                disabled={!customerContext.selectedCustomerId}
                onClick={() => void loadDirectory()}
              >
                {t('evaos.shared.load')}
              </Button>
            </div>
          </div>
          <div className='mt-10px flex flex-wrap gap-8px'>
            {customerContext.targets.length === 0 ? (
              <Tag color={customerContext.error ? 'orange' : 'gray'}>
                {safeEvaosUiText(
                  customerContext.error ?? customerContext.summaryText,
                  t('evaos.companyBrain.failedClosed')
                )}
              </Tag>
            ) : (
              customerContext.targets.map((target) => (
                <Button
                  key={targetKey(target)}
                  size='small'
                  type={
                    isSelectedTarget(target, selectedCustomerId, selectedCustomerAccountId) ? 'primary' : 'secondary'
                  }
                  onClick={() => selectCustomer(target)}
                >
                  {safeEvaosUiText(target.displayName, target.customerId)}
                </Button>
              ))
            )}
          </div>
          <p className='m-0 mt-8px text-12px leading-18px text-t-secondary'>
            {t('evaos.companyBrain.scopedSummary', {
              summary: safeEvaosUiText(customerContext.summaryText, t('evaos.shared.unknown')),
            })}
          </p>
          {directoryError ? (
            <p className='m-0 mt-8px text-12px leading-18px text-[rgb(var(--warning-6))]'>{directoryError}</p>
          ) : null}
        </section>

        {loadingDirectory ? (
          <div className='flex min-h-180px items-center justify-center rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1'>
            <Spin tip={t('evaos.companyBrain.loading')} />
          </div>
        ) : null}

        {directory ? (
          <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'>
            <div className='flex flex-wrap items-center justify-between gap-10px'>
              <div className='min-w-0'>
                <div className='flex flex-wrap items-center gap-8px'>
                  <h2 className='m-0 text-18px leading-24px font-semibold text-t-primary'>
                    {t('evaos.companyBrain.directory')}
                  </h2>
                  <Tag color={directory.routeDenied ? 'orange' : 'green'}>
                    {directory.routeDenied ? t('evaos.shared.routeDenied') : t('evaos.shared.brokerPolicyActive')}
                  </Tag>
                  <Tag color={directory.backendEnforced ? 'green' : 'orange'}>
                    {directory.backendEnforced
                      ? t('evaos.shared.backendEnforced')
                      : t('evaos.shared.needsBackendProof')}
                  </Tag>
                  <Tag color={statusColor(directory.ingestionState)}>{stateLabel(t, directory.ingestionState)}</Tag>
                </div>
                <p className='m-0 mt-6px text-13px leading-20px text-t-secondary'>
                  {safeEvaosUiText(directory.summaryText, t('evaos.companyBrain.directoryLoaded'))}
                </p>
              </div>
            </div>

            {directory.routeDenied ? (
              <div className='mt-14px rounded-8px border border-solid border-[rgb(var(--warning-6))] bg-[rgb(var(--warning-1))] p-14px text-13px leading-20px text-t-primary'>
                {safeEvaosUiText(directory.routeDenialReason, t('evaos.companyBrain.denied'))}
              </div>
            ) : null}

            {!directory.routeDenied ? (
              <div className='mt-14px grid grid-cols-[minmax(240px,320px)_minmax(0,1fr)] gap-14px max-lg:grid-cols-1'>
                <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px'>
                  <div className='mb-10px flex items-center gap-8px text-15px font-semibold leading-22px text-t-primary'>
                    <Brain theme='outline' size='16' /> {t('evaos.companyBrain.accounts')}
                  </div>
                  {directory.accounts.length === 0 ? (
                    <p className='m-0 text-13px leading-20px text-t-secondary'>
                      {t('evaos.companyBrain.emptyAccounts')}
                    </p>
                  ) : (
                    <div className='flex flex-col gap-8px'>
                      {directory.accounts.map((item) => (
                        <Button
                          key={item.accountId}
                          type={account?.accountId === item.accountId ? 'primary' : 'secondary'}
                          loading={loadingAccountId === item.accountId}
                          className='!h-auto !justify-start !whitespace-normal'
                          onClick={() => void loadAccount(item.accountId)}
                        >
                          <span className='flex w-full flex-col items-start gap-3px py-4px text-left'>
                            <span className='text-13px font-medium leading-18px'>{accountLabel(item)}</span>
                            <span className='text-11px leading-16px opacity-80'>
                              {stateLabel(t, item.ingestionState)}
                              {item.exceptionCount > 0
                                ? ` · ${t('evaos.companyBrain.exceptions', { count: item.exceptionCount })}`
                                : ''}
                            </span>
                          </span>
                        </Button>
                      ))}
                    </div>
                  )}
                </section>

                <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px'>
                  {accountError ? (
                    <div className='rounded-8px border border-solid border-[rgb(var(--warning-6))] bg-[rgb(var(--warning-1))] p-14px text-13px leading-20px text-t-primary'>
                      {accountError}
                    </div>
                  ) : account ? (
                    <div className='flex flex-col gap-14px'>
                      <div className='flex flex-wrap items-start justify-between gap-10px'>
                        <div className='min-w-0'>
                          <h3 className='m-0 text-17px leading-24px font-semibold text-t-primary'>
                            {accountLabel(account.account)}
                          </h3>
                          <p className='m-0 mt-4px text-13px leading-20px text-t-secondary'>
                            {safeEvaosUiText(
                              account.brief?.summary,
                              safeEvaosUiText(account.brief?.title, t('evaos.companyBrain.noBrief'))
                            )}
                          </p>
                        </div>
                        <Tag color={statusColor(account.ingestionState)}>{stateLabel(t, account.ingestionState)}</Tag>
                      </div>

                      {!accountProofReady ? (
                        <div className='rounded-8px border border-solid border-[rgb(var(--warning-6))] bg-[rgb(var(--warning-1))] p-12px text-13px leading-20px text-t-primary'>
                          {t('evaos.companyBrain.backendProofRequired')}
                        </div>
                      ) : null}

                      <div className='grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-10px'>
                        <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px'>
                          <div className='text-12px leading-18px text-t-secondary'>
                            {t('evaos.companyBrain.exceptionsLabel')}
                          </div>
                          <div className='mt-4px text-17px leading-24px font-semibold text-t-primary'>
                            {account.exceptions.length}
                          </div>
                        </div>
                        <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px'>
                          <div className='text-12px leading-18px text-t-secondary'>
                            {t('evaos.companyBrain.timeline')}
                          </div>
                          <div className='mt-4px text-17px leading-24px font-semibold text-t-primary'>
                            {account.timeline.length}
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className='mb-8px flex items-center gap-8px text-14px font-semibold leading-20px text-t-primary'>
                          <Time theme='outline' size='16' /> {t('evaos.companyBrain.recentActivity')}
                        </div>
                        {account.timeline.length === 0 ? (
                          <p className='m-0 text-13px leading-20px text-t-secondary'>
                            {t('evaos.companyBrain.emptyTimeline')}
                          </p>
                        ) : (
                          <div className='flex flex-col gap-8px'>
                            {account.timeline.slice(0, 4).map((event) => (
                              <article
                                key={event.entryId}
                                className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-10px'
                              >
                                <div className='text-13px font-medium leading-18px text-t-primary'>
                                  {safeEvaosUiText(event.title, event.type)}
                                </div>
                                {event.summary ? (
                                  <div className='mt-3px text-12px leading-18px text-t-secondary'>
                                    {safeEvaosUiText(event.summary, t('evaos.shared.unknown'))}
                                  </div>
                                ) : null}
                              </article>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <div className='mb-8px text-14px font-semibold leading-20px text-t-primary'>
                          {t('evaos.companyBrain.query')}
                        </div>
                        <div className='flex flex-col gap-8px'>
                          <Input.TextArea
                            value={queryText}
                            onChange={setQueryText}
                            placeholder={t('evaos.companyBrain.queryPlaceholder')}
                            autoSize={{ minRows: 2, maxRows: 4 }}
                          />
                          <div>
                            <Button
                              type='primary'
                              icon={<Search theme='outline' size='14' />}
                              loading={querying}
                              disabled={!accountProofReady}
                              onClick={() => void runQuery()}
                            >
                              {t('evaos.companyBrain.runQuery')}
                            </Button>
                          </div>
                          {queryError ? (
                            <p className='m-0 text-13px leading-20px text-[rgb(var(--warning-6))]'>{queryError}</p>
                          ) : null}
                          {queryResult ? (
                            <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px'>
                              <div className='text-12px leading-18px text-t-secondary'>
                                {safeEvaosUiText(queryResult.status, t('evaos.companyBrain.queryResult'))}
                              </div>
                              <p className='m-0 mt-6px text-13px leading-20px text-t-primary'>
                                {safeEvaosUiText(queryResult.answer, t('evaos.companyBrain.noAnswer'))}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className='m-0 text-13px leading-20px text-t-secondary'>
                      {t('evaos.companyBrain.selectAccount')}
                    </p>
                  )}
                </section>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
};

export default CompanyBrainPage;
