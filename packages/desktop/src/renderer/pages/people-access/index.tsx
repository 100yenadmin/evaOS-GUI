/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { Button, Input, Select, Spin, Tag } from '@arco-design/web-react';
import { AddUser, Peoples, Refresh } from '@icon-park/react';
import { useEvaosBrokeredCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import {
  evaosPeopleAccess,
  type IEvaosAccountPolicyRole,
  type IEvaosPeopleAccessInviteView,
  type IEvaosPeopleAccessMemberView,
  type IEvaosPeopleAccessPolicyView,
} from '@/common/adapter/ipcBridge';

const SECRET_TEXT_PATTERN =
  /\b(?:eds|epg)_[A-Za-z0-9_-]{4,}\b|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|grant[_-]?handle|authorization|bearer|secret|password/i;
const INVITE_ROLES: IEvaosAccountPolicyRole[] = [
  'member',
  'manager',
  'support',
  'agent_only',
  'technical_admin',
  'billing_admin',
  'admin',
];

function safeUiText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
}

function roleLabel(role: IEvaosAccountPolicyRole): string {
  return role.replace(/_/g, ' ');
}

function statusColor(status: string): 'green' | 'orange' | 'red' | 'gray' {
  const normalized = status.toLowerCase();
  if (normalized === 'active' || normalized === 'accepted') return 'green';
  if (normalized === 'pending' || normalized === 'invited') return 'orange';
  if (normalized === 'revoked' || normalized === 'expired' || normalized === 'disabled') return 'red';
  return 'gray';
}

function memberLabel(member: IEvaosPeopleAccessMemberView): string {
  return safeUiText(member.displayName, safeUiText(member.email, member.memberId));
}

function inviteLabel(invite: IEvaosPeopleAccessInviteView): string {
  return safeUiText(invite.email, invite.inviteId);
}

