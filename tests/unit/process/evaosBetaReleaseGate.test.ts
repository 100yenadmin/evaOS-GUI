import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const releaseGate = require('../../../scripts/evaosBetaReleaseGate.js') as {
  assertPublicBetaNotarizationEnv: (env: Record<string, string | undefined>) => void;
  assertPublicBetaReleaseSigningEnv: (env: Record<string, string | undefined>) => void;
  assertPublicDistributionTag: (tag: string) => void;
  assertMacosAutoUpdateMetadata: (outputDir: string, releaseTargetPlatforms: string) => void;
  assertReleaseConfig: (rootDir: string) => boolean;
  collectFunctionalSmokeConfigIssues: (workflow: string) => string[];
  collectBuildReleaseWorkflowIssues: (workflow: string) => string[];
  collectReleaseConfigIssues: (rootDir: string) => string[];
  createReleaseManifest: (outputDir: string, tag: string, env: Record<string, string | undefined>) => unknown;
  isLocalSignedDmgFallbackManifest: (manifest: unknown) => boolean;
  isStrictPublicBetaReleaseEnv: (env: Record<string, string | undefined>) => boolean;
  LOCAL_SIGNED_DMG_FALLBACK_ACK: string;
  releaseProvenanceFromEnv: (env: Record<string, string | undefined>) => unknown;
  RELEASE_PROVENANCE_LOCAL_SIGNED_DMG_FALLBACK: string;
  normalizeBoolean: (value: unknown) => boolean;
  verifyBrokerLiveCanaryProof: (proofDir: string, env?: Record<string, string | undefined>) => boolean;
  verifyReleaseManifest: (outputDir: string, tag: string, env: Record<string, string | undefined>) => boolean;
  verifyRcProof: (proofDir: string, tag: string, env: Record<string, string | undefined>) => boolean;
  writeRcProofTemplate: (proofDir: string, tag: string) => unknown;
};
const afterSign = require('../../../scripts/afterSign.js') as {
  (context: unknown): Promise<void>;
  default: (context: unknown) => Promise<void>;
  assertMacControlHelperSignatures: (
    appPath: string,
    env?: Record<string, string | undefined>,
    runProcess?: (
      command: string,
      args: string[],
      options: Record<string, unknown>
    ) => { status: number | null; stdout?: string; stderr?: string }
  ) => void;
  buildAppNotarytoolInfoArgs: (submissionId: string, notarizationOptions: Record<string, string>) => string[];
  buildAppNotarytoolSubmitArgs: (archivePath: string, notarizationOptions: Record<string, string>) => string[];
  getAppNotaryCommandProcessTimeoutMs: (env: Record<string, string | undefined>) => number;
  getAppNotaryPollIntervalMs: (env: Record<string, string | undefined>) => number;
  getAppNotaryProcessTimeoutMs: (env: Record<string, string | undefined>) => number;
  getAppTrustProcessTimeoutMs: (env: Record<string, string | undefined>) => number;
  getNotarizationOptions: (
    env: Record<string, string | undefined>,
    baseOptions: Record<string, string>
  ) => Record<string, string> | undefined;
  isMachOExecutable: (filePath: string) => boolean;
  stapleAndValidateApp: (
    appPath: string,
    runCommand?: (command: string, args: string[], options: Record<string, unknown>) => void
  ) => void;
  runAppNotarytoolSubmit: (
    submitArgs: string[],
    env?: Record<string, string | undefined>,
    runCommand?: (command: string, args: string[], options: Record<string, unknown>) => string
  ) => string;
  waitForAppNotarySubmission: (
    submissionId: string,
    notarizationOptions: Record<string, string>,
    env?: Record<string, string | undefined>,
    runCommand?: (command: string, args: string[], options: Record<string, unknown>) => string,
    sleep?: (ms: number) => void
  ) => unknown;
  withKeychainCredentialIsolation: <T>(
    notarizationOptions: Record<string, string> | undefined,
    operation: () => Promise<T> | T
  ) => Promise<T>;
};
const macDmgFinalizer = require('../../../scripts/evaosFinalizeMacDmg.js') as {
  buildDmgCodesignArgs: (dmgPath: string, identity: string, env: Record<string, string | undefined>) => string[];
  buildNotarytoolInfoArgs: (submissionId: string, env: Record<string, string | undefined>) => string[];
  buildNotarytoolSubmitArgs: (dmgPath: string, env: Record<string, string | undefined>) => string[];
  findDmgArtifacts: (outDir: string) => string[];
  getDmgCodesignProcessTimeoutMs: (env: Record<string, string | undefined>) => number;
  getDmgCodesignMode: (env: Record<string, string | undefined>) => string;
  getDmgTrustProcessTimeoutMs: (env: Record<string, string | undefined>) => number;
  getNotaryCommandProcessTimeoutMs: (env: Record<string, string | undefined>) => number;
  getNotaryPollIntervalMs: (env: Record<string, string | undefined>) => number;
  getNotaryProcessTimeoutMs: (env: Record<string, string | undefined>) => number;
  shouldCodesignDmg: (env: Record<string, string | undefined>) => boolean;
};

const repoRoot = path.resolve(__dirname, '../../..');
const liveCanaryProofEnv = {
  EVAOS_LIVE_CANARY_EXPECTED_CUSTOMER_ID: 'cus_123',
  EVAOS_LIVE_CANARY_MAX_PROOF_AGE_HOURS: '24',
};

function writeArm64TrustEvidence(proofDir: string) {
  fs.writeFileSync(path.join(proofDir, 'codesign-dmg-macos-arm64.txt'), 'evaOS Workbench.dmg: valid on disk\n');
  fs.writeFileSync(
    path.join(proofDir, 'stapler-dmg-macos-arm64.txt'),
    'Processing: evaOS Workbench.dmg\nThe validate action worked!\n'
  );
  fs.writeFileSync(path.join(proofDir, 'spctl-dmg-macos-arm64.txt'), 'evaOS Workbench.dmg: accepted\n');
  fs.writeFileSync(
    path.join(proofDir, 'codesign-macos-arm64.txt'),
    '/Applications/evaOS Workbench.app: valid on disk\n/Applications/evaOS Workbench.app: satisfies its Designated Requirement\n'
  );
  fs.writeFileSync(
    path.join(proofDir, 'stapler-macos-arm64.txt'),
    'Processing: /Applications/evaOS Workbench.app\nThe validate action worked!\n'
  );
  fs.writeFileSync(path.join(proofDir, 'spctl-macos-arm64.txt'), '/Applications/evaOS Workbench.app: accepted\n');
}

function writeMachOFixture(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from('cffaedfe00000000', 'hex'));
  fs.chmodSync(filePath, 0o755);
}

function writeScriptFixture(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(filePath, 0o755);
}

