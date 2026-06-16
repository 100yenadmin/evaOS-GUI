/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { Button, Spin, Tag } from '@arco-design/web-react';
import { Attention, LinkCloud, Refresh, Shield, Success } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useEvaosBrokeredCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { safeEvaosUiText } from '@renderer/utils/evaosSafeText';
import {
  evaosProviderHub,
  type IEvaosCustomerTargetView,
  type IEvaosProviderActionResult,
  type IEvaosProviderHubView,
  type IEvaosProviderKey,
  type IEvaosProviderProfileView,
  type IEvaosProviderStatus,
} from '@/common/adapter/ipcBridge';

type ProviderAction = 'startAuth' | 'switchProvider' | 'revokeProvider' | 'mintGrant' | 'requestApproval';

function statusColor(status: IEvaosProviderStatus): 'green' | 'orange' | 'red' | 'gray' | 'blue' {
  if (status === 'connected') return 'green';
  if (status === 'needs_login' || status === 'approval_required') return 'orange';
  if (status === 'error' || status === 'expired') return 'red';
  if (status === 'planned') return 'blue';
  return 'gray';
}

function targetKey(target: Pick<IEvaosCustomerTargetView, 'customerId' | 'customerAccountId'>): string {
  return `${target.customerId}:${target.customerAccountId ?? 'none'}`;
}

function sameAccount(expected?: string, actual?: string): boolean {
  return !expected || expected === actual;
}

function isSelectedTarget(
  target: Pick<IEvaosCustomerTargetView, 'customerId' | 'customerAccountId'>,
  selectedCustomerId?: string,
  selectedCustomerAccountId?: string
): boolean {
  return target.customerId === selectedCustomerId && target.customerAccountId === selectedCustomerAccountId;
}

function providerStatusLabel(t: ReturnType<typeof useTranslation>['t'], status: IEvaosProviderStatus): string {
  return t(`evaos.connectedApps.status.${status}`);
}

