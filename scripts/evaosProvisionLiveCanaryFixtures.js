#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SUPABASE_URL = 'https://rhfojelkgtwcxnrfhtlj.supabase.co';
const DEFAULT_BROKER_ENDPOINT = `${DEFAULT_SUPABASE_URL}/functions/v1/desktop-runtime-session`;
const DEFAULT_CUSTOMER_ID = 'golden';
const DEFAULT_ADMIN_EMAIL = 'admin@100yen.org';
const DEFAULT_BUSINESS_BROWSER_TEST_URL = 'https://www.electricsheephq.com/dashboard/';
const DEFAULT_BUSINESS_BROWSER_ALLOWED_HOSTS = 'www.electricsheephq.com';
const DEFAULT_COMPANY_BRAIN_QUERY = 'What changed recently for this account?';
const FIXTURE_PROVIDER_KEYS = ['slack', 'linear', 'notion'];
const SECRET_OUTPUT_PATTERNS = [
  /\beds_[A-Za-z0-9_-]{8,}\b/i,
  /\bepg_[A-Za-z0-9_-]{8,}\b/i,
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\bservice[_-]?role\b/i,
  /\bdesktop[_-]?session\b/i,
  /\bprovider[_-]?grant\b/i,
  /\baccess[_-]?token\b/i,
  /\brefresh[_-]?token\b/i,
  /\bpassword\b/i,
  /\bauthorization\b/i,
];

