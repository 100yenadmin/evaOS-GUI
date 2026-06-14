/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useThemeContext } from '@/renderer/hooks/context/ThemeContext';
import { IconDesktop, IconMoon, IconMoonFill, IconSun, IconSunFill } from '@arco-design/web-react/icon';
import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 主题切换器组件 / Theme switcher component
 *
 * 提供明暗模式切换功能
 * Provides light/dark mode switching functionality
 */
export const ThemeSwitcher = () => {
  const { theme, themeMode, setTheme } = useThemeContext();
  const { t } = useTranslation();
  const trackInset = 6;
  const options = [
    { value: 'light' as const, label: t('settings.lightMode'), icon: IconSun, activeIcon: IconSunFill },
    { value: 'dark' as const, label: t('settings.darkMode'), icon: IconMoon, activeIcon: IconMoonFill },
    {
      value: 'system' as const,
      label: t('settings.cssTheme.followSystem'),
      icon: IconDesktop,
      activeIcon: IconDesktop,
    },
  ];
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === themeMode)
  );

  return (
    <div
      className='relative inline-grid p-6px rd-full border border-solid border-[var(--color-border-2)] bg-1 w-full max-w-360px md:w-auto md:min-w-320px'
      role='radiogroup'
      aria-label={t('settings.theme')}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden='true'
        className='absolute rd-full border border-solid border-[var(--color-border-2)] transition-all duration-260 ease-[cubic-bezier(0.2,0.8,0.2,1)]'
        style={{
          top: trackInset,
          bottom: trackInset,
          left: trackInset,
          width: `calc((100% - ${trackInset * 2}px) / ${options.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
          backgroundColor: 'var(--color-fill-2)',
          boxShadow: theme === 'dark' ? '0 1px 4px rgba(0, 0, 0, 0.18)' : '0 2px 8px rgba(0, 0, 0, 0.08)',
        }}
      />
      {options.map((option) => {
        const isActive = themeMode === option.value;
        const Icon = option.icon;
        const ActiveIcon = option.activeIcon;
        const swapsIcon = Icon !== ActiveIcon;

        return (
          <button
            key={option.value}
            type='button'
            role='radio'
            data-theme-option={option.value}
            aria-checked={isActive}
            className='relative z-1 h-33px min-w-0 px-10px md:px-12px rd-full text-13px font-500 inline-flex items-center justify-center gap-6px transition-all duration-180 active:scale-[0.985] disabled:cursor-not-allowed'
            style={{
              color: isActive
                ? theme === 'dark'
                  ? 'var(--color-text-1)'
                  : 'rgb(var(--primary-6))'
                : 'var(--color-text-2)',
              backgroundColor: 'transparent',
              border: '1px solid transparent',
              cursor: isActive ? 'default' : 'pointer',
            }}
            onClick={() => {
              if (!isActive) {
                void setTheme(option.value);
              }
            }}
          >
            <span className='relative inline-flex items-center justify-center w-14px h-14px'>
              <Icon
                style={{
                  fontSize: 14,
                  opacity: isActive && swapsIcon ? 0 : 0.8,
                  transform: isActive && swapsIcon ? 'scale(0.6) rotate(-20deg)' : 'scale(1) rotate(0deg)',
                  transition: 'transform 220ms ease, opacity 220ms ease',
                  position: 'absolute',
                }}
              />
              <ActiveIcon
                style={{
                  fontSize: 14,
                  opacity: isActive && swapsIcon ? 1 : 0,
                  transform: isActive ? 'scale(1.08) rotate(0deg)' : 'scale(0.65) rotate(20deg)',
                  transition: 'transform 220ms ease, opacity 220ms ease',
                  position: 'absolute',
                }}
              />
            </span>
            {option.label}
          </button>
        );
      })}
    </div>
  );
};
