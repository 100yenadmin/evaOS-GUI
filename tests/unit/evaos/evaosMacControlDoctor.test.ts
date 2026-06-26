/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const doctor = require('../../../scripts/evaosMacControlDoctor.js') as {
  DEFAULT_SUPPORT_ACCOUNT: string;
  DEFAULT_SUPPORT_TARGET: string;
  GATE_IDS: string[];
  REPORT_SCHEMA: string;
  artifactRootForHead: (head: string, env?: Record<string, string | undefined>) => string;
  assertNoUnsafeDoctorOutput: (value: unknown) => void;
  buildDiagnosticPacket: (
    options: {
      expectedHead: string;
      appPath: string;
      supportAccount: string;
      supportTarget: string;
      customerId?: string;
      customerLabel?: string;
    },
    gates: Array<{ id: string; status: string; reasonCode?: string; message?: string }>,
    extras?: {
      bridgePath?: string;
      bundleInfo?: {
        bundleId: string;
        shortVersion: string;
      };
      desktopProofState?: {
        launchAgent?: { label?: string; status?: string; bridgePath?: string };
        staleLaunchAgent?: boolean;
      };
    }
  ) => { schemaVersion: string; blockerCategory: string; selectedContext: Record<string, unknown> };
  buildDryRunGates: () => Array<{ id: string; status: string }>;
  gateStatus: (gates: Array<{ id: string; status: string }>, id: string) => string;
  overallStatus: (gates: Array<{ id: string; status: string }>) => string;
  parseArgs: (args: string[]) => {
    dryRun?: boolean;
    appPath?: string;
    expectedHead?: string;
    supportAccount?: string;
    supportTarget?: string;
    computerUseEvidencePath?: string;
  };
  runComputerUseEvidenceGate: (options: {
    computerUseEvidencePath?: string;
    supportAccount?: string;
    supportTarget?: string;
  }) => { id: string; status: string; reasonCode?: string; message?: string; evidencePath?: string };
  runConfiguredCommandGate: (
    id: string,
    envName: string,
    env?: Record<string, string | undefined>,
    options?: { cwd?: string; timeout?: number }
  ) => { id: string; status: string; reasonCode?: string };
  runMacControlDoctor: (options?: {
    dryRun?: boolean;
    repoRoot?: string;
    repoHead?: string;
    expectedHead?: string;
    artifactRoot?: string;
  }) => Promise<{
    report: {
      schema: string;
      mode: string;
      gates: Array<{ id: string; status: string }>;
      overallStatus: string;
      diagnosticPacket: { schemaVersion: string };
    };
    files: { reportPath: string; proofPath: string; takeoverPath: string; diagnosticPath: string };
  }>;
};

