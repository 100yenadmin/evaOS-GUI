/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import AcpModelSelector from '@/renderer/components/agent/AcpModelSelector';
import type { AcpModelInfo } from '@/common/types/platform/acpTypes';
import type { AcpConfigSetStatus, AcpDerivedOption } from '@/renderer/hooks/agent/useAcpConfigOptions';

const { messageSuccessMock, messageErrorMock, useAcpModelInfoMock } = vi.hoisted(() => ({
  messageSuccessMock: vi.fn(),
  messageErrorMock: vi.fn(),
  useAcpModelInfoMock: vi.fn(),
}));

type MockAcpModelInfoResult = {
  model_info: AcpModelInfo | null;
  canSwitch: boolean;
  isSetting: boolean;
  selectModel: (modelId: string) => void;
  thoughtLevel: AcpDerivedOption | null;
  setStatus: AcpConfigSetStatus;
  setConfigOption: (optionId: string, value: string) => Promise<unknown>;
};

const modelInfo: AcpModelInfo = {
  current_model_id: 'gpt-5.2',
  current_model_label: 'GPT-5.2',
  available_models: [
    { id: 'gpt-5.2', label: 'GPT-5.2' },
    { id: 'gpt-5.2-mini', label: 'GPT-5.2 Mini' },
  ],
};

const thoughtLevel: AcpDerivedOption = {
  id: 'thought_level',
  category: 'thought_level',
  currentValue: 'high',
  options: [
    { value: 'low', label: 'Low' },
    { value: 'high', label: 'High' },
  ],
};

const makeResult = (overrides: Partial<MockAcpModelInfoResult> = {}): MockAcpModelInfoResult => ({
  model_info: modelInfo,
  canSwitch: true,
  isSetting: false,
  selectModel: vi.fn(),
  thoughtLevel,
  setStatus: { state: 'idle' },
  setConfigOption: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

vi.mock('@/renderer/hooks/agent/useAcpModelInfo', () => ({
  useAcpModelInfo: useAcpModelInfoMock,
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/pages/conversation/utils/warmupConversation', () => ({
  warmupConversation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/renderer/components/agent/MarqueePillLabel', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  getModelDisplayLabel: ({
    selectedLabel,
    selected_value,
    fallbackLabel,
  }: {
    selectedLabel?: string;
    selected_value?: string | null;
    fallbackLabel: string;
  }) => selectedLabel || selected_value || fallbackLabel,
}));

vi.mock('@icon-park/react', () => ({
  Brain: () => <span aria-hidden='true'>brain</span>,
  Down: () => <span aria-hidden='true'>v</span>,
  Search: () => <span aria-hidden='true'>search</span>,
  Loading: ({ className }: { className?: string }) => <span aria-hidden='true' className={className} />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      if (key === 'agent.thoughtLevel.label') return 'Thinking Level';
      if (key === 'agent.thoughtLevel.switchSuccess') return 'agent.thoughtLevel.switchSuccess';
      if (key === 'agent.config.commandAck') return 'agent.config.commandAck';
      if (key === 'common.model') return 'Model';
      if (key === 'common.defaultModel') return 'Default';
      if (key === 'agent.model.searchPlaceholder') return 'Search models';
      if (key === 'agent.model.noResults') return 'No matching models';
      if (key === 'conversation.welcome.useCliModel') return 'Use CLI model';
      if (key === 'conversation.welcome.modelSwitchNotSupported') return 'Model switch is not supported';
      return options?.defaultValue ?? key;
    },
  }),
}));

vi.mock('@arco-design/web-react', () => {
  const Menu = Object.assign(
    ({ children, className }: { children?: React.ReactNode; className?: string }) => (
      <div data-testid='dropdown-menu' className={className}>
        {children}
      </div>
    ),
    {
      Item: ({
        children,
        className,
        onClick,
      }: {
        children?: React.ReactNode;
        className?: string;
        onClick?: () => void;
      }) => (
        <div role='menuitem' className={className} onClick={onClick}>
          {children}
        </div>
      ),
      ItemGroup: ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => (
        <div role='group' aria-label={String(title)}>
          {children}
        </div>
      ),
      SubMenu: ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => (
        <div role='group'>
          <div data-testid='submenu-title'>{title}</div>
          <div data-testid='submenu-body'>{children}</div>
        </div>
      ),
    }
  );
  return {
    Button: ({
      children,
      disabled,
      onClick,
      ...props
    }: {
      children?: React.ReactNode;
      disabled?: boolean;
      onClick?: () => void;
      [key: string]: unknown;
    }) => (
      <button type='button' disabled={disabled} onClick={onClick} {...props}>
        {children}
      </button>
    ),
    Dropdown: ({ children, droplist }: { children?: React.ReactNode; droplist?: React.ReactNode }) => (
      <div>
        {children}
        {droplist}
      </div>
    ),
    Menu,
    Message: {
      success: messageSuccessMock,
      error: messageErrorMock,
    },
    Tooltip: ({ children, content }: { children?: React.ReactNode; content?: React.ReactNode }) => (
      <span data-tooltip-content={typeof content === 'string' ? content : undefined}>{children}</span>
    ),
  };
});

