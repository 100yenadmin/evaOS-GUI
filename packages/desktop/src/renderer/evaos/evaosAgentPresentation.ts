/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

type EvaosAgentIdentity = {
  agent_type: string;
  agent_source?: string;
  backend?: string;
  name: string;
};

const EVAOS_AGENT_DISPLAY_NAMES = new Map<string, string>([
  ['openclaw-gateway', 'evaOS'],
  ['openclaw', 'evaOS'],
  ['hermes', 'Hermes'],
  ['aionrs', 'Custom'],
]);

function evaosAgentPresentationKey(agent: EvaosAgentIdentity): string {
  return (agent.backend || agent.agent_type || '').trim().toLowerCase();
}

export function isEvaosCustomAgentPresentation(agent: EvaosAgentIdentity): boolean {
  return evaosAgentPresentationKey(agent) === 'aionrs' && agent.agent_source !== 'custom';
}

function evaosAgentPresentationRank(agent: EvaosAgentIdentity): number {
  const key = evaosAgentPresentationKey(agent);
  if (key === 'openclaw-gateway' || key === 'openclaw') return 0;
  if (key === 'hermes') return 1;
  if (key === 'aionrs' && agent.agent_source !== 'custom') return 1000;
  return 100;
}

export function getEvaosAgentDisplayName(agent: EvaosAgentIdentity): string {
  if (agent.agent_source === 'custom') return agent.name;
  return EVAOS_AGENT_DISPLAY_NAMES.get(evaosAgentPresentationKey(agent)) || agent.name;
}

export function sortEvaosDetectedAgentsForPresentation<T extends EvaosAgentIdentity>(agents: T[]): T[] {
  return agents
    .map((agent, index) => ({ agent, index, rank: evaosAgentPresentationRank(agent) }))
    .toSorted((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      return left.index - right.index;
    })
    .map(({ agent }) => agent);
}
