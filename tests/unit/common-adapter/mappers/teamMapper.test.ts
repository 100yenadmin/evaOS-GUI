/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  fromBackendAgent,
  fromBackendTeam,
  fromBackendTeamList,
  fromBackendTeamOptional,
  normalizeTeamStatus,
  toBackendAgent,
} from '@/common/adapter/mappers/teamMapper';

describe('teamMapper', () => {
  describe('normalizeTeamStatus', () => {
    it.each([
      ['pending', 'pending'],
      ['idle', 'idle'],
      ['working', 'active'],
      ['thinking', 'active'],
      ['tool_use', 'active'],
      ['completed', 'completed'],
      ['error', 'failed'],
      ['unknown', 'idle'],
      [undefined, 'idle'],
    ] as const)('maps backend status %s to UI status %s', (raw, expected) => {
      expect(normalizeTeamStatus(raw)).toBe(expected);
    });
  });

  it('uses normalized status when mapping backend agents', () => {
    const agent = fromBackendAgent({
      slot_id: 'slot-1',
      conversation_id: 'conversation-1',
      role: 'teammate',
      backend: 'claude',
      name: 'Worker',
      status: 'thinking',
    });

    expect(agent.status).toBe('active');
  });

  it('serializes the assistant identity contract required by AionCore v0.1.43', () => {
    expect(
      toBackendAgent({
        role: 'leader',
        status: 'pending',
        agent_type: 'claude',
        agent_name: 'Coordinator',
        conversation_type: 'acp',
        custom_agent_id: 'assistant-claude',
        model: 'claude-model',
      })
    ).toEqual({
      name: 'Coordinator',
      role: 'lead',
      model: 'claude-model',
      assistant_id: 'assistant-claude',
    });
  });

  it('rejects a team member without a canonical assistant identity', () => {
    expect(() =>
      toBackendAgent({
        role: 'teammate',
        status: 'pending',
        agent_type: 'claude',
        agent_name: 'Missing Identity',
        conversation_type: 'acp',
      })
    ).toThrow('assistant_id is required');
  });

  it('maps the assistants response shape returned by AionCore v0.1.43', () => {
    const team = fromBackendTeam({
      id: 'team-1',
      name: 'Compatibility Team',
      leader_assistant_id: 'slot-leader',
      assistants: [
        {
          slot_id: 'slot-leader',
          conversation_id: 'conversation-1',
          role: 'lead',
          assistant_backend: 'claude',
          assistant_name: 'Coordinator',
          assistant_id: 'assistant-claude',
          model: 'claude-model',
          status: 'idle',
        },
      ],
      created_at: 1,
      updated_at: 2,
    });

    expect(team.leader_agent_id).toBe('slot-leader');
    expect(team.agents).toEqual([
      expect.objectContaining({
        slot_id: 'slot-leader',
        role: 'leader',
        agent_type: 'claude',
        agent_name: 'Coordinator',
        custom_agent_id: 'assistant-claude',
      }),
    ]);
  });

  it('keeps the modern agents response aliases compatible', () => {
    const team = fromBackendTeam({
      id: 'team-modern',
      user_id: 'user-1',
      name: 'Modern Team',
      workspace: '/tmp/project',
      workspace_mode: 'isolated',
      leader_agent_id: 'slot-modern',
      agents: [
        {
          slot_id: 'slot-modern',
          conversation_id: 'conversation-modern',
          role: 'leader',
          agent_type: 'aionrs',
          agent_name: 'Modern Coordinator',
          customAgentId: 'assistant-modern',
          status: 'completed',
          pendingConfirmations: 2,
        },
      ],
      session_mode: 'active',
      created_at: 3,
      updated_at: 4,
    });

    expect(team).toMatchObject({
      user_id: 'user-1',
      workspace: '/tmp/project',
      workspace_mode: 'isolated',
      leader_agent_id: 'slot-modern',
      session_mode: 'active',
      agents: [
        {
          conversation_type: 'aionrs',
          custom_agent_id: 'assistant-modern',
          pending_confirmations: 2,
          status: 'completed',
        },
      ],
    });
  });

  it('uses safe defaults for malformed optional team payloads', () => {
    expect(fromBackendTeam(undefined)).toEqual({
      id: '',
      user_id: '',
      name: '',
      workspace: '',
      workspace_mode: 'shared',
      leader_agent_id: '',
      agents: [],
      session_mode: undefined,
      created_at: 0,
      updated_at: 0,
    });
    expect(fromBackendTeamList(undefined)).toEqual([]);
    expect(fromBackendTeamOptional(null)).toBeNull();
    expect(fromBackendTeamOptional({ id: 'team-optional' })?.id).toBe('team-optional');
  });

  it('serializes teammates with the pinned default model fallback', () => {
    expect(
      toBackendAgent({
        role: 'teammate',
        status: 'pending',
        agent_type: 'claude',
        agent_name: 'Worker',
        conversation_type: 'acp',
        custom_agent_id: 'assistant-worker',
      })
    ).toEqual({
      name: 'Worker',
      role: 'teammate',
      model: 'default',
      assistant_id: 'assistant-worker',
    });
  });
});