const PeopleAccessPage: React.FC = () => {
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
    requestEpochRef.current += 1;
    clearPolicyEvidence();
  }, [clearPolicyEvidence, customerContext.selectedCustomerId]);

  const isCurrentRequest = useCallback((epoch: number, customerId: string) => {
    return requestEpochRef.current === epoch && selectedCustomerRef.current === customerId;
  }, []);

  const selectCustomer = useCallback(
    (customerId: string) => {
      selectedCustomerRef.current = customerId;
      requestEpochRef.current += 1;
      customerContext.selectCustomer(customerId);
      clearPolicyEvidence();
    },
    [clearPolicyEvidence, customerContext]
  );

  const refreshCustomerTargets = useCallback(async () => {
    requestEpochRef.current += 1;
    selectedCustomerRef.current = undefined;
    clearPolicyEvidence();
    await customerContext.refreshTargets();
  }, [clearPolicyEvidence, customerContext]);

  const loadPolicy = useCallback(
    async (options: { preserveInviteStatus?: boolean } = {}) => {
      const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
      if (!options.preserveInviteStatus) {
        setInviteStatus(null);
        setInviteError(null);
      }
      if (!selectedCustomerId) {
        setPolicy(null);
        setPolicyError('Choose a customer before loading People & Access.');
        return;
      }

      const requestEpoch = requestEpochRef.current + 1;
      requestEpochRef.current = requestEpoch;
      selectedCustomerRef.current = selectedCustomerId;
      setLoadingPolicy(true);
      setPolicyError(null);
      try {
        const response = await evaosPeopleAccess.getPolicy.invoke({ customerId: selectedCustomerId });
        if (!isCurrentRequest(requestEpoch, selectedCustomerId)) {
          return;
        }
        if (!response.success || !response.data) {
          setPolicy(null);
          setPolicyError(safeUiText(response.msg, 'People & Access failed closed.'));
          return;
        }
        if (response.data.selectedCustomerId !== selectedCustomerId) {
          setPolicy(null);
          setPolicyError('People & Access broker returned evidence for a different customer.');
          return;
        }
        setPolicy(response.data);
      } catch {
        if (!isCurrentRequest(requestEpoch, selectedCustomerId)) {
          return;
        }
        setPolicy(null);
        setPolicyError('People & Access broker request failed closed.');
      } finally {
        if (isCurrentRequest(requestEpoch, selectedCustomerId)) {
          setLoadingPolicy(false);
        }
      }
    },
    [customerContext.selectedCustomerId, isCurrentRequest]
  );

  const inviteMember = useCallback(async () => {
    const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
    const email = inviteEmail.trim();
    setInviteStatus(null);
    setInviteError(null);
    if (!policy || policy.routeDenied || !selectedCustomerId || policy.selectedCustomerId !== selectedCustomerId) {
      setInviteError('Action denied by account policy.');
      return;
    }
    if (!email) {
      setInviteError('Enter an email address before sending an invite.');
      return;
    }

    setInviting(true);
    try {
      const response = await evaosPeopleAccess.inviteMember.invoke({
        customerId: selectedCustomerId,
        email,
        role: inviteRole,
      });
      if (selectedCustomerRef.current !== selectedCustomerId) {
        return;
      }
      if (!response.success || !response.data) {
        setInviteError(safeUiText(response.msg, 'People & Access invite failed closed.'));
        return;
      }
      setInviteEmail('');
      setInviteStatus(safeUiText(response.data.message, `Invite ${response.data.status}.`));
      await loadPolicy({ preserveInviteStatus: true });
    } catch {
      if (selectedCustomerRef.current === selectedCustomerId) {
        setInviteError('People & Access invite failed closed.');
      }
    } finally {
      if (selectedCustomerRef.current === selectedCustomerId) {
        setInviting(false);
      }
    }
  }, [customerContext.selectedCustomerId, inviteEmail, inviteRole, loadPolicy, policy]);

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
            <h1 className='m-0 text-28px leading-34px font-bold text-t-primary max-sm:text-24px'>People & Access</h1>
            <p className='m-0 mt-4px max-w-720px text-14px leading-22px text-t-secondary'>
              Manage seats, invites, and account permissions for the selected evaOS customer account.
            </p>
          </div>
          <Button
            type='primary'
            icon={<Refresh theme='outline' size='16' />}
            loading={loadingPolicy}
            disabled={!customerContext.selectedCustomerId}
            onClick={() => void loadPolicy()}
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
                loading={loadingPolicy || customerContext.loading}
                disabled={!customerContext.selectedCustomerId}
                onClick={() => void loadPolicy()}
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
            {customerContext.summaryText}. People & Access stays scoped to the selected customer.
          </p>
          {policyError ? (
            <p className='m-0 mt-8px text-12px leading-18px text-[rgb(var(--warning-6))]'>{policyError}</p>
          ) : null}
        </section>

        {loadingPolicy ? (
          <div className='flex min-h-180px items-center justify-center rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1'>
            <Spin tip='Loading People & Access...' />
          </div>
        ) : null}

        {policy ? (
          <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'>
            <div className='flex flex-wrap items-center justify-between gap-10px'>
              <div className='min-w-0'>
                <div className='flex flex-wrap items-center gap-8px'>
                  <h2 className='m-0 text-18px leading-24px font-semibold text-t-primary'>Account access</h2>
                  <Tag color={policy.routeDenied ? 'orange' : 'green'}>
                    {policy.routeDenied ? 'Route denied' : 'Broker policy active'}
                  </Tag>
                  <Tag color={policy.backendEnforced ? 'green' : 'orange'}>
                    {policy.backendEnforced ? 'Backend enforced' : 'Needs backend proof'}
                  </Tag>
                </div>
                <p className='m-0 mt-6px text-13px leading-20px text-t-secondary'>
                  {safeUiText(
                    `${policy.activeSeats ?? 0} active seats, ${policy.invitedSeats ?? 0} invited`,
                    'Seat evidence loaded.'
                  )}
                </p>
              </div>
              {policy.auditId ? (
                <div className='text-12px leading-18px text-t-secondary'>
                  Audit {safeUiText(policy.auditId, 'available')}
                </div>
              ) : null}
            </div>

            {policy.routeDenied ? (
              <div className='mt-14px rounded-8px border border-solid border-[rgb(var(--warning-6))] bg-[rgb(var(--warning-1))] p-14px text-13px leading-20px text-t-primary'>
                {safeUiText(policy.routeDenialReason, 'People & Access is denied for this customer account.')}
              </div>
            ) : null}

            <div className='mt-14px grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-10px'>
              <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-12px'>
                <div className='text-12px leading-18px text-t-secondary'>Plan</div>
                <div className='mt-4px text-17px leading-24px font-semibold text-t-primary'>
                  {safeUiText(policy.planCode, 'Unknown')}
                </div>
              </div>
              <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-12px'>
                <div className='text-12px leading-18px text-t-secondary'>Seats</div>
                <div className='mt-4px text-17px leading-24px font-semibold text-t-primary'>
                  {policy.activeSeats ?? 0}/{policy.seatLimit ?? 'unlimited'} active
                </div>
              </div>
              <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-12px'>
                <div className='text-12px leading-18px text-t-secondary'>Invites</div>
                <div className='mt-4px text-17px leading-24px font-semibold text-t-primary'>
                  {policy.invitedSeats ?? policy.invites.length}
                </div>
              </div>
              <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-12px'>
                <div className='text-12px leading-18px text-t-secondary'>Your role</div>
                <div className='mt-4px text-17px leading-24px font-semibold text-t-primary'>
                  {roleLabel(policy.membershipRole)}
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
                  <AddUser theme='outline' size='16' /> Invite member
                </div>
                <div className='flex flex-wrap gap-8px'>
                  <Input
                    className='max-w-280px min-w-220px'
                    placeholder='email@company.com'
                    value={inviteEmail}
                    onChange={setInviteEmail}
                  />
                  <Select className='w-180px' value={inviteRole} onChange={(role) => setInviteRole(role)}>
                    {INVITE_ROLES.map((role) => (
                      <Select.Option key={role} value={role}>
                        {roleLabel(role)}
                      </Select.Option>
                    ))}
                  </Select>
                  <Button type='primary' loading={inviting} onClick={() => void inviteMember()}>
                    Send invite
                  </Button>
                </div>
              </div>
            ) : null}

            <div className='mt-14px grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-12px'>
              <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px'>
                <div className='mb-10px flex items-center gap-8px text-15px font-semibold leading-22px text-t-primary'>
                  <Peoples theme='outline' size='16' /> Members
                </div>
                {policy.members.length === 0 ? (
                  <p className='m-0 text-13px leading-20px text-t-secondary'>
                    No active members returned for this account.
                  </p>
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
                              {roleLabel(member.role)}
                            </div>
                          </div>
                          <Tag color={statusColor(member.status)}>{safeUiText(member.status, 'status')}</Tag>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px'>
                <div className='mb-10px text-15px font-semibold leading-22px text-t-primary'>Invitations</div>
                {policy.invites.length === 0 ? (
                  <p className='m-0 text-13px leading-20px text-t-secondary'>
                    No pending invites returned for this account.
                  </p>
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
                              {roleLabel(invite.role)}
                            </div>
                          </div>
                          <Tag color={statusColor(invite.status)}>{safeUiText(invite.status, 'status')}</Tag>
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
