/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  getNativeCompanionRepairViewModel as buildNativeCompanionRepairViewModel,
  type NativeCompanionPrerequisiteCopy,
  type NativeCompanionRepairViewModelInput,
  type NativeCompanionUserState,
} from '@/renderer/evaos/nativeCompanionViewModel';
import type { IEvaosNativeCompanionStatusView } from '@/common/evaos/bridgeTypes';

type TestViewModelInput = Omit<NativeCompanionRepairViewModelInput, 'permissionGuideDetail' | 'prerequisiteCopy'> & {
  permissionGuideDetail?: string;
};

const prerequisiteCopy: NativeCompanionPrerequisiteCopy = {
  repairWorkbenchTitle: 'Repair Workbench',
  repairWorkbenchMissingDetail:
    'This Workbench installation is missing its bundled Mac connector. Reinstall or update Workbench; do not install Python or Homebrew.',
  repairWorkbenchIncompatibleDetail:
    'The bundled Mac connector is not compatible with this Workbench build. Reinstall or update the signed Workbench app.',
  repairControlToolsTitle: 'Repair Mac control tools',
  repairControlToolsDetail:
    'Neither the preferred CUA engine nor the bundled Peekaboo fallback is available. Repair Workbench before pairing this Mac.',
  clientMissingTitle: 'Install secure network',
  clientMissingDetail:
    'Open the official Tailscale macOS download page and follow the normal installer. No terminal, Python, pip, or Homebrew is required.',
  clientStoppedTitle: 'Open secure network',
  clientStoppedDetail:
    'Open the installed secure-network app, allow the normal macOS VPN prompt if shown, then check again.',
  unenrolledTitle: 'Connect this Mac',
  unenrolledDetail:
    'Workbench needs approved enrollment from the selected customer before it can connect this Mac safely.',
  wrongControlPlaneTitle: 'Reconnect secure network',
  wrongControlPlaneDetail:
    'This Mac is on the wrong private network. Workbench needs approved enrollment before reconnecting correctly.',
  aclBlockedTitle: 'Secure network access is blocked',
  aclBlockedDetail:
    'Use Report to support so the customer-scoped network policy can be repaired without exposing private details.',
  offlineTitle: 'Reconnect secure network',
  offlineDetail: 'Reconnect the secure-network client, then ask Workbench to verify it again.',
  errorTitle: 'Check secure network',
  errorDetail:
    'Workbench could not verify the secure network. Use Report to support; do not enter terminal commands or connection details.',
  refreshSessionLabel: 'Localized refresh session label',
  refreshSessionTitle: 'Localized refresh session title',
  refreshSessionDetail: 'Localized refresh session detail',
  checkingSessionLabel: 'Localized checking session label',
  checkingSessionTitle: 'Localized checking session title',
  checkingSessionDetail: 'Localized checking session detail',
  signInLabel: 'Localized sign-in label',
  signInTitle: 'Localized sign-in title',
  signInDetail: 'Localized sign-in detail',
  selectCustomerLabel: 'Localized select customer label',
  selectCustomerTitle: 'Localized select customer title',
  selectCustomerDetail: 'Localized select customer detail',
  chooseMacTargetLabel: 'Localized choose Mac target label',
  chooseMacTargetTitle: 'Localized choose Mac target title',
  chooseMacTargetDetail: 'Localized choose Mac target detail',
};

const getNativeCompanionRepairViewModel = (input: TestViewModelInput) =>
  buildNativeCompanionRepairViewModel({
    ...input,
    permissionGuideDetail: input.permissionGuideDetail ?? 'Localized permission guidance.',
    prerequisiteCopy,
  });

const baseStatus = (overrides: Partial<IEvaosNativeCompanionStatusView> = {}): IEvaosNativeCompanionStatusView => ({
  schemaVersion: 'evaos.native_companion_status.v1',
  generatedAt: '2026-06-07T03:45:00.000Z',
  readiness: 'repair_required',
  summaryText: 'Native companion repair is required before evaOS or Hermes can use Mac control.',
  sourcePointer: 'native-companion:read-only-bridge',
  canOpenReleasedWorkbench: true,
  releasedWorkbench: { installed: true, path: '/Applications/evaOS Workbench.app' },
  bridgeCli: {
    installed: true,
    status: 'repair_required',
    readOnly: true,
    permissions: {
      accessibility: 'granted',
      screenRecording: 'granted',
    },
  },
  connectorService: {
    status: 'repair_required',
    running: false,
    reachable: false,
  },
  customerMac: {
    status: 'repair_required',
    permissions: {
      accessibility: 'granted',
      screenRecording: 'granted',
    },
  },
  iPhone: {
    status: 'available',
    installed: true,
    running: false,
  },
  audit: {
    status: 'ready',
    auditIds: ['audit-native'],
  },
  ...overrides,
});

