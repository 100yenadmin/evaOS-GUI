/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useState } from 'react';
import classNames from 'classnames';
import { Button, Input, Select, Spin, Tag } from '@arco-design/web-react';
import { Attention, CheckOne, CloseOne, Connection, Refresh, Shield } from '@icon-park/react';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import {
  evaosProviderHub,
  type IEvaosProviderActionResult,
  type IEvaosProviderAgentRuntime,
  type IEvaosProviderHubView,
  type IEvaosProviderKey,
  type IEvaosProviderProfileView,
  type IEvaosProviderStatus,
} from '@/common/adapter/ipcBridge';

const SECRET_TEXT_PATTERN =
  /\b(?:eds|epg)_[A-Za-z0-9_-]{4,}\b|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|grant[_-]?handle|authorization|bearer|secret|password/i;

function safeUiText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
}

function statusColor(status: IEvaosProviderStatus, approvalRequired: boolean): 'green' | 'orange' | 'red' | 'gray' {
  if (approvalRequired) return 'orange';
  if (status === 'connected') return 'green';
  if (status === 'needs_login' || status === 'approval_required' || status === 'expired') return 'orange';
  if (status === 'error') return 'red';
  return 'gray';
}

function statusLabel(profile: IEvaosProviderProfileView): string {
  if (profile.approvalRequired) return 'Approval required';
  if (profile.rawSecretsStoredInWorkbench) return 'Blocked';
  if (profile.status === 'connected' && profile.hasConnectionProof) return 'Ready';
  if (profile.status === 'connected') return 'Needs verification';
  if (profile.status === 'needs_login') return 'Needs login';
  if (profile.status === 'approval_required') return 'Approval required';
  if (profile.status === 'expired') return 'Needs reconnection';
  if (profile.status === 'revoked') return 'Revoked';
  if (profile.status === 'error') return 'Blocked';
  return 'Unavailable';
}

