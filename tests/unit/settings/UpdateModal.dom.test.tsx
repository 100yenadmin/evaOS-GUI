/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UpdateModal from '@/renderer/components/settings/UpdateModal';
import type { AutoUpdateStatus } from '@/common/update/updateTypes';

const ipcMocks = vi.hoisted(() => ({
  autoUpdateCheck: vi.fn(),
  autoUpdateDownload: vi.fn(),
  autoUpdateQuitAndInstall: vi.fn(),
  messageError: vi.fn(),
  updateCheck: vi.fn(),
  updateDownload: vi.fn(),
  updateOpenDownloadedFile: vi.fn(),
  updateShowDownloadedInFolder: vi.fn(),
  updateOpenListeners: [] as Array<() => void>,
  autoUpdateStatusListeners: [] as Array<(evt: AutoUpdateStatus) => void>,
  downloadProgressListeners: [] as Array<(evt: unknown) => void>,
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
      error: ipcMocks.messageError,
    },
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    autoUpdate: {
      check: { invoke: ipcMocks.autoUpdateCheck },
      download: { invoke: ipcMocks.autoUpdateDownload },
      quitAndInstall: { invoke: ipcMocks.autoUpdateQuitAndInstall },
      status: {
        on: (listener: (evt: AutoUpdateStatus) => void) => {
          ipcMocks.autoUpdateStatusListeners.push(listener);
          return () => {
            const index = ipcMocks.autoUpdateStatusListeners.indexOf(listener);
            if (index >= 0) ipcMocks.autoUpdateStatusListeners.splice(index, 1);
          };
        },
      },
    },
    update: {
      check: { invoke: ipcMocks.updateCheck },
      download: { invoke: ipcMocks.updateDownload },
      openDownloadedFile: { invoke: ipcMocks.updateOpenDownloadedFile },
      showDownloadedInFolder: { invoke: ipcMocks.updateShowDownloadedInFolder },
      open: {
        on: (listener: () => void) => {
          ipcMocks.updateOpenListeners.push(listener);
          return () => {
            const index = ipcMocks.updateOpenListeners.indexOf(listener);
            if (index >= 0) ipcMocks.updateOpenListeners.splice(index, 1);
          };
        },
      },
      downloadProgress: {
        on: (listener: (evt: unknown) => void) => {
          ipcMocks.downloadProgressListeners.push(listener);
          return () => {
            const index = ipcMocks.downloadProgressListeners.indexOf(listener);
            if (index >= 0) ipcMocks.downloadProgressListeners.splice(index, 1);
          };
        },
      },
    },
  },
}));

vi.mock('@/renderer/components/base/AionModal', () => ({
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <div data-testid='update-modal'>{children}</div> : null,
}));

vi.mock('@/renderer/components/Markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/utils/platform', () => ({
  openEvaosExternalUrl: vi.fn(() => Promise.resolve()),
}));

function resetIpcMocks() {
  ipcMocks.autoUpdateCheck.mockReset();
  ipcMocks.autoUpdateDownload.mockReset();
  ipcMocks.autoUpdateQuitAndInstall.mockReset();
  ipcMocks.messageError.mockReset();
  ipcMocks.updateCheck.mockReset();
  ipcMocks.updateDownload.mockReset();
  ipcMocks.updateOpenDownloadedFile.mockReset();
  ipcMocks.updateShowDownloadedInFolder.mockReset();
  ipcMocks.updateOpenListeners.length = 0;
  ipcMocks.autoUpdateStatusListeners.length = 0;
  ipcMocks.downloadProgressListeners.length = 0;
}

function openDownloadedAutoUpdate() {
  render(<UpdateModal />);

  act(() => {
    ipcMocks.autoUpdateStatusListeners.forEach((listener) =>
      listener({
        status: 'available',
        version: '2.1.28',
        releaseNotes: 'ready notes',
      })
    );
    ipcMocks.autoUpdateStatusListeners.forEach((listener) =>
      listener({
        status: 'downloaded',
        version: '2.1.28',
      })
    );
  });
}

describe('UpdateModal evaOS update-check state', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    resetIpcMocks();
  });

  it('does not flash background auto-update errors during a user-triggered manual check', async () => {
    ipcMocks.autoUpdateCheck.mockResolvedValue({
      success: false,
      msg: 'background feed unavailable',
    });
    let resolveManualCheck!: (value: unknown) => void;
    ipcMocks.updateCheck.mockReturnValue(
      new Promise((resolve) => {
        resolveManualCheck = resolve;
      })
    );

    render(<UpdateModal />);

    act(() => {
      window.dispatchEvent(new CustomEvent('aionui-open-update-modal', { detail: { source: 'about' } }));
    });

    expect(await screen.findByText('update.checking')).toBeInTheDocument();
    await waitFor(() => expect(ipcMocks.updateCheck).toHaveBeenCalledTimes(1));

    act(() => {
      ipcMocks.autoUpdateStatusListeners.forEach((listener) =>
        listener({
          status: 'error',
          error: 'transient startup update check failed',
        })
      );
    });

    expect(screen.queryByText('update.errorTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('transient startup update check failed')).not.toBeInTheDocument();

    await act(async () => {
      resolveManualCheck({
        success: true,
        data: {
          currentVersion: '2.1.27',
          updateAvailable: false,
          latest: {
            version: '2.1.27',
            htmlUrl: 'https://github.com/100yenadmin/evaOS-GUI/releases/tag/evaos-beta-v2.1.27-evaos-beta',
          },
        },
      });
    });

    expect(await screen.findByText('update.upToDateTitle')).toBeInTheDocument();
    expect(screen.queryByText('update.errorTitle')).not.toBeInTheDocument();
  });

  it('shows a preparing install state while auto-update install readiness is pending', async () => {
    ipcMocks.autoUpdateQuitAndInstall.mockReturnValue(new Promise(() => {}));
    openDownloadedAutoUpdate();

    expect(await screen.findByText('update.readyToInstall')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /update.installNow/ }));

    expect(await screen.findByText('update.preparingInstall')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update.preparingInstall/ })).toBeDisabled();
  });

  it('surfaces auto-update install readiness failures in the modal', async () => {
    ipcMocks.autoUpdateQuitAndInstall.mockRejectedValue(new Error('native readiness failed'));
    openDownloadedAutoUpdate();

    expect(await screen.findByText('update.readyToInstall')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /update.installNow/ }));

    expect(await screen.findByText('update.errorTitle')).toBeInTheDocument();
    expect(screen.getByText('native readiness failed')).toBeInTheDocument();
  });
});
