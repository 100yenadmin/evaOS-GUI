import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  loadOrCreateTemporaryAdminMembership: (
    admin: FakeMembershipAdmin,
    adminProfile: { id: string; email: string },
    customerAccount: { id: string },
    options?: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  loadCoreBrokerOptions: (env: Record<string, string>) => Record<string, unknown>;
  loadMacControlCanaryOptions: (env: Record<string, string>) => Record<string, unknown>;
  loadOptions: (env: Record<string, string>) => Record<string, unknown>;
  macControlCanaryEnvFromProvision: (state: Record<string, unknown>, desktopSession: string) => Record<string, string>;
  provisionMacControlCanarySessionWithAdmin: (
    admin: FakeMacControlCanaryAdmin,
    options: Record<string, unknown>
  ) => Promise<{ state: Record<string, unknown>; env: Record<string, string>; report: Record<string, unknown> }>;
  cleanupMacControlCanarySessionWithAdmin: (
    admin: FakeMacControlCanaryAdmin,
    state: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  cleanupMacControlCanarySession: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
  providerCleanupReportFromState: (state: Record<string, unknown>) => Record<string, unknown>;
  providerFixtureSubjectsFromRows: (rows: ProviderRow[]) => string[];
  renderGithubEnvFile: (env: Record<string, string>) => string;
  restoreCustomerVmFixture: (admin: FakeCustomerVmAdmin, state: Record<string, unknown>) => Promise<boolean>;
  restoreAdminMembershipFixture: (admin: FakeMembershipAdmin, state: Record<string, unknown>) => Promise<boolean>;
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

class FakeMembershipAdmin {
  rows: ProviderRow[];
  inserts: Array<{ body: ProviderRow; options: Record<string, unknown> }> = [];
  patches: Array<{ query: Record<string, string>; body: ProviderRow }> = [];

  constructor(rows: ProviderRow[]) {
    this.rows = rows.map((row) => Object.assign({}, row));
  }

  async select(table: string, query: Record<string, string | number>) {
    if (table !== 'customer_account_memberships') throw new Error(`unexpected table ${table}`);
    const rows = this.rows.filter((row) => {
      const filteredQuery = Object.fromEntries(
        Object.entries(query).filter(([key]) => key !== 'select' && key !== 'limit')
      ) as Record<string, string>;
      return rowMatchesQuery(row, filteredQuery);
    });
    return rows.slice(0, Number(query.limit ?? rows.length)).map((row) => Object.assign({}, row));
  }

  async insert(table: string, body: ProviderRow, options: Record<string, unknown> = {}) {
    if (table !== 'customer_account_memberships') throw new Error(`unexpected table ${table}`);
    const row = { id: body.id ?? `membership-inserted-${this.inserts.length + 1}`, ...body };
    this.rows.push(row);
    this.inserts.push({ body: row, options });
    return { ...row };
  }

  async patch(table: string, query: Record<string, string>, body: ProviderRow) {
    if (table !== 'customer_account_memberships') throw new Error(`unexpected table ${table}`);
    this.patches.push({ query, body });
    for (const row of this.rows) {
      if (rowMatchesQuery(row, query)) Object.assign(row, body);
    }
  }
}

class FakeMacControlCanaryAdmin {
  inserts: Array<{ table: string; body: ProviderRow; options: Record<string, unknown> }> = [];
  patches: Array<{ table: string; query: Record<string, string>; body: ProviderRow }> = [];
  reads: Array<{ table: string; query: Record<string, unknown> }> = [];

  constructor(
    private readonly canaryMarker: unknown = {
      schema: 'evaos.mac_control_canary_target.v2',
      environment: 'staging',
      enabled: true,
      supabase_origin: 'https://dashboard-staging.example.test',
      endpoint_origin: 'https://dashboard-staging.example.test',
      expected_callback_host: 'openclaw-staging.example.test',
    },
    private readonly deviceRows: ProviderRow[] = [
      {
        id: 'staging-device-id',
        device_identifier: 'staging-device-for-test',
        status: 'active',
      },
    ]
  ) {}

  async single(table: string, query: Record<string, unknown>) {
    this.reads.push({ table, query });
    if (table === 'profiles') return { id: 'owner-profile-id', email: 'owner@staging.invalid' };
    if (table === 'customer_accounts') {
      return {
        id: 'staging-account-id',
        customer_id: 'staging-mac-owner',
        metadata: { evaos_mac_control_canary: this.canaryMarker },
      };
    }
    if (table === 'customer_account_memberships') {
      return { id: 'active-membership-id', role: 'owner', status: 'active' };
    }
    throw new Error(`unexpected single table ${table}`);
  }

  async insert(table: string, body: ProviderRow, options: Record<string, unknown> = {}) {
    this.inserts.push({ table, body, options });
    if (table !== 'desktop_app_sessions') throw new Error(`unexpected insert table ${table}`);
    return { id: 'temporary-session-id', expires_at: body.expires_at };
  }

  async select(table: string, query: Record<string, unknown>) {
    this.reads.push({ table, query });
    if (table === 'customer_devices') return this.deviceRows.map((row) => ({ ...row }));
    throw new Error(`unexpected select table ${table}`);
  }

  async patch(table: string, query: Record<string, string>, body: ProviderRow, _options?: Record<string, unknown>) {
    this.patches.push({ table, query, body });
    const sessionId = query.id?.startsWith('eq.') ? query.id.slice(3) : 'temporary-session-id';
    return [
      {
        id: sessionId,
        revoked_at: String(body.revoked_at).replace(/Z$/, '+00:00'),
      },
    ];
  }
}

class NoEvidenceMacControlCanaryAdmin extends FakeMacControlCanaryAdmin {
  override async patch(
    table: string,
    query: Record<string, string>,
    body: ProviderRow,
    _options?: Record<string, unknown>
  ) {
    this.patches.push({ table, query, body });
    return [];
  }

  override async select(table: string, query: Record<string, unknown>) {
    if (table === 'customer_devices') return super.select(table, query);
    return [];
  }
}

class RetrySafeMacControlCanaryAdmin extends FakeMacControlCanaryAdmin {
  selects: Array<{ table: string; query: Record<string, unknown> }> = [];

  constructor(
    private readonly fallbackRows: ProviderRow[],
    private readonly patchOutcome: 'zero' | 'throw-after-commit'
  ) {
    super();
  }

  override async patch(
    table: string,
    query: Record<string, string>,
    body: ProviderRow,
    _options?: Record<string, unknown>
  ) {
    this.patches.push({ table, query, body });
    if (this.patchOutcome === 'throw-after-commit') {
      throw new Error('simulated response loss after commit');
    }
    return [];
  }

  async select(table: string, query: Record<string, unknown>) {
    this.selects.push({ table, query });
    return this.fallbackRows.map((row) => ({ ...row }));
  }
}

class CleanupKeyLookupMacControlCanaryAdmin extends FakeMacControlCanaryAdmin {
  selects: Array<{ table: string; query: Record<string, unknown> }> = [];

  constructor(private readonly matchingRows: ProviderRow[]) {
    super();
  }

  async select(table: string, query: Record<string, unknown>) {
    this.selects.push({ table, query });
    return this.matchingRows.map((row) => ({ ...row }));
  }
}

function failingMacControlFileSystem(phase: 'state' | 'env' | 'proof') {
  return {
    mkdirSync: fs.mkdirSync.bind(fs),
    existsSync: fs.existsSync.bind(fs),
    readFileSync: fs.readFileSync.bind(fs),
    rmSync: fs.rmSync.bind(fs),
    renameSync: fs.renameSync.bind(fs),
    writeFileSync(filePath: fs.PathOrFileDescriptor, data: string, options?: fs.WriteFileOptions) {
      const rendered = String(filePath);
      if (
        (phase === 'state' && rendered.includes('session-state.json')) ||
        (phase === 'proof' && rendered.includes('mac-control-session-'))
      ) {
        throw new Error(`simulated ${phase} write failure at private-path`);
      }
      return fs.writeFileSync(filePath, data, options);
    },
    appendFileSync(filePath: fs.PathOrFileDescriptor, data: string) {
      if (phase === 'env') throw new Error('simulated env export failure at private-path');
      return fs.appendFileSync(filePath, data);
    },
  };
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
    expect(env).not.toHaveProperty('AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION');
    expect(env).not.toHaveProperty('AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID');
  });

  it('exports broker-specific credentials from full fixtures for non-internal broker proof targets', () => {
    const state = {
      ...fixtureState(),
      customerId: 'customer-under-proof',
      customerVmFixture: {
        ...fixtureState().customerVmFixture,
        customerId: 'customer-under-proof',
      },
    };
    const env = provisioner.fixtureEnvFromProvision(state);

    expect(env).toMatchObject({
      AIONUI_EVAOS_CUSTOMER_ID: 'customer-under-proof',
      AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID: 'customer-under-proof',
      AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION: 'eds_admin_session_for_test',
    });
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

  it('requires dedicated secret-backed Mac-control owner and customer configuration without generic fallback', () => {
    expect(() =>
      provisioner.loadMacControlCanaryOptions({
        AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_URL: 'https://dashboard-staging.example.test',
        AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
        AIONUI_EVAOS_FIXTURE_ADMIN_EMAIL: 'generic@staging.invalid',
        AIONUI_EVAOS_FIXTURE_CUSTOMER_ID: 'generic-customer',
      })
    ).toThrow(/AIONUI_EVAOS_MAC_CONTROL_CANARY_ACCOUNT_EMAIL/);

    expect(() =>
      provisioner.loadMacControlCanaryOptions({
        SUPABASE_URL: 'https://generic-production.example.test',
        SUPABASE_SECRET_KEY: 'generic-production-service-key',
        AIONUI_EVAOS_MAC_CONTROL_CANARY_ACCOUNT_EMAIL: 'owner@staging.invalid',
        AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID: 'staging-mac-owner',
        AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT: 'https://dashboard-staging.example.test/runtime',
        AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST: 'openclaw-staging.example.test',
      })
    ).toThrow(/AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_URL/);

    expect(() =>
      provisioner.loadMacControlCanaryOptions({
        AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_URL: 'https://dashboard-staging.example.test',
        SUPABASE_SECRET_KEY: 'generic-production-service-key',
        AIONUI_EVAOS_MAC_CONTROL_CANARY_ACCOUNT_EMAIL: 'owner@staging.invalid',
        AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID: 'staging-mac-owner',
        AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT: 'https://dashboard-staging.example.test/runtime',
        AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST: 'openclaw-staging.example.test',
      })
    ).toThrow(/AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_SERVICE_ROLE_KEY/);

    const options = provisioner.loadMacControlCanaryOptions({
      AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_URL: 'https://dashboard-staging.example.test',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_ACCOUNT_EMAIL: 'owner@staging.invalid',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID: 'staging-mac-owner',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT: 'https://dashboard-staging.example.test/runtime',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST: 'openclaw-staging.example.test',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_TTL_MINUTES: '10',
    });

    expect(options).toMatchObject({
      accountEmail: 'owner@staging.invalid',
      customerId: 'staging-mac-owner',
      ttlMinutes: 10,
      cleanupKey: expect.stringMatching(/^local-/),
      cleanupKeySource: 'generated',
    });

    const githubOptions = provisioner.loadMacControlCanaryOptions({
      AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_URL: 'https://dashboard-staging.example.test',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_ACCOUNT_EMAIL: 'owner@staging.invalid',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID: 'staging-mac-owner',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT: 'https://dashboard-staging.example.test/runtime',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST: 'openclaw-staging.example.test',
      GITHUB_REPOSITORY: 'electricsheephq/evaOS-GUI',
      GITHUB_RUN_ID: '123456789',
      GITHUB_RUN_ATTEMPT: '2',
    });
    expect(githubOptions).toMatchObject({
      cleanupKey: expect.stringMatching(/^github-/),
      cleanupKeySource: 'github',
    });
  });

  it('rejects production, cross-origin, or customer-like Mac-control configuration before database access', () => {
    const baseEnv = {
      AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_URL: 'https://dashboard-staging.example.test',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_ACCOUNT_EMAIL: 'owner@staging.invalid',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID: 'staging-mac-owner',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT: 'https://dashboard-staging.example.test/runtime',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST: 'openclaw-staging.example.test',
    };

    expect(() =>
      provisioner.loadMacControlCanaryOptions({
        ...baseEnv,
        AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_URL: 'https://rhfojelkgtwcxnrfhtlj.supabase.co',
        AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT:
          'https://rhfojelkgtwcxnrfhtlj.supabase.co/functions/v1/desktop-runtime-session',
      })
    ).toThrow(/production|default/i);
    expect(() =>
      provisioner.loadMacControlCanaryOptions({
        ...baseEnv,
        AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT: 'https://different-staging.example.test/runtime',
      })
    ).toThrow(/same staging origin/i);
    expect(() =>
      provisioner.loadMacControlCanaryOptions({
        ...baseEnv,
        AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID: 'real-customer-name',
      })
    ).toThrow(/explicit staging, canary, or synthetic target/i);
  });

  it('requires the database-backed staging canary marker before minting a desktop session', async () => {
    const missingMarkerAdmin = new FakeMacControlCanaryAdmin(null);
    const productionMarkerAdmin = new FakeMacControlCanaryAdmin({
      schema: 'evaos.mac_control_canary_target.v2',
      environment: 'production',
      enabled: true,
      supabase_origin: 'https://dashboard-staging.example.test',
      endpoint_origin: 'https://dashboard-staging.example.test',
      expected_callback_host: 'openclaw-staging.example.test',
    });
    const options = {
      supabaseUrl: 'https://dashboard-staging.example.test',
      accountEmail: 'owner@staging.invalid',
      customerId: 'staging-mac-owner',
      endpoint: 'https://dashboard-staging.example.test/runtime',
      expectedCallbackHost: 'openclaw-staging.example.test',
      ttlMinutes: 10,
    };

    await expect(provisioner.provisionMacControlCanarySessionWithAdmin(missingMarkerAdmin, options)).rejects.toThrow(
      /database-backed staging canary marker/i
    );
    await expect(provisioner.provisionMacControlCanarySessionWithAdmin(productionMarkerAdmin, options)).rejects.toThrow(
      /database-backed staging canary marker/i
    );
    expect(missingMarkerAdmin.inserts).toHaveLength(0);
    expect(productionMarkerAdmin.inserts).toHaveLength(0);
  });

  it('requires the database marker to bind the exact staging origins and callback host before insertion', async () => {
    const options = {
      supabaseUrl: 'https://dashboard-staging.example.test',
      accountEmail: 'owner@staging.invalid',
      customerId: 'staging-mac-owner',
      endpoint: 'https://dashboard-staging.example.test/runtime',
      expectedCallbackHost: 'openclaw-staging.example.test',
      ttlMinutes: 10,
    };
    const marker = {
      schema: 'evaos.mac_control_canary_target.v2',
      environment: 'staging',
      enabled: true,
      supabase_origin: 'https://dashboard-staging.example.test',
      endpoint_origin: 'https://dashboard-staging.example.test',
      expected_callback_host: 'openclaw-staging.example.test',
    };
    const mismatchedAdmins = [
      new FakeMacControlCanaryAdmin({ ...marker, supabase_origin: 'https://other-staging.example.test' }),
      new FakeMacControlCanaryAdmin({ ...marker, endpoint_origin: 'https://other-staging.example.test' }),
      new FakeMacControlCanaryAdmin({ ...marker, expected_callback_host: 'other-staging.example.test' }),
      new FakeMacControlCanaryAdmin({ ...marker, schema: 'evaos.mac_control_canary_target.v1' }),
    ];

    await Promise.all(
      mismatchedAdmins.map((admin) =>
        expect(provisioner.provisionMacControlCanarySessionWithAdmin(admin, options)).rejects.toThrow(
          /database-backed staging canary marker/i
        )
      )
    );
    for (const admin of mismatchedAdmins) expect(admin.inserts).toHaveLength(0);
  });

  it('mints only a fresh desktop session for the unique current staging Mac and emits sanitized proof', async () => {
    const admin = new FakeMacControlCanaryAdmin();
    const { state, env, report } = await provisioner.provisionMacControlCanarySessionWithAdmin(admin, {
      supabaseUrl: 'https://dashboard-staging.example.test',
      accountEmail: 'owner@staging.invalid',
      customerId: 'staging-mac-owner',
      endpoint: 'https://dashboard-staging.example.test/runtime',
      expectedCallbackHost: 'openclaw-staging.example.test',
      ttlMinutes: 10,
    });

    expect(admin.reads.map((read) => read.table)).toEqual([
      'profiles',
      'customer_accounts',
      'customer_account_memberships',
      'customer_devices',
    ]);
    expect(admin.inserts).toHaveLength(1);
    expect(admin.inserts[0]).toMatchObject({
      table: 'desktop_app_sessions',
      body: {
        user_id: 'owner-profile-id',
        email: 'owner@staging.invalid',
        metadata: {
          source: 'evaos-mac-control-live-canary',
          cleanup_key: expect.stringMatching(/^local-/),
        },
      },
    });
    expect(env).toMatchObject({
      AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID: 'staging-mac-owner',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT: 'https://dashboard-staging.example.test/runtime',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_NETWORK_ENDPOINT:
        'https://dashboard-staging.example.test/functions/v1/customer-mac-control',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_DEVICE_IDENTIFIER: 'staging-device-for-test',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST: 'openclaw-staging.example.test',
    });
    expect(env.AIONUI_EVAOS_MAC_CONTROL_CANARY_DESKTOP_SESSION).toMatch(/^eds_/);
    expect(report).toMatchObject({
      schema: 'evaos-mac-control-canary-session-provision/v1',
      accountConfigured: true,
      customerConfigured: true,
      activeMembershipVerified: true,
      stagingMarkerVerified: true,
      sessionMinted: true,
      sessionExpiryPresent: true,
      sensitiveOutput: 'passed',
    });
    expect(JSON.stringify(report)).not.toMatch(
      /owner@|staging-mac-owner|staging-account-id|owner-profile-id|temporary-session-id|eds_|example\.test/
    );
    expect(state).toMatchObject({
      schema: 'evaos-mac-control-canary-session-state/v1',
      cleanupKey: expect.stringMatching(/^local-/),
      cleanupKeySource: 'generated',
    });
    expect(JSON.stringify(state)).not.toMatch(/eds_|"raw"/);
    expect(state).toMatchObject({
      sessions: {
        macControl: {
          id: 'temporary-session-id',
          expiresAt: expect.any(String),
        },
      },
    });
  });

  it('fails closed before session minting when the staging Mac target is missing or ambiguous', async () => {
    const options = {
      supabaseUrl: 'https://dashboard-staging.example.test',
      accountEmail: 'owner@staging.invalid',
      customerId: 'staging-mac-owner',
      endpoint: 'https://dashboard-staging.example.test/runtime',
      expectedCallbackHost: 'openclaw-staging.example.test',
      ttlMinutes: 10,
    };
    const missing = new FakeMacControlCanaryAdmin(undefined, []);
    const ambiguous = new FakeMacControlCanaryAdmin(undefined, [
      { id: 'staging-device-id-1', device_identifier: 'staging-device-one', status: 'active' },
      { id: 'staging-device-id-2', device_identifier: 'staging-device-two', status: 'needs_attention' },
    ]);
    const workflowCommand = new FakeMacControlCanaryAdmin(undefined, [
      {
        id: 'staging-device-id',
        device_identifier: 'staging-device\n::warning::workflow-command',
        status: 'active',
      },
    ]);

    await expect(provisioner.provisionMacControlCanarySessionWithAdmin(missing, options)).rejects.toThrow(
      /exactly one current staging Mac/i
    );
    await expect(provisioner.provisionMacControlCanarySessionWithAdmin(ambiguous, options)).rejects.toThrow(
      /exactly one current staging Mac/i
    );
    await expect(provisioner.provisionMacControlCanarySessionWithAdmin(workflowCommand, options)).rejects.toThrow(
      /exactly one current staging Mac/i
    );
    expect(missing.inserts).toHaveLength(0);
    expect(ambiguous.inserts).toHaveLength(0);
    expect(workflowCommand.inserts).toHaveLength(0);
  });

  it('generates a unique run-scoped cleanup key for each local canary session', async () => {
    const options = {
      supabaseUrl: 'https://dashboard-staging.example.test',
      accountEmail: 'owner@staging.invalid',
      customerId: 'staging-mac-owner',
      endpoint: 'https://dashboard-staging.example.test/runtime',
      expectedCallbackHost: 'openclaw-staging.example.test',
      ttlMinutes: 10,
    };
    const first = await provisioner.provisionMacControlCanarySessionWithAdmin(new FakeMacControlCanaryAdmin(), options);
    const second = await provisioner.provisionMacControlCanarySessionWithAdmin(
      new FakeMacControlCanaryAdmin(),
      options
    );

    expect(first.state.cleanupKey).toMatch(/^local-/);
    expect(second.state.cleanupKey).toMatch(/^local-/);
    expect(first.state.cleanupKey).not.toBe(second.state.cleanupKey);
  });

  it.each(['state', 'env', 'proof'] as const)(
    'compensates an exact inserted session when %s persistence fails',
    async (phase) => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `evaos-mac-control-${phase}-failure-`));
      const admin = new FakeMacControlCanaryAdmin();
      const options = {
        supabaseUrl: 'https://dashboard-staging.example.test',
        serviceKey: 'fixture-service-key',
        accountEmail: 'owner@staging.invalid',
        customerId: 'staging-mac-owner',
        endpoint: 'https://dashboard-staging.example.test/runtime',
        expectedCallbackHost: 'openclaw-staging.example.test',
        ttlMinutes: 10,
        statePath: path.join(tempDir, 'session-state.json'),
        githubEnvPath: path.join(tempDir, 'github-env'),
        proofDir: path.join(tempDir, 'proof'),
        admin,
        fileSystem: failingMacControlFileSystem(phase),
      };

      try {
        const error = await provisioner.provisionMacControlCanarySession(options).catch((caught) => caught);
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toMatch(/provisioning failed after session creation/i);
        expect(error.message).not.toMatch(/private-path|temporary-session-id|fixture-service-key|eds_/i);
        expect(admin.inserts).toHaveLength(1);
        expect(admin.patches).toHaveLength(1);
        expect(admin.patches[0]).toMatchObject({
          table: 'desktop_app_sessions',
          query: { id: 'eq.temporary-session-id', revoked_at: 'is.null' },
        });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  );

  it('retains sanitized compensation-failure evidence and persisted state', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-mac-control-compensation-failure-'));
    const statePath = path.join(tempDir, 'session-state.json');
    const admin = new NoEvidenceMacControlCanaryAdmin();

    try {
      const error = await provisioner
        .provisionMacControlCanarySession({
          supabaseUrl: 'https://dashboard-staging.example.test',
          serviceKey: 'fixture-service-key',
          accountEmail: 'owner@staging.invalid',
          customerId: 'staging-mac-owner',
          endpoint: 'https://dashboard-staging.example.test/runtime',
          expectedCallbackHost: 'openclaw-staging.example.test',
          ttlMinutes: 10,
          statePath,
          githubEnvPath: path.join(tempDir, 'github-env'),
          proofDir: path.join(tempDir, 'proof'),
          admin,
          fileSystem: failingMacControlFileSystem('env'),
        })
        .catch((caught) => caught);

      expect(error).toMatchObject({
        code: 'MAC_CONTROL_PROVISION_PERSISTENCE_FAILED',
        compensation: 'failed',
      });
      expect(error.message).toMatch(/compensation could not be proven/i);
      expect(error.message).not.toMatch(/private-path|temporary-session-id|fixture-service-key|eds_/i);
      expect(fs.existsSync(statePath)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('revokes only the temporary Mac-control desktop session during unconditional cleanup', async () => {
    const admin = new FakeMacControlCanaryAdmin();
    const report = await provisioner.cleanupMacControlCanarySessionWithAdmin(admin, {
      schema: 'evaos-mac-control-canary-session-state/v1',
      sessions: { macControl: { id: 'temporary-session-id' } },
    });

    expect(admin.patches).toEqual([
      {
        table: 'desktop_app_sessions',
        query: { id: 'eq.temporary-session-id', revoked_at: 'is.null' },
        body: { revoked_at: expect.any(String) },
      },
    ]);
    expect(report).toMatchObject({
      schema: 'evaos-mac-control-canary-session-cleanup/v1',
      sessionRevoked: true,
      sensitiveOutput: 'passed',
    });
    expect(JSON.stringify(report)).not.toContain('temporary-session-id');
  });

  it('accepts an exact revoked row after an ambiguous PATCH commit', async () => {
    const admin = new RetrySafeMacControlCanaryAdmin(
      [{ id: 'temporary-session-id', revoked_at: '2026-07-14T05:00:00.000Z' }],
      'throw-after-commit'
    );

    await expect(
      provisioner.cleanupMacControlCanarySessionWithAdmin(admin, {
        schema: 'evaos-mac-control-canary-session-state/v1',
        sessions: { macControl: { id: 'temporary-session-id' } },
      })
    ).resolves.toMatchObject({ sessionRevoked: true });
    expect(admin.selects).toEqual([
      {
        table: 'desktop_app_sessions',
        query: { id: 'eq.temporary-session-id', select: 'id,revoked_at', limit: 2 },
      },
    ]);
  });

  it('accepts an already-revoked exact state-owned row when the conditional PATCH returns zero', async () => {
    const admin = new RetrySafeMacControlCanaryAdmin(
      [{ id: 'temporary-session-id', revoked_at: '2026-07-14T05:00:00.000Z' }],
      'zero'
    );

    await expect(
      provisioner.cleanupMacControlCanarySessionWithAdmin(admin, {
        schema: 'evaos-mac-control-canary-session-state/v1',
        sessions: { macControl: { id: 'temporary-session-id' } },
      })
    ).resolves.toMatchObject({ sessionRevoked: true });
  });

  it.each([
    ['missing', []],
    ['null revoked_at', [{ id: 'temporary-session-id', revoked_at: null }]],
    [
      'multiple',
      [
        { id: 'temporary-session-id', revoked_at: '2026-07-14T05:00:00.000Z' },
        { id: 'temporary-session-id', revoked_at: '2026-07-14T05:00:01.000Z' },
      ],
    ],
  ])('rejects %s fallback revocation evidence', async (_label, rows) => {
    const admin = new RetrySafeMacControlCanaryAdmin(rows, 'zero');

    await expect(
      provisioner.cleanupMacControlCanarySessionWithAdmin(admin, {
        schema: 'evaos-mac-control-canary-session-state/v1',
        sessions: { macControl: { id: 'temporary-session-id' } },
      })
    ).rejects.toThrow(/did not prove.*revoked/i);
  });

  it('fails explicitly and without sensitive output when required Mac-control cleanup state is missing', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-mac-control-cleanup-missing-'));
    try {
      await expect(
        provisioner.cleanupMacControlCanarySession({
          serviceKey: 'fixture-service-key',
          statePath: path.join(tempDir, 'missing-state.json'),
          proofDir: tempDir,
        })
      ).rejects.toThrow('Mac-control cleanup cannot proceed because the required canary session state is missing.');
      expect(fs.existsSync(path.join(tempDir, 'mac-control-session-cleanup.json'))).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses an explicit run-scoped cleanup key to recover exactly one state-less canary session', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-mac-control-cleanup-key-'));
    const admin = new CleanupKeyLookupMacControlCanaryAdmin([{ id: 'recovered-session-id', revoked_at: null }]);
    try {
      const report = await provisioner.cleanupMacControlCanarySession({
        serviceKey: 'fixture-service-key',
        supabaseUrl: 'https://dashboard-staging.example.test',
        statePath: path.join(tempDir, 'missing-state.json'),
        cleanupKey: 'explicit-0123456789abcdef',
        cleanupKeySource: 'explicit',
        admin,
      });

      expect(admin.selects[0]).toEqual({
        table: 'desktop_app_sessions',
        query: {
          'metadata->>cleanup_key': 'eq.explicit-0123456789abcdef',
          'metadata->>source': 'eq.evaos-mac-control-live-canary',
          select: 'id,revoked_at',
          limit: 2,
        },
      });
      expect(admin.patches[0]).toMatchObject({
        query: { id: 'eq.recovered-session-id', revoked_at: 'is.null' },
      });
      expect(report).toMatchObject({ sessionRevoked: true });
      expect(JSON.stringify(report)).not.toMatch(/recovered-session-id|explicit-/i);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['zero', []],
    [
      'multiple',
      [
        { id: 'recovered-session-id-1', revoked_at: null },
        { id: 'recovered-session-id-2', revoked_at: null },
      ],
    ],
  ])('rejects %s cleanup-key matches when state is missing', async (_label, matchingRows) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-mac-control-cleanup-key-reject-'));
    const admin = new CleanupKeyLookupMacControlCanaryAdmin(matchingRows);
    try {
      await expect(
        provisioner.cleanupMacControlCanarySession({
          serviceKey: 'fixture-service-key',
          supabaseUrl: 'https://dashboard-staging.example.test',
          statePath: path.join(tempDir, 'missing-state.json'),
          cleanupKey: 'explicit-0123456789abcdef',
          cleanupKeySource: 'explicit',
          admin,
        })
      ).rejects.toThrow(/exactly one temporary session/i);
      expect(admin.patches).toHaveLength(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('retains retryable state when atomic cleanup-proof persistence fails', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-mac-control-cleanup-proof-failure-'));
    const statePath = path.join(tempDir, 'session-state.json');
    fs.writeFileSync(
      statePath,
      `${JSON.stringify({
        schema: 'evaos-mac-control-canary-session-state/v1',
        sessions: { macControl: { id: 'temporary-session-id' } },
      })}\n`
    );
    const admin = new FakeMacControlCanaryAdmin();

    try {
      const error = await provisioner
        .cleanupMacControlCanarySession({
          serviceKey: 'fixture-service-key',
          supabaseUrl: 'https://dashboard-staging.example.test',
          statePath,
          proofDir: path.join(tempDir, 'proof'),
          admin,
          fileSystem: failingMacControlFileSystem('proof'),
        })
        .catch((caught) => caught);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/cleanup proof.*state.*retained/i);
      expect(error.message).not.toMatch(/private-path|temporary-session-id|fixture-service-key/i);
      expect(fs.existsSync(statePath)).toBe(true);
      expect(admin.patches).toHaveLength(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('refuses to claim cleanup when the exact temporary session row was not returned', async () => {
    const admin = new NoEvidenceMacControlCanaryAdmin();

    await expect(
      provisioner.cleanupMacControlCanarySessionWithAdmin(admin, {
        schema: 'evaos-mac-control-canary-session-state/v1',
        sessions: { macControl: { id: 'temporary-session-id' } },
      })
    ).rejects.toThrow(/did not prove.*revoked/i);
  });

  it('reuses an existing active admin membership for core broker provisioning', async () => {
    const admin = new FakeMembershipAdmin([
      {
        id: 'membership-existing',
        customer_account_id: 'account-id',
        profile_id: 'admin-profile-id',
        role: 'owner',
        status: 'active',
      },
    ]);

    const membership = await provisioner.loadOrCreateTemporaryAdminMembership(
      admin,
      { id: 'admin-profile-id', email: 'admin@electricsheephq.com' },
      { id: 'account-id' }
    );

    expect(membership).toMatchObject({
      id: 'membership-existing',
      role: 'owner',
      temporary: false,
    });
    expect(admin.inserts).toHaveLength(0);
    expect(admin.patches).toHaveLength(0);
  });

  it('temporarily activates and restores an inactive admin membership', async () => {
    const inactive = {
      id: 'membership-inactive',
      customer_account_id: 'account-id',
      profile_id: 'admin-profile-id',
      role: 'technical_admin',
      status: 'removed',
      accepted_at: null,
      removed_at: '2026-01-01T00:00:00.000Z',
      metadata: { previous: true },
    };
    const admin = new FakeMembershipAdmin([inactive]);

    const membership = await provisioner.loadOrCreateTemporaryAdminMembership(
      admin,
      { id: 'admin-profile-id', email: 'admin@electricsheephq.com' },
      { id: 'account-id' }
    );

    expect(membership).toMatchObject({
      id: 'membership-inactive',
      temporary: true,
      snapshot: { row: inactive },
    });
    expect(admin.patches[0].body).toMatchObject({
      status: 'active',
      metadata: { source: 'aionui-live-canary-core-broker', temporary: true },
    });

    const restored = await provisioner.restoreAdminMembershipFixture(admin, {
      admin: { membershipId: 'membership-inactive', membershipTemporary: true },
      adminMembershipSnapshot: { row: inactive },
    });

    expect(restored).toBe(true);
    expect(admin.patches.at(-1)?.body).toMatchObject({
      status: 'removed',
      metadata: { previous: true },
    });
  });

  it('temporarily upgrades and restores an active admin membership for approval canaries', async () => {
    const active = {
      id: 'membership-active-technical-admin',
      customer_account_id: 'account-id',
      profile_id: 'admin-profile-id',
      role: 'technical_admin',
      status: 'active',
      accepted_at: '2026-01-01T00:00:00.000Z',
      removed_at: null,
      metadata: { previous: true },
    };
    const admin = new FakeMembershipAdmin([active]);

    const membership = await provisioner.loadOrCreateTemporaryAdminMembership(
      admin,
      { id: 'admin-profile-id', email: 'admin@electricsheephq.com' },
      { id: 'account-id' },
      { requiredRole: 'owner' }
    );

    expect(membership).toMatchObject({
      id: 'membership-active-technical-admin',
      role: 'owner',
      temporary: true,
      snapshot: { row: active },
    });
    expect(admin.patches[0].body).toMatchObject({
      role: 'owner',
      status: 'active',
      metadata: {
        previous: true,
        source: 'aionui-live-canary-core-broker',
        temporary: true,
        previous_role: 'technical_admin',
        previous_metadata: { previous: true },
      },
    });

    const restored = await provisioner.restoreAdminMembershipFixture(admin, {
      admin: { membershipId: 'membership-active-technical-admin', membershipTemporary: true },
      adminMembershipSnapshot: { row: active },
    });

    expect(restored).toBe(true);
    expect(admin.patches.at(-1)?.body).toMatchObject({
      role: 'technical_admin',
      status: 'active',
      metadata: { previous: true },
    });
  });

  it('keeps interrupted temporary role upgrades cleanup-obligated on reprovision', async () => {
    const leftoverTemporary = {
      id: 'membership-leftover-owner',
      customer_account_id: 'account-id',
      profile_id: 'admin-profile-id',
      role: 'owner',
      status: 'active',
      accepted_at: '2026-01-01T00:00:00.000Z',
      removed_at: null,
      metadata: {
        source: 'aionui-live-canary-core-broker',
        temporary: true,
        previous_role: 'technical_admin',
        previous_metadata: { previous: true },
      },
    };
    const admin = new FakeMembershipAdmin([leftoverTemporary]);

    const membership = await provisioner.loadOrCreateTemporaryAdminMembership(
      admin,
      { id: 'admin-profile-id', email: 'admin@electricsheephq.com' },
      { id: 'account-id' },
      { requiredRole: 'owner' }
    );

    expect(membership).toMatchObject({
      id: 'membership-leftover-owner',
      role: 'owner',
      temporary: true,
      snapshot: { row: { role: 'technical_admin', metadata: { previous: true } } },
    });
    expect(admin.patches).toHaveLength(0);

    const restored = await provisioner.restoreAdminMembershipFixture(admin, {
      admin: { membershipId: 'membership-leftover-owner', membershipTemporary: true },
      adminMembershipSnapshot: membership.snapshot,
    });

    expect(restored).toBe(true);
    expect(admin.patches.at(-1)?.body).toMatchObject({
      role: 'technical_admin',
      status: 'active',
      metadata: { previous: true },
    });
  });

  it('keeps core broker reprovision of a leftover temporary owner cleanup-obligated', async () => {
    const leftoverTemporary = {
      id: 'membership-leftover-owner-core',
      customer_account_id: 'account-id',
      profile_id: 'admin-profile-id',
      role: 'owner',
      status: 'active',
      accepted_at: '2026-01-01T00:00:00.000Z',
      removed_at: null,
      metadata: {
        source: 'aionui-live-canary-core-broker',
        temporary: true,
        previous_role: 'technical_admin',
        previous_metadata: { previous: true },
      },
    };
    const admin = new FakeMembershipAdmin([leftoverTemporary]);

    const membership = await provisioner.loadOrCreateTemporaryAdminMembership(
      admin,
      { id: 'admin-profile-id', email: 'admin@electricsheephq.com' },
      { id: 'account-id' }
    );

    expect(membership).toMatchObject({
      id: 'membership-leftover-owner-core',
      role: 'owner',
      temporary: true,
      snapshot: { row: { role: 'technical_admin', metadata: { previous: true } } },
    });
    expect(admin.patches).toHaveLength(0);

    const restored = await provisioner.restoreAdminMembershipFixture(admin, {
      admin: { membershipId: 'membership-leftover-owner-core', membershipTemporary: true },
      adminMembershipSnapshot: membership.snapshot,
    });

    expect(restored).toBe(true);
    expect(admin.patches.at(-1)?.body).toMatchObject({
      role: 'technical_admin',
      status: 'active',
      metadata: { previous: true },
    });
  });

  it('does not nest temporary metadata when re-upgrading an interrupted temporary membership', async () => {
    const leftoverTemporary = {
      id: 'membership-leftover-rewrap',
      customer_account_id: 'account-id',
      profile_id: 'admin-profile-id',
      role: 'technical_admin',
      status: 'active',
      accepted_at: '2026-01-01T00:00:00.000Z',
      removed_at: null,
      metadata: {
        source: 'aionui-live-canary-core-broker',
        temporary: true,
        previous_role: 'billing_admin',
        previous_metadata: { previous: true },
      },
    };
    const admin = new FakeMembershipAdmin([leftoverTemporary]);

    const membership = await provisioner.loadOrCreateTemporaryAdminMembership(
      admin,
      { id: 'admin-profile-id', email: 'admin@electricsheephq.com' },
      { id: 'account-id' },
      { requiredRole: 'owner' }
    );

    expect(membership).toMatchObject({
      id: 'membership-leftover-rewrap',
      role: 'owner',
      temporary: true,
      snapshot: { row: { role: 'billing_admin', metadata: { previous: true } } },
    });
    expect(admin.patches[0].body).toMatchObject({
      role: 'owner',
      metadata: {
        previous: true,
        source: 'aionui-live-canary-core-broker',
        temporary: true,
        previous_role: 'billing_admin',
        previous_metadata: { previous: true },
      },
    });
    expect(admin.patches[0].body.metadata).not.toMatchObject({
      previous_metadata: expect.objectContaining({ temporary: true }),
    });

    const restored = await provisioner.restoreAdminMembershipFixture(admin, {
      admin: { membershipId: 'membership-leftover-rewrap', membershipTemporary: true },
      adminMembershipSnapshot: membership.snapshot,
    });

    expect(restored).toBe(true);
    expect(admin.patches.at(-1)?.body).toMatchObject({
      role: 'billing_admin',
      status: 'active',
      metadata: { previous: true },
    });
  });

  it('marks an inserted temporary admin membership removed during cleanup', async () => {
    const admin = new FakeMembershipAdmin([]);

    const membership = await provisioner.loadOrCreateTemporaryAdminMembership(
      admin,
      { id: 'admin-profile-id', email: 'admin@electricsheephq.com' },
      { id: 'account-id' }
    );

    expect(membership).toMatchObject({
      id: 'membership-inserted-1',
      temporary: true,
    });

    const restored = await provisioner.restoreAdminMembershipFixture(admin, {
      admin: { membershipId: 'membership-inserted-1', membershipTemporary: true },
    });

    expect(restored).toBe(true);
    expect(admin.patches.at(-1)?.body).toMatchObject({
      status: 'removed',
      metadata: { source: 'aionui-live-canary-core-broker', cleaned_up: true },
    });
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
