import { buildAssistantEditorBackends } from '@/renderer/hooks/assistant/useDetectedAgents';
import { describe, expect, it } from 'vitest';

const catalog = [
  {
    id: 'agent-claude-row',
    name: 'Claude Code',
    agent_type: 'acp' as const,
    agent_source: 'builtin' as const,
    backend: 'claude',
    enabled: true,
    installed: true,
    sort_order: 0,
    status: 'online' as const,
    available_models: {
      current_model_id: 'sonnet',
      current_model_label: 'Sonnet',
      available_models: [{ id: 'sonnet', label: 'Sonnet' }],
    },
  },
  {
    id: 'agent-aionrs-row',
    name: 'AionRS',
    agent_type: 'aionrs' as const,
    agent_source: 'internal' as const,
    enabled: true,
    installed: true,
    sort_order: 1,
    status: 'unchecked' as const,
  },
  {
    id: 'agent-offline-row',
    name: 'Offline ACP',
    agent_type: 'acp' as const,
    agent_source: 'custom' as const,
    backend: 'offline-acp',
    enabled: true,
    installed: true,
    sort_order: 2,
    status: 'offline' as const,
  },
  {
    id: 'remote-row',
    name: 'Remote',
    agent_type: 'remote' as const,
    agent_source: 'custom' as const,
    enabled: true,
    installed: true,
    sort_order: 3,
    status: 'online' as const,
  },
  {
    id: 'agent-uninstalled-row',
    name: 'Uninstalled ACP',
    agent_type: 'acp' as const,
    agent_source: 'builtin' as const,
    backend: 'uninstalled-acp',
    enabled: true,
    installed: false,
    sort_order: 4,
    status: 'unchecked' as const,
  },
];

describe('buildAssistantEditorBackends', () => {
  it('uses canonical catalog row ids and keeps runtime keys separate', () => {
    expect(buildAssistantEditorBackends(catalog)).toEqual([
      {
        id: 'agent-claude-row',
        name: 'Claude Code',
        runtimeKey: 'claude',
        isExtension: false,
        modelOptions: [{ value: 'sonnet', label: 'Sonnet' }],
      },
      {
        id: 'agent-aionrs-row',
        name: 'AionRS',
        runtimeKey: 'aionrs',
        isExtension: false,
        modelOptions: [],
      },
    ]);
  });

  it('retains the currently bound offline row without exposing other offline rows', () => {
    expect(buildAssistantEditorBackends(catalog, 'agent-offline-row').map((item) => item.id)).toEqual([
      'agent-claude-row',
      'agent-aionrs-row',
      'agent-offline-row',
    ]);
  });

  it('hides uninstalled unchecked rows unless they are the current binding', () => {
    expect(buildAssistantEditorBackends(catalog).map((item) => item.id)).not.toContain('agent-uninstalled-row');
    expect(buildAssistantEditorBackends(catalog, 'agent-uninstalled-row').map((item) => item.id)).toContain(
      'agent-uninstalled-row'
    );
  });
});
