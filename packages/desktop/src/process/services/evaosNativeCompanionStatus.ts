/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  execFile as execFileCallback,
  spawn as spawnCallback,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import fs from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { homedir, hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
  IEvaosNativeCompanionActionRequest,
  IEvaosNativeCompanionActionResult,
  IEvaosNativeCompanionAgentPairingStatus,
  IEvaosNativeCompanionAuditEvent,
  IEvaosNativeCompanionConnectorGrant,
  IEvaosNativeCompanionControlMode,
  IEvaosMacControlBlockerReason,
  IEvaosNativeCompanionOpenResult,
  IEvaosNativeCompanionPermissionView,
  IEvaosNativeCompanionReadiness,
  IEvaosNativeCompanionRepairActionRequest,
  IEvaosNativeCompanionRepairActionResult,
  IEvaosNativeCompanionRuntimeToolReadiness,
  IEvaosNativeCompanionStatusView,
  IEvaosWorkbenchDiagnosticPacketRequest,
  IEvaosWorkbenchDiagnosticPacketV1,
} from '@/common/evaos/bridgeTypes';
import { EVAOS_BETA_IDENTITY } from '@/common/evaos/betaIdentity';
import { getDefaultEvaosBrokerSessionClient, isEvaosBrokerSessionError } from './evaosBrokerSession';

const execFileAsync = promisify(execFileCallback);

const HOMEBREW_BRIDGE_PATHS = ['/opt/homebrew/bin/evaos-desktop-bridge', '/usr/local/bin/evaos-desktop-bridge'];
const DEFAULT_RELEASED_WORKBENCH_PATH = `/Applications/${EVAOS_BETA_IDENTITY.macAppBundleName}`;
const COMMAND_TIMEOUT_MS = 8000;
const PAIRING_COMMAND_TIMEOUT_MS = 30000;
const CONNECTOR_START_STATUS_ATTEMPTS = 4;
const CONNECTOR_START_STATUS_RETRY_DELAY_MS = 750;
const CONNECTOR_PORT = 8765;
const CONNECTOR_READY_PROBE_TIMEOUT_MS = 2000;
const CONNECTOR_READY_PROBE_DEADLINE_MS = 2500;
const MAX_CONNECTOR_READY_RESPONSE_BYTES = 32 * 1024;
const WORKBENCH_BUNDLE_ID = 'com.evaos.workbench';
const WORKBENCH_PROTOCOL = 'evaos-workbench';
const DIAGNOSTIC_SCHEMA_VERSION = 'evaos.workbench.diagnostic_packet.v1';
const WORKBENCH_CONNECTOR_MANAGERS = new Set(['workbench-session', 'workbench-or-manual']);
const SAFE_MAC_CONTROL_BLOCKER_REASONS = new Set<IEvaosMacControlBlockerReason>([
  'listener_owner_mismatch',
  'port_in_use',
  'token_missing',
  'not_workbench_managed',
  'secure_network_link_required',
  'permission_missing',
  'broker_session_expired',
  'agent_cli_config_invalid',
  'runtime_not_configured',
  'bundled_bridge_required',
  'connector_service_not_ready',
  'bridge_cli_missing',
  'bridge_diagnostics_unavailable',
  'pairing_not_ready',
  'stale_connector_port_conflict',
  'unknown',
]);
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
  runConnectorCommand?: (request: {
    connectorUrl: string;
    connectorToken: string;
    command: string;
    params?: Record<string, unknown>;
  }) => Promise<BridgeCommandResult>;
  probeConnectorReady?: (host: string, port: number) => Promise<boolean>;
  readTextFile?: (path: string) => string;
  spawnConnectorProcess?: (file: string, args: string[], options: SpawnOptions) => ChildProcess;
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

let workbenchManagedConnector:
  | {
      bridgePath: string;
      host: string;
      process: ChildProcess;
    }
  | undefined;

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
      runtimeToolReadiness: 'not_ready',
      pairingCapable: false,
      pairingBlockedReason: 'bundled_bridge_required',
      blockerReason: 'bridge_cli_missing',
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

  const [bridge, connectorService, customerMac, iPhone, controlSession, audit, bridgeReadyStatus] = await Promise.all([
    runBridgeCommand(bridgePath, ['status', '--json'], deps),
    runBridgeCommand(bridgePath, ['connector-service', 'status', '--json'], deps),
    runBridgeCommand(bridgePath, ['customer-mac', 'status', '--json'], deps),
    runBridgeCommand(bridgePath, ['customer-mac', 'iphone-mirroring', 'status', '--json'], deps),
    runBridgeCommand(bridgePath, ['customer-mac', 'control', 'status', '--json'], deps),
    runBridgeCommand(bridgePath, ['audit-tail', '--json', '--limit', '5'], deps),
    runBridgeCommand(bridgePath, ['ready', '--json'], deps),
  ]);

  const bridgePermissions = permissionView(bridge.data?.permissions);
  const customerMacStatusPermissions = permissionView(customerMac.data?.permissions);
  const customerMacPermissions = effectiveCustomerMacPermissions(customerMacStatusPermissions, controlSession);
  const bridgeEffectivePermissions = effectiveBridgePermissions(bridgePermissions, controlSession);
  const bridgeReady = bridge.ok && hasGrantedCorePermissions(bridgeEffectivePermissions);
  const connectorServiceData = connectorServiceDataForWorkbenchReadiness(
    bridgePath,
    connectorService.data,
    bridgeReadyStatus
  );
  const connectorServiceForReadiness: BridgeCommandResult = { ...connectorService, data: connectorServiceData };
  const connectorServiceReady = await connectorServiceIsReadyForWorkbenchSession(
    bridgePath,
    connectorServiceForReadiness,
    deps
  );
  const customerMacReady =
    (customerMac.ok && hasGrantedCorePermissions(customerMacPermissions)) ||
    controlSessionHasPermissionProof(controlSession);
  const readiness = bridgeReady && connectorServiceReady && customerMacReady ? 'ready' : 'repair_required';
  const auditIds = auditIdsFromPayload(audit);
  const pairingCapable =
    isPairingCapableBridgePath(bridgePath, deps.env) && connectorServiceHasSecureRegistrationHost(connectorServiceData);
  const reportedAgentPairingStatus = pairingCapable
    ? agentPairingStatusFromStatus(readiness, controlSession)
    : 'not_ready';
  const agentPairingCustomerId =
    reportedAgentPairingStatus === 'agent_paired' || reportedAgentPairingStatus === 'proof_failed'
      ? agentPairingCustomerIdFromControlSession(controlSession)
      : undefined;
  const agentPairingProofScopeId =
    reportedAgentPairingStatus === 'agent_paired' || reportedAgentPairingStatus === 'proof_failed'
      ? agentPairingProofScopeIdFromControlSession(controlSession)
      : undefined;
  const activeMacControlScopeId = activeMacControlScopeIdFromControlSession(controlSession);
  const pairingProofMatchesActiveScope = Boolean(
    agentPairingCustomerId &&
    agentPairingProofScopeId &&
    activeMacControlScopeId &&
    agentPairingProofScopeId === activeMacControlScopeId
  );
  const agentPairingStatus =
    (reportedAgentPairingStatus === 'agent_paired' || reportedAgentPairingStatus === 'proof_failed') &&
    !pairingProofMatchesActiveScope
      ? 'ready_for_agent_pairing'
      : reportedAgentPairingStatus;
  const reportedRuntimeToolReadiness = runtimeToolReadinessFromPairing(readiness, agentPairingStatus, controlSession);
  const runtimeToolProofCustomerId =
    reportedRuntimeToolReadiness === 'tools_ready' || reportedRuntimeToolReadiness === 'proof_failed'
      ? runtimeToolProofCustomerIdFromControlSession(controlSession)
      : undefined;
  const runtimeToolProofScopeId =
    reportedRuntimeToolReadiness === 'tools_ready' || reportedRuntimeToolReadiness === 'proof_failed'
      ? runtimeToolProofScopeIdFromControlSession(controlSession)
      : undefined;
  const runtimeProofMatchesPairing = Boolean(
    pairingProofMatchesActiveScope &&
    runtimeToolProofCustomerId === agentPairingCustomerId &&
    runtimeToolProofScopeId === agentPairingProofScopeId &&
    runtimeToolProofScopeId === activeMacControlScopeId
  );
  const runtimeToolReadiness =
    (reportedRuntimeToolReadiness === 'tools_ready' || reportedRuntimeToolReadiness === 'proof_failed') &&
    !runtimeProofMatchesPairing
      ? 'pairing_ready'
      : reportedRuntimeToolReadiness;
  const pairingBlockedReason = pairingCapable
    ? undefined
    : pairingBlockedReasonForStatus({ bridgePath, connectorService, env: deps.env });
  const blockerReason = blockerReasonForStatus({
    bridge,
    connectorService,
    customerMac,
    controlSession,
    bridgeReady,
    connectorServiceReady,
    customerMacReady,
    pairingBlockedReason,
    bridgePath,
  });
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
    agentPairingCustomerId,
    agentPairingProofScopeId,
    activeMacControlScopeId,
    runtimeToolReadiness,
    runtimeToolProofCustomerId,
    runtimeToolProofScopeId,
    pairingCapable,
    pairingBlockedReason,
    blockerReason,
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
        : connectorServiceStatusAvailable(connectorServiceForReadiness)
          ? 'repair_required'
          : 'error',
      running: connectorServiceReady || readBoolean(connectorServiceData, 'running'),
      reachable: connectorServiceReady || readNestedBoolean(connectorServiceData, ['health', 'reachable']),
      managedBy: readString(connectorServiceData, 'managed_by'),
      tailnetIp: readString(connectorServiceData, 'tailnet_ip'),
      permissionTarget: readString(connectorServiceData, 'permission_target'),
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

