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
import type { IEvaosBrokerSessionStatus } from '@/common/evaos/bridgeTypes';

const authMock = vi.hoisted(() => ({
  status: 'authenticated' as 'checking' | 'authenticated' | 'unauthenticated',
  user: null as { id: string; username: string } | null,
}));

const customerContextMock = vi.hoisted(() => ({
  roles: [] as string[],
  scopes: [] as string[],
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
  } as IEvaosBrokerSessionStatus,
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

function renderGuardedRoute(routePath = '/mission-control') {
  return render(
    <MemoryRouter initialEntries={[routePath]}>
      <Routes>
        <Route
          path='/evaos'
          element={
            <EvaosRuntimeRouteGuard routePath='/evaos'>
              <p>evaOS loaded</p>
            </EvaosRuntimeRouteGuard>
          }
        />
        <Route
          path='/hermes'
          element={
            <EvaosRuntimeRouteGuard routePath='/hermes'>
              <p>Hermes loaded</p>
            </EvaosRuntimeRouteGuard>
          }
        />
        <Route
          path='/mission-control'
          element={
            <EvaosRuntimeRouteGuard routePath='/mission-control'>
              <p>Mission Control loaded</p>
            </EvaosRuntimeRouteGuard>
          }
        />
        <Route
          path='/approval-center'
          element={
            <EvaosRuntimeRouteGuard routePath='/approval-center'>
              <p>Approval Center loaded</p>
            </EvaosRuntimeRouteGuard>
          }
        />
        <Route
          path='/terminal'
          element={
            <EvaosRuntimeRouteGuard routePath='/terminal'>
              <p>Terminal loaded</p>
            </EvaosRuntimeRouteGuard>
          }
        />
        <Route
          path='/native-companion'
          element={
            <EvaosRuntimeRouteGuard routePath='/native-companion'>
              <p>Native companion loaded</p>
            </EvaosRuntimeRouteGuard>
          }
        />
        <Route
          path='/people-access'
          element={
            <EvaosRuntimeRouteGuard routePath='/people-access'>
              <p>People Access loaded</p>
            </EvaosRuntimeRouteGuard>
          }
        />
        <Route
          path='/company-brain'
          element={
            <EvaosRuntimeRouteGuard routePath='/company-brain'>
              <p>Company Brain loaded</p>
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
    customerContextMock.scopes = [];
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
      scopes: customerContextMock.scopes,
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

    renderGuardedRoute();

    expect(screen.getByText('Mission Control loaded')).toBeInTheDocument();
  });

  it('keys the customer context to the broker session identity before evaluating runtime access', () => {
    authMock.user = null;
    customerContextMock.roles = ['owner'];

    renderGuardedRoute();

    expect(customerContextMock.useEvaosCustomerContext).toHaveBeenCalledWith(
      true,
      expect.stringContaining('admin@100yen.org'),
      undefined
    );
  });

  it('preserves shared customer context while a newly mounted broker check is pending', () => {
    brokerSessionMock.loading = true;
    brokerSessionMock.session = null as unknown as IEvaosBrokerSessionStatus;

    renderGuardedRoute('/people-access');

    expect(customerContextMock.useEvaosCustomerContext).toHaveBeenCalledWith(false, undefined, {
      clearOnUnauthenticated: false,
    });
  });

  it('holds broker-policy product routes behind a loader while customer context is still loading', () => {
    customerContextMock.loaded = false;
    customerContextMock.loading = true;

    renderGuardedRoute();

    expect(screen.queryByText('Mission Control loaded')).not.toBeInTheDocument();
    expect(document.querySelector('.arco-spin')).toBeInTheDocument();
  });

  it('fails closed to the assistant route for member sessions that deep-link into admin runtimes', async () => {
    customerContextMock.roles = ['member'];
    brokerSessionMock.session = {
      ...brokerSessionMock.session,
      userEmail: 'member@example.test',
    };

    renderGuardedRoute();

    await waitFor(() => expect(screen.getByText('Guid fallback')).toBeInTheDocument());
    expect(screen.queryByText('Mission Control loaded')).not.toBeInTheDocument();
  });

  it('fails closed for member sessions that deep-link into Terminal', async () => {
    customerContextMock.roles = ['member'];
    brokerSessionMock.session = {
      ...brokerSessionMock.session,
      userEmail: 'member@example.test',
    };

    renderGuardedRoute('/terminal');

    await waitFor(() => expect(screen.getByText('Guid fallback')).toBeInTheDocument());
    expect(screen.queryByText('Terminal loaded')).not.toBeInTheDocument();
  });

  it('fails closed to login before the desktop/web session is authenticated', async () => {
    authMock.status = 'unauthenticated';
    brokerSessionMock.session = {
      state: 'missing',
      authenticated: false,
      expired: false,
      source: 'none',
      message: 'Sign in required',
    };
    customerContextMock.roles = ['owner'];

    renderGuardedRoute();

    await waitFor(() => expect(screen.getByText('Login fallback')).toBeInTheDocument());
    expect(screen.queryByText('Mission Control loaded')).not.toBeInTheDocument();
  });

  it('allows a valid broker desktop session to carry shell auth when web auth is not hydrated', () => {
    authMock.status = 'unauthenticated';
    customerContextMock.roles = ['owner'];

    renderGuardedRoute();

    expect(screen.getByText('Mission Control loaded')).toBeInTheDocument();
    expect(screen.queryByText('Login fallback')).not.toBeInTheDocument();
    expect(customerContextMock.useEvaosCustomerContext).toHaveBeenCalledWith(
      true,
      expect.stringContaining('admin@100yen.org'),
      undefined
    );
  });

  it('renders Terminal for admin sessions with terminal scope', () => {
    customerContextMock.roles = ['owner'];
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
      scopes: ['access_terminal'],
    }));

    renderGuardedRoute('/terminal');

    expect(screen.getByText('Terminal loaded')).toBeInTheDocument();
  });

  it('denies Terminal when the broker session is missing', async () => {
    brokerSessionMock.session = {
      state: 'missing',
      authenticated: false,
      expired: false,
      source: 'none',
      message: 'Sign in required',
    };

    renderGuardedRoute('/terminal');

    await waitFor(() => expect(screen.getByText('Guid fallback')).toBeInTheDocument());
    expect(screen.queryByText('Terminal loaded')).not.toBeInTheDocument();
  });

  it('denies broker-backed product pages when the broker session is missing', async () => {
    brokerSessionMock.session = {
      state: 'missing',
      authenticated: false,
      expired: false,
      source: 'none',
      message: 'Sign in required',
    };

    renderGuardedRoute('/approval-center');

    await waitFor(() => expect(screen.getByText('Guid fallback')).toBeInTheDocument());
    expect(screen.queryByText('Approval Center loaded')).not.toBeInTheDocument();
  });

  it('allows native companion setup when the broker session is missing', () => {
    brokerSessionMock.session = {
      state: 'missing',
      authenticated: false,
      expired: false,
      source: 'none',
      message: 'Sign in required',
    };

    renderGuardedRoute('/native-companion');

    expect(screen.getByText('Native companion loaded')).toBeInTheDocument();
  });

  it('allows native companion repair but denies direct evaOS and Hermes for employees', async () => {
    customerContextMock.roles = ['member'];
    customerContextMock.scopes = [];
    brokerSessionMock.session = {
      ...brokerSessionMock.session,
      userEmail: 'employee@example.test',
    };

    const { unmount } = renderGuardedRoute('/native-companion');

    expect(screen.getByText('Native companion loaded')).toBeInTheDocument();

    unmount();
    renderGuardedRoute('/evaos');

    await waitFor(() => expect(screen.getByText('Guid fallback')).toBeInTheDocument());
    expect(screen.queryByText('evaOS loaded')).not.toBeInTheDocument();
  });

  it('allows People Access only with the account policy scope or admin override', async () => {
    customerContextMock.roles = ['member'];
    customerContextMock.scopes = [];
    brokerSessionMock.session = {
      ...brokerSessionMock.session,
      userEmail: 'member@example.test',
    };

    renderGuardedRoute('/people-access');

    await waitFor(() => expect(screen.getByText('Guid fallback')).toBeInTheDocument());
    expect(screen.queryByText('People Access loaded')).not.toBeInTheDocument();
  });

  it('renders scoped product routes for role-limited members', () => {
    customerContextMock.roles = ['member'];
    customerContextMock.scopes = ['manage_members'];
    brokerSessionMock.session = {
      ...brokerSessionMock.session,
      userEmail: 'member@example.test',
    };

    renderGuardedRoute('/people-access');

    expect(screen.getByText('People Access loaded')).toBeInTheDocument();
  });

  it('allows Company Brain only for the Electric Sheep admin account', async () => {
    customerContextMock.roles = ['member'];
    customerContextMock.scopes = ['view_company_brain'];
    brokerSessionMock.session = {
      ...brokerSessionMock.session,
      userEmail: 'analyst@example.test',
    };

    renderGuardedRoute('/company-brain');

    await waitFor(() => expect(screen.getByText('Guid fallback')).toBeInTheDocument());
    expect(screen.queryByText('Company Brain loaded')).not.toBeInTheDocument();
  });

  it('allows Company Brain for admin@100yen.org', () => {
    customerContextMock.roles = ['member'];
    customerContextMock.scopes = ['view_company_brain'];
    brokerSessionMock.session = {
      ...brokerSessionMock.session,
      userEmail: 'admin@100yen.org',
    };

    renderGuardedRoute('/company-brain');

    expect(screen.getByText('Company Brain loaded')).toBeInTheDocument();
  });
});
