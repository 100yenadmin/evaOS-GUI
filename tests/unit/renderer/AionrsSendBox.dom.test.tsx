/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AionrsSendBox from '@/renderer/pages/conversation/platforms/aionrs/AionrsSendBox';
import type { AionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';

const { setSendBoxHandlerMock } = vi.hoisted(() => ({
  setSendBoxHandlerMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      getMode: { invoke: vi.fn().mockResolvedValue({ initialized: true, mode: 'default' }) },
      setMode: { invoke: vi.fn().mockResolvedValue({ mode: 'default' }) },
    },
    conversation: {
      sendMessage: { invoke: vi.fn().mockResolvedValue({ msg_id: 'msg-1' }) },
      stop: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (typeof opts?.defaultValue === 'string') {
        return opts.defaultValue.replace('{{backend}}', String(opts.backend ?? ''));
      }
      return key;
    },
  }),
}));

vi.mock('@/renderer/components/chat/SendBox', () => ({
  default: ({ placeholder }: { placeholder?: string }) => (
    <textarea data-testid='sendbox-input' placeholder={placeholder} readOnly />
  ),
}));

vi.mock('@/renderer/components/agent/AgentModeSelector', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/CommandQueuePanel', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/MobileActionSheet', () => ({
  default: () => null,
  useAttachEntry: () => ({ entries: [], hiddenFileInput: null }),
}));
vi.mock('@/renderer/components/chat/ThoughtDisplay', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/FileAttachButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/FilePreview', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/HorizontalFileList', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/renderer/hooks/chat/useAutoTitle', () => ({
  useAutoTitle: () => ({ checkAndUpdateTitle: vi.fn() }),
}));
vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({
  getSendBoxDraftHook: () => () => ({
    data: { atPath: [], uploadFile: [], content: '' },
    mutate: vi.fn(),
  }),
}));
vi.mock('@/renderer/hooks/chat/useSendBoxFiles', () => ({
  createSetUploadFile: () => vi.fn(),
  useSendBoxFiles: () => ({ handleFilesAdded: vi.fn(), clearFiles: vi.fn() }),
}));
vi.mock('@/renderer/hooks/chat/useSlashCommands', () => ({
  useSlashCommands: () => [],
}));
vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => null,
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));
vi.mock('@/renderer/hooks/file/useOpenFileSelector', () => ({
  useOpenFileSelector: () => ({ openFileSelector: vi.fn(), onSlashBuiltinCommand: vi.fn() }),
}));
vi.mock('@/renderer/hooks/ui/useLatestRef', () => ({
  useLatestRef: <T,>(value: T) => ({ current: value }),
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ setSendBoxHandler: setSendBoxHandlerMock }),
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/useAionrsMessage', () => ({
  useAionrsMessage: () => ({
    thought: null,
    running: false,
    hasHydratedRunningState: true,
    setActiveMsgId: vi.fn(),
    setWaitingResponse: vi.fn(),
    resetState: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/platforms/useConversationCommandQueue', () => ({
  shouldEnqueueConversationCommand: () => false,
  useConversationCommandQueue: () => ({
    items: [],
    isPaused: false,
    isInteractionLocked: false,
    hasPendingCommands: false,
    enqueue: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    reorder: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    lockInteraction: vi.fn(),
    unlockInteraction: vi.fn(),
    resetActiveExecution: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/renderer/pages/conversation/utils/warmupConversation', () => ({
  warmupConversation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/renderer/pages/guid/hooks/agentSelectionUtils', () => ({
  savePreferredMode: vi.fn(),
}));
vi.mock('@/renderer/pages/team/hooks/TeamPermissionContext', () => ({
  useTeamPermission: () => null,
}));
vi.mock('@/renderer/services/FileService', () => ({
  allSupportedExts: [],
}));
vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
  useAddEventListener: vi.fn(),
}));
vi.mock('@/renderer/utils/file/fileSelection', () => ({
  mergeFileSelectionItems: vi.fn(),
}));
vi.mock('@/renderer/utils/file/messageFiles', () => ({
  buildDisplayMessage: (input: string) => input,
  collectSelectedFiles: () => [],
}));
vi.mock('@arco-design/web-react', () => ({
  Message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  Tag: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const modelSelection = (): AionrsModelSelection =>
  ({
    current_model: { id: 'provider-1', use_model: 'gpt-5' },
    providers: [],
    getAvailableModels: () => [],
    handleSelectModel: vi.fn(),
  }) as unknown as AionrsModelSelection;

describe('AionrsSendBox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('uses Custom as the missing agent_name fallback placeholder', () => {
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection()} />);

    expect(screen.getByTestId('sendbox-input')).toHaveAttribute('placeholder', 'Send message to Custom...');
    expect(screen.queryByPlaceholderText('Send message to AionCLI...')).not.toBeInTheDocument();
  });
});
