/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Router from '@/renderer/components/layout/Router';
import type { DeepLinkPayload } from '@/renderer/hooks/system/useDeepLink';

const authMock = vi.hoisted(() => ({
  status: 'unauthenticated' as 'checking' | 'authenticated' | 'unauthenticated',
}));

const brokerMock = vi.hoisted(() => ({
  getSessionStatus: vi.fn(),
}));

const bridgeMock = vi.hoisted(() => ({
  deepLinkHandlers: new Set<(payload: DeepLinkPayload) => void>(),
}));

vi.mock('@renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({
    status: authMock.status,
  }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  evaosBroker: {
    getSessionStatus: {
      invoke: brokerMock.getSessionStatus,
    },
  },
  deepLink: {
    received: {
      on: vi.fn((handler: (payload: DeepLinkPayload) => void) => {
        bridgeMock.deepLinkHandlers.add(handler);
        return () => {
          bridgeMock.deepLinkHandlers.delete(handler);
        };
      }),
    },
  },
}));

vi.mock('@renderer/evaos/evaosRoutes', () => ({
  renderEvaosRoutes: () => null,
}));

vi.mock('@renderer/pages/login', () => ({
  default: () => <div data-testid='login-page'>Login</div>,
}));

describe('Router deep-link listener', () => {
  beforeEach(() => {
    authMock.status = 'unauthenticated';
    brokerMock.getSessionStatus.mockReset();
    bridgeMock.deepLinkHandlers.clear();
    window.location.hash = '#/login';
  });

  it('handles desktop-session imports before legacy web auth is established', async () => {
    const importedEvents: Array<{ source?: string; confirmed?: boolean }> = [];
    const handleImported = (event: Event) => {
      importedEvents.push((event as CustomEvent).detail);
    };
    window.addEventListener('evaos:desktop-session-imported', handleImported);
    brokerMock.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'authenticated',
        authenticated: true,
        expired: false,
        source: 'callback',
        message: 'evaOS desktop session is active.',
      },
    });

    render(<Router layout={<div data-testid='protected-layout' />} />);

    await waitFor(() => {
      expect(bridgeMock.deepLinkHandlers.size).toBe(1);
    });

    bridgeMock.deepLinkHandlers.forEach((handler) =>
      handler({ action: 'evaos-auth/session-imported', params: { source: 'loopback' } })
    );

    await waitFor(() => {
      expect(brokerMock.getSessionStatus).toHaveBeenCalledTimes(1);
    });
    expect(importedEvents).toEqual([
      { source: 'loopback', confirmed: false },
      { source: 'loopback', confirmed: true },
    ]);

    window.removeEventListener('evaos:desktop-session-imported', handleImported);
  });

  it('keeps non-auth deep links out of the signed-out router listener', async () => {
    const importedEvents: Array<{ source?: string; confirmed?: boolean }> = [];
    const handleImported = (event: Event) => {
      importedEvents.push((event as CustomEvent).detail);
    };
    window.addEventListener('evaos:desktop-session-imported', handleImported);

    render(<Router layout={<div data-testid='protected-layout' />} />);

    await waitFor(() => {
      expect(bridgeMock.deepLinkHandlers.size).toBe(1);
    });

    bridgeMock.deepLinkHandlers.forEach((handler) =>
      handler({ action: 'add-provider', params: { base_url: 'https://provider.example', api_key: 'sk-test' } })
    );

    expect(brokerMock.getSessionStatus).not.toHaveBeenCalled();
    expect(importedEvents).toEqual([]);

    window.removeEventListener('evaos:desktop-session-imported', handleImported);
  });
});
