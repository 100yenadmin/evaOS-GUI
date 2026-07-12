/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { AgentMetadata, ManagedAgent } from '@/common/types/agent/agentMetadata';

export type {
  AgentEnvEntry,
  AgentHandshake,
  AgentManagementStatus,
  AgentMetadata,
  AgentSource,
  AgentSourceInfo,
  AgentType,
  BehaviorPolicy,
  ManagedAgent,
} from '@/common/types/agent/agentMetadata';

/** SWR key for enabled runtime rows projected from `/api/agents/management`. */
export const DETECTED_AGENTS_SWR_KEY = 'agents.detected';

/**
 * SWR key for the Agent settings management view
 * (`/api/agents/management`). Kept separate from
 * DETECTED_AGENTS_SWR_KEY so disabled custom agents can be re-enabled in
 * Settings without leaking into chat/team pickers.
 */
export const MANAGED_AGENTS_SWR_KEY = 'agents.managed';
export const ASSISTANT_AGENT_CATALOG_SWR_KEY = 'agents.assistant-management-catalog';

function projectManagementAgent(agent: ManagedAgent): AgentMetadata {
  const {
    installed,
    status: _status,
    config_options,
    available_modes,
    available_models,
    available_commands,
    ...metadata
  } = agent;
  return {
    ...metadata,
    available: installed && (agent.status === 'online' || agent.status === 'unchecked'),
    handshake: {
      config_options,
      available_modes,
      available_models,
      available_commands,
    },
  };
}

/** Shared fetcher for DETECTED_AGENTS_SWR_KEY — single source of truth. */
export async function fetchDetectedAgents(): Promise<AgentMetadata[]> {
  const agents = await ipcBridge.acpConversation.getAvailableAgents.invoke();
  if (!Array.isArray(agents)) {
    throw new TypeError('Detected agent catalog response must be an array');
  }
  return agents
    .filter((agent) => agent.enabled && agent.installed && (agent.status === 'online' || agent.status === 'unchecked'))
    .map(projectManagementAgent);
}

/**
 * Explicit refresh is a real probe, not another read of the cached management
 * rows. Probe every enabled row (including currently missing rows, which may
 * have been installed since startup), then let callers revalidate their SWR
 * caches. Individual failures remain row-scoped and must not prevent the rest
 * of the catalog from refreshing.
 */
export async function reprobeEnabledAgents(): Promise<void> {
  const agents = await ipcBridge.acpConversation.getManagedAgents.invoke();
  if (!Array.isArray(agents)) {
    throw new TypeError('Managed agent catalog response must be an array');
  }
  await Promise.allSettled(
    agents
      .filter((agent) => agent.enabled)
      .map((agent) => ipcBridge.acpConversation.checkAgentHealth.invoke({ id: agent.id }))
  );
}

/** Fetcher for the Settings-only management view that includes disabled rows. */
export async function fetchManagedAgents(): Promise<AgentMetadata[]> {
  const agents = await ipcBridge.acpConversation.getManagedAgents.invoke();
  if (!Array.isArray(agents)) {
    throw new TypeError('Managed agent catalog response must be an array');
  }
  return agents.map(projectManagementAgent);
}

/** Canonical catalog used by assistant editor bindings. */
export async function fetchAssistantAgentCatalog(): Promise<ManagedAgent[]> {
  const agents = await ipcBridge.acpConversation.getAssistantAgentCatalog.invoke();
  if (!Array.isArray(agents)) {
    throw new TypeError('Assistant agent catalog response must be an array');
  }
  return agents;
}

/**
 * Extract the list of MCP transport types an agent supports.
 *
 * Reads `handshake.agent_capabilities.mcp_capabilities.{stdio,http,sse}`
 * (populated by the ACP init response). Returns `undefined` when the
 * agent has not completed a handshake — callers should treat that as
 * "unknown" rather than "nothing supported".
 */
export function getSupportedMcpTransports(agent: AgentMetadata): string[] | undefined {
  const caps = (agent.handshake?.agent_capabilities as { mcp_capabilities?: unknown } | undefined)?.mcp_capabilities;
  if (!caps || typeof caps !== 'object') {
    return undefined;
  }
  const flags = caps as { stdio?: unknown; http?: unknown; sse?: unknown };
  const transports: string[] = [];
  if (flags.stdio === true) transports.push('stdio');
  if (flags.http === true) transports.push('http');
  if (flags.sse === true) transports.push('sse');
  return transports;
}