function token(prefix = 'eds') {
  return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isoAfter(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function isoBefore(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function requireEnv(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required environment variable ${key}.`);
  }
  return value.trim();
}

function optionalEnv(env, key, fallback) {
  const value = env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function safeText(value, maxLength = 220) {
  return typeof value === 'string' && value.trim() && value.trim().length <= maxLength ? value.trim() : undefined;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function assertNoUnsafeProofOutput(value) {
  const text = JSON.stringify(value);
  const match = SECRET_OUTPUT_PATTERNS.find((pattern) => pattern.test(text));
  if (match) {
    throw new Error(`Provisioning proof exposed unsafe material matching ${match}.`);
  }
}

function headers(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function encodeQuery(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) query.set(key, String(value));
  }
  const rendered = query.toString();
  return rendered ? `?${rendered}` : '';
}

async function readBody(response) {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function errorMessage(body) {
  const record = asRecord(body);
  return (
    safeText(record?.message, 500) ??
    safeText(record?.error_description, 500) ??
    safeText(record?.error, 500) ??
    safeText(record?.hint, 500) ??
    JSON.stringify(body ?? {})
  );
}

class SupabaseRestAdmin {
  constructor({ supabaseUrl, serviceKey }) {
    this.supabaseUrl = supabaseUrl.replace(/\/+$/, '');
    this.serviceKey = serviceKey;
  }

  async request(method, pathname, { body, query, prefer, allowNotOk = false } = {}) {
    const response = await fetch(`${this.supabaseUrl}${pathname}${encodeQuery(query)}`, {
      method,
      headers: headers(this.serviceKey, prefer ? { Prefer: prefer } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = await readBody(response);
    if (!response.ok && !allowNotOk) {
      throw new Error(`${method} ${pathname} failed HTTP ${response.status}: ${errorMessage(parsed)}`);
    }
    return { ok: response.ok, status: response.status, body: parsed };
  }

  async select(table, query) {
    const result = await this.request('GET', `/rest/v1/${table}`, { query });
    return Array.isArray(result.body) ? result.body : [];
  }

  async single(table, query, label) {
    const rows = await this.select(table, { ...query, limit: query.limit ?? 1 });
    const row = rows[0];
    if (!row) throw new Error(`${label} was not found.`);
    return row;
  }

  async insert(table, body, { select = '*', label = table } = {}) {
    const result = await this.request('POST', `/rest/v1/${table}`, {
      query: { select },
      body,
      prefer: 'return=representation',
    });
    const rows = Array.isArray(result.body) ? result.body : [];
    if (!rows[0]) throw new Error(`${label} insert did not return a row.`);
    return rows[0];
  }

  async upsert(table, body, { onConflict, select = '*', label = table } = {}) {
    const result = await this.request('POST', `/rest/v1/${table}`, {
      query: { on_conflict: onConflict, select },
      body,
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    const rows = Array.isArray(result.body) ? result.body : [];
    if (!rows[0]) throw new Error(`${label} upsert did not return a row.`);
    return rows[0];
  }

  async patch(table, query, body) {
    await this.request('PATCH', `/rest/v1/${table}`, {
      query,
      body,
      prefer: 'return=minimal',
    });
  }

  async deleteRows(table, query) {
    await this.request('DELETE', `/rest/v1/${table}`, {
      query,
      prefer: 'return=minimal',
    });
  }

  async createAuthUser({ email, password, fullName }) {
    const result = await this.request('POST', '/auth/v1/admin/users', {
      body: {
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      },
    });
    const user = asRecord(result.body)?.user ?? result.body;
    if (!asRecord(user)?.id) throw new Error(`Auth user creation did not return an id for ${email}.`);
    return user;
  }

  async deleteAuthUser(userId) {
    await this.request('DELETE', `/auth/v1/admin/users/${encodeURIComponent(userId)}`, { allowNotOk: true });
  }
}

async function postBrokerAction(endpoint, desktopSession, body) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${desktopSession}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const parsed = await readBody(response);
  return { ok: response.ok, status: response.status, body: parsed };
}

async function requiredBrokerAction(endpoint, desktopSession, body, label) {
  const result = await postBrokerAction(endpoint, desktopSession, body);
  if (!result.ok) {
    throw new Error(`${label} failed HTTP ${result.status}: ${errorMessage(result.body)}`);
  }
  return result.body;
}

async function createDesktopSession(admin, { userId, email, source, ttlMinutes }) {
  const raw = token('eds');
  const inserted = await admin.insert(
    'desktop_app_sessions',
    {
      user_id: userId,
      email,
      token_hash: sha256Hex(raw),
      expires_at: isoAfter(ttlMinutes),
      metadata: {
        roles: ['customer'],
        source,
        created_by: 'aionui-live-canary-fixture-provisioner',
      },
    },
    { select: 'id,expires_at', label: `desktop session for ${email}` }
  );
  return { raw, id: inserted.id, expiresAt: inserted.expires_at };
}

async function loadAdminProfile(admin, adminEmail) {
  return admin.single('profiles', { email: `eq.${adminEmail}`, select: 'id,email' }, `admin profile ${adminEmail}`);
}

async function loadCustomerAccount(admin, customerId) {
  return admin.single(
    'customer_accounts',
    {
      customer_id: `eq.${customerId}`,
      merged_into_customer_account_id: 'is.null',
      select: 'id,customer_id,display_name',
    },
    `customer account ${customerId}`
  );
}

async function loadAdminMembership(admin, adminProfileId, customerAccountId) {
  return admin.single(
    'customer_account_memberships',
    {
      profile_id: `eq.${adminProfileId}`,
      customer_account_id: `eq.${customerAccountId}`,
      status: 'eq.active',
      select: 'id,role,status',
    },
    'active admin customer-account membership'
  );
}

async function createTemporaryRequester(admin, customerAccountId) {
  const suffix = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const email = `aionui-deny-requester-${suffix}@100yen.org`;
  const password = crypto.randomBytes(24).toString('base64url');
  const user = await admin.createAuthUser({
    email,
    password,
    fullName: 'AionUi Approval Requester Fixture',
  });
  await admin.upsert(
    'profiles',
    {
      id: user.id,
      email,
      full_name: 'AionUi Approval Requester Fixture',
    },
    { onConflict: 'id', select: 'id,email', label: 'requester profile' }
  );
  const membership = await admin.upsert(
    'customer_account_memberships',
    {
      customer_account_id: customerAccountId,
      profile_id: user.id,
      invited_email: email,
      role: 'technical_admin',
      status: 'active',
      accepted_at: new Date().toISOString(),
      metadata: {
        source: 'aionui-live-canary-fixture-provisioner',
        temporary: true,
      },
    },
    {
      onConflict: 'customer_account_id,profile_id',
      select: 'id,role,status',
      label: 'requester customer-account membership',
    }
  );
  return { userId: user.id, email, membershipId: membership.id, role: membership.role };
}

async function createDeniedUser(admin) {
  const suffix = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const email = `aionui-denied-member-${suffix}@100yen.org`;
  const password = crypto.randomBytes(24).toString('base64url');
  const user = await admin.createAuthUser({
    email,
    password,
    fullName: 'AionUi Denied Member Fixture',
  });
  await admin.upsert(
    'profiles',
    {
      id: user.id,
      email,
      full_name: 'AionUi Denied Member Fixture',
    },
    { onConflict: 'id', select: 'id,email', label: 'denied profile' }
  );
  return { userId: user.id, email };
}

async function snapshotProviderRows(admin, customerId) {
  const rows = await admin.select('customer_provider_profiles', {
    customer_id: `eq.${customerId}`,
    provider_key: `in.(${FIXTURE_PROVIDER_KEYS.join(',')})`,
    select: '*',
  });
  return rows.map((row) => ({ providerKey: row.provider_key, row }));
}

async function upsertProviderFixtureRows(admin, customerId) {
  const now = new Date().toISOString();
  const rows = [
    {
      customer_id: customerId,
      provider_key: 'slack',
      display_name: 'Slack',
      status: 'connected',
      active: false,
      usage_summary: 'Controlled expired provider fixture for AionUi live canary proof.',
      usage_metadata: {},
      capabilities: ['Channels', 'Messages'],
      metadata: {
        source: 'aionui_live_canary_fixture',
        acceptance_fixture: true,
        identity: 'slack-aionui-fixture@100yen.org',
        scopes: ['channels:read'],
        server_secret_ref: `provider://acceptance-fixture/${customerId}/slack`,
        expires_at: isoBefore(10),
        raw_provider_token_stored: false,
      },
      last_validated_at: isoBefore(60),
    },
    {
      customer_id: customerId,
      provider_key: 'linear',
      display_name: 'Linear',
      status: 'revoked',
      active: false,
      usage_summary: 'Controlled revoked provider fixture for AionUi live canary proof.',
      usage_metadata: {},
      capabilities: ['Issues', 'Project status'],
      metadata: {
        source: 'aionui_live_canary_fixture',
        acceptance_fixture: true,
        raw_provider_token_stored: false,
      },
      last_validated_at: null,
    },
    {
      customer_id: customerId,
      provider_key: 'notion',
      display_name: 'Notion',
      status: 'needs_login',
      active: false,
      usage_summary: 'Controlled needs-login provider fixture for AionUi live canary proof.',
      usage_metadata: {},
      capabilities: ['Pages', 'Databases'],
      metadata: {
        source: 'aionui_live_canary_fixture',
        acceptance_fixture: true,
        raw_provider_token_stored: false,
      },
      last_validated_at: null,
    },
  ];

  for (const row of rows) {
    await admin.upsert('customer_provider_profiles', row, {
      onConflict: 'customer_id,provider_key',
      select: 'customer_id,provider_key,status',
      label: `${row.provider_key} provider fixture`,
    });
  }
}

