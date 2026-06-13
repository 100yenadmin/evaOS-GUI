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
import ConnectedAppsPage from '@/renderer/pages/connected-apps';

const brokerMocks = vi.hoisted(() => ({
  getSessionStatus: vi.fn(),
  getCustomerTargets: vi.fn(),
}));

const providerHubMocks = vi.hoisted(() => ({
  getProfiles: vi.fn(),
  startAuth: vi.fn(),
  switchProvider: vi.fn(),
  revokeProvider: vi.fn(),
  mintGrant: vi.fn(),
  requestApproval: vi.fn(),
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
  evaosProviderHub: {
    getProfiles: {
      invoke: providerHubMocks.getProfiles,
    },
    startAuth: {
      invoke: providerHubMocks.startAuth,
    },
    switchProvider: {
      invoke: providerHubMocks.switchProvider,
    },
    revokeProvider: {
      invoke: providerHubMocks.revokeProvider,
    },
    mintGrant: {
      invoke: providerHubMocks.mintGrant,
    },
    requestApproval: {
      invoke: providerHubMocks.requestApproval,
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

function providerHub(routeDenied = false) {
  return {
    schemaVersion: 'evaos.provider_hub.v1',
    customerId: 'david-poku',
    customerAccountId: 'acct_david',
    membershipId: 'mem_admin',
    membershipRole: 'admin',
    routeDenied,
    routeDenialReason: routeDenied
      ? 'Connected Apps requires the manage_integrations scope for this customer account.'
      : undefined,
    backendEnforced: true,
    activeProviderKey: routeDenied ? undefined : 'google_workspace',
    profiles: routeDenied
      ? []
      : [
          {
            providerKey: 'google_workspace',
            title: 'Google Workspace',
            subtitle: 'Calendar, Gmail, and Drive',
            status: 'connected',
            active: true,
            rawSecretsStoredInWorkbench: false,
            approvalRequired: false,
            capabilities: ['mail.read', 'calendar.read'],
            usageSummary: 'Connected for Eva operations.',
            grantedScopes: ['gmail.readonly'],
            hasConnectionProof: true,
            hasBrokeredGrant: true,
            summaryText: 'Google Workspace connected.',
            auditId: 'audit_provider_google',
          },
          {
            providerKey: 'slack',
            title: 'Slack',
            subtitle: 'Team chat',
            status: 'needs_login',
            active: false,
            rawSecretsStoredInWorkbench: false,
            approvalRequired: false,
            capabilities: ['chat.write'],
            grantedScopes: [],
            hasConnectionProof: false,
            hasBrokeredGrant: false,
            summaryText: 'Slack needs login.',
          },
        ],
    summaryText: routeDenied ? 'Connected Apps denied by account policy' : '2 provider profiles loaded',
    sourcePointer: routeDenied ? undefined : 'broker:provider_profiles:david-poku',
    auditId: routeDenied ? undefined : 'audit_provider_hub',
    policyAuditId: 'audit_policy',
  };
}

describe('ConnectedAppsPage', () => {
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
    Object.values(providerHubMocks).forEach((mock) => mock.mockReset());
  });

  it('loads provider profiles and starts auth through the broker bridge', async () => {
    const user = userEvent.setup();
    providerHubMocks.getProfiles.mockResolvedValue({
      success: true,
      data: providerHub(false),
    });
    providerHubMocks.startAuth.mockResolvedValue({
      success: true,
      data: {
        status: 'pending',
        providerKey: 'slack',
        message: 'Auth handoff prepared.',
        providerHub: providerHub(false),
        backendEnforced: true,
      },
    });

    const { container } = render(<ConnectedAppsPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Google Workspace')).toBeInTheDocument();
    expect(screen.getByText('Slack')).toBeInTheDocument();
    expect(screen.getByText('Brokered grant')).toBeInTheDocument();
    expect(screen.queryByText(/dashboard\/providers|Website handoff|Open dashboard/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^connect$/i }));

    await waitFor(() =>
      expect(providerHubMocks.startAuth).toHaveBeenCalledWith({
        customerId: 'david-poku',
        providerKey: 'slack',
      })
    );
    expect(await screen.findByText('Auth handoff prepared.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/eds_|epg_|access_token|desktop_session|provider_grant|Bearer/i);
  });

  it('renders route denial without exposing provider actions', async () => {
    const user = userEvent.setup();
    providerHubMocks.getProfiles.mockResolvedValue({
      success: true,
      data: providerHub(true),
    });

    render(<ConnectedAppsPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Route denied')).toBeInTheDocument();
    expect(
      screen.getByText('Connected Apps requires the manage_integrations scope for this customer account.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^connect$/i })).not.toBeInTheDocument();
    expect(providerHubMocks.startAuth).not.toHaveBeenCalled();
  });
});
