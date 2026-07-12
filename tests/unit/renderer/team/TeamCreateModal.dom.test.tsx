import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTeamInvokeMock = vi.fn();
const resolveDefaultTeamAgentModelMock = vi.fn();
const messageErrorMock = vi.fn();

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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; count?: number }) =>
      options?.defaultValue?.replace('{{count}}', String(options.count ?? '')) || key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@renderer/pages/conversation/hooks/useConversationAgents', () => ({
  useConversationAgents: () => ({
    cliAgents: [
      {
        id: 'claude-agent',
        name: 'Claude Agent',
        backend: 'claude',
        agent_type: 'acp',
        team_capable: true,
        description: 'Coordinates the team',
      },
      {
        id: 'codex-agent',
        name: 'Codex Agent',
        backend: 'codex',
        agent_type: 'acp',
        team_capable: true,
      },
      {
        id: 'blocked-agent',
        name: 'Blocked Agent',
        backend: 'remote',
        agent_type: 'remote',
        team_capable: false,
      },
      {
        id: 'uncatalogued-agent',
        name: 'Uncatalogued Agent',
        backend: 'claude',
        agent_type: 'acp',
        team_capable: true,
      },
      {
        id: 'generated-blocked-agent',
        name: 'Generated Blocked Agent',
        backend: 'claude',
        agent_type: 'acp',
        team_capable: true,
      },
    ],
    presetAssistants: [
      {
        id: 'bare:claude-agent',
        source: 'generated',
        name: 'Claude Agent',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 0,
        preset_agent_type: 'claude',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
        team_selectable: true,
      },
      {
        id: 'bare:codex-agent',
        source: 'generated',
        name: 'Codex Agent',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 1,
        preset_agent_type: 'codex',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
        team_selectable: true,
      },
      {
        id: 'bare:generated-blocked-agent',
        source: 'generated',
        name: 'Generated Blocked Agent',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 2,
        preset_agent_type: 'claude',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
        team_selectable: false,
      },
    ],
  }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      ...actual.Message,
      error: (...args: unknown[]) => messageErrorMock(...args),
    },
  };
});

vi.mock('@renderer/components/base/AionModal', () => ({
  default: ({ visible, header, footer, children, style }: Record<string, unknown>) => {
    if (!visible) return null;
    const headerConfig = header as { render?: () => React.ReactNode } | undefined;
    return (
      <div
        data-testid='team-create-modal'
        data-width={(style as React.CSSProperties | undefined)?.width}
        data-max-width={(style as React.CSSProperties | undefined)?.maxWidth}
      >
        {headerConfig?.render?.()}
        {children as React.ReactNode}
        {footer as React.ReactNode}
      </div>
    );
  },
}));

vi.mock('@renderer/components/workspace', () => ({
  WorkspaceFolderSelect: () => <div data-testid='workspace-folder-select' />,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      create: { invoke: (...args: unknown[]) => createTeamInvokeMock(...args) },
    },
  },
}));

vi.mock('@/renderer/pages/team/components/teamCreateModelResolver', () => ({
  resolveDefaultTeamAgentModel: (...args: unknown[]) => resolveDefaultTeamAgentModelMock(...args),
}));

import TeamCreateModal from '@/renderer/pages/team/components/TeamCreateModal';
import { LayoutContext } from '@/renderer/hooks/context/LayoutContext';

const renderMobile = () =>
  render(
    <LayoutContext.Provider value={{ isMobile: true, siderCollapsed: false, setSiderCollapsed: () => {} }}>
      <TeamCreateModal visible onClose={vi.fn()} onCreated={vi.fn()} />
    </LayoutContext.Provider>
  );

