/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SiderFooter from '@/renderer/components/layout/Sider/SiderFooter';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const baseProps = {
  isMobile: false,
  isSettings: false,
  collapsed: false,
  theme: 'light',
  siderTooltipProps: {},
  onSettingsClick: vi.fn(),
  onThemeToggle: vi.fn(),
};

describe('SiderFooter auth controls', () => {
  it('starts broker sign-in from the rendered footer button', async () => {
    const user = userEvent.setup();
    const onSignInClick = vi.fn();

    render(<SiderFooter {...baseProps} showSignIn onSignInClick={onSignInClick} />);

    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(onSignInClick).toHaveBeenCalledTimes(1);
  });

  it('starts broker sign-out from the rendered footer button', async () => {
    const user = userEvent.setup();
    const onLogoutClick = vi.fn();

    render(<SiderFooter {...baseProps} showLogout onLogoutClick={onLogoutClick} />);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(onLogoutClick).toHaveBeenCalledTimes(1);
  });
});
