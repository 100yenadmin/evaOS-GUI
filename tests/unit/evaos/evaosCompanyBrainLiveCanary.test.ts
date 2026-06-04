/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const companyBrainCanary = require('../../../scripts/evaosCompanyBrainLiveCanary.js') as {
  parseRequiredIngestionStates: (value?: string) => string[];
  runCompanyBrainLiveCanary: (options: {
    env: Record<string, string | undefined>;
    fetchImpl: typeof fetch;
  }) => Promise<Record<string, unknown>>;
  summarizeCompanyBrainProof: (
    raw: { policy: unknown; directory: unknown; account360: unknown; query: unknown },
    request: { customerId: string; accountId: string; requiredIngestionStates: string[] }
  ) => Record<string, unknown>;
  summarizeDeniedAttempt: (result: { ok: boolean; httpStatus: number; body: unknown }) => Record<string, unknown>;
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const env = {
  AIONUI_EVAOS_DESKTOP_SESSION: 'eds_company_brain_session_for_test',
  AIONUI_EVAOS_CUSTOMER_ID: 'cus_123',
  AIONUI_EVAOS_COMPANY_BRAIN_ACCOUNT_ID: 'account_acme',
  AIONUI_EVAOS_COMPANY_BRAIN_QUERY: 'What changed after the renewal call?',
  AIONUI_EVAOS_BROKER_ENDPOINT: 'https://broker.example.test/runtime',
};

const policy = {
  customer_id: 'cus_123',
  customer_account_id: 'acct_123',
  membership_id: 'mem_admin',
  membership_role: 'admin',
  scopes: ['view_company_brain'],
  backend_enforced: true,
  audit_id: 'audit_policy_123',
};

const directory = {
  schema_version: 'evaos.company_brain.directory.v1',
  customer_id: 'cus_123',
  customer_account_id: 'acct_123',
  ingestion_state: 'ingesting',
  integration_health: {
    state: 'ingesting',
    summary: 'Drive ingestion in progress',
  },
  accounts: [
    {
      account_id: 'account_acme',
      name: 'Acme Co',
      customer_account_id: 'acct_123',
      ingestion_state: 'ready',
      exception_count: 1,
      source_pointer: 'broker:company_brain_account:account_acme',
      audit_id: 'audit_account_row_123',
    },
  ],
  source_pointer: 'broker:company_brain_directory:cus_123',
  audit_id: 'audit_directory_123',
  backend_enforced: true,
};

const account360 = {
  schema_version: 'evaos.company_brain.account_360.v1',
  customer_id: 'cus_123',
  customer_account_id: 'acct_123',
  account_id: 'account_acme',
  account: directory.accounts[0],
  ingestion_state: 'ready',
  brief: {
    title: 'Renewal account',
    summary: 'Customer-sensitive brief text should not print in proof.',
    source_pointer: 'broker:company_brain_brief:account_acme',
    audit_id: 'audit_brief_123',
  },
  timeline: [
    {
      event_id: 'tl_1',
      type: 'meeting',
      title: 'Renewal call',
      summary: 'Customer-sensitive timeline text should not print.',
      source_pointer: 'broker:company_brain_timeline:tl_1',
      audit_id: 'audit_timeline_123',
    },
  ],
  exceptions: [
    {
      exception_id: 'exc_1',
      severity: 'warning',
      title: 'Drive connector still ingesting',
      status: 'open',
      source_pointer: 'broker:company_brain_exception:exc_1',
      audit_id: 'audit_exception_123',
    },
  ],
  source_pointer: 'broker:company_brain_account_360:account_acme',
  audit_id: 'audit_360_123',
  backend_enforced: true,
};

const query = {
  schema_version: 'evaos.company_brain.query.v1',
  customer_id: 'cus_123',
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
    },
  ],
  source_pointer: 'broker:company_brain_query:account_acme',
  audit_id: 'audit_query_123',
  backend_enforced: true,
};

