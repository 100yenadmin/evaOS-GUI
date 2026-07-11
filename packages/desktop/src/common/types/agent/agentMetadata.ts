/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Type of an agent. */
export type AgentType = 'acp' | 'remote' | 'aionrs' | 'openclaw-gateway' | 'nanobot';

/** Source tier of an agent row, mirroring backend `agent_source` enum. */
export type AgentSource = 'internal' | 'builtin' | 'extension' | 'custom';
export type AgentManagementStatus = 'online' | 'offline' | 'missing' | 'unchecked';

/** Source-specific bookkeeping (how to probe, how to upgrade). */
export type AgentSourceInfo = {
  binary_name?: string;
  bridge_binary?: string;
  hub_package_id?: string;
  version?: string;
};

/** Environment variable entry passed to a spawned agent process. */
export type AgentEnvEntry = {
  name: string;
  value: string;
  description?: string;
};

/** Adapter-side behaviour switches populated by the backend. */
export type BehaviorPolicy = {
  supports_side_question?: boolean;
};

/** Handshake-derived fields captured from the ACP init/session response. */
export type AgentHandshake = {
  agent_capabilities?: unknown;
  auth_methods?: unknown;
  config_options?: unknown;
  available_modes?: unknown;
  available_models?: unknown;
  available_commands?: unknown;
};

/** Unified agent metadata returned by `/api/agents`. */
export type AgentMetadata = {
  id: string;
  icon?: string;
  name: string;
  name_i18n?: Record<string, string>;
  description?: string;
  description_i18n?: Record<string, string>;
  backend?: string;
  agent_type: AgentType;
  agent_source: AgentSource;
  agent_source_info?: AgentSourceInfo;
  enabled: boolean;
  available: boolean;
  team_capable?: boolean;
  command?: string;
  args?: string[];
  env?: AgentEnvEntry[];
  native_skills_dirs?: string[];
  behavior_policy?: BehaviorPolicy;
  yolo_id?: string;
  handshake?: AgentHandshake;
};

/** Diagnostics-first row returned by AionCore v0.1.43 `/api/agents/management`. */
export type ManagedAgent = Omit<AgentMetadata, 'available' | 'handshake'> & {
  installed: boolean;
  sort_order: number;
  status: AgentManagementStatus;
  config_options?: unknown;
  available_modes?: unknown;
  available_models?: unknown;
};
