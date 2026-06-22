/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  IEvaosNativeCompanionActionRequest,
  IEvaosNativeCompanionActionResult,
  IEvaosNativeCompanionAgentPairingStatus,
  IEvaosNativeCompanionAuditEvent,
  IEvaosNativeCompanionControlMode,
  IEvaosNativeCompanionOpenResult,
  IEvaosNativeCompanionPermissionView,
  IEvaosNativeCompanionRepairActionRequest,
  IEvaosNativeCompanionRepairActionResult,
  IEvaosNativeCompanionStatusView,
} from '@/common/evaos/bridgeTypes';
import { getDefaultEvaosBrokerSessionClient, isEvaosBrokerSessionError } from './evaosBrokerSession';

const execFileAsync = promisify(execFileCallback);

const HOMEBREW_BRIDGE_PATHS = ['/opt/homebrew/bin/evaos-desktop-bridge', '/usr/local/bin/evaos-desktop-bridge'];
const DEFAULT_RELEASED_WORKBENCH_PATH = '/Applications/evaOS.app';
const COMMAND_TIMEOUT_MS = 8000;
const NATIVE_COMPANION_FIXTURE_STATES = [
  'ready',
  'repair_required',
  'not_paired',
  'permission_needed',
  'offline',
] as const;

type ExecFileResult = {
  stdout: string;
  stderr: string;
};

type NativeCompanionFixtureState = (typeof NATIVE_COMPANION_FIXTURE_STATES)[number];

export type EvaosNativeCompanionStatusDeps = {
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  bridgePaths?: string[];
  releasedWorkbenchPath?: string;
  existsSync?: (path: string) => boolean;
  execFile?: (file: string, args: string[], options: { timeout: number }) => Promise<ExecFileResult>;
  openPath?: (path: string) => Promise<string>;
  openExternal?: (url: string) => Promise<void>;
  createCustomerMacEnrollment?: (request: {
    customerId: string;
    deviceName?: string;
  }) => Promise<{ customerId: string; pairingCode: string; expiresAt?: string }>;
};

type BridgePayload = {
  ok?: boolean;
  audit_id?: string;
  data?: Record<string, unknown>;
  errors?: Array<Record<string, unknown>>;
  code?: string;
  error_code?: string;
  message?: string;
  error?: string | Record<string, unknown>;
};

type BridgeCommandResult = {
  ok: boolean;
  auditId?: string;
  data?: Record<string, unknown>;
  errors?: Array<Record<string, unknown>>;
  errorCode?: string;
  errorMessage?: string;
};

