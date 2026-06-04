/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import classNames from 'classnames';
import { Button, Input, Spin, Tag } from '@arco-design/web-react';
import { Attention, CloseOne, Refresh, Shield } from '@icon-park/react';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import {
  evaosApprovalCenter,
  type IEvaosApprovalCenterView,
  type IEvaosApprovalDecisionResult,
  type IEvaosApprovalRequestView,
} from '@/common/adapter/ipcBridge';

const SECRET_TEXT_PATTERN =
  /(eds_|epg_|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|authorization|bearer|secret|password)/i;

function safeUiText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
}

function riskColor(riskClass: IEvaosApprovalRequestView['riskClass']): 'red' | 'orange' | 'blue' {
  if (riskClass === 'critical') return 'red';
  if (riskClass === 'warning') return 'orange';
  return 'blue';
}

const ApprovalCenterPage: React.FC = () => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [customerId, setCustomerId] = useState('');
  const [center, setCenter] = useState<IEvaosApprovalCenterView | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [decisionStatus, setDecisionStatus] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decidingApprovalId, setDecidingApprovalId] = useState<string | null>(null);

  const handleCustomerChange = useCallback((value: string) => {
    setCustomerId(value);
    setCenter(null);
    setApprovalError(null);
    setDecisionStatus(null);
    setDecisionError(null);
    setDecidingApprovalId(null);
  }, []);

  const loadApprovals = useCallback(
    async (options: { resetDecisionStatus?: boolean } = {}) => {
      const trimmedCustomerId = customerId.trim();
      if (options.resetDecisionStatus !== false) {
        setDecisionStatus(null);
        setDecisionError(null);
      }
      if (!trimmedCustomerId) {
        setCenter(null);
        setApprovalError('Choose a customer before loading approvals.');
        return;
      }

      setLoadingApprovals(true);
      setApprovalError(null);
      try {
        const response = await evaosApprovalCenter.getApprovals.invoke({ customerId: trimmedCustomerId, limit: 50 });
        if (!response.success || !response.data) {
          setCenter(null);
          setApprovalError(safeUiText(response.msg, 'Approval Center failed closed.'));
          return;
        }
        setCenter(response.data);
      } catch {
        setCenter(null);
        setApprovalError('Approval Center broker request failed closed.');
      } finally {
        setLoadingApprovals(false);
      }
    },
    [customerId]
  );

  const denyApproval = useCallback(
    async (approval: IEvaosApprovalRequestView) => {
      const trimmedCustomerId = customerId.trim();
      setDecisionStatus(null);
      setDecisionError(null);
      if (!center || center.routeDenied || !approval.canDeny) {
        setDecisionError('Action denied by account policy.');
        return;
      }

      setDecidingApprovalId(approval.approvalId);
      try {
        const response = await evaosApprovalCenter.denyApproval.invoke({
          customerId: trimmedCustomerId,
          approvalId: approval.approvalId,
          reason: 'Denied from AionUi public beta Approval Center.',
        });
        if (!response.success || !response.data) {
          setDecisionError(safeUiText(response.msg, 'Backend denied the approval decision.'));
          return;
        }
        await loadApprovals({ resetDecisionStatus: false });
        setDecisionStatus(decisionSummary(response.data));
      } catch {
        setDecisionError('Backend denied the approval decision.');
      } finally {
        setDecidingApprovalId(null);
      }
    },
    [center, customerId, loadApprovals]
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
            <h1 className='m-0 text-28px leading-34px font-bold text-t-primary max-sm:text-24px'>Approval Center</h1>
            <p className='m-0 mt-4px max-w-720px text-14px leading-22px text-t-secondary'>
              Human decisions for risky agent actions, backed by evaOS policy and audit evidence.
            </p>
          </div>
          <Button
            type='primary'
            icon={<Refresh theme='outline' size='16' />}
            loading={loadingApprovals}
            onClick={() => void loadApprovals()}
          >
            Refresh
          </Button>
        </header>

        <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
          <label className='block text-13px font-medium leading-20px text-t-primary' htmlFor='approval-customer-id'>
            Customer context
          </label>
          <div className='mt-8px flex gap-8px max-[520px]:flex-col'>
            <Input
              id='approval-customer-id'
              value={customerId}
              placeholder='Customer ID or slug'
              onChange={handleCustomerChange}
              onPressEnter={() => void loadApprovals()}
            />
            <Button className='shrink-0' loading={loadingApprovals} onClick={() => void loadApprovals()}>
              Load
            </Button>
          </div>
          {approvalError ? (
            <p className='m-0 mt-8px text-12px leading-18px text-[rgb(var(--warning-6))]'>{approvalError}</p>
          ) : null}
        </section>

        {loadingApprovals ? (
          <div className='flex min-h-220px items-center justify-center rounded-8px border border-dashed border-[var(--color-border-2)] bg-fill-1'>
            <Spin />
          </div>
        ) : center ? (
          <>
            <section className='grid grid-cols-1 gap-10px md:grid-cols-4'>
              <SummaryTile label='Status' value={center.summaryText} />
              <SummaryTile label='Role' value={center.membershipRole ?? '-'} />
              <SummaryTile label='Pending' value={String(center.requests.length)} />
              <SummaryTile label='Audit' value={center.auditId ?? center.policyAuditId ?? '-'} />
            </section>

            {center.routeDenied ? (
              <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
                <div className='flex items-start gap-10px text-[rgb(var(--warning-6))]'>
                  <Attention theme='outline' size='18' className='mt-2px shrink-0' />
                  <div className='min-w-0'>
                    <h2 className='m-0 text-15px font-semibold leading-22px'>Route denied</h2>
                    <p className='m-0 mt-4px text-13px leading-20px'>
                      {center.routeDenialReason ?? 'This customer account does not allow approval decisions.'}
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            {decisionStatus ? (
              <p className='m-0 rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px text-13px leading-20px text-[rgb(var(--success-6))]'>
                {decisionStatus}
              </p>
            ) : null}
            {decisionError ? (
              <p className='m-0 rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px text-13px leading-20px text-[rgb(var(--warning-6))]'>
                {decisionError}
              </p>
            ) : null}

            <section className='flex flex-col gap-10px'>
              {center.routeDenied ? null : center.requests.length === 0 ? (
                <div className='rounded-8px border border-dashed border-[var(--color-border-2)] bg-fill-1 p-16px text-13px leading-20px text-t-secondary'>
                  No pending approval evidence returned.
                </div>
              ) : (
                center.requests.map((approval) => (
                  <ApprovalRow
                    key={approval.approvalId}
                    approval={approval}
                    routeDenied={center.routeDenied}
                    deciding={decidingApprovalId === approval.approvalId}
                    onDeny={() => void denyApproval(approval)}
                  />
                ))
              )}
            </section>
          </>
        ) : (
          <div className='rounded-8px border border-dashed border-[var(--color-border-2)] bg-fill-1 p-16px text-13px leading-20px text-t-secondary'>
            Load a customer account to review pending approval requests.
          </div>
        )}
      </div>
    </div>
  );
};

const ApprovalRow: React.FC<{
  approval: IEvaosApprovalRequestView;
  routeDenied: boolean;
  deciding: boolean;
  onDeny: () => void;
}> = ({ approval, routeDenied, deciding, onDeny }) => (
  <article className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
    <div className='flex flex-wrap items-start justify-between gap-10px'>
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center gap-6px'>
          <Tag color={riskColor(approval.riskClass)}>{approval.riskClass}</Tag>
          <Tag>{approval.toolName}</Tag>
          <Tag color={approval.destinationPreview.actionable ? 'green' : 'orange'}>
            {approval.destinationPreview.actionable ? 'destination proof' : 'missing destination'}
          </Tag>
        </div>
        <h2 className='m-0 mt-10px text-17px font-semibold leading-24px text-t-primary'>
          {approval.destinationPreview.primary}
        </h2>
        {approval.destinationPreview.secondary ? (
          <p className='m-0 mt-4px text-13px leading-20px text-t-secondary'>{approval.destinationPreview.secondary}</p>
        ) : null}
      </div>
      <Button
        status='danger'
        icon={<CloseOne theme='outline' size='15' />}
        disabled={routeDenied || !approval.canDeny}
        loading={deciding}
        onClick={onDeny}
      >
        Deny
      </Button>
    </div>
    {approval.destinationPreview.warning ? (
      <p className='m-0 mt-10px text-12px leading-18px text-[rgb(var(--warning-6))]'>
        {approval.destinationPreview.warning}
      </p>
    ) : null}
    <div className='mt-12px grid grid-cols-1 gap-6px text-12px leading-18px text-t-secondary md:grid-cols-3'>
      <span>Agent: {approval.agentId}</span>
      <span>Created: {approval.createdAt}</span>
      <span>Expires: {approval.expiresAt ?? '-'}</span>
      <span>Source: {approval.sourcePointer}</span>
      <span>Audit: {approval.auditId ?? '-'}</span>
      <span>Proof: {approval.destinationProof?.fingerprint ?? '-'}</span>
    </div>
    <div className='mt-10px flex items-start gap-8px text-12px leading-18px text-t-secondary'>
      <Shield theme='outline' size='15' className='mt-1px shrink-0' />
      <span>{approval.nextAction}</span>
    </div>
  </article>
);

const SummaryTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 px-14px py-12px'>
    <div className='text-12px leading-18px text-t-secondary'>{label}</div>
    <div className='mt-6px truncate text-18px font-semibold leading-24px text-t-primary'>{value}</div>
  </div>
);

function decisionSummary(result: IEvaosApprovalDecisionResult): string {
  const runtime = result.runtimeResult?.runtime ? `${result.runtimeResult.runtime}: ` : '';
  const audit = result.runtimeResult?.auditId ?? result.auditId;
  return `Approval ${result.status}. ${runtime}${result.runtimeResult?.status ?? 'runtime resolved'}${
    audit ? ` Audit ${audit}.` : ''
  }`;
}

export default ApprovalCenterPage;
