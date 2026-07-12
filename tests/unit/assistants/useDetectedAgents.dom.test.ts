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
      getAssistantAgentCatalog: { invoke: vi.fn() },
    },
  },
}));

import { useDetectedAgents } from '@/renderer/hooks/assistant/useDetectedAgents';
import { ipcBridge } from '@/common';
import useSWR, { mutate } from 'swr';
import {
  ASSISTANT_AGENT_CATALOG_SWR_KEY,
  DETECTED_AGENTS_SWR_KEY,
  fetchAssistantAgentCatalog,
  type ManagedAgent,
} from '@/renderer/utils/model/agentTypes';

describe('useDetectedAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty availableBackends when no agents detected', () => {
    vi.mocked(useSWR).mockReturnValue({ data: [], error: null, isLoading: false } as ReturnType<typeof useSWR>);

    const { result } = renderHook(() => useDetectedAgents());

    expect(result.current.availableBackends).toEqual([]);
  });

  it('exposes catalog loading and failure state', () => {
    const catalogError = new Error('catalog unavailable');
    vi.mocked(useSWR).mockReturnValue({
      data: undefined,
      error: catalogError,
      isLoading: true,
    } as ReturnType<typeof useSWR>);

    const { result } = renderHook(() => useDetectedAgents());

    expect(result.current.catalogError).toBe(catalogError);
    expect(result.current.isCatalogLoading).toBe(true);
    expect(result.current.availableBackends).toEqual([]);
  });

  it('propagates assistant catalog IPC failures', async () => {
    const failure = new Error('catalog unavailable');
    vi.mocked(ipcBridge.acpConversation.getAssistantAgentCatalog.invoke).mockRejectedValue(failure);

    await expect(fetchAssistantAgentCatalog()).rejects.toBe(failure);
  });

  it('rejects invalid assistant catalog responses', async () => {
    vi.mocked(ipcBridge.acpConversation.getAssistantAgentCatalog.invoke).mockResolvedValue({
      data: [],
    } as unknown as ManagedAgent[]);

    await expect(fetchAssistantAgentCatalog()).rejects.toThrow('Assistant agent catalog response must be an array');
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
    vi.mocked(useSWR).mockReturnValue({ data: mockAgents, error: null } as ReturnType<typeof useSWR>);

    const { result } = renderHook(() => useDetectedAgents());

    expect(result.current.availableBackends).toHaveLength(2); // 'remote' excluded
    // backend slug wins when present
    expect(result.current.availableBackends[0]).toEqual({
      id: 'a1',
      name: 'ClaudeCode',
      runtimeKey: 'claude',
      isExtension: false,
      modelOptions: [],
      thoughtLevelOption: null,
    });
    // falls back to agent_type when backend is absent (e.g. internal engines)
    expect(result.current.availableBackends[1]).toEqual({
      id: 'a2',
      name: 'AionRS',
      runtimeKey: 'aionrs',
      isExtension: false,
      modelOptions: [],
      thoughtLevelOption: null,
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
    vi.mocked(useSWR).mockReturnValue({ data: mockAgents, error: null } as ReturnType<typeof useSWR>);

    const { result } = renderHook(() => useDetectedAgents());

    expect(result.current.availableBackends[0]?.modelOptions).toEqual([
      { value: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
      { value: 'claude-opus-4', label: 'Claude Opus 4' },
    ]);
  });

  it('derives thought-level choices from the canonical management row config catalog', () => {
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
        config_options: {
          config_options: [
            {
              id: 'reasoning_effort',
              category: 'thought_level',
              type: 'select',
              current_value: 'medium',
              options: [
                { value: 'low', label: 'Low' },
                { value: 'medium', name: 'Balanced' },
                { value: 'high', label: 'High', description: 'Most careful' },
              ],
            },
          ],
        },
      },
    ];
    vi.mocked(useSWR).mockReturnValue({ data: mockAgents, error: null } as ReturnType<typeof useSWR>);

    const { result } = renderHook(() => useDetectedAgents());

    expect(result.current.availableBackends[0]?.thoughtLevelOption).toEqual({
      id: 'reasoning_effort',
      category: 'thought_level',
      currentValue: 'medium',
      options: [
        { value: 'low', label: 'Low', description: undefined },
        { value: 'medium', label: 'Balanced', description: undefined },
        { value: 'high', label: 'High', description: 'Most careful' },
      ],
    });
  });

  it('revalidates both catalogs without probing engines on refreshAgentDetection', async () => {
    vi.mocked(useSWR).mockReturnValue({ data: [], error: null } as ReturnType<typeof useSWR>);

    const { result } = renderHook(() => useDetectedAgents());

    await act(async () => {
      await result.current.refreshAgentDetection();
    });

    expect(mutate).toHaveBeenNthCalledWith(1, ASSISTANT_AGENT_CATALOG_SWR_KEY);
    expect(mutate).toHaveBeenNthCalledWith(2, DETECTED_AGENTS_SWR_KEY);
  });

  it('ignores error during refreshAgentDetection', async () => {
    vi.mocked(useSWR).mockReturnValue({ data: [], error: null } as ReturnType<typeof useSWR>);
    vi.mocked(mutate).mockRejectedValueOnce(new Error('Refresh failed'));

    const { result } = renderHook(() => useDetectedAgents());

    await act(async () => {
      await result.current.refreshAgentDetection();
    });

    // Should not throw or log error (hook ignores it)
    expect(mutate).toHaveBeenCalled();
  });
});
