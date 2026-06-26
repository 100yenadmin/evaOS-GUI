/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  applyEvaosNativeCompanionStatusToAgent,
  getEvaosNativeAgentAvailability,
  isEvaosNativeAgentRepairRequired,
  isEvaosNativeDependentAgent,
  resolveEvaosNativeAvailabilitySource,
} from '@/renderer/evaos/evaosNativeAgentAvailability';

describe('evaosNativeAgentAvailability', () => {
  it('allows evaOS/OpenClaw chat when Mac control pairing proof is missing', () => {
    const availability = getEvaosNativeAgentAvailability({
      agent_type: 'openclaw-gateway',
      backend: 'openclaw-gateway',
      name: 'OpenClaw',
    });

    expect(availability).toMatchObject({
      isNativeDependent: true,
      displayName: 'evaOS',
      status: 'usable',
      statusLabelKey: 'settings.agentManagement.detected',
      repairRoute: '/native-companion',
      repairActionLabelKey: 'settings.agentManagement.goToChat',
      reasonKey: 'settings.agentManagement.nativePairingProofMissing',
    });
    expect(isEvaosNativeAgentRepairRequired({ agent_type: 'openclaw-gateway' })).toBe(false);
  });

  it('allows Hermes chat when Mac control reports not paired', () => {
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

    expect(availability.status).toBe('usable');
    expect(availability.reasonKey).toBe('settings.agentManagement.nativeStatusReason');
    expect(availability.reasonParams).toEqual({ status: 'not_paired' });
  });

  it('treats repair_required as non-blocking Mac control repair copy instead of a chat blocker', () => {
    const availability = getEvaosNativeAgentAvailability({
      agent_type: 'openclaw-gateway',
      backend: 'openclaw-gateway',
      name: 'OpenClaw',
      handshake: {
        native_companion: {
          status: 'repair_required',
        },
      },
    });

    expect(availability.status).toBe('usable');
    expect(availability.reasonKey).toBe('settings.agentManagement.nativeStatusReason');
    expect(availability.reasonParams).toEqual({ status: 'repair_required' });
  });

  it('allows native-dependent agents only when agent pairing proof is explicitly provided', () => {
    const availability = getEvaosNativeAgentAvailability({
      agent_type: 'acp',
      backend: 'hermes',
      name: 'Hermes',
      handshake: {
        evaos_native_companion: {
          status: 'agent_paired',
        },
      },
    });

    expect(availability).toMatchObject({
      isNativeDependent: true,
      displayName: 'Hermes',
      status: 'usable',
      statusLabelKey: 'settings.agentManagement.nativePaired',
      sourceStatus: 'agent_paired',
    });
  });

  it('keeps chat usable when Mac control reports an unknown local-ready status', () => {
    const availability = getEvaosNativeAgentAvailability({
      agent_type: 'acp',
      backend: 'hermes',
      name: 'Hermes',
      handshake: {
        native_companion: {
          status: 'local-ready',
        },
      },
    });

    expect(availability.status).toBe('usable');
    expect(availability.reasonKey).toBe('settings.agentManagement.nativeStatusNotUsableReason');
    expect(availability.sourceStatus).toBe('local-ready');
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
          status: 'agent_paired',
        },
      },
    };

    const source = resolveEvaosNativeAvailabilitySource(selectedPreset, 'hermes', [detectedHermes]);

    expect(source).toBe(detectedHermes);
    expect(getEvaosNativeAgentAvailability(source!).status).toBe('usable');
  });

  it('applies read-only native companion readiness to evaOS and Hermes rows', () => {
    const nativeStatus = {
      schemaVersion: 'evaos.native_companion_status.v1' as const,
      generatedAt: '2026-06-07T03:45:00.000Z',
      readiness: 'ready' as const,
      agentPairingStatus: 'agent_paired' as const,
      summaryText: 'Native bridge ready.',
      sourcePointer: 'native-companion:read-only-bridge',
      canOpenReleasedWorkbench: true,
      releasedWorkbench: { installed: true, path: '/Applications/evaOS Workbench.app' },
      bridgeCli: { installed: true, status: 'ready' as const, readOnly: true, auditId: 'audit-bridge' },
      customerMac: { status: 'ready' as const, auditId: 'audit-mac' },
      iPhone: { status: 'available' as const, auditId: 'audit-iphone' },
      audit: { status: 'ready' as const, auditIds: ['audit-mac'] },
    };

    const evaos = applyEvaosNativeCompanionStatusToAgent(
      { agent_type: 'openclaw-gateway', backend: 'openclaw-gateway', name: 'OpenClaw' },
      nativeStatus
    );
    const hermes = applyEvaosNativeCompanionStatusToAgent(
      { agent_type: 'acp', backend: 'hermes', name: 'Hermes' },
      nativeStatus
    );
    const claude = applyEvaosNativeCompanionStatusToAgent(
      { agent_type: 'acp', backend: 'claude', name: 'Claude Code' },
      nativeStatus
    );

    expect(getEvaosNativeAgentAvailability(evaos).status).toBe('usable');
    expect(getEvaosNativeAgentAvailability(hermes).status).toBe('usable');
    expect(claude).not.toHaveProperty('native_companion_status');
  });

  it('does not block chat when local connector is ready but Mac control is not agent-paired yet', () => {
    const nativeStatus = {
      schemaVersion: 'evaos.native_companion_status.v1' as const,
      generatedAt: '2026-06-07T03:45:00.000Z',
      readiness: 'ready' as const,
      agentPairingStatus: 'ready_for_agent_pairing' as const,
      summaryText: 'Native bridge ready.',
      sourcePointer: 'native-companion:read-only-bridge',
      canOpenReleasedWorkbench: true,
      releasedWorkbench: { installed: true, path: '/Applications/evaOS Workbench.app' },
      bridgeCli: { installed: true, status: 'ready' as const, readOnly: true, auditId: 'audit-bridge' },
      customerMac: { status: 'ready' as const, auditId: 'audit-mac' },
      iPhone: { status: 'available' as const, auditId: 'audit-iphone' },
      audit: { status: 'ready' as const, auditIds: ['audit-mac'] },
    };

    const evaos = applyEvaosNativeCompanionStatusToAgent(
      { agent_type: 'openclaw-gateway', backend: 'openclaw-gateway', name: 'OpenClaw' },
      nativeStatus
    );

    const availability = getEvaosNativeAgentAvailability(evaos);
    expect(availability.status).toBe('usable');
    expect(availability.sourceStatus).toBe('ready_for_agent_pairing');
  });
});
