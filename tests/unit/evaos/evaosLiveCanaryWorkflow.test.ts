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
    expect(workflow).toContain('run_followup_canaries');
    expect(workflow).toContain('environment: evaos-staging');
    expect(workflow).toContain('proof_ref');
  });

  it('runs strict readiness before required release canaries and optional follow-up canaries', () => {
    const workflow = readWorkflow();

    expect(workflow).toContain('node scripts/evaosProvisionLiveCanaryFixtures.js provision');
    expect(workflow).toContain(
      "github.event.inputs.run_live_canaries == 'true' && github.event.inputs.run_followup_canaries == 'true' && github.event.inputs.provision_fixtures == 'true'"
    );
    expect(workflow).toContain('node scripts/evaosProvisionLiveCanaryFixtures.js provision-core-broker');
    expect(workflow).toContain(
      "github.event.inputs.run_live_canaries == 'true' && github.event.inputs.run_followup_canaries != 'true' && github.event.inputs.provision_fixtures == 'true'"
    );
    expect(workflow).toContain('awk -v out="$PROOF_DIR/fixture-provisioning.stdout.json"');
    expect(workflow).toContain('awk -v out="$PROOF_DIR/core-broker-fixture-provisioning.stdout.json"');
    expect(workflow).toContain("grep -q '^::add-mask::'");
    expect(workflow).toContain('node scripts/evaosLiveCanaryReadiness.js --strict');
    expect(workflow).toContain('node scripts/evaosBrokerLiveCanary.js');
    expect(workflow).toContain('Run follow-up live canaries');
    expect(workflow).toContain("github.event.inputs.run_followup_canaries == 'true'");
    const coreBlock = workflow.slice(
      workflow.indexOf('- name: Run live canaries'),
      workflow.indexOf('- name: Run follow-up live canaries')
    );
    const followUpBlock = workflow.slice(workflow.indexOf('- name: Run follow-up live canaries'));
    expect(coreBlock).not.toContain('node scripts/evaosBusinessBrowserLiveCanary.js');
    expect(followUpBlock).toContain('node scripts/evaosBusinessBrowserLiveCanary.js');
    expect(workflow).toContain('node scripts/evaosTrustSurfaceLiveCanary.js');
    expect(workflow).toContain('node scripts/evaosProviderHubLiveCanary.js');
    expect(workflow).toContain('node scripts/evaosPeopleApprovalLiveCanary.js');
    expect(workflow).toContain('node scripts/evaosCompanyBrainLiveCanary.js');
    expect(workflow).toContain('node scripts/evaosProvisionLiveCanaryFixtures.js cleanup');
    expect(workflow).toContain('core-broker-fixture-cleanup.stdout.json');
    expect(workflow).toContain('actions/upload-artifact@v4');
    expect(workflow).toContain('if-no-files-found: error');
  });

  it('maps fixture values from environment secrets or vars without echoing secret values', () => {
    const workflow = readWorkflow();

    expect(workflow).toContain('secrets.AIONUI_EVAOS_DESKTOP_SESSION');
    expect(workflow).toContain('vars.AIONUI_EVAOS_RELEASE_CANARY_ACCOUNT_EMAIL');
    expect(workflow).toContain('vars.AIONUI_EVAOS_RELEASE_CANARY_CUSTOMER_ID');
    expect(workflow).toContain('vars.AIONUI_EVAOS_RELEASE_CANARY_TARGET_KIND');
    expect(workflow).toContain('vars.AIONUI_EVAOS_RELEASE_CANARY_TARGET_LABEL');
    expect(workflow).toContain('AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID');
    expect(workflow).toContain(
      'AIONUI_EVAOS_REQUIRE_BROKER_CANARY_TARGET: ${{ github.event.inputs.run_live_canaries }}'
    );
    expect(workflow).toContain('AIONUI_EVAOS_FIXTURE_ADMIN_EMAIL: ${{ vars.AIONUI_EVAOS_FIXTURE_ADMIN_EMAIL');
    expect(workflow).toContain(
      'AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID: ${{ inputs.customer_id || vars.AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID'
    );
    expect(workflow).toContain(
      'AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION: ${{ secrets.AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION }}'
    );
    expect(workflow).not.toContain(
      'AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION: ${{ secrets.AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION || secrets.AIONUI_EVAOS_DESKTOP_SESSION }}'
    );
    expect(workflow).not.toContain('AIONUI_EVAOS_CUSTOMER_ID: ${{ inputs.customer_id');
    expect(workflow).toContain(
      'AIONUI_EVAOS_FIXTURE_CUSTOMER_ID: ${{ inputs.customer_id || vars.AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID'
    );
    expect(workflow).toContain('vars.AIONUI_EVAOS_FIXTURE_CUSTOMER_ID');
    expect(workflow).toContain('vars.AIONUI_EVAOS_CUSTOMER_ID');
    expect(workflow).toContain('secrets.AIONUI_EVAOS_FIXTURE_SUPABASE_SERVICE_ROLE_KEY');
    expect(workflow).toContain('AIONUI_EVAOS_APPROVAL_DENY_ACK: evaos-deny-test');
    expect(workflow).toContain('AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK: evaos-browser-test');
    expect(workflow).toContain('AIONUI_EVAOS_RUN_FOLLOWUP_CANARIES: ${{ github.event.inputs.run_followup_canaries }}');
    expect(workflow).toContain(
      'Core broker surfaces: evaOS/openclaw, Hermes/hermes, Mission Control/paperclip, Shared Browser/browser, Terminal/terminal'
    );
    expect(workflow).toContain('Business Browser action canary: follow-up only unless run_followup_canaries=true');
    expect(workflow).not.toContain('printenv');
    expect(workflow).not.toContain('set -x');
  });

  it('runs the selected-binding Mac-control lane only with exact acknowledgement, dedicated secrets, and unconditional session cleanup', () => {
    const workflow = readWorkflow();

    expect(workflow).toContain('run_mac_control_canary:');
    expect(workflow).toContain('mac_control_canary_ack:');
    expect(workflow).toContain('evaos-mac-control-canary');
    expect(workflow).toContain(
      'AIONUI_EVAOS_MAC_CONTROL_CANARY_ACCOUNT_EMAIL: ${{ secrets.AIONUI_EVAOS_MAC_CONTROL_CANARY_ACCOUNT_EMAIL }}'
    );
    expect(workflow).toContain(
      'AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID: ${{ secrets.AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID }}'
    );
    expect(workflow).toContain(
      'AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT: ${{ secrets.AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT }}'
    );
    expect(workflow).toContain(
      'AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST: ${{ secrets.AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST }}'
    );
    expect(workflow).toContain(
      'AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_URL: ${{ secrets.AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_URL }}'
    );
    expect(workflow).toContain(
      'AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_SERVICE_ROLE_KEY }}'
    );
    expect(workflow).not.toMatch(/AIONUI_EVAOS_MAC_CONTROL_CANARY_SUPABASE_(?:URL|SERVICE_ROLE_KEY):[^\n]*\|\|/);
    expect(workflow).not.toContain(
      'AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID: ${{ secrets.AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID ||'
    );
    expect(workflow).toContain('node scripts/evaosProvisionLiveCanaryFixtures.js provision-mac-control');
    expect(workflow).toContain('node scripts/evaosBrokerLiveCanary.js --mac-control');
    expect(workflow).toContain('> "$PROOF_DIR/mac-control-runtime.json"');
    expect(workflow).toContain('node scripts/evaosProvisionLiveCanaryFixtures.js cleanup-mac-control');
    expect(workflow).toMatch(
      /- name: Cleanup Mac-control canary session[\s\S]*if: always\(\)[\s\S]*cleanup-mac-control/
    );
    expect(workflow).toContain('mac-control-runtime.json');
    expect(workflow).toContain('secret/redaction scan');
    expect(workflow).toMatch(/- name: Run Mac-control proof secret\/redaction scan\n\s+id: mac-control-proof-scan/);
    expect(workflow).toContain("cleanupProof.schema !== 'evaos-mac-control-canary-session-cleanup/v1'");
    expect(workflow).toContain('cleanupProof.sessionRevoked !== true');
    expect(workflow).toContain(
      "if: always() && (github.event.inputs.run_mac_control_canary != 'true' || steps.mac-control-proof-scan.outcome == 'success')"
    );
  });
});
