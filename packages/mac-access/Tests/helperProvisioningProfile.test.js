const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  AppStoreConnectError,
  createJWT,
  decodeProfileContent,
  ensureBundle,
  ensureProfile,
  normalizeSerial,
  provisionProfile,
  requestJSON,
  selectCertificate,
  selectReusableProfile,
} = require('../scripts/release/ensure-helper-profile');

const NOW = new Date('2026-07-17T00:00:00.000Z');
const CONTENT = Buffer.from('signed mobile provisioning profile').toString('base64');

function bundle(id = 'bundle-1', platform = 'MAC_OS') {
  return {
    type: 'bundleIds',
    id,
    attributes: { identifier: 'com.evaos.mac-access.helper', platform },
  };
}

function certificate(overrides = {}) {
  return {
    type: 'certificates',
    id: 'cert-1',
    attributes: {
      certificateType: 'DEVELOPER_ID_APPLICATION',
      serialNumber: '00:ab-cd',
      expirationDate: '2027-01-01T00:00:00.000Z',
      ...overrides,
    },
  };
}

function profile(overrides = {}) {
  return {
    type: 'profiles',
    id: 'profile-1',
    attributes: {
      profileType: 'MAC_APP_DIRECT',
      profileState: 'ACTIVE',
      platform: 'MAC_OS',
      expirationDate: '2027-01-01T00:00:00.000Z',
      profileContent: CONTENT,
      ...(overrides.attributes || {}),
    },
    relationships: {
      bundleId: { data: { type: 'bundleIds', id: 'bundle-1' } },
      certificates: { data: [{ type: 'certificates', id: 'cert-1' }] },
      ...(overrides.relationships || {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => !['attributes', 'relationships'].includes(key))),
  };
}

function collection(data) {
  return { data, links: {} };
}

test('creates a short-lived ES256 JWT with App Store Connect claims', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const token = createJWT({
    issuer: 'issuer-id',
    keyId: 'KEYID12345',
    privateKey,
    now: NOW,
  });
  const [encodedHeader, encodedClaims, encodedSignature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(encodedHeader, 'base64url')), {
    alg: 'ES256',
    kid: 'KEYID12345',
    typ: 'JWT',
  });
  assert.deepEqual(JSON.parse(Buffer.from(encodedClaims, 'base64url')), {
    iss: 'issuer-id',
    iat: 1784246395,
    exp: 1784247000,
    aud: 'appstoreconnect-v1',
  });
  assert.equal(
    crypto.verify(
      'sha256',
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(encodedSignature, 'base64url')
    ),
    true
  );
});

test('normalizes one exact active Developer ID Application certificate', () => {
  assert.equal(normalizeSerial(' 0x00:AB-CD '), 'ABCD');
  assert.equal(selectCertificate([certificate()], 'abcd', NOW).id, 'cert-1');
  assert.throws(
    () => selectCertificate([certificate(), certificate({ serialNumber: 'ABCD' })], 'ABCD', NOW),
    /Duplicate exact/
  );
});

test('rejects a missing, expired, or wrong-type certificate', () => {
  assert.throws(() => selectCertificate([], 'ABCD', NOW), /No active exact/);
  assert.throws(
    () => selectCertificate([certificate({ expirationDate: NOW.toISOString() })], 'ABCD', NOW),
    /No active exact/
  );
  assert.throws(
    () => selectCertificate([certificate({ certificateType: 'MAC_APP_DISTRIBUTION' })], 'ABCD', NOW),
    /wrong certificate type/
  );
});

test('reuses only one active unexpired MAC_APP_DIRECT profile containing the exact certificate', () => {
  const unrelated = profile({
    id: 'unrelated-profile',
    relationships: { bundleId: { data: { type: 'bundleIds', id: 'another-bundle' } } },
  });
  assert.equal(selectReusableProfile([unrelated, profile()], 'bundle-1', 'cert-1', NOW).id, 'profile-1');
  assert.equal(
    selectReusableProfile([profile({ attributes: { profileState: 'INVALID' } })], 'bundle-1', 'cert-1', NOW),
    null
  );
  assert.throws(
    () => selectReusableProfile([profile(), profile({ id: 'profile-2' })], 'bundle-1', 'cert-1', NOW),
    /Duplicate active exact/
  );
});

test('fails closed on wrong target platform or malformed bundle relationship', () => {
  assert.throws(
    () => selectReusableProfile([profile({ attributes: { platform: 'IOS' } })], 'bundle-1', 'cert-1', NOW),
    /wrong helper profile/
  );
  assert.throws(
    () =>
      selectReusableProfile(
        [profile({ relationships: { bundleId: { data: { type: 'wrong', id: 'other-bundle' } } } })],
        'bundle-1',
        'cert-1',
        NOW
      ),
    /malformed profile collection/
  );
});

test('re-queries and reuses an exact bundle after a concurrent create conflict', async () => {
  let lists = 0;
  const request = async (method) => {
    if (method === 'GET') return collection(++lists === 1 ? [] : [bundle()]);
    throw new AppStoreConnectError('conflict', 409);
  };
  assert.equal((await ensureBundle(request)).id, 'bundle-1');
  assert.equal(lists, 2);
});

test('re-queries and reuses an exact profile after a concurrent create conflict', async () => {
  let lists = 0;
  const request = async (method) => {
    if (method === 'GET') return collection(++lists === 1 ? [] : [profile()]);
    throw new AppStoreConnectError('conflict', 409);
  };
  assert.equal((await ensureProfile(request, bundle(), certificate(), NOW)).id, 'profile-1');
  assert.equal(lists, 2);
});

test('provisions the exact profile bytes with mode 0600 without calling live APIs', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-access-profile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'helper.provisionprofile');
  const calls = [];
  const request = async (method, resourcePath, body) => {
    calls.push({ method, resourcePath, body });
    if (resourcePath.startsWith('/v1/bundleIds?')) return collection([bundle()]);
    if (resourcePath.startsWith('/v1/certificates?')) return collection([certificate()]);
    if (resourcePath.startsWith('/v1/profiles?')) return collection([]);
    if (method === 'POST' && resourcePath === '/v1/profiles') {
      return { data: { type: 'profiles', id: 'profile-1' } };
    }
    if (method === 'GET' && resourcePath.startsWith('/v1/profiles/profile-1?')) return { data: profile() };
    throw new Error(`Unexpected mocked request: ${method} ${resourcePath}`);
  };
  const result = await provisionProfile({ certificateSerial: 'ABCD', output }, { request, now: NOW });
  assert.deepEqual(result, { bundleId: 'bundle-1', certificateId: 'cert-1', profileId: 'profile-1' });
  assert.equal(fs.readFileSync(output, 'utf8'), 'signed mobile provisioning profile');
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
});

test('rejects malformed profile content instead of permissive base64 decoding', () => {
  for (const malformed of ['', 'not base64', 'YWJjZA', 'YWJjZA===']) {
    assert.throws(() => decodeProfileContent(malformed), /profile content is malformed/);
  }
});

test('API failures expose status but never response bodies or bearer tokens', async () => {
  const secret = 'never-print-this-token';
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => `leaked ${secret}` });
  await assert.rejects(
    () => requestJSON(fetchImpl, secret, 'GET', '/v1/profiles'),
    (error) => error.status === 401 && !error.message.includes(secret) && !error.message.includes('leaked')
  );
});
