/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CompanyBrainPage from '@/renderer/pages/company-brain';

const companyBrainMocks = vi.hoisted(() => ({
  getDirectory: vi.fn(),
  getAccount360: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
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

function directory(
  overrides: Partial<{
    customerId: string;
    routeDenied: boolean;
    accountId: string;
    accountName: string;
    ingestionState: string;
  }> = {}
) {
  const routeDenied = overrides.routeDenied ?? false;
  const accountId = overrides.accountId ?? 'account_acme';
  return {
    schemaVersion: 'evaos.company_brain.directory.v1',
    customerId: overrides.customerId ?? 'david-poku',
    customerAccountId: 'acct_123',
    membershipId: 'mem_admin',
    membershipRole: 'admin',
    routeDenied,
    routeDenialReason: routeDenied
      ? 'Company Brain requires the view_company_brain scope for this customer account.'
      : undefined,
    backendEnforced: true,
    ingestionState: overrides.ingestionState ?? 'ingesting',
    integrationHealth: {
      state: overrides.ingestionState ?? 'ingesting',
      summary: 'Google Drive ingesting 21 source files',
    },
    accounts: routeDenied
      ? []
      : [
          {
            accountId,
            name: overrides.accountName ?? 'Acme Co',
            domain: 'acme.example',
            owner: 'sales',
            ingestionState: 'ready',
            exceptionCount: 2,
            lastActivityAt: '2026-06-03T11:20:00.000Z',
            sourcePointer: `broker:company_brain_account:${accountId}`,
            auditId: 'audit_account_row_123',
          },
        ],
    summaryText: routeDenied ? 'Company Brain denied by account policy' : '1 account, ingesting',
    sourcePointer: routeDenied ? undefined : 'broker:company_brain_directory:david-poku',
    auditId: routeDenied ? undefined : 'audit_directory_123',
    policyAuditId: 'audit_policy_123',
  };
}

function account360(accountId = 'account_acme') {
  return {
    schemaVersion: 'evaos.company_brain.account_360.v1',
    customerId: 'david-poku',
    customerAccountId: 'acct_123',
    membershipId: 'mem_admin',
    membershipRole: 'admin',
    routeDenied: false,
    backendEnforced: true,
    accountId,
    account: {
      accountId,
      name: 'Acme Co',
      domain: 'acme.example',
      ingestionState: 'ready',
      exceptionCount: 2,
    },
    ingestionState: 'ready',
    brief: {
      title: 'Renewal account',
      summary: 'Acme is preparing a June renewal and has one open support exception.',
      updatedAt: '2026-06-03T11:40:00.000Z',
      sourcePointer: `broker:company_brain_brief:${accountId}`,
      auditId: 'audit_brief_123',
    },
    timeline: [
      {
        entryId: 'tl_1',
        type: 'meeting',
        title: 'Renewal call',
        summary: 'CEO asked for managed-agent rollout options.',
        occurredAt: '2026-06-03T10:30:00.000Z',
        sourcePointer: 'broker:company_brain_timeline:tl_1',
        auditId: 'audit_timeline_123',
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
        auditId: 'audit_exception_123',
      },
    ],
    sourcePointer: `broker:company_brain_account_360:${accountId}`,
    auditId: 'audit_360_123',
    policyAuditId: 'audit_policy_123',
  };
}

describe('CompanyBrainPage', () => {
  beforeEach(() => {
    companyBrainMocks.getDirectory.mockReset();
    companyBrainMocks.getAccount360.mockReset();
    companyBrainMocks.query.mockReset();
  });

  it('loads directory, account 360, and query evidence without rendering secrets', async () => {
    const user = userEvent.setup();
    companyBrainMocks.getDirectory.mockResolvedValue({
      success: true,
      data: directory(),
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
        customerAccountId: 'acct_123',
        accountId: 'account_acme',
        status: 'answered',
        answer: 'Acme asked for rollout options after the renewal call.',
        citations: [
          {
            citationId: 'cite_1',
            title: 'Renewal call',
            sourceType: 'meeting',
            sourcePointer: 'broker:company_brain_citation:cite_1',
            occurredAt: '2026-06-03T10:30:00.000Z',
          },
        ],
        sourcePointer: 'broker:company_brain_query:account_acme',
        auditId: 'audit_query_123',
        backendEnforced: true,
      },
    });

    const { container } = render(<CompanyBrainPage />);

    await user.type(screen.getByLabelText('Customer context'), 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Acme Co')).toBeInTheDocument();
    expect(screen.getByText('Google Drive ingesting 21 source files')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^view$/i }));
    expect(await screen.findByText('Renewal account')).toBeInTheDocument();
    expect(screen.getByText('Renewal call')).toBeInTheDocument();
    expect(screen.getByText('Drive connector still ingesting')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Ask Company Brain'), 'What changed after the renewal call?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => {
      expect(companyBrainMocks.query).toHaveBeenCalledWith({
        customerId: 'david-poku',
        accountId: 'account_acme',
        query: 'What changed after the renewal call?',
      });
    });
    expect(await screen.findByText('Acme asked for rollout options after the renewal call.')).toBeInTheDocument();
    expect(screen.getByText('Audit audit_query_123')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(
      /\beds_[A-Za-z0-9_-]+\b|access_token|refresh_token|desktop_session|raw_prompt|raw_embedding_text|Bearer/i
    );
  });

  it('renders route denial and keeps account/query actions off the broker path', async () => {
    const user = userEvent.setup();
    companyBrainMocks.getDirectory.mockResolvedValue({
      success: true,
      data: directory({ routeDenied: true }),
    });

    render(<CompanyBrainPage />);

    await user.type(screen.getByLabelText('Customer context'), 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Route denied')).toBeInTheDocument();
    expect(
      screen.getByText('Company Brain requires the view_company_brain scope for this customer account.')
    ).toBeInTheDocument();
    expect(companyBrainMocks.getAccount360).not.toHaveBeenCalled();
    expect(companyBrainMocks.query).not.toHaveBeenCalled();
  });

  it('clears selected account evidence when customer context changes before loading the next customer', async () => {
    const user = userEvent.setup();
    companyBrainMocks.getDirectory
      .mockResolvedValueOnce({
        success: true,
        data: directory({ customerId: 'david-poku', accountId: 'account_acme', accountName: 'Acme Co' }),
      })
      .mockResolvedValueOnce({
        success: true,
        data: directory({ customerId: 'second-customer', accountId: 'account_second', accountName: 'Second Co' }),
      });
    companyBrainMocks.getAccount360.mockResolvedValue({
      success: true,
      data: account360(),
    });

    render(<CompanyBrainPage />);

    const customerInput = screen.getByLabelText('Customer context');
    await user.type(customerInput, 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('Acme Co')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^view$/i }));
    expect(await screen.findByText('Renewal account')).toBeInTheDocument();

    await user.clear(customerInput);
    await user.type(customerInput, 'second-customer');

    expect(screen.queryByText('Renewal account')).not.toBeInTheDocument();
    expect(screen.queryByText('Acme Co')).not.toBeInTheDocument();
    expect(screen.getByText('Load a customer account to view Company Brain evidence.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('Second Co')).toBeInTheDocument();
  });

  it('renders backend denial without leaking broker secret text', async () => {
    const user = userEvent.setup();
    companyBrainMocks.getDirectory.mockResolvedValue({
      success: true,
      data: directory(),
    });
    companyBrainMocks.getAccount360.mockResolvedValue({
      success: false,
      msg: 'sk_live_1234567890abcdef should not render',
    });

    const { container } = render(<CompanyBrainPage />);

    await user.type(screen.getByLabelText('Customer context'), 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    await screen.findByText('Acme Co');

    await user.click(screen.getByRole('button', { name: /^view$/i }));

    expect(await screen.findByText('Backend denied the Company Brain request.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('sk_live_1234567890abcdef');
  });
});
