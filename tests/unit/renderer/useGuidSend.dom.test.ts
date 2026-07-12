/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_EVAOS_MAC_CONTROL_NAME, type IMcpServer } from '@/common/config/storage';
import { useGuidSend, type GuidSendDeps } from '@/renderer/pages/guid/hooks/useGuidSend';

const createConversationInvokeMock = vi.fn();
const swrMutateMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      create: {
        invoke: (...args: unknown[]) => createConversationInvokeMock(...args),
      },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: vi.fn(),
  },
}));

vi.mock('swr', () => ({
  mutate: (...args: unknown[]) => swrMutateMock(...args),
}));

vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({
  updateWorkspaceTime: vi.fn(),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

const createDeps = (): GuidSendDeps => ({
  input: 'hello',
  setInput: vi.fn(),
  files: [],
  setFiles: vi.fn(),
  dir: '',
  setDir: vi.fn(),
  setLoading: vi.fn(),
  loading: false,
  selectedAgent: 'claude',
  selectedAgentKey: 'preset-claude',
  selectedAgentInfo: {
    id: 'meta-1',
    key: 'preset-claude',
    name: 'Claude',
    agent_type: 'claude',
    backend: 'claude',
    custom_agent_id: 'assistant-1',
    is_preset: true,
    isExtension: false,
  } as never,
  is_presetAgent: true,
  selectedMode: 'bypassPermissions',
  selectedThoughtLevelValue: 'high',
  selectedAcpModel: 'claude-opus',
  currentAcpCachedModelInfo: null,
  current_model: undefined,
  findAgentByKey: vi.fn(),
  getEffectiveAgentType: vi.fn(() => ({
    agent_type: 'claude',
    isAvailable: true,
  })),
  resolveEnabledSkills: vi.fn(() => ['skill-a']),
  resolveDisabledBuiltinSkills: vi.fn(() => ['skill-b']),
  guidDisabledBuiltinSkills: undefined,
  guidEnabledSkills: undefined,
  assistantDefaultSkillIds: undefined,
  assistantDefaultDisabledBuiltinSkillIds: undefined,
  availableMcpServers: [{ id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer],
  selectedMcpServerIds: ['mcp-user'],
  assistantDefaultMcpIds: undefined,
  currentEffectiveAgentInfo: {
    agent_type: 'claude',
    isAvailable: true,
  } as never,
  isGoogleAuth: false,
  setMentionOpen: vi.fn(),
  setMentionQuery: vi.fn(),
  setMentionSelectorOpen: vi.fn(),
  setMentionActiveIndex: vi.fn(),
  navigate: vi.fn(() => Promise.resolve()) as never,
  t: vi.fn((key: string, options?: { defaultValue?: string }) => options?.defaultValue || key) as never,
  localeKey: 'zh-CN',
});

describe('useGuidSend', () => {
  beforeEach(() => {
    createConversationInvokeMock.mockReset();
    createConversationInvokeMock.mockResolvedValue({ id: 'conv-1' });
    swrMutateMock.mockReset();
    swrMutateMock.mockResolvedValue(undefined);
    sessionStorage.clear();
  });

  it('routes the evaOS/OpenClaw pill through the supported ACP backend instead of retired gateway conversations', async () => {
    const deps = createDeps();
    deps.selectedAgent = 'openclaw-gateway';
    deps.selectedAgentKey = 'openclaw-gateway';
    deps.selectedAgentInfo = {
      id: 'openclaw-gateway',
      key: 'openclaw-gateway',
      name: 'OpenClaw',
      agent_type: 'openclaw-gateway',
      backend: 'openclaw-gateway',
      cli_path: '/opt/evaos/openclaw',
      isExtension: false,
    } as never;
    deps.is_presetAgent = false;
    deps.getEffectiveAgentType = vi.fn(() => ({
      agent_type: 'openclaw-gateway',
      isAvailable: true,
    }));

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.type).toBe('acp');
    expect(payload.extra.backend).toBe('openclaw');
    expect(payload.extra.cli_path).toBe('/opt/evaos/openclaw');
    expect(sessionStorage.getItem('openclaw_initial_message_conv-1')).toBeNull();
    expect(sessionStorage.getItem('acp_initial_message_conv-1')).toBe(JSON.stringify({ input: 'hello' }));
  });

  it('auto-attaches built-in Mac-control tools to evaOS/OpenClaw ACP conversations', async () => {
    const deps = createDeps();
    deps.selectedAgent = 'openclaw-gateway';
    deps.selectedAgentKey = 'openclaw-gateway';
    deps.selectedAgentInfo = {
      id: 'openclaw-gateway',
      key: 'openclaw-gateway',
      name: 'evaOS',
      agent_type: 'openclaw-gateway',
      backend: 'openclaw-gateway',
      cli_path: '/opt/evaos/openclaw',
      isExtension: false,
    } as never;
    deps.is_presetAgent = false;
    deps.getEffectiveAgentType = vi.fn(() => ({
      agent_type: 'openclaw-gateway',
      isAvailable: true,
    }));
    deps.availableMcpServers = [
      { id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer,
      { id: 'mac-control-mcp', name: BUILTIN_EVAOS_MAC_CONTROL_NAME, enabled: true, builtin: true } as IMcpServer,
    ];
    deps.selectedMcpServerIds = [];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.extra.selected_mcp_server_ids).toEqual([]);
    expect(payload.extra.selected_session_mcp_servers).toEqual([
      expect.objectContaining({ id: 'mac-control-mcp', name: BUILTIN_EVAOS_MAC_CONTROL_NAME }),
    ]);
  });

  it('does not auto-attach Mac-control tools to unrelated ACP conversations', async () => {
    const deps = createDeps();
    deps.availableMcpServers = [
      { id: 'mac-control-mcp', name: BUILTIN_EVAOS_MAC_CONTROL_NAME, enabled: true, builtin: true } as IMcpServer,
    ];
    deps.selectedMcpServerIds = [];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual([]);
    expect(payload.extra.selected_session_mcp_servers).toEqual([]);
  });

  it('passes selected mode into assistant conversation overrides when creating a preset ACP conversation', async () => {
    const { result } = renderHook(() => useGuidSend(createDeps()));

    await act(async () => {
      await result.current.handleSend();
    });

    expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.permission).toBe('bypassPermissions');
    expect(payload.assistant?.conversation_overrides?.model).toBe('claude-opus');
    expect(payload.assistant?.conversation_overrides?.thought_level).toBe('high');
    expect(swrMutateMock).toHaveBeenCalledWith('guid.assistant.detail.assistant-1.zh-CN');
    expect(swrMutateMock).toHaveBeenCalledWith('assistants.list');
  });

  it('omits thought level when the selected runtime does not advertise a compatible choice', async () => {
    const deps = createDeps();
    deps.selectedThoughtLevelValue = '';

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides).not.toHaveProperty('thought_level');
  });

  it('falls back to assistant default skill and MCP ids for preset conversations before local Guid overrides exist', async () => {
    const deps = createDeps();
    deps.guidEnabledSkills = undefined;
    deps.guidDisabledBuiltinSkills = undefined;
    deps.assistantDefaultSkillIds = ['assistant-skill'];
    deps.assistantDefaultDisabledBuiltinSkillIds = ['builtin-skill'];
    deps.selectedMcpServerIds = undefined;
    deps.assistantDefaultMcpIds = ['mcp-user'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.skill_ids).toEqual(['assistant-skill']);
    expect(payload.assistant?.conversation_overrides?.disabled_builtin_skill_ids).toEqual(['builtin-skill']);
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual(['mcp-user']);
    expect(payload.extra.selected_mcp_server_ids).toEqual(['mcp-user']);
  });

  it('preserves builtin MCP ids in assistant overrides while only sending user MCP ids to runtime selection', async () => {
    const deps = createDeps();
    deps.availableMcpServers = [
      { id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer,
      { id: 'builtin-mcp', name: 'Builtin MCP', enabled: true, builtin: true } as IMcpServer,
    ];
    deps.selectedMcpServerIds = ['mcp-user', 'builtin-mcp'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual(['mcp-user', 'builtin-mcp']);
    expect(payload.extra.selected_mcp_server_ids).toEqual(['mcp-user']);
    expect(payload.extra.selected_session_mcp_servers).toEqual([expect.objectContaining({ id: 'builtin-mcp' })]);
  });

  it('sends selected skills to non-preset ACP runtime extra without assistant overrides', async () => {
    const deps = createDeps();
    deps.selectedAgent = 'claude';
    deps.selectedAgentKey = 'claude';
    deps.selectedAgentInfo = {
      id: 'claude-code',
      key: 'claude',
      name: 'Claude Code',
      agent_type: 'acp',
      backend: 'claude',
      isExtension: false,
    } as never;
    deps.is_presetAgent = false;
    deps.guidEnabledSkills = ['custom-skill'];
    deps.guidDisabledBuiltinSkills = ['builtin-web-search'];
    deps.resolveEnabledSkills = vi.fn(() => ['default-skill']);
    deps.resolveDisabledBuiltinSkills = vi.fn(() => ['default-disabled']);
    deps.getEffectiveAgentType = vi.fn(() => ({
      agent_type: 'acp',
      isAvailable: true,
    }));

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant).toBeUndefined();
    expect(payload.extra.enabled_skills).toEqual(['custom-skill']);
    expect(payload.extra.exclude_builtin_skills).toEqual(['builtin-web-search']);
    expect(payload.extra.preset_enabled_skills).toBeUndefined();
    expect(payload.extra.exclude_auto_inject_skills).toBeUndefined();
  });

  it('does not duplicate preset assistant skills into non-preset runtime extra', async () => {
    const deps = createDeps();
    deps.guidEnabledSkills = ['preset-skill'];
    deps.guidDisabledBuiltinSkills = ['preset-disabled'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.skill_ids).toEqual(['preset-skill']);
    expect(payload.assistant?.conversation_overrides?.disabled_builtin_skill_ids).toEqual(['preset-disabled']);
    expect(payload.extra.enabled_skills).toBeUndefined();
    expect(payload.extra.exclude_builtin_skills).toBeUndefined();
    expect(payload.extra.preset_enabled_skills).toBeUndefined();
    expect(payload.extra.exclude_auto_inject_skills).toBeUndefined();
  });
});
