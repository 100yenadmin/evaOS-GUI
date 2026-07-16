#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyGeneratedCoreSource } = require('../../../mac-connector-core/scripts/coreManifest');

const PACKAGE_ROOT = path.resolve(__dirname, '../..');
const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, '../..');
const MANIFEST_SCHEMA = 'evaos.mac_access.artifact_manifest.v1';
const TEAM_ID = 'TC6MS3T6NN';
const CORE_RELATIVE_PATH = 'Contents/XPCServices/evaOS Mac Access Helper.xpc/Contents/Resources/MacConnectorCore';
const EXPECTED_COMPATIBILITY = Object.freeze({
  stateSchema: 'evaos.mac_access.access_state.v1',
  schemaReaderVersion: 1,
  schemaWriterVersion: 1,
  minimumReaderSchemaVersion: 1,
  minimumWriterSchemaVersion: 1,
  securityEpoch: 1,
  credentialEpoch: 1,
  credentialAccessGroup: 'TC6MS3T6NN.com.evaos.mac-access.credentials.epoch-1',
});
const ROLE_CONTRACTS = Object.freeze({
  app: Object.freeze({
    bundleID: 'com.evaos.mac-access',
    bundlePath: '.',
    executablePath: 'Contents/MacOS/evaOS Mac Access',
    designatedRequirement:
      'anchor apple generic and certificate leaf[subject.OU] = "TC6MS3T6NN" and identifier "com.evaos.mac-access"',
    designatedRequirementSHA256: 'da635352f249b4213aa1a96c41d7979d8b25d86b056b9f0929c1b414e35896fb',
    relationship: Object.freeze({ kind: 'product', parentBundleID: null }),
    expectedEntitlements: Object.freeze({}),
  }),
  connector: Object.freeze({
    bundleID: 'com.evaos.mac-access.connector',
    bundlePath: 'Contents/Library/LoginItems/evaOS Mac Access Connector.app',
    executablePath:
      'Contents/Library/LoginItems/evaOS Mac Access Connector.app/Contents/MacOS/evaOS Mac Access Connector',
    designatedRequirement:
      'anchor apple generic and certificate leaf[subject.OU] = "TC6MS3T6NN" and identifier "com.evaos.mac-access.connector"',
    designatedRequirementSHA256: '0c3de778270de5b4a1992d0e13d4f27e41929c7ace94ae143bcba92a555be422',
    relationship: Object.freeze({ kind: 'login-item', parentBundleID: 'com.evaos.mac-access' }),
    expectedEntitlements: Object.freeze({}),
  }),
  helper: Object.freeze({
    bundleID: 'com.evaos.mac-access.helper',
    bundlePath: 'Contents/XPCServices/evaOS Mac Access Helper.xpc',
    executablePath: 'Contents/XPCServices/evaOS Mac Access Helper.xpc/Contents/MacOS/evaOS Mac Access Helper',
    designatedRequirement:
      'anchor apple generic and certificate leaf[subject.OU] = "TC6MS3T6NN" and identifier "com.evaos.mac-access.helper"',
    designatedRequirementSHA256: '222107bb855cfc463805777c76ca8cfdac0d1145957c5f190c234e52bfd277aa',
    relationship: Object.freeze({ kind: 'xpc-service', parentBundleID: 'com.evaos.mac-access' }),
    expectedEntitlements: Object.freeze({
      'keychain-access-groups': ['TC6MS3T6NN.com.evaos.mac-access.credentials.epoch-1'],
    }),
  }),
});
const MACH_O_MAGICS = new Set([
  'cafebabe',
  'bebafeca',
  'cafebabf',
  'bfbafeca',
  'feedface',
  'cefaedfe',
  'feedfacf',
  'cffaedfe',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function canonicalJSON(value) {
  return JSON.stringify(canonicalize(value));
}

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
  return { stdout, stderr, combined: `${stdout}${stderr}` };
}

function readPlist(plistPath, runner = defaultRunner) {
  const result = run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', plistPath], runner);
  return JSON.parse(result.stdout);
}

function parseEntitlements(output, runner = defaultRunner) {
  const start = output.indexOf('<?xml');
  const end = output.indexOf('</plist>');
  if (start < 0 || end < start) return {};
  const xml = output.slice(start, end + '</plist>'.length);
  const result = run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], runner, { input: xml });
  return JSON.parse(result.stdout);
}