export async function getEvaosNativeCompanionStatus(
  deps: EvaosNativeCompanionStatusDeps = {}
): Promise<IEvaosNativeCompanionStatusView> {
  const now = deps.now ?? (() => new Date());
  const fixtureState = nativeCompanionFixtureState(deps.env);
  const generatedAt = now().toISOString();
  if (fixtureState) {
    return nativeCompanionFixtureStatus(fixtureState, generatedAt);
  }

  const existsSync = deps.existsSync ?? fs.existsSync;
  const bridgePath = resolveBridgeExecutable(deps.bridgePaths ?? defaultBridgePaths(deps.env), existsSync);
  const releasedWorkbenchPath = deps.releasedWorkbenchPath ?? DEFAULT_RELEASED_WORKBENCH_PATH;
  const releasedWorkbenchInstalled = existsSync(releasedWorkbenchPath);

  if (!bridgePath) {
    return {
      schemaVersion: 'evaos.native_companion_status.v1',
      generatedAt,
      readiness: 'repair_required',
      agentPairingStatus: 'not_ready',
      summaryText: 'Workbench connector tools are not installed. Use setup or support to repair Mac control.',
      sourcePointer: 'native-companion:bridge-cli-missing',
      canOpenReleasedWorkbench: releasedWorkbenchInstalled,
      releasedWorkbench: {
        installed: releasedWorkbenchInstalled,
        path: releasedWorkbenchInstalled ? releasedWorkbenchPath : undefined,
      },
      bridgeCli: {
        installed: false,
        status: 'missing',
        readOnly: true,
      },
      connectorService: { status: 'missing' },
      customerMac: { status: 'unavailable' },
      iPhone: { status: 'unavailable' },
      controlSession: { status: 'unavailable' },
      audit: { status: 'unavailable', auditIds: [] },
    };
  }

  const [bridge, connectorService, customerMac, iPhone, controlSession, audit] = await Promise.all([
    runBridgeCommand(bridgePath, ['status', '--json'], deps),
    runBridgeCommand(bridgePath, ['connector-service', 'status', '--json'], deps),
    runBridgeCommand(bridgePath, ['customer-mac', 'status', '--json'], deps),
    runBridgeCommand(bridgePath, ['customer-mac', 'iphone-mirroring', 'status', '--json'], deps),
    runBridgeCommand(bridgePath, ['customer-mac', 'control', 'status', '--json'], deps),
    runBridgeCommand(bridgePath, ['audit-tail', '--json', '--limit', '5'], deps),
  ]);

  const bridgePermissions = permissionView(bridge.data?.permissions);
  const customerMacPermissions = permissionView(customerMac.data?.permissions);
  const bridgeReady = bridge.ok && hasGrantedCorePermissions(bridgePermissions);
  const connectorServiceReady = connectorService.ok && connectorServiceIsRunning(connectorService.data);
  const customerMacReady = customerMac.ok && hasGrantedCorePermissions(customerMacPermissions);
  const readiness = bridgeReady && connectorServiceReady && customerMacReady ? 'ready' : 'repair_required';
  const auditIds = auditIdsFromPayload(audit);
  const agentPairingStatus = agentPairingStatusFromStatus(readiness, controlSession.data);

  return {
    schemaVersion: 'evaos.native_companion_status.v1',
    generatedAt,
    readiness,
    agentPairingStatus,
    summaryText:
      readiness === 'ready'
        ? agentPairingStatus === 'agent_paired'
          ? 'Workbench connector ready with agent pairing proof.'
          : 'Workbench connector ready for code-only agent pairing.'
        : 'Workbench connector repair is required before evaOS or Hermes can use Mac control.',
    sourcePointer: 'native-companion:read-only-bridge',
    canOpenReleasedWorkbench: releasedWorkbenchInstalled,
    releasedWorkbench: {
      installed: releasedWorkbenchInstalled,
      path: releasedWorkbenchInstalled ? releasedWorkbenchPath : undefined,
    },
    bridgeCli: {
      installed: true,
      status: bridgeReady ? 'ready' : bridge.ok ? 'repair_required' : 'error',
      path: bridgePath,
      version: readString(bridge.data, 'version') ?? readString(bridge.data, 'bridge_version'),
      auditId: bridge.auditId,
      permissions: bridgePermissions,
      readOnly: readBoolean(bridge.data?.safety, 'read_only') !== false,
    },
    connectorService: {
      status: connectorServiceReady ? 'ready' : connectorService.ok ? 'repair_required' : 'error',
      running: readBoolean(connectorService.data, 'running'),
      reachable: readNestedBoolean(connectorService.data, ['health', 'reachable']),
      managedBy: readString(connectorService.data, 'managed_by'),
      tailnetIp: readString(connectorService.data, 'tailnet_ip'),
      permissionTarget: readString(connectorService.data, 'permission_target'),
    },
    customerMac: {
      status: customerMacReady ? 'ready' : customerMac.ok ? 'repair_required' : 'error',
      auditId: customerMac.auditId,
      deviceLabel: readNestedString(customerMac.data, ['device', 'hostname']),
      permissions: customerMacPermissions,
      screenSharing: screenSharingSummary(customerMac.data?.screen_sharing),
      killSwitchAvailable: readBoolean(customerMac.data?.safety, 'kill_switch_available'),
      appendOnlyAuditLog: readBoolean(customerMac.data?.safety, 'append_only_audit_log'),
    },
    iPhone: {
      status: iPhone.ok ? 'available' : 'unavailable',
      auditId: iPhone.auditId,
      installed: readBoolean(iPhone.data, 'installed'),
      running: readBoolean(iPhone.data, 'running'),
      killSwitchAvailable: readBoolean(iPhone.data?.safety, 'kill_switch_available'),
    },
    controlSession: {
      status: controlSession.ok ? 'ready' : 'unavailable',
      auditId: controlSession.auditId,
      active: readBoolean(controlSession.data, 'active'),
      mode: controlModeFromPayload(controlSession.data),
      killSwitch: readBoolean(controlSession.data, 'kill_switch'),
    },
    audit: {
      status: audit.ok ? 'ready' : 'unavailable',
      auditIds,
      latestAuditId: auditIds[0],
    },
  };
}

function nativeCompanionFixtureState(env: NodeJS.ProcessEnv = process.env): NativeCompanionFixtureState | undefined {
  if (env.AIONUI_E2E_TEST !== '1' || env.AIONUI_EVAOS_LOCAL_PRODUCT_FIXTURE !== '1') return undefined;
  const requested = env.AIONUI_EVAOS_NATIVE_COMPANION_STATUS_FIXTURE || 'ready';
  return NATIVE_COMPANION_FIXTURE_STATES.includes(requested as NativeCompanionFixtureState)
    ? (requested as NativeCompanionFixtureState)
    : 'ready';
}

