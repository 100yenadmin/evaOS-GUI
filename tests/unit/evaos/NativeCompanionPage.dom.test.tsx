/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NativeCompanionPage from '@/renderer/pages/native-companion';

const bridgeMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  openReleasedWorkbench: vi.fn(),
  openRepairAction: vi.fn(),
  runAction: vi.fn(),
}));

const supportEmailMock = vi.hoisted(() => ({
  openEvaosSupportEmail: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    evaosNativeCompanion: {
      getStatus: {
        invoke: bridgeMocks.getStatus,
      },
      openReleasedWorkbench: {
        invoke: bridgeMocks.openReleasedWorkbench,
      },
      openRepairAction: {
        invoke: bridgeMocks.openRepairAction,
      },
      runAction: {
        invoke: bridgeMocks.runAction,
      },
    },
  },
}));

vi.mock('@renderer/hooks/context/EvaosCustomerContext', () => ({
  useEvaosBrokeredCustomerContext: () => ({
    customerContext: {
      selectedCustomerId: 'benjamin-kennedy',
      selectedTarget: { displayName: 'Benjamin Kennedy' },
      loading: false,
      loaded: true,
    },
  }),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  openEvaosSupportEmail: supportEmailMock.openEvaosSupportEmail,
}));

function renderNativeCompanion() {
  return render(
    <ConfigProvider>
      <NativeCompanionPage />
    </ConfigProvider>
  );
}

