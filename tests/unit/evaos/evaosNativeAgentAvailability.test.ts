/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  getEvaosNativeAgentAvailability,
  isEvaosNativeAgentRepairRequired,
  isEvaosNativeDependentAgent,
  resolveEvaosNativeAvailabilitySource,
} from '@/renderer/evaos/evaosNativeAgentAvailability';

describe('evaosNativeAgentAvailability', () => {
  it('marks evaOS/OpenClaw as repair-required when native pairing proof is missing', () => {
    const availability = getEvaosNativeAgentAvailability({
      agent_type: 'openclaw-gateway',
      backend: 'openclaw-gateway',
      name: 'OpenClaw',
    });

    expect(availability).toMatchObject({
      isNativeDependent: true,
      displayName: 'evaOS',
      status: 'repair_required',
      statusLabelKey: 'settings.agentManagement.nativeRepairRequired',
      repairRoute: '/native-companion',
      repairActionLabelKey: 'settings.agentManagement.nativeRepairAction',
      reasonKey: 'settings.agentManagement.nativePairingProofMissing',
    });
    expect(isEvaosNativeAgentRepairRequired({ agent_type: 'openclaw-gateway' })).toBe(true);
  });

  it('marks Hermes as repair-required when native reports not paired', () => {
    const availability = getEvaosNativeAgentAvailability({
      agent_type: 'acp',
      backend: 'hermes',
      name: 'Hermes',
      handshake: {
        native_companion: {
          status: 'not_paired',
        },
      },
    });

    expect(availability.status).toBe('repair_required');
    expect(availability.reasonKey).toBe('settings.agentManagement.nativeStatusReason');
    expect(availability.reasonParams).toEqual({ status: 'not_paired' });
  });

  it('allows native-dependent agents only when native readiness is explicitly provided', () => {
    const availability = getEvaosNativeAgentAvailability({
      agent_type: 'acp',
      backend: 'hermes',
      name: 'Hermes',
      handshake: {
        evaos_native_companion: {
          status: 'ready',
        },
      },
    });

    expect(availability).toMatchObject({
      isNativeDependent: true,
      displayName: 'Hermes',
      status: 'usable',
      statusLabelKey: 'settings.agentManagement.nativePaired',
      sourceStatus: 'ready',
    });
  });

  it('does not gate Claude, Codex, or Custom behind native pairing', () => {
    expect(isEvaosNativeDependentAgent({ agent_type: 'acp', backend: 'claude', name: 'Claude Code' })).toBe(false);
    expect(isEvaosNativeDependentAgent({ agent_type: 'acp', backend: 'codex', name: 'Codex CLI' })).toBe(false);
    expect(isEvaosNativeDependentAgent({ agent_type: 'aionrs', backend: 'aionrs', name: 'Custom' })).toBe(false);
    expect(getEvaosNativeAgentAvailability({ agent_type: 'aionrs', name: 'Custom' }).status).toBe('usable');
  });

  it('uses the real detected runtime row for native proof when a preset row is selected', () => {
    const selectedPreset = {
      agent_type: 'hermes',
      backend: 'hermes',
      name: 'Hermes Preset',
      is_preset: true,
    };
    const detectedHermes = {
      agent_type: 'hermes',
      backend: 'hermes',
      name: 'Hermes',
      handshake: {
        native_companion: {
          status: 'ready',
        },
      },
    };

    const source = resolveEvaosNativeAvailabilitySource(selectedPreset, 'hermes', [detectedHermes]);

    expect(source).toBe(detectedHermes);
    expect(getEvaosNativeAgentAvailability(source!).status).toBe('usable');
  });
});
