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
});
