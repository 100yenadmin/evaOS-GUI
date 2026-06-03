/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EvaosBrokerSessionClient, type EvaosBrokerFetch } from '@/process/services/evaosBrokerSession';

const NOW = new Date('2026-06-03T12:00:00.000Z');
const FUTURE = '2026-06-03T18:00:00.000Z';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function fetchMock(): ReturnType<typeof vi.fn<EvaosBrokerFetch>> {
  return vi.fn<EvaosBrokerFetch>();
}

function requestBody(call: Parameters<EvaosBrokerFetch>): Record<string, unknown> {
  const init = call[1];
  expect(init?.body).toBeTypeOf('string');
  return JSON.parse(init?.body as string) as Record<string, unknown>;
}

function authenticatedClient(fetchImpl: EvaosBrokerFetch): EvaosBrokerSessionClient {
  return new EvaosBrokerSessionClient({
    fetchImpl,
    env: {
      AIONUI_EVAOS_DESKTOP_SESSION: 'eds_company_brain_secret_for_test',
      AIONUI_EVAOS_DESKTOP_SESSION_EXPIRES_AT: FUTURE,
    },
    now: () => NOW,
  });
}

const accountPayload = {
  customer_account_id: 'acct_123',
  selected_customer_id: 'david-poku',
  members: [
    {
      membership_id: 'mem_admin',
      email: 'admin@example.test',
      membership_role: 'admin',
      status: 'active',
    },
  ],
};

function policyPayload(scopes: string[], overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'evaos.account_policy.v1',
    customer_account_id: 'acct_123',
    selected_customer_id: 'david-poku',
    membership_id: 'mem_admin',
    membership_role: 'admin',
    scopes,
    advanced_surfaces: {},
    backend_enforced: true,
    audit_id: 'audit_policy_123',
    ...overrides,
  };
}

const accountSummary = {
  account_id: 'account_acme',
  name: 'Acme Co',
  domain: 'acme.example',
  customer_account_id: 'acct_123',
  owner: 'sales',
  ingestion_state: 'ready',
  exception_count: 2,
  last_activity_at: '2026-06-03T11:20:00.000Z',
  source_pointer: 'broker:company_brain_account:account_acme',
  audit_id: 'audit_account_row_123',
  raw_embedding_text: 'eds_account_row_secret_should_not_render',
};

function directoryPayload(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'evaos.company_brain.directory.v1',
    customer_id: 'david-poku',
    customer_account_id: 'acct_123',
    ingestion_state: 'ingesting',
    integration_health: {
      state: 'ingesting',
      summary: 'Google Drive ingesting 21 source files',
    },
    accounts: [accountSummary],
    source_pointer: 'broker:company_brain_directory:david-poku',
    audit_id: 'audit_directory_123',
    backend_enforced: true,
    ...overrides,
  };
}

function account360Payload(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'evaos.company_brain.account_360.v1',
    customer_id: 'david-poku',
    customer_account_id: 'acct_123',
    account: accountSummary,
    ingestion_state: 'ready',
    brief: {
      title: 'Renewal account',
      summary: 'Acme is preparing a June renewal and has one open support exception.',
      updated_at: '2026-06-03T11:40:00.000Z',
      source_pointer: 'broker:company_brain_brief:account_acme',
      audit_id: 'audit_brief_123',
    },
    timeline: [
      {
        event_id: 'tl_1',
        type: 'meeting',
        title: 'Renewal call',
        summary: 'CEO asked for managed-agent rollout options.',
        occurred_at: '2026-06-03T10:30:00.000Z',
        source_pointer: 'broker:company_brain_timeline:tl_1',
        audit_id: 'audit_timeline_123',
      },
    ],
    exceptions: [
      {
        exception_id: 'exc_1',
        severity: 'warning',
        title: 'Drive connector still ingesting',
        summary: 'Some files are not indexed yet.',
        status: 'open',
        source_pointer: 'broker:company_brain_exception:exc_1',
        audit_id: 'audit_exception_123',
      },
    ],
    source_pointer: 'broker:company_brain_account_360:account_acme',
    audit_id: 'audit_360_123',
    backend_enforced: true,
    ...overrides,
  };
}

