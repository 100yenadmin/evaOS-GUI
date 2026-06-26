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
    releasedWorkbenchPath: '/Applications/evaOS.app',
    existsSync: vi.fn((path: string) => path === bundledBridgePath || path === '/Applications/evaOS.app'),
    execFile: vi.fn(async (_file, args) => {
      const key = args.join(' ');
      const payload = responses[key];
      if (!payload) {
        throw new Error(`unexpected command ${key}`);
      }
      return { stdout: json(payload), stderr: '' };
    }),
    openPath: vi.fn(async () => ''),
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
    expect(JSON.stringify(status)).not.toMatch(/Bearer|desktop_session|provider_grant|access_token|refresh_token/i);
  });

  it('does not enable native state fixtures without the E2E local product gate', async () => {
    const deps = depsWithResponses(
      {},
      {
        env: {
          AIONUI_E2E_TEST: '1',
          AIONUI_EVAOS_NATIVE_COMPANION_STATUS_FIXTURE: 'ready',
        } as NodeJS.ProcessEnv,
        existsSync: vi.fn((path: string) => path === '/Applications/evaOS.app'),
      }
    );

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status.sourcePointer).toBe('native-companion:bridge-cli-missing');
    expect(status.bridgeCli.installed).toBe(false);
  });

  it('summarizes read-only bridge status without renderer-visible secrets', async () => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        audit_id: 'audit-bridge',
        data: {
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
        permission_target: 'evaOS Workbench',
      },
      'customer-mac status --json': {
        ok: true,
        audit_id: 'audit-mac',
        data: {
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
    });

    const status = await getEvaosNativeCompanionStatus(deps);

    expect(status).toMatchObject({
      schemaVersion: 'evaos.native_companion_status.v1',
      readiness: 'ready',
      agentPairingStatus: 'ready_for_agent_pairing',
      generatedAt: '2026-06-07T03:45:00.000Z',
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
        tailnetIp: '100.64.0.10',
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
    expect(JSON.stringify(status)).not.toMatch(/Bearer|token|secret|hardware_uuid|mac-3bf1c1b451434bcf/i);
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
        tailnetIp: '100.64.0.4',
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
            candidate === bundledBridge || candidate === homebrewBridge || candidate === '/Applications/evaOS.app'
        ),
      }
    );

    const status = await getEvaosNativeCompanionStatus(deps);

    const execFile = deps.execFile as ReturnType<typeof vi.fn>;
    expect(status.bridgeCli.path).toBe(bundledBridge);
    expect(status.bridgeCli.version).toBe('0.6.29');
    expect(execFile.mock.calls.every(([file]) => file === bundledBridge)).toBe(true);
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
        existsSync: vi.fn((path: string) => path === '/Applications/evaOS.app'),
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
    expect(result.message).toContain('Mac control setup check passed');
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
            running: true,
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
            running: true,
            managed_by: statusCalls > 1 ? 'workbench-or-manual' : 'launchagent',
            tailnet_ip: '100.64.0.4',
            health: { reachable: statusCalls > 1, host: '100.64.0.4' },
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
    expect(execFile).toHaveBeenCalledTimes(3);
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

  it('auto-ensures a first-party connector grant during setup check for a selected VM-backed customer', async () => {
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
      sourcePointer: 'native-companion:connector-grant-ready',
      agentPairingStatus: 'ready_for_agent_pairing',
      connectorGrant: {
        customerId: 'golden',
        deviceId: 'device-golden',
        grantId: 'grant-golden',
        grantState: 'active',
        auditId: 'audit-grant',
      },
    });
    expect(result.pairing).toBeUndefined();
    expect(result.auditIds).toEqual(['audit-grant', 'audit-live-connector', 'audit-mac', 'audit-control']);
    expect(ensureCustomerMacConnectorGrant).toHaveBeenCalledWith({
      customerId: 'golden',
      deviceName,
      deviceIdentifier: 'Proof-Mac.local',
      connectorUrl: 'http://100.64.0.10:8765',
      connectorToken: 'secret-token-abcdef1234567890',
      permissionState: {
        accessibility: 'granted',
        screen_recording: 'granted',
      },
      screenSharingOptIn: false,
    });
    expect(runConnectorCommand).toHaveBeenCalledWith({
      connectorUrl: 'http://100.64.0.10:8765',
      connectorToken: 'secret-token-abcdef1234567890',
      command: 'customerMacStatus',
      params: {},
    });
    expect(JSON.stringify(result)).not.toMatch(
      /PAIR-|customer_mac_complete_pairing|connectorUrl|connectorToken|secret-token|100\.64\.0\.10|8765|token_path/i
    );
  });

  it('does not register a grant when the live connector endpoint lacks Mac permissions', async () => {
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
        'connector-service status --json': {
          ok: true,
          running: true,
          health: { reachable: true },
          tailnet_ip: '100.64.0.10',
          token_path: '~/Library/Application Support/evaos-desktop-bridge/connector.token',
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

    const result = await runNativeCompanionAction({ action: 'setup_check', customerId: 'golden' }, deps);

    expect(result).toMatchObject({
      action: 'setup_check',
      status: 'repair_required',
      sourcePointer: 'native-companion:connector-grant-live-permission-required',
      auditId: 'audit-live-connector',
    });
    expect(result.message).toContain('live connector endpoint');
    expect(ensureCustomerMacConnectorGrant).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/secret-token|100\.64\.0\.10|8765|token_path/i);
  });

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
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
        [`connector-service complete-enrollment --json --enrollment-code PAIR-1234 --customer-id golden --device-name ${deviceName}`]:
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
      `connector-service complete-enrollment --json --enrollment-code PAIR-1234 --customer-id golden --device-name ${deviceName}`
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
        [`connector-service complete-enrollment --json --enrollment-code PAIR-1234 --customer-id golden --device-name ${deviceName}`]:
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
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
        [`connector-service complete-enrollment --json --enrollment-code PAIR-1234 --customer-id golden --device-name ${deviceName}`]:
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
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
        [`connector-service complete-enrollment --json --enrollment-code PAIR-1234 --customer-id golden --device-name ${deviceName}`]:
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
        existsSync: vi.fn((path: string) => path === '/Applications/evaOS.app'),
        openPath,
      }
    );

    const result = await openReleasedEvaosWorkbench(deps);

    expect(result).toEqual({
      opened: true,
      path: '/Applications/evaOS.app',
      message: 'Opened released evaOS Workbench for native pairing and repair.',
    });
    expect(openPath).toHaveBeenCalledWith('/Applications/evaOS.app');
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
