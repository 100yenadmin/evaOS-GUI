/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import { resolveCronAgentConfig } from '@/renderer/pages/cron/ScheduledTasksPage/resolveCronAgentConfig';

describe('resolveCronAgentConfig', () => {
  it('stores provider id for preset aionrs assistants instead of literal aionrs backend', () => {
    const result = resolveCronAgentConfig({
      agentValue: 'preset:assistant-1',
      conversationAgentType: 'acp',
      cliAgents: [],
      presetAssistants: [
        assistant({
          id: 'assistant-1',
          name: 'Financial Model Creator',
          preset_agent_type: 'aionrs',
        }),
      ],
      selectedAionrsProvider: {
        id: 'provider-gemini',
        name: 'Gemini',
      },
      model_id: 'gemini-3.1-pro-preview',
      workspace: '/Users/lume/project',
      getMode: () => 'yolo',
      aionrsModelRequiredMessage: 'provider required',
    });

    expect(result).toEqual({
      resolvedAgentType: 'aionrs',
      agent_config: {
        backend: 'provider-gemini',
        name: 'Financial Model Creator',
        is_preset: true,
        custom_agent_id: 'assistant-1',
        preset_agent_type: 'aionrs',
        mode: 'yolo',
        model_id: 'gemini-3.1-pro-preview',
        workspace: '/Users/lume/project',
      },
    });
  });

  it('keeps preset ACP assistants on the ACP runtime with the vendor slug in agent config', () => {
    const result = resolveCronAgentConfig({
      agentValue: 'preset:assistant-2',
      conversationAgentType: 'acp',
      cliAgents: [],
      presetAssistants: [
        assistant({
          id: 'assistant-2',
          name: 'Codex Assistant',
          preset_agent_type: 'codex',
        }),
      ],
      config_options: { reasoning_effort: 'high' },
      getMode: (backend) => (backend === 'codex' ? 'full-access' : 'yolo'),
      aionrsModelRequiredMessage: 'provider required',
    });

    expect(result).toEqual({
      resolvedAgentType: 'acp',
      agent_config: {
        backend: 'codex',
        name: 'Codex Assistant',
        is_preset: true,
        custom_agent_id: 'assistant-2',
        preset_agent_type: 'codex',
        mode: 'full-access',
        config_options: { reasoning_effort: 'high' },
        model_id: undefined,
        workspace: undefined,
      },
    });
  });

  it('uses ACP runtime for detected ACP CLI agents while preserving backend and config options', () => {
    const result = resolveCronAgentConfig({
      agentValue: 'cli:claude',
      conversationAgentType: 'acp',
      cliAgents: [
        {
          id: 'claude-code',
          name: 'Claude Code',
          backend: 'claude',
          agent_type: 'acp',
          agent_source: 'builtin',
          enabled: true,
          available: true,
        } as AgentMetadata,
      ],
      presetAssistants: [],
      model_id: 'claude-opus-4',
      config_options: { model: 'claude-opus-4' },
      workspace: '/Users/lume/project',
      getMode: (backend) => (backend === 'claude' ? 'bypassPermissions' : undefined),
      aionrsModelRequiredMessage: 'provider required',
    });

    expect(result).toEqual({
      resolvedAgentType: 'acp',
      agent_config: {
        backend: 'claude',
        name: 'Claude Code',
        mode: 'bypassPermissions',
        model_id: 'claude-opus-4',
        config_options: { model: 'claude-opus-4' },
        workspace: '/Users/lume/project',
      },
    });
  });
});

function assistant(overrides: Pick<Assistant, 'id' | 'name' | 'preset_agent_type'>): Assistant {
  return {
    id: overrides.id,
    source: 'user',
    name: overrides.name,
    name_i18n: {},
    description_i18n: {},
    enabled: true,
    sort_order: 0,
    preset_agent_type: overrides.preset_agent_type,
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
  };
}
