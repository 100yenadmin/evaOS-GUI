#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EVAOS_NAMESPACE = 'https://evaos.com/xml-namespaces/mac-access/v1';
const ARTIFACT_MANIFEST_SCHEMA = 'evaos.mac_access.artifact_manifest.v1';
const CORE_MANIFEST_SCHEMA = 'evaos-mac-connector-core-source/v1';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function metadataFor(manifest, archivePath, sourceSHA) {
  const update = manifest?.updatePolicy;
  const helper = manifest?.signing?.roles?.helper;
  if (
    manifest?.schema !== ARTIFACT_MANIFEST_SCHEMA ||
    manifest?.source?.commit !== sourceSHA ||
    !/^[a-f0-9]{40}$/.test(sourceSHA) ||
    update?.sourceCommit !== sourceSHA ||
    update?.channel !== 'mac-access' ||
    update?.feedURL?.toLowerCase().includes('workbench') ||
    !update?.feedURL?.startsWith('https://') ||
    manifest?.signing?.approvedTeamID !== 'TC6MS3T6NN' ||
    helper?.bundleID !== 'com.evaos.mac-access.helper' ||
    helper?.executableOwner !== 'helper' ||
    manifest?.connectorCore?.sourcePath !== 'packages/mac-connector-core'
  ) {
    throw new Error('Mac Access appcast metadata does not match the exact signed artifact manifest.');
  }
  const archive = fs.readFileSync(archivePath);
  const values = {
    product_id: 'com.evaos.mac-access',
    signed_lineage_id: 'mac-access-production',
    team_id: manifest.signing.approvedTeamID,
    app_requirement_sha256: update.appRequirementSHA256,
    helper_requirement_sha256: update.helperRequirementSHA256,
    connector_requirement_sha256: update.connectorRequirementSHA256,
    helper_entitlements_sha256: update.helperEntitlementsSHA256,
    helper_relation_sha256: update.helperRelationSHA256,
    tcc_executable_owner: helper.bundleID,
    artifact_manifest_schema: manifest.schema,
    core_manifest_schema: CORE_MANIFEST_SCHEMA,
    artifact_sha256: sha256(archive),
    core_source_sha256: manifest.connectorCore.coreSourceSha256,
    security_epoch: update.securityEpoch,
    credential_security_epoch: update.credentialSecurityEpoch,
    schema_reader_version: update.schemaReaderVersion,
    schema_writer_version: update.schemaWriterVersion,
    bundle_version: manifest.version.build,
    build_version: manifest.version.short,
    source_commit: sourceSHA,
  };
  const invalid = Object.entries(values).find(([, value]) => value === undefined || value === null || value === '');
  if (invalid) throw new Error(`Mac Access appcast metadata is missing ${invalid[0]}.`);
  for (const key of [
    'app_requirement_sha256',
    'helper_requirement_sha256',
    'connector_requirement_sha256',
    'helper_entitlements_sha256',
    'helper_relation_sha256',
    'artifact_sha256',
    'core_source_sha256',
  ]) {
    if (!/^[a-f0-9]{64}$/.test(String(values[key]))) {
      throw new Error(`Mac Access appcast metadata has an invalid ${key}.`);
    }
  }
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
}

function injectMetadata(appcastXML, metadata) {
  if ((appcastXML.match(/<item(?:\s|>)/g) || []).length !== 1 || (appcastXML.match(/<\/item>/g) || []).length !== 1) {
    throw new Error('Mac Access private appcast must contain exactly one update item.');
  }
  if (appcastXML.includes('xmlns:evaos=') || /<evaos:[A-Za-z_]/.test(appcastXML)) {
    throw new Error('Mac Access private appcast already contains evaOS metadata.');
  }
  const namespaced = appcastXML.replace(/<rss\b/, `<rss xmlns:evaos="${EVAOS_NAMESPACE}"`);
  if (namespaced === appcastXML) throw new Error('Mac Access private appcast is missing the RSS root.');
  const elements = Object.entries(metadata)
    .map(([key, value]) => `      <evaos:${key}>${xmlEscape(value)}</evaos:${key}>`)
    .join('\n');
  return namespaced.replace('</item>', `${elements}\n    </item>`);
}

function injectFile(options) {
  const manifest = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
  const metadata = metadataFor(manifest, options.archive, options.sourceSHA);
  const appcastXML = fs.readFileSync(options.appcast, 'utf8');
  const updated = injectMetadata(appcastXML, metadata);
  fs.writeFileSync(options.appcast, updated);
  return metadata;
}

function parseOptions(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument: ${key || '<missing>'}`);
    options[key.slice(2)] = value;
  }
  return options;
}

function main() {
  const [operation, ...arguments_] = process.argv.slice(2);
  const options = parseOptions(arguments_);
  if (operation !== 'inject' || !options.appcast || !options.manifest || !options.archive || !options['source-sha']) {
    throw new Error(
      'usage: appcast.js inject --appcast <appcast.xml> --manifest <artifact.json> --archive <update.zip> --source-sha <sha>'
    );
  }
  injectFile({
    appcast: path.resolve(options.appcast),
    manifest: path.resolve(options.manifest),
    archive: path.resolve(options.archive),
    sourceSHA: options['source-sha'],
  });
  console.log(`Injected exact Mac Access artifact metadata into private appcast: ${options.appcast}`);
}

if (require.main === module) main();

module.exports = {
  ARTIFACT_MANIFEST_SCHEMA,
  CORE_MANIFEST_SCHEMA,
  EVAOS_NAMESPACE,
  injectFile,
  injectMetadata,
  metadataFor,
  sha256,
  xmlEscape,
};
