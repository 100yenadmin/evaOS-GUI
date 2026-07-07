import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendStartupFailureDialog } from '@/renderer/components/layout/BackendStartupFailureDialog';

const mocks = vi.hoisted(() => ({
  recoverCorruptedDatabase: vi.fn(),
  messageError: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
});
