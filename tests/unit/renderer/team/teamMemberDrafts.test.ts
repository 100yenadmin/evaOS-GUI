import { describe, expect, it } from 'vitest';
import type { TeamAgentOption } from '@/renderer/pages/team/components/agentSelectUtils';
import {
  orderTeamMemberDraftsLeaderFirst,
  removeTeamMemberDraft,
  type TeamMemberDraft,
} from '@/renderer/pages/team/components/memberPicker/teamMemberDrafts';

const agent = (id: string): TeamAgentOption => ({ id, name: id, backend: 'claude', team_capable: true });

const members: TeamMemberDraft[] = [
  { selectionId: 'first', agent: agent('first-agent') },
  { selectionId: 'second', agent: agent('second-agent') },
];

describe('team member draft ordering', () => {
  it('returns no payload when the selected leader is missing', () => {
    expect(orderTeamMemberDraftsLeaderFirst(members, undefined)).toEqual([]);
    expect(orderTeamMemberDraftsLeaderFirst(members, 'missing')).toEqual([]);
  });

  it('moves the selected leader ahead of earlier rows', () => {
    expect(orderTeamMemberDraftsLeaderFirst(members, 'second').map((member) => member.selectionId)).toEqual([
      'second',
      'first',
    ]);
  });

  it('keeps the current leader when a teammate is removed', () => {
    expect(removeTeamMemberDraft(members, 'first', 'second')).toEqual({
      members: [members[0]],
      leaderSelectionId: 'first',
    });
  });
});