describe('evaOS Mac control doctor', () => {
  it('exposes the composed proof gate order including Computer Use product proof', () => {
    expect(doctor.GATE_IDS).toEqual([
      'installed_app_preflight',
      'computer_use_evidence',
      'support_account_target',
      'route_visibility',
      'new_chat_response',
      'mac_control_cold_start',
      'bridge_ready',
      'local_openclaw',
      'vm_openclaw',
      'hermes',
      'stop_revoke',
      'kill_switch',
      'post_reset_recovery',
    ]);
  });

  it('writes a dry-run handoff packet that cannot be mistaken for passed proof', async () => {
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-mac-control-doctor-'));
    const result = await doctor.runMacControlDoctor({
      dryRun: true,
      repoRoot: path.resolve(__dirname, '../../..'),
      repoHead: 'b8b301f1aaff5d66ca5f70ec43e5aff74eb29b54',
      expectedHead: 'b8b301f1aaff5d66ca5f70ec43e5aff74eb29b54',
      artifactRoot,
    });

    expect(result.report.schema).toBe('evaos-mac-control-doctor/v1');
    expect(result.report.mode).toBe('dry-run');
    expect(result.report.overallStatus).toBe('pending');
    expect(result.report.gates.map((gate) => gate.status)).toEqual(
      Array.from({ length: doctor.GATE_IDS.length }, () => 'pending')
    );
    expect(result.report.diagnosticPacket.schemaVersion).toBe('evaos.workbench.diagnostic_packet.v1');
    expect(fs.existsSync(result.files.reportPath)).toBe(true);
    expect(fs.existsSync(result.files.diagnosticPath)).toBe(true);
    doctor.assertNoUnsafeDoctorOutput(fs.readFileSync(result.files.reportPath, 'utf8'));
    doctor.assertNoUnsafeDoctorOutput(fs.readFileSync(result.files.proofPath, 'utf8'));
  });

  it('requires a redacted exact-path Computer Use evidence file for release proof', () => {
    const missing = doctor.runComputerUseEvidenceGate({});

    expect(missing).toMatchObject({
      id: 'computer_use_evidence',
      status: 'blocked',
      reasonCode: 'runtime_not_configured',
    });

    const evidencePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-cua-proof-')), 'proof.txt');
    fs.writeFileSync(
      evidencePath,
      [
        '/Applications/evaOS Workbench.app',
        'admin@electricsheephq.com',
        'Support VM',
        'screenshot saved to screenshots/new-chat-response.png',
        'accessibility tree captured',
        'New Chat assistant response visible',
        'Mac & iPhone native companion ready',
      ].join('\n')
    );

    const passed = doctor.runComputerUseEvidenceGate({ computerUseEvidencePath: evidencePath });

    expect(passed).toMatchObject({
      id: 'computer_use_evidence',
      status: 'passed',
      evidencePath,
    });
  });

  it('fails closed when smoke command environment variables are missing', () => {
    expect(doctor.runConfiguredCommandGate('vm_openclaw', 'MISSING_SMOKE_CMD', {})).toMatchObject({
      id: 'vm_openclaw',
      status: 'blocked',
      reasonCode: 'runtime_not_configured',
    });
  });

  it('builds a redacted diagnostic packet with selected support account and blocker category', () => {
    const packet = doctor.buildDiagnosticPacket(
      {
        expectedHead: 'b8b301f1aaff5d66ca5f70ec43e5aff74eb29b54',
        appPath: '/Applications/evaOS Workbench.app',
        supportAccount: 'admin@electricsheephq.com',
        supportTarget: 'Support VM',
        customerId: 'support-vm-customer',
      },
      [
        {
          id: 'new_chat_response',
          status: 'failed',
          reasonCode: 'agent_cli_config_invalid',
          message: 'Codex config invalid',
        },
      ],
      {
        bridgePath: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
        bundleInfo: {
          bundleId: 'com.evaos.workbench',
          shortVersion: '2.1.22',
        },
      }
    );

    expect(packet).toMatchObject({
      schemaVersion: 'evaos.workbench.diagnostic_packet.v1',
      blockerCategory: 'agent_cli_config_invalid',
      selectedContext: {
        accountEmail: 'admin@electricsheephq.com',
        customerId: 'support-vm-customer',
        vmTarget: 'Support VM',
      },
    });
    doctor.assertNoUnsafeDoctorOutput(packet);
  });

  it('blocks unsafe endpoint, token, and prompt material in doctor reports', () => {
    expect(() => doctor.assertNoUnsafeDoctorOutput({ ok: 'Mac control ready' })).not.toThrow();
    expect(() => doctor.assertNoUnsafeDoctorOutput({ bad: 'Bearer abcdefghijklmnop' })).toThrow(/Unsafe|Bearer/);
    expect(() => doctor.assertNoUnsafeDoctorOutput({ bad: 'connector_url=http://100.64.0.10:8765' })).toThrow(
      /Unsafe|connector/
    );
  });

  it('parses exact app and evidence arguments for handoff commands', () => {
    expect(
      doctor.parseArgs([
        '--dry-run',
        '--app',
        '/Applications/evaOS Workbench.app',
        '--expected-head',
        'b8b301f1aaff',
        '--support-account',
        'admin@electricsheephq.com',
        '--support-target',
        'Support VM',
        '--computer-use-evidence',
        '/Volumes/LEXAR/Codex/evidence/proof.txt',
      ])
    ).toMatchObject({
      dryRun: true,
      appPath: '/Applications/evaOS Workbench.app',
      expectedHead: 'b8b301f1aaff',
      supportAccount: 'admin@electricsheephq.com',
      supportTarget: 'Support VM',
      computerUseEvidencePath: '/Volumes/LEXAR/Codex/evidence/proof.txt',
    });
  });
});
