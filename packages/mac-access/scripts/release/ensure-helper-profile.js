#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const API_ORIGIN = 'https://api.appstoreconnect.apple.com';
const HELPER_BUNDLE_ID = 'com.evaos.mac-access.helper';
const BUNDLE_NAME = 'evaOS Mac Access Helper';
const DEFAULT_PROFILE_NAME = 'evaOS Mac Access Helper Developer ID';
const PLATFORM = 'MAC_OS';
const MAC_COMPATIBLE_BUNDLE_PLATFORMS = new Set([PLATFORM, 'UNIVERSAL']);
const CERTIFICATE_TYPE = 'DEVELOPER_ID_APPLICATION';
const PROFILE_TYPE = 'MAC_APP_DIRECT';

class AppStoreConnectError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'AppStoreConnectError';
    this.status = status;
  }
}

function base64URL(value) {
  return Buffer.from(value).toString('base64url');
}

function createJWT({ issuer, keyId, privateKey, now = new Date() }) {
  if (!issuer || !keyId || !privateKey) throw new Error('App Store Connect JWT inputs are incomplete.');
  const key = privateKey instanceof crypto.KeyObject ? privateKey : crypto.createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('App Store Connect private key must be an ES256 key.');
  }
  const issuedAt = Math.floor(now.getTime() / 1000);
  if (!Number.isSafeInteger(issuedAt)) throw new Error('App Store Connect JWT clock is invalid.');
  const header = base64URL(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const claims = base64URL(
    JSON.stringify({ iss: issuer, iat: issuedAt - 5, exp: issuedAt + 600, aud: 'appstoreconnect-v1' })
  );
  const signingInput = `${header}.${claims}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  if (signature.length !== 64) throw new Error('App Store Connect JWT signature is invalid.');
  return `${signingInput}.${base64URL(signature)}`;
}

function normalizeSerial(value) {
  if (typeof value !== 'string') throw new Error('Certificate serial is invalid.');
  const normalized = value
    .trim()
    .replace(/^0x/i, '')
    .replace(/[\s:-]/g, '')
    .toUpperCase();
  if (!/^[0-9A-F]+$/.test(normalized)) throw new Error('Certificate serial is invalid.');
  return normalized.replace(/^0+(?=[0-9A-F])/, '');
}

function queryPath(resource, parameters) {
  const url = new URL(resource, API_ORIGIN);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

async function requestJSON(fetchImpl, token, method, resourcePath, body) {
  const url = new URL(resourcePath, API_ORIGIN);
  if (url.origin !== API_ORIGIN || !url.pathname.startsWith('/v1/')) {
    throw new AppStoreConnectError('App Store Connect returned an unsafe pagination URL.');
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new AppStoreConnectError(`App Store Connect ${method} ${url.pathname} failed before a response.`);
  }
  if (!response?.ok) {
    throw new AppStoreConnectError(
      `App Store Connect ${method} ${url.pathname} failed with HTTP ${response?.status || 'unknown'}.`,
      response?.status
    );
  }
  try {
    const payload = await response.json();
    if (!payload || typeof payload !== 'object') throw new Error('invalid');
    return payload;
  } catch {
    throw new AppStoreConnectError(`App Store Connect ${method} ${url.pathname} returned malformed JSON.`);
  }
}

function createRequest({ fetchImpl = globalThis.fetch, token }) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  return (method, resourcePath, body) => requestJSON(fetchImpl, token, method, resourcePath, body);
}

async function listAll(request, resourcePath) {
  const resources = [];
  const seen = new Set();
  let next = resourcePath;
  while (next) {
    const url = new URL(next, API_ORIGIN);
    if (url.origin !== API_ORIGIN || !url.pathname.startsWith('/v1/') || seen.has(url.href)) {
      throw new AppStoreConnectError('App Store Connect returned an invalid pagination sequence.');
    }
    seen.add(url.href);
    const payload = await request('GET', `${url.pathname}${url.search}`);
    if (!Array.isArray(payload.data)) {
      throw new AppStoreConnectError('App Store Connect collection response is malformed.');
    }
    resources.push(...payload.data);
    next = payload.links?.next || null;
  }
  return resources;
}

function resourceData(payload, expectedType) {
  const resource = payload?.data;
  if (!resource || Array.isArray(resource) || resource.type !== expectedType || !resource.id) {
    throw new AppStoreConnectError(`App Store Connect ${expectedType} response is malformed.`);
  }
  return resource;
}

function validateBundle(resource) {
  if (
    resource?.type !== 'bundleIds' ||
    !resource.id ||
    resource.attributes?.identifier !== HELPER_BUNDLE_ID ||
    !MAC_COMPATIBLE_BUNDLE_PLATFORMS.has(resource.attributes?.platform)
  ) {
    throw new AppStoreConnectError('App Store Connect returned a wrong helper bundle identifier or platform.');
  }
  return resource;
}

async function findBundle(request) {
  const bundles = await listAll(
    request,
    queryPath('/v1/bundleIds', {
      'filter[identifier]': HELPER_BUNDLE_ID,
      'filter[platform]': PLATFORM,
      limit: '200',
    })
  );
  for (const bundle of bundles) validateBundle(bundle);
  if (bundles.length > 1) throw new AppStoreConnectError('Duplicate exact Mac Access helper bundle identifiers exist.');
  return bundles[0] || null;
}

async function ensureBundle(request) {
  const existing = await findBundle(request);
  if (existing) return existing;
  try {
    const payload = await request('POST', '/v1/bundleIds', {
      data: {
        type: 'bundleIds',
        attributes: { identifier: HELPER_BUNDLE_ID, name: BUNDLE_NAME, platform: PLATFORM },
      },
    });
    return validateBundle(resourceData(payload, 'bundleIds'));
  } catch (error) {
    if (error?.status !== 409) throw error;
    const raced = await findBundle(request);
    if (!raced)
      throw new AppStoreConnectError('Helper bundle registration conflicted but no exact bundle exists.', 409);
    return raced;
  }
}

function selectCertificate(resources, requestedSerial, now) {
  const serial = normalizeSerial(requestedSerial);
  const matching = [];
  for (const resource of resources) {
    if (
      resource?.type !== 'certificates' ||
      !resource.id ||
      resource.attributes?.certificateType !== CERTIFICATE_TYPE
    ) {
      throw new AppStoreConnectError('App Store Connect returned a wrong certificate type.');
    }
    if (normalizeSerial(resource.attributes?.serialNumber) === serial) matching.push(resource);
  }
  if (matching.length > 1)
    throw new AppStoreConnectError('Duplicate exact Developer ID Application certificates exist.');
  const certificate = matching[0];
  const expiration = certificate && new Date(certificate.attributes?.expirationDate);
  if (!certificate || !Number.isFinite(expiration?.getTime()) || expiration <= now) {
    throw new AppStoreConnectError('No active exact Developer ID Application certificate exists.');
  }
  return certificate;
}

async function findCertificate(request, requestedSerial, now) {
  const certificates = await listAll(
    request,
    queryPath('/v1/certificates', {
      'filter[certificateType]': CERTIFICATE_TYPE,
      limit: '200',
    })
  );
  return selectCertificate(certificates, requestedSerial, now);
}

function validateProfile(resource, bundleId) {
  const platform = resource?.attributes?.platform;
  if (
    resource?.type !== 'profiles' ||
    !resource.id ||
    resource.attributes?.profileType !== PROFILE_TYPE ||
    (platform !== undefined && platform !== PLATFORM) ||
    resource.relationships?.bundleId?.data?.type !== 'bundleIds' ||
    resource.relationships.bundleId.data.id !== bundleId ||
    !Array.isArray(resource.relationships?.certificates?.data) ||
    resource.relationships.certificates.data.some((item) => item?.type !== 'certificates' || !item.id)
  ) {
    throw new AppStoreConnectError(
      'App Store Connect returned a wrong helper profile type, platform, or relationship.'
    );
  }
  return resource;
}

function selectReusableProfile(resources, bundleId, certificateId, now) {
  const matching = [];
  for (const resource of resources) {
    if (
      resource?.type !== 'profiles' ||
      !resource.id ||
      resource.attributes?.profileType !== PROFILE_TYPE ||
      resource.relationships?.bundleId?.data?.type !== 'bundleIds' ||
      !resource.relationships.bundleId.data.id
    ) {
      throw new AppStoreConnectError('App Store Connect returned a malformed profile collection.');
    }
    if (resource.relationships.bundleId.data.id !== bundleId) continue;
    validateProfile(resource, bundleId);
    const expiration = new Date(resource.attributes?.expirationDate);
    const hasCertificate = resource.relationships.certificates.data.some((item) => item.id === certificateId);
    if (
      resource.attributes?.profileState === 'ACTIVE' &&
      Number.isFinite(expiration.getTime()) &&
      expiration > now &&
      hasCertificate
    ) {
      matching.push(resource);
    }
  }
  if (matching.length > 1) throw new AppStoreConnectError('Duplicate active exact helper provisioning profiles exist.');
  return matching[0] || null;
}

async function listProfiles(request) {
  return listAll(
    request,
    queryPath('/v1/profiles', {
      'filter[profileType]': PROFILE_TYPE,
      include: 'bundleId,certificates',
      limit: '200',
    })
  );
}

async function readProfile(request, profileId, bundleId, certificateId, now) {
  const resourcePath = queryPath(`/v1/profiles/${encodeURIComponent(profileId)}`, {
    include: 'bundleId,certificates',
  });
  const resource = validateProfile(resourceData(await request('GET', resourcePath), 'profiles'), bundleId);
  if (!resource.relationships.certificates.data.some((item) => item.id === certificateId)) {
    throw new AppStoreConnectError('Helper profile does not contain the exact certificate.');
  }
  const reusable = selectReusableProfile([resource], bundleId, certificateId, now);
  if (!reusable) throw new AppStoreConnectError('Helper profile is not active and unexpired.');
  return reusable;
}

async function ensureProfile(request, bundle, certificate, now, profileName = DEFAULT_PROFILE_NAME) {
  const existing = selectReusableProfile(await listProfiles(request), bundle.id, certificate.id, now);
  if (existing) {
    return typeof existing.attributes.profileContent === 'string'
      ? existing
      : readProfile(request, existing.id, bundle.id, certificate.id, now);
  }
  const body = {
    data: {
      type: 'profiles',
      attributes: { name: profileName, profileType: PROFILE_TYPE },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundle.id } },
        certificates: { data: [{ type: 'certificates', id: certificate.id }] },
      },
    },
  };
  try {
    const created = resourceData(await request('POST', '/v1/profiles', body), 'profiles');
    return readProfile(request, created.id, bundle.id, certificate.id, now);
  } catch (error) {
    if (error?.status !== 409) throw error;
    const raced = selectReusableProfile(await listProfiles(request), bundle.id, certificate.id, now);
    if (!raced)
      throw new AppStoreConnectError('Helper profile creation conflicted but no reusable exact profile exists.', 409);
    return typeof raced.attributes.profileContent === 'string'
      ? raced
      : readProfile(request, raced.id, bundle.id, certificate.id, now);
  }
}

function decodeProfileContent(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new AppStoreConnectError('App Store Connect profile content is malformed.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== value) {
    throw new AppStoreConnectError('App Store Connect profile content is malformed.');
  }
  return bytes;
}

function writeProfile(outputPath, content, fsImpl = fs) {
  fsImpl.writeFileSync(outputPath, content, { mode: 0o600 });
  fsImpl.chmodSync(outputPath, 0o600);
}

async function provisionProfile(options, dependencies = {}) {
  const now = dependencies.now ? new Date(dependencies.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Provisioning clock is invalid.');
  const request = dependencies.request;
  if (typeof request !== 'function') throw new Error('An App Store Connect request function is required.');
  const bundle = await ensureBundle(request);
  const certificate = await findCertificate(request, options.certificateSerial, now);
  const profile = await ensureProfile(request, bundle, certificate, now, options.profileName);
  const content = decodeProfileContent(profile.attributes?.profileContent);
  writeProfile(options.output, content, dependencies.fsImpl || fs);
  return { bundleId: bundle.id, certificateId: certificate.id, profileId: profile.id };
}

function parseOptions(arguments_) {
  const known = new Set(['key', 'key-id', 'issuer', 'certificate-serial', 'output', 'profile-name']);
  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!/^--[a-z][a-z-]*$/.test(flag || '') || !known.has(flag.slice(2)) || value === undefined) {
      throw new Error('Invalid helper provisioning profile argument.');
    }
    const key = flag.slice(2);
    if (Object.hasOwn(options, key) || value.length === 0)
      throw new Error('Duplicate or empty helper profile argument.');
    options[key] = value;
  }
  for (const required of ['key', 'key-id', 'issuer', 'certificate-serial', 'output']) {
    if (!options[required]) throw new Error(`Missing required --${required} argument.`);
  }
  return options;
}

function loadPrivateKey(keyInput) {
  if (keyInput.includes('-----BEGIN')) return keyInput;
  return fs.readFileSync(keyInput, 'utf8');
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const token = createJWT({
    issuer: options.issuer,
    keyId: options['key-id'],
    privateKey: loadPrivateKey(options.key),
  });
  const output = path.resolve(options.output);
  await provisionProfile(
    {
      certificateSerial: options['certificate-serial'],
      output,
      profileName: options['profile-name'] || DEFAULT_PROFILE_NAME,
    },
    { request: createRequest({ token }) }
  );
  console.log(`Ensured exact Mac Access helper provisioning profile: ${output}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Helper provisioning profile creation failed.');
    process.exitCode = 1;
  });
}

module.exports = {
  API_ORIGIN,
  AppStoreConnectError,
  CERTIFICATE_TYPE,
  DEFAULT_PROFILE_NAME,
  HELPER_BUNDLE_ID,
  PLATFORM,
  PROFILE_TYPE,
  createJWT,
  createRequest,
  decodeProfileContent,
  ensureBundle,
  ensureProfile,
  findBundle,
  findCertificate,
  listAll,
  normalizeSerial,
  parseOptions,
  provisionProfile,
  readProfile,
  requestJSON,
  selectCertificate,
  selectReusableProfile,
  validateBundle,
  validateProfile,
  writeProfile,
};
