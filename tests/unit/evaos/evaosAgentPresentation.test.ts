import { describe, expect, it } from 'vitest';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import {
  getEvaosAgentDisplayName,
  sortEvaosDetectedAgentsForPresentation,
} from '@/renderer/evaos/evaosAgentPresentation';

function agent(agent_type: AgentMetadata['agent_type'], name: string, backend?: string): AgentMetadata {
  return {
    id: `${backend ?? agent_type}-${name}`,
    name,
    backend,
    agent_type,
    agent_source: 'builtin',
    enabled: true,
    available: true,
  };
}

describe('evaOS agent presentation', () => {
  it('keeps internal backend keys stable while presenting evaOS names', () => {
    expect(getEvaosAgentDisplayName(agent('openclaw-gateway', 'OpenClaw', 'openclaw-gateway'))).toBe('evaOS');
    expect(getEvaosAgentDisplayName(agent('aionrs', 'Aion CLI', 'aionrs'))).toBe('Custom');
    expect(getEvaosAgentDisplayName(agent('acp', 'Hermes', 'hermes'))).toBe('Hermes');
  });

  it('orders evaOS first, Hermes second, detected third-party agents next, and Custom last', () => {
    const ordered = sortEvaosDetectedAgentsForPresentation([
      agent('aionrs', 'Aion CLI', 'aionrs'),
      agent('acp', 'Codex CLI', 'codex'),
      agent('acp', 'Hermes', 'hermes'),
      agent('openclaw-gateway', 'OpenClaw', 'openclaw-gateway'),
      agent('acp', 'Claude Code', 'claude'),
    ]);

    expect(ordered.map((candidate) => candidate.backend ?? candidate.agent_type)).toEqual([
      'openclaw-gateway',
      'hermes',
      'codex',
      'claude',
      'aionrs',
    ]);
  });
});
