import { cleanup, render, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TChatConversation } from '@/common/config/storage';
import WorkspaceGroupedHistory from '@/renderer/pages/conversation/GroupedHistory';
import WorkspaceCollapse from '@/renderer/pages/conversation/components/WorkspaceCollapse';
import { useConversations } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversations';
import { WORKSPACE_EXPANSION_STORAGE_KEY } from '@/renderer/pages/conversation/GroupedHistory/hooks/useWorkspaceExpansionState';

const conversationHistoryMock = vi.hoisted(() => ({
  value: null as unknown,
}));

vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => conversationHistoryMock.value,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      key === 'conversation.history.selectedCount' ? `selected: ${params?.count ?? 0}` : key,
  }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: null }),
}));

vi.mock('@/renderer/components/base/AionModal', () => ({
  default: ({ children, visible }: { children: ReactNode; visible?: boolean }) =>
    visible ? <div data-testid='aion-modal'>{children}</div> : null,
}));

vi.mock('@/renderer/components/settings/DirectorySelectionModal', () => ({
  default: () => null,
}));

vi.mock('@/renderer/pages/cron', () => ({
  CronJobIndicator: () => null,
  useCronJobsMap: () => ({
    getJobStatus: () => 'none',
    markAsRead: vi.fn(),
    setActiveConversation: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions', () => ({
  useConversationActions: () => ({
    renameModalVisible: false,
    renameModalName: '',
    setRenameModalName: vi.fn(),
    renameLoading: false,
    dropdownVisibleId: null,
    handleConversationClick: vi.fn(),
    handleDeleteClick: vi.fn(),
    handleBatchDelete: vi.fn(),
    handleEditStart: vi.fn(),
    handleRenameConfirm: vi.fn(),
    handleRenameCancel: vi.fn(),
    handleTogglePin: vi.fn(),
    handleMenuVisibleChange: vi.fn(),
    handleOpenMenu: vi.fn(),
    handleRemoveProject: vi.fn(),
    removeProjectTarget: null,
    removeProjectLoading: false,
    handleRemoveProjectCancel: vi.fn(),
    handleRemoveProjectConfirm: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useDragAndDrop', () => ({
  useDragAndDrop: () => ({
    sensors: [],
    activeId: null,
    activeConversation: null,
    handleDragStart: vi.fn(),
    handleDragEnd: vi.fn(),
    handleDragCancel: vi.fn(),
    isDragEnabled: false,
  }),
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useExport', () => ({
  useExport: () => ({
    exportTask: null,
    exportModalVisible: false,
    exportTargetPath: '',
    exportModalLoading: false,
    showExportDirectorySelector: false,
    setShowExportDirectorySelector: vi.fn(),
    closeExportModal: vi.fn(),
    handleSelectExportDirectoryFromModal: vi.fn(),
    handleSelectExportFolder: vi.fn(),
    handleExportConversation: vi.fn(),
    handleBatchExport: vi.fn(),
    handleConfirmExport: vi.fn(),
  }),
}));

const makeConversation = (id: string, workspace?: string): TChatConversation => ({
  id,
  name: id,
  created_at: 1,
  modified_at: 1,
  type: 'acp',
  model: {
    id: 'test-provider',
    platform: 'test',
    name: 'Test Provider',
    base_url: '',
    api_key: '',
    models: ['test-model'],
    use_model: 'test-model',
  },
  status: 'finished',
  extra: workspace ? { workspace, backend: 'aionrs' } : { backend: 'aionrs' },
});

const wrapperForRoute =
  (route: string) =>
  ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path='/conversation/:id' element={children} />
      </Routes>
    </MemoryRouter>
  );

describe('conversation sidebar upstream UX ports', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('reveals an active project conversation by opening its collapsed section and workspace', async () => {
    const workspace = '/Users/lume/project-alpha';
    const activeConversation = makeConversation('conv-active', workspace);
    const setActiveConversation = vi.fn();
    const clearCompletionUnread = vi.fn();

    localStorage.setItem('grouped-history-collapsed-sections', JSON.stringify(['projects']));
    localStorage.setItem(WORKSPACE_EXPANSION_STORAGE_KEY, JSON.stringify([]));

    conversationHistoryMock.value = {
      conversations: [activeConversation],
      isConversationGenerating: vi.fn(() => false),
      hasCompletionUnread: vi.fn(() => false),
      clearCompletionUnread,
      setActiveConversation,
      groupedHistory: {
        pinnedConversations: [],
        timelineSections: [
          {
            timeline: 'Today',
            items: [
              {
                type: 'workspace',
                time: 1,
                workspaceGroup: {
                  workspace,
                  display_name: 'Project Alpha',
                  conversations: [activeConversation],
                },
              },
            ],
          },
        ],
      },
    };

    const { result } = renderHook(() => useConversations(), {
      wrapper: wrapperForRoute('/conversation/conv-active'),
    });

    await waitFor(() => {
      expect(result.current.expandedWorkspaces).toContain(workspace);
      expect(result.current.collapsedSections.has('projects')).toBe(false);
    });
    expect(setActiveConversation).toHaveBeenCalledWith('conv-active');
    expect(clearCompletionUnread).toHaveBeenCalledWith('conv-active');
  });

  it('renders workspace headers as sticky when requested', () => {
    const { container } = render(
      <WorkspaceCollapse expanded stickyHeader stickyTop={28} onToggle={vi.fn()} header={<span>Project Alpha</span>}>
        <div>Conversation row</div>
      </WorkspaceCollapse>
    );

    const stickyHeader = container.querySelector('.workspace-collapse > .sticky');

    expect(stickyHeader).not.toBeNull();
    expect(stickyHeader).toHaveStyle({ top: '28px' });
    expect(stickyHeader).toHaveClass('bg-[var(--bg-2)]');
  });

  it('keeps the batch-selection panel sticky above long conversation lists', () => {
    const conversation = makeConversation('conv-free');
    conversationHistoryMock.value = {
      conversations: [conversation],
      isConversationGenerating: vi.fn(() => false),
      hasCompletionUnread: vi.fn(() => false),
      clearCompletionUnread: vi.fn(),
      setActiveConversation: vi.fn(),
      groupedHistory: {
        pinnedConversations: [],
        timelineSections: [
          {
            timeline: 'Today',
            items: [{ type: 'conversation', time: 1, conversation }],
          },
        ],
      },
    };

    const { container } = render(
      <MemoryRouter initialEntries={['/conversation/conv-free']}>
        <Routes>
          <Route path='/conversation/:id' element={<WorkspaceGroupedHistory batchMode />} />
        </Routes>
      </MemoryRouter>
    );

    const batchPanel = container.querySelector('[class*="z-20"]');

    expect(batchPanel).not.toBeNull();
    expect(batchPanel).toHaveTextContent('selected: 0');
    expect(batchPanel).toHaveClass('sticky');
    expect(batchPanel).toHaveClass('top-0');
    expect(batchPanel).toHaveClass('bg-[var(--bg-2)]');
  });
});
