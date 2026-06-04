/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ApprovalCenterPage from '@/renderer/pages/approval-center';

const approvalCenterMocks = vi.hoisted(() => ({
  getApprovals: vi.fn(),
  denyApproval: vi.fn(),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  evaosApprovalCenter: {
    getApprovals: {
      invoke: approvalCenterMocks.getApprovals,
    },
    denyApproval: {
      invoke: approvalCenterMocks.denyApproval,
    },
  },
}));

function approvalCenter(routeDenied = false) {
  return {
    schemaVersion: 'evaos.approval_center.v1',
    customerId: 'david-poku',
    customerAccountId: 'acct_123',
    membershipId: 'mem_approver',
    membershipRole: 'admin',
    routeDenied,
    routeDenialReason: routeDenied
      ? 'Approval Center requires the approve_actions scope for this customer account.'
      : undefined,
    backendEnforced: true,
    requests: routeDenied
      ? []
      : [
          {
            approvalId: 'approval-email-1',
            ownerId: 'owner_123',
            agentId: 'agent_email',
            requesterMembershipId: 'mem_requester',
            toolName: 'gmail.send',
            riskClass: 'critical',
            destinationPreview: {
              kind: 'email_recipient',
              primary: 'attacker@example.net',
              secondary: 'Wire instructions',
              bodyExcerpt: 'Please send payment.',
              actionable: true,
            },
            destinationProof: {
              kind: 'email_recipient',
              fingerprint: 'dest-abc123',
              summary: 'email_recipient: attacker@example.net',
              source: 'aionui_preview',
              sourcePointer: 'approval:approval-email-1',
            },
            allowAlwaysSupported: true,
            availableDecisions: ['allow-once', 'allow-always', 'deny'],
            canAllowOnce: true,
            canAllowAlways: true,
            canDeny: true,
            createdAt: '2026-06-03T11:59:00.000Z',
            expiresAt: '2026-06-03T12:10:00.000Z',
            sourcePointer: 'approval:approval-email-1',
            auditId: 'audit_request_123',
            nextAction: 'Critical action. Verify the actual destination before deciding.',
          },
        ],
    summaryText: routeDenied ? 'Approval Center denied by account policy' : '1 pending approval',
    auditId: 'audit_list_123',
    policyAuditId: 'audit_policy_123',
  };
}

describe('ApprovalCenterPage', () => {
  beforeEach(() => {
    approvalCenterMocks.getApprovals.mockReset();
    approvalCenterMocks.denyApproval.mockReset();
  });

  it('loads approval evidence and sends deny decisions through the broker bridge', async () => {
    const user = userEvent.setup();
    approvalCenterMocks.getApprovals
      .mockResolvedValueOnce({
        success: true,
        data: approvalCenter(false),
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          ...approvalCenter(false),
          requests: [],
          summaryText: 'No pending approvals',
        },
      });
    approvalCenterMocks.denyApproval.mockResolvedValue({
      success: true,
      data: {
        status: 'denied',
        decision: 'deny',
        scope: 'this-call',
        approvalId: 'approval-email-1',
        runtimeResult: {
          status: 'denied',
          runtime: 'openclaw',
          sourcePointer: 'approval-result:approval-email-1',
          auditId: 'audit_result_123',
        },
        backendEnforced: true,
      },
    });

    const { container } = render(<ApprovalCenterPage />);

    await user.type(screen.getByLabelText('Customer context'), 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('attacker@example.net')).toBeInTheDocument();
    expect(screen.getByText(/audit_request_123/)).toBeInTheDocument();
    expect(container.textContent).not.toContain('Please send payment.');

    await user.click(screen.getByRole('button', { name: /^deny$/i }));

    await waitFor(() => {
      expect(approvalCenterMocks.denyApproval).toHaveBeenCalledWith({
        customerId: 'david-poku',
        approvalId: 'approval-email-1',
        reason: 'Denied from AionUi public beta Approval Center.',
      });
    });
    expect(await screen.findByText('Approval denied. openclaw: denied Audit audit_result_123.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/eds_|epg_|access_token|desktop_session|provider_grant|Bearer/i);
  });

  it('renders route denial and keeps decision actions off the backend mutation path', async () => {
    const user = userEvent.setup();
    approvalCenterMocks.getApprovals.mockResolvedValue({
      success: true,
      data: approvalCenter(true),
    });

    render(<ApprovalCenterPage />);

    await user.type(screen.getByLabelText('Customer context'), 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Route denied')).toBeInTheDocument();
    expect(
      screen.getByText('Approval Center requires the approve_actions scope for this customer account.')
    ).toBeInTheDocument();
    expect(approvalCenterMocks.denyApproval).not.toHaveBeenCalled();
  });

  it('clears approval evidence when customer context changes before loading the next customer', async () => {
    const user = userEvent.setup();
    approvalCenterMocks.getApprovals.mockResolvedValue({
      success: true,
      data: approvalCenter(false),
    });

    render(<ApprovalCenterPage />);

    const customerInput = screen.getByLabelText('Customer context');
    await user.type(customerInput, 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('attacker@example.net')).toBeInTheDocument();
    expect(screen.getByText(/audit_request_123/)).toBeInTheDocument();

    await user.clear(customerInput);
    await user.type(customerInput, 'second-customer');

    expect(screen.queryByText('attacker@example.net')).not.toBeInTheDocument();
    expect(screen.queryByText(/audit_request_123/)).not.toBeInTheDocument();
    expect(screen.getByText('Load a customer account to review pending approval requests.')).toBeInTheDocument();
  });

  it('renders backend denial without leaking broker secret text', async () => {
    const user = userEvent.setup();
    approvalCenterMocks.getApprovals.mockResolvedValue({
      success: true,
      data: approvalCenter(false),
    });
    approvalCenterMocks.denyApproval.mockResolvedValue({
      success: false,
      msg: 'eds_raw_backend_secret should not render',
    });

    const { container } = render(<ApprovalCenterPage />);

    await user.type(screen.getByLabelText('Customer context'), 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    await screen.findByText('attacker@example.net');

    await user.click(screen.getByRole('button', { name: /^deny$/i }));

    expect(await screen.findByText('Backend denied the approval decision.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('eds_raw_backend_secret');
  });
});
