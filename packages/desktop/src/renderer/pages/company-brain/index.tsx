/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { Button, Input, Spin, Tag } from '@arco-design/web-react';
import { Attention, Brain, Refresh, Search } from '@icon-park/react';
import { useEvaosBrokeredCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import {
  evaosCompanyBrain,
  type IEvaosCompanyBrainAccount360View,
  type IEvaosCompanyBrainAccountSummaryView,
  type IEvaosCompanyBrainDirectoryView,
  type IEvaosCompanyBrainExceptionSeverity,
  type IEvaosCompanyBrainIngestionState,
  type IEvaosCompanyBrainQueryResult,
} from '@/common/adapter/ipcBridge';

const SECRET_TEXT_PATTERN =
  /\b(?:eds|epg)_[A-Za-z0-9_-]{4,}\b|\bsk_(?:live|test)_[A-Za-z0-9]{8,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b|\b(?:rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b|\bgh[opusr]_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bglpat-[A-Za-z0-9_-]{10,}\b|\bAIza[0-9A-Za-z_-]{20,}\b|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|grant[_-]?handle|authorization|bearer|secret|password|raw_prompt|raw_embedding/i;

function safeUiText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}

function ingestionColor(state: IEvaosCompanyBrainIngestionState): 'green' | 'orange' | 'red' | 'gray' {
  if (state === 'ready') return 'green';
  if (state === 'ingesting') return 'orange';
  if (state === 'error') return 'red';
  return 'gray';
}

function severityColor(severity: IEvaosCompanyBrainExceptionSeverity): 'red' | 'orange' | 'blue' {
  if (severity === 'critical') return 'red';
  if (severity === 'warning') return 'orange';
  return 'blue';
}

const CompanyBrainPage: React.FC = () => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [directory, setDirectory] = useState<IEvaosCompanyBrainDirectoryView | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<IEvaosCompanyBrainAccount360View | null>(null);
  const [queryResult, setQueryResult] = useState<IEvaosCompanyBrainQueryResult | null>(null);
  const [brainError, setBrainError] = useState<string | null>(null);
  const [queryText, setQueryText] = useState('');
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [loadingAccountId, setLoadingAccountId] = useState<string | null>(null);
  const [querying, setQuerying] = useState(false);
  const { customerContext } = useEvaosBrokeredCustomerContext();
  const selectedCustomerRef = useRef<string | undefined>(customerContext.selectedCustomerId);
  const selectedAccountRef = useRef<IEvaosCompanyBrainAccount360View | null>(selectedAccount);
  const requestEpochRef = useRef(0);
  const accountRequestEpochRef = useRef(0);
  const queryRequestEpochRef = useRef(0);
  const activeAccountRequestRef = useRef<{ epoch: number; customerId: string; accountId: string } | null>(null);

  const clearEvidence = useCallback(() => {
    setDirectory(null);
    setSelectedAccount(null);
    selectedAccountRef.current = null;
    setQueryResult(null);
    setBrainError(null);
    setLoadingDirectory(false);
    setLoadingAccountId(null);
    setQuerying(false);
    activeAccountRequestRef.current = null;
  }, []);

  useEffect(() => {
    selectedCustomerRef.current = customerContext.selectedCustomerId;
    requestEpochRef.current += 1;
    accountRequestEpochRef.current += 1;
    queryRequestEpochRef.current += 1;
    clearEvidence();
  }, [clearEvidence, customerContext.selectedCustomerId]);

  useEffect(() => {
    selectedAccountRef.current = selectedAccount;
  }, [selectedAccount]);

  const isCurrentRequest = useCallback((epoch: number, customerId: string) => {
    return requestEpochRef.current === epoch && selectedCustomerRef.current === customerId;
  }, []);

  const isCurrentAccountRequest = useCallback((epoch: number, customerId: string, accountId: string) => {
    return (
      accountRequestEpochRef.current === epoch &&
      activeAccountRequestRef.current?.epoch === epoch &&
      activeAccountRequestRef.current.customerId === customerId &&
      activeAccountRequestRef.current.accountId === accountId &&
      selectedCustomerRef.current === customerId
    );
  }, []);

  const isCurrentQueryRequest = useCallback((epoch: number, customerId: string, accountId: string) => {
    return (
      queryRequestEpochRef.current === epoch &&
      selectedCustomerRef.current === customerId &&
      selectedAccountRef.current?.accountId === accountId
    );
  }, []);

  const selectCustomer = useCallback(
    (customerId: string) => {
      selectedCustomerRef.current = customerId;
      requestEpochRef.current += 1;
      accountRequestEpochRef.current += 1;
      queryRequestEpochRef.current += 1;
      customerContext.selectCustomer(customerId);
      clearEvidence();
    },
    [clearEvidence, customerContext]
  );

  const refreshCustomerTargets = useCallback(async () => {
    requestEpochRef.current += 1;
    accountRequestEpochRef.current += 1;
    queryRequestEpochRef.current += 1;
    selectedCustomerRef.current = undefined;
    clearEvidence();
    await customerContext.refreshTargets();
  }, [clearEvidence, customerContext]);

  const loadDirectory = useCallback(async () => {
    const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
    setBrainError(null);
    setSelectedAccount(null);
    selectedAccountRef.current = null;
    setQueryResult(null);
    accountRequestEpochRef.current += 1;
    queryRequestEpochRef.current += 1;
    activeAccountRequestRef.current = null;
    if (!selectedCustomerId) {
      setDirectory(null);
      setBrainError('Choose a customer before loading Company Brain.');
      return;
    }

    const requestEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = requestEpoch;
    selectedCustomerRef.current = selectedCustomerId;
    setLoadingDirectory(true);
    try {
      const response = await evaosCompanyBrain.getDirectory.invoke({ customerId: selectedCustomerId });
      if (!isCurrentRequest(requestEpoch, selectedCustomerId)) {
        return;
      }
      if (!response.success || !response.data) {
        setDirectory(null);
        setBrainError(safeUiText(response.msg, 'Company Brain failed closed.'));
        return;
      }
      if (response.data.customerId !== selectedCustomerId) {
        setDirectory(null);
        setBrainError('Company Brain broker returned evidence for a different customer.');
        return;
      }
      setDirectory(response.data);
    } catch {
      if (!isCurrentRequest(requestEpoch, selectedCustomerId)) {
        return;
      }
      setDirectory(null);
      setBrainError('Company Brain broker request failed closed.');
    } finally {
      if (isCurrentRequest(requestEpoch, selectedCustomerId)) {
        setLoadingDirectory(false);
      }
    }
  }, [customerContext.selectedCustomerId, isCurrentRequest]);

  const loadAccount = useCallback(
    async (account: IEvaosCompanyBrainAccountSummaryView) => {
      const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
      if (!directory || directory.routeDenied) {
        setBrainError('Action denied by account policy.');
        return;
      }
      if (!selectedCustomerId) {
        setBrainError('Choose a customer before loading Company Brain.');
        return;
      }

      const requestEpoch = accountRequestEpochRef.current + 1;
      accountRequestEpochRef.current = requestEpoch;
      activeAccountRequestRef.current = {
        epoch: requestEpoch,
        customerId: selectedCustomerId,
        accountId: account.accountId,
      };
      queryRequestEpochRef.current += 1;
      setBrainError(null);
      selectedAccountRef.current = null;
      setQueryResult(null);
      setLoadingAccountId(account.accountId);
      try {
        const response = await evaosCompanyBrain.getAccount360.invoke({
          customerId: selectedCustomerId,
          accountId: account.accountId,
        });
        if (!isCurrentAccountRequest(requestEpoch, selectedCustomerId, account.accountId)) {
          return;
        }
        if (!response.success || !response.data) {
          setSelectedAccount(null);
          selectedAccountRef.current = null;
          setBrainError(safeUiText(response.msg, 'Backend denied the Company Brain request.'));
          return;
        }
        if (
          response.data.customerId !== selectedCustomerId ||
          response.data.accountId !== account.accountId ||
          response.data.account.accountId !== account.accountId
        ) {
          setSelectedAccount(null);
          selectedAccountRef.current = null;
          setBrainError('Company Brain broker returned account evidence for the wrong customer or account.');
          return;
        }
        selectedAccountRef.current = response.data;
        setSelectedAccount(response.data);
      } catch {
        if (!isCurrentAccountRequest(requestEpoch, selectedCustomerId, account.accountId)) {
          return;
        }
        setSelectedAccount(null);
        selectedAccountRef.current = null;
        setBrainError('Backend denied the Company Brain request.');
      } finally {
        if (isCurrentAccountRequest(requestEpoch, selectedCustomerId, account.accountId)) {
          setLoadingAccountId(null);
        }
      }
    },
    [customerContext.selectedCustomerId, directory, isCurrentAccountRequest]
  );

  const askCompanyBrain = useCallback(async () => {
    const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
    const trimmedQuery = queryText.trim();
    if (!selectedAccount || selectedAccount.routeDenied) {
      setBrainError('Choose a Company Brain account before asking a question.');
      return;
    }
    if (!selectedCustomerId) {
      setBrainError('Choose a customer before querying Company Brain.');
      return;
    }
    if (!trimmedQuery) {
      setBrainError('Enter a Company Brain question.');
      return;
    }

    const accountId = selectedAccount.accountId;
    const requestEpoch = queryRequestEpochRef.current + 1;
    queryRequestEpochRef.current = requestEpoch;
    setBrainError(null);
    setQuerying(true);
    try {
      const response = await evaosCompanyBrain.query.invoke({
        customerId: selectedCustomerId,
        accountId,
        query: trimmedQuery,
      });
      if (!isCurrentQueryRequest(requestEpoch, selectedCustomerId, accountId)) {
        return;
      }
      if (!response.success || !response.data) {
        setQueryResult(null);
        setBrainError(safeUiText(response.msg, 'Backend denied the Company Brain query.'));
        return;
      }
      if (response.data.customerId !== selectedCustomerId || response.data.accountId !== accountId) {
        setQueryResult(null);
        setBrainError('Company Brain broker returned query evidence for the wrong customer or account.');
        return;
      }
      setQueryResult(response.data);
    } catch {
      if (!isCurrentQueryRequest(requestEpoch, selectedCustomerId, accountId)) {
        return;
      }
      setQueryResult(null);
      setBrainError('Backend denied the Company Brain query.');
    } finally {
      if (isCurrentQueryRequest(requestEpoch, selectedCustomerId, accountId)) {
        setQuerying(false);
      }
    }
  }, [customerContext.selectedCustomerId, isCurrentQueryRequest, queryText, selectedAccount]);

  const exceptionCount = useMemo(
    () => directory?.accounts.reduce((total, account) => total + account.exceptionCount, 0) ?? 0,
    [directory?.accounts]
  );
  const selectedCustomerLabel =
    customerContext.selectedTarget?.displayName ?? customerContext.selectedCustomerId ?? 'No customer selected';

  return (
    <div
      className={classNames(
        'w-full min-h-full box-border overflow-y-auto',
        isMobile ? 'px-16px py-14px' : 'px-12px py-24px md:px-40px md:py-32px'
      )}
    >
      <div className='mx-auto flex w-full max-w-1120px box-border flex-col gap-16px'>
        <header className='flex flex-wrap items-start justify-between gap-12px'>
          <div className='min-w-0'>
            <h1 className='m-0 text-28px leading-34px font-bold text-t-primary max-sm:text-24px'>Company Brain</h1>
            <p className='m-0 mt-4px max-w-720px text-14px leading-22px text-t-secondary'>
              Org-scoped account directory, account brief, timeline, query, and exception evidence.
            </p>
          </div>
          <Button
            type='primary'
            icon={<Refresh theme='outline' size='16' />}
            loading={loadingDirectory}
            disabled={!customerContext.selectedCustomerId}
            onClick={() => void loadDirectory()}
          >
            Refresh
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
                className='shrink-0'
                loading={loadingDirectory || customerContext.loading}
                disabled={!customerContext.selectedCustomerId}
                onClick={() => void loadDirectory()}
              >
                Load
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
            {customerContext.summaryText}. Company Brain stays scoped to the selected customer.
          </p>
          {brainError ? (
            <p className='m-0 mt-8px text-12px leading-18px text-[rgb(var(--warning-6))]'>{brainError}</p>
          ) : null}
        </section>

        {loadingDirectory ? (
          <div className='flex min-h-220px items-center justify-center rounded-8px border border-dashed border-[var(--color-border-2)] bg-fill-1'>
            <Spin />
          </div>
        ) : directory ? (
          <>
            <section className='grid grid-cols-1 gap-10px md:grid-cols-4'>
              <SummaryTile label='Status' value={directory.summaryText} />
              <SummaryTile label='Ingestion' value={directory.ingestionState} />
              <SummaryTile label='Exceptions' value={String(exceptionCount)} />
              <SummaryTile label='Audit' value={directory.auditId ?? directory.policyAuditId ?? '-'} />
            </section>

            <EvidenceMeta
              items={[
                ['Source', directory.sourcePointer],
                ['Policy audit', directory.policyAuditId],
                ['Directory audit', directory.auditId],
              ]}
            />

            {directory.routeDenied ? (
              <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
                <div className='flex items-start gap-10px text-[rgb(var(--warning-6))]'>
                  <Attention theme='outline' size='18' className='mt-2px shrink-0' />
                  <div className='min-w-0'>
                    <h2 className='m-0 text-15px font-semibold leading-22px'>Route denied</h2>
                    <p className='m-0 mt-4px text-13px leading-20px'>
                      {directory.routeDenialReason ?? 'This customer account does not allow Company Brain.'}
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            {directory.integrationHealth ? (
              <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px'>
                <div className='flex flex-wrap items-center gap-8px'>
                  <Tag color={ingestionColor(directory.integrationHealth.state)}>
                    {directory.integrationHealth.state}
                  </Tag>
                  <span className='text-13px leading-20px text-t-primary'>
                    {directory.integrationHealth.summary ?? 'No integration health summary returned.'}
                  </span>
                </div>
              </section>
            ) : null}

            <section className='grid grid-cols-1 gap-12px lg:grid-cols-[minmax(0,380px)_1fr]'>
              <article className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
                <div className='flex items-center justify-between gap-8px'>
                  <h2 className='m-0 text-17px font-semibold leading-24px text-t-primary'>Directory</h2>
                  <Tag color={ingestionColor(directory.ingestionState)}>{directory.ingestionState}</Tag>
                </div>
                {directory.accounts.length === 0 ? (
                  <p className='m-0 mt-12px text-13px leading-20px text-t-secondary'>
                    No account evidence returned for this customer.
                  </p>
                ) : (
                  <div className='mt-12px flex flex-col gap-8px'>
                    {directory.accounts.map((account) => (
                      <AccountRow
                        key={account.accountId}
                        account={account}
                        selected={selectedAccount?.accountId === account.accountId}
                        loading={loadingAccountId === account.accountId}
                        onView={() => void loadAccount(account)}
                      />
                    ))}
                  </div>
                )}
              </article>

              <article className='min-w-0 rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
                {selectedAccount ? (
                  <Account360Panel
                    account360={selectedAccount}
                    queryText={queryText}
                    queryResult={queryResult}
                    querying={querying}
                    onQueryChange={setQueryText}
                    onAsk={() => void askCompanyBrain()}
                  />
                ) : (
                  <div className='flex min-h-260px flex-col items-center justify-center text-center text-t-secondary'>
                    <Brain theme='outline' size='30' />
                    <p className='m-0 mt-10px text-13px leading-20px'>
                      Load a customer account to view Company Brain evidence.
                    </p>
                  </div>
                )}
              </article>
            </section>
          </>
        ) : (
          <div className='flex min-h-260px flex-col items-center justify-center rounded-8px border border-dashed border-[var(--color-border-2)] bg-fill-1 text-center text-t-secondary'>
            <Brain theme='outline' size='30' />
            <p className='m-0 mt-10px text-13px leading-20px'>
              Load a customer account to view Company Brain evidence.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

const SummaryTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className='min-w-0 rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px'>
    <p className='m-0 text-12px leading-18px text-t-secondary'>{label}</p>
    <p className='m-0 mt-4px break-words text-15px font-semibold leading-22px text-t-primary'>{value}</p>
  </div>
);

const EvidenceMeta: React.FC<{ items: Array<[string, string | undefined]> }> = ({ items }) => (
  <div className='flex flex-wrap gap-8px rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-10px'>
    {items.map(([label, value]) => (
      <span key={label} className='break-words text-12px leading-18px text-t-secondary'>
        {label} {safeUiText(value, '-')}
      </span>
    ))}
  </div>
);

const AccountRow: React.FC<{
  account: IEvaosCompanyBrainAccountSummaryView;
  selected: boolean;
  loading: boolean;
  onView: () => void;
}> = ({ account, selected, loading, onView }) => (
  <div
    className={classNames(
      'rounded-8px border border-solid p-12px',
      selected ? 'border-[rgb(var(--primary-6))] bg-fill-2' : 'border-[var(--color-border-2)] bg-bg-1'
    )}
  >
    <div className='flex items-start justify-between gap-10px'>
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center gap-6px'>
          <h3 className='m-0 break-words text-15px font-semibold leading-22px text-t-primary'>{account.name}</h3>
          <Tag color={ingestionColor(account.ingestionState)}>{account.ingestionState}</Tag>
        </div>
        <p className='m-0 mt-4px break-words text-12px leading-18px text-t-secondary'>
          {account.domain ?? account.owner ?? account.accountId}
        </p>
      </div>
      <Button size='small' loading={loading} onClick={onView}>
        View
      </Button>
    </div>
    <div className='mt-8px flex flex-wrap gap-8px text-12px leading-18px text-t-secondary'>
      <span>Exceptions: {account.exceptionCount}</span>
      <span>Audit: {account.auditId ?? '-'}</span>
    </div>
  </div>
);

const Account360Panel: React.FC<{
  account360: IEvaosCompanyBrainAccount360View;
  queryText: string;
  queryResult: IEvaosCompanyBrainQueryResult | null;
  querying: boolean;
  onQueryChange: (value: string) => void;
  onAsk: () => void;
}> = ({ account360, queryText, queryResult, querying, onQueryChange, onAsk }) => (
  <div className='flex min-w-0 flex-col gap-14px'>
    <div className='flex flex-wrap items-start justify-between gap-10px'>
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center gap-6px'>
          <h2 className='m-0 break-words text-18px font-semibold leading-24px text-t-primary'>
            {account360.account.name}
          </h2>
          <Tag color={ingestionColor(account360.ingestionState)}>{account360.ingestionState}</Tag>
        </div>
        <p className='m-0 mt-4px break-words text-13px leading-20px text-t-secondary'>
          Audit {account360.auditId ?? account360.policyAuditId ?? '-'}
        </p>
        <p className='m-0 mt-2px break-words text-12px leading-18px text-t-secondary'>
          Source {safeUiText(account360.sourcePointer, '-')}
        </p>
      </div>
    </div>

    <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-bg-1 p-12px'>
      <h3 className='m-0 text-15px font-semibold leading-22px text-t-primary'>
        {account360.brief?.title ?? 'No account brief returned'}
      </h3>
      <p className='m-0 mt-6px whitespace-pre-wrap text-13px leading-20px text-t-secondary'>
        {account360.brief?.summary ?? 'No brief summary returned.'}
      </p>
      <p className='m-0 mt-6px break-words text-12px leading-18px text-t-secondary'>
        Brief source {safeUiText(account360.brief?.sourcePointer, '-')}
      </p>
    </section>

    <section className='grid grid-cols-1 gap-12px lg:grid-cols-2'>
      <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-bg-1 p-12px'>
        <h3 className='m-0 text-15px font-semibold leading-22px text-t-primary'>Timeline</h3>
        {account360.timeline.length === 0 ? (
          <p className='m-0 mt-8px text-13px leading-20px text-t-secondary'>No timeline events returned.</p>
        ) : (
          <div className='mt-10px flex flex-col gap-10px'>
            {account360.timeline.map((entry) => (
              <div key={entry.entryId} className='border-0 border-t border-solid border-[var(--color-border-2)] pt-8px'>
                <p className='m-0 text-13px font-semibold leading-20px text-t-primary'>{entry.title}</p>
                <p className='m-0 mt-3px text-12px leading-18px text-t-secondary'>
                  {entry.summary ?? entry.occurredAt ?? entry.type}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-bg-1 p-12px'>
        <h3 className='m-0 text-15px font-semibold leading-22px text-t-primary'>Exceptions</h3>
        {account360.exceptions.length === 0 ? (
          <p className='m-0 mt-8px text-13px leading-20px text-t-secondary'>No exception evidence returned.</p>
        ) : (
          <div className='mt-10px flex flex-col gap-10px'>
            {account360.exceptions.map((exception) => (
              <div
                key={exception.exceptionId}
                className='border-0 border-t border-solid border-[var(--color-border-2)] pt-8px'
              >
                <div className='flex flex-wrap items-center gap-6px'>
                  <Tag color={severityColor(exception.severity)}>{exception.severity}</Tag>
                  <p className='m-0 text-13px font-semibold leading-20px text-t-primary'>{exception.title}</p>
                </div>
                <p className='m-0 mt-3px text-12px leading-18px text-t-secondary'>
                  {exception.summary ?? exception.status}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>

    <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-bg-1 p-12px'>
      <label className='block text-13px font-medium leading-20px text-t-primary' htmlFor='company-brain-query'>
        Ask Company Brain
      </label>
      <div className='mt-8px flex gap-8px max-[620px]:flex-col'>
        <Input.TextArea
          id='company-brain-query'
          value={queryText}
          autoSize={{ minRows: 1, maxRows: 4 }}
          placeholder='Question about this account'
          onChange={onQueryChange}
        />
        <Button
          className='shrink-0'
          type='primary'
          icon={<Search theme='outline' size='15' />}
          aria-busy={querying}
          onClick={onAsk}
        >
          Ask
        </Button>
      </div>
      {queryResult ? (
        <div className='mt-12px rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px'>
          <div className='flex flex-wrap items-center gap-8px'>
            <Tag color='green'>{queryResult.status}</Tag>
            <span className='text-12px leading-18px text-t-secondary'>Audit {queryResult.auditId ?? '-'}</span>
            <span className='text-12px leading-18px text-t-secondary'>
              Source {safeUiText(queryResult.sourcePointer, '-')}
            </span>
          </div>
          <p className='m-0 mt-8px whitespace-pre-wrap text-13px leading-20px text-t-primary'>
            {queryResult.answer ?? 'No answer returned.'}
          </p>
          {queryResult.citations.length > 0 ? (
            <div className='mt-10px flex flex-wrap gap-6px'>
              {queryResult.citations.map((citation) => (
                <Tag key={citation.citationId}>{citation.title ?? citation.citationId}</Tag>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  </div>
);

export default CompanyBrainPage;
