import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import type { TTeam } from '@/common/types/team/teamTypes';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { useTeamSession } from '@/renderer/pages/team/hooks/useTeamSession';

const mutateTeamMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    cron: {
      removeJob: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
    team: {
      get: { invoke: vi.fn() },
      removeAgent: { invoke: vi.fn().mockResolvedValue(undefined) },
      agentStatusChanged: { on: vi.fn(() => vi.fn()) },
      agentSpawned: { on: vi.fn(() => vi.fn()) },
      agentRemoved: { on: vi.fn(() => vi.fn()) },
      agentRenamed: { on: vi.fn(() => vi.fn()) },
      mcpStatus: { on: vi.fn(() => vi.fn()) },
      taskChanged: { on: vi.fn(() => vi.fn()) },
      sessionChanged: { on: vi.fn(() => vi.fn()) },
    },
  },
}));

vi.mock('swr', () => ({
  __esModule: true,
  default: () => ({ mutate: mutateTeamMock }),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn(),
}));

describe('useTeamSession cron cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateTeamMock.mockResolvedValue(undefined);
    vi.mocked(getConversationOrNull).mockResolvedValue(
      conversation({ extra: { team_id: 'team-1', cron_job_id: 'cron-member-1' } })
    );
  });

  it('deletes a member cron job before removing the member from the team', async () => {
    const { result } = renderHook(() => useTeamSession(team()));

    await act(async () => {
      await result.current.removeAgent('member-slot');
    });

    expect(getConversationOrNull).toHaveBeenCalledWith('member-conv');
    expect(ipcBridge.cron.removeJob.invoke).toHaveBeenCalledWith({ job_id: 'cron-member-1' });
    expect(ipcBridge.team.removeAgent.invoke).toHaveBeenCalledWith({ team_id: 'team-1', slot_id: 'member-slot' });
  });
});

function conversation(overrides?: Partial<TChatConversation>): TChatConversation {
  return {
    id: 'member-conv',
    type: 'acp',
    name: 'Member',
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
