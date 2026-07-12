import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      getAvailableAgents: { invoke: vi.fn() },
      getManagedAgents: { invoke: vi.fn() },
    },
  },
}));

import { ipcBridge } from '@/common';
import type { ManagedAgent } from '@/common/types/agent/agentMetadata';
import { fetchDetectedAgents, fetchManagedAgents } from '@/renderer/utils/model/agentTypes';

const onlineAgent: ManagedAgent = {
  id: 'claude-row',
  name: 'Claude',
  backend: 'claude',
  agent_type: 'acp',
  agent_source: 'builtin',
  enabled: true,
  installed: true,
  sort_order: 100,
  status: 'online',
  behavior_policy: {
    supports_side_question: true,
    self_identity_sticky: true,
    session_load_via_meta_field: true,
    supports_team: true,
  },
  config_options: [{ id: 'model' }],
  available_modes: { current_mode_id: 'default' },
  available_models: { current_model_id: 'sonnet' },
  available_commands: [{ name: 'review' }],
};

describe('detected agent catalog projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('projects enabled management rows into the legacy runtime metadata contract', async () => {
    vi.mocked(ipcBridge.acpConversation.getAvailableAgents.invoke).mockResolvedValue([
      onlineAgent,
      { ...onlineAgent, id: 'disabled-row', enabled: false },
    ]);

    await expect(fetchDetectedAgents()).resolves.toEqual([
      {
        id: 'claude-row',
        name: 'Claude',
        backend: 'claude',
        agent_type: 'acp',
        agent_source: 'builtin',
        enabled: true,
        available: true,
        sort_order: 100,
        behavior_policy: {
          supports_side_question: true,
          self_identity_sticky: true,
          session_load_via_meta_field: true,
          supports_team: true,
        },
        handshake: {
          config_options: [{ id: 'model' }],
          available_modes: { current_mode_id: 'default' },
          available_models: { current_model_id: 'sonnet' },
          available_commands: [{ name: 'review' }],
        },
      },
    ]);
  });

  it('keeps disabled rows in the settings catalog while projecting availability', async () => {
    vi.mocked(ipcBridge.acpConversation.getManagedAgents.invoke).mockResolvedValue([
      { ...onlineAgent, id: 'disabled-row', enabled: false, installed: false, status: 'missing' },
    ]);

    await expect(fetchManagedAgents()).resolves.toEqual([
      {
        id: 'disabled-row',
        name: 'Claude',
        backend: 'claude',
        agent_type: 'acp',
        agent_source: 'builtin',
        enabled: false,
        available: false,
        sort_order: 100,
        behavior_policy: {
          supports_side_question: true,
          self_identity_sticky: true,
          session_load_via_meta_field: true,
          supports_team: true,
        },
        handshake: {
          config_options: [{ id: 'model' }],
          available_modes: { current_mode_id: 'default' },
          available_models: { current_model_id: 'sonnet' },
          available_commands: [{ name: 'review' }],
        },
      },
    ]);
  });

  it('surfaces detected-catalog transport failures to the shared SWR error state', async () => {
    const failure = new Error('catalog unavailable');
    vi.mocked(ipcBridge.acpConversation.getAvailableAgents.invoke).mockRejectedValue(failure);

    await expect(fetchDetectedAgents()).rejects.toBe(failure);
  });

  it('surfaces settings-catalog transport failures instead of showing an empty catalog', async () => {
    const failure = new Error('catalog unavailable');
    vi.mocked(ipcBridge.acpConversation.getManagedAgents.invoke).mockRejectedValue(failure);

    await expect(fetchManagedAgents()).rejects.toBe(failure);
  });

  it('rejects malformed detected-catalog payloads instead of silently choosing an empty catalog', async () => {
    vi.mocked(ipcBridge.acpConversation.getAvailableAgents.invoke).mockResolvedValue(
      null as unknown as ManagedAgent[]
    );

    await expect(fetchDetectedAgents()).rejects.toThrow('Detected agent catalog response must be an array');
  });

  it('rejects malformed settings-catalog payloads instead of hiding the failure as an empty state', async () => {
    vi.mocked(ipcBridge.acpConversation.getManagedAgents.invoke).mockResolvedValue(
      {} as unknown as ManagedAgent[]
    );

    await expect(fetchManagedAgents()).rejects.toThrow('Managed agent catalog response must be an array');
  });
});