function nativeCompanionFixtureStatus(
  fixtureState: NativeCompanionFixtureState,
  generatedAt: string
): IEvaosNativeCompanionStatusView {
  const auditIds = [
    `fixture-audit-native-${fixtureState}`,
    `fixture-audit-native-bridge-${fixtureState}`,
    `fixture-audit-native-mac-${fixtureState}`,
  ];
  const base: IEvaosNativeCompanionStatusView = {
    schemaVersion: 'evaos.native_companion_status.v1',
    generatedAt,
    readiness: 'repair_required',
    agentPairingStatus: 'not_ready',
    summaryText: 'LOCAL FIXTURE - NOT LIVE BETA PROOF: Native companion repair state fixture.',
    sourcePointer: `local-fixture:native-companion:${fixtureState}`,
    canOpenReleasedWorkbench: true,
    releasedWorkbench: {
      installed: true,
      running: false,
      path: DEFAULT_RELEASED_WORKBENCH_PATH,
      version: '0.6.27',
      displayName: 'evaOS.app',
    },
    bridgeCli: {
      installed: true,
      status: 'repair_required',
      path: defaultBridgePaths()[0],
      auditId: auditIds[1],
      permissions: {
        accessibility: 'granted',
        screenRecording: 'granted',
      },
      readOnly: true,
    },
    connectorService: {
      status: 'repair_required',
      running: fixtureState === 'ready',
      reachable: fixtureState === 'ready',
      managedBy: 'fixture',
      tailnetIp: '100.64.0.10',
      permissionTarget: 'evaOS Workbench',
    },
    customerMac: {
      status: 'repair_required',
      auditId: auditIds[2],
      deviceLabel: 'fixture-mac.local',
      permissions: {
        accessibility: 'granted',
        screenRecording: 'granted',
      },
      screenSharing: 'enabled=true; vnc_5900_listening=false',
      killSwitchAvailable: true,
      appendOnlyAuditLog: true,
    },
    iPhone: {
      status: 'available',
      auditId: `fixture-audit-native-iphone-${fixtureState}`,
      installed: true,
      running: false,
      killSwitchAvailable: true,
    },
    controlSession: {
      status: 'ready',
      auditId: `fixture-audit-native-control-${fixtureState}`,
      active: false,
      mode: 'ask-permission',
      killSwitch: false,
    },
    audit: {
      status: 'ready',
      auditIds,
      latestAuditId: auditIds[0],
    },
  };

  if (fixtureState === 'ready') {
    return {
      ...base,
      readiness: 'ready',
      agentPairingStatus: 'ready_for_agent_pairing',
      summaryText: 'LOCAL FIXTURE - NOT LIVE BETA PROOF: Native companion ready from fixture proof.',
      bridgeCli: { ...base.bridgeCli, status: 'ready' },
      connectorService: { ...base.connectorService, status: 'ready', running: true, reachable: true },
      customerMac: { ...base.customerMac, status: 'ready' },
    };
  }

  if (fixtureState === 'not_paired') {
    return {
      ...base,
      summaryText:
        'LOCAL FIXTURE - NOT LIVE BETA PROOF: NOT_PAIRED: pairing required before evaOS or Hermes can use Mac control.',
    };
  }

  if (fixtureState === 'permission_needed') {
    return {
      ...base,
      summaryText:
        'LOCAL FIXTURE - NOT LIVE BETA PROOF: Screen Recording permission is required before repair can continue.',
      bridgeCli: {
        ...base.bridgeCli,
        permissions: {
          accessibility: 'granted',
          screenRecording: 'missing',
        },
      },
      customerMac: {
        ...base.customerMac,
        permissions: {
          accessibility: 'granted',
          screenRecording: 'missing',
        },
      },
    };
  }

  if (fixtureState === 'offline') {
    return {
      ...base,
      readiness: 'unavailable',
      summaryText: 'LOCAL FIXTURE - NOT LIVE BETA PROOF: Native status source is offline or stale.',
      bridgeCli: { ...base.bridgeCli, status: 'unavailable' },
      connectorService: { ...base.connectorService, status: 'unavailable', running: false, reachable: false },
      customerMac: { ...base.customerMac, status: 'unavailable' },
      iPhone: { ...base.iPhone, status: 'unavailable', running: false },
      controlSession: { ...base.controlSession, status: 'unavailable', active: false },
      audit: {
        status: 'unavailable',
        auditIds,
        latestAuditId: auditIds[0],
      },
    };
  }

  return {
    ...base,
    summaryText: 'LOCAL FIXTURE - NOT LIVE BETA PROOF: Native companion repair is required before chat can start.',
  };
}

async function runCommandAction(
  action: IEvaosNativeCompanionActionRequest['action'],
  bridgePath: string,
  args: string[],
  deps: EvaosNativeCompanionStatusDeps,
  options: {
    successMessage: string;
    failureMessage: string;
    includeControl?: boolean;
  }
): Promise<IEvaosNativeCompanionActionResult> {
  const result = await runBridgeCommand(bridgePath, args, deps);
  return nativeActionResult(
    action,
    result.ok ? 'succeeded' : 'repair_required',
    result.ok ? options.successMessage : options.failureMessage,
    {
      sourcePointer: `native-companion:${args.slice(0, 3).join('-')}`,
      auditId: result.auditId,
      auditIds: compactStrings([result.auditId]),
      control: options.includeControl ? controlSummaryFromPayload(result.data) : undefined,
    }
  );
}

