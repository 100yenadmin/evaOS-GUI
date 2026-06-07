/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SystemModalContent from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent';

const ipcMocks = vi.hoisted(() => ({
  getStartOnBootStatus: vi.fn(() =>
    Promise.resolve({ success: true, data: { supported: true, enabled: false, isPackaged: true, platform: 'darwin' } })
  ),
  getGpuStatus: vi.fn(() => Promise.resolve({ success: true, data: null })),
  getCloseToTray: vi.fn(() => Promise.resolve(false)),
  systemInfo: vi.fn(() =>
    Promise.resolve({
      cacheDir: '/Users/lume/.aionui-config',
      workDir: '/Users/lume/.aionui',
      logDir: '/Users/lume/Library/Logs/AionUi',
      platform: 'darwin',
      arch: 'arm64',
    })
  ),
  openFolderWith: vi.fn(() => Promise.resolve()),
  updateSystemInfo: vi.fn(() => Promise.resolve()),
  restart: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      getStartOnBootStatus: { invoke: ipcMocks.getStartOnBootStatus },
      getGpuStatus: { invoke: ipcMocks.getGpuStatus },
      systemInfo: { invoke: ipcMocks.systemInfo },
      updateSystemInfo: { invoke: ipcMocks.updateSystemInfo },
      restart: { invoke: ipcMocks.restart },
    },
    systemSettings: {
      getCloseToTray: { invoke: ipcMocks.getCloseToTray },
      setCloseToTray: { invoke: vi.fn(() => Promise.resolve()) },
    },
    shell: {
      openFolderWith: { invoke: ipcMocks.openFolderWith },
    },
    dialog: {
      showOpen: { invoke: vi.fn(() => Promise.resolve([])) },
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
      })[key] ?? key,
  }),
}));

function renderSystemModalContent() {
  return render(
    <ConfigProvider>
      <SystemModalContent />
    </ConfigProvider>
  );
}

describe('SystemModalContent evaOS beta path presentation', () => {
  beforeEach(() => {
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('presents evaOS Workbench paths while hiding compatibility AionUi storage paths', async () => {
    const { container } = renderSystemModalContent();

    expect(await screen.findByText('/Users/lume/.evaos-workbench')).toBeInTheDocument();
    expect(await screen.findByText('/Users/lume/Library/Logs/evaOS Workbench Beta')).toBeInTheDocument();

    await waitFor(() => expect(container.textContent).not.toContain('/Users/lume/.aionui'));
    expect(container.textContent).not.toContain('/Users/lume/Library/Logs/AionUi');
  });
});