const ConnectedAppsPage: React.FC = () => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [customerId, setCustomerId] = useState('');
  const [hub, setHub] = useState<IEvaosProviderHubView | null>(null);
  const [hubError, setHubError] = useState<string | null>(null);
  const [loadingHub, setLoadingHub] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<string | null>(null);
  const [agentRuntime, setAgentRuntime] = useState<IEvaosProviderAgentRuntime>('openclaw');

  const canManageIntegrations = !hub?.routeDenied;
  const readyCount = useMemo(
    () => hub?.profiles.filter((profile) => profile.status === 'connected' && profile.hasConnectionProof).length ?? 0,
    [hub?.profiles]
  );
  const attentionCount = useMemo(
    () =>
      hub?.profiles.filter(
        (profile) =>
          profile.approvalRequired ||
          profile.rawSecretsStoredInWorkbench ||
          profile.status === 'needs_login' ||
          profile.status === 'expired' ||
          profile.status === 'error'
      ).length ?? 0,
    [hub?.profiles]
  );

  const handleCustomerChange = useCallback((value: string) => {
    setCustomerId(value);
    setHub(null);
    setHubError(null);
    setActionStatus(null);
    setActionError(null);
    setActionTarget(null);
  }, []);

  const loadHub = useCallback(
    async (options: { resetActionStatus?: boolean } = {}) => {
      const trimmedCustomerId = customerId.trim();
      if (options.resetActionStatus !== false) {
        setActionStatus(null);
        setActionError(null);
      }
      if (!trimmedCustomerId) {
        setHub(null);
        setHubError('Choose a customer before loading Connected Apps.');
        return;
      }

      setLoadingHub(true);
      setHubError(null);
      try {
        const response = await evaosProviderHub.getProfiles.invoke({ customerId: trimmedCustomerId });
        if (!response.success || !response.data) {
          setHub(null);
          setHubError(safeUiText(response.msg, 'Connected Apps failed closed.'));
          return;
        }
        setHub(response.data);
      } catch {
        setHub(null);
        setHubError('Connected Apps broker request failed closed.');
      } finally {
        setLoadingHub(false);
      }
    },
    [customerId]
  );

  const runProviderAction = useCallback(
    async (providerKey: IEvaosProviderKey, action: 'startAuth' | 'switchProvider' | 'revokeProvider' | 'mintGrant') => {
      const trimmedCustomerId = customerId.trim();
      setActionStatus(null);
      setActionError(null);
      if (!hub || hub.routeDenied || !canManageIntegrations) {
        setActionError('Action denied by account policy.');
        return;
      }

      setActionTarget(`${providerKey}:${action}`);
      try {
        const request = {
          customerId: trimmedCustomerId,
          providerKey,
          agentRuntime: action === 'mintGrant' ? agentRuntime : undefined,
        };
        const response = await evaosProviderHub[action].invoke(request);
        if (!response.success || !response.data) {
          setActionError(safeUiText(response.msg, 'Backend denied the provider action.'));
          return;
        }
        if (response.data.providerHub) {
          setHub(response.data.providerHub);
        } else {
          await loadHub({ resetActionStatus: false });
        }
        setActionStatus(actionSummary(response.data));
      } catch {
        setActionError('Backend denied the provider action.');
      } finally {
        setActionTarget(null);
      }
    },
    [agentRuntime, canManageIntegrations, customerId, hub, loadHub]
  );

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
            <h1 className='m-0 text-28px leading-34px font-bold text-t-primary max-sm:text-24px'>Connected Apps</h1>
            <p className='m-0 mt-4px max-w-720px text-14px leading-22px text-t-secondary'>
              Brokered provider status, grants, and revocation for this customer account.
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-8px'>
            <Select
              className='w-140px'
              value={agentRuntime}
              onChange={(value) => setAgentRuntime(value as IEvaosProviderAgentRuntime)}
            >
              <Select.Option value='openclaw'>OpenClaw</Select.Option>
              <Select.Option value='hermes'>Hermes</Select.Option>
            </Select>
            <Button
              type='primary'
              icon={<Refresh theme='outline' size='16' />}
              loading={loadingHub}
              onClick={() => void loadHub()}
            >
              Refresh
            </Button>
          </div>
        </header>

        <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
          <label className='block text-13px font-medium leading-20px text-t-primary' htmlFor='providers-customer-id'>
            Customer context
          </label>
          <div className='mt-8px flex gap-8px max-[520px]:flex-col'>
            <Input
              id='providers-customer-id'
              value={customerId}
              placeholder='Customer ID or slug'
              onChange={handleCustomerChange}
              onPressEnter={() => void loadHub()}
            />
            <Button className='shrink-0' loading={loadingHub} onClick={() => void loadHub()}>
              Load
            </Button>
          </div>
          {hubError ? (
            <p className='m-0 mt-8px text-12px leading-18px text-[rgb(var(--warning-6))]'>{hubError}</p>
          ) : null}
        </section>

        {loadingHub ? (
          <div className='flex min-h-220px items-center justify-center rounded-8px border border-dashed border-[var(--color-border-2)] bg-fill-1'>
            <Spin />
          </div>
        ) : hub ? (
          <>
            <section className='grid grid-cols-1 gap-10px md:grid-cols-4'>
              <SummaryTile label='Status' value={hub.summaryText} />
              <SummaryTile label='Ready' value={String(readyCount)} />
              <SummaryTile label='Needs attention' value={String(attentionCount)} />
              <SummaryTile label='Audit' value={hub.auditId ?? hub.policyAuditId ?? '-'} />
            </section>

            {hub.routeDenied ? (
              <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
                <div className='flex items-start gap-10px text-[rgb(var(--warning-6))]'>
                  <Attention theme='outline' size='18' className='mt-2px shrink-0' />
                  <div className='min-w-0'>
                    <h2 className='m-0 text-15px font-semibold leading-22px'>Route denied</h2>
                    <p className='m-0 mt-4px text-13px leading-20px'>
                      {hub.routeDenialReason ?? 'This customer account does not allow Connected Apps.'}
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

            <section className='flex flex-col gap-10px'>
              {hub.profiles.length === 0 ? (
                <div className='rounded-8px border border-dashed border-[var(--color-border-2)] bg-fill-1 p-16px text-13px leading-20px text-t-secondary'>
                  No provider profile evidence returned.
                </div>
              ) : (
                hub.profiles.map((profile) => (
                  <ProviderRow
                    key={profile.providerKey}
                    profile={profile}
                    activeProviderKey={hub.activeProviderKey}
                    routeDenied={hub.routeDenied}
                    actionTarget={actionTarget}
                    onStartAuth={() => void runProviderAction(profile.providerKey, 'startAuth')}
                    onSwitch={() => void runProviderAction(profile.providerKey, 'switchProvider')}
                    onMintGrant={() => void runProviderAction(profile.providerKey, 'mintGrant')}
                    onRevoke={() => void runProviderAction(profile.providerKey, 'revokeProvider')}
                  />
                ))
              )}
            </section>

            <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
              <h2 className='m-0 text-16px font-semibold leading-22px text-t-primary'>Policy evidence</h2>
              <div className='mt-10px grid grid-cols-1 gap-8px text-12px leading-18px text-t-secondary md:grid-cols-3'>
                <span>Account: {hub.customerAccountId ?? '-'}</span>
                <span>Customer: {hub.customerId}</span>
                <span>Source: {hub.sourcePointer ?? '-'}</span>
              </div>
            </section>
          </>
        ) : (
          <div className='rounded-8px border border-dashed border-[var(--color-border-2)] bg-fill-1 p-16px text-13px leading-20px text-t-secondary'>
            Load a customer account to view connected app evidence.
          </div>
        )}
      </div>
    </div>
  );
};