const ConnectedAppsPage: React.FC = () => {
  const { t } = useTranslation();
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
  const selectedCustomerAccountRef = useRef<string | undefined>(customerContext.selectedTarget?.customerAccountId);
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
    selectedCustomerAccountRef.current = customerContext.selectedTarget?.customerAccountId;
    requestEpochRef.current += 1;
    clearHubEvidence();
  }, [clearHubEvidence, customerContext.selectedCustomerId, customerContext.selectedTarget?.customerAccountId]);

  const isCurrentRequest = useCallback((epoch: number, customerId: string, customerAccountId?: string) => {
    return (
      requestEpochRef.current === epoch &&
      selectedCustomerRef.current === customerId &&
      selectedCustomerAccountRef.current === customerAccountId
    );
  }, []);

  const customerAccountIdForCustomer = useCallback(
    (customerId: string, preferredAccountId?: string) =>
      preferredAccountId ??
      (selectedCustomerRef.current === customerId ? selectedCustomerAccountRef.current : undefined) ??
      customerContext.targets.find((target) => target.customerId === customerId && target.customerAccountId)
        ?.customerAccountId ??
      (customerContext.selectedTarget?.customerId === customerId
        ? customerContext.selectedTarget.customerAccountId
        : undefined),
    [customerContext.selectedTarget, customerContext.targets]
  );

  const selectCustomer = useCallback(
    (target: IEvaosCustomerTargetView) => {
      const customerId = target.customerId;
      selectedCustomerRef.current = customerId;
      selectedCustomerAccountRef.current = customerAccountIdForCustomer(customerId, target.customerAccountId);
      requestEpochRef.current += 1;
      customerContext.selectCustomer(customerId);
      clearHubEvidence();
    },
    [clearHubEvidence, customerAccountIdForCustomer, customerContext]
  );

  const refreshCustomerTargets = useCallback(async () => {
    requestEpochRef.current += 1;
    selectedCustomerRef.current = undefined;
    selectedCustomerAccountRef.current = undefined;
    clearHubEvidence();
    await customerContext.refreshTargets();
  }, [clearHubEvidence, customerContext]);

  const loadHub = useCallback(
    async (options: { preserveActionStatus?: boolean } = {}) => {
      const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
      const customerAccountId = selectedCustomerId
        ? customerAccountIdForCustomer(selectedCustomerId, selectedCustomerAccountRef.current)
        : undefined;
      if (!options.preserveActionStatus) {
        setActionStatus(null);
        setActionError(null);
      }
      if (!selectedCustomerId) {
        setHub(null);
        setHubError(t('evaos.connectedApps.chooseCustomer'));
        return;
      }

      const requestEpoch = requestEpochRef.current + 1;
      requestEpochRef.current = requestEpoch;
      selectedCustomerRef.current = selectedCustomerId;
      selectedCustomerAccountRef.current = customerAccountId;
      setLoadingHub(true);
      setHubError(null);
      try {
        const response = await evaosProviderHub.getProfiles.invoke({
          customerId: selectedCustomerId,
          customerAccountId,
        });
        if (!isCurrentRequest(requestEpoch, selectedCustomerId, customerAccountId)) {
          return;
        }
        if (!response.success || !response.data) {
          setHub(null);
          setHubError(safeEvaosUiText(response.msg, t('evaos.connectedApps.failedClosed')));
          return;
        }
        if (response.data.customerId !== selectedCustomerId) {
          setHub(null);
          setHubError(t('evaos.connectedApps.differentCustomer'));
          return;
        }
        if (!sameAccount(customerAccountId, response.data.customerAccountId)) {
          setHub(null);
          setHubError(t('evaos.connectedApps.differentAccount'));
          return;
        }
        setHub(response.data);
      } catch {
        if (!isCurrentRequest(requestEpoch, selectedCustomerId, customerAccountId)) {
          return;
        }
        setHub(null);
        setHubError(t('evaos.connectedApps.requestFailed'));
      } finally {
        if (isCurrentRequest(requestEpoch, selectedCustomerId, customerAccountId)) {
          setLoadingHub(false);
        }
      }
    },
    [customerAccountIdForCustomer, customerContext.selectedCustomerId, isCurrentRequest, t]
  );

  const runProviderAction = useCallback(
    async (profile: IEvaosProviderProfileView, action: ProviderAction) => {
      const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
      const expectedCustomerAccountId = hub?.customerAccountId ?? selectedCustomerAccountRef.current;
      const isSameSelection = () =>
        selectedCustomerRef.current === selectedCustomerId &&
        selectedCustomerAccountRef.current === expectedCustomerAccountId;
      setActionStatus(null);
      setActionError(null);
      if (
        !hub ||
        hub.routeDenied ||
        !selectedCustomerId ||
        hub.customerId !== selectedCustomerId ||
        !sameAccount(expectedCustomerAccountId, hub.customerAccountId)
      ) {
        setActionError(t('evaos.connectedApps.actionDenied'));
        return;
      }

      setActionProviderKey(profile.providerKey);
      try {
        const request = {
          customerId: selectedCustomerId,
          customerAccountId: expectedCustomerAccountId,
          providerKey: profile.providerKey,
        };
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

        if (!isSameSelection()) {
          return;
        }
        if (!response.success || !response.data) {
          setActionError(safeEvaosUiText(response.msg, t('evaos.connectedApps.actionFailed')));
          return;
        }
        setActionStatus(
          safeEvaosUiText(
            response.data.message,
            t('evaos.connectedApps.providerUpdated', { providerKey: response.data.providerKey })
          )
        );
        if (
          response.data.providerHub?.customerId === selectedCustomerId &&
          sameAccount(expectedCustomerAccountId, response.data.providerHub.customerAccountId)
        ) {
          setHub(response.data.providerHub);
        } else {
          await loadHub({ preserveActionStatus: true });
        }
      } catch {
        if (isSameSelection()) {
          setActionError(t('evaos.connectedApps.actionFailed'));
        }
      } finally {
        if (isSameSelection()) {
          setActionProviderKey(null);
        }
      }
    },
    [customerContext.selectedCustomerId, hub, loadHub, t]
  );

  const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
  const selectedCustomerAccountId =
    selectedCustomerAccountRef.current ?? customerContext.selectedTarget?.customerAccountId;
  const selectedTarget =
    customerContext.targets.find((target) => isSelectedTarget(target, selectedCustomerId, selectedCustomerAccountId)) ??
    customerContext.selectedTarget;
  const selectedCustomerLabel = safeEvaosUiText(
    selectedTarget?.displayName,
    selectedCustomerId ?? t('evaos.connectedApps.noCustomerSelected')
  );

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
              {t('evaos.connectedApps.title')}
            </h1>
            <p className='m-0 mt-4px max-w-720px text-14px leading-22px text-t-secondary'>
              {t('evaos.connectedApps.description')}
            </p>
          </div>
          <Button
            type='primary'
            icon={<Refresh theme='outline' size='16' />}
            loading={loadingHub}
            disabled={!customerContext.selectedCustomerId}
            onClick={() => void loadHub()}
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
                loading={loadingHub || customerContext.loading}
                disabled={!customerContext.selectedCustomerId}
                onClick={() => void loadHub()}
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
                  t('evaos.connectedApps.failedClosed')
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
            {t('evaos.connectedApps.scopedSummary', {
              summary: safeEvaosUiText(customerContext.summaryText, t('evaos.shared.unknown')),
            })}
          </p>
          {hubError ? (
            <p className='m-0 mt-8px text-12px leading-18px text-[rgb(var(--warning-6))]'>{hubError}</p>
          ) : null}
        </section>

        {loadingHub ? (
          <div className='flex min-h-180px items-center justify-center rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1'>
            <Spin tip={t('evaos.connectedApps.loading')} />
          </div>
        ) : null}

        {hub ? (
          <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'>
            <div className='flex flex-wrap items-center justify-between gap-10px'>
              <div className='min-w-0'>
                <div className='flex flex-wrap items-center gap-8px'>
                  <h2 className='m-0 text-18px leading-24px font-semibold text-t-primary'>
                    {t('evaos.connectedApps.providerAccess')}
                  </h2>
                  <Tag color={hub.routeDenied ? 'orange' : 'green'}>
                    {hub.routeDenied ? t('evaos.shared.routeDenied') : t('evaos.shared.brokerPolicyActive')}
                  </Tag>
                  <Tag color={hub.backendEnforced ? 'green' : 'orange'}>
                    {hub.backendEnforced ? t('evaos.shared.backendEnforced') : t('evaos.shared.needsBackendProof')}
                  </Tag>
                </div>
                <p className='m-0 mt-6px text-13px leading-20px text-t-secondary'>
                  {safeEvaosUiText(hub.summaryText, t('evaos.connectedApps.providerProfilesLoaded'))}
                </p>
              </div>
              {hub.auditId || hub.policyAuditId ? (
                <div className='text-12px leading-18px text-t-secondary'>
                  {t('evaos.shared.audit', {
                    auditId: safeEvaosUiText(hub.auditId ?? hub.policyAuditId, t('evaos.shared.available')),
                  })}
                </div>
              ) : null}
            </div>

            {hub.routeDenied ? (
              <div className='mt-14px rounded-8px border border-solid border-[rgb(var(--warning-6))] bg-[rgb(var(--warning-1))] p-14px text-13px leading-20px text-t-primary'>
                {safeEvaosUiText(hub.routeDenialReason, t('evaos.connectedApps.denied'))}
              </div>
            ) : null}

            {actionStatus ? (
              <p className='m-0 mt-12px text-13px leading-20px text-[rgb(var(--success-6))]'>{actionStatus}</p>
            ) : null}
            {actionError ? (
              <p className='m-0 mt-12px text-13px leading-20px text-[rgb(var(--warning-6))]'>{actionError}</p>
            ) : null}

            {!hub.routeDenied ? (
              <div className='mt-14px grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-12px'>
                {hub.profiles.length === 0 ? (
                  <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px text-13px leading-20px text-t-secondary'>
                    {t('evaos.connectedApps.emptyProfiles')}
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
                            {safeEvaosUiText(profile.title, profile.providerKey)}
                          </h3>
                          <p className='m-0 mt-3px text-12px leading-18px text-t-secondary'>
                            {safeEvaosUiText(profile.subtitle, profile.summaryText)}
                          </p>
                        </div>
                        <Tag color={statusColor(profile.status)}>{providerStatusLabel(t, profile.status)}</Tag>
                      </div>
                      <div className='mt-10px flex flex-wrap gap-6px'>
                        {profile.active ? (
                          <Tag color='green' icon={<Success theme='outline' size='12' />}>
                            {t('evaos.connectedApps.active')}
                          </Tag>
                        ) : null}
                        {profile.approvalRequired ? (
                          <Tag color='orange' icon={<Shield theme='outline' size='12' />}>
                            {t('evaos.connectedApps.approvalRequired')}
                          </Tag>
                        ) : null}
                        {profile.hasBrokeredGrant ? (
                          <Tag color='green'>{t('evaos.connectedApps.brokeredGrant')}</Tag>
                        ) : null}
                        {profile.rawSecretsStoredInWorkbench ? (
                          <Tag color='red' icon={<Attention theme='outline' size='12' />}>
                            {t('evaos.connectedApps.unsafeSecretState')}
                          </Tag>
                        ) : (
                          <Tag color='gray'>{t('evaos.connectedApps.noWorkbenchSecrets')}</Tag>
                        )}
                      </div>
                      <p className='m-0 mt-10px text-12px leading-18px text-t-secondary'>
                        {safeEvaosUiText(profile.usageSummary, profile.summaryText)}
                      </p>
                      {profile.capabilities.length > 0 ? (
                        <div className='mt-10px flex flex-wrap gap-6px'>
                          {profile.capabilities.slice(0, 5).map((capability) => (
                            <Tag key={capability} color='gray'>
                              {safeEvaosUiText(capability, t('evaos.connectedApps.capability'))}
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
                            {t('evaos.connectedApps.connect')}
                          </Button>
                        ) : !profile.active ? (
                          <Button
                            size='small'
                            type='primary'
                            loading={actionProviderKey === profile.providerKey}
                            onClick={() => void runProviderAction(profile, 'switchProvider')}
                          >
                            {t('evaos.connectedApps.makeActive')}
                          </Button>
                        ) : null}
                        {profile.status === 'connected' && !profile.hasBrokeredGrant && !profile.approvalRequired ? (
                          <Button
                            size='small'
                            loading={actionProviderKey === profile.providerKey}
                            onClick={() => void runProviderAction(profile, 'mintGrant')}
                          >
                            {t('evaos.connectedApps.grantToAgents')}
                          </Button>
                        ) : null}
                        {profile.approvalRequired ? (
                          <Button
                            size='small'
                            loading={actionProviderKey === profile.providerKey}
                            onClick={() => void runProviderAction(profile, 'requestApproval')}
                          >
                            {t('evaos.connectedApps.requestApproval')}
                          </Button>
                        ) : null}
                        {profile.status === 'connected' ? (
                          <Button
                            size='small'
                            status='danger'
                            loading={actionProviderKey === profile.providerKey}
                            onClick={() => void runProviderAction(profile, 'revokeProvider')}
                          >
                            {t('evaos.connectedApps.revoke')}
                          </Button>
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
};

export default ConnectedAppsPage;
