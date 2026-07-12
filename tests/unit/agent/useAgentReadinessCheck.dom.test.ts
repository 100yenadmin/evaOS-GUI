import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      checkAgentHealth: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/hooks/agent/useAgents', () => ({
  getAgents: vi.fn(),
}));

import { ipcBridge } from '@/common';
import { getAgents } from '@/renderer/hooks/agent/useAgents';
import { useAgentReadinessCheck } from '@/renderer/hooks/agent/useAgentReadinessCheck';

describe('agent readiness checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the selected backend to its canonical row id before checking health', async () => {
    vi.mocked(getAgents).mockResolvedValue([
      {
        id: 'claude-row',
        name: 'Claude',
        backend: 'claude',
        agent_type: 'acp',
        agent_source: 'builtin',
        enabled: true,
        available: true,
      },
    ]);
    vi.mocked(ipcBridge.acpConversation.checkAgentHealth.invoke).mockResolvedValue({ available: true });
    const { result } = renderHook(() => useAgentReadinessCheck({ backend: 'claude', conversation_type: 'acp' }));

    await act(async () => {
      await result.current.checkCurrentAgent();
    });

    expect(ipcBridge.acpConversation.checkAgentHealth.invoke).toHaveBeenCalledWith({ id: 'claude-row' });
  });

  it('checks alternative agents by canonical row id instead of backend slug', async () => {
    vi.mocked(getAgents).mockResolvedValue([
      {
        id: 'claude-row',
        name: 'Claude',
        backend: 'claude',
        agent_type: 'acp',
        agent_source: 'builtin',
        enabled: true,
        available: false,
      },
      {
        id: 'codex-row',
        name: 'Codex',
        backend: 'codex',
        agent_type: 'acp',
        agent_source: 'builtin',
        enabled: true,
        available: true,
      },
    ]);
    vi.mocked(ipcBridge.acpConversation.checkAgentHealth.invoke).mockResolvedValue({ available: true });
    const { result } = renderHook(() => useAgentReadinessCheck({ backend: 'claude', conversation_type: 'acp' }));

    await act(async () => {
      await result.current.findAlternatives();
    });

    expect(ipcBridge.acpConversation.checkAgentHealth.invoke).toHaveBeenCalledWith({ id: 'codex-row' });
  });
});
