const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CORE_RELATIVE_PATH,
  EXPECTED_COMPATIBILITY,
  MANIFEST_SCHEMA,
  ROLE_CONTRACTS,
  TEAM_ID,
  canonicalJSON,
  createManifest,
  createSBOM,
  defaultRunner,
  normalizeRequirement,
  verifyManifest,
} = require('../scripts/release/manifest');
const { recordReleaseBundle, signArguments, signReleaseBundle } = require('../scripts/release/sign-bundle');

const SOURCE_SHA = '1234567890abcdef1234567890abcdef12345678';
const CORE_SHA = '1'.repeat(64);
const SOURCE_MANIFEST_SHA = '2'.repeat(64);
const RUNTIME_SOURCE_SHA = '3'.repeat(64);
const SPARKLE_PUBLIC_KEY = Buffer.alloc(32, 7).toString('base64');
const ROLLBACK_PUBLIC_KEY = Buffer.alloc(32, 9).toString('base64url');
const CORE_IDENTITY = Object.freeze({ coreSourceSha256: CORE_SHA, sourceManifestSha256: SOURCE_MANIFEST_SHA });

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeJSON(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeMachO(filePath, label) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([Buffer.from('feedfacf', 'hex'), Buffer.from(label)]));
  fs.chmodSync(filePath, 0o755);
}