describe('TeamCreateModal multi-member creation', () => {
  beforeEach(() => {
    createTeamInvokeMock.mockReset();
    createTeamInvokeMock.mockResolvedValue({ id: 'team-1', agents: [] });
    resolveDefaultTeamAgentModelMock.mockReset();
    resolveDefaultTeamAgentModelMock.mockImplementation(({ agent_type }: { agent_type: string }) =>
      Promise.resolve(`${agent_type}-model`)
    );
    messageErrorMock.mockReset();
  });

  it('serializes the chosen leader first for AionCore v0.1.43', async () => {
    render(<TeamCreateModal visible onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByTestId('team-create-name-input'), { target: { value: 'Ordered Team' } });
    fireEvent.click(screen.getByTestId('team-create-agent-option-claude-agent'));
    fireEvent.click(screen.getByTestId('team-create-agent-option-codex-agent'));
    const drafts = screen.getAllByTestId(/team-create-member-draft-/);
    fireEvent.click(within(drafts[1]).getByRole('button', { name: 'Set as leader' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Team' }));

    await waitFor(() => expect(createTeamInvokeMock).toHaveBeenCalledTimes(1));
    const agents = createTeamInvokeMock.mock.calls[0][0].agents;
    expect(agents.map((agent: { agent_name: string }) => agent.agent_name)).toEqual(['Codex Agent', 'Claude Agent']);
    expect(agents.map((agent: { role: string }) => agent.role)).toEqual(['leader', 'teammate']);
    expect(agents.map((agent: { custom_agent_id: string }) => agent.custom_agent_id)).toEqual([
      'bare:codex-agent',
      'bare:claude-agent',
    ]);
  });

  it('keeps duplicate assistant instances as distinct rows with one leader', async () => {
    render(<TeamCreateModal visible onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByTestId('team-create-name-input'), { target: { value: 'Duplicate Team' } });
    fireEvent.click(screen.getByTestId('team-create-agent-option-claude-agent'));
    fireEvent.click(screen.getByTestId('team-create-agent-option-claude-agent'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Team' }));

    await waitFor(() => expect(createTeamInvokeMock).toHaveBeenCalledTimes(1));
    const agents = createTeamInvokeMock.mock.calls[0][0].agents;
    expect(agents).toHaveLength(2);
    expect(agents.filter((agent: { role: string }) => agent.role === 'leader')).toHaveLength(1);
  });

  it('promotes the first remaining row when the leader is removed', async () => {
    render(<TeamCreateModal visible onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByTestId('team-create-name-input'), { target: { value: 'Promotion Team' } });
    fireEvent.click(screen.getByTestId('team-create-agent-option-claude-agent'));
    fireEvent.click(screen.getByTestId('team-create-agent-option-codex-agent'));
    const drafts = screen.getAllByTestId(/team-create-member-draft-/);
    fireEvent.click(within(drafts[0]).getByRole('button', { name: 'Remove member' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Team' }));

    await waitFor(() => expect(createTeamInvokeMock).toHaveBeenCalledTimes(1));
    expect(createTeamInvokeMock.mock.calls[0][0].agents).toEqual([
      expect.objectContaining({ agent_name: 'Codex Agent', role: 'leader' }),
    ]);
  });

  it('does not create a partial team when any model resolution fails', async () => {
    resolveDefaultTeamAgentModelMock.mockImplementation(({ agent_type }: { agent_type: string }) =>
      agent_type === 'codex' ? Promise.reject(new Error('model unavailable')) : Promise.resolve('model-ok')
    );
    render(<TeamCreateModal visible onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByTestId('team-create-name-input'), { target: { value: 'Failure Team' } });
    fireEvent.click(screen.getByTestId('team-create-agent-option-claude-agent'));
    fireEvent.click(screen.getByTestId('team-create-agent-option-codex-agent'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Team' }));

    await waitFor(() => expect(messageErrorMock).toHaveBeenCalled());
    expect(createTeamInvokeMock).not.toHaveBeenCalled();
    expect(String(messageErrorMock.mock.calls[0][0])).toContain('Codex Agent');
  });

  it('keeps the modal open when the bridge reports a create failure', async () => {
    createTeamInvokeMock.mockResolvedValue({ __bridgeError: true, message: 'backend rejected' });
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<TeamCreateModal visible onClose={onClose} onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId('team-create-name-input'), { target: { value: 'Rejected Team' } });
    fireEvent.click(screen.getByTestId('team-create-agent-option-claude-agent'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Team' }));

    await waitFor(() => expect(messageErrorMock).toHaveBeenCalledWith('backend rejected'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('preserves current team-capable filtering', () => {
    render(<TeamCreateModal visible onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByTestId('team-create-agent-option-claude-agent')).toBeInTheDocument();
    expect(screen.queryByTestId('team-create-agent-option-blocked-agent')).not.toBeInTheDocument();
    expect(screen.queryByTestId('team-create-agent-option-uncatalogued-agent')).not.toBeInTheDocument();
    expect(screen.queryByTestId('team-create-agent-option-generated-blocked-agent')).not.toBeInTheDocument();
  });

  it('preserves the existing E2E trigger and name-input ordering', () => {
    render(<TeamCreateModal visible onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByTestId('team-create-leader-select')).toBeVisible();
    expect(screen.getAllByRole('textbox')[0]).toHaveAttribute('data-testid', 'team-create-name-input');
  });

  it('uses a single-column narrow layout with the same member controls', () => {
    renderMobile();

    expect(screen.getByTestId('team-create-layout-mobile')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('team-create-agent-option-claude-agent'));
    fireEvent.change(screen.getByTestId('team-create-name-input'), { target: { value: 'Mobile Team' } });
    expect(screen.getAllByTestId(/team-create-member-draft-/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Create Team' })).toBeEnabled();
  });
});