function writeMacosBridgeZip(
  zipPath: string,
  options: {
    extraEntryCount?: number;
    omitPeekaboo?: boolean;
    omitLicense?: boolean;
    sourceSha256?: string;
    manifestLicenseSha256?: string;
    tamperPythonLicense?: boolean;
    universalPythonRuntime?: boolean;
    wrongObjcArchitecture?: boolean;
    wrongPythonSourceUrl?: boolean;
  } = {}
) {
  const script = [
    'import hashlib',
    'import json',
    'import pathlib',
    'import stat',
    'import struct',
    'import sys',
    'import zipfile',
    'zip_path = pathlib.Path(sys.argv[1])',
    'extra_entry_count = int(sys.argv[2]) if len(sys.argv) > 2 else 0',
    'omit_peekaboo = sys.argv[3] == "1"',
    'omit_license = sys.argv[4] == "1"',
    'source_sha256 = sys.argv[5]',
    'manifest_license_sha256 = sys.argv[6]',
    'python_license_path = pathlib.Path(sys.argv[7])',
    'tamper_python_license = sys.argv[8] == "1"',
    'wrong_objc_architecture = sys.argv[9] == "1"',
    'wrong_python_source_url = sys.argv[10] == "1"',
    'universal_python_runtime = sys.argv[11] == "1"',
    'app_root = zip_path.stem.replace("-mac-arm64", "").replace("-mac-x64", "") + ".app"',
    'python_arch = "arm64" if "arm64" in zip_path.name else "x64"',
    'python_source_sha256 = "5a30271f8d345a5b02b0c9e4e31e0f1e1455a8e4a04fba95cd9762472abc3b17" if python_arch == "arm64" else "cd369e76973c3179bc578230d8615ab621968ed758c5e32f636eecef4ad79894"',
    'def fat_macho():',
    '    slices = [(0x0100000c, bytes.fromhex("cffaedfe0c000001")), (0x01000007, bytes.fromhex("cffaedfe07000001"))]',
    '    offset = 8 + len(slices) * 20',
    '    records = []',
    '    payload = []',
    '    for cpu_type, thin_header in slices:',
    '        records.append(struct.pack(">IIIII", cpu_type, 0, offset, len(thin_header), 0))',
    '        payload.append(thin_header)',
    '        offset += len(thin_header)',
    '    return struct.pack(">II", 0xcafebabe, len(slices)) + b"".join(records) + b"".join(payload)',
    'python_header = fat_macho() if universal_python_runtime else bytes.fromhex("cffaedfe0c000001" if python_arch == "arm64" else "cffaedfe07000001")',
    'license_bytes = b"MIT License\\n\\nPermission is hereby granted, free of charge, to any person obtaining a copy\\n"',
    'license_sha256 = manifest_license_sha256 or hashlib.sha256(license_bytes).hexdigest()',
    'python_license_bytes = python_license_path.read_bytes() + (b"tampered\\n" if tamper_python_license else b"")',
    'python_license_sha256 = hashlib.sha256(python_license_bytes).hexdigest()',
    'objc_header = bytes.fromhex(("cffaedfe07000001" if python_arch == "arm64" else "cffaedfe0c000001") if wrong_objc_architecture else ("cffaedfe0c000001" if python_arch == "arm64" else "cffaedfe07000001"))',
    'python_packages = [{"name":"pyobjc-core","version":"12.2.1","sha256":"a64232bb27ed101d4adc7d42b0e64a6d3331aac7bee7861c037a6777a163f10b"},{"name":"pyobjc-framework-Cocoa","version":"12.2.1","sha256":"28b9b8bab1c36efb94744786918752d0c1842f5fbb67e7d5ca97b5f736512080"},{"name":"pyobjc-framework-Quartz","version":"12.2.1","sha256":"de9c8cca7e95290c8d540466af11c7cdfe3a5458e6f56c34006d5b45243f9ed9"},{"name":"pyobjc-framework-ApplicationServices","version":"12.2.1","sha256":"f519ced13888d03410cd7da1f08fc56ee2944099e607216cef7ca26ecfdef61b"},{"name":"pyobjc-framework-CoreText","version":"12.2.1","sha256":"ac2ead13dfa4379a1566129d0e8a8ea778a2bcac9ac360a583360fd4f1ba39c6"}]',
    'python_asset_arch = "aarch64" if python_arch == "arm64" else "x86_64"',
    'python_source_url = f"https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython-3.12.13+20260510-{python_asset_arch}-apple-darwin-install_only.tar.gz"',
    'if wrong_python_source_url:',
    '    python_source_url = "https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython.tar.gz"',
    'manifest = {"placeholder": False, "bundledTools": {"peekaboo": {"version": "3.8.0", "sourceSha256": source_sha256, "license": "MIT", "licensePath": "licenses/Peekaboo-LICENSE.txt", "licenseSha256": license_sha256}, "python": {"version": "3.12.13", "architecture": python_arch, "sourceSha256": python_source_sha256, "sourceUrl": python_source_url, "packages": python_packages, "license": "Python-2.0", "licensePath": "licenses/CPython-LICENSE.txt", "licenseSha256": python_license_sha256}}}',
    'with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:',
    '    archive.writestr(f"{app_root}/Contents/Resources/Bridge/evaos-desktop-bridge", "#!/usr/bin/env bash\\n")',
    '    if not omit_peekaboo:',
    '        archive.writestr(f"{app_root}/Contents/Resources/Bridge/bin/peekaboo", bytes.fromhex("cafebabe00000000"))',
    '    archive.writestr(f"{app_root}/Contents/Resources/Bridge/bin/evaos-connector-helper", bytes.fromhex("cafebabe00000000"))',
    '    python_launcher = zipfile.ZipInfo(f"{app_root}/Contents/Resources/Bridge/python/bin/python3")',
    '    python_launcher.create_system = 3',
    '    python_launcher.external_attr = (stat.S_IFLNK | 0o777) << 16',
    '    archive.writestr(python_launcher, b"python3.12")',
    '    archive.writestr(f"{app_root}/Contents/Resources/Bridge/python/bin/python3.12", python_header)',
    '    archive.writestr(f"{app_root}/Contents/Resources/Bridge/python/lib/python3.12/site-packages/ApplicationServices/__init__.py", b"")',
    '    archive.writestr(f"{app_root}/Contents/Resources/Bridge/python/lib/python3.12/site-packages/Quartz/__init__.py", b"")',
    '    archive.writestr(f"{app_root}/Contents/Resources/Bridge/python/lib/python3.12/site-packages/objc/__init__.py", b"")',
    '    archive.writestr(f"{app_root}/Contents/Resources/Bridge/python/lib/python3.12/site-packages/objc/_objc.cpython-312-darwin.so", objc_header)',
    '    archive.writestr(f"{app_root}/Contents/Resources/Bridge/licenses/CPython-LICENSE.txt", python_license_bytes)',
    '    if not omit_license:',
    '        archive.writestr(f"{app_root}/Contents/Resources/Bridge/licenses/Peekaboo-LICENSE.txt", license_bytes)',
    '    archive.writestr(f"{app_root}/Contents/Resources/Bridge/manifest.json", json.dumps(manifest) + "\\n")',
    '    for index in range(extra_entry_count):',
    '        archive.writestr(f"{app_root}/Contents/Resources/noise/entry-{index:05d}.txt", "x\\n")',
  ].join('\n');
  execFileSync('python3', [
    '-c',
    script,
    zipPath,
    String(options.extraEntryCount || 0),
    options.omitPeekaboo ? '1' : '0',
    options.omitLicense ? '1' : '0',
    options.sourceSha256 || '4a5c7e28c263c84e406aa1853ef62cad3042b13f40a7a9e044ec74ec42933383',
    options.manifestLicenseSha256 || '',
    path.join(repoRoot, 'tests/fixtures/licenses/CPython-3.12.13-LICENSE.txt'),
    options.tamperPythonLicense ? '1' : '0',
    options.wrongObjcArchitecture ? '1' : '0',
    options.wrongPythonSourceUrl ? '1' : '0',
    options.universalPythonRuntime ? '1' : '0',
  ]);
}

function writeMacosArm64ReleaseFixture(
  dir: string,
  zipOptions: Parameters<typeof writeMacosBridgeZip>[1] = {}
): string {
  const tag = 'evaos-beta-v2.1.10-evaos-beta.0';
  const zipName = 'evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.zip';
  fs.writeFileSync(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'mac');
  writeMacosBridgeZip(path.join(dir, zipName), zipOptions);
  fs.writeFileSync(path.join(dir, 'latest-arm64-mac.yml'), `minimumSystemVersion: '24.0.0'\npath: ${zipName}\n`);
  releaseGate.createReleaseManifest(dir, tag, {
    GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
    GITHUB_WORKFLOW: 'PR Checks',
    EVAOS_BETA_RELEASE_WORKFLOW: 'Build and Release',
    GITHUB_RUN_ID: '12345',
    GITHUB_RUN_ATTEMPT: '1',
    EVAOS_BETA_RELEASE_COMMIT: 'abc123',
    EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
    EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
    EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
  });
  return tag;
}

function writeBusinessBrowserLiveCanaryProof(proofDir: string, overrides: Record<string, unknown> = {}) {
  const customerId = String(overrides.customerId || 'cus_123');
  const checkedAt = String(overrides.checkedAt || new Date().toISOString());
  const runtimeProof = (status: string, auditId: string) => ({
    customerId,
    customerAccountId: 'customer_account_123',
    runtime: 'browser',
    status,
    controlSessionActive: true,
    canOpenUrl: true,
    canStop: true,
    actionCount: 2,
    sourcePointer: 'broker:runtime_status:browser',
    auditId,
  });
  const actionProof = (action: string, status: string, auditId: string) => ({
    action,
    customerId,
    customerAccountId: 'customer_account_123',
    status,
    backendEnforced: true,
    sourcePointer: `broker:${action}:${customerId}`,
    auditId,
  });
  const deniedProof = (actor: string) => ({
    runtime: {
      actor: `${actor}:runtime`,
      backendDenied: true,
      httpStatus: 403,
      code: 'forbidden',
      sourcePointer: `broker:business_browser_denial:${actor}:runtime`,
      auditId: `audit_${actor}_runtime_denied`,
    },
    open: {
      actor: `${actor}:open`,
      backendDenied: true,
      httpStatus: 403,
      code: 'forbidden',
      sourcePointer: `broker:business_browser_denial:${actor}:open`,
      auditId: `audit_${actor}_open_denied`,
    },
    stop: {
      actor: `${actor}:stop`,
      backendDenied: true,
      httpStatus: 403,
      code: 'forbidden',
      sourcePointer: `broker:business_browser_denial:${actor}:stop`,
      auditId: `audit_${actor}_stop_denied`,
    },
  });

  fs.writeFileSync(
    path.join(proofDir, 'business-browser.json'),
    `${JSON.stringify(
      {
        schema: 'evaos-business-browser-live-proof/v1',
        customerId,
        checkedAt,
        dryRun: false,
        acceptanceProof: true,
        customerIsolation: 'passed',
        negativeBoundary: 'required',
        policy: {
          customerId,
          customerAccountId: 'customer_account_123',
          membershipId: 'membership_123',
          membershipRole: 'admin',
          hasOpenBusinessBrowser: true,
          backendEnforced: true,
          auditId: 'audit_business_browser_policy',
        },
        before: runtimeProof('running', 'audit_browser_before'),
        open: actionProof('browser_open_url', 'opened', 'audit_browser_open'),
        afterOpen: runtimeProof('running', 'audit_browser_after_open'),
        stop: actionProof('browser_stop', 'stopped', 'audit_browser_stop'),
        afterStop: runtimeProof('stopped', 'audit_browser_after_stop'),
        wrongCustomer: deniedProof('wrong_customer'),
        deniedMember: deniedProof('denied_member'),
        sensitiveOutput: 'passed',
        ...overrides,
      },
      null,
      2
    )}\n`
  );
}

function writeBrokerLiveCanaryProof(
  proofDir: string,
  overrides: Record<string, unknown> = {},
  businessBrowserOverrides: Record<string, unknown> = {}
) {
  fs.mkdirSync(proofDir, { recursive: true });
  const checkedAt = String(overrides.checkedAt || new Date().toISOString());
  const surfaces = [
    ['evaos', 'openclaw'],
    ['hermes', 'hermes'],
    ['mission-control', 'paperclip'],
    ['shared-browser', 'browser'],
    ['terminal', 'terminal'],
  ].map(([surface, runtime]) => ({
    surface,
    runtime,
    status: 'running',
    sourcePointer: `broker:runtime_status:${runtime}`,
    auditId: `audit_status_${surface}`,
    checkedAt,
    secretScan: 'passed',
    launch: {
      status: 'attached',
      launchMode: 'dashboard_surface',
      sourcePointer: `broker:runtime_launch:${runtime}`,
      auditId: `audit_launch_${surface}`,
      launchUrlRedacted: true,
      checkedAt,
      secretScan: 'passed',
    },
  }));
  fs.writeFileSync(
    path.join(proofDir, 'broker-runtime-status.json'),
    `${JSON.stringify(
      {
        schema: 'evaos-broker-live-canary/v3',
        customerId: 'cus_123',
        releaseCanaryCustomerId: 'cus_123',
        requiredSurfaces: ['evaos', 'hermes', 'mission-control', 'shared-browser', 'terminal'],
        surfaces,
        checkedAt,
        secretScan: 'passed',
        ...overrides,
      },
      null,
      2
    )}\n`
  );
  writeBusinessBrowserLiveCanaryProof(proofDir, {
    customerId: String(overrides.customerId || 'cus_123'),
    checkedAt,
    ...businessBrowserOverrides,
  });
}

function mutateBrokerLiveCanaryProof(proofDir: string, mutator: (proof: Record<string, unknown>) => void) {
  const proofPath = path.join(proofDir, 'broker-runtime-status.json');
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8')) as Record<string, unknown>;
  mutator(proof);
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
}

