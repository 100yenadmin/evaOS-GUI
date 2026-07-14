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

  it('scopes status to the selected customer and never renders stale proof after a switch', async () => {
    const statusFor = (customerId: string) => ({
      schemaVersion: 'evaos.native_companion_status.v1' as const,
      generatedAt: '2026-07-13T00:00:00.000Z',
      readiness: 'ready' as const,
      summaryText: 'ready',
      sourcePointer: `native-companion:${customerId}`,
      canOpenReleasedWorkbench: false,
      releasedWorkbench: { installed: true },
      bridgeCli: { installed: true, status: 'ready' as const, readOnly: true, permissions: {} },
      connectorService: { status: 'ready' as const, running: true, reachable: true },
      customerMac: { status: 'ready' as const, permissions: {} },
      iPhone: { status: 'unavailable' as const, installed: false, running: false },
      audit: { status: 'ready' as const, auditIds: [] },
    });
    let resolveDavid: ((value: { success: true; data: ReturnType<typeof statusFor> }) => void) | undefined;
    bridgeMocks.getStatus.mockResolvedValueOnce({ success: true, data: statusFor('jackie') }).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDavid = resolve;
        })
    );

    const { result, rerender } = renderHook(({ customerId }) => useEvaosNativeCompanionStatus(true, customerId), {
      initialProps: { customerId: 'jackie' },
    });
    await waitFor(() => expect(result.current.status?.sourcePointer).toBe('native-companion:jackie'));
    expect(bridgeMocks.getStatus).toHaveBeenLastCalledWith({ customerId: 'jackie' });

    rerender({ customerId: 'david' });
    expect(result.current.status).toBeNull();
    await waitFor(() => expect(bridgeMocks.getStatus).toHaveBeenLastCalledWith({ customerId: 'david' }));

    await act(async () => {
      resolveDavid?.({ success: true, data: statusFor('david') });
    });
    await waitFor(() => expect(result.current.status?.sourcePointer).toBe('native-companion:david'));
  });

  it('drops non-enumerated authority diagnostics before exposing renderer status', async () => {
    bridgeMocks.getStatus.mockResolvedValueOnce({
      success: true,
      data: {
        schemaVersion: 'evaos.native_companion_status.v1',
        generatedAt: '2026-07-13T00:00:00.000Z',
        readiness: 'repair_required',
        summaryText: 'repair required',
        sourcePointer: 'native-companion:read-only-bridge',
        canOpenReleasedWorkbench: false,
        releasedWorkbench: { installed: true },
        bridgeCli: { installed: true, status: 'ready', readOnly: true, permissions: {} },
        connectorService: { status: 'repair_required', running: true, reachable: true },
        customerMac: { status: 'ready', permissions: {} },
        iPhone: { status: 'unavailable', installed: false, running: false },
        audit: { status: 'ready', auditIds: [] },
        privateNetworkAuthority: {
          classification: 'observed',
          reason: 'send_private_endpoint_to_renderer',
          auditId: 'audit-safe',
          endpoint: 'http://100.64.0.10:8765',
        },
      },
    });

    const { result } = renderHook(() => useEvaosNativeCompanionStatus(true, 'customer-313'));

    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.status?.privateNetworkAuthority).toBeUndefined();
    expect(JSON.stringify(result.current.status)).not.toContain('100.64.0.10');
  });

  it('drops non-enumerated authority diagnostics from renderer diagnostic packets', async () => {
    bridgeMocks.getStatus.mockResolvedValueOnce({ success: false, msg: 'not needed' });
    bridgeMocks.getDiagnosticPacket.mockResolvedValueOnce({
      success: true,
      data: {
        schemaVersion: 'evaos.workbench.diagnostic_packet.v1',
        brokerGrant: {
          auditIds: [],
          privateNetworkAuthority: {
            classification: 'observed',
            reason: 'raw_policy_payload',
            endpoint: 'http://100.64.0.10:8765',
          },
        },
      },
    });
    const { result } = renderHook(() => useEvaosNativeCompanionStatus(false, 'customer-313'));

    const packet = await result.current.getDiagnosticPacket({ customerId: 'customer-313' });

    expect(packet?.brokerGrant.privateNetworkAuthority).toBeUndefined();
    expect(JSON.stringify(packet)).not.toContain('100.64.0.10');
  });

  it('turns an enrollment IPC rejection into a safe visible action result', async () => {
    bridgeMocks.getStatus.mockResolvedValueOnce({ success: false, msg: 'not needed' });
    bridgeMocks.runAction.mockRejectedValueOnce(
      new Error('request failed for https://private.example.test with auth-key=tskey-secret and device 100.64.0.10')
    );
    const { result } = renderHook(() => useEvaosNativeCompanionStatus(false, 'bound-customer'));

    const actionResult = await result.current.runAction({
      action: 'secure_network_enroll',
      customerId: 'bound-customer',
    });

    expect(actionResult).toEqual({
      action: 'secure_network_enroll',
      status: 'failed',
      message: 'Workbench connector action could not be reached.',
      sourcePointer: 'native-companion:secure-network-enrollment-action-unreachable',
      auditIds: [],
      refreshRecommended: true,
    });
    expect(JSON.stringify(actionResult)).not.toContain('private.example.test');
    expect(JSON.stringify(actionResult)).not.toContain('tskey-secret');
    expect(JSON.stringify(actionResult)).not.toContain('100.64.0.10');
  });

  it('carries the broker-issued enrollment grant into the next scope-less status refresh', async () => {
    bridgeMocks.getStatus.mockResolvedValue({ success: false, msg: 'not ready' });
    bridgeMocks.runAction.mockResolvedValueOnce({
      success: true,
      data: {
        action: 'secure_network_enroll',
        status: 'succeeded',
        message: 'Enrollment submitted.',
        sourcePointer: 'native-companion:secure-network-enrollment-submitted',
        auditIds: [],
        refreshRecommended: true,
        blockerReason: 'secure_network_link_required',
        bootstrapGrantId: 'grant-bootstrap',
      },
    });
    const { result } = renderHook(() => useEvaosNativeCompanionStatus(true, 'bound-customer'));
    await waitFor(() => expect(bridgeMocks.getStatus).toHaveBeenCalled());

    await act(async () => {
      await result.current.runAction({ action: 'secure_network_enroll', customerId: 'bound-customer' });
      await result.current.refresh();
    });

    expect(bridgeMocks.getStatus).toHaveBeenLastCalledWith({
      customerId: 'bound-customer',
      bootstrapGrantId: 'grant-bootstrap',
    });
  });

  it('does not carry a bootstrap grant across a customer switch', async () => {
    bridgeMocks.getStatus.mockResolvedValue({ success: false, msg: 'not ready' });
    bridgeMocks.runAction.mockResolvedValueOnce({
      success: true,
      data: {
        action: 'secure_network_enroll',
        status: 'succeeded',
        message: 'Enrollment submitted.',
        sourcePointer: 'native-companion:secure-network-enrollment-submitted',
        auditIds: [],
        refreshRecommended: true,
        bootstrapGrantId: 'grant-jackie',
      },
    });
    const { result, rerender } = renderHook(({ customerId }) => useEvaosNativeCompanionStatus(true, customerId), {
      initialProps: { customerId: 'jackie' },
    });
    await waitFor(() => expect(bridgeMocks.getStatus).toHaveBeenCalled());
    await act(async () => {
      await result.current.runAction({ action: 'secure_network_enroll', customerId: 'jackie' });
    });

    rerender({ customerId: 'david' });
    await waitFor(() => expect(bridgeMocks.getStatus).toHaveBeenLastCalledWith({ customerId: 'david' }));
  });
});
