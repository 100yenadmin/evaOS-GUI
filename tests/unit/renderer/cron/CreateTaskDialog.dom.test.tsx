/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import userEvent from '@testing-library/user-event';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { ICronJob } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: [] }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    cron: {
      addJob: { invoke: vi.fn() },
      updateJob: { invoke: vi.fn() },
    },
    conversation: {
      get: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@renderer/components/base/ModalWrapper', () => ({
  __esModule: true,
  default: ({ visible, children, onOk }: { visible: boolean; children: React.ReactNode; onOk?: () => void }) =>
    visible ? (
      <div>
        {children}
        <button type='button' data-testid='modal-ok' onClick={onOk}>
          OK
        </button>
      </div>
    ) : null,
}));

vi.mock('@renderer/pages/conversation/hooks/useConversationAgents', () => ({
  useConversationAgents: () => ({
    cliAgents: [
      {
        agent_type: 'acp',
        backend: 'codex',
        name: 'Codex',
      },
    ],
    presetAssistants: assistants(),
  }),
}));

vi.mock('@renderer/hooks/agent/useModelProviderList', () => ({
  useModelProviderList: () => ({
    providers: [],
    getAvailableModels: () => [],
    formatModelLabel: (label: string) => label,
  }),
}));

vi.mock('@renderer/pages/guid/components/GuidModelSelector', () => ({
  __esModule: true,
  default: () => <div data-testid='guid-model-selector' />,
}));

vi.mock('@renderer/components/workspace', () => ({
  WorkspaceFolderSelect: () => <div data-testid='workspace-folder-select' />,
}));

vi.mock('@renderer/pages/cron/cronUtils', async () => {
  const actual = await vi.importActual<typeof import('@/renderer/pages/cron/cronUtils')>(
    '@/renderer/pages/cron/cronUtils'
  );
  return {
    ...actual,
    createCronSchedule: () => ({
      kind: 'cron',
      expr: '0 10 * * *',
      timezone: 'Asia/Bangkok',
      description: 'daily',
    }),
  };
});

vi.mock('@renderer/pages/conversation/utils/conversationCreateError', () => ({
  getConversationCreateErrorMessage: () => 'error',
}));

vi.mock('@renderer/utils/model/assistantAvatar', () => ({
  resolveAssistantAvatar: () => ({ kind: 'emoji', value: 'bot' }),
}));

vi.mock('@renderer/utils/model/agentLogo', () => ({
  resolveAgentLogo: () => null,
}));

vi.mock('@renderer/pages/cron/ScheduledTasksPage/resolveCronAgentConfig', () => ({
  resolveCronAgentConfig: vi.fn(() => ({
    agent_config: {
      assistant_id: 'assistant-1',
      backend: 'codex',
      name: 'Reporter',
      is_preset: true,
    },
    resolvedAgentType: 'acp',
  })),
}));

import { ipcBridge } from '@/common';
import CreateTaskDialog from '@/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog';
import { resolveCronAgentConfig } from '@/renderer/pages/cron/ScheduledTasksPage/resolveCronAgentConfig';

let resolvePendingConversation: ((value: TChatConversation) => void) | null = null;