async function runConnectorStartAction(
  bridgePath: string,
  deps: EvaosNativeCompanionStatusDeps
): Promise<IEvaosNativeCompanionActionResult> {
  const started = await runBridgeCommand(bridgePath, ['connector-service', 'start', '--json'], deps);
  const status = await runBridgeCommand(bridgePath, ['connector-service', 'status', '--json'], deps);
  const ready = status.ok && connectorServiceIsRunning(status.data);
  if (ready) {
    return nativeActionResult(
      'connector_start',
      'succeeded',
      started.ok
        ? 'Mac Access connector is running and reachable.'
        : 'Mac Access connector was already running and reachable after start reconciliation.',
      {
        sourcePointer: 'native-companion:connector-service-start',
        auditId: status.auditId ?? started.auditId,
        auditIds: compactStrings([status.auditId, started.auditId]),
      }
    );
  }

  const detail = bridgeFailureDetail(
    started.ok ? status : started,
    'The connector did not report a reachable local service after start.'
  );
  return nativeActionResult('connector_start', 'repair_required', `Mac Access connector could not start. ${detail}`, {
    sourcePointer: 'native-companion:connector-service-start',
    auditId: status.auditId ?? started.auditId,
    auditIds: compactStrings([status.auditId, started.auditId]),
  });
}

async function runSetupCheckAction(
  bridgePath: string,
  deps: EvaosNativeCompanionStatusDeps
): Promise<IEvaosNativeCompanionActionResult> {
  const [connectorService, customerMac, controlSession, audit] = await Promise.all([
    runBridgeCommand(bridgePath, ['connector-service', 'status', '--json'], deps),
    runBridgeCommand(bridgePath, ['customer-mac', 'status', '--json'], deps),
    runBridgeCommand(bridgePath, ['customer-mac', 'control', 'status', '--json'], deps),
    runBridgeCommand(bridgePath, ['audit-tail', '--json', '--limit', '12'], deps),
  ]);
  const permissions = permissionView(customerMac.data?.permissions);
  const setup = {
    connectorReady: connectorService.ok && connectorServiceIsRunning(connectorService.data),
    macReady: customerMac.ok && hasGrantedCorePermissions(permissions),
    controlReady: controlSession.ok,
    iPhoneDeferred: true,
  };
  const ready = setup.connectorReady && setup.macReady && setup.controlReady;
  const auditIds = compactStrings([customerMac.auditId, controlSession.auditId, ...auditIdsFromPayload(audit)]);
  const agentPairingStatus = ready ? agentPairingStatusFromStatus('ready', controlSession.data) : 'not_ready';
  return nativeActionResult(
    'setup_check',
    ready ? 'succeeded' : 'repair_required',
    ready
      ? 'Mac control setup check passed. evaOS and Hermes can use the paired Workbench connector.'
      : 'Mac control setup needs repair before evaOS or Hermes can use this Workbench connector.',
    {
      sourcePointer: 'native-companion:setup-check',
      auditId: auditIds[0],
      auditIds,
      setup,
      control: controlSummaryFromPayload(controlSession.data),
      agentPairingStatus,
    }
  );
}

async function runAuditTailAction(
  bridgePath: string,
  deps: EvaosNativeCompanionStatusDeps
): Promise<IEvaosNativeCompanionActionResult> {
  const result = await runBridgeCommand(bridgePath, ['audit-tail', '--json', '--limit', '12'], deps);
  const events = auditEventsFromPayload(result);
  const auditIds = compactStrings([...events.map((event) => event.id), result.auditId]);
  return nativeActionResult(
    'audit_tail',
    result.ok ? 'succeeded' : 'repair_required',
    result.ok ? 'Recent Mac control audit records loaded.' : 'Mac control audit records are unavailable.',
    {
      sourcePointer: 'native-companion:audit-tail',
      auditId: auditIds[0],
      auditIds,
      events,
      refreshRecommended: false,
    }
  );
}

