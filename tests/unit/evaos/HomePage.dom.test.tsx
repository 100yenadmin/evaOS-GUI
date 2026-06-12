/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '@/renderer/pages/home';
import type { IEvaosBrokerSessionStatus } from '@/common/evaos/bridgeTypes';

const authMock = vi.hoisted(() => ({
  status: 'authenticated' as 'checking' | 'authenticated' | 'unauthenticated',
  user: null as { id: string; username: string } | null,
}));

const customerContextMock = vi.hoisted(() => ({
  targets: [] as Array<{
    customerId: string;
    displayName: string;
    email?: string;
    status?: string;
    healthStatus?: string;
    isDefault: boolean;
  }>,
  selectedCustomerId: 'proof-customer' as string | undefined,
  roles: [] as string[],
  scopes: [] as string[],
  isOperator: false,
  loaded: true,
  loading: false,
  error: undefined as string | undefined,
  refreshTargets: vi.fn(),
  selectCustomer: vi.fn(),
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
  } as IEvaosBrokerSessionStatus | null,
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

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <Routes>
        <Route path='/home' element={<HomePage />} />
        <Route path='/mission-control' element={<p>Mission Control loaded</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('HomePage broker-policy quick actions', () => {
  beforeEach(() => {
    authMock.status = 'authenticated';
    authMock.user = { id: 'proof-user', username: 'admin@100yen.org' };
    customerContextMock.targets = [
      {
        customerId: 'proof-customer',
        displayName: 'Proof Customer',
        isDefault: true,
      },
    ];
    customerContextMock.selectedCustomerId = 'proof-customer';
    customerContextMock.roles = ['owner'];
    customerContextMock.scopes = [];
    customerContextMock.isOperator = false;
    customerContextMock.loaded = true;
    customerContextMock.loading = false;
    customerContextMock.error = undefined;
    customerContextMock.refreshTargets.mockReset();
    customerContextMock.selectCustomer.mockReset();
    customerContextMock.useEvaosCustomerContext.mockClear();
    customerContextMock.useEvaosCustomerContext.mockImplementation(() => ({
      targets: customerContextMock.targets,
      selectedCustomerId: customerContextMock.selectedCustomerId,
      selectedTarget: customerContextMock.targets.find(
        (target) => target.customerId === customerContextMock.selectedCustomerId
      ),
      summaryText: 'test customer context',
      refreshTargets: customerContextMock.refreshTargets,
      selectCustomer: customerContextMock.selectCustomer,
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

  it('hides broker-owned product quick actions while the broker session is missing', () => {
    brokerSessionMock.session = {
      state: 'missing',
      authenticated: false,
      expired: false,
      source: 'none',
      message: 'Sign in required',
    };

    renderHome();

    expect(screen.queryByRole('button', { name: /Connected Apps/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approvals/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Business Browser/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Company Brain/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^evaOS/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hermes/i })).not.toBeInTheDocument();
  });

  it('shows only quick actions allowed by broker policy for member sessions', () => {
    customerContextMock.roles = ['member'];
    customerContextMock.scopes = ['open_business_browser', 'view_company_brain'];
    brokerSessionMock.session = {
      ...brokerSessionMock.session,
      userEmail: 'member@example.test',
    };

    renderHome();

    expect(screen.getByRole('button', { name: /Business Browser/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Company Brain/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connected Apps/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approvals/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^evaOS/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hermes/i })).not.toBeInTheDocument();
  });

  it('keeps Refresh Home from deep-linking to Mission Control before broker policy is available', async () => {
    brokerSessionMock.session = {
      state: 'missing',
      authenticated: false,
      expired: false,
      source: 'none',
      message: 'Sign in required',
    };

    renderHome();

    await userEvent.click(screen.getByRole('button', { name: /Refresh Home/i }));

    await waitFor(() => expect(screen.queryByText('Mission Control loaded')).not.toBeInTheDocument());
  });

  it('shows admin quick actions when the authenticated broker policy allows them', () => {
    customerContextMock.roles = ['owner'];

    renderHome();

    expect(screen.getByRole('button', { name: /Connected Apps/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approvals/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Business Browser/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Company Brain/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^evaOS/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hermes/i })).toBeInTheDocument();
  });
});