async function createApprovalRequest(endpoint, requesterSession, customerId, providerKey) {
  const result = await requiredBrokerAction(
    endpoint,
    requesterSession,
    {
      action: 'provider_approval_request',
      customer_id: customerId,
      provider_key: providerKey,
      requested_action: 'provider_revoke',
    },
    'fixture provider approval request'
  );
  const request = asRecord(result)?.approval_request ?? asRecord(result)?.request;
  const approvalId = safeText(asRecord(request)?.approval_id ?? asRecord(request)?.id, 160);
  if (!approvalId) throw new Error('Fixture approval request did not return approval_id.');
  return {
    approvalId,
    providerKey: safeText(asRecord(request)?.provider_key, 80) ?? providerKey,
    requestedAction: safeText(asRecord(request)?.requested_action, 80) ?? 'provider_revoke',
    sourcePointer: safeText(asRecord(request)?.source_pointer),
    auditId: safeText(asRecord(request)?.audit_id),
  };
}

async function selectCompanyBrainAccount(endpoint, desktopSession, customerId, preferredAccountId) {
  if (preferredAccountId) return preferredAccountId;
  const directory = await requiredBrokerAction(
    endpoint,
    desktopSession,
    {
      action: 'company_brain_directory',
      customer_id: customerId,
    },
    'Company Brain fixture directory lookup'
  );
  const record = asRecord(directory)?.data ?? directory;
  const accounts = Array.isArray(asRecord(record)?.accounts) ? asRecord(record).accounts : [];
  const first = accounts.map(asRecord).find(Boolean);
  const accountId = safeText(first?.account_id ?? first?.accountId ?? first?.id, 160);
  if (!accountId) {
    throw new Error('Company Brain fixture directory did not return an account id.');
  }
  return accountId;
}

