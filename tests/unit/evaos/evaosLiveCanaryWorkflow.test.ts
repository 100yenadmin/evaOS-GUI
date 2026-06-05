import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = '.github/workflows/evaos-live-canary-proof.yml';

function readWorkflow(): string {
  return fs.readFileSync(WORKFLOW_PATH, 'utf8');
}

describe('evaOS live canary proof workflow', () => {
  it('is a manual staging proof workflow with explicit acknowledgement', () => {
    const workflow = readWorkflow();

    expect(workflow).toContain('name: evaOS Live Canary Proof');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('live_canary_ack');
    expect(workflow).toContain('evaos-live-canary');
    expect(workflow).toContain('provision_fixtures');
    expect(workflow).toContain('environment: evaos-staging');
    expect(workflow).toContain('proof_ref');
  });

  it('runs strict readiness before optional live canaries and uploads sanitized proof', () => {
    const workflow = readWorkflow();

    expect(workflow).toContain('node scripts/evaosProvisionLiveCanaryFixtures.js provision');
    expect(workflow).toContain('node scripts/evaosLiveCanaryReadiness.js --strict');
    expect(workflow).toContain('node scripts/evaosBrokerLiveCanary.js');
    expect(workflow).toContain('node scripts/evaosTrustSurfaceLiveCanary.js');
    expect(workflow).toContain('node scripts/evaosProviderHubLiveCanary.js');
    expect(workflow).toContain('node scripts/evaosPeopleApprovalLiveCanary.js');
    expect(workflow).toContain('node scripts/evaosCompanyBrainLiveCanary.js');
    expect(workflow).toContain('node scripts/evaosBusinessBrowserLiveCanary.js');
    expect(workflow).toContain('node scripts/evaosProvisionLiveCanaryFixtures.js cleanup');
    expect(workflow).toContain('actions/upload-artifact@v4');
    expect(workflow).toContain('if-no-files-found: error');
  });

  it('maps fixture values from environment secrets or vars without echoing secret values', () => {
    const workflow = readWorkflow();

    expect(workflow).toContain('secrets.AIONUI_EVAOS_DESKTOP_SESSION');
    expect(workflow).toContain('vars.AIONUI_EVAOS_CUSTOMER_ID');
    expect(workflow).toContain('secrets.AIONUI_EVAOS_FIXTURE_SUPABASE_SERVICE_ROLE_KEY');
    expect(workflow).toContain('AIONUI_EVAOS_APPROVAL_DENY_ACK: evaos-deny-test');
    expect(workflow).toContain('AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK: evaos-browser-test');
    expect(workflow).not.toContain('printenv');
    expect(workflow).not.toContain('set -x');
  });
});