async function createPairingPromptAction(
  request: IEvaosNativeCompanionActionRequest,
  bridgePath: string,
  deps: EvaosNativeCompanionStatusDeps
): Promise<IEvaosNativeCompanionActionResult> {
  const customerId = request.customerId?.trim();
  if (!customerId) {
    return nativeActionResult(
      'create_pairing_prompt',
      'repair_required',
      'Choose a customer before creating a pairing prompt.',
      {
        sourcePointer: 'native-companion:pairing-missing-customer',
      }
    );
  }

  const connector = await runBridgeCommand(bridgePath, ['connector-service', 'status', '--json'], deps);
  if (!connector.ok || !connectorServiceIsRunning(connector.data)) {
    return nativeActionResult(
      'create_pairing_prompt',
      'repair_required',
      'Start Mac Access and confirm the secure connector is reachable before creating a pairing prompt.',
      {
        sourcePointer: 'native-companion:pairing-connector-not-ready',
      }
    );
  }

  const customerMac = await runBridgeCommand(bridgePath, ['customer-mac', 'status', '--json'], deps);
  const permissions = permissionView(customerMac.data?.permissions);
  if (permissions && !hasGrantedCorePermissions(permissions)) {
    return nativeActionResult(
      'create_pairing_prompt',
      'repair_required',
      'Mac Access needs Accessibility and Screen Recording before Workbench can create an agent pairing prompt.',
      {
        sourcePointer: 'native-companion:pairing-mac-permission-required',
        auditId: customerMac.auditId,
        auditIds: compactStrings([customerMac.auditId]),
      }
    );
  }

  const createEnrollment =
    deps.createCustomerMacEnrollment ??
    ((input) => getDefaultEvaosBrokerSessionClient().createCustomerMacEnrollment(input));
  const deviceName = hostname() || 'Customer Mac';
  let enrollment: { customerId: string; pairingCode: string; expiresAt?: string };
  try {
    enrollment = await createEnrollment({
      customerId,
      deviceName,
    });
  } catch (error) {
    if (isBrokerSessionReconnectRequired(error)) {
      return nativeActionResult(
        'create_pairing_prompt',
        'repair_required',
        'Mac control is ready locally, but Workbench needs a fresh evaOS session before it can create a pairing code. Sign in again, then retry.',
        {
          sourcePointer: 'native-companion:pairing-broker-session-required',
          agentPairingStatus: 'ready_for_agent_pairing',
          refreshRecommended: false,
        }
      );
    }
    throw error;
  }
  const registration = await runBridgeCommand(
    bridgePath,
    [
      'connector-service',
      'complete-enrollment',
      '--json',
      '--enrollment-code',
      enrollment.pairingCode,
      '--customer-id',
      enrollment.customerId,
      '--device-name',
      deviceName,
    ],
    deps
  );
  if (!registration.ok) {
    const detail = bridgeFailureDetail(
      registration,
      'The local connector could not register with evaOS. Run setup check, then reconnect Workbench if this repeats.'
    );
    return nativeActionResult(
      'create_pairing_prompt',
      'repair_required',
      `Workbench created a pairing code, but the local connector could not register it with evaOS. ${detail}`,
      {
        sourcePointer: 'native-companion:pairing-registration-failed',
        auditId: registration.auditId,
        auditIds: compactStrings([registration.auditId]),
        agentPairingStatus: 'proof_failed',
      }
    );
  }
  const setupPrompt = pairingPromptText({
    customerId: enrollment.customerId,
    pairingCode: enrollment.pairingCode,
  });

  return nativeActionResult(
    'create_pairing_prompt',
    'succeeded',
    'Pairing prompt is ready. Paste it into evaOS/OpenClaw or Hermes to complete the link.',
    {
      sourcePointer: 'native-companion:pairing-prompt',
      auditId: registration.auditId,
      pairing: {
        customerId: enrollment.customerId,
        pairingCode: enrollment.pairingCode,
        expiresAt: enrollment.expiresAt,
        setupPrompt,
      },
      agentPairingStatus: 'pairing_prompt_created',
      refreshRecommended: false,
    }
  );
}

function isBrokerSessionReconnectRequired(error: unknown): boolean {
  if (!isEvaosBrokerSessionError(error)) return false;
  if (error.code === 'missing_session' || error.code === 'expired_session') return true;
  return error.code === 'broker_http_error' && (error.status === 401 || error.status === 403);
}

async function primeRepairPermission(
  action: IEvaosNativeCompanionRepairActionRequest['action'],
  deps: EvaosNativeCompanionStatusDeps
): Promise<void> {
  const existsSync = deps.existsSync ?? fs.existsSync;
  const bridgePath = resolveBridgeExecutable(deps.bridgePaths ?? defaultBridgePaths(deps.env), existsSync);
  if (!bridgePath) return;
  if (action === 'accessibility') {
    await runBridgeCommand(bridgePath, ['permissions', 'prime', '--json', '--permission', 'accessibility'], deps);
  }
  if (action === 'screen_recording') {
    await runBridgeCommand(bridgePath, ['permissions', 'prime', '--json', '--permission', 'screen-recording'], deps);
  }
}

export async function openReleasedEvaosWorkbench(
  deps: EvaosNativeCompanionStatusDeps = {}
): Promise<IEvaosNativeCompanionOpenResult> {
  const releasedWorkbenchPath = deps.releasedWorkbenchPath ?? DEFAULT_RELEASED_WORKBENCH_PATH;
  const existsSync = deps.existsSync ?? fs.existsSync;
  if (!existsSync(releasedWorkbenchPath)) {
    return {
      opened: false,
      message: 'Released evaOS Workbench fallback is not installed.',
    };
  }

  const openPath = deps.openPath ?? defaultOpenPath;
  const error = await openPath(releasedWorkbenchPath);
  if (error) {
    return {
      opened: false,
      path: releasedWorkbenchPath,
      message: error,
    };
  }

  return {
    opened: true,
    path: releasedWorkbenchPath,
    message: 'Opened released evaOS Workbench for native pairing and repair.',
  };
}

