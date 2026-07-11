import { describe, expect, it, vi } from 'vitest';

const mutateAssistantList = vi.hoisted(() => vi.fn());

vi.mock('swr', () => ({ mutate: mutateAssistantList }));

import { persistAssistantAgentBinding } from '@/renderer/pages/guid/utils/assistantAgentBinding';

describe('persistAssistantAgentBinding', () => {
  it('revalidates the assistant list when persistence rejects', async () => {
    mutateAssistantList.mockReset();
    mutateAssistantList.mockResolvedValue(undefined);
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
    expect(mutateAssistantList).toHaveBeenLastCalledWith('assistants.list');
    expect(refreshAgents).not.toHaveBeenCalled();
  });
});