function parseSignatureDetails(output) {
  const values = {};
  const authorities = [];
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === 'Authority') authorities.push(value);
    else values[key] = value;
  }
  return {
    identifier: values.Identifier || null,
    teamID: values.TeamIdentifier || null,
    authorities,
    hardenedRuntime: /flags=.*\bruntime\b/i.test(output) || Boolean(values['Runtime Version']),
    secureTimestamp: Boolean(values.Timestamp) && values.Timestamp.toLowerCase() !== 'none',
    adHoc: /flags=.*\badhoc\b/i.test(output) || values.Signature === 'adhoc',
  };
}

function normalizeRequirement(output) {
  const match = output.match(/designated\s*=>\s*([^\r\n]+)/);
  if (!match) throw new Error('codesign did not report a designated requirement.');
  return match[1]
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/certificate leaf\[subject\.OU\] = ([A-Z0-9]+)/g, 'certificate leaf[subject.OU] = "$1"');
}

function inspectSignature(targetPath, runner = defaultRunner) {
  const detailsOutput = run('/usr/bin/codesign', ['-d', '--verbose=4', targetPath], runner).combined;
  const details = parseSignatureDetails(detailsOutput);
  const designatedRequirement = normalizeRequirement(
    run('/usr/bin/codesign', ['-d', '-r-', targetPath], runner).combined
  );
  const entitlements = parseEntitlements(
    run('/usr/bin/codesign', ['-d', '--entitlements', ':-', targetPath], runner).combined,
    runner
  );
  return {
    ...details,
    designatedRequirement,
    designatedRequirementSHA256: sha256(designatedRequirement),
    entitlements: canonicalize(entitlements),
    entitlementsSHA256: sha256(canonicalJSON(entitlements)),
  };
}

function isMachO(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(4);
    return fs.readSync(descriptor, header, 0, 4, 0) === 4 && MACH_O_MAGICS.has(header.toString('hex'));
  } finally {
    fs.closeSync(descriptor);
  }
}

function walkBundle(rootPath) {
  const root = path.resolve(rootPath);
  const entries = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(directory)) {
      const absolutePath = path.join(directory, name);
      const metadata = fs.lstatSync(absolutePath);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
      if (metadata.isDirectory()) {
        pending.push(absolutePath);
      } else if (metadata.isFile()) {
        entries.push({ absolutePath, relativePath, metadata, type: 'file' });
      } else if (metadata.isSymbolicLink()) {
        const target = fs.readlinkSync(absolutePath);
        const resolved = path.resolve(path.dirname(absolutePath), target);
        if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
          throw new Error(`Bundle contains an escaping symbolic link: ${relativePath}`);
        }
        entries.push({ absolutePath, relativePath, metadata, target, type: 'symlink' });
      } else {
        throw new Error(`Bundle contains an unsupported filesystem entry: ${relativePath}`);
      }
    }
  }
  return entries.sort((left, right) => Buffer.compare(Buffer.from(left.relativePath), Buffer.from(right.relativePath)));
}

function bundleTreeIdentity(appPath) {
  const digest = crypto.createHash('sha256');
  let size = 0;
  let fileCount = 0;
  for (const entry of walkBundle(appPath)) {
    const mode = entry.metadata.mode & 0o777;
    digest.update(`${entry.type}\0${entry.relativePath}\0${mode.toString(8)}\0`);
    if (entry.type === 'file') {
      const bytes = fs.readFileSync(entry.absolutePath);
      digest.update(bytes);
      size += bytes.length;
      fileCount += 1;
    } else {
      digest.update(entry.target);
    }
    digest.update('\0');
  }
  return { algorithm: 'sha256-tree-v1', sha256: digest.digest('hex'), size, fileCount };
}

function discoverMachOFiles(appPath) {
  return walkBundle(appPath)
    .filter((entry) => entry.type === 'file' && isMachO(entry.absolutePath))
    .map((entry) => entry.relativePath);
}

function architectures(filePath, runner = defaultRunner) {
  return run('/usr/bin/lipo', ['-archs', filePath], runner).stdout.trim().split(/\s+/).filter(Boolean).sort();
}

function ownerForExecutable(relativePath) {
  if (relativePath.startsWith(`${ROLE_CONTRACTS.helper.bundlePath}/`)) return 'helper';
  if (relativePath.startsWith(`${ROLE_CONTRACTS.connector.bundlePath}/`)) return 'connector';
  return 'app';
}

