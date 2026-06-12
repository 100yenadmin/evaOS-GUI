import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const releaseGate = require('../../../scripts/evaosBetaReleaseGate.js') as {
  assertPublicBetaNotarizationEnv: (env: Record<string, string | undefined>) => void;
  assertPublicBetaReleaseSigningEnv: (env: Record<string, string | undefined>) => void;
  assertPublicDistributionTag: (tag: string) => void;
  assertReleaseConfig: (rootDir: string) => boolean;
  collectReleaseConfigIssues: (rootDir: string) => string[];
  createReleaseManifest: (outputDir: string, tag: string, env: Record<string, string | undefined>) => unknown;
  isStrictPublicBetaReleaseEnv: (env: Record<string, string | undefined>) => boolean;
  normalizeBoolean: (value: unknown) => boolean;
  verifyReleaseManifest: (outputDir: string, tag: string, env: Record<string, string | undefined>) => boolean;
  verifyRcProof: (proofDir: string, tag: string, env: Record<string, string | undefined>) => boolean;
  writeRcProofTemplate: (proofDir: string, tag: string) => unknown;
};
const afterSign = require('../../../scripts/afterSign.js') as {
  getNotarizationOptions: (
    env: Record<string, string | undefined>,
    baseOptions: Record<string, string>
  ) => Record<string, string> | undefined;
  withKeychainCredentialIsolation: <T>(
    notarizationOptions: Record<string, string> | undefined,
    operation: () => Promise<T> | T
  ) => Promise<T>;
};
const macDmgFinalizer = require('../../../scripts/evaosFinalizeMacDmg.js') as {
  buildNotarytoolSubmitArgs: (dmgPath: string, env: Record<string, string | undefined>) => string[];
  findDmgArtifacts: (outDir: string) => string[];
  getNotaryProcessTimeoutMs: (env: Record<string, string | undefined>) => number;
};

const repoRoot = path.resolve(__dirname, '../../..');

