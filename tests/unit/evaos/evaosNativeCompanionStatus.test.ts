/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { hostname } from 'node:os';
import {
  getEvaosWorkbenchDiagnosticPacket,
  getEvaosNativeCompanionStatus,
  openNativeCompanionRepairAction,
  openReleasedEvaosWorkbench,
  runNativeCompanionAction,
  stopEvaosNativeCompanionSessionConnector,
  type EvaosNativeCompanionStatusDeps,
} from '@/process/services/evaosNativeCompanionStatus';
import { EvaosBrokerSessionError } from '@/process/services/evaosBrokerSession';

const json = (payload: unknown) => JSON.stringify(payload);
const deviceName = hostname() || 'Customer Mac';
const bundledBridgePath = '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge';

function mockChildProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess & { exitCode: number | null; killed: boolean };
  child.exitCode = null;
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    child.exitCode = 0;
    child.emit('exit', 0, null);
    return true;
  }) as ChildProcess['kill'];
  child.unref = vi.fn(() => child) as ChildProcess['unref'];
  return child;
}

function depsWithResponses(
  responses: Record<string, unknown>,
  overrides: Partial<EvaosNativeCompanionStatusDeps> = {}
): EvaosNativeCompanionStatusDeps {
  return {
    now: () => new Date('2026-06-07T03:45:00.000Z'),
    bridgePaths: [bundledBridgePath],
    releasedWorkbenchPath: '/Applications/evaOS Workbench.app',
    existsSync: vi.fn((path: string) => path === bundledBridgePath || path === '/Applications/evaOS Workbench.app'),
    execFile: vi.fn(async (_file, args) => {
      const key = args.join(' ');
      const response = responses[key];
      const payload = Array.isArray(response) ? response.shift() : response;
      if (!payload) {
        throw new Error(`unexpected command ${key}`);
      }
      return { stdout: json(payload), stderr: '' };
    }),
    openPath: vi.fn(async () => ''),
    probeConnectorReady: vi.fn(async () => true),
    ...overrides,
  };
}

