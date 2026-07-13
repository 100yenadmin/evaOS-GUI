/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import {
  getEvaosWorkbenchDiagnosticPacket,
  clearPrivateNetworkBootstrapGrantsForTest,
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
    sleep: vi.fn(async () => undefined),
    probeConnectorReady: vi.fn(async () => true),
    ...overrides,
  };
}

function depsWithTypedReadyResponses(
  responses: Record<string, unknown>,
  overrides: Partial<EvaosNativeCompanionStatusDeps> = {}
): EvaosNativeCompanionStatusDeps {
  const bridge = responses['status --json'] as { data?: Record<string, unknown> } | undefined;
  const connectorResponse = responses['connector-service status --json'];
  const customerMac = responses['customer-mac status --json'] as { data?: Record<string, unknown> } | undefined;
  if (!bridge || !connectorResponse || !customerMac) {
    throw new Error(
      "depsWithTypedReadyResponses requires 'status --json', 'connector-service status --json', and 'customer-mac status --json' responses"
    );
  }
  bridge.data ??= {};
  bridge.data.bridge_runtime ??= {
    schema: 'evaos.desktop_bridge.workbench_runtime.v1',
    contract_version: 1,
    version: '0.1.1',
    version_compatible: true,
    compatible: true,
  };

  const connectorResponses = Array.isArray(connectorResponse)
    ? (connectorResponse as Array<Record<string, unknown>>)
    : [connectorResponse as Record<string, unknown>];
  for (const connector of connectorResponses) {
    const connectorData =
      connector.data && typeof connector.data === 'object' ? (connector.data as Record<string, unknown>) : connector;
    connectorData.private_network ??= {
      client_installed: true,
      client_running: true,
      enrolled: true,
      correct_control_plane: true,
      acl_allowed: true,
      online: true,
    };
  }

  customerMac.data ??= {};
  const device =
    customerMac.data.device && typeof customerMac.data.device === 'object'
      ? (customerMac.data.device as Record<string, unknown>)
      : {};
  device.hardware_uuid ??= typeof device.hostname === 'string' ? device.hostname : 'typed-ready-device';
  customerMac.data.device = device;
  customerMac.data.control_engines ??= {
    cua_driver: { available: true, active_for_actions: true },
    active_primary: 'cua_driver',
  };

  responses['customer-mac control status --json'] ??= {
    ok: true,
    data: { active: false, kill_switch: false, active_mac_control_scope_id: 'grant-typed-ready' },
  };
  const controlResponse = responses['customer-mac control status --json'];
  let authorityGrantId = 'grant-typed-ready';
  if (controlResponse) {
    const controlResponses = Array.isArray(controlResponse)
      ? (controlResponse as Array<Record<string, unknown>>)
      : [controlResponse as Record<string, unknown>];
    for (const control of controlResponses) {
      control.data ??= {};
      const controlData = control.data as Record<string, unknown>;
      if (typeof controlData.active_mac_control_scope_id === 'string') {
        authorityGrantId = controlData.active_mac_control_scope_id;
      } else {
        controlData.active_mac_control_scope_id = authorityGrantId;
      }
    }
  }

  return depsWithResponses(responses, {
    getPrivateNetworkReadiness: async ({ customerId, deviceIdentifier }) => ({
      customerId,
      deviceId: 'typed-ready-device-id',
      deviceIdentifier,
      enrollmentId: 'typed-ready-enrollment',
      grantId: authorityGrantId,
      correctControlPlane: true,
      aclAllowed: true,
      online: true,
      reason: 'ready',
      observedAt: '2026-06-07T03:45:00.000Z',
      expiresAt: '2026-06-07T03:45:45.000Z',
      auditId: 'audit-typed-ready',
    }),
    ...overrides,
  });
}

