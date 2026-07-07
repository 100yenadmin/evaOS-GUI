/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCronSchedule,
  formatCronRunConversationTitle,
  getCurrentCronTimeZone,
  resolveCronJobId,
} from '@/renderer/pages/cron/cronUtils';

const originalDateTimeFormat = Intl.DateTimeFormat;

describe('cronUtils', () => {
  afterEach(() => {
    Intl.DateTimeFormat = originalDateTimeFormat;
    vi.restoreAllMocks();
  });

  it('uses the current system timezone when building cron schedules', () => {
    Intl.DateTimeFormat = vi.fn(
      () =>
        ({
          resolvedOptions: () => ({ timeZone: 'Asia/Shanghai' }),
        }) as Intl.DateTimeFormat
    ) as unknown as typeof Intl.DateTimeFormat;

    expect(createCronSchedule('0 10 * * *', 'Daily at 10:00')).toEqual({
      kind: 'cron',
      expr: '0 10 * * *',
      tz: 'Asia/Shanghai',
      description: 'Daily at 10:00',
    });
  });

  it('falls back to UTC when timezone resolution fails', () => {
    Intl.DateTimeFormat = vi.fn(() => {
      throw new Error('boom');
    }) as unknown as typeof Intl.DateTimeFormat;

    expect(getCurrentCronTimeZone()).toBe('UTC');
  });

  it('formats new cron run conversation titles with the execution date', () => {
    const localRunAtMs = new Date(2026, 6, 1, 12, 0, 0).getTime();

    expect(formatCronRunConversationTitle('Daily report', localRunAtMs)).toBe('Daily report 01-07-26');
  });

  it('resolves cron job ids from snake_case and camelCase conversation extras', () => {
    expect(resolveCronJobId({ cron_job_id: 'cron-1' } as never)).toBe('cron-1');
    expect(resolveCronJobId({ cronJobId: 'cron-2' } as never)).toBe('cron-2');
    expect(resolveCronJobId({} as never)).toBeUndefined();
  });
});
