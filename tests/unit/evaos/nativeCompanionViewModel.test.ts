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
  releasedWorkbench: { installed: true, path: '/Applications/evaOS.app' },
  bridgeCli: {
    installed: true,
    status: 'repair_required',
    readOnly: true,
    permissions: {
      accessibility: 'granted',
      screenRecording: 'granted',
    },
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
        summaryText: 'NOT_PAIRED: pairing required before chat can start.',
      }),
      loading: false,
      error: null,
    });

    expect(viewModel.state).toBe('not_paired');
    expect(viewModel.primaryAction.kind).toBe('refresh');
    expect(viewModel.primaryAction.label).toBe('Check again');
    expect(viewModel.readinessStrip.map((item) => item.help).join(' ')).not.toMatch(/AionUi|Aion CLI/i);
    expect(viewModel.readinessStrip.map((item) => item.help).join(' ')).toContain(
      'evaOS Workbench only presents status and opens the repair workflow.'
    );
    expect(viewModel.readinessStrip.find((item) => item.label === 'iPhone')).toMatchObject({
      value: 'Deferred',
      tone: 'neutral',
    });
    expect(viewModel.repairSteps.join(' ')).not.toMatch(
      /pairing code|keychain|tcc bypass|access[_-]?token|desktop[_-]?session|provider[_-]?grant|secret/i
    );
  });
});
