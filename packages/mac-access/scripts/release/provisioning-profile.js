#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HELPER_BUNDLE_ID = 'com.evaos.mac-access.helper';
const HELPER_PROFILE_RELATIVE_PATH =
  'Contents/XPCServices/evaOS Mac Access Helper.xpc/Contents/embedded.provisionprofile';
const TEAM_ID = 'TC6MS3T6NN';
const CREDENTIAL_ACCESS_GROUP = 'TC6MS3T6NN.com.evaos.mac-access.credentials.epoch-1';

function defaultRunner(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });
}

function run(command, args, runner = defaultRunner, options = {}) {
  const result = runner(command, args, options);
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : result.stdout || '';
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr || '';
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args[0] || ''} failed: ${(stderr || stdout).trim()}`);
  }
  return stdout;
}

function decodeProfile(profilePath, runner = defaultRunner) {
  const xml = run('/usr/bin/security', ['cms', '-D', '-i', profilePath], runner);
  const extract = (keyPath, format = 'raw') =>
    run('/usr/bin/plutil', ['-extract', keyPath, format, '-o', '-', '--', '-'], runner, { input: xml }).trim();
  const certificateCount = Number(extract('DeveloperCertificates'));
  if (!Number.isSafeInteger(certificateCount) || certificateCount < 1) {
    throw new Error('Mac Access helper provisioning profile has no Developer ID certificate.');
  }
  const teamIdentifierCount = Number(extract('TeamIdentifier'));
  if (!Number.isSafeInteger(teamIdentifierCount) || teamIdentifierCount < 1) {
    throw new Error('Mac Access helper provisioning profile has no Team identifier.');
  }
  return {
    Name: extract('Name'),
    UUID: extract('UUID'),
    CreationDate: extract('CreationDate'),
    ExpirationDate: extract('ExpirationDate'),
    TeamIdentifier: Array.from({ length: teamIdentifierCount }, (_, index) => extract(`TeamIdentifier.${index}`)),
    DeveloperCertificates: Array.from({ length: certificateCount }, (_, index) =>
      extract(`DeveloperCertificates.${index}`)
    ),
    Entitlements: JSON.parse(extract('Entitlements', 'json')),
  };
}

function normalizedSHA1(value) {
  const normalized = String(value || '')
    .replace(/[^A-Fa-f0-9]/g, '')
    .toUpperCase();
  return /^[A-F0-9]{40}$/.test(normalized) ? normalized : null;
}

function groupAuthorizes(profileGroup, requestedGroup) {
  if (profileGroup === requestedGroup) return true;
  return profileGroup.endsWith('*') && requestedGroup.startsWith(profileGroup.slice(0, -1));
}

function inspectHelperProvisioningProfile(profilePath, options = {}) {
  const absolutePath = path.resolve(profilePath);
  const metadata = fs.lstatSync(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Mac Access helper provisioning profile must be a regular file.');
  }

  const runner = options.runner || defaultRunner;
  const now = options.now ? new Date(options.now) : new Date();
  const profile = decodeProfile(absolutePath, runner);
  const entitlements = profile.Entitlements || {};
  const teamIdentifiers = Array.isArray(profile.TeamIdentifier) ? profile.TeamIdentifier : [];
  const developerTeamIdentifier = entitlements['com.apple.developer.team-identifier'];
  const applicationIdentifier = entitlements['com.apple.application-identifier'];
  const profileGroups = Array.isArray(entitlements['keychain-access-groups'])
    ? entitlements['keychain-access-groups']
    : [];
  const expiration = new Date(profile.ExpirationDate);
  const expectedApplicationIdentifier = `${TEAM_ID}.${HELPER_BUNDLE_ID}`;
  if (
    !teamIdentifiers.includes(TEAM_ID) ||
    developerTeamIdentifier !== TEAM_ID ||
    applicationIdentifier !== expectedApplicationIdentifier
  ) {
    throw new Error('Mac Access helper provisioning profile team or application identifier drifted.');
  }
  if (!profileGroups.some((group) => groupAuthorizes(group, CREDENTIAL_ACCESS_GROUP))) {
    throw new Error('Mac Access helper provisioning profile does not authorize the frozen credential group.');
  }
  if (!Number.isFinite(expiration.getTime()) || expiration <= now) {
    throw new Error('Mac Access helper provisioning profile is expired or has an invalid expiration date.');
  }

  const certificateSHA1s = (Array.isArray(profile.DeveloperCertificates) ? profile.DeveloperCertificates : [])
    .map((value) => {
      try {
        return crypto.createHash('sha1').update(Buffer.from(value, 'base64')).digest('hex').toUpperCase();
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (certificateSHA1s.length === 0) {
    throw new Error('Mac Access helper provisioning profile has no Developer ID certificate.');
  }
  const expectedCertificateSHA1 = options.expectedCertificateSHA1
    ? normalizedSHA1(options.expectedCertificateSHA1)
    : null;
  if (options.expectedCertificateSHA1 && !expectedCertificateSHA1) {
    throw new Error('Expected Developer ID certificate fingerprint must be a SHA-1 digest.');
  }
  if (expectedCertificateSHA1 && !certificateSHA1s.includes(expectedCertificateSHA1)) {
    throw new Error('Mac Access helper provisioning profile does not contain the selected Developer ID certificate.');
  }

  return {
    uuid: profile.UUID,
    name: profile.Name,
    teamID: TEAM_ID,
    applicationIdentifier,
    authorizedKeychainAccessGroups: profileGroups,
    developerCertificateSHA1s: certificateSHA1s,
    creationDate: profile.CreationDate || null,
    expirationDate: expiration.toISOString(),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex'),
  };
}

function embedHelperProvisioningProfile(appPath, sourcePath, options = {}) {
  const expectedCertificateSHA1 = normalizedSHA1(options.expectedCertificateSHA1);
  if (!expectedCertificateSHA1) {
    throw new Error('Embedding the helper profile requires the selected Developer ID certificate SHA-1.');
  }
  inspectHelperProvisioningProfile(sourcePath, {
    expectedCertificateSHA1,
    now: options.now,
    runner: options.runner,
  });
  const destination = path.join(path.resolve(appPath), HELPER_PROFILE_RELATIVE_PATH);
  fs.copyFileSync(path.resolve(sourcePath), destination);
  fs.chmodSync(destination, 0o644);
  return inspectHelperProvisioningProfile(destination, {
    expectedCertificateSHA1,
    now: options.now,
    runner: options.runner,
  });
}

module.exports = {
  CREDENTIAL_ACCESS_GROUP,
  HELPER_BUNDLE_ID,
  HELPER_PROFILE_RELATIVE_PATH,
  TEAM_ID,
  decodeProfile,
  embedHelperProvisioningProfile,
  groupAuthorizes,
  inspectHelperProvisioningProfile,
  normalizedSHA1,
};
