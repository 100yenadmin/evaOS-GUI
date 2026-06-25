/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs';
import { isIP } from 'node:net';
import { homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
  IEvaosNativeCompanionActionRequest,
  IEvaosNativeCompanionActionResult,
  IEvaosNativeCompanionAgentPairingStatus,
  IEvaosNativeCompanionAuditEvent,
  IEvaosNativeCompanionConnectorGrant,
  IEvaosNativeCompanionControlMode,
  IEvaosNativeCompanionOpenResult,
  IEvaosNativeCompanionPermissionView,
  IEvaosNativeCompanionReadiness,
  IEvaosNativeCompanionRepairActionRequest,
  IEvaosNativeCompanionRepairActionResult,
  IEvaosNativeCompanionStatusView,
} from '@/common/evaos/bridgeTypes';
import { getDefaultEvaosBrokerSessionClient, isEvaosBrokerSessionError } from './evaosBrokerSession';

const execFileAsync = promisify(execFileCallback);

const HOMEBREW_BRIDGE_PATHS = ['/opt/homebrew/bin/evaos-desktop-bridge', '/usr/local/bin/evaos-desktop-bridge'];
const DEFAULT_RELEASED_WORKBENCH_PATH = '/Applications/evaOS.app';
const COMMAND_TIMEOUT_MS = 8000;
const PAIRING_COMMAND_TIMEOUT_MS = 30000;
const CONNECTOR_START_STATUS_ATTEMPTS = 4;
const CONNECTOR_START_STATUS_RETRY_DELAY_MS = 750;
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
  sleep?: (durationMs: number) => Promise<void>;
  openPath?: (path: string) => Promise<string>;
  openExternal?: (url: string) => Promise<void>;
  createCustomerMacEnrollment?: (request: {
    customerId: string;
    deviceName?: string;
  }) => Promise<{ customerId: string; pairingCode: string; expiresAt?: string }>;
  ensureCustomerMacConnectorGrant?: (request: {
    customerId: string;
    connectorUrl: string;
    connectorToken: string;
    deviceName?: string;
    deviceIdentifier?: string;
    permissionState?: Record<string, unknown>;
    screenSharingOptIn?: boolean;
  }) => Promise<IEvaosNativeCompanionConnectorGrant>;
  readTextFile?: (path: string) => string;
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
      pairingCapable: false,
      pairingBlockedReason: 'bundled_bridge_required',
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
  const customerMacStatusPermissions = permissionView(customerMac.data?.permissions);
  const customerMacPermissions = effectiveCustomerMacPermissions(customerMacStatusPermissions, controlSession);
  const bridgeEffectivePermissions = effectiveBridgePermissions(bridgePermissions, controlSession);
  const bridgeReady = bridge.ok && hasGrantedCorePermissions(bridgeEffectivePermissions);
  const connectorServiceReady = connectorServiceIsReady(connectorService);
  const customerMacReady =
    (customerMac.ok && hasGrantedCorePermissions(customerMacPermissions)) ||
    controlSessionHasPermissionProof(controlSession);
  const readiness = bridgeReady && connectorServiceReady && customerMacReady ? 'ready' : 'repair_required';
  const auditIds = auditIdsFromPayload(audit);
  const pairingCapable =
    isPairingCapableBridgePath(bridgePath, deps.env) &&
    connectorServiceHasSecureRegistrationHost(connectorService.data);
  const agentPairingStatus = pairingCapable
    ? agentPairingStatusFromStatus(readiness, controlSession.data)
    : 'not_ready';
  const pairingBlockedReason = pairingCapable
    ? undefined
    : pairingBlockedReasonForStatus({ bridgePath, connectorService, env: deps.env });
  const summaryText = nativeCompanionSummaryText({
    readiness,
    pairingCapable,
    pairingBlockedReason,
    agentPairingStatus,
  });

  return {
    schemaVersion: 'evaos.native_companion_status.v1',
    generatedAt,
    readiness,
    agentPairingStatus,
    pairingCapable,
    pairingBlockedReason,
    summaryText,
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
      permissions: bridgeEffectivePermissions,
      readOnly: readBoolean(bridge.data?.safety, 'read_only') !== false,
    },
    connectorService: {
      status: connectorServiceReady
        ? 'ready'
        : connectorServiceStatusAvailable(connectorService)
          ? 'repair_required'
          : 'error',
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
  const status = await waitForConnectorServiceReadyAfterStart(bridgePath, deps, started);
  const ready = connectorServiceIsReady(status);
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

async function waitForConnectorServiceReadyAfterStart(
  bridgePath: string,
  deps: EvaosNativeCompanionStatusDeps,
  started: BridgeCommandResult
): Promise<BridgeCommandResult> {
  const startedStatus = connectorServiceStatusFromStartResult(started);
  if (startedStatus && connectorServiceIsReady(startedStatus)) return startedStatus;

  let latest = await runBridgeCommand(bridgePath, ['connector-service', 'status', '--json'], deps);
  if (connectorServiceIsReady(latest)) return latest;

  const sleep = deps.sleep ?? defaultSleep;
  for (let attempt = 1; attempt < CONNECTOR_START_STATUS_ATTEMPTS; attempt++) {
    await sleep(CONNECTOR_START_STATUS_RETRY_DELAY_MS);
    latest = await runBridgeCommand(bridgePath, ['connector-service', 'status', '--json'], deps);
    if (connectorServiceIsReady(latest)) return latest;
  }

  return latest;
}

function connectorServiceStatusFromStartResult(result: BridgeCommandResult): BridgeCommandResult | undefined {
  const status = result.data?.status;
  if (!status || typeof status !== 'object') return undefined;
  return {
    ok: result.ok || connectorServiceLooksLikeStatusPayload(status),
    auditId: result.auditId,
    data: status as Record<string, unknown>,
    errors: result.errors,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
  };
}

async function runControlStartAction(
  bridgePath: string,
  mode: IEvaosNativeCompanionControlMode,
  request: IEvaosNativeCompanionActionRequest,
  deps: EvaosNativeCompanionStatusDeps
): Promise<IEvaosNativeCompanionActionResult> {
  const started = await runBridgeCommand(
    bridgePath,
    ['customer-mac', 'control', 'start', '--json', '--mode', mode, '--agent-label', safeAgentLabel(request.agentLabel)],
    deps
  );
  if (started.ok) {
    return nativeActionResult(
      request.action,
      'succeeded',
      mode === 'ask-permission' ? 'Ask Permission agent control is active.' : 'Full Access agent control is active.',
      {
        sourcePointer: 'native-companion:customer-mac-control-start',
        auditId: started.auditId,
        auditIds: compactStrings([started.auditId]),
        control: controlSummaryFromPayload(started.data),
      }
    );
  }

  const status = await runBridgeCommand(bridgePath, ['customer-mac', 'control', 'status', '--json'], deps);
  if (controlSessionIsReady(status)) {
    return nativeActionResult(
      request.action,
      'succeeded',
      'Agent control was already active and ready after start reconciliation.',
      {
        sourcePointer: 'native-companion:customer-mac-control-start-reconciled',
        auditId: status.auditId ?? started.auditId,
        auditIds: compactStrings([status.auditId, started.auditId]),
        control: controlSummaryFromPayload(status.data),
      }
    );
  }

  const detail = bridgeFailureDetail(
    started,
    'The control session did not report ready after Workbench retried current status.'
  );
  return nativeActionResult(request.action, 'repair_required', `Agent control could not start. ${detail}`, {
    sourcePointer: 'native-companion:customer-mac-control-start',
    auditId: status.auditId ?? started.auditId,
    auditIds: compactStrings([status.auditId, started.auditId]),
    control: controlSummaryFromPayload(status.data),
  });
}

async function runSetupCheckAction(
  request: IEvaosNativeCompanionActionRequest,
  bridgePath: string,
  deps: EvaosNativeCompanionStatusDeps
): Promise<IEvaosNativeCompanionActionResult> {
  const [connectorService, customerMac, controlSession, audit] = await Promise.all([
    runBridgeCommand(bridgePath, ['connector-service', 'status', '--json'], deps),
    runBridgeCommand(bridgePath, ['customer-mac', 'status', '--json'], deps),
    runBridgeCommand(bridgePath, ['customer-mac', 'control', 'status', '--json'], deps),
    runBridgeCommand(bridgePath, ['audit-tail', '--json', '--limit', '12'], deps),
  ]);
  const permissions = effectiveCustomerMacPermissions(permissionView(customerMac.data?.permissions), controlSession);
  const setup = {
    connectorReady: connectorServiceIsReady(connectorService),
    macReady:
      (customerMac.ok && hasGrantedCorePermissions(permissions)) || controlSessionHasPermissionProof(controlSession),
    controlReady: controlSession.ok,
    iPhoneDeferred: true,
  };
  const ready = setup.connectorReady && setup.macReady && setup.controlReady;
  const auditIds = compactStrings([customerMac.auditId, controlSession.auditId, ...auditIdsFromPayload(audit)]);
  const agentPairingStatus = ready ? agentPairingStatusFromStatus('ready', controlSession.data) : 'not_ready';

  if (ready && request.customerId?.trim()) {
    return ensureCustomerMacConnectorGrantAction(request, bridgePath, deps, {
      connectorService,
      customerMac,
      controlSession,
      auditIds,
      setup,
    });
  }

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

async function ensureCustomerMacConnectorGrantAction(
  request: IEvaosNativeCompanionActionRequest,
  bridgePath: string,
  deps: EvaosNativeCompanionStatusDeps,
  prepared?: {
    connectorService: BridgeCommandResult;
    customerMac: BridgeCommandResult;
    controlSession: BridgeCommandResult;
    auditIds: string[];
    setup: {
      connectorReady: boolean;
      macReady: boolean;
      controlReady: boolean;
      iPhoneDeferred: boolean;
    };
  }
): Promise<IEvaosNativeCompanionActionResult> {
  const action = request.action;
  const resultAction = action === 'setup_check' ? 'setup_check' : 'ensure_customer_mac_connector_grant';
  if (!isPairingCapableBridgePath(bridgePath, deps.env)) {
    return nativeActionResult(
      resultAction,
      'repair_required',
      'This Workbench build is missing the bundled Mac connector. Install the current Workbench build before connecting Mac control.',
      {
        sourcePointer: 'native-companion:connector-grant-bundled-bridge-required',
        agentPairingStatus: 'ready_for_agent_pairing',
        refreshRecommended: false,
      }
    );
  }

  const customerId = request.customerId?.trim();
  if (!customerId) {
    return nativeActionResult(resultAction, 'repair_required', 'Choose a customer before connecting Mac control.', {
      sourcePointer: 'native-companion:connector-grant-missing-customer',
    });
  }
  if (isAccountLikeCustomerId(customerId)) {
    return nativeActionResult(
      resultAction,
      'repair_required',
      'Choose a VM-backed Mac-control customer before connecting Mac control.',
      {
        sourcePointer: 'native-companion:connector-grant-invalid-customer',
        agentPairingStatus: 'ready_for_agent_pairing',
      }
    );
  }

  const connectorService =
    prepared?.connectorService ?? (await runBridgeCommand(bridgePath, ['connector-service', 'status', '--json'], deps));
  if (!connectorServiceIsReady(connectorService)) {
    return nativeActionResult(
      resultAction,
      'repair_required',
      'Start Mac Access and confirm the secure connector is reachable before connecting Mac control.',
      {
        sourcePointer: 'native-companion:connector-grant-connector-not-ready',
      }
    );
  }
  if (!connectorServiceHasSecureRegistrationHost(connectorService.data)) {
    return nativeActionResult(
      resultAction,
      'repair_required',
      'Mac Access is running locally, but this Mac still needs the broker-owned private connector link before Workbench can connect Mac control.',
      {
        sourcePointer: 'native-companion:connector-grant-secure-network-required',
        agentPairingStatus: 'ready_for_agent_pairing',
        refreshRecommended: false,
      }
    );
  }

  const customerMac =
    prepared?.customerMac ?? (await runBridgeCommand(bridgePath, ['customer-mac', 'status', '--json'], deps));
  const controlSession =
    prepared?.controlSession ??
    (await runBridgeCommand(bridgePath, ['customer-mac', 'control', 'status', '--json'], deps));
  const permissions = effectiveCustomerMacPermissions(permissionView(customerMac.data?.permissions), controlSession);
  if (!hasGrantedCorePermissions(permissions)) {
    return nativeActionResult(
      resultAction,
      'repair_required',
      'Mac Access needs Accessibility and Screen Recording before Workbench can connect Mac control.',
      {
        sourcePointer: 'native-companion:connector-grant-mac-permission-required',
        auditId: customerMac.auditId,
        auditIds: compactStrings([customerMac.auditId]),
      }
    );
  }

  const connectorUrl = connectorUrlFromStatus(connectorService.data);
  const connectorToken = connectorTokenFromStatus(connectorService.data, deps);
  if (!connectorUrl || !connectorToken) {
    return nativeActionResult(
      resultAction,
      'repair_required',
      'Mac control is ready locally, but Workbench could not read the secure connector registration material.',
      {
        sourcePointer: 'native-companion:connector-grant-local-secret-unavailable',
        agentPairingStatus: 'ready_for_agent_pairing',
      }
    );
  }

  const ensureGrant =
    deps.ensureCustomerMacConnectorGrant ??
    ((grantInput) => getDefaultEvaosBrokerSessionClient().ensureCustomerMacConnectorGrant(grantInput));
  let grant: IEvaosNativeCompanionConnectorGrant;
  try {
    grant = await ensureGrant({
      customerId,
      deviceName: hostname() || 'Customer Mac',
      deviceIdentifier: connectorDeviceIdentifier(customerMac.data),
      connectorUrl,
      connectorToken,
      permissionState: permissionStateForGrant(permissions),
      screenSharingOptIn: false,
    });
  } catch (error) {
    if (isBrokerSessionReconnectRequired(error)) {
      return nativeActionResult(
        resultAction,
        'repair_required',
        'Mac control is ready locally, but Workbench needs a fresh evaOS session before it can connect Mac control. Sign in again, then retry.',
        {
          sourcePointer: 'native-companion:connector-grant-broker-session-required',
          agentPairingStatus: 'ready_for_agent_pairing',
          refreshRecommended: false,
        }
      );
    }
    throw error;
  }

  const auditIds = compactStrings([
    grant.auditId,
    ...(prepared?.auditIds ?? [customerMac.auditId, controlSession.auditId]),
  ]);
  return nativeActionResult(
    resultAction,
    'succeeded',
    'Mac control is connected for this evaOS Workbench session. evaOS/OpenClaw and Hermes can discover the active connector grant.',
    {
      sourcePointer: 'native-companion:connector-grant-ready',
      auditId: auditIds[0],
      auditIds,
      setup: prepared?.setup,
      control: controlSummaryFromPayload(controlSession.data),
      connectorGrant: grant,
      agentPairingStatus: grant.agentPairingStatus ?? 'ready_for_agent_pairing',
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
  if (!isPairingCapableBridgePath(bridgePath, deps.env)) {
    return nativeActionResult(
      'create_pairing_prompt',
      'repair_required',
      'This Workbench build is missing the bundled Mac connector. Install the current Workbench build before creating agent pairing prompts.',
      {
        sourcePointer: 'native-companion:pairing-bundled-bridge-required',
        agentPairingStatus: 'ready_for_agent_pairing',
        refreshRecommended: false,
      }
    );
  }

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
  if (isAccountLikeCustomerId(customerId)) {
    return nativeActionResult(
      'create_pairing_prompt',
      'repair_required',
      'Choose a VM-backed Mac-control customer before creating a pairing prompt.',
      {
        sourcePointer: 'native-companion:pairing-invalid-customer',
        agentPairingStatus: 'ready_for_agent_pairing',
      }
    );
  }

  const connector = await runBridgeCommand(bridgePath, ['connector-service', 'status', '--json'], deps);
  if (!connectorServiceIsReady(connector)) {
    return nativeActionResult(
      'create_pairing_prompt',
      'repair_required',
      'Start Mac Access and confirm the secure connector is reachable before creating a pairing prompt.',
      {
        sourcePointer: 'native-companion:pairing-connector-not-ready',
      }
    );
  }
  if (!connectorServiceHasSecureRegistrationHost(connector.data)) {
    return nativeActionResult(
      'create_pairing_prompt',
      'repair_required',
      'Mac Access is running locally, but this Mac still needs the broker-owned private connector link before Workbench can create an agent pairing prompt.',
      {
        sourcePointer: 'native-companion:pairing-secure-network-required',
        agentPairingStatus: 'ready_for_agent_pairing',
        refreshRecommended: false,
      }
    );
  }

  const customerMac = await runBridgeCommand(bridgePath, ['customer-mac', 'status', '--json'], deps);
  const permissions = permissionView(customerMac.data?.permissions);
  if (!hasGrantedCorePermissions(permissions)) {
    const controlSession = await runBridgeCommand(bridgePath, ['customer-mac', 'control', 'status', '--json'], deps);
    if (controlSessionHasPermissionProof(controlSession)) {
      return createPairingPromptWithReadyMac({ bridgePath, customerId, deps });
    }
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

  return createPairingPromptWithReadyMac({ bridgePath, customerId, deps });
}

async function createPairingPromptWithReadyMac(input: {
  bridgePath: string;
  customerId: string;
  deps: EvaosNativeCompanionStatusDeps;
}): Promise<IEvaosNativeCompanionActionResult> {
  const { bridgePath, customerId, deps } = input;
  const createEnrollment =
    deps.createCustomerMacEnrollment ??
    ((enrollmentInput) => getDefaultEvaosBrokerSessionClient().createCustomerMacEnrollment(enrollmentInput));
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
  const registration = await completeLocalConnectorEnrollment({
    bridgePath,
    enrollment,
    deviceName,
    deps,
  });
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
        agentPairingStatus: 'ready_for_agent_pairing',
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

async function completeLocalConnectorEnrollment(input: {
  bridgePath: string;
  enrollment: { customerId: string; pairingCode: string; expiresAt?: string };
  deviceName: string;
  deps: EvaosNativeCompanionStatusDeps;
}): Promise<BridgeCommandResult> {
  return runBridgeCommand(
    input.bridgePath,
    [
      'connector-service',
      'complete-enrollment',
      '--json',
      '--enrollment-code',
      input.enrollment.pairingCode,
      '--customer-id',
      input.enrollment.customerId,
      '--device-name',
      input.deviceName,
    ],
    input.deps,
    PAIRING_COMMAND_TIMEOUT_MS
  );
}

function isBrokerSessionReconnectRequired(error: unknown): boolean {
  if (!isEvaosBrokerSessionError(error)) return false;
  if (error.code === 'missing_session' || error.code === 'expired_session') return true;
  return error.code === 'broker_http_error' && error.status === 401;
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
      return runSetupCheckAction(request, bridgePath, deps);
    case 'ensure_customer_mac_connector_grant':
      return ensureCustomerMacConnectorGrantAction(request, bridgePath, deps);
    case 'control_status':
      return runCommandAction(request.action, bridgePath, ['customer-mac', 'control', 'status', '--json'], deps, {
        successMessage: 'Agent control status refreshed.',
        failureMessage: 'Agent control status is unavailable.',
        includeControl: true,
      });
    case 'control_start': {
      const mode = normalizeControlMode(request.mode);
      return runControlStartAction(bridgePath, mode, request, deps);
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
    resourcesPath ? join(resourcesPath, 'Bridge', 'evaos-desktop-bridge') : undefined,
    resolve(process.cwd(), 'resources', 'Bridge', 'evaos-desktop-bridge'),
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

function isPairingCapableBridgePath(bridgePath: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (enabledEnvFlag(env.EVAOS_ALLOW_DIAGNOSTIC_BRIDGE_PAIRING)) {
    return true;
  }
  const normalized = bridgePath.replace(/\\/g, '/');
  return (
    normalized.endsWith('/Contents/Resources/Bridge/evaos-desktop-bridge') ||
    normalized.endsWith('/resources/Bridge/evaos-desktop-bridge')
  );
}

function pairingBlockedReasonForStatus(input: {
  bridgePath: string;
  connectorService: BridgeCommandResult;
  env?: NodeJS.ProcessEnv;
}): string {
  if (!isPairingCapableBridgePath(input.bridgePath, input.env)) return 'bundled_bridge_required';
  if (!connectorServiceIsReady(input.connectorService)) return 'connector_service_not_ready';
  if (!connectorServiceHasSecureRegistrationHost(input.connectorService.data)) return 'secure_network_link_required';
  return 'pairing_not_ready';
}

function connectorServiceHasSecureRegistrationHost(input: unknown): boolean {
  const tailnetIp = readString(input, 'tailnet_ip');
  if (isSafeConnectorRegistrationHost(tailnetIp)) return true;
  if (readNestedBoolean(input, ['health', 'reachable']) !== true) return false;
  return isSafeConnectorRegistrationHost(readNestedString(input, ['health', 'host']));
}

function connectorUrlFromStatus(input: unknown): string | undefined {
  const host =
    normalizeConnectorHost(readString(input, 'tailnet_ip')) ??
    normalizeConnectorHost(readNestedString(input, ['health', 'host']));
  if (!isSafeConnectorRegistrationHost(host)) return undefined;
  return `http://${host}:8765`;
}

function connectorTokenFromStatus(input: unknown, deps: EvaosNativeCompanionStatusDeps): string | undefined {
  const tokenPath = connectorTokenPathFromStatus(input);
  if (!tokenPath) return undefined;
  const readTextFile = deps.readTextFile ?? ((path: string) => fs.readFileSync(path, 'utf8'));
  try {
    const token = readTextFile(expandHomePath(tokenPath)).trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

function connectorTokenPathFromStatus(input: unknown): string | undefined {
  return (
    readString(input, 'token_path') ??
    readNestedString(input, ['token', 'path']) ??
    readNestedString(input, ['connector', 'token_path'])
  );
}

function expandHomePath(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function connectorDeviceIdentifier(customerMacData: unknown): string | undefined {
  return (
    readNestedString(customerMacData, ['device', 'hardware_uuid']) ??
    readNestedString(customerMacData, ['device', 'id']) ??
    readNestedString(customerMacData, ['device', 'hostname']) ??
    hostname()
  );
}

function permissionStateForGrant(
  permissions: IEvaosNativeCompanionPermissionView | undefined
): Record<string, unknown> {
  return {
    accessibility: permissions?.accessibility ?? 'unknown',
    screen_recording: permissions?.screenRecording ?? 'unknown',
  };
}

function isSafeConnectorRegistrationHost(value: string | undefined): boolean {
  const host = normalizeConnectorHost(value);
  if (!host) return false;
  const lowered = host.toLowerCase();
  if (lowered === 'localhost' || lowered === 'localhost.localdomain') return false;
  if (lowered.endsWith('.local')) return true;
  if (isIP(host) !== 4) return false;
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 127 || parts[0] === 0 || parts[0] >= 224) return false;
  if (parts[0] === 100) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return parts[0] === 192 && parts[1] === 168;
}

function normalizeConnectorHost(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const parsed = parseConnectorHostFromUrl(raw);
  const hostWithMaybePort = parsed ?? raw.replace(/^\[/, '').replace(/\]$/, '');
  if (/[/?#@]/.test(hostWithMaybePort)) return undefined;
  const host = stripConnectorHostPort(hostWithMaybePort);
  if (!host || host.includes(':')) return undefined;
  return host;
}

function parseConnectorHostFromUrl(value: string): string | undefined {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return undefined;
  try {
    return new URL(value).hostname.replace(/^\[/, '').replace(/\]$/, '');
  } catch {
    return undefined;
  }
}

function stripConnectorHostPort(value: string): string | undefined {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) return bracketed[1];
  const match = /^([^:]+)(?::\d+)?$/.exec(value);
  return match?.[1];
}

function enabledEnvFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

async function runBridgeCommand(
  bridgePath: string,
  args: string[],
  deps: EvaosNativeCompanionStatusDeps,
  timeoutMs = COMMAND_TIMEOUT_MS
): Promise<BridgeCommandResult> {
  const execFile = deps.execFile ?? defaultExecFile;
  try {
    const completed = await execFile(bridgePath, args, { timeout: timeoutMs });
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
    /["']?\b(?:access[_-]?token|refresh[_-]?token|connector[_-]?(?:token|url)|desktop[_-]?session|provider[_-]?grant|api[_-]?key|password|credential|client[_-]?secret|service[_-]?role|grant[_-]?handle|private[_-]?key|session[_-]?key|auth[_-]?proof|token|secret)\b["']?\s*[:=]\s*["']?[^"'\s,)}]+["']?/gi;
  const secretWordPattern =
    /\b(?:access[_-]?token|refresh[_-]?token|connector[_-]?(?:token|url)|desktop[_-]?session|provider[_-]?grant|api[_-]?key|password|credential|client[_-]?secret|service[_-]?role|grant[_-]?handle|private[_-]?key|session[_-]?key|auth[_-]?proof|bearer|secret)\b[^\s,.;)]*/gi;
  const redacted = value
    .replace(secretFieldPattern, '[redacted-secret]')
    .replace(secretWordPattern, '[redacted-secret]')
    .replace(/https?:\/\/[^\s"')]+/gi, '[redacted-url]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[redacted-ip]')
    .replace(/\b(?:100|10|172|192)\.[0-9.]+(?::\d+)?\b/g, '[redacted-ip]')
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, '[redacted-secret]')
    .trim();
  return redacted ? redacted.slice(0, 260) : undefined;
}

function isAccountLikeCustomerId(customerId: string): boolean {
  return customerId.includes('@');
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

async function defaultSleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
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
    connectorGrant: options.connectorGrant,
    pairing: options.pairing,
    agentPairingStatus: options.agentPairingStatus,
    events: options.events,
  };
}

function hasGrantedCorePermissions(permissions: IEvaosNativeCompanionPermissionView | undefined): boolean {
  return permissions?.accessibility === 'granted' && permissions.screenRecording === 'granted';
}

function effectiveCustomerMacPermissions(
  customerMacPermissions: IEvaosNativeCompanionPermissionView | undefined,
  controlSession: BridgeCommandResult
): IEvaosNativeCompanionPermissionView | undefined {
  return effectivePermissionProof(customerMacPermissions, controlSession);
}

function effectiveBridgePermissions(
  bridgePermissions: IEvaosNativeCompanionPermissionView | undefined,
  controlSession: BridgeCommandResult
): IEvaosNativeCompanionPermissionView | undefined {
  return effectivePermissionProof(bridgePermissions, controlSession);
}

function effectivePermissionProof(
  permissions: IEvaosNativeCompanionPermissionView | undefined,
  controlSession: BridgeCommandResult
): IEvaosNativeCompanionPermissionView | undefined {
  if (hasGrantedCorePermissions(permissions)) return permissions;
  return controlSessionHasPermissionProof(controlSession)
    ? permissionView(controlSession.data?.permissions)
    : permissions;
}

function controlSessionHasPermissionProof(controlSession: BridgeCommandResult): boolean {
  return (
    controlSession.ok &&
    readBoolean(controlSession.data, 'kill_switch') !== true &&
    readBoolean(controlSession.data, 'ready') === true &&
    hasGrantedCorePermissions(permissionView(controlSession.data?.permissions))
  );
}

function connectorServiceIsRunning(input: unknown): boolean {
  return readBoolean(input, 'running') === true && readNestedBoolean(input, ['health', 'reachable']) === true;
}

function connectorServiceIsReady(result: BridgeCommandResult): boolean {
  return connectorServiceStatusAvailable(result) && connectorServiceIsRunning(result.data);
}

function connectorServiceStatusAvailable(result: BridgeCommandResult): boolean {
  return result.ok || connectorServiceLooksLikeStatusPayload(result.data);
}

function connectorServiceLooksLikeStatusPayload(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const record = input as Record<string, unknown>;
  return (
    typeof record.running === 'boolean' ||
    typeof record.loaded === 'boolean' ||
    typeof record.plist_installed === 'boolean' ||
    (record.health !== null && typeof record.health === 'object')
  );
}

function controlSessionIsReady(controlSession: BridgeCommandResult): boolean {
  if (!controlSession.ok) return false;
  if (readBoolean(controlSession.data, 'kill_switch') === true) return false;
  if (readBoolean(controlSession.data, 'active') === true) return true;
  return readBoolean(controlSession.data, 'ready') === true;
}

function nativeCompanionSummaryText(input: {
  readiness: IEvaosNativeCompanionReadiness;
  pairingCapable: boolean;
  pairingBlockedReason?: string;
  agentPairingStatus: IEvaosNativeCompanionAgentPairingStatus;
}): string {
  if (input.readiness !== 'ready') {
    return 'Workbench connector repair is required before evaOS or Hermes can use Mac control.';
  }
  if (input.pairingCapable) {
    return input.agentPairingStatus === 'agent_paired'
      ? 'Workbench connector ready with account-scoped agent grant proof.'
      : 'Workbench connector ready for first-party account-scoped Mac control.';
  }
  if (input.pairingBlockedReason === 'secure_network_link_required') {
    return 'Workbench connector is locally ready, but this Mac needs the broker-owned private connector link before Mac control can connect.';
  }
  return 'Workbench connector is locally ready, but Mac control needs the bundled connector and secure private connector link.';
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
  if (mode === 'ask_permission') return 'ask-permission';
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
    '2. customer_mac_capabilities',
    '3. desktop_control_status',
    '4. desktop_see',
    '5. desktop_bridge_audit_tail',
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
    'Use only the pairing code above. Do not request any other connection details.',
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
