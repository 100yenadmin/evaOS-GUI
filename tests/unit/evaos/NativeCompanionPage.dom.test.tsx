/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ConfigProvider } from '@arco-design/web-react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NativeCompanionPage from '@/renderer/pages/native-companion';
import type { IEvaosBrokerSessionStatus, IEvaosCustomerTargetView } from '@/common/evaos/bridgeTypes';
import { EVAOS_DESKTOP_SESSION_IMPORTED_EVENT } from '@renderer/hooks/system/useDeepLink';

const bridgeMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getDiagnosticPacket: vi.fn(),
  openReleasedWorkbench: vi.fn(),
  openRepairAction: vi.fn(),
  runAction: vi.fn(),
}));

const supportEmailMock = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
}));

const feedbackMocks = vi.hoisted(() => ({
  openFeedback: vi.fn(),
}));

const brokerMocks = vi.hoisted(() => ({
  beginDesktopAuth: vi.fn(),
}));

const i18nMocks = vi.hoisted(() => ({
  t: vi.fn((key: string) => {
    const translations: Record<string, string> = {
      'evaos.nativeCompanion.permissionGuideDetail': 'Localized permission guidance.',
      'evaos.nativeCompanion.onboarding.repairWorkbenchTitle': 'Repair Workbench',
      'evaos.nativeCompanion.onboarding.repairWorkbenchMissingDetail': 'Repair the missing bundled Mac connector.',
      'evaos.nativeCompanion.onboarding.repairWorkbenchIncompatibleDetail':
        'Repair the incompatible bundled Mac connector.',
      'evaos.nativeCompanion.onboarding.repairControlToolsTitle': 'Repair Mac control tools',
      'evaos.nativeCompanion.onboarding.repairControlToolsDetail': 'Repair CUA or the bundled Peekaboo fallback.',
      'evaos.nativeCompanion.onboarding.clientMissingTitle': 'Install secure network',
      'evaos.nativeCompanion.onboarding.clientMissingDetail':
        'Open the official Tailscale macOS download page. No terminal commands are required.',
      'evaos.nativeCompanion.onboarding.clientStoppedTitle': 'Open secure network',
      'evaos.nativeCompanion.onboarding.clientStoppedDetail': 'Open the installed secure-network app.',
      'evaos.nativeCompanion.onboarding.unenrolledTitle': 'Connect this Mac',
      'evaos.nativeCompanion.onboarding.unenrolledDetail': 'Approved enrollment is required.',
      'evaos.nativeCompanion.onboarding.enrollmentSubmittedDetail':
        'Localized enrollment is waiting for broker verification.',
      'evaos.nativeCompanion.onboarding.enrollmentFailedDetail': 'Localized enrollment failed safely.',
      'evaos.nativeCompanion.onboarding.enrollmentSessionDetail': 'Localized Workbench session refresh required.',
      'evaos.nativeCompanion.onboarding.wrongControlPlaneTitle': 'Reconnect secure network',
      'evaos.nativeCompanion.onboarding.wrongControlPlaneDetail': 'The Mac is on the wrong private network.',
      'evaos.nativeCompanion.onboarding.aclBlockedTitle': 'Secure network access is blocked',
      'evaos.nativeCompanion.onboarding.aclBlockedDetail': 'Use Report to support.',
      'evaos.nativeCompanion.onboarding.offlineTitle': 'Reconnect secure network',
      'evaos.nativeCompanion.onboarding.offlineDetail': 'Reconnect, then verify again.',
      'evaos.nativeCompanion.onboarding.errorTitle': 'Check secure network',
      'evaos.nativeCompanion.onboarding.errorDetail': 'Use Report to support; do not enter terminal commands.',
      'evaos.nativeCompanion.onboarding.refreshSessionLabel': 'Refresh Workbench Session',
      'evaos.nativeCompanion.onboarding.refreshSessionTitle': 'Refresh Workbench session',
      'evaos.nativeCompanion.onboarding.refreshSessionDetail': 'Refresh the Workbench session.',
      'evaos.nativeCompanion.onboarding.checkingSessionLabel': 'Checking session',
      'evaos.nativeCompanion.onboarding.checkingSessionTitle': 'Checking Workbench session',
      'evaos.nativeCompanion.onboarding.checkingSessionDetail': 'Workbench is checking the session.',
      'evaos.nativeCompanion.onboarding.signInLabel': 'Sign In To Workbench',
      'evaos.nativeCompanion.onboarding.signInTitle': 'Sign in to Workbench',
      'evaos.nativeCompanion.onboarding.signInDetail': 'Sign in to Workbench.',
      'evaos.nativeCompanion.onboarding.selectCustomerLabel': 'Select customer',
      'evaos.nativeCompanion.onboarding.selectCustomerTitle': 'Choose a customer',
      'evaos.nativeCompanion.onboarding.selectCustomerDetail': 'Select a customer.',
      'evaos.nativeCompanion.onboarding.chooseMacTargetLabel': 'Choose Mac target',
      'evaos.nativeCompanion.onboarding.chooseMacTargetTitle': 'Choose a Mac-control customer',
      'evaos.nativeCompanion.onboarding.chooseMacTargetDetail': 'Choose a VM-backed target.',
    };
    return translations[key] ?? key;
  }),
}));

