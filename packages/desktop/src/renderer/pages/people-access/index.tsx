/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useState } from 'react';
import classNames from 'classnames';
import { Button, Input, Select, Spin, Tag } from '@arco-design/web-react';
import { Attention, Peoples, Plus, Refresh } from '@icon-park/react';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import {
  evaosPeopleAccess,
  type IEvaosAccountPolicyRole,
  type IEvaosPeopleAccessPolicyView,
} from '@/common/adapter/ipcBridge';

const INVITE_ROLES: IEvaosAccountPolicyRole[] = [
  'admin',
  'billing_admin',
  'technical_admin',
  'manager',
  'member',
  'agent_only',
];

const SECRET_TEXT_PATTERN =
  /(eds_|epg_|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|authorization|bearer|secret|password)/i;

function safeUiText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
}

function roleLabel(role: string): string {
  return role
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

const PeopleAccessPage: React.FC = () => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [customerId, setCustomerId] = useState('');
  const [policy, setPolicy] = useState<IEvaosPeopleAccessPolicyView | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [loadingPolicy, setLoadingPolicy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<IEvaosAccountPolicyRole>('member');
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const canManageMembers = policy?.scopes.includes('manage_members') ?? false;
  const seatUsed = (policy?.activeSeats ?? 0) + (policy?.invitedSeats ?? 0);
  const seatLimit = policy?.seatLimit;
  const seatLabel = seatLimit === undefined ? `${seatUsed} used` : `${seatUsed} of ${seatLimit}`;

  const advancedSurfaceRows = useMemo(() => {
    return Object.entries(policy?.advancedSurfaces ?? {}).toSorted(([left], [right]) => left.localeCompare(right));
  }, [policy?.advancedSurfaces]);

  const handleCustomerChange = useCallback((value: string) => {
    setCustomerId(value);
    setPolicy(null);
    setPolicyError(null);
    setInviteStatus(null);
    setInviteError(null);
  }, []);

  const loadPolicy = useCallback(
    async (options: { resetInviteStatus?: boolean } = {}) => {
      const trimmedCustomerId = customerId.trim();
      if (options.resetInviteStatus !== false) {
        setInviteStatus(null);
        setInviteError(null);
      }
      if (!trimmedCustomerId) {
        setPolicy(null);
        setPolicyError('Choose a customer before loading People Access.');
        return;
      }

      setLoadingPolicy(true);
      setPolicyError(null);
      try {
        const response = await evaosPeopleAccess.getPolicy.invoke({ customerId: trimmedCustomerId });
        if (!response.success || !response.data) {
          setPolicy(null);
          setPolicyError(safeUiText(response.msg, 'People Access failed closed.'));
          return;
        }
        setPolicy(response.data);
      } catch {
        setPolicy(null);
        setPolicyError('People Access broker request failed closed.');
      } finally {
        setLoadingPolicy(false);
      }
    },
    [customerId]
  );

  const inviteMember = useCallback(async () => {
    const trimmedCustomerId = customerId.trim();
    setInviteStatus(null);
    setInviteError(null);
    if (!policy || policy.routeDenied || !canManageMembers) {
      setInviteError('Action denied by account policy.');
      return;
    }

    setInviting(true);
    try {
      const response = await evaosPeopleAccess.inviteMember.invoke({
        customerId: trimmedCustomerId,
        email: inviteEmail,
        role: inviteRole,
      });
      if (!response.success || !response.data) {
        setInviteError(safeUiText(response.msg, 'Backend denied the invite action.'));
        return;
      }
      await loadPolicy({ resetInviteStatus: false });
      setInviteStatus(safeUiText(response.data.message, `Invite ${response.data.status}.`));
    } catch {
      setInviteError('Backend denied the invite action.');
    } finally {
      setInviting(false);
    }
  }, [canManageMembers, customerId, inviteEmail, inviteRole, loadPolicy, policy]);

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
            <h1 className='m-0 text-28px leading-34px font-bold text-t-primary max-sm:text-24px'>People Access</h1>
            <p className='m-0 mt-4px max-w-720px text-14px leading-22px text-t-secondary'>
              Members, roles, invites, and seats from the evaOS account policy plane.
            </p>
          </div>
          <Button
            type='primary'
            icon={<Refresh theme='outline' size='16' />}
            loading={loadingPolicy}
            onClick={() => void loadPolicy()}
          >
            Refresh
          </Button>
        </header>

        <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
          <label className='block text-13px font-medium leading-20px text-t-primary' htmlFor='people-customer-id'>
            Customer context
          </label>
          <div className='mt-8px flex gap-8px max-[520px]:flex-col'>
            <Input
              id='people-customer-id'
              value={customerId}
              placeholder='Customer ID or slug'
              onChange={handleCustomerChange}
              onPressEnter={() => void loadPolicy()}
            />
            <Button className='shrink-0' loading={loadingPolicy} onClick={() => void loadPolicy()}>
              Load
            </Button>
          </div>
          {policyError ? (
            <p className='m-0 mt-8px text-12px leading-18px text-[rgb(var(--warning-6))]'>{policyError}</p>
          ) : null}
        </section>

        {loadingPolicy ? (
          <div className='flex min-h-220px items-center justify-center rounded-8px border border-dashed border-[var(--color-border-2)] bg-fill-1'>
            <Spin />
          </div>
        ) : policy ? (
          <>
            <section className='grid grid-cols-1 gap-10px md:grid-cols-4'>
              <SummaryTile label='Role' value={roleLabel(policy.membershipRole)} />
              <SummaryTile label='Seats' value={seatLabel} />
              <SummaryTile label='Members' value={String(policy.members.length)} />
              <SummaryTile label='Invites' value={String(policy.invites.length)} />
            </section>

            {policy.routeDenied ? (
              <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
                <div className='flex items-start gap-10px text-[rgb(var(--warning-6))]'>
                  <Attention theme='outline' size='18' className='mt-2px shrink-0' />
                  <div className='min-w-0'>
                    <h2 className='m-0 text-15px font-semibold leading-22px'>Route denied</h2>
                    <p className='m-0 mt-4px text-13px leading-20px'>
                      {policy.routeDenialReason ?? 'This customer account does not allow People Access.'}
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            <section className='grid grid-cols-1 gap-12px lg:grid-cols-[minmax(0,1fr)_340px]'>
              <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
                <div className='mb-12px flex items-center justify-between gap-10px'>
                  <h2 className='m-0 text-16px font-semibold leading-22px text-t-primary'>Members</h2>
                  <Tag color={canManageMembers ? 'green' : 'orange'}>
                    {canManageMembers ? 'manage_members' : 'action denied'}
                  </Tag>
                </div>
                <div className='flex flex-col gap-8px'>
                  {policy.members.length === 0 ? (
                    <div className='rounded-8px border border-dashed border-[var(--color-border-2)] p-12px text-13px text-t-secondary'>
                      No member evidence returned.
                    </div>
                  ) : (
                    policy.members.map((member) => (
                      <div
                        key={member.memberId}
                        className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-10px rounded-8px border border-solid border-[var(--color-border-2)] px-12px py-10px'
                      >
                        <div className='min-w-0'>
                          <div className='truncate text-14px font-medium leading-20px text-t-primary'>
                            {member.displayName ?? member.email ?? member.memberId}
                          </div>
                          <div className='mt-2px truncate text-12px leading-18px text-t-secondary'>
                            {member.email ?? member.memberId}
                          </div>
                        </div>
                        <div className='flex shrink-0 items-center gap-6px'>
                          <Tag>{roleLabel(member.role)}</Tag>
                          <Tag color={member.status === 'active' ? 'green' : 'gray'}>{member.status}</Tag>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <aside className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
                <div className='flex items-center gap-8px'>
                  <span className='flex size-30px items-center justify-center rounded-8px bg-fill-3 text-t-primary'>
                    <Peoples theme='outline' size='17' />
                  </span>
                  <h2 className='m-0 text-16px font-semibold leading-22px text-t-primary'>Invite member</h2>
                </div>
                <div className='mt-12px flex flex-col gap-8px'>
                  <Input value={inviteEmail} placeholder='employee@example.com' onChange={setInviteEmail} />
                  <Select value={inviteRole} onChange={(value) => setInviteRole(value as IEvaosAccountPolicyRole)}>
                    {INVITE_ROLES.map((role) => (
                      <Select.Option key={role} value={role}>
                        {roleLabel(role)}
                      </Select.Option>
                    ))}
                  </Select>
                  <Button
                    type='primary'
                    icon={<Plus theme='outline' size='15' />}
                    disabled={!canManageMembers || policy.routeDenied}
                    loading={inviting}
                    onClick={() => void inviteMember()}
                  >
                    Invite
                  </Button>
                  {!canManageMembers || policy.routeDenied ? (
                    <p className='m-0 text-12px leading-18px text-[rgb(var(--warning-6))]'>
                      Action denied by account policy.
                    </p>
                  ) : null}
                  {inviteStatus ? (
                    <p className='m-0 text-12px leading-18px text-[rgb(var(--success-6))]'>{inviteStatus}</p>
                  ) : null}
                  {inviteError ? (
                    <p className='m-0 text-12px leading-18px text-[rgb(var(--warning-6))]'>{inviteError}</p>
                  ) : null}
                </div>
              </aside>
            </section>

            <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
              <h2 className='m-0 text-16px font-semibold leading-22px text-t-primary'>Policy evidence</h2>
              <div className='mt-10px grid grid-cols-1 gap-8px text-12px leading-18px text-t-secondary md:grid-cols-3'>
                <span>Account: {policy.customerAccountId}</span>
                <span>Customer: {policy.selectedCustomerId}</span>
                <span>Audit: {policy.auditId ?? '-'}</span>
              </div>
              <div className='mt-12px flex flex-wrap gap-6px'>
                {policy.scopes.map((scope) => (
                  <Tag key={scope}>{scope}</Tag>
                ))}
              </div>
              {advancedSurfaceRows.length > 0 ? (
                <div className='mt-12px grid grid-cols-1 gap-6px text-12px leading-18px text-t-secondary sm:grid-cols-2'>
                  {advancedSurfaceRows.map(([surface, allowed]) => (
                    <span key={surface}>
                      {surface}: {allowed ? 'allowed' : 'denied'}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>
          </>
        ) : (
          <div className='rounded-8px border border-dashed border-[var(--color-border-2)] bg-fill-1 p-16px text-13px leading-20px text-t-secondary'>
            Load a customer account policy to view People Access.
          </div>
        )}
      </div>
    </div>
  );
};

const SummaryTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 px-14px py-12px'>
    <div className='text-12px leading-18px text-t-secondary'>{label}</div>
    <div className='mt-6px truncate text-18px font-semibold leading-24px text-t-primary'>{value}</div>
  </div>
);

export default PeopleAccessPage;