export async function runNativeCompanionAction(
  request: IEvaosNativeCompanionActionRequest,
  deps: EvaosNativeCompanionStatusDeps = {}
): Promise<IEvaosNativeCompanionActionResult> {
  const existsSync = deps.existsSync ?? fs.existsSync;
  const bridgePath = resolveBridgeExecutable(deps.bridgePaths ?? defaultBridgePaths(deps.env), existsSync);
  if (!bridgePath) {
    return nativeActionResult(request.action, 'repair_required', 'Workbench connector tools are not installed.', {
      sourcePointer: 'native-companion:bridge-cli-missing',
    });
  }

  switch (request.action) {
    case 'connector_start':
      return runConnectorStartAction(bridgePath, deps);
    case 'connector_stop':
      return runCommandAction(request.action, bridgePath, ['connector-service', 'stop', '--json'], deps, {
        successMessage: 'Mac Access connector stopped.',
        failureMessage: 'Mac Access connector could not stop.',
      });
    case 'setup_check':
      return runSetupCheckAction(bridgePath, deps);
    case 'control_status':
      return runCommandAction(request.action, bridgePath, ['customer-mac', 'control', 'status', '--json'], deps, {
        successMessage: 'Agent control status refreshed.',
        failureMessage: 'Agent control status is unavailable.',
        includeControl: true,
      });
    case 'control_start': {
      const mode = normalizeControlMode(request.mode);
      return runCommandAction(
        request.action,
        bridgePath,
        [
          'customer-mac',
          'control',
          'start',
          '--json',
          '--mode',
          mode,
          '--agent-label',
          safeAgentLabel(request.agentLabel),
        ],
        deps,
        {
          successMessage:
            mode === 'ask-permission'
              ? 'Ask Permission agent control is active.'
              : 'Full Access agent control is active.',
          failureMessage: 'Agent control could not start.',
          includeControl: true,
        }
      );
    }
    case 'control_stop':
      return runCommandAction(request.action, bridgePath, ['customer-mac', 'control', 'stop', '--json'], deps, {
        successMessage: 'Agent control stopped.',
        failureMessage: 'Agent control could not stop.',
        includeControl: true,
      });
    case 'kill_switch':
      return runCommandAction(request.action, bridgePath, ['customer-mac', 'control', 'kill-switch', '--json'], deps, {
        successMessage: 'Kill switch is active. Agents are blocked until a new control session starts.',
        failureMessage: 'Kill switch could not be activated.',
        includeControl: true,
      });
    case 'audit_tail':
      return runAuditTailAction(bridgePath, deps);
    case 'create_pairing_prompt':
      return createPairingPromptAction(request, bridgePath, deps);
    default:
      return nativeActionResult(request.action, 'unsupported', 'Workbench connector action is not supported.', {
        sourcePointer: 'native-companion:unsupported-action',
      });
  }
}

export async function openNativeCompanionRepairAction(
  request: IEvaosNativeCompanionRepairActionRequest,
  deps: EvaosNativeCompanionStatusDeps = {}
): Promise<IEvaosNativeCompanionRepairActionResult> {
  if (request.action === 'released_workbench_fallback') {
    const result = await openReleasedEvaosWorkbench(deps);
    return {
      opened: result.opened,
      target: result.path,
      message: result.message,
    };
  }

  const target = systemSettingsUrlForRepairAction(request.action);
  await primeRepairPermission(request.action, deps);
  const openExternal = deps.openExternal ?? defaultOpenExternal;
  await openExternal(target);
  return {
    opened: true,
    target,
    message:
      request.action === 'accessibility'
        ? 'Opened macOS Accessibility permissions for evaOS Workbench.'
        : 'Opened macOS Screen Recording permissions for evaOS Workbench.',
  };
}

function defaultBridgePaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const resourcesPath = readProcessResourcesPath();
  return compactStrings([
    env.EVAOS_DESKTOP_BRIDGE_PATH,
    env.EVAOS_WORKBENCH_BRIDGE_PATH,
    resourcesPath ? path.join(resourcesPath, 'Bridge', 'evaos-desktop-bridge') : undefined,
    path.resolve(process.cwd(), 'resources', 'Bridge', 'evaos-desktop-bridge'),
    ...HOMEBREW_BRIDGE_PATHS,
  ]);
}

function readProcessResourcesPath(): string | undefined {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: unknown }).resourcesPath;
  return typeof resourcesPath === 'string' && resourcesPath.trim() ? resourcesPath.trim() : undefined;
}

function resolveBridgeExecutable(paths: string[], existsSync: (path: string) => boolean): string | undefined {
  return paths.find((path) => existsSync(path));
}

async function runBridgeCommand(
  bridgePath: string,
  args: string[],
  deps: EvaosNativeCompanionStatusDeps
): Promise<BridgeCommandResult> {
  const execFile = deps.execFile ?? defaultExecFile;
  try {
    const completed = await execFile(bridgePath, args, { timeout: COMMAND_TIMEOUT_MS });
    return parseBridgeCommandPayload(completed.stdout);
  } catch (error) {
    const stdout = readErrorStdout(error);
    if (stdout) {
      return parseBridgeCommandPayload(stdout);
    }
    return {
      ok: false,
      errorMessage: readErrorStderr(error) ?? (error instanceof Error ? error.message : undefined),
    };
  }
}

function parseBridgeCommandPayload(stdout: string): BridgeCommandResult {
  try {
    const payload = JSON.parse(stdout || '{}') as BridgePayload & Record<string, unknown>;
    const data = payload.data && typeof payload.data === 'object' ? payload.data : payloadDataFromTopLevel(payload);
    const error = firstBridgeError(payload);
    return {
      ok: payload.ok === true,
      auditId: typeof payload.audit_id === 'string' ? payload.audit_id : undefined,
      data,
      errors: Array.isArray(payload.errors) ? payload.errors : undefined,
      errorCode: error.code,
      errorMessage: error.message,
    };
  } catch {
    return { ok: false, errorMessage: 'Bridge returned non-JSON output.' };
  }
}

