import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BackendStartupFailureDialog,
  shouldShowBackendStartupFailureDialog,
} from '@/renderer/components/layout/BackendStartupFailureDialog';

const mocks = vi.hoisted(() => ({
  feedbackModal: vi.fn(),
  recoverCorruptedDatabase: vi.fn(),
  messageError: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/FeedbackReportModal', () => ({
  default: (props: unknown) => {
    mocks.feedbackModal(props);
    return null;
  },
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      ...actual.Message,
      error: mocks.messageError,
    },
  };
});

describe('BackendStartupFailureDialog recoverable database corruption', () => {
  beforeEach(() => {
    mocks.feedbackModal.mockReset();
    mocks.recoverCorruptedDatabase.mockReset();
    mocks.messageError.mockReset();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        recoverCorruptedDatabase: mocks.recoverCorruptedDatabase,
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it('shows an explicit backup-and-rebuild action without running recovery on render or cancel', () => {
    render(
      <BackendStartupFailureDialog
        failure={{
          reason: 'backend_recoverable_database_corruption',
          backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
          backendBoundaryStage: 'database.recoverable_corruption',
        }}
      />
    );

    expect(screen.getByText('common.backendStartup.recoverableDatabaseCorruption.title')).toBeInTheDocument();
    expect(screen.getByText('common.backendStartup.recoverableDatabaseCorruption.description')).toBeInTheDocument();
    expect(screen.getByText('common.backendStartup.recoverableDatabaseCorruption.diagnosticsHint')).toBeInTheDocument();
    expect(mocks.recoverCorruptedDatabase).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /common.cancel/ }));

    expect(mocks.recoverCorruptedDatabase).not.toHaveBeenCalled();
  });

  it('runs recovery only after the user confirms rebuild', async () => {
    mocks.recoverCorruptedDatabase.mockResolvedValue(undefined);

    render(
      <BackendStartupFailureDialog
        failure={{
          reason: 'backend_recoverable_database_corruption',
          backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
          backendBoundaryStage: 'database.recoverable_corruption',
        }}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /common.backendStartup.recoverableDatabaseCorruption.confirmRebuild/ })
    );

    await waitFor(() => expect(mocks.recoverCorruptedDatabase).toHaveBeenCalledOnce());
  });

  it('surfaces recovery failures without retrying automatically', async () => {
    mocks.recoverCorruptedDatabase.mockRejectedValue(new Error('rebuild failed'));

    render(
      <BackendStartupFailureDialog
        failure={{
          reason: 'backend_recoverable_database_corruption',
          backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
          backendBoundaryStage: 'database.recoverable_corruption',
        }}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /common.backendStartup.recoverableDatabaseCorruption.confirmRebuild/ })
    );

    await waitFor(() =>
      expect(mocks.messageError).toHaveBeenCalledWith(
        'common.backendStartup.recoverableDatabaseCorruption.rebuildFailed'
      )
    );
    expect(mocks.recoverCorruptedDatabase).toHaveBeenCalledOnce();
  });

  it('shows startup directory guidance with diagnostics instead of download', async () => {
    const failure = {
      reason: 'backend_startup_directory_unavailable' as const,
      startupDirectoryIssueKind: 'permission_denied' as const,
    };

    render(<BackendStartupFailureDialog failure={failure} />);

    expect(shouldShowBackendStartupFailureDialog(failure)).toBe(true);
    expect(screen.getByText('common.backendStartup.startupDirectory.title')).toBeInTheDocument();
    expect(screen.getByText('common.backendStartup.startupDirectory.description')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /common.backendStartup.startupDirectory.sendDiagnostics/ }));
    await waitFor(() =>
      expect(mocks.feedbackModal).toHaveBeenLastCalledWith({
        defaultModule: 'system-settings',
        feedbackExtra: {
          reason: 'backend_startup_directory_unavailable',
          startupDirectoryIssueKind: 'permission_denied',
        },
        feedbackTags: {
          'evaos.backend_startup_failure.reason': 'backend_startup_directory_unavailable',
          'evaos.backend_startup_failure.startup_directory_issue_kind': 'permission_denied',
        },
        onCancel: expect.any(Function),
        visible: true,
      })
    );
    expect(
      screen.queryByRole('button', { name: /common.backendStartup.incompleteInstallation.downloadLatest/ })
    ).not.toBeInTheDocument();
  });

  it('uses the unavailable-directory fallback when diagnostics omit an issue kind', async () => {
    const failure = {
      reason: 'backend_startup_directory_unavailable' as const,
    };

    render(<BackendStartupFailureDialog failure={failure} />);

    fireEvent.click(screen.getByRole('button', { name: /common.backendStartup.startupDirectory.sendDiagnostics/ }));
    await waitFor(() =>
      expect(mocks.feedbackModal).toHaveBeenLastCalledWith(
        expect.objectContaining({
          feedbackExtra: expect.objectContaining({
            startupDirectoryIssueKind: 'missing_or_unavailable_directory',
          }),
          feedbackTags: expect.objectContaining({
            'evaos.backend_startup_failure.startup_directory_issue_kind': 'missing_or_unavailable_directory',
          }),
          visible: true,
        })
      )
    );
  });
});
