import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';

import { AgentLogoIcon } from '@/renderer/components/agent/AgentBadge';
import DragOverlayContent from '@/renderer/pages/conversation/GroupedHistory/DragOverlayContent';
import AssistantEditorSections from '@/renderer/pages/settings/AssistantSettings/AssistantEditorSections';
import type { AssistantEditorViewModel } from '@/renderer/pages/settings/AssistantSettings/types';

const usePresetAssistantInfoMock = vi.hoisted(() => vi.fn());

vi.mock('@icon-park/react', () => ({
  Info: () => <span data-testid='info-icon' />,
  Robot: () => <span data-testid='robot-icon' />,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  getAgentLogo: (backend: string | undefined) => (backend ? `/logos/${backend}.svg` : null),
}));

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: usePresetAssistantInfoMock,
}));

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useModelProviderList: () => ({
    providers: [],
    getAvailableModels: () => [],
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    dialog: {
      showOpen: { invoke: vi.fn() },
    },
    fs: {
      getImageBase64: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/pages/settings/AssistantSettings/editor/IdentitySection', () => ({
  default: () => <div data-testid='identity-section' />,
}));

vi.mock('@/renderer/pages/settings/AssistantSettings/editor/PromptsSection', () => ({
  default: () => <div data-testid='prompts-section' />,
}));

vi.mock('@/renderer/pages/settings/AssistantSettings/editor/DefaultsSection', () => ({
  default: () => <div data-testid='defaults-section' />,
}));

vi.mock('@/renderer/pages/settings/AssistantSettings/editor/RulesSection', () => ({
  default: () => <div data-testid='rules-section' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

const noop = vi.fn();

beforeEach(() => {
  usePresetAssistantInfoMock.mockReturnValue({ info: null, isLoading: false });
});

const makeEditor = (): AssistantEditorViewModel =>
  ({
    isCreating: false,
    profile: {
      name: 'Assistant',
      setName: noop,
      description: '',
      setDescription: noop,
      avatar: '',
      setAvatar: noop,
      setAvatarPreview: noop,
      avatarImage: '',
      builtinAvatarOptions: [],
    },
    agent: {
      value: 'codex',
      setValue: noop,
      availableBackends: [
        {
          id: 'codex',
          name: 'Codex',
          runtimeKey: 'codex',
          modelOptions: [],
          thoughtLevelOption: null,
          isExtension: false,
        },
      ],
    },
    prompts: {
      text: '',
      setText: noop,
    },
    defaults: {
      model: { mode: 'auto', setMode: noop, value: '', setValue: noop },
      permission: { mode: 'auto', setMode: noop, value: '', setValue: noop },
      thoughtLevel: { mode: 'auto', setMode: noop, value: '', setValue: noop },
      skills: { mode: 'auto', setMode: noop },
      mcps: {
        mode: 'auto',
        setMode: noop,
        availableServers: [],
        selectedIds: [],
        setSelectedIds: noop,
      },
    },
    rules: {
      content: '',
      setContent: noop,
      viewMode: 'preview',
      setViewMode: noop,
    },
    skills: {
      availableSkills: [],
      selectedSkills: [],
      setSelectedSkills: noop,
      pendingSkills: [],
      builtinAutoSkills: [],
      disabledBuiltinSkills: [],
      setDisabledBuiltinSkills: noop,
    },
    actions: {
      duplicate: noop,
    },
  }) as AssistantEditorViewModel;

describe('assistant badge and avatar consistency', () => {
  it('renders explicit assistant fallback avatars as the assistant robot instead of a backend logo', () => {
    const { container } = render(
      <AgentLogoIcon backend='codex' agent_name='Empty Avatar' agentLogo='' agentLogoIsFallback />
    );

    expect(screen.getByTestId('robot-icon')).toBeInTheDocument();
    expect(container.querySelector('img[src="/logos/codex.svg"]')).toBeNull();
  });

  it('uses warning styling for the engine-only-new-conversation badge', () => {
    render(<AssistantEditorSections editor={makeEditor()} activeAssistant={null} />);

    const badge = screen.getByText('New conversations only');

    expect(badge).toHaveClass('bg-warning-8');
    expect(badge).toHaveClass('border-warning-8');
    expect(badge).not.toHaveClass('bg-success-8');
  });

  it('renders drag overlays with assistant fallback avatars instead of backend logos', () => {
    usePresetAssistantInfoMock.mockReturnValue({
      info: {
        name: 'Empty Avatar',
        logo: '',
        isEmoji: false,
        isFallback: true,
      },
      isLoading: false,
    });

    const { container } = render(<DragOverlayContent conversation={makeConversation()} />);

    expect(screen.getByTestId('robot-icon')).toBeInTheDocument();
    expect(container.querySelector('img[src="/logos/codex.svg"]')).toBeNull();
  });
});

function makeConversation(): TChatConversation {
  return {
    created_at: 1,
    modified_at: 1,
    name: 'Empty Avatar Conversation',
    id: 'conv-empty-avatar',
    type: 'acp',
    extra: {
      backend: 'codex',
    },
    model: {
      id: 'codex',
      platform: 'openai',
      name: 'Codex',
      base_url: '',
      api_key: '',
      models: [],
      use_model: '',
    },
    status: 'finished',
  };
}
