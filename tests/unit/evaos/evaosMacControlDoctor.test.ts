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
        bridgeListener?: { status?: string; staleOwners?: Array<unknown>; owners?: Array<unknown> };
        staleLaunchAgent?: boolean;
        staleBridgeListener?: boolean;
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
    options?: {
      timeout?: number;
      desktopProofState?: {
        launchAgent?: { status?: string; bridgePath?: string | null };
        staleLaunchAgent?: boolean;
        bridgeListener?: { status?: string; staleOwners?: Array<unknown>; owners?: Array<unknown> };
        staleBridgeListener?: boolean;
      };
    }
  ) => { id: string; status: string; reasonCode?: string; message?: string; data?: Record<string, unknown> };
  macControlReadyTextSatisfied: (text: string) => boolean;
  runVisibleAgentMacToolEvidenceGate: (evidence: unknown) => {
    id: string;
    status: string;
    reasonCode?: string;
    message?: string;
    data?: Record<string, unknown>;
  };
  visibleAgentEvidenceText: (text: string, options?: { beforeText?: string; prompt?: string }) => string;
  runConfiguredCommandGate: (
    id: string,
    envName: string,
    env?: Record<string, string | undefined>,
    options?: { cwd?: string; timeout?: number; env?: Record<string, string | undefined> }
  ) => { id: string; status: string; reasonCode?: string };
  ensureAdminRouteSurfaceVisible: (
    page: {
      locator: (selector: string) => {
        first: () => {
          waitFor?: (options: { state: string; timeout: number }) => Promise<void>;
          isVisible: () => Promise<boolean>;
          getAttribute: (name: string) => Promise<string | null>;
          click: () => Promise<void>;
        };
      };
      waitForFunction: (fn: () => boolean, arg?: unknown, options?: { timeout: number }) => Promise<void>;
    },
    timeout: number
  ) => Promise<void>;
  captureVisibleAgentFailureState: (
    page: {
      screenshot: (options: { path: string; fullPage: boolean }) => Promise<void>;
      evaluate: (fn: () => unknown) => Promise<unknown>;
    },
    artifactRoot: string,
    gateId: string,
    error: Error & { preSendAgentState?: unknown; structuredFailureEvidence?: unknown }
  ) => Promise<{ state: Record<string, unknown> }>;
  runMacControlDoctor: (options?: {
    dryRun?: boolean;
    skipUi?: boolean;
    allowNonCanonicalAppPath?: boolean;
    appPath?: string;
    repoRoot?: string;
    repoHead?: string;
    expectedHead?: string;
    artifactRoot?: string;
    desktopProofState?: {
      launchAgent?: { status?: string; bridgePath?: string | null };
      staleLaunchAgent?: boolean;
      bridgeListener?: { status?: string; staleOwners?: Array<unknown>; owners?: Array<unknown> };
      staleBridgeListener?: boolean;
    };
  }) => Promise<{
    report: {
      schema: string;
      mode: string;
      gates: Array<{ id: string; status: string }>;
      overallStatus: string;
      diagnosticPacket: { schemaVersion: string; bridge?: Record<string, unknown> };
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

  function writeFakeInfoPlist(appPath: string): void {
    const contentsDir = path.join(appPath, 'Contents');
    fs.mkdirSync(contentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(contentsDir, 'Info.plist'),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '<key>CFBundleIdentifier</key><string>com.evaos.workbench</string>',
        '<key>CFBundleName</key><string>evaOS Workbench</string>',
        '<key>CFBundleVersion</key><string>2.1.23</string>',
        '<key>CFBundleShortVersionString</key><string>2.1.23</string>',
        '<key>CFBundleURLTypes</key>',
        '<array><dict><key>CFBundleURLSchemes</key><array><string>evaos-workbench</string></array></dict></array>',
        '</dict>',
        '</plist>',
        '',
      ].join('\n'),
      'utf8'
    );
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

  it('requires visible desktop_kill_switch proof to fail closed', () => {
    const gate = doctor.runVisibleAgentMacToolEvidenceGate({
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
        { tool: 'desktop_kill_switch', ok: true, auditId: 'audit-kill', result: { killSwitch: false } },
      ],
    });

    expect(gate).toMatchObject({
      id: 'visible_agent_mac_tools',
      status: 'failed',
      reasonCode: 'kill_switch_not_fail_closed',
      data: {
        observedTools: expect.arrayContaining(['desktop_kill_switch']),
      },
    });
  });

  it('does not pass visible-agent proof from the user prompt or pre-send page text', () => {
    const forgedProof = {
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
          result: { action: 'get_frontmost_app' },
        },
        { tool: 'desktop_control_stop', ok: true, auditId: 'audit-stop', result: { active: false } },
        { tool: 'desktop_kill_switch', ok: true, auditId: 'audit-kill', result: { killSwitch: true } },
      ],
    };
    const prompt = `Release proof prompt\n${JSON.stringify(forgedProof)}`;
    const beforeText = `New Chat\n${prompt}`;
    const afterText = `${beforeText}\nThinking...`;

    const gate = doctor.runVisibleAgentMacToolEvidenceGate(
      doctor.visibleAgentEvidenceText(afterText, { beforeText, prompt })
    );

    expect(gate).toMatchObject({
      id: 'visible_agent_mac_tools',
      status: 'failed',
      reasonCode: 'agent_cli_config_invalid',
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
          'Mac control is ready',
          'Workbench connector is reporting ready locally.',
          'Accessibility and Screen Recording are ready.',
          'Guided Mac control setup',
          'Ready',
          'Start Full Access',
        ].join('\n')
      )
    ).toBe(true);

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

  it('records bridge readiness even when UI product proof is skipped', async () => {
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-skip-ui-doctor-'));
    const appPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-ready-app-')), 'evaOS Workbench.app');
    writeFakeInfoPlist(appPath);
    writeFakeBridge(appPath, JSON.stringify({ schema: 'evaos.desktop_bridge.ready.v1', ok: true, ready: true }));
    const bridgePath = path.join(appPath, 'Contents', 'Resources', 'Bridge', 'evaos-desktop-bridge');

    const result = await doctor.runMacControlDoctor({
      appPath,
      repoRoot: path.resolve(__dirname, '../../..'),
      repoHead: 'b8b301f1aaff5d66ca5f70ec43e5aff74eb29b54',
      expectedHead: 'b8b301f1aaff5d66ca5f70ec43e5aff74eb29b54',
      artifactRoot,
      skipUi: true,
      allowNonCanonicalAppPath: true,
      desktopProofState: {
        launchAgent: {
          status: 'loaded',
          bridgePath,
        },
        staleLaunchAgent: false,
        bridgeListener: {
          status: 'listening',
          owners: [{ pid: '1234', matchesExpectedBridge: true }],
          staleOwners: [],
        },
        staleBridgeListener: false,
      },
    });

    expect(result.report.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'bridge_ready', status: 'passed' }),
        expect.objectContaining({ id: 'support_account_target', status: 'blocked' }),
        expect.objectContaining({ id: 'visible_agent_mac_tools', status: 'blocked' }),
      ])
    );
    expect(result.report.diagnosticPacket.bridge).toMatchObject({
      status: 'ready',
      readyStatus: 'ready',
    });
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

  it('fails bridge readiness with typed blocker when stale UI conflicts with bridge status truth', () => {
    const appPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-ready-app-')), 'evaOS Workbench.app');
    writeFakeBridge(
      appPath,
      JSON.stringify({
        schema: 'evaos.desktop_bridge.ready.v1',
        ok: false,
        ready: false,
        blockers: [{ code: 'connector_service_unreachable', message: 'Connector service is not reachable.' }],
        connector_service: {
          running: false,
          status: 'not-running',
        },
        control_session: {
          active: false,
          kill_switch: false,
        },
      })
    );

    const gate = doctor.runBridgeReadyGate(appPath);

    expect(gate).toMatchObject({
      id: 'bridge_ready',
      status: 'failed',
      reasonCode: 'connector_service_unreachable',
      data: {
        ready: {
          blockers: [{ code: 'connector_service_unreachable' }],
          connector_service: {
            running: false,
            status: 'not-running',
          },
        },
      },
    });
  });

  it('keeps stale connected UI diagnostic repair-required when bridge truth is unreachable', () => {
    const appPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-ready-app-')), 'evaOS Workbench.app');
    writeFakeBridge(
      appPath,
      JSON.stringify({
        schema: 'evaos.desktop_bridge.ready.v1',
        ok: false,
        ready: false,
        blockers: [{ code: 'connector_service_unreachable', message: 'Connector service is not reachable.' }],
      })
    );

    const bridgeGate = doctor.runBridgeReadyGate(appPath);
    const packet = doctor.buildDiagnosticPacket(
      {
        expectedHead: 'b8b301f1aaff5d66ca5f70ec43e5aff74eb29b54',
        appPath: '/Applications/evaOS Workbench.app',
        supportAccount: 'admin@electricsheephq.com',
        supportTarget: 'Support VM',
      },
      [
        { id: 'mac_control_cold_start', status: 'passed', message: 'Stale UI claimed Mac control was ready.' },
        bridgeGate,
        { id: 'visible_agent_mac_tools', status: 'passed' },
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
      blockerCategory: 'connector_service_unreachable',
      bridge: {
        status: 'repair_required',
        readyStatus: 'not_ready',
      },
      brokerGrant: {
        agentPairingStatus: 'not_ready',
      },
      connector: {
        status: 'repair_required',
        ownerClassification: 'connector_service_unreachable',
      },
    });
  });

  it('prefers the Mac-control cold-start blocker over harness-like route visibility failure', () => {
    const packet = doctor.buildDiagnosticPacket(
      {
        expectedHead: 'b8b301f1aaff5d66ca5f70ec43e5aff74eb29b54',
        appPath: '/Applications/evaOS Workbench.app',
        supportAccount: 'admin@electricsheephq.com',
        supportTarget: 'Support VM',
      },
      [
        {
          id: 'route_visibility',
          status: 'failed',
          reasonCode: 'runtime_not_configured',
          message: 'Expected route visibility did not settle.',
          data: {
            message: 'Timed out waiting for visible Admin route marker while Admin section was collapsed.',
          },
        },
        {
          id: 'mac_control_cold_start',
          status: 'failed',
          reasonCode: 'connector_service_not_ready',
          message: 'Mac control cold-start proof failed.',
        },
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
      blockerCategory: 'connector_service_not_ready',
      lastAction: {
        action: 'mac_control_cold_start',
        blockerReason: 'connector_service_not_ready',
      },
    });
  });

  it('fails bridge readiness when the live listener is missing even if ready JSON is green', () => {
    const appPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-ready-app-')), 'evaOS Workbench.app');
    writeFakeBridge(appPath, JSON.stringify({ schema: 'evaos.desktop_bridge.ready.v1', ok: true, ready: true }));

    const gate = doctor.runBridgeReadyGate(appPath, {
      desktopProofState: {
        launchAgent: {
          status: 'loaded',
          bridgePath: path.join(appPath, 'Contents', 'Resources', 'Bridge', 'evaos-desktop-bridge'),
        },
        staleLaunchAgent: false,
        bridgeListener: {
          status: 'not-listening',
          owners: [],
          staleOwners: [],
        },
        staleBridgeListener: false,
      },
    });

    expect(gate).toMatchObject({
      id: 'bridge_ready',
      status: 'failed',
      reasonCode: 'missing_live_listener',
    });
  });

  it('accepts a verified Workbench-managed live listener when LaunchAgent status is not loaded', () => {
    const appPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-ready-app-')), 'evaOS Workbench.app');
    const bridgePath = writeFakeBridge(
      appPath,
      JSON.stringify({ schema: 'evaos.desktop_bridge.ready.v1', ok: true, ready: true })
    );

    const gate = doctor.runBridgeReadyGate(appPath, {
      desktopProofState: {
        launchAgent: {
          status: 'not-loaded',
          bridgePath,
        },
        staleLaunchAgent: false,
        bridgeListener: {
          status: 'listening',
          owners: [{ pid: '1234', matchesExpectedBridge: true }],
          staleOwners: [],
        },
        staleBridgeListener: false,
      },
    });

    expect(gate).toMatchObject({
      id: 'bridge_ready',
      status: 'passed',
    });
  });

  it('keeps stale listener owners blocked even when the listener is present', () => {
    const appPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-ready-app-')), 'evaOS Workbench.app');
    const bridgePath = writeFakeBridge(
      appPath,
      JSON.stringify({ schema: 'evaos.desktop_bridge.ready.v1', ok: true, ready: true })
    );

    const gate = doctor.runBridgeReadyGate(appPath, {
      desktopProofState: {
        launchAgent: {
          status: 'not-loaded',
          bridgePath,
        },
        staleLaunchAgent: false,
        bridgeListener: {
          status: 'listening',
          owners: [{ pid: '9999', matchesExpectedBridge: false }],
          staleOwners: [{ pid: '9999', command: '/Applications/Old.app/bridge' }],
        },
        staleBridgeListener: true,
      },
    });

    expect(gate).toMatchObject({
      id: 'bridge_ready',
      status: 'failed',
      reasonCode: 'stale_bridge_owner',
    });
  });

  it('prioritizes missing live listener as the diagnostic blocker over installed-app preflight', () => {
    const packet = doctor.buildDiagnosticPacket(
      {
        expectedHead: 'b8b301f1aaff5d66ca5f70ec43e5aff74eb29b54',
        appPath: '/Applications/evaOS Workbench.app',
        supportAccount: 'admin@electricsheephq.com',
        supportTarget: 'Support VM',
      },
      [
        {
          id: 'installed_app_preflight',
          status: 'failed',
          reasonCode: 'not_workbench_managed',
          message: 'Installed app product proof failed.',
        },
        {
          id: 'computer_use_evidence',
          status: 'blocked',
          reasonCode: 'runtime_not_configured',
          message: 'Computer Use evidence not provided.',
        },
        {
          id: 'bridge_ready',
          status: 'failed',
          reasonCode: 'missing_live_listener',
          message: 'No live Workbench bridge listener is present for Mac-control proof.',
        },
      ],
      {
        bridgePath: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
        bundleInfo: {
          bundleId: 'com.evaos.workbench',
          shortVersion: '2.1.23',
        },
        desktopProofState: {
          launchAgent: {
            status: 'loaded',
            bridgePath: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
          },
          staleLaunchAgent: false,
          bridgeListener: {
            status: 'not-listening',
            owners: [],
            staleOwners: [],
          },
          staleBridgeListener: false,
        },
      }
    );

    expect(packet).toMatchObject({
      blockerCategory: 'missing_live_listener',
      connector: {
        ownerClassification: 'missing_live_listener',
      },
      lastAction: {
        action: 'bridge_ready',
        blockerReason: 'missing_live_listener',
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

  it('requires configured smoke command gates to start with approved tooling and emit audited structured proof', () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-doctor-bin-'));
    const bridgeBin = path.join(binDir, 'evaos-desktop-bridge');
    fs.writeFileSync(
      bridgeBin,
      ['#!/bin/sh', 'printf \'{"ok":true,"auditId":"audit-smoke","result":{"status":"ready"}}\\n\'', ''].join('\n')
    );
    fs.chmodSync(bridgeBin, 0o755);

    expect(
      doctor.runConfiguredCommandGate('vm_openclaw', 'VM_SMOKE_CMD', {
        VM_SMOKE_CMD: 'printf evaos-desktop-bridge',
      })
    ).toMatchObject({
      id: 'vm_openclaw',
      status: 'failed',
      reasonCode: 'unapproved_proof_command',
    });

    expect(
      doctor.runConfiguredCommandGate('vm_openclaw', 'VM_SMOKE_CMD', {
        VM_SMOKE_CMD: `${bridgeBin} diagnostics --json`,
      })
    ).toMatchObject({
      id: 'vm_openclaw',
      status: 'passed',
    });

    const openclawBin = path.join(binDir, 'openclaw');
    fs.writeFileSync(
      openclawBin,
      ['#!/bin/sh', 'printf \'{"ok":true,"result":{"status":"ready"}}\\n\'', ''].join('\n')
    );
    fs.chmodSync(openclawBin, 0o755);

    expect(
      doctor.runConfiguredCommandGate('local_openclaw', 'LOCAL_SMOKE_CMD', {
        LOCAL_SMOKE_CMD: `${openclawBin} mac-control-smoke`,
      })
    ).toMatchObject({
      id: 'local_openclaw',
      status: 'failed',
      reasonCode: 'missing_audit_proof',
    });

    const splitAuditBin = path.join(binDir, 'hermes');
    fs.writeFileSync(
      splitAuditBin,
      [
        '#!/bin/sh',
        'printf \'{"ok":true,"result":{"status":"ready"}}\\n\'',
        'printf \'{"ok":false,"auditId":"audit-failed","result":{"status":"failed"}}\\n\'',
        '',
      ].join('\n')
    );
    fs.chmodSync(splitAuditBin, 0o755);

    expect(
      doctor.runConfiguredCommandGate('hermes', 'HERMES_SMOKE_CMD', {
        HERMES_SMOKE_CMD: `${splitAuditBin} mac-control-smoke`,
      })
    ).toMatchObject({
      id: 'hermes',
      status: 'failed',
      reasonCode: 'missing_audit_proof',
    });

    fs.writeFileSync(
      openclawBin,
      ['#!/bin/sh', 'printf \'{"ok":false,"auditId":"audit-failed","result":{"status":"ready"}}\\n\'', ''].join('\n')
    );

    expect(
      doctor.runConfiguredCommandGate('local_openclaw', 'LOCAL_SMOKE_CMD', {
        LOCAL_SMOKE_CMD: `${openclawBin} mac-control-smoke`,
      })
    ).toMatchObject({
      id: 'local_openclaw',
      status: 'failed',
      reasonCode: 'missing_structured_success',
    });

    const killSwitchBin = path.join(binDir, 'customer_mac_kill_switch');
    fs.writeFileSync(
      killSwitchBin,
      [
        '#!/bin/sh',
        'printf \'{"ok":true,"auditId":"audit-kill","result":{"killSwitch":false,"message":"kill switch was not activated"}}\\n\'',
        '',
      ].join('\n')
    );
    fs.chmodSync(killSwitchBin, 0o755);

    expect(
      doctor.runConfiguredCommandGate('kill_switch', 'KILL_SWITCH_CMD', {
        KILL_SWITCH_CMD: `${killSwitchBin}`,
      })
    ).toMatchObject({
      id: 'kill_switch',
      status: 'failed',
      reasonCode: 'kill_switch_not_fail_closed',
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

  it('allows the evaos-support.sh wrapper as approved structured proof tooling', () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-doctor-bin-'));
    const supportScript = path.join(binDir, 'evaos-support.sh');
    fs.writeFileSync(
      supportScript,
      ['#!/bin/sh', 'printf \'{"ok":true,"auditId":"audit-support","result":{"status":"ready"}}\\n\'', ''].join('\n')
    );
    fs.chmodSync(supportScript, 0o755);

    expect(
      doctor.runConfiguredCommandGate('vm_openclaw', 'VM_SMOKE_CMD', {
        VM_SMOKE_CMD: `${supportScript} runtime-health --targets support-vm`,
      })
    ).toMatchObject({
      id: 'vm_openclaw',
      status: 'passed',
    });
  });

  it('rejects shell chaining in approved support-control proof commands', () => {
    expect(
      doctor.runConfiguredCommandGate('vm_openclaw', 'VM_SMOKE_CMD', {
        VM_SMOKE_CMD:
          'evaos-support.sh runtime-health --targets support-vm; printf \'{"ok":true,"auditId":"audit-forged","result":{"status":"ready"}}\\n\'',
      })
    ).toMatchObject({
      id: 'vm_openclaw',
      status: 'failed',
      reasonCode: 'unsupported_proof_command_syntax',
    });
  });

  it('expands the Admin route surface deterministically before checking route markers', async () => {
    const events: string[] = [];
    let expanded = false;
    const adminToggle = {
      waitFor: vi.fn(async () => {
        events.push('wait-toggle');
      }),
      isVisible: vi.fn(async () => {
        events.push('visible-toggle');
        return true;
      }),
      getAttribute: vi.fn(async (name: string) => {
        events.push(`attr:${name}`);
        return expanded ? 'true' : 'false';
      }),
      click: vi.fn(async () => {
        events.push('click-toggle');
        expanded = true;
      }),
    };
    const page = {
      locator: vi.fn(() => ({
        first: () => adminToggle,
      })),
      waitForFunction: vi.fn(async () => {
        events.push('wait-expanded');
      }),
    };

    await doctor.ensureAdminRouteSurfaceVisible(page, 250);

    expect(events).toEqual(['wait-toggle', 'visible-toggle', 'attr:aria-expanded', 'click-toggle', 'wait-expanded']);
    expect(adminToggle.click).toHaveBeenCalledTimes(1);
  });

  it('preserves pre-send proof-agent state when later failure capture loses agent pills', async () => {
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-agent-failure-'));
    const error = Object.assign(new Error('Visible Workbench agent proof did not settle.'), {
      preSendAgentState: {
        selectedAgent: {
          key: 'openclaw-gateway',
          type: 'openclaw-gateway',
          nativeStatus: 'ready',
        },
        availableAgents: [
          {
            key: 'openclaw-gateway',
            type: 'openclaw-gateway',
            selected: 'true',
            nativeStatus: 'ready',
          },
        ],
      },
      structuredFailureEvidence: {
        status: 'failed',
        reasonCode: 'agent_cli_config_invalid',
        data: {
          failureKind: 'fatal',
        },
      },
    });
    const page = {
      screenshot: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => ({
        hash: '#/conversation/after-navigation',
        selectedAgent: null,
        availableAgents: [],
        bodySummary: { length: 120, sha256Prefix: '__BODY_DIGEST__' },
      })),
    };

    const failure = await doctor.captureVisibleAgentFailureState(page, artifactRoot, 'visible_agent_mac_tools', error);

    expect(failure.state).toMatchObject({
      selectedAgent: null,
      availableAgents: [],
      preSendAgentState: {
        selectedAgent: {
          key: 'openclaw-gateway',
          nativeStatus: 'ready',
        },
      },
      structuredFailureEvidence: {
        reasonCode: 'agent_cli_config_invalid',
        data: {
          failureKind: 'fatal',
        },
      },
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

  it('does not report agent_paired when visible agent tool proof fails after connector readiness passes', () => {
    const packet = doctor.buildDiagnosticPacket(
      {
        expectedHead: 'b8b301f1aaff5d66ca5f70ec43e5aff74eb29b54',
        appPath: '/Applications/evaOS Workbench.app',
        supportAccount: 'admin@electricsheephq.com',
        supportTarget: 'Support VM',
      },
      [
        { id: 'mac_control_cold_start', status: 'passed' },
        { id: 'bridge_ready', status: 'passed' },
        {
          id: 'visible_agent_mac_tools',
          status: 'failed',
          reasonCode: 'agent_cli_config_invalid',
          message: 'Visible Workbench agent proof is missing required structured Mac-control tool results.',
        },
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
      blockerCategory: 'agent_cli_config_invalid',
      runtimeStatus: {
        evaos: 'failed',
        localAcp: 'failed',
      },
      brokerGrant: {
        state: 'failed',
        agentPairingStatus: 'not_ready',
      },
      connector: {
        status: 'repair_required',
        ownerClassification: 'agent_cli_config_invalid',
      },
    });
  });

  it('keeps support-control-only smoke from satisfying visible first-party Mac-control proof', () => {
    const gate = doctor.runVisibleAgentMacToolEvidenceGate({
      toolResults: [
        {
          tool: 'support_control_smoke',
          ok: true,
          auditId: 'audit-support-control',
          result: { status: 'healthy' },
        },
      ],
    });

    expect(gate).toMatchObject({
      id: 'visible_agent_mac_tools',
      status: 'failed',
      reasonCode: 'agent_cli_config_invalid',
      data: {
        observedTools: ['support_control_smoke'],
        missingTools: doctor.REQUIRED_VISIBLE_AGENT_MAC_TOOLS,
      },
    });

    const packet = doctor.buildDiagnosticPacket(
      {
        expectedHead: 'b8b301f1aaff5d66ca5f70ec43e5aff74eb29b54',
        appPath: '/Applications/evaOS Workbench.app',
        supportAccount: 'admin@electricsheephq.com',
        supportTarget: 'Support VM',
      },
      [
        { id: 'mac_control_cold_start', status: 'passed' },
        { id: 'bridge_ready', status: 'passed' },
        {
          id: 'visible_agent_mac_tools',
          status: 'failed',
          reasonCode: 'agent_cli_config_invalid',
          message: 'Visible Workbench agent proof is missing required structured Mac-control tool results.',
          data: {
            observedTools: ['support_control_smoke'],
            missingTools: doctor.REQUIRED_VISIBLE_AGENT_MAC_TOOLS,
          },
        },
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
      blockerCategory: 'agent_cli_config_invalid',
      brokerGrant: {
        agentPairingStatus: 'not_ready',
      },
      connector: {
        status: 'repair_required',
        ownerClassification: 'agent_cli_config_invalid',
      },
    });
  });

  it('does not report agent_paired when visible proof passes but readiness failed', () => {
    const packet = doctor.buildDiagnosticPacket(
      {
        expectedHead: 'b8b301f1aaff5d66ca5f70ec43e5aff74eb29b54',
        appPath: '/Applications/evaOS Workbench.app',
        supportAccount: 'admin@electricsheephq.com',
        supportTarget: 'Support VM',
      },
      [
        {
          id: 'mac_control_cold_start',
          status: 'failed',
          reasonCode: 'connector_service_not_ready',
          message: 'Mac control cold-start proof failed.',
        },
        { id: 'bridge_ready', status: 'passed' },
        { id: 'visible_agent_mac_tools', status: 'passed' },
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
        state: 'passed',
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