describe('EvaosBrokerSessionClient Company Brain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed without broker calls when Company Brain loads without a desktop session', async () => {
    const fetchImpl = fetchMock();
    const client = new EvaosBrokerSessionClient({
      fetchImpl,
      env: {},
      now: () => NOW,
    });

    await expect(client.companyBrainDirectory({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'missing_session',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns route denial without querying Company Brain when view_company_brain is absent', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['open_business_browser'])));
    const client = authenticatedClient(fetchImpl);

    const directory = await client.companyBrainDirectory({ customerId: 'david-poku' });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(directory).toMatchObject({
      schemaVersion: 'evaos.company_brain.directory.v1',
      routeDenied: true,
      routeDenialReason: 'Company Brain requires the view_company_brain scope for this customer account.',
      accounts: [],
      summaryText: 'Company Brain denied by account policy',
      policyAuditId: 'audit_policy_123',
    });
  });

  it('fails closed on route denial when account policy proof is not backend enforced', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(
        jsonResponse(policyPayload(['open_business_browser'], { backend_enforced: false, audit_id: undefined }))
      );
    const client = authenticatedClient(fetchImpl);

    await expect(client.companyBrainDirectory({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'action_denied',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails closed before directory fetch when policy proof is not backend enforced', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['view_company_brain'], { backend_enforced: false })));
    const client = authenticatedClient(fetchImpl);

    await expect(client.companyBrainDirectory({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'action_denied',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('loads directory, account 360, and query evidence without exposing raw source secrets', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['view_company_brain'])))
      .mockResolvedValueOnce(jsonResponse(directoryPayload()))
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['view_company_brain'])))
      .mockResolvedValueOnce(jsonResponse(account360Payload()))
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['view_company_brain'])))
      .mockResolvedValueOnce(
        jsonResponse({
          schema_version: 'evaos.company_brain.query.v1',
          customer_id: 'david-poku',
          customer_account_id: 'acct_123',
          account_id: 'account_acme',
          status: 'answered',
          answer: 'Acme asked for rollout options after the renewal call.',
          citations: [
            {
              citation_id: 'cite_1',
              title: 'Renewal call',
              source_type: 'meeting',
              source_pointer: 'broker:company_brain_citation:cite_1',
              occurred_at: '2026-06-03T10:30:00.000Z',
            },
          ],
          source_pointer: 'broker:company_brain_query:account_acme',
          audit_id: 'audit_query_123',
          backend_enforced: true,
          raw_prompt: 'eds_query_secret_should_not_render',
        })
      );
    const client = authenticatedClient(fetchImpl);

    const directory = await client.companyBrainDirectory({ customerId: 'david-poku' });
    const account = await client.companyBrainAccount360({ customerId: 'david-poku', accountId: 'account_acme' });
    const query = await client.companyBrainQuery({
      customerId: 'david-poku',
      accountId: 'account_acme',
      query: 'What changed after the renewal call?',
    });

    expect(requestBody(fetchImpl.mock.calls[2])).toEqual({
      action: 'company_brain_directory',
      customer_id: 'david-poku',
    });
    expect(requestBody(fetchImpl.mock.calls[5])).toEqual({
      action: 'company_brain_account_360',
      customer_id: 'david-poku',
      account_id: 'account_acme',
    });
    expect(requestBody(fetchImpl.mock.calls[8])).toEqual({
      action: 'company_brain_query',
      customer_id: 'david-poku',
      account_id: 'account_acme',
      query: 'What changed after the renewal call?',
    });
    expect(directory).toMatchObject({
      routeDenied: false,
      ingestionState: 'ingesting',
      summaryText: '1 account, ingesting',
      sourcePointer: 'broker:company_brain_directory:david-poku',
      auditId: 'audit_directory_123',
    });
    expect(directory.accounts[0]).toMatchObject({
      accountId: 'account_acme',
      name: 'Acme Co',
      ingestionState: 'ready',
      exceptionCount: 2,
      sourcePointer: 'broker:company_brain_account:account_acme',
    });
    expect(account).toMatchObject({
      accountId: 'account_acme',
      brief: {
        title: 'Renewal account',
      },
      timeline: [
        {
          entryId: 'tl_1',
          title: 'Renewal call',
        },
      ],
      exceptions: [
        {
          exceptionId: 'exc_1',
          title: 'Drive connector still ingesting',
        },
      ],
      sourcePointer: 'broker:company_brain_account_360:account_acme',
      auditId: 'audit_360_123',
    });
    expect(query).toMatchObject({
      status: 'answered',
      answer: 'Acme asked for rollout options after the renewal call.',
      citations: [
        {
          citationId: 'cite_1',
          sourcePointer: 'broker:company_brain_citation:cite_1',
        },
      ],
      sourcePointer: 'broker:company_brain_query:account_acme',
      auditId: 'audit_query_123',
    });
    expect(JSON.stringify({ directory, account, query })).not.toMatch(
      /\beds_[A-Za-z0-9_-]+\b|access_token|refresh_token|desktop_session|raw_prompt|raw_embedding_text|Bearer/i
    );
  });

  it('fails closed on cross-org Company Brain directory evidence', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['view_company_brain'])))
      .mockResolvedValueOnce(
        jsonResponse(
          directoryPayload({
            customer_account_id: 'acct_other',
          })
        )
      );
    const client = authenticatedClient(fetchImpl);

    await expect(client.companyBrainDirectory({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
    });
  });

  it('fails closed when Company Brain directory evidence omits explicit customer proof', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['view_company_brain'])))
      .mockResolvedValueOnce(
        jsonResponse(
          directoryPayload({
            customer_id: undefined,
          })
        )
      );
    const client = authenticatedClient(fetchImpl);

    await expect(client.companyBrainDirectory({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
    });
  });

  it('fails closed when directory account rows omit row-level customer account proof', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['view_company_brain'])))
      .mockResolvedValueOnce(
        jsonResponse(
          directoryPayload({
            accounts: [
              {
                ...accountSummary,
                customer_account_id: undefined,
              },
            ],
          })
        )
      );
    const client = authenticatedClient(fetchImpl);

    await expect(client.companyBrainDirectory({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
    });
  });

  it('fails closed instead of dropping malformed rows from a non-empty directory', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['view_company_brain'])))
      .mockResolvedValueOnce(
        jsonResponse(
          directoryPayload({
            accounts: [
              {
                ...accountSummary,
                account_id: '',
              },
            ],
          })
        )
      );
    const client = authenticatedClient(fetchImpl);

    await expect(client.companyBrainDirectory({ customerId: 'david-poku' })).rejects.toMatchObject({
      code: 'broker_invalid_response',
    });
  });

  it('fails closed when query proof is missing backend enforcement', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['view_company_brain'])))
      .mockResolvedValueOnce(
        jsonResponse({
          schema_version: 'evaos.company_brain.query.v1',
          customer_id: 'david-poku',
          customer_account_id: 'acct_123',
          account_id: 'account_acme',
          status: 'answered',
          answer: 'Acme asked for rollout options.',
          source_pointer: 'broker:company_brain_query:account_acme',
          audit_id: 'audit_query_123',
          backend_enforced: false,
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.companyBrainQuery({
        customerId: 'david-poku',
        accountId: 'account_acme',
        query: 'What changed?',
      })
    ).rejects.toMatchObject({
      code: 'broker_invalid_response',
    });
  });

  it('fails closed instead of rendering common third-party secret tokens from query answers', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['view_company_brain'])))
      .mockResolvedValueOnce(
        jsonResponse({
          schema_version: 'evaos.company_brain.query.v1',
          customer_id: 'david-poku',
          customer_account_id: 'acct_123',
          account_id: 'account_acme',
          status: 'answered',
          answer:
            'Leaked keys sk_live_1234567890abcdef and ghp_123456789012345678901234567890abcdef and AIzaSy12345678901234567890123456789012345',
          source_pointer: 'broker:company_brain_query:account_acme',
          audit_id: 'audit_query_123',
          backend_enforced: true,
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.companyBrainQuery({
        customerId: 'david-poku',
        accountId: 'account_acme',
        query: 'What changed?',
      })
    ).rejects.toMatchObject({
      code: 'broker_invalid_response',
    });
  });

  it('fails closed when query evidence omits explicit account proof', async () => {
    const fetchImpl = fetchMock();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(accountPayload))
      .mockResolvedValueOnce(jsonResponse(policyPayload(['view_company_brain'])))
      .mockResolvedValueOnce(
        jsonResponse({
          schema_version: 'evaos.company_brain.query.v1',
          customer_id: 'david-poku',
          customer_account_id: 'acct_123',
          status: 'answered',
          answer: 'Acme asked for rollout options.',
          source_pointer: 'broker:company_brain_query:account_acme',
          audit_id: 'audit_query_123',
          backend_enforced: true,
        })
      );
    const client = authenticatedClient(fetchImpl);

    await expect(
      client.companyBrainQuery({
        customerId: 'david-poku',
        accountId: 'account_acme',
        query: 'What changed?',
      })
    ).rejects.toMatchObject({
      code: 'broker_invalid_response',
    });
  });
});
