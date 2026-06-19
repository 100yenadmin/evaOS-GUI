/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      refreshCustomAgents: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/utils/model/agentTypes', () => ({
  DETECTED_AGENTS_SWR_KEY: 'agents.detected',
  MANAGED_AGENTS_SWR_KEY: 'agents.managed',
  fetchDetectedAgents: vi.fn(),
  fetchManagedAgents: vi.fn(),
}));

vi.mock('swr', () => ({
  default: vi.fn(),
  mutate: vi.fn(),
}));

import { ipcBridge } from '@/common';
import { useManagedAgents } from '@/renderer/hooks/agent/useAgents';
import { fetchManagedAgents } from '@/renderer/utils/model/agentTypes';
import useSWR, { mutate } from 'swr';

describe('useManagedAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSWR).mockReturnValue({ data: [], isLoading: false, error: null, mutate: vi.fn() } as never);
    vi.mocked(mutate).mockResolvedValue(undefined);
    vi.mocked(ipcBridge.acpConversation.refreshCustomAgents.invoke).mockResolvedValue(undefined);
  });

  it('uses the Settings-only managed agents cache key', () => {
    renderHook(() => useManagedAgents());

    expect(useSWR).toHaveBeenCalledWith('agents.managed', fetchManagedAgents);
  });

  it('refreshes managed and detected caches after custom-agent refresh', async () => {
    const { result } = renderHook(() => useManagedAgents());

    await act(async () => {
      await result.current.refreshCustomAgents();
    });

    expect(ipcBridge.acpConversation.refreshCustomAgents.invoke).toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledWith('agents.managed');
    expect(mutate).toHaveBeenCalledWith('agents.detected');
  });
});
