/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Theme } from '@/renderer/hooks/system/useTheme';

const QUERY = '(prefers-color-scheme: dark)';

function getMediaQueryList(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(QUERY);
}

export function getSystemTheme(): Theme {
  return getMediaQueryList()?.matches ? 'dark' : 'light';
}

export function watchSystemTheme(onChange: (theme: Theme) => void): () => void {
  const mql = getMediaQueryList();
  if (!mql) return () => {};
  const handler = (event: MediaQueryListEvent) => onChange(event.matches ? 'dark' : 'light');
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
}