describe('NativeCompanionPage', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
    window.location.hash = '';
  });

  it('renders integrated Mac control status and keeps legacy fallback advanced-only', async () => {
    localStorage.setItem('evaos.supportDiagnostics', '1');
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-07T03:45:00.000Z',
        readiness: 'ready',
        summaryText: 'Native bridge ready from read-only adapter proof.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: true,
        releasedWorkbench: {
          installed: true,
          running: false,
          path: '/Applications/evaOS.app',
          version: '0.6.28',
        },
        bridgeCli: {
          installed: true,
          status: 'ready',
          auditId: 'audit-bridge',
          readOnly: true,
          permissions: {
            accessibility: 'granted',
            screenRecording: 'granted',
          },
        },
        customerMac: {
          status: 'ready',
          auditId: 'audit-mac',
          deviceLabel: 'EVAs-Mac-mini.local',
          permissions: {
            accessibility: 'granted',
            screenRecording: 'granted',
          },
        },
        iPhone: {
          status: 'available',
          auditId: 'audit-iphone',
          installed: true,
          running: false,
        },
        audit: {
          status: 'ready',
          auditIds: ['audit-mac', 'audit-iphone'],
        },
      },
    });
    bridgeMocks.openReleasedWorkbench.mockResolvedValue({
      success: true,
      data: {
        opened: true,
        path: '/Applications/evaOS.app',
        message: 'Opened released evaOS Workbench for native pairing and repair.',
      },
    });

    const user = userEvent.setup();
    const { container } = renderNativeCompanion();

    expect(await screen.findByText('Mac control is ready')).toBeInTheDocument();
    expect(screen.getByText(/Local Workbench connector proof is ready/i)).toBeInTheDocument();
    expect(screen.getByText('Pair evaOS/OpenClaw or Hermes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Pairing Prompt' })).toBeInTheDocument();
    expect(screen.queryByText('Test with evaOS / OpenClaw')).not.toBeInTheDocument();
    expect(screen.queryByText('Test with Hermes')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kill Switch' })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(
      /Native companion|Native bridge|released Workbench|\/Applications\/evaOS\.app/i
    );
    expect(screen.queryByText(/Bearer|desktop_session|provider_grant/i)).not.toBeInTheDocument();

    await user.click(screen.getByText('Advanced diagnostics'));
    expect(screen.getByText('EVAs-Mac-mini.local')).toBeInTheDocument();
    expect(screen.getByText('audit-mac, audit-iphone')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Open released Workbench fallback/i }));

    await waitFor(() => expect(bridgeMocks.openReleasedWorkbench).toHaveBeenCalledTimes(1));
  });

  it('defaults repair-required users to one repair action and hides diagnostics until disclosure', async () => {
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-07T03:45:00.000Z',
        readiness: 'repair_required',
        summaryText: 'Screen Recording permission is required before evaOS or Hermes can use Mac control.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: true,
        releasedWorkbench: {
          installed: true,
          running: false,
          path: '/Applications/evaOS.app',
          version: '0.6.28',
        },
        bridgeCli: {
          installed: true,
          status: 'ready',
          auditId: 'audit-bridge',
          readOnly: true,
          permissions: {
            accessibility: 'granted',
            screenRecording: 'missing',
          },
        },
        connectorService: {
          status: 'ready',
          running: true,
          reachable: true,
        },
        customerMac: {
          status: 'repair_required',
          auditId: 'audit-mac',
          deviceLabel: 'EVAs-Mac-mini.local',
          permissions: {
            accessibility: 'granted',
            screenRecording: 'missing',
          },
        },
        iPhone: {
          status: 'available',
          auditId: 'audit-iphone',
          installed: true,
          running: false,
        },
        audit: {
          status: 'ready',
          auditIds: ['audit-mac', 'audit-iphone'],
        },
      },
    });
    bridgeMocks.openRepairAction.mockResolvedValue({
      success: true,
      data: {
        opened: true,
        message: 'Opened macOS privacy settings.',
      },
    });

    const user = userEvent.setup();
    renderNativeCompanion();

    expect(await screen.findByRole('button', { name: 'Open Screen Recording' })).toBeInTheDocument();
    expect(screen.getByText('Mac control repair')).toBeInTheDocument();
    expect(screen.queryByText('Mac control status matrix')).not.toBeInTheDocument();
    expect(screen.queryByText('RC native canary contract')).not.toBeInTheDocument();
    expect(screen.queryByText('Advanced diagnostics')).not.toBeInTheDocument();
    expect(screen.queryByText('Open released Workbench')).not.toBeInTheDocument();
    expect(screen.queryByText('Not installed')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Native companion|released Workbench|\/Applications\/evaOS\.app/i);

    const repairCard = screen.getByTestId('native-companion-repair-card');
    expect(within(repairCard).getByTestId('native-companion-next-action')).toHaveTextContent('Open Screen Recording');
    expect(within(repairCard).queryByRole('button', { name: 'Open Accessibility' })).not.toBeInTheDocument();

    await user.click(within(repairCard).getByRole('button', { name: 'Open Screen Recording' }));

    await waitFor(() => expect(bridgeMocks.openRepairAction).toHaveBeenCalledTimes(1));
    expect(bridgeMocks.openRepairAction).toHaveBeenCalledWith({ action: 'screen_recording' });
    expect(bridgeMocks.openReleasedWorkbench).not.toHaveBeenCalled();
  });

  it('opens evaOS support email with Mac control state context', async () => {
    window.location.hash = '#/native-companion';
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-07T03:45:00.000Z',
        readiness: 'permission_needed',
        summaryText: 'Screen Recording permission is required before repair can continue.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: true,
        releasedWorkbench: {
          installed: true,
          running: false,
          path: '/Applications/evaOS.app',
          version: '0.6.28',
        },
        bridgeCli: {
          installed: true,
          status: 'permission_needed',
          auditId: 'audit-bridge-permission',
          readOnly: true,
          permissions: {
            accessibility: 'granted',
            screenRecording: 'missing',
          },
        },
        customerMac: {
          status: 'permission_needed',
          auditId: 'audit-mac-permission',
          deviceLabel: 'EVAs-Mac-mini.local',
          permissions: {
            accessibility: 'granted',
            screenRecording: 'missing',
          },
        },
        iPhone: {
          status: 'available',
          auditId: 'audit-iphone-available',
          installed: true,
          running: false,
        },
        audit: {
          status: 'ready',
          auditIds: ['audit-mac-permission', 'audit-iphone-available'],
        },
      },
    });

    const user = userEvent.setup();
    renderNativeCompanion();

    expect(await screen.findByText('Allow Mac control')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Report to support' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Report to support' }));

    await waitFor(() => expect(supportEmailMock.openEvaosSupportEmail).toHaveBeenCalledTimes(1));
    expect(supportEmailMock.openEvaosSupportEmail).toHaveBeenCalledWith({
      subject: 'evaOS Workbench support: Mac control',
      body: expect.stringContaining('Route: /native-companion'),
    });
    const payload = supportEmailMock.openEvaosSupportEmail.mock.calls[0][0];
    expect(payload.body).toContain('State: permission_needed');
    expect(payload.body).toContain('Summary: Screen Recording permission is required before repair can continue.');
    expect(JSON.stringify(payload)).not.toMatch(/desktop_session|eds_|Bearer|token=/i);
  });

  it('runs Workbench connector actions and renders a safe pairing prompt', async () => {
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-07T03:45:00.000Z',
        readiness: 'ready',
        summaryText: 'Mac control setup needs repair.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: false },
        bridgeCli: {
          installed: true,
          status: 'ready',
          auditId: 'audit-bridge',
          readOnly: true,
          permissions: {
            accessibility: 'granted',
            screenRecording: 'granted',
          },
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
          permissions: {
            accessibility: 'granted',
            screenRecording: 'granted',
          },
        },
        iPhone: {
          status: 'unavailable',
          installed: false,
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
          auditIds: ['audit-mac', 'audit-control'],
        },
      },
    });
    bridgeMocks.runAction
      .mockResolvedValueOnce({
        success: true,
        data: {
          action: 'setup_check',
          status: 'repair_required',
          message: 'Mac control setup needs repair before evaOS or Hermes can use this Workbench connector.',
          sourcePointer: 'native-companion:setup-check',
          auditIds: ['audit-mac', 'audit-control'],
          refreshRecommended: false,
          setup: {
            connectorReady: true,
            macReady: false,
            controlReady: true,
            iPhoneDeferred: true,
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          action: 'create_pairing_prompt',
          status: 'succeeded',
          message: 'Pairing prompt is ready. Paste it into evaOS or OpenClaw to complete the link.',
          sourcePointer: 'native-companion:pairing-prompt',
          auditIds: [],
          refreshRecommended: false,
          pairing: {
            customerId: 'benjamin-kennedy',
            pairingCode: 'PAIR-1234',
            setupPrompt:
              'Please pair my Mac to my evaOS/OpenClaw or Hermes agent.\nCustomer: benjamin-kennedy\nPairing code: PAIR-1234\nUse customer_mac_complete_pairing with this code.',
          },
        },
      });

    const user = userEvent.setup();
    renderNativeCompanion();

    expect(await screen.findByText('Pair evaOS/OpenClaw or Hermes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Setup Check' })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('native-companion-next-action')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Show advanced connector controls' }));
    expect(screen.getByRole('button', { name: 'Run Setup Check' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run Setup Check' }));
    expect(await screen.findByTestId('native-companion-action-result')).toHaveTextContent('repair_required');
    expect(screen.getByText('Connector:')).toBeInTheDocument();
    expect(bridgeMocks.runAction).toHaveBeenCalledWith({
      action: 'setup_check',
      customerId: 'benjamin-kennedy',
      agentLabel: 'evaOS Workbench',
    });

    await user.click(screen.getAllByRole('button', { name: 'Create Pairing Prompt' })[0]);
    expect(await screen.findByText('Agent setup prompt')).toBeInTheDocument();
    expect(screen.getByText(/Pairing code: PAIR-1234/)).toBeInTheDocument();
    expect(screen.getByTestId('native-companion-next-action')).toHaveTextContent('Copy Pairing Prompt');
    expect(document.body.textContent).not.toMatch(
      /Bearer|desktop_session|provider_grant|access_token|refresh_token|connector_url|100\.64\.0\.10|8765|secret-token/i
    );
    expect(bridgeMocks.runAction).toHaveBeenCalledWith({
      action: 'create_pairing_prompt',
      customerId: 'benjamin-kennedy',
      agentLabel: 'evaOS Workbench',
    });
  });

  it('advances ready local connector users from pairing prompt to agent proof checklist', async () => {
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-07T03:45:00.000Z',
        readiness: 'ready',
        summaryText: 'Workbench connector ready.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: false },
        bridgeCli: {
          installed: true,
          status: 'ready',
          auditId: 'audit-bridge-ready',
          readOnly: true,
          permissions: {
            accessibility: 'granted',
            screenRecording: 'granted',
          },
        },
        connectorService: {
          status: 'ready',
          running: true,
          reachable: true,
          tailnetIp: '100.64.0.10',
        },
        customerMac: {
          status: 'ready',
          auditId: 'audit-mac-ready',
          permissions: {
            accessibility: 'granted',
            screenRecording: 'granted',
          },
        },
        iPhone: {
          status: 'unavailable',
          installed: false,
          running: false,
        },
        controlSession: {
          status: 'ready',
          auditId: 'audit-control-ready',
          active: true,
          mode: 'full-access',
          killSwitch: false,
        },
        audit: {
          status: 'ready',
          auditIds: ['audit-mac-ready', 'audit-control-ready'],
        },
      },
    });
    bridgeMocks.runAction.mockResolvedValueOnce({
      success: true,
      data: {
        action: 'create_pairing_prompt',
        status: 'succeeded',
        message: 'Pairing prompt is ready. Paste it into evaOS or OpenClaw to complete the link.',
        sourcePointer: 'native-companion:pairing-prompt',
        auditIds: [],
        refreshRecommended: false,
        pairing: {
          customerId: 'benjamin-kennedy',
          pairingCode: 'PAIR-1234',
          setupPrompt: 'Finish my evaOS Workbench Mac pairing.\nCustomer: benjamin-kennedy\nPairing code: PAIR-1234',
        },
      },
    });

    const user = userEvent.setup();
    renderNativeCompanion();

    expect(await screen.findByText('Pair evaOS/OpenClaw or Hermes')).toBeInTheDocument();
    expect(screen.queryByText('Test with evaOS / OpenClaw')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create Pairing Prompt' }));

    expect(await screen.findByText('Agent setup prompt')).toBeInTheDocument();
    expect(screen.getByText('Copy the pairing prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Pairing Prompt' })).toBeInTheDocument();
    expect(screen.getByText('Test with evaOS / OpenClaw')).toBeInTheDocument();
    expect(screen.getByText('Test with Hermes')).toBeInTheDocument();
    expect(screen.getAllByText('Pending')).toHaveLength(2);
    expect(screen.queryByText('Proven')).not.toBeInTheDocument();
    expect(screen.getByText(/broker-owned plugin/i)).toBeInTheDocument();
  });

  it('shows reconnect step when broker denies pairing enrollment', async () => {
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-07T03:45:00.000Z',
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        summaryText: 'Workbench connector ready for code-only agent pairing.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: false },
        bridgeCli: {
          installed: true,
          status: 'ready',
          auditId: 'audit-bridge-ready',
          readOnly: true,
          permissions: {
            accessibility: 'granted',
            screenRecording: 'granted',
          },
        },
        connectorService: {
          status: 'ready',
          running: true,
          reachable: true,
        },
        customerMac: {
          status: 'ready',
          auditId: 'audit-mac-ready',
          permissions: {
            accessibility: 'granted',
            screenRecording: 'granted',
          },
        },
        iPhone: {
          status: 'unavailable',
          installed: false,
          running: false,
        },
        controlSession: {
          status: 'ready',
          auditId: 'audit-control-ready',
          active: false,
          killSwitch: false,
        },
        audit: {
          status: 'ready',
          auditIds: ['audit-mac-ready'],
        },
      },
    });
    bridgeMocks.runAction.mockResolvedValueOnce({
      success: true,
      data: {
        action: 'create_pairing_prompt',
        status: 'repair_required',
        message:
          'Mac control is ready locally, but Workbench needs a fresh evaOS session before it can create a pairing code. Sign in again, then retry.',
        sourcePointer: 'native-companion:pairing-broker-session-required',
        auditIds: [],
        refreshRecommended: false,
        agentPairingStatus: 'ready_for_agent_pairing',
      },
    });

    const user = userEvent.setup();
    renderNativeCompanion();

    await user.click(await screen.findByRole('button', { name: 'Create Pairing Prompt' }));

    expect(await screen.findByText('Reconnect Workbench session')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect Workbench' })).toBeInTheDocument();
    expect(screen.queryByText('Agent setup prompt')).not.toBeInTheDocument();
    expect(screen.queryByText('PAIR-1234')).not.toBeInTheDocument();
    expect(screen.queryByText('Test with evaOS / OpenClaw')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show advanced connector controls' }));
    expect(screen.getByRole('button', { name: 'Create Pairing Prompt' })).toBeDisabled();
  });

  it('does not lock pairing after a previous agent-control start failure', async () => {
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-21T03:45:00.000Z',
        readiness: 'repair_required',
        agentPairingStatus: 'ready_for_agent_pairing',
        summaryText: 'Workbench connector ready for code-only agent pairing.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: false },
        bridgeCli: {
          installed: true,
          status: 'ready',
          auditId: 'audit-bridge-ready',
          readOnly: true,
          permissions: {
            accessibility: 'granted',
            screenRecording: 'granted',
          },
        },
        connectorService: {
          status: 'ready',
          running: true,
          reachable: true,
        },
        customerMac: {
          status: 'ready',
          auditId: 'audit-mac-ready',
          permissions: {
            accessibility: 'granted',
            screenRecording: 'granted',
          },
        },
        iPhone: {
          status: 'unavailable',
          installed: false,
          running: false,
        },
        controlSession: {
          status: 'repair_required',
          auditId: 'audit-control-repair',
          active: false,
          killSwitch: false,
        },
        audit: {
          status: 'ready',
          auditIds: ['audit-mac-ready'],
        },
      },
    });
    bridgeMocks.runAction
      .mockResolvedValueOnce({
        success: true,
        data: {
          action: 'control_start',
          status: 'repair_required',
          message: 'Agent control could not start.',
          sourcePointer: 'native-companion:customer-mac-control-start',
          auditIds: [],
          refreshRecommended: false,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          action: 'create_pairing_prompt',
          status: 'succeeded',
          message: 'Pairing prompt is ready. Paste it into evaOS or OpenClaw to complete the link.',
          sourcePointer: 'native-companion:pairing-prompt',
          auditIds: [],
          refreshRecommended: false,
          pairing: {
            customerId: 'benjamin-kennedy',
            pairingCode: 'PAIR-1234',
            setupPrompt: 'Pairing code: PAIR-1234',
          },
        },
      });

    const user = userEvent.setup();
    renderNativeCompanion();

    expect(await screen.findByText('Pair evaOS/OpenClaw or Hermes')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Show advanced connector controls' }));
    await user.click(screen.getByRole('button', { name: 'Full Access' }));

    expect(await screen.findByTestId('native-companion-action-result')).toHaveTextContent(
      'Agent control could not start.'
    );
    expect(screen.getByTestId('native-companion-next-action')).toHaveTextContent('Create Pairing Prompt');
    expect(screen.getByTestId('native-companion-next-action')).toBeEnabled();

    const createPairingButtons = screen.getAllByRole('button', { name: 'Create Pairing Prompt' });
    expect(createPairingButtons.every((button) => !button.hasAttribute('disabled'))).toBe(true);

    await user.click(screen.getByTestId('native-companion-next-action'));
    expect(await screen.findByText('Agent setup prompt')).toBeInTheDocument();
    expect(screen.getByText(/Pairing code: PAIR-1234/)).toBeInTheDocument();
  });

  it('marks agent proof cards proven only when status carries agent pairing proof', async () => {
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-07T03:45:00.000Z',
        readiness: 'ready',
        agentPairingStatus: 'agent_paired',
        summaryText: 'Workbench connector ready with agent proof.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: false },
        bridgeCli: {
          installed: true,
          status: 'ready',
          auditId: 'audit-bridge-ready',
          readOnly: true,
          permissions: {
            accessibility: 'granted',
            screenRecording: 'granted',
          },
        },
        connectorService: {
          status: 'ready',
          running: true,
          reachable: true,
        },
        customerMac: {
          status: 'ready',
          auditId: 'audit-mac-ready',
          permissions: {
            accessibility: 'granted',
            screenRecording: 'granted',
          },
        },
        iPhone: {
          status: 'unavailable',
          installed: false,
          running: false,
        },
        controlSession: {
          status: 'ready',
          auditId: 'audit-control-ready',
          active: true,
          mode: 'full-access',
          killSwitch: false,
        },
        audit: {
          status: 'ready',
          auditIds: ['audit-mac-ready', 'audit-control-ready'],
        },
      },
    });

    renderNativeCompanion();

    expect(await screen.findByText('Agent paired')).toBeInTheDocument();
    expect(screen.getByText('Test with evaOS / OpenClaw')).toBeInTheDocument();
    expect(screen.getByText('Test with Hermes')).toBeInTheDocument();
    expect(screen.getAllByText('Proven')).toHaveLength(2);
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  });

  it('does not mark setup check as proven without explicit agent pairing proof', async () => {
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-07T03:45:00.000Z',
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        summaryText: 'Workbench connector ready for code-only agent pairing.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: false },
        bridgeCli: {
          installed: true,
          status: 'ready',
          auditId: 'audit-bridge-ready',
          readOnly: true,
          permissions: {
            accessibility: 'granted',
            screenRecording: 'granted',
          },
        },
        connectorService: {
          status: 'ready',
          running: true,
          reachable: true,
        },
        customerMac: {
          status: 'ready',
          auditId: 'audit-mac-ready',
          permissions: {
            accessibility: 'granted',
            screenRecording: 'granted',
          },
        },
        iPhone: {
          status: 'unavailable',
          installed: false,
          running: false,
        },
        controlSession: {
          status: 'ready',
          auditId: 'audit-control-ready',
          active: true,
          mode: 'full-access',
          killSwitch: false,
        },
        audit: {
          status: 'ready',
          auditIds: ['audit-mac-ready', 'audit-control-ready'],
        },
      },
    });
    bridgeMocks.runAction
      .mockResolvedValueOnce({
        success: true,
        data: {
          action: 'create_pairing_prompt',
          status: 'succeeded',
          message: 'Pairing prompt is ready. Paste it into evaOS or OpenClaw to complete the link.',
          sourcePointer: 'native-companion:pairing-prompt',
          auditIds: [],
          refreshRecommended: false,
          pairing: {
            customerId: 'benjamin-kennedy',
            pairingCode: 'PAIR-1234',
            setupPrompt: 'Finish my evaOS Workbench Mac pairing.\nCustomer: benjamin-kennedy\nPairing code: PAIR-1234',
          },
          agentPairingStatus: 'pairing_prompt_created',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          action: 'setup_check',
          status: 'succeeded',
          message: 'Mac control setup check passed. evaOS and Hermes can use the paired Workbench connector.',
          sourcePointer: 'native-companion:setup-check',
          auditIds: ['audit-mac-ready', 'audit-control-ready'],
          refreshRecommended: false,
          setup: {
            connectorReady: true,
            macReady: true,
            controlReady: true,
            iPhoneDeferred: true,
          },
          control: {
            active: true,
            mode: 'full-access',
            killSwitch: false,
          },
          agentPairingStatus: 'ready_for_agent_pairing',
        },
      });

    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
      },
    });
    renderNativeCompanion();

    expect(await screen.findByText('Pair evaOS/OpenClaw or Hermes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create Pairing Prompt' }));
    expect(await screen.findAllByText('Pending')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Copy Pairing Prompt' }));
    await user.click(screen.getByRole('button', { name: /Run Setup Check/i }));

    await waitFor(() => expect(bridgeMocks.runAction).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Proven')).not.toBeInTheDocument();
  });
});
