import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TeamChatView from '@/renderer/pages/team/components/TeamChatView';

const { acpChatMock, aionrsChatMock } = vi.hoisted(() => ({
  acpChatMock: vi.fn(() => <div data-testid='mock-acp-chat' />),
  aionrsChatMock: vi.fn(() => <div data-testid='mock-aionrs-chat' />),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      update: { invoke: vi.fn().mockResolvedValue(true) },
    },
    team: {
      cancelChildTurn: { invoke: vi.fn().mockResolvedValue(undefined) },
      cancelRun: { invoke: vi.fn().mockResolvedValue(undefined) },
      sendMessage: { invoke: vi.fn().mockResolvedValue({}) },
      sendMessageToAgent: { invoke: vi.fn().mockResolvedValue({}) },
    },
  },
}));

vi.mock('@arco-design/web-react', () => ({
  Spin: () => <div data-testid='team-chat-loading' />,
}));

vi.mock('@/renderer/pages/conversation/platforms/acp/AcpChat', () => ({
  __esModule: true,
  default: (props: unknown) => acpChatMock(props),
}));

vi.mock('@/renderer/pages/conversation/platforms/aionrs/AionrsChat', () => ({
  __esModule: true,
  default: (props: unknown) => aionrsChatMock(props),
}));

vi.mock('@/renderer/pages/conversation/platforms/openclaw/OpenClawChat', () => ({
  __esModule: true,
  default: () => <div data-testid='mock-openclaw-chat' />,
}));

vi.mock('@/renderer/pages/conversation/platforms/nanobot/NanobotChat', () => ({
  __esModule: true,
  default: () => <div data-testid='mock-nanobot-chat' />,
}));

vi.mock('@/renderer/pages/conversation/platforms/remote/RemoteChat', () => ({
  __esModule: true,
  default: () => <div data-testid='mock-remote-chat' />,
}));

vi.mock('@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection', () => ({
  useAionrsModelSelection: () => ({
    current_model: { id: 'provider-1', use_model: 'gpt-5' },
    providers: [],
    getAvailableModels: () => [],
    handleSelectModel: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/guid/hooks/agentSelectionUtils', () => ({
  saveAionrsDefaultModel: vi.fn(),
}));

describe('TeamChatView', () => {
  beforeEach(() => {
    acpChatMock.mockClear();
    aionrsChatMock.mockClear();
  });

  it('passes loaded skills and MCP snapshot to ACP team chat', async () => {
    const mcpStatuses = [{ id: 'office', name: 'office', status: 'loaded' as const }];

    render(
      <TeamChatView
        conversation={{
          id: 'conv-1',
          type: 'acp',
          name: 'Team - Planner',
          created_at: Date.now(),
          updated_at: Date.now(),
          extra: {
            workspace: '/tmp',
            skills: ['excel'],
            mcp_servers: ['office'],
            mcp_statuses: mcpStatuses,
          },
        }}
      />
    );

    expect(await screen.findByTestId('mock-acp-chat')).toBeInTheDocument();
    expect(acpChatMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        loadedSkills: ['excel'],
        loadedMcpServers: ['office'],
        loadedMcpStatuses: mcpStatuses,
      })
    );
  });

  it('passes loaded skills and MCP snapshot to AionRS team chat', async () => {
    const mcpStatuses = [{ id: 'office', name: 'office', status: 'loaded' as const }];

    render(
      <TeamChatView
        conversation={{
          id: 'conv-1',
          type: 'aionrs',
          name: 'Team - AionRS',
          created_at: Date.now(),
          updated_at: Date.now(),
          extra: {
            workspace: '/tmp',
            skills: ['excel'],
            mcp_servers: ['office'],
            mcp_statuses: mcpStatuses,
          },
          model: {
            id: 'provider-1',
            name: 'Provider',
            type: 'openai',
            api_key: '',
            api_base_url: '',
            use_model: 'gpt-5',
          },
        }}
      />
    );

    expect(await screen.findByTestId('mock-aionrs-chat')).toBeInTheDocument();
    expect(aionrsChatMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        loadedSkills: ['excel'],
        loadedMcpServers: ['office'],
        loadedMcpStatuses: mcpStatuses,
      })
    );
  });
});
