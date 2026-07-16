import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  signedMacControlAttestation,
  TEST_CONTEXT_KEY_ID,
  TEST_RECEIPT_KEY_ID,
} from '../evaos/fixtures/signedMacControlAttestation';

const require = createRequire(import.meta.url);
const releaseGate = require('../../../scripts/evaosBetaReleaseGate.js') as {
  assertPublicBetaNotarizationEnv: (env: Record<string, string | undefined>) => void;
  assertPublicBetaReleaseSigningEnv: (env: Record<string, string | undefined>) => void;
  assertPublicDistributionTag: (tag: string) => void;
  assertMacosAutoUpdateMetadata: (outputDir: string, releaseTargetPlatforms: string) => void;
  assertReleaseConfig: (rootDir: string) => boolean;
  collectFunctionalSmokeConfigIssues: (workflow: string) => string[];
  collectBuildReleaseWorkflowIssues: (workflow: string) => string[];
  collectPublicationWorkflowIssues: (workflows: {
    buildRelease: string;
    distribute: string;
    reusableBuild: string;
  }) => string[];
  collectRcCanaryWorkflowIssues: (workflow: string) => string[];
  collectReleaseDistributeWorkflowIssues: (workflow: string) => string[];
  committedBridgeSourceIdentity: (
    commit: string,
    runGit?: (command: string, args: string[], options: Record<string, unknown>) => string | Buffer,
    rootDir?: string
  ) => { sourceSha256: string; sourcePaths: string[] };
  collectLiveCanaryVerifierBehaviorIssues: (rootDir: string) => string[];
  resolveLiveCanaryVerifierAuditBash: (candidates?: string[]) => string;
  collectReleaseConfigIssues: (rootDir: string) => string[];
  createReleaseManifest: (outputDir: string, tag: string, env: Record<string, string | undefined>) => unknown;
  isLocalSignedDmgFallbackManifest: (manifest: unknown) => boolean;
  isStrictPublicBetaReleaseEnv: (env: Record<string, string | undefined>) => boolean;
  LOCAL_SIGNED_DMG_FALLBACK_ACK: string;
  releaseProvenanceFromEnv: (env: Record<string, string | undefined>) => unknown;
  RELEASE_PROVENANCE_LOCAL_SIGNED_DMG_FALLBACK: string;
  normalizeBoolean: (value: unknown) => boolean;
  requiresMacControlLiveCanaryProof: (tagOrVersion: string) => boolean;
  verifyBrokerLiveCanaryProof: (proofDir: string, env?: Record<string, string | undefined>) => boolean;
  verifyMacControlLiveCanaryProof: (
    proofDir: string,
    env?: Record<string, string | undefined>,
    options?: { now?: Date; maxAgeHours?: number }
  ) => boolean;
  verifyReleaseManifest: (outputDir: string, tag: string, env: Record<string, string | undefined>) => boolean;
  verifyRcProof: (proofDir: string, tag: string, env: Record<string, string | undefined>) => boolean;
  writeRcProofTemplate: (proofDir: string, tag: string) => unknown;
};
const bridgeResource = require('../../../scripts/prepareEvaosDesktopBridgeResource.js') as {
  bridgeWrapperScript: () => string;
  directorySha256: (sourceDir: string) => string;
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
const fixtureReleaseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();
const fixtureBridgeSourcePrefix = 'resources/evaos-beta/bridge/src/evaos_desktop_bridge/';
let fixtureBridgeSourceTempDir = '';
let fixtureBridgeSourceRoot = '';

beforeAll(() => {
  fixtureBridgeSourceTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-committed-bridge-source-'));
  fixtureBridgeSourceRoot = path.join(fixtureBridgeSourceTempDir, 'evaos_desktop_bridge');
  const sourcePaths = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', fixtureReleaseCommit, '--', fixtureBridgeSourcePrefix.slice(0, -1)],
    { cwd: repoRoot, encoding: 'utf8' }
  )
    .split('\n')
    .filter(Boolean);
  for (const sourcePath of sourcePaths) {
    if (!sourcePath.startsWith(fixtureBridgeSourcePrefix)) {
      throw new Error(`Unexpected committed bridge source path: ${sourcePath}`);
    }
    const targetPath = path.join(fixtureBridgeSourceRoot, sourcePath.slice(fixtureBridgeSourcePrefix.length));
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(
      targetPath,
      execFileSync('git', ['cat-file', 'blob', `${fixtureReleaseCommit}:${sourcePath}`], {
        cwd: repoRoot,
        encoding: null,
      })
    );
  }
});