function firstBridgeError(payload: BridgePayload & Record<string, unknown>): { code?: string; message?: string } {
  const first = Array.isArray(payload.errors) ? payload.errors[0] : undefined;
  const nestedError = payload.error && typeof payload.error === 'object' ? payload.error : undefined;
  const source = first ?? nestedError ?? payload;
  return {
    code:
      readString(source, 'code') ??
      readString(source, 'error_code') ??
      readString(source, 'errorCode') ??
      readString(payload, 'code') ??
      readString(payload, 'error_code'),
    message:
      readString(source, 'message') ??
      (typeof payload.error === 'string' ? payload.error : undefined) ??
      readString(payload, 'message'),
  };
}

function payloadDataFromTopLevel(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = { ...payload };
  delete data.data;
  delete data.errors;
  delete data.audit_id;
  return Object.keys(data).length > 0 ? data : undefined;
}

function readErrorStdout(error: unknown): string | undefined {
  const stdout = error && typeof error === 'object' ? (error as { stdout?: unknown }).stdout : undefined;
  if (typeof stdout === 'string') return stdout;
  if (Buffer.isBuffer(stdout)) return stdout.toString('utf8');
  return undefined;
}

function readErrorStderr(error: unknown): string | undefined {
  const stderr = error && typeof error === 'object' ? (error as { stderr?: unknown }).stderr : undefined;
  if (typeof stderr === 'string') return stderr;
  if (Buffer.isBuffer(stderr)) return stderr.toString('utf8');
  return undefined;
}

function bridgeFailureDetail(result: BridgeCommandResult, fallback: string): string {
  const code = safeBridgeErrorText(result.errorCode);
  const message = safeBridgeErrorText(result.errorMessage);
  if (code && message) return `Bridge error ${code}: ${message}`;
  if (message) return message;
  if (code) return `Bridge error ${code}.`;
  return fallback;
}

function safeBridgeErrorText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const secretFieldPattern =
    /["']?\b(?:access[_-]?token|refresh[_-]?token|connector[_-]?token|desktop[_-]?session|provider[_-]?grant|api[_-]?key|password|credential|client[_-]?secret|service[_-]?role|grant[_-]?handle|private[_-]?key|session[_-]?key|auth[_-]?proof|token|secret)\b["']?\s*[:=]\s*["']?[^"'\s,.;)}]+["']?/gi;
  const secretWordPattern =
    /\b(?:access[_-]?token|refresh[_-]?token|connector[_-]?token|desktop[_-]?session|provider[_-]?grant|api[_-]?key|password|credential|client[_-]?secret|service[_-]?role|grant[_-]?handle|private[_-]?key|session[_-]?key|auth[_-]?proof|bearer|secret)\b[^\s,.;)]*/gi;
  const redacted = value
    .replace(/https?:\/\/[^\s"')]+/gi, '[redacted-url]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[redacted-ip]')
    .replace(/\b(?:100|10|172|192)\.[0-9.]+(?::\d+)?\b/g, '[redacted-ip]')
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, '[redacted-secret]')
    .replace(secretFieldPattern, '[redacted-secret]')
    .replace(secretWordPattern, '[redacted-secret]')
    .trim();
  return redacted ? redacted.slice(0, 260) : undefined;
}