describe('evaOS Company Brain live canary', () => {
  it('parses optional ingestion state requirements and rejects unsupported states', () => {
    expect(companyBrainCanary.parseRequiredIngestionStates(undefined)).toEqual([]);
    expect(companyBrainCanary.parseRequiredIngestionStates('ready,ingesting')).toEqual(['ready', 'ingesting']);
    expect(() => companyBrainCanary.parseRequiredIngestionStates('ready,leaking')).toThrow(
      /Unsupported Company Brain ingestion state/
    );
  });

  it('summarizes directory, account, and query proof without printing customer content', () => {
    const proof = companyBrainCanary.summarizeCompanyBrainProof(
      { policy, directory, account360, query },
      { customerId: 'cus_123', accountId: 'account_acme', requiredIngestionStates: ['ready', 'ingesting'] }
    );

    expect(proof).toMatchObject({
      schema: 'evaos-company-brain-live-canary/v1',
      customerId: 'cus_123',
      customerAccountId: 'acct_123',
      directory: {
        backendEnforced: true,
        ingestionState: 'ingesting',
        accountCount: 1,
      },
      account360: {
        accountId: 'account_acme',
        backendEnforced: true,
        timelineCount: 1,
        exceptionCount: 1,
      },
      query: {
        accountId: 'account_acme',
        status: 'answered',
        citationCount: 1,
      },
      requiredIngestionStates: ['ready', 'ingesting'],
      ingestionStatesPresent: ['ingesting', 'ready'],
      sensitiveOutput: 'passed',
    });
    expect(JSON.stringify(proof)).not.toMatch(
      /Acme Co|renewal call|Customer-sensitive|rollout options|eds_|access_token|desktop_session|Bearer/i
    );
  });

  it('fails closed when the expected account is absent from the directory fixture', () => {
    expect(() =>
      companyBrainCanary.summarizeCompanyBrainProof(
        {
          policy,
          directory: {
            ...directory,
            accounts: [],
          },
          account360,
          query,
        },
        { customerId: 'cus_123', accountId: 'account_acme', requiredIngestionStates: [] }
      )
    ).toThrow(/did not include expected account/);
  });

  it('fails closed when the expected directory account lacks row-level org proof', () => {
    expect(() =>
      companyBrainCanary.summarizeCompanyBrainProof(
        {
          policy,
          directory: {
            ...directory,
            accounts: [
              {
                ...directory.accounts[0],
                customer_account_id: 'acct_other',
              },
            ],
          },
          account360,
          query,
        },
        { customerId: 'cus_123', accountId: 'account_acme', requiredIngestionStates: [] }
      )
    ).toThrow(/directory account row/);
  });

  it('accepts backend cross-org denial and rejects successful wrong-customer reads', () => {
    expect(
      companyBrainCanary.summarizeDeniedAttempt({
        ok: false,
        httpStatus: 403,
        body: {
          code: 'org_denied',
          message: 'Cross-org Company Brain access denied.',
          source_pointer: 'broker:company_brain_denial:cus_other',
          audit_id: 'audit_denied_123',
        },
      })
    ).toMatchObject({
      backendDenied: true,
      httpStatus: 403,
      code: 'org_denied',
      sourcePointer: 'broker:company_brain_denial:cus_other',
      auditId: 'audit_denied_123',
    });

    expect(() =>
      companyBrainCanary.summarizeDeniedAttempt({
        ok: true,
        httpStatus: 200,
        body: directory,
      })
    ).toThrow(/did not fail closed/);
  });

  it('rejects positive query statuses that do not prove an answered query', () => {
    for (const status of ['error', 'denied', 'pending']) {
      expect(() =>
        companyBrainCanary.summarizeCompanyBrainProof(
          {
            policy,
            directory,
            account360,
            query: {
              ...query,
              status,
              answer: undefined,
            },
          },
          { customerId: 'cus_123', accountId: 'account_acme', requiredIngestionStates: [] }
        )
      ).toThrow(/must return answered status/);
    }
  });

  it('rejects negative denial proof without source and audit evidence', () => {
    expect(() =>
      companyBrainCanary.summarizeDeniedAttempt({
        ok: false,
        httpStatus: 403,
        body: {
          code: 'org_denied',
          message: 'Cross-org Company Brain access denied.',
        },
      })
    ).toThrow(/source and audit evidence/);
  });

  it('runs read-only Company Brain checks and wrong-customer denial across every Company Brain action', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(policy))
      .mockResolvedValueOnce(jsonResponse(directory))
      .mockResolvedValueOnce(jsonResponse(account360))
      .mockResolvedValueOnce(jsonResponse(query))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: 'org_denied',
            message: 'Cross-org Company Brain access denied.',
            source_pointer: 'broker:company_brain_denial:directory:cus_other',
            audit_id: 'audit_denied_directory_123',
          },
          { status: 403 }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: 'org_denied',
            message: 'Cross-org Company Brain account access denied.',
            source_pointer: 'broker:company_brain_denial:account_360:cus_other',
            audit_id: 'audit_denied_account_123',
          },
          { status: 403 }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: 'org_denied',
            message: 'Cross-org Company Brain query access denied.',
            source_pointer: 'broker:company_brain_denial:query:cus_other',
            audit_id: 'audit_denied_123',
          },
          { status: 403 }
        )
      );

    const proof = await companyBrainCanary.runCompanyBrainLiveCanary({
      env: {
        ...env,
        AIONUI_EVAOS_COMPANY_BRAIN_WRONG_CUSTOMER_ID: 'cus_other',
        AIONUI_EVAOS_COMPANY_BRAIN_REQUIRED_INGESTION_STATES: 'ready,ingesting',
      },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(7);
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer eds_company_brain_session_for_test',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      action: 'current_customer_account_permissions',
      customer_id: 'cus_123',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[2][1]?.body))).toMatchObject({
      action: 'company_brain_account_360',
      customer_id: 'cus_123',
      account_id: 'account_acme',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[3][1]?.body))).toMatchObject({
      action: 'company_brain_query',
      customer_id: 'cus_123',
      account_id: 'account_acme',
      query: 'What changed after the renewal call?',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[4][1]?.body))).toMatchObject({
      action: 'company_brain_directory',
      customer_id: 'cus_other',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[5][1]?.body))).toMatchObject({
      action: 'company_brain_account_360',
      customer_id: 'cus_other',
      account_id: 'account_acme',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[6][1]?.body))).toMatchObject({
      action: 'company_brain_query',
      customer_id: 'cus_other',
      account_id: 'account_acme',
      query: 'What changed after the renewal call?',
    });
    expect(proof).toMatchObject({
      schema: 'evaos-company-brain-live-proof/v1',
      customerId: 'cus_123',
      accountId: 'account_acme',
      companyBrain: {
        query: {
          citationCount: 1,
        },
      },
      crossOrgDenial: {
        directory: {
          backendDenied: true,
        },
        account360: {
          backendDenied: true,
        },
        query: {
          backendDenied: true,
        },
      },
      sensitiveOutput: 'passed',
    });
    expect(JSON.stringify(proof)).not.toMatch(/eds_|Acme Co|rollout options|access_token|desktop_session|Bearer/i);
  });

  it('requires a negative boundary fixture unless explicitly bypassed', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      companyBrainCanary.runCompanyBrainLiveCanary({
        env,
        fetchImpl,
      })
    ).rejects.toThrow(/requires AIONUI_EVAOS_COMPANY_BRAIN_WRONG_CUSTOMER_ID/);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('labels explicit no-negative bypass output as dry-run only', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(policy))
      .mockResolvedValueOnce(jsonResponse(directory))
      .mockResolvedValueOnce(jsonResponse(account360))
      .mockResolvedValueOnce(jsonResponse(query));

    const proof = await companyBrainCanary.runCompanyBrainLiveCanary({
      env: {
        ...env,
        AIONUI_EVAOS_COMPANY_BRAIN_ALLOW_NO_NEGATIVE: '1',
      },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(proof).toMatchObject({
      dryRun: true,
      acceptanceProof: false,
      negativeBoundary: 'not-run',
    });
  });
});