afterAll(() => {
  if (fixtureBridgeSourceTempDir) {
    fs.rmSync(fixtureBridgeSourceTempDir, { recursive: true, force: true });
  }
});
const liveCanaryProofEnv = {
  EVAOS_LIVE_CANARY_EXPECTED_CUSTOMER_ID: 'cus_123',
  EVAOS_LIVE_CANARY_MAX_PROOF_AGE_HOURS: '24',
};
const macControlTestKeyPair = generateKeyPairSync('ed25519');
const macControlProofTrustEnv = {
  EVAOS_LIVE_CANARY_CONTEXT_KEY_ID: TEST_CONTEXT_KEY_ID,
  EVAOS_LIVE_CANARY_RECEIPT_KEY_ID: TEST_RECEIPT_KEY_ID,
  EVAOS_LIVE_CANARY_RECEIPT_PUBLIC_KEY: macControlTestKeyPair.publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('base64url'),
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
  fs.writeFileSync(
    path.join(proofDir, 'codesign-updater-zip-macos-arm64.txt'),
    'evaOS Workbench.app: valid on disk\nevaOS Workbench.app: satisfies its Designated Requirement\n'
  );
  fs.writeFileSync(
    path.join(proofDir, 'stapler-updater-zip-macos-arm64.txt'),
    'Processing: evaOS Workbench.app\nThe validate action worked!\n'
  );
  fs.writeFileSync(path.join(proofDir, 'spctl-updater-zip-macos-arm64.txt'), 'evaOS Workbench.app: accepted\n');
  const trustedManifest = JSON.parse(
    fs.readFileSync(path.join(proofDir, 'trusted-manifest', 'evaos-beta-release-manifest.json'), 'utf8')
  );
  const updaterZip = trustedManifest.assets.find(
    (asset: { name?: string }) => asset.name?.endsWith('.zip') && /arm64/i.test(asset.name)
  );
  if (!updaterZip) throw new Error('Test release manifest is missing the arm64 updater ZIP.');
  const versionMatch = String(trustedManifest.tag || '').match(/^evaos-beta-v?(\d+\.\d+\.\d+)-evaos-beta(?:\.\d+)?$/);
  if (!versionMatch) throw new Error('Test release manifest has an invalid beta tag.');
  const version = versionMatch[1];
  fs.writeFileSync(
    path.join(proofDir, 'updater-zip-macos-arm64.json'),
    `${JSON.stringify(
      {
        schema: 'evaos-updater-zip-trust/v2',
        tag: trustedManifest.tag,
        releaseCommit: trustedManifest.releaseCommit,
        assetName: updaterZip.name,
        sha256: updaterZip.sha256,
        appName: 'evaOS Workbench.app',
        bundleId: 'com.evaos.workbench',
        productName: 'evaOS Workbench',
        shortVersion: version,
        bundleVersion: version,
        codesignVerified: true,
        staplerVerified: true,
        gatekeeperVerified: true,
      },
      null,
      2
    )}\n`
  );
  const sourceSha256 = releaseGate.committedBridgeSourceIdentity(trustedManifest.releaseCommit).sourceSha256;
  const localBinding = {
    ok: true,
    source_commit: trustedManifest.releaseCommit,
    requested_source_ref: trustedManifest.releaseCommit,
    source_path: 'resources/evaos-beta/bridge',
    source_sha256: sourceSha256,
    actual_source_sha256: sourceSha256,
    owner: '100yenadmin/evaOS-GUI',
    status: 'vendored',
    app_path: '/Applications/evaOS Workbench.app',
    app_version: version,
    app_build: version,
    app_bundle_id: 'com.evaos.workbench',
    app_name: 'evaOS Workbench',
    source_integrity_valid: true,
  };
  fs.writeFileSync(
    path.join(proofDir, 'installed-candidate-pre-canary.json'),
    `${JSON.stringify(
      {
        ok: true,
        summary: {
          canonical_path: '/Applications/evaOS Workbench.app',
          bundle_id: 'com.evaos.workbench',
          expected_version: version,
          expected_build: version,
          expected_source_commit: trustedManifest.releaseCommit,
          bridge_source_binding: localBinding,
        },
        checks: [{ code: 'packaged_bridge_source_integrity_verified', status: 'pass' }],
        inventory: {
          app_bundles: [
            {
              path: '/Applications/evaOS Workbench.app',
              bundle_id: 'com.evaos.workbench',
              version,
              build: version,
            },
          ],
        },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(proofDir, 'installed-candidate-connector-start.json'),
    `${JSON.stringify(
      {
        schema: 'evaos-installed-connector-harness-start/v1',
        ok: true,
        classification: 'ready',
        mode: 'harness-owned-loopback',
        startInvoked: true,
        processRunning: true,
        processExitCode: null,
        attempts: 1,
        token: {
          atomicRead: true,
          exists: true,
          regularFile: true,
          ownerMatchesRunner: true,
          mode0600: true,
          nonempty: true,
        },
        health: { reachable: true },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(proofDir, 'installed-candidate-connector.json'),
    `${JSON.stringify(
      {
        run_id: 'qa-fixture',
        version_under_test: version,
        build_under_test: version,
        source_commit_under_test: trustedManifest.releaseCommit,
        candidate_binding: {
          ok: true,
          local: localBinding,
          connector: {
            ok: true,
            source_commit: trustedManifest.releaseCommit,
            source_sha256: sourceSha256,
            source_path: 'resources/evaos-beta/bridge',
            owner: '100yenadmin/evaOS-GUI',
            status: 'vendored',
            app_path: '/Applications/evaOS Workbench.app',
            app_version: version,
            app_build: version,
            app_bundle_id: 'com.evaos.workbench',
            app_name: 'evaOS Workbench',
          },
          selected_binding: { ok: null, reason: 'selected_binding_proof_not_required_for_suite' },
        },
        summary: { total: 6, passed: 6, failed: 0, skipped: 0 },
        results: [
          {
            id: 'control_start.bridge_status',
            command: 'desktop_bridge_status',
            ok: true,
            status: 'passed',
            params_redacted: {},
          },
          {
            id: 'control_start.full_access',
            command: 'local_workbench_control_start',
            ok: true,
            status: 'passed',
            params_redacted: { mode: 'full-access' },
          },
          {
            id: 'control_start.ask_permission',
            command: 'local_workbench_control_start',
            ok: true,
            status: 'passed',
            params_redacted: { mode: 'ask-permission' },
          },
          {
            id: 'control_start.stop',
            command: 'desktop_control_stop',
            ok: true,
            status: 'passed',
            params_redacted: {},
          },
          {
            id: 'control_start.kill_switch',
            command: 'desktop_kill_switch',
            ok: true,
            status: 'passed',
            params_redacted: {},
          },
          {
            id: 'control_cleanup.local_kill_switch',
            command: 'desktop_kill_switch',
            ok: true,
            status: 'passed',
            params_redacted: {},
          },
        ],
      },
      null,
      2
    )}\n`
  );
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
    omitCocoa?: boolean;
    omitCoreText?: boolean;
    wrongObjcArchitecture?: boolean;
    wrongPythonLauncherArchitecture?: boolean;
    regularPythonLauncher?: boolean;
    nonTraversablePythonDirectory?: boolean;
    nonTraversablePythonRoot?: boolean;
    normalizedPythonEntryCollision?: boolean;
    inventorySymlinkArchiveMode?: number;
    inventorySymlinkArchiveTarget?: string;
    inventorySymlinkDeclaredTarget?: string;
    regularInventorySymlink?: boolean;
    inventoryDirectoryArchiveMode?: number;
    inventoryFileArchiveMode?: number;
    wrongPythonSourceUrl?: boolean;
    nonExecutablePayload?: 'bridge' | 'peekaboo' | 'helper' | 'verifier' | 'python';
    omitFoundationNative?: boolean;
    omitInventoriedRuntimeFile?: boolean;
    omitStdlibSentinel?: boolean;
    signedPythonMutation?: boolean;
    secondAppRoot?: boolean;
    tamperBridgeWrapper?: boolean;
    tamperBridgeSource?: boolean;
    selfAttestTamperedBridgeSource?: boolean;
    extraBridgeSourceEntry?: boolean;
    bridgeSourceCommit?: string;
    wrongAppRoot?: boolean;
    omitInfoPlist?: boolean;
    malformedInfoPlist?: boolean;
    wrongBundleIdentifier?: boolean;
    wrongProductName?: boolean;
    wrongShortVersion?: boolean;
    wrongBundleVersion?: boolean;
  } = {}
) {
  const bridgeWrapperBase64 = Buffer.from(bridgeResource.bridgeWrapperScript()).toString('base64');
  const ed25519VerifierSourceSha256 = createHash('sha256')
    .update(
      fs.readFileSync(
        path.join(process.cwd(), 'resources', 'evaos-beta', 'bridge', 'native', 'EvaOSEd25519Verify.swift')
      )
    )
    .digest('hex');
  const script = [
    'import base64',
    'import hashlib',
    'import json',
    'import pathlib',
    'import plistlib',
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
    'omit_cocoa = sys.argv[12] == "1"',
    'omit_core_text = sys.argv[13] == "1"',
    'wrong_python_launcher_architecture = sys.argv[14] == "1"',
    'non_executable_payload = sys.argv[15]',
    'omit_foundation_native = sys.argv[16] == "1"',
    'omit_inventoried_runtime_file = sys.argv[17] == "1"',
    'second_app_root = sys.argv[18] == "1"',
    'omit_stdlib_sentinel = sys.argv[19] == "1"',
    'signed_python_mutation = sys.argv[20] == "1"',
    'regular_python_launcher = sys.argv[21] == "1"',
    'non_traversable_python_directory = sys.argv[22] == "1"',
    'non_traversable_python_root = sys.argv[23] == "1"',
    'normalized_python_entry_collision = sys.argv[24] == "1"',
    'inventory_symlink_archive_mode = int(sys.argv[25])',
    'inventory_symlink_archive_target = sys.argv[26]',
    'inventory_symlink_declared_target = sys.argv[27]',
    'regular_inventory_symlink = sys.argv[28] == "1"',
    'inventory_directory_archive_mode = int(sys.argv[29]) if sys.argv[29] else None',
    'inventory_file_archive_mode = int(sys.argv[30]) if sys.argv[30] else None',
    'tamper_bridge_wrapper = sys.argv[31] == "1"',
    'tamper_bridge_source = sys.argv[32] == "1"',
    'bridge_source_commit = sys.argv[33]',
    'bridge_source_root = pathlib.Path(sys.argv[34])',
    'self_attest_tampered_bridge_source = sys.argv[35] == "1"',
    'extra_bridge_source_entry = sys.argv[36] == "1"',
    'wrong_app_root = sys.argv[37] == "1"',
    'omit_info_plist = sys.argv[38] == "1"',
    'malformed_info_plist = sys.argv[39] == "1"',
    'wrong_bundle_identifier = sys.argv[40] == "1"',
    'wrong_product_name = sys.argv[41] == "1"',
    'wrong_short_version = sys.argv[42] == "1"',
    'wrong_bundle_version = sys.argv[43] == "1"',
    `bridge_wrapper_bytes = base64.b64decode("${bridgeWrapperBase64}")`,
    `ed25519_verifier_source_sha256 = "${ed25519VerifierSourceSha256}"`,
    'app_root = "Wrong Workbench.app" if wrong_app_root else "evaOS Workbench.app"',
    'info_plist = {"CFBundleIdentifier": "com.example.wrong" if wrong_bundle_identifier else "com.evaos.workbench", "CFBundleName": "Wrong Workbench" if wrong_product_name else "evaOS Workbench", "CFBundleShortVersionString": "9.9.9" if wrong_short_version else "2.1.10", "CFBundleVersion": "999" if wrong_bundle_version else "2.1.10"}',
    'info_plist_bytes = b"not-a-plist" if malformed_info_plist else plistlib.dumps(info_plist)',
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
    'wrong_python_launcher_header = bytes.fromhex("cffaedfe07000001" if python_arch == "arm64" else "cffaedfe0c000001")',
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
    'runtime_entries = []',
    'def add_runtime_directory(relative_path, mode=0o755):',
    '    runtime_entries.append({"path": relative_path, "type": "directory", "mode": mode, "include": True})',
    'def add_runtime_file(relative_path, data, mode=0o644, include_in_zip=True, archive_data=None):',
    '    entry = {"path": relative_path, "type": "file", "mode": mode, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "data": data, "include": include_in_zip, "archiveData": archive_data}',
    '    if data[:4].hex() in {"feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "cafebabf", "bebafeca", "bfbafeca"}:',
    '        entry["signedMachO"] = True',
    '    runtime_entries.append(entry)',
    'def add_runtime_symlink(relative_path, target):',
    '    runtime_entries.append({"path": relative_path, "type": "symlink", "mode": 0o777, "target": target, "data": target.encode(), "include": True})',
    'for runtime_directory in ["bin", "lib", "lib/python3.12", "lib/python3.12/encodings", "lib/python3.12/site-packages", "lib/python3.12/site-packages/ApplicationServices", "lib/python3.12/site-packages/Cocoa", "lib/python3.12/site-packages/CoreText", "lib/python3.12/site-packages/Foundation", "lib/python3.12/site-packages/HIServices", "lib/python3.12/site-packages/Quartz", "lib/python3.12/site-packages/Quartz/CoreGraphics", "lib/python3.12/site-packages/objc"]:',
    '    add_runtime_directory(runtime_directory, 0o600 if non_traversable_python_directory and runtime_directory == "bin" else 0o755)',
    'if wrong_python_launcher_architecture:',
    '    add_runtime_file("bin/python3", wrong_python_launcher_header, 0o755)',
    'elif regular_python_launcher:',
    '    add_runtime_file("bin/python3", python_header, 0o755)',
    'else:',
    '    add_runtime_symlink("bin/python3", "python3.12")',
    'add_runtime_file("bin/python3.12", python_header, 0o644 if non_executable_payload == "python" else 0o755, True, python_header + b"signed" if signed_python_mutation else None)',
    'add_runtime_file("lib/python3.12/LICENSE.txt", python_license_bytes)',
    'add_runtime_symlink("lib/python3.12/LICENSE-link.txt", inventory_symlink_declared_target)',
    'if not omit_stdlib_sentinel:',
    '    add_runtime_file("lib/python3.12/encodings/__init__.py", b"# encodings fixture\\n")',
    'add_runtime_file("lib/python3.12/site-packages/ApplicationServices/__init__.py", b"")',
    'if not omit_cocoa:',
    '    add_runtime_file("lib/python3.12/site-packages/Cocoa/__init__.py", b"")',
    'if not omit_core_text:',
    '    add_runtime_file("lib/python3.12/site-packages/CoreText/__init__.py", b"")',
    'add_runtime_file("lib/python3.12/site-packages/Quartz/__init__.py", b"")',
    'add_runtime_file("lib/python3.12/site-packages/objc/__init__.py", b"")',
    'add_runtime_file("lib/python3.12/site-packages/objc/_objc.cpython-312-darwin.so", objc_header, 0o755)',
    'if not omit_foundation_native:',
    '    add_runtime_file("lib/python3.12/site-packages/Foundation/_Foundation.cpython-312-darwin.so", python_header, 0o755)',
    'add_runtime_file("lib/python3.12/site-packages/Quartz/CoreGraphics/_coregraphics.cpython-312-darwin.so", python_header, 0o755)',
    'add_runtime_file("lib/python3.12/site-packages/HIServices/_HIServices.cpython-312-darwin.so", python_header, 0o755)',
    'add_runtime_file("lib/python3.12/site-packages/CoreText/_manual.cpython-312-darwin.so", python_header, 0o755)',
    'add_runtime_file("lib/python3.12/site-packages/runtime-only.py", b"runtime closure\\n", 0o644, not omit_inventoried_runtime_file)',
    'inventory_entries = [{key: value for key, value in entry.items() if key not in {"data", "include", "archiveData"}} for entry in sorted(runtime_entries, key=lambda item: item["path"])]',
    'inventory = {"schema": "evaos-python-runtime-inventory/v1", "entries": inventory_entries}',
    'inventory_bytes = (json.dumps(inventory, indent=2) + "\\n").encode()',
    'python_metadata = {"version": "3.12.13", "architecture": python_arch, "sourceSha256": python_source_sha256, "sourceUrl": python_source_url, "packages": python_packages, "license": "Python-2.0", "licensePath": "licenses/CPython-LICENSE.txt", "licenseSha256": python_license_sha256, "inventoryPath": "python-runtime-inventory.json", "inventorySha256": hashlib.sha256(inventory_bytes).hexdigest(), "inventoryEntryCount": len(inventory_entries)}',
    'bridge_source_files = {}',
    'for source_path in bridge_source_root.rglob("*"):',
    '    if source_path.is_file():',
    '        bridge_source_files[source_path.relative_to(bridge_source_root).as_posix()] = source_path.read_bytes()',
    'if self_attest_tampered_bridge_source:',
    '    bridge_source_files["cli.py"] += b"# self-attested tamper\\n"',
    'bridge_source_hash = hashlib.sha256()',
    'for relative_path, contents in sorted(bridge_source_files.items()):',
    '    bridge_source_hash.update(relative_path.encode())',
    '    bridge_source_hash.update(b"\\0")',
    '    bridge_source_hash.update(contents)',
    '    bridge_source_hash.update(b"\\0")',
    'bridge_wrapper_metadata = {"schema": "evaos-workbench-bridge-wrapper/v1", "path": "evaos-desktop-bridge", "sourceSha256": hashlib.sha256(bridge_wrapper_bytes).hexdigest()}',
    'source_provenance = {"schema": "evaos-workbench-vendored-bridge-source/v1", "owner": "100yenadmin/evaOS-GUI", "status": "vendored", "importedCommit": "908e3cad8c5f11dca739bbfc2c697c3e6d52f79e", "sourceSha256": bridge_source_hash.hexdigest()}',
    'manifest = {"placeholder": False, "requestedSourceRef": bridge_source_commit, "sourcePath": "resources/evaos-beta/bridge", "sourceCommit": bridge_source_commit, "sourceProvenance": source_provenance, "bundledTools": {"bridgeWrapper": bridge_wrapper_metadata, "ed25519Verifier": {"schema": "evaos-workbench-ed25519-verifier/v1", "path": "bin/evaos-ed25519-verify", "architecture": python_arch, "minimumMacOS": "15.0", "sourceSha256": ed25519_verifier_source_sha256}, "peekaboo": {"version": "3.8.0", "sourceSha256": source_sha256, "license": "MIT", "licensePath": "licenses/Peekaboo-LICENSE.txt", "licenseSha256": license_sha256}, "python": python_metadata}}',
    'def write_regular(archive, name, data, mode=0o644):',
    '    info = zipfile.ZipInfo(name)',
    '    info.create_system = 3',
    '    info.external_attr = (stat.S_IFREG | mode) << 16',
    '    info.compress_type = zipfile.ZIP_DEFLATED',
    '    archive.writestr(info, data)',
    'def write_symlink(archive, name, target, mode=0o777):',
    '    info = zipfile.ZipInfo(name)',
    '    info.create_system = 3',
    '    info.external_attr = (stat.S_IFLNK | mode) << 16',
    '    info.compress_type = zipfile.ZIP_DEFLATED',
    '    archive.writestr(info, target.encode())',
    'def write_directory(archive, name, mode=0o755):',
    '    info = zipfile.ZipInfo(name.rstrip("/") + "/")',
    '    info.create_system = 3',
    '    info.external_attr = (stat.S_IFDIR | mode) << 16',
    '    info.compress_type = zipfile.ZIP_STORED',
    '    archive.writestr(info, b"")',
    'with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:',
    '    if not omit_info_plist:',
    '        write_regular(archive, f"{app_root}/Contents/Info.plist", info_plist_bytes)',
    '    bridge_prefix = f"{app_root}/Contents/Resources/Bridge"',
    '    packaged_wrapper_bytes = b"#!/bin/sh\\nexit 0\\n" if tamper_bridge_wrapper else bridge_wrapper_bytes',
    '    write_regular(archive, f"{bridge_prefix}/evaos-desktop-bridge", packaged_wrapper_bytes, 0o644 if non_executable_payload == "bridge" else 0o755)',
    '    for relative_path, contents in bridge_source_files.items():',
    '        packaged_contents = contents + b"# tampered\\n" if tamper_bridge_source and relative_path == "cli.py" else contents',
    '        write_regular(archive, f"{bridge_prefix}/src/evaos_desktop_bridge/{relative_path}", packaged_contents)',
    '    if extra_bridge_source_entry:',
    '        write_regular(archive, f"{bridge_prefix}/src/sitecustomize.py", b"raise RuntimeError(\\"unexpected startup code\\")\\n")',
    '    if not omit_peekaboo:',
    '        write_regular(archive, f"{bridge_prefix}/bin/peekaboo", bytes.fromhex("cafebabe00000000"), 0o644 if non_executable_payload == "peekaboo" else 0o755)',
    '    write_regular(archive, f"{bridge_prefix}/bin/evaos-connector-helper", bytes.fromhex("cafebabe00000000"), 0o644 if non_executable_payload == "helper" else 0o755)',
    '    write_regular(archive, f"{bridge_prefix}/bin/evaos-ed25519-verify", python_header, 0o644 if non_executable_payload == "verifier" else 0o755)',
    '    write_directory(archive, f"{bridge_prefix}/python", 0o600 if non_traversable_python_root else 0o755)',
    '    if normalized_python_entry_collision:',
    '        write_regular(archive, f"{bridge_prefix}/python/bin", b"shadowed runtime entry")',
    '    for entry in runtime_entries:',
    '        if not entry["include"]:',
    '            continue',
    '        entry_name = f"{bridge_prefix}/python/{entry[\'path\']}"',
    '        if entry["type"] == "directory":',
    '            archive_mode = inventory_directory_archive_mode if entry["path"] == "lib/python3.12" and inventory_directory_archive_mode is not None else entry["mode"]',
    '            write_directory(archive, entry_name, archive_mode)',
    '        elif entry["type"] == "symlink":',
    '            if entry["path"] == "lib/python3.12/LICENSE-link.txt":',
    '                archive_target = inventory_symlink_archive_target or entry["target"]',
    '                if regular_inventory_symlink:',
    '                    write_regular(archive, entry_name, archive_target.encode(), inventory_symlink_archive_mode)',
    '                else:',
    '                    write_symlink(archive, entry_name, archive_target, inventory_symlink_archive_mode)',
    '            else:',
    '                write_symlink(archive, entry_name, entry["target"])',
    '        else:',
    '            archive_mode = inventory_file_archive_mode if entry["path"] == "lib/python3.12/site-packages/runtime-only.py" and inventory_file_archive_mode is not None else entry["mode"]',
    '            write_regular(archive, entry_name, entry["archiveData"] if entry["archiveData"] is not None else entry["data"], archive_mode)',
    '    write_regular(archive, f"{bridge_prefix}/python-runtime-inventory.json", inventory_bytes)',
    '    write_regular(archive, f"{bridge_prefix}/licenses/CPython-LICENSE.txt", python_license_bytes)',
    '    if not omit_license:',
    '        write_regular(archive, f"{bridge_prefix}/licenses/Peekaboo-LICENSE.txt", license_bytes)',
    '    write_regular(archive, f"{bridge_prefix}/manifest.json", (json.dumps(manifest) + "\\n").encode())',
    '    if second_app_root:',
    '        write_regular(archive, "Stale Workbench.app/Contents/Info.plist", b"stale")',
    '    for index in range(extra_entry_count):',
    '        write_regular(archive, f"{app_root}/Contents/Resources/noise/entry-{index:05d}.txt", b"x\\n")',
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
    options.omitCocoa ? '1' : '0',
    options.omitCoreText ? '1' : '0',
    options.wrongPythonLauncherArchitecture ? '1' : '0',
    options.nonExecutablePayload || '',
    options.omitFoundationNative ? '1' : '0',
    options.omitInventoriedRuntimeFile ? '1' : '0',
    options.secondAppRoot ? '1' : '0',
    options.omitStdlibSentinel ? '1' : '0',
    options.signedPythonMutation ? '1' : '0',
    options.regularPythonLauncher ? '1' : '0',
    options.nonTraversablePythonDirectory ? '1' : '0',
    options.nonTraversablePythonRoot ? '1' : '0',
    options.normalizedPythonEntryCollision ? '1' : '0',
    String(options.inventorySymlinkArchiveMode ?? 0o777),
    options.inventorySymlinkArchiveTarget || '',
    options.inventorySymlinkDeclaredTarget || 'LICENSE.txt',
    options.regularInventorySymlink ? '1' : '0',
    String(options.inventoryDirectoryArchiveMode ?? ''),
    String(options.inventoryFileArchiveMode ?? ''),
    options.tamperBridgeWrapper ? '1' : '0',
    options.tamperBridgeSource ? '1' : '0',
    options.bridgeSourceCommit || fixtureReleaseCommit,
    fixtureBridgeSourceRoot,
    options.selfAttestTamperedBridgeSource ? '1' : '0',
    options.extraBridgeSourceEntry ? '1' : '0',
    options.wrongAppRoot ? '1' : '0',
    options.omitInfoPlist ? '1' : '0',
    options.malformedInfoPlist ? '1' : '0',
    options.wrongBundleIdentifier ? '1' : '0',
    options.wrongProductName ? '1' : '0',
    options.wrongShortVersion ? '1' : '0',
    options.wrongBundleVersion ? '1' : '0',
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
    EVAOS_BETA_RELEASE_COMMIT: fixtureReleaseCommit,
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

function writeMacControlLiveCanaryProof(proofDir: string, overrides: Record<string, unknown> = {}) {
  fs.mkdirSync(proofDir, { recursive: true });
  const sourceSha256 = releaseGate.committedBridgeSourceIdentity(fixtureReleaseCommit).sourceSha256;
  const executedAtText = String(overrides.executedAt || new Date().toISOString());
  const executedAt = Date.parse(executedAtText);
  const executedAtSeconds = Math.floor(executedAt / 1000);
  const authorityIssuedAt = Number(overrides.authorityIssuedAt ?? executedAtSeconds);
  const authorityExpiresAt = Number(overrides.authorityExpiresAt ?? overrides.expiresAt ?? executedAtSeconds + 59);
  const candidateOverrides = (overrides.candidate as Record<string, unknown> | undefined) || {};
  const candidate = {
    sourceCommit: String(candidateOverrides.sourceCommit || fixtureReleaseCommit),
    sourceSha256: String(candidateOverrides.sourceSha256 || sourceSha256),
    appVersion: String(candidateOverrides.appVersion || '2.1.36'),
    appBuild: String(candidateOverrides.appBuild || '2.1.36'),
  };
  const signed = signedMacControlAttestation({
    runRef: String(overrides.runRef || 'gha:12345:111111111111111111111111'),
    executedAt: executedAtText,
    authorityIssuedAt,
    authorityExpiresAt,
    candidate,
    privateReceiptSha256: String(overrides.privateReceiptSha256 || 'f'.repeat(64)),
    keyPair: macControlTestKeyPair,
    attestationOverrides: (overrides.attestationOverrides as Record<string, unknown> | undefined) || {},
    envelopeOverrides: (overrides.envelopeOverrides as Record<string, unknown> | undefined) || {},
  });
  fs.writeFileSync(
    path.join(proofDir, 'mac-control-session-provisioning.json'),
    `${JSON.stringify(
      {
        schema: 'evaos-mac-control-canary-session-provision/v1',
        accountConfigured: true,
        customerConfigured: true,
        activeMembershipVerified: true,
        stagingMarkerVerified: true,
        sessionMinted: true,
        sessionExpiryPresent: true,
        sensitiveOutput: 'passed',
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(path.join(proofDir, 'mac-control-runtime.json'), `${JSON.stringify(signed.envelope, null, 2)}\n`);
  fs.writeFileSync(
    path.join(proofDir, 'mac-control-runtime-negative.json'),
    `${JSON.stringify(
      {
        schema: 'evaos.mac_control.deployed_negative_probe.v1',
        proofMode: 'deployed-staging',
        sourceRunId: '12345',
        candidate,
        classifications: {
          forgedSignature: {
            rejected: true,
            httpStatus: 401,
            code: 'execution_context_signature_invalid',
          },
          expiredContext: {
            rejected: true,
            httpStatus: 401,
            code: 'execution_context_expired',
          },
          replay: {
            firstAccepted: true,
            secondRejected: true,
            httpStatus: 409,
            code: 'execution_context_replayed',
          },
        },
        connectorActionAttempted: false,
        sensitiveOutputAbsent: true,
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(proofDir, 'mac-control-deployed-route.json'),
    `${JSON.stringify(
      {
        schema: 'evaos.mac_control.deployed_route_probe.v1',
        sourceHeadSha: fixtureReleaseCommit,
        sourceRunId: '12345',
        checkedAt: executedAtText,
        assertions: {
          gatewayAuthRequired: true,
          postOnly: true,
          exactMatch: true,
          strictBody: true,
          callerAuthorityBodyRejected: true,
          sensitiveOutputAbsent: true,
        },
        ...(overrides.deployedRoute as Record<string, unknown> | undefined),
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(proofDir, 'mac-control-session-cleanup.json'),
    `${JSON.stringify(
      {
        schema: 'evaos-mac-control-canary-session-cleanup/v1',
        sessionRevoked: true,
        sensitiveOutput: 'passed',
      },
      null,
      2
    )}\n`
  );
  return signed;
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
    EVAOS_BETA_RELEASE_COMMIT: fixtureReleaseCommit,
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
  it('derives the Workbench bridge digest from the exact committed GUI tree', () => {
    const identity = releaseGate.committedBridgeSourceIdentity(fixtureReleaseCommit);
    expect(identity.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.sourcePaths).toContain('cli.py');
    expect(identity.sourcePaths).toContain('adapters/customer_mac.py');
    expect(identity.sourcePaths).toEqual(identity.sourcePaths.toSorted());
  });

  it('uses the same deterministic UTF-8 byte ordering for committed and directory bridge identities', () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-bridge-sort-'));
    const commit = 'a'.repeat(40);
    const files = [
      { name: 'é.py', objectId: '1'.repeat(40), contents: 'accent\n' },
      { name: 'z.py', objectId: '2'.repeat(40), contents: 'zee\n' },
      { name: 'A.py', objectId: '3'.repeat(40), contents: 'alpha\n' },
    ];
    try {
      for (const file of files) fs.writeFileSync(path.join(sourceDir, file.name), file.contents);
      const blobs = new Map(files.map((file) => [file.objectId, Buffer.from(file.contents)]));
      const tree = Buffer.from(
        `${files
          .map(
            (file) => `100644 blob ${file.objectId}\tresources/evaos-beta/bridge/src/evaos_desktop_bridge/${file.name}`
          )
          .join('\0')}\0`
      );
      const runGit = (_command: string, args: string[]) => {
        if (args[0] === 'rev-parse') return `${commit}\n`;
        if (args[0] === 'ls-tree') return tree;
        if (args[0] === 'cat-file') return blobs.get(args[2]) ?? Buffer.alloc(0);
        throw new Error(`Unexpected git operation: ${args[0]}`);
      };
      const identity = releaseGate.committedBridgeSourceIdentity(commit, runGit, repoRoot);
      const byteSortedNames = files
        .map((file) => file.name)
        .toSorted((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')));

      expect(identity.sourcePaths).toEqual(byteSortedNames);
      expect(identity.sourceSha256).toBe(bridgeResource.directorySha256(sourceDir));
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('captures installed bridge stderr and scans the complete proof tree before reporting canary failure', () => {
    const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/evaos-beta-rc-canary.yml'), 'utf8');
    const distributionWorkflow = fs.readFileSync(
      path.join(repoRoot, '.github/workflows/release-distribute.yml'),
      'utf8'
    );

    expect(workflow).toContain('PRE_CANARY_STDERR="$RUNNER_TEMP/evaos-installed-candidate-pre-canary.stderr.txt"');
    expect(workflow).toContain('CONNECTOR_CANARY_STDERR="$RUNNER_TEMP/evaos-installed-candidate-connector.stderr.txt"');
    expect(workflow).toContain('2> "$PRE_CANARY_STDERR"');
    expect(workflow).toContain('2> "$CONNECTOR_CANARY_STDERR"');
    expect(workflow).not.toContain('$PROOF_DIR/installed-candidate-pre-canary.stderr');
    expect(workflow).not.toContain('$PROOF_DIR/installed-candidate-connector.stderr');
    expect(workflow).toContain('LC_ALL=C grep -R -F -- "$CONNECTOR_TOKEN" "$PROOF_DIR"');
    expect(workflow).toMatch(/QA_CANARY_EXIT=\$\?[\s\S]*unset CONNECTOR_TOKEN[\s\S]*QA_CANARY_EXIT/);
    expect(workflow).toContain('EVAOS_BETA_RC_RELEASE_ASSETS_DIR: release-assets');
    expect(distributionWorkflow).toMatch(
      /- name: Validate release candidate proof[\s\S]*EVAOS_BETA_RC_RELEASE_ASSETS_DIR: dist[\s\S]*verify-rc-proof rc-proof/
    );
  });

  it('binds a successful RC proof run to the exact release commit head', () => {
    const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/release-distribute.yml'), 'utf8');
    const expectedIssue =
      '.github/workflows/release-distribute.yml: Validate release candidate proof must bind the selected successful RC run headSha to the exact release commit';

    expect(releaseGate.collectReleaseDistributeWorkflowIssues(workflow)).toEqual([]);
    expect(
      releaseGate.collectReleaseDistributeWorkflowIssues(
        workflow.replace('--json conclusion,event,workflowName,headSha', '--json conclusion,event,workflowName')
      )
    ).toContain(expectedIssue);
    expect(
      releaseGate.collectReleaseDistributeWorkflowIssues(
        workflow.replace('if (run.headSha !== expectedHead) {', 'if (false) {')
      )
    ).toContain(expectedIssue);

    const verifierMatch = workflow.match(
      /node - "\$RUN_JSON" "\$EXPECTED_RELEASE_COMMIT" <<'NODE'\n([\s\S]*?)\n {10}NODE/
    );
    expect(verifierMatch).not.toBeNull();
    const verifier = String(verifierMatch?.[1] || '').replace(/^ {10}/gm, '');
    const expectedHead = 'a'.repeat(40);
    const runVerifier = (headSha: string, createdAt = new Date().toISOString()) =>
      spawnSync(
        process.execPath,
        [
          '-',
          JSON.stringify({
            conclusion: 'success',
            event: 'workflow_dispatch',
            workflowName: 'evaOS Beta RC Canary',
            headSha,
            createdAt,
          }),
          expectedHead,
        ],
        { encoding: 'utf8', input: `${verifier}\n` }
      );

    expect(runVerifier(expectedHead).status).toBe(0);
    const staleResult = runVerifier('b'.repeat(40));
    expect(staleResult.status).not.toBe(0);
    expect(staleResult.stderr).toMatch(/does not match release commit/);
    const expiredResult = runVerifier(expectedHead, new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());
    expect(expiredResult.status).not.toBe(0);
    expect(expiredResult.stderr).toMatch(/outside the 24-hour publication window/);
  });

  it('keeps RC DMG installation and installed local-control proof fail closed', () => {
    if (process.platform === 'win32') return;
    const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/evaos-beta-rc-canary.yml'), 'utf8');
    const commandSubstitutionHeredocIssue =
      '.github/workflows/evaos-beta-rc-canary.yml: macOS Bash 3.2 must not wrap updater ZIP Node heredocs in command substitution';
    const expectedIssue =
      '.github/workflows/evaos-beta-rc-canary.yml: install_app_from_dmg must not reference the ZIP-only extract_dir variable under nounset';
    const controlStartIssue =
      '.github/workflows/evaos-beta-rc-canary.yml: installed candidate must run the operator-acknowledged local control_start suite';
    const harnessIssue =
      '.github/workflows/evaos-beta-rc-canary.yml: installed connector proof must start the packaged bridge in an isolated harness before token polling and terminate only its captured child';
    const rollbackIssue =
      '.github/workflows/evaos-beta-rc-canary.yml: rollback must run after every post-install outcome';
    const failurePacketIssue =
      '.github/workflows/evaos-beta-rc-canary.yml: failures must upload only the allowlisted sanitized RC failure packet';

    expect(releaseGate.collectRcCanaryWorkflowIssues(workflow)).toEqual([]);
    expect(workflow).toContain("fs.writeFileSync(outputPath, String(asset.sha256).toLowerCase(), 'utf8');");
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        `${workflow}\n          ZIP_NAME=$(node - release-assets/latest-arm64-mac.yml <<'NODE'\n          NODE\n          )\n`
      )
    ).toContain(commandSubstitutionHeredocIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        `${workflow}\n          EXPECTED_SHA=$(node - release-assets/evaos-beta-release-manifest.json "$ZIP_NAME" <<'NODE'\n          NODE\n          )\n`
      )
    ).toContain(commandSubstitutionHeredocIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        `${workflow}\n          ZIP_NAME=$( node - release-assets/latest-arm64-mac.yml << 'NODE'\n          NODE\n          )\n`
      )
    ).toContain(commandSubstitutionHeredocIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        `${workflow}\n          ZIP_NAME="$(node - release-assets/latest-arm64-mac.yml <<'NODE'\n          NODE\n          )"\n`
      )
    ).toContain(commandSubstitutionHeredocIssue);
    const drifted = workflow.replace(
      '            hdiutil detach "$mount_dir" -quiet',
      '            rm -rf "$extract_dir"\n            hdiutil detach "$mount_dir" -quiet'
    );
    expect(releaseGate.collectRcCanaryWorkflowIssues(drifted)).toContain(expectedIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(workflow.replace('--suite control_start \\', '--suite candidate \\'))
    ).toContain(controlStartIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(workflow.replace('            --operator-ack-live-control \\\n', ''))
    ).toContain(controlStartIssue);
    expect(releaseGate.collectRcCanaryWorkflowIssues(workflow.replace('          CONNECTOR_PID=$!\n', ''))).toContain(
      harnessIssue
    );
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(workflow.replace('            const buffer = Buffer.alloc(130);\n', ''))
    ).toContain(harnessIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        workflow.replace(
          '            const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);\n',
          "            const raw = fs.readFileSync(descriptor, 'utf8');\n"
        )
      )
    ).toContain(harnessIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        workflow.replace('/bin/ps -ww -axo pid=,comm=', 'ps -axo pid=,command=')
      )
    ).toContain(harnessIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        workflow.replace(
          '            if node - "$process_snapshot" "$app_path" "$pid_output" <<\'NODE\'\n',
          '            node - "$process_snapshot" "$app_path" "$pid_output" <<\'NODE\'\n'
        )
      )
    ).toContain(harnessIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        workflow.replace('              if (match && match[1] !== canonicalApp) process.exit(2);\n', '')
      )
    ).toContain(harnessIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        workflow.replace(
          "        if: ${{ always() && steps.install_apps.outputs.mutation_started == 'true' }}\n",
          "        if: ${{ success() && steps.install_apps.outputs.mutation_started == 'true' }}\n"
        )
      )
    ).toContain(rollbackIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        workflow.replace('          echo "mutation_started=true" >> "$GITHUB_OUTPUT"\n', '')
      )
    ).toContain(rollbackIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        workflow.replace('[ "$INSTALL_STEP_OUTCOME" != "success" ]', '[ "$INSTALL_STEP_OUTCOME" = "success" ]')
      )
    ).toContain(rollbackIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        workflow.replace('          echo "RC_FALLBACK_LAUNCH_VERIFIED=true" >> "$GITHUB_ENV"\n', '')
      )
    ).toContain(rollbackIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(workflow.replace('          FALLBACK_LAUNCH_DWELL_SECONDS=8\n', ''))
    ).toContain(rollbackIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        workflow.replace('/usr/bin/grep -Fx "$FALLBACK_LAUNCH_PID" "$FALLBACK_MAIN_PIDS"', '/usr/bin/true')
      )
    ).toContain(rollbackIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        workflow.replace(
          '          echo "RC_WORKBENCH_CLEANUP_SUCCEEDED=true" >> "$GITHUB_ENV"\n\n          rm -rf "$BETA_APP"',
          '          pkill -f "evaOS Workbench" || true\n\n          rm -rf "$BETA_APP"'
        )
      )
    ).toContain(rollbackIssue);
    const rollbackStepIndex = workflow.indexOf('      - name: Roll back beta and verify fallback');
    const rollbackParserMutation = `${workflow.slice(0, rollbackStepIndex)}${workflow
      .slice(rollbackStepIndex)
      .replace(
        '            if node - "$process_snapshot" "$app_path" "$pid_output" <<\'NODE\'\n',
        '            node - "$process_snapshot" "$app_path" "$pid_output" <<\'NODE\'\n'
      )}`;
    expect(releaseGate.collectRcCanaryWorkflowIssues(rollbackParserMutation)).toContain(rollbackIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        workflow.replace('          path: rc-failure-proof\n', '          path: rc-proof\n')
      )
    ).toContain(failurePacketIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        workflow.replace(
          "        if: ${{ failure() && steps.prepare_proof.outcome == 'success' }}\n",
          '        if: ${{ success() }}\n'
        )
      )
    ).toContain(failurePacketIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        workflow.replace(
          '          mkdir -p rc-failure-proof\n',
          '          mkdir -p rc-failure-proof\n          cp "$RUNNER_TEMP/raw.stderr" rc-failure-proof/raw.stderr\n'
        )
      )
    ).toContain(failurePacketIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        workflow.replace(
          "              workbenchCleanupSucceeded: strictBoolean('RC_WORKBENCH_CLEANUP_SUCCEEDED'),\n",
          ''
        )
      )
    ).toContain(failurePacketIssue);
    expect(
      releaseGate.collectRcCanaryWorkflowIssues(
        workflow.replace(
          '            rollback: {\n',
          '            rollback: {\n              fallbackPid: process.env.FALLBACK_LAUNCH_PID,\n'
        )
      )
    ).toContain(failurePacketIssue);

    const installers = Array.from(
      workflow.matchAll(/^ {10}install_app_from_dmg\(\) \{\n[\s\S]*?^ {10}\}$/gm),
      (match) => match[0].replace(/^ {10}/gm, '')
    );
    expect(installers.length).toBeGreaterThan(0);
    for (const installer of installers) {
      const output = execFileSync(
        '/bin/bash',
        [
          '--noprofile',
          '--norc',
          '-c',
          `set -euo pipefail
rm() { :; }
mkdir() { :; }
hdiutil() { :; }
find() { printf '%s\\n' '/mounted/evaOS Workbench.app'; }
ditto() { :; }
${installer}
install_app_from_dmg fixture.dmg 'evaOS Workbench.app' /tmp/evaos-dmg-mount
printf '%s\\n' ok
`,
        ],
        { encoding: 'utf8' }
      );
      expect(output.trim()).toBe('ok');
    }
  });

  it('recognizes little-endian fat Mach-O helpers during signing closure validation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-after-sign-fat-mach-o-'));
    try {
      for (const [index, magic] of ['bebafeca', 'bfbafeca'].entries()) {
        const helperPath = path.join(dir, `helper-${index}`);
        fs.writeFileSync(helperPath, Buffer.from(`${magic}00000000`, 'hex'));
        fs.chmodSync(helperPath, 0o755);
        expect(afterSign.isMachOExecutable(helperPath)).toBe(true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

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
    expect(runtimePrep).toContain(
      'PYTHON_RUNTIME_LICENSE_SHA256:=3b2f81fe21d181c499c59a256c8e1968455d6689d269aa85373bfb6af41da3bf'
    );
    expect(runtimePrep).toContain('"$PYTHON_RUNTIME_LICENSE_SHA256" "$python_license_path"');
    expect(runtimePrep).toContain('-I -m pip check');
    expect(runtimePrep).toContain('distributions(path=[sys.argv[1]])');
    expect(runtimePrep).toContain('installed_pyobjc');
    expect(runtimePrep).toContain('expected_pyobjc');
    expect(runtimePrep).toContain('import ApplicationServices, Cocoa, CoreText, Quartz');
  });

  it('requires functional smoke to verify the packaged Peekaboo version', () => {
    const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/workbench-functional-smoke.yml'), 'utf8');

    expect(workflow).toContain('BUNDLED_PEEKABOO_SOURCE_SHA256');
    expect(workflow).toContain('BUNDLED_PEEKABOO_LICENSE_SHA256');
    expect(workflow).toContain('3.8.0');
    expect(workflow).toContain(`"$BRIDGE_PYTHON" -I -B -c 'import ApplicationServices, Cocoa, CoreText, Quartz'`);
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

    const mutableBridgeRefWorkflow = workflow.replace(
      '[[ ! "$WORKBENCH_SMOKE_BRIDGE_REF" =~ ^[0-9a-fA-F]{40}$ ]]',
      'true'
    );
    expect(releaseGate.collectFunctionalSmokeConfigIssues(mutableBridgeRefWorkflow)).toContain(
      '.github/workflows/workbench-functional-smoke.yml: bridge ref must be a full immutable commit SHA'
    );

    const missingNoBytecodeProbe = workflow
      .replace(
        `"$BRIDGE_PYTHON" -I -B -c 'import ApplicationServices, Cocoa, CoreText, Quartz'`,
        `"$BRIDGE_PYTHON" -I -c 'import ApplicationServices, Cocoa, CoreText, Quartz'\n` +
          `          # "$BRIDGE_PYTHON" -I -B -c 'import ApplicationServices, Cocoa, CoreText, Quartz'\n` +
          `          printf '%s\\n' 'env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin "$BRIDGE_PYTHON" -I -B -c import ApplicationServices, Cocoa, CoreText, Quartz'`
      )
      .concat(
        `\n# "$BRIDGE_PYTHON" -I -B -c 'import ApplicationServices, Cocoa, CoreText, Quartz'\n` +
          `  unused-probe:\n    runs-on: macos-15\n    steps:\n      - run: "$BRIDGE_PYTHON" -I -B -c 'import ApplicationServices, Cocoa, CoreText, Quartz'\n`
      );
    expect(releaseGate.collectFunctionalSmokeConfigIssues(missingNoBytecodeProbe)).toContain(
      '.github/workflows/workbench-functional-smoke.yml: packaged PyObjC import probe must disable bytecode writes with -B'
    );

    const unusedSafeProbe = workflow.replace(
      `          env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin "$BRIDGE_PYTHON" -I -B -c 'import ApplicationServices, Cocoa, CoreText, Quartz'`,
      `          never_called_probe() {\n` +
        `          env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin "$BRIDGE_PYTHON" -I -B -c 'import ApplicationServices, Cocoa, CoreText, Quartz'\n` +
        `          }\n` +
        `          env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin "$BRIDGE_PYTHON" -I -c "import ApplicationServices, Cocoa, CoreText, Quartz"`
    );
    expect(releaseGate.collectFunctionalSmokeConfigIssues(unusedSafeProbe)).toContain(
      '.github/workflows/workbench-functional-smoke.yml: packaged PyObjC import probe must disable bytecode writes with -B'
    );

    for (const skippedOrNonBlockingProbe of [
      workflow.replace(
        '      - name: Verify packaged PyObjC imports without bytecode writes\n        shell:',
        '      - name: Verify packaged PyObjC imports without bytecode writes\n        if: ${{ false }}\n        shell:'
      ),
      workflow.replace(
        '      - name: Verify packaged PyObjC imports without bytecode writes\n        shell:',
        '      - name: Verify packaged PyObjC imports without bytecode writes\n        continue-on-error: true\n        shell:'
      ),
      workflow.replace(
        '      - name: Verify packaged PyObjC imports without bytecode writes\n        shell:',
        '      - name: Verify packaged PyObjC imports without bytecode writes\n        "if": ${{ false }}\n        shell:'
      ),
      workflow.replace(
        '      - name: Verify packaged PyObjC imports without bytecode writes\n        shell:',
        "      - name: Verify packaged PyObjC imports without bytecode writes\n        'continue-on-error': true\n        shell:"
      ),
      workflow.replace(
        '      - name: Verify packaged PyObjC imports without bytecode writes\n        shell:',
        '      - name: Verify packaged PyObjC imports without bytecode writes\n        "if" : ${{ false }}\n        shell:'
      ),
      workflow.replace(
        '      - name: Verify packaged PyObjC imports without bytecode writes\n        shell:',
        '      - name: Verify packaged PyObjC imports without bytecode writes\n        continue-on-error : true\n        shell:'
      ),
      workflow.replace(
        '      - name: Verify packaged PyObjC imports without bytecode writes\n        shell:',
        '      - name: Verify packaged PyObjC imports without bytecode writes\n        "i\\u0066": ${{ false }}\n        shell:'
      ),
    ]) {
      expect(releaseGate.collectFunctionalSmokeConfigIssues(skippedOrNonBlockingProbe)).toContain(
        '.github/workflows/workbench-functional-smoke.yml: packaged PyObjC import probe must disable bytecode writes with -B'
      );
    }

    const decoyVerifyOutput = workflow.replace(
      '      - name: Verify functional-smoke artifact shape\n        id: verify',
      '      - name: Decoy artifact output\n' +
        '        id: verify\n' +
        '        shell: bash\n' +
        '        run: echo "app_path=/tmp/decoy.app" >> "$GITHUB_OUTPUT"\n\n' +
        '      - name: Verify functional-smoke artifact shape\n' +
        '        id: actual-verify'
    );
    expect(releaseGate.collectFunctionalSmokeConfigIssues(decoyVerifyOutput)).toContain(
      '.github/workflows/workbench-functional-smoke.yml: packaged PyObjC import probe must disable bytecode writes with -B'
    );

    const decoyAppPathOutput = workflow.replace(
      '          echo "app_path=$APP_PATH" >> "$GITHUB_OUTPUT"',
      '          echo "app_path=/tmp/decoy.app" >> "$GITHUB_OUTPUT"'
    );
    expect(releaseGate.collectFunctionalSmokeConfigIssues(decoyAppPathOutput)).toContain(
      '.github/workflows/workbench-functional-smoke.yml: packaged PyObjC import probe must disable bytecode writes with -B'
    );

    for (const alteredAppPathControlFlow of [
      workflow.replace(
        `          APP_PATH="$(find out -type d -name '*.app' -print -quit)"`,
        `          APP_PATH="$(find out -type d -name '*.app' -print -quit)"\n` +
          `          printf -v APP_PATH '%s' '/tmp/decoy.app'`
      ),
      workflow.replace(
        '          echo "app_path=$APP_PATH" >> "$GITHUB_OUTPUT"',
        `          if false; then\n` +
          `            echo "app_path=$APP_PATH" >> "$GITHUB_OUTPUT"\n` +
          `          fi\n` +
          `          printf '%s=%s\\n' app_path /tmp/decoy.app >> "$GITHUB_OUTPUT"`
      ),
    ]) {
      expect(releaseGate.collectFunctionalSmokeConfigIssues(alteredAppPathControlFlow)).toContain(
        '.github/workflows/workbench-functional-smoke.yml: packaged PyObjC import probe must disable bytecode writes with -B'
      );
    }

    for (const alteredProbeEnvironmentOrShell of [
      workflow.replace(
        '        shell: /usr/bin/env -u BASH_ENV /bin/bash --noprofile --norc -eo pipefail {0}',
        '        shell: /usr/bin/true {0}'
      ),
      workflow.replace(
        '      - name: Verify packaged PyObjC imports without bytecode writes\n' +
          '        shell: /usr/bin/env -u BASH_ENV /bin/bash --noprofile --norc -eo pipefail {0}\n' +
          '        env:\n' +
          '          WORKBENCH_APP_PATH:',
        '      - name: Verify packaged PyObjC imports without bytecode writes\n' +
          '        shell: /usr/bin/env -u BASH_ENV /bin/bash --noprofile --norc -eo pipefail {0}\n' +
          '        env:\n' +
          '          BASH_ENV: /tmp/exit-zero\n' +
          '          WORKBENCH_APP_PATH:'
      ),
    ]) {
      expect(releaseGate.collectFunctionalSmokeConfigIssues(alteredProbeEnvironmentOrShell)).toContain(
        '.github/workflows/workbench-functional-smoke.yml: packaged PyObjC import probe must disable bytecode writes with -B'
      );
    }
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
    const verifierPath = path.join(helperDir, 'evaos-ed25519-verify');
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
      writeMachOFixture(verifierPath);
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
  }, 15_000);

  it('requires the rotated publication variable and exact release-branch guards on executable publication jobs', () => {
    const workflows = {
      buildRelease: fs.readFileSync(path.join(repoRoot, '.github/workflows/build-and-release.yml'), 'utf8'),
      distribute: fs.readFileSync(path.join(repoRoot, '.github/workflows/release-distribute.yml'), 'utf8'),
      reusableBuild: fs.readFileSync(path.join(repoRoot, '.github/workflows/_build-reusable.yml'), 'utf8'),
    };

    expect(releaseGate.collectPublicationWorkflowIssues(workflows)).toEqual([]);

    const legacyPublicationPath = {
      ...workflows,
      distribute: workflows.distribute.replace(
        'vars.EVAOS_BETA_RELEASE_V2136_PUBLISH_ENABLED',
        'vars.EVAOS_BETA_RELEASE_PUBLISH_ENABLED'
      ),
    };
    expect(releaseGate.collectPublicationWorkflowIssues(legacyPublicationPath)).toContain(
      '.github/workflows/release-distribute.yml: executable publication paths must not use vars.EVAOS_BETA_RELEASE_PUBLISH_ENABLED'
    );

    const unguardedCreateTag = {
      ...workflows,
      buildRelease: workflows.buildRelease.replace("vars.EVAOS_BETA_RELEASE_V2136_PUBLISH_ENABLED == 'true'", 'true'),
    };
    expect(releaseGate.collectPublicationWorkflowIssues(unguardedCreateTag)).toContain(
      '.github/workflows/build-and-release.yml: jobs.create-tag must require vars.EVAOS_BETA_RELEASE_V2136_PUBLISH_ENABLED'
    );

    const missingRefGuard = {
      ...workflows,
      distribute: workflows.distribute
        .replace("github.ref_type == 'branch' &&", 'true &&')
        .replace(
          '    if: |',
          `    env:\n      BRANCH_GUARD_DECOY: "github.ref_type == 'branch' && github.ref == format('refs/heads/{0}', vars.EVAOS_BETA_RELEASE_BRANCH)"\n    if: |`
        )
        .concat(
          "\n# github.ref_type == 'branch' && github.ref == format('refs/heads/{0}', vars.EVAOS_BETA_RELEASE_BRANCH)\n"
        ),
    };
    expect(releaseGate.collectPublicationWorkflowIssues(missingRefGuard)).toContain(
      '.github/workflows/release-distribute.yml: jobs.distribute must require a branch ref matching vars.EVAOS_BETA_RELEASE_BRANCH'
    );

    const publicationJobs = [
      { workflowKey: 'buildRelease' as const, jobName: 'create-tag', file: '.github/workflows/build-and-release.yml' },
      { workflowKey: 'buildRelease' as const, jobName: 'release', file: '.github/workflows/build-and-release.yml' },
      {
        workflowKey: 'buildRelease' as const,
        jobName: 'register-local-signed-dmg-manifest',
        file: '.github/workflows/build-and-release.yml',
      },
      { workflowKey: 'distribute' as const, jobName: 'distribute', file: '.github/workflows/release-distribute.yml' },
    ];
    const guards = [
      {
        guard: "vars.EVAOS_BETA_RELEASE_V2136_PUBLISH_ENABLED == 'true'",
        issue: (file: string, jobName: string) =>
          `${file}: jobs.${jobName} must require vars.EVAOS_BETA_RELEASE_V2136_PUBLISH_ENABLED`,
      },
      {
        guard: "github.ref_type == 'branch' && github.ref == format('refs/heads/{0}', vars.EVAOS_BETA_RELEASE_BRANCH)",
        issue: (file: string, jobName: string) =>
          `${file}: jobs.${jobName} must require a branch ref matching vars.EVAOS_BETA_RELEASE_BRANCH`,
      },
    ];
    for (const { workflowKey, jobName, file } of publicationJobs) {
      const workflow = workflows[workflowKey];
      const start = workflow.indexOf(`  ${jobName}:`);
      const remainder = workflow.slice(start + 1);
      const nextJobOffset = remainder.search(/^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/m);
      const end = nextJobOffset === -1 ? workflow.length : start + 1 + nextJobOffset;
      const jobBlock = workflow.slice(start, end);
      expect(start).toBeGreaterThanOrEqual(0);
      for (const { guard, issue } of guards) {
        const driftedJob = jobBlock
          .replace(guard, 'true')
          .replace('    if: |', `    env:\n      AUTH_GUARD_DECOY: "${guard}"\n    if: |`)
          .concat(`\n    # ${guard}\n`);
        expect(driftedJob).not.toBe(jobBlock);
        expect(
          releaseGate.collectPublicationWorkflowIssues({
            ...workflows,
            [workflowKey]: workflow.slice(0, start) + driftedJob + workflow.slice(end),
          })
        ).toContain(issue(file, jobName));
      }

      const alwaysTrueJob = jobBlock.replace(
        "vars.EVAOS_BETA_RELEASE_V2136_PUBLISH_ENABLED == 'true'",
        "true || (vars.EVAOS_BETA_RELEASE_V2136_PUBLISH_ENABLED == 'true')"
      );
      expect(
        releaseGate.collectPublicationWorkflowIssues({
          ...workflows,
          [workflowKey]: workflow.slice(0, start) + alwaysTrueJob + workflow.slice(end),
        })
      ).toContain(`${file}: jobs.${jobName} publication condition must match the audited allowlist`);
    }
  });

  it('binds the live-canary audit to the exact distribute job named step and executable data flow', () => {
    const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/release-distribute.yml'), 'utf8');

    expect(releaseGate.collectReleaseDistributeWorkflowIssues(workflow)).toEqual([]);

    const driftedWithDecoys = workflow
      .replace(
        '          /bin/bash scripts/evaosValidateLiveCanaryProofRun.sh',
        '          if false; then\n            /bin/bash scripts/evaosValidateLiveCanaryProofRun.sh\n          fi'
      )
      .replace(
        '          EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: ${{ github.event.inputs.live_canary_proof_run_id }}',
        '          EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: decoy'
      ).concat(`
# /bin/bash scripts/evaosValidateLiveCanaryProofRun.sh
# EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: \${{ github.event.inputs.live_canary_proof_run_id }}
  unused-decoy:
    runs-on: ubuntu-latest
    steps:
      - name: Validate live broker surface proof
        env:
          EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: \${{ github.event.inputs.live_canary_proof_run_id }}
        run: |
          /bin/bash scripts/evaosValidateLiveCanaryProofRun.sh
`);

    const issues = releaseGate.collectReleaseDistributeWorkflowIssues(driftedWithDecoys);
    expect(issues).toContain(
      '.github/workflows/release-distribute.yml: Validate live broker surface proof must execute only the dedicated verifier script'
    );
    expect(issues).toContain(
      '.github/workflows/release-distribute.yml: Validate live broker surface proof must bind the selected proof run id through its env block'
    );

    const driftedWithInlineComments = workflow
      .replace(
        '          /bin/bash scripts/evaosValidateLiveCanaryProofRun.sh',
        `          # /bin/bash scripts/evaosValidateLiveCanaryProofRun.sh\n` +
          `          echo '/bin/bash scripts/evaosValidateLiveCanaryProofRun.sh'`
      )
      .replace(
        '          EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: ${{ github.event.inputs.live_canary_proof_run_id }}',
        `          EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: decoy\n` +
          `          # EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: \${{ github.event.inputs.live_canary_proof_run_id }}`
      );
    const inlineCommentIssues = releaseGate.collectReleaseDistributeWorkflowIssues(driftedWithInlineComments);
    expect(inlineCommentIssues).toContain(
      '.github/workflows/release-distribute.yml: Validate live broker surface proof must execute only the dedicated verifier script'
    );
    expect(inlineCommentIssues).toContain(
      '.github/workflows/release-distribute.yml: Validate live broker surface proof must bind the selected proof run id through its env block'
    );

    for (const skippedOrNonBlockingProof of [
      workflow.replace(
        '      - name: Validate live broker surface proof\n        shell:',
        '      - name: Validate live broker surface proof\n        if: ${{ false }}\n        shell:'
      ),
      workflow.replace(
        '      - name: Validate live broker surface proof\n        shell:',
        '      - name: Validate live broker surface proof\n        continue-on-error: true\n        shell:'
      ),
      workflow.replace(
        '      - name: Validate live broker surface proof\n        shell:',
        '      - name: Validate live broker surface proof\n        "if" : ${{ false }}\n        shell:'
      ),
      workflow.replace(
        '      - name: Validate live broker surface proof\n        shell:',
        '      - name: Validate live broker surface proof\n        "i\\u0066": ${{ false }}\n        shell:'
      ),
    ]) {
      expect(releaseGate.collectReleaseDistributeWorkflowIssues(skippedOrNonBlockingProof)).toContain(
        '.github/workflows/release-distribute.yml: Validate live broker surface proof must execute only the dedicated verifier script'
      );
    }

    for (const alteredProofEnvironmentOrShell of [
      workflow.replace(
        '        shell: /usr/bin/env -u BASH_ENV /bin/bash --noprofile --norc -eo pipefail {0}',
        '        shell: /usr/bin/true {0}'
      ),
      workflow.replace(
        '      - name: Validate live broker surface proof\n' +
          '        shell: /usr/bin/env -u BASH_ENV /bin/bash --noprofile --norc -eo pipefail {0}\n' +
          '        env:\n' +
          '          GH_TOKEN:',
        '      - name: Validate live broker surface proof\n' +
          '        shell: /usr/bin/env -u BASH_ENV /bin/bash --noprofile --norc -eo pipefail {0}\n' +
          '        env:\n' +
          '          BASH_ENV: /tmp/exit-zero\n' +
          '          GH_TOKEN:'
      ),
    ]) {
      expect(releaseGate.collectReleaseDistributeWorkflowIssues(alteredProofEnvironmentOrShell)).toContain(
        '.github/workflows/release-distribute.yml: Validate live broker surface proof must execute only the dedicated verifier script'
      );
    }

    const staleProofWindow = workflow.replace(
      "          EVAOS_LIVE_CANARY_MAX_PROOF_AGE_HOURS: '24'",
      "          EVAOS_LIVE_CANARY_MAX_PROOF_AGE_HOURS: '999999'"
    );
    expect(releaseGate.collectReleaseDistributeWorkflowIssues(staleProofWindow)).toContain(
      '.github/workflows/release-distribute.yml: Validate live broker surface proof env block is missing EVAOS_LIVE_CANARY_MAX_PROOF_AGE_HOURS: 24'
    );

    const skippedProof = workflow.replace(
      '          /bin/bash scripts/evaosValidateLiveCanaryProofRun.sh',
      '          if false; then\n            /bin/bash scripts/evaosValidateLiveCanaryProofRun.sh\n          fi'
    );
    expect(releaseGate.collectReleaseDistributeWorkflowIssues(skippedProof)).toContain(
      '.github/workflows/release-distribute.yml: Validate live broker surface proof must execute only the dedicated verifier script'
    );
  });

  it('behaviorally requires the live-canary verifier script to execute the proof verifier', () => {
    if (process.platform === 'win32') return;
    expect(releaseGate.collectLiveCanaryVerifierBehaviorIssues(repoRoot)).toEqual([]);

    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-canary-verifier-bypass-'));
    try {
      const scriptDir = path.join(fixtureRoot, 'scripts');
      fs.mkdirSync(scriptDir, { recursive: true });
      const verifier = fs.readFileSync(path.join(repoRoot, 'scripts/evaosValidateLiveCanaryProofRun.sh'), 'utf8');
      const bypassedVerifier = verifier.replace('set -euo pipefail', 'set -euo pipefail\n\nif false; then');
      const fixtureVerifier = path.join(scriptDir, 'evaosValidateLiveCanaryProofRun.sh');
      fs.writeFileSync(fixtureVerifier, `${bypassedVerifier}\nfi\nexit 0\n`);
      fs.chmodSync(fixtureVerifier, 0o755);

      expect(releaseGate.collectLiveCanaryVerifierBehaviorIssues(fixtureRoot)).toContain(
        'scripts/evaosValidateLiveCanaryProofRun.sh: isolated behavior probe must execute the live-canary proof verifier'
      );

      const partialProvenanceVerifier = verifier.replace(
        /node - "\$RUN_JSON" "\$EXPECTED_RELEASE_COMMIT" <<'NODE'[\s\S]*?\nNODE/,
        `node - "$RUN_JSON" "$EXPECTED_RELEASE_COMMIT" <<'NODE'\n` +
          `const run = JSON.parse(process.argv[2]);\n` +
          `if (run.conclusion !== 'success') throw new Error('Live canary proof run failed.');\n` +
          `NODE`
      );
      fs.writeFileSync(fixtureVerifier, partialProvenanceVerifier);
      expect(releaseGate.collectLiveCanaryVerifierBehaviorIssues(fixtureRoot)).toContain(
        'scripts/evaosValidateLiveCanaryProofRun.sh: isolated behavior probe must execute the live-canary proof verifier'
      );
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('runs the live-canary behavior probe only with Bash 4 or newer', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-canary-bash-version-'));
    try {
      const bash3 = path.join(fixtureRoot, 'bash3');
      const bash5 = path.join(fixtureRoot, 'bash5');
      fs.writeFileSync(bash3, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      fs.writeFileSync(bash5, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

      expect(releaseGate.resolveLiveCanaryVerifierAuditBash([bash3, bash5])).toBe(bash5);
      expect(releaseGate.resolveLiveCanaryVerifierAuditBash([bash3])).toBe('');
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('rejects forged verifier audit evidence and swallowed proof-verifier failures', () => {
    if (process.platform === 'win32') return;
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-canary-verifier-forgery-'));
    try {
      const scriptDir = path.join(fixtureRoot, 'scripts');
      fs.mkdirSync(scriptDir, { recursive: true });
      const fixtureVerifier = path.join(scriptDir, 'evaosValidateLiveCanaryProofRun.sh');
      fs.writeFileSync(
        fixtureVerifier,
        `#!/bin/bash\n` +
          `set -euo pipefail\n` +
          `printf '%s\\n' 'gh|args=run view 123456789' >> "\${EVAOS_VERIFIER_AUDIT_LOG}"\n` +
          `printf '%s\\n' 'gh|args=run download 123456789' >> "\${EVAOS_VERIFIER_AUDIT_LOG}"\n` +
          `printf '%s\\n' 'node|required=true|args=scripts/evaosBetaReleaseGate.js verify-live-canary-proof live-canary-proof' >> "\${EVAOS_VERIFIER_AUDIT_LOG}"\n`
      );
      fs.chmodSync(fixtureVerifier, 0o755);
      expect(releaseGate.collectLiveCanaryVerifierBehaviorIssues(fixtureRoot)).toContain(
        'scripts/evaosValidateLiveCanaryProofRun.sh: isolated behavior probe must execute the live-canary proof verifier'
      );

      const verifier = fs.readFileSync(path.join(repoRoot, 'scripts/evaosValidateLiveCanaryProofRun.sh'), 'utf8');
      fs.writeFileSync(
        fixtureVerifier,
        verifier.replace(
          'node scripts/evaosBetaReleaseGate.js verify-live-canary-proof live-canary-proof',
          'node scripts/evaosBetaReleaseGate.js verify-live-canary-proof live-canary-proof || true'
        )
      );
      expect(releaseGate.collectLiveCanaryVerifierBehaviorIssues(fixtureRoot)).toContain(
        'scripts/evaosValidateLiveCanaryProofRun.sh: isolated behavior probe must execute the live-canary proof verifier'
      );
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('requires the verifier to execute and enforce live-canary run provenance validation', () => {
    if (process.platform === 'win32') return;
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-canary-provenance-bypass-'));
    try {
      const scriptDir = path.join(fixtureRoot, 'scripts');
      fs.mkdirSync(scriptDir, { recursive: true });
      const verifier = fs.readFileSync(path.join(repoRoot, 'scripts/evaosValidateLiveCanaryProofRun.sh'), 'utf8');
      const bypassedVerifier = verifier
        .replace(
          'node - "$RUN_JSON" "$EXPECTED_RELEASE_COMMIT" <<\'NODE\'',
          'if false; then\nnode - "$RUN_JSON" "$EXPECTED_RELEASE_COMMIT" <<\'NODE\''
        )
        .replace('\nNODE\n\nrm -rf live-canary-proof-download', '\nNODE\nfi\n\nrm -rf live-canary-proof-download');
      const fixtureVerifier = path.join(scriptDir, 'evaosValidateLiveCanaryProofRun.sh');
      fs.writeFileSync(fixtureVerifier, bypassedVerifier);
      fs.chmodSync(fixtureVerifier, 0o755);

      expect(releaseGate.collectLiveCanaryVerifierBehaviorIssues(fixtureRoot)).toContain(
        'scripts/evaosValidateLiveCanaryProofRun.sh: isolated behavior probe must execute the live-canary proof verifier'
      );
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
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

  it('requires the distribution workflow to bind the Mac-control proof to the selected same-head run', () => {
    const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/release-distribute.yml'), 'utf8');
    const verifier = fs.readFileSync(path.join(repoRoot, 'scripts/evaosValidateLiveCanaryProofRun.sh'), 'utf8');

    expect(workflow).toContain('/bin/bash scripts/evaosValidateLiveCanaryProofRun.sh');
    expect(verifier).toContain('mac-control-runtime.json');
    expect(verifier).toContain('mac-control-deployed-route.json');
    expect(verifier).toContain('Run Mac-control canary: true');
    expect(verifier).toContain('requires-mac-control-proof');
    expect(verifier).toContain('EVAOS_REQUIRE_MAC_CONTROL_LIVE_CANARY_PROOF="$MAC_CONTROL_PROOF_REQUIRED"');
    expect(workflow).toContain(
      'EVAOS_LIVE_CANARY_EXPECTED_SOURCE_HEAD_SHA: ${{ steps.provenance.outputs.tag_commit }}'
    );
    expect(workflow).toContain(
      'EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: ${{ github.event.inputs.live_canary_proof_run_id }}'
    );
    expect(workflow).toContain('EVAOS_LIVE_CANARY_CONTEXT_KEY_ID: ${{ vars.EVAOS_MAC_CONTROL_CONTEXT_KEY_ID }}');
    expect(workflow).toContain('EVAOS_LIVE_CANARY_RECEIPT_KEY_ID: ${{ vars.EVAOS_MAC_CONTROL_RECEIPT_KEY_ID }}');
    expect(workflow).toContain(
      'EVAOS_LIVE_CANARY_RECEIPT_PUBLIC_KEY: ${{ vars.EVAOS_MAC_CONTROL_RECEIPT_PUBLIC_KEY }}'
    );
  });

  it('requires Mac-control proof starting at 2.1.36 without breaking historical tag retries', () => {
    expect(releaseGate.requiresMacControlLiveCanaryProof('evaos-beta-v2.1.35-evaos-beta')).toBe(false);
    expect(releaseGate.requiresMacControlLiveCanaryProof('2.1.35-evaos-beta.4')).toBe(false);
    expect(releaseGate.requiresMacControlLiveCanaryProof('evaos-beta-v2.1.36-evaos-beta')).toBe(true);
    expect(releaseGate.requiresMacControlLiveCanaryProof('2.1.36-evaos-beta.0')).toBe(true);
    expect(releaseGate.requiresMacControlLiveCanaryProof('evaos-beta-v2.2.0-evaos-beta')).toBe(true);
    expect(() => releaseGate.requiresMacControlLiveCanaryProof('evaos-beta-latest')).toThrow(/version/i);
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

  it('requires one sanitized same-head Mac-control proof when the release gate enables it', () => {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-mac-control-proof-'));
    const releaseEnv = {
      ...liveCanaryProofEnv,
      ...macControlProofTrustEnv,
      EVAOS_REQUIRE_MAC_CONTROL_LIVE_CANARY_PROOF: 'true',
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_HEAD_SHA: fixtureReleaseCommit,
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: '12345',
    };
    try {
      writeBrokerLiveCanaryProof(proofDir);
      expect(() => releaseGate.verifyBrokerLiveCanaryProof(proofDir, releaseEnv)).toThrow(/Mac-control.*proof/i);

      writeMacControlLiveCanaryProof(proofDir);
      expect(releaseGate.verifyBrokerLiveCanaryProof(proofDir, releaseEnv)).toBe(true);
      expect(releaseGate.verifyMacControlLiveCanaryProof(proofDir, releaseEnv)).toBe(true);
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('requires sanitized proof that the temporary Mac-control session was revoked', () => {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-mac-control-cleanup-proof-'));
    const releaseEnv = {
      ...macControlProofTrustEnv,
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_HEAD_SHA: fixtureReleaseCommit,
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: '12345',
    };
    try {
      writeMacControlLiveCanaryProof(proofDir);
      const cleanupPath = path.join(proofDir, 'mac-control-session-cleanup.json');
      fs.writeFileSync(
        cleanupPath,
        `${JSON.stringify({
          schema: 'evaos-mac-control-canary-session-cleanup/v1',
          sessionRevoked: false,
          sensitiveOutput: 'passed',
        })}\n`
      );
      expect(() => releaseGate.verifyMacControlLiveCanaryProof(proofDir, releaseEnv)).toThrow(/cleanup.*revoked/i);

      fs.rmSync(cleanupPath);
      expect(() => releaseGate.verifyMacControlLiveCanaryProof(proofDir, releaseEnv)).toThrow(/cleanup.*proof/i);
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('requires sanitized proof of the database-backed staging marker', () => {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-mac-control-staging-marker-'));
    const releaseEnv = {
      ...macControlProofTrustEnv,
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_HEAD_SHA: fixtureReleaseCommit,
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: '12345',
    };
    try {
      writeMacControlLiveCanaryProof(proofDir);
      fs.rmSync(path.join(proofDir, 'mac-control-session-provisioning.json'));
      expect(() => releaseGate.verifyMacControlLiveCanaryProof(proofDir, releaseEnv)).toThrow(
        /staging marker|provisioning proof/i
      );
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('rejects failed, incomplete, unsafe, tampered, or wrong-head Mac-control release proof', () => {
    const releaseEnv = {
      ...macControlProofTrustEnv,
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_HEAD_SHA: fixtureReleaseCommit,
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: '12345',
    };
    const cases: Array<{
      name: string;
      options?: Record<string, unknown>;
      mutate?: (proof: Record<string, unknown>) => void;
      error: RegExp;
    }> = [
      {
        name: 'failed',
        options: { attestationOverrides: { outcome: 'failed' } },
        error: /successful signed direct-control attestation/i,
      },
      {
        name: 'incomplete',
        options: { runRef: 'not-a-run-reference' },
        error: /proof run/i,
      },
      {
        name: 'unsafe',
        mutate: (proof) => {
          proof.customerId = 'private-customer';
        },
        error: /forbidden field|secret material/,
      },
      {
        name: 'tampered-signature',
        mutate: (proof) => {
          proof.signature = String(proof.signature).replace('A', 'B');
        },
        error: /signature is invalid/i,
      },
      {
        name: 'wrong-head',
        options: { candidate: { sourceCommit: 'b'.repeat(40) } },
        error: /candidate.*release commit/i,
      },
    ];

    for (const testCase of cases) {
      const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), `evaos-live-mac-control-${testCase.name}-`));
      try {
        writeMacControlLiveCanaryProof(proofDir, testCase.options);
        const proofPath = path.join(proofDir, 'mac-control-runtime.json');
        const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8')) as Record<string, unknown>;
        if (testCase.mutate) {
          testCase.mutate(proof);
          fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
        }
        expect(() => releaseGate.verifyMacControlLiveCanaryProof(proofDir, releaseEnv)).toThrow(testCase.error);
      } finally {
        fs.rmSync(proofDir, { recursive: true, force: true });
      }
    }
  });

  it('rejects legacy unsigned evidence, artifact-supplied trust, and the wrong external receipt key', () => {
    const releaseEnv = {
      ...macControlProofTrustEnv,
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_HEAD_SHA: fixtureReleaseCommit,
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: '12345',
    };
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-mac-control-trust-boundary-'));
    try {
      writeMacControlLiveCanaryProof(proofDir);
      const proofPath = path.join(proofDir, 'mac-control-runtime.json');
      const envelope = JSON.parse(fs.readFileSync(proofPath, 'utf8')) as Record<string, unknown>;

      fs.writeFileSync(
        proofPath,
        `${JSON.stringify({
          schema: 'evaos.mac_control.runtime_proof.v2',
          ok: true,
          outcome: 'succeeded',
          candidate: { sourceCommit: fixtureReleaseCommit },
        })}\n`
      );
      expect(() => releaseGate.verifyMacControlLiveCanaryProof(proofDir, releaseEnv)).toThrow(
        /forbidden field|signed-attestation fields/i
      );

      fs.writeFileSync(
        proofPath,
        `${JSON.stringify({ ...envelope, publicKey: macControlProofTrustEnv.EVAOS_LIVE_CANARY_RECEIPT_PUBLIC_KEY })}\n`
      );
      expect(() => releaseGate.verifyMacControlLiveCanaryProof(proofDir, releaseEnv)).toThrow(/forbidden field/i);

      fs.writeFileSync(proofPath, `${JSON.stringify(envelope)}\n`);
      const wrongKeyPair = generateKeyPairSync('ed25519');
      const wrongKeyEnv = {
        ...releaseEnv,
        EVAOS_LIVE_CANARY_RECEIPT_PUBLIC_KEY: wrongKeyPair.publicKey
          .export({ format: 'der', type: 'spki' })
          .subarray(-32)
          .toString('base64url'),
      };
      expect(() => releaseGate.verifyMacControlLiveCanaryProof(proofDir, wrongKeyEnv)).toThrow(/signature is invalid/i);
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('requires a fresh, canonical, bounded historical runtime receipt', () => {
    const verificationNow = Date.parse('2026-07-15T12:00:00.000Z');
    const releaseEnv = {
      ...macControlProofTrustEnv,
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_HEAD_SHA: fixtureReleaseCommit,
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: '12345',
      EVAOS_LIVE_CANARY_MAX_PROOF_AGE_HOURS: '24',
    };
    const validExecutedAt = verificationNow - 60 * 60 * 1000;
    const validDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-mac-control-historical-'));
    try {
      writeMacControlLiveCanaryProof(validDir, {
        executedAt: new Date(validExecutedAt).toISOString(),
        expiresAt: Math.floor(validExecutedAt / 1000) + 60,
      });
      expect(
        releaseGate.verifyMacControlLiveCanaryProof(validDir, releaseEnv, {
          now: new Date(verificationNow),
          maxAgeHours: 24,
        })
      ).toBe(true);
    } finally {
      fs.rmSync(validDir, { recursive: true, force: true });
    }

    const cases = [
      {
        name: 'future',
        executedAt: verificationNow + 5_001,
        expiresAt: Math.floor((verificationNow + 5_001) / 1000) + 60,
      },
      {
        name: 'stale',
        executedAt: verificationNow - 25 * 60 * 60 * 1000,
        expiresAt: Math.floor((verificationNow - 25 * 60 * 60 * 1000) / 1000) + 60,
      },
      {
        name: 'overlong',
        executedAt: verificationNow - 1_000,
        expiresAt: Math.floor((verificationNow - 1_000) / 1000) + 67,
      },
    ];
    for (const testCase of cases) {
      const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), `evaos-live-mac-control-${testCase.name}-`));
      try {
        writeMacControlLiveCanaryProof(proofDir, {
          executedAt: new Date(testCase.executedAt).toISOString(),
          expiresAt: testCase.expiresAt,
        });
        expect(() =>
          releaseGate.verifyMacControlLiveCanaryProof(proofDir, releaseEnv, {
            now: new Date(verificationNow),
            maxAgeHours: 24,
          })
        ).toThrow(/signed attestation fields/i);
      } finally {
        fs.rmSync(proofDir, { recursive: true, force: true });
      }
    }

    const noncanonicalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-live-mac-control-noncanonical-'));
    try {
      writeMacControlLiveCanaryProof(noncanonicalDir, {
        executedAt: '2026-07-15 11:59:59Z',
        expiresAt: Math.floor(verificationNow / 1000) + 59,
      });
      expect(() =>
        releaseGate.verifyMacControlLiveCanaryProof(noncanonicalDir, releaseEnv, {
          now: new Date(verificationNow),
          maxAgeHours: 24,
        })
      ).toThrow(/signed attestation fields/i);
    } finally {
      fs.rmSync(noncanonicalDir, { recursive: true, force: true });
    }
  });

  it('rejects missing, false, mismatched, or extended runtime-receipt negative proof', () => {
    const releaseEnv = {
      ...macControlProofTrustEnv,
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_HEAD_SHA: fixtureReleaseCommit,
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: '12345',
    };
    const cases: Array<{
      name: string;
      mutate: (proofDir: string, proof: Record<string, unknown>) => void;
    }> = [
      {
        name: 'missing',
        mutate: (proofDir) => fs.rmSync(path.join(proofDir, 'mac-control-runtime-negative.json')),
      },
      {
        name: 'false-assertion',
        mutate: (_proofDir, proof) => {
          const classifications = proof.classifications as Record<string, Record<string, unknown>>;
          classifications.replay.secondRejected = false;
        },
      },
      {
        name: 'wrong-head',
        mutate: (_proofDir, proof) => {
          (proof.candidate as Record<string, unknown>).sourceCommit = 'e'.repeat(40);
        },
      },
      {
        name: 'wrong-run',
        mutate: (_proofDir, proof) => {
          proof.sourceRunId = '99999';
        },
      },
      {
        name: 'extra-field',
        mutate: (_proofDir, proof) => {
          proof.note = 'must not be accepted';
        },
      },
    ];

    for (const testCase of cases) {
      const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), `evaos-live-mac-control-negative-${testCase.name}-`));
      try {
        writeMacControlLiveCanaryProof(proofDir);
        const proofPath = path.join(proofDir, 'mac-control-runtime-negative.json');
        const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8')) as Record<string, unknown>;
        testCase.mutate(proofDir, proof);
        if (fs.existsSync(proofPath)) fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
        expect(() => releaseGate.verifyMacControlLiveCanaryProof(proofDir, releaseEnv)).toThrow(
          /negative proof|negative candidate|negative classifications/i
        );
      } finally {
        fs.rmSync(proofDir, { recursive: true, force: true });
      }
    }
  });

  it('rejects missing, false, mismatched, stale, or extended deployed-route proof', () => {
    const verificationNow = new Date('2026-07-15T12:00:00.000Z');
    const releaseEnv = {
      ...macControlProofTrustEnv,
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_HEAD_SHA: fixtureReleaseCommit,
      EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: '12345',
      EVAOS_LIVE_CANARY_MAX_PROOF_AGE_HOURS: '24',
    };
    const cases: Array<{
      name: string;
      mutate: (proofDir: string, proof: Record<string, unknown>) => void;
      error: RegExp;
    }> = [
      {
        name: 'missing',
        mutate: (proofDir) => fs.rmSync(path.join(proofDir, 'mac-control-deployed-route.json')),
        error: /deployed route probe/i,
      },
      {
        name: 'false-assertion',
        mutate: (_proofDir, proof) => {
          (proof.assertions as Record<string, unknown>).strictBody = false;
        },
        error: /deployed route assertions/i,
      },
      {
        name: 'wrong-head',
        mutate: (_proofDir, proof) => {
          proof.sourceHeadSha = 'e'.repeat(40);
        },
        error: /exact release run/i,
      },
      {
        name: 'wrong-run',
        mutate: (_proofDir, proof) => {
          proof.sourceRunId = '99999';
        },
        error: /exact release run/i,
      },
      {
        name: 'stale',
        mutate: (_proofDir, proof) => {
          proof.checkedAt = '2026-07-13T11:59:59.000Z';
        },
        error: /stale/i,
      },
      {
        name: 'extra-field',
        mutate: (_proofDir, proof) => {
          proof.note = 'must not be accepted';
        },
        error: /exact release run/i,
      },
    ];

    for (const testCase of cases) {
      const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), `evaos-live-mac-control-route-${testCase.name}-`));
      try {
        writeMacControlLiveCanaryProof(proofDir, {
          executedAt: '2026-07-15T11:59:00.000Z',
          authorityExpiresAt: Date.parse('2026-07-15T12:00:00.000Z') / 1000,
        });
        const proofPath = path.join(proofDir, 'mac-control-deployed-route.json');
        const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8')) as Record<string, unknown>;
        testCase.mutate(proofDir, proof);
        if (fs.existsSync(proofPath)) fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
        expect(() =>
          releaseGate.verifyMacControlLiveCanaryProof(proofDir, releaseEnv, { now: verificationNow, maxAgeHours: 24 })
        ).toThrow(testCase.error);
      } finally {
        fs.rmSync(proofDir, { recursive: true, force: true });
      }
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
        EVAOS_BETA_RELEASE_COMMIT: fixtureReleaseCommit,
        EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
        EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
        EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
      });

      expect(
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
        })
      ).toBe(true);

      fs.writeFileSync(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'tampered');
      expect(() =>
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
        })
      ).toThrow(/checksum/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects macOS release ZIPs without exact Mac-control package proof', () => {
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
        name: 'tampered bridge launcher',
        options: { tamperBridgeWrapper: true },
        expected: /canonical launcher digest/,
      },
      {
        name: 'tampered GUI-owned bridge source',
        options: { tamperBridgeSource: true },
        expected: /GUI-owned Python source digest/,
      },
      {
        name: 'self-attested tampered GUI-owned bridge source',
        options: { selfAttestTamperedBridgeSource: true },
        expected: /GUI-owned Python source digest/,
      },
      {
        name: 'unexpected importable bridge source sibling',
        options: { extraBridgeSourceEntry: true },
        expected: /exact committed GUI source tree/,
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
      {
        name: 'missing Cocoa payload',
        options: { omitCocoa: true },
        expected: /bundled PyObjC control modules/,
      },
      {
        name: 'missing CoreText payload',
        options: { omitCoreText: true },
        expected: /bundled PyObjC control modules/,
      },
      {
        name: 'wrong Python launcher architecture',
        options: { wrongPythonLauncherArchitecture: true },
        expected: /relocatable bundled Python launcher/,
      },
      {
        name: 'regular-file Python launcher',
        options: { regularPythonLauncher: true },
        expected: /relocatable bundled Python launcher/,
      },
      {
        name: 'regular-file substitution for an inventoried Python symlink',
        options: { regularInventorySymlink: true },
        expected: /Python runtime inventory/,
      },
      {
        name: 'wrong inventoried Python symlink target',
        options: { inventorySymlinkArchiveTarget: 'encodings/__init__.py' },
        expected: /Python runtime inventory/,
      },
      {
        name: 'escaping inventoried Python symlink target',
        options: {
          inventorySymlinkArchiveTarget: '../../../outside',
          inventorySymlinkDeclaredTarget: '../../../outside',
        },
        expected: /Python runtime inventory/,
      },
      {
        name: 'traversable Python directory with mismatched inventory mode',
        options: { inventoryDirectoryArchiveMode: 0o700 },
        expected: /Python runtime inventory/,
      },
      {
        name: 'ordinary Python file with mismatched inventory mode',
        options: { inventoryFileArchiveMode: 0o600 },
        expected: /Python runtime inventory/,
      },
      {
        name: 'non-traversable Python directory',
        options: { nonTraversablePythonDirectory: true },
        expected: /Python runtime inventory/,
      },
      {
        name: 'non-traversable Python runtime root',
        options: { nonTraversablePythonRoot: true },
        expected: /Python runtime inventory/,
      },
      {
        name: 'normalized Python entry collision',
        options: { normalizedPythonEntryCollision: true },
        expected: /Python runtime inventory/,
      },
      {
        name: 'multiple app roots',
        options: { secondAppRoot: true },
        expected: /exactly one \.app root/,
      },
      {
        name: 'wrong app root',
        options: { wrongAppRoot: true },
        expected: /exactly one \.app root/,
      },
      {
        name: 'missing app Info.plist',
        options: { omitInfoPlist: true },
        expected: /canonical Info\.plist/,
      },
      {
        name: 'malformed app Info.plist',
        options: { malformedInfoPlist: true },
        expected: /canonical Info\.plist/,
      },
      {
        name: 'wrong bundle identifier',
        options: { wrongBundleIdentifier: true },
        expected: /bundle identifier/,
      },
      {
        name: 'wrong product name',
        options: { wrongProductName: true },
        expected: /product name/,
      },
      {
        name: 'wrong short version',
        options: { wrongShortVersion: true },
        expected: /tag-bound short version/,
      },
      {
        name: 'wrong bundle version',
        options: { wrongBundleVersion: true },
        expected: /tag-bound bundle version/,
      },
      ...(['bridge', 'peekaboo', 'helper', 'verifier', 'python'] as const).map((payload) => ({
        name: `non-executable ${payload}`,
        options: { nonExecutablePayload: payload },
        expected: /executable ZIP mode/,
      })),
      {
        name: 'missing inventoried runtime file',
        options: { omitInventoriedRuntimeFile: true },
        expected: /Python runtime inventory/,
      },
      {
        name: 'self-consistent missing stdlib sentinel',
        options: { omitStdlibSentinel: true },
        expected: /Python stdlib sentinel/,
      },
      {
        name: 'self-consistent missing Foundation native sentinel',
        options: { omitFoundationNative: true },
        expected: /PyObjC native sentinel/,
      },
    ];

    for (const testCase of cases) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `evaos-beta-peekaboo-${testCase.name.replaceAll(' ', '-')}-`));
      try {
        const tag = writeMacosArm64ReleaseFixture(dir, testCase.options);
        expect(() =>
          releaseGate.verifyReleaseManifest(dir, tag, {
            GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
            EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
            EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
            EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
          })
        ).toThrow(testCase.expected);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }, 20_000);

  it('accepts a universal Mach-O Python runtime containing the target slice', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-universal-python-'));
    try {
      const tag = writeMacosArm64ReleaseFixture(dir, { universalPythonRuntime: true });
      expect(
        releaseGate.verifyReleaseManifest(dir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
        })
      ).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts an inventoried Python symlink whose archive-normalized mode differs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-python-symlink-mode-'));
    try {
      const tag = writeMacosArm64ReleaseFixture(dir, { inventorySymlinkArchiveMode: 0o755 });
      expect(
        releaseGate.verifyReleaseManifest(dir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
        })
      ).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a code-signed Mach-O runtime whose signature bytes changed after the pre-sign inventory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-signed-python-'));
    try {
      const tag = writeMacosArm64ReleaseFixture(dir, { signedPythonMutation: true });
      expect(
        releaseGate.verifyReleaseManifest(dir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
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
        EVAOS_BETA_RELEASE_COMMIT: fixtureReleaseCommit,
        EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
        EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
        EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
      });

      expect(
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
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
        EVAOS_BETA_RELEASE_COMMIT: fixtureReleaseCommit,
        EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
        EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
      });

      expect(() =>
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
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
        EVAOS_BETA_RELEASE_COMMIT: fixtureReleaseCommit,
        EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
        EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
        EVAOS_RELEASE_TARGET_PLATFORMS: 'windows',
      }) as { releaseTargetPlatforms: string };

      expect(manifest.releaseTargetPlatforms).toBe('windows');
      expect(
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
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
    const sourceSha = fixtureReleaseCommit;
    try {
      fs.writeFileSync(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'mac-arm64');
      fs.writeFileSync(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-x64.dmg'), 'mac-x64');
      writeMacosBridgeZip(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-arm64.zip'), {
        bridgeSourceCommit: sourceSha,
      });
      writeMacosBridgeZip(path.join(dir, 'evaOS Workbench-2.1.10-evaos-beta.0-mac-x64.zip'), {
        bridgeSourceCommit: sourceSha,
      });
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
        EVAOS_BETA_RELEASE_COMMIT: fixtureReleaseCommit,
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
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
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
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
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
    let releaseAssetBytesDir = '';

    try {
      const releaseAssets = writeProofReleaseAssetsReference(proofDir, tag);
      cleanupReleaseAssets = releaseAssets.cleanup;
      releaseAssetBytesDir = releaseAssets.sourceReleaseAssetsDir;

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
        [
          'PASS: candidate app rolled back; released fallback app launched; data/cache disposition recorded; protocol handler state evaos-workbench / com.evaos.workbench inspected; broker login/session state remained usable.',
          'Fallback exact bundle identity verified: true',
          'Fallback exact main-process path verified: true',
          'Fallback exact main-process dwell seconds: 8',
        ].join('\n') + '\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'support-notes.md'),
        'Support route: 100yenadmin/evaOS-GUI. The released macOS app remains the fallback while beta is gated.\n'
      );

      expect(
        releaseGate.verifyRcProof(proofDir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
          EVAOS_BETA_RC_RELEASE_ASSETS_DIR: releaseAssetBytesDir,
        })
      ).toBe(true);

      const rollbackProofPath = path.join(proofDir, 'rollback-smoke.md');
      const rollbackProof = fs.readFileSync(rollbackProofPath, 'utf8');
      for (const requiredMarker of [
        'Fallback exact bundle identity verified: true',
        'Fallback exact main-process path verified: true',
        'Fallback exact main-process dwell seconds: 8',
      ]) {
        fs.writeFileSync(rollbackProofPath, rollbackProof.replace(`${requiredMarker}\n`, ''));
        expect(() =>
          releaseGate.verifyRcProof(proofDir, tag, {
            GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
            EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
            EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
            EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
            EVAOS_BETA_RC_RELEASE_ASSETS_DIR: releaseAssetBytesDir,
          })
        ).toThrow(/rollback-smoke/i);
      }
      fs.writeFileSync(rollbackProofPath, rollbackProof);

      const connectorStartProofPath = path.join(proofDir, 'installed-candidate-connector-start.json');
      const connectorStartProof = JSON.parse(fs.readFileSync(connectorStartProofPath, 'utf8'));
      connectorStartProof.token.mode0600 = false;
      fs.writeFileSync(connectorStartProofPath, `${JSON.stringify(connectorStartProof, null, 2)}\n`);
      expect(() =>
        releaseGate.verifyRcProof(proofDir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
          EVAOS_BETA_RC_RELEASE_ASSETS_DIR: releaseAssetBytesDir,
        })
      ).toThrow(/mode0600|strict successful harness summary/);
      connectorStartProof.token.mode0600 = true;
      connectorStartProof.rawMessage = 'Bearer secret https://private.example /Users/private/connector.token';
      fs.writeFileSync(connectorStartProofPath, `${JSON.stringify(connectorStartProof, null, 2)}\n`);
      expect(() =>
        releaseGate.verifyRcProof(proofDir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
          EVAOS_BETA_RC_RELEASE_ASSETS_DIR: releaseAssetBytesDir,
        })
      ).toThrow(/strict successful harness summary/);
      delete connectorStartProof.rawMessage;
      fs.writeFileSync(connectorStartProofPath, `${JSON.stringify(connectorStartProof, null, 2)}\n`);

      const updaterMetadataPath = path.join(proofDir, 'release-assets', 'latest-arm64-mac.yml');
      const updaterMetadata = fs.readFileSync(updaterMetadataPath, 'utf8');
      fs.writeFileSync(updaterMetadataPath, "minimumSystemVersion: '24.0.0'\npath: different-mac-arm64.zip\n");
      expect(() =>
        releaseGate.verifyRcProof(proofDir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
          EVAOS_BETA_RC_RELEASE_ASSETS_DIR: releaseAssetBytesDir,
        })
      ).toThrow(/latest-arm64-mac\.yml/);
      fs.writeFileSync(updaterMetadataPath, updaterMetadata);

      const connectorProofPath = path.join(proofDir, 'installed-candidate-connector.json');
      const connectorProof = JSON.parse(fs.readFileSync(connectorProofPath, 'utf8'));
      const canonicalConnectorProof = structuredClone(connectorProof);
      connectorProof.candidate_binding.connector.source_sha256 = '0'.repeat(64);
      fs.writeFileSync(connectorProofPath, `${JSON.stringify(connectorProof, null, 2)}\n`);
      expect(() =>
        releaseGate.verifyRcProof(proofDir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
          EVAOS_BETA_RC_RELEASE_ASSETS_DIR: releaseAssetBytesDir,
        })
      ).toThrow(/installed-candidate-connector|installed candidate connector proof/i);
      connectorProof.candidate_binding.connector.source_sha256 =
        connectorProof.candidate_binding.local.actual_source_sha256;
      fs.writeFileSync(connectorProofPath, `${JSON.stringify(connectorProof, null, 2)}\n`);

      connectorProof.results = connectorProof.results.filter(
        (result: { id?: string }) => result.id !== 'control_start.ask_permission'
      );
      connectorProof.summary = { total: 5, passed: 5, failed: 0, skipped: 0 };
      fs.writeFileSync(connectorProofPath, `${JSON.stringify(connectorProof, null, 2)}\n`);
      expect(() =>
        releaseGate.verifyRcProof(proofDir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
          EVAOS_BETA_RC_RELEASE_ASSETS_DIR: releaseAssetBytesDir,
        })
      ).toThrow(/installed-candidate-connector|installed candidate connector proof/i);
      fs.writeFileSync(connectorProofPath, `${JSON.stringify(canonicalConnectorProof, null, 2)}\n`);

      const updaterZipProofPath = path.join(proofDir, 'updater-zip-macos-arm64.json');
      const updaterZipProof = JSON.parse(fs.readFileSync(updaterZipProofPath, 'utf8'));
      const canonicalUpdaterZipProof = structuredClone(updaterZipProof);
      updaterZipProof.sha256 = '0'.repeat(64);
      fs.writeFileSync(updaterZipProofPath, `${JSON.stringify(updaterZipProof, null, 2)}\n`);
      expect(() =>
        releaseGate.verifyRcProof(proofDir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
          EVAOS_BETA_RC_RELEASE_ASSETS_DIR: releaseAssetBytesDir,
        })
      ).toThrow(/updater ZIP trust proof checksum/i);

      const identityMutations: Array<[string, (proof: Record<string, unknown>) => void]> = [
        ['schema', (proof) => (proof.schema = 'evaos-updater-zip-trust/v1')],
        ['app name', (proof) => (proof.appName = 'Other.app')],
        ['bundle id', (proof) => (proof.bundleId = 'com.example.other')],
        ['product name', (proof) => (proof.productName = 'Other')],
        ['short version', (proof) => (proof.shortVersion = '9.9.9')],
        ['bundle version', (proof) => (proof.bundleVersion = '999')],
      ];
      for (const [label, mutate] of identityMutations) {
        const changed = structuredClone(canonicalUpdaterZipProof) as Record<string, unknown>;
        mutate(changed);
        fs.writeFileSync(updaterZipProofPath, `${JSON.stringify(changed, null, 2)}\n`);
        expect(
          () =>
            releaseGate.verifyRcProof(proofDir, tag, {
              GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
              EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
              EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
              EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
              EVAOS_BETA_RC_RELEASE_ASSETS_DIR: releaseAssetBytesDir,
            }),
          label
        ).toThrow(/updater ZIP trust proof|updater-zip-macos-arm64\.json/i);
      }
      fs.writeFileSync(updaterZipProofPath, `${JSON.stringify(canonicalUpdaterZipProof, null, 2)}\n`);

      const updaterZipPath = path.join(releaseAssetBytesDir, String(canonicalUpdaterZipProof.assetName));
      fs.appendFileSync(updaterZipPath, 'tampered');
      expect(() =>
        releaseGate.verifyRcProof(proofDir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_RELEASE_TARGET_PLATFORMS: 'macos-arm64',
          EVAOS_BETA_RC_RELEASE_ASSETS_DIR: releaseAssetBytesDir,
        })
      ).toThrow(/Updater ZIP bytes/);
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
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
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
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
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
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
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
    let releaseAssetBytesDir = '';

    try {
      const releaseAssets = writeProofReleaseAssetsReference(proofDir, tag);
      cleanupReleaseAssets = releaseAssets.cleanup;
      releaseAssetBytesDir = releaseAssets.sourceReleaseAssetsDir;

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
          EXPECTED_RELEASE_COMMIT: fixtureReleaseCommit,
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_BETA_RC_RELEASE_ASSETS_DIR: releaseAssetBytesDir,
        })
      ).toThrow(/rollback-smoke/);
    } finally {
      cleanupReleaseAssets();
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });
});
