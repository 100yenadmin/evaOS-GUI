/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for renderer/hooks/assistant/useDetectedAgents.ts (A4 in N4a).
 * Tests useDetectedAgents hook: agent detection via SWR and refresh trigger.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock SWR
vi.mock('swr', () => ({
  default: vi.fn((_key, _fetcher) => {
    // Return mock data immediately for simplicity
    return { data: [], error: null, isLoading: false };
  }),
  mutate: vi.fn(),
}));

// Mock @/common
vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      refreshCustomAgents: { invoke: vi.fn() },
    },
  },
}));

// Mock agentTypes module
vi.mock('@/renderer/utils/model/agentTypes', () => ({
  ASSISTANT_AGENT_CATALOG_SWR_KEY: 'assistant-agent-catalog',
  DETECTED_AGENTS_SWR_KEY: 'detected-agents',
  fetchAssistantAgentCatalog: vi.fn(),
}));

import { useDetectedAgents } from '@/renderer/hooks/assistant/useDetectedAgents';
import { ipcBridge } from '@/common';
import useSWR, { mutate } from 'swr';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

describe('useDetectedAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty availableBackends when no agents detected', () => {
    (useSWR as any).mockReturnValue({ data: [], error: null });

    const { result } = renderHook(() => useDetectedAgents());

    expect(result.current.availableBackends).toEqual([]);
  });

  it('filters and maps detected agents to availableBackends', () => {
    const mockAgents: ManagedAgent[] = [
      {
        id: 'a1',
        name: 'ClaudeCode',
        agent_type: 'acp',
        agent_source: 'builtin',
        backend: 'claude',
        enabled: true,
        installed: true,
        sort_order: 0,
        status: 'online',
      },
      {
        id: 'a2',
        name: 'AionRS',
        agent_type: 'aionrs',
        agent_source: 'internal',
        enabled: true,
        installed: true,
        sort_order: 1,
        status: 'unchecked',
      },
      {
        id: 'a3',
        name: 'RemoteAgent',
        agent_type: 'remote',
        agent_source: 'builtin',
        enabled: true,
        installed: true,
        sort_order: 2,
        status: 'online',
      },
    ];
    (useSWR as any).mockReturnValue({ data: mockAgents, error: null });

    const { result } = renderHook(() => useDetectedAgents());

    expect(result.current.availableBackends).toHaveLength(2); // 'remote' excluded
    // backend slug wins when present
    expect(result.current.availableBackends[0]).toEqual({
      id: 'a1',
      name: 'ClaudeCode',
      runtimeKey: 'claude',
      isExtension: false,
      modelOptions: [],
    });
    // falls back to agent_type when backend is absent (e.g. internal engines)
    expect(result.current.availableBackends[1]).toEqual({
      id: 'a2',
      name: 'AionRS',
      runtimeKey: 'aionrs',
      isExtension: false,
      modelOptions: [],
    });
  });

  it('derives backend-scoped model options from handshake available_models', () => {
    const mockAgents: ManagedAgent[] = [
      {
        id: 'a1',
        name: 'ClaudeCode',
        agent_type: 'acp',
        agent_source: 'builtin',
        backend: 'claude',
        enabled: true,
        installed: true,
        sort_order: 0,
        status: 'online',
        available_models: {
          current_model_id: 'claude-sonnet-4',
          current_model_label: 'Claude Sonnet 4',
          available_models: [
            { id: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
            { id: 'claude-opus-4', label: 'Claude Opus 4' },
          ],
        },
      },
    ];
    (useSWR as any).mockReturnValue({ data: mockAgents, error: null });

    const { result } = renderHook(() => useDetectedAgents());

    expect(result.current.availableBackends[0]?.modelOptions).toEqual([
      { value: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
      { value: 'claude-opus-4', label: 'Claude Opus 4' },
    ]);
  });

  it('calls refreshCustomAgents and mutate on refreshAgentDetection', async () => {
    (useSWR as any).mockReturnValue({ data: [], error: null });
    (ipcBridge.acpConversation.refreshCustomAgents.invoke as any).mockResolvedValue(undefined);

    const { result } = renderHook(() => useDetectedAgents());

    await act(async () => {
      await result.current.refreshAgentDetection();
    });

    expect(ipcBridge.acpConversation.refreshCustomAgents.invoke).toHaveBeenCalled();
    expect(mutate).toHaveBeenNthCalledWith(1, 'assistant-agent-catalog');
    expect(mutate).toHaveBeenNthCalledWith(2, 'detected-agents');
  });

  it('ignores error during refreshAgentDetection', async () => {
    (useSWR as any).mockReturnValue({ data: [], error: null });
    (ipcBridge.acpConversation.refreshCustomAgents.invoke as any).mockRejectedValue(new Error('Refresh failed'));

    const { result } = renderHook(() => useDetectedAgents());

    await act(async () => {
      await result.current.refreshAgentDetection();
    });

    // Should not throw or log error (hook ignores it)
    expect(ipcBridge.acpConversation.refreshCustomAgents.invoke).toHaveBeenCalled();
  });
});
