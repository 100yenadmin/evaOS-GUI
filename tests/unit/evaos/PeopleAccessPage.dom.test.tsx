/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PeopleAccessPage from '@/renderer/pages/people-access';

const peopleAccessMocks = vi.hoisted(() => ({
  getPolicy: vi.fn(),
  inviteMember: vi.fn(),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  evaosPeopleAccess: {
    getPolicy: {
      invoke: peopleAccessMocks.getPolicy,
    },
    inviteMember: {
      invoke: peopleAccessMocks.inviteMember,
    },
  },
}));

function policy(scopes: string[]) {
  return {
    schemaVersion: 'evaos.account_policy.v1',
    customerAccountId: 'acct_123',
    selectedCustomerId: 'david-poku',
    membershipRole: 'admin',
    planCode: 'biz',
    seatLimit: 3,
    activeSeats: 2,
    invitedSeats: 0,
    scopes,
    advancedSurfaces: {
      terminal: false,
    },
    members: [
      {
        memberId: 'mem_owner',
        email: 'owner@example.test',
        role: 'owner',
        status: 'active',
      },
    ],
    invites: [],
    routeDenied: !scopes.includes('manage_members'),
    routeDenialReason: !scopes.includes('manage_members')
      ? 'People Access requires the manage_members scope for this customer account.'
      : undefined,
    backendEnforced: true,
    auditId: 'audit_policy_123',
  };
}

describe('PeopleAccessPage', () => {
  beforeEach(() => {
    peopleAccessMocks.getPolicy.mockReset();
    peopleAccessMocks.inviteMember.mockReset();
  });

  it('loads policy evidence and sends member invites through the broker bridge', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy
      .mockResolvedValueOnce({
        success: true,
        data: policy(['manage_members', 'open_business_browser', 'view_company_brain']),
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          ...policy(['manage_members', 'open_business_browser', 'view_company_brain']),
          invitedSeats: 1,
        },
      });
    peopleAccessMocks.inviteMember.mockResolvedValue({
      success: true,
      data: {
        status: 'created',
        message: 'Invite created.',
        inviteId: 'inv_456',
        backendEnforced: true,
      },
    });

    const { container } = render(<PeopleAccessPage />);

    await user.type(screen.getByLabelText('Customer context'), 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect((await screen.findAllByText('owner@example.test')).length).toBeGreaterThan(0);
    expect(screen.getByText(/audit_policy_123/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('employee@example.com'), 'new@example.test');
    await user.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() => {
      expect(peopleAccessMocks.inviteMember).toHaveBeenCalledWith({
        customerId: 'david-poku',
        email: 'new@example.test',
        role: 'member',
      });
    });
    expect(await screen.findByText('Invite created.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/eds_|epg_|access_token|desktop_session|provider_grant|Bearer/i);
  });

  it('renders route denial and keeps invite action disabled without calling the backend mutation', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy.mockResolvedValue({
      success: true,
      data: policy(['open_business_browser']),
    });

    render(<PeopleAccessPage />);

    await user.type(screen.getByLabelText('Customer context'), 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Route denied')).toBeInTheDocument();
    expect(
      screen.getByText('People Access requires the manage_members scope for this customer account.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^invite$/i })).toBeDisabled();
    expect(peopleAccessMocks.inviteMember).not.toHaveBeenCalled();
  });

  it('clears policy evidence when customer context changes before loading the next customer', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy.mockResolvedValue({
      success: true,
      data: policy(['manage_members']),
    });

    render(<PeopleAccessPage />);

    const customerInput = screen.getByLabelText('Customer context');
    await user.type(customerInput, 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect((await screen.findAllByText('owner@example.test')).length).toBeGreaterThan(0);
    expect(screen.getByText(/audit_policy_123/)).toBeInTheDocument();

    await user.clear(customerInput);
    await user.type(customerInput, 'second-customer');

    expect(screen.queryByText('owner@example.test')).not.toBeInTheDocument();
    expect(screen.queryByText(/audit_policy_123/)).not.toBeInTheDocument();
    expect(screen.getByText('Load a customer account policy to view People Access.')).toBeInTheDocument();
  });

  it('renders backend denial without leaking broker secret text', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy.mockResolvedValue({
      success: true,
      data: policy(['manage_members']),
    });
    peopleAccessMocks.inviteMember.mockResolvedValue({
      success: false,
      msg: 'eds_raw_backend_secret should not render',
    });

    const { container } = render(<PeopleAccessPage />);

    await user.type(screen.getByLabelText('Customer context'), 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    await screen.findAllByText('owner@example.test');

    await user.type(screen.getByPlaceholderText('employee@example.com'), 'new@example.test');
    await user.click(screen.getByRole('button', { name: /^invite$/i }));

    expect(await screen.findByText('Backend denied the invite action.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('eds_raw_backend_secret');
  });
});
