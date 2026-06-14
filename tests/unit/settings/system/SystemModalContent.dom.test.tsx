/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import SystemModalContent from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent';

const {
  getStartOnBootStatus,
  getGpuStatus,
  getCloseToTray,
  systemInfoMock,
  updateSystemInfoMock,
  restartMock,
  showOpenMock,
  messageInfoMock,
} = vi.hoisted(() => ({
  getStartOnBootStatus: vi.fn(() =>
    Promise.resolve({ success: true, data: { supported: true, enabled: false, isPackaged: true, platform: 'darwin' } })
  ),
  getGpuStatus: vi.fn(() => Promise.resolve({ success: true, data: null })),
  getCloseToTray: vi.fn(() => Promise.resolve(false)),
  systemInfoMock: vi.fn(),
  updateSystemInfoMock: vi.fn(() => Promise.resolve()),
  restartMock: vi.fn(() => Promise.resolve({ restarted: true, manualRestartRequired: false })),
  showOpenMock: vi.fn(() => Promise.resolve([])),
  messageInfoMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      getStartOnBootStatus: { invoke: getStartOnBootStatus },
      getGpuStatus: { invoke: getGpuStatus },
      systemInfo: { invoke: systemInfoMock },
      updateSystemInfo: { invoke: updateSystemInfoMock },
      restart: { invoke: restartMock },
    },
    systemSettings: {
      getCloseToTray: { invoke: getCloseToTray },
      setCloseToTray: { invoke: vi.fn(() => Promise.resolve()) },
    },
    shell: {
      openFolderWith: { invoke: vi.fn(() => Promise.resolve()) },
    },
    dialog: {
      showOpen: { invoke: showOpenMock },
    },
  },
}));

vi.mock('@/common/config/configService', () => ({
  configService: {
    get: vi.fn(() => undefined),
    set: vi.fn(() => Promise.resolve()),
    setLocal: vi.fn(),
  },
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
}));

vi.mock('@/renderer/components/base/AionScrollArea', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/base/FeedbackButton', () => ({
  default: () => <button type='button'>settings.oneClickFeedback</button>,
}));

vi.mock('@/renderer/components/settings/LanguageSwitcher', () => ({
  default: () => <div data-testid='language-switcher'>LanguageSwitcher</div>,
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/SystemModalContent/DevSettings', () => ({
  default: () => <div data-testid='dev-settings'>DevSettings</div>,
}));

vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'modal',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'settings.workDir': 'Work directory',
        'settings.logDir': 'Log directory',
        'settings.dirNotConfigured': 'Not configured',
        'settings.changeWorkDir': 'Change work directory',
        'settings.changeLogDir': 'Change log directory',
        'settings.updateConfirm': 'Update paths?',
        'settings.restartConfirm': 'Restart to apply changes.',
        'settings.restartManualRequired': 'Restart manually to apply changes.',
      })[key] ?? key,
  }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      ...actual.Message,
      info: messageInfoMock,
    },
    Modal: {
      ...actual.Modal,
      useModal: () => [
        {
          confirm: ({ onOk }: { onOk?: () => void }) => {
            onOk?.();
          },
        },
        null,
      ],
    },
  };
});

const defaultSystemInfo = {
  cacheDir: '/Users/lume/.aionui-config',
  workDir: '/Users/lume/.aionui',
  logDir: '/Users/lume/Library/Logs/AionUi',
  platform: 'darwin',
  arch: 'arm64',
};

function renderSystemModalContent() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ConfigProvider>
        <SystemModalContent />
      </ConfigProvider>
    </SWRConfig>
  );
}

