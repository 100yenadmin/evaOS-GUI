/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { Button, Input, Select, Spin, Tag } from '@arco-design/web-react';
import { AddUser, Peoples, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useEvaosBrokeredCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { safeEvaosUiText } from '@renderer/utils/evaosSafeText';
import {
  evaosPeopleAccess,
  type IEvaosAccountPolicyRole,
  type IEvaosCustomerTargetView,
  type IEvaosPeopleAccessInviteView,
  type IEvaosPeopleAccessMemberView,
  type IEvaosPeopleAccessPolicyView,
} from '@/common/adapter/ipcBridge';

const INVITE_ROLES: IEvaosAccountPolicyRole[] = [
  'member',
  'manager',
  'support',
  'agent_only',
  'employee',
  'technical_admin',
  'billing_admin',
  'admin',
];

const ROLE_LABEL_KEYS: Record<IEvaosAccountPolicyRole, string> = {
  owner: 'evaos.peopleAccess.roles.owner',
  admin: 'evaos.peopleAccess.roles.admin',
  billing_admin: 'evaos.peopleAccess.roles.billingAdmin',
  technical_admin: 'evaos.peopleAccess.roles.technicalAdmin',
  employee: 'evaos.peopleAccess.roles.employee',
  manager: 'evaos.peopleAccess.roles.manager',
  member: 'evaos.peopleAccess.roles.member',
  agent_only: 'evaos.peopleAccess.roles.agentOnly',
  support: 'evaos.peopleAccess.roles.support',
};

const PEOPLE_ACCESS_STATUS_KEYS: Record<string, string> = {
  accepted: 'evaos.peopleAccess.status.accepted',
  active: 'evaos.peopleAccess.status.active',
  disabled: 'evaos.peopleAccess.status.disabled',
  expired: 'evaos.peopleAccess.status.expired',
  invited: 'evaos.peopleAccess.status.invited',
  pending: 'evaos.peopleAccess.status.pending',
  revoked: 'evaos.peopleAccess.status.revoked',
};

function roleLabel(t: ReturnType<typeof useTranslation>['t'], role: IEvaosAccountPolicyRole): string {
  return t(ROLE_LABEL_KEYS[role]);
}

function statusLabel(t: ReturnType<typeof useTranslation>['t'], status: string): string {
  return PEOPLE_ACCESS_STATUS_KEYS[status.toLowerCase()]
    ? t(PEOPLE_ACCESS_STATUS_KEYS[status.toLowerCase()])
    : safeEvaosUiText(status, t('evaos.shared.unknown'));
}

function statusColor(status: string): 'green' | 'orange' | 'red' | 'gray' {
  const normalized = status.toLowerCase();
  if (normalized === 'active' || normalized === 'accepted') return 'green';
  if (normalized === 'pending' || normalized === 'invited') return 'orange';
  if (normalized === 'revoked' || normalized === 'expired' || normalized === 'disabled') return 'red';
  return 'gray';
}

function targetKey(target: Pick<IEvaosCustomerTargetView, 'customerId' | 'customerAccountId'>): string {
  return `${target.customerId}:${target.customerAccountId ?? 'none'}`;
}

function memberLabel(member: IEvaosPeopleAccessMemberView): string {
  return safeEvaosUiText(member.displayName, safeEvaosUiText(member.email, member.memberId));
}

function inviteLabel(invite: IEvaosPeopleAccessInviteView): string {
  return safeEvaosUiText(invite.email, invite.inviteId);
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

const PeopleAccessPage: React.FC = () => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [policy, setPolicy] = useState<IEvaosPeopleAccessPolicyView | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [loadingPolicy, setLoadingPolicy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<IEvaosAccountPolicyRole>('member');
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const { customerContext } = useEvaosBrokeredCustomerContext();
  const selectedCustomerRef = useRef<string | undefined>(customerContext.selectedCustomerId);
  const selectedCustomerAccountRef = useRef<string | undefined>(customerContext.selectedTarget?.customerAccountId);
  const requestEpochRef = useRef(0);

  const clearPolicyEvidence = useCallback(() => {
    setPolicy(null);
    setPolicyError(null);
    setInviteStatus(null);
    setInviteError(null);
    setInviting(false);
    setLoadingPolicy(false);
  }, []);

  useEffect(() => {
    selectedCustomerRef.current = customerContext.selectedCustomerId;
    selectedCustomerAccountRef.current = customerContext.selectedTarget?.customerAccountId;
    requestEpochRef.current += 1;
    clearPolicyEvidence();
  }, [clearPolicyEvidence, customerContext.selectedCustomerId, customerContext.selectedTarget?.customerAccountId]);

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
      clearPolicyEvidence();
    },
    [clearPolicyEvidence, customerAccountIdForCustomer, customerContext]
  );

  const refreshCustomerTargets = useCallback(async () => {
    requestEpochRef.current += 1;
    selectedCustomerRef.current = undefined;
    selectedCustomerAccountRef.current = undefined;
    clearPolicyEvidence();
    await customerContext.refreshTargets();
  }, [clearPolicyEvidence, customerContext]);

  const loadPolicy = useCallback(
    async (options: { preserveInviteStatus?: boolean } = {}) => {
      const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
      const customerAccountId = selectedCustomerId
        ? customerAccountIdForCustomer(selectedCustomerId, selectedCustomerAccountRef.current)
        : undefined;
      if (!options.preserveInviteStatus) {
        setInviteStatus(null);
        setInviteError(null);
      }
      if (!selectedCustomerId) {
        setPolicy(null);
        setPolicyError(t('evaos.peopleAccess.chooseCustomer'));
        return;
      }

      const requestEpoch = requestEpochRef.current + 1;
      requestEpochRef.current = requestEpoch;
      selectedCustomerRef.current = selectedCustomerId;
      selectedCustomerAccountRef.current = customerAccountId;
      setLoadingPolicy(true);
      setPolicyError(null);
      try {
        const response = await evaosPeopleAccess.getPolicy.invoke({
          customerId: selectedCustomerId,
          customerAccountId,
        });
        if (!isCurrentRequest(requestEpoch, selectedCustomerId, customerAccountId)) {
          return;
        }
        if (!response.success || !response.data) {
          setPolicy(null);
          setPolicyError(safeEvaosUiText(response.msg, t('evaos.peopleAccess.failedClosed')));
          return;
        }
        if (response.data.selectedCustomerId !== selectedCustomerId) {
          setPolicy(null);
          setPolicyError(t('evaos.peopleAccess.differentCustomer'));
          return;
        }
        if (!sameAccount(customerAccountId, response.data.customerAccountId)) {
          setPolicy(null);
          setPolicyError(t('evaos.peopleAccess.differentAccount'));
          return;
        }
        setPolicy(response.data);
      } catch {
        if (!isCurrentRequest(requestEpoch, selectedCustomerId, customerAccountId)) {
          return;
        }
        setPolicy(null);
        setPolicyError(t('evaos.peopleAccess.requestFailed'));
      } finally {
        if (isCurrentRequest(requestEpoch, selectedCustomerId, customerAccountId)) {
          setLoadingPolicy(false);
        }
      }
    },
    [customerAccountIdForCustomer, customerContext.selectedCustomerId, isCurrentRequest, t]
  );

  const inviteMember = useCallback(async () => {
    const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
    const expectedCustomerAccountId = policy?.customerAccountId ?? selectedCustomerAccountRef.current;
    const isSameSelection = () =>
      selectedCustomerRef.current === selectedCustomerId &&
      selectedCustomerAccountRef.current === expectedCustomerAccountId;
    const email = inviteEmail.trim();
    setInviteStatus(null);
    setInviteError(null);
    if (
      !policy ||
      policy.routeDenied ||
      !selectedCustomerId ||
      policy.selectedCustomerId !== selectedCustomerId ||
      !sameAccount(expectedCustomerAccountId, policy.customerAccountId)
    ) {
      setInviteError(t('evaos.peopleAccess.actionDenied'));
      return;
    }
    if (!email) {
      setInviteError(t('evaos.peopleAccess.enterEmail'));
      return;
    }

    setInviting(true);
    try {
      const response = await evaosPeopleAccess.inviteMember.invoke({
        customerId: selectedCustomerId,
        customerAccountId: expectedCustomerAccountId,
        email,
        role: inviteRole,
      });
      if (!isSameSelection()) {
        return;
      }
      if (!response.success || !response.data) {
        setInviteError(safeEvaosUiText(response.msg, t('evaos.peopleAccess.inviteFailedClosed')));
        return;
      }
      setInviteEmail('');
      setInviteStatus(
        safeEvaosUiText(response.data.message, t('evaos.peopleAccess.inviteStatus', { status: response.data.status }))
      );
      await loadPolicy({ preserveInviteStatus: true });
    } catch {
      if (isSameSelection()) {
        setInviteError(t('evaos.peopleAccess.inviteFailedClosed'));
      }
    } finally {
      if (isSameSelection()) {
        setInviting(false);
      }
    }
  }, [customerContext.selectedCustomerId, inviteEmail, inviteRole, loadPolicy, policy, t]);

  const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
  const selectedCustomerAccountId =
    selectedCustomerAccountRef.current ?? customerContext.selectedTarget?.customerAccountId;
  const selectedTarget =
    customerContext.targets.find((target) => isSelectedTarget(target, selectedCustomerId, selectedCustomerAccountId)) ??
    customerContext.selectedTarget;
  const selectedCustomerLabel = safeEvaosUiText(
    selectedTarget?.displayName,
    selectedCustomerId ?? t('evaos.peopleAccess.noCustomerSelected')
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
              {t('evaos.peopleAccess.title')}
            </h1>
            <p className='m-0 mt-4px max-w-720px text-14px leading-22px text-t-secondary'>
              {t('evaos.peopleAccess.description')}
            </p>
          </div>
          <Button
            type='primary'
            icon={<Refresh theme='outline' size='16' />}
            loading={loadingPolicy}
            disabled={!customerContext.selectedCustomerId}
            onClick={() => void loadPolicy()}
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
                loading={loadingPolicy || customerContext.loading}
                disabled={!customerContext.selectedCustomerId}
                onClick={() => void loadPolicy()}
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
                  t('evaos.peopleAccess.failedClosed')
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
            {t('evaos.peopleAccess.scopedSummary', {
              summary: safeEvaosUiText(customerContext.summaryText, t('evaos.shared.unknown')),
            })}
          </p>
          {policyError ? (
            <p className='m-0 mt-8px text-12px leading-18px text-[rgb(var(--warning-6))]'>{policyError}</p>
          ) : null}
        </section>

        {loadingPolicy ? (
          <div className='flex min-h-180px items-center justify-center rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1'>
            <Spin tip={t('evaos.peopleAccess.loading')} />
          </div>
        ) : null}

        {policy ? (
          <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'>
            <div className='flex flex-wrap items-center justify-between gap-10px'>
              <div className='min-w-0'>
                <div className='flex flex-wrap items-center gap-8px'>
                  <h2 className='m-0 text-18px leading-24px font-semibold text-t-primary'>
                    {t('evaos.peopleAccess.accountAccess')}
                  </h2>
                  <Tag color={policy.routeDenied ? 'orange' : 'green'}>
                    {policy.routeDenied ? t('evaos.shared.routeDenied') : t('evaos.shared.brokerPolicyActive')}
                  </Tag>
                  <Tag color={policy.backendEnforced ? 'green' : 'orange'}>
                    {policy.backendEnforced ? t('evaos.shared.backendEnforced') : t('evaos.shared.needsBackendProof')}
                  </Tag>
                </div>
                <p className='m-0 mt-6px text-13px leading-20px text-t-secondary'>
                  {t('evaos.peopleAccess.seatSummary', {
                    activeSeats: policy.activeSeats ?? 0,
                    invitedSeats: policy.invitedSeats ?? 0,
                  })}
                </p>
              </div>
              {policy.auditId ? (
                <div className='text-12px leading-18px text-t-secondary'>
                  {t('evaos.shared.audit', {
                    auditId: safeEvaosUiText(policy.auditId, t('evaos.shared.available')),
                  })}
                </div>
              ) : null}
            </div>

            {policy.routeDenied ? (
              <div className='mt-14px rounded-8px border border-solid border-[rgb(var(--warning-6))] bg-[rgb(var(--warning-1))] p-14px text-13px leading-20px text-t-primary'>
                {safeEvaosUiText(policy.routeDenialReason, t('evaos.peopleAccess.denied'))}
              </div>
            ) : null}

            <div className='mt-14px grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-10px'>
              <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-12px'>
                <div className='text-12px leading-18px text-t-secondary'>{t('evaos.peopleAccess.plan')}</div>
                <div className='mt-4px text-17px leading-24px font-semibold text-t-primary'>
                  {safeEvaosUiText(policy.planCode, t('evaos.shared.unknown'))}
                </div>
              </div>
              <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-12px'>
                <div className='text-12px leading-18px text-t-secondary'>{t('evaos.peopleAccess.seats')}</div>
                <div className='mt-4px text-17px leading-24px font-semibold text-t-primary'>
                  {t('evaos.peopleAccess.activeSeats', {
                    activeSeats: policy.activeSeats ?? 0,
                    seatLimit: policy.seatLimit ?? t('evaos.peopleAccess.unlimited'),
                  })}
                </div>
              </div>
              <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-12px'>
                <div className='text-12px leading-18px text-t-secondary'>{t('evaos.peopleAccess.invites')}</div>
                <div className='mt-4px text-17px leading-24px font-semibold text-t-primary'>
                  {policy.invitedSeats ?? policy.invites.length}
                </div>
              </div>
              <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-12px'>
                <div className='text-12px leading-18px text-t-secondary'>{t('evaos.peopleAccess.yourRole')}</div>
                <div className='mt-4px text-17px leading-24px font-semibold text-t-primary'>
                  {roleLabel(t, policy.membershipRole)}
                </div>
              </div>
            </div>

            {inviteStatus ? (
              <p className='m-0 mt-12px text-13px leading-20px text-[rgb(var(--success-6))]'>{inviteStatus}</p>
            ) : null}
            {inviteError ? (
              <p className='m-0 mt-12px text-13px leading-20px text-[rgb(var(--warning-6))]'>{inviteError}</p>
            ) : null}

            {!policy.routeDenied ? (
              <div className='mt-14px rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-12px'>
                <div className='mb-10px flex items-center gap-8px text-14px font-semibold leading-20px text-t-primary'>
                  <AddUser theme='outline' size='16' /> {t('evaos.peopleAccess.inviteMember')}
                </div>
                <div className='flex flex-wrap gap-8px'>
                  <Input
                    className='max-w-280px min-w-220px'
                    placeholder={t('evaos.peopleAccess.emailPlaceholder')}
                    value={inviteEmail}
                    onChange={setInviteEmail}
                  />
                  <Select className='w-180px' value={inviteRole} onChange={(role) => setInviteRole(role)}>
                    {INVITE_ROLES.map((role) => (
                      <Select.Option key={role} value={role}>
                        {roleLabel(t, role)}
                      </Select.Option>
                    ))}
                  </Select>
                  <Button type='primary' loading={inviting} onClick={() => void inviteMember()}>
                    {t('evaos.peopleAccess.sendInvite')}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className='mt-14px grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-12px'>
              <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px'>
                <div className='mb-10px flex items-center gap-8px text-15px font-semibold leading-22px text-t-primary'>
                  <Peoples theme='outline' size='16' /> {t('evaos.peopleAccess.members')}
                </div>
                {policy.members.length === 0 ? (
                  <p className='m-0 text-13px leading-20px text-t-secondary'>{t('evaos.peopleAccess.emptyMembers')}</p>
                ) : (
                  <div className='flex flex-col gap-10px'>
                    {policy.members.map((member) => (
                      <article
                        key={member.memberId}
                        className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-10px'
                      >
                        <div className='flex flex-wrap items-start justify-between gap-8px'>
                          <div className='min-w-0'>
                            <div className='truncate text-14px font-medium leading-20px text-t-primary'>
                              {memberLabel(member)}
                            </div>
                            <div className='mt-2px text-12px leading-18px text-t-secondary'>
                              {roleLabel(t, member.role)}
                            </div>
                          </div>
                          <Tag color={statusColor(member.status)}>{statusLabel(t, member.status)}</Tag>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px'>
                <div className='mb-10px text-15px font-semibold leading-22px text-t-primary'>
                  {t('evaos.peopleAccess.invitations')}
                </div>
                {policy.invites.length === 0 ? (
                  <p className='m-0 text-13px leading-20px text-t-secondary'>{t('evaos.peopleAccess.emptyInvites')}</p>
                ) : (
                  <div className='flex flex-col gap-10px'>
                    {policy.invites.map((invite) => (
                      <article
                        key={invite.inviteId}
                        className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-10px'
                      >
                        <div className='flex flex-wrap items-start justify-between gap-8px'>
                          <div className='min-w-0'>
                            <div className='truncate text-14px font-medium leading-20px text-t-primary'>
                              {inviteLabel(invite)}
                            </div>
                            <div className='mt-2px text-12px leading-18px text-t-secondary'>
                              {roleLabel(t, invite.role)}
                            </div>
                          </div>
                          <Tag color={statusColor(invite.status)}>{statusLabel(t, invite.status)}</Tag>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
};

export default PeopleAccessPage;