function writeProofReleaseAssetsReference(
  proofDir: string,
  tag: string,
  options: { includeTrustedManifest?: boolean } = {}
) {
  const sourceReleaseAssetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-release-source-'));
  const proofReleaseAssetsDir = path.join(proofDir, 'release-assets');
  const version = '2.1.10-evaos-beta.0';

  fs.mkdirSync(proofReleaseAssetsDir, { recursive: true });
  fs.writeFileSync(path.join(sourceReleaseAssetsDir, `evaOS Workbench-${version}-mac-arm64.dmg`), 'mac');
  writeMacosBridgeZip(path.join(sourceReleaseAssetsDir, `evaOS Workbench-${version}-mac-arm64.zip`));
  fs.writeFileSync(
    path.join(sourceReleaseAssetsDir, 'latest-arm64-mac.yml'),
    `minimumSystemVersion: '24.0.0'\npath: evaOS Workbench-${version}-mac-arm64.zip\n`
  );

  releaseGate.createReleaseManifest(sourceReleaseAssetsDir, tag, {
    GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
    GITHUB_WORKFLOW: 'Build and Release',
    GITHUB_RUN_ID: '12345',
    GITHUB_RUN_ATTEMPT: '1',
    EVAOS_BETA_RELEASE_COMMIT: 'abc123',
    EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
    EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
    EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
  });

  const sourceManifestPath = path.join(sourceReleaseAssetsDir, 'evaos-beta-release-manifest.json');
  const proofManifestPath = path.join(proofReleaseAssetsDir, 'evaos-beta-release-manifest.json');
  fs.copyFileSync(sourceManifestPath, proofManifestPath);
  fs.copyFileSync(
    path.join(sourceReleaseAssetsDir, 'latest-arm64-mac.yml'),
    path.join(proofReleaseAssetsDir, 'latest-arm64-mac.yml')
  );

  const releaseManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
  fs.writeFileSync(
    path.join(proofReleaseAssetsDir, 'release-assets-reference.json'),
    `${JSON.stringify(
      {
        schema: 'evaos-beta-release-assets-reference/v1',
        tag,
        repository: releaseManifest.repository,
        releaseRunId: releaseManifest.releaseRunId,
        releaseCommit: releaseManifest.releaseCommit,
        assets: releaseManifest.assets.map((asset: { name: string; size: number; sha256: string }) => ({
          name: asset.name,
          size: asset.size,
          sha256: asset.sha256,
        })),
      },
      null,
      2
    )}\n`
  );

  if (options.includeTrustedManifest !== false) {
    fs.mkdirSync(path.join(proofDir, 'trusted-manifest'), { recursive: true });
    fs.copyFileSync(sourceManifestPath, path.join(proofDir, 'trusted-manifest', 'evaos-beta-release-manifest.json'));
  }

  return {
    cleanup: () => fs.rmSync(sourceReleaseAssetsDir, { recursive: true, force: true }),
    proofManifestPath,
    sourceReleaseAssetsDir,
  };
}

