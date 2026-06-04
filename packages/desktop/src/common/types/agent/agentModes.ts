/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { CODEX_MODE_NATIVE_DEFAULT, CODEX_MODE_NATIVE_FULL_ACCESS } from '@/common/types/codex/codexModes';

const EVAOS_BETA_SAFE_MODE: Record<string, string> = {
  claude: 'default',
  qwen: 'default',
  opencode: 'plan',
  gemini: 'default',
  aionrs: 'default',
  codex: CODEX_MODE_NATIVE_DEFAULT,
  cursor: 'ask',
  snow: 'default',
};

export const EVAOS_BETA_UNSAFE_AGENT_MODE_VALUES = new Set([
  'yolo',
  'yoloNoSandbox',
  'bypassPermissions',
  CODEX_MODE_NATIVE_FULL_ACCESS,
]);

export function isEvaosBetaUnsafeAgentMode(mode: string | undefined): boolean {
  return !!mode && EVAOS_BETA_UNSAFE_AGENT_MODE_VALUES.has(mode);
}

export function filterEvaosBetaAgentModes<T extends { value: string }>(modes: readonly T[]): T[] {
  return modes.filter((mode) => !isEvaosBetaUnsafeAgentMode(mode.value));
}

export function getEvaosBetaSafeAgentMode(backend: string | undefined): string {
  if (!backend) return 'default';
  return EVAOS_BETA_SAFE_MODE[backend] || 'default';
}

/**
 * Legacy helper for callers that request full-auto defaults.
 * evaOS beta demotes those requests to safe backend defaults.
 */
export function getFullAutoMode(backend: string | undefined): string {
  return getEvaosBetaSafeAgentMode(backend);
}
