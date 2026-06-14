import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Theme, ThemeSelection } from '@/renderer/hooks/system/useTheme';
import { ThemeSwitcher } from '@/renderer/components/settings/ThemeSwitcher';

const themeContext = vi.hoisted(() => ({
  value: {
    theme: 'light' as Theme,
    themeMode: 'light' as ThemeSelection,
    setTheme: vi.fn(),
  },
}));

vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => themeContext.value,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'settings.theme': 'Theme',
        'settings.lightMode': 'Light',
        'settings.darkMode': 'Dark',
        'settings.cssTheme.followSystem': 'Follow System',
      })[key] ?? key,
  }),
}));

vi.mock('@arco-design/web-react/icon', () => {
  const Icon = ({ label }: { label: string }) => <span aria-hidden='true'>{label}</span>;
  return {
    IconDesktop: () => <Icon label='desktop' />,
    IconMoon: () => <Icon label='moon' />,
    IconMoonFill: () => <Icon label='moon-fill' />,
    IconSun: () => <Icon label='sun' />,
    IconSunFill: () => <Icon label='sun-fill' />,
  };
});

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    themeContext.value = {
      theme: 'light',
      themeMode: 'light',
      setTheme: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('renders light, dark, and follow-system options', () => {
    render(<ThemeSwitcher />);

    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Follow System' })).toHaveAttribute('aria-checked', 'false');
  });

  it('marks Follow System active while the resolved theme remains dark', () => {
    themeContext.value.theme = 'dark';
    themeContext.value.themeMode = 'system';

    render(<ThemeSwitcher />);

    expect(screen.getByRole('radio', { name: 'Follow System' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'false');
  });

  it('selects the system sentinel without changing the resolved theme directly', () => {
    render(<ThemeSwitcher />);

    fireEvent.click(screen.getByRole('radio', { name: 'Follow System' }));

    expect(themeContext.value.setTheme).toHaveBeenCalledWith('system');
  });
});
