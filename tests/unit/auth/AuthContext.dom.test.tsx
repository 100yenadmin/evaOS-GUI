/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('AuthContext desktop runtime detection', () => {
  afterEach(() => {
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
    vi.unstubAllGlobals();
  });

  it('detects Electron at refresh time when preload injects electronAPI after module import', async () => {
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { AuthProvider, useAuth } = await import('@/renderer/hooks/context/AuthContext');
    (window as typeof window & { electronAPI?: unknown }).electronAPI = {
      emit: vi.fn(),
      on: vi.fn(),
    };

    const Probe: React.FC = () => {
      const { ready, status } = useAuth();
      return (
        <div>
          {status}:{String(ready)}
        </div>
      );
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText('authenticated:true')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