export async function getEvaosWorkbenchDiagnosticPacket(
  request: IEvaosWorkbenchDiagnosticPacketRequest = {},
  deps: EvaosNativeCompanionStatusDeps = {}
): Promise<IEvaosWorkbenchDiagnosticPacketV1> {
  const now = deps.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const existsSync = deps.existsSync ?? fs.existsSync;
  const bridgePath = resolveBridgeExecutable(deps.bridgePaths ?? defaultBridgePaths(deps.env), existsSync);
  const status = await getEvaosNativeCompanionStatus({ ...deps, now });
  const bridgeDiagnostics = bridgePath
    ? await runOptionalBridgeDiagnostics(bridgePath, ['diagnostics', '--json'], deps)
    : optionalBridgeDiagnosticsUnavailable('bridge-cli-missing');
  const bridgeReady = bridgePath
    ? await runOptionalBridgeDiagnostics(bridgePath, ['ready', '--json'], deps)
    : optionalBridgeDiagnosticsUnavailable('bridge-cli-missing');
  const blockerCategory =
    request.lastAction?.blockerReason ?? status.blockerReason ?? status.pairingBlockedReason ?? 'unknown';

  return {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    generatedAt,
    app: {
      product: EVAOS_BETA_IDENTITY.productName,
      bundleId: EVAOS_BETA_IDENTITY.appId,
      protocol: WORKBENCH_PROTOCOL,
      version: safeDiagnosticText(status.releasedWorkbench.version ?? deps.env?.npm_package_version),
      sourceSha: safeDiagnosticText(
        deps.env?.EVAOS_APP_COMMIT ?? deps.env?.AIONUI_APP_COMMIT ?? deps.env?.GITHUB_SHA ?? deps.env?.APP_COMMIT
      ),
      channel: safeDiagnosticText(deps.env?.EVAOS_RELEASE_CHANNEL ?? 'Mac release'),
      installedPath: safeDiagnosticPath(status.releasedWorkbench.path ?? workbenchAppPathFromResources()),
      running: status.releasedWorkbench.running,
    },
    signing: {
      summary: 'not_collected_by_workbench_status',
    },
    selectedContext: {
      accountEmail: safeDiagnosticText(request.accountEmail),
      customerId: safeDiagnosticText(request.customerId),
      customerLabel: safeDiagnosticText(request.customerLabel),
      vmTarget: safeDiagnosticText(request.vmTarget),
      route: safeDiagnosticText(request.route),
    },
    runtimeStatus: {
      evaos: safeDiagnosticText(request.runtimeStatus?.evaos),
      openclaw: safeDiagnosticText(request.runtimeStatus?.openclaw),
      hermes: safeDiagnosticText(request.runtimeStatus?.hermes),
      localAcp: safeDiagnosticText(request.runtimeStatus?.localAcp),
      lastStartupCategory: request.runtimeStatus?.lastStartupCategory,
    },
    brokerGrant: {
      state: safeDiagnosticText(status.controlSession?.active ? 'control_active' : status.agentPairingStatus),
      agentPairingStatus: status.agentPairingStatus,
      sourcePointer: safeDiagnosticText(status.sourcePointer),
      auditIds: safeDiagnosticAuditIds(status.audit.auditIds),
    },
    bridge: {
      installed: status.bridgeCli.installed,
      status: status.bridgeCli.status,
      path: safeDiagnosticPath(status.bridgeCli.path),
      version: safeDiagnosticText(status.bridgeCli.version),
      diagnosticsStatus: bridgeDiagnostics.ok ? 'available' : 'unavailable',
      diagnosticsSource: safeDiagnosticText(bridgeDiagnostics.source),
      readyStatus: bridgeReady.ok ? 'ready' : bridgeReady.source === 'bridge-cli-missing' ? 'unavailable' : 'not_ready',
      readySource: safeDiagnosticText(bridgeReady.source),
    },
    connector: {
      status: status.connectorService?.status,
      running: status.connectorService?.running,
      reachable: status.connectorService?.reachable,
      managedBy: safeDiagnosticText(status.connectorService?.managedBy),
      ownerClassification: connectorOwnerClassification(status),
      endpointSummary: status.connectorService?.reachable ? 'redacted' : 'unavailable',
    },
    launchAgent: {
      label: safeDiagnosticText(readString(bridgeDiagnostics.data, 'launch_agent_label')),
      state: safeDiagnosticText(readString(bridgeDiagnostics.data, 'launch_agent_state')),
      programPathSummary: safeDiagnosticPath(readString(bridgeDiagnostics.data, 'launch_agent_program_path')),
      stalePath: readBoolean(bridgeDiagnostics.data, 'launch_agent_stale'),
    },
    tcc: {
      accessibility: safeDiagnosticText(
        status.customerMac.permissions?.accessibility ?? status.bridgeCli.permissions?.accessibility
      ),
      screenRecording: safeDiagnosticText(
        status.customerMac.permissions?.screenRecording ?? status.bridgeCli.permissions?.screenRecording
      ),
      holder: safeDiagnosticText(status.connectorService?.permissionTarget),
    },
    audit: {
      status: status.audit.status,
      auditIds: safeDiagnosticAuditIds(status.audit.auditIds),
      latestAuditId: safeDiagnosticText(status.audit.latestAuditId),
    },
    lastAction: request.lastAction
      ? {
          action: safeDiagnosticText(request.lastAction.action) ?? 'unknown',
          status: safeDiagnosticText(request.lastAction.status) ?? 'unknown',
          message: safeDiagnosticText(request.lastAction.message),
          blockerReason: request.lastAction.blockerReason,
          auditId: safeDiagnosticText(request.lastAction.auditId),
        }
      : undefined,
    blockerCategory,
    redaction: {
      rawSecretsStoredInWorkbench: false,
      urlsIpsPortsRedacted: true,
      rawPromptMaterialIncluded: false,
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
    runtimeToolReadiness: 'not_ready',
    blockerReason: fixtureState === 'permission_needed' ? 'permission_missing' : 'connector_service_not_ready',
    summaryText: 'LOCAL FIXTURE - NOT LIVE BETA PROOF: Native companion repair state fixture.',
    sourcePointer: `local-fixture:native-companion:${fixtureState}`,
    canOpenReleasedWorkbench: true,
    releasedWorkbench: {
      installed: true,
      running: false,
      path: DEFAULT_RELEASED_WORKBENCH_PATH,
      version: '0.6.27',
      displayName: EVAOS_BETA_IDENTITY.macAppBundleName,
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
      runtimeToolReadiness: 'pairing_ready',
      blockerReason: undefined,
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
      blockerReason: 'connector_service_not_ready',
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
      blockerReason: result.ok ? undefined : classifyBridgeBlocker(result, 'unknown'),
    }
  );
}

async function runConnectorStartAction(
  bridgePath: string,
  deps: EvaosNativeCompanionStatusDeps
): Promise<IEvaosNativeCompanionActionResult> {
  const before = await runBridgeCommand(bridgePath, ['connector-service', 'status', '--json'], deps);
  const status = await ensureWorkbenchManagedConnectorReady(bridgePath, deps, before);
  const ready = await connectorServiceIsReadyForWorkbenchSession(bridgePath, status, deps);
  if (ready) {
    return nativeActionResult(
      'connector_start',
      'succeeded',
      'Mac Access connector is running from this Workbench session.',
      {
        sourcePointer: 'native-companion:workbench-session-connector-start',
        auditId: status.auditId ?? before.auditId,
        auditIds: compactStrings([status.auditId, before.auditId]),
      }
    );
  }

  const detail = bridgeFailureDetail(status, 'The connector did not report a reachable local service after start.');
  return nativeActionResult('connector_start', 'repair_required', `Mac Access connector could not start. ${detail}`, {
    sourcePointer: 'native-companion:workbench-session-connector-start',
    auditId: status.auditId ?? before.auditId,
    auditIds: compactStrings([status.auditId, before.auditId]),
    blockerReason: classifyConnectorServiceBlocker(bridgePath, status, 'stale_connector_port_conflict'),
  });
}

async function ensureWorkbenchManagedConnectorReady(
  bridgePath: string,
  deps: EvaosNativeCompanionStatusDeps,
  before?: BridgeCommandResult
): Promise<BridgeCommandResult> {
  const current = before ?? (await runBridgeCommand(bridgePath, ['connector-service', 'status', '--json'], deps));
  if (await connectorServiceIsReadyForWorkbenchSession(bridgePath, current, deps)) {
    return current;
  }

  await runBridgeCommand(bridgePath, ['connector-service', 'stop', '--json'], deps);
  stopWorkbenchManagedConnector();

  const host = connectorSessionHostFromStatus(current.data) ?? '127.0.0.1';
  startWorkbenchManagedConnector(bridgePath, host, deps);
  return waitForConnectorServiceReadyAfterStart(bridgePath, deps, current);
}

function startWorkbenchManagedConnector(bridgePath: string, host: string, deps: EvaosNativeCompanionStatusDeps): void {
  if (
    workbenchManagedConnector?.bridgePath === bridgePath &&
    workbenchManagedConnector.host === host &&
    workbenchManagedConnector.process.exitCode === null &&
    !workbenchManagedConnector.process.killed
  ) {
    return;
  }

  stopWorkbenchManagedConnector();
  const spawnConnectorProcess = deps.spawnConnectorProcess ?? defaultSpawnConnectorProcess;
  const args = ['serve', '--host', host, '--port', String(CONNECTOR_PORT)];
  const child = spawnConnectorProcess(bridgePath, args, {
    cwd: dirname(bridgePath),
    detached: false,
    env: workbenchManagedConnectorEnv(deps.env),
    stdio: 'ignore',
  });
  child.once('exit', () => {
    if (workbenchManagedConnector?.process === child) {
      workbenchManagedConnector = undefined;
    }
  });
  child.unref?.();
  workbenchManagedConnector = { bridgePath, host, process: child };
}

function stopWorkbenchManagedConnector(): void {
  const current = workbenchManagedConnector;
  workbenchManagedConnector = undefined;
  if (!current || current.process.killed || current.process.exitCode !== null) return;
  current.process.kill();
}

export function stopEvaosNativeCompanionSessionConnector(): void {
  stopWorkbenchManagedConnector();
}

function workbenchManagedConnectorMatchesStatus(bridgePath: string, status: unknown): boolean {
  const host = connectorSessionHostFromStatus(status);
  if (!host) return false;
  if (connectorStatusHasExplicitOwnerMismatch(bridgePath, status)) {
    return false;
  }
  if (connectorStatusOwnedByCurrentWorkbench(bridgePath, status)) {
    return true;
  }
  return (
    workbenchManagedConnector?.bridgePath === bridgePath &&
    workbenchManagedConnector.host === host &&
    workbenchManagedConnector.process.exitCode === null &&
    !workbenchManagedConnector.process.killed
  );
}

function workbenchManagedConnectorIsReady(bridgePath: string, result: BridgeCommandResult): boolean {
  return (
    connectorServiceStatusAvailable(result) &&
    readNestedBoolean(result.data, ['health', 'reachable']) === true &&
    workbenchManagedConnectorMatchesStatus(bridgePath, result.data)
  );
}

async function workbenchManagedConnectorIsReadyWithEndpoint(
  bridgePath: string,
  result: BridgeCommandResult,
  deps: EvaosNativeCompanionStatusDeps
): Promise<boolean> {
  if (
    workbenchManagedConnectorIsReady(bridgePath, result) &&
    (await connectorReadyEndpointIsReady(result.data, deps))
  ) {
    return true;
  }
  if (!connectorServiceHasSecureRegistrationHost(result.data)) {
    return false;
  }
  if (connectorStatusHasExplicitOwnerMismatch(bridgePath, result.data)) {
    return false;
  }
  const ready = await runBridgeCommand(bridgePath, ['ready', '--json'], deps);
  return bridgeReadyCommandShowsConnectorReady(bridgePath, ready);
}

async function connectorServiceIsReadyForWorkbenchSession(
  bridgePath: string,
  result: BridgeCommandResult,
  deps: EvaosNativeCompanionStatusDeps
): Promise<boolean> {
  if (connectorServiceStatusAvailable(result) && readNestedBoolean(result.data, ['health', 'reachable']) === true) {
    const endpointReady = await connectorReadyEndpointIsReady(result.data, deps);
    if (endpointReady) {
      if (workbenchManagedConnectorIsReady(bridgePath, result)) {
        return true;
      }
      if (!connectorStatusHasOwnershipSignals(result.data)) {
        return connectorServiceIsReady(result);
      }
      return connectorStatusOwnedByCurrentWorkbench(bridgePath, result.data);
    }
  }

  const ready = await runBridgeCommand(bridgePath, ['ready', '--json'], deps);
  return bridgeReadyCommandShowsConnectorReady(bridgePath, ready);
}

function connectorServiceDataForWorkbenchReadiness(
  bridgePath: string,
  fallbackData: unknown,
  readyResult: BridgeCommandResult
): Record<string, unknown> | undefined {
  const fallbackRecord =
    fallbackData && typeof fallbackData === 'object' ? (fallbackData as Record<string, unknown>) : undefined;
  if (!bridgeReadyCommandShowsConnectorReady(bridgePath, readyResult)) return fallbackRecord;
  const readyConnector = readyResult.data?.connector_service;
  if (!readyConnector || typeof readyConnector !== 'object') return fallbackRecord;
  const fallbackConnector = fallbackRecord ?? {};
  const readyRecord = readyConnector as Record<string, unknown>;
  const fallbackHealth =
    fallbackConnector.health && typeof fallbackConnector.health === 'object'
      ? (fallbackConnector.health as Record<string, unknown>)
      : {};
  const readyHealth =
    readyRecord.health && typeof readyRecord.health === 'object' ? (readyRecord.health as Record<string, unknown>) : {};

  return {
    ...fallbackConnector,
    ...readyRecord,
    running: readBoolean(readyRecord, 'running') ?? true,
    ready: readBoolean(readyRecord, 'ready') ?? true,
    loaded: readBoolean(readyRecord, 'loaded') ?? readBoolean(fallbackConnector, 'loaded'),
    managed_by: readString(readyRecord, 'managed_by') ?? readString(fallbackConnector, 'managed_by'),
    health: {
      ...fallbackHealth,
      ...readyHealth,
      reachable: readNestedBoolean(readyRecord, ['health', 'reachable']) ?? true,
      ready: readNestedBoolean(readyRecord, ['health', 'ready']) ?? true,
    },
  };
}

function bridgeReadyCommandShowsConnectorReady(bridgePath: string, result: BridgeCommandResult): boolean {
  const connectorService = result.data?.connector_service;
  if (connectorStatusHasExplicitOwnerMismatch(bridgePath, connectorService)) {
    return false;
  }
  if (
    connectorStatusHasOwnershipSignals(connectorService) &&
    !connectorStatusOwnedByCurrentWorkbench(bridgePath, connectorService)
  ) {
    return false;
  }
  return (
    result.ok &&
    readBoolean(result.data, 'ready') === true &&
    readString(result.data, 'service') === 'evaos-desktop-bridge-connector' &&
    readNestedBoolean(result.data, ['connector_service', 'health', 'reachable']) !== false
  );
}

async function connectorReadyEndpointIsReady(input: unknown, deps: EvaosNativeCompanionStatusDeps): Promise<boolean> {
  const host =
    connectorSessionHostFromStatus(input) ??
    (readNestedBoolean(input, ['health', 'reachable']) === true ? '127.0.0.1' : undefined);
  if (!host) return false;
  const probe = deps.probeConnectorReady ?? defaultProbeConnectorReady;
  return probe(host, CONNECTOR_PORT);
}

function workbenchManagedConnectorEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const appPath = workbenchAppPathFromResources();
  return {
    ...process.env,
    ...env,
    EVAOS_DESKTOP_BRIDGE_MODE: 'customer-mac-connector',
    EVAOS_DESKTOP_BRIDGE_MANAGED_BY: 'workbench-session',
    EVAOS_DESKTOP_BRIDGE_RESPONSIBLE_BUNDLE_ID: env.EVAOS_DESKTOP_BRIDGE_RESPONSIBLE_BUNDLE_ID ?? WORKBENCH_BUNDLE_ID,
    ...(appPath ? { EVAOS_DESKTOP_BRIDGE_RESPONSIBLE_APP_PATH: appPath } : {}),
  };
}

