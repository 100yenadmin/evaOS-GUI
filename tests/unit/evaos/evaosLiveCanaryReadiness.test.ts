import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const readiness = require('../../../scripts/evaosLiveCanaryReadiness.js') as {
  inspectLiveCanaryReadiness: (env: Record<string, string | undefined>) => {
    ready: boolean;
    blockers: string[];
    canaries: Array<{
      name: string;
      ready: boolean;
      missingRequired: string[];
      invalidRequired: string[];
      missingAnyOf: string[][];
      command: string;
    }>;
  };
  renderMarkdown: (report: ReturnType<typeof readiness.inspectLiveCanaryReadiness>) => string;
};

const requiredEnv = {
  AIONUI_EVAOS_DESKTOP_SESSION: 'eds_live_session_for_test',
  AIONUI_EVAOS_CUSTOMER_ID: 'cus_123',
  AIONUI_EVAOS_APPROVAL_DENY_ACK: 'evaos-deny-test',
  AIONUI_EVAOS_APPROVAL_ID: 'approval_123',
  AIONUI_EVAOS_REQUESTER_SESSION: 'eds_requester_session_for_test',
  AIONUI_EVAOS_APPROVER_SESSION: 'eds_approver_session_for_test',
  AIONUI_EVAOS_COMPANY_BRAIN_ACCOUNT_ID: 'acct_123',
  AIONUI_EVAOS_COMPANY_BRAIN_QUERY: 'What changed?',
  AIONUI_EVAOS_COMPANY_BRAIN_WRONG_CUSTOMER_ID: 'cus_other',
  AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK: 'evaos-browser-test',
  AIONUI_EVAOS_BUSINESS_BROWSER_TEST_URL: 'https://workspace.example.test/app',
  AIONUI_EVAOS_BUSINESS_BROWSER_ALLOWED_HOSTS: 'workspace.example.test',
  AIONUI_EVAOS_BUSINESS_BROWSER_DENIED_SESSION: 'eds_denied_session_for_test',
};

describe('evaOS live canary readiness', () => {
  it('reports missing fixtures without exposing secret values', () => {
    const report = readiness.inspectLiveCanaryReadiness({});
    const rendered = JSON.stringify(report);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('broker-runtime-status: missing AIONUI_EVAOS_DESKTOP_SESSION');
    expect(report.blockers).toContain('people-approval-deny: missing AIONUI_EVAOS_APPROVAL_DENY_ACK');
    expect(report.blockers).toContain('business-browser: missing AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK');
    expect(rendered).not.toMatch(/eds_|Bearer|desktop_session|approval_123|workspace\\.example/);
  });

  it('requires exact mutation acknowledgements before approval and browser canaries are ready', () => {
    const report = readiness.inspectLiveCanaryReadiness({
      ...requiredEnv,
      AIONUI_EVAOS_APPROVAL_DENY_ACK: 'yes',
      AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK: 'yes',
    });

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain(
      'people-approval-deny: AIONUI_EVAOS_APPROVAL_DENY_ACK must equal evaos-deny-test'
    );
    expect(report.blockers).toContain(
      'business-browser: AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK must equal evaos-browser-test'
    );
  });

  it('marks the live canary suite ready when required positive and negative fixtures are present', () => {
    const report = readiness.inspectLiveCanaryReadiness(requiredEnv);

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.canaries.every((canary) => canary.ready)).toBe(true);
  });

  it('renders a markdown checklist with commands and variable names only', () => {
    const report = readiness.inspectLiveCanaryReadiness(requiredEnv);
    const markdown = readiness.renderMarkdown(report);

    expect(markdown).toContain('node scripts/evaosBrokerLiveCanary.js');
    expect(markdown).toContain('AIONUI_EVAOS_DESKTOP_SESSION');
    expect(markdown).toContain('AIONUI_EVAOS_COMPANY_BRAIN_WRONG_CUSTOMER_ID');
    expect(markdown).not.toContain('eds_live_session_for_test');
    expect(markdown).not.toContain('https://workspace.example.test/app');
  });
});
