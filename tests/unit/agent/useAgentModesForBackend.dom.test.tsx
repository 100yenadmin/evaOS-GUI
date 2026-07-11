/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAgentModesForBackend } from '@/renderer/hooks/agent/useAgentModesForBackend';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getConfig } = vi.hoisted(() => ({ getConfig: vi.fn() }));

vi.mock('@/common/config/configService', () => ({
  configService: { get: getConfig },
}));

describe('useAgentModesForBackend', () => {
  beforeEach(() => {
    getConfig.mockReset();
  });

  it('uses cached backend modes while filtering unsafe evaOS beta modes', async () => {
    getConfig.mockImplementation((key: string) => {
      if (key === 'acp.cachedModes') {
        return {
          claude: {
            available_modes: [
              { id: 'default', name: 'Default' },
              { id: 'bypassPermissions', name: 'Bypass permissions' },
            ],
          },
        };
      }
      return undefined;
    });

    const { result } = renderHook(() => useAgentModesForBackend('claude'));

    await waitFor(() => expect(result.current).toEqual([{ value: 'default', label: 'Default' }]));
  });

  it('falls back to cached config options and filters unsafe values', async () => {
    getConfig.mockImplementation((key: string) => {
      if (key === 'acp.cachedModes') return {};
      if (key === 'acp.cached_config_options') {
        return {
          claude: [
            {
              id: 'mode',
              category: 'mode',
              type: 'select',
              options: [
                { value: 'default', name: 'Default' },
                { value: 'bypassPermissions', name: 'Bypass permissions' },
              ],
            },
          ],
        };
      }
      return undefined;
    });

    const { result } = renderHook(() => useAgentModesForBackend('claude'));

    await waitFor(() => expect(result.current).toEqual([{ value: 'default', label: 'Default' }]));
  });

  it('uses the filtered static fallback when neither cache has modes', () => {
    getConfig.mockReturnValue(undefined);

    const { result } = renderHook(() => useAgentModesForBackend('codex'));

    expect(result.current.map((mode) => mode.value)).toEqual(['read-only', 'auto']);
  });

  it('returns no modes when the backend is absent', () => {
    getConfig.mockReturnValue(undefined);

    const { result } = renderHook(() => useAgentModesForBackend(undefined));

    expect(result.current).toEqual([]);
  });
});
