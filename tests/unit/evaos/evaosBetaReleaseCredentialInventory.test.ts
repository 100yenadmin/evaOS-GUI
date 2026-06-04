import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const inventory = require('../../../scripts/evaosBetaReleaseCredentialInventory.js') as {
  auditReleaseCredentialInventory: (input: { secrets: string[]; variables: string[] }) => {
    ready: boolean;
    readyForSignedCandidate: boolean;
    readyForDistribution: boolean;
    missingSecrets: string[];
    missingVariables: string[];
    satisfiedSecrets: string[];
    satisfiedVariables: string[];
  };
  renderMarkdown: (report: ReturnType<typeof inventory.auditReleaseCredentialInventory>) => string;
};

const signingSecrets = [
  'BUILD_CERTIFICATE_BASE64',
  'P12_PASSWORD',
  'IDENTITY',
  'APPLE_ID',
  'APPLE_ID_PASSWORD',
  'TEAM_ID',
];

const distributionSecrets = ['GH_TOKEN', 'AWS_REGION', 'AWS_ROLE_ARN', 'AWS_S3_BUCKET'];

const releaseVariables = ['EVAOS_BETA_RELEASE_BRANCH', 'EVAOS_BETA_RELEASE_PUBLISH_ENABLED'];

describe('evaOS beta release credential inventory', () => {
  it('reports missing public beta signing, release, and distribution names', () => {
    const report = inventory.auditReleaseCredentialInventory({ secrets: [], variables: [] });

    expect(report.ready).toBe(false);
    expect(report.readyForSignedCandidate).toBe(false);
    expect(report.readyForDistribution).toBe(false);
    expect(report.missingSecrets).toContain('BUILD_CERTIFICATE_BASE64');
    expect(report.missingSecrets).toContain('APPLE_ID_PASSWORD');
    expect(report.missingSecrets).toContain('AWS_ROLE_ARN');
    expect(report.missingVariables).toContain('EVAOS_BETA_RELEASE_BRANCH');
    expect(report.missingVariables).toContain('EVAOS_BETA_RELEASE_PUBLISH_ENABLED');
  });

  it('separates signed candidate readiness from public distribution readiness', () => {
    const report = inventory.auditReleaseCredentialInventory({
      secrets: signingSecrets,
      variables: [],
    });

    expect(report.ready).toBe(false);
    expect(report.readyForSignedCandidate).toBe(true);
    expect(report.readyForDistribution).toBe(false);
    expect(report.missingSecrets).toEqual(distributionSecrets);
    expect(report.missingVariables).toEqual(releaseVariables);
  });

  it('marks inventory ready when all required names are present', () => {
    const report = inventory.auditReleaseCredentialInventory({
      secrets: [...signingSecrets, ...distributionSecrets],
      variables: releaseVariables,
    });

    expect(report.ready).toBe(true);
    expect(report.readyForSignedCandidate).toBe(true);
    expect(report.readyForDistribution).toBe(true);
    expect(report.satisfiedSecrets).toContain('BUILD_CERTIFICATE_BASE64');
    expect(report.satisfiedSecrets).toContain('AWS_S3_BUCKET');
    expect(report.satisfiedVariables).toContain('EVAOS_BETA_RELEASE_BRANCH');
  });

  it('renders a name-only Markdown checklist without credential values', () => {
    const report = inventory.auditReleaseCredentialInventory({
      secrets: ['BUILD_CERTIFICATE_BASE64'],
      variables: ['EVAOS_BETA_RELEASE_BRANCH'],
    });
    const markdown = inventory.renderMarkdown(report);

    expect(markdown).toContain('BUILD_CERTIFICATE_BASE64');
    expect(markdown).toContain('AWS_S3_BUCKET');
    expect(markdown).toContain('EVAOS_BETA_RELEASE_BRANCH');
    expect(markdown).not.toContain('BEGIN CERTIFICATE');
    expect(markdown).not.toContain('apple-app-specific-password');
  });
});
