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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'common.refresh': 'Refresh',
        'evaos.connectedApps.actionFailed': 'Connected Apps action failed closed.',
        'evaos.connectedApps.active': 'Active',
        'evaos.connectedApps.approvalRequired': 'Approval required',
        'evaos.connectedApps.brokeredGrant': 'Brokered grant',
        'evaos.connectedApps.capability': 'capability',
        'evaos.connectedApps.connect': 'Connect',
        'evaos.connectedApps.denied': 'Connected Apps is denied for this customer account.',
        'evaos.connectedApps.differentAccount':
          'Connected Apps broker returned evidence for a different customer account.',
        'evaos.connectedApps.grantToAgents': 'Grant to agents',
        'evaos.connectedApps.noWorkbenchSecrets': 'No Workbench secrets',
        'evaos.connectedApps.providerUpdated': `${String(values?.providerKey ?? 'provider')} updated.`,
        'evaos.connectedApps.requestApproval': 'Request approval',
        'evaos.connectedApps.revoke': 'Revoke',
        'evaos.connectedApps.status.approval_required': 'Approval required',
        'evaos.connectedApps.status.connected': 'Connected',
        'evaos.connectedApps.status.error': 'Error',
        'evaos.connectedApps.status.expired': 'Expired',
        'evaos.connectedApps.status.needs_login': 'Needs login',
        'evaos.connectedApps.status.planned': 'Planned',
        'evaos.connectedApps.status.revoked': 'Revoked',
        'evaos.shared.unknown': 'Unknown',
        'evaos.shared.load': 'Load',
        'evaos.shared.refreshTargets': 'Refresh targets',
        'evaos.shared.routeDenied': 'Route denied',
        'evaos.shared.blockers.backendContractIncomplete':
          'The evaOS broker returned incomplete proof. Try again after support updates the backend.',
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
    expect(providerHubMocks.getProfiles).toHaveBeenCalledWith({
      customerId: 'david-poku',
      customerAccountId: 'acct_david',
    });

    await user.click(screen.getByRole('button', { name: /^connect$/i }));

    await waitFor(() =>
      expect(providerHubMocks.startAuth).toHaveBeenCalledWith({
        customerId: 'david-poku',
        customerAccountId: 'acct_david',
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
      data: {
        ...providerHub(true),
        profiles: providerHub(false).profiles,
      },
    });

    render(<ConnectedAppsPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Route denied')).toBeInTheDocument();
    expect(
      screen.getByText('Connected Apps requires the manage_integrations scope for this customer account.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Google Workspace')).not.toBeInTheDocument();
    expect(screen.queryByText('Slack')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^connect$/i })).not.toBeInTheDocument();
    expect(providerHubMocks.startAuth).not.toHaveBeenCalled();
  });

  it('rejects provider evidence for a different customer account', async () => {
    const user = userEvent.setup();
    providerHubMocks.getProfiles.mockResolvedValue({
      success: true,
      data: {
        ...providerHub(false),
        customerAccountId: 'acct_other',
      },
    });

    render(<ConnectedAppsPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(
      await screen.findByText('Connected Apps broker returned evidence for a different customer account.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Google Workspace')).not.toBeInTheDocument();
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
    providerHubMocks.getProfiles.mockResolvedValue({
      success: true,
      data: {
        ...providerHub(false),
        customerAccountId: 'acct_secondary',
      },
    });

    render(<ConnectedAppsPage />);

    await user.click(await screen.findByRole('button', { name: /^secondary account$/i }));
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    await waitFor(() =>
      expect(providerHubMocks.getProfiles).toHaveBeenCalledWith({
        customerId: 'david-poku',
        customerAccountId: 'acct_secondary',
      })
    );
    expect(await screen.findByText('Google Workspace')).toBeInTheDocument();
  });

  it('uses typed blockers for incomplete broker proof failures', async () => {
    const user = userEvent.setup();
    providerHubMocks.getProfiles.mockResolvedValue({
      success: false,
      errorCode: 'broker_invalid_response',
      msg: 'provider_grant=epg_secret invalid response',
    });

    const { container } = render(<ConnectedAppsPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(
      await screen.findByText(
        'The evaOS broker returned incomplete proof. Try again after support updates the backend.'
      )
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/epg_|provider_grant|Bearer/i);
  });
});
