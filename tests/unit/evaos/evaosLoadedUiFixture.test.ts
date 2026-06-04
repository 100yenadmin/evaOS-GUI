/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createEvaosLoadedUiFixture } from './fixtures/loadedUiFixture';

const SECRET_PATTERN =
  /(?:Bearer\s+|access[_-]?token|refresh[_-]?token|id[_-]?token|jwt|provider[_-]?grant|desktop[_-]?session|\beds_|\bepg_|eyJ[a-zA-Z0-9_-]*\.|token=|secret|password|credential|customer_credentials)/i;

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => stringValues(item));
  if (value && typeof value === 'object') return Object.values(value).flatMap((item) => stringValues(item));
  return [];
}

describe('evaOS loaded UI local fixture', () => {
  it('is deterministic, explicitly non-live, and cannot satisfy parent issue #67', () => {
    const first = createEvaosLoadedUiFixture();
    const second = createEvaosLoadedUiFixture();

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.mode).toEqual({
      kind: 'local-fixture',
      live: false,
      label: 'LOCAL FIXTURE - NOT LIVE BETA PROOF',
      satisfiesParentIssue67: false,
      publicBetaReleaseEnabled: false,
      issue: 80,
      parentIssue: 67,
    });
  });

  it('covers the loaded Product Reality buckets required by issue #80', () => {
    const fixture = createEvaosLoadedUiFixture();

    expect(fixture.customer).toMatchObject({
      customerId: 'fixture-customer-acme',
      customerAccountId: 'fixture-account-acme',
      accountName: 'Acme Fixture Co',
    });
    expect(fixture.people.members.map((member) => member.role)).toEqual(['owner', 'admin', 'member', 'agent_only']);
    expect(fixture.people.invites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'pending', role: 'member' }),
        expect.objectContaining({ status: 'expired', role: 'technical_admin' }),
      ])
    );
    expect(fixture.people.policy).toMatchObject({
      schemaVersion: 'evaos.account_policy.v1',
      seatLimit: 8,
      activeSeats: 4,
      invitedSeats: 2,
      routeDenied: false,
      backendEnforced: true,
    });

    expect(fixture.providers.profiles.map((profile) => profile.status)).toEqual([
      'connected',
      'needs_login',
      'expired',
      'revoked',
      'approval_required',
    ]);

    expect(fixture.approvals.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ approvalId: 'fixture-approval-requested', canDeny: true }),
        expect.objectContaining({
          approvalId: 'fixture-approval-approved',
          nextAction: 'Approved in fixture audit trail.',
        }),
        expect.objectContaining({
          approvalId: 'fixture-approval-denied',
          nextAction: 'Denied in fixture audit trail.',
        }),
      ])
    );

    expect(fixture.companyBrain.directory.ingestionState).toBe('ingesting');
    expect(fixture.companyBrain.account360.ingestionState).toBe('ready');
    expect(fixture.companyBrain.query.status).toBe('error');
    expect(fixture.companyBrain.denied.routeDenied).toBe(true);

    expect(fixture.businessBrowser.active.status).toBe('running');
    expect(fixture.businessBrowser.offline.status).toBe('offline');
    expect(fixture.businessBrowser.launch.status).toBe('launching');
    expect(fixture.businessBrowser.stop.status).toBe('stopped');
    expect(fixture.businessBrowser.denied.routeDenied).toBe(true);
  });

  it('is secret-free and contains no token-bearing URLs or production data markers', () => {
    const fixtureText = stringValues(createEvaosLoadedUiFixture()).join('\n');

    expect(fixtureText).not.toMatch(SECRET_PATTERN);
    expect(fixtureText).not.toMatch(/https:\/\/(app|api|dashboard)\.(evaos|hireeva|electricsheep)\./i);
    expect(fixtureText).not.toMatch(/localhost:\d+\/.*(?:token|jwt|session|grant)=/i);
    expect(fixtureText).not.toMatch(/@(?!example\.test\b)[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});
