/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import { usePresetAssistantInfo } from '@/renderer/hooks/agent/usePresetAssistantInfo';

const useSWRMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: {
      list: { invoke: vi.fn() },
    },
    extensions: {
      getAcpAdapters: { invoke: vi.fn() },
    },
    remoteAgent: {
      get: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/utils/platform', () => ({
  resolveBackendAssetUrl: (value: string | undefined) => value,
  resolveExtensionAssetUrl: (value: string | undefined) => value,
}));

vi.mock('swr', () => ({
  __esModule: true,
  default: (...args: unknown[]) => useSWRMock(...args),
}));

describe('usePresetAssistantInfo', () => {
  beforeEach(() => {
    useSWRMock.mockReset();
  });

  it('prefers preset assistant avatar over custom runtime metadata when both identities exist', () => {
    useSWRMock.mockImplementation((key: unknown) => {
      if (key === 'assistants') {
        return {
          data: [
            {
              id: 'assistant-social',
              source: 'builtin',
              name: 'Social Job Publisher',
              avatar: 'https://127.0.0.1:56663/api/assistants/social-job-publisher/avatar',
              name_i18n: {},
              description_i18n: {},
              enabled: true,
              sort_order: 0,
              preset_agent_type: 'gemini',
              enabled_skills: [],
              custom_skill_names: [],
              disabled_builtin_skills: [],
              context_i18n: {},
              prompts: [],
              prompts_i18n: {},
              models: [],
            },
          ],
          isLoading: false,
        };
      }
      if (key === 'extensions.acpAdapters') return { data: [], isLoading: false };
      if (key === 'agents.detected') {
        return {
          data: [
            {
              id: 'runtime-social',
              name: 'Generic Runtime',
              icon: '🧩',
              agent_source: 'custom',
            },
          ],
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    });

    const conversation = makeConversation({
      agent_id: 'runtime-social',
      custom_agent_id: 'assistant-social',
      preset_assistant_id: 'assistant-social',
      backend: 'gemini',
    });

    const { result } = renderHook(() => usePresetAssistantInfo(conversation));

    expect(result.current.info).toEqual({
      name: 'Social Job Publisher',
      logo: 'https://127.0.0.1:56663/api/assistants/social-job-publisher/avatar',
      isEmoji: false,
    });
  });

  it('falls back to custom runtime metadata when no assistant identity exists', () => {
    useSWRMock.mockImplementation((key: unknown) => {
      if (key === 'assistants') return { data: [], isLoading: false };
      if (key === 'extensions.acpAdapters') return { data: [], isLoading: false };
      if (key === 'agents.detected') {
        return {
          data: [
            {
              id: 'runtime-social',
              name: 'Generic Runtime',
              icon: '🧩',
              agent_source: 'custom',
            },
          ],
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    });

    const conversation = makeConversation({
      agent_id: 'runtime-social',
      backend: 'gemini',
    });

    const { result } = renderHook(() => usePresetAssistantInfo(conversation));

    expect(result.current.info).toEqual({
      name: 'Generic Runtime',
      logo: '🧩',
      isEmoji: true,
    });
  });

  it('marks catalog assistants with empty avatars as assistant fallback icons', () => {
    useSWRMock.mockImplementation((key: unknown) => {
      if (key === 'assistants') {
        return {
          data: [
            {
              id: 'assistant-empty-avatar',
              source: 'user',
              name: 'Empty Avatar',
              avatar: '',
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
            },
          ],
          isLoading: false,
        };
      }
      if (key === 'extensions.acpAdapters') return { data: [], isLoading: false };
      if (key === 'agents.detected') return { data: [], isLoading: false };
      return { data: undefined, isLoading: false };
    });

    const conversation = makeConversation({
      preset_assistant_id: 'assistant-empty-avatar',
      backend: 'codex',
    });

    const { result } = renderHook(() => usePresetAssistantInfo(conversation));

    expect(result.current.info).toEqual({
      name: 'Empty Avatar',
      logo: '',
      isEmoji: false,
      isFallback: true,
    });
  });
});

function makeConversation(extra: Record<string, unknown>): TChatConversation {
  return {
    id: 'conv-1',
    user_id: 'user-1',
    name: 'Conversation',
    type: 'acp',
    model: {},
    extra,
    status: 'finished',
    source: 'aionui',
    created_at: 1,
    modified_at: 1,
    pinned: false,
  } as TChatConversation;
}