describe('CreateTaskDialog cron ownership locks', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resolvePendingConversation = null;
    vi.mocked(ipcBridge.cron.addJob.invoke).mockResolvedValue(job());
    vi.mocked(ipcBridge.cron.updateJob.invoke).mockResolvedValue(job());
    vi.mocked(ipcBridge.conversation.get.invoke).mockResolvedValue(standaloneConversation());
  });

  it('does not send agent config when updating an ongoing conversation task', async () => {
    const user = userEvent.setup();

    render(<CreateTaskDialog visible onClose={() => {}} editJob={ongoingConversationJob()} />);

    expect(await screen.findByDisplayValue('original prompt')).toBeInTheDocument();
    expect(screen.getByTestId('cron-agent-select')).toHaveClass('arco-select-disabled');

    await user.click(screen.getByTestId('modal-ok'));

    await waitFor(() => expect(ipcBridge.cron.updateJob.invoke).toHaveBeenCalledTimes(1));
    expect(resolveCronAgentConfig).not.toHaveBeenCalled();
    const [{ updates }] = vi.mocked(ipcBridge.cron.updateJob.invoke).mock.calls[0];
    expect(updates.metadata).not.toHaveProperty('agent_config');
  });

  it('locks execution mode while resolving team ownership', async () => {
    vi.mocked(ipcBridge.conversation.get.invoke).mockReturnValue(
      new Promise((resolve) => {
        resolvePendingConversation = resolve;
      })
    );

    render(<CreateTaskDialog visible onClose={() => {}} editJob={teamOwnedJob()} />);

    await waitFor(() =>
      expect(ipcBridge.conversation.get.invoke).toHaveBeenCalledWith({
        id: 'team-conv-1',
      })
    );

    expect(executionModeInputs()).toHaveLength(2);
    expect(executionModeInputs().every((input) => input.disabled)).toBe(true);

    await act(async () => {
      resolvePendingConversation?.(standaloneConversation());
    });
  });

  it('locks execution mode and agent config when editing a team-owned task', async () => {
    const user = userEvent.setup();
    vi.mocked(ipcBridge.conversation.get.invoke).mockResolvedValue(teamConversation());

    render(<CreateTaskDialog visible onClose={() => {}} editJob={teamOwnedJob()} />);

    await waitFor(() =>
      expect(ipcBridge.conversation.get.invoke).toHaveBeenCalledWith({
        id: 'team-conv-1',
      })
    );

    expect(screen.getByTestId('cron-agent-select')).toHaveClass('arco-select-disabled');
    expect(executionModeInputs()).toHaveLength(2);
    expect(executionModeInputs().every((input) => input.disabled)).toBe(true);
    await waitFor(() => expect(screen.getAllByText('cron.page.form.executionModeEditHint')).toHaveLength(2));

    await user.click(await screen.findByText('cron.page.form.newConversation'));
    await user.click(screen.getByTestId('modal-ok'));

    await waitFor(() => expect(ipcBridge.cron.updateJob.invoke).toHaveBeenCalledTimes(1));
    expect(resolveCronAgentConfig).not.toHaveBeenCalled();
    const [{ updates }] = vi.mocked(ipcBridge.cron.updateJob.invoke).mock.calls[0];
    expect(updates.target?.execution_mode).toBe('existing');
    expect(updates.metadata).not.toHaveProperty('agent_config');
  });
});

function job(): ICronJob {
  return {
    id: 'job-1',
    name: 'Daily report',
    description: 'Summarize the day',
    enabled: true,
    schedule: {
      kind: 'cron',
      expr: '0 10 * * *',
      timezone: 'Asia/Bangkok',
      description: 'daily',
    },
    metadata: {
      created_at_ms: 1,
      updated_at_ms: 1,
      next_run_at_ms: 1,
      status: 'active',
      agent_type: 'acp',
      agent_config: {
        assistant_id: 'assistant-1',
        backend: 'codex',
        name: 'Reporter',
        preset_agent_type: 'codex',
        is_preset: true,
      },
    },
    target: {
      execution_mode: 'new_conversation',
      payload: {
        kind: 'message',
        text: 'original prompt',
      },
    },
    state: {
      next_run_at_ms: 1,
      run_count: 0,
      retry_count: 0,
      max_retries: 0,
    },
  } as ICronJob;
}

function ongoingConversationJob(): ICronJob {
  return {
    ...job(),
    target: {
      ...job().target,
      execution_mode: 'existing',
    },
  } as ICronJob;
}

function teamOwnedJob(): ICronJob {
  return {
    ...ongoingConversationJob(),
    metadata: {
      ...ongoingConversationJob().metadata,
      conversation_id: 'team-conv-1',
    },
  } as ICronJob;
}

function standaloneConversation(): TChatConversation {
  return {
    id: 'team-conv-1',
    type: 'acp',
    name: 'Standalone conversation',
    created_at: 1,
    updated_at: 1,
    extra: {},
  } as TChatConversation;
}

function teamConversation(): TChatConversation {
  return {
    ...standaloneConversation(),
    name: 'Team member conversation',
    extra: {
      teamId: 'team-1',
    },
  } as TChatConversation;
}

function executionModeInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('.arco-radio input[type="radio"]'));
}

function assistants(): Assistant[] {
  return [
    {
      id: 'assistant-1',
      source: 'user',
      name: 'Reporter',
      name_i18n: {},
      description_i18n: {},
      avatar: 'bot',
      enabled: true,
      sort_order: 0,
      agent_id: 'agent-codex',
      agent: { type: 'acp', source: 'builtin', acp_backend: 'codex' },
      enabled_skills: [],
      custom_skill_names: [],
      disabled_builtin_skills: [],
      context_i18n: {},
      prompts: [],
      prompts_i18n: {},
      models: [],
    } as Assistant,
  ];
}