async function defaultExecFile(file: string, args: string[], options: { timeout: number }): Promise<ExecFileResult> {
  const result = await execFileAsync(file, args, {
    timeout: options.timeout,
    maxBuffer: 1024 * 1024,
  });
  return {
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

async function defaultOpenPath(path: string): Promise<string> {
  const { shell } = await import('electron');
  return shell.openPath(path);
}

async function defaultOpenExternal(url: string): Promise<void> {
  const { shell } = await import('electron');
  await shell.openExternal(url);
}

function systemSettingsUrlForRepairAction(action: IEvaosNativeCompanionRepairActionRequest['action']): string {
  if (action === 'accessibility') {
    return 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility';
  }
  if (action === 'screen_recording') {
    return 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture';
  }
  throw new Error('Unsupported native companion repair action.');
}

function permissionView(input: unknown): IEvaosNativeCompanionPermissionView | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  return {
    accessibility: readNestedString(record, ['accessibility', 'status']),
    screenRecording: readNestedString(record, ['screen_recording', 'status']),
  };
}

function nativeActionResult(
  action: IEvaosNativeCompanionActionRequest['action'],
  status: IEvaosNativeCompanionActionResult['status'],
  message: string,
  options: Partial<Omit<IEvaosNativeCompanionActionResult, 'action' | 'status' | 'message'>> = {}
): IEvaosNativeCompanionActionResult {
  return {
    action,
    status,
    message,
    sourcePointer: options.sourcePointer ?? 'native-companion:action',
    auditId: options.auditId,
    auditIds: options.auditIds ?? [],
    refreshRecommended: options.refreshRecommended ?? true,
    setup: options.setup,
    control: options.control,
    pairing: options.pairing,
    agentPairingStatus: options.agentPairingStatus,
    events: options.events,
  };
}

function hasGrantedCorePermissions(permissions: IEvaosNativeCompanionPermissionView | undefined): boolean {
  return permissions?.accessibility === 'granted' && permissions.screenRecording === 'granted';
}

function connectorServiceIsRunning(input: unknown): boolean {
  return readBoolean(input, 'running') === true && readNestedBoolean(input, ['health', 'reachable']) === true;
}

function normalizeControlMode(mode: IEvaosNativeCompanionControlMode | undefined): IEvaosNativeCompanionControlMode {
  return mode === 'ask-permission' ? 'ask-permission' : 'full-access';
}

function safeAgentLabel(label: string | undefined): string {
  const trimmed = label?.trim().replace(/\s+/g, ' ').slice(0, 80);
  return trimmed || 'evaOS Workbench';
}

function controlModeFromPayload(input: unknown): IEvaosNativeCompanionControlMode | undefined {
  const mode = readString(input, 'mode');
  return mode === 'ask-permission' || mode === 'full-access' ? mode : undefined;
}

function agentPairingStatusFromStatus(
  readiness: IEvaosNativeCompanionStatusView['readiness'],
  controlSession: unknown
): IEvaosNativeCompanionAgentPairingStatus {
  if (readiness !== 'ready') return 'not_ready';
  const explicit =
    readString(controlSession, 'agent_pairing_status') ?? readString(controlSession, 'agentPairingStatus');
  if (isAgentPairingStatus(explicit)) return explicit;
  if (readBoolean(controlSession, 'agent_paired') === true || readBoolean(controlSession, 'agentPaired') === true) {
    return 'agent_paired';
  }
  return 'ready_for_agent_pairing';
}

function isAgentPairingStatus(value: string | undefined): value is IEvaosNativeCompanionAgentPairingStatus {
  return (
    value === 'not_ready' ||
    value === 'ready_for_agent_pairing' ||
    value === 'pairing_prompt_created' ||
    value === 'agent_paired' ||
    value === 'proof_failed'
  );
}

function controlSummaryFromPayload(input: unknown): IEvaosNativeCompanionActionResult['control'] {
  return {
    active: readBoolean(input, 'active'),
    mode: controlModeFromPayload(input),
    killSwitch: readBoolean(input, 'kill_switch'),
  };
}

function screenSharingSummary(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const enabled = readBoolean(input, 'enabled');
  const vncListening = readBoolean(input, 'vnc_5900_listening');
  if (enabled === undefined && vncListening === undefined) return undefined;
  return `enabled=${String(enabled ?? false)}; vnc_5900_listening=${String(vncListening ?? false)}`;
}

function auditIdsFromPayload(payload: { data?: Record<string, unknown> }): string[] {
  const records = payload.data?.records;
  if (!Array.isArray(records)) return [];
  return records
    .map((record) =>
      record && typeof record === 'object'
        ? ((record as Record<string, unknown>).audit_id ?? (record as Record<string, unknown>).id)
        : undefined
    )
    .filter((auditId): auditId is string => typeof auditId === 'string' && auditId.trim().length > 0);
}

function auditEventsFromPayload(payload: BridgeCommandResult): IEvaosNativeCompanionAuditEvent[] {
  const records = payload.data?.records;
  if (!Array.isArray(records)) return [];
  return records
    .map((record) => {
      if (!record || typeof record !== 'object') return undefined;
      const item = record as Record<string, unknown>;
      const id = readString(item, 'audit_id') ?? readString(item, 'id');
      if (!id) return undefined;
      const createdAt = readString(item, 'created_at') ?? readString(item, 'timestamp');
      const event: IEvaosNativeCompanionAuditEvent = {
        id,
        action: readString(item, 'command') ?? readString(item, 'action') ?? 'mac_control',
        outcome: readBoolean(item, 'ok') === false ? 'failed' : (readString(item, 'outcome') ?? 'recorded'),
      };
      if (createdAt) {
        event.createdAt = createdAt;
      }
      return event;
    })
    .filter((event): event is IEvaosNativeCompanionAuditEvent => Boolean(event));
}

function pairingPromptText(input: { customerId: string; pairingCode: string }): string {
  return [
    'Please pair my Mac to my evaOS/OpenClaw or Hermes agent.',
    '',
    `Customer: ${input.customerId}`,
    `Pairing code: ${input.pairingCode}`,
    '',
    'Use customer_mac_complete_pairing with this code, then run:',
    '1. customer_mac_status',
    '2. desktop_control_status',
    '3. desktop_see',
    '4. desktop_bridge_audit_tail',
    '',
    'Tool input:',
    JSON.stringify(
      {
        enrollment_code: input.pairingCode,
        customer_id: input.customerId,
        device_name: hostname() || 'Customer Mac',
      },
      null,
      2
    ),
    '',
    'Do not ask for connector URLs, IP addresses, ports, SSH, VNC, CDP, tokens, or secrets.',
    '',
    'Do not perform live Mac actions until I start Agent Control in Workbench.',
  ].join('\n');
}

function compactStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))
  );
}

function readBoolean(input: unknown, key: string): boolean | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readNestedBoolean(input: unknown, path: string[]): boolean | undefined {
  let current = input;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'boolean' ? current : undefined;
}

function readString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNestedString(input: unknown, path: string[]): string | undefined {
  let current = input;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current.trim() ? current.trim() : undefined;
}
