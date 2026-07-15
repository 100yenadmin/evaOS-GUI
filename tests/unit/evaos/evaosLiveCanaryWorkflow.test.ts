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
  scanMacControlProofDirectory: (
    proofDir: string,
    options?: { allowPartial?: boolean }
  ) => { ok: boolean; scanned: number; missing?: string[] };
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
    schema: 'evaos.mac_control.deployed_negative_probe.v1',
    proofMode: 'deployed-staging',
    sourceRunId: '12345',
    candidate: {
      sourceCommit: 'd'.repeat(40),
      sourceSha256: 'e'.repeat(64),
      appVersion: '2.1.36',
      appBuild: '2.1.36',
    },
    classifications: {
      forgedSignature: {
        rejected: true,
        httpStatus: 401,
        code: 'execution_context_signature_invalid',
      },
      expiredContext: {
        rejected: true,
        httpStatus: 401,
        code: 'execution_context_expired',
      },
      replay: {
        firstAccepted: true,
        secondRejected: true,
        httpStatus: 409,
        code: 'execution_context_replayed',
      },
    },
    connectorActionAttempted: false,
    sensitiveOutputAbsent: true,
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
    expect(workflow).toContain(
      'AIONUI_EVAOS_MAC_CONTROL_DEPLOYED_NEGATIVE_PROBE_OUTPUT: live-canary-proof/mac-control-runtime-negative.json'
    );
    expect(workflow).toContain('vars.EVAOS_MAC_CONTROL_CONTEXT_KEY_ID');
    expect(workflow).toContain('vars.EVAOS_MAC_CONTROL_RECEIPT_KEY_ID');
    expect(workflow).toContain('vars.EVAOS_MAC_CONTROL_RECEIPT_PUBLIC_KEY');
    expect(workflow).not.toContain('Prove Mac-control runtime-receipt negative boundaries');
    expect(workflow).not.toContain('proof:runtime-receipt-negative');
    expect(workflow).toContain('mac-control-runtime-negative.json');
    expect(workflow).toContain('node scripts/evaosProvisionLiveCanaryFixtures.js cleanup-mac-control');
    expect(workflow).toMatch(
      /- name: Cleanup Mac-control canary session[\s\S]*if: always\(\)[\s\S]*cleanup-mac-control/
    );
    expect(workflow).toContain('mac-control-runtime.json');
    expect(workflow).toContain('Scan existing Mac-control proofs for safe diagnostic upload');
    expect(workflow).toContain('Require complete Mac-control proof set');
  });

  it('keeps producer failures terminal while scanning safe partial diagnostics before strict completeness', () => {
    const workflow = readWorkflow();
    const producerStart = workflow.indexOf('- name: Provision Mac-control canary session');
    const partialStart = workflow.indexOf('- name: Scan existing Mac-control proofs for safe diagnostic upload');
    const strictStart = workflow.indexOf('- name: Require complete Mac-control proof set');
    const summaryStart = workflow.indexOf('- name: Write summary');

    expect(producerStart).toBeGreaterThan(-1);
    expect(partialStart).toBeGreaterThan(producerStart);
    expect(strictStart).toBeGreaterThan(partialStart);
    expect(summaryStart).toBeGreaterThan(strictStart);

    const producerBlock = workflow.slice(producerStart, partialStart);
    const partialStep = workflow.slice(partialStart, strictStart);
    const strictStep = workflow.slice(strictStart, summaryStart);
    expect(producerBlock).not.toContain('continue-on-error');
    expect(partialStep).toContain('id: mac-control-partial-proof-scan');
    expect(partialStep).toContain("if: always() && github.event.inputs.run_mac_control_canary == 'true'");
    expect(partialStep).toContain('node scripts/evaosScanMacControlProofs.js --allow-partial "$PROOF_DIR"');
    expect(strictStep).toContain('id: mac-control-complete-proof-scan');
    expect(strictStep).toContain(
      "if: success() && github.event.inputs.run_live_canaries == 'true' && github.event.inputs.run_mac_control_canary == 'true' && github.event.inputs.provision_fixtures == 'true' && steps.mac-control-partial-proof-scan.outcome == 'success'"
    );
    expect(strictStep).toContain('node scripts/evaosScanMacControlProofs.js "$PROOF_DIR"');
    expect(strictStep).not.toContain('--allow-partial');
  });

  it('uploads Mac-control diagnostics only after the partial safety scan passes', () => {
    const workflow = readWorkflow();
    const uploadStep = workflow.slice(workflow.indexOf('- name: Upload live canary proof packet'));

    expect(uploadStep).toContain(
      "if: always() && (github.event.inputs.run_mac_control_canary != 'true' || steps.mac-control-partial-proof-scan.outcome == 'success')"
    );
    expect(uploadStep).not.toContain('mac-control-complete-proof-scan.outcome');
  });

  it('allows an empty partial scan and reports every missing allowlisted artifact', () => {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-proof-partial-empty-'));
    try {
      expect(proofScanner.scanMacControlProofDirectory(proofDir, { allowPartial: true })).toEqual({
        ok: true,
        scanned: 0,
        missing: [
          'mac-control-runtime.json',
          'mac-control-runtime-negative.json',
          'mac-control-deployed-route.json',
          'mac-control-session-provisioning.json',
          'mac-control-session-provisioning.stdout.json',
          'mac-control-session-cleanup.json',
          'mac-control-session-cleanup.stdout.json',
        ],
      });
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('scans a safe cleanup diagnostic without inferring successful revocation', () => {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-proof-partial-cleanup-'));
    try {
      fs.writeFileSync(
        path.join(proofDir, 'mac-control-session-cleanup.json'),
        `${JSON.stringify({
          schema: 'evaos-mac-control-canary-session-cleanup/v1',
          sessionRevoked: false,
          sensitiveOutput: 'passed',
        })}\n`
      );

      expect(proofScanner.scanMacControlProofDirectory(proofDir, { allowPartial: true })).toEqual({
        ok: true,
        scanned: 1,
        missing: [
          'mac-control-runtime.json',
          'mac-control-runtime-negative.json',
          'mac-control-deployed-route.json',
          'mac-control-session-provisioning.json',
          'mac-control-session-provisioning.stdout.json',
          'mac-control-session-cleanup.stdout.json',
        ],
      });
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('rejects an unsafe existing artifact in partial mode', () => {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-proof-partial-unsafe-'));
    try {
      fs.writeFileSync(
        path.join(proofDir, 'mac-control-session-cleanup.json'),
        `${JSON.stringify({
          schema: 'evaos-mac-control-canary-session-cleanup/v1',
          sessionRevoked: false,
          sensitiveOutput: 'passed',
          connectorToken: 'opaque-token-value-123456',
        })}\n`
      );

      expect(() => proofScanner.scanMacControlProofDirectory(proofDir, { allowPartial: true })).toThrow(/forbidden/i);
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('rejects a failed sensitive-output claim in partial mode', () => {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-proof-partial-sensitive-output-'));
    try {
      fs.writeFileSync(
        path.join(proofDir, 'mac-control-session-cleanup.json'),
        `${JSON.stringify({
          schema: 'evaos-mac-control-canary-session-cleanup/v1',
          sessionRevoked: false,
          sensitiveOutput: 'failed',
        })}\n`
      );

      expect(() => proofScanner.scanMacControlProofDirectory(proofDir, { allowPartial: true })).toThrow(
        /sensitive-output contract/i
      );
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('fails a strict scan with the exact missing artifact name', () => {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-proof-strict-missing-'));
    try {
      writeCompleteMacControlProofSet(proofDir);
      fs.rmSync(path.join(proofDir, 'mac-control-runtime-negative.json'));

      expect(() => proofScanner.scanMacControlProofDirectory(proofDir)).toThrow(
        'Mac-control proof is missing required artifacts: mac-control-runtime-negative.json.'
      );
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('requires successful session revocation in a strict complete-set scan', () => {
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-proof-strict-cleanup-'));
    try {
      writeCompleteMacControlProofSet(proofDir);
      fs.writeFileSync(
        path.join(proofDir, 'mac-control-session-cleanup.json'),
        `${JSON.stringify({
          schema: 'evaos-mac-control-canary-session-cleanup/v1',
          sessionRevoked: false,
          sensitiveOutput: 'passed',
        })}\n`
      );

      expect(() => proofScanner.scanMacControlProofDirectory(proofDir)).toThrow(/temporary session revocation/i);
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
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