describe('evaosNativeCompanionStatus', () => {
  afterEach(() => {
    vi.useRealTimers();
    stopEvaosNativeCompanionSessionConnector();
    clearPrivateNetworkBootstrapGrantsForTest();
  });

  it('reports missing canonical fixtures clearly when typed-ready test responses are incomplete', () => {
    expect(() => depsWithTypedReadyResponses({})).toThrow(/requires 'status --json'.*connector-service.*customer-mac/);
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

  it('restricts bridge lookup to bundled paths when packaging detection is unavailable', async () => {
    const existsSync = vi.fn(() => false);

    await getEvaosNativeCompanionStatus({
      env: { EVAOS_DESKTOP_BRIDGE_PATH: '/tmp/untrusted/evaos-desktop-bridge' } as NodeJS.ProcessEnv,
      existsSync,
      detectIsPackaged: () => {
        throw new Error('packaging state unavailable');
      },
    });

    expect(existsSync).not.toHaveBeenCalledWith('/tmp/untrusted/evaos-desktop-bridge');
    expect(existsSync).not.toHaveBeenCalledWith('/opt/homebrew/bin/evaos-desktop-bridge');
    expect(existsSync).not.toHaveBeenCalledWith('/usr/local/bin/evaos-desktop-bridge');
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

  it('requires local online proof even when fresh broker authority is ready', async () => {
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
          device: { hardware_uuid: 'david-mac-hardware-id' },
          permissions: { accessibility: { status: 'granted' }, screen_recording: { status: 'granted' } },
          control_engines: { peekaboo: { available: true }, active_primary: 'peekaboo' },
        },
      },
      'customer-mac iphone-mirroring status --json': { ok: true, data: { installed: true, running: false } },
      'customer-mac control status --json': { ok: true, data: { active: false, kill_switch: false } },
      'audit-tail --json --limit 5': { ok: true, data: { records: [] } },
      'ready --json': { ok: true, data: { ready: true } },
    });

    deps.getPrivateNetworkReadiness = vi.fn(async () => ({
      customerId: 'jackie-david',
      deviceId: 'device-david',
      deviceIdentifier: 'david-mac-hardware-id',
      enrollmentId: 'network-enrollment-1',
      grantId: 'grant-david',
      correctControlPlane: true,
      aclAllowed: true,
      online: true,
      reason: 'ready',
      observedAt: '2026-06-07T03:45:00.000Z',
      expiresAt: '2026-06-07T03:45:45.000Z',
      auditId: 'audit-network-ready',
    }));

    const status = await getEvaosNativeCompanionStatus(deps, { customerId: 'jackie-david' });

    expect(status).toMatchObject({
      readiness: 'repair_required',
      pairingCapable: false,
      pairingBlockedReason: 'secure_network_link_required',
      blockerReason: 'secure_network_link_required',
      prerequisites: {
        bridgeRuntime: 'ready',
        privateNetwork: 'error',
        actionEngine: 'peekaboo_ready',
      },
    });
  });

  it.each([
    ['missing', { ok: false, errors: [{ code: 'control_status_unavailable' }] }],
    ['scope-less', { ok: true, data: { active: false, kill_switch: false } }],
  ])('does not merge ready broker authority when local control status is %s', async (_case, controlStatus) => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        data: {
          bridge_runtime: {
            schema: 'evaos.desktop_bridge.workbench_runtime.v1',
            contract_version: 1,
            version_compatible: true,
            compatible: true,
          },
          permissions: { accessibility: { status: 'granted' }, screen_recording: { status: 'granted' } },
        },
      },
      'connector-service status --json': {
        ok: true,
        data: {
          running: true,
          health: { reachable: true },
          tailnet_ip: '100.64.0.10',
          token_path: '/tmp/connector.token',
          managed_by: 'workbench-session',
          owner: {
            program_path: { kind: 'path', value: bundledBridgePath },
            app_path: { kind: 'path', value: '/Applications/evaOS Workbench.app' },
            bundle_id: 'com.evaos.workbench',
            classification: 'workbench_bundle',
          },
          private_network: {
            client_installed: true,
            client_running: true,
            enrolled: true,
            online: true,
          },
        },
      },
      'customer-mac status --json': {
        ok: true,
        data: {
          device: { hardware_uuid: 'bound-device' },
          permissions: { accessibility: { status: 'granted' }, screen_recording: { status: 'granted' } },
          control_engines: { peekaboo: { available: true }, active_primary: 'peekaboo' },
        },
      },
      'customer-mac iphone-mirroring status --json': { ok: true, data: { installed: true, running: false } },
      'customer-mac control status --json': controlStatus,
      'audit-tail --json --limit 5': { ok: true, data: { records: [] } },
      'ready --json': { ok: true, data: { ready: true } },
    });
    deps.getPrivateNetworkReadiness = vi.fn(async () => ({
      customerId: 'bound-customer',
      deviceId: 'device-id',
      deviceIdentifier: 'bound-device',
      enrollmentId: 'enrollment-id',
      grantId: 'grant-ready',
      correctControlPlane: true,
      aclAllowed: true,
      online: true,
      reason: 'ready',
      observedAt: '2026-06-07T03:45:00.000Z',
      expiresAt: '2026-06-07T03:45:45.000Z',
      auditId: 'audit-authority-ready',
    }));

    const status = await getEvaosNativeCompanionStatus(deps, { customerId: 'bound-customer' });

    expect(status).toMatchObject({
      readiness: 'repair_required',
      pairingCapable: false,
      pairingBlockedReason: 'secure_network_link_required',
      blockerReason: 'secure_network_link_required',
      prerequisites: { privateNetwork: 'error' },
      privateNetworkAuthority: {
        classification: 'unavailable',
        reason: 'local_scope_unavailable',
      },
    });
    expect(status.sourcePointer).toBe('native-companion:read-only-bridge');
    expect(deps.getPrivateNetworkReadiness).not.toHaveBeenCalled();
  });

  it('uses the trusted one-use enrollment grant to bootstrap scope-less broker authority', async () => {
    const enrollmentDeps = depsWithResponses(
      {},
      {
        existsSync: vi.fn(
          (path: string) =>
            path === bundledBridgePath ||
            path === '/Applications/evaOS Workbench.app' ||
            path === '/Applications/Tailscale.app' ||
            path === '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
        ),
        execFile: vi.fn(async (file: string, args: string[]) => {
          const key = args.join(' ');
          if (file === bundledBridgePath && key === 'connector-service status --json') {
            return {
              stdout: json({
                ok: true,
                data: { private_network: { client_installed: true, client_running: true, enrolled: false } },
              }),
              stderr: '',
            };
          }
          if (file === bundledBridgePath && key === 'customer-mac status --json') {
            return {
              stdout: json({ ok: true, data: { device: { hardware_uuid: 'bound-device' } } }),
              stderr: '',
            };
          }
          if (file === '/usr/bin/codesign' && args[0] === '-dv') {
            return { stdout: '', stderr: 'Identifier=io.tailscale.ipn.macsys\nTeamIdentifier=W5364U7YZB\n' };
          }
          if (file === '/usr/bin/codesign' && args[0] === '--verify') return { stdout: '', stderr: '' };
          if (file === '/Applications/Tailscale.app/Contents/MacOS/Tailscale') return { stdout: '', stderr: '' };
          throw new Error(`unexpected command ${file} ${key}`);
        }),
        createPrivateNetworkEnrollment: vi.fn(async () => ({
          customerId: 'bound-customer',
          deviceId: 'device-id',
          deviceIdentifier: 'bound-device',
          grantId: 'grant-bootstrap',
          clientVariant: 'tailscale_standalone' as const,
          enrollmentId: 'enrollment-id',
          loginServer: 'https://headscale.example',
          authKey: 'one-use-private-network-key-for-test',
          expiresAt: '2026-06-07T04:00:00.000Z',
        })),
      }
    );
    await expect(
      runNativeCompanionAction({ action: 'secure_network_enroll', customerId: 'bound-customer' }, enrollmentDeps)
    ).resolves.toMatchObject({ status: 'succeeded', bootstrapGrantId: 'grant-bootstrap' });

    const deps = depsWithResponses(
      {
        'status --json': {
          ok: true,
          data: {
            bridge_runtime: {
              schema: 'evaos.desktop_bridge.workbench_runtime.v1',
              contract_version: 1,
              version_compatible: true,
              compatible: true,
            },
            permissions: { accessibility: { status: 'granted' }, screen_recording: { status: 'granted' } },
          },
        },
        'connector-service status --json': {
          ok: true,
          data: {
            running: true,
            health: { reachable: true },
            tailnet_ip: '100.64.0.10',
            token_path: '/tmp/connector.token',
            managed_by: 'workbench-session',
            owner: {
              program_path: { kind: 'path', value: bundledBridgePath },
              app_path: { kind: 'path', value: '/Applications/evaOS Workbench.app' },
              bundle_id: 'com.evaos.workbench',
              classification: 'workbench_bundle',
            },
            private_network: { client_installed: true, client_running: true, enrolled: true, online: true },
          },
        },
        'customer-mac status --json': {
          ok: true,
          data: {
            device: { hardware_uuid: 'bound-device' },
            permissions: { accessibility: { status: 'granted' }, screen_recording: { status: 'granted' } },
            control_engines: { cua_driver: { available: true, active_for_actions: true } },
          },
        },
        'customer-mac iphone-mirroring status --json': { ok: true, data: { installed: true, running: false } },
        'customer-mac control status --json': { ok: true, data: { active: false, kill_switch: false } },
        'audit-tail --json --limit 5': { ok: true, data: { records: [] } },
        'ready --json': { ok: true, data: { ready: true } },
      },
      {
        readTextFile: vi.fn(() => 'connector-token'),
        runConnectorCommand: vi.fn(async () => ({
          ok: true,
          data: {
            permissions: { accessibility: { status: 'granted' }, screen_recording: { status: 'granted' } },
          },
        })),
        ensureCustomerMacConnectorGrant: vi.fn(async () => ({
          ok: true,
          customerId: 'bound-customer',
          deviceId: 'device-id',
          grantId: 'grant-bootstrap',
          grantState: 'active',
        })),
      }
    );
    deps.getPrivateNetworkReadiness = vi.fn(async () => ({
      customerId: 'bound-customer',
      deviceId: 'device-id',
      deviceIdentifier: 'bound-device',
      enrollmentId: 'enrollment-id',
      grantId: 'grant-bootstrap',
      correctControlPlane: true,
      aclAllowed: true,
      online: true,
      reason: 'ready',
      observedAt: '2026-06-07T03:45:00.000Z',
      expiresAt: '2026-06-07T03:45:45.000Z',
      auditId: 'audit-authority-ready',
    }));

    const status = await getEvaosNativeCompanionStatus(deps, {
      customerId: 'bound-customer',
      bootstrapGrantId: 'grant-bootstrap',
    });

    expect(status).toMatchObject({
      readiness: 'ready',
      pairingCapable: true,
      prerequisites: { privateNetwork: 'online' },
      privateNetworkAuthority: { classification: 'observed', reason: 'ready' },
    });

    const connectorGrantResult = await runNativeCompanionAction(
      { action: 'ensure_customer_mac_connector_grant', customerId: 'bound-customer' },
      deps
    );
    expect(connectorGrantResult).toMatchObject({
      status: 'succeeded',
      action: 'ensure_customer_mac_connector_grant',
      connectorGrant: { grantId: 'grant-bootstrap' },
    });
  });

  it.each([
    ['mismatched bootstrap grant', 'grant-other', 'grant-local'],
    ['arbitrary bootstrap grant without a trusted enrollment', 'grant-bootstrap', undefined],
    ['missing bootstrap grant after restart', undefined, undefined],
  ])('keeps scope-less bootstrap authority repair-required for %s', async (_label, bootstrapGrantId, localGrantId) => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        data: {
          bridge_runtime: {
            schema: 'evaos.desktop_bridge.workbench_runtime.v1',
            contract_version: 1,
            version_compatible: true,
            compatible: true,
          },
          permissions: { accessibility: { status: 'granted' }, screen_recording: { status: 'granted' } },
        },
      },
      'connector-service status --json': {
        ok: true,
        data: {
          running: true,
          health: { reachable: true },
          secure_registration_host: 'connector.evaos.example',
          private_network: { client_installed: true, client_running: true, enrolled: true, online: true },
        },
      },
      'customer-mac status --json': {
        ok: true,
        data: {
          device: { hardware_uuid: 'bound-device' },
          permissions: { accessibility: { status: 'granted' }, screen_recording: { status: 'granted' } },
          control_engines: { cua_driver: { available: true, active_for_actions: true } },
        },
      },
      'customer-mac iphone-mirroring status --json': { ok: true, data: { installed: true, running: false } },
      'customer-mac control status --json': {
        ok: true,
        data: { active: false, kill_switch: false, active_mac_control_scope_id: localGrantId },
      },
      'audit-tail --json --limit 5': { ok: true, data: { records: [] } },
      'ready --json': { ok: true, data: { ready: true } },
    });
    deps.getPrivateNetworkReadiness = vi.fn(async () => ({
      customerId: 'bound-customer',
      deviceId: 'device-id',
      deviceIdentifier: 'bound-device',
      enrollmentId: 'enrollment-id',
      grantId: 'grant-bootstrap',
      correctControlPlane: true,
      aclAllowed: true,
      online: true,
      reason: 'ready',
      observedAt: '2026-06-07T03:45:00.000Z',
      expiresAt: '2026-06-07T03:45:45.000Z',
      auditId: 'audit-authority-ready',
    }));

    const status = await getEvaosNativeCompanionStatus(deps, {
      customerId: 'bound-customer',
      bootstrapGrantId,
    });

    expect(status).toMatchObject({
      readiness: 'repair_required',
      pairingCapable: false,
      prerequisites: { privateNetwork: 'error' },
    });
  });

  it.each([
    {
      label: 'CUA primary',
      controlEngines: {
        cua_driver: { available: true, active_for_actions: true },
        peekaboo: { available: true },
        active_primary: 'cua_driver',
      },
      expectedActionEngine: 'cua_ready',
    },
    {
      label: 'Peekaboo fallback',
      controlEngines: { peekaboo: { available: true }, active_primary: 'peekaboo' },
      expectedActionEngine: 'peekaboo_ready',
    },
  ] as const)(
    'accepts $label when all typed prerequisites are ready',
    async ({ controlEngines, expectedActionEngine }) => {
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
            online: true,
          },
        },
        'customer-mac status --json': {
          ok: true,
          data: {
            device: { hardware_uuid: 'typed-ready-device' },
            permissions: { accessibility: { status: 'granted' }, screen_recording: { status: 'granted' } },
            control_engines: controlEngines,
          },
        },
        'customer-mac iphone-mirroring status --json': { ok: true, data: { installed: true, running: false } },
        'customer-mac control status --json': {
          ok: true,
          data: { active: false, kill_switch: false, active_mac_control_scope_id: 'grant-typed-ready' },
        },
        'audit-tail --json --limit 5': { ok: true, data: { records: [] } },
        'ready --json': { ok: true, data: { ready: true } },
      });
      deps.getPrivateNetworkReadiness = vi.fn(async () => ({
        customerId: 'typed-ready-customer',
        deviceId: 'typed-ready-device-id',
        deviceIdentifier: 'typed-ready-device',
        enrollmentId: 'typed-ready-enrollment',
        grantId: 'grant-typed-ready',
        correctControlPlane: true,
        aclAllowed: true,
        online: true,
        reason: 'ready',
        observedAt: '2026-06-07T03:45:00.000Z',
        expiresAt: '2026-06-07T03:45:45.000Z',
        auditId: 'audit-typed-ready',
      }));

      const status = await getEvaosNativeCompanionStatus(deps, { customerId: 'typed-ready-customer' });

      expect(status).toMatchObject({
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        runtimeToolReadiness: 'pairing_ready',
        pairingCapable: true,
        pairingBlockedReason: undefined,
        blockerReason: undefined,
        prerequisites: {
          bridgeRuntime: 'ready',
          privateNetwork: 'online',
          actionEngine: expectedActionEngine,
        },
      });
    }
  );

  it('demotes pairing when explicit private-network evidence cannot prove control-plane and ACL state', async () => {
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
          online: true,
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
        privateNetwork: 'error',
        actionEngine: 'peekaboo_ready',
      },
    });
  });

  it('surfaces broker-session recovery when private-network authority authentication expires', async () => {
    const deps = depsWithTypedReadyResponses(
      {
        'status --json': { ok: true, data: {} },
        'connector-service status --json': {
          ok: true,
          running: true,
          health: { reachable: true },
          tailnet_ip: '100.64.0.10',
        },
        'customer-mac status --json': {
          ok: true,
          data: {
            device: { hardware_uuid: 'session-device' },
            permissions: { accessibility: { status: 'granted' }, screen_recording: { status: 'granted' } },
          },
        },
        'customer-mac control status --json': {
          ok: true,
          data: { active: false, kill_switch: false, active_mac_control_scope_id: 'grant-session' },
        },
        'audit-tail --json --limit 5': { ok: true, data: { records: [] } },
        'ready --json': { ok: true, data: { ready: true } },
      },
      {
        getPrivateNetworkReadiness: vi.fn(async () => {
          throw new EvaosBrokerSessionError('expired_session', 'expired');
        }),
      }
    );

    const status = await getEvaosNativeCompanionStatus(deps, { customerId: 'session-customer' });

    expect(status).toMatchObject({
      readiness: 'repair_required',
      blockerReason: 'broker_session_expired',
      privateNetworkAuthority: { reason: 'broker_session_expired' },
    });
  });

  it('rejects mixed grant scopes and aborts a timed-out authority request', async () => {
    const deps = depsWithResponses({
      'status --json': {
        ok: true,
        data: {
          bridge_runtime: {
            schema: 'evaos.desktop_bridge.workbench_runtime.v1',
            contract_version: 1,
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
        private_network: {
          client_installed: true,
          client_running: true,
          enrolled: true,
          online: true,
        },
      },
      'customer-mac status --json': {
        ok: true,
        data: {
          device: { hardware_uuid: 'david-mac-hardware-id' },
          permissions: { accessibility: { status: 'granted' }, screen_recording: { status: 'granted' } },
          control_engines: { cua_driver: { available: true, active_for_actions: true } },
        },
      },
      'customer-mac iphone-mirroring status --json': { ok: true, data: { installed: true, running: false } },
      'customer-mac control status --json': {
        ok: true,
        data: { active: false, kill_switch: false, active_mac_control_scope_id: 'grant-current' },
      },
      'audit-tail --json --limit 5': { ok: true, data: { records: [] } },
      'ready --json': { ok: true, data: { ready: true } },
    });
    const authority = {
      customerId: 'jackie-david',
      deviceId: 'device-david',
      deviceIdentifier: 'david-mac-hardware-id',
      enrollmentId: 'network-enrollment-1',
      grantId: 'grant-other',
      correctControlPlane: true,
      aclAllowed: true,
      online: true,
      reason: 'ready' as const,
      observedAt: '2026-06-07T03:45:00.000Z',
      expiresAt: '2026-06-07T03:45:45.000Z',
      auditId: 'audit-network-ready',
    };
    deps.getPrivateNetworkReadiness = vi.fn(async () => authority);

    const mixedScope = await getEvaosNativeCompanionStatus(deps, { customerId: 'jackie-david' });
    expect(mixedScope).toMatchObject({
      readiness: 'repair_required',
      pairingCapable: false,
      prerequisites: { privateNetwork: 'error' },
    });

    let aborted = false;
    deps.getPrivateNetworkReadiness = vi.fn(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        })
    );
    vi.useFakeTimers();
    const pending = getEvaosNativeCompanionStatus(deps, { customerId: 'jackie-david' });
    await vi.advanceTimersByTimeAsync(8_000);
    const timedOut = await pending;

    expect(aborted).toBe(true);
    expect(timedOut).toMatchObject({
      readiness: 'repair_required',
      pairingCapable: false,
      prerequisites: { privateNetwork: 'error' },
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

    deps.getPrivateNetworkReadiness = vi.fn(async () => ({
      customerId: 'friendly',
      deviceId: 'device-friendly',
      deviceIdentifier: 'mac-3bf1c1b451434bcf',
      enrollmentId: 'network-enrollment-friendly',
      grantId: 'grant-current',
      correctControlPlane: true,
      aclAllowed: true,
      online: true,
      reason: 'ready',
      observedAt: '2026-06-07T03:45:00.000Z',
      expiresAt: '2026-06-07T03:45:45.000Z',
      auditId: 'audit-network-authority',
    }));
    const getStatus = () => getEvaosNativeCompanionStatus(deps, { customerId: 'friendly' });

    const status = await getStatus();

    expect(status).toMatchObject({
      schemaVersion: 'evaos.native_companion_status.v1',
      readiness: 'ready',
      agentPairingStatus: 'agent_paired',
      runtimeToolReadiness: 'pairing_ready',
      generatedAt: '2026-06-07T03:45:00.000Z',
      sourcePointer: 'native-companion:broker-authority-merged',
      privateNetworkAuthority: {
        classification: 'observed',
        reason: 'ready',
        auditId: 'audit-network-authority',
      },
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

    const provenStatus = await getStatus();
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

    const camelCaseProvenStatus = await getStatus();
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

    const failedPairingStatus = await getStatus();
    expect(failedPairingStatus).toMatchObject({
      agentPairingStatus: 'proof_failed',
      runtimeToolReadiness: 'proof_failed',
      controlSession: { auditId: 'audit-control-failed-stale-proof' },
    });

    const incompletePairingStatus = await getStatus();
    expect(incompletePairingStatus).toMatchObject({
      readiness: 'repair_required',
      agentPairingStatus: 'not_ready',
      runtimeToolReadiness: 'not_ready',
      privateNetworkAuthority: {
        classification: 'unavailable',
        reason: 'local_scope_unavailable',
      },
      controlSession: { auditId: 'audit-control-unpaired-stale-proof' },
    });

    const killSwitchStatus = await getStatus();
    expect(killSwitchStatus).toMatchObject({
      agentPairingStatus: 'agent_paired',
      runtimeToolReadiness: 'not_ready',
      controlSession: { auditId: 'audit-control-kill-switch-stale-proof', killSwitch: true },
    });

    const staleGrantProofStatus = await getStatus();
    expect(staleGrantProofStatus).toMatchObject({
      agentPairingStatus: 'agent_paired',
      agentPairingCustomerId: 'friendly',
      agentPairingProofScopeId: 'grant-current',
      runtimeToolReadiness: 'pairing_ready',
      controlSession: { auditId: 'audit-control-stale-grant-proof' },
    });

    const identicalStaleProofStatus = await getStatus();
    expect(identicalStaleProofStatus).toMatchObject({
      agentPairingStatus: 'ready_for_agent_pairing',
      agentPairingCustomerId: 'friendly',
      agentPairingProofScopeId: 'grant-revoked',
      activeMacControlScopeId: 'grant-current',
      runtimeToolReadiness: 'pairing_ready',
      controlSession: { auditId: 'audit-control-identical-stale-proof' },
    });

    const failedCommandStatus = await getStatus();
    expect(failedCommandStatus).toMatchObject({
      readiness: 'repair_required',
      agentPairingStatus: 'not_ready',
      runtimeToolReadiness: 'not_ready',
      privateNetworkAuthority: {
        classification: 'unavailable',
        reason: 'local_scope_unavailable',
      },
      controlSession: { auditId: 'audit-control-command-failed-stale-proof', status: 'unavailable' },
    });
  });

  it('fails closed when legacy connector readiness lacks typed prerequisite evidence', async () => {
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
      readiness: 'repair_required',
      agentPairingStatus: 'not_ready',
      runtimeToolReadiness: 'not_ready',
      pairingCapable: false,
      pairingBlockedReason: 'bundled_bridge_required',
      blockerReason: 'bundled_bridge_required',
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
      brokerGrant: {
        privateNetworkAuthority: {
          classification: 'unavailable',
          reason: 'local_evidence_unavailable',
        },
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
    const deps = depsWithTypedReadyResponses({
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
      readiness: 'repair_required',
      pairingCapable: false,
      agentPairingStatus: 'not_ready',
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
    const deps = depsWithTypedReadyResponses({
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
      readiness: 'repair_required',
      agentPairingStatus: 'not_ready',
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
    const deps = depsWithTypedReadyResponses({
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
      readiness: 'repair_required',
      agentPairingStatus: 'not_ready',
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
            control_engines: {
              cua_driver: { available: true, active_for_actions: true },
              active_primary: 'cua_driver',
            },
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
    const deps = depsWithTypedReadyResponses({
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
      readiness: 'repair_required',
      agentPairingStatus: 'not_ready',
      pairingCapable: false,
      pairingBlockedReason: 'secure_network_link_required',
      connectorService: {
        status: 'ready',
        running: true,
        reachable: true,
      },
    });
    expect(status.summaryText).toContain('connector repair is required');
  });

  it('accepts private connector hosts when the bridge reports a URL or port', async () => {
    const deps = depsWithTypedReadyResponses({
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
      readiness: 'repair_required',
      agentPairingStatus: 'not_ready',
      pairingCapable: false,
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

  it('fails setup check closed when otherwise-ready legacy inputs lack typed prerequisites', async () => {
    const createCustomerMacEnrollment = vi.fn();
    const ensureCustomerMacConnectorGrant = vi.fn();
    const deps = depsWithResponses(
      {
        'status --json': { ok: true, data: {} },
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
      },
      { createCustomerMacEnrollment, ensureCustomerMacConnectorGrant }
    );

    const result = await runNativeCompanionAction({ action: 'setup_check' }, deps);

    expect(result).toMatchObject({
      action: 'setup_check',
      status: 'repair_required',
      agentPairingStatus: 'not_ready',
      blockerReason: 'bundled_bridge_required',
      sourcePointer: 'native-companion:setup-check',
      auditIds: ['audit-mac', 'audit-control'],
      setup: {
        connectorReady: false,
        macReady: true,
        controlReady: true,
        iPhoneDeferred: true,
      },
    });
    expect(createCustomerMacEnrollment).not.toHaveBeenCalled();
    expect(ensureCustomerMacConnectorGrant).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/Bearer|desktop_session|provider_grant|access_token|refresh_token/i);
  });

  it('runs setup check with legacy top-level connector-service status payloads', async () => {
    const deps = depsWithTypedReadyResponses({
      'status --json': { ok: true, data: {} },
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

    const diagnosticConnector = await deps.execFile?.(bundledBridgePath, ['connector-service', 'status', '--json'], {
      timeout: 1,
    });
    expect(JSON.parse(diagnosticConnector?.stdout ?? '{}')).toHaveProperty('private_network');

    const result = await runNativeCompanionAction({ action: 'setup_check', customerId: 'typed-ready-customer' }, deps);

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
    let statusCalls = 0;
    const execFile = vi.fn(async (_file, args) => {
      const key = args.join(' ');
      if (key === 'connector-service status --json') {
        statusCalls += 1;
        const ready = statusCalls > 1;
        return {
          stdout: json({
            ok: true,
            audit_id: 'audit-connector',
            loaded: false,
            running: false,
            managed_by: 'workbench-or-manual',
            tailnet_ip: '100.64.0.4',
            health: { reachable: ready, ready, host: '100.64.0.4' },
          }),
          stderr: '',
        };
      }
      if (key === 'ready --json') {
        return { stdout: json({ ok: false, ready: false, service: 'evaos-desktop-bridge-connector' }), stderr: '' };
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
    ).toHaveLength(0);
  });

  it('preserves a live tracked connector when bridge discovery changes paths', async () => {
    const oldBridgePath = bundledBridgePath;
    const newBridgePath = '/Applications/evaOS Workbench.app/Contents/Resources/Bridge/v2/evaos-desktop-bridge';
    const trackedChild = mockChildProcess();
    const firstSpawn = vi.fn(() => trackedChild);
    let firstStatusCalls = 0;
    const firstExecFile = vi.fn(async (_file: string, args: string[]) => {
      const key = args.join(' ');
      if (key === 'connector-service status --json') {
        firstStatusCalls += 1;
        return {
          stdout: json({
            ok: true,
            loaded: false,
            running: false,
            managed_by: firstStatusCalls === 1 ? 'offline' : 'workbench-or-manual',
            tailnet_ip: '100.64.0.4',
            health: {
              reachable: firstStatusCalls > 1,
              ready: firstStatusCalls > 1,
              host: '100.64.0.4',
            },
          }),
          stderr: '',
        };
      }
      if (key === 'ready --json') {
        return { stdout: json({ ok: false, ready: false, service: 'evaos-desktop-bridge-connector' }), stderr: '' };
      }
      throw new Error(`unexpected command ${key}`);
    });
    const firstResult = await runNativeCompanionAction(
      { action: 'connector_start' },
      depsWithResponses({}, { execFile: firstExecFile, spawnConnectorProcess: firstSpawn })
    );
    expect(firstResult.status).toBe('succeeded');

    const replacementSpawn = vi.fn(() => mockChildProcess());
    const replacementDeps = depsWithResponses(
      {
        'connector-service status --json': {
          ok: true,
          loaded: false,
          running: false,
          managed_by: 'offline',
          tailnet_ip: '100.64.0.5',
          health: { reachable: false, ready: false, host: '100.64.0.5' },
        },
        'ready --json': { ok: false, ready: false, service: 'evaos-desktop-bridge-connector' },
      },
      {
        bridgePaths: [newBridgePath],
        existsSync: vi.fn((path: string) => path === newBridgePath),
        spawnConnectorProcess: replacementSpawn,
      }
    );

    const replacementResult = await runNativeCompanionAction({ action: 'connector_start' }, replacementDeps);

    expect(replacementResult).toMatchObject({
      action: 'connector_start',
      status: 'repair_required',
      blockerReason: 'listener_replacement_unproven',
    });
    expect(trackedChild.kill).not.toHaveBeenCalled();
    expect(replacementSpawn).not.toHaveBeenCalled();
    expect(
      (replacementDeps.execFile as ReturnType<typeof vi.fn>).mock.calls.map(([, callArgs]) => callArgs.join(' '))
    ).not.toContain('connector-service stop --json');
    expect(firstSpawn).toHaveBeenCalledWith(oldBridgePath, expect.any(Array), expect.any(Object));
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
    expect(execFile.mock.calls.map(([, callArgs]) => callArgs.join(' '))).not.toContain(
      'connector-service stop --json'
    );
  });

  it.each([
    [
      'reachable ownerless loopback status',
      {
        ok: true,
        loaded: false,
        running: true,
        health: { reachable: true, ready: true, host: '127.0.0.1' },
      },
    ],
    [
      'loopback-only bridge-ready fallback',
      {
        ok: true,
        loaded: false,
        running: true,
        managed_by: 'workbench-or-manual',
        health: { reachable: false, ready: false },
      },
    ],
  ])('preserves %s without claiming connector start success', async (_label, connectorStatus) => {
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const deps = depsWithResponses(
      {
        'connector-service status --json': connectorStatus,
        'ready --json': {
          ok: true,
          ready: true,
          service: 'evaos-desktop-bridge-connector',
          connector_service: { running: true, ready: true, health: { reachable: true } },
        },
      },
      { probeConnectorReady: vi.fn(async () => true), spawnConnectorProcess }
    );

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({
      action: 'connector_start',
      status: 'repair_required',
      blockerReason: 'listener_replacement_unproven',
    });
    expect(spawnConnectorProcess).not.toHaveBeenCalled();
    expect(
      (deps.execFile as ReturnType<typeof vi.fn>).mock.calls.map(([, callArgs]) => callArgs.join(' '))
    ).not.toContain('connector-service stop --json');
  });

  it('preserves the current listener when authenticated diagnostics time out', async () => {
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const key = args.join(' ');
      if (key === 'connector-service status --json') {
        throw new Error('simulated authenticated diagnostics timeout');
      }
      if (key === 'ready --json') {
        return {
          stdout: json({ ok: false, ready: false, service: 'evaos-desktop-bridge-connector' }),
          stderr: '',
        };
      }
      if (key === 'connector-service stop --json') {
        return { stdout: json({ ok: true, action: 'stop' }), stderr: '' };
      }
      throw new Error(`unexpected command ${key}`);
    });
    const deps = depsWithResponses({}, { execFile, spawnConnectorProcess });

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({
      action: 'connector_start',
      status: 'repair_required',
      blockerReason: 'listener_replacement_unproven',
    });
    expect(execFile.mock.calls.map(([, callArgs]) => callArgs.join(' '))).not.toContain(
      'connector-service stop --json'
    );
    expect(spawnConnectorProcess.mock.calls.length).toBe(0);
  });

  it.each([
    ['authentication rejected', false],
    ['authentication incomplete', undefined],
  ])('preserves a reachable private listener when %s', async (_label, authenticated) => {
    const privateListener = {
      ok: true,
      audit_id: 'audit-private-listener-uncertain',
      loaded: false,
      running: false,
      managed_by: 'offline',
      tailnet_ip: '100.64.0.4',
      health: {
        reachable: true,
        ready: false,
        host: '100.64.0.4',
        ...(authenticated === undefined ? {} : { authenticated }),
      },
    };
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const deps = depsWithResponses(
      {
        'connector-service status --json': privateListener,
        'ready --json': {
          ok: false,
          ready: false,
          service: 'evaos-desktop-bridge-connector',
          connector_service: { health: { reachable: true, ready: false, host_kind: 'tailnet' } },
        },
        'connector-service stop --json': { ok: true, action: 'stop' },
      },
      { probeConnectorReady: vi.fn(async () => false), spawnConnectorProcess }
    );

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({ action: 'connector_start', status: 'repair_required' });
    expect(
      (deps.execFile as ReturnType<typeof vi.fn>).mock.calls.map(([, callArgs]) => callArgs.join(' '))
    ).not.toContain('connector-service stop --json');
    expect(spawnConnectorProcess.mock.calls.length).toBe(0);
  });

  it('does not fall back to loopback when private host evidence is unresolved', async () => {
    const privateListener = {
      ok: true,
      audit_id: 'audit-private-host-unresolved',
      loaded: false,
      running: false,
      managed_by: 'offline',
      tailnet_available: true,
      private_network: { client_installed: true, client_running: true, enrolled: true, online: true },
      health: { reachable: true, ready: false, authenticated: false, host_kind: 'tailnet' },
    };
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const deps = depsWithResponses(
      {
        'connector-service status --json': privateListener,
        'ready --json': {
          ok: false,
          ready: false,
          service: 'evaos-desktop-bridge-connector',
          connector_service: { health: { reachable: true, ready: false, host_kind: 'tailnet' } },
        },
        'connector-service stop --json': { ok: true, action: 'stop' },
      },
      {
        execFile: vi.fn(async (file: string, args: string[]) => {
          const key = args.join(' ');
          if (file === bundledBridgePath && key === 'connector-service status --json') {
            return { stdout: json(privateListener), stderr: '' };
          }
          if (file === bundledBridgePath && key === 'ready --json') {
            return {
              stdout: json({ ok: false, ready: false, service: 'evaos-desktop-bridge-connector' }),
              stderr: '',
            };
          }
          if (file === bundledBridgePath && key === 'connector-service stop --json') {
            return { stdout: json({ ok: true, action: 'stop' }), stderr: '' };
          }
          if (key === 'ip -4') return { stdout: '', stderr: '' };
          if (file === '/sbin/ifconfig') return { stdout: '', stderr: '' };
          throw new Error(`unexpected command ${file} ${key}`);
        }),
        probeConnectorReady: vi.fn(async () => false),
        spawnConnectorProcess,
      }
    );

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({ action: 'connector_start', status: 'repair_required' });
    expect(spawnConnectorProcess.mock.calls.length).toBe(0);
    expect(
      (deps.execFile as ReturnType<typeof vi.fn>).mock.calls.map(([, callArgs]) => callArgs.join(' '))
    ).not.toContain('connector-service stop --json');
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['public', '8.8.8.8'],
  ])('rejects an offline %s listener for an unscoped connector start', async (_label, host) => {
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const deps = depsWithResponses(
      {
        'connector-service status --json': {
          ok: true,
          loaded: false,
          running: false,
          managed_by: 'offline',
          health: { reachable: false, ready: false, host },
        },
        'ready --json': { ok: false, ready: false, service: 'evaos-desktop-bridge-connector' },
      },
      { spawnConnectorProcess }
    );

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({
      action: 'connector_start',
      status: 'repair_required',
      blockerReason: 'listener_replacement_unproven',
    });
    expect(spawnConnectorProcess).not.toHaveBeenCalled();
    expect(
      (deps.execFile as ReturnType<typeof vi.fn>).mock.calls.map(([, callArgs]) => callArgs.join(' '))
    ).not.toContain('connector-service stop --json');
  });

  it('cold-starts a private connector only when the previous owner is proven offline', async () => {
    const offlineStatus = {
      ok: true,
      audit_id: 'audit-connector-offline',
      loaded: false,
      running: false,
      managed_by: 'offline',
      tailnet_ip: '100.64.0.4',
      health: { reachable: false, ready: false, host: '100.64.0.4' },
    };
    const readyStatus = {
      ...offlineStatus,
      audit_id: 'audit-connector-cold-start-ready',
      managed_by: 'workbench-or-manual',
      health: { reachable: true, ready: true, host: '100.64.0.4' },
    };
    let statusCalls = 0;
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const key = args.join(' ');
      if (key === 'connector-service status --json') {
        statusCalls += 1;
        return { stdout: json(statusCalls === 1 ? offlineStatus : readyStatus), stderr: '' };
      }
      if (key === 'ready --json') {
        return {
          stdout: json({ ok: false, ready: false, service: 'evaos-desktop-bridge-connector' }),
          stderr: '',
        };
      }
      if (key === 'connector-service stop --json') {
        return { stdout: json({ ok: true, action: 'stop' }), stderr: '' };
      }
      throw new Error(`unexpected command ${key}`);
    });
    const deps = depsWithResponses({}, { execFile, spawnConnectorProcess });

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({ action: 'connector_start', status: 'succeeded' });
    expect(spawnConnectorProcess).toHaveBeenCalledWith(
      bundledBridgePath,
      ['serve', '--host', '100.64.0.4', '--port', '8765'],
      expect.any(Object)
    );
    expect(execFile.mock.calls.map(([, callArgs]) => callArgs.join(' '))).not.toContain(
      'connector-service stop --json'
    );
  });

  it('preserves an unloaded-but-present owner instead of attempting an unproven replacement', async () => {
    const offlineStatus = {
      ok: true,
      audit_id: 'audit-offline-owner-stop-failed',
      loaded: true,
      running: false,
      managed_by: 'launchagent',
      tailnet_ip: '100.64.0.4',
      health: { reachable: false, ready: false, host: '100.64.0.4' },
    };
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const deps = depsWithResponses(
      {
        'connector-service status --json': offlineStatus,
        'ready --json': {
          ok: false,
          ready: false,
          service: 'evaos-desktop-bridge-connector',
        },
        'connector-service stop --json': { ok: true, action: 'stop' },
      },
      { spawnConnectorProcess }
    );

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({
      action: 'connector_start',
      status: 'repair_required',
      blockerReason: 'listener_replacement_unproven',
    });
    expect(spawnConnectorProcess.mock.calls.length).toBe(0);
    expect(
      (deps.execFile as ReturnType<typeof vi.fn>).mock.calls.map(([, callArgs]) => callArgs.join(' '))
    ).not.toContain('connector-service stop --json');
  });

  it('does not accept stale bridge-ready proof without a current secure registration host', async () => {
    const spawnConnectorProcess = vi.fn(() => {
      throw new Error('unexpected connector spawn');
    });
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
      status: 'repair_required',
      sourcePointer: 'native-companion:workbench-session-connector-start',
      blockerReason: 'listener_replacement_unproven',
    });
    expect(
      (deps.execFile as ReturnType<typeof vi.fn>).mock.calls.map(([, callArgs]) => callArgs.join(' '))
    ).not.toContain('connector-service stop --json');
  });

  it('privately resolves and tracks a redacted tailnet host for the Workbench-session connector', async () => {
    const startingStatus = {
      ok: true,
      audit_id: 'audit-redacted-connector-starting',
      loaded: false,
      running: false,
      managed_by: 'offline',
      tailnet_available: true,
      private_network: {
        client_installed: true,
        client_running: true,
        enrolled: true,
        online: true,
      },
      health: { authenticated: true, reachable: false, ready: false, host_kind: 'tailnet' },
    };
    const readyStatus = {
      ...startingStatus,
      audit_id: 'audit-redacted-connector-ready',
      loaded: false,
      running: false,
      managed_by: 'workbench-or-manual',
      health: { authenticated: true, reachable: true, ready: true, host_kind: 'tailnet' },
    };
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const probeConnectorReady = vi.fn(async (host: string) => host === '100.64.0.4');
    let statusCalls = 0;
    const execFile = vi.fn(async (file: string, args: string[]) => {
      const key = args.join(' ');
      if (file === bundledBridgePath && key === 'connector-service status --json') {
        statusCalls += 1;
        return { stdout: json(statusCalls === 1 ? startingStatus : readyStatus), stderr: '' };
      }
      if (file === bundledBridgePath && key === 'connector-service stop --json') {
        return { stdout: json({ ok: true, action: 'stop' }), stderr: '' };
      }
      if (file === bundledBridgePath && key === 'ready --json') {
        return {
          stdout: json({
            ok: false,
            ready: false,
            service: 'evaos-desktop-bridge-connector',
            connector_service: { health: { reachable: false, ready: false, host_kind: 'tailnet' } },
          }),
          stderr: '',
        };
      }
      if (file === '/opt/homebrew/bin/tailscale' && key === 'ip -4') {
        return { stdout: '100.64.0.4\n', stderr: '' };
      }
      throw new Error(`unexpected command ${file} ${key}`);
    });
    const deps = depsWithResponses(
      {},
      {
        execFile,
        probeConnectorReady,
        sleep: vi.fn(async () => undefined),
        spawnConnectorProcess,
      }
    );

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({
      action: 'connector_start',
      status: 'succeeded',
      sourcePointer: 'native-companion:workbench-session-connector-start',
      auditId: 'audit-redacted-connector-ready',
    });
    expect(spawnConnectorProcess).toHaveBeenCalledWith(
      bundledBridgePath,
      ['serve', '--host', '100.64.0.4', '--port', '8765'],
      expect.objectContaining({
        env: expect.objectContaining({ EVAOS_DESKTOP_BRIDGE_MANAGED_BY: 'workbench-session' }),
      })
    );
    expect(probeConnectorReady).toHaveBeenCalledWith('100.64.0.4', 8765);
    expect(startingStatus).not.toHaveProperty('tailnet_ip');
    expect(startingStatus.health).not.toHaveProperty('host');
    expect(readyStatus).not.toHaveProperty('tailnet_ip');
    expect(readyStatus.health).not.toHaveProperty('host');
    expect(JSON.stringify(result)).not.toContain('100.64.0.4');
  });

  it('does not spawn a redacted tailnet connector when private host resolution finds only loopback', async () => {
    const redactedStatus = {
      ok: true,
      audit_id: 'audit-redacted-host-unavailable',
      loaded: true,
      running: true,
      managed_by: 'launchagent',
      tailnet_available: true,
      private_network: {
        client_installed: true,
        client_running: true,
        enrolled: true,
        online: true,
      },
      health: { authenticated: true, reachable: false, ready: false, host_kind: 'tailnet' },
    };
    const spawnConnectorProcess = vi.fn(() => {
      throw new Error('unexpected connector spawn');
    });
    const execFile = vi.fn(async (file: string, args: string[]) => {
      const key = args.join(' ');
      if (file === bundledBridgePath && key === 'connector-service status --json') {
        return { stdout: json(redactedStatus), stderr: '' };
      }
      if (file === bundledBridgePath && key === 'connector-service stop --json') {
        return { stdout: json({ ok: true, action: 'stop' }), stderr: '' };
      }
      if (file === bundledBridgePath && key === 'ready --json') {
        return {
          stdout: json({
            ok: false,
            ready: false,
            service: 'evaos-desktop-bridge-connector',
            connector_service: { health: { reachable: false, ready: false, host_kind: 'tailnet' } },
          }),
          stderr: '',
        };
      }
      if (file === '/opt/homebrew/bin/tailscale' && key === 'ip -4') {
        return { stdout: '127.0.0.1\n', stderr: '' };
      }
      throw new Error(`unexpected command ${file} ${key}`);
    });
    const deps = depsWithResponses(
      {},
      {
        execFile,
        sleep: vi.fn(async () => undefined),
        spawnConnectorProcess,
      }
    );

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({
      action: 'connector_start',
      status: 'repair_required',
    });
    expect(execFile.mock.calls.map(([, callArgs]) => callArgs.join(' '))).not.toContain(
      'connector-service stop --json'
    );
    expect(redactedStatus).not.toHaveProperty('tailnet_ip');
    expect(redactedStatus.health).not.toHaveProperty('host');
    expect(JSON.stringify(result)).not.toMatch(/127\.0\.0\.1|tailnet_ip|health\.host/);
  });

  it('keeps an explicit connector stop authoritative while private host resolution is in flight', async () => {
    const redactedStatus = {
      ok: true,
      audit_id: 'audit-concurrent-stop',
      loaded: false,
      running: false,
      managed_by: 'offline',
      tailnet_available: true,
      private_network: {
        client_installed: true,
        client_running: true,
        enrolled: true,
        online: true,
      },
      health: { authenticated: true, reachable: false, ready: false, host_kind: 'tailnet' },
    };
    let resolveTailnetHost!: (value: { stdout: string; stderr: string }) => void;
    let markResolverStarted!: () => void;
    const resolverStarted = new Promise<void>((resolve) => {
      markResolverStarted = resolve;
    });
    const tailnetHost = new Promise<{ stdout: string; stderr: string }>((resolve) => {
      resolveTailnetHost = resolve;
    });
    const spawnConnectorProcess = vi.fn(() => {
      throw new Error('unexpected connector spawn');
    });
    const execFile = vi.fn(async (file: string, args: string[]) => {
      const key = args.join(' ');
      if (file === bundledBridgePath && key === 'connector-service status --json') {
        return { stdout: json(redactedStatus), stderr: '' };
      }
      if (file === bundledBridgePath && key === 'connector-service stop --json') {
        return { stdout: json({ ok: true, action: 'stop' }), stderr: '' };
      }
      if (file === bundledBridgePath && key === 'ready --json') {
        return {
          stdout: json({ ok: false, ready: false, service: 'evaos-desktop-bridge-connector' }),
          stderr: '',
        };
      }
      if (file === '/opt/homebrew/bin/tailscale' && key === 'ip -4') {
        markResolverStarted();
        return tailnetHost;
      }
      throw new Error(`unexpected command ${file} ${key}`);
    });
    const deps = depsWithResponses({}, { execFile, spawnConnectorProcess });

    const startPromise = runNativeCompanionAction({ action: 'connector_start' }, deps);
    await resolverStarted;
    const stopResult = await runNativeCompanionAction({ action: 'connector_stop' }, deps);
    resolveTailnetHost({ stdout: '100.64.0.4\n', stderr: '' });
    const startResult = await startPromise;

    expect(stopResult).toMatchObject({ action: 'connector_stop', status: 'succeeded' });
    expect(startResult).toMatchObject({ action: 'connector_start', status: 'repair_required' });
  });

  it('keeps overlapping starts from replacing an uncertain private owner', async () => {
    const uncertainStatus = {
      ok: true,
      audit_id: 'audit-overlapping-start-unready',
      loaded: true,
      running: true,
      managed_by: 'launchagent',
      tailnet_ip: '100.64.0.4',
      health: { reachable: false, ready: false, host: '100.64.0.4' },
    };
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const deps = depsWithResponses(
      {
        'connector-service status --json': uncertainStatus,
        'ready --json': { ok: false, ready: false, service: 'evaos-desktop-bridge-connector' },
        'connector-service stop --json': { ok: true, action: 'stop' },
      },
      { spawnConnectorProcess }
    );

    const [olderResult, newerResult] = await Promise.all([
      runNativeCompanionAction({ action: 'connector_start' }, deps),
      runNativeCompanionAction({ action: 'connector_start' }, deps),
    ]);

    expect(olderResult).toMatchObject({
      action: 'connector_start',
      status: 'repair_required',
    });
    expect(newerResult).toMatchObject({
      action: 'connector_start',
      status: 'repair_required',
      blockerReason: 'listener_replacement_unproven',
    });
    expect(spawnConnectorProcess.mock.calls.length).toBe(0);
    expect(
      (deps.execFile as ReturnType<typeof vi.fn>).mock.calls.map(([, callArgs]) => callArgs.join(' '))
    ).not.toContain('connector-service stop --json');
  });

  it.each(['100.63.255.255', '100.128.0.1'])(
    'rejects a non-CGNAT 100/8 bind host (%s) for a redacted tailnet connector',
    async (unsafeHost) => {
      const redactedStatus = {
        ok: true,
        audit_id: 'audit-unsafe-100-range',
        loaded: true,
        running: true,
        managed_by: 'launchagent',
        tailnet_available: true,
        private_network: { client_running: true, enrolled: true, online: true },
        health: { authenticated: true, reachable: false, ready: false, host_kind: 'tailnet' },
      };
      const spawnConnectorProcess = vi.fn(() => {
        throw new Error('unexpected connector spawn');
      });
      const execFile = vi.fn(async (file: string, args: string[]) => {
        const key = args.join(' ');
        if (file === bundledBridgePath && key === 'connector-service status --json') {
          return { stdout: json(redactedStatus), stderr: '' };
        }
        if (file === bundledBridgePath && key === 'ready --json') {
          return {
            stdout: json({ ok: false, ready: false, service: 'evaos-desktop-bridge-connector' }),
            stderr: '',
          };
        }
        throw new Error(`unexpected command ${file} ${key}`);
      });
      const deps = depsWithResponses(
        {},
        {
          env: { EVAOS_DESKTOP_BRIDGE_CONNECTOR_HOST: unsafeHost },
          execFile,
          spawnConnectorProcess,
        }
      );

      const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

      expect(result).toMatchObject({ action: 'connector_start', status: 'repair_required' });
      expect(execFile.mock.calls.map(([, callArgs]) => callArgs.join(' '))).not.toContain(
        'connector-service stop --json'
      );
    }
  );

  it('bounds cold connector polling by elapsed time when bridge status commands time out', async () => {
    let nowMs = 0;
    let statusCalls = 0;
    const pollTimeouts: number[] = [];
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const execFile = vi.fn(async (file: string, args: string[], options: { timeout?: number }) => {
      const key = args.join(' ');
      if (file === bundledBridgePath && key === 'connector-service status --json') {
        statusCalls += 1;
        if (statusCalls === 1) {
          return {
            stdout: json({
              ok: true,
              loaded: false,
              running: false,
              managed_by: 'offline',
              tailnet_ip: '100.64.0.4',
              health: { reachable: false, host: '100.64.0.4' },
            }),
            stderr: '',
          };
        }
        const timeout = options.timeout ?? 0;
        pollTimeouts.push(timeout);
        nowMs += timeout;
        throw new Error('simulated connector status timeout');
      }
      if (file === bundledBridgePath && key === 'connector-service stop --json') {
        return { stdout: json({ ok: true, action: 'stop' }), stderr: '' };
      }
      throw new Error(`unexpected command ${file} ${key}`);
    });
    const deps = depsWithResponses(
      {},
      {
        now: () => new Date(nowMs),
        execFile,
        sleep: vi.fn(async (durationMs: number) => {
          nowMs += durationMs;
        }),
        spawnConnectorProcess,
      }
    );

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({ action: 'connector_start', status: 'repair_required' });
    expect(nowMs).toBeLessThanOrEqual(12_000);
    expect(statusCalls).toBeLessThan(13);
    expect(pollTimeouts.at(-1)).toBeLessThanOrEqual(4_000);
  });

  it('does not let ownerless ready output override a concrete foreign connector owner', async () => {
    const foreignStatus = {
      ok: true,
      audit_id: 'audit-foreign-current-owner',
      loaded: false,
      running: true,
      managed_by: 'workbench-session',
      responsible_bundle_id: 'com.evaos.workbench.beta',
      responsible_app_path: '/Applications/evaOS Workbench Beta.app',
      tailnet_ip: '100.64.0.4',
      health: { reachable: false, host: '100.64.0.4' },
    };
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const deps = depsWithResponses(
      {
        'connector-service status --json': Array.from({ length: 13 }, () => foreignStatus),
        'connector-service stop --json': { ok: true, action: 'stop' },
        'ready --json': {
          ok: true,
          ready: true,
          service: 'evaos-desktop-bridge-connector',
          connector_service: { health: { reachable: true, ready: true, host_kind: 'tailnet' } },
        },
      },
      { spawnConnectorProcess }
    );

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({
      action: 'connector_start',
      status: 'repair_required',
      blockerReason: 'listener_replacement_unproven',
    });
  });

  it('keeps polling a cold Workbench-session connector beyond the initial 2.25 second window', async () => {
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const sleep = vi.fn(async () => undefined);
    let statusCalls = 0;
    const execFile = vi.fn(async (file: string, args: string[]) => {
      const key = args.join(' ');
      if (file === bundledBridgePath && key === 'connector-service status --json') {
        statusCalls += 1;
        const ready = statusCalls >= 6;
        return {
          stdout: json({
            ok: true,
            audit_id: ready ? 'audit-cold-connector-ready' : 'audit-cold-connector-starting',
            loaded: false,
            running: false,
            managed_by: statusCalls === 1 ? 'offline' : 'workbench-or-manual',
            tailnet_ip: '100.64.0.4',
            health: { reachable: ready, ready, host: '100.64.0.4' },
          }),
          stderr: '',
        };
      }
      if (file === bundledBridgePath && key === 'connector-service stop --json') {
        return { stdout: json({ ok: true, action: 'stop' }), stderr: '' };
      }
      if (file === bundledBridgePath && key === 'ready --json') {
        return {
          stdout: json({
            ok: false,
            ready: false,
            service: 'evaos-desktop-bridge-connector',
            connector_service: { health: { reachable: false, ready: false } },
          }),
          stderr: '',
        };
      }
      throw new Error(`unexpected command ${file} ${key}`);
    });
    const deps = depsWithResponses({}, { execFile, sleep, spawnConnectorProcess });

    const result = await runNativeCompanionAction({ action: 'connector_start' }, deps);

    expect(result).toMatchObject({
      action: 'connector_start',
      status: 'succeeded',
      sourcePointer: 'native-companion:workbench-session-connector-start',
      auditId: 'audit-cold-connector-ready',
    });
    expect(statusCalls).toBe(6);
    expect(sleep).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenNthCalledWith(4, 750);
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
        'connector-service status --json': Array.from({ length: 13 }, () => staleStatus),
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
      blockerReason: 'listener_replacement_unproven',
    });
    expect(result.message).toContain('Mac Access connector could not start');
    expect((deps.spawnConnectorProcess as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
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
      blockerReason: 'listener_replacement_unproven',
    });
    expect(result.message).toContain('Mac Access connector could not start');
    expect((deps.spawnConnectorProcess as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(deps.probeConnectorReady).toHaveBeenCalledWith('100.64.0.4', 8765);
  });

  it('surfaces a tracked Workbench-managed connector as ready when the bridge reports manual reachable status', async () => {
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const deps = depsWithResponses(
      {
        'connector-service status --json': [
          {
            ok: true,
            loaded: false,
            running: false,
            managed_by: 'offline',
            tailnet_ip: '100.64.0.4',
            health: { reachable: false, host: '100.64.0.4' },
            private_network: {
              client_installed: true,
              client_running: true,
              enrolled: true,
              correct_control_plane: true,
              acl_allowed: true,
              online: true,
            },
          },
          {
            ok: true,
            audit_id: 'audit-connector-ready',
            loaded: false,
            running: false,
            managed_by: 'workbench-or-manual',
            tailnet_ip: '100.64.0.4',
            health: { reachable: true, host: '100.64.0.4' },
            private_network: {
              client_installed: true,
              client_running: true,
              enrolled: true,
              correct_control_plane: true,
              acl_allowed: true,
              online: true,
            },
          },
          {
            ok: true,
            audit_id: 'audit-connector-status',
            loaded: false,
            running: false,
            managed_by: 'workbench-or-manual',
            tailnet_ip: '100.64.0.4',
            health: { reachable: true, host: '100.64.0.4' },
            private_network: {
              client_installed: true,
              client_running: true,
              enrolled: true,
              correct_control_plane: true,
              acl_allowed: true,
              online: true,
            },
          },
        ],
        'connector-service stop --json': {
          ok: true,
          action: 'stop',
        },
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
      readiness: 'repair_required',
      connectorService: {
        status: 'ready',
        running: true,
        reachable: true,
        managedBy: 'workbench-or-manual',
      },
    });
  });

  it('starts a Workbench-owned session connector only after launchd is proven offline', async () => {
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
            loaded: false,
            running: false,
            managed_by: statusCalls > 1 ? 'workbench-or-manual' : 'offline',
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
    expect(execFile).toHaveBeenCalledTimes(3);
    expect(execFile.mock.calls.map(([, callArgs]) => callArgs.join(' '))).not.toContain(
      'connector-service stop --json'
    );
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

  it('fails setup check closed when an otherwise-ready connector is reachable only on loopback', async () => {
    const ensureCustomerMacConnectorGrant = vi.fn();
    const deps = depsWithTypedReadyResponses(
      {
        'status --json': { ok: true, data: {} },
        'connector-service status --json': {
          ok: true,
          loaded: false,
          running: true,
          tailnet_ip: '127.0.0.1',
          health: { reachable: true, ready: true, host: '127.0.0.1' },
        },
        'customer-mac status --json': {
          ok: true,
          audit_id: 'audit-loopback-mac',
          data: {
            permissions: {
              accessibility: { status: 'granted' },
              screen_recording: { status: 'granted' },
            },
          },
        },
        'customer-mac control status --json': {
          ok: true,
          audit_id: 'audit-loopback-control',
          data: { ready: true, active: false, kill_switch: false },
        },
        'audit-tail --json --limit 12': {
          ok: true,
          data: { records: [{ audit_id: 'audit-loopback-mac' }, { audit_id: 'audit-loopback-control' }] },
        },
      },
      { ensureCustomerMacConnectorGrant }
    );

    const result = await runNativeCompanionAction({ action: 'setup_check', customerId: 'typed-ready-customer' }, deps);

    expect(result).toMatchObject({
      action: 'setup_check',
      status: 'repair_required',
      agentPairingStatus: 'not_ready',
      setup: { connectorReady: false, macReady: true, controlReady: true },
    });
    expect(ensureCustomerMacConnectorGrant).not.toHaveBeenCalled();
  });

  it('marks setup check as agent paired only when control status carries explicit proof', async () => {
    const deps = depsWithTypedReadyResponses({
      'status --json': { ok: true, data: {} },
      'connector-service status --json': {
        ok: true,
        running: true,
        tailnet_ip: '100.64.0.4',
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

    const result = await runNativeCompanionAction({ action: 'setup_check', customerId: 'typed-ready-customer' }, deps);

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
    const deps = depsWithTypedReadyResponses({
      'status --json': { ok: true, data: {} },
      'connector-service status --json': {
        ok: true,
        running: true,
        tailnet_ip: '100.64.0.4',
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

    const result = await runNativeCompanionAction({ action: 'setup_check', customerId: 'typed-ready-customer' }, deps);

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
    const deps = depsWithTypedReadyResponses({
      'status --json': { ok: true, data: {} },
      'connector-service status --json': {
        ok: true,
        running: true,
        tailnet_ip: '100.64.0.4',
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

    const result = await runNativeCompanionAction({ action: 'setup_check', customerId: 'typed-ready-customer' }, deps);

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
    const deps = depsWithTypedReadyResponses(
      {
        'status --json': { ok: true, data: {} },
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
    const deps = depsWithTypedReadyResponses(
      {
        'status --json': { ok: true, data: {} },
        'connector-service status --json': [
          {
            ok: true,
            loaded: true,
            running: true,
            health: { authenticated: true, reachable: true, ready: true },
            managed_by: 'launchagent',
            responsible_bundle_id: 'com.evaos.workbench',
            responsible_app_path: '/Applications/evaOS Workbench.app',
            process_path: bundledBridgePath,
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
    expect((deps.spawnConnectorProcess as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(deps.runConnectorCommand).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(/secret-token|100\.64\.0\.10|8765|token_path/i);
  });

  it('does not call the broker grant when typed prerequisite evidence is missing', async () => {
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
        'status --json': { ok: true, data: {} },
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
        'customer-mac status --json': {
          ok: true,
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
      status: 'repair_required',
      blockerReason: 'bundled_bridge_required',
    });
    expect(runConnectorCommand).not.toHaveBeenCalled();
    expect(ensureCustomerMacConnectorGrant).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/secret-token|connector_token|100\.64\.0\.4|8765|token_path/i);
  });

  it.each([
    ['LaunchAgent-managed', 'launchagent'],
    ['untracked Workbench/manual', 'workbench-or-manual'],
  ])(
    'preserves a stale %s connector before explicit first-party grant when replacement is unproven',
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
      const deps = depsWithTypedReadyResponses(
        {
          'status --json': { ok: true, data: {} },
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
        status: 'repair_required',
        sourcePointer: 'native-companion:connector-grant-workbench-session-start-required',
        blockerReason: 'listener_replacement_unproven',
      });
      expect(result.message).not.toMatch(/stop mac access|stop.*connector/i);
      expect(result.message).toMatch(/preserved/i);
      expect(result.message).toMatch(/refresh/i);
      expect(result.message).toMatch(/support/i);
      expect(JSON.stringify(result)).not.toMatch(/secret-token|connector_token|100\.64\.0\.10|8765/i);
      expect((deps.spawnConnectorProcess as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
      expect(runConnectorCommand).not.toHaveBeenCalled();
      expect(ensureCustomerMacConnectorGrant).not.toHaveBeenCalled();
      expect(
        (deps.execFile as ReturnType<typeof vi.fn>).mock.calls.map(([, callArgs]) => callArgs.join(' '))
      ).not.toContain('connector-service stop --json');
      expect(JSON.stringify(result)).not.toMatch(/secret-token|100\.64\.0\.10|8765|token_path/i);
    }
  );

  it('does not spawn or grant from an offline loopback-only connector in the customer grant flow', async () => {
    const spawnConnectorProcess = vi.fn(() => mockChildProcess());
    const ensureCustomerMacConnectorGrant = vi.fn();
    const deps = depsWithResponses(
      {
        'connector-service status --json': {
          ok: true,
          loaded: false,
          running: false,
          managed_by: 'offline',
          health: { reachable: false, ready: false, host: '127.0.0.1' },
        },
        'ready --json': { ok: false, ready: false, service: 'evaos-desktop-bridge-connector' },
      },
      { spawnConnectorProcess, ensureCustomerMacConnectorGrant }
    );

    const result = await runNativeCompanionAction(
      { action: 'ensure_customer_mac_connector_grant', customerId: 'golden' },
      deps
    );

    expect(result).toMatchObject({
      action: 'ensure_customer_mac_connector_grant',
      status: 'repair_required',
      blockerReason: 'not_workbench_managed',
    });
    expect(spawnConnectorProcess).not.toHaveBeenCalled();
    expect(ensureCustomerMacConnectorGrant).not.toHaveBeenCalled();
    expect(
      (deps.execFile as ReturnType<typeof vi.fn>).mock.calls.map(([, callArgs]) => callArgs.join(' '))
    ).not.toContain('connector-service stop --json');
  });

  it('does not create a pairing prompt when typed prerequisite evidence is missing', async () => {
    const createCustomerMacEnrollment = vi.fn(async () => ({
      customerId: 'golden',
      pairingCode: 'PAIR-1234',
      expiresAt: '2026-06-07T04:00:00.000Z',
    }));
    const deps = depsWithResponses(
      {
        'status --json': { ok: true, data: {} },
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
        createCustomerMacEnrollment,
      }
    );

    const result = await runNativeCompanionAction({ action: 'create_pairing_prompt', customerId: 'golden' }, deps);

    expect(result).toMatchObject({
      status: 'repair_required',
      blockerReason: 'bundled_bridge_required',
    });
    expect(createCustomerMacEnrollment).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /Bearer|desktop_session|provider_grant|access_token|refresh_token|connectorUrl|secret-token/i
    );
  });

  it('creates a pairing prompt when control-status permission proof supersedes stale customer status', async () => {
    const deps = depsWithTypedReadyResponses(
      {
        'status --json': { ok: true, data: {} },
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
    const deps = depsWithTypedReadyResponses(
      {
        'status --json': { ok: true, data: {} },
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
    const deps = depsWithTypedReadyResponses(
      {
        'status --json': { ok: true, data: {} },
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
    const deps = depsWithTypedReadyResponses(
      {
        'status --json': { ok: true, data: {} },
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
    expect(execFile).toHaveBeenCalledTimes(4);
    expect(execFile.mock.calls.map((call) => call[1])).toEqual(
      expect.arrayContaining([
        ['status', '--json'],
        ['connector-service', 'status', '--json'],
        ['customer-mac', 'status', '--json'],
      ])
    );
  });

  it('surfaces broker 403 enrollment denial without reconnect copy', async () => {
    const deps = depsWithTypedReadyResponses(
      {
        'status --json': { ok: true, data: {} },
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
    const deps = depsWithTypedReadyResponses(
      {
        'status --json': { ok: true, data: {} },
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
    expect(deps.execFile).toHaveBeenCalledTimes(2);
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

  it('opens the official secure-network download page without running a terminal command', async () => {
    const openExternal = vi.fn(async () => undefined);
    const deps = depsWithResponses({}, { openExternal });

    const result = await openNativeCompanionRepairAction({ action: 'secure_network_install' }, deps);

    expect(result).toMatchObject({
      opened: true,
      target: 'https://tailscale.com/download/mac',
    });
    expect(openExternal).toHaveBeenCalledWith('https://tailscale.com/download/mac');
    expect(deps.execFile).not.toHaveBeenCalled();
  });

  it('opens the installed secure-network app from an approved application path', async () => {
    const openPath = vi.fn(async () => '');
    const openExternal = vi.fn(async () => undefined);
    const deps = depsWithResponses(
      {},
      {
        existsSync: vi.fn((path: string) => path === '/Applications/Tailscale.app'),
        openPath,
        openExternal,
      }
    );

    const result = await openNativeCompanionRepairAction({ action: 'secure_network_open' }, deps);

    expect(result).toMatchObject({
      opened: true,
      target: '/Applications/Tailscale.app',
    });
    expect(openPath).toHaveBeenCalledWith('/Applications/Tailscale.app');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('fails closed when the secure-network app disappeared instead of opening an unpinned artifact', async () => {
    const openPath = vi.fn(async () => '');
    const openExternal = vi.fn(async () => undefined);
    const deps = depsWithResponses(
      {},
      {
        existsSync: vi.fn(() => false),
        openPath,
        openExternal,
      }
    );

    const result = await openNativeCompanionRepairAction({ action: 'secure_network_open' }, deps);

    expect(result).toMatchObject({ opened: false });
    expect(openPath).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('enrolls an unenrolled signed Tailscale client with file-backed one-use material', async () => {
    const authKey = 'one-use-private-network-key-for-test';
    const createPrivateNetworkEnrollment = vi.fn(async () => ({
      customerId: 'jackie-david',
      deviceId: 'device-david',
      deviceIdentifier: 'david-mac-hardware-id',
      grantId: 'grant-network-1',
      clientVariant: 'tailscale_app_store' as const,
      enrollmentId: 'network-enrollment-1',
      loginServer: 'https://headscale.example',
      authKey,
      expiresAt: '2026-06-07T04:00:00.000Z',
    }));
    const cancelPrivateNetworkEnrollment = vi.fn(async () => ({
      cancelled: true as const,
      enrollmentId: 'network-enrollment-1',
    }));
    let secretFilePath: string | undefined;
    let secretFileContents: string | undefined;
    const execFile = vi.fn(
      async (file: string, args: string[], options: { timeout: number; env?: NodeJS.ProcessEnv }) => {
        const key = args.join(' ');
        if (file === bundledBridgePath && key === 'connector-service status --json') {
          return {
            stdout: json({
              ok: true,
              data: {
                private_network: { client_installed: true, client_running: true, enrolled: false },
              },
            }),
            stderr: '',
          };
        }
        if (file === bundledBridgePath && key === 'customer-mac status --json') {
          return {
            stdout: json({ ok: true, data: { device: { hardware_uuid: 'david-mac-hardware-id' } } }),
            stderr: '',
          };
        }
        if (file === '/usr/bin/codesign' && args[0] === '--verify') {
          expect(args.find((arg) => arg.startsWith('-R='))).toContain(
            'anchor apple generic and certificate leaf[subject.OU] = "W5364U7YZB"'
          );
          expect(args.find((arg) => arg.startsWith('-R='))).toContain('identifier "io.tailscale.ipn.macos"');
          return { stdout: '', stderr: '' };
        }
        if (file === '/usr/bin/codesign' && args[0] === '-dv') {
          return {
            stdout: '',
            stderr: 'Identifier=io.tailscale.ipn.macos\nTeamIdentifier=W5364U7YZB\n',
          };
        }
        if (file === '/Applications/Tailscale.app/Contents/MacOS/Tailscale') {
          const authKeyArg = args.find((arg) => arg.startsWith('--auth-key=file:'));
          secretFilePath = authKeyArg?.slice('--auth-key=file:'.length);
          secretFileContents = secretFilePath ? fs.readFileSync(secretFilePath, 'utf8') : undefined;
          expect(args).toContain('--login-server=https://headscale.example');
          expect(args.join(' ')).not.toContain(authKey);
          expect(options.env?.TAILSCALE_BE_CLI).toBe('1');
          expect(options.env?.HOME).toBe('/custom/home');
          expect(options.env).not.toHaveProperty('AIONUI_EVAOS_DESKTOP_SESSION');
          return { stdout: '', stderr: '' };
        }
        throw new Error(`unexpected command ${file} ${key}`);
      }
    );
    const deps = depsWithResponses(
      {},
      {
        existsSync: vi.fn(
          (path: string) =>
            path === bundledBridgePath ||
            path === '/Applications/evaOS Workbench.app' ||
            path === '/Applications/Tailscale.app' ||
            path === '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
        ),
        execFile,
        env: {
          HOME: '/custom/home',
          AIONUI_EVAOS_DESKTOP_SESSION: 'must-not-leak',
        },
        createPrivateNetworkEnrollment,
        cancelPrivateNetworkEnrollment,
      }
    );

    const result = await runNativeCompanionAction(
      { action: 'secure_network_enroll', customerId: 'jackie-david' },
      deps
    );

    expect(result).toMatchObject({
      action: 'secure_network_enroll',
      status: 'succeeded',
      sourcePointer: 'native-companion:secure-network-enrollment-submitted',
      refreshRecommended: true,
      blockerReason: 'secure_network_link_required',
      bootstrapGrantId: 'grant-network-1',
    });
    expect(createPrivateNetworkEnrollment).toHaveBeenCalledWith({
      customerId: 'jackie-david',
      deviceIdentifier: 'david-mac-hardware-id',
      deviceName,
      clientVariant: 'tailscale_app_store',
    });
    expect(secretFileContents).toBe(authKey);
    expect(secretFilePath && fs.existsSync(secretFilePath)).toBe(false);
    expect(cancelPrivateNetworkEnrollment).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(authKey);
  });

  it('skips a spoofable system app and uses the first Apple-anchored Tailscale candidate', async () => {
    const systemApp = '/Applications/Tailscale.app';
    const userApp = join(homedir(), 'Applications', 'Tailscale.app');
    const userCommand = join(userApp, 'Contents', 'MacOS', 'Tailscale');
    const createPrivateNetworkEnrollment = vi.fn(async () => ({
      customerId: 'jackie-david',
      deviceId: 'device-david',
      deviceIdentifier: 'david-mac-hardware-id',
      clientVariant: 'tailscale_standalone' as const,
      enrollmentId: 'network-enrollment-1',
      loginServer: 'https://headscale.example',
      authKey: 'one-use-private-network-key-for-test',
      expiresAt: '2026-06-07T04:00:00.000Z',
    }));
    const execFile = vi.fn(async (file: string, args: string[]) => {
      const key = args.join(' ');
      if (file === bundledBridgePath && key === 'connector-service status --json') {
        return {
          stdout: json({
            ok: true,
            data: { private_network: { client_installed: true, client_running: true, enrolled: false } },
          }),
          stderr: '',
        };
      }
      if (file === bundledBridgePath && key === 'customer-mac status --json') {
        return {
          stdout: json({ ok: true, data: { device: { hardware_uuid: 'david-mac-hardware-id' } } }),
          stderr: '',
        };
      }
      if (file === '/usr/bin/codesign' && args[0] === '-dv') {
        return { stdout: '', stderr: 'Identifier=io.tailscale.ipn.macsys\nTeamIdentifier=W5364U7YZB\n' };
      }
      if (file === '/usr/bin/codesign' && args[0] === '--verify') {
        const candidate = args.at(-1);
        if (candidate === systemApp) throw new Error('metadata-only self-signed app');
        if (candidate === userApp) return { stdout: '', stderr: '' };
      }
      if (file === userCommand) return { stdout: '', stderr: '' };
      throw new Error(`unexpected command ${file} ${key}`);
    });
    const deps = depsWithResponses(
      {},
      {
        existsSync: vi.fn(
          (path: string) =>
            path === bundledBridgePath ||
            path === '/Applications/evaOS Workbench.app' ||
            path === systemApp ||
            path === join(systemApp, 'Contents', 'MacOS', 'Tailscale') ||
            path === userApp ||
            path === userCommand
        ),
        execFile,
        createPrivateNetworkEnrollment,
      }
    );

    const result = await runNativeCompanionAction(
      { action: 'secure_network_enroll', customerId: 'jackie-david' },
      deps
    );

    expect(result).toMatchObject({ status: 'succeeded' });
    expect(createPrivateNetworkEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ clientVariant: 'tailscale_standalone' })
    );
    expect(execFile).toHaveBeenCalledWith(
      userCommand,
      expect.arrayContaining(['--login-server=https://headscale.example']),
      expect.any(Object)
    );
  });

  it('cancels one-use enrollment when the local Tailscale login fails', async () => {
    const authKey = 'one-use-private-network-key-for-test';
    const createPrivateNetworkEnrollment = vi.fn(async () => ({
      customerId: 'jackie-david',
      deviceId: 'device-david',
      deviceIdentifier: 'david-hardware-id',
      clientVariant: 'tailscale_standalone' as const,
      enrollmentId: 'network-enrollment-1',
      loginServer: 'https://headscale.example',
      authKey,
      expiresAt: '2026-06-07T04:00:00.000Z',
    }));
    const cancelPrivateNetworkEnrollment = vi.fn(async () => ({
      cancelled: true as const,
      enrollmentId: 'network-enrollment-1',
    }));
    const execFile = vi.fn(async (file: string, args: string[]) => {
      const key = args.join(' ');
      if (file === bundledBridgePath && key === 'connector-service status --json') {
        return {
          stdout: json({
            ok: true,
            data: {
              private_network: { client_installed: true, client_running: true, enrolled: false },
            },
          }),
          stderr: '',
        };
      }
      if (file === bundledBridgePath && key === 'customer-mac status --json') {
        return {
          stdout: json({ ok: true, data: { device: { hardware_uuid: 'david-mac-hardware-id' } } }),
          stderr: '',
        };
      }
      if (file === '/usr/bin/codesign' && args[0] === '--verify') return { stdout: '', stderr: '' };
      if (file === '/usr/bin/codesign' && args[0] === '-dv') {
        return { stdout: '', stderr: 'Identifier=io.tailscale.ipn.macsys\nTeamIdentifier=W5364U7YZB\n' };
      }
      if (file === '/Applications/Tailscale.app/Contents/MacOS/Tailscale') {
        throw new Error('Tailscale login failed');
      }
      throw new Error(`unexpected command ${file} ${key}`);
    });
    const diagnosticEvents: string[] = [];
    const deps = depsWithResponses(
      {},
      {
        existsSync: vi.fn(
          (path: string) =>
            path === bundledBridgePath ||
            path === '/Applications/evaOS Workbench.app' ||
            path === '/Applications/Tailscale.app' ||
            path === '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
        ),
        execFile,
        createPrivateNetworkEnrollment,
        cancelPrivateNetworkEnrollment,
        recordDiagnosticEvent: (eventCode) => diagnosticEvents.push(eventCode),
      }
    );

    const result = await runNativeCompanionAction(
      { action: 'secure_network_enroll', customerId: 'jackie-david' },
      deps
    );

    expect(result).toMatchObject({
      status: 'repair_required',
      sourcePointer: 'native-companion:secure-network-enrollment-client-failed',
      refreshRecommended: false,
    });
    expect(cancelPrivateNetworkEnrollment).toHaveBeenCalledWith({
      customerId: 'jackie-david',
      enrollmentId: 'network-enrollment-1',
      authKey,
    });
    expect(JSON.stringify(result)).not.toContain(authKey);
    expect(diagnosticEvents).toEqual(['secure_network_enrollment_login_failed']);
    expect(JSON.stringify(diagnosticEvents)).not.toMatch(
      /auth-key|Tailscale login failed|one-use-private-network-key/i
    );
  });

  it.each([
    ['secret file', 'secure_network_enrollment_secret_unlink_failed'],
    ['secret directory', 'secure_network_enrollment_secret_directory_cleanup_failed'],
  ] as const)('records only a safe event code when %s cleanup is ambiguous', async (cleanupTarget, expectedEvent) => {
    const authKey = 'one-use-private-network-key-for-test';
    const createPrivateNetworkEnrollment = vi.fn(async () => ({
      customerId: 'jackie-david',
      deviceId: 'device-david',
      deviceIdentifier: 'david-mac-hardware-id',
      clientVariant: 'tailscale_standalone' as const,
      enrollmentId: 'network-enrollment-1',
      loginServer: 'https://headscale.example',
      authKey,
      expiresAt: '2026-06-07T04:00:00.000Z',
    }));
    const cancelPrivateNetworkEnrollment = vi.fn();
    const diagnosticEvents: string[] = [];
    let connectorStatusCalls = 0;
    const execFile = vi.fn(async (file: string, args: string[]) => {
      const key = args.join(' ');
      if (file === bundledBridgePath && key === 'connector-service status --json') {
        connectorStatusCalls += 1;
        return {
          stdout: json({
            ok: true,
            data: {
              private_network: {
                client_installed: true,
                client_running: true,
                enrolled: connectorStatusCalls >= 3,
              },
            },
          }),
          stderr: '',
        };
      }
      if (file === bundledBridgePath && key === 'customer-mac status --json') {
        return {
          stdout: json({ ok: true, data: { device: { hardware_uuid: 'david-mac-hardware-id' } } }),
          stderr: '',
        };
      }
      if (file === '/usr/bin/codesign' && args[0] === '-dv') {
        return { stdout: '', stderr: 'Identifier=io.tailscale.ipn.macsys\nTeamIdentifier=W5364U7YZB\n' };
      }
      if (file === '/usr/bin/codesign' && args[0] === '--verify') return { stdout: '', stderr: '' };
      if (file === '/Applications/Tailscale.app/Contents/MacOS/Tailscale') return { stdout: '', stderr: '' };
      throw new Error(`unexpected command ${file} ${key}`);
    });
    const cleanupOverrides: Partial<EvaosNativeCompanionStatusDeps> =
      cleanupTarget === 'secret file'
        ? {
            unlinkSync: (path) => {
              fs.unlinkSync(path);
              throw new Error('secret file cleanup failed after removal');
            },
          }
        : {
            rmSync: (path, options) => {
              fs.rmSync(path, options);
              throw new Error('secret directory cleanup failed after removal');
            },
          };
    const deps = depsWithResponses(
      {},
      {
        existsSync: vi.fn(
          (path: string) =>
            path === bundledBridgePath ||
            path === '/Applications/evaOS Workbench.app' ||
            path === '/Applications/Tailscale.app' ||
            path === '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
        ),
        execFile,
        createPrivateNetworkEnrollment,
        cancelPrivateNetworkEnrollment,
        recordDiagnosticEvent: (eventCode) => diagnosticEvents.push(eventCode),
        ...cleanupOverrides,
      }
    );

    const result = await runNativeCompanionAction(
      { action: 'secure_network_enroll', customerId: 'jackie-david' },
      deps
    );

    expect(result).toMatchObject({
      status: 'repair_required',
      sourcePointer: 'native-companion:secure-network-enrollment-cancel-unconfirmed',
    });
    expect(diagnosticEvents).toEqual([expectedEvent]);
    expect(JSON.stringify(diagnosticEvents)).not.toMatch(/auth-key|one-use-private-network-key|evaos-private-network/i);
    expect(cancelPrivateNetworkEnrollment).toHaveBeenCalled();
  });

  it('settles before cancellation when a failed CLI exit is followed by delayed enrolled local state', async () => {
    const authKey = 'one-use-private-network-key-for-test';
    const createPrivateNetworkEnrollment = vi.fn(async () => ({
      customerId: 'jackie-david',
      deviceId: 'device-david',
      deviceIdentifier: 'david-mac-hardware-id',
      clientVariant: 'tailscale_standalone' as const,
      enrollmentId: 'network-enrollment-1',
      loginServer: 'https://headscale.example',
      authKey,
      expiresAt: '2026-06-07T04:00:00.000Z',
    }));
    const cancelPrivateNetworkEnrollment = vi.fn();
    let connectorStatusCalls = 0;
    const execFile = vi.fn(async (file: string, args: string[]) => {
      const key = args.join(' ');
      if (file === bundledBridgePath && key === 'connector-service status --json') {
        connectorStatusCalls += 1;
        return {
          stdout: json({
            ok: true,
            data: {
              private_network: {
                client_installed: true,
                client_running: true,
                enrolled: connectorStatusCalls >= 4,
              },
            },
          }),
          stderr: '',
        };
      }
      if (file === bundledBridgePath && key === 'customer-mac status --json') {
        return {
          stdout: json({ ok: true, data: { device: { hardware_uuid: 'david-mac-hardware-id' } } }),
          stderr: '',
        };
      }
      if (file === '/usr/bin/codesign' && args[0] === '-dv') {
        return { stdout: '', stderr: 'Identifier=io.tailscale.ipn.macsys\nTeamIdentifier=W5364U7YZB\n' };
      }
      if (file === '/usr/bin/codesign' && args[0] === '--verify') return { stdout: '', stderr: '' };
      if (file === '/Applications/Tailscale.app/Contents/MacOS/Tailscale') {
        throw new Error('ambiguous Tailscale exit');
      }
      throw new Error(`unexpected command ${file} ${key}`);
    });
    const recordDiagnosticEvent = vi.fn();
    const deps = depsWithResponses(
      {},
      {
        existsSync: vi.fn(
          (path: string) =>
            path === bundledBridgePath ||
            path === '/Applications/evaOS Workbench.app' ||
            path === '/Applications/Tailscale.app' ||
            path === '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
        ),
        execFile,
        createPrivateNetworkEnrollment,
        cancelPrivateNetworkEnrollment,
        recordDiagnosticEvent,
      }
    );

    const result = await runNativeCompanionAction(
      { action: 'secure_network_enroll', customerId: 'jackie-david' },
      deps
    );

    expect(result).toMatchObject({
      status: 'succeeded',
      sourcePointer: 'native-companion:secure-network-enrollment-submitted',
      blockerReason: 'secure_network_link_required',
    });
    expect(cancelPrivateNetworkEnrollment).not.toHaveBeenCalled();
    expect(recordDiagnosticEvent).toHaveBeenCalledWith('secure_network_enrollment_login_failed');
    expect(deps.sleep).toHaveBeenCalledWith(250);
    expect(JSON.stringify(result)).not.toContain(authKey);
  });

  it('cancels before invoking Tailscale when local enrollment changes after broker mint', async () => {
    const authKey = 'one-use-private-network-key-for-test';
    const createPrivateNetworkEnrollment = vi.fn(async () => ({
      customerId: 'jackie-david',
      deviceId: 'device-david',
      deviceIdentifier: 'david-hardware-id',
      clientVariant: 'tailscale_standalone' as const,
      enrollmentId: 'network-enrollment-1',
      loginServer: 'https://headscale.example',
      authKey,
      expiresAt: '2026-06-07T04:00:00.000Z',
    }));
    const cancelPrivateNetworkEnrollment = vi.fn(async () => ({
      cancelled: true as const,
      enrollmentId: 'network-enrollment-1',
    }));
    let connectorStatusCalls = 0;
    let tailscaleCalls = 0;
    const execFile = vi.fn(async (file: string, args: string[]) => {
      const key = args.join(' ');
      if (file === bundledBridgePath && key === 'connector-service status --json') {
        connectorStatusCalls += 1;
        return {
          stdout: json({
            ok: true,
            data: {
              private_network: {
                client_installed: true,
                client_running: true,
                enrolled: connectorStatusCalls > 1,
              },
            },
          }),
          stderr: '',
        };
      }
      if (file === bundledBridgePath && key === 'customer-mac status --json') {
        return {
          stdout: json({ ok: true, data: { device: { hardware_uuid: 'david-mac-hardware-id' } } }),
          stderr: '',
        };
      }
      if (file === '/usr/bin/codesign' && args[0] === '-dv') {
        return { stdout: '', stderr: 'Identifier=io.tailscale.ipn.macsys\nTeamIdentifier=W5364U7YZB\n' };
      }
      if (file === '/usr/bin/codesign' && args[0] === '--verify') return { stdout: '', stderr: '' };
      if (file === '/Applications/Tailscale.app/Contents/MacOS/Tailscale') {
        tailscaleCalls += 1;
        return { stdout: '', stderr: '' };
      }
      throw new Error(`unexpected command ${file} ${key}`);
    });
    const deps = depsWithResponses(
      {},
      {
        existsSync: vi.fn(
          (path: string) =>
            path === bundledBridgePath ||
            path === '/Applications/evaOS Workbench.app' ||
            path === '/Applications/Tailscale.app' ||
            path === '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
        ),
        execFile,
        createPrivateNetworkEnrollment,
        cancelPrivateNetworkEnrollment,
      }
    );

    const result = await runNativeCompanionAction(
      { action: 'secure_network_enroll', customerId: 'jackie-david' },
      deps
    );

    expect(result).toMatchObject({
      status: 'repair_required',
      sourcePointer: 'native-companion:secure-network-enrollment-state-changed',
      refreshRecommended: true,
    });
    expect(cancelPrivateNetworkEnrollment).toHaveBeenCalledWith({
      customerId: 'jackie-david',
      enrollmentId: 'network-enrollment-1',
      authKey,
    });
    expect(tailscaleCalls).toBe(0);
  });

  it('does not mint another key when local private-network state is already enrolled', async () => {
    const createPrivateNetworkEnrollment = vi.fn();
    const deps = depsWithResponses(
      {
        'connector-service status --json': {
          ok: true,
          data: { private_network: { client_installed: true, client_running: true, enrolled: true } },
        },
        'customer-mac status --json': {
          ok: true,
          data: { device: { hardware_uuid: 'david-mac-hardware-id' } },
        },
      },
      { createPrivateNetworkEnrollment }
    );

    const result = await runNativeCompanionAction(
      { action: 'secure_network_enroll', customerId: 'jackie-david' },
      deps
    );

    expect(result).toMatchObject({
      status: 'repair_required',
      sourcePointer: 'native-companion:secure-network-enrollment-state-changed',
    });
    expect(createPrivateNetworkEnrollment).not.toHaveBeenCalled();
  });
});
