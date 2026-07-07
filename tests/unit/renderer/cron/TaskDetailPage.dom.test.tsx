import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICronJob } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import TaskDetailPage from '@/renderer/pages/cron/ScheduledTasksPage/TaskDetailPage';

const getJobInvokeMock = vi.fn();
const runNowInvokeMock = vi.fn();
const removeJobInvokeMock = vi.fn();
const getConversationInvokeMock = vi.fn();
const removeConversationInvokeMock = vi.fn();
const updateConversationInvokeMock = vi.fn();
const navigateMock = vi.fn();
const refetchConversationsMock = vi.fn();
const emitterEmitMock = vi.fn();
const { useCronJobConversationsMock } = vi.hoisted(() => ({
  useCronJobConversationsMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      typeof options?.defaultValue === 'string' ? options.defaultValue : key,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  const Modal = Object.assign(actual.Modal, {
    confirm: vi.fn((config: { onOk?: () => unknown }) => {
      void config.onOk?.();
      return { close: vi.fn(), update: vi.fn() };
    }),
  });
  return {
    ...actual,
    Modal,
    Message: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
    },
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    cron: {
      getJob: { invoke: (...args: unknown[]) => getJobInvokeMock(...args) },
      onJobUpdated: { on: () => vi.fn() },
      onJobExecuted: { on: () => vi.fn() },
      updateJob: { invoke: vi.fn() },
      runNow: { invoke: (...args: unknown[]) => runNowInvokeMock(...args) },
      removeJob: { invoke: (...args: unknown[]) => removeJobInvokeMock(...args) },
    },
    conversation: {
      get: { invoke: (...args: unknown[]) => getConversationInvokeMock(...args) },
      remove: { invoke: (...args: unknown[]) => removeConversationInvokeMock(...args) },
      update: { invoke: (...args: unknown[]) => updateConversationInvokeMock(...args) },
      listChanged: { on: () => vi.fn() },
    },
  },
}));

vi.mock('@renderer/pages/conversation/hooks/useConversationAgents', () => ({
  useConversationAgents: () => ({
    cliAgents: [],
    presetAssistants: [],
  }),
}));

vi.mock('@renderer/pages/cron/useCronJobs', () => ({
  useCronJobConversations: (...args: unknown[]) => useCronJobConversationsMock(...args),
}));

vi.mock('@renderer/pages/cron/repairCronJobTimeZone', () => ({
  repairCronJobTimeZone: async (cronJob: ICronJob) => cronJob,
}));

vi.mock('@renderer/pages/conversation/utils/conversationCreateError', () => ({
  getConversationRuntimeWorkspaceErrorMessage: (error: unknown) => String(error),
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: (...args: unknown[]) => emitterEmitMock(...args),
  },
}));

