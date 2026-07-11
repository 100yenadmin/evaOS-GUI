import { describe, expect, it } from 'vitest';

import {
  assistantToOption,
  cliAgentToOption,
  compactTeamAgentOptions,
  filterTeamSupportedAgents,
  resolveConversationType,
  sortTeamLeaderOptions,
} from '@/renderer/pages/team/components/agentSelectUtils';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';

describe('team agent type policy', () => {
  it('resolves every non-Aion CLI backend as ACP conversation type', () => {
    expect(resolveConversationType('aionrs')).toBe('aionrs');
    expect(resolveConversationType('claude')).toBe('acp');
    expect(resolveConversationType('gemini')).toBe('acp');
    expect(resolveConversationType('openclaw-gateway')).toBe('acp');
    expect(resolveConversationType('nanobot')).toBe('acp');
    expect(resolveConversationType('remote')).toBe('acp');
  });

  it('filters retired top-level runtime agents out of team creation options', () => {
    const options = [
      cliAgentToOption(agent('acp', 'claude')),
      cliAgentToOption(agent('aionrs')),
      cliAgentToOption(agent('openclaw-gateway')),
      cliAgentToOption(agent('nanobot')),
      cliAgentToOption(agent('remote')),
      cliAgentToOption(agent('gemini')),
    ];

    expect(filterTeamSupportedAgents(options).map((option) => option.backend)).toEqual(['claude', 'aionrs']);
  });

  it('presents the built-in AionRS team leader as Custom and ranks it last', () => {
    const options = filterTeamSupportedAgents([
      cliAgentToOption(agent('aionrs', undefined, 'Aion CLI')),
      cliAgentToOption(agent('acp', 'claude', 'Claude Code')),
    ]);

    expect(sortTeamLeaderOptions(options).map((option) => option.name)).toEqual(['Claude Code', 'Custom']);
  });

  it('curates preset assistants before they enter the team leader picker', () => {
    const options = compactTeamAgentOptions([
      assistantToOption(assistant({ id: 'openclaw-setup', name: 'OpenClaw Setup Expert' })),
      assistantToOption(assistant({ id: 'builtin-moltbook', name: 'Moltbook' })),
    ]);

    expect(options.map((option) => option.name)).toEqual(['Gateway Debug Expert']);
    expect(options[0].description).toContain('OpenClaw and Hermes');
  });

  it('uses canonical per-assistant team eligibility instead of a shared runtime slug', () => {
    const allowed = assistantToOption(assistant({ id: 'allowed', team_selectable: true }));
    const blocked = assistantToOption(assistant({ id: 'blocked', team_selectable: false }));

    expect(filterTeamSupportedAgents(compactTeamAgentOptions([allowed, blocked])).map((option) => option.id)).toEqual([
      'allowed',
    ]);
  });
});

function agent(agent_type: string, backend?: string, name = backend ?? agent_type): AgentMetadata {
  return {
    id: backend ?? agent_type,
    name,
    agent_type,
    backend,
    agent_source: 'builtin',
    team_capable: true,
  } as AgentMetadata;
}

function assistant(overrides: Partial<Assistant>): Assistant {
  return {
    id: 'openclaw-setup',
    source: 'builtin',
    name: 'OpenClaw Setup Expert',
    description: 'OpenClaw setup.',
    avatar: '🦞',
    enabled: true,
    preset_agent_type: 'openclaw-gateway',
    enabled_skills: [],
    disabled_builtin_skills: [],
    team_selectable: true,
    ...overrides,
  } as Assistant;
}
