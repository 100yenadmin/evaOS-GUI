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
  openEvaosExternalUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'modal',
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: platformMocks.isElectronDesktop,
  openEvaosExternalUrl: platformMocks.openEvaosExternalUrl,
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
    const { container } = renderAbout();

    expect(screen.getByText(EVAOS_BETA_ABOUT_LINKS.appName)).toBeInTheDocument();
    expect(screen.queryByText('AionUi')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/AionUi|\.aionui/i);
  });

  it('shows the beta support and released macOS fallback notice', () => {
    renderAbout();

    expect(screen.getByText(EVAOS_BETA_SUPPORT_NOTICE.title)).toBeInTheDocument();
    expect(screen.getByText(EVAOS_BETA_SUPPORT_NOTICE.body)).toBeInTheDocument();
    expect(screen.getByText(EVAOS_BETA_SUPPORT_NOTICE.diagnostics)).toBeInTheDocument();
    expect(screen.getByText(EVAOS_BETA_SUPPORT_NOTICE.supportRoute)).toBeInTheDocument();
  });

  it('shows support-grade beta build identity metadata', () => {
    renderAbout();

    EVAOS_BETA_BUILD_METADATA.forEach((item) => {
      expect(screen.getByText(item.label)).toBeInTheDocument();
      expect(screen.getAllByText(item.value).length).toBeGreaterThan(0);
    });
  });

  it('keeps release-control breadcrumbs out of the About build identity', () => {
    renderAbout();

    expect(screen.queryByText('Release repo')).not.toBeInTheDocument();
    expect(screen.queryByText(/github\.com\/100yenadmin\//i)).not.toBeInTheDocument();
  });

  it('routes About support links to evaOS-owned release surfaces only', async () => {
    const user = userEvent.setup();
    renderAbout();

    expect(Object.values(EVAOS_BETA_ABOUT_LINKS).join(' ')).not.toMatch(/AionUi|iOfficeAI|aionui\.com/i);

    await user.click(screen.getByLabelText('Open ElectricSheep'));
    await user.click(screen.getByText(EVAOS_BETA_SUPPORT_NOTICE.supportRoute));
    await user.click(screen.getByText('settings.contactMe'));

    expect(platformMocks.openEvaosExternalUrl).toHaveBeenCalledWith(EVAOS_BETA_ABOUT_LINKS.website);
    expect(platformMocks.openEvaosExternalUrl).toHaveBeenCalledWith(EVAOS_BETA_ABOUT_LINKS.support);
    expect(platformMocks.openEvaosExternalUrl).not.toHaveBeenCalledWith(expect.stringContaining('docs'));
    expect(platformMocks.openEvaosExternalUrl).not.toHaveBeenCalledWith(expect.stringContaining('releases'));
    expect(platformMocks.openEvaosExternalUrl).not.toHaveBeenCalledWith(expect.stringContaining('iOfficeAI/AionUi'));
    expect(platformMocks.openEvaosExternalUrl).not.toHaveBeenCalledWith(expect.stringContaining('aionui.com'));
  });

  it('keeps bug reporting in-app instead of linking to broken external issue surfaces', async () => {
    const user = userEvent.setup();
    renderAbout();

    expect(screen.getByTestId('feedback-modal')).toHaveTextContent('false');

    await user.click(screen.getByText('settings.bugReport'));

    expect(screen.getByTestId('feedback-modal')).toHaveTextContent('true');
    expect(platformMocks.openEvaosExternalUrl).not.toHaveBeenCalledWith(expect.stringContaining('github.com'));
  });
});
