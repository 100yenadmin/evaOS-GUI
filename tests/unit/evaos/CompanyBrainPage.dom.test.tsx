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
import CompanyBrainPage from '@/renderer/pages/company-brain';

const brokerMocks = vi.hoisted(() => ({
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

vi.mock('@/common/adapter/ipcBridge', () => ({
  evaosBroker: {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
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
    clearEvaosCustomerContext();
    brokerMocks.getCustomerTargets.mockReset();
    brokerMocks.getCustomerTargets.mockResolvedValue(customerTargets());
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

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Acme Co')).toBeInTheDocument();
    expect(screen.getByText('Google Drive ingesting 21 source files')).toBeInTheDocument();
    expect(screen.getByText('Source broker:company_brain_directory:david-poku')).toBeInTheDocument();
    expect(screen.getByText('Policy audit audit_policy_123')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^view$/i }));
    expect(await screen.findByText('Renewal account')).toBeInTheDocument();
    expect(screen.getByText('Renewal call')).toBeInTheDocument();
    expect(screen.getByText('Drive connector still ingesting')).toBeInTheDocument();
    expect(screen.getByText('Source broker:company_brain_account_360:account_acme')).toBeInTheDocument();
    expect(screen.getByText('Brief source broker:company_brain_brief:account_acme')).toBeInTheDocument();

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
    expect(screen.getByText('Source broker:company_brain_query:account_acme')).toBeInTheDocument();
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

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
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

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('Acme Co')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^view$/i }));
    expect(await screen.findByText('Renewal account')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Second Customer' }));

    expect(screen.queryByText('Renewal account')).not.toBeInTheDocument();
    expect(screen.queryByText('Acme Co')).not.toBeInTheDocument();
    expect(screen.getByText('Load a customer account to view Company Brain evidence.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('Second Co')).toBeInTheDocument();
  });

  it('uses the selected non-default customer for directory, account, and query loads', async () => {
    const user = userEvent.setup();
    companyBrainMocks.getDirectory.mockResolvedValue({
      success: true,
      data: directory({ customerId: 'second-customer', accountId: 'account_second', accountName: 'Second Co' }),
    });
    companyBrainMocks.getAccount360.mockResolvedValue({
      success: true,
      data: {
        ...account360('account_second'),
        customerId: 'second-customer',
        account: {
          accountId: 'account_second',
          name: 'Second Co',
          domain: 'second.example',
          ingestionState: 'ready',
          exceptionCount: 0,
        },
      },
    });
    companyBrainMocks.query.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.company_brain.query.v1',
        customerId: 'second-customer',
        customerAccountId: 'acct_123',
        accountId: 'account_second',
        status: 'answered',
        answer: 'Second Co is ready for rollout.',
        citations: [],
        sourcePointer: 'broker:company_brain_query:account_second',
        auditId: 'audit_query_second',
        backendEnforced: true,
      },
    });

    render(<CompanyBrainPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Second Customer' }));
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Second Co')).toBeInTheDocument();
    expect(companyBrainMocks.getDirectory).toHaveBeenCalledWith({ customerId: 'second-customer' });

    await user.click(screen.getByRole('button', { name: /^view$/i }));
    expect(await screen.findAllByText('Second Co')).toHaveLength(2);
    expect(companyBrainMocks.getAccount360).toHaveBeenCalledWith({
      customerId: 'second-customer',
      accountId: 'account_second',
    });

    await user.type(screen.getByLabelText('Ask Company Brain'), 'Is rollout ready?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => {
      expect(companyBrainMocks.query).toHaveBeenCalledWith({
        customerId: 'second-customer',
        accountId: 'account_second',
        query: 'Is rollout ready?',
      });
    });
    expect(await screen.findByText('Second Co is ready for rollout.')).toBeInTheDocument();
  });

  it('does not render stale Company Brain evidence when the selected customer changes before the broker responds', async () => {
    const user = userEvent.setup();
    const pendingDirectory = deferred<{
      success: boolean;
      data: ReturnType<typeof directory>;
    }>();
    companyBrainMocks.getDirectory.mockReturnValueOnce(pendingDirectory.promise);

    render(<CompanyBrainPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(companyBrainMocks.getDirectory).toHaveBeenCalledWith({ customerId: 'david-poku' });

    await user.click(screen.getByRole('button', { name: 'Second Customer' }));

    await act(async () => {
      pendingDirectory.resolve({
        success: true,
        data: directory({ customerId: 'david-poku', accountId: 'account_acme', accountName: 'Acme Co' }),
      });
      await pendingDirectory.promise;
    });

    expect(screen.queryByText('Acme Co')).not.toBeInTheDocument();
    expect(screen.queryByText(/audit_directory_123/)).not.toBeInTheDocument();
    expect(screen.getByText('Load a customer account to view Company Brain evidence.')).toBeInTheDocument();
  });

  it('fails closed when directory evidence is returned for a different customer', async () => {
    const user = userEvent.setup();
    companyBrainMocks.getDirectory.mockResolvedValue({
      success: true,
      data: directory({ customerId: 'wrong-customer', accountId: 'account_wrong', accountName: 'Wrong Co' }),
    });

    render(<CompanyBrainPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(
      await screen.findByText('Company Brain broker returned evidence for a different customer.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Wrong Co')).not.toBeInTheDocument();
    expect(companyBrainMocks.getAccount360).not.toHaveBeenCalled();
    expect(companyBrainMocks.query).not.toHaveBeenCalled();
  });

  it('fails closed when account 360 evidence does not match the selected customer and account', async () => {
    const user = userEvent.setup();
    companyBrainMocks.getDirectory.mockResolvedValue({
      success: true,
      data: directory({ accountId: 'account_acme', accountName: 'Acme Co' }),
    });
    companyBrainMocks.getAccount360.mockResolvedValue({
      success: true,
      data: {
        ...account360('account_wrong'),
        customerId: 'wrong-customer',
        accountId: 'account_wrong',
      },
    });

    render(<CompanyBrainPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('Acme Co')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^view$/i }));

    expect(
      await screen.findByText('Company Brain broker returned account evidence for the wrong customer or account.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Renewal account')).not.toBeInTheDocument();
  });

  it('keeps newer account evidence when an older same-customer account request resolves last', async () => {
    const user = userEvent.setup();
    const firstAccount = deferred<{
      success: boolean;
      data: ReturnType<typeof account360>;
    }>();
    const secondAccount = deferred<{
      success: boolean;
      data: ReturnType<typeof account360>;
    }>();
    companyBrainMocks.getDirectory.mockResolvedValue({
      success: true,
      data: {
        ...directory(),
        accounts: [
          {
            accountId: 'account_acme',
            name: 'Acme Co',
            domain: 'acme.example',
            owner: 'sales',
            ingestionState: 'ready',
            exceptionCount: 2,
          },
          {
            accountId: 'account_second',
            name: 'Second Co',
            domain: 'second.example',
            owner: 'sales',
            ingestionState: 'ready',
            exceptionCount: 0,
          },
        ],
      },
    });
    companyBrainMocks.getAccount360
      .mockReturnValueOnce(firstAccount.promise)
      .mockReturnValueOnce(secondAccount.promise);

    render(<CompanyBrainPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('Acme Co')).toBeInTheDocument();

    const viewButtons = screen.getAllByRole('button', { name: /^view$/i });
    await user.click(viewButtons[0]);
    await user.click(viewButtons[1]);

    await act(async () => {
      secondAccount.resolve({
        success: true,
        data: {
          ...account360('account_second'),
          account: {
            accountId: 'account_second',
            name: 'Second Co',
            domain: 'second.example',
            ingestionState: 'ready',
            exceptionCount: 0,
          },
          brief: {
            title: 'Second account brief',
            summary: 'Second account should remain selected when the older request resolves last.',
            updatedAt: '2026-06-03T11:45:00.000Z',
            sourcePointer: 'broker:company_brain_brief:account_second',
            auditId: 'audit_second_brief_123',
          },
        },
      });
      await secondAccount.promise;
    });
    expect(await screen.findAllByText('Second Co')).toHaveLength(2);

    await act(async () => {
      firstAccount.resolve({
        success: true,
        data: account360('account_acme'),
      });
      await firstAccount.promise;
    });

    expect(screen.queryByText('Renewal account')).not.toBeInTheDocument();
    expect(screen.getAllByText('Second Co')).toHaveLength(2);
  });

  it('keeps newer query evidence when an older same-account query resolves last', async () => {
    const user = userEvent.setup();
    const firstQuery = deferred<{
      success: boolean;
      data: Record<string, unknown>;
    }>();
    const secondQuery = deferred<{
      success: boolean;
      data: Record<string, unknown>;
    }>();
    companyBrainMocks.getDirectory.mockResolvedValue({
      success: true,
      data: directory(),
    });
    companyBrainMocks.getAccount360.mockResolvedValue({
      success: true,
      data: account360(),
    });
    companyBrainMocks.query.mockReturnValueOnce(firstQuery.promise).mockReturnValueOnce(secondQuery.promise);

    render(<CompanyBrainPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('Acme Co')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^view$/i }));
    expect(await screen.findByText('Renewal account')).toBeInTheDocument();

    const queryInput = screen.getByLabelText('Ask Company Brain');
    await user.type(queryInput, 'First question');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));
    await user.clear(queryInput);
    await user.type(queryInput, 'Second question');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));

    await act(async () => {
      secondQuery.resolve({
        success: true,
        data: {
          schemaVersion: 'evaos.company_brain.query.v1',
          customerId: 'david-poku',
          customerAccountId: 'acct_123',
          accountId: 'account_acme',
          status: 'answered',
          answer: 'Second answer wins.',
          citations: [],
          backendEnforced: true,
        },
      });
      await secondQuery.promise;
    });
    expect(await screen.findByText('Second answer wins.')).toBeInTheDocument();

    await act(async () => {
      firstQuery.resolve({
        success: true,
        data: {
          schemaVersion: 'evaos.company_brain.query.v1',
          customerId: 'david-poku',
          customerAccountId: 'acct_123',
          accountId: 'account_acme',
          status: 'answered',
          answer: 'Stale first answer.',
          citations: [],
          backendEnforced: true,
        },
      });
      await firstQuery.promise;
    });

    expect(screen.queryByText('Stale first answer.')).not.toBeInTheDocument();
    expect(screen.getByText('Second answer wins.')).toBeInTheDocument();
  });

  it('fails closed when query evidence does not match the selected customer and account', async () => {
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
        customerId: 'wrong-customer',
        customerAccountId: 'acct_123',
        accountId: 'account_wrong',
        status: 'answered',
        answer: 'Wrong customer answer.',
        citations: [],
        backendEnforced: true,
      },
    });

    render(<CompanyBrainPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('Acme Co')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^view$/i }));
    expect(await screen.findByText('Renewal account')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Ask Company Brain'), 'Is this scoped?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(
      await screen.findByText('Company Brain broker returned query evidence for the wrong customer or account.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Wrong customer answer.')).not.toBeInTheDocument();
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

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    await screen.findByText('Acme Co');

    await user.click(screen.getByRole('button', { name: /^view$/i }));

    expect(await screen.findByText('Backend denied the Company Brain request.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('sk_live_1234567890abcdef');
  });
});
