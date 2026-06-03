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
  });

  it('passes the repository release config audit', () => {
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
        GITHUB_REPOSITORY: '100yenadmin/AionUi',
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
          GITHUB_REPOSITORY: '100yenadmin/AionUi',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
        })
      ).toBe(true);

      fs.writeFileSync(path.join(dir, 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg'), 'tampered');
      expect(() =>
        releaseGate.verifyReleaseManifest(dir, 'evaos-beta-v2.1.10-evaos-beta.0', {
          GITHUB_REPOSITORY: '100yenadmin/AionUi',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
        })
      ).toThrow(/checksum/);
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
        GITHUB_REPOSITORY: '100yenadmin/AionUi',
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
          GITHUB_REPOSITORY: '100yenadmin/AionUi',
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
          GITHUB_REPOSITORY: '100yenadmin/AionUi',
          EXPECTED_RELEASE_COMMIT: 'abc123',
          EVAOS_BETA_SKIP_GITHUB_RUN_VERIFY: '1',
          EVAOS_BETA_TRUSTED_MANIFEST_PATH: trustedManifestPath,
        })
      ).toThrow(/trusted workflow artifact/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