describe('TaskDetailPage scheduled task reliability', () => {
  beforeEach(() => {
    getJobInvokeMock.mockReset();
    getJobInvokeMock.mockResolvedValue(job());
    runNowInvokeMock.mockReset();
    runNowInvokeMock.mockResolvedValue({});
    removeJobInvokeMock.mockReset();
    removeJobInvokeMock.mockResolvedValue(undefined);
    getConversationInvokeMock.mockReset();
    getConversationInvokeMock.mockResolvedValue(null);
    removeConversationInvokeMock.mockReset();
    removeConversationInvokeMock.mockResolvedValue(true);
    updateConversationInvokeMock.mockReset();
    updateConversationInvokeMock.mockResolvedValue(true);
    navigateMock.mockReset();
    refetchConversationsMock.mockReset();
    refetchConversationsMock.mockResolvedValue(undefined);
    emitterEmitMock.mockReset();
    useCronJobConversationsMock.mockReset();
    useCronJobConversationsMock.mockReturnValue({ conversations: [], refetch: refetchConversationsMock });
  });

  it('opens the owning team from execution history when the conversation belongs to a team', async () => {
    useCronJobConversationsMock.mockReturnValue({
      conversations: [
        conversation({
          id: 'conv-team-member',
          name: 'Team member run',
          extra: { team_id: 'team-1' },
        }),
      ],
      refetch: refetchConversationsMock,
    });

    renderTaskDetail();

    await waitFor(() => expect(getJobInvokeMock).toHaveBeenCalledWith({ job_id: 'job-1' }));
    fireEvent.click(await screen.findByText('Team member run'));

    expect(navigateMock).toHaveBeenCalledWith('/team/team-1');
  });

  it('renames run-now conversations with the execution date in new-conversation mode', async () => {
    const localRunAtMs = new Date(2026, 6, 1, 12, 0, 0).getTime();
    runNowInvokeMock.mockResolvedValue({ conversation_id: 'conv-run' });
    getConversationInvokeMock.mockResolvedValue(
      conversation({
        id: 'conv-run',
        name: 'Daily report',
        created_at: localRunAtMs,
        updated_at: localRunAtMs,
        extra: { workspace: '/tmp/project' },
      })
    );

    renderTaskDetail();

    await waitFor(() => expect(getJobInvokeMock).toHaveBeenCalledWith({ job_id: 'job-1' }));
    fireEvent.click(await screen.findByText('cron.detail.runNow'));

    await waitFor(() =>
      expect(updateConversationInvokeMock).toHaveBeenCalledWith({
        id: 'conv-run',
        updates: { name: 'Daily report 01-07-26' },
      })
    );
    expect(navigateMock).toHaveBeenCalledWith('/conversation/conv-run');
  });

  it('batch deletes execution history conversations without deleting the scheduled task', async () => {
    useCronJobConversationsMock.mockReturnValue({
      conversations: [
        conversation({ id: 'conv-run-1', name: 'Run 1' }),
        conversation({ id: 'conv-run-2', name: 'Run 2' }),
      ],
      refetch: refetchConversationsMock,
    });

    renderTaskDetail();

    await waitFor(() => expect(getJobInvokeMock).toHaveBeenCalledWith({ job_id: 'job-1' }));
    fireEvent.click(await screen.findByText('conversation.history.batchManage'));
    fireEvent.click(screen.getByText('conversation.history.selectAll'));
    const batchDeleteButton = screen.getByText('conversation.history.batchDelete').closest('button');
    await waitFor(() => expect(batchDeleteButton).not.toBeDisabled());
    fireEvent.click(batchDeleteButton!);

    await waitFor(() => {
      expect(removeConversationInvokeMock).toHaveBeenCalledWith({ id: 'conv-run-1' });
      expect(removeConversationInvokeMock).toHaveBeenCalledWith({ id: 'conv-run-2' });
    });
    expect(removeJobInvokeMock).not.toHaveBeenCalled();
  });
});

function renderTaskDetail() {
  render(
    <MemoryRouter initialEntries={['/scheduled/job-1']}>
      <Routes>
        <Route path='/scheduled/:job_id' element={<TaskDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function conversation(overrides?: Partial<TChatConversation>): TChatConversation {
  return {
    id: 'conv-1',
    type: 'acp',
    name: 'Cron run',
    created_at: 1,
    updated_at: 1,
    extra: {},
    ...overrides,
  } as TChatConversation;
}

function job(overrides?: Partial<ICronJob>): ICronJob {
  return {
    id: 'job-1',
    name: 'Daily report',
    description: 'Summarize daily progress',
    enabled: true,
    schedule: {
      kind: 'cron',
      expr: '0 9 * * *',
      tz: 'UTC',
      description: 'Daily at 09:00',
    },
    target: {
      payload: { kind: 'message', text: 'Write a report' },
      execution_mode: 'new_conversation',
    },
    metadata: {
      conversation_id: 'conv-source',
      conversation_title: 'Source',
      agent_type: 'codex',
      created_by: 'user',
      created_at: 1,
      updated_at: 1,
    },
    state: {
      next_run_at_ms: Date.UTC(2026, 6, 2, 9, 0, 0),
      last_run_at_ms: Date.UTC(2026, 6, 1, 9, 0, 0),
      last_status: 'ok',
      run_count: 1,
      retry_count: 0,
      max_retries: 3,
    },
    ...overrides,
  };
}