function fixtureEnvFromProvision(state) {
  return {
    AIONUI_EVAOS_BROKER_ENDPOINT: state.brokerEndpoint,
    AIONUI_EVAOS_DESKTOP_SESSION: state.sessions.admin.raw,
    AIONUI_EVAOS_CUSTOMER_ID: state.customerId,
    AIONUI_EVAOS_RUNTIME: 'browser',
    AIONUI_EVAOS_PROVIDER_REQUIRED_STATES: 'connected,needs_login,expired,revoked',
    AIONUI_EVAOS_APPROVAL_DENY_ACK: 'evaos-deny-test',
    AIONUI_EVAOS_APPROVAL_ID: state.approval.approvalId,
    AIONUI_EVAOS_REQUESTER_SESSION: state.sessions.requester.raw,
    AIONUI_EVAOS_APPROVER_SESSION: state.sessions.admin.raw,
    AIONUI_EVAOS_REQUESTER_MEMBERSHIP_ID: state.requester.membershipId,
    AIONUI_EVAOS_APPROVAL_DENY_REASON: 'Denied by reusable AionUi live canary fixture.',
    AIONUI_EVAOS_COMPANY_BRAIN_ACCOUNT_ID: state.companyBrain.accountId,
    AIONUI_EVAOS_COMPANY_BRAIN_QUERY: state.companyBrain.query,
    AIONUI_EVAOS_COMPANY_BRAIN_WRONG_CUSTOMER_ID: state.wrongCustomerId,
    AIONUI_EVAOS_COMPANY_BRAIN_DENIED_SESSION: state.sessions.denied.raw,
    AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK: 'evaos-browser-test',
    AIONUI_EVAOS_BUSINESS_BROWSER_TEST_URL: state.businessBrowser.testUrl,
    AIONUI_EVAOS_BUSINESS_BROWSER_ALLOWED_HOSTS: state.businessBrowser.allowedHosts,
    AIONUI_EVAOS_BUSINESS_BROWSER_WRONG_CUSTOMER_ID: state.wrongCustomerId,
    AIONUI_EVAOS_BUSINESS_BROWSER_DENIED_SESSION: state.sessions.denied.raw,
  };
}

function renderGithubEnvFile(env) {
  return `${Object.entries(env)
    .map(([key, value]) => `${key}=${String(value).replace(/\r?\n/g, '')}`)
    .join('\n')}\n`;
}

