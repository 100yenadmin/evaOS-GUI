/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { Button, Spin, Tag } from '@arco-design/web-react';
import { Attention, LinkCloud, Refresh, Shield, Success } from '@icon-park/react';
import { useEvaosBrokeredCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import {
  evaosProviderHub,
  type IEvaosProviderActionResult,
  type IEvaosProviderHubView,
  type IEvaosProviderKey,
  type IEvaosProviderProfileView,
  type IEvaosProviderStatus,
} from '@/common/adapter/ipcBridge';

const SECRET_TEXT_PATTERN =
  /\b(?:eds|epg)_[A-Za-z0-9_-]{4,}\b|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|grant[_-]?handle|authorization|bearer|secret|password/i;

type ProviderAction = 'startAuth' | 'switchProvider' | 'revokeProvider' | 'mintGrant' | 'requestApproval';

function safeUiText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
}

function statusColor(status: IEvaosProviderStatus): 'green' | 'orange' | 'red' | 'gray' | 'blue' {
  if (status === 'connected') return 'green';
  if (status === 'needs_login' || status === 'approval_required') return 'orange';
  if (status === 'error' || status === 'expired') return 'red';
  if (status === 'planned') return 'blue';
  return 'gray';
}

function actionMessage(result: IEvaosProviderActionResult): string {
  return safeUiText(result.message, `${result.providerKey} updated.`);
}

