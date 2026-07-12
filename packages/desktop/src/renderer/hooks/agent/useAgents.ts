/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import {
  DETECTED_AGENTS_SWR_KEY,
  MANAGED_AGENTS_SWR_KEY,
  fetchDetectedAgents,
  fetchManagedAgents,
} from '@/renderer/utils/model/agentTypes';
import useSWR, { mutate } from 'swr';

export type UseAgentsResult = {
  agents: AgentMetadata[];
  isLoading: boolean;
  error: unknown;
  /** Force re-fetch of the management catalog and broadcast to all subscribers. */
  revalidate: () => Promise<AgentMetadata[] | undefined>;
  /** Re-read the v0.1.43 management catalog for explicit refresh actions. */
  refreshCustomAgents: () => Promise<void>;
};

/**
 * Canonical React hook for reading detected agents. All components/hooks that
 * need projected management-catalog data must consume this instead of calling
 * `ipcBridge.acpConversation.getAvailableAgents.invoke()` directly —
 * SWR's cross-component de-dup only works when every subscriber shares the
 * same `DETECTED_AGENTS_SWR_KEY`.
 */
export const useAgents = (): UseAgentsResult => {
  const { data, isLoading, error } = useSWR<AgentMetadata[]>(DETECTED_AGENTS_SWR_KEY, fetchDetectedAgents);

  return {
    agents: data ?? [],
    isLoading,
    error,
    revalidate: () => mutate<AgentMetadata[]>(DETECTED_AGENTS_SWR_KEY),
    refreshCustomAgents: async () => {
      await ipcBridge.acpConversation.refreshCustomAgents.invoke();
      await mutate(DETECTED_AGENTS_SWR_KEY);
    },
  };
};

/**
 * Settings-only agent management hook. It includes disabled custom agents so
 * users can re-enable them, while refreshing the detected cache so chat/team
 * pickers stay in sync after toggles.
 */
export const useManagedAgents = (): UseAgentsResult => {
  const { data, isLoading, error } = useSWR<AgentMetadata[]>(MANAGED_AGENTS_SWR_KEY, fetchManagedAgents);

  const revalidateBoth = async () => {
    const [managed] = await Promise.all([
      mutate<AgentMetadata[]>(MANAGED_AGENTS_SWR_KEY),
      mutate(DETECTED_AGENTS_SWR_KEY),
    ]);
    return managed;
  };

  return {
    agents: data ?? [],
    isLoading,
    error,
    revalidate: revalidateBoth,
    refreshCustomAgents: async () => {
      await ipcBridge.acpConversation.refreshCustomAgents.invoke();
      await revalidateBoth();
    },
  };
};

/**
 * Non-hook entry point — use from plain async functions (e.g. route/action
 * utilities) where `useAgents()` is not allowed. Fetches fresh data and
 * writes the result into the shared SWR cache so every component subscribed
 * via `useAgents()` stays in sync.
 *
 * Note: this call always hits the network. That's fine because the handful
 * of non-React call sites (`createConversationParams`, `teamCreateModelResolver`)
 * only fire on specific user actions, not on every render.
 */
export async function getAgents(): Promise<AgentMetadata[]> {
  const data = await fetchDetectedAgents();
  await mutate(DETECTED_AGENTS_SWR_KEY, data, { revalidate: false });
  return data;
}

/**
 * Non-hook entry point to re-read the v0.1.43 management catalog and
 * revalidate the shared cache. Safe to call from plain async code.
 */
export async function refreshAgents(): Promise<void> {
  await ipcBridge.acpConversation.refreshCustomAgents.invoke();
  await mutate(DETECTED_AGENTS_SWR_KEY);
}
