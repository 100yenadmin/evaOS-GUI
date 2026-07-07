/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICronJob } from '@/common/adapter/ipcBridge';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { getEvaosAgentDisplayName } from '@renderer/evaos/evaosAgentPresentation';
import { getAgentLogo } from '@renderer/utils/model/agentLogo';
import { resolveAssistantAvatar } from '@renderer/utils/model/assistantAvatar';
import type { AgentMetadata } from '@renderer/utils/model/agentTypes';

function normalizeAgentBackend(agent: string | undefined): string | undefined {
  if (!agent) return undefined;
  return agent.replace(/^cli:/, '').replace(/^preset:/, '');
}

/**
 * Resolve the display name and logo for a cron job's agent.
 *
 * ACP jobs store the literal string "acp" in `agent_type`; the real vendor id
 * (claude/gemini/codex/…) and the human-readable label live in `agent_config`.
 * Non-ACP agents (aionrs, remote, nanobot, openclaw-gateway, …) use
 * `agent_type` directly — aionrs in particular reuses `agent_config.backend`
 * for provider_id, so we must not fall back to it there.
 */
export function getJobAgentMeta(
  job: ICronJob,
  cliAgents: AgentMetadata[],
  presetAssistants: Assistant[] = []
): { name?: string; logo?: string | null; emoji?: string; assistantFallback?: boolean } {
  const rawType = normalizeAgentBackend(job.metadata.agent_type);
  if (!rawType) return {};

  const config = job.metadata.agent_config;
  if (config?.is_preset && config.custom_agent_id) {
    const assistant = presetAssistants.find((item) => item.id === config.custom_agent_id);
    const displayName = assistant?.name || config.name || rawType;
    if (!assistant) {
      return { name: displayName, assistantFallback: true };
    }
    const avatar = resolveAssistantAvatar(assistant?.avatar);
    if (avatar.kind === 'image') {
      return { name: displayName, logo: avatar.value };
    }
    if (avatar.kind === 'emoji') {
      return { name: displayName, emoji: avatar.value };
    }

    return { name: displayName, assistantFallback: true };
  }

  if (rawType === 'acp') {
    const backend = config?.backend;
    const detected = backend ? cliAgents.find((a) => (a.backend || a.agent_type) === backend) : undefined;
    const fallbackName = config?.name || backend || rawType;
    return {
      name: getEvaosAgentDisplayName(
        detected || {
          agent_type: backend || rawType,
          backend: backend || rawType,
          name: fallbackName,
        }
      ),
      logo: getAgentLogo(backend),
    };
  }

  const detected = cliAgents.find((a) => (a.backend || a.agent_type) === rawType);
  return {
    name: getEvaosAgentDisplayName(
      detected || {
        agent_type: rawType,
        backend: rawType,
        name: rawType,
      }
    ),
    logo: getAgentLogo(rawType),
  };
}