const ConnectedAppsPage: React.FC = () => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [hub, setHub] = useState<IEvaosProviderHubView | null>(null);
  const [hubError, setHubError] = useState<string | null>(null);
  const [loadingHub, setLoadingHub] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionProviderKey, setActionProviderKey] = useState<IEvaosProviderKey | null>(null);
  const { customerContext } = useEvaosBrokeredCustomerContext();
  const selectedCustomerRef = useRef<string | undefined>(customerContext.selectedCustomerId);
  const requestEpochRef = useRef(0);

  const clearHubEvidence = useCallback(() => {
    setHub(null);
    setHubError(null);
    setActionStatus(null);
    setActionError(null);
    setActionProviderKey(null);
    setLoadingHub(false);
  }, []);

  useEffect(() => {
    selectedCustomerRef.current = customerContext.selectedCustomerId;
    requestEpochRef.current += 1;
    clearHubEvidence();
  }, [clearHubEvidence, customerContext.selectedCustomerId]);

  const isCurrentRequest = useCallback((epoch: number, customerId: string) => {
    return requestEpochRef.current === epoch && selectedCustomerRef.current === customerId;
  }, []);

  const selectCustomer = useCallback(
    (customerId: string) => {
      selectedCustomerRef.current = customerId;
      requestEpochRef.current += 1;
      customerContext.selectCustomer(customerId);
      clearHubEvidence();
    },
    [clearHubEvidence, customerContext]
  );

  const refreshCustomerTargets = useCallback(async () => {
    requestEpochRef.current += 1;
    selectedCustomerRef.current = undefined;
    clearHubEvidence();
    await customerContext.refreshTargets();
  }, [clearHubEvidence, customerContext]);

  const loadHub = useCallback(
    async (options: { preserveActionStatus?: boolean } = {}) => {
      const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
      if (!options.preserveActionStatus) {
        setActionStatus(null);
        setActionError(null);
      }
      if (!selectedCustomerId) {
        setHub(null);
        setHubError('Choose a customer before loading Connected Apps.');
        return;
      }

      const requestEpoch = requestEpochRef.current + 1;
      requestEpochRef.current = requestEpoch;
      selectedCustomerRef.current = selectedCustomerId;
      setLoadingHub(true);
      setHubError(null);
      try {
        const response = await evaosProviderHub.getProfiles.invoke({ customerId: selectedCustomerId });
        if (!isCurrentRequest(requestEpoch, selectedCustomerId)) {
          return;
        }
        if (!response.success || !response.data) {
          setHub(null);
          setHubError(safeUiText(response.msg, 'Connected Apps failed closed.'));
          return;
        }
        if (response.data.customerId !== selectedCustomerId) {
          setHub(null);
          setHubError('Connected Apps broker returned evidence for a different customer.');
          return;
        }
        setHub(response.data);
      } catch {
        if (!isCurrentRequest(requestEpoch, selectedCustomerId)) {
          return;
        }
        setHub(null);
        setHubError('Connected Apps broker request failed closed.');
      } finally {
        if (isCurrentRequest(requestEpoch, selectedCustomerId)) {
          setLoadingHub(false);
        }
      }
    },
    [customerContext.selectedCustomerId, isCurrentRequest]
  );

  const runProviderAction = useCallback(
    async (profile: IEvaosProviderProfileView, action: ProviderAction) => {
      const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
      setActionStatus(null);
      setActionError(null);
      if (!hub || hub.routeDenied || !selectedCustomerId || hub.customerId !== selectedCustomerId) {
        setActionError('Action denied by account policy.');
        return;
      }

      setActionProviderKey(profile.providerKey);
      try {
        const request = { customerId: selectedCustomerId, providerKey: profile.providerKey };
        const response =
          action === 'startAuth'
            ? await evaosProviderHub.startAuth.invoke(request)
            : action === 'switchProvider'
              ? await evaosProviderHub.switchProvider.invoke(request)
              : action === 'revokeProvider'
                ? await evaosProviderHub.revokeProvider.invoke(request)
                : action === 'mintGrant'
                  ? await evaosProviderHub.mintGrant.invoke(request)
                  : await evaosProviderHub.requestApproval.invoke({
                      ...request,
                      requestedAction: 'provider_mint_grant',
                    });

        if (selectedCustomerRef.current !== selectedCustomerId) {
          return;
        }
        if (!response.success || !response.data) {
          setActionError(safeUiText(response.msg, 'Connected Apps action failed closed.'));
          return;
        }
        setActionStatus(actionMessage(response.data));
        if (response.data.providerHub?.customerId === selectedCustomerId) {
          setHub(response.data.providerHub);
        } else {
          await loadHub({ preserveActionStatus: true });
        }
      } catch {
        if (selectedCustomerRef.current === selectedCustomerId) {
          setActionError('Connected Apps action failed closed.');
        }
      } finally {
        if (selectedCustomerRef.current === selectedCustomerId) {
          setActionProviderKey(null);
        }
      }
    },
    [customerContext.selectedCustomerId, hub, loadHub]
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
      <div className='mx-auto flex w-full max-w-1080px box-border flex-col gap-16px'>
        <header className='flex flex-wrap items-start justify-between gap-12px'>
          <div className='min-w-0'>
            <h1 className='m-0 text-28px leading-34px font-bold text-t-primary max-sm:text-24px'>Connected Apps</h1>
            <p className='m-0 mt-4px max-w-720px text-14px leading-22px text-t-secondary'>
              Connect and review provider access for the selected evaOS customer account.
            </p>
          </div>
          <Button
            type='primary'
            icon={<Refresh theme='outline' size='16' />}
            loading={loadingHub}
            disabled={!customerContext.selectedCustomerId}
            onClick={() => void loadHub()}
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
                loading={loadingHub || customerContext.loading}
                disabled={!customerContext.selectedCustomerId}
                onClick={() => void loadHub()}
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
            {customerContext.summaryText}. Connected Apps stays scoped to the selected customer.
          </p>
          {hubError ? (
            <p className='m-0 mt-8px text-12px leading-18px text-[rgb(var(--warning-6))]'>{hubError}</p>
          ) : null}
        </section>

        {loadingHub ? (
          <div className='flex min-h-180px items-center justify-center rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1'>
            <Spin tip='Loading Connected Apps...' />
          </div>
        ) : null}

        {hub ? (
          <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'>
            <div className='flex flex-wrap items-center justify-between gap-10px'>
              <div className='min-w-0'>
                <div className='flex flex-wrap items-center gap-8px'>
                  <h2 className='m-0 text-18px leading-24px font-semibold text-t-primary'>Provider access</h2>
                  <Tag color={hub.routeDenied ? 'orange' : 'green'}>
                    {hub.routeDenied ? 'Route denied' : 'Broker policy active'}
                  </Tag>
                  <Tag color={hub.backendEnforced ? 'green' : 'orange'}>
                    {hub.backendEnforced ? 'Backend enforced' : 'Needs backend proof'}
                  </Tag>
                </div>
                <p className='m-0 mt-6px text-13px leading-20px text-t-secondary'>
                  {safeUiText(hub.summaryText, 'Provider profiles loaded.')}
                </p>
              </div>
              {hub.auditId || hub.policyAuditId ? (
                <div className='text-12px leading-18px text-t-secondary'>
                  Audit {safeUiText(hub.auditId ?? hub.policyAuditId, 'available')}
                </div>
              ) : null}
            </div>

            {hub.routeDenied ? (
              <div className='mt-14px rounded-8px border border-solid border-[rgb(var(--warning-6))] bg-[rgb(var(--warning-1))] p-14px text-13px leading-20px text-t-primary'>
                {safeUiText(hub.routeDenialReason, 'Connected Apps is denied for this customer account.')}
              </div>
            ) : null}

            {actionStatus ? (
              <p className='m-0 mt-12px text-13px leading-20px text-[rgb(var(--success-6))]'>{actionStatus}</p>
            ) : null}
            {actionError ? (
              <p className='m-0 mt-12px text-13px leading-20px text-[rgb(var(--warning-6))]'>{actionError}</p>
            ) : null}

            <div className='mt-14px grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-12px'>
              {hub.profiles.length === 0 ? (
                <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px text-13px leading-20px text-t-secondary'>
                  No provider profiles returned for this customer.
                </div>
              ) : (
                hub.profiles.map((profile) => (
                  <article
                    key={profile.providerKey}
                    className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px'
                  >
                    <div className='flex items-start justify-between gap-10px'>
                      <div className='min-w-0'>
                        <h3 className='m-0 text-15px leading-22px font-semibold text-t-primary'>
                          {safeUiText(profile.title, profile.providerKey)}
                        </h3>
                        <p className='m-0 mt-3px text-12px leading-18px text-t-secondary'>
                          {safeUiText(profile.subtitle, profile.summaryText)}
                        </p>
                      </div>
                      <Tag color={statusColor(profile.status)}>{profile.status.replace(/_/g, ' ')}</Tag>
                    </div>
                    <div className='mt-10px flex flex-wrap gap-6px'>
                      {profile.active ? (
                        <Tag color='green' icon={<Success theme='outline' size='12' />}>
                          Active
                        </Tag>
                      ) : null}
                      {profile.approvalRequired ? (
                        <Tag color='orange' icon={<Shield theme='outline' size='12' />}>
                          Approval required
                        </Tag>
                      ) : null}
                      {profile.hasBrokeredGrant ? <Tag color='green'>Brokered grant</Tag> : null}
                      {profile.rawSecretsStoredInWorkbench ? (
                        <Tag color='red' icon={<Attention theme='outline' size='12' />}>
                          Unsafe secret state
                        </Tag>
                      ) : (
                        <Tag color='gray'>No Workbench secrets</Tag>
                      )}
                    </div>
                    <p className='m-0 mt-10px text-12px leading-18px text-t-secondary'>
                      {safeUiText(profile.usageSummary, profile.summaryText)}
                    </p>
                    {profile.capabilities.length > 0 ? (
                      <div className='mt-10px flex flex-wrap gap-6px'>
                        {profile.capabilities.slice(0, 5).map((capability) => (
                          <Tag key={capability} color='gray'>
                            {safeUiText(capability, 'capability')}
                          </Tag>
                        ))}
                      </div>
                    ) : null}
                    <div className='mt-12px flex flex-wrap gap-8px'>
                      {profile.status !== 'connected' ? (
                        <Button
                          size='small'
                          icon={<LinkCloud theme='outline' size='14' />}
                          loading={actionProviderKey === profile.providerKey}
                          onClick={() => void runProviderAction(profile, 'startAuth')}
                        >
                          Connect
                        </Button>
                      ) : !profile.active ? (
                        <Button
                          size='small'
                          type='primary'
                          loading={actionProviderKey === profile.providerKey}
                          onClick={() => void runProviderAction(profile, 'switchProvider')}
                        >
                          Make active
                        </Button>
                      ) : null}
                      {profile.status === 'connected' && !profile.hasBrokeredGrant && !profile.approvalRequired ? (
                        <Button
                          size='small'
                          loading={actionProviderKey === profile.providerKey}
                          onClick={() => void runProviderAction(profile, 'mintGrant')}
                        >
                          Grant to agents
                        </Button>
                      ) : null}
                      {profile.approvalRequired ? (
                        <Button
                          size='small'
                          loading={actionProviderKey === profile.providerKey}
                          onClick={() => void runProviderAction(profile, 'requestApproval')}
                        >
                          Request approval
                        </Button>
                      ) : null}
                      {profile.status === 'connected' ? (
                        <Button
                          size='small'
                          status='danger'
                          loading={actionProviderKey === profile.providerKey}
                          onClick={() => void runProviderAction(profile, 'revokeProvider')}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
};

export default ConnectedAppsPage;
