import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const provisioner = require('../../../scripts/evaosProvisionLiveCanaryFixtures.js') as {
  assertNoUnsafeProofOutput: (value: unknown) => void;
  fixtureEnvFromProvision: (state: Record<string, unknown>) => Record<string, string>;
  renderGithubEnvFile: (env: Record<string, string>) => string;
  sanitizedProvisionReport: (state: Record<string, unknown>) => Record<string, unknown>;
  restoreProviderProfileSnapshot: (
    admin: FakeProviderAdmin,
    row: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  restoreProviderSnapshots: (admin: FakeProviderAdmin, state: Record<string, unknown>) => Promise<void>;
  upsertProviderFixtureRows: (admin: FakeProviderAdmin, customerId: string) => Promise<void>;
};

type ProviderRow = Record<string, unknown>;

class FakeProviderAdmin {
  rows: ProviderRow[];
  deletes: Array<{ query: Record<string, string> }> = [];
  inserts: Array<{ body: ProviderRow; options: Record<string, unknown> }> = [];
  patches: Array<{ query: Record<string, string>; body: ProviderRow }> = [];

  constructor(rows: ProviderRow[]) {
    this.rows = rows.map((row) => Object.assign({}, row));
  }

  async select(_table: string, query: Record<string, string | number>) {
    const rows = this.rows.filter((row) => {
      for (const [key, value] of Object.entries(query)) {
        if (key === 'select' || key === 'limit') continue;
        if (typeof value === 'string' && value.startsWith('eq.') && String(row[key]) !== value.slice(3)) {
          return false;
        }
      }
      return true;
    });
    return rows.slice(0, Number(query.limit ?? rows.length)).map((row) => Object.assign({}, row));
  }

  async insert(_table: string, body: ProviderRow, options: Record<string, unknown> = {}) {
    const row = { id: body.id ?? `inserted-${this.inserts.length + 1}`, ...body };
    this.rows.push(row);
    this.inserts.push({ body: row, options });
    return { ...row };
  }

  async patch(_table: string, query: Record<string, string>, body: ProviderRow) {
    this.patches.push({ query, body });
    for (const row of this.rows) {
      const matches = Object.entries(query).every(([key, value]) => {
        return typeof value !== 'string' || !value.startsWith('eq.') || String(row[key]) === value.slice(3);
      });
      if (matches) Object.assign(row, body);
    }
  }

  async upsert() {
    throw new Error('unexpected composite upsert');
  }

  async deleteRows(_table: string, query: Record<string, string>) {
    this.deletes.push({ query });
  }
}

function fixtureState() {
  return {
    brokerEndpoint: 'https://rhfojelkgtwcxnrfhtlj.supabase.co/functions/v1/desktop-runtime-session',
    customerId: 'golden',
    runtime: 'openclaw',
    customerAccountId: '823ee8be-d547-4df9-9ee5-20cc7bb1ddcb',
    wrongCustomerId: 'aionui-wrong-customer-proof',
    admin: {
      id: 'admin-profile-id',
      email: 'admin@100yen.org',
      membershipId: 'admin-membership-id',
      membershipRole: 'owner',
    },
    requester: {
      userId: 'requester-user-id',
      email: 'aionui-deny-requester@example.test',
      membershipId: 'requester-membership-id',
      role: 'technical_admin',
    },
    denied: {
      userId: 'denied-user-id',
      email: 'aionui-denied-member@example.test',
    },
    sessions: {
      admin: {
        id: 'admin-session-id',
        raw: 'eds_admin_session_for_test',
        expiresAt: '2026-06-06T01:00:00.000Z',
      },
      requester: {
        id: 'requester-session-id',
        raw: 'eds_requester_session_for_test',
        expiresAt: '2026-06-06T01:00:00.000Z',
      },
      denied: {
        id: 'denied-session-id',
        raw: 'eds_denied_session_for_test',
        expiresAt: '2026-06-06T01:00:00.000Z',
      },
    },
    approval: {
      approvalId: 'approval-id',
      providerKey: 'github',
      requestedAction: 'provider_revoke',
      sourcePointer: 'broker:provider_approval_request:golden:approval-id',
      auditId: 'approval-audit-id',
    },
    companyBrain: {
      accountId: 'company-brain-account-id',
      query: 'What changed recently for this account?',
    },
    businessBrowser: {
      testUrl: 'https://www.electricsheephq.com/dashboard/',
      allowedHosts: 'www.electricsheephq.com',
    },
  };
}

describe('evaOS live canary fixture provisioner', () => {
  it('exports the existing live canary environment contract from fresh provisioned state', () => {
    const env = provisioner.fixtureEnvFromProvision(fixtureState());

    expect(env).toMatchObject({
      AIONUI_EVAOS_CUSTOMER_ID: 'golden',
      AIONUI_EVAOS_RUNTIME: 'openclaw',
      AIONUI_EVAOS_APPROVAL_DENY_ACK: 'evaos-deny-test',
      AIONUI_EVAOS_APPROVAL_ID: 'approval-id',
      AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK: 'evaos-browser-test',
      AIONUI_EVAOS_COMPANY_BRAIN_WRONG_CUSTOMER_ID: 'aionui-wrong-customer-proof',
      AIONUI_EVAOS_BUSINESS_BROWSER_WRONG_CUSTOMER_ID: 'aionui-wrong-customer-proof',
    });
    expect(env.AIONUI_EVAOS_DESKTOP_SESSION).toBe('eds_admin_session_for_test');
    expect(env.AIONUI_EVAOS_REQUESTER_SESSION).toBe('eds_requester_session_for_test');
    expect(env.AIONUI_EVAOS_COMPANY_BRAIN_DENIED_SESSION).toBe('eds_denied_session_for_test');
  });

  it('writes GitHub env lines without shell commands or multiline values', () => {
    const rendered = provisioner.renderGithubEnvFile({
      AIONUI_EVAOS_CUSTOMER_ID: 'golden',
      AIONUI_EVAOS_COMPANY_BRAIN_QUERY: 'What changed?\nInjected=bad',
    });

    expect(rendered).toContain('AIONUI_EVAOS_CUSTOMER_ID=golden');
    expect(rendered).toContain('AIONUI_EVAOS_COMPANY_BRAIN_QUERY=What changed?Injected=bad');
    expect(rendered).not.toContain('gh secret set');
    expect(rendered).not.toContain('\nInjected=bad');
  });

  it('keeps sanitized proof free of desktop sessions and service-role markers', () => {
    const report = provisioner.sanitizedProvisionReport(fixtureState());
    const text = JSON.stringify(report);

    expect(report).toMatchObject({
      schema: 'evaos-live-canary-fixture-provision/v1',
      customerId: 'golden',
      sensitiveOutput: 'passed',
    });
    expect(text).not.toMatch(/eds_(admin|requester|denied)/);
    expect(text).not.toMatch(/service[_-]?role/i);
    expect(text).not.toMatch(/desktop[_-]?session/i);
  });

  it('rejects unsafe proof output if a secret marker is accidentally added', () => {
    expect(() =>
      provisioner.assertNoUnsafeProofOutput({
        safe: true,
        accidentallyUnsafe: 'Bearer secret_token_for_test',
      })
    ).toThrow(/unsafe material/i);
  });

  it('patches one selected provider fixture row or inserts without requiring a composite unique constraint', async () => {
    const admin = new FakeProviderAdmin([
      {
        id: 'existing-slack-1',
        customer_id: 'golden',
        provider_key: 'slack',
        status: 'old',
      },
      {
        id: 'existing-slack-2',
        customer_id: 'golden',
        provider_key: 'slack',
        status: 'duplicate-old',
      },
    ]);

    await provisioner.upsertProviderFixtureRows(admin, 'golden');

    expect(admin.patches).toEqual([
      expect.objectContaining({
        query: { id: 'eq.existing-slack-1' },
      }),
    ]);
    expect(admin.inserts.map((insert) => String(insert.body.provider_key)).toSorted()).toEqual(['linear', 'notion']);
    expect(admin.inserts.map((insert) => insert.options)).toEqual([
      { select: 'customer_id,provider_key,status', label: 'linear provider fixture' },
      { select: 'customer_id,provider_key,status', label: 'notion provider fixture' },
    ]);
    expect(admin.rows.find((row) => row.id === 'existing-slack-1')?.status).toBe('connected');
    expect(admin.rows.find((row) => row.id === 'existing-slack-2')?.status).toBe('duplicate-old');
  });

  it('restores provider snapshots by row id before falling back to natural-key writes', async () => {
    const admin = new FakeProviderAdmin([
      {
        id: 'snapshot-row',
        customer_id: 'golden',
        provider_key: 'slack',
        status: 'fixture',
      },
    ]);

    await provisioner.restoreProviderProfileSnapshot(admin, {
      id: 'snapshot-row',
      customer_id: 'golden',
      provider_key: 'slack',
      status: 'connected',
    });

    expect(admin.patches).toEqual([
      expect.objectContaining({
        query: { id: 'eq.snapshot-row' },
      }),
    ]);
    expect(admin.rows[0]?.status).toBe('connected');
  });

  it('restores every duplicate provider snapshot row instead of collapsing by provider key', async () => {
    const admin = new FakeProviderAdmin([
      {
        id: 'snapshot-row-1',
        customer_id: 'golden',
        provider_key: 'slack',
        status: 'fixture-1',
      },
      {
        id: 'snapshot-row-2',
        customer_id: 'golden',
        provider_key: 'slack',
        status: 'fixture-2',
      },
    ]);

    await provisioner.restoreProviderSnapshots(admin, {
      customerId: 'golden',
      providerSnapshots: [
        {
          providerKey: 'slack',
          row: {
            id: 'snapshot-row-1',
            customer_id: 'golden',
            provider_key: 'slack',
            status: 'connected',
          },
        },
        {
          providerKey: 'slack',
          row: {
            id: 'snapshot-row-2',
            customer_id: 'golden',
            provider_key: 'slack',
            status: 'revoked',
          },
        },
      ],
    });

    expect(admin.patches.map((patch) => patch.query)).toEqual([
      { id: 'eq.snapshot-row-1' },
      { id: 'eq.snapshot-row-2' },
    ]);
    expect(admin.rows.map((row) => row.status)).toEqual(['connected', 'revoked']);
    expect(admin.deletes.map((deleted) => deleted.query.provider_key).toSorted()).toEqual(['eq.linear', 'eq.notion']);
  });

  it('fails closed on a stale snapshot id without overwriting a duplicate natural-key row', async () => {
    const admin = new FakeProviderAdmin([
      {
        id: 'duplicate-row',
        customer_id: 'golden',
        provider_key: 'slack',
        status: 'duplicate-original',
      },
    ]);

    await expect(
      provisioner.restoreProviderProfileSnapshot(admin, {
        id: 'missing-snapshot-row',
        customer_id: 'golden',
        provider_key: 'slack',
        status: 'connected',
      })
    ).rejects.toThrow(/could not verify snapshot row missing-snapshot-row/);

    expect(admin.patches).toEqual([
      expect.objectContaining({
        query: { id: 'eq.missing-snapshot-row' },
      }),
    ]);
    expect(admin.inserts).toEqual([]);
    expect(admin.rows.find((row) => row.id === 'duplicate-row')?.status).toBe('duplicate-original');
  });

  it('rejects natural-key provider fixture patches when the selected row id is missing', async () => {
    const admin = new FakeProviderAdmin([
      {
        customer_id: 'golden',
        provider_key: 'slack',
        status: 'old',
      },
    ]);

    await expect(provisioner.upsertProviderFixtureRows(admin, 'golden')).rejects.toThrow(
      /slack provider fixture lookup did not return a row id/
    );
  });

  it('rejects provider profile writes without customer and provider natural keys', async () => {
    const admin = new FakeProviderAdmin([]);

    await expect(
      provisioner.restoreProviderProfileSnapshot(admin, {
        customer_id: 'golden',
        status: 'connected',
      })
    ).rejects.toThrow(/customer_id and provider_key/);
  });
});
