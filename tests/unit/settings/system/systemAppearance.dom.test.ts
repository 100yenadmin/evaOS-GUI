import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSystemTheme, watchSystemTheme } from '@/renderer/utils/theme/systemAppearance';

type ChangeHandler = (event: { matches: boolean }) => void;

function installMatchMedia(matches: boolean) {
  const handlers = new Set<ChangeHandler>();
  const media = {
    matches,
    addEventListener: vi.fn((_: string, handler: ChangeHandler) => handlers.add(handler)),
    removeEventListener: vi.fn((_: string, handler: ChangeHandler) => handlers.delete(handler)),
  };
  window.matchMedia = vi.fn().mockReturnValue(media) as unknown as typeof window.matchMedia;
  return {
    media,
    fire(nextMatches: boolean) {
      media.matches = nextMatches;
      handlers.forEach((handler) => handler({ matches: nextMatches }));
    },
  };
}

describe('systemAppearance', () => {
  beforeEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('resolves the current system theme from prefers-color-scheme', () => {
    installMatchMedia(true);
    expect(getSystemTheme()).toBe('dark');
    installMatchMedia(false);
    expect(getSystemTheme()).toBe('light');
  });

  it('defaults to light when matchMedia is unavailable', () => {
    expect(getSystemTheme()).toBe('light');
  });

  it('watches system theme changes and unsubscribes cleanly', () => {
    const matchMedia = installMatchMedia(false);
    const onChange = vi.fn();
    const unsubscribe = watchSystemTheme(onChange);

    matchMedia.fire(true);
    expect(onChange).toHaveBeenCalledWith('dark');

    unsubscribe();
    matchMedia.fire(false);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(matchMedia.media.removeEventListener).toHaveBeenCalled();
  });
});
