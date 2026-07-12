import { DEFAULT_CODEX_MODELS } from '@/common/types/codex/codexModels';
import type { AcpModelInfo } from '@/common/types/platform/acpTypes';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';
import {
  ASSISTANT_AGENT_CATALOG_SWR_KEY,
  DETECTED_AGENTS_SWR_KEY,
  fetchAssistantAgentCatalog,
  reprobeEnabledAgents,
} from '@/renderer/utils/model/agentTypes';
import { useCallback, useMemo } from 'react';
import useSWR, { mutate } from 'swr';

export type AvailableBackendModelOption = {
  value: string;
  label: string;
};

export type AvailableBackend = {
  id: string;
  name: string;
  runtimeKey: string;
  isExtension?: boolean;
  modelOptions: AvailableBackendModelOption[];
};

const resolveBackendModelOptions = (agent: ManagedAgent): AvailableBackendModelOption[] => {
  const handshakeModels = agent.available_models as AcpModelInfo | undefined;
  if (
    handshakeModels &&
    Array.isArray(handshakeModels.available_models) &&
    handshakeModels.available_models.length > 0
  ) {
    return handshakeModels.available_models.map((model) => ({
      value: model.id,
      label: model.label || model.id,
    }));
  }

  const backend = agent.backend || agent.agent_type;
  if (backend === 'codex' && DEFAULT_CODEX_MODELS.length > 0) {
    return DEFAULT_CODEX_MODELS.map((model) => ({
      value: model.id,
      label: model.label,
    }));
  }

  return [];
};

const ASSISTANT_EDITOR_AGENT_TYPES = new Set(['acp', 'aionrs']);
export const isAssistantEditorAgentType = (agentType: string): boolean => ASSISTANT_EDITOR_AGENT_TYPES.has(agentType);

/**
 * Builds canonical assistant-editor options from management rows.
 * `currentAgentId` retains its matching row despite type, selectability, or status filters when identity is complete.
 */
export const buildAssistantEditorBackends = (agents: ManagedAgent[], currentAgentId?: string): AvailableBackend[] => {
  const backendMap = new Map<string, AvailableBackend>();

  for (const agent of agents) {
    const agentId = agent.id?.trim() || '';
    const runtimeKey = (agent.backend || agent.agent_type || '').trim();
    const isCurrent = Boolean(currentAgentId && agentId === currentAgentId);
    if (!isAssistantEditorAgentType(agent.agent_type) && !isCurrent) continue;
    const isSelectable =
      agent.enabled !== false && agent.installed && (agent.status === 'online' || agent.status === 'unchecked');
    if (!agentId || !runtimeKey || backendMap.has(agentId) || (!isSelectable && !isCurrent)) continue;

    backendMap.set(agentId, {
      id: agentId,
      name: agent.name,
      runtimeKey,
      isExtension: agent.agent_source === 'extension',
      modelOptions: resolveBackendModelOptions(agent),
    });
  }

  return [...backendMap.values()];
};

/**
 * Provides canonical management-catalog rows for assistant editor bindings.
 *
 * Returns catalog-derived selectable options plus the raw rows. Callers that
 * need to retain a current offline row must rebuild with `currentAgentId`.
 */
export const useDetectedAgents = () => {
  const {
    data: rawAgents = [],
    error: catalogError,
    isLoading: isCatalogLoading,
  } = useSWR<ManagedAgent[]>(ASSISTANT_AGENT_CATALOG_SWR_KEY, fetchAssistantAgentCatalog);

  const availableBackends = useMemo<AvailableBackend[]>(() => buildAssistantEditorBackends(rawAgents), [rawAgents]);

  const refreshAgentDetection = useCallback(async () => {
    try {
      await reprobeEnabledAgents();
      await Promise.all([mutate(ASSISTANT_AGENT_CATALOG_SWR_KEY), mutate(DETECTED_AGENTS_SWR_KEY)]);
    } catch {
      // ignore
    }
  }, []);

  return {
    managedAgents: rawAgents,
    availableBackends,
    catalogError,
    isCatalogLoading,
    refreshAgentDetection,
  };
};
