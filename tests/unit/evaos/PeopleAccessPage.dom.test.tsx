/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearEvaosCustomerContext } from '@/renderer/hooks/context/EvaosCustomerContext';
import PeopleAccessPage from '@/renderer/pages/people-access';

const brokerMocks = vi.hoisted(() => ({
  getCustomerTargets: vi.fn(),
}));

const peopleAccessMocks = vi.hoisted(() => ({
  getPolicy: vi.fn(),
  inviteMember: vi.fn(),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  evaosBroker: {
    getCustomerTargets: {
      invoke: brokerMocks.getCustomerTargets,
    },
  },
  evaosPeopleAccess: {
    getPolicy: {
      invoke: peopleAccessMocks.getPolicy,
    },
    inviteMember: {
      invoke: peopleAccessMocks.inviteMember,
    },
  },
}));

function policy(scopes: string[], overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function customerTargets() {
  return {
    success: true,
    data: {
      roles: ['admin'],
      isOperator: true,
      defaultCustomerId: 'david-poku',
      selectedCustomerId: 'david-poku',
      customers: [
        {
          customerId: 'david-poku',
          displayName: 'David Poku Co',
          status: 'active',
          healthStatus: 'ready',
          isDefault: true,
        },
        {
          customerId: 'second-customer',
          displayName: 'Second Customer',
          status: 'active',
          healthStatus: 'ready',
          isDefault: false,
        },
      ],
      summaryText: '2 customer targets loaded',
    },
  };
}

function noCustomerTargets() {
  return {
    success: true,
    data: {
      roles: [],
      isOperator: false,
      defaultCustomerId: undefined,
      selectedCustomerId: undefined,
      customers: [],
      summaryText: 'No customer targets loaded',
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('PeopleAccessPage', () => {
  beforeEach(() => {
    clearEvaosCustomerContext();
    brokerMocks.getCustomerTargets.mockReset();
    brokerMocks.getCustomerTargets.mockResolvedValue(customerTargets());
    peopleAccessMocks.getPolicy.mockReset();
    peopleAccessMocks.inviteMember.mockReset();
  });

  it('renders loaded members, roles, seats, invites, policy badges, and backend source metadata', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy.mockResolvedValue({
      success: true,
      data: policy(['manage_members', 'open_business_browser', 'view_company_brain'], {
        membershipRole: 'billing_admin',
        seatLimit: 4,
        activeSeats: 2,
        invitedSeats: 2,
        planCode: 'beta-team',
        updatedAt: '2026-06-04T10:00:00.000Z',
        advancedSurfaces: {
          business_browser: true,
          company_brain: true,
          terminal: false,
        },
        members: [
          {
            memberId: 'mem_owner',
            email: 'owner@example.test',
            displayName: 'Owner Persona',
            role: 'admin',
            seatType: 'full',
            status: 'active',
            joinedAt: '2026-05-01T00:00:00.000Z',
            lastActiveAt: '2026-06-03T11:00:00.000Z',
          },
          {
            memberId: 'mem_agent',
            email: 'agent@example.test',
            displayName: 'Agent Seat',
            role: 'agent_only',
            seatType: 'agent',
            status: 'suspended',
          },
        ],
        invites: [
          {
            inviteId: 'inv_pending',
            email: 'pending@example.test',
            role: 'member',
            status: 'pending',
            expiresAt: '2026-06-11T00:00:00.000Z',
            invitedAt: '2026-06-04T00:00:00.000Z',
          },
          {
            inviteId: 'inv_expired',
            email: 'expired@example.test',
            role: 'manager',
            status: 'expired',
            expiresAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      }),
    });

    render(<PeopleAccessPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Owner Persona')).toBeInTheDocument();
    expect(screen.getByText('Agent Seat')).toBeInTheDocument();
    expect(screen.getByText('Agent Only')).toBeInTheDocument();
    expect(screen.getByText('suspended')).toBeInTheDocument();
    expect(screen.getByText('full seat')).toBeInTheDocument();
    expect(screen.getByText('agent seat')).toBeInTheDocument();
    expect(screen.getByText('4 of 4')).toBeInTheDocument();
    expect(screen.getByText('Seat limit reached')).toBeInTheDocument();
    expect(screen.getByText('2 invites')).toBeInTheDocument();
    expect(screen.getByText('1 pending')).toBeInTheDocument();
    expect(screen.getByText('pending@example.test')).toBeInTheDocument();
    expect(screen.getByText('expired@example.test')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Policy source: backend account policy')).toBeInTheDocument();
    expect(screen.getByText('Backend denial source: backend account policy')).toBeInTheDocument();
    expect(screen.getByText('Plan: beta-team')).toBeInTheDocument();
    expect(screen.getByText('Updated: 2026-06-04T10:00:00.000Z')).toBeInTheDocument();
    expect(screen.getByText('business_browser: allowed')).toBeInTheDocument();
    expect(screen.getByText('terminal: denied')).toBeInTheDocument();
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

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
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

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Route denied')).toBeInTheDocument();
    expect(
      screen.getByText('People Access requires the manage_members scope for this customer account.')
    ).toBeInTheDocument();
    expect(screen.getByText('Route denial source: backend account policy')).toBeInTheDocument();
    expect(screen.getByText('Action denial source: backend account policy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^invite$/i })).toBeDisabled();
    expect(peopleAccessMocks.inviteMember).not.toHaveBeenCalled();
  });

  it('keeps invite actions disabled when backend policy proof is missing', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy.mockResolvedValue({
      success: true,
      data: policy(['manage_members'], {
        backendEnforced: false,
        auditId: undefined,
      }),
    });

    render(<PeopleAccessPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect((await screen.findAllByText('Backend proof missing')).length).toBeGreaterThan(0);
    expect(screen.getByText('Invite actions require backend-enforced account policy proof.')).toBeInTheDocument();
    expect(screen.getByText('Action denial source: missing backend proof')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^invite$/i })).toBeDisabled();
    expect(peopleAccessMocks.inviteMember).not.toHaveBeenCalled();
  });

  it('renders honest no-customer copy without calling the People Access policy bridge', async () => {
    const user = userEvent.setup();
    brokerMocks.getCustomerTargets.mockReset();
    brokerMocks.getCustomerTargets.mockResolvedValue(noCustomerTargets());

    render(<PeopleAccessPage />);

    expect(await screen.findByText('No customer targets loaded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^refresh$/i }));

    expect(screen.getByText('Choose a customer before loading People Access.')).toBeInTheDocument();
    expect(peopleAccessMocks.getPolicy).not.toHaveBeenCalled();
  });

  it('renders offline policy load denial with backend source metadata', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy.mockRejectedValue(new Error('offline'));

    render(<PeopleAccessPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('People Access broker request failed closed.')).toBeInTheDocument();
    expect(screen.getByText('Policy source: backend unavailable')).toBeInTheDocument();
  });

  it('renders backend policy denial without leaking broker secret text', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy.mockResolvedValue({
      success: false,
      msg: 'eds_raw_policy_secret should not render',
    });

    const { container } = render(<PeopleAccessPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('People Access failed closed.')).toBeInTheDocument();
    expect(screen.getByText('Policy source: backend denied')).toBeInTheDocument();
    expect(container.textContent).not.toContain('eds_raw_policy_secret');
  });

  it('clears policy evidence when customer context changes before loading the next customer', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy.mockResolvedValue({
      success: true,
      data: policy(['manage_members']),
    });

    render(<PeopleAccessPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect((await screen.findAllByText('owner@example.test')).length).toBeGreaterThan(0);
    expect(screen.getByText(/audit_policy_123/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Second Customer' }));

    expect(screen.queryByText('owner@example.test')).not.toBeInTheDocument();
    expect(screen.queryByText(/audit_policy_123/)).not.toBeInTheDocument();
    expect(screen.getByText('Load a customer account policy to view People Access.')).toBeInTheDocument();
    expect(peopleAccessMocks.getPolicy).toHaveBeenCalledTimes(1);
  });

  it('uses the selected non-default customer for policy loads and invites', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy.mockResolvedValue({
      success: true,
      data: policy(['manage_members'], {
        selectedCustomerId: 'second-customer',
        members: [
          {
            memberId: 'mem_second',
            email: 'second-owner@example.test',
            role: 'owner',
            status: 'active',
          },
        ],
      }),
    });
    peopleAccessMocks.inviteMember.mockResolvedValue({
      success: true,
      data: {
        status: 'created',
        message: 'Invite created.',
        inviteId: 'inv_second',
        backendEnforced: true,
      },
    });

    render(<PeopleAccessPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Second Customer' }));
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect((await screen.findAllByText('second-owner@example.test')).length).toBeGreaterThan(0);
    expect(peopleAccessMocks.getPolicy).toHaveBeenCalledWith({ customerId: 'second-customer' });

    await user.type(screen.getByPlaceholderText('employee@example.com'), 'new@example.test');
    await user.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() => {
      expect(peopleAccessMocks.inviteMember).toHaveBeenCalledWith({
        customerId: 'second-customer',
        email: 'new@example.test',
        role: 'member',
      });
    });
  });

  it('does not render stale policy evidence when the selected customer changes before the broker responds', async () => {
    const user = userEvent.setup();
    const pendingPolicy = deferred<{
      success: boolean;
      data: ReturnType<typeof policy>;
    }>();
    peopleAccessMocks.getPolicy.mockReturnValueOnce(pendingPolicy.promise);

    render(<PeopleAccessPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(peopleAccessMocks.getPolicy).toHaveBeenCalledWith({ customerId: 'david-poku' });

    await user.click(screen.getByRole('button', { name: 'Second Customer' }));

    await act(async () => {
      pendingPolicy.resolve({
        success: true,
        data: policy(['manage_members']),
      });
      await pendingPolicy.promise;
    });

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

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    await screen.findAllByText('owner@example.test');

    await user.type(screen.getByPlaceholderText('employee@example.com'), 'new@example.test');
    await user.click(screen.getByRole('button', { name: /^invite$/i }));

    expect(await screen.findByText('Backend denied the invite action.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('eds_raw_backend_secret');
  });

  it('lets operators retry customer targets after a broker failure', async () => {
    const user = userEvent.setup();
    brokerMocks.getCustomerTargets.mockReset();
    brokerMocks.getCustomerTargets
      .mockResolvedValueOnce({
        success: false,
        msg: 'eds_raw_customer_target_secret should not render',
      })
      .mockResolvedValueOnce(customerTargets());

    const { container } = render(<PeopleAccessPage />);

    expect(await screen.findByText('Customer targets failed closed.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('eds_raw_customer_target_secret');

    await user.click(screen.getByRole('button', { name: /^refresh targets$/i }));

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    expect(brokerMocks.getCustomerTargets).toHaveBeenCalledTimes(2);
  });
});