function maskSecretsForGithub(env) {
  if (!process.env.GITHUB_ACTIONS) return;
  for (const key of [
    'AIONUI_EVAOS_DESKTOP_SESSION',
    'AIONUI_EVAOS_REQUESTER_SESSION',
    'AIONUI_EVAOS_APPROVER_SESSION',
    'AIONUI_EVAOS_COMPANY_BRAIN_DENIED_SESSION',
    'AIONUI_EVAOS_BUSINESS_BROWSER_DENIED_SESSION',
  ]) {
    const value = env[key];
    if (value) process.stdout.write(`::add-mask::${value}\n`);
  }
}

function sanitizedProvisionReport(state) {
  const report = {
    schema: 'evaos-live-canary-fixture-provision/v1',
    checkedAt: new Date().toISOString(),
    customerId: state.customerId,
    customerAccountId: state.customerAccountId,
    admin: {
      email: state.admin.email,
      membershipRole: state.admin.membershipRole,
    },
    requester: {
      membershipId: state.requester.membershipId,
      role: state.requester.role,
    },
    approval: state.approval,
    providerFixtures: {
      keys: FIXTURE_PROVIDER_KEYS,
      requiredStates: ['connected', 'needs_login', 'expired', 'revoked'],
      strategy: 'short-lived canary fixture rows with snapshot/restore cleanup',
    },
    companyBrain: {
      accountId: state.companyBrain.accountId,
      query: state.companyBrain.query,
    },
    businessBrowser: {
      testUrlHost: new URL(state.businessBrowser.testUrl).hostname,
      allowedHosts: state.businessBrowser.allowedHosts,
    },
    negativeFixtures: {
      wrongCustomerId: state.wrongCustomerId,
      deniedSessionCreated: true,
    },
    expiresAt: state.sessions.admin.expiresAt,
    sensitiveOutput: 'passed',
  };
  assertNoUnsafeProofOutput(report);
  return report;
}

function loadOptions(env = process.env) {
  const supabaseUrl = optionalEnv(env, 'AIONUI_EVAOS_FIXTURE_SUPABASE_URL', env.SUPABASE_URL || DEFAULT_SUPABASE_URL);
  return {
    supabaseUrl,
    serviceKey:
      optionalEnv(env, 'AIONUI_EVAOS_FIXTURE_SUPABASE_SERVICE_ROLE_KEY', undefined) ||
      optionalEnv(env, 'SUPABASE_SECRET_KEY', undefined) ||
      optionalEnv(env, 'SUPABASE_SERVICE_ROLE_KEY', undefined),
    brokerEndpoint: optionalEnv(
      env,
      'AIONUI_EVAOS_BROKER_ENDPOINT',
      `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/desktop-runtime-session`
    ),
    adminEmail: optionalEnv(env, 'AIONUI_EVAOS_FIXTURE_ADMIN_EMAIL', DEFAULT_ADMIN_EMAIL),
    customerId: optionalEnv(
      env,
      'AIONUI_EVAOS_FIXTURE_CUSTOMER_ID',
      env.AIONUI_EVAOS_CUSTOMER_ID || DEFAULT_CUSTOMER_ID
    ),
    wrongCustomerId: optionalEnv(env, 'AIONUI_EVAOS_FIXTURE_WRONG_CUSTOMER_ID', 'aionui-wrong-customer-proof'),
    preferredCompanyBrainAccountId: optionalEnv(env, 'AIONUI_EVAOS_COMPANY_BRAIN_ACCOUNT_ID', undefined),
    companyBrainQuery: optionalEnv(env, 'AIONUI_EVAOS_COMPANY_BRAIN_QUERY', DEFAULT_COMPANY_BRAIN_QUERY),
    browserTestUrl: optionalEnv(env, 'AIONUI_EVAOS_BUSINESS_BROWSER_TEST_URL', DEFAULT_BUSINESS_BROWSER_TEST_URL),
    browserAllowedHosts: optionalEnv(
      env,
      'AIONUI_EVAOS_BUSINESS_BROWSER_ALLOWED_HOSTS',
      DEFAULT_BUSINESS_BROWSER_ALLOWED_HOSTS
    ),
    approvalProviderKey: optionalEnv(env, 'AIONUI_EVAOS_APPROVAL_PROVIDER_KEY', 'google_workspace'),
    ttlMinutes: Number(optionalEnv(env, 'AIONUI_EVAOS_FIXTURE_TTL_MINUTES', '180')),
    statePath: optionalEnv(
      env,
      'AIONUI_EVAOS_FIXTURE_STATE_PATH',
      path.join(process.cwd(), '.evaos-live-canary-fixtures.json')
    ),
    githubEnvPath: optionalEnv(env, 'GITHUB_ENV', undefined),
    proofDir: optionalEnv(env, 'PROOF_DIR', undefined),
  };
}