describe('evaOS beta release gate', () => {
  it('detects strict public beta release mode', () => {
    expect(releaseGate.normalizeBoolean('true')).toBe(true);
    expect(releaseGate.normalizeBoolean('evaos-beta')).toBe(true);
    expect(releaseGate.normalizeBoolean('0')).toBe(false);
    expect(releaseGate.isStrictPublicBetaReleaseEnv({ EVAOS_BETA_PUBLIC_RELEASE: 'true' })).toBe(true);
    expect(releaseGate.isStrictPublicBetaReleaseEnv({ EVAOS_BETA_REQUIRE_SIGNING: '1' })).toBe(true);
    expect(releaseGate.isStrictPublicBetaReleaseEnv({ EVAOS_BETA_PUBLIC_RELEASE: 'false' })).toBe(false);
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
      appBundleId: 'com.evaos.workbench.beta',
      appPath: '/Applications/evaOS Workbench Beta.app',
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

  it('uses a bounded external process timeout for DMG notarytool submit', () => {
    expect(macDmgFinalizer.getNotaryProcessTimeoutMs({})).toBe(20 * 60 * 1000);
    expect(macDmgFinalizer.getNotaryProcessTimeoutMs({ EVAOS_DMG_NOTARY_PROCESS_TIMEOUT_MS: '90000' })).toBe(90000);
    expect(() => macDmgFinalizer.getNotaryProcessTimeoutMs({ EVAOS_DMG_NOTARY_PROCESS_TIMEOUT_MS: 'invalid' })).toThrow(
      /positive integer/
    );
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
    expect(section('win')).toContain('executableName: EvaOSWorkbenchBeta');
    expect(section('linux')).toContain('executableName: EvaOSWorkbenchBeta');
    expect(section('mac')).not.toContain('executableName:');

    expect(releaseGate.collectReleaseConfigIssues(repoRoot)).toEqual([]);
    expect(releaseGate.assertReleaseConfig(repoRoot)).toBe(true);
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

  it('writes and verifies release manifests with exact asset checksums', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-release-'));
    try {
      fs.writeFileSync(path.join(dir, 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'mac');
      fs.writeFileSync(path.join(dir, 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.zip'), 'zip');
      fs.writeFileSync(
        path.join(dir, 'latest-mac.yml'),
        'path: evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg\n'
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
      });

      expect(
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
        })
      ).toBe(true);

      fs.writeFileSync(path.join(dir, 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'tampered');
      expect(() =>
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
        })
      ).toThrow(/checksum/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('verifies release manifests for DMG-only macOS release assets', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-release-dmg-only-'));
    try {
      fs.writeFileSync(path.join(dir, 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'mac');
      fs.writeFileSync(
        path.join(dir, 'latest-arm64-mac.yml'),
        'path: evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg\n'
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

      expect(
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
        })
      ).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('binds distribution verification to the trusted workflow manifest artifact', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-trusted-release-'));
    try {
      fs.writeFileSync(path.join(dir, 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'mac');
      fs.writeFileSync(path.join(dir, 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.zip'), 'zip');
      fs.writeFileSync(
        path.join(dir, 'latest-mac.yml'),
        'path: evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg\n'
      );

      releaseGate.createReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
        GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
        GITHUB_WORKFLOW: 'Build and Release',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '1',
        EVAOS_BETA_RELEASE_COMMIT: 'abc123',
        EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
        EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
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
        })
      ).toThrow(/trusted workflow artifact/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('verifies a release candidate proof packet with install, launch, updater, rollback, and support evidence', () => {
    const tag = 'evaos-beta-v2.1.10-evaos-beta.0';
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-rc-proof-'));
    const releaseAssetsDir = path.join(proofDir, 'release-assets');

    try {
      fs.mkdirSync(releaseAssetsDir, { recursive: true });
      fs.writeFileSync(path.join(releaseAssetsDir, 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'mac');
      fs.writeFileSync(path.join(releaseAssetsDir, 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.zip'), 'zip');
      fs.writeFileSync(
        path.join(releaseAssetsDir, 'latest-mac.yml'),
        'path: evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg\n'
      );

      releaseGate.createReleaseManifest(releaseAssetsDir, tag, {
        GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
        GITHUB_WORKFLOW: 'Build and Release',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '1',
        EVAOS_BETA_RELEASE_COMMIT: 'abc123',
        EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
        EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
      });
      fs.mkdirSync(path.join(proofDir, 'trusted-manifest'), { recursive: true });
      fs.copyFileSync(
        path.join(releaseAssetsDir, 'evaos-beta-release-manifest.json'),
        path.join(proofDir, 'trusted-manifest', 'evaos-beta-release-manifest.json')
      );

      releaseGate.writeRcProofTemplate(proofDir, tag);
      const manifestPath = path.join(proofDir, 'evaos-beta-rc-proof.json');
      const rcManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      rcManifest.checks = rcManifest.checks.map((check: { status: string }) => ({ ...check, status: 'pass' }));
      rcManifest.macosX64.reason = 'macOS x64 is explicitly deferred because this beta candidate only includes arm64.';
      fs.writeFileSync(manifestPath, `${JSON.stringify(rcManifest, null, 2)}\n`);

      fs.writeFileSync(
        path.join(proofDir, 'codesign-macos-arm64.txt'),
        '/Applications/evaOS Workbench Beta.app: valid on disk\n/Applications/evaOS Workbench Beta.app: satisfies its Designated Requirement\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'spctl-macos-arm64.txt'),
        '/Applications/evaOS Workbench Beta.app: accepted\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'install-smoke.md'),
        'PASS: DMG copied to /Applications/evaOS Workbench Beta.app without replacing the released fallback app.\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'launch-smoke.md'),
        'PASS: evaOS Workbench Beta launched with beta identity and no upstream AionUi feed.\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'updater-feed-audit.md'),
        'PASS: update repo is 100yenadmin/evaOS-GUI and iOfficeAI/AionUi blocked for beta assets.\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'rollback-smoke.md'),
        'PASS: beta app absent after removal; released fallback app launched; data/cache disposition recorded; protocol handler state inspected; broker login/session state remained usable.\n'
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
        })
      ).toBe(true);
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('requires a trusted workflow manifest artifact for release candidate proof', () => {
    const tag = 'evaos-beta-v2.1.10-evaos-beta.0';
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-rc-proof-untrusted-'));
    const releaseAssetsDir = path.join(proofDir, 'release-assets');

    try {
      fs.mkdirSync(releaseAssetsDir, { recursive: true });
      fs.writeFileSync(path.join(releaseAssetsDir, 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'mac');
      fs.writeFileSync(path.join(releaseAssetsDir, 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.zip'), 'zip');
      fs.writeFileSync(
        path.join(releaseAssetsDir, 'latest-mac.yml'),
        'path: evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg\n'
      );

      releaseGate.createReleaseManifest(releaseAssetsDir, tag, {
        GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
        GITHUB_WORKFLOW: 'Build and Release',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '1',
        EVAOS_BETA_RELEASE_COMMIT: 'abc123',
        EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
        EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
      });
      releaseGate.writeRcProofTemplate(proofDir, tag);

      expect(() =>
        releaseGate.verifyRcProof(proofDir, tag, {
          GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
        })
      ).toThrow(/trusted release manifest/);
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('does not allow release candidate proof JSON to weaken built-in evidence markers', () => {
    const tag = 'evaos-beta-v2.1.10-evaos-beta.0';
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-rc-proof-weakened-'));
    const releaseAssetsDir = path.join(proofDir, 'release-assets');

    try {
      fs.mkdirSync(releaseAssetsDir, { recursive: true });
      fs.writeFileSync(path.join(releaseAssetsDir, 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'mac');
      fs.writeFileSync(path.join(releaseAssetsDir, 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.zip'), 'zip');
      fs.writeFileSync(
        path.join(releaseAssetsDir, 'latest-mac.yml'),
        'path: evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg\n'
      );

      releaseGate.createReleaseManifest(releaseAssetsDir, tag, {
        GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
        GITHUB_WORKFLOW: 'Build and Release',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '1',
        EVAOS_BETA_RELEASE_COMMIT: 'abc123',
        EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
        EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
      });
      fs.mkdirSync(path.join(proofDir, 'trusted-manifest'), { recursive: true });
      fs.copyFileSync(
        path.join(releaseAssetsDir, 'evaos-beta-release-manifest.json'),
        path.join(proofDir, 'trusted-manifest', 'evaos-beta-release-manifest.json')
      );

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
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('fails release candidate proof verification when rollback evidence is incomplete', () => {
    const tag = 'evaos-beta-v2.1.10-evaos-beta.0';
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-beta-rc-proof-missing-'));
    const releaseAssetsDir = path.join(proofDir, 'release-assets');

    try {
      fs.mkdirSync(releaseAssetsDir, { recursive: true });
      fs.writeFileSync(path.join(releaseAssetsDir, 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'mac');
      fs.writeFileSync(path.join(releaseAssetsDir, 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.zip'), 'zip');
      fs.writeFileSync(
        path.join(releaseAssetsDir, 'latest-mac.yml'),
        'path: evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg\n'
      );

      releaseGate.createReleaseManifest(releaseAssetsDir, tag, {
        GITHUB_REPOSITORY: '100yenadmin/evaOS-GUI',
        GITHUB_WORKFLOW: 'Build and Release',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '1',
        EVAOS_BETA_RELEASE_COMMIT: 'abc123',
        EVAOS_BETA_RELEASE_BRANCH: 'evaos/release-public-beta',
        EVAOS_BETA_RELEASE_PUBLISH_ENABLED: 'true',
      });
      fs.mkdirSync(path.join(proofDir, 'trusted-manifest'), { recursive: true });
      fs.copyFileSync(
        path.join(releaseAssetsDir, 'evaos-beta-release-manifest.json'),
        path.join(proofDir, 'trusted-manifest', 'evaos-beta-release-manifest.json')
      );

      releaseGate.writeRcProofTemplate(proofDir, tag);
      const manifestPath = path.join(proofDir, 'evaos-beta-rc-proof.json');
      const rcManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      rcManifest.checks = rcManifest.checks.map((check: { status: string }) => ({ ...check, status: 'pass' }));
      rcManifest.macosX64.reason = 'macOS x64 is explicitly deferred because this beta candidate only includes arm64.';
      fs.writeFileSync(manifestPath, `${JSON.stringify(rcManifest, null, 2)}\n`);

      fs.writeFileSync(
        path.join(proofDir, 'codesign-macos-arm64.txt'),
        '/Applications/evaOS Workbench Beta.app: valid on disk\n/Applications/evaOS Workbench Beta.app: satisfies its Designated Requirement\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'spctl-macos-arm64.txt'),
        '/Applications/evaOS Workbench Beta.app: accepted\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'install-smoke.md'),
        'PASS: DMG copied to /Applications/evaOS Workbench Beta.app without replacing the released fallback app.\n'
      );
      fs.writeFileSync(
        path.join(proofDir, 'launch-smoke.md'),
        'PASS: evaOS Workbench Beta launched with beta identity and no upstream AionUi feed.\n'
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
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });
});
