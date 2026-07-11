import React from 'react';
import { Robot } from '@icon-park/react';
import { getAgentLogo } from '@renderer/utils/model/agentLogo';
import { resolveAssistantAvatar } from '@renderer/utils/model/assistantAvatar';
import type { AgentMetadata } from '@renderer/utils/model/agentTypes';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import {
  getEvaosAgentDisplayName,
  sortEvaosDetectedAgentsForPresentation,
} from '@renderer/evaos/evaosAgentPresentation';
import {
  getEvaosAssistantDisplayDescription,
  getEvaosAssistantDisplayName,
  isEvaosAssistantVisibleInRc,
} from '@renderer/evaos/evaosAssistantPresentation';
import {
  isDeprecatedRuntimeAgentType,
  resolveSupportedConversationType,
} from '@/renderer/utils/model/agentTypeSupportPolicy';

/**
 * Team leader selector entry — unified view over CLI agents and preset
 * assistants. Both sources share the dropdown but have different native
 * shapes; this type is what the dropdown code actually reads.
 */
export type TeamAgentOption = {
  id: string;
  /** Canonical assistant-catalog identity accepted by AionCore Team APIs. */
  assistant_id?: string;
  name: string;
  /** Execution backend (claude, gemini, qwen, …). For assistants this is
   *  `preset_agent_type`; for CLI agents it's `backend`. */
  backend?: string;
  /** Top-level runtime type from detected agents. Preset assistants leave this unset. */
  agent_type?: string;
  /** Source marker from detected agents. Used to distinguish built-in AionRS from user custom agents. */
  agent_source?: string;
  /** Icon / avatar token — an SVG filename, emoji, or key into
   *  `CUSTOM_AVATAR_IMAGE_MAP`. */
  icon?: string;
  /** Short user-facing explanation shown in hover details. */
  description?: string;
  /** Whether this agent supports team mode. Sourced from backend `team_capable` field. */
  team_capable?: boolean;
};

export function cliAgentToOption(agent: AgentMetadata): TeamAgentOption {
  return {
    id: agent.id,
    name: getEvaosAgentDisplayName(agent),
    backend: agent.backend || agent.agent_type,
    agent_type: agent.agent_type,
    agent_source: agent.agent_source,
    icon: agent.icon,
    description: agent.description,
    team_capable: agent.team_capable,
  };
}

export function assistantToOption(assistant: Assistant, localeKey = 'en-US'): TeamAgentOption | undefined {
  if (!isEvaosAssistantVisibleInRc(assistant)) {
    return undefined;
  }
  return {
    id: assistant.id,
    assistant_id: assistant.id,
    name: getEvaosAssistantDisplayName(assistant, localeKey),
    backend: assistant.preset_agent_type,
    icon: assistant.avatar,
    description: getEvaosAssistantDisplayDescription(assistant, localeKey),
    team_capable: assistant.team_selectable,
  };
}

export function compactTeamAgentOptions(options: Array<TeamAgentOption | undefined>): TeamAgentOption[] {
  return options.filter((option): option is TeamAgentOption => Boolean(option));
}

export function sortTeamLeaderOptions(options: TeamAgentOption[]): TeamAgentOption[] {
  const cliOptions = sortEvaosDetectedAgentsForPresentation(
    options
      .filter((option): option is TeamAgentOption & { agent_type: string } => Boolean(option.agent_type))
      .map((option) => Object.assign({}, option, { name: option.name }))
  );
  const cliOrder = new Map(cliOptions.map((option, index) => [agentKey(option), index]));
  return options
    .map((option, index) => ({
      option,
      index,
      rank:
        option.backend === 'aionrs' && option.agent_source !== 'custom'
          ? 10_000
          : cliOrder.has(agentKey(option))
            ? (cliOrder.get(agentKey(option)) ?? 100)
            : 200,
    }))
    .toSorted((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      return left.index - right.index;
    })
    .map(({ option }) => option);
}

export function agentKey(agent: TeamAgentOption): string {
  return agent.id;
}

export function agentFromKey(key: string, allAgents: TeamAgentOption[]): TeamAgentOption | undefined {
  return allAgents.find((a) => agentKey(a) === key);
}

export function resolveTeamAgentType(agent: TeamAgentOption | undefined, fallback: string): string {
  return agent?.backend || fallback;
}

/** Filter agents to only those supported in team mode */
export function filterTeamSupportedAgents(agents: TeamAgentOption[]): TeamAgentOption[] {
  return agents.filter((a) => a.team_capable && !isDeprecatedRuntimeAgentType(a.agent_type));
}

export function resolveConversationType(backend: string): 'acp' | 'aionrs' {
  return resolveSupportedConversationType(backend);
}

export const AgentOptionLabel: React.FC<{ agent: TeamAgentOption }> = ({ agent }) => {
  const logo = getAgentLogo(agent.backend);
  const avatar = resolveAssistantAvatar(agent.icon);
  return (
    <div className='flex items-center gap-8px'>
      {avatar.kind === 'image' ? (
        <img src={avatar.value} alt={agent.name} style={{ width: 16, height: 16, objectFit: 'contain' }} />
      ) : avatar.kind === 'emoji' ? (
        <span style={{ fontSize: 14, lineHeight: '16px' }}>{avatar.value}</span>
      ) : logo ? (
        <img src={logo} alt={agent.name} style={{ width: 16, height: 16, objectFit: 'contain' }} />
      ) : (
        <Robot size='16' />
      )}
      <span>{agent.name}</span>
    </div>
  );
};
