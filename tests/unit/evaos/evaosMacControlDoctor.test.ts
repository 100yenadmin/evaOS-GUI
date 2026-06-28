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
  REQUIRED_VISIBLE_AGENT_MAC_TOOLS: string[];
  VISIBLE_AGENT_MAC_TOOL_PROMPT: string;
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
  runBridgeReadyGate: (
    appPath: string,
    options?: { timeout?: number }
  ) => { id: string; status: string; reasonCode?: string; message?: string; data?: Record<string, unknown> };
  macControlReadyTextSatisfied: (text: string) => boolean;
  runVisibleAgentMacToolEvidenceGate: (evidence: unknown) => {
    id: string;
    status: string;
    reasonCode?: string;
    message?: string;
    data?: Record<string, unknown>;
  };
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
  function writeFakeBridge(appPath: string, body: string, exitCode = 0): string {
    const bridgeDir = path.join(appPath, 'Contents', 'Resources', 'Bridge');
    fs.mkdirSync(bridgeDir, { recursive: true });
    const bridgePath = path.join(bridgeDir, 'evaos-desktop-bridge');
    fs.writeFileSync(
      bridgePath,
      ['#!/bin/sh', `cat <<'JSON'`, body, 'JSON', `exit ${exitCode}`, ''].join('\n'),
      'utf8'
    );
    fs.chmodSync(bridgePath, 0o755);
    return bridgePath;
  }

  it('exposes the composed proof gate order including Computer Use product proof', () => {
    expect(doctor.GATE_IDS).toEqual([
      'installed_app_preflight',
      'computer_use_evidence',
      'support_account_target',
      'route_visibility',
      'mac_control_cold_start',
      'bridge_ready',
      'visible_agent_mac_tools',
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

  it('rejects a generic visible New Chat response as Mac-control proof', () => {
    const gate = doctor.runVisibleAgentMacToolEvidenceGate(
      [
        'Release proof: call the active evaOS/OpenClaw Mac-control tools.',
        'Thought complete.',
        'I can help with Mac control once the connector is ready.',
      ].join('\n')
    );

    expect(gate).toMatchObject({
      id: 'visible_agent_mac_tools',
      status: 'failed',
      reasonCode: 'agent_cli_config_invalid',
    });
    expect(gate.message).toContain('structured');
  });

  it('requires structured visible tool results including low-impact, stop, and kill-switch proof', () => {
    const proseOnly = doctor.runVisibleAgentMacToolEvidenceGate(
      [
        'customer_mac_status customer_mac_capabilities desktop_control_status desktop_see desktop_bridge_audit_tail',
        'desktop_control_stop desktop_kill_switch all passed.',
      ].join('\n')
    );

    expect(proseOnly).toMatchObject({
      id: 'visible_agent_mac_tools',
      status: 'failed',
      reasonCode: 'agent_cli_config_invalid',
    });

    const passed = doctor.runVisibleAgentMacToolEvidenceGate({
      toolResults: [
        { tool: 'customer_mac_status', ok: true, auditId: 'audit-status', result: { device: 'Workbench Mac' } },
        { tool: 'customer_mac_capabilities', ok: true, auditId: 'audit-capabilities', result: { screen: true } },
        { tool: 'desktop_control_status', ok: true, auditId: 'audit-control', result: { active: true } },
        { tool: 'desktop_see', ok: true, auditId: 'audit-see', result: { screenshot: 'redacted' } },
        { tool: 'desktop_bridge_audit_tail', ok: true, auditId: 'audit-tail', result: { records: ['audit-see'] } },
        {
          tool: 'desktop_control_action',
          ok: true,
          auditId: 'audit-low-impact',
          approved: true,
          lowImpact: true,
          action: 'get_frontmost_app',
          result: { app: 'evaOS Workbench' },
        },
        { tool: 'desktop_control_stop', ok: true, auditId: 'audit-stop', result: { active: false } },
        { tool: 'desktop_kill_switch', ok: true, auditId: 'audit-kill', result: { killSwitch: true } },
      ],
    });

    expect(passed).toMatchObject({
      id: 'visible_agent_mac_tools',
      status: 'passed',
      data: {
        observedTools: expect.arrayContaining([
          'customer_mac_status',
          'customer_mac_capabilities',
          'desktop_control_status',
          'desktop_see',
          'desktop_bridge_audit_tail',
          'desktop_control_stop',
          'desktop_kill_switch',
        ]),
      },
    });
  });

  it('rejects visible tool proof when required tool calls do not carry audit ids', () => {
    const gate = doctor.runVisibleAgentMacToolEvidenceGate({
      toolResults: [
        { tool: 'customer_mac_status', ok: true, result: { device: 'Workbench Mac' } },
        { tool: 'customer_mac_capabilities', ok: true, result: { screen: true } },
        { tool: 'desktop_control_status', ok: true, result: { active: true } },
        { tool: 'desktop_see', ok: true, result: { screenshot: 'redacted' } },
        { tool: 'desktop_bridge_audit_tail', ok: true, result: { records: [] } },
        {
          tool: 'desktop_control_action',
          ok: true,
          approved: true,
          lowImpact: true,
          result: { app: 'evaOS Workbench' },
        },
        { tool: 'desktop_control_stop', ok: true, result: { active: false } },
        { tool: 'desktop_kill_switch', ok: true, result: { killSwitch: true } },
      ],
    });

    expect(gate).toMatchObject({
      id: 'visible_agent_mac_tools',
      status: 'failed',
      reasonCode: 'agent_cli_config_invalid',
      data: {
        missingAuditTools: expect.arrayContaining([
          'customer_mac_status',
          'desktop_see',
          'desktop_control_stop',
          'desktop_kill_switch',
        ]),
      },
    });
    expect(gate.message).toContain('audit ids');
  });

  it('fails visible tool proof on ACP parse, broker-boundary, or OS permission prompt failures', () => {
    expect(doctor.runVisibleAgentMacToolEvidenceGate('transport parse error: Invalid message {')).toMatchObject({
      id: 'visible_agent_mac_tools',
      status: 'failed',
      reasonCode: 'agent_cli_config_invalid',
    });
    expect(doctor.runVisibleAgentMacToolEvidenceGate('generic broker-boundary failure')).toMatchObject({
      id: 'visible_agent_mac_tools',
      status: 'failed',
      reasonCode: 'agent_cli_config_invalid',
    });
    expect(
      doctor.runVisibleAgentMacToolEvidenceGate('"osascript" wants access to control "System Events"')
    ).toMatchObject({
      id: 'visible_agent_mac_tools',
      status: 'failed',
      reasonCode: 'permission_missing',
    });
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
        'screenshot saved to screenshots/visible-agent-mac-tools.png',
        'accessibility tree captured',
        'Visible Workbench agent Mac tool proof visible',
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

  it('does not accept generic ready text on a repair-state Mac-control page as cold-start proof', () => {
    expect(
      doctor.macControlReadyTextSatisfied(
        ['Mac & iPhone', 'repair_required', 'Repair needed', 'Permissions Granted', 'Turn on Mac access', 'ready'].join(
          '\n'
        )
      )
    ).toBe(false);

    expect(
      doctor.macControlReadyTextSatisfied(
        [
          'Mac control ready to connect',
          'Workbench connector is reporting ready locally.',
          'Accessibility and Screen Recording are ready.',
          'Guided Mac control setup',
          'Ready',
          'Connect Mac Control',
        ].join('\n')
      )
    ).toBe(false);

    expect(
      doctor.macControlReadyTextSatisfied(
        [
          'Mac control ready to connect',
          'Workbench connector is reporting ready locally.',
          'Accessibility and Screen Recording are ready.',
          'Guided Mac control setup',
          'Ready',
          'Mac control is connected for this evaOS Workbench session.',
        ].join('\n')
      )
    ).toBe(true);
  });

  it('passes bridge readiness only for the ready v1 schema with ok and ready true', () => {
    const appPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-ready-app-')), 'evaOS Workbench.app');
    writeFakeBridge(appPath, JSON.stringify({ schema: 'evaos.desktop_bridge.ready.v1', ok: true, ready: true }));

    expect(doctor.runBridgeReadyGate(appPath)).toMatchObject({
      id: 'bridge_ready',
      status: 'passed',
    });
  });

  it('fails bridge readiness on malformed JSON even when the bridge exits zero', () => {
    const appPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-ready-app-')), 'evaOS Workbench.app');
    writeFakeBridge(appPath, 'not json');

    expect(doctor.runBridgeReadyGate(appPath)).toMatchObject({
      id: 'bridge_ready',
      status: 'failed',
      reasonCode: 'bridge_diagnostics_unavailable',
    });
  });

  it('fails bridge readiness when ready schema reports not ready despite exit zero', () => {
    const appPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-ready-app-')), 'evaOS Workbench.app');
    writeFakeBridge(appPath, JSON.stringify({ schema: 'evaos.desktop_bridge.ready.v1', ok: true, ready: false }));

    const gate = doctor.runBridgeReadyGate(appPath);

    expect(gate).toMatchObject({
      id: 'bridge_ready',
      status: 'failed',
      reasonCode: 'bridge_diagnostics_unavailable',
      data: {
        readySchema: 'evaos.desktop_bridge.ready.v1',
        readyOk: true,
        readyState: false,
      },
    });
  });

  it('fails closed when smoke command environment variables are missing', () => {
    expect(doctor.runConfiguredCommandGate('vm_openclaw', 'MISSING_SMOKE_CMD', {})).toMatchObject({
      id: 'vm_openclaw',
      status: 'blocked',
      reasonCode: 'runtime_not_configured',
    });
  });

  it('rejects local fallback executors for configured smoke command gates', () => {
    expect(
      doctor.runConfiguredCommandGate('vm_openclaw', 'VM_SMOKE_CMD', {
        VM_SMOKE_CMD: 'node -e "process.exit(0)"',
      })
    ).toMatchObject({
      id: 'vm_openclaw',
      status: 'failed',
      reasonCode: 'unapproved_executor',
    });

    expect(
      doctor.runConfiguredCommandGate('hermes', 'HERMES_SMOKE_CMD', {
        HERMES_SMOKE_CMD: 'osascript -e "tell application \\"System Events\\" to keystroke \\"x\\""',
      })
    ).toMatchObject({
      id: 'hermes',
      status: 'failed',
      reasonCode: 'unapproved_executor',
    });
  });

  it('allows configured smoke command gates only for brokered Mac-control tooling', () => {
    expect(
      doctor.runConfiguredCommandGate('vm_openclaw', 'VM_SMOKE_CMD', {
        VM_SMOKE_CMD: 'printf evaos-desktop-bridge',
      })
    ).toMatchObject({
      id: 'vm_openclaw',
      status: 'passed',
    });

    expect(
      doctor.runConfiguredCommandGate('local_openclaw', 'LOCAL_SMOKE_CMD', {
        LOCAL_SMOKE_CMD: 'echo ok',
      })
    ).toMatchObject({
      id: 'local_openclaw',
      status: 'failed',
      reasonCode: 'unapproved_proof_command',
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
          id: 'visible_agent_mac_tools',
          status: 'failed',
          reasonCode: 'runtime_not_configured',
          message: 'Mac tools not available',
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
      blockerCategory: 'runtime_not_configured',
      selectedContext: {
        accountEmail: 'admin@electricsheephq.com',
        customerId: 'support-vm-customer',
        vmTarget: 'Support VM',
      },
    });
    doctor.assertNoUnsafeDoctorOutput(packet);
  });

  it('does not report agent_paired unless both cold-start UI and bridge ready gates passed', () => {
    const packet = doctor.buildDiagnosticPacket(
      {
        expectedHead: 'b8b301f1aaff5d66ca5f70ec43e5aff74eb29b54',
        appPath: '/Applications/evaOS Workbench.app',
        supportAccount: 'admin@electricsheephq.com',
        supportTarget: 'Support VM',
      },
      [
        { id: 'mac_control_cold_start', status: 'passed' },
        { id: 'bridge_ready', status: 'failed', reasonCode: 'bridge_diagnostics_unavailable' },
      ],
      {
        bridgePath: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
        bundleInfo: {
          bundleId: 'com.evaos.workbench',
          shortVersion: '2.1.23',
        },
      }
    );

    expect(packet).toMatchObject({
      brokerGrant: {
        agentPairingStatus: 'not_ready',
      },
      connector: {
        status: 'repair_required',
      },
    });
  });

  it('blocks unsafe endpoint, token, and prompt material in doctor reports', () => {
    expect(() => doctor.assertNoUnsafeDoctorOutput({ ok: 'Mac control ready' })).not.toThrow();
    expect(() => doctor.assertNoUnsafeDoctorOutput({ bad: 'Bearer abcdefghijklmnop' })).toThrow(/Unsafe|Bearer/);
    expect(() => doctor.assertNoUnsafeDoctorOutput({ bad: 'connector_url=http://100.64.0.10:8765' })).toThrow(
      /Unsafe|connector/
    );
  });

  it('requires visible Workbench agent proof to name every Mac-control tool', () => {
    expect(doctor.REQUIRED_VISIBLE_AGENT_MAC_TOOLS).toEqual([
      'customer_mac_status',
      'customer_mac_capabilities',
      'desktop_control_status',
      'desktop_see',
      'desktop_bridge_audit_tail',
      'desktop_control_stop',
      'desktop_kill_switch',
    ]);
    for (const tool of doctor.REQUIRED_VISIBLE_AGENT_MAC_TOOLS) {
      expect(doctor.VISIBLE_AGENT_MAC_TOOL_PROMPT).toContain(tool);
    }
    expect(doctor.VISIBLE_AGENT_MAC_TOOL_PROMPT).not.toMatch(/connector[_\s-]?url|connector[_\s-]?token|Bearer/i);
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
        '--agent-key',
        'openclaw-gateway',
        '--agent-type',
        'openclaw-gateway',
      ])
    ).toMatchObject({
      dryRun: true,
      appPath: '/Applications/evaOS Workbench.app',
      expectedHead: 'b8b301f1aaff',
      supportAccount: 'admin@electricsheephq.com',
      supportTarget: 'Support VM',
      computerUseEvidencePath: '/Volumes/LEXAR/Codex/evidence/proof.txt',
      agentKey: 'openclaw-gateway',
      agentType: 'openclaw-gateway',
    });
  });
});