describe('evaosNativeCompanionStatus', () => {
  afterEach(() => {
    stopEvaosNativeCompanionSessionConnector();
  });

  it('exposes native companion state fixtures only under the local product proof gate', async () => {
    const execFile = vi.fn(async () => {
      throw new Error('fixture should not call bridge CLI');
    });
    const status = await getEvaosNativeCompanionStatus({
      now: () => new Date('2026-06-07T03:45:00.000Z'),
      env: {
        AIONUI_E2E_TEST: '1',
        AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE: '1',
        AIONUI_EVAOS_NATIVE_COMPANION_STATUS_FIXTURE: 'not_paired',
      } as NodeJS.ProcessEnv,
      execFile,
    });

    expect(status).toMatchObject({
      readiness: 'repair_required',
      sourcePointer: 'local-fixture:native-companion:not_paired',
      canOpenReleasedWorkbench: true,
      bridgeCli: {
        installed: true,
        readOnly: true,
      },
      customerMac: {
        deviceLabel: 'fixture-mac.local',
      },
    });
    expect(status.summaryText).toContain('NOT_PAIRED');
    expect(status.summaryText).toContain('LOCAL FIXTURE - NOT LIVE BETA PROOF');
    expect(status.audit.auditIds).toContain('fixture-audit-native-not_paired');
    expect(execFile).not.toHaveBeenCalled();
    expect(JSON.stringify(status)).not.toMatch(
      /Bearer|desktop_session|provider_grant|access_token|refresh_token|100\.64\.0\.10/i
    );
  });

  it('does not enable native state fixtures without the E2E local product gate', async () => {
    const deps = depsWithResponses(
      {},
      {
        env: {
          AIONUI_E2E_TEST: '1',
          AIONUI_EVAOS_NATIVE_COMPANION_STATUS_FIXTURE: 'ready',
        } as NodeJS.ProcessEnv,
        existsSync: vi.fn((path: string) => path === '/Applications/evaOS Workbench.app'),
      }
    );

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status.sourcePointer).toBe('native-companion:bridge-cli-missing');
    expect(status.bridgeCli.installed).toBe(false);
  });

  it('classifies a missing bundled bridge without claiming any other prerequisite is ready', async () => {
    const status = await getEvaosNativeCompanionStatus({
      now: () => new Date('2026-06-07T03:45:00.000Z'),
      bridgePaths: [bundledBridgePath],
      existsSync: vi.fn(() => false),
    });

    expect(status.prerequisites).toEqual({
      bridgeRuntime: 'missing',
      privateNetwork: 'error',
      actionEngine: 'unavailable',
    });
  });

  it('demotes legacy-ready pairing when explicit private-network evidence is offline', async () => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        data: {
          bridge_runtime: {
            schema: 'evaos.desktop_bridge.workbench_runtime.v1',
            contract_version: 1,
            version: '0.1.1',
            version_compatible: true,
            compatible: true,
          },
          permissions: { accessibility: { status: 'granted' }, screen_recording: { status: 'granted' } },
        },
      },
      'connector-service status --json': {
        ok: true,
        running: true,
        health: { reachable: true },
        tailnet_ip: '100.64.0.10',
        private_network: {
          client_installed: true,
          client_running: true,
          enrolled: true,
          correct_control_plane: true,
          acl_allowed: true,
          online: false,
        },
      },
      'customer-mac status --json': {
        ok: true,
        data: {
          permissions: { accessibility: { status: 'granted' }, screen_recording: { status: 'granted' } },
          control_engines: { peekaboo: { available: true }, active_primary: 'peekaboo' },
        },
      },
      'customer-mac iphone-mirroring status --json': { ok: true, data: { installed: true, running: false } },
      'customer-mac control status --json': { ok: true, data: { active: false, kill_switch: false } },
      'audit-tail --json --limit 5': { ok: true, data: { records: [] } },
      'ready --json': { ok: true, data: { ready: true } },
    });

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status).toMatchObject({
      readiness: 'repair_required',
      pairingCapable: false,
      pairingBlockedReason: 'secure_network_link_required',
      blockerReason: 'secure_network_link_required',
      prerequisites: {
        bridgeRuntime: 'ready',
        privateNetwork: 'offline',
        actionEngine: 'peekaboo_ready',
      },
    });
  });

  it('demotes legacy-ready pairing when the bundled bridge explicitly reports incompatibility', async () => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        data: {
          bridge_runtime: {
            schema: 'evaos.desktop_bridge.workbench_runtime.v1',
            contract_version: 1,
            version: '0.0.9',
            version_compatible: false,
            compatible: false,
          },
          permissions: { accessibility: { status: 'granted' }, screen_recording: { status: 'granted' } },
        },
      },
      'connector-service status --json': {
        ok: true,
        running: true,
        health: { reachable: true },
        tailnet_ip: '100.64.0.10',
      },
      'customer-mac status --json': {
        ok: true,
        data: {
          permissions: { accessibility: { status: 'granted' }, screen_recording: { status: 'granted' } },
          control_engines: { peekaboo: { available: true }, active_primary: 'peekaboo' },
        },
      },
      'customer-mac iphone-mirroring status --json': { ok: true, data: { installed: true, running: false } },
      'customer-mac control status --json': { ok: true, data: { active: false, kill_switch: false } },
      'audit-tail --json --limit 5': { ok: true, data: { records: [] } },
      'ready --json': { ok: true, data: { ready: true } },
    });

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status).toMatchObject({
      readiness: 'repair_required',
      pairingCapable: false,
      pairingBlockedReason: 'bundled_bridge_required',
      blockerReason: 'bundled_bridge_required',
      prerequisites: {
        bridgeRuntime: 'incompatible',
        privateNetwork: 'error',
        actionEngine: 'peekaboo_ready',
      },
    });
  });

  it('summarizes read-only bridge status without renderer-visible secrets', async () => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        audit_id: 'audit-bridge',
        data: {
          bridge_runtime: {
            schema: 'evaos.desktop_bridge.workbench_runtime.v1',
            contract_version: 1,
            version: '0.1.1',
            version_compatible: true,
            compatible: true,
          },
          permissions: {
            accessibility: { status: 'granted', guidance: 'secret-looking token guidance should not be used' },
            screen_recording: { status: 'granted' },
          },
          safety: {
            read_only: true,
            sends_prompts: false,
            uses_internal_mutation_rpc: false,
          },
        },
      },
      'connector-service status --json': {
        ok: true,
        running: true,
        health: {
          reachable: true,
        },
        tailnet_ip: '100.64.0.10',
        private_network: {
          client_installed: true,
          client_running: true,
          enrolled: true,
          correct_control_plane: true,
          acl_allowed: true,
          online: true,
        },
        permission_target: 'evaOS Workbench',
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac',
        data: {
          control_engines: {
            cua_driver: { available: true, active_for_actions: true },
            peekaboo: { available: true },
            active_primary: 'cua_driver',
          },
          device: {
            hostname: 'EVAs-Mac-mini.local',
            id: 'mac-3bf1c1b451434bcf',
            hardware_uuid_present: true,
          },
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
          screen_sharing: {
            enabled: true,
            vnc_5900_listening: true,
          },
          safety: {
            append_only_audit_log: true,
            kill_switch_available: true,
            hidden_shell_public_ports_and_token_exfiltration_blocked: true,
          },
        },
      },
      'customer-mac iphone-mirroring status --json': {
        ok: true,
        audit_id: 'audit-iphone',
        data: {
          installed: true,
          running: false,
          safety: {
            kill_switch_available: true,
          },
        },
      },
      'customer-mac control status --json': [
        {
          ok: true,
          audit_id: 'audit-control',
          data: {
            active: false,
            mode: 'ask-permission',
            kill_switch: false,
            agent_pairing_status: 'agent_paired',
            agent_pairing_customer_id: 'friendly',
            agent_pairing_proof_scope_id: 'grant-current',
            active_mac_control_scope_id: 'grant-current',
          },
        },
        {
          ok: true,
          audit_id: 'audit-control-proven',
          data: {
            active: false,
            mode: 'ask-permission',
            kill_switch: false,
            agent_pairing_status: 'agent_paired',
            agent_pairing_customer_id: 'friendly',
            agent_pairing_proof_scope_id: 'grant-current',
            active_mac_control_scope_id: 'grant-current',
            runtime_tool_readiness: 'tools_ready',
            runtime_tool_proof_customer_id: 'friendly',
            runtime_tool_proof_scope_id: 'grant-current',
          },
        },
        {
          ok: true,
          audit_id: 'audit-control-proven-camel-case',
          data: {
            active: false,
            mode: 'ask-permission',
            kill_switch: false,
            agent_pairing_status: 'agent_paired',
            agentPairingCustomerId: 'friendly',
            agentPairingProofScopeId: 'grant-current',
            activeMacControlScopeId: 'grant-current',
            runtimeToolReadiness: 'tools_ready',
            runtimeToolProofCustomerId: 'friendly',
            runtimeToolProofScopeId: 'grant-current',
          },
        },
        {
          ok: true,
          audit_id: 'audit-control-failed-stale-proof',
          data: {
            active: false,
            mode: 'ask-permission',
            kill_switch: false,
            agent_pairing_status: 'proof_failed',
            agent_pairing_customer_id: 'friendly',
            agent_pairing_proof_scope_id: 'grant-current',
            active_mac_control_scope_id: 'grant-current',
            runtime_tool_readiness: 'tools_ready',
            runtime_tool_proof_customer_id: 'friendly',
            runtime_tool_proof_scope_id: 'grant-current',
          },
        },
        {
          ok: true,
          audit_id: 'audit-control-unpaired-stale-proof',
          data: {
            active: false,
            mode: 'ask-permission',
            kill_switch: false,
            agent_pairing_status: 'ready_for_agent_pairing',
            runtimeToolReadiness: 'tools_ready',
          },
        },
        {
          ok: true,
          audit_id: 'audit-control-kill-switch-stale-proof',
          data: {
            active: false,
            mode: 'ask-permission',
            kill_switch: true,
            agent_pairing_status: 'agent_paired',
            agent_pairing_customer_id: 'friendly',
            agent_pairing_proof_scope_id: 'grant-current',
            active_mac_control_scope_id: 'grant-current',
            runtime_tool_readiness: 'tools_ready',
          },
        },
        {
          ok: true,
          audit_id: 'audit-control-stale-grant-proof',
          data: {
            active: false,
            mode: 'ask-permission',
            kill_switch: false,
            agent_pairing_status: 'agent_paired',
            agent_pairing_customer_id: 'friendly',
            agent_pairing_proof_scope_id: 'grant-current',
            active_mac_control_scope_id: 'grant-current',
            runtime_tool_readiness: 'tools_ready',
            runtime_tool_proof_customer_id: 'friendly',
            runtime_tool_proof_scope_id: 'grant-revoked',
          },
        },
        {
          ok: true,
          audit_id: 'audit-control-identical-stale-proof',
          data: {
            active: false,
            mode: 'ask-permission',
            kill_switch: false,
            agent_pairing_status: 'agent_paired',
            agent_pairing_customer_id: 'friendly',
            agent_pairing_proof_scope_id: 'grant-revoked',
            active_mac_control_scope_id: 'grant-current',
            runtime_tool_readiness: 'tools_ready',
            runtime_tool_proof_customer_id: 'friendly',
            runtime_tool_proof_scope_id: 'grant-revoked',
          },
        },
        {
          ok: false,
          audit_id: 'audit-control-command-failed-stale-proof',
          data: {
            active: false,
            mode: 'ask-permission',
            kill_switch: false,
            agent_pairing_status: 'agent_paired',
            runtime_tool_readiness: 'tools_ready',
          },
        },
      ],
      'audit-tail --json --limit 5': {
        ok: true,
        audit_id: 'audit-tail',
        data: {
          records: [{ audit_id: 'audit-mac' }, { audit_id: 'audit-iphone' }],
        },
      },
    });

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status).toMatchObject({
      schemaVersion: 'evaos.native_companion_status.v1',
      readiness: 'ready',
      agentPairingStatus: 'agent_paired',
      runtimeToolReadiness: 'pairing_ready',
      generatedAt: '2026-06-07T03:45:00.000Z',
      prerequisites: {
        bridgeRuntime: 'ready',
        privateNetwork: 'online',
        actionEngine: 'cua_ready',
      },
      bridgeCli: {
        installed: true,
        status: 'ready',
        auditId: 'audit-bridge',
        readOnly: true,
      },
      connectorService: {
        status: 'ready',
        running: true,
        reachable: true,
        privateNetworkAvailable: true,
      },
      customerMac: {
        status: 'ready',
        auditId: 'audit-mac',
        deviceLabel: 'EVAs-Mac-mini.local',
      },
      iPhone: {
        status: 'available',
        auditId: 'audit-iphone',
        installed: true,
        running: false,
      },
      controlSession: {
        status: 'ready',
        auditId: 'audit-control',
        active: false,
        mode: 'ask-permission',
        killSwitch: false,
      },
      audit: {
        status: 'ready',
        auditIds: ['audit-mac', 'audit-iphone'],
      },
    });
    expect(status.canOpenReleasedWorkbench).toBe(true);
    expect(JSON.stringify(status)).not.toMatch(
      /Bearer|token|secret|hardware_uuid|mac-3bf1c1b451434bcf|100\.64\.0\.10/i
    );

    const provenStatus = await getEvaosNativeCompanionStatus(deps);
    expect(provenStatus).toMatchObject({
      agentPairingStatus: 'agent_paired',
      agentPairingCustomerId: 'friendly',
      agentPairingProofScopeId: 'grant-current',
      activeMacControlScopeId: 'grant-current',
      runtimeToolReadiness: 'tools_ready',
      runtimeToolProofCustomerId: 'friendly',
      runtimeToolProofScopeId: 'grant-current',
      controlSession: { auditId: 'audit-control-proven' },
    });

    const camelCaseProvenStatus = await getEvaosNativeCompanionStatus(deps);
    expect(camelCaseProvenStatus).toMatchObject({
      agentPairingStatus: 'agent_paired',
      agentPairingCustomerId: 'friendly',
      agentPairingProofScopeId: 'grant-current',
      activeMacControlScopeId: 'grant-current',
      runtimeToolReadiness: 'tools_ready',
      runtimeToolProofCustomerId: 'friendly',
      runtimeToolProofScopeId: 'grant-current',
      controlSession: { auditId: 'audit-control-proven-camel-case' },
    });

    const failedPairingStatus = await getEvaosNativeCompanionStatus(deps);
    expect(failedPairingStatus).toMatchObject({
      agentPairingStatus: 'proof_failed',
      runtimeToolReadiness: 'proof_failed',
      controlSession: { auditId: 'audit-control-failed-stale-proof' },
    });

    const incompletePairingStatus = await getEvaosNativeCompanionStatus(deps);
    expect(incompletePairingStatus).toMatchObject({
      agentPairingStatus: 'ready_for_agent_pairing',
      runtimeToolReadiness: 'pairing_ready',
      controlSession: { auditId: 'audit-control-unpaired-stale-proof' },
    });

    const killSwitchStatus = await getEvaosNativeCompanionStatus(deps);
    expect(killSwitchStatus).toMatchObject({
      agentPairingStatus: 'agent_paired',
      runtimeToolReadiness: 'not_ready',
      controlSession: { auditId: 'audit-control-kill-switch-stale-proof', killSwitch: true },
    });

    const staleGrantProofStatus = await getEvaosNativeCompanionStatus(deps);
    expect(staleGrantProofStatus).toMatchObject({
      agentPairingStatus: 'agent_paired',
      agentPairingCustomerId: 'friendly',
      agentPairingProofScopeId: 'grant-current',
      runtimeToolReadiness: 'pairing_ready',
      controlSession: { auditId: 'audit-control-stale-grant-proof' },
    });

    const identicalStaleProofStatus = await getEvaosNativeCompanionStatus(deps);
    expect(identicalStaleProofStatus).toMatchObject({
      agentPairingStatus: 'ready_for_agent_pairing',
      agentPairingCustomerId: 'friendly',
      agentPairingProofScopeId: 'grant-revoked',
      activeMacControlScopeId: 'grant-current',
      runtimeToolReadiness: 'pairing_ready',
      controlSession: { auditId: 'audit-control-identical-stale-proof' },
    });

    const failedCommandStatus = await getEvaosNativeCompanionStatus(deps);
    expect(failedCommandStatus).toMatchObject({
      agentPairingStatus: 'ready_for_agent_pairing',
      runtimeToolReadiness: 'not_ready',
      controlSession: { auditId: 'audit-control-command-failed-stale-proof', status: 'unavailable' },
    });
  });

  it('uses bridge ready as connector truth when legacy connector-service status is stale', async () => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        audit_id: 'audit-bridge',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
          safety: { read_only: true },
        },
      },
      'connector-service status --json': {
        ok: false,
        data: {
          running: false,
          loaded: false,
          managed_by: 'offline',
          health: { reachable: false, ready: false, host_kind: 'tailnet' },
        },
      },
      'ready --json': {
        ok: true,
        ready: true,
        service: 'evaos-desktop-bridge-connector',
        connector_service: {
          health: { authenticated: true, reachable: true, ready: true, host_kind: 'tailnet' },
          owner: {
            app_path: { kind: 'path', value: '/Applications/evaOS Workbench.app' },
            bundle_id: 'com.evaos.workbench',
            classification: 'workbench_bundle',
            program_path: {
              kind: 'path',
              value: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
            },
          },
        },
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac',
        data: {
          device: { hostname: 'Matthew Calderon' },
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'customer-mac iphone-mirroring status --json': {
        ok: true,
        data: { installed: true, running: true },
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control',
        data: { active: false, ready: true, kill_switch: false },
      },
      'audit-tail --json --limit 5': {
        ok: true,
        data: { records: [{ audit_id: 'audit-mac' }, { audit_id: 'audit-control' }] },
      },
    });

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status).toMatchObject({
      readiness: 'ready',
      agentPairingStatus: 'ready_for_agent_pairing',
      runtimeToolReadiness: 'pairing_ready',
      pairingCapable: true,
      pairingBlockedReason: undefined,
      connectorService: {
        status: 'ready',
        running: true,
        reachable: true,
      },
      customerMac: {
        status: 'ready',
      },
    });
  });

  it('does not accept bridge ready proof from a different signed app owner', async () => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        audit_id: 'audit-bridge',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
          safety: { read_only: true },
        },
      },
      'connector-service status --json': {
        ok: false,
        data: {
          running: false,
          loaded: false,
          managed_by: 'offline',
          health: { reachable: false, ready: false, host_kind: 'tailnet' },
        },
      },
      'ready --json': {
        ok: true,
        ready: true,
        service: 'evaos-desktop-bridge-connector',
        connector_service: {
          health: { reachable: true, ready: true, host_kind: 'tailnet' },
          responsible_bundle_id: 'com.evaos.workbench.beta',
          responsible_app_path: '/Applications/evaOS Workbench Beta.app',
        },
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'customer-mac iphone-mirroring status --json': {
        ok: true,
        data: { installed: true, running: true },
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control',
        data: { active: false, ready: true, kill_switch: false },
      },
      'audit-tail --json --limit 5': {
        ok: true,
        data: { records: [] },
      },
    });

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status.readiness).toBe('repair_required');
    expect(status.connectorService).toMatchObject({
      status: 'repair_required',
      running: false,
      reachable: false,
    });
  });

  it('does not mark Mac control ready when a reachable listener fails the bridge /ready contract', async () => {
    const deps = depsWithResponses(
      {
        'status --json': {
          ok: true,
          audit_id: 'audit-bridge',
          data: {
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
            safety: {
              read_only: true,
            },
          },
        },
        'connector-service status --json': {
          ok: true,
          running: true,
          health: {
            host: '100.64.0.10',
            reachable: true,
            status_line: 'HTTP/1.0 200 OK',
          },
          tailnet_ip: '100.64.0.10',
          token_present: true,
        },
        'customer-mac status --json': {
          ok: true,
          audit_id: 'audit-mac',
          data: {
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
        'customer-mac iphone-mirroring status --json': {
          ok: true,
          audit_id: 'audit-iphone',
          data: {
            installed: true,
            running: false,
          },
        },
        'customer-mac control status --json': {
          ok: true,
          audit_id: 'audit-control',
          data: {
            active: false,
            mode: 'ask-permission',
            kill_switch: false,
          },
        },
        'audit-tail --json --limit 5': {
          ok: true,
          audit_id: 'audit-tail',
          data: {
            records: [{ audit_id: 'audit-mac' }, { audit_id: 'audit-iphone' }],
          },
        },
      },
      {
        probeConnectorReady: vi.fn(async () => false),
      }
    );

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status).toMatchObject({
      readiness: 'repair_required',
      agentPairingStatus: 'not_ready',
      connectorService: {
        status: 'repair_required',
        running: true,
        reachable: true,
        privateNetworkAvailable: true,
      },
    });
    expect(status.summaryText).toContain('repair is required');
    expect(deps.probeConnectorReady).toHaveBeenCalledWith('100.64.0.10', 8765);
  });

  it('builds a redacted Mac-control diagnostic packet with a typed blocker category', async () => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        audit_id: 'audit-bridge',
        data: {
          version: 'bridge-1.2.3',
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
          safety: { read_only: true },
        },
      },
      'connector-service status --json': {
        ok: false,
        data: {
          running: false,
          managed_by: 'manual',
          tailnet_ip: '100.64.0.10',
          permission_target: 'evaOS Workbench',
          health: { reachable: false, host: '100.64.0.10' },
        },
        errors: [
          {
            code: 'EADDRINUSE',
            message: 'Address already in use on http://100.64.0.10:8765 with connector_token=abc123',
          },
        ],
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac',
        data: {
          device: { hostname: 'Support Mac' },
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'customer-mac iphone-mirroring status --json': {
        ok: true,
        data: { installed: false, running: false },
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control',
        data: { active: false, ready: true, kill_switch: false },
      },
      'audit-tail --json --limit 5': {
        ok: true,
        data: { records: [{ audit_id: 'audit-mac' }, { audit_id: 'audit-control' }] },
      },
      'diagnostics --json': {
        ok: true,
        data: {
          launch_agent_label: 'com.evaos.workbench.bridge',
          launch_agent_state: 'loaded',
          launch_agent_program_path: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
        },
      },
      'ready --json': {
        ok: false,
        errors: [{ code: 'not_ready', message: 'http://100.64.0.10:8765 is not ready' }],
      },
    });

    const packet = await getEvaosWorkbenchDiagnosticPacket(
      {
        route: '/native-companion',
        accountEmail: 'admin@electricsheephq.com',
        customerId: 'support-vm',
        customerLabel: 'Support VM',
        lastAction: {
          action: 'connector_start',
          status: 'repair_required',
          message: 'Address already in use on http://100.64.0.10:8765 with Bearer deadbeef',
          blockerReason: 'port_in_use',
        },
      },
      deps
    );

    expect(packet).toMatchObject({
      schemaVersion: 'evaos.workbench.diagnostic_packet.v1',
      blockerCategory: 'port_in_use',
      selectedContext: {
        accountEmail: 'admin@electricsheephq.com',
        customerId: 'support-vm',
      },
      connector: {
        endpointSummary: 'unavailable',
        ownerClassification: 'not_workbench_managed',
      },
      bridge: {
        diagnosticsStatus: 'available',
        readyStatus: 'not_ready',
      },
      redaction: {
        rawSecretsStoredInWorkbench: false,
        urlsIpsPortsRedacted: true,
        rawPromptMaterialIncluded: false,
      },
    });
    const serialized = JSON.stringify(packet);
    expect(serialized).not.toContain('100.64.0.10');
    expect(serialized).not.toContain('8765');
    expect(serialized).not.toContain('abc123');
    expect(serialized).not.toMatch(/https?:\/\//i);
    expect(serialized).not.toMatch(/Bearer\s+deadbeef/i);
  });

  it('uses control-status permission proof when customer-mac status is stale', async () => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        audit_id: 'audit-bridge',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
          safety: { read_only: true },
        },
      },
      'connector-service status --json': {
        ok: true,
        running: true,
        health: { reachable: true },
        tailnet_ip: '100.64.0.10',
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac-stale',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'missing' },
          },
        },
      },
      'customer-mac iphone-mirroring status --json': {
        ok: true,
        audit_id: 'audit-iphone',
        data: { installed: true, running: false },
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control-current',
        data: {
          active: false,
          mode: 'ask-permission',
          kill_switch: false,
          ready: true,
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'audit-tail --json --limit 5': {
        ok: true,
        data: {
          records: [{ audit_id: 'audit-control-current' }, { audit_id: 'audit-mac-stale' }],
        },
      },
    });

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status).toMatchObject({
      readiness: 'ready',
      pairingCapable: true,
      agentPairingStatus: 'ready_for_agent_pairing',
      customerMac: {
        status: 'ready',
        permissions: {
          accessibility: 'granted',
          screenRecording: 'granted',
        },
      },
      controlSession: {
        status: 'ready',
        auditId: 'audit-control-current',
      },
    });
  });

  it('uses current control permission proof when bridge status permission state is stale', async () => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        audit_id: 'audit-bridge-stale',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'missing' },
          },
          safety: { read_only: true },
        },
      },
      'connector-service status --json': {
        ok: true,
        running: true,
        health: { reachable: true },
        tailnet_ip: '100.64.0.10',
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac-stale',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'missing' },
          },
        },
      },
      'customer-mac iphone-mirroring status --json': {
        ok: true,
        audit_id: 'audit-iphone',
        data: { installed: true, running: false },
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control-current',
        data: {
          active: true,
          mode: 'ask_permission',
          kill_switch: false,
          ready: true,
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'audit-tail --json --limit 5': {
        ok: true,
        data: {
          records: [{ audit_id: 'audit-control-current' }, { audit_id: 'audit-bridge-stale' }],
        },
      },
    });

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status).toMatchObject({
      readiness: 'ready',
      agentPairingStatus: 'ready_for_agent_pairing',
      bridgeCli: {
        status: 'ready',
        permissions: {
          accessibility: 'granted',
          screenRecording: 'granted',
        },
      },
      customerMac: {
        status: 'ready',
        permissions: {
          accessibility: 'granted',
          screenRecording: 'granted',
        },
      },
      controlSession: {
        status: 'ready',
        active: true,
        mode: 'ask-permission',
        killSwitch: false,
      },
    });
  });

  it('treats legacy top-level connector-service status as ready when reachable', async () => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        audit_id: 'audit-bridge',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
          safety: { read_only: true },
        },
      },
      'connector-service status --json': {
        domain: 'gui/502',
        label: 'com.electricsheep.evaos-desktop-bridge',
        loaded: true,
        running: true,
        health: {
          host: '100.64.0.4',
          port: 8765,
          reachable: true,
          status_line: 'HTTP/1.0 200 OK',
        },
        tailnet_ip: '100.64.0.4',
        token_present: true,
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'customer-mac iphone-mirroring status --json': {
        ok: true,
        audit_id: 'audit-iphone',
        data: { installed: true, running: false },
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control',
        data: {
          active: true,
          mode: 'ask_permission',
          kill_switch: false,
          ready: true,
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'audit-tail --json --limit 5': {
        ok: true,
        data: {
          records: [{ audit_id: 'audit-control' }, { audit_id: 'audit-mac' }],
        },
      },
    });

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status).toMatchObject({
      readiness: 'ready',
      agentPairingStatus: 'ready_for_agent_pairing',
      connectorService: {
        status: 'ready',
        running: true,
        reachable: true,
        privateNetworkAvailable: true,
      },
      customerMac: {
        status: 'ready',
      },
    });
  });

  it('does not use control permission proof when the kill switch is active', async () => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        audit_id: 'audit-bridge-stale',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'missing' },
          },
          safety: { read_only: true },
        },
      },
      'connector-service status --json': {
        ok: true,
        running: true,
        health: { reachable: true },
        tailnet_ip: '100.64.0.10',
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac-stale',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'missing' },
          },
        },
      },
      'customer-mac iphone-mirroring status --json': {
        ok: true,
        audit_id: 'audit-iphone',
        data: { installed: true, running: false },
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control-blocked',
        data: {
          active: true,
          mode: 'ask_permission',
          kill_switch: true,
          ready: true,
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'audit-tail --json --limit 5': {
        ok: true,
        data: {
          records: [{ audit_id: 'audit-control-blocked' }, { audit_id: 'audit-bridge-stale' }],
        },
      },
    });

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status).toMatchObject({
      readiness: 'repair_required',
      agentPairingStatus: 'not_ready',
      bridgeCli: {
        status: 'repair_required',
        permissions: {
          accessibility: 'granted',
          screenRecording: 'missing',
        },
      },
      customerMac: {
        status: 'repair_required',
        permissions: {
          accessibility: 'granted',
          screenRecording: 'missing',
        },
      },
      controlSession: {
        status: 'ready',
        active: true,
        mode: 'ask-permission',
        killSwitch: true,
      },
    });
  });

  it('prefers the packaged Workbench bridge before Homebrew fallback paths', async () => {
    const bundledBridge = '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge';
    const homebrewBridge = '/opt/homebrew/bin/evaos-desktop-bridge';
    const deps = depsWithResponses(
      {
        'status --json': {
          ok: true,
          audit_id: 'audit-bridge',
          data: {
            version: '0.6.29',
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
            safety: { read_only: true },
          },
        },
        'connector-service status --json': {
          ok: true,
          running: true,
          health: { reachable: true },
          tailnet_ip: '100.64.0.10',
        },
        'customer-mac status --json': {
          ok: true,
          audit_id: 'audit-mac',
          data: {
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
        'customer-mac iphone-mirroring status --json': {
          ok: true,
          audit_id: 'audit-iphone',
          data: { installed: true, running: false },
        },
        'customer-mac control status --json': {
          ok: true,
          audit_id: 'audit-control',
          data: { active: false, kill_switch: false },
        },
        'audit-tail --json --limit 5': {
          ok: true,
          data: { records: [] },
        },
      },
      {
        bridgePaths: [bundledBridge, homebrewBridge],
        existsSync: vi.fn(
          (candidate: string) =>
            candidate === bundledBridge ||
            candidate === homebrewBridge ||
            candidate === '/Applications/evaOS Workbench.app'
        ),
      }
    );

    const status = await getEvaosNativeCompanionStatus(deps);

    const execFile = deps.execFile as ReturnType<typeof vi.fn>;
    expect(status.bridgeCli.path).toBe(bundledBridge);
    expect(status.bridgeCli.version).toBe('0.6.29');
    expect(execFile.mock.calls.every(([file]) => file === bundledBridge)).toBe(true);
  });

  it('does not search environment or Homebrew bridge paths in packaged mode', async () => {
    const homebrewBridge = '/opt/homebrew/bin/evaos-desktop-bridge';
    const execFile = vi.fn(async () => {
      throw new Error('packaged status must not execute a host bridge');
    });

    const status = await getEvaosNativeCompanionStatus({
      now: () => new Date('2026-06-07T03:45:00.000Z'),
      env: {
        EVAOS_DESKTOP_BRIDGE_PATH: homebrewBridge,
        IS_PACKAGED: 'true',
      } as NodeJS.ProcessEnv,
      isPackaged: true,
      releasedWorkbenchPath: '/Applications/evaOS Workbench.app',
      existsSync: vi.fn((candidate: string) => candidate === homebrewBridge),
      execFile,
    });

    expect(status).toMatchObject({
      prerequisites: { bridgeRuntime: 'missing' },
      bridgeCli: { installed: false, status: 'missing' },
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('does not mark Mac control ready when the connector service is not reachable', async () => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        audit_id: 'audit-bridge',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
          safety: {
            read_only: true,
          },
        },
      },
      'connector-service status --json': {
        ok: true,
        running: true,
        health: {
          reachable: false,
        },
        tailnet_ip: '100.64.0.10',
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'customer-mac iphone-mirroring status --json': {
        ok: true,
        audit_id: 'audit-iphone',
        data: {
          installed: true,
          running: false,
        },
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control',
        data: {
          active: false,
          kill_switch: false,
        },
      },
      'audit-tail --json --limit 5': {
        ok: true,
        audit_id: 'audit-tail',
        data: { records: [] },
      },
    });

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status).toMatchObject({
      readiness: 'repair_required',
      agentPairingStatus: 'not_ready',
      connectorService: {
        status: 'repair_required',
        running: true,
        reachable: false,
      },
    });
    expect(status.summaryText).toContain('repair is required');
  });

  it('does not report pairing capable when the connector only exposes loopback', async () => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        audit_id: 'audit-bridge',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
          safety: {
            read_only: true,
          },
        },
      },
      'connector-service status --json': {
        ok: true,
        running: true,
        health: {
          reachable: true,
          host: '127.0.0.1',
        },
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'customer-mac iphone-mirroring status --json': {
        ok: true,
        audit_id: 'audit-iphone',
        data: {
          installed: true,
          running: false,
        },
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control',
        data: {
          active: false,
          kill_switch: false,
        },
      },
      'audit-tail --json --limit 5': {
        ok: true,
        audit_id: 'audit-tail',
        data: { records: [] },
      },
    });

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status).toMatchObject({
      readiness: 'ready',
      agentPairingStatus: 'not_ready',
      pairingCapable: false,
      pairingBlockedReason: 'secure_network_link_required',
      connectorService: {
        status: 'ready',
        running: true,
        reachable: true,
      },
    });
    expect(status.summaryText).toContain('private connector link');
  });

  it('accepts private connector hosts when the bridge reports a URL or port', async () => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        audit_id: 'audit-bridge',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
          safety: {
            read_only: true,
          },
        },
      },
      'connector-service status --json': {
        ok: true,
        running: true,
        health: {
          reachable: true,
          host: 'http://100.64.0.4:8765',
        },
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'customer-mac iphone-mirroring status --json': {
        ok: true,
        audit_id: 'audit-iphone',
        data: {
          installed: true,
          running: false,
        },
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control',
        data: {
          active: false,
          kill_switch: false,
        },
      },
      'audit-tail --json --limit 5': {
        ok: true,
        audit_id: 'audit-tail',
        data: { records: [] },
      },
    });

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status).toMatchObject({
      readiness: 'ready',
      agentPairingStatus: 'ready_for_agent_pairing',
      pairingCapable: true,
    });
  });

  it('fails closed when the bridge CLI is missing', async () => {
    const deps = depsWithResponses(
      {},
      {
        existsSync: vi.fn((path: string) => path === '/Applications/evaOS Workbench.app'),
      }
    );

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status.readiness).toBe('repair_required');
    expect(status.bridgeCli).toMatchObject({
      installed: false,
      status: 'missing',
    });
    expect(status.summaryText).toContain('Workbench connector tools are not installed');
  });

  it('runs the setup check through fixed connector commands', async () => {
    const deps = depsWithResponses({
      'connector-service status --json': {
        ok: true,
        running: true,
        health: { reachable: true },
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control',
        data: {
          active: false,
          mode: 'ask-permission',
          kill_switch: false,
        },
      },
      'audit-tail --json --limit 12': {
        ok: true,
        data: {
          records: [{ audit_id: 'audit-mac' }, { audit_id: 'audit-control' }],
        },
      },
    });

    const result = await runNativeCompanionAction({ action: 'setup_check' }, deps);

    expect(result).toMatchObject({
      action: 'setup_check',
      status: 'succeeded',
      agentPairingStatus: 'ready_for_agent_pairing',
      sourcePointer: 'native-companion:setup-check',
      auditIds: ['audit-mac', 'audit-control'],
      setup: {
        connectorReady: true,
        macReady: true,
        controlReady: true,
        iPhoneDeferred: true,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/Bearer|desktop_session|provider_grant|access_token|refresh_token/i);
  });

  it('runs setup check with legacy top-level connector-service status payloads', async () => {
    const deps = depsWithResponses({
      'connector-service status --json': {
        domain: 'gui/502',
        label: 'com.electricsheep.evaos-desktop-bridge',
        loaded: true,
        running: true,
        health: {
          host: '100.64.0.4',
          port: 8765,
          reachable: true,
          status_line: 'HTTP/1.0 200 OK',
        },
        token_present: true,
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'missing' },
          },
        },
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control-current',
        data: {
          ready: true,
          active: true,
          mode: 'ask_permission',
          kill_switch: false,
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'audit-tail --json --limit 12': {
        ok: true,
        data: {
          records: [{ audit_id: 'audit-control-current' }, { audit_id: 'audit-mac' }],
        },
      },
    });

    const result = await runNativeCompanionAction({ action: 'setup_check' }, deps);

    expect(result).toMatchObject({
      action: 'setup_check',
      status: 'succeeded',
      agentPairingStatus: 'ready_for_agent_pairing',
      setup: {
        connectorReady: true,
        macReady: true,
        controlReady: true,
      },
    });
    expect(result.message).toContain('Mac Access setup check passed');
  });

  it('starts then reuses a tracked Workbench-managed Mac Access connector', async () => {
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const execFile = vi.fn(async (_file, args) => {
      const key = args.join(' ');
      if (key === 'connector-service status --json') {
        return {
          stdout: json({
            ok: true,
            audit_id: 'audit-connector',
            loaded: false,
            running: false,
            managed_by: 'workbench-or-manual',
            tailnet_ip: '100.64.0.4',
            health: { reachable: true, host: '100.64.0.4' },
          }),
          stderr: '',
        };
      }
      if (key === 'connector-service stop --json') {
        return {
          stdout: json({ ok: true, action: 'stop' }),
          stderr: '',
        };
      }
      throw new Error(`unexpected command ${key}`);
    });
    const deps = depsWithResponses({}, { execFile, spawnConnectorProcess });

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);
    const reused = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({
      action: 'connector_start',
      status: 'succeeded',
      sourcePointer: 'native-companion:workbench-session-connector-start',
      auditId: 'audit-connector',
    });
    expect(result.message).toContain('Workbench session');
    expect(reused).toMatchObject({
      action: 'connector_start',
      status: 'succeeded',
      sourcePointer: 'native-companion:workbench-session-connector-start',
      auditId: 'audit-connector',
    });
    expect(spawnConnectorProcess).toHaveBeenCalledTimes(1);
    expect(
      execFile.mock.calls.filter(([, callArgs]) => callArgs.join(' ') === 'connector-service stop --json')
    ).toHaveLength(1);
  });

  it('adopts an exact signed Workbench-owned connector after app relaunch without respawning it', async () => {
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const execFile = vi.fn(async (_file, args) => {
      const key = args.join(' ');
      if (key === 'connector-service status --json') {
        return {
          stdout: json({
            ok: true,
            audit_id: 'audit-adopted-connector',
            loaded: false,
            running: true,
            managed_by: 'workbench-session',
            responsible_bundle_id: 'com.evaos.workbench',
            responsible_app_path: '/Applications/evaOS Workbench.app',
            process_path: bundledBridgePath,
            tailnet_ip: '100.64.0.4',
            health: { reachable: true, host: '100.64.0.4' },
          }),
          stderr: '',
        };
      }
      throw new Error(`unexpected command ${key}`);
    });
    const deps = depsWithResponses({}, { execFile, spawnConnectorProcess });

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({
      action: 'connector_start',
      status: 'succeeded',
      sourcePointer: 'native-companion:workbench-session-connector-start',
      auditId: 'audit-adopted-connector',
    });
    expect(spawnConnectorProcess).not.toHaveBeenCalled();
    expect(execFile.mock.calls.map(([, callArgs]) => callArgs.join(' '))).not.toContain(
      'connector-service stop --json'
    );
  });

  it('accepts bridge ready proof when connector-service status is stale during connector start', async () => {
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const deps = depsWithResponses(
      {
        'connector-service status --json': {
          ok: false,
          data: {
            running: false,
            loaded: false,
            managed_by: 'offline',
            health: { reachable: false, ready: false, host_kind: 'tailnet' },
          },
        },
        'ready --json': [
          {
            ok: true,
            ready: true,
            service: 'evaos-desktop-bridge-connector',
            connector_service: {
              health: { reachable: true, ready: true, host_kind: 'tailnet' },
            },
          },
          {
            ok: true,
            ready: true,
            service: 'evaos-desktop-bridge-connector',
            connector_service: {
              health: { reachable: true, ready: true, host_kind: 'tailnet' },
            },
          },
        ],
      },
      { spawnConnectorProcess }
    );

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({
      action: 'connector_start',
      status: 'succeeded',
      sourcePointer: 'native-companion:workbench-session-connector-start',
    });
    expect(spawnConnectorProcess).not.toHaveBeenCalled();
    expect(
      (deps.execFile as ReturnType<typeof vi.fn>).mock.calls.map(([, callArgs]) => callArgs.join(' '))
    ).not.toContain('connector-service stop --json');
  });

  it('surfaces a stale listener owner when the connector port belongs to an old app bundle', async () => {
    const staleStatus = {
      ok: true,
      audit_id: 'audit-stale-connector',
      loaded: false,
      running: true,
      managed_by: 'workbench-session',
      responsible_bundle_id: 'com.evaos.workbench.beta',
      responsible_app_path: '/Volumes/LEXAR/Codex/old/evaOS Workbench Beta.app',
      process_path: '/Volumes/LEXAR/Codex/old/evaOS Workbench Beta.app/Contents/Resources/Bridge/evaos-desktop-bridge',
      tailnet_ip: '100.64.0.4',
      health: { reachable: true, host: '100.64.0.4' },
    };
    const deps = depsWithResponses(
      {
        'connector-service status --json': [staleStatus, staleStatus, staleStatus, staleStatus, staleStatus],
        'connector-service stop --json': {
          ok: true,
          action: 'stop',
        },
      },
      {
        sleep: vi.fn(async () => undefined),
        spawnConnectorProcess: vi.fn(() => mockChildProcess()),
      }
    );

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({
      action: 'connector_start',
      status: 'repair_required',
      blockerReason: 'listener_owner_mismatch',
    });
    expect(result.message).toContain('Mac Access connector could not start');
    expect(deps.spawnConnectorProcess).toHaveBeenCalledTimes(1);
  });

  it('rejects a health-only listener when /ready does not prove the Workbench bridge', async () => {
    const healthOnlyStatus = {
      ok: true,
      audit_id: 'audit-health-only-connector',
      loaded: false,
      running: false,
      managed_by: 'workbench-or-manual',
      tailnet_ip: '100.64.0.4',
      token_path: '~/Library/Application Support/evaos-desktop-bridge/connector.token',
      health: { reachable: true, host: '100.64.0.4', status_line: 'HTTP/1.0 200 OK' },
    };
    const deps = depsWithResponses(
      {
        'connector-service status --json': [
          healthOnlyStatus,
          healthOnlyStatus,
          healthOnlyStatus,
          healthOnlyStatus,
          healthOnlyStatus,
        ],
        'connector-service stop --json': {
          ok: true,
          action: 'stop',
        },
      },
      {
        sleep: vi.fn(async () => undefined),
        probeConnectorReady: vi.fn(async () => false),
        spawnConnectorProcess: vi.fn(() => mockChildProcess()),
      }
    );

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({
      action: 'connector_start',
      status: 'repair_required',
      blockerReason: 'stale_connector_port_conflict',
    });
    expect(result.message).toContain('Mac Access connector could not start');
    expect(deps.spawnConnectorProcess).toHaveBeenCalledTimes(1);
    expect(deps.probeConnectorReady).toHaveBeenCalledWith('100.64.0.4', 8765);
  });

  it('surfaces a tracked Workbench-managed connector as ready when the bridge reports manual reachable status', async () => {
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const deps = depsWithResponses(
      {
        'connector-service status --json': [
          {
            ok: true,
            running: true,
            managed_by: 'launchagent',
            tailnet_ip: '100.64.0.4',
            health: { reachable: true, host: '100.64.0.4' },
          },
          {
            ok: true,
            audit_id: 'audit-connector-ready',
            loaded: false,
            running: false,
            managed_by: 'workbench-or-manual',
            tailnet_ip: '100.64.0.4',
            health: { reachable: true, host: '100.64.0.4' },
          },
          {
            ok: true,
            audit_id: 'audit-connector-status',
            loaded: false,
            running: false,
            managed_by: 'workbench-or-manual',
            tailnet_ip: '100.64.0.4',
            health: { reachable: true, host: '100.64.0.4' },
          },
        ],
        'connector-service stop --json': {
          ok: true,
          action: 'stop',
        },
        'status --json': {
          ok: true,
          data: {
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
            safety: { read_only: true },
          },
        },
        'customer-mac status --json': {
          ok: true,
          audit_id: 'audit-mac',
          data: {
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
        'customer-mac iphone-mirroring status --json': {
          ok: true,
          audit_id: 'audit-iphone',
          data: { installed: true, running: false },
        },
        'customer-mac control status --json': {
          ok: true,
          audit_id: 'audit-control',
          data: {
            ready: true,
            active: false,
            mode: 'ask-permission',
            kill_switch: false,
          },
        },
        'audit-tail --json --limit 5': {
          ok: true,
          data: {
            records: [{ audit_id: 'audit-mac' }, { audit_id: 'audit-control' }],
          },
        },
      },
      { spawnConnectorProcess }
    );

    const start = await runNativeCompanionAction({ action: 'connector_start' }, deps);
    const status = await getEvaosNativeCompanionStatus(deps);

    expect(start).toMatchObject({
      action: 'connector_start',
      status: 'succeeded',
      sourcePointer: 'native-companion:workbench-session-connector-start',
    });
    expect(status).toMatchObject({
      readiness: 'ready',
      connectorService: {
        status: 'ready',
        running: true,
        reachable: true,
        managedBy: 'workbench-or-manual',
      },
    });
  });

  it('stops launchd and starts a Workbench-owned session connector for Mac Access', async () => {
    const child = mockChildProcess();
    const spawnConnectorProcess = vi.fn(() => child);
    const execFile = vi.fn(async (_file, args) => {
      const key = args.join(' ');
      if (key === 'connector-service stop --json') {
        return {
          stdout: json({
            ok: true,
            action: 'stop',
          }),
          stderr: '',
        };
      }
      if (key === 'connector-service status --json') {
        const statusCalls = execFile.mock.calls.filter(([, callArgs]) => {
          return callArgs.join(' ') === 'connector-service status --json';
        }).length;
        return {
          stdout: json({
            ok: true,
            audit_id: statusCalls > 1 ? 'audit-connector-ready' : 'audit-connector-starting',
            loaded: statusCalls <= 1,
            running: statusCalls <= 1,
            managed_by: statusCalls > 1 ? 'workbench-or-manual' : 'launchagent',
            tailnet_ip: '100.64.0.4',
            health: { reachable: statusCalls > 1, host: '100.64.0.4' },
          }),
          stderr: '',
        };
      }
      if (key === 'ready --json') {
        return {
          stdout: json({
            ok: false,
            ready: false,
            service: 'evaos-desktop-bridge-connector',
            connector_service: {
              health: { reachable: false, ready: false },
            },
          }),
          stderr: '',
        };
      }
      throw new Error(`unexpected command ${key}`);
    });
    const sleep = vi.fn(async () => undefined);
    const deps = depsWithResponses({}, { execFile, sleep, spawnConnectorProcess });

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({
      action: 'connector_start',
      status: 'succeeded',
      sourcePointer: 'native-companion:workbench-session-connector-start',
      auditId: 'audit-connector-ready',
    });
    expect(result.message).toBe('Mac Access connector is running from this Workbench session.');
    expect(spawnConnectorProcess).toHaveBeenCalledWith(
      bundledBridgePath,
      ['serve', '--host', '100.64.0.4', '--port', '8765'],
      expect.objectContaining({
        cwd: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge',
        detached: false,
        stdio: 'ignore',
      })
    );
    expect(spawnConnectorProcess.mock.calls[0]?.[2]?.env).toMatchObject({
      EVAOS_DESKTOP_BRIDGE_MANAGED_BY: 'workbench-session',
      EVAOS_DESKTOP_BRIDGE_RESPONSIBLE_BUNDLE_ID: 'com.evaos.workbench',
    });
    expect(execFile).toHaveBeenCalledTimes(4);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('reconciles control start when current control status is ready after a failed start response', async () => {
    const deps = depsWithResponses({
      'customer-mac control start --json --mode ask-permission --agent-label evaOS Workbench': {
        ok: false,
        errors: [{ code: 'already_active', message: 'transient launchd start failure' }],
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control-current',
        data: {
          active: true,
          ready: true,
          mode: 'ask-permission',
          kill_switch: false,
        },
      },
    });

    const result = await runNativeCompanionAction({ action: 'control_start', mode: 'ask-permission' }, deps);

    expect(result).toMatchObject({
      action: 'control_start',
      status: 'succeeded',
      sourcePointer: 'native-companion:customer-mac-control-start-reconciled',
      auditId: 'audit-control-current',
      control: {
        active: true,
        mode: 'ask-permission',
        killSwitch: false,
      },
    });
    expect(result.message).toContain('already active and ready');
  });

  it('does not reconcile control start as ready when the kill switch is enabled', async () => {
    const deps = depsWithResponses({
      'customer-mac control start --json --mode ask-permission --agent-label evaOS Workbench': {
        ok: false,
        errors: [{ code: 'already_active', message: 'transient launchd start failure' }],
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control-current',
        data: {
          active: true,
          ready: true,
          mode: 'ask-permission',
          kill_switch: true,
        },
      },
    });

    const result = await runNativeCompanionAction({ action: 'control_start', mode: 'ask-permission' }, deps);

    expect(result).toMatchObject({
      action: 'control_start',
      status: 'repair_required',
      sourcePointer: 'native-companion:customer-mac-control-start',
      auditId: 'audit-control-current',
      control: {
        active: true,
        mode: 'ask-permission',
        killSwitch: true,
      },
    });
    expect(result.message).toContain('Agent control could not start');
  });

  it('marks setup check as agent paired only when control status carries explicit proof', async () => {
    const deps = depsWithResponses({
      'connector-service status --json': {
        ok: true,
        running: true,
        health: { reachable: true },
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control',
        data: {
          active: true,
          mode: 'full-access',
          kill_switch: false,
          agent_pairing_status: 'agent_paired',
          agent_pairing_customer_id: 'friendly',
          agent_pairing_proof_scope_id: 'grant-current',
          active_mac_control_scope_id: 'grant-current',
        },
      },
      'audit-tail --json --limit 12': {
        ok: true,
        data: {
          records: [{ audit_id: 'audit-mac' }, { audit_id: 'audit-control' }],
        },
      },
    });

    const result = await runNativeCompanionAction({ action: 'setup_check' }, deps);

    expect(result).toMatchObject({
      action: 'setup_check',
      status: 'succeeded',
      agentPairingStatus: 'agent_paired',
      control: {
        active: true,
        mode: 'full-access',
        killSwitch: false,
      },
    });
  });

  it('marks setup check ready when control-status permission proof supersedes stale customer status', async () => {
    const deps = depsWithResponses({
      'connector-service status --json': {
        ok: true,
        running: true,
        health: { reachable: true },
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac-stale',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'missing' },
          },
        },
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control-current',
        data: {
          ready: true,
          active: false,
          mode: 'ask-permission',
          kill_switch: false,
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'audit-tail --json --limit 12': {
        ok: true,
        data: {
          records: [{ audit_id: 'audit-control-current' }, { audit_id: 'audit-mac-stale' }],
        },
      },
    });

    const result = await runNativeCompanionAction({ action: 'setup_check' }, deps);

    expect(result).toMatchObject({
      action: 'setup_check',
      status: 'succeeded',
      agentPairingStatus: 'ready_for_agent_pairing',
      setup: {
        connectorReady: true,
        macReady: true,
        controlReady: true,
      },
    });
    expect(result.auditIds).toEqual(['audit-mac-stale', 'audit-control-current']);
  });

  it('does not treat local-ready control status as agent pairing proof', async () => {
    const deps = depsWithResponses({
      'connector-service status --json': {
        ok: true,
        running: true,
        health: { reachable: true },
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac',
        data: {
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      },
      'customer-mac control status --json': {
        ok: true,
        audit_id: 'audit-control',
        data: {
          active: true,
          mode: 'full-access',
          kill_switch: false,
          agent_pairing_status: 'local-ready',
        },
      },
      'audit-tail --json --limit 12': {
        ok: true,
        data: {
          records: [{ audit_id: 'audit-mac' }, { audit_id: 'audit-control' }],
        },
      },
    });

    const result = await runNativeCompanionAction({ action: 'setup_check' }, deps);

    expect(result).toMatchObject({
      action: 'setup_check',
      status: 'succeeded',
      agentPairingStatus: 'ready_for_agent_pairing',
    });
  });

  it('keeps setup check local for a selected VM-backed customer', async () => {
    const ensureCustomerMacConnectorGrant = vi.fn(async () => ({
      ok: true,
      customerId: 'golden',
      deviceId: 'device-golden',
      grantId: 'grant-golden',
      grantState: 'active',
      auditId: 'audit-grant',
    }));
    const runConnectorCommand = vi.fn(async () => ({
      ok: true,
      auditId: 'audit-live-connector',
      data: {
        device: {
          hostname: 'Proof-Mac.local',
        },
        permissions: {
          accessibility: { status: 'granted' },
          screen_recording: { status: 'granted' },
        },
      },
    }));
    const deps = depsWithResponses(
      {
        'connector-service status --json': [
          {
            ok: true,
            running: true,
            health: { reachable: true },
            tailnet_ip: '100.64.0.10',
            token_path: '~/Library/Application Support/evaos-desktop-bridge/connector.token',
          },
          {
            ok: true,
            loaded: false,
            running: false,
            health: { reachable: true, host: '100.64.0.10' },
            managed_by: 'workbench-or-manual',
            tailnet_ip: '100.64.0.10',
            token_path: '~/Library/Application Support/evaos-desktop-bridge/connector.token',
          },
        ],
        'ready --json': {
          ok: true,
          ready: true,
          service: 'evaos-desktop-bridge-connector',
          connector_service: {
            health: { reachable: true, ready: true, host_kind: 'tailnet' },
            responsible_bundle_id: 'com.evaos.workbench',
            responsible_app_path: '/Applications/evaOS Workbench.app',
          },
        },
        'connector-service stop --json': {
          ok: true,
          action: 'stop',
        },
        'customer-mac status --json': {
          ok: true,
          audit_id: 'audit-mac',
          data: {
            device: {
              hostname: 'Proof-Mac.local',
            },
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
        'customer-mac control status --json': {
          ok: true,
          audit_id: 'audit-control',
          data: {
            ready: true,
            active: false,
            mode: 'ask-permission',
            kill_switch: false,
          },
        },
        'audit-tail --json --limit 12': {
          ok: true,
          data: {
            records: [{ audit_id: 'audit-mac' }, { audit_id: 'audit-control' }],
          },
        },
      },
      {
        ensureCustomerMacConnectorGrant,
        runConnectorCommand,
        spawnConnectorProcess: vi.fn(() => mockChildProcess()),
        readTextFile: vi.fn((path: string) => {
          expect(path).toMatch(/connector\.token$/);
          return 'secret-token-abcdef1234567890\n';
        }),
      }
    );

    const result = await runNativeCompanionAction({ action: 'setup_check', customerId: 'golden' }, deps);

    expect(result).toMatchObject({
      action: 'setup_check',
      status: 'succeeded',
      sourcePointer: 'native-companion:setup-check',
      agentPairingStatus: 'ready_for_agent_pairing',
      setup: {
        connectorReady: true,
        macReady: true,
        controlReady: true,
      },
    });
    expect(result.message).toContain('Mac Access setup check passed');
    expect(result.pairing).toBeUndefined();
    expect(result.connectorGrant).toBeUndefined();
    expect(result.auditIds).toEqual(['audit-mac', 'audit-control']);
    expect(ensureCustomerMacConnectorGrant).not.toHaveBeenCalled();
    expect(runConnectorCommand).not.toHaveBeenCalled();
    expect(deps.readTextFile).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /PAIR-|customer_mac_complete_pairing|connectorUrl|connectorToken|secret-token|100\.64\.0\.10|8765|token_path/i
    );
  });

  it('does not register a grant when explicit broker connect sees live endpoint missing Mac permissions', async () => {
    const ensureCustomerMacConnectorGrant = vi.fn(async () => ({
      ok: true,
      customerId: 'golden',
      deviceId: 'device-golden',
      grantId: 'grant-golden',
      grantState: 'active',
      auditId: 'audit-grant',
    }));
    const deps = depsWithResponses(
      {
        'connector-service status --json': [
          {
            ok: true,
            running: true,
            health: { reachable: true },
            managed_by: 'launchagent',
            tailnet_ip: '100.64.0.10',
            token_path: '~/Library/Application Support/evaos-desktop-bridge/connector.token',
          },
          {
            ok: true,
            loaded: false,
            running: false,
            health: { reachable: true, host: '100.64.0.10' },
            managed_by: 'workbench-or-manual',
            tailnet_ip: '100.64.0.10',
            token_path: '~/Library/Application Support/evaos-desktop-bridge/connector.token',
          },
        ],
        'connector-service stop --json': {
          ok: true,
          action: 'stop',
        },
        'customer-mac status --json': {
          ok: true,
          audit_id: 'audit-local-mac',
          data: {
            device: {
              hostname: 'Local-CLI-Mac.local',
            },
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
        'customer-mac control status --json': {
          ok: true,
          audit_id: 'audit-control',
          data: {
            ready: true,
            active: true,
            mode: 'ask-permission',
            kill_switch: false,
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
        'audit-tail --json --limit 12': {
          ok: true,
          data: {
            records: [{ audit_id: 'audit-local-mac' }, { audit_id: 'audit-control' }],
          },
        },
      },
      {
        ensureCustomerMacConnectorGrant,
        spawnConnectorProcess: vi.fn(() => mockChildProcess()),
        runConnectorCommand: vi.fn(async () => ({
          ok: true,
          auditId: 'audit-live-connector',
          data: {
            permissions: {
              accessibility: { status: 'missing' },
              screen_recording: { status: 'missing' },
            },
          },
        })),
        readTextFile: vi.fn(() => 'secret-token-abcdef1234567890\n'),
      }
    );

    const result = await runNativeCompanionAction(
      { action: 'ensure_customer_mac_connector_grant', customerId: 'golden' },
      deps
    );

    expect(result).toMatchObject({
      action: 'ensure_customer_mac_connector_grant',
      status: 'repair_required',
      sourcePointer: 'native-companion:connector-grant-live-permission-required',
      auditId: 'audit-live-connector',
    });
    expect(result.message).toContain('live connector endpoint');
    expect(ensureCustomerMacConnectorGrant).not.toHaveBeenCalled();
    expect(deps.spawnConnectorProcess).toHaveBeenCalledTimes(1);
    expect(deps.runConnectorCommand).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(/secret-token|100\.64\.0\.10|8765|token_path/i);
  });

  it('privately resolves a redacted tailnet connector host before explicit first-party grant', async () => {
    const ensureCustomerMacConnectorGrant = vi.fn(async () => ({
      ok: true,
      customerId: 'golden',
      deviceId: 'device-golden',
      grantId: 'grant-golden',
      grantState: 'active',
      auditId: 'audit-grant',
      sourcePointer: 'http://100.64.0.4:8765/register?connector_token=secret-token-abcdef1234567890',
      connectorToken: 'secret-token-abcdef1234567890',
    }));
    const runConnectorCommand = vi.fn(async () => ({
      ok: true,
      auditId: 'audit-live-ready',
      data: {
        device: {
          hostname: 'Proof-Mac.local',
        },
        permissions: {
          accessibility: { status: 'granted' },
          screen_recording: { status: 'granted' },
        },
      },
    }));
    const deps = depsWithResponses(
      {
        'connector-service status --json': {
          ok: true,
          loaded: true,
          running: true,
          health: { authenticated: true, host_kind: 'tailnet', reachable: true, ready: true },
          managed_by: 'launchagent',
          owner: {
            app_path: { kind: 'path', value: '/Applications/evaOS Workbench.app' },
            bundle_id: 'com.evaos.workbench',
            program_path: {
              kind: 'path',
              value: '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge',
            },
          },
          tailnet_available: true,
          token_path: '~/Library/Application Support/evaos-desktop-bridge/connector.token',
          token_present: true,
        },
        'customer-mac control status --json': {
          ok: true,
          audit_id: 'audit-control',
          data: {
            ready: true,
            active: true,
            mode: 'ask-permission',
            kill_switch: false,
          },
        },
        'ready --json': {
          ok: true,
          ready: true,
          service: 'evaos-desktop-bridge-connector',
          connector_service: {
            health: { host_kind: 'tailnet', reachable: true },
            managed_by: 'launchagent',
            owner: {
              app_path: { kind: 'path', value: '/Applications/evaOS Workbench.app' },
              bundle_id: 'com.evaos.workbench',
            },
            ready: true,
            running: true,
          },
        },
        'ip -4': '100.64.0.4\n',
      },
      {
        ensureCustomerMacConnectorGrant,
        runConnectorCommand,
        readTextFile: vi.fn(() => 'secret-token-abcdef1234567890\n'),
      }
    );

    const result = await runNativeCompanionAction(
      { action: 'ensure_customer_mac_connector_grant', customerId: 'golden' },
      deps
    );

    expect(result).toMatchObject({
      action: 'ensure_customer_mac_connector_grant',
      status: 'succeeded',
      sourcePointer: 'native-companion:connector-grant-ready',
      connectorGrant: {
        customerId: 'golden',
        grantId: 'grant-golden',
      },
    });
    expect(runConnectorCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorUrl: 'http://100.64.0.4:8765',
        connectorToken: 'secret-token-abcdef1234567890',
        command: 'customerMacStatus',
      })
    );
    expect(ensureCustomerMacConnectorGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'golden',
        connectorUrl: 'http://100.64.0.4:8765',
      })
    );
    expect(JSON.stringify(result)).not.toMatch(/secret-token|connector_token|100\.64\.0\.4|8765|token_path/i);
  });

  it.each([
    ['LaunchAgent-managed', 'launchagent'],
    ['untracked Workbench/manual', 'workbench-or-manual'],
  ])(
    'restarts a stale %s connector before explicit first-party grant when local permission proof is green',
    async (_label, staleManagedBy) => {
      const ensureCustomerMacConnectorGrant = vi.fn(async () => ({
        ok: true,
        customerId: 'golden',
        deviceId: 'device-golden',
        grantId: 'grant-golden',
        grantState: 'active',
        auditId: 'audit-grant',
        sourcePointer: 'http://100.64.0.10:8765/register?connector_token=secret-token-abcdef1234567890',
        connectorToken: 'secret-token-abcdef1234567890',
      }));
      const runConnectorCommand = vi.fn().mockResolvedValueOnce({
        ok: true,
        auditId: 'audit-live-ready',
        data: {
          device: {
            hostname: 'Proof-Mac.local',
          },
          permissions: {
            accessibility: { status: 'granted' },
            screen_recording: { status: 'granted' },
          },
        },
      });
      const deps = depsWithResponses(
        {
          'connector-service status --json': [
            {
              ok: true,
              loaded: staleManagedBy === 'launchagent',
              running: staleManagedBy === 'launchagent',
              health: { reachable: true, host: '100.64.0.10' },
              managed_by: staleManagedBy,
              tailnet_ip: '100.64.0.10',
              token_path: '~/Library/Application Support/evaos-desktop-bridge/connector.token',
            },
            {
              ok: true,
              loaded: false,
              running: false,
              health: { reachable: true, host: '100.64.0.10' },
              managed_by: 'workbench-or-manual',
              tailnet_ip: '100.64.0.10',
              token_path: '~/Library/Application Support/evaos-desktop-bridge/connector.token',
            },
          ],
          'connector-service stop --json': {
            ok: true,
            action: 'stop',
          },
          'customer-mac status --json': {
            ok: true,
            audit_id: 'audit-local-mac',
            data: {
              device: {
                hostname: 'Proof-Mac.local',
              },
              permissions: {
                accessibility: { status: 'granted' },
                screen_recording: { status: 'granted' },
              },
            },
          },
          'customer-mac control status --json': {
            ok: true,
            audit_id: 'audit-control',
            data: {
              ready: true,
              active: true,
              mode: 'ask-permission',
              kill_switch: false,
            },
          },
          'audit-tail --json --limit 12': {
            ok: true,
            data: {
              records: [{ audit_id: 'audit-local-mac' }, { audit_id: 'audit-control' }],
            },
          },
        },
        {
          ensureCustomerMacConnectorGrant,
          runConnectorCommand,
          readTextFile: vi.fn(() => 'secret-token-abcdef1234567890\n'),
          spawnConnectorProcess: vi.fn(() => mockChildProcess()),
        }
      );

      const result = await runNativeCompanionAction(
        { action: 'ensure_customer_mac_connector_grant', customerId: 'golden' },
        deps
      );

      expect(result).toMatchObject({
        action: 'ensure_customer_mac_connector_grant',
        status: 'succeeded',
        sourcePointer: 'native-companion:connector-grant-ready',
        connectorGrant: {
          customerId: 'golden',
          grantId: 'grant-golden',
        },
      });
      expect(result.connectorGrant).not.toHaveProperty('sourcePointer');
      expect(result.connectorGrant).not.toHaveProperty('connectorToken');
      expect(JSON.stringify(result)).not.toMatch(/secret-token|connector_token|100\.64\.0\.10|8765/i);
      expect(deps.spawnConnectorProcess).toHaveBeenCalledWith(
        bundledBridgePath,
        ['serve', '--host', '100.64.0.10', '--port', '8765'],
        expect.objectContaining({
          env: expect.objectContaining({
            EVAOS_DESKTOP_BRIDGE_MANAGED_BY: 'workbench-session',
            EVAOS_DESKTOP_BRIDGE_RESPONSIBLE_BUNDLE_ID: 'com.evaos.workbench',
          }),
        })
      );
      expect(runConnectorCommand).toHaveBeenCalledTimes(1);
      expect(ensureCustomerMacConnectorGrant).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'golden',
          deviceIdentifier: 'Proof-Mac.local',
          permissionState: {
            accessibility: 'granted',
            screen_recording: 'granted',
          },
        })
      );
      expect(JSON.stringify(result)).not.toMatch(/secret-token|100\.64\.0\.10|8765|token_path/i);
    }
  );

  it('creates a renderer-safe pairing prompt without exposing connector private material', async () => {
    const deps = depsWithResponses(
      {
        'connector-service status --json': {
          ok: true,
          running: true,
          health: { reachable: true },
          tailnet_ip: '100.64.0.10',
          token_path: '~/Library/Application Support/evaos-desktop-bridge/connector.token',
        },
        'customer-mac status --json': {
          ok: true,
          audit_id: 'audit-mac',
          data: {
            device: {
              hostname: 'Proof-Mac.local',
            },
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
        [`connector-service complete-enrollment --json --enrollment-code PAIR-1234 --customer-id golden --device-name ${deviceName} --device-identifier Proof-Mac.local`]:
          {
            ok: true,
            audit_id: 'audit-pairing',
            data: {
              action: 'complete-enrollment',
              connector_registered: true,
              customer_id: 'golden',
              device_id: 'device-golden',
              grant_id: 'grant-golden',
              connector_token_last4: '7890',
              raw_secrets_returned: false,
            },
          },
      },
      {
        createCustomerMacEnrollment: vi.fn(async () => ({
          customerId: 'golden',
          pairingCode: 'PAIR-1234',
          expiresAt: '2026-06-07T04:00:00.000Z',
        })),
      }
    );

    const result = await runNativeCompanionAction({ action: 'create_pairing_prompt', customerId: 'golden' }, deps);

    expect(result.status).toBe('succeeded');
    expect(result.agentPairingStatus).toBe('pairing_prompt_created');
    expect(result.pairing).toMatchObject({
      customerId: 'golden',
      pairingCode: 'PAIR-1234',
    });
    expect(result.pairing?.setupPrompt).toContain('customer_mac_complete_pairing');
    expect(result.pairing?.setupPrompt).not.toMatch(
      /connector[_\s-]?url|connector[_\s-]?token|100\.64\.0\.10|8765|Bearer|secret-token|access_token|refresh_token|ssh|vnc|cdp|browser\s+debug/i
    );
    expect(JSON.stringify(result)).not.toMatch(
      /Bearer|desktop_session|provider_grant|access_token|refresh_token|connectorUrl|secret-token/i
    );
    const execFile = deps.execFile as ReturnType<typeof vi.fn>;
    const completeCall = execFile.mock.calls.find(
      (call) => call[1][0] === 'connector-service' && call[1][1] === 'complete-enrollment'
    );
    expect(completeCall?.[1].join(' ')).toBe(
      `connector-service complete-enrollment --json --enrollment-code PAIR-1234 --customer-id golden --device-name ${deviceName} --device-identifier Proof-Mac.local`
    );
    expect(completeCall?.[2]).toEqual({ timeout: 30000 });
  });

  it('creates a pairing prompt when control-status permission proof supersedes stale customer status', async () => {
    const deps = depsWithResponses(
      {
        'connector-service status --json': {
          ok: true,
          running: true,
          health: { reachable: true },
          tailnet_ip: '100.64.0.10',
          token_path: '~/Library/Application Support/evaos-desktop-bridge/connector.token',
        },
        'customer-mac status --json': {
          ok: true,
          audit_id: 'audit-mac-stale',
          data: {
            device: {
              hostname: 'Proof-Mac.local',
            },
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'missing' },
            },
          },
        },
        'customer-mac control status --json': {
          ok: true,
          audit_id: 'audit-control-current',
          data: {
            ready: true,
            active: false,
            mode: 'ask-permission',
            kill_switch: false,
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
        [`connector-service complete-enrollment --json --enrollment-code PAIR-1234 --customer-id golden --device-name ${deviceName} --device-identifier Proof-Mac.local`]:
          {
            ok: true,
            audit_id: 'audit-pairing',
            data: {
              action: 'complete-enrollment',
              connector_registered: true,
              customer_id: 'golden',
              device_id: 'device-golden',
              grant_id: 'grant-golden',
              connector_token_last4: '7890',
              raw_secrets_returned: false,
            },
          },
      },
      {
        createCustomerMacEnrollment: vi.fn(async () => ({
          customerId: 'golden',
          pairingCode: 'PAIR-1234',
          expiresAt: '2026-06-07T04:00:00.000Z',
        })),
      }
    );

    const result = await runNativeCompanionAction({ action: 'create_pairing_prompt', customerId: 'golden' }, deps);

    expect(result).toMatchObject({
      action: 'create_pairing_prompt',
      status: 'succeeded',
      sourcePointer: 'native-companion:pairing-prompt',
      agentPairingStatus: 'pairing_prompt_created',
      pairing: {
        customerId: 'golden',
        pairingCode: 'PAIR-1234',
      },
    });
    expect(result.pairing?.setupPrompt).toContain('customer_mac_complete_pairing');
    expect(result.pairing?.setupPrompt).not.toMatch(
      /connector[_\s-]?url|connector[_\s-]?token|100\.64\.0\.10|8765|Bearer|secret-token|access_token|refresh_token|ssh|vnc|cdp|browser\s+debug/i
    );
  });

  it('rejects account-row customer ids before creating a pairing enrollment', async () => {
    const createCustomerMacEnrollment = vi.fn(async () => ({
      customerId: 'admin@100yen.org',
      pairingCode: 'PAIR-1234',
      expiresAt: '2026-06-07T04:00:00.000Z',
    }));
    const deps = depsWithResponses({}, { createCustomerMacEnrollment });

    const result = await runNativeCompanionAction(
      { action: 'create_pairing_prompt', customerId: 'admin@100yen.org' },
      deps
    );

    expect(result).toMatchObject({
      action: 'create_pairing_prompt',
      status: 'repair_required',
      sourcePointer: 'native-companion:pairing-invalid-customer',
      agentPairingStatus: 'ready_for_agent_pairing',
    });
    expect(result.message).toContain('VM-backed Mac-control customer');
    expect(createCustomerMacEnrollment).not.toHaveBeenCalled();
    expect(deps.execFile).not.toHaveBeenCalled();
  });

  it('blocks pairing prompts when the packaged app fell back to a diagnostic Homebrew bridge', async () => {
    const createCustomerMacEnrollment = vi.fn(async () => ({
      customerId: 'golden',
      pairingCode: 'PAIR-1234',
      expiresAt: '2026-06-07T04:00:00.000Z',
    }));
    const deps = depsWithResponses(
      {},
      {
        bridgePaths: ['/opt/homebrew/bin/evaos-desktop-bridge'],
        existsSync: vi.fn((path: string) => path === '/opt/homebrew/bin/evaos-desktop-bridge'),
        createCustomerMacEnrollment,
      }
    );

    const result = await runNativeCompanionAction({ action: 'create_pairing_prompt', customerId: 'golden' }, deps);

    expect(result).toMatchObject({
      action: 'create_pairing_prompt',
      status: 'repair_required',
      sourcePointer: 'native-companion:pairing-bundled-bridge-required',
      agentPairingStatus: 'ready_for_agent_pairing',
    });
    expect(result.message).toContain('bundled Mac connector');
    expect(result.pairing).toBeUndefined();
    expect(createCustomerMacEnrollment).not.toHaveBeenCalled();
    expect(deps.execFile).not.toHaveBeenCalled();
  });

  it('does not expose a dead pairing prompt when local connector registration fails', async () => {
    const deps = depsWithResponses(
      {
        'connector-service status --json': {
          ok: true,
          running: true,
          health: { reachable: true },
          tailnet_ip: '100.64.0.10',
          token_path: '~/Library/Application Support/evaos-desktop-bridge/connector.token',
        },
        'customer-mac status --json': {
          ok: true,
          audit_id: 'audit-mac',
          data: {
            device: {
              hostname: 'Proof-Mac.local',
            },
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
        [`connector-service complete-enrollment --json --enrollment-code PAIR-1234 --customer-id golden --device-name ${deviceName} --device-identifier Proof-Mac.local`]:
          {
            ok: false,
            errors: [
              {
                code: 'broker_complete_enrollment_failed',
                message:
                  'connector_url=http://100.64.0.10:8765 token=secret-token Bearer live-secret access_token=abc api_key=raw password=hunter2 client_secret=client service_role=role grant_handle=grant credential=cred',
              },
            ],
          },
      },
      {
        createCustomerMacEnrollment: vi.fn(async () => ({
          customerId: 'golden',
          pairingCode: 'PAIR-1234',
          expiresAt: '2026-06-07T04:00:00.000Z',
        })),
      }
    );

    const result = await runNativeCompanionAction({ action: 'create_pairing_prompt', customerId: 'golden' }, deps);

    expect(result).toMatchObject({
      action: 'create_pairing_prompt',
      status: 'repair_required',
      sourcePointer: 'native-companion:pairing-registration-failed',
      agentPairingStatus: 'ready_for_agent_pairing',
    });
    expect(result.pairing).toBeUndefined();
    expect(result.message).toContain('Bridge error broker_complete_enrollment_failed');
    expect(result.message).not.toMatch(
      /100\.64\.0\.10|8765|secret-token|live-secret|access_token|api_key|password|hunter2|client_secret|service_role|grant_handle|credential|Bearer/i
    );
  });

  it('redacts bridge enrollment error bodies before surfacing local connector registration failures', async () => {
    const deps = depsWithResponses(
      {
        'connector-service status --json': {
          ok: true,
          running: true,
          health: { reachable: true },
          tailnet_ip: '100.64.0.10',
          token_path: '~/Library/Application Support/evaos-desktop-bridge/connector.token',
        },
        'customer-mac status --json': {
          ok: true,
          audit_id: 'audit-mac',
          data: {
            device: {
              hostname: 'Proof-Mac.local',
            },
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
        [`connector-service complete-enrollment --json --enrollment-code PAIR-1234 --customer-id golden --device-name ${deviceName} --device-identifier Proof-Mac.local`]:
          {
            ok: false,
            error: {
              code: 'broker_complete_enrollment_failed',
              message:
                'connector_url=http://100.64.0.10:8765 connector_token=secret-token Bearer live-secret access_token=abc api_key=raw password=hunter2 client_secret=client service_role=role grant_handle=grant credential=cred',
            },
          },
      },
      {
        createCustomerMacEnrollment: vi.fn(async () => ({
          customerId: 'golden',
          pairingCode: 'PAIR-1234',
          expiresAt: '2026-06-07T04:00:00.000Z',
        })),
      }
    );

    const result = await runNativeCompanionAction({ action: 'create_pairing_prompt', customerId: 'golden' }, deps);

    expect(result).toMatchObject({
      action: 'create_pairing_prompt',
      status: 'repair_required',
      sourcePointer: 'native-companion:pairing-registration-failed',
      agentPairingStatus: 'ready_for_agent_pairing',
    });
    expect(result.pairing).toBeUndefined();
    expect(result.message).toContain('Bridge error broker_complete_enrollment_failed');
    expect(result.message).not.toMatch(
      /100\.64\.0\.10|8765|secret-token|live-secret|access_token|api_key|password|hunter2|client_secret|service_role|grant_handle|credential|Bearer|connector_url|connector_token/i
    );
  });

  it('maps broker 401 enrollment denial to reconnect without completing enrollment', async () => {
    const deps = depsWithResponses(
      {
        'connector-service status --json': {
          ok: true,
          running: true,
          health: { reachable: true },
          tailnet_ip: '100.64.0.10',
        },
        'customer-mac status --json': {
          ok: true,
          audit_id: 'audit-mac',
          data: {
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
      },
      {
        createCustomerMacEnrollment: vi.fn(async () => {
          throw new EvaosBrokerSessionError(
            'broker_http_error',
            'The evaOS broker denied this desktop session. Sign in again.',
            401
          );
        }),
      }
    );

    const result = await runNativeCompanionAction({ action: 'create_pairing_prompt', customerId: 'golden' }, deps);

    expect(result).toMatchObject({
      action: 'create_pairing_prompt',
      status: 'repair_required',
      sourcePointer: 'native-companion:pairing-broker-session-required',
      agentPairingStatus: 'ready_for_agent_pairing',
    });
    expect(result.message).toContain('Sign in again');
    expect(result.pairing).toBeUndefined();
    const execFile = deps.execFile as ReturnType<typeof vi.fn>;
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(execFile.mock.calls[0]?.[1]).toEqual(['connector-service', 'status', '--json']);
    expect(execFile.mock.calls[1]?.[1]).toEqual(['customer-mac', 'status', '--json']);
  });

  it('surfaces broker 403 enrollment denial without reconnect copy', async () => {
    const deps = depsWithResponses(
      {
        'connector-service status --json': {
          ok: true,
          running: true,
          health: { reachable: true },
          tailnet_ip: '100.64.0.10',
        },
        'customer-mac status --json': {
          ok: true,
          audit_id: 'audit-mac',
          data: {
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
      },
      {
        createCustomerMacEnrollment: vi.fn(async () => {
          throw new EvaosBrokerSessionError('broker_http_error', 'manage_integrations permission required', 403);
        }),
      }
    );

    await expect(
      runNativeCompanionAction({ action: 'create_pairing_prompt', customerId: 'golden' }, deps)
    ).rejects.toMatchObject({
      code: 'broker_http_error',
      status: 403,
      message: 'manage_integrations permission required',
    });
  });

  it('does not create a pairing enrollment until Mac permissions are granted', async () => {
    const createCustomerMacEnrollment = vi.fn(async () => ({
      customerId: 'golden',
      pairingCode: 'PAIR-1234',
      expiresAt: '2026-06-07T04:00:00.000Z',
    }));
    const deps = depsWithResponses(
      {
        'connector-service status --json': {
          ok: true,
          running: true,
          health: { reachable: true },
          tailnet_ip: '100.64.0.10',
        },
        'customer-mac status --json': {
          ok: true,
          audit_id: 'audit-mac-permission',
          data: {
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'missing' },
            },
          },
        },
      },
      { createCustomerMacEnrollment }
    );

    const result = await runNativeCompanionAction({ action: 'create_pairing_prompt', customerId: 'golden' }, deps);

    expect(result).toMatchObject({
      action: 'create_pairing_prompt',
      status: 'repair_required',
      sourcePointer: 'native-companion:pairing-mac-permission-required',
      auditId: 'audit-mac-permission',
    });
    expect(createCustomerMacEnrollment).not.toHaveBeenCalled();
  });

  it('blocks pairing enrollment when local registration has no secure connector host', async () => {
    const createCustomerMacEnrollment = vi.fn(async () => ({
      customerId: 'golden',
      pairingCode: 'PAIR-1234',
      expiresAt: '2026-06-07T04:00:00.000Z',
    }));
    const deps = depsWithResponses(
      {
        'connector-service status --json': {
          ok: true,
          running: true,
          health: {
            reachable: true,
            host: 'localhost',
          },
        },
      },
      { createCustomerMacEnrollment }
    );

    const result = await runNativeCompanionAction({ action: 'create_pairing_prompt', customerId: 'golden' }, deps);

    expect(result).toMatchObject({
      action: 'create_pairing_prompt',
      status: 'repair_required',
      sourcePointer: 'native-companion:pairing-secure-network-required',
      agentPairingStatus: 'ready_for_agent_pairing',
    });
    expect(result.message).toContain('private connector link');
    expect(result.pairing).toBeUndefined();
    expect(createCustomerMacEnrollment).not.toHaveBeenCalled();
    expect(deps.execFile).toHaveBeenCalledTimes(1);
  });

  it('opens only the released Workbench fallback path', async () => {
    const openPath = vi.fn(async () => '');
    const deps = depsWithResponses(
      {},
      {
        existsSync: vi.fn((path: string) => path === '/Applications/evaOS Workbench.app'),
        openPath,
      }
    );

    const result = await openReleasedEvaosWorkbench(deps);

    expect(result).toEqual({
      opened: true,
      path: '/Applications/evaOS Workbench.app',
      message: 'Opened released evaOS Workbench for native pairing and repair.',
    });
    expect(openPath).toHaveBeenCalledWith('/Applications/evaOS Workbench.app');
  });

  it('opens new-app macOS repair targets without launching the released Workbench', async () => {
    const openPath = vi.fn(async () => '');
    const openExternal = vi.fn(async () => undefined);
    const deps = depsWithResponses(
      {},
      {
        openPath,
        openExternal,
      }
    );

    const accessibility = await openNativeCompanionRepairAction({ action: 'accessibility' }, deps);
    const screenRecording = await openNativeCompanionRepairAction({ action: 'screen_recording' }, deps);

    expect(accessibility).toMatchObject({
      opened: true,
      target: 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility',
    });
    expect(screenRecording).toMatchObject({
      opened: true,
      target: 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture',
    });
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(openPath).not.toHaveBeenCalled();
  });
});
