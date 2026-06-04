/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConnectedAppsPage from '@/renderer/pages/connected-apps';

const providerHubMocks = vi.hoisted(() => ({
  getProfiles: vi.fn(),
  startAuth: vi.fn(),
  switchProvider: vi.fn(),
  revokeProvider: vi.fn(),
  mintGrant: vi.fn(),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
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
  },
}));

function providerHub(routeDenied = false) {
  return {
    schemaVersion: 'evaos.provider_hub.v1',
    customerId: 'david-poku',
    customerAccountId: 'acct_123',
    membershipId: 'mem_admin',
    membershipRole: 'admin',
    routeDenied,
    routeDenialReason: routeDenied
      ? 'Connected Apps requires the manage_integrations scope for this customer account.'
      : undefined,
    backendEnforced: true,
    activeProviderKey: 'google_workspace',
    profiles: routeDenied
      ? []
      : [
          {
            providerKey: 'google_workspace',
            title: 'Google Workspace',
            subtitle: 'Email, calendar, and Drive',
            status: 'connected',
            active: false,
            rawSecretsStoredInWorkbench: false,
            approvalRequired: false,
            capabilities: ['gmail', 'calendar'],
            usageSummary: 'Used for customer inbox triage',
            customerAccountId: 'acct_123',
            ownerKind: 'user',
            ownerUserId: 'usr_123',
            grantedScopes: ['gmail.readonly'],
            expiresAt: '2026-06-10T12:00:00.000Z',
            accountLabel: 'sales@example.test',
            lastCheckedAt: '2026-06-03T11:50:00.000Z',
            sourcePointer: 'broker:provider_profile:google_workspace',
            auditId: 'audit_google_123',
            lastValidatedAt: '2026-06-03T11:51:00.000Z',
            hasConnectionProof: true,
            hasBrokeredGrant: true,
            summaryText: 'Ready',
          },
          {
            providerKey: 'slack',
            title: 'Slack',
            status: 'needs_login',
            active: false,
            rawSecretsStoredInWorkbench: false,
            approvalRequired: false,
            capabilities: [],
            grantedScopes: [],
            accountLabel: 'workspace.example',
            sourcePointer: 'broker:provider_profile:slack',
            auditId: 'audit_slack_123',
            hasConnectionProof: false,
            hasBrokeredGrant: false,
            summaryText: 'Needs login',
          },
          {
            providerKey: 'notion',
            title: 'Notion',
            status: 'expired',
            active: false,
            rawSecretsStoredInWorkbench: false,
            approvalRequired: false,
            capabilities: [],
            grantedScopes: [],
            sourcePointer: 'broker:provider_profile:notion',
            auditId: 'audit_notion_123',
            hasConnectionProof: false,
            hasBrokeredGrant: false,
            summaryText: 'Needs reconnection',
          },
          {
            providerKey: 'github',
            title: 'GitHub',
            status: 'revoked',
            active: false,
            rawSecretsStoredInWorkbench: false,
            approvalRequired: false,
            capabilities: [],
            grantedScopes: [],
            sourcePointer: 'broker:provider_profile:github',
            auditId: 'audit_github_123',
            hasConnectionProof: false,
            hasBrokeredGrant: false,
            summaryText: 'Revoked',
          },
          {
            providerKey: 'linear',
            title: 'Linear',
            status: 'approval_required',
            active: false,
            rawSecretsStoredInWorkbench: false,
            approvalRequired: true,
            capabilities: ['issues'],
            grantedScopes: ['linear.read'],
            sourcePointer: 'broker:provider_profile:linear',
            auditId: 'audit_linear_123',
            hasConnectionProof: false,
            hasBrokeredGrant: false,
            summaryText: 'Approval required',
          },
        ],
    summaryText: routeDenied ? 'Connected Apps denied by account policy' : '1 ready, 3 need attention',
    sourcePointer: 'broker:provider_profiles:david-poku',
    auditId: 'audit_provider_list_123',
    policyAuditId: 'audit_policy_123',
  };
}