describe('SystemModalContent evaOS directory settings', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    systemInfoMock.mockResolvedValue(defaultSystemInfo);
    updateSystemInfoMock.mockResolvedValue(undefined);
    restartMock.mockResolvedValue({ restarted: true, manualRestartRequired: false });
    showOpenMock.mockResolvedValue([]);
  });

  it('presents evaOS Workbench paths while hiding compatibility AionUi storage paths', async () => {
    const { container } = renderSystemModalContent();

    expect(await screen.findByText('/Users/lume/.evaos-workbench')).toBeInTheDocument();
    expect(await screen.findByText('/Users/lume/Library/Logs/evaOS Workbench Beta')).toBeInTheDocument();

    await waitFor(() => expect(container.textContent).not.toContain('/Users/lume/.aionui'));
    expect(container.textContent).not.toContain('/Users/lume/Library/Logs/AionUi');
  });

  it('persists a selected log directory without rewriting the masked work directory', async () => {
    const user = userEvent.setup();
    showOpenMock.mockResolvedValueOnce(['/Users/lume/Library/Logs/evaOS Workbench Beta Custom']);
    renderSystemModalContent();

    await screen.findByText('/Users/lume/Library/Logs/evaOS Workbench Beta');
    const logDirItem = screen.getByText('Log directory').closest('.arco-form-item');
    expect(logDirItem).not.toBeNull();

    await user.click(within(logDirItem as HTMLElement).getByRole('button'));

    await waitFor(() => {
      expect(updateSystemInfoMock).toHaveBeenCalledWith({
        cacheDir: '/Users/lume/.aionui-config',
        workDir: '/Users/lume/.aionui',
        logDir: '/Users/lume/Library/Logs/evaOS Workbench Beta Custom',
      });
    });
    expect(restartMock).toHaveBeenCalledTimes(1);
  });

  it('persists a selected work directory with the current log directory', async () => {
    const user = userEvent.setup();
    showOpenMock.mockResolvedValueOnce(['/Users/lume/.evaos-workbench-custom']);
    renderSystemModalContent();

    await screen.findByText('/Users/lume/.evaos-workbench');
    const workDirItem = screen.getByText('Work directory').closest('.arco-form-item');
    expect(workDirItem).not.toBeNull();

    await user.click(within(workDirItem as HTMLElement).getByRole('button'));

    await waitFor(() => {
      expect(updateSystemInfoMock).toHaveBeenCalledWith({
        cacheDir: '/Users/lume/.aionui-config',
        workDir: '/Users/lume/.evaos-workbench-custom',
        logDir: '/Users/lume/Library/Logs/AionUi',
      });
    });
  });

  it('shows the update failure reason and restores visible paths when changing a directory fails', async () => {
    const user = userEvent.setup();
    updateSystemInfoMock.mockRejectedValueOnce(new Error('permission denied'));
    showOpenMock.mockResolvedValueOnce(['/Users/lume/.evaos-workbench-custom']);
    const { container } = renderSystemModalContent();

    await screen.findByText('/Users/lume/.evaos-workbench');
    const workDirItem = screen.getByText('Work directory').closest('.arco-form-item');
    expect(workDirItem).not.toBeNull();

    await user.click(within(workDirItem as HTMLElement).getByRole('button'));

    await screen.findByText('permission denied');
    expect(container.textContent).toContain('/Users/lume/.evaos-workbench');
    expect(container.textContent).toContain('/Users/lume/Library/Logs/evaOS Workbench Beta');
    expect(restartMock).not.toHaveBeenCalled();
  });

  it('tells the user to restart manually when dev mode cannot relaunch automatically', async () => {
    const user = userEvent.setup();
    restartMock.mockResolvedValueOnce({ restarted: false, manualRestartRequired: true, reason: 'dev-mode' });
    showOpenMock.mockResolvedValueOnce(['/Users/lume/Library/Logs/evaOS Workbench Beta Custom']);
    renderSystemModalContent();

    await screen.findByText('/Users/lume/Library/Logs/evaOS Workbench Beta');
    const logDirItem = screen.getByText('Log directory').closest('.arco-form-item');
    expect(logDirItem).not.toBeNull();

    await user.click(within(logDirItem as HTMLElement).getByRole('button'));

    await waitFor(() => {
      expect(updateSystemInfoMock).toHaveBeenCalledWith({
        cacheDir: '/Users/lume/.aionui-config',
        workDir: '/Users/lume/.aionui',
        logDir: '/Users/lume/Library/Logs/evaOS Workbench Beta Custom',
      });
    });
    expect(restartMock).toHaveBeenCalledTimes(1);
    expect(messageInfoMock).toHaveBeenCalledWith('Restart manually to apply changes.');
  });
});
