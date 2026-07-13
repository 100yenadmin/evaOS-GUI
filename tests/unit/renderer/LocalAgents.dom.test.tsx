/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';

const navigateMock = vi.fn();
const revalidateMock = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; displayName?: string; status?: string }) => {
      if (options?.defaultValue) return options.defaultValue;
      if (key === 'settings.agentManagement.detected') return 'Detected';
      if (key === 'settings.agentManagement.localAgentsDescription') return 'Local agents';
      if (key === 'settings.agentManagement.detectCustomAgent') return 'Detect Custom Agent';
      if (key === 'settings.agentManagement.goToChat') return 'Go to Chat';
      if (key === 'common.failed') return 'Failed';
      if (key === 'common.retry') return 'Retry';
      if (key === 'settings.agentManagement.nativePaired') return 'Paired';
      if (key === 'settings.agentManagement.nativeStatusReason') return `Mac control status: ${options?.status ?? ''}`;
      if (key === 'settings.agentManagement.nativePairingProofMissing') return 'Mac control pairing proof is missing.';
      if (key === 'settings.agentManagement.nativeNotRequiredReason') {
        return 'Agent does not depend on evaOS Mac control pairing.';
      }
      if (key === 'settings.agentManagement.gatewayManagedTools') return 'Gateway-managed tools';
      if (key === 'settings.agentManagement.workbenchSessionMcpUnsupported') {
        return 'Workbench session MCP unsupported';
      }
      if (key === 'settings.agentManagement.desktopBridgeGatewayPluginRequired') {
        return 'Desktop Bridge gateway plugin required';
      }
      if (key === 'settings.agentManagement.sessionMcpSupportDeterminedAtConnection') {
        return 'Session MCP support is determined at connection time';
      }
      return key;
    },
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      createCustomAgent: { invoke: vi.fn() },
      updateCustomAgent: { invoke: vi.fn() },
      deleteCustomAgent: { invoke: vi.fn() },
      setAgentEnabled: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/components/base/AionModal', () => ({
  default: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? <div data-testid='aion-modal'>{children}</div> : null,
}));

vi.mock('@/renderer/hooks/agent/useAgents', () => ({
  useManagedAgents: vi.fn(),
}));

vi.mock('@/renderer/evaos/useEvaosNativeCompanionStatus', () => ({
  useEvaosNativeCompanionStatus: vi.fn(() => ({ status: null })),
}));

vi.mock('@/renderer/pages/settings/AgentSettings/AgentHubModal', () => ({
  AgentHubModal: () => <div data-testid='agent-hub-modal' />,
}));

vi.mock('@/renderer/pages/settings/AgentSettings/InlineAgentEditor', () => ({
  default: () => <div data-testid='inline-agent-editor' />,
}));

import { useManagedAgents } from '@/renderer/hooks/agent/useAgents';
import LocalAgents from '@/renderer/pages/settings/AgentSettings/LocalAgents';

const managedAgentsMock = vi.mocked(useManagedAgents);

function agent(overrides: Partial<AgentMetadata>): AgentMetadata {
  return {
    id: overrides.id ?? 'agent',
    name: overrides.name ?? 'Agent',
    agent_type: overrides.agent_type ?? 'acp',
    agent_source: overrides.agent_source ?? 'builtin',
    backend: overrides.backend,
    enabled: overrides.enabled ?? true,
    available: overrides.available ?? true,
    handshake: overrides.handshake,
    ...overrides,
  };
}

const agents = [
  agent({
    id: 'codex',
    name: 'Codex CLI',
    backend: 'codex',
    available: true,
  }),
  agent({
    id: 'missing-claude',
    name: 'Claude Code',
    backend: 'claude',
    available: false,
  }),
  agent({
    id: 'hermes',
    name: 'Hermes',
    backend: 'hermes',
    available: true,
    handshake: {
      native_companion: {
        status: 'not_paired',
      },
    },
  }),
  agent({
    id: 'custom-1',
    name: 'Personal Agent',
    agent_source: 'custom',
    agent_type: 'aionrs',
    command: 'personal-agent',
  }),
];

describe('LocalAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managedAgentsMock.mockReturnValue({
      agents,
      isLoading: false,
      error: null,
      revalidate: revalidateMock,
      refreshCustomAgents: vi.fn(),
    });
  });

  it('renders availability tabs and filters detected agents without changing chat actions', () => {
    render(<LocalAgents />);

    const allTab = screen.getByTestId('agent-filter-all');
    const availableTab = screen.getByTestId('agent-filter-available');
    const setupTab = screen.getByTestId('agent-filter-setup');

    expect(allTab).toHaveTextContent('All3');
    expect(availableTab).toHaveTextContent('Available1');
    expect(setupTab).toHaveTextContent('Needs setup2');
    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Hermes')).toBeInTheDocument();

    fireEvent.click(availableTab);
    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.queryByText('Claude Code')).toBeNull();

    fireEvent.click(setupTab);
    expect(screen.queryByText('Codex CLI')).toBeNull();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Hermes')).toBeInTheDocument();
    expect(screen.getAllByText('Go to Chat').length).toBeGreaterThan(0);
  });

  it('shows the gateway-managed OpenClaw transport contract', () => {
    managedAgentsMock.mockReturnValue({
      agents: [
        agent({
          id: 'openclaw',
          name: 'OpenClaw',
          backend: 'openclaw',
          available: true,
        }),
      ],
      isLoading: false,
      error: null,
      revalidate: revalidateMock,
      refreshCustomAgents: vi.fn(),
    });

    render(<LocalAgents />);

    expect(screen.getByText('Gateway-managed tools')).toBeInTheDocument();
    expect(screen.getByText('Workbench session MCP unsupported')).toBeInTheDocument();
    expect(screen.getByText('Desktop Bridge gateway plugin required')).toBeInTheDocument();
  });

  it('shows connection-time session MCP truth for a generic ACP agent', () => {
    managedAgentsMock.mockReturnValue({
      agents: [
        agent({
          id: 'generic-acp',
          name: 'Generic ACP',
          backend: 'generic',
          available: true,
        }),
      ],
      isLoading: false,
      error: null,
      revalidate: revalidateMock,
      refreshCustomAgents: vi.fn(),
    });

    render(<LocalAgents />);

    expect(screen.getByText('Session MCP support is determined at connection time')).toBeInTheDocument();
  });

  it('shows a retryable error instead of an empty catalog when loading fails', () => {
    managedAgentsMock.mockReturnValue({
      agents: [],
      isLoading: false,
      error: new Error('catalog unavailable'),
      revalidate: revalidateMock,
      refreshCustomAgents: vi.fn(),
    });

    render(<LocalAgents />);

    expect(screen.getByTestId('agent-catalog-error')).toHaveTextContent('Failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(revalidateMock).toHaveBeenCalledTimes(1);
  });

  it('renders existing custom agents without opening the destructive redacted edit path', () => {
    render(<LocalAgents />);

    expect(screen.getByText('Personal Agent')).toBeInTheDocument();
    expect(screen.queryByText('settings.agentManagement.editCustomAgent')).toBeNull();
  });
});
