import { describe, expect, it, vi } from 'vitest';
import type { Assistant } from '@/common/types/agent/assistantTypes';

const mutateAssistantList = vi.hoisted(() => vi.fn());

vi.mock('swr', () => ({ mutate: mutateAssistantList }));

import { persistAssistantAgentBinding } from '@/renderer/pages/guid/utils/assistantAgentBinding';

describe('persistAssistantAgentBinding', () => {
  const previousAssistants = [
    {
      id: 'assistant-1',
      agent_id: 'agent-claude-row',
      preset_agent_type: 'claude',
    } as Assistant,
  ];

  it('restores the captured assistant list when persistence rejects', async () => {
    mutateAssistantList.mockReset();
    let cachedAssistants = previousAssistants;
    mutateAssistantList.mockImplementation(async (_key, value) => {
      if (typeof value === 'function') {
        cachedAssistants = value(cachedAssistants);
      }
      return cachedAssistants;
    });
    const updateBinding = vi.fn().mockRejectedValue(new Error('backend rejected'));
    const refreshAgents = vi.fn();

    await expect(
      persistAssistantAgentBinding({
        assistantId: 'assistant-1',
        nextAgentId: 'agent-codex-row',
        nextRuntimeKey: 'codex',
        updateBinding,
        refreshAgents,
      })
    ).rejects.toThrow('backend rejected');

    expect(mutateAssistantList).toHaveBeenCalledTimes(3);
    expect(mutateAssistantList).toHaveBeenLastCalledWith('assistants.list');
    expect(cachedAssistants).toEqual(previousAssistants);
    expect(refreshAgents).not.toHaveBeenCalled();
  });

  it('does not roll back a newer overlapping binding switch', async () => {
    mutateAssistantList.mockReset();
    const newerAssistants = [{ ...previousAssistants[0], agent_id: 'agent-gemini-row', preset_agent_type: 'gemini' }];
    let cachedAssistants = previousAssistants;
    let mutationCount = 0;
    mutateAssistantList.mockImplementation(async (_key, value) => {
      mutationCount += 1;
      if (mutationCount === 2) {
        cachedAssistants = newerAssistants;
      }
      if (typeof value === 'function') {
        cachedAssistants = value(cachedAssistants);
      }
      return cachedAssistants;
    });

    await expect(
      persistAssistantAgentBinding({
        assistantId: 'assistant-1',
        nextAgentId: 'agent-codex-row',
        nextRuntimeKey: 'codex',
        updateBinding: vi.fn().mockRejectedValue(new Error('first switch rejected')),
        refreshAgents: vi.fn(),
      })
    ).rejects.toThrow('first switch rejected');

    expect(cachedAssistants).toEqual(newerAssistants);
  });

  it('does not reject a committed update when best-effort refreshes fail', async () => {
    mutateAssistantList.mockReset();
    mutateAssistantList
      .mockImplementationOnce(async (_key, value) => (typeof value === 'function' ? value(previousAssistants) : value))
      .mockRejectedValueOnce(new Error('list refresh failed'));
    const updateBinding = vi.fn().mockResolvedValue(undefined);
    const refreshAgents = vi.fn().mockRejectedValue(new Error('agent refresh failed'));

    await expect(
      persistAssistantAgentBinding({
        assistantId: 'assistant-1',
        nextAgentId: 'agent-codex-row',
        nextRuntimeKey: 'codex',
        updateBinding,
        refreshAgents,
      })
    ).resolves.toBeUndefined();

    expect(updateBinding).toHaveBeenCalledWith({ id: 'assistant-1', agent_id: 'agent-codex-row' });
    expect(mutateAssistantList).toHaveBeenCalledWith('assistants');
    expect(refreshAgents).toHaveBeenCalled();
  });
});
