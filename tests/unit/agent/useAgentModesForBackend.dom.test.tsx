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
});
