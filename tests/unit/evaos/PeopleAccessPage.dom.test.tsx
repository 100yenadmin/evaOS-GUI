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
    expect(screen.getByText('beta-owner')).toBeInTheDocument();
    expect(screen.queryByText(/dashboard\/invites|Website handoff|Open dashboard/i)).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('email@company.com'), 'teammate@example.test');
    await user.click(screen.getByRole('button', { name: /^send invite$/i }));

    await waitFor(() =>
      expect(peopleAccessMocks.inviteMember).toHaveBeenCalledWith({
        customerId: 'david-poku',
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
});
