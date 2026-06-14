/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
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

const signedOutBrokerSession = {
  success: true,
  data: {
    state: 'signed_out',
    authenticated: false,
    expired: false,
    source: 'none',
    message: 'No evaOS desktop session is active.',
  },
};

const activeBrokerSession = {
  success: true,
  data: {
    state: 'authenticated',
    authenticated: true,
    expired: false,
    source: 'callback',
    message: 'evaOS desktop session is active.',
  },
};

describe('Router deep-link listener', () => {
  beforeEach(() => {
    authMock.status = 'unauthenticated';
    brokerMock.getSessionStatus.mockReset();
    brokerMock.getSessionStatus.mockResolvedValue(signedOutBrokerSession);
    bridgeMock.deepLinkHandlers.clear();
    window.location.hash = '#/login';
  });

  it('allows broker desktop-session auth to carry protected routes when web auth is not hydrated', async () => {
    window.location.hash = '#/guid';
    brokerMock.getSessionStatus.mockResolvedValue(activeBrokerSession);

    const { getByTestId } = render(<Router layout={<div data-testid='protected-layout' />} />);

    await waitFor(() => {
      expect(getByTestId('protected-layout')).toBeInTheDocument();
    });
  });

  it('redirects the login route when broker desktop-session auth is already active', async () => {
    window.location.hash = '#/login';
    brokerMock.getSessionStatus.mockResolvedValue(activeBrokerSession);

    const { getByTestId, queryByTestId } = render(<Router layout={<div data-testid='protected-layout' />} />);

    await waitFor(() => {
      expect(getByTestId('protected-layout')).toBeInTheDocument();
    });
    expect(queryByTestId('login-page')).not.toBeInTheDocument();
  });

  it('handles desktop-session imports before legacy web auth is established', async () => {
    const importedEvents: Array<{ source?: string; confirmed?: boolean }> = [];
    const handleImported = (event: Event) => {
      importedEvents.push((event as CustomEvent).detail);
    };
    window.addEventListener('evaos:desktop-session-imported', handleImported);
    brokerMock.getSessionStatus.mockResolvedValueOnce(signedOutBrokerSession).mockResolvedValue(activeBrokerSession);

    render(<Router layout={<div data-testid='protected-layout' />} />);

    await waitFor(() => {
      expect(bridgeMock.deepLinkHandlers.size).toBe(1);
    });
    await waitFor(() => {
      expect(brokerMock.getSessionStatus).toHaveBeenCalledTimes(1);
    });
    brokerMock.getSessionStatus.mockClear();

    await act(async () => {
      bridgeMock.deepLinkHandlers.forEach((handler) =>
        handler({ action: 'evaos-auth/session-imported', params: { source: 'loopback' } })
      );
    });

    await waitFor(() => {
      expect(brokerMock.getSessionStatus).toHaveBeenCalled();
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
    await waitFor(() => {
      expect(brokerMock.getSessionStatus).toHaveBeenCalledTimes(1);
    });
    brokerMock.getSessionStatus.mockClear();

    bridgeMock.deepLinkHandlers.forEach((handler) =>
      handler({ action: 'add-provider', params: { base_url: 'https://provider.example', api_key: 'sk-test' } })
    );

    expect(brokerMock.getSessionStatus).not.toHaveBeenCalled();
    expect(importedEvents).toEqual([]);

    window.removeEventListener('evaos:desktop-session-imported', handleImported);
  });
});
