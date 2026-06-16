/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearEvaosCustomerContext } from '@/renderer/hooks/context/EvaosCustomerContext';
import PeopleAccessPage from '@/renderer/pages/people-access';

const brokerMocks = vi.hoisted(() => ({
  getSessionStatus: vi.fn(),
  getCustomerTargets: vi.fn(),
}));

const peopleAccessMocks = vi.hoisted(() => ({
  getPolicy: vi.fn(),
  inviteMember: vi.fn(),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'common.refresh': 'Refresh',
        'common.status': 'status',
        'evaos.peopleAccess.actionDenied': 'Action denied by account policy.',
        'evaos.peopleAccess.chooseCustomer': 'Choose a customer before loading People & Access.',
        'evaos.peopleAccess.differentAccount':
          'People & Access broker returned evidence for a different customer account.',
        'evaos.peopleAccess.emailPlaceholder': 'email@company.com',
        'evaos.peopleAccess.enterEmail': 'Enter an email address before sending an invite.',
        'evaos.peopleAccess.failedClosed': 'People & Access failed closed.',
        'evaos.peopleAccess.inviteFailedClosed': 'People & Access invite failed closed.',
        'evaos.peopleAccess.inviteStatus': `Invite ${String(values?.status ?? 'updated')}.`,
        'evaos.peopleAccess.requestFailed': 'People & Access broker request failed closed.',
        'evaos.peopleAccess.roles.admin': 'Admin',
        'evaos.peopleAccess.roles.agentOnly': 'Agent only',
        'evaos.peopleAccess.roles.billingAdmin': 'Billing admin',
        'evaos.peopleAccess.roles.manager': 'Manager',
        'evaos.peopleAccess.roles.member': 'Member',
        'evaos.peopleAccess.roles.owner': 'Owner',
        'evaos.peopleAccess.roles.support': 'Support',
        'evaos.peopleAccess.roles.technicalAdmin': 'Technical admin',
        'evaos.peopleAccess.sendInvite': 'Send invite',
        'evaos.peopleAccess.status.accepted': 'Accepted',
        'evaos.peopleAccess.status.active': 'Active',
        'evaos.peopleAccess.status.disabled': 'Disabled',
        'evaos.peopleAccess.status.expired': 'Expired',
        'evaos.peopleAccess.status.invited': 'Invited',
        'evaos.peopleAccess.status.pending': 'Pending',
        'evaos.peopleAccess.status.revoked': 'Revoked',
        'evaos.shared.unknown': 'Unknown',
        'evaos.shared.load': 'Load',
        'evaos.shared.refreshTargets': 'Refresh targets',
        'evaos.shared.routeDenied': 'Route denied',
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  evaosBroker: {
    getSessionStatus: {
      invoke: brokerMocks.getSessionStatus,
    },
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
          customerAccountId: 'acct_david',
          membershipId: 'mem_admin',
          membershipRole: 'admin',
          targetKind: 'customer_account',
          displayName: 'David Poku Co',
          status: 'active',
          healthStatus: 'ready',
          isDefault: true,
        },
      ],
      summaryText: '1 customer target loaded',
    },
  };
}

function peoplePolicy(routeDenied = false) {
  return {
    schemaVersion: 'evaos.account_policy.v1',
    customerAccountId: 'acct_david',
    selectedCustomerId: 'david-poku',
    membershipId: 'mem_admin',
    membershipRole: 'admin',
    planCode: 'beta-owner',
    seatLimit: 8,
    activeSeats: routeDenied ? 0 : 2,
    invitedSeats: routeDenied ? 0 : 1,
    scopes: routeDenied ? [] : ['manage_members', 'manage_integrations'],
    advancedSurfaces: {
      peopleAccess: !routeDenied,
      providerHub: !routeDenied,
    },
    members: routeDenied
      ? []
      : [
          {
            memberId: 'mem_admin',
            email: 'admin@100yen.org',
            displayName: 'Admin Owner',
            role: 'admin',
            seatType: 'owner',
            status: 'active',
            joinedAt: '2026-06-03T10:00:00.000Z',
          },
        ],
    invites: routeDenied
      ? []
      : [
          {
            inviteId: 'invite_pending',
            email: 'new.member@example.test',
            role: 'member',
            status: 'pending',
            invitedAt: '2026-06-03T11:00:00.000Z',
          },
        ],
    routeDenied,
    routeDenialReason: routeDenied
      ? 'People Access requires the manage_members scope for this customer account.'
      : undefined,
    backendEnforced: true,
    updatedAt: '2026-06-03T12:00:00.000Z',
    auditId: routeDenied ? undefined : 'audit_people_policy',
  };
}