function assertRoleContract(appPath, role, runner = defaultRunner) {
  const contract = ROLE_CONTRACTS[role];
  const bundlePath = contract.bundlePath === '.' ? appPath : path.join(appPath, contract.bundlePath);
  const executablePath = path.join(appPath, contract.executablePath);
  if (!fs.statSync(bundlePath).isDirectory() || !fs.statSync(executablePath).isFile() || !isMachO(executablePath)) {
    throw new Error(`${role} executable owner or helper relationship drifted.`);
  }
  const plist = readPlist(path.join(bundlePath, 'Contents', 'Info.plist'), runner);
  if (plist.CFBundleIdentifier !== contract.bundleID || plist.CFBundleExecutable !== path.basename(executablePath)) {
    throw new Error(`${role} bundle identity or executable owner drifted.`);
  }
  const signature = inspectSignature(bundlePath, runner);
  if (
    signature.identifier !== contract.bundleID ||
    signature.teamID !== TEAM_ID ||
    signature.adHoc ||
    !signature.hardenedRuntime ||
    !signature.secureTimestamp ||
    !signature.authorities.some((authority) => authority.startsWith('Developer ID Application:')) ||
    signature.designatedRequirement !== contract.designatedRequirement ||
    signature.designatedRequirementSHA256 !== contract.designatedRequirementSHA256 ||
    canonicalJSON(signature.entitlements) !== canonicalJSON(contract.expectedEntitlements)
  ) {
    throw new Error(`${role} signing identity, requirement, hardened runtime, or entitlements drifted.`);
  }
  return {
    bundleID: contract.bundleID,
    bundlePath: contract.bundlePath,
    executablePath: contract.executablePath,
    executableOwner: role,
    relationship: contract.relationship,
    designatedRequirement: signature.designatedRequirement,
    designatedRequirementSHA256: signature.designatedRequirementSHA256,
    signature: {
      teamID: signature.teamID,
      authorities: signature.authorities,
      hardenedRuntime: signature.hardenedRuntime,
      secureTimestamp: signature.secureTimestamp,
      adHoc: signature.adHoc,
    },
    entitlements: signature.entitlements,
    entitlementsSHA256: signature.entitlementsSHA256,
  };
}

function verifyMachOClosure(appPath, runner = defaultRunner) {
  const closure = [];
  for (const relativePath of discoverMachOFiles(appPath)) {
    const absolutePath = path.join(appPath, relativePath);
    run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', absolutePath], runner);
    const details = parseSignatureDetails(
      run('/usr/bin/codesign', ['-d', '--verbose=4', absolutePath], runner).combined
    );
    if (
      details.teamID !== TEAM_ID ||
      details.adHoc ||
      !details.hardenedRuntime ||
      !details.secureTimestamp ||
      !details.authorities.some((authority) => authority.startsWith('Developer ID Application:'))
    ) {
      throw new Error(`Mach-O closure identity is not Gatekeeper-ready Developer ID code: ${relativePath}`);
    }
    closure.push({
      path: relativePath,
      executableOwner: ownerForExecutable(relativePath),
      architectures: architectures(absolutePath, runner),
      sha256: sha256(fs.readFileSync(absolutePath)),
      teamID: details.teamID,
      hardenedRuntime: details.hardenedRuntime,
      secureTimestamp: details.secureTimestamp,
      adHoc: details.adHoc,
    });
  }
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath], runner);
  if (closure.length < 4) throw new Error('Mac Access signed Mach-O closure is incomplete.');
  return closure;
}

