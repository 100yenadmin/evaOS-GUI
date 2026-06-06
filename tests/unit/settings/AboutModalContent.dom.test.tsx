/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AboutModalContent, {
  EVAOS_BETA_ABOUT_LINKS,
  EVAOS_BETA_BUILD_METADATA,
  EVAOS_BETA_SUPPORT_NOTICE,
} from '@/renderer/components/settings/SettingsModal/contents/AboutModalContent';

const platformMocks = vi.hoisted(() => ({
  isElectronDesktop: vi.fn(() => true),
  openExternalUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'modal',
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: platformMocks.isElectronDesktop,
  openExternalUrl: platformMocks.openExternalUrl,
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/FeedbackReportModal', () => ({
  default: ({ visible }: { visible: boolean }) => <div data-testid='feedback-modal'>{String(visible)}</div>,
}));

function renderAbout() {
  return render(
    <ConfigProvider>
      <AboutModalContent />
    </ConfigProvider>
  );
}

describe('AboutModalContent evaOS beta identity', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders beta app identity instead of upstream AionUi', () => {
    renderAbout();

    expect(screen.getByText(EVAOS_BETA_ABOUT_LINKS.appName)).toBeInTheDocument();
    expect(screen.queryByText('AionUi')).not.toBeInTheDocument();
  });

  it('shows the beta support and released macOS fallback notice', () => {
    renderAbout();

    expect(screen.getByText(EVAOS_BETA_SUPPORT_NOTICE.title)).toBeInTheDocument();
    expect(screen.getByText(EVAOS_BETA_SUPPORT_NOTICE.body)).toBeInTheDocument();
    expect(screen.getByText(EVAOS_BETA_SUPPORT_NOTICE.supportRoute)).toBeInTheDocument();
  });

  it('shows support-grade beta build identity metadata', () => {
    renderAbout();

    EVAOS_BETA_BUILD_METADATA.forEach((item) => {
      expect(screen.getByText(item.label)).toBeInTheDocument();
      expect(screen.getAllByText(item.value).length).toBeGreaterThan(0);
    });
  });

  it('routes About support links to evaOS-owned surfaces', async () => {
    const user = userEvent.setup();
    renderAbout();

    await user.click(screen.getByText('settings.helpDocumentation'));
    await user.click(screen.getByText('settings.updateLog'));
    await user.click(screen.getByText('settings.contactMe'));
    await user.click(screen.getByText('settings.officialWebsite'));

    expect(platformMocks.openExternalUrl).toHaveBeenCalledWith(EVAOS_BETA_ABOUT_LINKS.documentation);
    expect(platformMocks.openExternalUrl).toHaveBeenCalledWith(EVAOS_BETA_ABOUT_LINKS.releases);
    expect(platformMocks.openExternalUrl).toHaveBeenCalledWith(EVAOS_BETA_ABOUT_LINKS.support);
    expect(platformMocks.openExternalUrl).toHaveBeenCalledWith(EVAOS_BETA_ABOUT_LINKS.repository);
    expect(platformMocks.openExternalUrl).not.toHaveBeenCalledWith(expect.stringContaining('iOfficeAI/AionUi'));
    expect(platformMocks.openExternalUrl).not.toHaveBeenCalledWith(expect.stringContaining('aionui.com'));
  });
});
