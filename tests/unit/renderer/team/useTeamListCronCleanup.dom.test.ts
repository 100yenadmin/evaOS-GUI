import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import type { TTeam } from '@/common/types/team/teamTypes';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { useTeamList } from '@/renderer/pages/team/hooks/useTeamList';

const mutateTeamsMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    cron: {
      removeJob: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
    team: {
      list: { invoke: vi.fn() },
      remove: { invoke: vi.fn().mockResolvedValue(undefined) },
      listChanged: { on: vi.fn(() => vi.fn()) },
      created: { on: vi.fn(() => vi.fn()) },
      removed: { on: vi.fn(() => vi.fn()) },
      renamed: { on: vi.fn(() => vi.fn()) },
    },
  },
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: [team()], mutate: mutateTeamsMock }),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn(),
}));

describe('useTeamList cron cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateTeamsMock.mockResolvedValue(undefined);
    vi.mocked(getConversationOrNull).mockImplementation(async (conversationId: string) => {
      if (conversationId === 'leader-conv') return conversation({ id: conversationId, extra: { cronJobId: 'cron-1' } });
      if (conversationId === 'member-conv')
        return conversation({ id: conversationId, extra: { cron_job_id: 'cron-2' } });
      return null;
    });
    localStorage.clear();
  });

  it('deletes linked cron jobs before removing a team', async () => {
    const { result } = renderHook(() => useTeamList());

    await act(async () => {
      await result.current.removeTeam('team-1');
    });

    expect(ipcBridge.cron.removeJob.invoke).toHaveBeenCalledWith({ job_id: 'cron-1' });
    expect(ipcBridge.cron.removeJob.invoke).toHaveBeenCalledWith({ job_id: 'cron-2' });
    expect(ipcBridge.team.remove.invoke).toHaveBeenCalledWith({ id: 'team-1' });
    expect(localStorage.getItem('team-active-slot-team-1')).toBeNull();
  });
});

function conversation(overrides?: Partial<TChatConversation>): TChatConversation {
  return {
    id: 'conv-1',
    type: 'acp',
    name: 'Conversation',
    created_at: 1,
    updated_at: 1,
    extra: {},
    ...overrides,
  } as TChatConversation;
}

function team(): TTeam {
  return {
    id: 'team-1',
    user_id: 'user-1',
    name: 'Cron Team',
    workspace: '/tmp/team',
    workspace_mode: 'shared',
    leader_agent_id: 'leader-slot',
    created_at: 1,
    updated_at: 1,
    agents: [
      {
        slot_id: 'leader-slot',
        conversation_id: 'leader-conv',
        role: 'leader',
        agent_type: 'codex',
        conversation_type: 'acp',
        agent_name: 'Leader',
        status: 'idle',
      },
      {
        slot_id: 'member-slot',
        conversation_id: 'member-conv',
        role: 'teammate',
        agent_type: 'codex',
        conversation_type: 'acp',
        agent_name: 'Member',
        status: 'idle',
      },
    ],
  };
}
