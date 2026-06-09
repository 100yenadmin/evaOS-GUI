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
}));

const feedbackMock = vi.hoisted(() => ({
  openFeedback: vi.fn(),
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
    },
  },
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({
  useFeedback: () => feedbackMock,
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
    window.location.hash = '';
  });

  it('renders read-only native companion status and opens the advanced released Workbench repair handoff', async () => {
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
    renderNativeCompanion();

    expect(await screen.findByText('Mac & iPhone are ready')).toBeInTheDocument();
    expect(screen.getByText(/Native companion proof is ready/i)).toBeInTheDocument();
    expect(screen.getByText(/Native bridge ready from read-only adapter proof/i)).toBeInTheDocument();
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
        summaryText: 'NOT_PAIRED: pairing required before evaOS or Hermes can use Mac control.',
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
          status: 'repair_required',
          auditId: 'audit-bridge',
          readOnly: true,
          permissions: {
            accessibility: 'granted',
            screenRecording: 'granted',
          },
        },
        customerMac: {
          status: 'repair_required',
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
    renderNativeCompanion();

    expect(await screen.findByRole('button', { name: 'Pair this Mac' })).toBeInTheDocument();
    expect(screen.getByText('Mac & iPhone repair')).toBeInTheDocument();
    expect(screen.queryByText('Native companion status matrix')).not.toBeInTheDocument();
    expect(screen.queryByText('RC native canary contract')).not.toBeInTheDocument();
    expect(screen.queryByText('Open released Workbench')).not.toBeInTheDocument();
    expect(screen.queryByText('Not installed')).not.toBeInTheDocument();

    const repairCard = screen.getByTestId('native-companion-repair-card');
    expect(within(repairCard).getAllByRole('button')).toHaveLength(1);

    await user.click(within(repairCard).getByRole('button', { name: 'Pair this Mac' }));
    await waitFor(() => expect(bridgeMocks.openReleasedWorkbench).toHaveBeenCalledTimes(1));

    await user.click(screen.getByText('Advanced diagnostics'));
    expect(await screen.findByText('Native companion status matrix')).toBeInTheDocument();
    expect(screen.getByText('RC native canary contract')).toBeInTheDocument();
    expect(screen.getByText('Open released Workbench fallback')).toBeInTheDocument();
  });

  it('opens an evaOS support report with native audit ids and screenshot request', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Report to support' }));

    await waitFor(() => expect(feedbackMock.openFeedback).toHaveBeenCalledTimes(1));
    const payload = feedbackMock.openFeedback.mock.calls[0][0];
    expect(payload.autoScreenshot).toBe(true);
    expect(payload.tags).toMatchObject({
      support_surface: 'native-companion',
      evaos_route: '/native-companion',
      evaos_state: 'permission_needed',
      evaos_issue: '#179',
    });
    expect(payload.extra).toMatchObject({
      support_packet_version: 'evaos.support_report.v1',
      product: 'evaOS Workbench Beta',
      bundle_id: 'com.evaos.workbench.beta',
      protocol_scheme: 'evaos-workbench-beta',
      route: '/native-companion',
      source_pointer: 'native-companion:read-only-bridge',
      audit_ids: ['audit-mac-permission', 'audit-iphone-available', 'audit-bridge-permission'],
      screenshot: {
        auto_capture_requested: true,
      },
    });
    expect(JSON.stringify(payload)).not.toMatch(/desktop_session|eds_|Bearer|token=/i);
  });
});
