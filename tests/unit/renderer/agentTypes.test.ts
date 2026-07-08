/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      getAvailableAgents: { invoke: vi.fn() },
      getManagedAgents: { invoke: vi.fn() },
    },
  },
}));

import { ipcBridge } from '@/common';
import {
  fetchDetectedAgents,
  fetchManagedAgents,
  managedAgentsToDetectedAgents,
} from '@/renderer/utils/model/agentTypes';

const getAvailableAgents = vi.mocked(ipcBridge.acpConversation.getAvailableAgents.invoke);
const getManagedAgents = vi.mocked(ipcBridge.acpConversation.getManagedAgents.invoke);

function agent(overrides: Partial<AgentMetadata>): AgentMetadata {
  return {
    id: overrides.id ?? 'agent',
    name: overrides.name ?? 'Agent',
    agent_type: overrides.agent_type ?? 'acp',
    agent_source: overrides.agent_source ?? 'builtin',
    enabled: overrides.enabled ?? true,
    available: overrides.available as boolean,
    ...overrides,
  };
}

describe('agentTypes compatibility fetchers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives detected agents from v0.1.43 management rows when legacy /api/agents is unavailable', async () => {
    getAvailableAgents.mockRejectedValue(new Error('404'));
    getManagedAgents.mockResolvedValue([
      agent({ id: 'aion', name: 'Aion CLI', agent_type: 'aionrs', installed: true, status: 'online' }),
      agent({ id: 'openclaw', name: 'OpenClaw', backend: 'openclaw', installed: true, status: 'unchecked' }),
      agent({ id: 'missing', name: 'Missing CLI', backend: 'missing', installed: false, status: 'missing' }),
      agent({
        id: 'disabled',
        name: 'Disabled CLI',
        backend: 'disabled',
        enabled: false,
        installed: true,
        status: 'online',
      }),
    ]);

    const result = await fetchDetectedAgents();

    expect(result.map((row) => row.id)).toEqual(['aion', 'openclaw']);
    expect(result.every((row) => row.available)).toBe(true);
  });

  it('keeps managed rows visible while normalizing legacy available flags', async () => {
    getManagedAgents.mockResolvedValue([
      agent({ id: 'online', installed: true, status: 'online' }),
      agent({ id: 'unchecked', installed: true, status: 'unchecked' }),
      agent({ id: 'missing', installed: false, status: 'missing' }),
    ]);

    const result = await fetchManagedAgents();

    expect(result.map((row) => [row.id, row.available])).toEqual([
      ['online', true],
      ['unchecked', true],
      ['missing', false],
    ]);
  });

  it('does not call management fallback when legacy detected agents succeed', async () => {
    getAvailableAgents.mockResolvedValue([agent({ id: 'legacy', available: true })]);

    await expect(fetchDetectedAgents()).resolves.toEqual([expect.objectContaining({ id: 'legacy', available: true })]);
    expect(getManagedAgents).not.toHaveBeenCalled();
  });

  it('filters management rows to enabled usable detected agents', () => {
    const result = managedAgentsToDetectedAgents([
      agent({ id: 'online', installed: true, status: 'online' }),
      agent({ id: 'offline', installed: true, status: 'offline' }),
      agent({ id: 'disabled', enabled: false, installed: true, status: 'online' }),
    ]);

    expect(result.map((row) => row.id)).toEqual(['online']);
  });
});