function helperEntitlementsXML(group = EXPECTED_COMPATIBILITY.credentialAccessGroup) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>keychain-access-groups</key><array><string>${group}</string></array></dict></plist>`;
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-access-release-manifest-'));
  const app = path.join(root, 'evaOS Mac Access.app');
  for (const [role, contract] of Object.entries(ROLE_CONTRACTS)) {
    const bundle = contract.bundlePath === '.' ? app : path.join(app, contract.bundlePath);
    const plist = {
      CFBundleIdentifier: contract.bundleID,
      CFBundleExecutable: path.basename(contract.executablePath),
      CFBundleShortVersionString: '0.1.0',
      CFBundleVersion: '1',
    };
    if (role === 'app') {
      Object.assign(plist, {
        SUFeedURL: 'https://updates.evaos.com/mac-access/appcast.xml',
        SUPublicEDKey: SPARKLE_PUBLIC_KEY,
        MacAccessAppRequirementSHA256: ROLE_CONTRACTS.app.designatedRequirementSHA256,
        MacAccessHelperRequirementSHA256: ROLE_CONTRACTS.helper.designatedRequirementSHA256,
        MacAccessConnectorRequirementSHA256: ROLE_CONTRACTS.connector.designatedRequirementSHA256,
        MacAccessHelperEntitlementsSHA256: sha256(canonicalJSON(ROLE_CONTRACTS.helper.expectedEntitlements)),
        MacAccessHelperRelationSHA256: sha256(canonicalJSON(ROLE_CONTRACTS.helper.relationship)),
        MacAccessSourceCommit: SOURCE_SHA,
        MacAccessSecurityEpoch: String(EXPECTED_COMPATIBILITY.securityEpoch),
        MacAccessCredentialSecurityEpoch: String(EXPECTED_COMPATIBILITY.credentialEpoch),
        MacAccessSchemaReaderVersion: String(EXPECTED_COMPATIBILITY.schemaReaderVersion),
        MacAccessSchemaWriterVersion: String(EXPECTED_COMPATIBILITY.schemaWriterVersion),
        MacAccessRollbackKeyID: 'broker-rollback-v1',
        MacAccessRollbackPublicKeyBase64URL: ROLLBACK_PUBLIC_KEY,
      });
    }
    writeJSON(path.join(bundle, 'Contents', 'Info.plist'), plist);
    writeMachO(path.join(app, contract.executablePath), role);
  }

  const core = path.join(app, CORE_RELATIVE_PATH);
  const inventory = { schema: 'evaos-python-runtime-inventory/v1', entries: [] };
  const inventoryBytes = Buffer.from(`${JSON.stringify(inventory, null, 2)}\n`);
  fs.mkdirSync(core, { recursive: true });
  fs.writeFileSync(path.join(core, 'python-runtime-inventory.json'), inventoryBytes);
  const licenseBytes = Buffer.from('CPython license fixture\n');
  writeJSON(path.join(core, 'SOURCE.json'), {
    schema: 'evaos-mac-access-private-runtime/v1',
    owner: '100yenadmin/evaOS-GUI',
    product: 'evaOS Mac Access',
    repositoryCommit: SOURCE_SHA,
    connectorCore: {
      sourcePath: 'packages/mac-connector-core',
      coreSourceSha256: CORE_SHA,
      sourceManifestSha256: SOURCE_MANIFEST_SHA,
    },
    runtime: {
      version: '3.12.13',
      sourceSha256: RUNTIME_SOURCE_SHA,
      sourceUrl: 'https://example.invalid/cpython.tar.gz',
      architecture: 'arm64',
      packages: [{ name: 'pyobjc-core', version: '12.2.1', sha256: '4'.repeat(64) }],
      license: 'Python-2.0',
      licensePath: 'licenses/CPython-LICENSE.txt',
      licenseSha256: sha256(licenseBytes),
      inventoryPath: 'python-runtime-inventory.json',
      inventorySha256: sha256(inventoryBytes),
    },
  });
  const python = path.join(core, 'python', 'bin', 'python3.12');
  writeMachO(python, 'python');
  fs.symlinkSync('python3.12', path.join(core, 'python', 'bin', 'python3'));
  const metadata = `Metadata-Version: 2.4\nName: pyobjc-core\nVersion: 12.2.1\nLicense: MIT\n`;
  const metadataPath = path.join(
    core,
    'python',
    'lib',
    'python3.12',
    'site-packages',
    'pyobjc_core-12.2.1.dist-info',
    'METADATA'
  );
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, metadata);
  const licensePath = path.join(core, 'licenses', 'CPython-LICENSE.txt');
  fs.mkdirSync(path.dirname(licensePath), { recursive: true });
  fs.writeFileSync(licensePath, licenseBytes);
  const fixturePath = path.join(app, 'Contents', 'Resources', 'fixture.txt');
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, 'signed artifact fixture\n');
  return { app, root };
}

function roleForTarget(target, app) {
  if (target === app) return 'app';
  if (target.endsWith(ROLE_CONTRACTS.helper.bundlePath)) return 'helper';
  if (target.endsWith(ROLE_CONTRACTS.connector.bundlePath)) return 'connector';
  return 'leaf';
}

function fakeRunner(app, state = {}) {
  return (command, args, options = {}) => {
    const tool = path.basename(command);
    if (tool === 'plutil') return defaultRunner(command, args, options);
    if (tool === 'lipo') return { status: 0, stdout: `${state.architecture || 'arm64'}\n`, stderr: '' };
    if (tool !== 'codesign') throw new Error(`Unexpected test command: ${command}`);
    state.calls?.push({ command, args: [...args] });
    if (args[0] === '--force') return { status: 0, stdout: '', stderr: '' };
    if (args[0] === '--verify') return { status: 0, stdout: '', stderr: '' };

    const target = args.at(-1);
    const role = roleForTarget(target, app);
    const contract = ROLE_CONTRACTS[role];
    if (args.includes('-r-')) {
      const requirement =
        state.requirementRole === role ? `${contract.designatedRequirement} and true` : contract.designatedRequirement;
      return { status: 0, stdout: '', stderr: `${target}: designated => ${requirement}\n` };
    }
    if (args.includes('--entitlements')) {
      const entitlements =
        role === 'helper'
          ? helperEntitlementsXML(
              state.entitlementsRole === role ? 'TC6MS3T6NN.com.evaos.mac-access.credentials.epoch-2' : undefined
            )
          : '';
      return { status: 0, stdout: '', stderr: entitlements };
    }

    const identifier = contract?.bundleID || 'org.python.python3.12';
    const team = state.teamRole === role ? 'WRONGTEAM1' : TEAM_ID;
    const flags = state.adHocRole === role ? 'flags=0x2(adhoc)' : 'flags=0x10000(runtime)';
    return {
      status: 0,
      stdout: '',
      stderr: [
        `Executable=${target}`,
        `Identifier=${identifier}`,
        `CodeDirectory v=20500 size=100 ${flags} hashes=1+0 location=embedded`,
        'Authority=Developer ID Application: Andrew Ryan (TC6MS3T6NN)',
        'Authority=Developer ID Certification Authority',
        `TeamIdentifier=${team}`,
        'Runtime Version=15.0.0',
        'Timestamp=Jul 16, 2026 at 9:00:00 PM',
        '',
      ].join('\n'),
    };
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('creates an exact identity-continuity manifest and SPDX dependency inventory', (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const runner = fakeRunner(fixture.app);
  const manifest = createManifest(fixture.app, {
    coreIdentity: CORE_IDENTITY,
    runner,
    sourceSHA: SOURCE_SHA,
    createdAt: '2026-07-16T14:00:00Z',
  });
  const sbom = createSBOM(fixture.app, manifest);

  assert.equal(manifest.schema, MANIFEST_SCHEMA);
  assert.equal(manifest.source.commit, SOURCE_SHA);
  assert.equal(manifest.connectorCore.coreSourceSha256, CORE_SHA);
  assert.equal(manifest.updatePolicy.sourceCommit, SOURCE_SHA);
  assert.equal(manifest.updatePolicy.channel, 'mac-access');
  assert.equal(manifest.updatePolicy.rollbackKeyID, 'broker-rollback-v1');
  assert.equal(manifest.signing.roles.helper.executableOwner, 'helper');
  assert.deepEqual(manifest.signing.roles.helper.relationship, {
    kind: 'xpc-service',
    parentBundleID: 'com.evaos.mac-access',
  });
  assert.deepEqual(manifest.signing.roles.helper.entitlements, {
    'keychain-access-groups': [EXPECTED_COMPATIBILITY.credentialAccessGroup],
  });
  assert.deepEqual(manifest.artifact.architectures, ['arm64']);
  assert.equal(manifest.signing.machOClosure.length, 4);
  assert.equal(sbom.spdxVersion, 'SPDX-2.3');
  assert.ok(sbom.packages.some((entry) => entry.name === 'CPython' && entry.licenseDeclared === 'Python-2.0'));
  assert.ok(sbom.packages.some((entry) => entry.name === 'pyobjc-core' && entry.licenseDeclared === 'MIT'));
  assert.doesNotThrow(() => verifyManifest(fixture.app, manifest, sbom, { runner, coreIdentity: CORE_IDENTITY }));
});

test('records the exact post-staple bundle without signing it again', (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const runner = fakeRunner(fixture.app);
  const before = createManifest(fixture.app, {
    coreIdentity: CORE_IDENTITY,
    runner,
    sourceSHA: SOURCE_SHA,
    createdAt: '2026-07-16T14:00:00Z',
  });
  fs.writeFileSync(path.join(fixture.app, 'Contents', 'CodeResources'), 'stapled ticket fixture\n');
  const manifestPath = path.join(fixture.root, 'mac-access-artifact.json');
  const sbomPath = path.join(fixture.root, 'mac-access-sbom.spdx.json');

  const recorded = recordReleaseBundle(fixture.app, {
    coreIdentity: CORE_IDENTITY,
    createdAt: '2026-07-16T14:00:00Z',
    manifest: manifestPath,
    runner,
    sbom: sbomPath,
    sourceSHA: SOURCE_SHA,
  });

  assert.notEqual(recorded.manifest.artifact.bundleTree.sha256, before.artifact.bundleTree.sha256);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), recorded.manifest);
  assert.deepEqual(JSON.parse(fs.readFileSync(sbomPath, 'utf8')), recorded.sbom);
  assert.doesNotThrow(() =>
    verifyManifest(fixture.app, recorded.manifest, recorded.sbom, {
      coreIdentity: CORE_IDENTITY,
      runner,
    })
  );
});

test('rejects every frozen artifact continuity field when the evidence drifts', (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const runner = fakeRunner(fixture.app);
  const manifest = createManifest(fixture.app, {
    coreIdentity: CORE_IDENTITY,
    runner,
    sourceSHA: SOURCE_SHA,
    createdAt: '2026-07-16T14:00:00Z',
  });
  const sbom = createSBOM(fixture.app, manifest);
  const mutations = [
    (value) => (value.signing.roles.app.signature.teamID = 'WRONGTEAM1'),
    (value) => (value.signing.roles.connector.designatedRequirement += ' and true'),
    (value) => (value.signing.roles.helper.executableOwner = 'app'),
    (value) => (value.signing.roles.helper.relationship.kind = 'login-item'),
    (value) => value.signing.roles.helper.entitlements['keychain-access-groups'].push('unexpected'),
    (value) => (value.compatibility.securityEpoch = 2),
    (value) => (value.updatePolicy.rollbackPublicKeySHA256 = 'd'.repeat(64)),
    (value) => (value.connectorCore.coreSourceSha256 = 'f'.repeat(64)),
    (value) => (value.artifact.bundleTree.sha256 = 'e'.repeat(64)),
  ];
  for (const mutate of mutations) {
    const changed = clone(manifest);
    mutate(changed);
    assert.throws(
      () => verifyManifest(fixture.app, changed, sbom, { runner, coreIdentity: CORE_IDENTITY }),
      /manifest drifted|source SHA|schema drifted/
    );
  }
});

test('rejects missing or mismatched signed update identity inputs', (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const plistPath = path.join(fixture.app, 'Contents', 'Info.plist');
  const original = JSON.parse(fs.readFileSync(plistPath, 'utf8'));
  for (const [key, value] of [
    ['MacAccessSourceCommit', 'f'.repeat(40)],
    ['MacAccessSecurityEpoch', '2'],
    ['MacAccessRollbackPublicKeyBase64URL', 'invalid'],
    ['MacAccessRollbackKeyID', ' broker-rollback-v1'],
    ['SUFeedURL', 'https://updates.evaos.com/workbench/appcast.xml'],
  ]) {
    writeJSON(plistPath, { ...original, [key]: value });
    assert.throws(
      () =>
        createManifest(fixture.app, {
          coreIdentity: CORE_IDENTITY,
          runner: fakeRunner(fixture.app),
          sourceSHA: SOURCE_SHA,
          createdAt: '2026-07-16T14:00:00Z',
        }),
      /update identity/
    );
  }
});

test('rejects live Team ID, requirement, entitlement, ad-hoc, and checksum drift', (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  for (const state of [
    { teamRole: 'app' },
    { requirementRole: 'connector' },
    { entitlementsRole: 'helper' },
    { adHocRole: 'helper' },
  ]) {
    assert.throws(
      () =>
        createManifest(fixture.app, {
          coreIdentity: CORE_IDENTITY,
          runner: fakeRunner(fixture.app, state),
          sourceSHA: SOURCE_SHA,
          createdAt: '2026-07-16T14:00:00Z',
        }),
      /signing identity|requirement|hardened runtime|entitlements/
    );
  }

  const runner = fakeRunner(fixture.app);
  const manifest = createManifest(fixture.app, {
    coreIdentity: CORE_IDENTITY,
    runner,
    sourceSHA: SOURCE_SHA,
    createdAt: '2026-07-16T14:00:00Z',
  });
  const sbom = createSBOM(fixture.app, manifest);
  fs.appendFileSync(path.join(fixture.app, 'Contents', 'Resources', 'fixture.txt'), 'tamper\n');
  assert.throws(
    () => verifyManifest(fixture.app, manifest, sbom, { runner, coreIdentity: CORE_IDENTITY }),
    /manifest drifted/
  );
});

test('signs the complete Mach-O closure inside-out with helper-only entitlements', (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const state = { calls: [] };
  const identity = 'Developer ID Application: Andrew Ryan (TC6MS3T6NN)';
  const result = signReleaseBundle(fixture.app, {
    identity,
    keychain: '/tmp/release.keychain-db',
    runner: fakeRunner(fixture.app, state),
  });
  const signingCalls = state.calls.filter((entry) => entry.args[0] === '--force');

  assert.equal(result.leafPaths.length, 1);
  assert.equal(signingCalls.length, 4);
  assert.ok(signingCalls.every((entry) => entry.args.includes('--timestamp')));
  assert.ok(signingCalls.every((entry) => entry.args.includes('runtime')));
  assert.ok(signingCalls.every((entry) => entry.args.includes('/tmp/release.keychain-db')));
  assert.ok(signingCalls[0].args.at(-1).endsWith('python3.12'));
  assert.ok(signingCalls[1].args.at(-1).endsWith(ROLE_CONTRACTS.connector.bundlePath));
  assert.ok(signingCalls[2].args.at(-1).endsWith(ROLE_CONTRACTS.helper.bundlePath));
  assert.equal(signingCalls[3].args.at(-1), fixture.app);
  assert.equal(signingCalls.filter((entry) => entry.args.includes('--entitlements')).length, 1);
  assert.ok(signingCalls[2].args.some((entry) => entry.endsWith('Helper-Release.entitlements')));
  assert.ok(signingCalls.slice(1).every((entry) => entry.args.includes('--requirements')));
});

test('refuses ad-hoc signing identities before invoking codesign', () => {
  assert.throws(() => signArguments('/tmp/app', '-', {}), /Developer ID Application identity/);
  assert.throws(() => signArguments('/tmp/app', 'adhoc', {}), /Developer ID Application identity/);
  assert.throws(() => signArguments('/tmp/app', 'Apple Development: Example', {}), /Developer ID Application identity/);
});

test('canonicalizes codesign requirement display without weakening the frozen expression', () => {
  const displayed =
    'designated => anchor apple generic and certificate leaf[subject.OU] = TC6MS3T6NN and identifier "com.evaos.mac-access"';
  assert.equal(normalizeRequirement(displayed), ROLE_CONTRACTS.app.designatedRequirement);
});