function workbenchAppPathFromResources(): string | undefined {
  const resourcesPath = readProcessResourcesPath();
  if (!resourcesPath) return undefined;
  const normalized = resourcesPath.replace(/\\/g, '/');
  if (!normalized.endsWith('.app/Contents/Resources')) return undefined;
  return dirname(dirname(resourcesPath));
}

function workbenchAppPathFromBridgePath(bridgePath: string): string | undefined {
  const normalized = normalizeComparisonPath(bridgePath);
  const appMarkerIndex = normalized?.indexOf('.app/');
  if (appMarkerIndex === undefined || appMarkerIndex < 0) return undefined;
  return normalized?.slice(0, appMarkerIndex + '.app'.length);
}

function normalizeComparisonPath(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized || undefined;
}

function pathIsSameOrNested(candidate: string | undefined, expectedRoot: string | undefined): boolean {
  const normalizedCandidate = normalizeComparisonPath(candidate);
  const normalizedRoot = normalizeComparisonPath(expectedRoot);
  return Boolean(
    normalizedCandidate &&
    normalizedRoot &&
    (normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`))
  );
}

function connectorStatusHasOwnershipSignals(status: unknown): boolean {
  return Boolean(
    readString(status, 'managed_by') || connectorResponsibleBundleId(status) || connectorOwnerPaths(status).length > 0
  );
}

function connectorStatusHasExplicitOwnerMismatch(bridgePath: string, status: unknown): boolean {
  const managedBy = readString(status, 'managed_by')?.toLowerCase();
  const bundleId = connectorResponsibleBundleId(status);
  if (bundleId && bundleId !== WORKBENCH_BUNDLE_ID) {
    return true;
  }

  const ownerMatch = connectorOwnerPathMatchesWorkbench(bridgePath, status);
  if (ownerMatch === false) {
    return true;
  }

  if (managedBy && !WORKBENCH_CONNECTOR_MANAGERS.has(managedBy)) {
    return bundleId !== WORKBENCH_BUNDLE_ID && ownerMatch !== true;
  }

  return false;
}

function connectorStatusOwnedByCurrentWorkbench(bridgePath: string, status: unknown): boolean {
  const managedBy = readString(status, 'managed_by')?.toLowerCase();
  const bundleId = connectorResponsibleBundleId(status);
  if (bundleId && bundleId !== WORKBENCH_BUNDLE_ID) {
    return false;
  }

  const ownerMatch = connectorOwnerPathMatchesWorkbench(bridgePath, status);
  if (ownerMatch === false) {
    return false;
  }

  if (ownerMatch === true) {
    return true;
  }

  if (managedBy && !WORKBENCH_CONNECTOR_MANAGERS.has(managedBy)) {
    return false;
  }

  return bundleId === WORKBENCH_BUNDLE_ID && Boolean(managedBy && WORKBENCH_CONNECTOR_MANAGERS.has(managedBy));
}

function connectorOwnerPathMatchesWorkbench(bridgePath: string, status: unknown): boolean | undefined {
  const ownerPaths = connectorOwnerPaths(status);
  if (ownerPaths.length === 0) return undefined;

  const expectedBridgePath = normalizeComparisonPath(bridgePath);
  const expectedAppPath = workbenchAppPathFromBridgePath(bridgePath);
  return ownerPaths.some((ownerPath) => {
    const normalizedOwner = normalizeComparisonPath(ownerPath);
    return normalizedOwner === expectedBridgePath || pathIsSameOrNested(normalizedOwner, expectedAppPath);
  });
}

function connectorOwnerPaths(status: unknown): string[] {
  return compactStrings([
    readString(status, 'responsible_app_path'),
    readString(status, 'responsibleAppPath'),
    readString(status, 'owner_app_path'),
    readString(status, 'ownerAppPath'),
    readString(status, 'process_path'),
    readString(status, 'processPath'),
    readString(status, 'executable_path'),
    readString(status, 'executablePath'),
    readString(status, 'bridge_path'),
    readString(status, 'bridgePath'),
    readString(status, 'launch_agent_program_path'),
    readString(status, 'launchAgentProgramPath'),
    readNestedString(status, ['responsible', 'app_path']),
    readNestedString(status, ['responsible', 'appPath']),
    readNestedString(status, ['owner', 'app_path', 'value']),
    readNestedString(status, ['owner', 'appPath', 'value']),
    readNestedString(status, ['owner', 'program_path', 'value']),
    readNestedString(status, ['owner', 'programPath', 'value']),
    readNestedString(status, ['process', 'path']),
    readNestedString(status, ['launch_agent', 'program_path']),
    readNestedString(status, ['launchAgent', 'programPath']),
  ]);
}

function connectorResponsibleBundleId(status: unknown): string | undefined {
  return (
    readString(status, 'responsible_bundle_id') ??
    readString(status, 'responsibleBundleId') ??
    readString(status, 'bundle_id') ??
    readString(status, 'bundleId') ??
    readNestedString(status, ['responsible', 'bundle_id']) ??
    readNestedString(status, ['responsible', 'bundleId']) ??
    readNestedString(status, ['owner', 'bundle_id']) ??
    readNestedString(status, ['owner', 'bundleId'])
  );
}

function classifyConnectorServiceBlocker(
  bridgePath: string,
  result: BridgeCommandResult,
  fallback: IEvaosMacControlBlockerReason
): IEvaosMacControlBlockerReason {
  if (connectorStatusHasExplicitOwnerMismatch(bridgePath, result.data)) {
    const managedBy = readString(result.data, 'managed_by')?.toLowerCase();
    if (connectorResponsibleBundleId(result.data) || connectorOwnerPaths(result.data).length > 0) {
      return 'listener_owner_mismatch';
    }
    if (managedBy && !WORKBENCH_CONNECTOR_MANAGERS.has(managedBy)) {
      return 'not_workbench_managed';
    }
  }
  return classifyBridgeBlocker(result, fallback);
}

function connectorSessionHostFromStatus(input: unknown): string | undefined {
  return (
    normalizeConnectorHost(readString(input, 'tailnet_ip')) ??
    normalizeConnectorHost(readNestedString(input, ['health', 'host']))
  );
}

async function runConnectorStopAction(
  bridgePath: string,
  deps: EvaosNativeCompanionStatusDeps
): Promise<IEvaosNativeCompanionActionResult> {
  stopWorkbenchManagedConnector();
  return runCommandAction('connector_stop', bridgePath, ['connector-service', 'stop', '--json'], deps, {
    successMessage: 'Mac Access connector stopped.',
    failureMessage: 'Mac Access connector could not stop.',
  });
}

async function waitForConnectorServiceReadyAfterStart(
  bridgePath: string,
  deps: EvaosNativeCompanionStatusDeps,
  started: BridgeCommandResult
): Promise<BridgeCommandResult> {
  const startedStatus = connectorServiceStatusFromStartResult(started);
  if (startedStatus && (await workbenchManagedConnectorIsReadyWithEndpoint(bridgePath, startedStatus, deps))) {
    return startedStatus;
  }

  let latest = await runBridgeCommand(bridgePath, ['connector-service', 'status', '--json'], deps);
  if (await workbenchManagedConnectorIsReadyWithEndpoint(bridgePath, latest, deps)) return latest;

  const sleep = deps.sleep ?? defaultSleep;
  for (let attempt = 1; attempt < CONNECTOR_START_STATUS_ATTEMPTS; attempt++) {
    await sleep(CONNECTOR_START_STATUS_RETRY_DELAY_MS);
    latest = await runBridgeCommand(bridgePath, ['connector-service', 'status', '--json'], deps);
    if (await workbenchManagedConnectorIsReadyWithEndpoint(bridgePath, latest, deps)) return latest;
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
    blockerReason: classifyBridgeBlocker(started, 'connector_service_not_ready'),
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
  const connectorReady = await connectorServiceIsReadyForWorkbenchSession(bridgePath, connectorService, deps);
  const setup = {
    connectorReady,
    macReady:
      (customerMac.ok && hasGrantedCorePermissions(permissions)) || controlSessionHasPermissionProof(controlSession),
    controlReady: controlSession.ok,
    iPhoneDeferred: true,
  };
  const ready = setup.connectorReady && setup.macReady && setup.controlReady;
  const auditIds = compactStrings([customerMac.auditId, controlSession.auditId, ...auditIdsFromPayload(audit)]);
  const reportedAgentPairingStatus = ready ? agentPairingStatusFromStatus('ready', controlSession) : 'not_ready';
  const agentPairingProofScopeId = agentPairingProofScopeIdFromControlSession(controlSession);
  const pairingProofMatchesActiveScope = Boolean(
    agentPairingCustomerIdFromControlSession(controlSession) &&
    agentPairingProofScopeId &&
    agentPairingProofScopeId === activeMacControlScopeIdFromControlSession(controlSession)
  );
  const agentPairingStatus =
    (reportedAgentPairingStatus === 'agent_paired' || reportedAgentPairingStatus === 'proof_failed') &&
    !pairingProofMatchesActiveScope
      ? 'ready_for_agent_pairing'
      : reportedAgentPairingStatus;

  return nativeActionResult(
    'setup_check',
    ready ? 'succeeded' : 'repair_required',
    ready
      ? 'Mac Access setup check passed. Local Workbench connector and macOS permissions are ready.'
      : 'Mac Access setup needs repair before agent control can use this Workbench connector.',
    {
      sourcePointer: 'native-companion:setup-check',
      auditId: auditIds[0],
      auditIds,
      setup,
      control: controlSummaryFromPayload(controlSession.data),
      agentPairingStatus,
      blockerReason: ready
        ? undefined
        : (blockerReasonForStatus({
            bridge: { ok: true, data: {} },
            connectorService,
            customerMac,
            controlSession,
            bridgeReady: true,
            connectorServiceReady: setup.connectorReady,
            customerMacReady: setup.macReady,
            bridgePath,
          }) ?? 'unknown'),
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
        blockerReason: 'bundled_bridge_required',
      }
    );
  }

  const customerId = request.customerId?.trim();
  if (!customerId) {
    return nativeActionResult(resultAction, 'repair_required', 'Choose a customer before connecting Mac control.', {
      sourcePointer: 'native-companion:connector-grant-missing-customer',
      blockerReason: 'runtime_not_configured',
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
        blockerReason: 'runtime_not_configured',
      }
    );
  }

  const connectorService =
    prepared?.connectorService ?? (await runBridgeCommand(bridgePath, ['connector-service', 'status', '--json'], deps));
  let sessionConnector = connectorService;
  const sessionConnectorReady = await connectorServiceIsReadyForWorkbenchSession(bridgePath, sessionConnector, deps);
  if (!sessionConnectorReady && !connectorServiceCanAttemptWorkbenchSessionStart(sessionConnector)) {
    return nativeActionResult(
      resultAction,
      'repair_required',
      'Start Mac Access and confirm the secure connector is reachable before connecting Mac control.',
      {
        sourcePointer: 'native-companion:connector-grant-connector-not-ready',
        blockerReason: classifyConnectorServiceBlocker(bridgePath, sessionConnector, 'connector_service_not_ready'),
      }
    );
  }
  if (!connectorServiceHasSecureRegistrationHost(sessionConnector.data)) {
    return nativeActionResult(
      resultAction,
      'repair_required',
      'Mac Access is running locally, but this Mac still needs the broker-owned private connector link before Workbench can connect Mac control.',
      {
        sourcePointer: 'native-companion:connector-grant-secure-network-required',
        agentPairingStatus: 'ready_for_agent_pairing',
        refreshRecommended: false,
        blockerReason: 'secure_network_link_required',
      }
    );
  }

  const controlSession =
    prepared?.controlSession ??
    (await runBridgeCommand(bridgePath, ['customer-mac', 'control', 'status', '--json'], deps));
  let localCustomerMac = prepared?.customerMac;
  let localPermissions = localCustomerMac
    ? effectiveCustomerMacPermissions(permissionView(localCustomerMac.data?.permissions), controlSession)
    : undefined;
  if (!(await workbenchManagedConnectorIsReadyWithEndpoint(bridgePath, sessionConnector, deps))) {
    sessionConnector = await ensureWorkbenchManagedConnectorReady(bridgePath, deps, sessionConnector);
    if (!(await workbenchManagedConnectorIsReadyWithEndpoint(bridgePath, sessionConnector, deps))) {
      return nativeActionResult(
        resultAction,
        'repair_required',
        'Mac control is ready locally, but Workbench could not replace the stale connector with this signed app session. Stop Mac access, then reconnect Mac control.',
        {
          sourcePointer: 'native-companion:connector-grant-workbench-session-start-required',
          auditId: localCustomerMac?.auditId ?? controlSession.auditId,
          auditIds: compactStrings([localCustomerMac?.auditId, controlSession.auditId]),
          blockerReason: classifyConnectorServiceBlocker(bridgePath, sessionConnector, 'stale_connector_port_conflict'),
        }
      );
    }
  }

  let connectorUrl = await resolveConnectorUrlFromStatus(sessionConnector.data, deps);
  let connectorToken = connectorTokenFromStatus(sessionConnector.data, deps);
  if (!connectorUrl) {
    return nativeActionResult(
      resultAction,
      'repair_required',
      'Mac control is ready locally, but Workbench could not determine the private tailnet connector address.',
      {
        sourcePointer: 'native-companion:connector-grant-tailnet-host-unavailable',
        agentPairingStatus: 'ready_for_agent_pairing',
        blockerReason: 'secure_network_link_required',
      }
    );
  }
  if (!connectorToken) {
    return nativeActionResult(
      resultAction,
      'repair_required',
      'Mac control is ready locally, but Workbench could not read the secure connector registration material.',
      {
        sourcePointer: 'native-companion:connector-grant-local-secret-unavailable',
        agentPairingStatus: 'ready_for_agent_pairing',
        blockerReason: 'token_missing',
      }
    );
  }

  let customerMac = await runConnectorCustomerMacStatus({ connectorUrl, connectorToken, deps });
  let permissions = permissionView(customerMac.data?.permissions);
  if (!customerMac.ok || !hasGrantedCorePermissions(permissions)) {
    localCustomerMac =
      localCustomerMac ?? (await runBridgeCommand(bridgePath, ['customer-mac', 'status', '--json'], deps));
    localPermissions = effectiveCustomerMacPermissions(
      permissionView(localCustomerMac.data?.permissions),
      controlSession
    );
    if (
      localCustomerMac.ok &&
      hasGrantedCorePermissions(localPermissions) &&
      !(await workbenchManagedConnectorIsReadyWithEndpoint(bridgePath, sessionConnector, deps))
    ) {
      sessionConnector = await ensureWorkbenchManagedConnectorReady(bridgePath, deps, sessionConnector);
      if (!(await workbenchManagedConnectorIsReadyWithEndpoint(bridgePath, sessionConnector, deps))) {
        return nativeActionResult(
          resultAction,
          'repair_required',
          'Mac control is ready locally, but Workbench could not replace the stale connector with this signed app session. Stop Mac access, then reconnect Mac control.',
          {
            sourcePointer: 'native-companion:connector-grant-workbench-session-start-required',
            auditId: localCustomerMac.auditId,
            auditIds: compactStrings([localCustomerMac.auditId, controlSession.auditId]),
            blockerReason: classifyConnectorServiceBlocker(
              bridgePath,
              sessionConnector,
              'stale_connector_port_conflict'
            ),
          }
        );
      }
      connectorUrl = await resolveConnectorUrlFromStatus(sessionConnector.data, deps);
      connectorToken = connectorTokenFromStatus(sessionConnector.data, deps);
      if (connectorUrl && connectorToken) {
        customerMac = await runConnectorCustomerMacStatus({ connectorUrl, connectorToken, deps });
        permissions = permissionView(customerMac.data?.permissions);
      }
    }
  }
  if (!customerMac.ok || !hasGrantedCorePermissions(permissions)) {
    const detail = customerMac.ok
      ? 'The brokered connector endpoint reports missing Accessibility or Screen Recording.'
      : bridgeFailureDetail(customerMac, 'The brokered connector endpoint could not run customerMacStatus.');
    return nativeActionResult(
      resultAction,
      'repair_required',
      `Mac Access needs the live connector endpoint to prove Accessibility and Screen Recording before Workbench can connect Mac control. ${detail}`,
      {
        sourcePointer: 'native-companion:connector-grant-live-permission-required',
        auditId: customerMac.auditId,
        auditIds: compactStrings([customerMac.auditId]),
        blockerReason: customerMac.ok ? 'permission_missing' : classifyBridgeBlocker(customerMac, 'permission_missing'),
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
          blockerReason: 'broker_session_expired',
        }
      );
    }
    throw error;
  }

  const auditIds = compactStrings([
    grant.auditId,
    customerMac.auditId,
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
      connectorGrant: rendererSafeConnectorGrant(grant),
      agentPairingStatus: grant.agentPairingStatus ?? 'ready_for_agent_pairing',
    }
  );
}

function connectorServiceCanAttemptWorkbenchSessionStart(result: BridgeCommandResult): boolean {
  return connectorServiceIsReady(result) || readNestedBoolean(result.data, ['health', 'reachable']) === true;
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
      blockerReason: result.ok ? undefined : classifyBridgeBlocker(result, 'bridge_diagnostics_unavailable'),
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
        blockerReason: 'bundled_bridge_required',
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
        blockerReason: 'runtime_not_configured',
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
        blockerReason: 'runtime_not_configured',
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
        blockerReason: classifyBridgeBlocker(connector, 'connector_service_not_ready'),
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
        blockerReason: 'secure_network_link_required',
      }
    );
  }

  const customerMac = await runBridgeCommand(bridgePath, ['customer-mac', 'status', '--json'], deps);
  const permissions = permissionView(customerMac.data?.permissions);
  const deviceIdentifier = connectorDeviceIdentifier(customerMac.data);
  if (!hasGrantedCorePermissions(permissions)) {
    const controlSession = await runBridgeCommand(bridgePath, ['customer-mac', 'control', 'status', '--json'], deps);
    if (controlSessionHasPermissionProof(controlSession)) {
      return createPairingPromptWithReadyMac({ bridgePath, customerId, deps, deviceIdentifier });
    }
    return nativeActionResult(
      'create_pairing_prompt',
      'repair_required',
      'Mac Access needs Accessibility and Screen Recording before Workbench can create an agent pairing prompt.',
      {
        sourcePointer: 'native-companion:pairing-mac-permission-required',
        auditId: customerMac.auditId,
        auditIds: compactStrings([customerMac.auditId]),
        blockerReason: 'permission_missing',
      }
    );
  }

  return createPairingPromptWithReadyMac({ bridgePath, customerId, deps, deviceIdentifier });
}

async function createPairingPromptWithReadyMac(input: {
  bridgePath: string;
  customerId: string;
  deps: EvaosNativeCompanionStatusDeps;
  deviceIdentifier?: string;
}): Promise<IEvaosNativeCompanionActionResult> {
  const { bridgePath, customerId, deps, deviceIdentifier } = input;
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
          blockerReason: 'broker_session_expired',
        }
      );
    }
    throw error;
  }
  const registration = await completeLocalConnectorEnrollment({
    bridgePath,
    enrollment,
    deviceName,
    deviceIdentifier,
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
        blockerReason: classifyBridgeBlocker(registration, 'connector_service_not_ready'),
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
  deviceIdentifier?: string;
  deps: EvaosNativeCompanionStatusDeps;
}): Promise<BridgeCommandResult> {
  const args = [
    'connector-service',
    'complete-enrollment',
    '--json',
    '--enrollment-code',
    input.enrollment.pairingCode,
    '--customer-id',
    input.enrollment.customerId,
    '--device-name',
    input.deviceName,
  ];
  if (input.deviceIdentifier) {
    args.push('--device-identifier', input.deviceIdentifier);
  }
  return runBridgeCommand(input.bridgePath, args, input.deps, PAIRING_COMMAND_TIMEOUT_MS);
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
      blockerReason: 'bridge_cli_missing',
    });
  }

  switch (request.action) {
    case 'connector_start':
      return runConnectorStartAction(bridgePath, deps);
    case 'connector_stop':
      return runConnectorStopAction(bridgePath, deps);
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
        blockerReason: 'unknown',
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
}): IEvaosMacControlBlockerReason {
  if (!isPairingCapableBridgePath(input.bridgePath, input.env)) return 'bundled_bridge_required';
  if (!connectorServiceIsReady(input.connectorService)) return 'connector_service_not_ready';
  if (!connectorServiceHasSecureRegistrationHost(input.connectorService.data)) return 'secure_network_link_required';
  return 'pairing_not_ready';
}

function blockerReasonForStatus(input: {
  bridge: BridgeCommandResult;
  connectorService: BridgeCommandResult;
  customerMac: BridgeCommandResult;
  controlSession: BridgeCommandResult;
  bridgeReady: boolean;
  connectorServiceReady: boolean;
  customerMacReady: boolean;
  pairingBlockedReason?: IEvaosMacControlBlockerReason;
  bridgePath?: string;
}): IEvaosMacControlBlockerReason | undefined {
  if (input.bridgeReady && input.connectorServiceReady && input.customerMacReady && !input.pairingBlockedReason) {
    return undefined;
  }
  if (!input.bridge.ok) return classifyBridgeBlocker(input.bridge, 'bridge_diagnostics_unavailable');
  if (!input.bridgeReady || !input.customerMacReady) {
    const permissionReason = classifyPermissionBlocker(input.customerMac, input.controlSession);
    if (permissionReason) return permissionReason;
  }
  if (!input.connectorServiceReady) {
    return input.bridgePath
      ? classifyConnectorServiceBlocker(input.bridgePath, input.connectorService, 'connector_service_not_ready')
      : classifyBridgeBlocker(input.connectorService, 'connector_service_not_ready');
  }
  return input.pairingBlockedReason ?? 'unknown';
}

function classifyPermissionBlocker(
  customerMac: BridgeCommandResult,
  controlSession: BridgeCommandResult
): IEvaosMacControlBlockerReason | undefined {
  const permissions = effectiveCustomerMacPermissions(permissionView(customerMac.data?.permissions), controlSession);
  if (permissionsNeedRepair(permissions)) return 'permission_missing';
  return undefined;
}

function classifyBridgeBlocker(
  result: BridgeCommandResult,
  fallback: IEvaosMacControlBlockerReason
): IEvaosMacControlBlockerReason {
  const haystack = [result.errorCode, result.errorMessage, JSON.stringify(result.errors ?? [])]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  if (/\beaddrinuse\b|address already in use|port[^a-z0-9]+in[^a-z0-9]+use|bind failed/.test(haystack)) {
    return 'port_in_use';
  }
  if (/listener owner|owner mismatch|wrong owner|old app|stale listener|launch[_ -]?agent stale/.test(haystack)) {
    return 'listener_owner_mismatch';
  }
  if (/token.*missing|missing.*token|token.*invalid|no token/.test(haystack)) return 'token_missing';
  if (/not.*workbench.*managed|manual connector|managed_by|not_workbench_managed/.test(haystack)) {
    return 'not_workbench_managed';
  }
  if (/secure.*network|tailnet|private connector|headscale|tailscale|secure.*link/.test(haystack)) {
    return 'secure_network_link_required';
  }
  if (/accessibility|screen recording|screen[_ -]?recording|tcc|permission/.test(haystack)) {
    return 'permission_missing';
  }
  if (/missing_session|expired_session|broker.*401|unauthorized|session.*expired|sign in/.test(haystack)) {
    return 'broker_session_expired';
  }
  if (/codex.*config|unknown variant|service_tier|acp.*handshake|startup.*failed/.test(haystack)) {
    return 'agent_cli_config_invalid';
  }
  if (/runtime.*not.*configured|not configured|hermes.*missing|openclaw.*missing/.test(haystack)) {
    return 'runtime_not_configured';
  }
  return fallback;
}

function connectorServiceHasSecureRegistrationHost(input: unknown): boolean {
  const tailnetIp = readString(input, 'tailnet_ip');
  if (isSafeConnectorRegistrationHost(tailnetIp)) return true;
  if (readNestedBoolean(input, ['health', 'reachable']) !== true) return false;
  const hostKind = readNestedString(input, ['health', 'host_kind']) ?? readNestedString(input, ['health', 'hostKind']);
  if (hostKind === 'tailnet' && readNestedBoolean(input, ['health', 'authenticated']) !== false) return true;
  return isSafeConnectorRegistrationHost(readNestedString(input, ['health', 'host']));
}

function connectorUrlFromStatus(input: unknown): string | undefined {
  const host =
    normalizeConnectorHost(readString(input, 'tailnet_ip')) ??
    normalizeConnectorHost(readNestedString(input, ['health', 'host']));
  if (!isSafeConnectorRegistrationHost(host)) return undefined;
  return `http://${host}:8765`;
}

async function resolveConnectorUrlFromStatus(
  input: unknown,
  deps: EvaosNativeCompanionStatusDeps
): Promise<string | undefined> {
  const statusUrl = connectorUrlFromStatus(input);
  if (statusUrl) return statusUrl;
  if (!connectorStatusAllowsPrivateTailnetHostResolution(input)) return undefined;
  const host = await resolvePrivateTailnetHost(deps);
  return host ? `http://${host}:${CONNECTOR_PORT}` : undefined;
}

function connectorStatusAllowsPrivateTailnetHostResolution(input: unknown): boolean {
  if (readNestedBoolean(input, ['health', 'reachable']) !== true) return false;
  const hostKind = readNestedString(input, ['health', 'host_kind']) ?? readNestedString(input, ['health', 'hostKind']);
  return hostKind === 'tailnet' && readNestedBoolean(input, ['health', 'authenticated']) !== false;
}

async function resolvePrivateTailnetHost(deps: EvaosNativeCompanionStatusDeps): Promise<string | undefined> {
  const envHost = normalizeConnectorHost(deps.env?.EVAOS_DESKTOP_BRIDGE_CONNECTOR_HOST);
  if (isSafeConnectorRegistrationHost(envHost)) return envHost;

  const tailscaleHost = await resolveTailnetHostFromTailscaleCli(deps);
  if (tailscaleHost) return tailscaleHost;

  return resolveTailnetHostFromIfconfig(deps);
}

async function resolveTailnetHostFromTailscaleCli(deps: EvaosNativeCompanionStatusDeps): Promise<string | undefined> {
  const candidates = await Promise.all(
    ['/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale', 'tailscale'].map((command) =>
      runLocalCommandStdout(command, ['ip', '-4'], deps)
    )
  );
  for (const stdout of candidates) {
    const host = firstSafeConnectorHostFromText(stdout);
    if (host) return host;
  }
  return undefined;
}

async function resolveTailnetHostFromIfconfig(deps: EvaosNativeCompanionStatusDeps): Promise<string | undefined> {
  const stdout = await runLocalCommandStdout('/sbin/ifconfig', [], deps);
  return firstSafeConnectorHostFromText(stdout);
}

async function runLocalCommandStdout(
  file: string,
  args: string[],
  deps: EvaosNativeCompanionStatusDeps
): Promise<string | undefined> {
  const execFile = deps.execFile ?? defaultExecFile;
  try {
    const completed = await execFile(file, args, { timeout: 3000 });
    return completed.stdout;
  } catch {
    return undefined;
  }
}

function firstSafeConnectorHostFromText(input: string | undefined): string | undefined {
  if (!input) return undefined;
  for (const match of input.matchAll(/\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g)) {
    const host = normalizeConnectorHost(match[0]);
    if (isSafeConnectorRegistrationHost(host)) return host;
  }
  return undefined;
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

async function runOptionalBridgeDiagnostics(
  bridgePath: string,
  args: string[],
  deps: EvaosNativeCompanionStatusDeps
): Promise<BridgeCommandResult & { source: string }> {
  const result = await runBridgeCommand(bridgePath, args, deps);
  return {
    ...result,
    source: args.slice(0, 2).join(' '),
  };
}

function optionalBridgeDiagnosticsUnavailable(source: string): BridgeCommandResult & { source: string } {
  return {
    ok: false,
    source,
  };
}

function connectorOwnerClassification(
  status: IEvaosNativeCompanionStatusView
): IEvaosWorkbenchDiagnosticPacketV1['connector']['ownerClassification'] {
  if (status.connectorService?.managedBy === 'workbench-session') return 'workbench_managed';
  if (status.blockerReason === 'listener_owner_mismatch' || status.blockerReason === 'not_workbench_managed') {
    return status.blockerReason;
  }
  if (status.connectorService?.managedBy && status.connectorService.managedBy !== 'workbench-session') {
    return 'not_workbench_managed';
  }
  return 'unknown';
}

function safeDiagnosticAuditIds(values: string[]): string[] {
  return compactStrings(values.map((value) => safeDiagnosticText(value))).slice(0, 12);
}

function safeDiagnosticPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\\/g, '/');
  if (/https?:\/\/|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:localhost|127\.0\.0\.1)\b/i.test(normalized)) {
    return '[redacted-endpoint]';
  }
  return safeDiagnosticText(normalized, 280);
}

