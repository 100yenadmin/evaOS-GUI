import type { TChatConversation } from '@/common/config/storage';
import type { TTeam } from '@/common/types/team/teamTypes';
import { resolveCronJobId } from '@/renderer/pages/cron/cronUtils';

type RemoveAgentParams = {
  team_id: string;
  slot_id: string;
};

type RemoveTeamAssistantWithCronCleanupParams = {
  team: TTeam;
  slot_id: string;
  getConversation: (conversation_id: string) => Promise<TChatConversation | null>;
  removeCronJob: (job_id: string) => Promise<unknown>;
  removeAgent: (params: RemoveAgentParams) => Promise<unknown>;
};

type RemoveTeamWithCronCleanupParams = {
  team: TTeam;
  getConversation: (conversation_id: string) => Promise<TChatConversation | null>;
  removeCronJob: (job_id: string) => Promise<unknown>;
  removeTeam: (params: { id: string }) => Promise<unknown>;
};

export async function removeTeamAssistantWithCronCleanup({
  team,
  slot_id,
  getConversation,
  removeCronJob,
  removeAgent,
}: RemoveTeamAssistantWithCronCleanupParams): Promise<void> {
  const agent = team.agents.find((item) => item.slot_id === slot_id);
  if (agent?.conversation_id) {
    const conversation = await getConversation(agent.conversation_id);
    const cronJobId = resolveCronJobId(conversation?.extra);
    if (cronJobId) {
      await removeCronJob(cronJobId);
    }
  }

  await removeAgent({ team_id: team.id, slot_id });
}

export async function removeTeamWithCronCleanup({
  team,
  getConversation,
  removeCronJob,
  removeTeam,
}: RemoveTeamWithCronCleanupParams): Promise<void> {
  const cronJobIds = new Set<string>();
  const conversations = await Promise.all(
    team.agents.map((agent) => (agent.conversation_id ? getConversation(agent.conversation_id) : Promise.resolve(null)))
  );
  for (const conversation of conversations) {
    const cronJobId = resolveCronJobId(conversation?.extra);
    if (cronJobId) cronJobIds.add(cronJobId);
  }

  await Promise.all([...cronJobIds].map((job_id) => removeCronJob(job_id)));

  await removeTeam({ id: team.id });
}
