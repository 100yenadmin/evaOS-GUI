import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const provisioner = require('../../../scripts/evaosProvisionLiveCanaryFixtures.js') as {
  assertNoUnsafeProofOutput: (value: unknown) => void;
  ensureCustomerVmFixture: (
    admin: FakeCustomerVmAdmin,
    customerId: string,
    options?: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  coreBrokerFixtureEnvFromProvision: (state: Record<string, unknown>) => Record<string, string>;
  fixtureEnvFromProvision: (state: Record<string, unknown>) => Record<string, string>;
  loadCoreBrokerOptions: (env: Record<string, string>) => Record<string, unknown>;
  loadOptions: (env: Record<string, string>) => Record<string, unknown>;
  providerCleanupReportFromState: (state: Record<string, unknown>) => Record<string, unknown>;
  providerFixtureSubjectsFromRows: (rows: ProviderRow[]) => string[];
  renderGithubEnvFile: (env: Record<string, string>) => string;
  restoreCustomerVmFixture: (admin: FakeCustomerVmAdmin, state: Record<string, unknown>) => Promise<boolean>;
  sanitizedCoreBrokerProvisionReport: (state: Record<string, unknown>) => Record<string, unknown>;
  sanitizedProvisionReport: (state: Record<string, unknown>) => Record<string, unknown>;
  restoreProviderProfileSnapshot: (
    admin: FakeProviderAdmin,
    row: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  restoreProviderSnapshots: (admin: FakeProviderAdmin, state: Record<string, unknown>) => Promise<void>;
  upsertProviderFixtureRows: (admin: FakeProviderAdmin, customerId: string) => Promise<void>;
};

type ProviderRow = Record<string, unknown>;

const CUSTOMER_PROVIDER_PROFILE_COLUMNS = new Set([
  'id',
  'customer_id',
  'provider_key',
  'provider_subject_id',
  'customer_account_id',
  'display_name',
  'status',
  'active',
  'usage_summary',
  'usage_metadata',
  'capabilities',
  'metadata',
  'last_validated_at',
  'pipedream_app_slug',
  'pipedream_account_id',
  'pipedream_app_name',
]);

const CUSTOMER_VM_COLUMNS = new Set([
  'id',
  'customer_id',
  'user_id',
  'tier',
  'hetzner_server_id',
  'hetzner_server_name',
  'public_ip',
  'tailnet_ip',
  'headscale_node_id',
  'openclaw_port',
  'paperclip_port',
  'region',
  'status',
  'health_status',
  'last_health_check',
  'created_at',
  'updated_at',
  'activated_at',
  'suspended_at',
  'metadata',
  'lifecycle_stage',
  'lifecycle_updated_at',
  'queued_at',
  'hydrating_started_at',
  'verifying_started_at',
  'ready_at',
  'failed_at',
  'manual_attention_at',
  'manual_attention_reason',
  'manual_attention_note',
  'runtime_assigned_at',
  'runtime_home',
  'runtime_provider',
  'runtime_instance_id',
  'runtime_hostname',
  'runtime_assignment',
  'verification_status',
  'verification_summary',
  'last_verified_at',
]);

function assertCustomerProviderProfileColumns(row: ProviderRow) {
  for (const key of Object.keys(row)) {
    if (!CUSTOMER_PROVIDER_PROFILE_COLUMNS.has(key)) {
      throw new Error(`Unknown customer_provider_profiles column in fixture test: ${key}`);
    }
  }
}

function assertCustomerVmColumns(row: ProviderRow) {
  for (const key of Object.keys(row)) {
    if (!CUSTOMER_VM_COLUMNS.has(key)) {
      throw new Error(`Unknown customer_vms column in fixture test: ${key}`);
    }
  }
}

function rowValue(row: ProviderRow, key: string) {
  if (key.startsWith('metadata->>')) {
    const metadataKey = key.slice('metadata->>'.length);
    const metadata = row.metadata as Record<string, unknown> | undefined;
    return metadata?.[metadataKey];
  }
  return row[key];
}

function rowMatchesQuery(row: ProviderRow, query: Record<string, string>) {
  return Object.entries(query).every(([key, value]) => {
    if (typeof value !== 'string') return true;
    const actual = rowValue(row, key);
    if (value.startsWith('eq.')) return String(actual) === value.slice(3);
    if (value.startsWith('in.(') && value.endsWith(')')) {
      return value.slice(4, -1).split(',').includes(String(actual));
    }
    if (value.startsWith('not.in.(') && value.endsWith(')')) {
      return !value.slice(8, -1).split(',').includes(String(actual));
    }
    if (value === 'is.null') return actual === null || actual === undefined;
    return true;
  });
}

class FakeProviderAdmin {
  rows: ProviderRow[];
  deletes: Array<{ query: Record<string, string> }> = [];
  inserts: Array<{ body: ProviderRow; options: Record<string, unknown> }> = [];
  patches: Array<{ query: Record<string, string>; body: ProviderRow }> = [];

  constructor(rows: ProviderRow[]) {
    rows.forEach(assertCustomerProviderProfileColumns);
    this.rows = rows.map((row) => Object.assign({}, row));
  }

  async select(_table: string, query: Record<string, string | number>) {
    const rows = this.rows.filter((row) => {
      const filteredQuery = Object.fromEntries(
        Object.entries(query).filter(([key]) => key !== 'select' && key !== 'limit')
      ) as Record<string, string>;
      return rowMatchesQuery(row, filteredQuery);
    });
    return rows.slice(0, Number(query.limit ?? rows.length)).map((row) => Object.assign({}, row));
  }

  async insert(_table: string, body: ProviderRow, options: Record<string, unknown> = {}) {
    const row = { id: body.id ?? `inserted-${this.inserts.length + 1}`, ...body };
    assertCustomerProviderProfileColumns(row);
    this.rows.push(row);
    this.inserts.push({ body: row, options });
    return { ...row };
  }

  async patch(_table: string, query: Record<string, string>, body: ProviderRow) {
    assertCustomerProviderProfileColumns(body);
    this.patches.push({ query, body });
    for (const row of this.rows) {
      if (rowMatchesQuery(row, query)) Object.assign(row, body);
    }
  }

  async upsert() {
    throw new Error('unexpected composite upsert');
  }

  async deleteRows(_table: string, query: Record<string, string>) {
    this.deletes.push({ query });
    this.rows = this.rows.filter((row) => !rowMatchesQuery(row, query));
  }
}

class FakeCustomerVmAdmin {
  rows: ProviderRow[];
  deletes: Array<{ query: Record<string, string> }> = [];
  inserts: Array<{ body: ProviderRow; options: Record<string, unknown> }> = [];
  patches: Array<{ query: Record<string, string>; body: ProviderRow }> = [];

  constructor(rows: ProviderRow[]) {
    rows.forEach(assertCustomerVmColumns);
    this.rows = rows.map((row) => Object.assign({}, row));
  }

  async select(table: string, query: Record<string, string | number>) {
    if (table !== 'customer_vms') throw new Error(`unexpected table ${table}`);
    const rows = this.rows.filter((row) => {
      const filteredQuery = Object.fromEntries(
        Object.entries(query).filter(([key]) => key !== 'select' && key !== 'limit')
      ) as Record<string, string>;
      return rowMatchesQuery(row, filteredQuery);
    });
    return rows.slice(0, Number(query.limit ?? rows.length)).map((row) => Object.assign({}, row));
  }

  async insert(table: string, body: ProviderRow, options: Record<string, unknown> = {}) {
    if (table !== 'customer_vms') throw new Error(`unexpected table ${table}`);
    const row = { id: body.id ?? `vm-inserted-${this.inserts.length + 1}`, ...body };
    assertCustomerVmColumns(row);
    this.rows.push(row);
    this.inserts.push({ body: row, options });
    return { ...row };
  }

  async patch(table: string, query: Record<string, string>, body: ProviderRow) {
    if (table !== 'customer_vms') throw new Error(`unexpected table ${table}`);
    assertCustomerVmColumns(body);
    this.patches.push({ query, body });
    for (const row of this.rows) {
      if (rowMatchesQuery(row, query)) Object.assign(row, body);
    }
  }

  async deleteRows(table: string, query: Record<string, string>) {
    if (table !== 'customer_vms') throw new Error(`unexpected table ${table}`);
    this.deletes.push({ query });
    this.rows = this.rows.filter((row) => !rowMatchesQuery(row, query));
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
    customerVmFixture: {
      id: 'vm-fixture-row',
      customerId: 'golden',
      status: 'active',
      managed: true,
      created: true,
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

  it('exports a complete core broker credential pair without follow-up fixture variables', () => {
    const env = provisioner.coreBrokerFixtureEnvFromProvision(fixtureState());

    expect(env).toMatchObject({
      AIONUI_EVAOS_BROKER_ENDPOINT: 'https://rhfojelkgtwcxnrfhtlj.supabase.co/functions/v1/desktop-runtime-session',
      AIONUI_EVAOS_DESKTOP_SESSION: 'eds_admin_session_for_test',
      AIONUI_EVAOS_CUSTOMER_ID: 'golden',
      AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION: 'eds_admin_session_for_test',
      AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID: 'golden',
      AIONUI_EVAOS_RUNTIME: 'openclaw',
    });
    expect(env).not.toHaveProperty('AIONUI_EVAOS_REQUESTER_SESSION');
    expect(env).not.toHaveProperty('AIONUI_EVAOS_BUSINESS_BROWSER_DENIED_SESSION');
    expect(env).not.toHaveProperty('AIONUI_EVAOS_COMPANY_BRAIN_DENIED_SESSION');
  });

  it('keeps core broker provisioning proof free of desktop sessions and service-role markers', () => {
    const report = provisioner.sanitizedCoreBrokerProvisionReport(fixtureState());
    const text = JSON.stringify(report);

    expect(report).toMatchObject({
      schema: 'evaos-live-canary-core-broker-fixture-provision/v1',
      customerId: 'golden',
      runtimeTarget: {
        customerId: 'golden',
        fixtureManaged: true,
        fixtureCreated: true,
        source: 'customer_vms',
      },
      sensitiveOutput: 'passed',
    });
    expect(text).not.toMatch(/eds_(admin|requester|denied)/);
    expect(text).not.toMatch(/service[_-]?role/i);
    expect(text).not.toMatch(/desktop[_-]?session/i);
  });

  it('uses the broker canary customer id for core broker provisioning when present', () => {
    const options = provisioner.loadCoreBrokerOptions({
      AIONUI_EVAOS_FIXTURE_SUPABASE_URL: 'https://example.supabase.co',
      AIONUI_EVAOS_FIXTURE_SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
      AIONUI_EVAOS_FIXTURE_CUSTOMER_ID: 'release-support',
      AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID: 'customer-under-proof',
    });

    expect(options.customerId).toBe('customer-under-proof');
  });

  it('does not claim provider fixture restoration for a core broker cleanup state', () => {
    const report = provisioner.providerCleanupReportFromState({
      schema: 'evaos-live-canary-core-broker-fixture-state/v1',
      customerId: 'golden',
      sessions: { admin: { id: 'admin-session-id' } },
    });

    expect(report).toMatchObject({
      providerFixturesRestored: false,
      providerFixtureSnapshotCount: 0,
      providerFixtureRowCount: 0,
      providerFixtureSubjectCount: 0,
      providerCleanupScope: 'no-provider-fixtures-in-state',
    });
  });

  it('reports provider fixture cleanup only when provider fixture state exists', () => {
    const report = provisioner.providerCleanupReportFromState({
      providerSnapshots: [{ providerKey: 'github', row: { id: 'snapshot-row' } }],
      providerFixtureRows: [{ id: 'fixture-row' }],
      providerFixtureSubjects: ['fixture-subject'],
    });

    expect(report).toMatchObject({
      providerFixturesRestored: true,
      providerCleanupScope: 'provider-fixtures',
    });
    expect(Number(report.providerFixtureSnapshotCount)).toBeGreaterThan(0);
    expect(Number(report.providerFixtureRowCount)).toBeGreaterThan(0);
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
      runtimeTarget: {
        customerId: 'golden',
        fixtureManaged: true,
        fixtureCreated: true,
        source: 'customer_vms',
      },
      sensitiveOutput: 'passed',
    });
    expect(text).not.toMatch(/eds_(admin|requester|denied)/);
    expect(text).not.toMatch(/service[_-]?role/i);
    expect(text).not.toMatch(/desktop[_-]?session/i);
  });

  it('uses the connected provider fixture for approval requests by default', () => {
    const options = provisioner.loadOptions({
      AIONUI_EVAOS_FIXTURE_SUPABASE_URL: 'https://example.supabase.co',
      AIONUI_EVAOS_FIXTURE_SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
    });

    expect(options.approvalProviderKey).toBe('google_workspace');
  });

  it('inserts an active marked customer VM fixture when the runtime target is missing', async () => {
    const admin = new FakeCustomerVmAdmin([]);

    const result = await provisioner.ensureCustomerVmFixture(admin, 'evaos-support', { ttlMinutes: 30 });

    expect(result).toMatchObject({
      managed: true,
      created: true,
      row: {
        id: 'vm-inserted-1',
        customer_id: 'evaos-support',
        tier: 'biz',
        status: 'active',
        health_status: 'healthy',
        lifecycle_stage: 'ready',
      },
    });
    expect(admin.inserts).toHaveLength(1);
    expect(admin.inserts[0]?.body.metadata).toMatchObject({
      source: 'aionui_live_canary_fixture',
      acceptance_fixture: true,
      runtime_canary: true,
      raw_runtime_secret_stored: false,
    });
  });

  it('leaves a genuine active customer VM untouched', async () => {
    const admin = new FakeCustomerVmAdmin([
      {
        id: 'real-vm',
        customer_id: 'evaos-support',
        tier: 'biz',
        status: 'active',
        health_status: 'healthy',
        metadata: { source: 'real_runtime' },
      },
    ]);

    const result = await provisioner.ensureCustomerVmFixture(admin, 'evaos-support');

    expect(result).toMatchObject({
      managed: false,
      created: false,
      row: { id: 'real-vm', status: 'active' },
    });
    expect(admin.inserts).toEqual([]);
    expect(admin.patches).toEqual([]);
  });

  it('refuses to overwrite genuine inactive customer VM state', async () => {
    const admin = new FakeCustomerVmAdmin([
      {
        id: 'real-vm',
        customer_id: 'evaos-support',
        tier: 'biz',
        status: 'suspended',
        health_status: 'degraded',
        metadata: { source: 'real_runtime' },
      },
    ]);

    await expect(provisioner.ensureCustomerVmFixture(admin, 'evaos-support')).rejects.toThrow(
      /refusing to overwrite real VM state/
    );

    expect(admin.inserts).toEqual([]);
    expect(admin.patches).toEqual([]);
  });

  it('deletes only marked customer VM fixture rows during cleanup', async () => {
    const admin = new FakeCustomerVmAdmin([
      {
        id: 'vm-fixture',
        customer_id: 'evaos-support',
        tier: 'biz',
        status: 'active',
        health_status: 'healthy',
        metadata: { source: 'aionui_live_canary_fixture', acceptance_fixture: true },
      },
      {
        id: 'real-vm',
        customer_id: 'real-customer',
        tier: 'biz',
        status: 'active',
        health_status: 'healthy',
        metadata: { source: 'real_runtime' },
      },
    ]);

    await expect(
      provisioner.restoreCustomerVmFixture(admin, {
        customerVmFixture: {
          id: 'vm-fixture',
          customerId: 'evaos-support',
          managed: true,
          created: true,
        },
      })
    ).resolves.toBe(true);

    expect(admin.deletes).toEqual([
      {
        query: {
          id: 'eq.vm-fixture',
          'metadata->>source': 'eq.aionui_live_canary_fixture',
          'metadata->>acceptance_fixture': 'eq.true',
        },
      },
    ]);
    expect(admin.rows.map((row) => row.id)).toEqual(['real-vm']);
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
        metadata: { source: 'aionui_live_canary_fixture', acceptance_fixture: true },
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
    expect(admin.inserts.map((insert) => String(insert.body.provider_key)).toSorted()).toEqual([
      'google_workspace',
      'linear',
      'notion',
    ]);
    expect(admin.inserts.map((insert) => insert.options)).toEqual([
      { select: 'id,customer_id,provider_key,provider_subject_id,status', label: 'google_workspace provider fixture' },
      { select: 'id,customer_id,provider_key,provider_subject_id,status', label: 'linear provider fixture' },
      { select: 'id,customer_id,provider_key,provider_subject_id,status', label: 'notion provider fixture' },
    ]);
    expect(admin.rows.find((row) => row.id === 'existing-slack-1')?.status).toBe('expired');
    expect(admin.rows.find((row) => row.id === 'existing-slack-2')?.status).toBe('duplicate-old');
  });

  it('refuses to overwrite genuine provider rows with live canary fixtures', async () => {
    const admin = new FakeProviderAdmin([
      {
        id: 'real-google-row',
        customer_id: 'golden',
        provider_key: 'google_workspace',
        provider_subject_id: 'acct_account_profile_requester',
        status: 'connected',
        metadata: { source: 'real_customer_connection' },
      },
    ]);

    await expect(
      provisioner.upsertProviderFixtureRows(admin, 'golden', {
        customerAccountId: 'account',
        profileIds: ['requester'],
      })
    ).rejects.toThrow(/existing non-fixture provider row/);

    expect(admin.rows.find((row) => row.id === 'real-google-row')?.metadata).toEqual({
      source: 'real_customer_connection',
    });
    expect(admin.patches).toEqual([]);
  });

  it('preflights every subject before writing provider fixtures', async () => {
    const admin = new FakeProviderAdmin([
      {
        id: 'real-google-row',
        customer_id: 'golden',
        provider_key: 'google_workspace',
        provider_subject_id: 'acct_account_profile_second-profile',
        status: 'connected',
        metadata: { source: 'real_customer_connection' },
      },
    ]);

    await expect(
      provisioner.upsertProviderFixtureRows(admin, 'golden', {
        customerAccountId: 'account',
        profileIds: ['first-profile', 'second-profile'],
      })
    ).rejects.toThrow(/existing non-fixture provider row/);

    expect(admin.rows).toEqual([
      expect.objectContaining({
        id: 'real-google-row',
        metadata: { source: 'real_customer_connection' },
      }),
    ]);
    expect(admin.inserts).toEqual([]);
    expect(admin.patches).toEqual([]);
  });

  it('writes provider fixtures for the scoped customer-account subjects required by live approvals', async () => {
    const admin = new FakeProviderAdmin([]);
    const customerAccountId = '823ee8be-d547-4df9-9ee5-20cc7bb1ddcb';
    const profileOne = '11111111-1111-4111-8111-111111111111';
    const profileTwo = '22222222-2222-4222-8222-222222222222';

    await provisioner.upsertProviderFixtureRows(admin, 'golden', {
      customerAccountId,
      profileIds: [profileOne, profileTwo],
      ttlMinutes: 60,
    });

    const googleRows = admin.rows.filter((row) => row.provider_key === 'google_workspace');
    expect(googleRows).toHaveLength(2);
    expect(googleRows.map((row) => row.provider_subject_id).toSorted()).toEqual([
      `acct_${customerAccountId}_profile_${profileOne}`,
      `acct_${customerAccountId}_profile_${profileTwo}`,
    ]);
    expect(googleRows.map((row) => row.customer_account_id)).toEqual([customerAccountId, customerAccountId]);
    expect(googleRows.some((row) => 'owner_profile_id' in row)).toBe(false);
    for (const row of googleRows) {
      const metadata = row.metadata as Record<string, unknown>;
      expect(row.status).toBe('connected');
      expect(row.active).toBe(true);
      expect(Date.parse(String(metadata.expires_at))).toBeGreaterThan(Date.now());
    }
  });

  it('derives the persisted provider fixture subject list exactly from written rows', () => {
    expect(
      provisioner.providerFixtureSubjectsFromRows([
        { id: 'row-1', provider_subject_id: 'acct_account-one_profile_profile-one' },
        { id: 'row-2', provider_subject_id: 'acct_account-one_profile_profile-one' },
        { id: 'row-3', provider_subject_id: 'acct_account-one_profile_profile-two' },
        { id: 'row-4' },
      ])
    ).toEqual(['acct_account-one_profile_profile-one', 'acct_account-one_profile_profile-two']);
  });

  it('fails closed instead of truncating provider subject ids into collisions', async () => {
    const admin = new FakeProviderAdmin([]);

    await expect(
      provisioner.upsertProviderFixtureRows(admin, 'golden', {
        customerAccountId: `account-${'a'.repeat(120)}`,
        profileIds: [`profile-${'b'.repeat(120)}`],
      })
    ).rejects.toThrow(/subject id is too long/i);
  });

  it('fails closed when sanitized provider subject ids would collide', async () => {
    const admin = new FakeProviderAdmin([]);

    await expect(
      provisioner.upsertProviderFixtureRows(admin, 'golden', {
        customerAccountId: 'account',
        profileIds: ['profile.one', 'profile,one'],
      })
    ).rejects.toThrow(/subject id collision/i);

    expect(admin.rows).toEqual([]);
    expect(admin.inserts).toEqual([]);
    expect(admin.patches).toEqual([]);
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
    expect(admin.deletes.map((deleted) => deleted.query.provider_key)).toEqual(
      expect.arrayContaining(['eq.google_workspace', 'eq.linear', 'eq.notion'])
    );
  });

  it('deletes scoped fixture rows that did not exist before the canary run', async () => {
    const admin = new FakeProviderAdmin([
      {
        id: 'snapshot-row-1',
        customer_id: 'golden',
        provider_key: 'slack',
        provider_subject_id: 'legacy_customer',
        status: 'fixture-1',
      },
      {
        id: 'fixture-row-1',
        customer_id: 'golden',
        provider_key: 'google_workspace',
        provider_subject_id: 'acct_account_profile_requester',
        metadata: { source: 'aionui_live_canary_fixture', acceptance_fixture: true },
        status: 'connected',
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
            provider_subject_id: 'legacy_customer',
            status: 'connected',
          },
        },
      ],
      providerFixtureRows: [
        {
          id: 'snapshot-row-1',
          customer_id: 'golden',
          provider_key: 'slack',
          provider_subject_id: 'legacy_customer',
        },
        {
          id: 'fixture-row-1',
          customer_id: 'golden',
          provider_key: 'google_workspace',
          provider_subject_id: 'acct_account_profile_requester',
        },
      ],
    });

    expect(admin.patches.map((patch) => patch.query)).toContainEqual({ id: 'eq.snapshot-row-1' });
    expect(admin.deletes.map((deleted) => deleted.query)).toContainEqual(
      expect.objectContaining({
        id: 'eq.fixture-row-1',
        'metadata->>source': 'eq.aionui_live_canary_fixture',
        'metadata->>acceptance_fixture': 'eq.true',
      })
    );
    expect(admin.rows.some((row) => row.id === 'fixture-row-1')).toBe(false);
  });

  it('marker-sweeps legacy fixture rows even when provider snapshots exist', async () => {
    const admin = new FakeProviderAdmin([
      {
        id: 'snapshot-slack-row',
        customer_id: 'golden',
        provider_key: 'slack',
        status: 'fixture',
        metadata: { source: 'aionui_live_canary_fixture', acceptance_fixture: true },
      },
      {
        id: 'fixture-slack-row',
        customer_id: 'golden',
        provider_key: 'slack',
        status: 'expired',
        metadata: { source: 'aionui_live_canary_fixture', acceptance_fixture: true },
      },
      {
        id: 'genuine-slack-row',
        customer_id: 'golden',
        provider_key: 'slack',
        status: 'connected',
        metadata: { source: 'real_customer_connection' },
      },
    ]);

    await provisioner.restoreProviderSnapshots(admin, {
      customerId: 'golden',
      providerSnapshots: [
        {
          providerKey: 'slack',
          row: {
            id: 'snapshot-slack-row',
            customer_id: 'golden',
            provider_key: 'slack',
            status: 'connected',
            metadata: { source: 'aionui_live_canary_fixture', acceptance_fixture: true },
          },
        },
      ],
      providerFixtureRows: [
        {
          customer_id: 'golden',
          provider_key: 'slack',
          status: 'expired',
        },
      ],
    });

    expect(admin.rows.some((row) => row.id === 'snapshot-slack-row')).toBe(true);
    expect(admin.rows.some((row) => row.id === 'genuine-slack-row')).toBe(true);
    expect(admin.rows.some((row) => row.id === 'fixture-slack-row')).toBe(false);
    expect(admin.deletes.map((deleted) => deleted.query)).toContainEqual(
      expect.objectContaining({
        customer_id: 'eq.golden',
        provider_key: 'eq.slack',
        provider_subject_id: 'is.null',
        id: 'not.in.(snapshot-slack-row)',
        'metadata->>source': 'eq.aionui_live_canary_fixture',
        'metadata->>acceptance_fixture': 'eq.true',
      })
    );
  });

  it('deletes subject-scoped fixture rows without deleting restored snapshot subjects', async () => {
    const admin = new FakeProviderAdmin([
      {
        id: 'snapshot-row-1',
        customer_id: 'golden',
        provider_key: 'slack',
        provider_subject_id: 'legacy_customer',
        status: 'fixture-1',
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
            provider_subject_id: 'legacy_customer',
            status: 'connected',
          },
        },
      ],
      providerFixtureRows: [
        {
          customer_id: 'golden',
          provider_key: 'google_workspace',
          provider_subject_id: 'acct_account_profile_requester',
        },
      ],
      providerFixtureSubjects: ['acct_account_profile_requester', 'legacy_customer'],
    });

    expect(admin.deletes.map((deleted) => deleted.query)).toContainEqual({
      customer_id: 'eq.golden',
      provider_key: 'eq.google_workspace',
      provider_subject_id: 'eq.acct_account_profile_requester',
      'metadata->>source': 'eq.aionui_live_canary_fixture',
      'metadata->>acceptance_fixture': 'eq.true',
    });
    expect(admin.deletes.map((deleted) => deleted.query)).not.toContainEqual(
      expect.objectContaining({
        customer_id: 'eq.golden',
        provider_key: 'eq.slack',
        provider_subject_id: 'eq.legacy_customer',
      })
    );
  });

  it('preserves genuine rows when provider-key fallback cleanup runs', async () => {
    const admin = new FakeProviderAdmin([
      {
        id: 'genuine-slack-row',
        customer_id: 'golden',
        provider_key: 'slack',
        status: 'connected',
        metadata: { source: 'real_customer_connection' },
      },
      {
        id: 'fixture-slack-row',
        customer_id: 'golden',
        provider_key: 'slack',
        status: 'expired',
        metadata: { source: 'aionui_live_canary_fixture', acceptance_fixture: true },
      },
    ]);

    await provisioner.restoreProviderSnapshots(admin, {
      customerId: 'golden',
      providerSnapshots: [],
      providerFixtureRows: [],
    });

    expect(admin.rows.some((row) => row.id === 'genuine-slack-row')).toBe(true);
    expect(admin.rows.some((row) => row.id === 'fixture-slack-row')).toBe(false);
    expect(admin.deletes.map((deleted) => deleted.query)).toContainEqual(
      expect.objectContaining({
        customer_id: 'eq.golden',
        provider_key: 'eq.slack',
        'metadata->>source': 'eq.aionui_live_canary_fixture',
        'metadata->>acceptance_fixture': 'eq.true',
      })
    );
  });

  it('preserves genuine rows when subject fallback cleanup runs from stale state', async () => {
    const admin = new FakeProviderAdmin([
      {
        id: 'genuine-google-row',
        customer_id: 'golden',
        provider_key: 'google_workspace',
        provider_subject_id: 'acct_account_profile_requester',
        status: 'connected',
        metadata: { source: 'real_customer_connection' },
      },
      {
        id: 'fixture-google-row',
        customer_id: 'golden',
        provider_key: 'google_workspace',
        provider_subject_id: 'acct_account_profile_requester',
        status: 'connected',
        metadata: { source: 'aionui_live_canary_fixture', acceptance_fixture: true },
      },
    ]);

    await provisioner.restoreProviderSnapshots(admin, {
      customerId: 'golden',
      providerSnapshots: [],
      providerFixtureRows: [
        {
          customer_id: 'golden',
          provider_key: 'google_workspace',
          provider_subject_id: 'acct_account_profile_requester',
        },
      ],
      providerFixtureSubjects: ['acct_account_profile_requester'],
    });

    expect(admin.rows.some((row) => row.id === 'genuine-google-row')).toBe(true);
    expect(admin.rows.some((row) => row.id === 'fixture-google-row')).toBe(false);
    expect(admin.deletes.map((deleted) => deleted.query)).toContainEqual(
      expect.objectContaining({
        customer_id: 'eq.golden',
        provider_key: 'eq.google_workspace',
        provider_subject_id: 'eq.acct_account_profile_requester',
        'metadata->>source': 'eq.aionui_live_canary_fixture',
        'metadata->>acceptance_fixture': 'eq.true',
      })
    );
  });

  it('keeps restored snapshot rows out of id and subject cleanup passes', async () => {
    const admin = new FakeProviderAdmin([
      {
        id: 'snapshot-row-1',
        customer_id: 'golden',
        provider_key: 'google_workspace',
        provider_subject_id: 'acct_account_profile_requester',
        status: 'fixture-1',
      },
    ]);

    await provisioner.restoreProviderSnapshots(admin, {
      customerId: 'golden',
      providerSnapshots: [
        {
          providerKey: 'google_workspace',
          row: {
            id: 'snapshot-row-1',
            customer_id: 'golden',
            provider_key: 'google_workspace',
            provider_subject_id: 'acct_account_profile_requester',
            status: 'connected',
          },
        },
      ],
      providerFixtureRows: [
        {
          id: 'snapshot-row-1',
          customer_id: 'golden',
          provider_key: 'google_workspace',
          provider_subject_id: 'acct_account_profile_requester',
        },
      ],
      providerFixtureSubjects: ['acct_account_profile_requester'],
    });

    expect(admin.deletes.map((deleted) => deleted.query)).not.toContainEqual(
      expect.objectContaining({ id: 'eq.snapshot-row-1' })
    );
    expect(admin.deletes.map((deleted) => deleted.query)).not.toContainEqual(
      expect.objectContaining({
        customer_id: 'eq.golden',
        provider_key: 'eq.google_workspace',
        provider_subject_id: 'eq.acct_account_profile_requester',
      })
    );
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
        metadata: { source: 'aionui_live_canary_fixture', acceptance_fixture: true },
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