async function provisionFixtures(options = loadOptions()) {
  if (!options.serviceKey) {
    throw new Error('Missing AIONUI_EVAOS_FIXTURE_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY.');
  }
  const admin = new SupabaseRestAdmin({ supabaseUrl: options.supabaseUrl, serviceKey: options.serviceKey });
  const adminProfile = await loadAdminProfile(admin, options.adminEmail);
  const customerAccount = await loadCustomerAccount(admin, options.customerId);
  const adminMembership = await loadAdminMembership(admin, adminProfile.id, customerAccount.id);
  const providerSnapshots = await snapshotProviderRows(admin, options.customerId);
  const requester = await createTemporaryRequester(admin, customerAccount.id);
  const denied = await createDeniedUser(admin);
  const adminSession = await createDesktopSession(admin, {
    userId: adminProfile.id,
    email: adminProfile.email,
    source: 'aionui-live-canary-admin',
    ttlMinutes: options.ttlMinutes,
  });
  const requesterSession = await createDesktopSession(admin, {
    userId: requester.userId,
    email: requester.email,
    source: 'aionui-live-canary-requester',
    ttlMinutes: options.ttlMinutes,
  });
  const deniedSession = await createDesktopSession(admin, {
    userId: denied.userId,
    email: denied.email,
    source: 'aionui-live-canary-denied',
    ttlMinutes: options.ttlMinutes,
  });

  await upsertProviderFixtureRows(admin, options.customerId);
  const approval = await createApprovalRequest(
    options.brokerEndpoint,
    requesterSession.raw,
    options.customerId,
    options.approvalProviderKey
  );
  const companyBrainAccountId = await selectCompanyBrainAccount(
    options.brokerEndpoint,
    adminSession.raw,
    options.customerId,
    options.preferredCompanyBrainAccountId
  );

  const state = {
    schema: 'evaos-live-canary-fixture-state/v1',
    createdAt: new Date().toISOString(),
    supabaseUrl: options.supabaseUrl,
    brokerEndpoint: options.brokerEndpoint,
    customerId: options.customerId,
    customerAccountId: customerAccount.id,
    wrongCustomerId: options.wrongCustomerId,
    admin: {
      id: adminProfile.id,
      email: adminProfile.email,
      membershipId: adminMembership.id,
      membershipRole: adminMembership.role,
    },
    requester,
    denied,
    sessions: {
      admin: adminSession,
      requester: requesterSession,
      denied: deniedSession,
    },
    providerSnapshots,
    approval,
    companyBrain: {
      accountId: companyBrainAccountId,
      query: options.companyBrainQuery,
    },
    businessBrowser: {
      testUrl: options.browserTestUrl,
      allowedHosts: options.browserAllowedHosts,
    },
  };

  fs.mkdirSync(path.dirname(options.statePath), { recursive: true });
  fs.writeFileSync(options.statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });

  const env = fixtureEnvFromProvision(state);
  maskSecretsForGithub(env);
  if (options.githubEnvPath) {
    fs.appendFileSync(options.githubEnvPath, renderGithubEnvFile(env));
  }
  if (options.proofDir) {
    fs.mkdirSync(options.proofDir, { recursive: true });
    fs.writeFileSync(
      path.join(options.proofDir, 'fixture-provisioning.json'),
      `${JSON.stringify(sanitizedProvisionReport(state), null, 2)}\n`
    );
  }

  return { state, env, report: sanitizedProvisionReport(state) };
}