function readRuntimeIdentity(appPath) {
  const coreRoot = path.join(appPath, CORE_RELATIVE_PATH);
  const sourcePath = path.join(coreRoot, 'SOURCE.json');
  const inventoryPath = path.join(coreRoot, 'python-runtime-inventory.json');
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const inventoryBytes = fs.readFileSync(inventoryPath);
  const inventory = JSON.parse(inventoryBytes.toString('utf8'));
  const licensePath = source.runtime?.licensePath;
  const licenseAbsolutePath = licensePath === 'licenses/CPython-LICENSE.txt' ? path.join(coreRoot, licensePath) : null;
  const licenseMetadata = licenseAbsolutePath ? fs.lstatSync(licenseAbsolutePath) : null;
  if (
    source.schema !== 'evaos-mac-access-private-runtime/v1' ||
    source.owner !== '100yenadmin/evaOS-GUI' ||
    source.product !== 'evaOS Mac Access' ||
    source.connectorCore?.sourcePath !== 'packages/mac-connector-core' ||
    !/^[a-f0-9]{64}$/.test(source.connectorCore?.coreSourceSha256 || '') ||
    !/^[a-f0-9]{64}$/.test(source.connectorCore?.sourceManifestSha256 || '') ||
    inventory.schema !== 'evaos-python-runtime-inventory/v1' ||
    source.runtime?.inventoryPath !== 'python-runtime-inventory.json' ||
    source.runtime?.inventorySha256 !== sha256(inventoryBytes) ||
    !licenseAbsolutePath ||
    !licenseMetadata?.isFile() ||
    licenseMetadata.isSymbolicLink() ||
    source.runtime?.licenseSha256 !== sha256(fs.readFileSync(licenseAbsolutePath)) ||
    !/^[a-f0-9]{64}$/.test(source.runtime?.sourceSha256 || '') ||
    !['arm64', 'x64'].includes(source.runtime?.architecture) ||
    !Array.isArray(source.runtime?.packages) ||
    source.runtime.packages.some(
      (entry) =>
        typeof entry?.name !== 'string' ||
        typeof entry?.version !== 'string' ||
        !/^[a-f0-9]{64}$/.test(entry?.sha256 || '')
    )
  ) {
    throw new Error('Packaged connector core, source manifest, or runtime inventory drifted.');
  }
  const coreRoots = new Set();
  for (const entry of walkBundle(appPath)) {
    const marker = '/MacConnectorCore/';
    const offset = `/${entry.relativePath}`.indexOf(marker);
    if (offset >= 0) coreRoots.add(`/${entry.relativePath}`.slice(1, offset + marker.length - 1));
  }
  if (coreRoots.size !== 1 || !coreRoots.has(CORE_RELATIVE_PATH)) {
    throw new Error('Helper relationship drifted: connector core must exist only under the frozen XPC helper.');
  }
  const licenseFiles = walkBundle(path.join(coreRoot, 'licenses'))
    .filter((entry) => entry.type === 'file')
    .map((entry) => ({
      path: `licenses/${entry.relativePath}`,
      sha256: sha256(fs.readFileSync(entry.absolutePath)),
    }));
  return { coreRoot, source, inventorySha256: sha256(inventoryBytes), licenseFiles };
}

