const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ARTIFACT_MANIFEST_SCHEMA,
  EVAOS_NAMESPACE,
  injectMetadata,
  metadataFor,
  sha256,
} = require('../scripts/release/appcast');

const SOURCE_SHA = 'a'.repeat(40);
const HASH = 'b'.repeat(64);

function manifest() {
  return {
    schema: ARTIFACT_MANIFEST_SCHEMA,
    source: { commit: SOURCE_SHA },
    version: { short: '0.1.0', build: '2' },
    signing: {
      approvedTeamID: 'TC6MS3T6NN',
      roles: {
        helper: {
          bundleID: 'com.evaos.mac-access.helper',
          executableOwner: 'helper',
        },
      },
    },
    connectorCore: { sourcePath: 'packages/mac-connector-core', coreSourceSha256: HASH },
    updatePolicy: {
      channel: 'mac-access',
      feedURL: 'https://updates.evaos.com/mac-access/appcast.xml',
      sourceCommit: SOURCE_SHA,
      appRequirementSHA256: HASH,
      helperRequirementSHA256: HASH,
      connectorRequirementSHA256: HASH,
      helperEntitlementsSHA256: HASH,
      helperRelationSHA256: HASH,
      securityEpoch: 1,
      credentialSecurityEpoch: 1,
      schemaReaderVersion: 1,
      schemaWriterVersion: 1,
    },
  };
}

test('binds one private appcast item to the exact signed archive and artifact identity', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-access-appcast-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = path.join(root, 'evaOS-Mac-Access.zip');
  fs.writeFileSync(archive, 'signed candidate bytes');
  const metadata = metadataFor(manifest(), archive, SOURCE_SHA);
  const appcast = injectMetadata(
    '<?xml version="1.0"?><rss version="2.0"><channel><item><title>0.1.0</title></item></channel></rss>',
    metadata
  );

  assert.ok(appcast.includes(`xmlns:evaos="${EVAOS_NAMESPACE}"`));
  assert.ok(appcast.includes(`<evaos:artifact_sha256>${sha256(fs.readFileSync(archive))}</evaos:artifact_sha256>`));
  assert.ok(
    appcast.includes(`<evaos:artifact_manifest_schema>${ARTIFACT_MANIFEST_SCHEMA}</evaos:artifact_manifest_schema>`)
  );
  assert.ok(appcast.includes('<evaos:source_commit>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</evaos:source_commit>'));
  assert.equal((appcast.match(/<evaos:/g) || []).length, 20);
});

test('rejects source, product, channel, digest, and appcast cardinality drift', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-access-appcast-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = path.join(root, 'candidate.zip');
  fs.writeFileSync(archive, 'candidate');
  const mutations = [
    (value) => (value.schema = 'wrong'),
    (value) => (value.source.commit = 'c'.repeat(40)),
    (value) => (value.signing.approvedTeamID = 'WRONGTEAM1'),
    (value) => (value.updatePolicy.feedURL = 'https://updates.evaos.com/workbench/appcast.xml'),
    (value) => (value.updatePolicy.helperRelationSHA256 = 'invalid'),
  ];
  for (const mutate of mutations) {
    const changed = manifest();
    mutate(changed);
    assert.throws(() => metadataFor(changed, archive, SOURCE_SHA), /appcast metadata/);
  }
  const metadata = metadataFor(manifest(), archive, SOURCE_SHA);
  assert.throws(() => injectMetadata('<rss><channel></channel></rss>', metadata), /exactly one/);
  assert.throws(
    () => injectMetadata('<rss><channel><item></item><item></item></channel></rss>', metadata),
    /exactly one/
  );
  assert.throws(
    () => injectMetadata('<rss xmlns:evaos="existing"><channel><item></item></channel></rss>', metadata),
    /already contains/
  );
});
