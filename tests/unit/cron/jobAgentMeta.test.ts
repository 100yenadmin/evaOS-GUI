/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { ICronJob } from '@/common/adapter/ipcBridge';
import { getJobAgentMeta } from '@/renderer/pages/cron/ScheduledTasksPage/jobAgentMeta';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';

const mockJob = (agentType: string): ICronJob =>
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
});
