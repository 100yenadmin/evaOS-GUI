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
    mutateAssistantList.mockImplementation(async (_key, value) =>
      typeof value === 'function' ? value(previousAssistants) : value
    );
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

    expect(mutateAssistantList).toHaveBeenCalledTimes(2);
    expect(mutateAssistantList).toHaveBeenLastCalledWith('assistants.list', previousAssistants, { revalidate: false });
    expect(refreshAgents).not.toHaveBeenCalled();
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
    expect(refreshAgents).toHaveBeenCalled();
  });
});
