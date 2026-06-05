/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IEvaosProviderAgentRuntime,
  IEvaosProviderKey,
  IEvaosProviderStatus,
  IEvaosRuntimeKey,
} from '@/common/evaos/bridgeTypes';

export const VALID_EVAOS_RUNTIME_KEYS: ReadonlySet<IEvaosRuntimeKey> = new Set([
  'openclaw',
  'hermes',
  'paperclip',
  'browser',
  'terminal',
  'opendesign',
  'creative_studio',
  'team_chat',
]);

export const EVAOS_RUNTIME_LABELS: Record<IEvaosRuntimeKey, string> = {
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  paperclip: 'Paperclip',
  browser: 'Business Browser',
  terminal: 'Terminal',
  opendesign: 'Open Design',
  creative_studio: 'Creative Studio',
  team_chat: 'Team Chat',
};

export const VALID_EVAOS_PROVIDER_KEYS: ReadonlySet<IEvaosProviderKey> = new Set([
  'openai_codex',
  'openclaw',
  'hermes',
  'google_workspace',
  'pipedream',
  'slack',
  'notion',
  'linear',
  'github',
]);

export const EVAOS_PIPEDREAM_PROVIDER_KEYS: ReadonlySet<IEvaosProviderKey> = new Set([
  'google_workspace',
  'slack',
  'notion',
  'linear',
  'github',
]);

export const EVAOS_PROVIDER_LABELS: Record<IEvaosProviderKey, string> = {
  openai_codex: 'Codex Desktop',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  google_workspace: 'Google Workspace',
  pipedream: 'Pipedream Connection Service',
  slack: 'Slack',
  notion: 'Notion',
  linear: 'Linear',
  github: 'GitHub',
};

export const VALID_EVAOS_PROVIDER_STATUSES: ReadonlySet<IEvaosProviderStatus> = new Set([
  'connected',
  'needs_login',
  'approval_required',
  'planned',
  'revoked',
  'expired',
  'error',
]);

export const VALID_EVAOS_PROVIDER_AGENT_RUNTIMES: ReadonlySet<IEvaosProviderAgentRuntime> = new Set([
  'openclaw',
  'hermes',
]);
