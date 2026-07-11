import type { TeamAgentOption } from '../agentSelectUtils';

export type TeamMemberDraft = {
  selectionId: string;
  agent: TeamAgentOption;
};

export function removeTeamMemberDraft(
  members: TeamMemberDraft[],
  leaderSelectionId: string | undefined,
  selectionId: string
): { members: TeamMemberDraft[]; leaderSelectionId: string | undefined } {
  const nextMembers = members.filter((member) => member.selectionId !== selectionId);
  return {
    members: nextMembers,
    leaderSelectionId: leaderSelectionId === selectionId ? nextMembers[0]?.selectionId : leaderSelectionId,
  };
}

/** AionCore v0.1.43 assigns leadership by array position, so the chosen leader must be first. */
export function orderTeamMemberDraftsLeaderFirst(
  members: TeamMemberDraft[],
  leaderSelectionId: string | undefined
): TeamMemberDraft[] {
  if (!leaderSelectionId) return [];
  const leader = members.find((member) => member.selectionId === leaderSelectionId);
  if (!leader) return [];
  return [leader, ...members.filter((member) => member.selectionId !== leaderSelectionId)];
}
