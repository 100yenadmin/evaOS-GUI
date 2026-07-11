import type {
  Assistant,
  AssistantDetail,
  AssistantEngine,
  CreateAssistantRequest,
  UpdateAssistantRequest,
} from '@/common/types/agent/assistantTypes';

export type ApiAssistant = Omit<Assistant, 'preset_agent_type'>;
export type ApiAssistantDetail = Omit<AssistantDetail, 'engine'> & {
  engine: Omit<AssistantEngine, 'agent_backend'>;
};
export type ApiCreateAssistantRequest = Omit<CreateAssistantRequest, 'preset_agent_type'>;
export type ApiUpdateAssistantRequest = Partial<Omit<ApiCreateAssistantRequest, 'id' | 'name'>> & {
  name?: string;
};

function resolveRuntimeBackend(agent: { type: string; acp_backend?: string } | undefined): string {
  return agent?.acp_backend || agent?.type || '';
}

/** Resolves the runtime key for a canonical catalog row id, or `undefined` when the row is absent. */
export function resolveRuntimeBackendForCanonicalAgentId(
  agents: Array<{ id?: string; backend?: string; agent_type?: string }>,
  agentId: string
): string | undefined {
  const agent = agents.find((candidate) => candidate.id === agentId);
  return agent ? agent.backend || agent.agent_type : undefined;
}

/** Resolves an assistant's canonical catalog row first, then falls back to its legacy runtime key. */
export function resolveAgentRowForAssistant<
  T extends { id?: string; backend?: string; agent_type?: string; is_preset?: boolean },
>(agents: T[], agentId: string, runtimeKey: string): T | undefined {
  return (
    agents.find((agent) => !agent.is_preset && agent.id === agentId) ||
    agents.find((agent) => !agent.is_preset && (agent.backend || agent.agent_type) === runtimeKey)
  );
}

/** Resolves a runtime key to its canonical catalog row id, or `undefined` when no row matches. */
export function resolveCanonicalAgentIdForRuntime(
  agents: Array<{ id?: string; backend?: string; agent_type?: string }>,
  runtimeKey: string
): string | undefined {
  return agents.find((agent) => (agent.backend || agent.agent_type) === runtimeKey)?.id;
}

/** Maps a canonical list response to the renderer compatibility projection. */
export function fromApiAssistant(raw: ApiAssistant): Assistant {
  return {
    ...raw,
    preset_agent_type: resolveRuntimeBackend(raw.agent),
  };
}

/** Maps a canonical detail response and projects its legacy runtime backend field. */
export function fromApiAssistantDetail(raw: ApiAssistantDetail): AssistantDetail {
  return {
    ...raw,
    engine: {
      ...raw.engine,
      agent_backend: resolveRuntimeBackend(raw.engine.agent),
    },
  };
}

/** Maps a create request to the canonical wire shape; legacy aliases must already contain canonical row ids. */
export function toApiCreateAssistantRequest(request: CreateAssistantRequest): ApiCreateAssistantRequest {
  const { preset_agent_type, ...canonical } = request;
  const agentId = canonical.agent_id || preset_agent_type;
  return agentId ? { ...canonical, agent_id: agentId } : canonical;
}

/** Maps an update request to its id-free canonical wire shape. */
export function toApiUpdateAssistantRequest(request: UpdateAssistantRequest): ApiUpdateAssistantRequest {
  const { id: _id, preset_agent_type, ...canonical } = request;
  const agentId = canonical.agent_id || preset_agent_type;
  return agentId ? { ...canonical, agent_id: agentId } : canonical;
}