async function restoreProviderSnapshots(admin, state) {
  const snapshots = Array.isArray(state.providerSnapshots) ? state.providerSnapshots : [];
  const snapshotByKey = new Map(snapshots.map((entry) => [entry.providerKey, entry.row]));
  for (const providerKey of FIXTURE_PROVIDER_KEYS) {
    const row = snapshotByKey.get(providerKey);
    if (row) {
      await admin.upsert('customer_provider_profiles', row, {
        onConflict: 'customer_id,provider_key',
        select: 'customer_id,provider_key,status',
        label: `${providerKey} provider snapshot restore`,
      });
    } else {
      await admin.deleteRows('customer_provider_profiles', {
        customer_id: `eq.${state.customerId}`,
        provider_key: `eq.${providerKey}`,
      });
    }
  }
}

async function cleanupFixtures(options = loadOptions()) {
  if (!options.serviceKey) {
    throw new Error('Missing AIONUI_EVAOS_FIXTURE_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY.');
  }
  if (!fs.existsSync(options.statePath)) {
    return { schema: 'evaos-live-canary-fixture-cleanup/v1', status: 'no-state-file' };
  }
  const state = JSON.parse(fs.readFileSync(options.statePath, 'utf8'));
  const admin = new SupabaseRestAdmin({ supabaseUrl: options.supabaseUrl, serviceKey: options.serviceKey });
  const now = new Date().toISOString();
  await restoreProviderSnapshots(admin, state);
  const sessionIds = [state.sessions?.admin?.id, state.sessions?.requester?.id, state.sessions?.denied?.id].filter(
    Boolean
  );
  if (sessionIds.length > 0) {
    await admin.patch(
      'desktop_app_sessions',
      { id: `in.(${sessionIds.join(',')})` },
      { revoked_at: now, last_used_at: now }
    );
  }
  if (state.requester?.membershipId) {
    await admin.patch(
      'customer_account_memberships',
      { id: `eq.${state.requester.membershipId}` },
      { status: 'removed', removed_at: now }
    );
  }
  if (state.approval?.approvalId) {
    await admin.patch(
      'customer_provider_action_requests',
      { id: `eq.${state.approval.approvalId}`, status: 'eq.pending' },
      {
        status: 'failed',
        decision_note: 'Cleaned up after AionUi reusable live canary fixture run.',
        decided_at: now,
      }
    );
  }
  if (state.requester?.userId) await admin.deleteAuthUser(state.requester.userId);
  if (state.denied?.userId) await admin.deleteAuthUser(state.denied.userId);
  fs.rmSync(options.statePath, { force: true });
  const report = {
    schema: 'evaos-live-canary-fixture-cleanup/v1',
    checkedAt: new Date().toISOString(),
    customerId: state.customerId,
    providerFixturesRestored: true,
    sessionsRevoked: sessionIds.length,
    temporaryUsersDeleted: [state.requester?.userId, state.denied?.userId].filter(Boolean).length,
    sensitiveOutput: 'passed',
  };
  assertNoUnsafeProofOutput(report);
  if (options.proofDir) {
    fs.mkdirSync(options.proofDir, { recursive: true });
    fs.writeFileSync(path.join(options.proofDir, 'fixture-cleanup.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

async function main() {
  const mode = process.argv[2] || 'provision';
  if (mode === 'provision') {
    const { report } = await provisionFixtures();
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (mode === 'cleanup') {
    const report = await cleanupFixtures();
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  throw new Error(`Unknown mode ${mode}. Use provision or cleanup.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_BROKER_ENDPOINT,
  SupabaseRestAdmin,
  assertNoUnsafeProofOutput,
  cleanupFixtures,
  fixtureEnvFromProvision,
  loadOptions,
  provisionFixtures,
  renderGithubEnvFile,
  sanitizedProvisionReport,
};
