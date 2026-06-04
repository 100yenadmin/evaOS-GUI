/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { Button, Input, Select, Spin, Tag } from '@arco-design/web-react';
import { Attention, Peoples, Plus, Refresh } from '@icon-park/react';
import { useEvaosCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
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

function statusLabel(status: string): string {
  const label = roleLabel(status);
  return label || 'Unknown';
}

function seatTypeLabel(seatType: string | undefined): string {
  return `${seatType ? roleLabel(seatType).toLowerCase() : 'unassigned'} seat`;
}

function policySourceLabel(source: PolicySource): string {
  switch (source) {
    case 'backend-denied':
      return 'backend denied';
    case 'backend-unavailable':
      return 'backend unavailable';
    case 'backend-policy':
      return 'backend account policy';
    case 'missing-backend-proof':
      return 'missing backend proof';
    default:
      return 'not loaded';
  }
}

type PolicySource =
  | 'not-loaded'
  | 'backend-policy'
  | 'missing-backend-proof'
  | 'backend-denied'
  | 'backend-unavailable';

const PeopleAccessPage: React.FC = () => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [policy, setPolicy] = useState<IEvaosPeopleAccessPolicyView | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policySource, setPolicySource] = useState<PolicySource>('not-loaded');
  const [loadingPolicy, setLoadingPolicy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<IEvaosAccountPolicyRole>('member');
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const customerContext = useEvaosCustomerContext(true);
  const selectedCustomerRef = useRef<string | undefined>(customerContext.selectedCustomerId);
  const requestEpochRef = useRef(0);

  const canManageMembers = policy?.scopes.includes('manage_members') ?? false;
  const hasBackendPolicyProof = policy?.backendEnforced === true && Boolean(policy.auditId);
  const canInviteMembers = canManageMembers && hasBackendPolicyProof && !policy?.routeDenied;
  const seatUsed = (policy?.activeSeats ?? 0) + (policy?.invitedSeats ?? 0);
  const seatLimit = policy?.seatLimit;
  const seatLabel = seatLimit === undefined ? `${seatUsed} used` : `${seatUsed} of ${seatLimit}`;
  const seatLimitReached = seatLimit !== undefined && seatUsed >= seatLimit;
  const inviteCount = policy?.invites.length ?? 0;
  const pendingInviteCount = policy?.invites.filter((invite) => invite.status === 'pending').length ?? 0;
  const effectivePolicySource = policy
    ? hasBackendPolicyProof
      ? 'backend-policy'
      : 'missing-backend-proof'
    : policySource;

  const advancedSurfaceRows = useMemo(() => {
    return Object.entries(policy?.advancedSurfaces ?? {}).toSorted(([left], [right]) => left.localeCompare(right));
  }, [policy?.advancedSurfaces]);

  useEffect(() => {
    selectedCustomerRef.current = customerContext.selectedCustomerId;
    requestEpochRef.current += 1;
  }, [customerContext.selectedCustomerId]);

  const isCurrentRequest = useCallback((epoch: number, customerId: string) => {
    return requestEpochRef.current === epoch && selectedCustomerRef.current === customerId;
  }, []);

  const isSelectedCustomer = useCallback((customerId: string) => {
    return selectedCustomerRef.current === customerId;
  }, []);

  const selectCustomer = useCallback(
    (customerId: string) => {
      selectedCustomerRef.current = customerId;
      requestEpochRef.current += 1;
      customerContext.selectCustomer(customerId);
      setPolicy(null);
      setPolicyError(null);
      setPolicySource('not-loaded');
      setInviteStatus(null);
      setInviteError(null);
      setLoadingPolicy(false);
    },
    [customerContext]
  );

  const refreshCustomerTargets = useCallback(async () => {
    requestEpochRef.current += 1;
    selectedCustomerRef.current = undefined;
    setPolicy(null);
    setPolicyError(null);
    setPolicySource('not-loaded');
    setInviteStatus(null);
    setInviteError(null);
    setLoadingPolicy(false);
    await customerContext.refreshTargets();
  }, [customerContext]);

  const loadPolicy = useCallback(
    async (options: { resetInviteStatus?: boolean } = {}) => {
      const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
      if (options.resetInviteStatus !== false) {
        setInviteStatus(null);
        setInviteError(null);
      }
      if (!selectedCustomerId) {
        setPolicy(null);
        setPolicyError('Choose a customer before loading People Access.');
        setPolicySource('not-loaded');
        return;
      }

      const requestEpoch = requestEpochRef.current + 1;
      requestEpochRef.current = requestEpoch;
      selectedCustomerRef.current = selectedCustomerId;
      setLoadingPolicy(true);
      setPolicyError(null);
      setPolicySource('not-loaded');
      try {
        const response = await evaosPeopleAccess.getPolicy.invoke({ customerId: selectedCustomerId });
        if (!isCurrentRequest(requestEpoch, selectedCustomerId)) {
          return;
        }
        if (!response.success || !response.data) {
          setPolicy(null);
          setPolicyError(safeUiText(response.msg, 'People Access failed closed.'));
          setPolicySource('backend-denied');
          return;
        }
        if (response.data.selectedCustomerId !== selectedCustomerId) {
          setPolicy(null);
          setPolicyError('People Access broker returned evidence for a different customer.');
          setPolicySource('backend-denied');
          return;
        }
        setPolicy(response.data);
        setPolicySource(
          response.data.backendEnforced === true && response.data.auditId ? 'backend-policy' : 'missing-backend-proof'
        );
      } catch {
        if (!isCurrentRequest(requestEpoch, selectedCustomerId)) {
          return;
        }
        setPolicy(null);
        setPolicyError('People Access broker request failed closed.');
        setPolicySource('backend-unavailable');
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
    setInviteStatus(null);
    setInviteError(null);
    if (!policy || policy.routeDenied || !canManageMembers || !selectedCustomerId) {
      setInviteError('Action denied by account policy.');
      return;
    }
    if (!hasBackendPolicyProof) {
      setInviteError('Invite actions require backend-enforced account policy proof.');
      return;
    }

    setInviting(true);
    try {
      const response = await evaosPeopleAccess.inviteMember.invoke({
        customerId: selectedCustomerId,
        email: inviteEmail,
        role: inviteRole,
      });
      if (!isSelectedCustomer(selectedCustomerId)) {
        return;
      }
      if (!response.success || !response.data || response.data.backendEnforced !== true) {
        setInviteError(safeUiText(response.msg, 'Backend denied the invite action.'));
        return;
      }
      await loadPolicy({ resetInviteStatus: false });
      if (!isSelectedCustomer(selectedCustomerId)) {
        return;
      }
      setInviteStatus(safeUiText(response.data.message, `Invite ${response.data.status}.`));
    } catch {
      if (!isSelectedCustomer(selectedCustomerId)) {
        return;
      }
      setInviteError('Backend denied the invite action.');
    } finally {
      setInviting(false);
    }
  }, [
    canManageMembers,
    customerContext.selectedCustomerId,
    hasBackendPolicyProof,
    inviteEmail,
    inviteRole,
    isSelectedCustomer,
    loadPolicy,
    policy,
  ]);

  const selectedCustomerLabel =
    customerContext.selectedTarget?.displayName ?? customerContext.selectedCustomerId ?? 'No customer selected';

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
            {customerContext.summaryText}. People Access stays scoped to the selected customer.
          </p>
          {policyError ? (
            <div className='mt-8px text-12px leading-18px text-[rgb(var(--warning-6))]'>
              <p className='m-0'>{policyError}</p>
              <p className='m-0 mt-2px'>Policy source: {policySourceLabel(policySource)}</p>
            </div>
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
              <SummaryTile label='Invites' value={`${inviteCount} invites`} />
            </section>
            <section className='flex flex-wrap gap-8px'>
              <Tag color={hasBackendPolicyProof ? 'green' : 'red'}>
                {hasBackendPolicyProof ? 'Backend enforced' : 'Backend proof missing'}
              </Tag>
              {seatLimitReached ? <Tag color='orange'>Seat limit reached</Tag> : null}
              <Tag>Policy source: {policySourceLabel(effectivePolicySource)}</Tag>
              <Tag>Backend denial source: backend account policy</Tag>
              {policy.planCode ? <Tag>Plan: {policy.planCode}</Tag> : null}
              {policy.updatedAt ? <Tag>Updated: {policy.updatedAt}</Tag> : null}
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
                    <p className='m-0 mt-4px text-12px leading-18px text-t-secondary'>
                      Route denial source: {policySourceLabel(effectivePolicySource)}
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
                  <Tag color={hasBackendPolicyProof ? 'green' : 'red'}>
                    {hasBackendPolicyProof ? 'backend enforced' : 'Backend proof missing'}
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
                          <div className='mt-2px flex flex-wrap gap-6px text-12px leading-18px text-t-secondary'>
                            <span>{seatTypeLabel(member.seatType)}</span>
                            {member.joinedAt ? <span>Joined: {member.joinedAt}</span> : null}
                            {member.lastActiveAt ? <span>Last active: {member.lastActiveAt}</span> : null}
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
                    disabled={!canInviteMembers}
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
                  {!canManageMembers || policy.routeDenied || !hasBackendPolicyProof ? (
                    <p className='m-0 text-12px leading-18px text-t-secondary'>
                      Action denial source: {policySourceLabel(effectivePolicySource)}
                    </p>
                  ) : null}
                  {canManageMembers && !hasBackendPolicyProof ? (
                    <p className='m-0 text-12px leading-18px text-[rgb(var(--warning-6))]'>
                      Invite actions require backend-enforced account policy proof.
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
              <div className='mb-12px flex items-center justify-between gap-10px'>
                <h2 className='m-0 text-16px font-semibold leading-22px text-t-primary'>Invites</h2>
                <Tag color={seatLimitReached ? 'orange' : 'blue'}>{pendingInviteCount} pending</Tag>
              </div>
              <div className='flex flex-col gap-8px'>
                {policy.invites.length === 0 ? (
                  <div className='rounded-8px border border-dashed border-[var(--color-border-2)] p-12px text-13px text-t-secondary'>
                    No invite evidence returned.
                  </div>
                ) : (
                  policy.invites.map((invite) => (
                    <div
                      key={invite.inviteId}
                      className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-10px rounded-8px border border-solid border-[var(--color-border-2)] px-12px py-10px'
                    >
                      <div className='min-w-0'>
                        <div className='truncate text-14px font-medium leading-20px text-t-primary'>{invite.email}</div>
                        <div className='mt-2px flex flex-wrap gap-6px text-12px leading-18px text-t-secondary'>
                          {invite.invitedAt ? <span>Invited: {invite.invitedAt}</span> : null}
                          {invite.expiresAt ? <span>Expires: {invite.expiresAt}</span> : null}
                        </div>
                      </div>
                      <div className='flex shrink-0 items-center gap-6px'>
                        <Tag>{roleLabel(invite.role)}</Tag>
                        <Tag color={invite.status === 'pending' ? 'blue' : 'gray'}>{statusLabel(invite.status)}</Tag>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
              <h2 className='m-0 text-16px font-semibold leading-22px text-t-primary'>Policy evidence</h2>
              <div className='mt-10px grid grid-cols-1 gap-8px text-12px leading-18px text-t-secondary md:grid-cols-3'>
                <span>Account: {policy.customerAccountId}</span>
                <span>Customer: {policy.selectedCustomerId}</span>
                <span>Audit: {policy.auditId ?? '-'}</span>
                <span>Backend: {hasBackendPolicyProof ? 'enforced' : 'proof missing'}</span>
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
