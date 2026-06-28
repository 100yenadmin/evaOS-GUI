/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEvaosNativeCompanionStatus } from '@/renderer/evaos/useEvaosNativeCompanionStatus';

const bridgeMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  openReleasedWorkbench: vi.fn(),
  openRepairAction: vi.fn(),
  runAction: vi.fn(),
  getDiagnosticPacket: vi.fn(),
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
      getDiagnosticPacket: {
        invoke: bridgeMocks.getDiagnosticPacket,
      },
    },
  },
}));

describe('useEvaosNativeCompanionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues a foreground refresh behind an in-flight silent refresh', async () => {
    const initialStatus = {
      schemaVersion: 'evaos.native_companion_status.v1',
      generatedAt: '2026-06-28T18:00:00.000Z',
      readiness: 'ready',
      agentPairingStatus: 'ready_for_agent_pairing',
      summaryText: 'ready',
      sourcePointer: 'native-companion:initial',
      canOpenReleasedWorkbench: false,
      releasedWorkbench: { installed: true },
      bridgeCli: { installed: true, status: 'ready', readOnly: true, permissions: {} },
      connectorService: { status: 'ready', running: true, reachable: true },
      customerMac: { status: 'ready', permissions: {} },
      iPhone: { status: 'unavailable', installed: false, running: false },
      audit: { status: 'ready', auditIds: [] },
    };
    const staleStatus = {
      ...initialStatus,
      generatedAt: '2026-06-28T18:00:05.000Z',
      sourcePointer: 'native-companion:silent-poll',
    };
    const foregroundStatus = {
      ...initialStatus,
      generatedAt: '2026-06-28T18:00:06.000Z',
      sourcePointer: 'native-companion:foreground',
    };

    let resolveSilent: ((value: { success: true; data: typeof staleStatus }) => void) | undefined;
    bridgeMocks.getStatus.mockResolvedValueOnce({ success: true, data: initialStatus });

    const { result } = renderHook(() => useEvaosNativeCompanionStatus(true));

    await waitFor(() => expect(result.current.status?.sourcePointer).toBe('native-companion:initial'));

    bridgeMocks.getStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSilent = resolve;
        })
    );
    const silentRefresh = result.current.refresh({ silent: true });

    await waitFor(() => expect(bridgeMocks.getStatus).toHaveBeenCalledTimes(2));
    bridgeMocks.getStatus.mockResolvedValueOnce({ success: true, data: foregroundStatus });

    await act(async () => {
      await result.current.refresh();
    });
    expect(bridgeMocks.getStatus).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSilent?.({ success: true, data: staleStatus });
      await silentRefresh;
    });

    await waitFor(() => expect(bridgeMocks.getStatus).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.status?.sourcePointer).toBe('native-companion:foreground'));
  });
});
