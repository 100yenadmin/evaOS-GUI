/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useThrottle from '@/renderer/hooks/ui/useThrottle';

describe('useThrottle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears a pending trailing call when the component unmounts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T12:00:00.000Z'));
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useThrottle(callback, 100, [callback]));

    act(() => {
      result.current('first');
    });
    expect(callback).toHaveBeenCalledWith('first');

    vi.setSystemTime(new Date('2026-07-07T12:00:00.050Z'));
    act(() => {
      result.current('second');
    });
    expect(callback).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
