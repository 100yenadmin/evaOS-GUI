#!/usr/bin/env node

const path = require('path');
const {
  ROLE_CONTRACTS,
  createManifest,
  createSBOM,
  defaultRunner,
  discoverMachOFiles,
  verifyManifest,
  writeJSON,
} = require('./manifest');

const PACKAGE_ROOT = path.resolve(__dirname, '../..');

function runChecked(command, args, runner = defaultRunner) {
  const result = runner(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    throw new Error(`${path.basename(command)} failed: ${output}`);
  }
}

function signArguments(targetPath, identity, options = {}) {
  if (!identity || (!/^Developer ID Application:/.test(identity) && !/^[A-Fa-f0-9]{40}$/.test(identity))) {
    throw new Error('Mac Access release signing requires an explicit Developer ID Application identity.');
  }
  const args = ['--force', '--sign', identity, '--timestamp', '--options', 'runtime'];
  if (options.keychain) args.push('--keychain', options.keychain);
  if (options.requirement) args.push('--requirements', `=designated => ${options.requirement}`);
  if (options.entitlements) args.push('--entitlements', options.entitlements);
  args.push(targetPath);
  return args;
}

function signReleaseBundle(appPath, options = {}) {
  const app = path.resolve(appPath);
  const runner = options.runner || defaultRunner;
  const identity = options.identity;
  const roleExecutablePaths = new Set(Object.values(ROLE_CONTRACTS).map((role) => role.executablePath));
  const leafPaths = discoverMachOFiles(app)
    .filter((relativePath) => !roleExecutablePaths.has(relativePath))
    .sort((left, right) => right.split('/').length - left.split('/').length || left.localeCompare(right));

  for (const relativePath of leafPaths) {
    runChecked(
      '/usr/bin/codesign',
      signArguments(path.join(app, relativePath), identity, { keychain: options.keychain }),
      runner
    );
  }

  for (const role of ['connector', 'helper', 'app']) {
    const contract = ROLE_CONTRACTS[role];
    const targetPath = contract.bundlePath === '.' ? app : path.join(app, contract.bundlePath);
    runChecked(
      '/usr/bin/codesign',
      signArguments(targetPath, identity, {
        keychain: options.keychain,
        requirement: contract.designatedRequirement,
        entitlements:
          role === 'helper'
            ? path.join(PACKAGE_ROOT, 'Resources', 'Entitlements', 'Helper-Release.entitlements')
            : undefined,
      }),
      runner
    );
  }
  return { leafPaths, roles: ['connector', 'helper', 'app'] };
}

function recordReleaseBundle(appPath, options = {}) {
  const manifest = createManifest(appPath, {
    coreIdentity: options.coreIdentity,
    createdAt: options.createdAt,
    runner: options.runner,
    sourceSHA: options.sourceSHA,
  });
  const sbom = createSBOM(appPath, manifest);
  writeJSON(options.manifest, manifest);
  writeJSON(options.sbom, sbom);
  verifyManifest(appPath, manifest, sbom, {
    coreIdentity: options.coreIdentity,
    runner: options.runner,
  });
  return { manifest, sbom };
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
  if (!['sign', 'record', 'verify'].includes(operation) || !options.app || !options.manifest || !options.sbom) {
    throw new Error(
      'usage: sign-bundle.js sign|record|verify --app <App.app> --manifest <manifest.json> --sbom <sbom.spdx.json> [--identity <Developer ID>] [--keychain <path>] [--source-sha <sha>]'
    );
  }
  if (operation === 'sign') {
    signReleaseBundle(options.app, { identity: options.identity, keychain: options.keychain });
    recordReleaseBundle(options.app, {
      manifest: options.manifest,
      sbom: options.sbom,
      sourceSHA: options['source-sha'],
    });
    console.log(`Signed and verified Mac Access with exact Developer ID manifest: ${options.manifest}`);
  } else if (operation === 'record') {
    recordReleaseBundle(options.app, {
      manifest: options.manifest,
      sbom: options.sbom,
      sourceSHA: options['source-sha'],
    });
    console.log(`Recorded exact post-staple Mac Access manifest: ${options.manifest}`);
  } else {
    const fs = require('fs');
    const manifest = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
    const sbom = JSON.parse(fs.readFileSync(options.sbom, 'utf8'));
    verifyManifest(options.app, manifest, sbom);
    console.log(`Verified signed Mac Access bundle and manifest: ${options.app}`);
  }
}

if (require.main === module) main();

module.exports = { recordReleaseBundle, signArguments, signReleaseBundle };
