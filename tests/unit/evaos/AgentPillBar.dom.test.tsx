/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AgentPillBar from '@/renderer/pages/guid/components/AgentPillBar';
import type { AvailableAgent } from '@/renderer/pages/guid/types';

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const getAgentKey = (agent: { agent_type: string; agent_source?: string; backend?: string; id?: string }): string =>
  agent.backend || agent.agent_type || agent.id || '';

function renderPillBar(availableAgents: AvailableAgent[], selectedAgentKey = 'openclaw-gateway') {
  return render(
    <MemoryRouter>
      <AgentPillBar
        availableAgents={availableAgents}
        selectedAgentKey={selectedAgentKey}
        getAgentKey={getAgentKey}
        onSelectAgent={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe('AgentPillBar evaOS presentation', () => {
  it('renders stable evaOS labels even when backend rows still use upstream names', () => {
    renderPillBar([
      {
        agent_type: 'openclaw-gateway',
        backend: 'openclaw-gateway',
        name: 'OpenClaw',
      },
      {
        agent_type: 'acp',
        backend: 'hermes',
        name: 'Hermes',
      },
      {
        agent_type: 'aionrs',
        backend: 'aionrs',
        name: 'Aion CLI',
      },
    ]);

    expect(screen.getByText('evaOS')).toBeInTheDocument();
    expect(screen.getByText('Hermes')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.queryByText('OpenClaw')).not.toBeInTheDocument();
    expect(screen.queryByText('Aion CLI')).not.toBeInTheDocument();
    expect(screen.getByTestId('agent-pill-aionrs').querySelector('img')?.getAttribute('src') ?? '').not.toMatch(
      /aion/i
    );
  });

  it('keeps Custom last after evaOS, Hermes, and third-party local agents', () => {
    renderPillBar(
      [
        {
          agent_type: 'aionrs',
          backend: 'aionrs',
          name: 'Aion CLI',
        },
        {
          agent_type: 'acp',
          backend: 'claude',
          name: 'Claude Code',
        },
        {
          agent_type: 'acp',
          backend: 'hermes',
          name: 'Hermes',
        },
        {
          agent_type: 'openclaw-gateway',
          backend: 'openclaw-gateway',
          name: 'OpenClaw',
        },
      ],
      'aionrs'
    );

    const renderedLabels = screen
      .getAllByTestId(/^agent-pill-/)
      .map((pill) => within(pill).getByText(/evaOS|Hermes|Claude Code|Custom/).textContent);

    expect(renderedLabels).toEqual(['evaOS', 'Hermes', 'Claude Code', 'Custom']);
  });
});