const customerContextMock = vi.hoisted(() => ({
  brokerAuthenticated: true as boolean | undefined,
  brokerSession: {
    state: 'authenticated',
    authenticated: true,
    expired: false,
    sessionKey: 'evaos-session-1',
    source: 'beta-storage',
    userEmail: 'admin@100yen.org',
    message: 'Authenticated',
  } as IEvaosBrokerSessionStatus | null,
  brokerSessionLoading: false,
  refreshBrokerSession: vi.fn(),
  customerContext: {
    selectedCustomerId: 'benjamin-kennedy' as string | undefined,
    selectedTarget: {
      customerId: 'benjamin-kennedy',
      targetKind: 'customer_vm',
      displayName: 'Benjamin Kennedy',
      isDefault: true,
    } as IEvaosCustomerTargetView,
    targets: [
      {
        customerId: 'benjamin-kennedy',
        targetKind: 'customer_vm',
        displayName: 'Benjamin Kennedy',
        isDefault: true,
      },
    ] as IEvaosCustomerTargetView[],
    isOperator: false,
    roles: ['admin'] as string[],
    scopes: ['access_technical_diagnostics'] as string[],
    loading: false,
    loaded: true,
    refreshTargets: vi.fn(),
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    evaosNativeCompanion: {
      getStatus: {
        invoke: bridgeMocks.getStatus,
      },
      getDiagnosticPacket: {
        invoke: bridgeMocks.getDiagnosticPacket,
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

vi.mock('@/common/adapter/ipcBridge', () => ({
  evaosBroker: {
    beginDesktopAuth: {
      invoke: brokerMocks.beginDesktopAuth,
    },
  },
}));

vi.mock('@renderer/hooks/context/EvaosCustomerContext', () => ({
  useEvaosBrokeredCustomerContext: () => ({
    brokerSession: customerContextMock.brokerSession,
    brokerAuthenticated: customerContextMock.brokerAuthenticated,
    brokerSessionLoading: customerContextMock.brokerSessionLoading,
    refreshBrokerSession: customerContextMock.refreshBrokerSession,
    customerContext: customerContextMock.customerContext,
  }),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: supportEmailMock.openExternalUrl,
}));

vi.mock('@renderer/hooks/context/FeedbackContext', () => ({
  useFeedback: () => ({
    openFeedback: feedbackMocks.openFeedback,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: i18nMocks.t }),
}));

function renderNativeCompanion() {
  return render(
    <ConfigProvider>
      <NativeCompanionPage />
    </ConfigProvider>
  );
}

function mockUnenrolledMacStatus(): void {
  bridgeMocks.getStatus.mockResolvedValue({
    success: true,
    data: {
      schemaVersion: 'evaos.native_companion_status.v1',
      generatedAt: '2026-07-12T12:00:00.000Z',
      readiness: 'repair_required',
      pairingCapable: false,
      pairingBlockedReason: 'secure_network_link_required',
      prerequisites: {
        bridgeRuntime: 'ready',
        privateNetwork: 'unenrolled',
        actionEngine: 'cua_ready',
      },
      summaryText: 'Secure network enrollment is required.',
      sourcePointer: 'native-companion:typed-prerequisites',
      canOpenReleasedWorkbench: true,
      releasedWorkbench: { installed: true },
      bridgeCli: {
        installed: true,
        status: 'ready',
        readOnly: true,
        permissions: { accessibility: 'granted', screenRecording: 'granted' },
      },
      connectorService: { status: 'repair_required', running: true, reachable: false },
      customerMac: {
        status: 'repair_required',
        permissions: { accessibility: 'granted', screenRecording: 'granted' },
      },
      iPhone: { status: 'available' },
      audit: { status: 'ready', auditIds: [] },
    },
  });
}

function mockSecureNetworkSessionRequired(): void {
  bridgeMocks.runAction.mockResolvedValue({
    success: true,
    data: {
      action: 'secure_network_enroll',
      status: 'repair_required',
      message: 'Session refresh required.',
      sourcePointer: 'native-companion:secure-network-enrollment-broker-session-required',
      auditIds: [],
      refreshRecommended: false,
      blockerReason: 'broker_session_expired',
    },
  });
}

describe('NativeCompanionPage', () => {
  beforeEach(() => {
    customerContextMock.brokerAuthenticated = true;
    customerContextMock.brokerSession = {
      state: 'authenticated',
      authenticated: true,
      expired: false,
      sessionKey: 'evaos-session-1',
      source: 'beta-storage',
      userEmail: 'admin@100yen.org',
      message: 'Authenticated',
    };
    customerContextMock.brokerSessionLoading = false;
    customerContextMock.refreshBrokerSession.mockResolvedValue(undefined);
    customerContextMock.customerContext.selectedCustomerId = 'benjamin-kennedy';
    customerContextMock.customerContext.selectedTarget = {
      customerId: 'benjamin-kennedy',
      targetKind: 'customer_vm',
      displayName: 'Benjamin Kennedy',
      isDefault: true,
    };
    customerContextMock.customerContext.targets = [
      {
        customerId: 'benjamin-kennedy',
        targetKind: 'customer_vm',
        displayName: 'Benjamin Kennedy',
        isDefault: true,
      },
    ];
    customerContextMock.customerContext.isOperator = false;
    customerContextMock.customerContext.roles = ['admin'];
    customerContextMock.customerContext.scopes = ['access_technical_diagnostics'];
    customerContextMock.customerContext.refreshTargets.mockResolvedValue(undefined);
    bridgeMocks.getDiagnosticPacket.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.workbench.diagnostic_packet.v1',
        generatedAt: '2026-06-07T03:45:00.000Z',
        app: {
          product: 'evaOS Workbench',
          bundleId: 'com.evaos.workbench',
          protocol: 'evaos-workbench',
        },
        signing: { summary: 'not_collected_by_workbench_status' },
        selectedContext: {},
        runtimeStatus: {},
        brokerGrant: { auditIds: [] },
        bridge: {
          installed: true,
          status: 'repair_required',
          diagnosticsStatus: 'unavailable',
          readyStatus: 'unavailable',
        },
        connector: { endpointSummary: 'unavailable' },
        launchAgent: {},
        tcc: {},
        audit: { status: 'ready', auditIds: [] },
        blockerCategory: 'permission_missing',
        redaction: {
          rawSecretsStoredInWorkbench: false,
          urlsIpsPortsRedacted: true,
          rawPromptMaterialIncluded: false,
        },
      },
    });
    brokerMocks.beginDesktopAuth.mockResolvedValue({
      success: true,
      data: {
        authUrl: 'https://www.electricsheephq.com/login',
        callbackUrl: 'evaos-workbench://auth/callback',
        fallbackDeviceCode: 'SAFE-CODE',
        message: 'Continue sign-in in the browser.',
      },
    });
  });

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
          path: '/Applications/evaOS Workbench.app',
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
        connectorService: {
          status: 'ready',
          running: true,
          reachable: true,
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
        path: '/Applications/evaOS Workbench.app',
        message: 'Opened released evaOS Workbench for native pairing and repair.',
      },
    });

    const user = userEvent.setup();
    const { container } = renderNativeCompanion();

    expect(await screen.findByText('This Mac is locally ready')).toBeInTheDocument();
    expect(screen.getByText(/Local Workbench connector and macOS permissions are ready/i)).toBeInTheDocument();
    expect(screen.getAllByText('Connect Mac control').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Connect Mac Control' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export Pairing Prompt' })).not.toBeInTheDocument();
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

  it('hides Mac & iPhone diagnostics from non-admin customer users even when support mode is toggled locally', async () => {
    localStorage.setItem('evaos.supportDiagnostics', '1');
    customerContextMock.brokerSession = {
      state: 'authenticated',
      authenticated: true,
      expired: false,
      sessionKey: 'evaos-session-member',
      source: 'beta-storage',
      userEmail: 'member@example.test',
      message: 'Authenticated',
    };
    customerContextMock.customerContext.roles = ['member'];
    customerContextMock.customerContext.scopes = ['access_technical_diagnostics'];
    customerContextMock.customerContext.isOperator = false;
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
          path: '/Applications/evaOS Workbench.app',
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
        connectorService: {
          status: 'ready',
          running: true,
          reachable: true,
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

    renderNativeCompanion();

    expect(await screen.findByText('This Mac is locally ready')).toBeInTheDocument();
    expect(screen.queryByText('Advanced diagnostics')).not.toBeInTheDocument();
    expect(screen.queryByText('EVAs-Mac-mini.local')).not.toBeInTheDocument();
    expect(screen.queryByText('audit-mac, audit-iphone')).not.toBeInTheDocument();
  });

  it('shows an agent setup blocker without failing local Mac Access', async () => {
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-24T15:45:00.000Z',
        readiness: 'ready',
        agentPairingStatus: 'not_ready',
        pairingCapable: false,
        pairingBlockedReason: 'secure_network_link_required',
        summaryText:
          'Workbench connector is locally ready, but this Mac needs the broker-owned private connector link before agent pairing can start.',
        sourcePointer: 'native-companion:customer-mac-status',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: true, running: true, path: '/Applications/evaOS Workbench.app' },
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
        },
        customerMac: {
          status: 'ready',
          auditId: 'audit-mac',
          deviceLabel: 'Davids-MacBook-Pro.local',
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
          auditIds: ['audit-mac', 'audit-control-ready'],
        },
      },
    });

    const user = userEvent.setup();
    renderNativeCompanion();

    expect(await screen.findByText('This Mac is locally ready')).toBeInTheDocument();
    expect(screen.getByText('Agent setup needed')).toBeInTheDocument();
    expect(screen.getAllByText(/broker-owned private connector link/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('native-companion-next-action')).toHaveTextContent('Connect Mac Control');
    expect(screen.getByTestId('native-companion-next-action')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Show advanced connector controls' }));
    for (const button of screen.getAllByRole('button', { name: 'Export Pairing Prompt' })) {
      expect(button).toBeDisabled();
    }
    expect(bridgeMocks.runAction).not.toHaveBeenCalled();
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
          path: '/Applications/evaOS Workbench.app',
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
    expect(within(repairCard).getByText('Localized permission guidance.')).toBeInTheDocument();
    expect(i18nMocks.t).toHaveBeenCalledWith('evaos.nativeCompanion.permissionGuideDetail');
    expect(within(repairCard).queryByRole('button', { name: 'Open Accessibility' })).not.toBeInTheDocument();

    await user.click(within(repairCard).getByRole('button', { name: 'Open Screen Recording' }));

    await waitFor(() => expect(bridgeMocks.openRepairAction).toHaveBeenCalledTimes(1));
    expect(bridgeMocks.openRepairAction).toHaveBeenCalledWith({ action: 'screen_recording' });
    expect(bridgeMocks.openReleasedWorkbench).not.toHaveBeenCalled();
  });

  it('shows a one-click official secure-network install handoff before connector startup', async () => {
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-07-12T12:00:00.000Z',
        readiness: 'repair_required',
        pairingCapable: false,
        pairingBlockedReason: 'secure_network_link_required',
        prerequisites: {
          bridgeRuntime: 'ready',
          privateNetwork: 'client_missing',
          actionEngine: 'peekaboo_ready',
        },
        summaryText: 'Secure network client is missing.',
        sourcePointer: 'native-companion:typed-prerequisites',
        canOpenReleasedWorkbench: true,
        releasedWorkbench: { installed: true },
        bridgeCli: {
          installed: true,
          status: 'ready',
          readOnly: true,
          permissions: { accessibility: 'granted', screenRecording: 'granted' },
        },
        connectorService: { status: 'repair_required', running: false, reachable: false },
        customerMac: {
          status: 'repair_required',
          permissions: { accessibility: 'granted', screenRecording: 'granted' },
        },
        iPhone: { status: 'available' },
        audit: { status: 'ready', auditIds: [] },
      },
    });
    bridgeMocks.openRepairAction.mockResolvedValue({
      success: true,
      data: {
        opened: true,
        target: 'https://tailscale.com/download/mac',
        message: 'Opened the official secure-network download page.',
      },
    });

    const user = userEvent.setup();
    renderNativeCompanion();

    const action = await screen.findByRole('button', { name: 'Install secure network' });
    expect(
      screen.getAllByText('Open the official Tailscale macOS download page. No terminal commands are required.').length
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Turn On Mac Access' })).not.toBeInTheDocument();

    await user.click(action);

    await waitFor(() =>
      expect(bridgeMocks.openRepairAction).toHaveBeenCalledWith({ action: 'secure_network_install' })
    );
    expect(bridgeMocks.runAction).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'connector_start' }));
  });

  it('replaces Turn On Mac Access with refresh after preserving an unproven listener handoff', async () => {
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-07-14T01:00:00.000Z',
        readiness: 'repair_required',
        pairingCapable: true,
        agentPairingStatus: 'not_ready',
        prerequisites: {
          bridgeRuntime: 'ready',
          privateNetwork: 'ready',
          actionEngine: 'cua_ready',
        },
        summaryText: 'Mac Access needs a safe listener handoff.',
        sourcePointer: 'native-companion:typed-prerequisites',
        canOpenReleasedWorkbench: true,
        releasedWorkbench: { installed: true },
        bridgeCli: {
          installed: true,
          status: 'ready',
          readOnly: true,
          permissions: { accessibility: 'granted', screenRecording: 'granted' },
        },
        connectorService: { status: 'repair_required', running: true, reachable: false },
        customerMac: {
          status: 'ready',
          permissions: { accessibility: 'granted', screenRecording: 'granted' },
        },
        iPhone: { status: 'available' },
        audit: { status: 'ready', auditIds: [] },
      },
    });
    bridgeMocks.runAction.mockResolvedValue({
      success: true,
      data: {
        action: 'connector_start',
        status: 'repair_required',
        message: 'The existing Mac Access owner was preserved.',
        sourcePointer: 'native-companion:workbench-session-connector-start',
        auditIds: [],
        refreshRecommended: false,
        blockerReason: 'listener_replacement_unproven',
      },
    });

    const user = userEvent.setup();
    renderNativeCompanion();

    await user.click(await screen.findByRole('button', { name: 'Turn On Mac Access' }));

    await waitFor(() =>
      expect(bridgeMocks.runAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'connector_start',
          customerId: 'benjamin-kennedy',
        })
      )
    );
    expect(screen.queryByRole('button', { name: 'Turn On Mac Access' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Refresh status' }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Show advanced connector controls' }));
    expect(screen.queryByRole('button', { name: 'Turn On Mac Access' })).not.toBeInTheDocument();
  });

  it('uses refreshed ready connector truth instead of a stale unproven-listener result', async () => {
    const repairStatus = {
      schemaVersion: 'evaos.native_companion_status.v1',
      generatedAt: '2026-07-13T18:00:00.000Z',
      readiness: 'repair_required',
      pairingCapable: true,
      agentPairingStatus: 'not_ready',
      prerequisites: { bridgeRuntime: 'ready', privateNetwork: 'ready', actionEngine: 'cua_ready' },
      summaryText: 'Mac Access needs a safe listener handoff.',
      sourcePointer: 'native-companion:typed-prerequisites',
      canOpenReleasedWorkbench: true,
      releasedWorkbench: { installed: true },
      bridgeCli: {
        installed: true,
        status: 'ready',
        readOnly: true,
        permissions: { accessibility: 'granted', screenRecording: 'granted' },
      },
      connectorService: { status: 'repair_required', running: true, reachable: false },
      customerMac: {
        status: 'ready',
        permissions: { accessibility: 'granted', screenRecording: 'granted' },
      },
      iPhone: { status: 'available' },
      audit: { status: 'ready', auditIds: [] },
    };
    const readyStatus = {
      ...repairStatus,
      generatedAt: '2026-07-13T18:00:05.000Z',
      readiness: 'ready',
      agentPairingStatus: 'ready_for_agent_pairing',
      summaryText: 'This Mac is locally ready.',
      connectorService: { status: 'ready', running: true, reachable: true },
    };
    bridgeMocks.getStatus
      .mockResolvedValueOnce({ success: true, data: repairStatus })
      .mockResolvedValueOnce({ success: true, data: readyStatus });
    bridgeMocks.runAction.mockResolvedValue({
      success: true,
      data: {
        action: 'connector_start',
        status: 'repair_required',
        message: 'The existing Mac Access owner was preserved.',
        sourcePointer: 'native-companion:workbench-session-connector-start',
        auditIds: [],
        refreshRecommended: true,
        blockerReason: 'listener_replacement_unproven',
      },
    });

    const user = userEvent.setup();
    renderNativeCompanion();

    await user.click(await screen.findByRole('button', { name: 'Turn On Mac Access' }));
    await screen.findByText('Ready on this Mac');

    expect(screen.queryByRole('button', { name: 'Refresh status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn On Mac Access' })).not.toBeInTheDocument();
  });

  it('routes an unenrolled Mac through the authenticated broker action for the selected customer', async () => {
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-07-12T12:00:00.000Z',
        readiness: 'repair_required',
        pairingCapable: false,
        pairingBlockedReason: 'secure_network_link_required',
        prerequisites: {
          bridgeRuntime: 'ready',
          privateNetwork: 'unenrolled',
          actionEngine: 'cua_ready',
        },
        summaryText: 'Secure network enrollment is required.',
        sourcePointer: 'native-companion:typed-prerequisites',
        canOpenReleasedWorkbench: true,
        releasedWorkbench: { installed: true },
        bridgeCli: {
          installed: true,
          status: 'ready',
          readOnly: true,
          permissions: { accessibility: 'granted', screenRecording: 'granted' },
        },
        connectorService: { status: 'repair_required', running: true, reachable: false },
        customerMac: {
          status: 'repair_required',
          permissions: { accessibility: 'granted', screenRecording: 'granted' },
        },
        iPhone: { status: 'available' },
        audit: { status: 'ready', auditIds: [] },
      },
    });
    bridgeMocks.runAction.mockResolvedValue({
      success: true,
      data: {
        action: 'secure_network_enroll',
        status: 'succeeded',
        message: 'Private-network enrollment was submitted.',
        sourcePointer: 'native-companion:secure-network-enrollment-submitted',
        auditIds: [],
        refreshRecommended: true,
        blockerReason: 'secure_network_link_required',
      },
    });

    const user = userEvent.setup();
    renderNativeCompanion();
    await user.click(await screen.findByRole('button', { name: 'Connect this Mac' }));

    await waitFor(() =>
      expect(bridgeMocks.runAction).toHaveBeenCalledWith({
        action: 'secure_network_enroll',
        customerId: 'benjamin-kennedy',
        agentLabel: 'evaOS Workbench',
      })
    );
    expect((await screen.findAllByText('Localized enrollment is waiting for broker verification.')).length).toBe(2);
    expect(screen.getByRole('button', { name: 'Connect this Mac' })).toBeDisabled();
    expect(bridgeMocks.openRepairAction).not.toHaveBeenCalled();
  });

  it.each([
    [
      'native-companion:secure-network-enrollment-broker-session-required',
      'Localized Workbench session refresh required.',
    ],
    ['native-companion:secure-network-enrollment-client-failed', 'Localized enrollment failed safely.'],
  ])('localizes secure-network action result %s', async (sourcePointer, localizedMessage) => {
    mockUnenrolledMacStatus();
    bridgeMocks.runAction.mockResolvedValue({
      success: true,
      data: {
        action: 'secure_network_enroll',
        status: 'repair_required',
        message: 'Raw process message must not be rendered.',
        sourcePointer,
        auditIds: [],
        refreshRecommended: false,
        blockerReason: 'secure_network_link_required',
      },
    });

    const user = userEvent.setup();
    renderNativeCompanion();
    await user.click(await screen.findByRole('button', { name: 'Connect this Mac' }));

    expect((await screen.findAllByText(localizedMessage)).length).toBe(2);
    expect(screen.queryByText('Raw process message must not be rendered.')).not.toBeInTheDocument();
  });

  it('clears secure-network session recovery after the broker session refreshes', async () => {
    mockUnenrolledMacStatus();
    mockSecureNetworkSessionRequired();
    const user = userEvent.setup();
    const view = renderNativeCompanion();

    await user.click(await screen.findByRole('button', { name: 'Connect this Mac' }));
    expect(await screen.findByRole('button', { name: 'Refresh Workbench Session' })).toBeInTheDocument();

    customerContextMock.brokerSession = {
      ...customerContextMock.brokerSession!,
      sessionKey: 'evaos-session-2',
      source: 'callback',
    };
    view.rerender(
      <ConfigProvider>
        <NativeCompanionPage />
      </ConfigProvider>
    );

    expect(await screen.findByRole('button', { name: 'Connect this Mac' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh Workbench Session' })).not.toBeInTheDocument();
  });

  it('clears secure-network session recovery when a desktop session is imported', async () => {
    mockUnenrolledMacStatus();
    mockSecureNetworkSessionRequired();
    const user = userEvent.setup();
    renderNativeCompanion();

    await user.click(await screen.findByRole('button', { name: 'Connect this Mac' }));
    expect(await screen.findByRole('button', { name: 'Refresh Workbench Session' })).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event(EVAOS_DESKTOP_SESSION_IMPORTED_EVENT));
    });

    expect(await screen.findByRole('button', { name: 'Connect this Mac' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh Workbench Session' })).not.toBeInTheDocument();
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
          path: '/Applications/evaOS Workbench.app',
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

    await waitFor(() => expect(feedbackMocks.openFeedback).toHaveBeenCalledTimes(1));
    expect(bridgeMocks.getDiagnosticPacket).toHaveBeenCalledWith({
      route: '/native-companion',
      accountEmail: 'admin@100yen.org',
      customerId: 'benjamin-kennedy',
      customerLabel: 'Benjamin Kennedy',
      vmTarget: 'Benjamin Kennedy',
      lastAction: undefined,
    });
    const payload = feedbackMocks.openFeedback.mock.calls[0][0];
    expect(payload).toMatchObject({
      module: 'evaos-support',
      autoScreenshot: true,
      tags: expect.objectContaining({
        support_surface: 'native_companion_mac_control',
        evaos_route: '/native-companion',
        evaos_issue: '#432',
      }),
      extra: expect.objectContaining({
        support_packet_version: 'evaos.support_report.v1',
        route: '/native-companion',
        settled_state: 'permission_needed',
        mac_control_diagnostic_packet: expect.objectContaining({
          schemaVersion: 'evaos.workbench.diagnostic_packet.v1',
          blockerCategory: 'permission_missing',
        }),
      }),
    });
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
          status: 'succeeded',
          message: 'Mac Access setup check passed. Local Workbench connector and macOS permissions are ready.',
          sourcePointer: 'native-companion:setup-check',
          auditIds: ['audit-mac', 'audit-control'],
          refreshRecommended: false,
          setup: {
            connectorReady: true,
            macReady: true,
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

    expect(await screen.findByText('Connect Mac control')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Setup Check' })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('native-companion-next-action')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Show advanced connector controls' }));
    expect(screen.getByRole('button', { name: 'Run Setup Check' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run Setup Check' }));
    expect(await screen.findByTestId('native-companion-action-result')).toHaveTextContent('succeeded');
    expect(screen.getByText('Connector:')).toBeInTheDocument();
    expect(bridgeMocks.runAction).toHaveBeenCalledWith({
      action: 'setup_check',
      customerId: 'benjamin-kennedy',
      agentLabel: 'evaOS Workbench',
    });

    await user.click(screen.getAllByRole('button', { name: 'Export Pairing Prompt' })[0]);
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

  it('clears a customer-scoped pairing prompt when the selected customer changes', async () => {
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-07T03:45:00.000Z',
        readiness: 'ready',
        summaryText: 'Mac control is ready.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: false },
        bridgeCli: {
          installed: true,
          status: 'ready',
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
          setupPrompt: 'Customer: benjamin-kennedy\nPairing code: PAIR-1234',
        },
      },
    });

    const user = userEvent.setup();
    const view = renderNativeCompanion();

    await user.click(await screen.findByRole('button', { name: 'Show advanced connector controls' }));
    await user.click(await screen.findByRole('button', { name: 'Export Pairing Prompt' }));
    expect(await screen.findByText('Agent setup prompt')).toBeInTheDocument();
    expect(screen.getByText(/Pairing code: PAIR-1234/)).toBeInTheDocument();

    customerContextMock.customerContext.selectedCustomerId = 'matt-calderon';
    customerContextMock.customerContext.selectedTarget = {
      customerId: 'matt-calderon',
      targetKind: 'customer_vm',
      displayName: 'Matt Calderon',
      isDefault: false,
    };
    view.rerender(
      <ConfigProvider>
        <NativeCompanionPage />
      </ConfigProvider>
    );

    await waitFor(() => expect(screen.queryByText('Agent setup prompt')).not.toBeInTheDocument());
    expect(screen.queryByText(/Pairing code: PAIR-1234/)).not.toBeInTheDocument();
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

    expect(await screen.findByText('Connect Mac control')).toBeInTheDocument();
    expect(screen.queryByText('Test with evaOS / OpenClaw')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show advanced connector controls' }));
    await user.click(screen.getByRole('button', { name: 'Export Pairing Prompt' }));

    expect(await screen.findByText('Agent setup prompt')).toBeInTheDocument();
    expect(screen.getByText('Copy the pairing prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Pairing Prompt' })).toBeInTheDocument();
    expect(screen.getByText('Test with evaOS / OpenClaw')).toBeInTheDocument();
    expect(screen.getByText('Test with Hermes')).toBeInTheDocument();
    expect(screen.getAllByText('Pending')).toHaveLength(2);
    expect(screen.queryByText('Proven')).not.toBeInTheDocument();
    expect(screen.getByText(/end-to-end broker grant and runtime tool proof/i)).toBeInTheDocument();
  });

  it('shows reconnect step when broker denies connector grant and preserves the Mac-control target', async () => {
    const accountOnlyTarget = {
      customerId: 'admin@100yen.org',
      customerAccountId: 'acct_admin',
      targetKind: 'customer_account' as const,
      accountOnly: true,
      displayName: 'admin@100yen.org',
      isDefault: false,
    };
    const benjaminTarget = {
      customerId: 'benjamin-kennedy',
      targetKind: 'customer_vm' as const,
      displayName: 'Benjamin Kennedy',
      isDefault: true,
    };
    const davidTarget = {
      customerId: 'jackie-david',
      targetKind: 'customer_vm' as const,
      displayName: 'David Dorman',
      isDefault: false,
    };
    customerContextMock.customerContext.selectedCustomerId = 'jackie-david';
    customerContextMock.customerContext.selectedTarget = davidTarget;
    customerContextMock.customerContext.targets = [accountOnlyTarget, benjaminTarget, davidTarget];
    customerContextMock.customerContext.isOperator = true;
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
    bridgeMocks.runAction
      .mockResolvedValueOnce({
        success: true,
        data: {
          action: 'ensure_customer_mac_connector_grant',
          status: 'repair_required',
          message:
            'Mac control is ready locally, but Workbench needs a fresh evaOS session before it can connect Mac control. Sign in again, then retry.',
          sourcePointer: 'native-companion:connector-grant-broker-session-required',
          auditIds: [],
          refreshRecommended: false,
          agentPairingStatus: 'ready_for_agent_pairing',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          action: 'create_pairing_prompt',
          status: 'succeeded',
          message: 'Pairing prompt is ready. Paste it into evaOS/OpenClaw or Hermes to complete the link.',
          sourcePointer: 'native-companion:pairing-prompt',
          auditIds: ['audit-pairing'],
          refreshRecommended: false,
          pairing: {
            customerId: 'jackie-david',
            pairingCode: 'PAIR-DAVID',
            setupPrompt:
              'Customer: jackie-david\nPairing code: PAIR-DAVID\nUse customer_mac_complete_pairing with this code.',
          },
          agentPairingStatus: 'pairing_prompt_created',
        },
      });

    const user = userEvent.setup();
    const view = renderNativeCompanion();

    expect(await screen.findByText(/Mac control target: David Dorman/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Connect Mac Control' }));

    expect(await screen.findByText('Refresh Workbench session')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh Workbench Session' })).toBeInTheDocument();
    expect(screen.queryByText('Agent setup prompt')).not.toBeInTheDocument();
    expect(screen.queryByText('PAIR-1234')).not.toBeInTheDocument();
    expect(screen.queryByText('Test with evaOS / OpenClaw')).not.toBeInTheDocument();
    expect(bridgeMocks.runAction).toHaveBeenLastCalledWith({
      action: 'ensure_customer_mac_connector_grant',
      customerId: 'jackie-david',
      agentLabel: 'evaOS Workbench',
    });

    await user.click(screen.getByRole('button', { name: 'Refresh Workbench Session' }));

    await waitFor(() => expect(brokerMocks.beginDesktopAuth).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Open sign-in page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy sign-in link' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open sign-in page' }));
    expect(supportEmailMock.openExternalUrl).toHaveBeenCalledWith('https://www.electricsheephq.com/login');
    expect(customerContextMock.refreshBrokerSession).not.toHaveBeenCalled();
    expect(customerContextMock.customerContext.refreshTargets).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('native-companion-next-action')).toHaveTextContent('Refresh Workbench Session')
    );
    expect(screen.queryByRole('button', { name: 'Export Pairing Prompt' })).not.toBeInTheDocument();

    customerContextMock.customerContext.selectedCustomerId = 'admin@100yen.org';
    customerContextMock.customerContext.selectedTarget = accountOnlyTarget;
    customerContextMock.customerContext.targets = [accountOnlyTarget, benjaminTarget, davidTarget];
    customerContextMock.brokerSession = {
      state: 'authenticated',
      authenticated: true,
      expired: false,
      sessionKey: 'evaos-session-2',
      source: 'callback',
      userEmail: 'admin@100yen.org',
      message: 'Authenticated',
    };
    view.rerender(
      <ConfigProvider>
        <NativeCompanionPage />
      </ConfigProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId('native-companion-next-action')).toHaveTextContent('Connect Mac Control')
    );
    expect(screen.getByText(/Mac control target: David Dorman/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show advanced connector controls' }));
    for (const button of screen.getAllByRole('button', { name: 'Export Pairing Prompt' })) {
      expect(button).toBeEnabled();
    }

    await user.click(screen.getAllByRole('button', { name: 'Export Pairing Prompt' })[0]);

    expect(await screen.findByText('Agent setup prompt')).toBeInTheDocument();
    expect(screen.getByText(/Pairing code: PAIR-DAVID/)).toBeInTheDocument();
    expect(bridgeMocks.runAction).toHaveBeenLastCalledWith({
      action: 'create_pairing_prompt',
      customerId: 'jackie-david',
      agentLabel: 'evaOS Workbench',
    });
    expect(document.body.textContent).not.toMatch(/benjamin-kennedy.*Pairing code|admin@100yen\.org.*Pairing code/s);
  });

  it('does not create a Mac pairing prompt for account-only customer targets', async () => {
    const accountOnlyTarget = {
      customerId: 'admin@100yen.org',
      customerAccountId: 'acct_admin',
      targetKind: 'customer_account' as const,
      accountOnly: true,
      displayName: 'admin@100yen.org',
      isDefault: true,
    };
    customerContextMock.customerContext.selectedCustomerId = 'admin@100yen.org';
    customerContextMock.customerContext.selectedTarget = accountOnlyTarget;
    customerContextMock.customerContext.targets = [accountOnlyTarget];
    customerContextMock.customerContext.isOperator = true;
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-21T03:45:00.000Z',
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        summaryText: 'Workbench connector ready for code-only agent pairing.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: false },
        bridgeCli: {
          installed: true,
          status: 'ready',
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
        audit: {
          status: 'ready',
          auditIds: ['audit-mac-ready'],
        },
      },
    });

    const user = userEvent.setup();
    renderNativeCompanion();

    expect(await screen.findByText('Choose a Mac-control customer')).toBeInTheDocument();
    expect(screen.getByText('Setup needed')).toBeInTheDocument();
    expect(screen.getByTestId('native-companion-next-action')).toHaveTextContent('Choose Mac target');
    expect(screen.getByTestId('native-companion-next-action')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Show advanced connector controls' }));
    expect(screen.getByRole('button', { name: 'Export Pairing Prompt' })).toBeDisabled();
    expect(bridgeMocks.runAction).not.toHaveBeenCalled();
  });

  it('requires choosing the VM-backed pairing target when the footer is on the admin account row', async () => {
    const accountOnlyTarget = {
      customerId: 'admin@100yen.org',
      customerAccountId: 'acct_admin',
      targetKind: 'customer_account' as const,
      accountOnly: true,
      displayName: 'admin@100yen.org',
      isDefault: false,
    };
    const goldenTarget = {
      customerId: 'golden',
      targetKind: 'customer_vm' as const,
      displayName: 'Golden Test VM',
      isDefault: true,
    };
    customerContextMock.customerContext.selectedCustomerId = 'admin@100yen.org';
    customerContextMock.customerContext.selectedTarget = accountOnlyTarget;
    customerContextMock.customerContext.targets = [accountOnlyTarget, goldenTarget];
    customerContextMock.customerContext.isOperator = true;
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-21T03:45:00.000Z',
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        summaryText: 'Workbench connector ready for code-only agent pairing.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: false },
        bridgeCli: {
          installed: true,
          status: 'ready',
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
        status: 'succeeded',
        message: 'Pairing prompt is ready. Paste it into evaOS/OpenClaw or Hermes to complete the link.',
        sourcePointer: 'native-companion:pairing-prompt',
        auditIds: ['audit-pairing'],
        refreshRecommended: false,
        pairing: {
          customerId: 'golden',
          pairingCode: 'PAIR-1234',
          setupPrompt: 'Customer: golden\nPairing code: PAIR-1234\nUse customer_mac_complete_pairing with this code.',
        },
        agentPairingStatus: 'pairing_prompt_created',
      },
    });

    const user = userEvent.setup();
    renderNativeCompanion();

    const targetSelect = await screen.findByTestId('native-companion-mac-target-select');
    expect(targetSelect).toHaveValue('');
    expect(screen.getByTestId('native-companion-next-action')).toBeDisabled();

    await user.selectOptions(targetSelect, 'golden');
    expect(screen.getByText(/Mac control target: Golden Test VM/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show advanced connector controls' }));
    await user.click(screen.getByRole('button', { name: 'Export Pairing Prompt' }));

    expect(await screen.findByText('Agent setup prompt')).toBeInTheDocument();
    expect(bridgeMocks.runAction).toHaveBeenCalledWith({
      action: 'create_pairing_prompt',
      customerId: 'golden',
      agentLabel: 'evaOS Workbench',
    });
    expect(document.body.textContent).not.toMatch(/admin@100yen\.org.*Pairing code/s);
  });

  it('requires an explicit Mac target when the selected footer account is account-only', async () => {
    const accountOnlyTarget = {
      customerId: 'admin@100yen.org',
      customerAccountId: 'acct_admin',
      targetKind: 'customer_account' as const,
      accountOnly: true,
      displayName: 'admin@100yen.org',
      isDefault: false,
    };
    const benjaminTarget = {
      customerId: 'benjamin-kennedy',
      targetKind: 'customer_vm' as const,
      displayName: 'Benjamin Kennedy',
      isDefault: false,
    };
    const goldenTarget = {
      customerId: 'golden',
      targetKind: 'customer_vm' as const,
      displayName: 'admin@100yen.org',
      isDefault: true,
    };
    customerContextMock.customerContext.selectedCustomerId = 'admin@100yen.org';
    customerContextMock.customerContext.selectedTarget = accountOnlyTarget;
    customerContextMock.customerContext.targets = [accountOnlyTarget, benjaminTarget, goldenTarget];
    customerContextMock.customerContext.isOperator = true;
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-21T03:45:00.000Z',
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        summaryText: 'Workbench connector ready for account-scoped Mac control.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: false },
        bridgeCli: {
          installed: true,
          status: 'ready',
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
          action: 'ensure_customer_mac_connector_grant',
          status: 'succeeded',
          message: 'Mac control is connected for this evaOS Workbench session.',
          sourcePointer: 'native-companion:connector-grant-ready',
          auditIds: ['audit-grant'],
          refreshRecommended: false,
          connectorGrant: {
            ok: true,
            customerId: 'benjamin-kennedy',
            deviceId: 'device-benjamin',
            grantId: 'grant-benjamin',
            grantState: 'active',
            auditId: 'audit-grant',
          },
          agentPairingStatus: 'ready_for_agent_pairing',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          action: 'create_pairing_prompt',
          status: 'succeeded',
          message: 'Pairing prompt is ready. Paste it into evaOS/OpenClaw or Hermes to complete the link.',
          sourcePointer: 'native-companion:pairing-prompt',
          auditIds: ['audit-pairing'],
          refreshRecommended: false,
          pairing: {
            customerId: 'benjamin-kennedy',
            pairingCode: 'PAIR-1234',
            setupPrompt:
              'Customer: benjamin-kennedy\nPairing code: PAIR-1234\nUse customer_mac_complete_pairing with this code.',
          },
          agentPairingStatus: 'pairing_prompt_created',
        },
      });

    const user = userEvent.setup();
    renderNativeCompanion();

    const targetSelect = await screen.findByTestId('native-companion-mac-target-select');
    expect(targetSelect).toHaveValue('');
    expect(screen.getByTestId('native-companion-next-action')).toBeDisabled();
    expect(document.body.textContent).not.toMatch(/Mac control target: Golden VM \(admin@100yen\.org\)/i);

    await user.selectOptions(targetSelect, 'benjamin-kennedy');
    expect(screen.getByText(/Mac control target: Benjamin Kennedy/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Connect Mac Control' }));
    await waitFor(() =>
      expect(screen.getAllByText('Mac control is connected for this evaOS Workbench session.').length).toBeGreaterThan(
        0
      )
    );
    expect(bridgeMocks.runAction).toHaveBeenLastCalledWith({
      action: 'ensure_customer_mac_connector_grant',
      customerId: 'benjamin-kennedy',
      agentLabel: 'evaOS Workbench',
    });

    await user.click(screen.getByRole('button', { name: 'Show advanced connector controls' }));
    await user.click(screen.getByRole('button', { name: 'Export Pairing Prompt' }));

    expect(await screen.findByText('Agent setup prompt')).toBeInTheDocument();
    expect(bridgeMocks.runAction).toHaveBeenCalledWith({
      action: 'create_pairing_prompt',
      customerId: 'benjamin-kennedy',
      agentLabel: 'evaOS Workbench',
    });
  });

  it('refreshes status and clears a stale connected grant when the connector stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      customerContextMock.customerContext.selectedCustomerId = 'golden';
      customerContextMock.customerContext.selectedTarget = {
        customerId: 'golden',
        targetKind: 'customer_vm',
        displayName: 'Golden VM (admin@100yen.org)',
        isDefault: true,
      };
      customerContextMock.customerContext.targets = [customerContextMock.customerContext.selectedTarget];
      const readyStatus = {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-28T17:37:06.000Z',
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        summaryText: 'Workbench connector ready for account-scoped Mac control.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: true, running: true, path: '/Applications/evaOS Workbench.app' },
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
        iPhone: { status: 'unavailable', installed: false, running: false },
        audit: { status: 'ready', auditIds: ['audit-mac-ready'] },
      };
      const stoppedStatus = {
        ...readyStatus,
        generatedAt: '2026-06-28T17:41:07.000Z',
        readiness: 'repair_required',
        agentPairingStatus: 'not_ready',
        summaryText: 'Mac Access connector could not start. The connector did not report a reachable local service.',
        connectorService: { status: 'repair_required', running: false, reachable: false },
        customerMac: { status: 'repair_required', permissions: readyStatus.customerMac.permissions },
      };
      bridgeMocks.getStatus
        .mockResolvedValueOnce({ success: true, data: readyStatus })
        .mockResolvedValueOnce({ success: true, data: stoppedStatus });
      bridgeMocks.runAction.mockResolvedValueOnce({
        success: true,
        data: {
          action: 'ensure_customer_mac_connector_grant',
          status: 'succeeded',
          message: 'Mac control is connected for this evaOS Workbench session.',
          sourcePointer: 'native-companion:connector-grant-ready',
          auditIds: ['audit-grant'],
          refreshRecommended: false,
          connectorGrant: {
            ok: true,
            customerId: 'golden',
            deviceId: 'device-golden',
            grantId: 'grant-golden',
            grantState: 'active',
            auditId: 'audit-grant',
          },
          agentPairingStatus: 'agent_paired',
        },
      });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderNativeCompanion();

      expect(await screen.findByText('This Mac is locally ready')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Connect Mac Control' }));
      await waitFor(() =>
        expect(
          screen.getAllByText('Mac control is connected for this evaOS Workbench session.').length
        ).toBeGreaterThan(0)
      );

      await act(async () => {
        vi.advanceTimersByTime(6_000);
      });

      expect(bridgeMocks.getStatus).toHaveBeenCalledTimes(2);
      await waitFor(() =>
        expect(screen.queryByText('Mac control is connected for this evaOS Workbench session.')).not.toBeInTheDocument()
      );
      expect(screen.getByText('Repair Mac access')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Turn On Mac Access' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears a stale connected grant when the latest status revokes pairing proof', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      customerContextMock.customerContext.selectedCustomerId = 'golden';
      customerContextMock.customerContext.selectedTarget = {
        customerId: 'golden',
        targetKind: 'customer_vm',
        displayName: 'Golden VM (admin@100yen.org)',
        isDefault: true,
      };
      customerContextMock.customerContext.targets = [customerContextMock.customerContext.selectedTarget];
      const readyStatus = {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-28T18:05:00.000Z',
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        summaryText: 'Workbench connector ready for account-scoped Mac control.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: true, running: true, path: '/Applications/evaOS Workbench.app' },
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
        iPhone: { status: 'unavailable', installed: false, running: false },
        audit: { status: 'ready', auditIds: ['audit-mac-ready'] },
      };
      const revokedStatus = {
        ...readyStatus,
        generatedAt: '2026-06-28T18:05:05.000Z',
        agentPairingStatus: 'not_ready',
        summaryText: 'Mac control grant is not active for this session.',
      };
      bridgeMocks.getStatus
        .mockResolvedValueOnce({ success: true, data: readyStatus })
        .mockResolvedValueOnce({ success: true, data: revokedStatus });
      bridgeMocks.runAction.mockResolvedValueOnce({
        success: true,
        data: {
          action: 'ensure_customer_mac_connector_grant',
          status: 'succeeded',
          message: 'Mac control is connected for this evaOS Workbench session.',
          sourcePointer: 'native-companion:connector-grant-ready',
          auditIds: ['audit-grant'],
          refreshRecommended: false,
          connectorGrant: {
            ok: true,
            customerId: 'golden',
            deviceId: 'device-golden',
            grantId: 'grant-golden',
            grantState: 'active',
            auditId: 'audit-grant',
          },
          agentPairingStatus: 'agent_paired',
        },
      });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderNativeCompanion();

      expect(await screen.findByText('This Mac is locally ready')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Connect Mac Control' }));
      await waitFor(() =>
        expect(
          screen.getAllByText('Mac control is connected for this evaOS Workbench session.').length
        ).toBeGreaterThan(0)
      );

      await act(async () => {
        vi.advanceTimersByTime(6_000);
      });

      expect(bridgeMocks.getStatus).toHaveBeenCalledTimes(2);
      await waitFor(() =>
        expect(screen.queryByText('Mac control is connected for this evaOS Workbench session.')).not.toBeInTheDocument()
      );
      expect(screen.getByRole('button', { name: 'Connect Mac Control' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides the advanced connector start action when Mac Access is already ready', async () => {
    customerContextMock.customerContext.selectedCustomerId = 'golden';
    customerContextMock.customerContext.selectedTarget = {
      customerId: 'golden',
      targetKind: 'customer_vm',
      displayName: 'Golden VM (admin@100yen.org)',
      isDefault: true,
    };
    customerContextMock.customerContext.targets = [customerContextMock.customerContext.selectedTarget];
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-28T18:10:00.000Z',
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        summaryText: 'Workbench connector ready for account-scoped Mac control.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: true, running: true, path: '/Applications/evaOS Workbench.app' },
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
        iPhone: { status: 'unavailable', installed: false, running: false },
        audit: { status: 'ready', auditIds: ['audit-mac-ready'] },
      },
    });

    const user = userEvent.setup();
    renderNativeCompanion();

    await screen.findByText('This Mac is locally ready');
    await user.click(screen.getByRole('button', { name: 'Show advanced connector controls' }));
    expect(screen.queryByRole('button', { name: 'Turn On Mac Access' })).not.toBeInTheDocument();
    expect(bridgeMocks.runAction).not.toHaveBeenCalled();
  });

  it('ignores ambiguous account-looking rows when choosing a Mac pairing target', async () => {
    const ambiguousAccountTarget = {
      customerId: 'acct_admin',
      customerAccountId: 'acct_admin',
      displayName: 'admin@100yen.org',
      isDefault: true,
    };
    const goldenTarget = {
      customerId: 'golden',
      targetKind: 'customer_vm' as const,
      displayName: 'Golden Test VM',
      isDefault: false,
    };
    customerContextMock.customerContext.selectedCustomerId = 'acct_admin';
    customerContextMock.customerContext.selectedTarget = ambiguousAccountTarget;
    customerContextMock.customerContext.targets = [ambiguousAccountTarget, goldenTarget];
    customerContextMock.customerContext.isOperator = true;
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-21T03:45:00.000Z',
        readiness: 'ready',
        agentPairingStatus: 'ready_for_agent_pairing',
        summaryText: 'Workbench connector ready for code-only agent pairing.',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: false },
        bridgeCli: {
          installed: true,
          status: 'ready',
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
        status: 'succeeded',
        message: 'Pairing prompt is ready. Paste it into evaOS/OpenClaw or Hermes to complete the link.',
        sourcePointer: 'native-companion:pairing-prompt',
        auditIds: ['audit-pairing'],
        refreshRecommended: false,
        pairing: {
          customerId: 'golden',
          pairingCode: 'PAIR-1234',
          setupPrompt: 'Customer: golden\nPairing code: PAIR-1234\nUse customer_mac_complete_pairing with this code.',
        },
        agentPairingStatus: 'pairing_prompt_created',
      },
    });

    const user = userEvent.setup();
    renderNativeCompanion();

    const targetSelect = await screen.findByTestId('native-companion-mac-target-select');
    expect(targetSelect).toHaveValue('');
    await user.selectOptions(targetSelect, 'golden');
    await user.click(screen.getByRole('button', { name: 'Show advanced connector controls' }));
    await user.click(screen.getByRole('button', { name: 'Export Pairing Prompt' }));

    expect(await screen.findByText('Agent setup prompt')).toBeInTheDocument();
    expect(bridgeMocks.runAction).toHaveBeenCalledWith({
      action: 'create_pairing_prompt',
      customerId: 'golden',
      agentLabel: 'evaOS Workbench',
    });
    expect(document.body.textContent).not.toMatch(/Customer: acct_admin|Mac control target: admin@100yen\.org/i);
  });

  it('starts Workbench sign-in instead of showing a locked pairing button when signed out', async () => {
    customerContextMock.brokerAuthenticated = false;
    customerContextMock.brokerSession = null;
    customerContextMock.customerContext.selectedCustomerId = undefined;
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-06-21T03:45:00.000Z',
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
        audit: {
          status: 'ready',
          auditIds: ['audit-mac-ready'],
        },
      },
    });

    const user = userEvent.setup();
    renderNativeCompanion();

    expect(await screen.findByText('Sign in to Workbench')).toBeInTheDocument();
    const reconnect = screen.getByTestId('native-companion-next-action');
    expect(reconnect).toHaveTextContent('Sign In To Workbench');
    expect(reconnect).toBeEnabled();
    expect(screen.queryByTestId('native-companion-next-action')).not.toHaveTextContent('Export Pairing Prompt');

    await user.click(reconnect);

    await waitFor(() => expect(brokerMocks.beginDesktopAuth).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Open sign-in page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy sign-in link' })).toBeInTheDocument();
    expect(customerContextMock.refreshBrokerSession).not.toHaveBeenCalled();
    expect(customerContextMock.customerContext.refreshTargets).not.toHaveBeenCalled();
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

    expect(await screen.findByText('Connect Mac control')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Show advanced connector controls' }));
    await user.click(screen.getByRole('button', { name: 'Ask Permission' }));

    expect(await screen.findByTestId('native-companion-takeover-cue-warning')).toHaveTextContent(
      'takeover_sound_unavailable'
    );
    expect(await screen.findByTestId('native-companion-action-result')).toHaveTextContent(
      'Agent control could not start.'
    );
    expect(screen.getByTestId('native-companion-next-action')).toHaveTextContent('Connect Mac Control');
    expect(screen.getByTestId('native-companion-next-action')).toBeEnabled();

    const createPairingButtons = screen.getAllByRole('button', { name: 'Export Pairing Prompt' });
    expect(createPairingButtons.every((button) => !button.hasAttribute('disabled'))).toBe(true);

    await user.click(createPairingButtons[0]);
    expect(await screen.findByText('Agent setup prompt')).toBeInTheDocument();
    expect(screen.getByText(/Pairing code: PAIR-1234/)).toBeInTheDocument();
  });

  it('keeps proof cards pending for a grant and marks them proven only with runtime tool proof', async () => {
    const pairedStatus = {
      schemaVersion: 'evaos.native_companion_status.v1' as const,
      generatedAt: '2026-06-07T03:45:00.000Z',
      readiness: 'ready' as const,
      agentPairingStatus: 'agent_paired' as const,
      agentPairingCustomerId: 'benjamin-kennedy',
      agentPairingProofScopeId: 'grant-current',
      activeMacControlScopeId: 'grant-current',
      runtimeToolReadiness: 'pairing_ready' as const,
      runtimeToolProofCustomerId: 'benjamin-kennedy',
      runtimeToolProofScopeId: 'grant-current',
      summaryText: 'Workbench connector ready with agent proof.',
      sourcePointer: 'native-companion:read-only-bridge',
      canOpenReleasedWorkbench: false,
      releasedWorkbench: { installed: false },
      bridgeCli: {
        installed: true,
        status: 'ready' as const,
        auditId: 'audit-bridge-ready',
        readOnly: true,
        permissions: { accessibility: 'granted', screenRecording: 'granted' },
      },
      connectorService: { status: 'ready' as const, running: true, reachable: true },
      customerMac: {
        status: 'ready' as const,
        auditId: 'audit-mac-ready',
        permissions: { accessibility: 'granted', screenRecording: 'granted' },
      },
      iPhone: { status: 'unavailable' as const, installed: false, running: false },
      controlSession: {
        status: 'ready' as const,
        auditId: 'audit-control-ready',
        active: true,
        mode: 'full-access' as const,
        killSwitch: false,
      },
      audit: { status: 'ready' as const, auditIds: ['audit-mac-ready', 'audit-control-ready'] },
    };
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: pairedStatus,
    });

    renderNativeCompanion();

    expect(await screen.findAllByText('Grant active; test needed')).toHaveLength(2);
    expect(screen.getByText('Test with evaOS / OpenClaw')).toBeInTheDocument();
    expect(screen.getByText('Test with Hermes')).toBeInTheDocument();
    expect(screen.getAllByText('Pending')).toHaveLength(2);
    expect(screen.queryByText('Proven')).not.toBeInTheDocument();

    cleanup();
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: { ...pairedStatus, runtimeToolReadiness: 'tools_ready' },
    });
    renderNativeCompanion();

    expect(await screen.findAllByText('End-to-end ready')).toHaveLength(2);
    expect(screen.getAllByText('Proven')).toHaveLength(2);
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();

    cleanup();
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: { ...pairedStatus, runtimeToolReadiness: 'proof_failed' },
    });
    renderNativeCompanion();

    expect(await screen.findAllByText('Needs retry')).toHaveLength(2);
    expect(screen.queryByText('Proven')).not.toBeInTheDocument();
    expect(screen.queryByText('End-to-end ready')).not.toBeInTheDocument();

    cleanup();
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        ...pairedStatus,
        agentPairingProofScopeId: 'grant-revoked',
        runtimeToolReadiness: 'tools_ready',
        runtimeToolProofScopeId: 'grant-revoked',
      },
    });
    renderNativeCompanion();

    expect(await screen.findByText('Setup needed')).toBeInTheDocument();
    expect(screen.queryByText('Proven')).not.toBeInTheDocument();
    expect(screen.queryByText('End-to-end ready')).not.toBeInTheDocument();

    cleanup();
    customerContextMock.customerContext.selectedCustomerId = 'customer-b';
    customerContextMock.customerContext.selectedTarget = {
      customerId: 'customer-b',
      targetKind: 'customer_vm',
      displayName: 'Customer B',
      isDefault: true,
    };
    customerContextMock.customerContext.targets = [
      {
        customerId: 'benjamin-kennedy',
        targetKind: 'customer_vm',
        displayName: 'Benjamin Kennedy',
      },
      customerContextMock.customerContext.selectedTarget,
    ];
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: { ...pairedStatus, runtimeToolReadiness: 'tools_ready' },
    });
    renderNativeCompanion();

    expect(await screen.findByText('Setup needed')).toBeInTheDocument();
    expect(screen.queryByText('Grant active; test needed')).not.toBeInTheDocument();
    expect(screen.queryByText('Proven')).not.toBeInTheDocument();
    expect(screen.queryByText('End-to-end ready')).not.toBeInTheDocument();

    cleanup();
    customerContextMock.customerContext.selectedCustomerId = 'benjamin-kennedy';
    customerContextMock.customerContext.selectedTarget = {
      customerId: 'benjamin-kennedy',
      targetKind: 'customer_vm',
      displayName: 'Benjamin Kennedy',
      isDefault: true,
    };
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        ...pairedStatus,
        runtimeToolReadiness: 'tools_ready',
        runtimeToolProofScopeId: 'grant-revoked',
      },
    });
    renderNativeCompanion();

    expect(await screen.findAllByText('Grant active; test needed')).toHaveLength(2);
    expect(screen.queryByText('Proven')).not.toBeInTheDocument();
    expect(screen.queryByText('End-to-end ready')).not.toBeInTheDocument();

    cleanup();
    bridgeMocks.getStatus.mockResolvedValue({
      success: true,
      data: {
        ...pairedStatus,
        agentPairingStatus: 'proof_failed',
        agentPairingProofScopeId: undefined,
        runtimeToolReadiness: 'proof_failed',
        runtimeToolProofScopeId: undefined,
      },
    });
    renderNativeCompanion();

    expect(await screen.findByText('Setup needed')).toBeInTheDocument();
    expect(screen.queryByText('Needs retry')).not.toBeInTheDocument();
  });

  it('does not let a stale setup-check action restore agent pairing after refreshed status downgrades it', async () => {
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
          message: 'Mac Access setup check passed. Local Workbench connector and macOS permissions are ready.',
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
          agentPairingStatus: 'agent_paired',
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

    expect(await screen.findByText('Connect Mac control')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show advanced connector controls' }));
    await user.click(screen.getByRole('button', { name: 'Export Pairing Prompt' }));
    await waitFor(() => expect(screen.getAllByText('Pending')).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Copy Pairing Prompt' }));
    await user.click(screen.getByTestId('native-companion-next-action'));

    await waitFor(() => expect(bridgeMocks.runAction).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Ready to connect')).toBeInTheDocument();
    expect(screen.queryByText('Grant active; test needed')).not.toBeInTheDocument();
    expect(screen.queryByText('Proven')).not.toBeInTheDocument();
  });
});
