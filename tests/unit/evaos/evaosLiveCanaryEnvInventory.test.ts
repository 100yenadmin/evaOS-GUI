import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const inventory = require('../../../scripts/evaosLiveCanaryEnvInventory.js') as {
  auditEnvironmentInventory: (input: { secrets: string[]; variables: string[] }) => {
    ready: boolean;
    missing: string[];
    satisfied: string[];
    missingOneOf: string[][];
  };
  renderMarkdown: (report: ReturnType<typeof inventory.auditEnvironmentInventory>) => string;
  renderProvisioningTemplate: (options?: {
    repo?: string;
    environment?: string;
    branch?: string;
    proofRef?: string;
  }) => string;
};

const completeSecrets = [
  'AIONUI_EVAOS_DESKTOP_SESSION',
  'AIONUI_EVAOS_REQUESTER_SESSION',
  'AIONUI_EVAOS_APPROVER_SESSION',
  'AIONUI_EVAOS_COMPANY_BRAIN_DENIED_SESSION',
  'AIONUI_EVAOS_BUSINESS_BROWSER_DENIED_SESSION',
];

const completeVariables = [
  'AIONUI_EVAOS_CUSTOMER_ID',
  'AIONUI_EVAOS_RUNTIME',
  'AIONUI_EVAOS_APPROVAL_ID',
  'AIONUI_EVAOS_PROVIDER_REQUIRED_STATES',
  'AIONUI_EVAOS_APPROVAL_DENY_REASON',
  'AIONUI_EVAOS_COMPANY_BRAIN_ACCOUNT_ID',
  'AIONUI_EVAOS_COMPANY_BRAIN_QUERY',
  'AIONUI_EVAOS_BUSINESS_BROWSER_TEST_URL',
  'AIONUI_EVAOS_BUSINESS_BROWSER_ALLOWED_HOSTS',
];

describe('evaOS live canary GitHub environment inventory', () => {
  it('reports missing required fixture names from secret and variable inventories', () => {
    const report = inventory.auditEnvironmentInventory({
      secrets: [],
      variables: ['AIONUI_EVAOS_RUNTIME', 'AIONUI_EVAOS_PROVIDER_REQUIRED_STATES'],
    });

    expect(report.ready).toBe(false);
    expect(report.missing).toContain('AIONUI_EVAOS_DESKTOP_SESSION');
    expect(report.missing).toContain('AIONUI_EVAOS_CUSTOMER_ID');
    expect(report.missing).toContain('AIONUI_EVAOS_APPROVAL_ID');
    expect(report.missingOneOf).toContainEqual([
      'AIONUI_EVAOS_COMPANY_BRAIN_WRONG_CUSTOMER_ID',
      'AIONUI_EVAOS_COMPANY_BRAIN_DENIED_SESSION',
    ]);
  });

  it('accepts either wrong-customer IDs or denied sessions for negative fixture groups', () => {
    const report = inventory.auditEnvironmentInventory({
      secrets: completeSecrets.filter((name) => !name.includes('DENIED_SESSION')),
      variables: [
        ...completeVariables,
        'AIONUI_EVAOS_COMPANY_BRAIN_WRONG_CUSTOMER_ID',
        'AIONUI_EVAOS_BUSINESS_BROWSER_WRONG_CUSTOMER_ID',
      ],
    });

    expect(report.ready).toBe(true);
    expect(report.missing).toEqual([]);
    expect(report.missingOneOf).toEqual([]);
  });

  it('marks the inventory ready when all required fixtures are present by name', () => {
    const report = inventory.auditEnvironmentInventory({
      secrets: completeSecrets,
      variables: completeVariables,
    });

    expect(report.ready).toBe(true);
    expect(report.satisfied).toContain('AIONUI_EVAOS_DESKTOP_SESSION');
    expect(report.satisfied).toContain('AIONUI_EVAOS_BUSINESS_BROWSER_ALLOWED_HOSTS');
  });

  it('renders a name-only Markdown checklist without values', () => {
    const report = inventory.auditEnvironmentInventory({
      secrets: ['AIONUI_EVAOS_DESKTOP_SESSION'],
      variables: ['AIONUI_EVAOS_RUNTIME'],
    });
    const markdown = inventory.renderMarkdown(report);

    expect(markdown).toContain('AIONUI_EVAOS_DESKTOP_SESSION');
    expect(markdown).toContain('AIONUI_EVAOS_CUSTOMER_ID');
    expect(markdown).not.toContain('eds_live_session_for_test');
    expect(markdown).not.toContain('https://workspace.example.test');
  });

  it('renders placeholder-only provisioning commands from the same fixture contract', () => {
    const template = inventory.renderProvisioningTemplate({
      repo: '100yenadmin/AionUi',
      environment: 'evaos-staging',
      branch: 'evaos/dev',
      proofRef: 'https://github.com/100yenadmin/AionUi/issues/41',
    });

    expect(template).toContain('gh secret set AIONUI_EVAOS_DESKTOP_SESSION');
    expect(template).toContain('gh variable set AIONUI_EVAOS_CUSTOMER_ID');
    expect(template).toContain('AIONUI_EVAOS_COMPANY_BRAIN_DENIED_SESSION');
    expect(template).toContain('AIONUI_EVAOS_COMPANY_BRAIN_WRONG_CUSTOMER_ID');
    expect(template).toContain('gh workflow run evaos-live-canary-proof.yml');
    expect(template).toContain("--ref 'evaos/dev'");
    expect(template).toContain('-f live_canary_ack=evaos-live-canary');
    expect(template).toContain("-f proof_ref='https://github.com/100yenadmin/AionUi/issues/41'");
    expect(template).toContain(
      "node scripts/evaosLiveCanaryEnvInventory.js --repo '100yenadmin/AionUi' --env 'evaos-staging' --strict --markdown"
    );
    expect(template).not.toContain('eds_live_session_for_test');
    expect(template).not.toContain('https://workspace.example.test');
  });

  it('shell-quotes operator-controlled template arguments', () => {
    const template = inventory.renderProvisioningTemplate({
      repo: "100yenadmin/AionUi; echo PWN 'x'",
      environment: 'evaos-staging; echo ENV',
      branch: 'evaos/dev; echo BRANCH',
      proofRef: "https://github.com/100yenadmin/AionUi/issues/41; echo 'TOKEN'",
    });

    expect(template).toContain("-R '100yenadmin/AionUi; echo PWN '\"'\"'x'\"'\"''");
    expect(template).toContain("--env 'evaos-staging; echo ENV'");
    expect(template).toContain("--ref 'evaos/dev; echo BRANCH'");
    expect(template).toContain(
      "-f proof_ref='https://github.com/100yenadmin/AionUi/issues/41; echo '\"'\"'TOKEN'\"'\"''"
    );
    expect(template).not.toContain('-R 100yenadmin/AionUi; echo PWN');
    expect(template).not.toContain('--ref evaos/dev; echo BRANCH');
    expect(template).not.toContain('-f proof_ref=https://github.com/100yenadmin/AionUi/issues/41; echo');
  });
});