function safeDiagnosticText(value: string | undefined, maxLength = 220): string | undefined {
  if (!value) return undefined;
  return safeBridgeErrorText(value)?.slice(0, maxLength);
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

async function runConnectorCustomerMacStatus(input: {
  connectorUrl: string;
  connectorToken: string;
  deps: EvaosNativeCompanionStatusDeps;
}): Promise<BridgeCommandResult> {
  const runConnectorCommand = input.deps.runConnectorCommand ?? defaultRunConnectorCommand;
  return runConnectorCommand({
    connectorUrl: input.connectorUrl,
    connectorToken: input.connectorToken,
    command: 'customerMacStatus',
    params: {},
  });
}

async function defaultRunConnectorCommand(input: {
  connectorUrl: string;
  connectorToken: string;
  command: string;
  params?: Record<string, unknown>;
}): Promise<BridgeCommandResult> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const settle = (result: BridgeCommandResult): void => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };

    let url: URL;
    try {
      url = new URL('/v1/commands', input.connectorUrl);
    } catch {
      settle({ ok: false, errorCode: 'connector_url_invalid', errorMessage: 'Connector URL is invalid.' });
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      settle({
        ok: false,
        errorCode: 'connector_protocol_invalid',
        errorMessage: 'Connector URL must use http or https.',
      });
      return;
    }

    const body = JSON.stringify({ command: input.command, params: input.params ?? {} });
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = requestFn(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.connectorToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: PAIRING_COMMAND_TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const parsed = parseBridgeCommandPayload(Buffer.concat(chunks).toString('utf8'));
          if ((response.statusCode ?? 0) >= 400 && parsed.ok) {
            settle({
              ...parsed,
              ok: false,
              errorCode: `connector_http_${response.statusCode}`,
              errorMessage: `Connector command failed with HTTP ${response.statusCode}.`,
            });
            return;
          }
          settle(parsed);
        });
      }
    );
    request.on('timeout', () => {
      request.destroy(new Error('Connector command timed out.'));
    });
    request.on('error', (error) => {
      settle({
        ok: false,
        errorCode: 'connector_command_failed',
        errorMessage: error instanceof Error ? error.message : 'Connector command failed.',
      });
    });
    request.end(body);
  });
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
    .replace(secretFieldPattern, '[redacted]')
    .replace(secretWordPattern, '[redacted]')
    .replace(/https?:\/\/[^\s"')]+/gi, '[redacted-url]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[redacted-ip]')
    .replace(/\b(?:100|10|172|192)\.[0-9.]+(?::\d+)?\b/g, '[redacted-ip]')
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, '[redacted]')
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

function defaultSpawnConnectorProcess(file: string, args: string[], options: SpawnOptions): ChildProcess {
  return spawnCallback(file, args, options);
}

async function defaultProbeConnectorReady(host: string, port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;
    const settle = (ready: boolean): void => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      resolvePromise(ready);
    };

    const request = httpRequest(
      {
        host,
        port,
        path: '/ready',
        method: 'GET',
        timeout: CONNECTOR_READY_PROBE_TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.length;
          if (totalBytes > MAX_CONNECTOR_READY_RESPONSE_BYTES) {
            response.destroy();
            settle(false);
            return;
          }
          chunks.push(buffer);
        });
        response.on('end', () => {
          if ((response.statusCode ?? 0) >= 400) {
            settle(false);
            return;
          }
          try {
            const parsed = parseBridgeCommandPayload(Buffer.concat(chunks).toString('utf8'));
            settle(
              parsed.ok !== false &&
                readBoolean(parsed.data, 'ready') === true &&
                readString(parsed.data, 'service') === 'evaos-desktop-bridge-connector'
            );
          } catch {
            settle(false);
          }
        });
      }
    );
    request.on('timeout', () => {
      request.destroy();
      settle(false);
    });
    request.on('error', () => settle(false));
    deadline = setTimeout(() => {
      request.destroy();
      settle(false);
    }, CONNECTOR_READY_PROBE_DEADLINE_MS);
    request.end();
  });
}

