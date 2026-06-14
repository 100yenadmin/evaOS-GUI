// hooks/useTheme.ts
import { configService } from '@/common/config/configService';
import { useCallback, useEffect, useState } from 'react';
import { getSystemTheme, watchSystemTheme } from '@/renderer/utils/theme/systemAppearance';

export type Theme = 'light' | 'dark';
export type ThemeSelection = Theme | 'system';

const DEFAULT_THEME: Theme = 'light';
const THEME_CACHE_KEY = '__aionui_theme';

const applyThemeToDom = (value: Theme) => {
  document.documentElement.setAttribute('data-theme', value);
  document.body.setAttribute('arco-theme', value);
};

const readCachedTheme = (): Theme => {
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY);
    if (cached === 'light' || cached === 'dark') return cached;
  } catch (_e) {
    /* noop */
  }
  return DEFAULT_THEME;
};

const isThemeSelection = (value: unknown): value is ThemeSelection =>
  value === 'light' || value === 'dark' || value === 'system';

const readPersistedThemeSelection = (fallback: ThemeSelection): ThemeSelection => {
  const value = configService.get('theme');
  return isThemeSelection(value) ? value : fallback;
};

const resolveThemeSelection = (selection: ThemeSelection): Theme =>
  selection === 'system' ? getSystemTheme() : selection;

// Apply localStorage hint synchronously to avoid FOUC, then resolve to the
// authoritative value from configService once it has loaded from the backend.
const initTheme = async (): Promise<{ theme: Theme; themeMode: ThemeSelection }> => {
  const hint = readCachedTheme();
  applyThemeToDom(hint);
  try {
    await configService.whenReady();
    const themeMode = readPersistedThemeSelection(hint);
    const theme = resolveThemeSelection(themeMode);
    applyThemeToDom(theme);
    try {
      localStorage.setItem(THEME_CACHE_KEY, theme);
    } catch (_e) {
      /* noop */
    }
    return { theme, themeMode };
  } catch (error) {
    console.error('Failed to load initial theme:', error);
    return { theme: hint, themeMode: hint };
  }
};

// Run theme initialization immediately
let initialThemePromise: Promise<{ theme: Theme; themeMode: ThemeSelection }> | null = null;
if (typeof window !== 'undefined') {
  initialThemePromise = initTheme();
}

const useTheme = (): [Theme, (theme: ThemeSelection) => Promise<void>, ThemeSelection] => {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [themeMode, setThemeModeState] = useState<ThemeSelection>(DEFAULT_THEME);

  // Apply theme to document
  const applyTheme = useCallback((newTheme: Theme) => {
    applyThemeToDom(newTheme);
    try {
      localStorage.setItem(THEME_CACHE_KEY, newTheme);
    } catch (_e) {
      /* noop */
    }
  }, []);

  // Set theme with persistence
  const setTheme = useCallback(
    async (newThemeMode: ThemeSelection) => {
      const nextTheme = resolveThemeSelection(newThemeMode);
      try {
        setThemeModeState(newThemeMode);
        setThemeState(nextTheme);
        applyTheme(nextTheme);
        await configService.set('theme', newThemeMode);
      } catch (error) {
        console.error('Failed to save theme:', error);
        // Revert on error
        setThemeModeState(themeMode);
        setThemeState(theme);
        applyTheme(theme);
      }
    },
    [theme, themeMode, applyTheme]
  );

  // Initialize theme state from the early initialization
  useEffect(() => {
    if (initialThemePromise) {
      initialThemePromise
        .then(({ theme: initialTheme, themeMode: initialThemeMode }) => {
          setThemeState(initialTheme);
          setThemeModeState(initialThemeMode);
        })
        .catch((error) => {
          console.error('Failed to initialize theme:', error);
        });
    }
  }, []);

  useEffect(() => {
    if (themeMode !== 'system') return;
    return watchSystemTheme((nextTheme) => {
      setThemeState(nextTheme);
      applyTheme(nextTheme);
    });
  }, [themeMode, applyTheme]);

  return [theme, setTheme, themeMode];
};

export default useTheme;
