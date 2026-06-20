/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { ICronJob } from '@/common/adapter/ipcBridge';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { getJobAgentMeta } from '@/renderer/pages/cron/ScheduledTasksPage/jobAgentMeta';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';

const mockJob = (agentType: string, agentConfig?: ICronJob['metadata']['agent_config']): ICronJob =>
  ({
    id: 'job-1',
    enabled: true,
    schedule: { kind: 'cron', expr: '0 9 * * *', description: 'Daily' },
    action: { command: 'test' },
    state: {},
    metadata: {
      conversation_id: 'conv-1',
      created_at_ms: 1,
      agent_type: agentType,
      agent_config: agentConfig,
    },
  }) as ICronJob;

describe('getJobAgentMeta', () => {
  it('uses evaOS and Hermes before raw backend fallbacks', () => {
    expect(getJobAgentMeta(mockJob('openclaw-gateway'), [])).toMatchObject({ name: 'evaOS' });
    expect(getJobAgentMeta(mockJob('hermes'), [])).toMatchObject({ name: 'Hermes' });
  });

  it('uses detected agent names after evaOS/Hermes known labels', () => {
    const detected = [
      {
        id: 'codex',
        name: 'Codex CLI',
        backend: 'codex',
        agent_type: 'acp',
        agent_source: 'builtin',
        enabled: true,
        available: true,
      },
    ] as AgentMetadata[];

    expect(getJobAgentMeta(mockJob('codex'), detected)).toMatchObject({ name: 'Codex CLI' });
  });

  it('renders raw aionrs fallback as Custom when no detected agent name exists', () => {
    expect(getJobAgentMeta(mockJob('aionrs'), [])).toMatchObject({ name: 'Custom' });
  });

  it('uses preset assistant metadata for scheduled task cards', () => {
    const assistants = [
      assistant({
        id: 'assistant-social',
        name: 'Social Job Publisher',
        avatar: '🧑‍💼',
        preset_agent_type: 'codex',
      }),
    ];

    expect(
      getJobAgentMeta(
        mockJob('acp', {
          backend: 'codex',
          name: 'Codex CLI',
          is_preset: true,
          custom_agent_id: 'assistant-social',
          preset_agent_type: 'codex',
        }),
        [],
        assistants
      )
    ).toEqual({
      name: 'Social Job Publisher',
      emoji: '🧑‍💼',
    });
  });

  it('falls back to preset backend logo when the assistant has no custom avatar', () => {
    const assistants = [
      assistant({
        id: 'assistant-codex',
        name: 'Codex Assistant',
        preset_agent_type: 'codex',
      }),
    ];

    const meta = getJobAgentMeta(
      mockJob('acp', {
        backend: 'codex',
        name: 'Codex CLI',
        is_preset: true,
        custom_agent_id: 'assistant-codex',
        preset_agent_type: 'codex',
      }),
      [],
      assistants
    );

    expect(meta.name).toBe('Codex Assistant');
    expect(meta.logo).toBeTruthy();
  });
});

function assistant(overrides: Partial<Assistant>): Assistant {
  return {
    id: 'assistant-1',
    source: 'builtin',
    name: 'Assistant',
    name_i18n: {},
    description_i18n: {},
    enabled: true,
    sort_order: 0,
    preset_agent_type: 'codex',
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
    ...overrides,
  };
}