describe('AcpModelSelector runtime options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAcpModelInfoMock.mockReturnValue(makeResult());
  });

  it('shows the current model and thought level in the header pill', () => {
    render(<AcpModelSelector conversation_id='conversation-1' backend='codex' />);

    expect(screen.getByTestId('acp-model-selector')).toHaveTextContent('GPT-5.2 · High');
  });

  it('preserves warmup and global-preference controls on the model hook', () => {
    render(
      <AcpModelSelector
        conversation_id='conversation-1'
        backend='codex'
        waitForWarmup
        persistGlobalPreference={false}
      />
    );

    expect(useAcpModelInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conversation-1',
        backend: 'codex',
        prepareRuntime: expect.any(Function),
        persistGlobalPreference: false,
      })
    );
  });

  it('shows the model submenu before the thought level submenu, each with its current value', () => {
    render(<AcpModelSelector conversation_id='conversation-1' backend='codex' />);

    const titles = screen.getAllByTestId('submenu-title');
    expect(titles[0]).toHaveTextContent('Model');
    expect(titles[0]).toHaveTextContent('GPT-5.2');
    expect(titles[1]).toHaveTextContent('Thinking Level');
    expect(titles[1]).toHaveTextContent('High');
  });

  it('marks the current model with the same leading check indicator as thought level options', () => {
    render(<AcpModelSelector conversation_id='conversation-1' backend='codex' />);

    const modelBody = screen.getAllByTestId('submenu-body')[0];
    const currentModelItem = within(modelBody).getByText('GPT-5.2').closest('[role="menuitem"]');
    const otherModelItem = within(modelBody).getByText('GPT-5.2 Mini').closest('[role="menuitem"]');

    expect(currentModelItem?.textContent?.trim().startsWith('\u2713')).toBe(true);
    expect(otherModelItem).not.toHaveTextContent('\u2713');
  });

  it('omits the thought level label and group when the runtime has no thought option', () => {
    useAcpModelInfoMock.mockReturnValue(makeResult({ thoughtLevel: null }));

    render(<AcpModelSelector conversation_id='conversation-1' backend='codex' />);

    expect(screen.getByTestId('acp-model-selector')).toHaveTextContent('GPT-5.2');
    expect(screen.queryAllByTestId('submenu-title')).toHaveLength(0);
    expect(screen.getByText('GPT-5.2 Mini')).toBeInTheDocument();
  });

  it('selects a model through the existing model setter', () => {
    const selectModel = vi.fn();
    useAcpModelInfoMock.mockReturnValue(makeResult({ selectModel }));

    render(<AcpModelSelector conversation_id='conversation-1' backend='codex' />);
    const modelBody = screen.getAllByTestId('submenu-body')[0];
    fireEvent.click(within(modelBody).getByText('GPT-5.2 Mini'));

    expect(selectModel).toHaveBeenCalledWith('gpt-5.2-mini');
  });

  it('supports a thinking-only runtime control when model switching is absent', () => {
    useAcpModelInfoMock.mockReturnValue(makeResult({ model_info: null, canSwitch: false }));

    render(<AcpModelSelector conversation_id='conversation-1' backend='codex' />);

    expect(screen.getByTestId('acp-model-selector')).toHaveTextContent('Use CLI model · High');
    expect(screen.getByRole('group', { name: 'Thinking Level' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Model' })).not.toBeInTheDocument();
  });

  it('sets thought level through the existing config option setter', async () => {
    const setConfigOption = vi.fn().mockResolvedValue(undefined);
    useAcpModelInfoMock.mockReturnValue(makeResult({ setConfigOption }));

    render(<AcpModelSelector conversation_id='conversation-1' backend='codex' />);

    fireEvent.click(screen.getByText('Low'));

    await waitFor(() => {
      expect(setConfigOption).toHaveBeenCalledWith('thought_level', 'low');
    });
    expect(messageSuccessMock).toHaveBeenCalledWith('agent.thoughtLevel.switchSuccess');
  });

  it('keeps the old thought value and shows an error when config update fails', async () => {
    const setConfigOption = vi.fn().mockRejectedValue(new Error('command_ack'));
    useAcpModelInfoMock.mockReturnValue(makeResult({ setConfigOption }));

    render(<AcpModelSelector conversation_id='conversation-1' backend='codex' />);

    fireEvent.click(screen.getByText('Low'));

    await waitFor(() => {
      expect(messageErrorMock).toHaveBeenCalledWith('agent.config.commandAck');
    });
    expect(screen.getByTestId('acp-model-selector')).toHaveTextContent('GPT-5.2 · High');
  });
});
