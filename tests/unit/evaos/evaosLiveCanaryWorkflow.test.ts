import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { signedMacControlAttestation } from './fixtures/signedMacControlAttestation';

const WORKFLOW_PATH = '.github/workflows/evaos-live-canary-proof.yml';
const require = createRequire(import.meta.url);
const proofScanner = require('../../../scripts/evaosScanMacControlProofs.js') as {
  assertMacControlProofSanitized: (proof: unknown) => void;
  scanMacControlProofDirectory: (proofDir: string) => { ok: boolean; scanned: number };
};

function readWorkflow(): string {
  return fs.readFileSync(WORKFLOW_PATH, 'utf8');
}

function validMacControlRuntimeProof(): Record<string, unknown> {
  return signedMacControlAttestation({
    runRef: 'gha:12345:111111111111111111111111',
    executedAt: '2026-07-15T00:00:00.000Z',
    authorityIssuedAt: 1784073599,
    authorityExpiresAt: 1784073659,
    candidate: {
      sourceCommit: 'd'.repeat(40),
      sourceSha256: 'e'.repeat(64),
      appVersion: '2.1.36',
      appBuild: '2.1.36',
    },
  }).envelope;
}

function writeCompleteMacControlProofSet(proofDir: string): void {
  const provision = {
    schema: 'evaos-mac-control-canary-session-provision/v1',
    accountConfigured: true,
    customerConfigured: true,
    activeMembershipVerified: true,
    stagingMarkerVerified: true,
    sessionMinted: true,
    sessionExpiryPresent: true,
    sensitiveOutput: 'passed',
  };
  const cleanup = {
    schema: 'evaos-mac-control-canary-session-cleanup/v1',
    sessionRevoked: true,
    sensitiveOutput: 'passed',
  };
  const negative = {
    schema: 'evaos.mac_control.runtime_receipt_negative_proof.v1',
    sourceHeadSha: 'd'.repeat(40),
    sourceRunId: '12345',
    assertions: {
      forgedContextRejected: true,
      expiredContextRejected: true,
      replayRejected: true,
      authorityRedacted: true,
    },
  };
  const deployedRoute = {
    schema: 'evaos.mac_control.deployed_route_probe.v1',
    sourceHeadSha: 'd'.repeat(40),
    sourceRunId: '12345',
    checkedAt: '2026-07-15T00:00:01.000Z',
    assertions: {
      gatewayAuthRequired: true,
      postOnly: true,
      exactMatch: true,
      strictBody: true,
      callerAuthorityBodyRejected: true,
      sensitiveOutputAbsent: true,
    },
  };
  const proofs = {
    'mac-control-runtime.json': validMacControlRuntimeProof(),
    'mac-control-runtime-negative.json': negative,
    'mac-control-deployed-route.json': deployedRoute,
    'mac-control-session-provisioning.json': provision,
    'mac-control-session-provisioning.stdout.json': provision,
    'mac-control-session-cleanup.json': cleanup,
    'mac-control-session-cleanup.stdout.json': cleanup,
  };
  for (const [name, proof] of Object.entries(proofs)) {
    fs.writeFileSync(path.join(proofDir, name), `${JSON.stringify(proof)}\n`);
  }
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
    expect(workflow).toContain(
      'AIONUI_EVAOS_MAC_CONTROL_DEPLOYED_PROBE_OUTPUT: live-canary-proof/mac-control-deployed-route.json'
    );
    expect(workflow).toContain('vars.EVAOS_MAC_CONTROL_CONTEXT_KEY_ID');
    expect(workflow).toContain('vars.EVAOS_MAC_CONTROL_RECEIPT_KEY_ID');
    expect(workflow).toContain('vars.EVAOS_MAC_CONTROL_RECEIPT_PUBLIC_KEY');
    expect(workflow).toContain('Prove Mac-control runtime-receipt negative boundaries');
    const negativeStep = workflow.slice(
      workflow.indexOf('- name: Prove Mac-control runtime-receipt negative boundaries'),
      workflow.indexOf('- name: Run follow-up live canaries')
    );
    expect(negativeStep).toContain(
      "if: github.event.inputs.run_live_canaries == 'true' && github.event.inputs.run_mac_control_canary == 'true'"
    );
    expect(negativeStep).toContain(
      'npm --prefix resources/evaos-beta/bridge/agent-tools/openclaw-plugin ci --ignore-scripts --omit=peer --no-audit --no-fund'
    );
    expect(workflow).toContain('resources/evaos-beta/bridge/agent-tools/openclaw-plugin/package-lock.json');
    expect(negativeStep).toContain('run proof:runtime-receipt-negative --');
    expect(negativeStep).toContain('"$PROOF_DIR/mac-control-runtime-negative.json" "$GITHUB_SHA" "$GITHUB_RUN_ID"');
    expect(negativeStep).not.toContain('continue-on-error');
    expect(negativeStep).not.toContain('forgedContextRejected: true');
    expect(workflow).toContain('mac-control-runtime-negative.json');
    expect(workflow).toContain('node scripts/evaosProvisionLiveCanaryFixtures.js cleanup-mac-control');
    expect(workflow).toMatch(
      /- name: Cleanup Mac-control canary session[\s\S]*if: always\(\)[\s\S]*cleanup-mac-control/
    );
    expect(workflow).toContain('mac-control-runtime.json');
    expect(workflow).toContain('secret/redaction scan');
    expect(workflow).toMatch(/- name: Run Mac-control proof secret\/redaction scan\n\s+id: mac-control-proof-scan/);
    expect(workflow).toContain('node scripts/evaosScanMacControlProofs.js "$PROOF_DIR"');
    expect(workflow).toContain(
      "if: always() && (github.event.inputs.run_mac_control_canary != 'true' || steps.mac-control-proof-scan.outcome == 'success')"
    );
  });

  it('executes a case-normalized Mac-control artifact scanner', () => {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-proof-scan-'));
    try {
      fs.writeFileSync(
        path.join(proofDir, 'mac-control-session-cleanup.json'),
        `${JSON.stringify({
          schema: 'evaos-mac-control-canary-session-cleanup/v1',
          sessionRevoked: true,
          sensitiveOutput: 'passed',
        })}\n`
      );
      expect(() => proofScanner.scanMacControlProofDirectory(proofDir)).toThrow(/missing required artifact/i);

      writeCompleteMacControlProofSet(proofDir);
      expect(proofScanner.scanMacControlProofDirectory(proofDir)).toEqual({ ok: true, scanned: 7 });

      for (const unsafe of [
        { Cookie: 'opaque-cookie-value-123456' },
        { AuthorizationHeader: 'opaque-auth-value-123456' },
        { Authorization: 'opaque-auth-value-123456' },
        { cookie_value: 'opaque-cookie-value-123456' },
        { context_signature: 'opaque-signature-value-123456' },
        { receipt_signature_value: 'opaque-signature-value-123456' },
        { receipt_base64: 'opaque-receipt-value-123456' },
        { connector_token: 'opaque-token-value-123456' },
        { connector_token_value: 'opaque-token-value-123456' },
        { providerCredentialsBundle: 'opaque-credential-value-123456' },
        { password_hint: 'opaque-password-value-123456' },
        { apiKeyValue: 'opaque-api-key-value-123456' },
        { auth_key_value: 'opaque-auth-key-value-123456' },
        { serviceRoleKeyValue: 'opaque-service-role-key-value-123456' },
        { signingKeyHandle: 'opaque-signing-key-value-123456' },
        { sessionValue: 'opaque-session-value-123456' },
        { bindingIdValue: 'opaque-binding-value-123456' },
        { challengeCopy: 'opaque-challenge-value-123456' },
        { receiptPrivateKeyPath: '/safe-looking/path' },
        { privateSigningKey: 'opaque-key-value-123456' },
        { connectorKeyMaterial: 'opaque-key-material-value-123456' },
        { note: '-----BEGIN OPENSSH PRIVATE KEY-----' },
      ]) {
        fs.writeFileSync(
          path.join(proofDir, 'mac-control-runtime.json'),
          `${JSON.stringify({ ...validMacControlRuntimeProof(), ...unsafe })}\n`
        );
        expect(() => proofScanner.scanMacControlProofDirectory(proofDir)).toThrow(/forbidden/i);
      }

      fs.writeFileSync(
        path.join(proofDir, 'mac-control-runtime.json'),
        `${JSON.stringify(validMacControlRuntimeProof())}\n`
      );
      expect(proofScanner.scanMacControlProofDirectory(proofDir)).toEqual({ ok: true, scanned: 7 });
      expect(() =>
        proofScanner.assertMacControlProofSanitized({
          keyId: 'public-key-id',
          contextKeyId: 'public-context-key-id',
          receiptKeyId: 'public-receipt-key-id',
        })
      ).not.toThrow();
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });
});