describe('PeopleAccessPage', () => {
  beforeEach(() => {
    clearEvaosCustomerContext();
    brokerMocks.getSessionStatus.mockReset();
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'authenticated',
        authenticated: true,
        expired: false,
        userEmail: 'admin@100yen.org',
        expiresAt: '2026-06-06T12:00:00.000Z',
        source: 'callback',
        message: 'Session active',
      },
    });
    brokerMocks.getCustomerTargets.mockReset();
    brokerMocks.getCustomerTargets.mockResolvedValue(customerTargets());
    peopleAccessMocks.getPolicy.mockReset();
    peopleAccessMocks.inviteMember.mockReset();
  });

  it('loads account policy evidence and sends invites through the broker bridge', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy
      .mockResolvedValueOnce({
        success: true,
        data: peoplePolicy(false),
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          ...peoplePolicy(false),
          invitedSeats: 2,
          invites: [
            ...peoplePolicy(false).invites,
            {
              inviteId: 'invite_created',
              email: 'teammate@example.test',
              role: 'member',
              status: 'pending',
            },
          ],
        },
      });
    peopleAccessMocks.inviteMember.mockResolvedValue({
      success: true,
      data: {
        status: 'invited',
        message: 'Invite sent.',
        inviteId: 'invite_created',
        backendEnforced: true,
      },
    });

    const { container } = render(<PeopleAccessPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Admin Owner')).toBeInTheDocument();
    expect(screen.getByText('new.member@example.test')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('beta-owner')).toBeInTheDocument();
    expect(screen.queryByText(/dashboard\/invites|Website handoff|Open dashboard/i)).not.toBeInTheDocument();
    expect(peopleAccessMocks.getPolicy).toHaveBeenCalledWith({
      customerId: 'david-poku',
      customerAccountId: 'acct_david',
    });

    await user.type(screen.getByPlaceholderText('email@company.com'), 'teammate@example.test');
    await user.click(screen.getByRole('button', { name: /^send invite$/i }));

    await waitFor(() =>
      expect(peopleAccessMocks.inviteMember).toHaveBeenCalledWith({
        customerId: 'david-poku',
        customerAccountId: 'acct_david',
        email: 'teammate@example.test',
        role: 'member',
      })
    );
    expect(await screen.findByText('Invite sent.')).toBeInTheDocument();
    expect(screen.getByText('teammate@example.test')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/eds_|epg_|access_token|desktop_session|provider_grant|Bearer/i);
  });

  it('renders route denial without exposing invite actions', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy.mockResolvedValue({
      success: true,
      data: peoplePolicy(true),
    });

    render(<PeopleAccessPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Route denied')).toBeInTheDocument();
    expect(
      screen.getByText('People Access requires the manage_members scope for this customer account.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^send invite$/i })).not.toBeInTheDocument();
    expect(peopleAccessMocks.inviteMember).not.toHaveBeenCalled();
  });

  it('rejects account policy evidence for a different customer account', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy.mockResolvedValue({
      success: true,
      data: {
        ...peoplePolicy(false),
        customerAccountId: 'acct_other',
      },
    });

    render(<PeopleAccessPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(
      await screen.findByText('People & Access broker returned evidence for a different customer account.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Admin Owner')).not.toBeInTheDocument();
  });

  it('shows invite failures without exposing backend output', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy.mockResolvedValue({
      success: true,
      data: peoplePolicy(false),
    });
    peopleAccessMocks.inviteMember.mockResolvedValue({
      success: false,
      msg: 'backend denial for invite',
    });

    const { container } = render(<PeopleAccessPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    await user.type(screen.getByPlaceholderText('email@company.com'), 'teammate@example.test');
    await user.click(screen.getByRole('button', { name: /^send invite$/i }));

    expect(await screen.findByText('backend denial for invite')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/eds_|epg_|access_token|desktop_session|provider_grant|Bearer/i);
  });

  it('shows getPolicy failures without exposing secret-bearing broker output', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy.mockResolvedValue({
      success: false,
      msg: 'desktop_session=eds_secret_request denied',
    });

    const { container } = render(<PeopleAccessPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('People & Access failed closed.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/eds_|desktop_session|Bearer/i);
  });

  it('shows request failure when getPolicy throws', async () => {
    const user = userEvent.setup();
    peopleAccessMocks.getPolicy.mockRejectedValue(new Error('network down'));

    render(<PeopleAccessPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('People & Access broker request failed closed.')).toBeInTheDocument();
  });

  it('does not load policy when the session has no customer targets', async () => {
    const user = userEvent.setup();
    brokerMocks.getCustomerTargets.mockResolvedValue({
      success: true,
      data: {
        roles: [],
        isOperator: false,
        defaultCustomerId: undefined,
        selectedCustomerId: undefined,
        customers: [],
        summaryText: 'No customer targets loaded',
      },
    });

    render(<PeopleAccessPage />);

    expect(await screen.findByText('No customer targets loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^load$/i })).toBeDisabled();
    expect(peopleAccessMocks.getPolicy).not.toHaveBeenCalled();
  });

  it('keeps People & Access empty when the desktop session is unauthenticated', async () => {
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'signed_out',
        authenticated: false,
        expired: false,
        source: 'none',
        message: 'Signed out',
      },
    });

    render(<PeopleAccessPage />);

    expect(await screen.findByText('No customer targets loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^refresh$/i })).toBeDisabled();
    expect(peopleAccessMocks.getPolicy).not.toHaveBeenCalled();
  });

  it('preserves the selected customer account when targets share a customer id', async () => {
    const user = userEvent.setup();
    brokerMocks.getCustomerTargets.mockResolvedValue({
      success: true,
      data: {
        ...customerTargets().data,
        customers: [
          {
            ...customerTargets().data.customers[0],
            customerAccountId: 'acct_primary',
            displayName: 'Primary account',
            isDefault: true,
          },
          {
            ...customerTargets().data.customers[0],
            customerAccountId: 'acct_secondary',
            displayName: 'Secondary account',
            isDefault: false,
          },
        ],
      },
    });
    peopleAccessMocks.getPolicy.mockResolvedValue({
      success: true,
      data: {
        ...peoplePolicy(false),
        customerAccountId: 'acct_secondary',
      },
    });

    render(<PeopleAccessPage />);

    await user.click(await screen.findByRole('button', { name: /^secondary account$/i }));
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    await waitFor(() =>
      expect(peopleAccessMocks.getPolicy).toHaveBeenCalledWith({
        customerId: 'david-poku',
        customerAccountId: 'acct_secondary',
      })
    );
    expect(await screen.findByText('Admin Owner')).toBeInTheDocument();
  });
});