const ProviderRow: React.FC<{
  profile: IEvaosProviderProfileView;
  activeProviderKey?: IEvaosProviderKey;
  routeDenied: boolean;
  actionTarget: string | null;
  onStartAuth: () => void;
  onSwitch: () => void;
  onMintGrant: () => void;
  onRevoke: () => void;
}> = ({ profile, activeProviderKey, routeDenied, actionTarget, onStartAuth, onSwitch, onMintGrant, onRevoke }) => {
  const disabled = routeDenied || profile.status === 'planned' || profile.rawSecretsStoredInWorkbench;
  const canStartAuth =
    profile.status !== 'connected' &&
    profile.status !== 'approval_required' &&
    profile.status !== 'planned' &&
    !profile.rawSecretsStoredInWorkbench;
  const canSwitch = profile.status === 'connected' && profile.hasConnectionProof && !profile.active;
  const canMintGrant =
    profile.status === 'connected' && profile.hasConnectionProof && !profile.rawSecretsStoredInWorkbench;
  const canRequestAccess =
    profile.status === 'approval_required' && profile.hasConnectionProof && !profile.rawSecretsStoredInWorkbench;
  const canRevoke = profile.status === 'connected';
  const active = profile.active || activeProviderKey === profile.providerKey;

  return (
    <article className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
      <div className='flex flex-wrap items-start justify-between gap-12px'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-6px'>
            <Tag color={statusColor(profile.status, profile.approvalRequired)}>{statusLabel(profile)}</Tag>
            {active ? <Tag color='green'>active</Tag> : null}
            {profile.hasBrokeredGrant ? <Tag color='blue'>auditable handle</Tag> : null}
          </div>
          <h2 className='m-0 mt-10px text-17px font-semibold leading-24px text-t-primary'>{profile.title}</h2>
          <p className='m-0 mt-4px text-13px leading-20px text-t-secondary'>
            {profile.accountLabel ?? profile.subtitle ?? profile.summaryText}
          </p>
        </div>
        <div className='flex max-w-full flex-wrap justify-end gap-8px'>
          {canStartAuth ? (
            <Button
              icon={<Connection theme='outline' size='15' />}
              disabled={disabled}
              loading={actionTarget === `${profile.providerKey}:startAuth`}
              onClick={onStartAuth}
            >
              Connect
            </Button>
          ) : null}
          {canSwitch ? (
            <Button
              icon={<CheckOne theme='outline' size='15' />}
              disabled={disabled}
              loading={actionTarget === `${profile.providerKey}:switchProvider`}
              onClick={onSwitch}
            >
              Make active
            </Button>
          ) : null}
          {profile.approvalRequired || canMintGrant ? (
            <Button
              type='primary'
              icon={<Shield theme='outline' size='15' />}
              disabled={disabled || (!canRequestAccess && !canMintGrant)}
              loading={actionTarget === `${profile.providerKey}:mintGrant`}
              onClick={onMintGrant}
            >
              {profile.approvalRequired ? 'Request access' : 'Allow Eva'}
            </Button>
          ) : null}
          {canRevoke ? (
            <Button
              status='danger'
              icon={<CloseOne theme='outline' size='15' />}
              disabled={routeDenied}
              loading={actionTarget === `${profile.providerKey}:revokeProvider`}
              onClick={onRevoke}
            >
              Disconnect
            </Button>
          ) : null}
        </div>
      </div>

      <div className='mt-12px grid grid-cols-1 gap-6px text-12px leading-18px text-t-secondary md:grid-cols-3'>
        <span>State: {profile.summaryText}</span>
        <span>Expires: {profile.expiresAt ?? '-'}</span>
        <span>Last checked: {profile.lastCheckedAt ?? profile.lastValidatedAt ?? '-'}</span>
        <span>Source: {profile.sourcePointer ?? '-'}</span>
        <span>Audit: {profile.auditId ?? '-'}</span>
        <span>Grant: {profile.hasBrokeredGrant ? 'brokered' : '-'}</span>
      </div>

      {profile.capabilities.length > 0 || profile.grantedScopes.length > 0 ? (
        <div className='mt-12px flex flex-wrap gap-6px'>
          {profile.capabilities.map((capability) => (
            <Tag key={`capability:${profile.providerKey}:${capability}`}>{capability}</Tag>
          ))}
          {profile.grantedScopes.map((scope) => (
            <Tag key={`scope:${profile.providerKey}:${scope}`} color='blue'>
              {scope}
            </Tag>
          ))}
        </div>
      ) : null}

      {profile.rawSecretsStoredInWorkbench ? (
        <div className='mt-10px flex items-start gap-8px text-12px leading-18px text-[rgb(var(--warning-6))]'>
          <Attention theme='outline' size='15' className='mt-1px shrink-0' />
          <span>Provider blocked because the broker reported raw local secrets.</span>
        </div>
      ) : null}
    </article>
  );
};

const SummaryTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 px-14px py-12px'>
    <div className='text-12px leading-18px text-t-secondary'>{label}</div>
    <div className='mt-6px truncate text-18px font-semibold leading-24px text-t-primary'>{value}</div>
  </div>
);

function actionSummary(result: IEvaosProviderActionResult): string {
  const message = safeUiText(result.message, result.status).replace(/[.]+$/, '');
  const authTarget = result.authUrlSummary?.displayText ? ` Auth handoff: ${result.authUrlSummary.displayText}.` : '';
  const audit = result.auditId ? ` Audit ${result.auditId}.` : '';
  return `${result.providerKey} ${message}.${authTarget}${audit}`;
}

export default ConnectedAppsPage;
