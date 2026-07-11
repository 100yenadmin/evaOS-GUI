import {
  fromApiAssistant,
  fromApiAssistantDetail,
  resolveCanonicalAgentIdForRuntime,
  resolveAgentRowForAssistant,
  resolveRuntimeBackendForCanonicalAgentId,
  toApiCreateAssistantRequest,
  toApiUpdateAssistantRequest,
} from '@/common/adapter/assistantMapper';
import { describe, expect, it } from 'vitest';

const canonicalAgent = {
  type: 'acp' as const,
  source: 'builtin' as const,
  acp_backend: 'claude',
};

describe('assistantMapper', () => {
  it('preserves canonical agent identity and projects the runtime backend for legacy consumers', () => {
    const assistant = fromApiAssistant({
      id: 'cowork',
      source: 'builtin',
      name: 'Cowork',
      name_i18n: {},
      description_i18n: {},
      enabled: true,
      sort_order: 1000,
      agent_id: 'agent-claude-row',
      agent: canonicalAgent,
      enabled_skills: [],
      custom_skill_names: [],
      disabled_builtin_skills: [],
      context_i18n: {},
      prompts: [],
      prompts_i18n: {},
      models: [],
      agent_status: 'online',
      team_selectable: true,
      deletable: false,
    });

    expect(assistant.agent_id).toBe('agent-claude-row');
    expect(assistant.preset_agent_type).toBe('claude');
    expect(assistant.agent).toEqual(canonicalAgent);
  });

  it('uses the canonical agent type when a runtime has no ACP backend slug', () => {
    const assistant = fromApiAssistant({
      id: 'builtin-aionrs',
      source: 'builtin',
      name: 'AionRS',
      name_i18n: {},
      description_i18n: {},
      enabled: true,
      sort_order: 1000,
      agent_id: 'agent-aionrs-row',
      agent: { type: 'aionrs', source: 'internal' },
      enabled_skills: [],
      custom_skill_names: [],
      disabled_builtin_skills: [],
      context_i18n: {},
      prompts: [],
      prompts_i18n: {},
      models: [],
      agent_status: 'unchecked',
      team_selectable: true,
      deletable: false,
    });

    expect(assistant.preset_agent_type).toBe('aionrs');
  });

  it('does not project a missing canonical row id as a runnable backend', () => {
    const assistant = fromApiAssistant({
      id: 'orphaned',
      source: 'user',
      name: 'Orphaned',
      name_i18n: {},
      description_i18n: {},
      enabled: true,
      sort_order: 1000,
      agent_id: 'deleted-agent-row',
      enabled_skills: [],
      custom_skill_names: [],
      disabled_builtin_skills: [],
      context_i18n: {},
      prompts: [],
      prompts_i18n: {},
      models: [],
      agent_status: 'missing',
      team_selectable: false,
      deletable: true,
    });

    expect(assistant.preset_agent_type).toBe('');
  });

  it('maps canonical detail identity while retaining thought-level defaults', () => {
    const detail = fromApiAssistantDetail({
      id: 'cowork',
      source: 'builtin',
      agent_status: 'online',
      team_selectable: true,
      deletable: false,
      profile: { name: 'Cowork', name_i18n: {}, description_i18n: {} },
      state: { enabled: true, sort_order: 1000 },
      engine: { agent_id: 'agent-claude-row', agent: canonicalAgent },
      rules: { content: '', storage_mode: 'builtin' },
      prompts: { recommended: [], recommended_i18n: {} },
      defaults: {
        model: { mode: 'auto' },
        permission: { mode: 'auto' },
        thought_level: { mode: 'fixed', value: 'high' },
        skills: { mode: 'auto', value: [] },
        mcps: { mode: 'auto', value: [] },
      },
      capabilities: {
        default_skill_ids: [],
        custom_skill_names: [],
        default_disabled_builtin_skill_ids: [],
      },
      preferences: {
        last_thought_level_value: 'medium',
        last_skill_ids: [],
        last_disabled_builtin_skill_ids: [],
        last_mcp_ids: [],
      },
    });

    expect(detail.engine.agent_id).toBe('agent-claude-row');
    expect(detail.engine.agent_backend).toBe('claude');
    expect(detail.defaults.thought_level).toEqual({ mode: 'fixed', value: 'high' });
    expect(detail.preferences.last_thought_level_value).toBe('medium');
  });

  it('renames a pre-resolved legacy create alias to agent_id before it crosses the wire', () => {
    const request = toApiCreateAssistantRequest({
      id: 'mine',
      name: 'Mine',
      preset_agent_type: 'agent-claude-row',
    });

    expect(request).toEqual({ id: 'mine', name: 'Mine', agent_id: 'agent-claude-row' });
    expect(request).not.toHaveProperty('preset_agent_type');
  });

  it('strips the path id and sends only canonical update fields', () => {
    const request = toApiUpdateAssistantRequest({
      id: 'cowork',
      preset_agent_type: 'agent-claude-row',
      name: 'Ignored for builtin only when caller chooses it',
    });

    expect(request).toEqual({
      agent_id: 'agent-claude-row',
      name: 'Ignored for builtin only when caller chooses it',
    });
    expect(request).not.toHaveProperty('id');
    expect(request).not.toHaveProperty('preset_agent_type');
  });

  it('resolves a runtime slug to its canonical catalog row id', () => {
    expect(
      resolveCanonicalAgentIdForRuntime(
        [
          { id: 'agent-claude-row', backend: 'claude', agent_type: 'acp' },
          { id: 'agent-aionrs-row', agent_type: 'aionrs' },
        ],
        'claude'
      )
    ).toBe('agent-claude-row');
    expect(resolveCanonicalAgentIdForRuntime([{ id: 'agent-aionrs-row', agent_type: 'aionrs' }], 'aionrs')).toBe(
      'agent-aionrs-row'
    );
    expect(resolveCanonicalAgentIdForRuntime([], 'claude')).toBeUndefined();
  });

  it('resolves runtime identity from the selected canonical row when backends are duplicated', () => {
    const rows = [
      { id: 'builtin-claude', backend: 'claude', agent_type: 'acp' },
      { id: 'custom-claude', backend: 'claude', agent_type: 'acp' },
    ];

    expect(resolveRuntimeBackendForCanonicalAgentId(rows, 'custom-claude')).toBe('claude');
    expect(resolveRuntimeBackendForCanonicalAgentId(rows, 'missing-row')).toBeUndefined();
  });

  it('resolves a displayed agent row by canonical id before runtime fallback', () => {
    const rows = [
      { id: 'builtin-claude', backend: 'claude', agent_type: 'acp', icon: 'builtin.svg' },
      { id: 'custom-claude', backend: 'claude', agent_type: 'acp', icon: 'custom.svg' },
    ];

    expect(resolveAgentRowForAssistant(rows, 'custom-claude', 'claude')?.icon).toBe('custom.svg');
    expect(resolveAgentRowForAssistant(rows, 'missing-row', 'claude')?.icon).toBe('builtin.svg');
  });
});
