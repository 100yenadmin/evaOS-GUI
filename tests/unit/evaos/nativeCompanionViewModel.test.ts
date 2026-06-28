/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  getNativeCompanionRepairViewModel,
  type NativeCompanionUserState,
} from '@/renderer/evaos/nativeCompanionViewModel';
import type { IEvaosNativeCompanionStatusView } from '@/common/evaos/bridgeTypes';

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
    expect(viewModel.readinessStrip.map((item) => item.label)).toEqual(['Connector', 'Agent access', 'Permissions']);
    expect(viewModel.repairSteps.join(' ')).not.toMatch(
      /pairing code|keychain|tcc bypass|access[_-]?token|desktop[_-]?session|provider[_-]?grant|secret/i
    );
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
    const pairing = viewModel.readinessStrip.find((item) => item.label === 'Agent access');
    const pairingStep = viewModel.repairSteps.find((step) => step.title === 'Connect Mac control');
    const toolStep = viewModel.repairSteps.find((step) => step.title === 'Test Mac control');

    expect(viewModel.title).toBe('Mac control ready to connect');
    expect(viewModel.summary).toContain('Connect this signed-in Workbench session');
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
    expect(pairing?.help).toContain('account-scoped connector grant');
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
    const pairing = viewModel.readinessStrip.find((item) => item.label === 'Agent access');
    const pairingStep = viewModel.repairSteps.find((step) => step.title === 'Connect Mac control');

    expect(viewModel.state).toBe('repair_required');
    expect(viewModel.title).toBe('Connect secure Mac link');
    expect(viewModel.summary).toContain('broker-owned private connector link');
    expect(pairing).toMatchObject({
      value: 'Secure link needed',
      tone: 'attention',
    });
    expect(pairingStep).toMatchObject({
      detail: expect.stringContaining('broker-owned private connector link'),
      state: 'neutral',
    });
    expect(viewModel.nextAction).toMatchObject({
      kind: 'run',
      action: 'ensure_customer_mac_connector_grant',
      label: 'Connect Mac Control',
      disabled: true,
      detail: expect.stringContaining('broker-owned private connector link'),
    });
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
      label: 'Choose Mac target',
      title: 'Choose a Mac-control customer',
      step: 3,
      disabled: true,
    });
    expect(viewModel.nextAction.detail).toContain('not a VM-backed Mac-control target');
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

  it('distinguishes a proven paired agent from local connector readiness', () => {
    const viewModel = getNativeCompanionRepairViewModel({
      status: baseStatus({
        readiness: 'ready',
        agentPairingStatus: 'agent_paired',
        summaryText: 'Workbench connector ready with agent proof.',
        bridgeCli: { installed: true, status: 'ready', readOnly: true },
        connectorService: { status: 'ready', running: true, reachable: true },
        customerMac: { status: 'ready' },
      }),
      loading: false,
      error: null,
      hasSelectedCustomer: true,
    });
    const pairing = viewModel.readinessStrip.find((item) => item.label === 'Agent access');
    const pairingStep = viewModel.repairSteps.find((step) => step.title === 'Connect Mac control');

    expect(pairing).toMatchObject({
      value: 'Agent paired',
      tone: 'ready',
    });
    expect(pairingStep).toMatchObject({
      state: 'ready',
    });
    expect(viewModel.summary).toContain('Connect this signed-in Workbench session');
    expect(viewModel.nextAction).toMatchObject({
      kind: 'run',
      action: 'control_start',
      mode: 'full-access',
      label: 'Start Full Access',
      disabled: false,
    });
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
      label: 'Sign In To Workbench',
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
      label: 'Select customer',
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
      label: 'Refresh Workbench Session',
      title: 'Refresh Workbench session',
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

    expect(viewModel.state).toBe('repair_required');
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
      value: 'Granted',
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
      value: 'Granted',
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
