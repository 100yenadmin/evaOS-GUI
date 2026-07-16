import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync(path.resolve('.github/workflows/mac-access-private-rc.yml'), 'utf8');

describe('Mac Access private-RC workflow contract', () => {
  it('is manual, read-only, and uploads only a private Actions artifact', () => {
    expect(workflow).toMatch(/^on:\n  workflow_dispatch:/m);
    expect(workflow).not.toMatch(/^  (push|pull_request|schedule|release):/m);
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('uses: actions/upload-artifact@v4');
    expect(workflow).toContain('actionsArtifactOnly: true');
  });

  it('builds both standalone architectures with the embedded private runtime', () => {
    expect(workflow).toContain('runtime_arch: arm64');
    expect(workflow).toContain('runtime_arch: x64');
    expect(workflow).toContain('xcode_arch: arm64');
    expect(workflow).toContain('xcode_arch: x86_64');
    expect(workflow).toContain('runner: macos-15');
    expect(workflow).toContain('runner: macos-15-intel');
    expect(workflow).toContain('scripts/prepareEvaosDesktopBridgePythonRuntime.sh');
    expect(workflow).toContain('MAC_ACCESS_REQUIRE_PRIVATE_RUNTIME:');
    expect(workflow).toContain('CODE_SIGNING_ALLOWED=NO');
    expect(workflow).toContain('-configuration Release');
  });

  it('fails closed on dedicated Sparkle config and release credentials', () => {
    expect(workflow).toContain('private_rc_ack:');
    expect(workflow).toContain('sparkle_feed_url:');
    expect(workflow).toContain('sparkle_public_ed_key:');
    expect(workflow).toContain('rollback_key_id:');
    expect(workflow).toContain('rollback_public_key_base64url:');
    expect(workflow).toContain('test "$PRIVATE_RC_ACK" = \'mac-access-private-rc\'');
    expect(workflow).toContain("'mac-access' not in parsed.path.lower()");
    expect(workflow).toContain("'workbench' in feed.lower()");
    expect(workflow).toContain('len(decoded) != 32');
    expect(workflow).toContain("re.fullmatch(r'[A-Za-z0-9_-]{43}', rollback_public_key)");
    expect(workflow).toContain('len(decoded_rollback_key) != 32');
    for (const buildSetting of [
      'MAC_ACCESS_UPDATE_FEED_URL=',
      'MAC_ACCESS_UPDATE_PUBLIC_ED_KEY=',
      'MAC_ACCESS_SOURCE_COMMIT=',
      'MAC_ACCESS_SECURITY_EPOCH=',
      'MAC_ACCESS_CREDENTIAL_SECURITY_EPOCH=',
      'MAC_ACCESS_SCHEMA_READER_VERSION=',
      'MAC_ACCESS_SCHEMA_WRITER_VERSION=',
      'MAC_ACCESS_ROLLBACK_KEY_ID=',
      'MAC_ACCESS_ROLLBACK_PUBLIC_KEY_BASE64URL=',
      'MAC_ACCESS_HELPER_ENTITLEMENTS_SHA256=',
      'MAC_ACCESS_HELPER_RELATION_SHA256=',
    ]) {
      expect(workflow).toContain(buildSetting);
    }
    for (const secret of [
      'BUILD_CERTIFICATE_BASE64',
      'P12_PASSWORD',
      'APPLE_API_KEY_BASE64',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER',
    ]) {
      expect(workflow).toContain(`secrets.${secret}`);
    }
    expect(workflow).not.toContain('continue-on-error: true');
  });

  it('signs inside-out and verifies identity, runtime, SBOM, notarization, stapling, and Gatekeeper', () => {
    expect(workflow).toContain('scripts/release/sign-bundle.js sign');
    expect(workflow).toContain('scripts/release/sign-bundle.js verify');
    expect(workflow).toContain('mac-access-artifact.json');
    expect(workflow).toContain('mac-access-sbom.spdx.json');
    expect(workflow).toContain('notarytool submit');
    expect(workflow).toContain('--timeout 30m');
    expect(workflow).toContain('stapler staple');
    expect(workflow).toContain('stapler validate');
    expect(workflow).toContain('spctl --assess --type execute');
    expect(workflow).toContain('private-rc-final-manifest.json');
    expect(workflow).toContain('evidenceFiles:');
    expect(workflow).toContain('CHECKSUMS.txt');
  });

  it('does not publish a release, tag, appcast, public feed, Workbench, or v2.1.36 mutation', () => {
    expect(workflow).not.toMatch(/\bgh release\b|\bgit tag\b|softprops\/action-gh-release|actions\/create-release/);
    expect(workflow).toContain('appcastPublished: false');
    expect(workflow).toContain('githubReleaseCreated: false');
    expect(workflow).toContain('tagCreated: false');
    expect(workflow).toContain('publicFeedMutated: false');
    expect(workflow).toContain('workbenchReleaseMutated: false');
    expect(workflow).toContain('betaV2136Mutated: false');
  });
});
