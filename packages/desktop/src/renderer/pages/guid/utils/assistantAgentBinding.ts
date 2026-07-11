import type { Assistant } from '@/common/types/agent/assistantTypes';
import { mutate as swrMutate } from 'swr';

type PersistAssistantAgentBindingInput = {
  assistantId: string;
  nextAgentId: string;
  nextRuntimeKey: string;
  updateBinding: (input: { id: string; agent_id: string }) => Promise<unknown>;
  refreshAgents: () => Promise<unknown>;
};

const ASSISTANT_LIST_CACHE_KEY = 'assistants.list';
const ASSISTANT_METADATA_CACHE_KEY = 'assistants';

/**
 * Optimistically projects a canonical assistant binding, persists it, and restores captured list state on failure.
 * Post-commit assistant metadata and agent-catalog refreshes are best-effort.
 */
export async function persistAssistantAgentBinding({
  assistantId,
  nextAgentId,
  nextRuntimeKey,
  updateBinding,
  refreshAgents,
}: PersistAssistantAgentBindingInput): Promise<void> {
  let previousAssistants: Assistant[] | undefined;
  await swrMutate(
    ASSISTANT_LIST_CACHE_KEY,
    (previous: Assistant[] | undefined) => {
      previousAssistants = previous;
      return previous?.map((assistant) =>
        assistant.id === assistantId
          ? { ...assistant, agent_id: nextAgentId, preset_agent_type: nextRuntimeKey }
          : assistant
      );
    },
    { revalidate: false }
  );

  try {
    await updateBinding({ id: assistantId, agent_id: nextAgentId });
  } catch (error) {
    const previousAssistant = previousAssistants?.find((assistant) => assistant.id === assistantId);
    await swrMutate(
      ASSISTANT_LIST_CACHE_KEY,
      (current: Assistant[] | undefined) =>
        current?.map((assistant) =>
          assistant.id === assistantId && assistant.agent_id === nextAgentId && previousAssistant
            ? previousAssistant
            : assistant
        ),
      { revalidate: false }
    ).catch((): void => undefined);
    await swrMutate(ASSISTANT_LIST_CACHE_KEY).catch((): void => undefined);
    throw error;
  }

  await Promise.allSettled([
    swrMutate(ASSISTANT_LIST_CACHE_KEY),
    swrMutate(ASSISTANT_METADATA_CACHE_KEY),
    refreshAgents(),
  ]);
}