describe('nativeCompanionViewModel', () => {
  it('collapses raw native status into the six user-facing repair states', () => {
    const cases: Array<[string, IEvaosNativeCompanionStatusView | null, NativeCompanionUserState]> = [
      [
        'ready',
        baseStatus({
          readiness: 'ready',
          summaryText: 'Native companion ready.',
          bridgeCli: { installed: true, status: 'ready', readOnly: true },
          connectorService: { status: 'ready', running: true, reachable: true },
          customerMac: { status: 'ready' },
        }),
        'ready',
      ],
      [
        'not paired',
        baseStatus({
          summaryText: 'NOT_PAIRED: pairing required: device identity changed and must be re-approved.',
          customerMac: { status: 'repair_required' },
        }),
        'not_paired',
      ],
      [
        'permission needed',
        baseStatus({
          bridgeCli: {
            installed: true,
            status: 'repair_required',
            readOnly: true,
            permissions: { accessibility: 'denied', screenRecording: 'granted' },
          },
          customerMac: {
            status: 'repair_required',
            permissions: { accessibility: 'denied', screenRecording: 'granted' },
          },
        }),
        'permission_needed',
      ],
      [
        'offline',
        baseStatus({
          readiness: 'unavailable',
          summaryText: 'Native status source is offline or stale.',
          sourcePointer: 'native-companion:offline',
        }),
        'offline',
      ],
      [
        'unsupported',
        baseStatus({
          summaryText: 'Native companion is not installed on this Mac.',
          releasedWorkbench: { installed: false },
          canOpenReleasedWorkbench: false,
          bridgeCli: { installed: false, status: 'missing', readOnly: true },
          customerMac: { status: 'unavailable' },
        }),
        'unsupported',
      ],
      ['generic repair', baseStatus(), 'repair_required'],
      ['missing status', null, 'offline'],
    ];

    const allowed = new Set<NativeCompanionUserState>([
      'ready',
      'repair_required',
      'not_paired',
      'permission_needed',
      'offline',
      'unsupported',
    ]);

    for (const [name, status, expected] of cases) {
      const viewModel = getNativeCompanionRepairViewModel({ status, loading: false, error: null });

      expect(viewModel.state, name).toBe(expected);
      expect(allowed.has(viewModel.state), name).toBe(true);
    }
  });

  it('routes NOT_PAIRED to a repair action without renderer-owned trust claims', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        summaryText: 'NOT_PAIRED: pairing required before local Mac control can run.',
      }),
      loading: false,
      error: null,
      hasSelectedCustomer: true,
    });

    expect(viewModel.state).toBe('not_paired');
    expect(viewModel.primaryAction.kind).toBe('refresh');
    expect(viewModel.primaryAction.label).toBe('Check again');
    expect(viewModel.readinessStrip.map((item) => item.help).join(' ')).not.toMatch(/AionUi|Aion CLI/i);
    expect(viewModel.readinessStrip.map((item) => item.label)).toEqual(['Connector', 'Agent runtime', 'Permissions']);
    expect(viewModel.repairSteps.join(' ')).not.toMatch(
      /pairing code|keychain|tcc bypass|access[_-]?token|desktop[_-]?session|provider[_-]?grant|secret/i
    );
  });

  it('guides users to add the Workbench app row for a missing macOS permission', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        bridgeCli: {
          installed: true,
          status: 'permission_needed',
          readOnly: true,
          permissions: { accessibility: 'granted', screenRecording: 'missing' },
        },
        connectorService: { status: 'ready', running: true, reachable: true },
        customerMac: {
          status: 'permission_needed',
          permissions: { accessibility: 'granted', screenRecording: 'missing' },
        },
      }),
      loading: false,
      error: null,
      permissionGuideDetail: 'Localized permission guidance.',
    });

    expect(viewModel.nextAction).toMatchObject({
      kind: 'repair',
      repairAction: 'screen_recording',
      label: 'Open Screen Recording',
      detail: 'Localized permission guidance.',
    });
  });

  it('does not overclaim agent pairing when local Mac control is ready', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        summaryText: 'Workbench connector ready.',
        bridgeCli: { installed: true, status: 'ready', readOnly: true },
        connectorService: { status: 'ready', running: true, reachable: true },
        customerMac: { status: 'ready' },
      }),
      loading: false,
      error: null,
      hasSelectedCustomer: true,
    });
    const pairing = viewModel.readinessStrip.find((item) => item.label === 'Agent runtime');
    const pairingStep = viewModel.repairSteps.find((step) => step.title === 'Connect Mac control');
    const toolStep = viewModel.repairSteps.find((step) => step.title === 'Test Mac control');

    expect(viewModel.title).toBe('This Mac is locally ready');
    expect(viewModel.summary).toContain('Local Workbench connector and macOS permissions are ready');
    expect(viewModel.nextAction).toMatchObject({
      kind: 'run',
      action: 'ensure_customer_mac_connector_grant',
      label: 'Connect Mac Control',
      step: 3,
      disabled: false,
    });
    expect(pairing).toMatchObject({
      value: 'Ready to connect',
      tone: 'attention',
    });
    expect(pairing?.help).toContain('End-to-end broker grant and runtime tool proof');
    expect(pairingStep?.detail).toContain('do not expose public Mac, VNC, SSH, or browser debug ports');
    expect(toolStep).toMatchObject({
      state: 'neutral',
    });
  });

  it('does not call a loopback-only connector ready for agent pairing', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        readiness: 'ready',
        agentPairingStatus: 'not_ready',
        pairingCapable: false,
        pairingBlockedReason: 'secure_network_link_required',
        summaryText:
          'Workbench connector is locally ready, but this Mac needs the broker-owned private connector link before agent pairing can start.',
        bridgeCli: { installed: true, status: 'ready', readOnly: true },
        connectorService: { status: 'ready', running: true, reachable: true },
        customerMac: { status: 'ready' },
      }),
      loading: false,
      error: null,
      hasSelectedCustomer: true,
    });
    const pairing = viewModel.readinessStrip.find((item) => item.label === 'Agent runtime');
    const pairingStep = viewModel.repairSteps.find((step) => step.title === 'Connect Mac control');

    expect(viewModel.state).toBe('ready');
    expect(viewModel.title).toBe('This Mac is locally ready');
    expect(viewModel.summary).toContain('Local Workbench connector and macOS permissions are ready');
    expect(pairing).toMatchObject({
      value: 'Agent setup needed',
      tone: 'attention',
    });
    expect(pairingStep).toMatchObject({
      detail: expect.stringContaining('broker-owned private connector link'),
      state: 'attention',
    });
    expect(viewModel.nextAction).toMatchObject({
      kind: 'run',
      action: 'ensure_customer_mac_connector_grant',
      label: 'Connect Mac Control',
      disabled: true,
      detail: expect.stringContaining('broker-owned private connector link'),
    });
  });

  it('guides a pristine Mac to the official secure-network download page before starting the connector', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        pairingCapable: false,
        pairingBlockedReason: 'secure_network_link_required',
        prerequisites: {
          bridgeRuntime: 'ready',
          privateNetwork: 'client_missing',
          actionEngine: 'peekaboo_ready',
        },
      }),
      loading: false,
      error: null,
      brokerAuthenticated: true,
      brokerSessionLoading: false,
      hasSelectedCustomer: true,
      hasPairableCustomer: true,
    });

    expect(viewModel.state).toBe('repair_required');
    expect(viewModel.title).toBe('Install secure network');
    expect(viewModel.nextAction).toMatchObject({
      kind: 'repair',
      repairAction: 'secure_network_install',
      label: 'Install secure network',
      step: 1,
      disabled: false,
    });
    expect(viewModel.nextAction.detail).toContain('official Tailscale macOS download page');
  });

  it('opens an installed but stopped secure-network client before starting the connector', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        pairingCapable: false,
        pairingBlockedReason: 'secure_network_link_required',
        prerequisites: {
          bridgeRuntime: 'ready',
          privateNetwork: 'client_stopped',
          actionEngine: 'cua_ready',
        },
      }),
      loading: false,
      error: null,
    });

    expect(viewModel.title).toBe('Open secure network');
    expect(viewModel.nextAction).toMatchObject({
      kind: 'repair',
      repairAction: 'secure_network_open',
      label: 'Open secure network',
      disabled: false,
    });
  });

  it('offers broker-owned one-use enrollment for an installed unenrolled client', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        pairingCapable: false,
        pairingBlockedReason: 'secure_network_link_required',
        prerequisites: {
          bridgeRuntime: 'ready',
          privateNetwork: 'unenrolled',
          actionEngine: 'cua_ready',
        },
      }),
      brokerAuthenticated: true,
      brokerSessionLoading: false,
      hasSelectedCustomer: true,
      hasPairableCustomer: true,
      loading: false,
      error: null,
    });

    expect(viewModel.title).toBe('Connect this Mac');
    expect(viewModel.nextAction).toMatchObject({
      kind: 'run',
      action: 'secure_network_enroll',
      label: 'Connect this Mac',
      disabled: false,
    });
    expect(viewModel.nextAction.detail).toContain('approved enrollment');
  });

  it('requires an authenticated broker session before offering private-network enrollment', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        pairingCapable: false,
        pairingBlockedReason: 'secure_network_link_required',
        prerequisites: {
          bridgeRuntime: 'ready',
          privateNetwork: 'unenrolled',
          actionEngine: 'cua_ready',
        },
      }),
      brokerAuthenticated: false,
      brokerSessionLoading: false,
      hasSelectedCustomer: true,
      hasPairableCustomer: true,
      loading: false,
      error: null,
    });

    expect(viewModel.nextAction).toMatchObject({
      kind: 'reconnect',
      label: 'Localized sign-in label',
      title: 'Localized sign-in title',
      detail: 'Localized sign-in detail',
      step: 1,
      disabled: false,
    });
  });

  it('routes a rejected private-network broker session to session recovery', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        pairingCapable: false,
        pairingBlockedReason: 'secure_network_link_required',
        prerequisites: {
          bridgeRuntime: 'ready',
          privateNetwork: 'unenrolled',
          actionEngine: 'cua_ready',
        },
      }),
      actionResult: {
        action: 'secure_network_enroll',
        status: 'repair_required',
        message: 'Session refresh required.',
        sourcePointer: 'native-companion:secure-network-enrollment-broker-session-required',
        refreshRecommended: false,
        auditIds: [],
      },
      brokerAuthenticated: true,
      brokerSessionLoading: false,
      hasSelectedCustomer: true,
      hasPairableCustomer: true,
      loading: false,
      error: null,
    });

    expect(viewModel.nextAction).toMatchObject({
      kind: 'reconnect',
      label: 'Localized refresh session label',
      title: 'Localized refresh session title',
      detail: 'Localized refresh session detail',
      step: 1,
      disabled: false,
    });
  });

  it('keeps one-use private-network enrollment disabled while broker verification is pending', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        pairingCapable: false,
        pairingBlockedReason: 'secure_network_link_required',
        prerequisites: {
          bridgeRuntime: 'ready',
          privateNetwork: 'unenrolled',
          actionEngine: 'cua_ready',
        },
      }),
      actionResult: {
        action: 'secure_network_enroll',
        status: 'succeeded',
        message: 'Unlocalized enrollment submission detail.',
        sourcePointer: 'native-companion:secure-network-enrollment-submitted',
        refreshRecommended: true,
        auditIds: [],
      },
      brokerAuthenticated: true,
      brokerSessionLoading: false,
      hasSelectedCustomer: true,
      hasPairableCustomer: true,
      loading: false,
      error: null,
    });

    expect(viewModel.nextAction).toMatchObject({
      kind: 'none',
      label: 'Connect this Mac',
      disabled: true,
      step: 1,
    });
  });

  it.each([
    ['wrong_control_plane', 'Reconnect secure network', 'wrong private network'],
    ['acl_blocked', 'Secure network access is blocked', 'support'],
    ['error', 'Check secure network', 'could not verify'],
  ] as const)(
    'keeps %s fail closed with precise guidance and no unsafe local enrollment action',
    (privateNetwork, title, detail) => {
      const viewModel = getNativeCompanionRepairViewModel({
        status: baseStatus({
          pairingCapable: false,
          pairingBlockedReason: 'secure_network_link_required',
          prerequisites: {
            bridgeRuntime: 'ready',
            privateNetwork,
            actionEngine: 'native_fallback_ready',
          },
        }),
        loading: false,
        error: null,
      });

      expect(viewModel.state).toBe('repair_required');
      expect(viewModel.title).toBe(title);
      expect(viewModel.nextAction).toMatchObject({ kind: 'none', disabled: true });
      expect(viewModel.nextAction.detail.toLowerCase()).toContain(detail);
    }
  );

  it('routes enrolled authority-session expiry to Workbench session refresh before generic network repair', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        blockerReason: 'broker_session_expired',
        privateNetworkAuthority: { classification: 'unavailable', reason: 'broker_session_expired' },
        prerequisites: {
          bridgeRuntime: 'ready',
          privateNetwork: 'error',
          actionEngine: 'peekaboo_ready',
        },
      }),
      brokerAuthenticated: true,
      hasSelectedCustomer: true,
      hasPairableCustomer: true,
      loading: false,
      error: null,
    });

    expect(viewModel.nextAction).toMatchObject({
      kind: 'reconnect',
      label: 'Localized refresh session label',
      title: 'Localized refresh session title',
      disabled: false,
    });
  });

  it('does not render local-ready when explicit prerequisite proof is incomplete', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        readiness: 'repair_required',
        pairingCapable: false,
        pairingBlockedReason: 'secure_network_link_required',
        prerequisites: {
          bridgeRuntime: 'ready',
          privateNetwork: 'error',
          actionEngine: 'peekaboo_ready',
        },
        bridgeCli: { installed: true, status: 'ready', readOnly: true },
        connectorService: { status: 'ready', running: true, reachable: true },
        customerMac: { status: 'ready' },
      }),
      loading: false,
      error: null,
    });

    expect(viewModel.state).toBe('repair_required');
    expect(viewModel.title).toBe('Check secure network');
    expect(viewModel.statusLabel).not.toBe('local ready');
  });

  it('treats a missing packaged bridge as a Workbench release defect instead of asking for Python', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        pairingCapable: false,
        pairingBlockedReason: 'bundled_bridge_required',
        prerequisites: {
          bridgeRuntime: 'missing',
          privateNetwork: 'online',
          actionEngine: 'peekaboo_ready',
        },
      }),
      loading: false,
      error: null,
    });

    expect(viewModel.title).toBe('Repair Workbench');
    expect(viewModel.summary).toContain('do not install Python or Homebrew');
    expect(viewModel.nextAction).toMatchObject({
      kind: 'none',
      label: 'Repair Workbench',
      disabled: true,
    });
    expect(viewModel.nextAction.detail).not.toMatch(/pip install|brew install|terminal command/i);
  });

  it('keeps an unavailable CUA and Peekaboo toolchain blocked without changing the engine preference', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        pairingCapable: false,
        pairingBlockedReason: 'bundled_bridge_required',
        prerequisites: {
          bridgeRuntime: 'ready',
          privateNetwork: 'online',
          actionEngine: 'unavailable',
        },
      }),
      loading: false,
      error: null,
    });

    expect(viewModel.title).toBe('Repair Mac control tools');
    expect(viewModel.summary).toContain('CUA');
    expect(viewModel.summary).toContain('Peekaboo fallback');
    expect(viewModel.nextAction).toMatchObject({ kind: 'none', disabled: true });
  });

  it('does not enable pairing for account-only customer targets', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        summaryText: 'Workbench connector ready.',
        bridgeCli: { installed: true, status: 'ready', readOnly: true },
        connectorService: { status: 'ready', running: true, reachable: true },
        customerMac: { status: 'ready' },
      }),
      loading: false,
      error: null,
      hasSelectedCustomer: true,
      hasPairableCustomer: false,
    });

    expect(viewModel.nextAction).toMatchObject({
      kind: 'none',
      label: 'Localized choose Mac target label',
      title: 'Localized choose Mac target title',
      step: 3,
      disabled: true,
    });
    expect(viewModel.nextAction.detail).toBe('Localized choose Mac target detail');
  });

  it('does not overclaim ready when the connector service is offline', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        summaryText: 'Workbench connector ready.',
        bridgeCli: {
          installed: true,
          status: 'ready',
          readOnly: true,
          permissions: { accessibility: 'granted', screenRecording: 'granted' },
        },
        connectorService: { status: 'repair_required', running: false, reachable: false },
        customerMac: {
          status: 'ready',
          permissions: { accessibility: 'granted', screenRecording: 'granted' },
        },
      }),
      loading: false,
      error: null,
      hasSelectedCustomer: true,
    });
    const connector = viewModel.readinessStrip.find((item) => item.label === 'Connector');

    expect(viewModel.state).toBe('repair_required');
    expect(connector).toMatchObject({
      value: 'Repair needed',
      tone: 'attention',
    });
    expect(viewModel.nextAction).toMatchObject({
      kind: 'run',
      action: 'connector_start',
      label: 'Turn On Mac Access',
      disabled: false,
    });
  });

  it('offers refresh instead of another restart after preserving an unproven listener handoff', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        readiness: 'repair_required',
        agentPairingStatus: 'not_ready',
        connectorService: { status: 'repair_required', running: true, reachable: false },
      }),
      loading: false,
      error: null,
      hasSelectedCustomer: true,
      actionResult: {
        action: 'connector_start',
        status: 'repair_required',
        message: 'The existing Mac Access owner was preserved.',
        sourcePointer: 'native-companion:workbench-session-connector-start',
        auditIds: [],
        refreshRecommended: true,
        blockerReason: 'listener_replacement_unproven',
      },
    });

    expect(viewModel.nextAction).toMatchObject({
      kind: 'refresh',
      label: 'Refresh status',
      title: 'Reconnect Mac control',
      detail: 'Workbench cannot read current Mac control status. Refresh before pairing or agent control.',
      disabled: false,
    });
    expect(viewModel.nextAction).not.toHaveProperty('action');
  });

  it('lets refreshed ready connector truth supersede a stale unproven-listener result', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        bridgeCli: { installed: true, status: 'ready', readOnly: true },
        connectorService: { status: 'ready', running: true, reachable: true },
        customerMac: { status: 'ready' },
      }),
      loading: false,
      error: null,
      hasSelectedCustomer: true,
      actionResult: {
        action: 'connector_start',
        status: 'repair_required',
        message: 'The existing Mac Access owner was preserved.',
        sourcePointer: 'native-companion:workbench-session-connector-start',
        auditIds: [],
        refreshRecommended: true,
        blockerReason: 'listener_replacement_unproven',
      },
    });

    expect(viewModel.nextAction.kind).not.toBe('refresh');
    expect(viewModel.nextAction.label).not.toBe('Refresh status');
  });

  it('distinguishes proven runtime tools from local connector readiness', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        readiness: 'ready',
        agentPairingStatus: 'agent_paired',
        runtimeToolReadiness: 'tools_ready',
        summaryText: 'Workbench connector ready with agent proof.',
        bridgeCli: { installed: true, status: 'ready', readOnly: true },
        connectorService: { status: 'ready', running: true, reachable: true },
        customerMac: { status: 'ready' },
      }),
      loading: false,
      error: null,
      hasSelectedCustomer: true,
    });
    const pairing = viewModel.readinessStrip.find((item) => item.label === 'Agent runtime');
    const pairingStep = viewModel.repairSteps.find((step) => step.title === 'Connect Mac control');

    expect(pairing).toMatchObject({
      value: 'End-to-end ready',
      tone: 'ready',
    });
    expect(pairingStep).toMatchObject({
      state: 'ready',
    });
    expect(viewModel.summary).toContain('End-to-end broker and runtime tool proof is ready');
    expect(viewModel.nextAction).toMatchObject({
      kind: 'run',
      action: 'control_start',
      mode: 'full-access',
      label: 'Start Full Access',
      disabled: false,
    });
  });

  it('keeps an active connector grant below end-to-end ready until runtime tools are proven', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        readiness: 'ready',
        agentPairingStatus: 'agent_paired',
        runtimeToolReadiness: 'pairing_ready',
        summaryText: 'Workbench connector ready with an active account-scoped grant.',
        bridgeCli: { installed: true, status: 'ready', readOnly: true },
        connectorService: { status: 'ready', running: true, reachable: true },
        customerMac: { status: 'ready' },
      }),
      loading: false,
      error: null,
      hasSelectedCustomer: true,
    });
    const pairing = viewModel.readinessStrip.find((item) => item.label === 'Agent runtime');
    const toolStep = viewModel.repairSteps.find((step) => step.title === 'Test Mac control');

    expect(viewModel.title).toBe('This Mac is locally ready');
    expect(viewModel.summary).toContain('not proven end to end');
    expect(pairing).toMatchObject({
      value: 'Grant active; test needed',
      tone: 'attention',
    });
    expect(toolStep).toMatchObject({ state: 'neutral' });
  });

  it('prioritizes one next action through the Mac pairing flow', () => {
    const readyStatus = baseStatus({
      readiness: 'ready',
      agentPairingStatus: 'ready_for_agent_pairing',
      summaryText: 'Workbench connector ready.',
      bridgeCli: {
        installed: true,
        status: 'ready',
        readOnly: true,
        permissions: { accessibility: 'granted', screenRecording: 'granted' },
      },
      connectorService: { status: 'ready', running: true, reachable: true },
      customerMac: {
        status: 'ready',
        permissions: { accessibility: 'granted', screenRecording: 'granted' },
      },
    });

    expect(
      getNativeCompanionRepairViewModel({
        status: readyStatus,
        loading: false,
        error: null,
        brokerAuthenticated: false,
        hasSelectedCustomer: false,
      }).nextAction
    ).toMatchObject({
      kind: 'reconnect',
      label: 'Localized sign-in label',
      disabled: false,
    });

    expect(
      getNativeCompanionRepairViewModel({
        status: readyStatus,
        loading: false,
        error: null,
        hasSelectedCustomer: false,
      }).nextAction
    ).toMatchObject({
      kind: 'none',
      label: 'Localized select customer label',
      disabled: true,
    });

    expect(
      getNativeCompanionRepairViewModel({
        status: {
          ...readyStatus,
          agentPairingStatus: 'pairing_prompt_created',
        },
        loading: false,
        error: null,
        hasSelectedCustomer: true,
        actionResult: {
          action: 'create_pairing_prompt',
          status: 'repair_required',
          message: 'Sign in again.',
          sourcePointer: 'native-companion:pairing-broker-session-required',
          auditIds: [],
          refreshRecommended: false,
        },
      }).nextAction
    ).toMatchObject({
      kind: 'reconnect',
      label: 'Localized refresh session label',
      title: 'Localized refresh session title',
    });

    expect(
      getNativeCompanionRepairViewModel({
        status: readyStatus,
        loading: false,
        error: null,
        hasSelectedCustomer: true,
        actionResult: {
          action: 'create_pairing_prompt',
          status: 'repair_required',
          message: 'Workbench created a pairing code, but the local connector could not register it with evaOS.',
          sourcePointer: 'native-companion:pairing-registration-failed',
          agentPairingStatus: 'ready_for_agent_pairing',
          auditIds: [],
          refreshRecommended: false,
        },
      }).nextAction
    ).toMatchObject({
      kind: 'run',
      action: 'ensure_customer_mac_connector_grant',
      label: 'Connect Mac Control',
      title: 'Connect Mac control',
      detail: expect.stringContaining('local connector could not register'),
      disabled: false,
    });

    expect(
      getNativeCompanionRepairViewModel({
        status: readyStatus,
        loading: false,
        error: null,
        hasSelectedCustomer: true,
        actionResult: {
          action: 'create_pairing_prompt',
          status: 'succeeded',
          message: 'Pairing prompt is ready.',
          sourcePointer: 'native-companion:pairing-prompt',
          auditIds: [],
          refreshRecommended: false,
          pairing: {
            customerId: 'golden',
            pairingCode: 'PAIR-1234',
            setupPrompt: 'Pairing code: PAIR-1234',
          },
        },
      }).nextAction
    ).toMatchObject({
      kind: 'copy',
      label: 'Copy Pairing Prompt',
    });

    expect(
      getNativeCompanionRepairViewModel({
        status: readyStatus,
        loading: false,
        error: null,
        hasSelectedCustomer: true,
        actionResult: {
          action: 'create_pairing_prompt',
          status: 'repair_required',
          message: 'Workbench created a pairing code, but the local connector could not register it with evaOS.',
          sourcePointer: 'native-companion:pairing-registration-failed',
          agentPairingStatus: 'ready_for_agent_pairing',
          auditIds: [],
          refreshRecommended: false,
          pairing: {
            customerId: 'golden',
            pairingCode: 'PAIR-1234',
            setupPrompt: 'Pairing code: PAIR-1234',
          },
        },
      }).nextAction
    ).toMatchObject({
      kind: 'run',
      action: 'ensure_customer_mac_connector_grant',
      label: 'Connect Mac Control',
      detail: expect.stringContaining('local connector could not register'),
    });

    expect(
      getNativeCompanionRepairViewModel({
        status: readyStatus,
        loading: false,
        error: null,
        hasSelectedCustomer: true,
        actionResult: {
          action: 'create_pairing_prompt',
          status: 'succeeded',
          message: 'Pairing prompt is ready.',
          sourcePointer: 'native-companion:pairing-prompt',
          auditIds: [],
          refreshRecommended: false,
          pairing: {
            customerId: 'golden',
            pairingCode: 'PAIR-1234',
            setupPrompt: 'Pairing code: PAIR-1234',
          },
        },
        pairingPromptCopied: true,
      }).nextAction
    ).toMatchObject({
      kind: 'run',
      action: 'setup_check',
      label: 'Run Setup Check',
    });
  });

  it('keeps pairing available after a failed control start when connector prerequisites are ready', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        readiness: 'repair_required',
        summaryText: 'Workbench connector ready for code-only agent pairing.',
        bridgeCli: {
          installed: true,
          status: 'ready',
          readOnly: true,
          permissions: { accessibility: 'granted', screenRecording: 'granted' },
        },
        connectorService: { status: 'ready', running: true, reachable: true },
        customerMac: {
          status: 'ready',
          permissions: { accessibility: 'granted', screenRecording: 'granted' },
        },
        controlSession: {
          status: 'repair_required',
          active: false,
          killSwitch: false,
        },
      }),
      loading: false,
      error: null,
      hasSelectedCustomer: true,
      actionResult: {
        action: 'control_start',
        status: 'repair_required',
        message: 'Agent control could not start.',
        sourcePointer: 'native-companion:customer-mac-control-start',
        auditIds: [],
        refreshRecommended: false,
      },
    });

    expect(viewModel.state).toBe('ready');
    expect(viewModel.nextAction).toMatchObject({
      kind: 'run',
      action: 'ensure_customer_mac_connector_grant',
      label: 'Connect Mac Control',
      disabled: false,
    });
  });

  it('does not let a stale failed repair action override current ready permission proof', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        summaryText: 'Workbench connector ready for code-only agent pairing.',
        bridgeCli: {
          installed: true,
          status: 'ready',
          readOnly: true,
          permissions: { accessibility: 'granted', screenRecording: 'granted' },
        },
        connectorService: { status: 'ready', running: true, reachable: true },
        customerMac: {
          status: 'ready',
          permissions: { accessibility: 'granted', screenRecording: 'granted' },
        },
      }),
      loading: false,
      error: null,
      hasSelectedCustomer: true,
      actionResult: {
        action: 'setup_check',
        status: 'repair_required',
        message: 'Mac control setup needs repair before evaOS or Hermes can use this Workbench connector.',
        sourcePointer: 'native-companion:setup-check',
        auditIds: [],
        refreshRecommended: false,
      },
    });

    expect(viewModel.state).toBe('ready');
    expect(viewModel.readinessStrip.find((item) => item.label === 'Permissions')).toMatchObject({
      value: 'Granted on this Mac',
      tone: 'ready',
    });
    expect(viewModel.repairSteps.find((step) => step.title === 'Allow screen and control')).toMatchObject({
      detail: 'Accessibility and Screen Recording are ready.',
      state: 'ready',
    });
    expect(viewModel.nextAction).toMatchObject({
      kind: 'run',
      action: 'ensure_customer_mac_connector_grant',
      label: 'Connect Mac Control',
      disabled: false,
    });
  });

  it('trusts ready process status over stale bridge permission fields', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        summaryText: 'Workbench connector ready for code-only agent pairing.',
        bridgeCli: {
          installed: true,
          status: 'ready',
          readOnly: true,
          permissions: { accessibility: 'granted', screenRecording: 'missing' },
        },
        connectorService: { status: 'ready', running: true, reachable: true },
        customerMac: {
          status: 'ready',
          permissions: { accessibility: 'granted', screenRecording: 'granted' },
        },
      }),
      loading: false,
      error: null,
      hasSelectedCustomer: true,
    });

    expect(viewModel.state).toBe('ready');
    expect(viewModel.readinessStrip.find((item) => item.label === 'Permissions')).toMatchObject({
      value: 'Granted on this Mac',
      tone: 'ready',
    });
    expect(viewModel.nextAction).toMatchObject({
      kind: 'run',
      action: 'ensure_customer_mac_connector_grant',
      label: 'Connect Mac Control',
      disabled: false,
    });
  });
});
