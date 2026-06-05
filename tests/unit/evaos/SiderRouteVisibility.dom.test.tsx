/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sider from '@/renderer/components/layout/Sider';

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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({
    closePreview: vi.fn(),
  }),
}));

vi.mock('@renderer/hooks/context/AuthContext', () => ({
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

vi.mock('@renderer/hooks/context/EvaosCustomerContext', () => ({
  useEvaosCustomerContext: customerContextMock.useEvaosCustomerContext,
}));

vi.mock('@renderer/hooks/useEvaosBrokerSessionStatus', () => ({
  useEvaosBrokerSessionStatus: () => brokerSessionMock,
  evaosBrokerSessionKey: (session: typeof brokerSessionMock.session | null) =>
    session?.authenticated
      ? [session.state, session.source, session.userEmail, session.expiresAt].filter(Boolean).join('|')
      : undefined,
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'dark', setTheme: vi.fn() }),
}));

vi.mock('@renderer/pages/cron/useCronJobs', () => ({
  useAllCronJobs: () => ({ jobs: [] }),
}));

vi.mock('@renderer/pages/team/hooks/useTeamCreatedRedirect', () => ({
  useTeamCreatedRedirect: () => {},
}));

vi.mock('@renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({
  default: () => <button type='button'>Search</button>,
}));

vi.mock('@renderer/pages/conversation/GroupedHistory', () => ({
  default: () => <div data-testid='mock-history' />,
}));

vi.mock('@renderer/pages/settings/components/SettingsSider', () => ({
  default: () => <div data-testid='mock-settings-sider' />,
}));

function renderSider(path = '/guid') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sider />
    </MemoryRouter>
  );
}

describe('Sider runtime route visibility', () => {
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

  it('shows Mission Control for owner sessions', () => {
    customerContextMock.roles = ['owner'];

    renderSider();

    expect(screen.getByText('Mission Control')).toBeInTheDocument();
  });

  it('hides Mission Control for member sessions without technical runtime access', () => {
    customerContextMock.roles = ['member'];
    brokerSessionMock.session = {
      ...brokerSessionMock.session,
      userEmail: 'member@example.test',
    };

    renderSider();

    expect(screen.queryByText('Mission Control')).not.toBeInTheDocument();
    expect(screen.getByText('People Access')).toBeInTheDocument();
  });

  it('keys route visibility to the current broker session identity', () => {
    authMock.user = null;
    customerContextMock.roles = ['owner'];

    renderSider();

    expect(customerContextMock.useEvaosCustomerContext).toHaveBeenCalledWith(
      true,
      expect.stringContaining('admin@100yen.org')
    );
  });
});