describe('ConnectedAppsPage', () => {
  beforeEach(() => {
    providerHubMocks.getProfiles.mockReset();
    providerHubMocks.startAuth.mockReset();
    providerHubMocks.switchProvider.mockReset();
    providerHubMocks.revokeProvider.mockReset();
    providerHubMocks.mintGrant.mockReset();
  });

  it('loads provider states and sends brokered provider actions without rendering secrets', async () => {
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
        authUrlSummary: {
          host: 'auth.example.test',
          path: '/oauth/start',
          displayText: 'auth.example.test/oauth/start',
          redacted: true,
        },
        providerHub: providerHub(false),
        auditId: 'audit_auth_123',
        backendEnforced: true,
      },
    });
    providerHubMocks.mintGrant.mockResolvedValue({
      success: true,
      data: {
        status: 'granted',
        providerKey: 'google_workspace',
        message: 'Grant minted.',
        providerHub: providerHub(false),
        auditId: 'audit_mint_123',
        backendEnforced: true,
      },
    });

    const { container } = render(<ConnectedAppsPage />);

    await user.type(screen.getByLabelText('Customer context'), 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Google Workspace')).toBeInTheDocument();
    expect(screen.getByText('sales@example.test')).toBeInTheDocument();
    expect(screen.getAllByText('Needs login').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Needs reconnection').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Revoked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Approval required').length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole('button', { name: /^connect$/i })[0]);
    await waitFor(() => {
      expect(providerHubMocks.startAuth).toHaveBeenCalledWith({
        customerId: 'david-poku',
        providerKey: 'slack',
        agentRuntime: undefined,
      });
    });
    expect(
      await screen.findByText(
        'slack Auth handoff prepared. Auth handoff: auth.example.test/oauth/start. Audit audit_auth_123.'
      )
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^allow eva$/i }));
    await waitFor(() => {
      expect(providerHubMocks.mintGrant).toHaveBeenCalledWith({
        customerId: 'david-poku',
        providerKey: 'google_workspace',
        agentRuntime: 'openclaw',
      });
    });
    expect(await screen.findByText('google_workspace Grant minted. Audit audit_mint_123.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(
      /\b(?:eds|epg)_[A-Za-z0-9_-]+\b|access_token|refresh_token|desktop_session|provider_grant_handle|grant_handle|Bearer/i
    );
  });

  it('renders route denial and keeps provider actions off the backend mutation path', async () => {
    const user = userEvent.setup();
    providerHubMocks.getProfiles.mockResolvedValue({
      success: true,
      data: providerHub(true),
    });

    render(<ConnectedAppsPage />);

    await user.type(screen.getByLabelText('Customer context'), 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Route denied')).toBeInTheDocument();
    expect(
      screen.getByText('Connected Apps requires the manage_integrations scope for this customer account.')
    ).toBeInTheDocument();
    expect(providerHubMocks.startAuth).not.toHaveBeenCalled();
    expect(providerHubMocks.mintGrant).not.toHaveBeenCalled();
  });

  it('clears provider evidence when customer context changes before loading the next customer', async () => {
    const user = userEvent.setup();
    providerHubMocks.getProfiles.mockResolvedValue({
      success: true,
      data: providerHub(false),
    });

    render(<ConnectedAppsPage />);

    const customerInput = screen.getByLabelText('Customer context');
    await user.type(customerInput, 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Google Workspace')).toBeInTheDocument();
    expect(screen.getByText('sales@example.test')).toBeInTheDocument();

    await user.clear(customerInput);
    await user.type(customerInput, 'second-customer');

    expect(screen.queryByText('Google Workspace')).not.toBeInTheDocument();
    expect(screen.queryByText('sales@example.test')).not.toBeInTheDocument();
    expect(screen.getByText('Load a customer account to view connected app evidence.')).toBeInTheDocument();
  });

  it('renders backend denial without leaking broker secret text', async () => {
    const user = userEvent.setup();
    providerHubMocks.getProfiles.mockResolvedValue({
      success: true,
      data: providerHub(false),
    });
    providerHubMocks.startAuth.mockResolvedValue({
      success: false,
      msg: 'eds_raw_backend_secret should not render',
    });

    const { container } = render(<ConnectedAppsPage />);

    await user.type(screen.getByLabelText('Customer context'), 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    await screen.findByText('Google Workspace');

    await user.click(screen.getAllByRole('button', { name: /^connect$/i })[0]);

    expect(await screen.findByText('Backend denied the provider action.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('eds_raw_backend_secret');
  });
});
