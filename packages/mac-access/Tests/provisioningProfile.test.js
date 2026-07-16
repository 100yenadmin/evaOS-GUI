const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CREDENTIAL_ACCESS_GROUP,
  TEAM_ID,
  embedHelperProvisioningProfile,
  inspectHelperProvisioningProfile,
} = require('../scripts/release/provisioning-profile');

const CERTIFICATE = Buffer.from('developer-id-certificate-fixture');
const CERTIFICATE_SHA1 = crypto.createHash('sha1').update(CERTIFICATE).digest('hex').toUpperCase();

function profileXML(overrides = {}) {
  const certificate = (overrides.certificate || CERTIFICATE).toString('base64');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Name</key><string>evaOS Mac Access Helper Developer ID</string>
<key>UUID</key><string>00000000-0000-0000-0000-000000000705</string>
<key>CreationDate</key><date>2026-07-16T00:00:00Z</date>
<key>ExpirationDate</key><date>${overrides.expirationDate || '2027-07-16T00:00:00Z'}</date>
<key>TeamIdentifier</key><array><string>${overrides.teamID || TEAM_ID}</string></array>
<key>DeveloperCertificates</key><array><data>${certificate}</data></array>
<key>Entitlements</key><dict>
<key>com.apple.application-identifier</key><string>${overrides.applicationIdentifier || `${TEAM_ID}.com.evaos.mac-access.helper`}</string>
<key>com.apple.developer.team-identifier</key><string>${overrides.developerTeamID || TEAM_ID}</string>
<key>keychain-access-groups</key><array><string>${overrides.keychainGroup || `${TEAM_ID}.*`}</string></array>
</dict></dict></plist>`;
}

function runnerFor(overrides = {}) {
  return (command, args, options = {}) => {
    if (path.basename(command) === 'security') {
      return { status: 0, stdout: profileXML(overrides), stderr: '' };
    }
    if (path.basename(command) === 'plutil' && args[0] === '-extract' && args[2] === 'json') {
      return {
        status: 1,
        stdout: '',
        stderr: '<stdin>: invalid object in plist for destination format',
      };
    }
    return require('node:child_process').spawnSync(command, args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    });
  };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-access-helper-profile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'helper.provisionprofile');
  const app = path.join(root, 'evaOS Mac Access.app');
  fs.mkdirSync(path.join(app, 'Contents', 'XPCServices', 'evaOS Mac Access Helper.xpc', 'Contents'), {
    recursive: true,
  });
  fs.writeFileSync(source, 'cms profile fixture\n');
  return { app, source };
}

test('embeds a profile that authorizes the exact helper and frozen credential group', (t) => {
  const value = fixture(t);
  const result = embedHelperProvisioningProfile(value.app, value.source, {
    expectedCertificateSHA1: CERTIFICATE_SHA1,
    now: '2026-07-17T00:00:00Z',
    runner: runnerFor(),
  });
  assert.equal(result.applicationIdentifier, `${TEAM_ID}.com.evaos.mac-access.helper`);
  assert.equal(result.developerCertificateSHA1s[0], CERTIFICATE_SHA1);
  assert.ok(
    fs.existsSync(
      path.join(
        value.app,
        'Contents',
        'XPCServices',
        'evaOS Mac Access Helper.xpc',
        'Contents',
        'embedded.provisionprofile'
      )
    )
  );
});

test('fails closed on expired, wrong-team, wrong-helper, unauthorized-group, and certificate drift', (t) => {
  const value = fixture(t);
  for (const overrides of [
    { expirationDate: '2026-07-16T00:00:00Z' },
    { teamID: 'WRONGTEAM1' },
    { applicationIdentifier: `${TEAM_ID}.com.evaos.mac-access` },
    { keychainGroup: `${TEAM_ID}.com.evaos.unrelated.*` },
    { certificate: Buffer.from('other-certificate') },
  ]) {
    assert.throws(
      () =>
        inspectHelperProvisioningProfile(value.source, {
          expectedCertificateSHA1: CERTIFICATE_SHA1,
          now: '2026-07-17T00:00:00Z',
          runner: runnerFor(overrides),
        }),
      /profile|certificate/
    );
  }
  assert.equal(CREDENTIAL_ACCESS_GROUP, 'TC6MS3T6NN.com.evaos.mac-access.credentials.epoch-1');
});
