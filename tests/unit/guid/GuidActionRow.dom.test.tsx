/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import GuidActionRow from '@/renderer/pages/guid/components/GuidActionRow';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { showOpen, layoutState } = vi.hoisted(() => ({
  showOpen: vi.fn(),
  layoutState: { isMobile: true },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    dialog: {
      showOpen: { invoke: showOpen },
    },
  },
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: layoutState.isMobile }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
}));

vi.mock('@/renderer/components/agent/AgentModeSelector', () => ({
  default: () => <div data-testid='desktop-mode-selector'>Desktop mode</div>,
}));

vi.mock('@/renderer/pages/guid/components/PresetAgentTag', () => ({
  default: () => <div data-testid='preset-agent-tag' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; count?: number }) =>
      options?.defaultValue ?? (options?.count === undefined ? key : `${key}:${options.count}`),
  }),
}));

const renderRow = (overrides: Record<string, unknown> = {}) => {
  const props = {
    files: [],
    onFilesUploaded: vi.fn(),
    modelSelectorNode: <div data-testid='desktop-model-selector'>Desktop model</div>,
    isGeminiMode: false,
    modelList: [],
    current_model: undefined,
    setCurrentModel: vi.fn(),
    currentAcpCachedModelInfo: {
      current_model_id: 'model-a',
      current_model_label: 'Model A',
      available_models: [
        { id: 'model-a', label: 'Model A' },
        { id: 'model-b', label: 'Model B' },
      ],
    },
    selectedAcpModel: 'model-a',
    setSelectedAcpModel: vi.fn(),
    selectedAgent: 'codex',
    selectedMode: 'read-only',
    onModeSelect: vi.fn(),
    is_presetAgent: false,
    selectedAgentInfo: undefined,
    assistants: [],
    localeKey: 'en',
    onClosePresetTag: vi.fn(),
    allSkills: [
      { name: 'review', description: 'Review code', isAuto: false },
      { name: 'research', description: 'Research', isAuto: false },
    ],
    disabledBuiltinSkills: [],
    enabledSkills: ['review'],
    onToggleSkill: vi.fn(),
    mcpServers: [
      { id: 'mcp-a', name: 'MCP A', tools: [{ name: 'one' }] },
      { id: 'mcp-b', name: 'MCP B', tools: [] },
    ],
    selectedMcpServerIds: ['mcp-a'],
    onToggleMcpServer: vi.fn(),
    loading: false,
    isButtonDisabled: false,
    onSend: vi.fn(),
    ...overrides,
  };

  const view = render(<GuidActionRow {...(props as React.ComponentProps<typeof GuidActionRow>)} />);
  return Object.assign(props, {
    rerenderRow: () => view.rerender(<GuidActionRow {...(props as React.ComponentProps<typeof GuidActionRow>)} />),
  });
};

describe('GuidActionRow mobile controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    layoutState.isMobile = true;
    showOpen.mockResolvedValue(['/tmp/example.txt']);
  });

  it('opens the shared action sheet and removes inline desktop selectors', () => {
    renderRow();

    expect(screen.queryByTestId('desktop-model-selector')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desktop-mode-selector')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('file-upload-btn'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-action-sheet-model')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-action-sheet-permission')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-action-sheet-attach')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-action-sheet-skills')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-action-sheet-mcp')).toBeInTheDocument();
  });

  it('routes model, permission, skill, and MCP selections through existing callbacks', () => {
    const props = renderRow();
    fireEvent.click(screen.getByTestId('file-upload-btn'));

    fireEvent.click(screen.getByTestId('mobile-action-sheet-model'));
    fireEvent.click(screen.getByTestId('mobile-action-sheet-option-model-b'));
    expect(props.setSelectedAcpModel).toHaveBeenCalledWith('model-b');

    fireEvent.click(screen.getByTestId('mobile-action-sheet-permission'));
    fireEvent.click(screen.getByTestId('mobile-action-sheet-option-auto'));
    expect(props.onModeSelect).toHaveBeenCalledWith('auto');

    fireEvent.click(screen.getByTestId('mobile-action-sheet-skills'));
    fireEvent.click(screen.getByTestId('mobile-action-sheet-option-research'));
    expect(props.onToggleSkill).toHaveBeenCalledWith('research', false);
    fireEvent.click(screen.getByTestId('mobile-action-sheet-option-review'));
    expect(props.onToggleSkill).toHaveBeenCalledWith('review', false);

    fireEvent.click(screen.getByText('Back'));
    fireEvent.click(screen.getByTestId('mobile-action-sheet-mcp'));
    fireEvent.click(screen.getByTestId('mobile-action-sheet-option-mcp-b'));
    expect(props.onToggleMcpServer).toHaveBeenCalledWith('mcp-b');
  });

  it('routes host attachment through the existing upload callback and closes the sheet', async () => {
    const props = renderRow();
    fireEvent.click(screen.getByTestId('file-upload-btn'));
    fireEvent.click(screen.getByTestId('mobile-action-sheet-attach'));

    await waitFor(() => expect(props.onFilesUploaded).toHaveBeenCalledWith(['/tmp/example.txt']));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('preserves the add-model recovery route when no provider models are configured', () => {
    const onAddModel = vi.fn();
    renderRow({
      isGeminiMode: true,
      modelList: [],
      currentAcpCachedModelInfo: null,
      onAddModel,
    });

    fireEvent.click(screen.getByTestId('file-upload-btn'));
    fireEvent.click(screen.getByTestId('mobile-action-sheet-model'));
    fireEvent.click(screen.getByTestId('mobile-action-sheet-option-add-model'));

    expect(onAddModel).toHaveBeenCalledTimes(1);
  });

  it('does not reopen an old sheet after leaving and returning to mobile layout', () => {
    const props = renderRow();
    fireEvent.click(screen.getByTestId('file-upload-btn'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    layoutState.isMobile = false;
    props.rerenderRow();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    layoutState.isMobile = true;
    props.rerenderRow();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