function installedDistributions(coreRoot) {
  const packages = [];
  for (const entry of walkBundle(path.join(coreRoot, 'python'))) {
    if (entry.type !== 'file' || !entry.relativePath.endsWith('.dist-info/METADATA')) continue;
    const metadata = fs.readFileSync(entry.absolutePath, 'utf8');
    const field = (name) => metadata.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'))?.[1]?.trim();
    const name = field('Name');
    const version = field('Version');
    if (!name || !version) throw new Error(`Python distribution metadata is incomplete: ${entry.relativePath}`);
    packages.push({
      name,
      version,
      license: field('License-Expression') || field('License') || 'NOASSERTION',
      metadataPath: `python/${entry.relativePath}`,
      metadataSHA256: sha256(fs.readFileSync(entry.absolutePath)),
    });
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

function sourceCommit() {
  return run('/usr/bin/git', ['rev-parse', 'HEAD'], defaultRunner, { cwd: REPOSITORY_ROOT }).stdout.trim();
}

function creationTime(commit, runner = defaultRunner) {
  const configured = process.env.SOURCE_DATE_EPOCH;
  const epoch =
    configured ||
    run('/usr/bin/git', ['show', '-s', '--format=%ct', commit], runner, {
      cwd: REPOSITORY_ROOT,
    }).stdout.trim();
  if (!/^\d+$/.test(epoch)) throw new Error('SOURCE_DATE_EPOCH or source commit time is invalid.');
  return new Date(Number(epoch) * 1000).toISOString().replace('.000Z', 'Z');
}

function createManifest(appPath, options = {}) {
  const app = path.resolve(appPath);
  const runner = options.runner || defaultRunner;
  const runtime = readRuntimeIdentity(app);
  const commit = options.sourceSHA || sourceCommit();
  if (!/^[a-f0-9]{40}$/.test(commit) || runtime.source.repositoryCommit !== commit) {
    throw new Error('Artifact source SHA does not match the embedded private-runtime source SHA.');
  }
  const coreIdentity =
    options.coreIdentity ||
    verifyGeneratedCoreSource(path.join(REPOSITORY_ROOT, 'packages', 'mac-connector-core'), runtime.coreRoot);
  if (
    runtime.source.connectorCore.coreSourceSha256 !== coreIdentity.coreSourceSha256 ||
    runtime.source.connectorCore.sourceManifestSha256 !== coreIdentity.sourceManifestSha256
  ) {
    throw new Error('Packaged connector core does not match the exact checkout source manifest and digest.');
  }
  const appPlist = readPlist(path.join(app, 'Contents', 'Info.plist'), runner);
  const roles = Object.fromEntries(
    Object.keys(ROLE_CONTRACTS).map((role) => [role, assertRoleContract(app, role, runner)])
  );
  const closure = verifyMachOClosure(app, runner);
  const mainArchitectures = closure.find((entry) => entry.path === ROLE_CONTRACTS.app.executablePath)?.architectures;
  if (!mainArchitectures) throw new Error('App executable is absent from the signed Mach-O closure.');
  const expectedRuntimeArchitecture = runtime.source.runtime.architecture === 'x64' ? 'x86_64' : 'arm64';
  if (mainArchitectures.length !== 1 || mainArchitectures[0] !== expectedRuntimeArchitecture) {
    throw new Error('App executable architecture does not match the embedded private runtime architecture.');
  }
  return canonicalize({
    schema: MANIFEST_SCHEMA,
    createdAt: options.createdAt || creationTime(commit, runner),
    product: 'evaOS Mac Access',
    source: { repository: '100yenadmin/evaOS-GUI', commit },
    version: {
      short: String(appPlist.CFBundleShortVersionString || ''),
      build: String(appPlist.CFBundleVersion || ''),
    },
    artifact: {
      name: path.basename(app),
      architectures: mainArchitectures,
      bundleTree: bundleTreeIdentity(app),
    },
    compatibility: EXPECTED_COMPATIBILITY,
    connectorCore: {
      sourcePath: runtime.source.connectorCore.sourcePath,
      coreSourceSha256: runtime.source.connectorCore.coreSourceSha256,
      sourceManifestSha256: runtime.source.connectorCore.sourceManifestSha256,
      privateRuntimeManifestSchema: runtime.source.schema,
      privateRuntimeManifestSha256: sha256(fs.readFileSync(path.join(runtime.coreRoot, 'SOURCE.json'))),
      runtimeInventorySchema: 'evaos-python-runtime-inventory/v1',
      runtimeInventorySha256: runtime.inventorySha256,
      runtime: {
        pythonVersion: runtime.source.runtime.version,
        architecture: runtime.source.runtime.architecture,
        sourceURL: runtime.source.runtime.sourceUrl,
        sourceSha256: runtime.source.runtime.sourceSha256,
        packages: runtime.source.runtime.packages,
        license: runtime.source.runtime.license,
        licenseFiles: runtime.licenseFiles,
      },
    },
    signing: {
      approvedTeamID: TEAM_ID,
      hardenedRuntimeRequired: true,
      secureTimestampRequired: true,
      adHocAllowed: false,
      roles,
      machOClosure: closure,
    },
  });
}

function spdxID(value) {
  return `SPDXRef-${value.replace(/[^A-Za-z0-9.-]+/g, '-')}`;
}

function createSBOM(appPath, manifest) {
  const runtime = readRuntimeIdentity(path.resolve(appPath));
  const runtimePackages = runtime.source.runtime.packages || [];
  const installed = installedDistributions(runtime.coreRoot);
  const sourceByName = new Map(runtimePackages.map((entry) => [entry.name.toLowerCase(), entry]));
  const packages = [
    {
      SPDXID: 'SPDXRef-evaOS-Mac-Access',
      name: 'evaOS Mac Access',
      versionInfo: `${manifest.version.short}+${manifest.version.build}`,
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: 'NOASSERTION',
      licenseDeclared: 'NOASSERTION',
      checksums: [{ algorithm: 'SHA256', checksumValue: manifest.artifact.bundleTree.sha256 }],
      externalRefs: [
        {
          referenceCategory: 'OTHER',
          referenceType: 'evaos-source-commit',
          referenceLocator: manifest.source.commit,
        },
      ],
    },
    {
      SPDXID: 'SPDXRef-mac-connector-core',
      name: 'evaOS mac-connector-core',
      versionInfo: manifest.source.commit,
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: 'NOASSERTION',
      licenseDeclared: 'NOASSERTION',
      checksums: [{ algorithm: 'SHA256', checksumValue: manifest.connectorCore.coreSourceSha256 }],
    },
    {
      SPDXID: 'SPDXRef-CPython',
      name: 'CPython',
      versionInfo: runtime.source.runtime.version,
      downloadLocation: runtime.source.runtime.sourceUrl || 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: runtime.source.runtime.license || 'Python-2.0',
      licenseDeclared: runtime.source.runtime.license || 'Python-2.0',
      checksums: [{ algorithm: 'SHA256', checksumValue: runtime.source.runtime.sourceSha256 }],
    },
    ...installed.map((entry) => {
      const provenance = sourceByName.get(entry.name.toLowerCase());
      return {
        SPDXID: spdxID(entry.name),
        name: entry.name,
        versionInfo: entry.version,
        downloadLocation: 'NOASSERTION',
        filesAnalyzed: false,
        licenseConcluded: entry.license,
        licenseDeclared: entry.license,
        checksums: [
          {
            algorithm: 'SHA256',
            checksumValue: provenance?.sha256 || entry.metadataSHA256,
          },
        ],
        externalRefs: [
          {
            referenceCategory: 'OTHER',
            referenceType: provenance ? 'evaos-pinned-wheel-sha256' : 'evaos-installed-metadata-sha256',
            referenceLocator: provenance?.sha256 || entry.metadataSHA256,
          },
        ],
      };
    }),
  ];
  const dependencyIDs = packages.slice(1).map((entry) => entry.SPDXID);
  return canonicalize({
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `evaOS-Mac-Access-${manifest.version.short}-${manifest.artifact.bundleTree.sha256.slice(0, 12)}`,
    documentNamespace: `https://evaos.com/sbom/mac-access/${manifest.source.commit}/${manifest.artifact.bundleTree.sha256}`,
    creationInfo: { created: manifest.createdAt, creators: ['Organization: Electric Sheep'] },
    documentDescribes: ['SPDXRef-evaOS-Mac-Access'],
    packages,
    relationships: dependencyIDs.map((relatedSpdxElement) => ({
      spdxElementId: 'SPDXRef-evaOS-Mac-Access',
      relationshipType: 'DEPENDS_ON',
      relatedSpdxElement,
    })),
  });
}

function verifyManifest(appPath, manifest, sbom, options = {}) {
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA) throw new Error('Artifact manifest schema drifted.');
  const actual = createManifest(appPath, {
    runner: options.runner,
    coreIdentity: options.coreIdentity,
    sourceSHA: manifest.source?.commit,
    createdAt: manifest.createdAt,
  });
  if (canonicalJSON(actual) !== canonicalJSON(manifest)) {
    throw new Error(
      'Artifact manifest drifted: identity, owner, helper relation, entitlement, core/schema, or checksum mismatch.'
    );
  }
  const actualSBOM = createSBOM(appPath, actual);
  if (canonicalJSON(actualSBOM) !== canonicalJSON(sbom)) {
    throw new Error('Artifact SBOM or dependency license inventory drifted.');
  }
  return actual;
}

function writeJSON(filePath, value) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
  if (!['create', 'verify'].includes(operation) || !options.app || !options.manifest || !options.sbom) {
    throw new Error(
      'usage: manifest.js create|verify --app <App.app> --manifest <manifest.json> --sbom <sbom.spdx.json> [--source-sha <sha>]'
    );
  }
  if (operation === 'create') {
    const manifest = createManifest(options.app, { sourceSHA: options['source-sha'] });
    const sbom = createSBOM(options.app, manifest);
    writeJSON(options.manifest, manifest);
    writeJSON(options.sbom, sbom);
    verifyManifest(options.app, manifest, sbom);
    console.log(`Created and verified exact Mac Access artifact manifest: ${options.manifest}`);
  } else {
    const manifest = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
    const sbom = JSON.parse(fs.readFileSync(options.sbom, 'utf8'));
    verifyManifest(options.app, manifest, sbom);
    console.log(`Verified exact Mac Access artifact manifest: ${options.manifest}`);
  }
}

if (require.main === module) main();

module.exports = {
  CORE_RELATIVE_PATH,
  EXPECTED_COMPATIBILITY,
  MANIFEST_SCHEMA,
  ROLE_CONTRACTS,
  TEAM_ID,
  bundleTreeIdentity,
  canonicalJSON,
  createManifest,
  createSBOM,
  defaultRunner,
  discoverMachOFiles,
  inspectSignature,
  normalizeRequirement,
  ownerForExecutable,
  parseSignatureDetails,
  verifyManifest,
  writeJSON,
};
