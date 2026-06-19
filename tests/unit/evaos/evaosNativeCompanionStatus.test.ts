/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { hostname } from 'node:os';
import {
  getEvaosNativeCompanionStatus,
  openNativeCompanionRepairAction,
  openReleasedEvaosWorkbench,
  runNativeCompanionAction,
  type EvaosNativeCompanionStatusDeps,
} from '@/process/services/evaosNativeCompanionStatus';
import { EvaosBrokerSessionError } from '@/process/services/evaosBrokerSession';

const json = (payload: unknown) => JSON.stringify(payload);
const deviceName = hostname() || 'Customer Mac';

function depsWithResponses(
  responses: Record<string, unknown>,
  overrides: Partial<EvaosNativeCompanionStatusDeps> = {}
): EvaosNativeCompanionStatusDeps {
  return {
    now: () => new Date('2026-06-07T03:45:00.000Z'),
    bridgePaths: ['/opt/homebrew/bin/evaos-desktop-bridge'],
    releasedWorkbenchPath: '/Applications/evaOS.app',
    existsSync: vi.fn(
      (path: string) => path === '/opt/homebrew/bin/evaos-desktop-bridge' || path === '/Applications/evaOS.app'
    ),
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

  it('creates a renderer-safe pairing prompt without exposing connector private material', async () => {
    const deps = depsWithResponses(
      {
        'connector-service status --json': {
          ok: true,
          running: true,
          health: { reachable: true },
          tailnet_ip: '100.64.0.10',
        },
        [`connector-service complete-enrollment --json --enrollment-code PAIR-1234 --customer-id golden --device-name ${deviceName}`]:
          {
            ok: true,
            audit_id: 'audit-pairing',
            connector_registered: true,
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
      /connector_url|100\.64\.0\.10|8765|Bearer|secret-token|access_token|refresh_token/i
    );
    expect(JSON.stringify(result)).not.toMatch(
      /Bearer|desktop_session|provider_grant|access_token|refresh_token|connectorUrl|secret-token/i
    );
  });

  it.each([401, 403])(
    'maps broker %s enrollment denial to reconnect without completing enrollment',
    async (statusCode) => {
      const deps = depsWithResponses(
        {
          'connector-service status --json': {
            ok: true,
            running: true,
            health: { reachable: true },
            tailnet_ip: '100.64.0.10',
          },
        },
        {
          createCustomerMacEnrollment: vi.fn(async () => {
            throw new EvaosBrokerSessionError(
              'broker_http_error',
              'The evaOS broker denied this desktop session. Sign in again.',
              statusCode
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
      expect(deps.execFile).toHaveBeenCalledTimes(1);
      expect(vi.mocked(deps.execFile).mock.calls[0]?.[1]).toEqual(['connector-service', 'status', '--json']);
    }
  );

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
      target: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    });
    expect(screenRecording).toMatchObject({
      opened: true,
      target: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    });
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(openPath).not.toHaveBeenCalled();
  });
});
