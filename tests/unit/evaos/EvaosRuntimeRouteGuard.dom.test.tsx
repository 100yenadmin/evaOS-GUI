/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EvaosRuntimeRouteGuard } from '@/renderer/components/layout/EvaosRuntimeRouteGuard';

const authMock = vi.hoisted(() => ({
  status: 'authenticated' as 'checking' | 'authenticated' | 'unauthenticated',
  user: null as { id: string; username: string } | null,
}));

const customerContextMock = vi.hoisted(() => ({
  roles: [] as string[],
  isOperator: false,
  loaded: true,
  loading: false,
  error: undefined as string | undefined,
  useEvaosCustomerContext: vi.fn(),
}));

const brokerSessionMock = vi.hoisted(() => ({
  loading: false,
  error: null as string | null,
  session: {
    state: 'authenticated' as const,
    authenticated: true,
    expired: false,
    userEmail: 'admin@100yen.org',
    expiresAt: '2026-06-05T12:00:00.000Z',
    source: 'callback' as const,
    message: 'Session active',
  },
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({
    ready: true,
    status: authMock.status,
    user: authMock.user,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    clearAuthCache: vi.fn(),
  }),
}));

vi.mock('@/renderer/hooks/context/EvaosCustomerContext', () => ({
  useEvaosCustomerContext: customerContextMock.useEvaosCustomerContext,
}));

vi.mock('@renderer/hooks/useEvaosBrokerSessionStatus', () => ({
  useEvaosBrokerSessionStatus: () => brokerSessionMock,
  evaosBrokerSessionKey: (session: typeof brokerSessionMock.session | null) =>
    session?.authenticated
      ? [session.state, session.source, session.userEmail, session.expiresAt].filter(Boolean).join('|')
      : undefined,
}));

function renderGuardedMissionControl() {
  return render(
    <MemoryRouter initialEntries={['/mission-control']}>
      <Routes>
        <Route
          path='/mission-control'
          element={
            <EvaosRuntimeRouteGuard routePath='/mission-control'>
              <p>Mission Control loaded</p>
            </EvaosRuntimeRouteGuard>
          }
        />
        <Route path='/guid' element={<p>Guid fallback</p>} />
        <Route path='/login' element={<p>Login fallback</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('EvaosRuntimeRouteGuard', () => {
  beforeEach(() => {
    authMock.status = 'authenticated';
    authMock.user = null;
    customerContextMock.roles = [];
    customerContextMock.isOperator = false;
    customerContextMock.loaded = true;
    customerContextMock.loading = false;
    customerContextMock.error = undefined;
    customerContextMock.useEvaosCustomerContext.mockClear();
    customerContextMock.useEvaosCustomerContext.mockImplementation(() => ({
      targets: [],
      selectedCustomerId: undefined,
      selectedTarget: undefined,
      summaryText: 'test customer context',
      refreshTargets: vi.fn(),
      selectCustomer: vi.fn(),
      roles: customerContextMock.roles,
      isOperator: customerContextMock.isOperator,
      loaded: customerContextMock.loaded,
      loading: customerContextMock.loading,
      error: customerContextMock.error,
    }));
    brokerSessionMock.loading = false;
    brokerSessionMock.error = null;
    brokerSessionMock.session = {
      state: 'authenticated',
      authenticated: true,
      expired: false,
      userEmail: 'admin@100yen.org',
      expiresAt: '2026-06-05T12:00:00.000Z',
      source: 'callback',
      message: 'Session active',
    };
  });

  it('renders admin-only runtime routes for owner sessions', () => {
    customerContextMock.roles = ['owner'];

    renderGuardedMissionControl();

    expect(screen.getByText('Mission Control loaded')).toBeInTheDocument();
  });

  it('keys the customer context to the broker session identity before evaluating runtime access', () => {
    authMock.user = null;
    customerContextMock.roles = ['owner'];

    renderGuardedMissionControl();

    expect(customerContextMock.useEvaosCustomerContext).toHaveBeenCalledWith(
      true,
      expect.stringContaining('admin@100yen.org')
    );
  });

  it('fails closed to the assistant route for member sessions that deep-link into admin runtimes', async () => {
    customerContextMock.roles = ['member'];
    brokerSessionMock.session = {
      ...brokerSessionMock.session,
      userEmail: 'member@example.test',
    };

    renderGuardedMissionControl();

    await waitFor(() => expect(screen.getByText('Guid fallback')).toBeInTheDocument());
    expect(screen.queryByText('Mission Control loaded')).not.toBeInTheDocument();
  });

  it('fails closed to login before the desktop/web session is authenticated', async () => {
    authMock.status = 'unauthenticated';
    customerContextMock.roles = ['owner'];

    renderGuardedMissionControl();

    await waitFor(() => expect(screen.getByText('Login fallback')).toBeInTheDocument());
    expect(screen.queryByText('Mission Control loaded')).not.toBeInTheDocument();
  });
});
