/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  evaosLocalProductFixtureBusinessBrowserAction,
  evaosLocalProductFixtureBusinessBrowserStatus,
  evaosLocalProductFixtureCompanyBrainAccount360,
  evaosLocalProductFixtureCompanyBrainDirectory,
  evaosLocalProductFixtureCompanyBrainQuery,
  evaosLocalProductFixtureCustomerTargets,
  evaosLocalProductFixtureProviderAction,
  evaosLocalProductFixtureProviderHub,
  isEvaosLocalProductFixtureEnabled,
} from '@/process/services/evaosLocalProductFixture';

const SECRET_PATTERN =
  /\b(?:eds|epg)_[A-Za-z0-9_-]+\b|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|grant[_-]?handle|Bearer|authorization/i;

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  return Object.values(value).flatMap(stringValues);
}

describe('evaOS local product fixture', () => {
  it('requires both E2E mode and explicit local product fixture opt-in', () => {
    expect(isEvaosLocalProductFixtureEnabled({ AIONUI_E2E_TEST: '1' })).toBe(false);
    expect(isEvaosLocalProductFixtureEnabled({ AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE: '1' })).toBe(false);
    expect(isEvaosLocalProductFixtureEnabled({ AIONUI_E2E_TEST: '1', AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE: '1' })).toBe(
      true
    );
  });

  it('provides loaded customer and provider state proof without secret-shaped values', () => {
    const customers = evaosLocalProductFixtureCustomerTargets();
    const hub = evaosLocalProductFixtureProviderHub({ customerId: 'fixture-customer-acme' });

    expect(customers.summaryText).toContain('LOCAL FIXTURE - NOT LIVE BETA PROOF');
    expect(customers.selectedCustomerId).toBe('fixture-customer-acme');
    expect(customers.customers.map((customer) => customer.displayName)).toEqual([
      'Acme Fixture Co',
      'Denied Browser Fixture Co',
    ]);
    expect(hub.summaryText).toContain('LOCAL FIXTURE - NOT LIVE BETA PROOF');
    expect(hub.profiles.map((profile) => profile.status)).toEqual([
      'connected',
      'needs_login',
      'expired',
      'revoked',
      'approval_required',
    ]);
    expect(hub.profiles.find((profile) => profile.providerKey === 'google_workspace')).toMatchObject({
      hasConnectionProof: true,
      hasBrokeredGrant: true,
    });
    expect(stringValues({ customers, hub }).join('\n')).not.toMatch(SECRET_PATTERN);
  });

  it('fails closed for a customer outside the local fixture', () => {
    const hub = evaosLocalProductFixtureProviderHub({ customerId: 'wrong-customer' });

    expect(hub.routeDenied).toBe(true);
    expect(hub.profiles).toEqual([]);
    expect(hub.summaryText).toContain('wrong customer fixture');
  });

  it('returns broker-like provider action evidence without exposing opaque handles', () => {
    const result = evaosLocalProductFixtureProviderAction(
      { customerId: 'fixture-customer-acme', providerKey: 'google_workspace', agentRuntime: 'openclaw' },
      'provider_mint_grant'
    );

    expect(result).toMatchObject({
      status: 'granted',
      providerKey: 'google_workspace',
      backendEnforced: true,
    });
    expect(result.message).toContain('opaque agent access handle minted');
    expect(stringValues(result).join('\n')).not.toMatch(SECRET_PATTERN);
  });

  it('provides loaded Business Browser runtime and action proof without secrets', () => {
    const status = evaosLocalProductFixtureBusinessBrowserStatus({ customerId: 'fixture-customer-acme' });
    const launch = evaosLocalProductFixtureBusinessBrowserAction(
      { customerId: 'fixture-customer-acme' },
      'browser_launch'
    );
    const openUrl = evaosLocalProductFixtureBusinessBrowserAction(
      { customerId: 'fixture-customer-acme', url: 'https://runtime.example.test/work?token=raw-secret' },
      'browser_open_url'
    );
    const stop = evaosLocalProductFixtureBusinessBrowserAction({ customerId: 'fixture-customer-acme' }, 'browser_stop');

    expect(status).toMatchObject({
      schemaVersion: 'evaos.browser_status.v1',
      customerId: 'fixture-customer-acme',
      routeDenied: false,
      backendEnforced: true,
      displayLabel: 'Business Browser Fixture',
      status: 'running',
      controlSessionActive: true,
      canOpenUrl: true,
      sourcePointer: 'local-fixture:business-browser:running',
      auditId: 'fixture-audit-browser-running',
    });
    expect(status.currentUrlSummary?.displayText).toBe('fixture.example.test/dashboard');
    expect(launch).toMatchObject({
      status: 'launching',
      backendEnforced: true,
      sourcePointer: 'local-fixture:business-browser:launch',
      auditId: 'fixture-audit-browser-launch',
    });
    expect(launch.browser?.status).toBe('launching');
    expect(openUrl).toMatchObject({
      status: 'opened',
      backendEnforced: true,
      sourcePointer: 'local-fixture:business-browser:open-url',
      auditId: 'fixture-audit-browser-open-url',
    });
    expect(openUrl.urlSummary?.displayText).toBe('runtime.example.test/work');
    expect(openUrl.browser?.currentUrlSummary?.displayText).toBe('runtime.example.test/work');
    expect(stop).toMatchObject({
      status: 'stopped',
      backendEnforced: true,
      sourcePointer: 'local-fixture:business-browser:stop',
      auditId: 'fixture-audit-browser-stop',
    });
    expect(stop.browser?.status).toBe('stopped');
    expect(stringValues({ status, launch, openUrl, stop }).join('\n')).not.toMatch(SECRET_PATTERN);
  });

  it('fails Business Browser closed for denied and wrong customer fixture paths', () => {
    const denied = evaosLocalProductFixtureBusinessBrowserStatus({ customerId: 'fixture-customer-browser-denied' });
    const wrongCustomer = evaosLocalProductFixtureBusinessBrowserStatus({ customerId: 'wrong-customer' });
    const deniedAction = evaosLocalProductFixtureBusinessBrowserAction(
      { customerId: 'fixture-customer-browser-denied' },
      'browser_launch'
    );

    expect(denied).toMatchObject({
      customerId: 'fixture-customer-browser-denied',
      routeDenied: true,
      backendEnforced: true,
      membershipRole: 'agent_only',
      status: 'denied',
      canLaunch: false,
      canOpenUrl: false,
      canStop: false,
      sourcePointer: 'local-fixture:business-browser:denied',
      policyAuditId: 'fixture-audit-browser-denied-policy',
    });
    expect(denied.routeDenialReason).toContain('account policy lacks open_business_browser');
    expect(wrongCustomer.routeDenied).toBe(true);
    expect(wrongCustomer.routeDenialReason).toContain('customer target is not available');
    expect(deniedAction.status).toBe('denied');
    expect(deniedAction.backendEnforced).toBe(true);
    expect(deniedAction.browser?.routeDenied).toBe(true);
    expect(stringValues({ denied, wrongCustomer, deniedAction }).join('\n')).not.toMatch(SECRET_PATTERN);
  });

  it('provides loaded Company Brain directory, account, query, and denial proof without secrets', () => {
    const directory = evaosLocalProductFixtureCompanyBrainDirectory({ customerId: 'fixture-customer-acme' });
    const account = evaosLocalProductFixtureCompanyBrainAccount360({
      customerId: 'fixture-customer-acme',
      accountId: 'fixture-company-renewal',
    });
    const query = evaosLocalProductFixtureCompanyBrainQuery({
      customerId: 'fixture-customer-acme',
      accountId: 'fixture-company-renewal',
      query: 'What needs attention?',
    });
    const deniedQuery = evaosLocalProductFixtureCompanyBrainQuery({
      customerId: 'fixture-customer-acme',
      accountId: 'missing-fixture-account',
      query: 'What needs attention?',
    });
    const denied = evaosLocalProductFixtureCompanyBrainDirectory({ customerId: 'wrong-customer' });

    expect(directory.summaryText).toContain('LOCAL FIXTURE - NOT LIVE BETA PROOF');
    expect(directory.accounts.map((item) => item.ingestionState)).toEqual(['ready', 'ingesting', 'error']);
    expect(directory.sourcePointer).toBe('local-fixture:company-brain:directory');
    expect(account.brief?.title).toBe('Renewal fixture brief');
    expect(account.sourcePointer).toBe('local-fixture:company-brain:account-360:fixture-company-renewal');
    expect(query.status).toBe('answered');
    expect(query.sourcePointer).toBe('local-fixture:company-brain:query:fixture-company-renewal');
    expect(deniedQuery.status).toBe('denied');
    expect(deniedQuery.sourcePointer).toBe('local-fixture:company-brain:query:denied');
    expect(denied.routeDenied).toBe(true);
    expect(denied.routeDenialReason).toContain('wrong customer fixture');
    expect(stringValues({ directory, account, query, deniedQuery, denied }).join('\n')).not.toMatch(SECRET_PATTERN);
  });
});