describe('evaOS beta release gate', () => {
  it('pins the stable Peekaboo fallback asset and published digest', () => {
    const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/_build-reusable.yml'), 'utf8');

    expect(workflow).toContain("PEEKABOO_VERSION: '3.8.0'");
    expect(workflow).toContain("PYTHON_RUNTIME_VERSION: '3.12.13'");
    expect(workflow).toContain("PYTHON_RUNTIME_RELEASE: '20260510'");
    expect(workflow).toContain(
      "PYTHON_RUNTIME_ARM64_SHA256: '5a30271f8d345a5b02b0c9e4e31e0f1e1455a8e4a04fba95cd9762472abc3b17'"
    );
    expect(workflow).toContain(
      "PYTHON_RUNTIME_X64_SHA256: 'cd369e76973c3179bc578230d8615ab621968ed758c5e32f636eecef4ad79894'"
    );
    expect(workflow).toContain("PEEKABOO_SHA256: '5be06117ed861ac7a87ea1d1e552122db4231bf2cd618ec516d77c66acd39620'");
    expect(workflow).toContain(
      "PEEKABOO_BINARY_SHA256: '4a5c7e28c263c84e406aa1853ef62cad3042b13f40a7a9e044ec74ec42933383'"
    );
    expect(workflow).toContain(
      "PEEKABOO_LICENSE_SHA256: '62316704df7426e5a79d2827ff8aca36e9abb3a73b8e68557030749ebefec667'"
    );
    expect(workflow).toContain('peekaboo-macos-universal.tar.gz');
  });

  it('verifies the pinned Peekaboo digest before exporting the packaging path', () => {
    const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/_build-reusable.yml'), 'utf8');
    const runtimePrep = fs.readFileSync(
      path.join(repoRoot, 'scripts/prepareEvaosDesktopBridgePythonRuntime.sh'),
      'utf8'
    );

    expect(workflow).toContain('shasum -a 256 -c');
    expect(workflow).toContain('EVAOS_PEEKABOO_BIN=$PEEKABOO_BIN');
    expect(workflow).toContain('EVAOS_REQUIRED_PEEKABOO_SOURCE_SHA256=$PEEKABOO_BINARY_SHA256');
    expect(workflow).toContain('EVAOS_PEEKABOO_LICENSE=$PEEKABOO_LICENSE');
    expect(workflow).toContain('TARGET_ARCH: ${{ matrix.arch }}');
    expect(workflow).toContain('scripts/prepareEvaosDesktopBridgePythonRuntime.sh "$TARGET_ARCH"');
    expect(runtimePrep).toContain('EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR=$runtime_dir');
    expect(runtimePrep).toContain('EVAOS_REQUIRED_PYTHON_RUNTIME_SHA256=$runtime_sha256');
    expect(runtimePrep).toContain('import ApplicationServices, Quartz');
  });

  it('requires functional smoke to verify the packaged Peekaboo version', () => {
    const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/workbench-functional-smoke.yml'), 'utf8');

    expect(workflow).toContain('BUNDLED_PEEKABOO_SOURCE_SHA256');
    expect(workflow).toContain('BUNDLED_PEEKABOO_LICENSE_SHA256');
    expect(workflow).toContain('3.8.0');
  });

  it('requires the functional-smoke app job itself to run on Sequoia', () => {
    const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/workbench-functional-smoke.yml'), 'utf8');

    expect(releaseGate.collectFunctionalSmokeConfigIssues(workflow)).toEqual([]);

    const decoyWorkflow = workflow
      .replace('    runs-on: macos-15', '    runs-on: macos-14')
      .concat('\n# runs-on: macos-15\n  unrelated-job:\n    runs-on: macos-15\n');

    expect(releaseGate.collectFunctionalSmokeConfigIssues(decoyWorkflow)).toEqual([
      '.github/workflows/workbench-functional-smoke.yml: macos-arm64-app must run on macos-15',
    ]);
  });

  it('detects strict public beta release mode', () => {
    expect(releaseGate.normalizeBoolean('true')).toBe(true);
    expect(releaseGate.normalizeBoolean('evaos-beta')).toBe(true);
    expect(releaseGate.normalizeBoolean('0')).toBe(false);
    expect(releaseGate.isStrictPublicBetaReleaseEnv({ EVAOS_BETA_PUBLIC_RELEASE: 'true' })).toBe(true);
    expect(releaseGate.isStrictPublicBetaReleaseEnv({ EVAOS_BETA_REQUIRE_SIGNING: '1' })).toBe(true);
    expect(releaseGate.isStrictPublicBetaReleaseEnv({ EVAOS_BETA_PUBLIC_RELEASE: 'false' })).toBe(false);
  });

  it('exports the electron-builder afterSign hook as a callable CommonJS module', () => {
    expect(typeof afterSign).toBe('function');
    expect(afterSign.default).toBe(afterSign);
  });

  it('requires bundled Mac-control helpers to be native and signed by the expected team', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-after-sign-helpers-'));
    const appPath = path.join(dir, 'evaOS Workbench.app');
    const helperDir = path.join(appPath, 'Contents', 'Resources', 'Bridge', 'bin');
    const peekabooPath = path.join(helperDir, 'peekaboo');
    const connectorHelperPath = path.join(helperDir, 'evaos-connector-helper');
    const pythonPath = path.join(appPath, 'Contents', 'Resources', 'Bridge', 'python', 'bin', 'python3.12');
    const pythonDylibPath = path.join(
      appPath,
      'Contents',
      'Resources',
      'Bridge',
      'python',
      'lib',
      'libpython3.12.dylib'
    );
    const signedByExpectedTeam = {
      status: 0,
      stdout: '',
      stderr:
        'Executable=/tmp/helper\nIdentifier=com.evaos.helper\nAuthority=Developer ID Application: Andrew Ryan (TC6MS3T6NN)\nTeamIdentifier=TC6MS3T6NN\n',
    };
    const signedByWrongTeam = {
      status: 0,
      stdout: '',
      stderr:
        'Executable=/tmp/helper\nIdentifier=com.example.helper\nAuthority=Developer ID Application: Other Team (ABCDE12345)\nTeamIdentifier=ABCDE12345\n',
    };

    try {
      writeMachOFixture(peekabooPath);
      writeMachOFixture(connectorHelperPath);
      writeMachOFixture(pythonPath);
      fs.mkdirSync(path.dirname(pythonDylibPath), { recursive: true });
      fs.writeFileSync(pythonDylibPath, Buffer.from('cffaedfe0c000001', 'hex'));
      fs.chmodSync(pythonDylibPath, 0o644);

      const signedRuntimeClosure = vi.fn(() => signedByExpectedTeam);

      expect(() =>
        afterSign.assertMacControlHelperSignatures(
          appPath,
          {
            EVAOS_MAC_CONTROL_HELPER_TEAM_ID: 'TC6MS3T6NN',
            EVAOS_MAC_CONTROL_HELPER_AUTHORITY: 'Developer ID Application: Andrew Ryan (TC6MS3T6NN)',
          },
          signedRuntimeClosure
        )
      ).not.toThrow();
      expect(signedRuntimeClosure).toHaveBeenCalledWith(
        'codesign',
        ['-dv', '--verbose=4', pythonDylibPath],
        expect.any(Object)
      );

      expect(() =>
        afterSign.assertMacControlHelperSignatures(
          appPath,
          { EVAOS_MAC_CONTROL_HELPER_TEAM_ID: 'TC6MS3T6NN' },
          () => signedByWrongTeam
        )
      ).toThrow(/TeamIdentifier=TC6MS3T6NN/);

      writeScriptFixture(connectorHelperPath);
      expect(() =>
        afterSign.assertMacControlHelperSignatures(
          appPath,
          { EVAOS_MAC_CONTROL_HELPER_TEAM_ID: 'TC6MS3T6NN' },
          () => signedByExpectedTeam
        )
      ).toThrow(/native Mach-O executable/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed when public beta signing inputs are missing', () => {
    expect(() => releaseGate.assertPublicBetaReleaseSigningEnv({})).toThrow(/BUILD_CERTIFICATE_BASE64/);
    expect(() =>
      releaseGate.assertPublicBetaReleaseSigningEnv({
        BUILD_CERTIFICATE_BASE64: 'cert',
        P12_PASSWORD: 'password',
        identity: 'Developer ID Application: evaOS',
        appleId: 'release@example.com',
        appleIdPassword: 'app-password',
        teamId: 'TEAMID',
      })
    ).not.toThrow();
    expect(() =>
      releaseGate.assertPublicBetaReleaseSigningEnv({
        BUILD_CERTIFICATE_BASE64: 'cert',
        P12_PASSWORD: 'password',
        identity: 'Developer ID Application: evaOS',
        APPLE_API_KEY: '/secure/AuthKey_ABC123.p8',
        APPLE_API_KEY_ID: 'ABC123',
        APPLE_API_ISSUER: 'd5631714-a680-4b4b-8156-b4ed624c0845',
      })
    ).not.toThrow();
  });

  it('fails closed when notarization inputs are missing', () => {
    expect(() => releaseGate.assertPublicBetaNotarizationEnv({ appleId: 'release@example.com' })).toThrow(
      /appleIdPassword/
    );
    expect(() =>
      releaseGate.assertPublicBetaNotarizationEnv({
        APPLE_ID: 'release@example.com',
        APPLE_ID_PASSWORD: 'app-password',
        TEAM_ID: 'TEAMID',
      })
    ).not.toThrow();
    expect(() =>
      releaseGate.assertPublicBetaNotarizationEnv({
        APPLE_API_KEY: '/secure/AuthKey_ABC123.p8',
        APPLE_API_KEY_ID: 'ABC123',
      })
    ).toThrow(/appleApiIssuer|APPLE_API_ISSUER/);
    expect(() =>
      releaseGate.assertPublicBetaNotarizationEnv({
        APPLE_API_KEY: '/secure/AuthKey_ABC123.p8',
        APPLE_API_KEY_ID: 'ABC123',
        APPLE_API_ISSUER: 'd5631714-a680-4b4b-8156-b4ed624c0845',
      })
    ).not.toThrow();
    expect(() =>
      releaseGate.assertPublicBetaNotarizationEnv({
        APPLE_API_KEY: '/secure/AuthKey_ABC123.p8',
        APPLE_API_KEY_ID: 'ABC123',
        APPLE_API_INDIVIDUAL_KEY: 'true',
      })
    ).toThrow(/appleApiIssuer|APPLE_API_ISSUER/);
    expect(() =>
      releaseGate.assertPublicBetaNotarizationEnv({
        NOTARY_PROFILE: 'evaos-workbench-notary',
      })
    ).not.toThrow();
  });

  it('builds afterSign notarization options for Apple ID, API-key, and keychain credential paths', () => {
    const baseOptions = {
      tool: 'notarytool',
      appBundleId: 'com.evaos.workbench',
      appPath: '/Applications/evaOS Workbench.app',
    };

    expect(
      afterSign.getNotarizationOptions(
        {
          APPLE_ID: 'release@example.com',
          APPLE_ID_PASSWORD: 'app-password',
          TEAM_ID: 'TEAMID',
        },
        baseOptions
      )
    ).toMatchObject({
      ...baseOptions,
      appleId: 'release@example.com',
      appleIdPassword: 'app-password',
      teamId: 'TEAMID',
    });

    expect(
      afterSign.getNotarizationOptions(
        {
          APPLE_ID: 'release@example.com',
          APPLE_ID_PASSWORD: 'app-password',
          TEAM_ID: 'TEAMID',
          APPLE_API_KEY: '/secure/AuthKey_ABC123.p8',
          APPLE_API_KEY_ID: 'ABC123',
          APPLE_API_ISSUER: 'd5631714-a680-4b4b-8156-b4ed624c0845',
        },
        baseOptions
      )
    ).toMatchObject({
      ...baseOptions,
      appleApiKey: '/secure/AuthKey_ABC123.p8',
      appleApiKeyId: 'ABC123',
      appleApiIssuer: 'd5631714-a680-4b4b-8156-b4ed624c0845',
    });

    expect(
      afterSign.getNotarizationOptions(
        {
          APPLE_API_KEY: '/secure/AuthKey_ABC123.p8',
          APPLE_API_KEY_ID: 'ABC123',
          APPLE_API_ISSUER: 'd5631714-a680-4b4b-8156-b4ed624c0845',
        },
        baseOptions
      )
    ).toMatchObject({
      ...baseOptions,
      appleApiKey: '/secure/AuthKey_ABC123.p8',
      appleApiKeyId: 'ABC123',
      appleApiIssuer: 'd5631714-a680-4b4b-8156-b4ed624c0845',
    });

    expect(
      afterSign.getNotarizationOptions(
        {
          APPLE_API_KEY: '/secure/AuthKey_ABC123.p8',
          APPLE_API_KEY_ID: 'ABC123',
          APPLE_API_INDIVIDUAL_KEY: 'true',
        },
        baseOptions
      )
    ).toBeUndefined();

    expect(
      afterSign.getNotarizationOptions(
        {
          NOTARY_PROFILE: 'evaos-workbench-notary',
          NOTARY_KEYCHAIN: '/secure/evaos-release-signing.keychain-db',
          APPLE_API_KEY: '/secure/AuthKey_ABC123.p8',
          APPLE_API_KEY_ID: 'ABC123',
        },
        baseOptions
      )
    ).toMatchObject({
      ...baseOptions,
      keychainProfile: 'evaos-workbench-notary',
      keychain: '/secure/evaos-release-signing.keychain-db',
    });
  });

  it('builds bounded afterSign app notarytool submit args', () => {
    const apiKeyOptions = {
      appleApiKey: '/secure/AuthKey_ABC123.p8',
      appleApiKeyId: 'ABC123',
      appleApiIssuer: 'd5631714-a680-4b4b-8156-b4ed624c0845',
    };
    expect(afterSign.buildAppNotarytoolSubmitArgs('/tmp/evaOS.zip', apiKeyOptions)).toEqual([
      'notarytool',
      'submit',
      '/tmp/evaOS.zip',
      '--key',
      '/secure/AuthKey_ABC123.p8',
      '--key-id',
      'ABC123',
      '--issuer',
      'd5631714-a680-4b4b-8156-b4ed624c0845',
    ]);
    expect(afterSign.buildAppNotarytoolInfoArgs('SUBMISSION-ID', apiKeyOptions)).toEqual([
      'notarytool',
      'info',
      'SUBMISSION-ID',
      '--key',
      '/secure/AuthKey_ABC123.p8',
      '--key-id',
      'ABC123',
      '--issuer',
      'd5631714-a680-4b4b-8156-b4ed624c0845',
    ]);

    expect(
      afterSign.buildAppNotarytoolSubmitArgs('/tmp/evaOS.zip', {
        keychainProfile: 'evaos-workbench-notary',
        keychain: '/secure/evaos-release-signing.keychain-db',
      })
    ).toEqual([
      'notarytool',
      'submit',
      '/tmp/evaOS.zip',
      '--keychain-profile',
      'evaos-workbench-notary',
      '--keychain',
      '/secure/evaos-release-signing.keychain-db',
    ]);

    expect(afterSign.getAppNotaryProcessTimeoutMs({})).toBe(20 * 60 * 1000);
    expect(afterSign.getAppNotaryProcessTimeoutMs({ EVAOS_APP_NOTARY_PROCESS_TIMEOUT_MS: '90000' })).toBe(90000);
    expect(() => afterSign.getAppNotaryProcessTimeoutMs({ EVAOS_APP_NOTARY_PROCESS_TIMEOUT_MS: '-1' })).toThrow(
      /positive integer/
    );
    expect(afterSign.getAppNotaryCommandProcessTimeoutMs({})).toBe(90 * 1000);
    expect(
      afterSign.getAppNotaryCommandProcessTimeoutMs({ EVAOS_APP_NOTARY_COMMAND_PROCESS_TIMEOUT_MS: '45000' })
    ).toBe(45000);
    expect(afterSign.getAppNotaryPollIntervalMs({})).toBe(15 * 1000);
    expect(afterSign.getAppNotaryPollIntervalMs({ EVAOS_APP_NOTARY_POLL_INTERVAL_MS: '1000' })).toBe(1000);
    expect(afterSign.getAppTrustProcessTimeoutMs({})).toBe(5 * 60 * 1000);
    expect(afterSign.getAppTrustProcessTimeoutMs({ EVAOS_APP_TRUST_PROCESS_TIMEOUT_MS: '45000' })).toBe(45000);
    expect(() => afterSign.getAppTrustProcessTimeoutMs({ EVAOS_APP_TRUST_PROCESS_TIMEOUT_MS: '0' })).toThrow(
      /positive integer/
    );
  });

  it('submits app notarization without --wait and polls notarytool info', () => {
    const submitCalls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const submissionId = afterSign.runAppNotarytoolSubmit(
      ['notarytool', 'submit', '/tmp/evaOS.zip', '--keychain-profile', 'evaos-workbench-notary'],
      { EVAOS_APP_NOTARY_COMMAND_PROCESS_TIMEOUT_MS: '30000' },
      (command, args, options) => {
        submitCalls.push({ command, args, options });
        return JSON.stringify({ id: 'SUBMISSION-ID', status: 'In Progress' });
      }
    );

    expect(submissionId).toBe('SUBMISSION-ID');
    expect(submitCalls).toEqual([
      {
        command: 'xcrun',
        args: [
          'notarytool',
          'submit',
          '/tmp/evaOS.zip',
          '--keychain-profile',
          'evaos-workbench-notary',
          '--no-progress',
          '--output-format',
          'json',
        ],
        options: {
          stdio: ['ignore', 'pipe', 'inherit'],
          encoding: 'utf8',
          timeout: 30000,
          killSignal: 'SIGKILL',
        },
      },
    ]);
    expect(submitCalls[0].args).not.toContain('--wait');

    const pollCalls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const result = afterSign.waitForAppNotarySubmission(
      'SUBMISSION-ID',
      { keychainProfile: 'evaos-workbench-notary' },
      {
        EVAOS_APP_NOTARY_COMMAND_PROCESS_TIMEOUT_MS: '30000',
        EVAOS_APP_NOTARY_PROCESS_TIMEOUT_MS: '60000',
        EVAOS_APP_NOTARY_POLL_INTERVAL_MS: '1',
      },
      (command, args, options) => {
        pollCalls.push({ command, args, options });
        return JSON.stringify({ id: 'SUBMISSION-ID', status: 'Accepted' });
      },
      () => {}
    ) as { status: string };

    expect(result.status).toBe('Accepted');
    expect(pollCalls).toEqual([
      {
        command: 'xcrun',
        args: [
          'notarytool',
          'info',
          'SUBMISSION-ID',
          '--keychain-profile',
          'evaos-workbench-notary',
          '--output-format',
          'json',
        ],
        options: {
          stdio: ['ignore', 'pipe', 'inherit'],
          encoding: 'utf8',
          timeout: 30000,
          killSignal: 'SIGKILL',
        },
      },
    ]);
  });

  it('isolates keychain notarization from ambient App Store Connect API env', async () => {
    const keys = [
      'APPLE_API_KEY',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER',
      'APPLE_API_INDIVIDUAL_KEY',
      'appleApiKey',
      'appleApiKeyId',
      'appleApiIssuer',
      'appleApiIndividualKey',
    ];
    const previous = new Map(keys.map((key) => [key, process.env[key]]));
    const assignedValues: Record<string, string> = {
      APPLE_API_KEY: '/secure/AuthKey_ABC123.p8',
      APPLE_API_KEY_ID: 'ABC123',
      APPLE_API_ISSUER: 'issuer',
      APPLE_API_INDIVIDUAL_KEY: 'true',
      appleApiKey: '/secure/AuthKey_ABC123.p8',
      appleApiKeyId: 'ABC123',
      appleApiIssuer: 'issuer',
      appleApiIndividualKey: 'true',
    };

    try {
      for (const [key, value] of Object.entries(assignedValues)) {
        process.env[key] = value;
      }

      await afterSign.withKeychainCredentialIsolation({ keychainProfile: 'evaos-workbench-notary' }, async () => {
        for (const key of keys) {
          expect(process.env[key]).toBeUndefined();
        }
      });

      for (const key of keys) {
        expect(process.env[key]).toBe(assignedValues[key]);
      }
    } finally {
      for (const key of keys) {
        const value = previous.get(key);
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('staples, validates, and Gatekeeper-assesses the notarized app bundle', () => {
    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];

    afterSign.stapleAndValidateApp('/release/evaOS Workbench.app', (command, args, options) => {
      calls.push({ command, args, options });
    });

    expect(calls).toEqual([
      {
        command: 'xcrun',
        args: ['stapler', 'staple', '/release/evaOS Workbench.app'],
        options: { stdio: 'inherit', timeout: 5 * 60 * 1000, killSignal: 'SIGKILL' },
      },
      {
        command: 'xcrun',
        args: ['stapler', 'validate', '/release/evaOS Workbench.app'],
        options: { stdio: 'inherit', timeout: 5 * 60 * 1000, killSignal: 'SIGKILL' },
      },
      {
        command: 'spctl',
        args: ['--assess', '--type', 'execute', '--verbose', '/release/evaOS Workbench.app'],
        options: { stdio: 'inherit', timeout: 5 * 60 * 1000, killSignal: 'SIGKILL' },
      },
    ]);
  });

  it('builds notarytool submit args for DMG finalization credential paths', () => {
    expect(
      macDmgFinalizer.buildNotarytoolSubmitArgs('/release/evaOS.dmg', {
        NOTARY_PROFILE: 'evaos-workbench-notary',
        NOTARY_KEYCHAIN: '/secure/evaos-release-signing.keychain-db',
      })
    ).toEqual([
      'notarytool',
      'submit',
      '/release/evaOS.dmg',
      '--keychain-profile',
      'evaos-workbench-notary',
      '--keychain',
      '/secure/evaos-release-signing.keychain-db',
    ]);
    expect(
      macDmgFinalizer.buildNotarytoolInfoArgs('SUBMISSION-ID', {
        NOTARY_PROFILE: 'evaos-workbench-notary',
        NOTARY_KEYCHAIN: '/secure/evaos-release-signing.keychain-db',
      })
    ).toEqual([
      'notarytool',
      'info',
      'SUBMISSION-ID',
      '--keychain-profile',
      'evaos-workbench-notary',
      '--keychain',
      '/secure/evaos-release-signing.keychain-db',
    ]);

    expect(
      macDmgFinalizer.buildNotarytoolSubmitArgs('/release/evaOS.dmg', {
        APPLE_ID: 'release@example.com',
        APPLE_ID_PASSWORD: 'app-password',
        TEAM_ID: 'TEAMID',
      })
    ).toEqual([
      'notarytool',
      'submit',
      '/release/evaOS.dmg',
      '--apple-id',
      'release@example.com',
      '--password',
      'app-password',
      '--team-id',
      'TEAMID',
    ]);

    expect(
      macDmgFinalizer.buildNotarytoolSubmitArgs('/release/evaOS.dmg', {
        APPLE_API_KEY: '/secure/AuthKey_ABC123.p8',
        APPLE_API_KEY_ID: 'ABC123',
        APPLE_API_ISSUER: 'd5631714-a680-4b4b-8156-b4ed624c0845',
        NOTARY_PROFILE: 'evaos-workbench-notary',
      })
    ).toEqual([
      'notarytool',
      'submit',
      '/release/evaOS.dmg',
      '--key',
      '/secure/AuthKey_ABC123.p8',
      '--key-id',
      'ABC123',
      '--issuer',
      'd5631714-a680-4b4b-8156-b4ed624c0845',
    ]);

    expect(() =>
      macDmgFinalizer.buildNotarytoolSubmitArgs('/release/evaOS.dmg', {
        APPLE_API_KEY: '/secure/AuthKey_ABC123.p8',
        APPLE_API_KEY_ID: 'ABC123',
        NOTARY_PROFILE: 'evaos-workbench-notary',
      })
    ).toThrow(/APPLE_API_ISSUER/);
  });

  it('keeps DMG codesign default-on and separate from notarization keychain credentials', () => {
    expect(macDmgFinalizer.shouldCodesignDmg({})).toBe(true);
    expect(macDmgFinalizer.shouldCodesignDmg({ EVAOS_DMG_CODESIGN: 'true' })).toBe(true);
    expect(macDmgFinalizer.shouldCodesignDmg({ EVAOS_DMG_CODESIGN: 'false' })).toBe(false);
    expect(macDmgFinalizer.getDmgCodesignMode({})).toBe('sign');
    expect(macDmgFinalizer.getDmgCodesignMode({ EVAOS_DMG_CODESIGN_MODE: 'verify-existing' })).toBe('verify-existing');
    expect(() => macDmgFinalizer.getDmgCodesignMode({ EVAOS_DMG_CODESIGN_MODE: 'ambient' })).toThrow(
      /EVAOS_DMG_CODESIGN_MODE/
    );

    expect(
      macDmgFinalizer.buildDmgCodesignArgs('/release/evaOS.dmg', 'Developer ID Application: evaOS', {
        NOTARY_KEYCHAIN: '/secure/evaos-release-signing.keychain-db',
        RELEASE_KEYCHAIN: '/secure/evaos-release-signing.keychain-db',
        KEYCHAIN: '/secure/evaos-release-signing.keychain-db',
      })
    ).toEqual(['--force', '--sign', 'Developer ID Application: evaOS', '--timestamp=none', '/release/evaOS.dmg']);

    expect(
      macDmgFinalizer.buildDmgCodesignArgs('/release/evaOS.dmg', 'Developer ID Application: evaOS', {
        EVAOS_DMG_CODESIGN_KEYCHAIN: '/secure/build.keychain-db',
        NOTARY_KEYCHAIN: '/secure/evaos-release-signing.keychain-db',
        EVAOS_DMG_CODESIGN_TIMESTAMP: 'true',
      })
    ).toEqual([
      '--force',
      '--sign',
      'Developer ID Application: evaOS',
      '--timestamp',
      '--keychain',
      '/secure/build.keychain-db',
      '/release/evaOS.dmg',
    ]);
  });

  it('uses a bounded external process timeout for DMG notarytool submit', () => {
    expect(macDmgFinalizer.getNotaryProcessTimeoutMs({})).toBe(20 * 60 * 1000);
    expect(macDmgFinalizer.getNotaryProcessTimeoutMs({ EVAOS_DMG_NOTARY_PROCESS_TIMEOUT_MS: '90000' })).toBe(90000);
    expect(() => macDmgFinalizer.getNotaryProcessTimeoutMs({ EVAOS_DMG_NOTARY_PROCESS_TIMEOUT_MS: 'invalid' })).toThrow(
      /positive integer/
    );
    expect(macDmgFinalizer.getNotaryCommandProcessTimeoutMs({})).toBe(90 * 1000);
    expect(
      macDmgFinalizer.getNotaryCommandProcessTimeoutMs({ EVAOS_DMG_NOTARY_COMMAND_PROCESS_TIMEOUT_MS: '45000' })
    ).toBe(45000);
    expect(macDmgFinalizer.getNotaryPollIntervalMs({})).toBe(15 * 1000);
    expect(macDmgFinalizer.getNotaryPollIntervalMs({ EVAOS_DMG_NOTARY_POLL_INTERVAL_MS: '1000' })).toBe(1000);
    expect(macDmgFinalizer.getDmgTrustProcessTimeoutMs({})).toBe(5 * 60 * 1000);
    expect(macDmgFinalizer.getDmgTrustProcessTimeoutMs({ EVAOS_DMG_TRUST_PROCESS_TIMEOUT_MS: '30000' })).toBe(30000);
    expect(macDmgFinalizer.getDmgCodesignProcessTimeoutMs({})).toBe(15 * 60 * 1000);
    expect(macDmgFinalizer.getDmgCodesignProcessTimeoutMs({ EVAOS_DMG_CODESIGN_PROCESS_TIMEOUT_MS: '900000' })).toBe(
      900000
    );
    expect(() =>
      macDmgFinalizer.getDmgCodesignProcessTimeoutMs({ EVAOS_DMG_CODESIGN_PROCESS_TIMEOUT_MS: 'invalid' })
    ).toThrow(/positive integer/);
  });

  it('finds macOS DMG artifacts in stable sort order', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-dmg-finalizer-'));
    try {
      fs.writeFileSync(path.join(dir, 'zeta.dmg'), 'dmg');
      fs.writeFileSync(path.join(dir, 'alpha.dmg'), 'dmg');
      fs.writeFileSync(path.join(dir, 'alpha.zip'), 'zip');

      expect(macDmgFinalizer.findDmgArtifacts(dir).map((filePath) => path.basename(filePath))).toEqual([
        'alpha.dmg',
        'zeta.dmg',
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes the repository release config audit', () => {
    const builder = fs.readFileSync(path.join(repoRoot, 'packages/desktop/electron-builder.yml'), 'utf8');
    const section = (name: string) => {
      const lines = builder.split(/\r?\n/);
      const start = lines.findIndex((line) => line === `${name}:`);
      if (start === -1) return '';
      const result = [lines[start]];
      for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (line && !line.startsWith(' ') && !line.startsWith('-') && !line.startsWith('#')) break;
        result.push(line);
      }
      return result.join('\n');
    };

    expect(builder).not.toMatch(/^executableName:/m);
    expect(section('win')).toContain('executableName: EvaOSWorkbench');
    expect(section('linux')).toContain('executableName: EvaOSWorkbench');
    expect(section('mac')).not.toContain('executableName:');

    expect(releaseGate.collectReleaseConfigIssues(repoRoot)).toEqual([]);
    expect(releaseGate.assertReleaseConfig(repoRoot)).toBe(true);
  });

  it('forces the no-ACP managed resource profile in the beta release workflow', () => {
    const buildRelease = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-and-release.yml'), 'utf8');

    expect(releaseGate.collectBuildReleaseWorkflowIssues(buildRelease)).toEqual([]);

    const driftedWithDecoys = buildRelease
      .replace('      managed_resources_bundle: no-acp', '      managed_resources_bundle: full')
      .concat(
        '\n# managed_resources_bundle: no-acp\n  decoy-job:\n    with:\n      managed_resources_bundle: no-acp\n'
      );

    expect(releaseGate.collectBuildReleaseWorkflowIssues(driftedWithDecoys)).toEqual([
      '.github/workflows/build-and-release.yml: jobs.build-pipeline.with.managed_resources_bundle must be exactly no-acp',
    ]);
  });

  it('fails closed on an existing release tag instead of mutating the version after build', () => {
    const buildRelease = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-and-release.yml'), 'utf8');

    expect(buildRelease).not.toContain('bun pm version');
    expect(buildRelease).toContain('Refusing post-build version mutation because tag $TAG_NAME already exists.');
    expect(buildRelease).toContain('Bump package.json and bun.lock in a reviewed source commit');
  });

  it('does not require optional Business Browser action proof in the release workflow config audit', () => {
    const issues = releaseGate.collectReleaseConfigIssues(repoRoot);

    expect(
      issues.filter((issue: string) => /business-browser\.json|Business Browser live proof artifact/i.test(issue))
    ).toEqual([]);
  });

  it('requires the release workflow to record follow-up canary disposition', () => {
    const issues = releaseGate.collectReleaseConfigIssues(repoRoot);

    expect(issues.filter((issue: string) => /follow-up canary disposition/i.test(issue))).toEqual([]);
  });

  it('verifies live broker-surface proof before distribution can publish', () => {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-broker-proof-'));
    try {
      writeBrokerLiveCanaryProof(proofDir);

      expect(releaseGate.verifyBrokerLiveCanaryProof(proofDir, liveCanaryProofEnv)).toBe(true);
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('uses the broker canary customer as the expected live broker proof customer when configured', () => {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-broker-proof-broker-customer-'));
    try {
      writeBrokerLiveCanaryProof(proofDir);

      expect(
        releaseGate.verifyBrokerLiveCanaryProof(proofDir, {
          AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID: 'cus_123',
          AIONUI_EVAOS_CUSTOMER_ID: 'fixture-customer',
          EVAOS_LIVE_CANARY_MAX_PROOF_AGE_HOURS: '24',
        })
      ).toBe(true);
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('rejects broker proof packets that omit a required surface or contain raw launch material', () => {
    const missingSurfaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-broker-proof-missing-'));
    const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-broker-proof-secret-'));
    try {
      writeBrokerLiveCanaryProof(missingSurfaceDir, {
        surfaces: [
          {
            surface: 'evaos',
            runtime: 'openclaw',
            status: 'running',
            sourcePointer: 'broker:runtime_status:openclaw',
            auditId: 'audit_status_evaos',
            checkedAt: new Date().toISOString(),
            secretScan: 'passed',
            launch: {
              status: 'attached',
              launchMode: 'dashboard_surface',
              sourcePointer: 'broker:runtime_launch:openclaw',
              auditId: 'audit_launch_evaos',
              launchUrlRedacted: true,
              checkedAt: new Date().toISOString(),
              secretScan: 'passed',
            },
          },
        ],
      });
      expect(() => releaseGate.verifyBrokerLiveCanaryProof(missingSurfaceDir, liveCanaryProofEnv)).toThrow(
        /missing required surface/
      );

      writeBrokerLiveCanaryProof(secretDir, {
        surfaces: [
          {
            surface: 'evaos',
            runtime: 'openclaw',
            status: 'running',
            sourcePointer: 'broker:runtime_status:openclaw',
            auditId: 'audit_status_evaos',
            checkedAt: new Date().toISOString(),
            secretScan: 'passed',
            launch: {
              status: 'attached',
              launchMode: 'dashboard_surface',
              launch_url: 'https://runtime.example.test/callback?desktop_session=eds_raw_secret',
              sourcePointer: 'broker:runtime_launch:openclaw',
              auditId: 'audit_launch_evaos',
              launchUrlRedacted: true,
              checkedAt: new Date().toISOString(),
              secretScan: 'passed',
            },
          },
        ],
      });
      expect(() => releaseGate.verifyBrokerLiveCanaryProof(secretDir, liveCanaryProofEnv)).toThrow(
        /secret material|missing required surface/
      );
    } finally {
      fs.rmSync(missingSurfaceDir, { recursive: true, force: true });
      fs.rmSync(secretDir, { recursive: true, force: true });
    }
  });

  it('rejects malformed live broker proof packets before scanning nested fields', () => {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-broker-proof-malformed-'));
    try {
      writeBusinessBrowserLiveCanaryProof(proofDir);
      fs.writeFileSync(path.join(proofDir, 'broker-runtime-status.json'), '[]\n');

      expect(() => releaseGate.verifyBrokerLiveCanaryProof(proofDir, liveCanaryProofEnv)).toThrow(
        /Unexpected live broker canary proof schema/
      );
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('rejects malformed Business Browser proof packets before scanning nested fields', () => {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-broker-proof-browser-malformed-'));
    try {
      writeBrokerLiveCanaryProof(proofDir);
      fs.writeFileSync(path.join(proofDir, 'business-browser.json'), '[]\n');

      expect(() => releaseGate.verifyBrokerLiveCanaryProof(proofDir, liveCanaryProofEnv)).toThrow(
        /Unexpected Business Browser live proof schema/
      );
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('rejects live broker proof packets that omit launch proof or do not redact launch URLs', () => {
    const missingLaunchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-broker-proof-launch-missing-'));
    const unredactedLaunchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-broker-proof-launch-unredacted-'));
    try {
      writeBrokerLiveCanaryProof(missingLaunchDir);
      mutateBrokerLiveCanaryProof(missingLaunchDir, (proof) => {
        const surfaces = proof.surfaces as Array<Record<string, unknown>>;
        delete surfaces[0].launch;
      });
      expect(() => releaseGate.verifyBrokerLiveCanaryProof(missingLaunchDir, liveCanaryProofEnv)).toThrow(
        /missing launch proof/
      );

      writeBrokerLiveCanaryProof(unredactedLaunchDir);
      mutateBrokerLiveCanaryProof(unredactedLaunchDir, (proof) => {
        const surfaces = proof.surfaces as Array<Record<string, Record<string, unknown>>>;
        surfaces[0].launch.launchUrlRedacted = false;
      });
      expect(() => releaseGate.verifyBrokerLiveCanaryProof(unredactedLaunchDir, liveCanaryProofEnv)).toThrow(
        /redact launch URL/
      );
    } finally {
      fs.rmSync(missingLaunchDir, { recursive: true, force: true });
      fs.rmSync(unredactedLaunchDir, { recursive: true, force: true });
    }
  });

  it('accepts broker surface proof without deeper Business Browser action proof', () => {
    const missingBrowserDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-broker-proof-browser-missing-'));
    try {
      writeBrokerLiveCanaryProof(missingBrowserDir);
      fs.rmSync(path.join(missingBrowserDir, 'business-browser.json'));
      expect(releaseGate.verifyBrokerLiveCanaryProof(missingBrowserDir, liveCanaryProofEnv)).toBe(true);
    } finally {
      fs.rmSync(missingBrowserDir, { recursive: true, force: true });
    }
  });

  it('rejects non-acceptance Business Browser action proof when the optional packet is present', () => {
    const dryRunDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-broker-proof-browser-dry-run-'));
    try {
      writeBrokerLiveCanaryProof(
        dryRunDir,
        {},
        {
          dryRun: true,
          acceptanceProof: false,
          customerIsolation: 'not-run',
          negativeBoundary: 'not-run',
        }
      );
      expect(() => releaseGate.verifyBrokerLiveCanaryProof(dryRunDir, liveCanaryProofEnv)).toThrow(
        /non-dry-run acceptance proof/
      );
    } finally {
      fs.rmSync(dryRunDir, { recursive: true, force: true });
    }
  });

  it('rejects stale or cross-customer live broker proof packets', () => {
    const staleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-broker-proof-stale-'));
    const mismatchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-broker-proof-mismatch-'));
    const releaseCanaryMismatchDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'evaos-live-broker-proof-release-canary-mismatch-')
    );
    try {
      writeBrokerLiveCanaryProof(staleDir, {
        checkedAt: '2020-01-01T00:00:00.000Z',
      });
      expect(() => releaseGate.verifyBrokerLiveCanaryProof(staleDir, liveCanaryProofEnv)).toThrow(/stale/);

      writeBrokerLiveCanaryProof(
        mismatchDir,
        {},
        {
          customerId: 'different_customer',
        }
      );
      expect(() => releaseGate.verifyBrokerLiveCanaryProof(mismatchDir, liveCanaryProofEnv)).toThrow(
        /customer mismatch/
      );

      writeBrokerLiveCanaryProof(releaseCanaryMismatchDir, {
        releaseCanaryCustomerId: 'release_canary_a',
      });
      expect(() =>
        releaseGate.verifyBrokerLiveCanaryProof(releaseCanaryMismatchDir, {
          ...liveCanaryProofEnv,
          EVAOS_LIVE_CANARY_EXPECTED_RELEASE_CANARY_CUSTOMER_ID: 'release_canary_b',
        })
      ).toThrow(/releaseCanaryCustomerId/);
    } finally {
      fs.rmSync(staleDir, { recursive: true, force: true });
      fs.rmSync(mismatchDir, { recursive: true, force: true });
      fs.rmSync(releaseCanaryMismatchDir, { recursive: true, force: true });
    }
  });

  it('rejects duplicate or unknown live broker proof surfaces', () => {
    const duplicateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-broker-proof-duplicate-surface-'));
    const unknownDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-broker-proof-unknown-surface-'));
    try {
      writeBrokerLiveCanaryProof(duplicateDir);
      mutateBrokerLiveCanaryProof(duplicateDir, (proof) => {
        const surfaces = proof.surfaces as Array<Record<string, unknown>>;
        surfaces[1] = { ...surfaces[0] };
      });
      expect(() => releaseGate.verifyBrokerLiveCanaryProof(duplicateDir, liveCanaryProofEnv)).toThrow(
        /duplicate surface/
      );

      writeBrokerLiveCanaryProof(unknownDir);
      mutateBrokerLiveCanaryProof(unknownDir, (proof) => {
        const surfaces = proof.surfaces as Array<Record<string, unknown>>;
        surfaces.push({
          surface: 'unknown-dashboard',
          runtime: 'unknown',
          status: 'running',
          sourcePointer: 'broker:runtime_status:unknown',
          auditId: 'audit_status_unknown',
          checkedAt: new Date().toISOString(),
          secretScan: 'passed',
          launch: {
            status: 'attached',
            launchMode: 'dashboard_surface',
            sourcePointer: 'broker:runtime_launch:unknown',
            auditId: 'audit_launch_unknown',
            launchUrlRedacted: true,
            checkedAt: new Date().toISOString(),
            secretScan: 'passed',
          },
        });
      });
      expect(() => releaseGate.verifyBrokerLiveCanaryProof(unknownDir, liveCanaryProofEnv)).toThrow(/unknown surface/);
    } finally {
      fs.rmSync(duplicateDir, { recursive: true, force: true });
      fs.rmSync(unknownDir, { recursive: true, force: true });
    }
  });

  it('requires an explicit expected customer id for live broker proof verification', () => {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-broker-proof-unbound-customer-'));
    try {
      writeBrokerLiveCanaryProof(proofDir);
      expect(() => releaseGate.verifyBrokerLiveCanaryProof(proofDir, {})).toThrow(/EXPECTED_CUSTOMER_ID/);
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('rejects development beta tags for public distribution', () => {
    expect(() => releaseGate.assertPublicDistributionTag('evaos-beta-v2.1.10-evaos-beta.0')).not.toThrow();
    expect(() => releaseGate.assertPublicDistributionTag('evaos-beta-v2.1.10-evaos-beta.0-dev-abc123')).toThrow(
      /development beta tag/
    );
    expect(() => releaseGate.assertPublicDistributionTag('evaos-beta-v2.1.10-evaos-beta-dev')).toThrow(
      /development beta tag/
    );
    expect(() => releaseGate.assertPublicDistributionTag('evaos-beta-v2.1.10')).toThrow(/evaos-beta version marker/);
    expect(() => releaseGate.assertPublicDistributionTag('v2.1.10')).toThrow(/non-evaOS beta tag/);
  });

  it('requires the macOS 15 Darwin kernel floor in arm64 updater metadata', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-updater-system-floor-'));
    try {
      const zipName = 'evaOS.Workbench-2.1.32-mac-arm64.zip';
      fs.writeFileSync(path.join(dir, zipName), 'zip');
      fs.writeFileSync(path.join(dir, 'latest-arm64-mac.yml'), `version: 2.1.32\npath: ${zipName}\n`);

      expect(() => releaseGate.assertMacosAutoUpdateMetadata(dir, 'macos-arm64')).toThrow(
        /minimumSystemVersion.*24\.0\.0/
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes and verifies release manifests with exact asset checksums', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-release-'));
    try {
      fs.writeFileSync(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'mac');
      writeMacosBridgeZip(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.zip'));
      fs.writeFileSync(
        path.join(dir, 'latest-arm64-mac.yml'),
        "minimumSystemVersion: '24.0.0'\npath: evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.zip\n"
      );

      releaseGate.createReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
        GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
        GITHUB_WORKFLOW: 'PR Checks',
        EVAOS_BETA_RELEASE_WORKFLOW: 'Build and Release',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '1',
        EVAOS_BETA_RELEASE_COMMIT: 'abc123',
        EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
        EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
        EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
      });

      expect(
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
        })
      ).toBe(true);

      fs.writeFileSync(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'tampered');
      expect(() =>
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
        })
      ).toThrow(/checksum/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects macOS release ZIPs without exact Peekaboo package proof', () => {
    const cases = [
      {
        name: 'missing binary',
        options: { omitPeekaboo: true },
        expected: /Peekaboo binary/,
      },
      {
        name: 'missing license',
        options: { omitLicense: true },
        expected: /Peekaboo license/,
      },
      {
        name: 'mismatched license digest',
        options: { manifestLicenseSha256: '0'.repeat(64) },
        expected: /license digest/,
      },
      {
        name: 'mismatched source digest',
        options: { sourceSha256: '0'.repeat(64) },
        expected: /source digest/,
      },
      {
        name: 'self-consistent altered CPython license',
        options: { tamperPythonLicense: true },
        expected: /Python runtime provenance|CPython license digest/,
      },
      {
        name: 'wrong PyObjC architecture',
        options: { wrongObjcArchitecture: true },
        expected: /PyObjC native runtime architecture/,
      },
      {
        name: 'wrong Python source URL',
        options: { wrongPythonSourceUrl: true },
        expected: /Python runtime provenance/,
      },
    ];

    for (const testCase of cases) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `evaos-beta-peekaboo-${testCase.name.replaceAll(' ', '-')}-`));
      try {
        const tag = writeMacosArm64ReleaseFixture(dir, testCase.options);
        expect(() =>
          releaseGate.verifyReleaseManifest(dir, tag, {
            GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
            EXPECTED_RELEASE_COMMIT: 'abc123',
            EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
            EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
          })
        ).toThrow(testCase.expected);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('accepts a universal Mach-O Python runtime containing the target slice', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-universal-python-'));
    try {
      const tag = writeMacosArm64ReleaseFixture(dir, { universalPythonRuntime: true });
      expect(
        releaseGate.verifyReleaseManifest(dir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
        })
      ).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('verifies release manifests without buffering the full macOS ZIP entry list', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-release-large-zip-'));
    try {
      fs.writeFileSync(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'mac');
      writeMacosBridgeZip(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.zip'), {
        extraEntryCount: 20000,
      });
      fs.writeFileSync(
        path.join(dir, 'latest-arm64-mac.yml'),
        "minimumSystemVersion: '24.0.0'\npath: evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.zip\n"
      );

      releaseGate.createReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
        GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
        GITHUB_WORKFLOW: 'PR Checks',
        EVAOS_BETA_RELEASE_WORKFLOW: 'Build and Release',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '1',
        EVAOS_BETA_RELEASE_COMMIT: 'abc123',
        EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
        EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
        EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
      });

      expect(
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
        })
      ).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects DMG-only macOS updater metadata because Electron auto-update requires ZIP metadata', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-release-dmg-only-'));
    try {
      fs.writeFileSync(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'mac');
      fs.writeFileSync(
        path.join(dir, 'latest-arm64-mac.yml'),
        "minimumSystemVersion: '24.0.0'\npath: evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.dmg\n"
      );

      releaseGate.createReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
        GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
        GITHUB_WORKFLOW: 'Build and Release',
        EVAOS_BETA_RELEASE_WORKFLOW: 'Build and Release',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '1',
        EVAOS_BETA_RELEASE_COMMIT: 'abc123',
        EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
        EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
      });

      expect(() =>
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
        })
      ).toThrow(/must reference \.zip/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('verifies release manifests for Windows-only release assets', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-release-windows-'));
    try {
      fs.writeFileSync(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-win-x64.exe'), 'win-x64');
      fs.writeFileSync(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-win-arm64.exe'), 'win-arm64');
      fs.writeFileSync(path.join(dir, 'latest.yml'), 'path: evaOS Workbench-2.1.10-evaos-beta.0-win-x64.exe\n');
      fs.writeFileSync(
        path.join(dir, 'latest-win-arm64.yml'),
        'path: evaOS Workbench-2.1.10-evaos-beta.0-win-arm64.exe\n'
      );

      const manifest = releaseGate.createReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
        GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
        GITHUB_WORKFLOW: 'Build and Release',
        EVAOS_BETA_RELEASE_WORKFLOW: 'Build and Release',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '1',
        EVAOS_BETA_RELEASE_COMMIT: 'abc123',
        EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
        EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
        EVAOS_RELEASE_TARGET_PLATFORMS: 'windows',
      }) as { releaseTargetPlatforms: string };

      expect(manifest.releaseTargetPlatforms).toBe('windows');
      expect(
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'windows',
        })
      ).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('verifies explicit local-signed DMG fallback release manifests with proof provenance', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-release-local-dmg-'));
    const sourceSha = 'a'.repeat(40);
    try {
      fs.writeFileSync(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'mac-arm64');
      fs.writeFileSync(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-x64.dmg'), 'mac-x64');
      writeMacosBridgeZip(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.zip'));
      writeMacosBridgeZip(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-x64.zip'));
      fs.writeFileSync(
        path.join(dir, 'latest-arm64-mac.yml'),
        "minimumSystemVersion: '24.0.0'\npath: evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.zip\n"
      );
      fs.writeFileSync(
        path.join(dir, 'latest-mac.yml'),
        "minimumSystemVersion: '24.0.0'\npath: evaOS Workbench-2.1.10-evaos-beta.0-mac-x64.zip\n"
      );

      const manifest = releaseGate.createReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
        GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
        EVAOS_BETA_RELEASE_WORKFLOW: 'Build and Release',
        EVAOS_BETA_RELEASE_COMMIT: sourceSha,
        EVAOS_BETA_RELEASE_BRANCH: 'evaos/beta-rc-20260612',
        EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
        EVAOS_BETA_RELEASE_PROVENANCE_MODE: releaseGate.RELEASE_PROVENANCE_LOCAL_SIGNED_DMG_FALLBACK,
        EVAOS_BETA_LOCAL_DMG_SOURCE_RUN_ID: '27459204891',
        EVAOS_BETA_LOCAL_DMG_SOURCE_WORKFLOW: 'Build and Release',
        EVAOS_BETA_LOCAL_DMG_SOURCE_CONCLUSION: 'failure',
        EVAOS_BETA_LOCAL_DMG_SOURCE_SHA: sourceSha,
        EVAOS_BETA_LOCAL_DMG_SOURCE_BRANCH: 'evaos/beta-rc-20260612',
        EVAOS_BETA_LOCAL_DMG_SOURCE_ARTIFACTS: 'macos-build-arm64,macos-build-x64',
        EVAOS_BETA_LOCAL_DMG_FALLBACK_REASON: 'ci-dmg-codesign-timeout',
        EVAOS_BETA_LOCAL_DMG_FINALIZATION_PROOF_REF: 'gh-proof-run-27459204891',
        EVAOS_BETA_LOCAL_DMG_NOTARY_SUBMISSION_IDS:
          '19f29881-3c5e-4c93-a8db-e227a17e1324,ee658e30-bbed-4057-bae7-002899da8117',
      });

      expect(releaseGate.isLocalSignedDmgFallbackManifest(manifest)).toBe(true);
      expect(() =>
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: sourceSha,
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
        })
      ).toThrow(/EVAOS_BETA_LOCAL_SIGNED_DMG_FALLBACK_ACK/);
      expect(
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: sourceSha,
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_BETA_LOCAL_SIGNED_DMG_FALLBACK_ACK: releaseGate.LOCAL_SIGNED_DMG_FALLBACK_ACK,
        })
      ).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults local-signed DMG provenance to arm64-only source artifacts for the macos-arm64 profile', () => {
    const provenance = releaseGate.releaseProvenanceFromEnv({
      EVAOS_BETA_RELEASE_PROVENANCE_MODE: releaseGate.RELEASE_PROVENANCE_LOCAL_SIGNED_DMG_FALLBACK,
      EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
      EVAOS_BETA_LOCAL_DMG_SOURCE_RUN_ID: '27459204891',
      EVAOS_BETA_LOCAL_DMG_SOURCE_SHA: 'a'.repeat(40),
      EVAOS_BETA_LOCAL_DMG_SOURCE_BRANCH: 'evaos/beta-rc-20260612',
    }) as { sourceArtifactNames: string[] };

    expect(provenance.sourceArtifactNames).toEqual(['macos-build-arm64']);
  });

  it('binds distribution verification to the trusted workflow manifest artifact', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-trusted-release-'));
    try {
      fs.writeFileSync(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'mac');
      writeMacosBridgeZip(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.zip'));
      fs.writeFileSync(
        path.join(dir, 'latest-arm64-mac.yml'),
        "minimumSystemVersion: '24.0.0'\npath: evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.zip\n"
      );

      releaseGate.createReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
        GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
        GITHUB_WORKFLOW: 'Build and Release',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '1',
        EVAOS_BETA_RELEASE_COMMIT: 'abc123',
        EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
        EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
        EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
      });

      const releaseManifestPath = path.join(dir, 'evaos-beta-release-manifest.json');
      const trustedManifestPath = path.join(dir, 'trusted-evaos-beta-release-manifest.json');
      fs.copyFileSync(releaseManifestPath, trustedManifestPath);

      expect(
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_BETA_TRUSTED_MANIFEST_PATH: trustedManifestPath,
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
        })
      ).toBe(true);

      const mutableReleaseManifest = JSON.parse(fs.readFileSync(releaseManifestPath, 'utf8'));
      mutableReleaseManifest.releaseRunAttempt = '2';
      fs.writeFileSync(releaseManifestPath, `${JSON.stringify(mutableReleaseManifest, null, 2)}\n`);

      expect(() =>
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_BETA_TRUSTED_MANIFEST_PATH: trustedManifestPath,
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
        })
      ).toThrow(/trusted workflow artifact/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('verifies a release candidate proof packet with install, launch, updater, rollback, and support evidence', () => {
    const tag = 'evaos-beta-v2.1.10-evaos-beta.0';
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-rc-proof-'));
    let cleanupReleaseAssets = () => {};

    try {
      cleanupReleaseAssets = writeProofReleaseAssetsReference(proofDir, tag).cleanup;

      releaseGate.writeRcProofTemplate(proofDir, tag);
      const manifestPath = path.join(proofDir, 'evaos-beta-rc-proof.json');
      const rcManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      rcManifest.checks = rcManifest.checks.map((check: { status: string }) => ({ ...check, status: 'pass' }));
      rcManifest.macosX64.reason = 'macOS x64 is explicitly deferred because this beta candidate only includes arm64.';
      fs.writeFileSync(manifestPath, `${JSON.stringify(rcManifest, null, 2)}\n`);

      writeArm64TrustEvidence(proofDir);
      fs.writeFileSync(
        path.join(proofDir, 'codesign-macos-arm64.txt'),
        '/Applications/evaOS Workbench.app: valid on disk\n/Applications/evaOS Workbench.app: satisfies its Designated Requirement\n'
      );
      fs.writeFileSync(path.join(proofDir, 'spctl-macos-arm64.txt'), '/Applications/evaOS Workbench.app: accepted\n');
      fs.writeFileSync(
        path.join(proofDir, 'install-smoke.md'),
        'PASS: DMG copied to /Applications/evaOS Workbench.app without replacing the released fallback app.\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'launch-smoke.md'),
        'PASS: evaOS Workbench launched with stable Workbench identity, protocol scheme evaos-workbench, and no upstream AionUi feed.\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'protocol-identity.md'),
        'PASS: protocol scheme evaos-workbench is declared by com.evaos.workbench.\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'installed-app-path-hygiene.md'),
        [
          'PASS: exact app path /Applications/evaOS Workbench.app used for signed installed-app proof.',
          'PASS: no stale indexed Workbench apps under Lexar proof trees.',
          'PASS: no stale running Workbench apps outside /Applications/evaOS Workbench.app.',
          'PASS: Computer Use exact path rule recorded; no bundle-id-only launch.',
          'PASS: OpenClaw bridge tools selected unless Computer Use is explicitly mounted in that runtime.',
        ].join('\n')
      );
      fs.writeFileSync(
        path.join(proofDir, 'updater-feed-audit.md'),
        'PASS: update repo is 100yenadmin/evaOS-GUI and iOfficeAI/AionUi blocked for beta assets.\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'rollback-smoke.md'),
        'PASS: candidate app rolled back; released fallback app launched; data/cache disposition recorded; protocol handler state evaos-workbench / com.evaos.workbench inspected; broker login/session state remained usable.\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'support-notes.md'),
        'Support route: 100yenadmin/evaOS-GUI. The released macOS app remains the fallback while beta is gated.\n'
      );

      expect(
        releaseGate.verifyRcProof(proofDir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'windows',
        })
      ).toBe(true);
    } finally {
      cleanupReleaseAssets();
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('requires a trusted workflow manifest artifact for release candidate proof', () => {
    const tag = 'evaos-beta-v2.1.10-evaos-beta.0';
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-rc-proof-untrusted-'));
    let cleanupReleaseAssets = () => {};

    try {
      cleanupReleaseAssets = writeProofReleaseAssetsReference(proofDir, tag, {
        includeTrustedManifest: false,
      }).cleanup;
      releaseGate.writeRcProofTemplate(proofDir, tag);

      expect(() =>
        releaseGate.verifyRcProof(proofDir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
        })
      ).toThrow(/trusted release manifest/);
    } finally {
      cleanupReleaseAssets();
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('rejects release candidate proof packets that embed release asset bytes', () => {
    const tag = 'evaos-beta-v2.1.10-evaos-beta.0';
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-rc-proof-embedded-assets-'));
    let cleanupReleaseAssets = () => {};

    try {
      cleanupReleaseAssets = writeProofReleaseAssetsReference(proofDir, tag).cleanup;
      releaseGate.writeRcProofTemplate(proofDir, tag);
      fs.writeFileSync(path.join(proofDir, 'release-assets', 'evaOS Workbench-embedded-mac-arm64.dmg'), 'mac');

      expect(() =>
        releaseGate.verifyRcProof(proofDir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
        })
      ).toThrow(/must not embed release asset bytes/);
    } finally {
      cleanupReleaseAssets();
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('does not allow release candidate proof JSON to weaken built-in evidence markers', () => {
    const tag = 'evaos-beta-v2.1.10-evaos-beta.0';
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-rc-proof-weakened-'));
    let cleanupReleaseAssets = () => {};

    try {
      cleanupReleaseAssets = writeProofReleaseAssetsReference(proofDir, tag).cleanup;

      releaseGate.writeRcProofTemplate(proofDir, tag);
      const manifestPath = path.join(proofDir, 'evaos-beta-rc-proof.json');
      const rcManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      rcManifest.checks[0].status = 'pass';
      rcManifest.checks[0].requiredText = ['PASS'];
      rcManifest.macosX64.reason = 'macOS x64 is explicitly deferred because this beta candidate only includes arm64.';
      fs.writeFileSync(manifestPath, `${JSON.stringify(rcManifest, null, 2)}\n`);

      expect(() =>
        releaseGate.verifyRcProof(proofDir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
        })
      ).toThrow(/built-in RC proof gate markers/);
    } finally {
      cleanupReleaseAssets();
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('fails release candidate proof verification when rollback evidence is incomplete', () => {
    const tag = 'evaos-beta-v2.1.10-evaos-beta.0';
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-rc-proof-missing-'));
    let cleanupReleaseAssets = () => {};

    try {
      cleanupReleaseAssets = writeProofReleaseAssetsReference(proofDir, tag).cleanup;

      releaseGate.writeRcProofTemplate(proofDir, tag);
      const manifestPath = path.join(proofDir, 'evaos-beta-rc-proof.json');
      const rcManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      rcManifest.checks = rcManifest.checks.map((check: { status: string }) => ({ ...check, status: 'pass' }));
      rcManifest.macosX64.reason = 'macOS x64 is explicitly deferred because this beta candidate only includes arm64.';
      fs.writeFileSync(manifestPath, `${JSON.stringify(rcManifest, null, 2)}\n`);

      writeArm64TrustEvidence(proofDir);
      fs.writeFileSync(
        path.join(proofDir, 'codesign-macos-arm64.txt'),
        '/Applications/evaOS Workbench.app: valid on disk\n/Applications/evaOS Workbench.app: satisfies its Designated Requirement\n'
      );
      fs.writeFileSync(path.join(proofDir, 'spctl-macos-arm64.txt'), '/Applications/evaOS Workbench.app: accepted\n');
      fs.writeFileSync(
        path.join(proofDir, 'install-smoke.md'),
        'PASS: DMG copied to /Applications/evaOS Workbench.app without replacing the released fallback app.\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'launch-smoke.md'),
        'PASS: evaOS Workbench launched with stable Workbench identity, protocol scheme evaos-workbench, and no upstream AionUi feed.\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'protocol-identity.md'),
        'PASS: protocol scheme evaos-workbench is declared by com.evaos.workbench.\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'installed-app-path-hygiene.md'),
        [
          'PASS: exact app path /Applications/evaOS Workbench.app used for signed installed-app proof.',
          'PASS: no stale indexed Workbench apps under Lexar proof trees.',
          'PASS: no stale running Workbench apps outside /Applications/evaOS Workbench.app.',
          'PASS: Computer Use exact path rule recorded; no bundle-id-only launch.',
          'PASS: OpenClaw bridge tools selected unless Computer Use is explicitly mounted in that runtime.',
        ].join('\n')
      );
      fs.writeFileSync(
        path.join(proofDir, 'updater-feed-audit.md'),
        'PASS: update repo is 100yenadmin/evaOS-GUI and iOfficeAI/AionUi blocked for beta assets.\n'
      );
      fs.writeFileSync(path.join(proofDir, 'rollback-smoke.md'), 'PASS: beta removed.\n');
      fs.writeFileSync(
        path.join(proofDir, 'support-notes.md'),
        'Support route: 100yenadmin/evaOS-GUI. The released macOS app remains the fallback while beta is gated.\n'
      );

      expect(() =>
        releaseGate.verifyRcProof(proofDir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
        })
      ).toThrow(/rollback-smoke/);
    } finally {
      cleanupReleaseAssets();
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });
});
