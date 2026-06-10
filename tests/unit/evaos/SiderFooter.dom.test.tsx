/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

function mockRect(element: Element, rect: Partial<DOMRect>): void {
  const fullRect = {
    x: rect.x ?? rect.left ?? 0,
    y: rect.y ?? rect.top ?? 0,
    top: rect.top ?? rect.y ?? 0,
    left: rect.left ?? rect.x ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    right: rect.right ?? (rect.left ?? rect.x ?? 0) + (rect.width ?? 0),
    bottom: rect.bottom ?? (rect.top ?? rect.y ?? 0) + (rect.height ?? 0),
    toJSON: () => ({}),
  } as DOMRect;

  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(fullRect);
}

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

  it('starts broker sign-in from a footer-coordinate event when the event target is not the button', () => {
    const onSignInClick = vi.fn();

    render(<SiderFooter {...baseProps} showSignIn onSignInClick={onSignInClick} />);

    const footer = document.querySelector('.sider-footer');
    const signIn = screen.getByRole('button', { name: 'Sign In' });
    expect(footer).toBeTruthy();
    mockRect(footer as Element, { left: 0, top: 700, width: 220, height: 80 });
    mockRect(signIn, { left: 116, top: 728, width: 92, height: 34 });

    fireEvent.mouseUp(document, { clientX: 160, clientY: 746 });

    expect(onSignInClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the neighboring footer settings action clickable from the same capture path', () => {
    const onSettingsClick = vi.fn();

    render(<SiderFooter {...baseProps} onSettingsClick={onSettingsClick} showSignIn onSignInClick={vi.fn()} />);

    const footer = document.querySelector('.sider-footer');
    const settings = screen.getByRole('button', { name: 'common.settings' });
    expect(footer).toBeTruthy();
    mockRect(footer as Element, { left: 0, top: 700, width: 220, height: 80 });
    mockRect(settings, { left: 8, top: 728, width: 102, height: 34 });

    fireEvent.mouseUp(document, { clientX: 48, clientY: 746 });

    expect(onSettingsClick).toHaveBeenCalledTimes(1);
  });
});