async function defaultOpenPath(path: string): Promise<string> {
  const { shell } = await import('electron');
  return shell.openPath(path);
}

async function defaultSleep(durationMs: number): Promise<void> {
  await new Promise((done) => setTimeout(done, durationMs));
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
    sourcePointer: rendererSafeNativeSourcePointer(options.sourcePointer),
    auditId: options.auditId,
    auditIds: options.auditIds ?? [],
    refreshRecommended: options.refreshRecommended ?? true,
    setup: options.setup,
    control: options.control,
    connectorGrant: options.connectorGrant ? rendererSafeConnectorGrant(options.connectorGrant) : undefined,
    pairing: options.pairing,
    agentPairingStatus: options.agentPairingStatus,
    events: options.events,
    blockerReason: rendererSafeMacControlBlockerReason(options.blockerReason),
  };
}

function rendererSafeNativeSourcePointer(value: string | undefined): string {
  const normalized = safeDiagnosticText(value);
  if (
    normalized &&
    /^(?:native-companion|local-fixture):[A-Za-z0-9:_-]+$/.test(normalized) &&
    !/\[redacted/.test(normalized)
  ) {
    return normalized;
  }
  return 'native-companion:action';
}

function rendererSafeConnectorGrant(grant: IEvaosNativeCompanionConnectorGrant): IEvaosNativeCompanionConnectorGrant {
  return {
    ok: grant.ok === true,
    customerId: safeDiagnosticText(grant.customerId) ?? 'unknown',
    deviceId: safeDiagnosticText(grant.deviceId),
    grantId: safeDiagnosticText(grant.grantId),
    grantState: safeDiagnosticText(grant.grantState),
    agentPairingStatus: grant.agentPairingStatus,
    auditId: safeDiagnosticText(grant.auditId),
  };
}

function rendererSafeMacControlBlockerReason(
  value: IEvaosMacControlBlockerReason | undefined
): IEvaosMacControlBlockerReason | undefined {
  if (value === undefined) return undefined;
  return SAFE_MAC_CONTROL_BLOCKER_REASONS.has(value) ? value : 'unknown';
}

function hasGrantedCorePermissions(permissions: IEvaosNativeCompanionPermissionView | undefined): boolean {
  return permissions?.accessibility === 'granted' && permissions.screenRecording === 'granted';
}

function permissionsNeedRepair(permissions: IEvaosNativeCompanionPermissionView | undefined): boolean {
  if (!permissions) return false;
  return [permissions.accessibility, permissions.screenRecording]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .some((value) => !/^(granted|ready|available|ok)$/i.test(value.trim()));
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
  controlSession: BridgeCommandResult
): IEvaosNativeCompanionAgentPairingStatus {
  if (readiness !== 'ready') return 'not_ready';
  if (!controlSession.ok) return 'ready_for_agent_pairing';
  const explicit =
    readString(controlSession.data, 'agent_pairing_status') ?? readString(controlSession.data, 'agentPairingStatus');
  if (isAgentPairingStatus(explicit)) return explicit;
  if (
    readBoolean(controlSession.data, 'agent_paired') === true ||
    readBoolean(controlSession.data, 'agentPaired') === true
  ) {
    return 'agent_paired';
  }
  return 'ready_for_agent_pairing';
}

function runtimeToolReadinessFromPairing(
  readiness: IEvaosNativeCompanionStatusView['readiness'],
  agentPairingStatus: IEvaosNativeCompanionAgentPairingStatus,
  controlSession: BridgeCommandResult
): IEvaosNativeCompanionRuntimeToolReadiness {
  if (!controlSession.ok || readiness !== 'ready' || agentPairingStatus === 'not_ready') return 'not_ready';
  if (readBoolean(controlSession.data, 'kill_switch') === true) return 'not_ready';
  if (agentPairingStatus === 'proof_failed') return 'proof_failed';
  if (agentPairingStatus !== 'agent_paired') return 'pairing_ready';
  const explicit =
    readString(controlSession.data, 'runtime_tool_readiness') ??
    readString(controlSession.data, 'runtimeToolReadiness');
  if (isRuntimeToolReadiness(explicit)) return explicit;
  return 'pairing_ready';
}

function isRuntimeToolReadiness(value: string | undefined): value is IEvaosNativeCompanionRuntimeToolReadiness {
  return value === 'not_ready' || value === 'pairing_ready' || value === 'tools_ready' || value === 'proof_failed';
}

function runtimeToolProofCustomerIdFromControlSession(controlSession: BridgeCommandResult): string | undefined {
  if (!controlSession.ok) return undefined;
  return (
    readString(controlSession.data, 'runtime_tool_proof_customer_id') ??
    readString(controlSession.data, 'runtimeToolProofCustomerId') ??
    readNestedString(controlSession.data, ['runtime_tool_proof', 'customer_id']) ??
    readNestedString(controlSession.data, ['runtimeToolProof', 'customerId'])
  );
}

function runtimeToolProofScopeIdFromControlSession(controlSession: BridgeCommandResult): string | undefined {
  if (!controlSession.ok) return undefined;
  return (
    readString(controlSession.data, 'runtime_tool_proof_scope_id') ??
    readString(controlSession.data, 'runtimeToolProofScopeId') ??
    readNestedString(controlSession.data, ['runtime_tool_proof', 'scope_id']) ??
    readNestedString(controlSession.data, ['runtimeToolProof', 'scopeId'])
  );
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

function agentPairingCustomerIdFromControlSession(controlSession: BridgeCommandResult): string | undefined {
  if (!controlSession.ok) return undefined;
  return (
    readString(controlSession.data, 'agent_pairing_customer_id') ??
    readString(controlSession.data, 'agentPairingCustomerId') ??
    readNestedString(controlSession.data, ['agent_pairing', 'customer_id']) ??
    readNestedString(controlSession.data, ['agentPairing', 'customerId'])
  );
}

function agentPairingProofScopeIdFromControlSession(controlSession: BridgeCommandResult): string | undefined {
  if (!controlSession.ok) return undefined;
  return (
    readString(controlSession.data, 'agent_pairing_proof_scope_id') ??
    readString(controlSession.data, 'agentPairingProofScopeId') ??
    readNestedString(controlSession.data, ['agent_pairing', 'proof_scope_id']) ??
    readNestedString(controlSession.data, ['agentPairing', 'proofScopeId'])
  );
}

function activeMacControlScopeIdFromControlSession(controlSession: BridgeCommandResult): string | undefined {
  if (!controlSession.ok) return undefined;
  return (
    readString(controlSession.data, 'active_mac_control_scope_id') ??
    readString(controlSession.data, 'activeMacControlScopeId') ??
    readNestedString(controlSession.data, ['active_mac_control', 'scope_id']) ??
    readNestedString(controlSession.data, ['activeMacControl', 'scopeId']) ??
    readNestedString(controlSession.data, ['route_summary', 'canonical_route', 'proof_scope_id']) ??
    readNestedString(controlSession.data, ['routeSummary', 'canonicalRoute', 'proofScopeId'])
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
