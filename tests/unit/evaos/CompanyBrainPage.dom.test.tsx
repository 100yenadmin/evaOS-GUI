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
import CompanyBrainPage from '@/renderer/pages/company-brain';

const brokerMocks = vi.hoisted(() => ({
  getSessionStatus: vi.fn(),
  getCustomerTargets: vi.fn(),
}));

const companyBrainMocks = vi.hoisted(() => ({
  getDirectory: vi.fn(),
  getAccount360: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'common.refresh': 'Refresh',
        'evaos.companyBrain.accountFailedClosed': 'Company Brain account proof failed closed.',
        'evaos.companyBrain.accountRequestFailed': 'Company Brain account request failed closed.',
        'evaos.companyBrain.accounts': 'Accounts',
        'evaos.companyBrain.backendProofRequired': 'Backend proof is required before querying Company Brain.',
        'evaos.companyBrain.chooseCustomer': 'Choose a customer before loading Company Brain.',
        'evaos.companyBrain.denied': 'Company Brain is denied for this customer account.',
        'evaos.companyBrain.description': 'Review customer account intelligence.',
        'evaos.companyBrain.differentEvidence':
          'Company Brain broker returned evidence for a different customer or account.',
        'evaos.companyBrain.directory': 'Company Brain directory',
        'evaos.companyBrain.directoryLoaded': 'Company Brain directory loaded.',
        'evaos.companyBrain.emptyAccounts': 'No Company Brain accounts returned for this customer.',
        'evaos.companyBrain.emptyTimeline': 'No recent activity returned for this account.',
        'evaos.companyBrain.exceptions': `${String(values?.count ?? 0)} exceptions`,
        'evaos.companyBrain.exceptionsLabel': 'Exceptions',
        'evaos.companyBrain.failedClosed': 'Company Brain failed closed.',
        'evaos.companyBrain.ingestion.empty': 'Empty',
        'evaos.companyBrain.ingestion.error': 'Error',
        'evaos.companyBrain.ingestion.ingesting': 'Ingesting',
        'evaos.companyBrain.ingestion.ready': 'Ready',
        'evaos.companyBrain.loading': 'Loading Company Brain...',
        'evaos.companyBrain.noAnswer': 'No answer returned.',
        'evaos.companyBrain.noBrief': 'No account brief returned yet.',
        'evaos.companyBrain.noCustomerSelected': 'No customer selected',
        'evaos.companyBrain.query': 'Ask Company Brain',
        'evaos.companyBrain.queryFailedClosed': 'Company Brain query failed closed.',
        'evaos.companyBrain.queryPlaceholder': 'Ask about this account...',
        'evaos.companyBrain.queryRequired': 'Enter a question before querying Company Brain.',
        'evaos.companyBrain.queryRequiresAccount': 'Load an account before querying Company Brain.',
        'evaos.companyBrain.queryResult': 'Query result',
        'evaos.companyBrain.recentActivity': 'Recent activity',
        'evaos.companyBrain.requestFailed': 'Company Brain broker request failed closed.',
        'evaos.companyBrain.runQuery': 'Run query',
        'evaos.companyBrain.scopedSummary': `${String(values?.summary ?? 'summary')}. Company Brain stays scoped.`,
        'evaos.companyBrain.selectAccount': 'Select an account to view Account 360.',
        'evaos.companyBrain.timeline': 'Timeline',
        'evaos.companyBrain.title': 'Company Brain',
        'evaos.shared.backendEnforced': 'Backend enforced',
        'evaos.shared.brokerPolicyActive': 'Broker policy active',
        'evaos.shared.customerContext': 'Customer context',
        'evaos.shared.load': 'Load',
        'evaos.shared.loadingCustomerTargets': 'Loading customer targets...',
        'evaos.shared.needsBackendProof': 'Needs backend proof',
        'evaos.shared.refreshTargets': 'Refresh targets',
        'evaos.shared.routeDenied': 'Route denied',
        'evaos.shared.unknown': 'Unknown',
        'evaos.shared.blockers.backendContractIncomplete':
          'The evaOS broker returned incomplete proof. Try again after support updates the backend.',
        'evaos.shared.blockers.policyDenied':
          'Your account policy does not allow this action for the selected customer.',
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
  evaosCompanyBrain: {
    getDirectory: {
      invoke: companyBrainMocks.getDirectory,
    },
    getAccount360: {
      invoke: companyBrainMocks.getAccount360,
    },
    query: {
      invoke: companyBrainMocks.query,
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

function directory(routeDenied = false) {
  return {
    schemaVersion: 'evaos.company_brain.directory.v1',
    customerId: 'david-poku',
    customerAccountId: 'acct_david',
    membershipId: 'mem_admin',
    membershipRole: 'admin',
    routeDenied,
    routeDenialReason: routeDenied
      ? 'Company Brain requires the view_company_brain scope for this customer account.'
      : undefined,
    backendEnforced: true,
    ingestionState: routeDenied ? 'empty' : 'ingesting',
    integrationHealth: routeDenied
      ? undefined
      : {
          state: 'ingesting',
          summary: 'Google Drive ingesting 21 source files',
        },
    accounts: routeDenied
      ? []
      : [
          {
            accountId: 'account_acme',
            name: 'Acme Co',
            domain: 'acme.example',
            customerAccountId: 'acct_david',
            ingestionState: 'ready',
            exceptionCount: 1,
            lastActivityAt: '2026-06-03T11:20:00.000Z',
            sourcePointer: 'broker:company_brain_account:account_acme',
            auditId: 'audit_account_row',
          },
        ],
    summaryText: routeDenied ? 'Company Brain denied by account policy' : '1 account, ingesting',
    sourcePointer: routeDenied ? undefined : 'broker:company_brain_directory:david-poku',
    auditId: routeDenied ? undefined : 'audit_directory',
    policyAuditId: 'audit_policy',
  };
}

function account360() {
  return {
    schemaVersion: 'evaos.company_brain.account_360.v1',
    customerId: 'david-poku',
    customerAccountId: 'acct_david',
    membershipId: 'mem_admin',
    membershipRole: 'admin',
    routeDenied: false,
    backendEnforced: true,
    accountId: 'account_acme',
    account: directory(false).accounts[0],
    ingestionState: 'ready',
    brief: {
      title: 'Renewal account',
      summary: 'Acme is preparing a June renewal.',
      updatedAt: '2026-06-03T11:40:00.000Z',
      sourcePointer: 'broker:company_brain_brief:account_acme',
      auditId: 'audit_brief',
    },
    timeline: [
      {
        entryId: 'tl_1',
        type: 'meeting',
        title: 'Renewal call',
        summary: 'CEO asked for rollout options.',
        occurredAt: '2026-06-03T10:30:00.000Z',
        sourcePointer: 'broker:company_brain_timeline:tl_1',
        auditId: 'audit_timeline',
      },
    ],
    exceptions: [
      {
        exceptionId: 'exc_1',
        severity: 'warning',
        title: 'Drive connector still ingesting',
        summary: 'Some files are not indexed yet.',
        status: 'open',
        sourcePointer: 'broker:company_brain_exception:exc_1',
        auditId: 'audit_exception',
      },
    ],
    sourcePointer: 'broker:company_brain_account_360:account_acme',
    auditId: 'audit_360',
    policyAuditId: 'audit_policy',
  };
}

describe('CompanyBrainPage', () => {
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
    Object.values(companyBrainMocks).forEach((mock) => mock.mockReset());
  });

  it('loads native directory, Account 360, and query evidence without the dashboard handoff', async () => {
    const user = userEvent.setup();
    companyBrainMocks.getDirectory.mockResolvedValue({
      success: true,
      data: directory(false),
    });
    companyBrainMocks.getAccount360.mockResolvedValue({
      success: true,
      data: account360(),
    });
    companyBrainMocks.query.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.company_brain.query.v1',
        customerId: 'david-poku',
        customerAccountId: 'acct_david',
        accountId: 'account_acme',
        status: 'answered',
        answer: 'Acme asked for rollout options after the renewal call.',
        citations: [
          {
            citationId: 'cite_1',
            title: 'Renewal call',
            sourceType: 'meeting',
            sourcePointer: 'broker:company_brain_citation:cite_1',
          },
        ],
        sourcePointer: 'broker:company_brain_query:account_acme',
        auditId: 'audit_query',
        backendEnforced: true,
      },
    });

    const { container } = render(<CompanyBrainPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Company Brain directory')).toBeInTheDocument();
    expect((await screen.findAllByText('Acme Co')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Acme is preparing a June renewal.')).toBeInTheDocument();
    expect(screen.getByText('Renewal call')).toBeInTheDocument();
    expect(screen.queryByText(/Website handoff|Open dashboard|dashboard\/company-brain/i)).not.toBeInTheDocument();
    expect(companyBrainMocks.getDirectory).toHaveBeenCalledWith({ customerId: 'david-poku' });
    expect(companyBrainMocks.getAccount360).toHaveBeenCalledWith({
      customerId: 'david-poku',
      accountId: 'account_acme',
    });

    await user.type(screen.getByPlaceholderText('Ask about this account...'), 'What changed?');
    await user.click(screen.getByRole('button', { name: /^run query$/i }));

    await waitFor(() =>
      expect(companyBrainMocks.query).toHaveBeenCalledWith({
        customerId: 'david-poku',
        accountId: 'account_acme',
        query: 'What changed?',
      })
    );
    expect(await screen.findByText('Acme asked for rollout options after the renewal call.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/eds_|access_token|desktop_session|provider_grant|Bearer/i);
    expect(container.textContent).not.toMatch(/broker:company_brain|audit_/i);
  });

  it('renders route denial without loading account details', async () => {
    const user = userEvent.setup();
    companyBrainMocks.getDirectory.mockResolvedValue({
      success: true,
      data: directory(true),
    });

    render(<CompanyBrainPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Route denied')).toBeInTheDocument();
    expect(
      screen.getByText('Company Brain requires the view_company_brain scope for this customer account.')
    ).toBeInTheDocument();
    expect(companyBrainMocks.getAccount360).not.toHaveBeenCalled();
    expect(screen.queryByText('Acme Co')).not.toBeInTheDocument();
  });

  it('uses typed blockers for incomplete backend proof', async () => {
    const user = userEvent.setup();
    companyBrainMocks.getDirectory.mockResolvedValue({
      success: false,
      errorCode: 'broker_invalid_response',
      msg: 'desktop_session=eds_secret invalid response',
    });

    const { container } = render(<CompanyBrainPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(
      await screen.findByText(
        'The evaOS broker returned incomplete proof. Try again after support updates the backend.'
      )
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/eds_|desktop_session|Bearer/i);
  });
});
