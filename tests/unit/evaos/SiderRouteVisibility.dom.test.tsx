/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sider from '@/renderer/components/layout/Sider';

const authMock = vi.hoisted(() => ({
  status: 'authenticated' as 'checking' | 'authenticated' | 'unauthenticated',
  user: null as { id: string; username: string } | null,
  logout: vi.fn(),
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
  selectedCustomerId: undefined as string | undefined,
  roles: [] as string[],
  scopes: [] as string[],
  isOperator: false,
  loaded: true,
  loading: false,
  error: undefined as string | undefined,
  selectCustomer: vi.fn(),
  clearEvaosCustomerContext: vi.fn(),
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

const brokerMocks = vi.hoisted(() => ({
  beginDesktopAuth: vi.fn(),
  revokeSession: vi.fn(),
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
    logout: authMock.logout,
    refresh: vi.fn(),
    clearAuthCache: vi.fn(),
  }),
}));

vi.mock('@renderer/hooks/context/EvaosCustomerContext', () => ({
  useEvaosCustomerContext: customerContextMock.useEvaosCustomerContext,
  clearEvaosCustomerContext: customerContextMock.clearEvaosCustomerContext,
}));

vi.mock('@renderer/hooks/useEvaosBrokerSessionStatus', () => ({
  useEvaosBrokerSessionStatus: () => brokerSessionMock,
  EVAOS_DESKTOP_SESSION_CLEARED_EVENT: 'evaos:desktop-session-cleared',
  evaosBrokerSessionKey: (session: typeof brokerSessionMock.session | null) =>
    session?.sessionKey ??
    (session?.authenticated
      ? [session.state, session.source, session.userEmail, session.expiresAt].filter(Boolean).join('|')
      : undefined),
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

vi.mock('@/common/adapter/ipcBridge', () => ({
  evaosBroker: {
    beginDesktopAuth: {
      invoke: brokerMocks.beginDesktopAuth,
    },
    revokeSession: {
      invoke: brokerMocks.revokeSession,
    },
  },
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

function renderSider(path = '/guid', options: { collapsed?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sider collapsed={options.collapsed} />
    </MemoryRouter>
  );
}

describe('Sider runtime route visibility', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    authMock.status = 'authenticated';
    authMock.user = null;
    authMock.logout.mockReset();
    authMock.logout.mockResolvedValue(undefined);
    customerContextMock.targets = [];
    customerContextMock.selectedCustomerId = undefined;
    customerContextMock.roles = [];
    customerContextMock.scopes = [];
    customerContextMock.isOperator = false;
    customerContextMock.loaded = true;
    customerContextMock.loading = false;
    customerContextMock.error = undefined;
    customerContextMock.selectCustomer.mockReset();
    customerContextMock.clearEvaosCustomerContext.mockReset();
    customerContextMock.useEvaosCustomerContext.mockClear();
    customerContextMock.useEvaosCustomerContext.mockImplementation(() => ({
      targets: customerContextMock.targets,
      selectedCustomerId: customerContextMock.selectedCustomerId,
      selectedTarget: customerContextMock.targets.find(
        (target) => target.customerId === customerContextMock.selectedCustomerId
      ),
      summaryText: 'test customer context',
      refreshTargets: vi.fn(),
      selectCustomer: customerContextMock.selectCustomer,
      roles: customerContextMock.roles,
      scopes: customerContextMock.scopes,
      isOperator: customerContextMock.isOperator,
      loaded: customerContextMock.loaded,
      loading: customerContextMock.loading,
      error: customerContextMock.error,
    }));
    brokerMocks.revokeSession.mockReset();
    brokerMocks.beginDesktopAuth.mockReset();
    brokerMocks.beginDesktopAuth.mockResolvedValue({
      success: true,
      data: {
        authUrl: 'https://www.electricsheephq.com/desktop-auth?fresh=abcd-efgh-1234-5678-9012-3456',
        displayText: 'electricsheephq.com/desktop-auth',
        deviceCode: {
          code: 'ABCD-EFGH',
          expiresAt: '2026-06-05T12:05:00.000Z',
        },
      },
    });
    brokerMocks.revokeSession.mockResolvedValue({
      success: true,
      data: {
        state: 'missing',
        authenticated: false,
        expired: false,
        source: 'none',
        message: 'Sign in to evaOS to connect this desktop shell.',
      },
    });
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

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Approvals')).toBeInTheDocument();
    expect(screen.getByText('Mission Control')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('Mac & iPhone')).toBeInTheDocument();
  });

  it('hides Mission Control for member sessions without technical runtime access', () => {
    customerContextMock.roles = ['member'];
    brokerSessionMock.session = {
      ...brokerSessionMock.session,
      userEmail: 'member@example.test',
    };

    renderSider();

    expect(screen.queryByText('Mission Control')).not.toBeInTheDocument();
    expect(screen.queryByText('Terminal')).not.toBeInTheDocument();
    expect(screen.queryByText('People & Access')).not.toBeInTheDocument();
    expect(screen.queryByText('Connected Apps')).not.toBeInTheDocument();
    expect(screen.queryByText('Company Brain')).not.toBeInTheDocument();
    expect(screen.queryByText('Business Browser')).not.toBeInTheDocument();
    expect(screen.queryByText('Mac & iPhone')).not.toBeInTheDocument();
  });

  it('shows product routes only when the broker policy grants the matching scopes', () => {
    customerContextMock.roles = ['member'];
    customerContextMock.scopes = [
      'manage_members',
      'manage_integrations',
      'view_company_brain',
      'open_business_browser',
      'use_design_workspace',
      'use_creative_studio',
    ];
    brokerSessionMock.session = {
      ...brokerSessionMock.session,
      userEmail: 'member@example.test',
    };

    renderSider();

    expect(screen.getByText('People & Access')).toBeInTheDocument();
    expect(screen.getByText('Connected Apps')).toBeInTheDocument();
    expect(screen.getByText('Company Brain')).toBeInTheDocument();
    expect(screen.getByText('Design Workspace')).toBeInTheDocument();
    expect(screen.getByText('Business Browser')).toBeInTheDocument();
    expect(screen.getByText('Creative Studio')).toBeInTheDocument();
    expect(screen.queryByText('Mission Control')).not.toBeInTheDocument();
    expect(screen.queryByText('Terminal')).not.toBeInTheDocument();
  });

  it('keeps Workbench parity routes visible as repair surfaces when the web session exists but broker session is missing', () => {
    brokerSessionMock.session = {
      state: 'missing',
      authenticated: false,
      expired: false,
      source: 'none',
      message: 'Sign in required',
    };

    renderSider();

    expect(screen.getByText('Mission Control')).toBeInTheDocument();
    expect(screen.getByText('Mac & iPhone')).toBeInTheDocument();
    expect(screen.getByText('Design Workspace')).toBeInTheDocument();
    expect(screen.getByText('Business Browser')).toBeInTheDocument();
    expect(screen.getByText('Creative Studio')).toBeInTheDocument();
    expect(screen.getByText('Connected Apps')).toBeInTheDocument();
    expect(screen.getByText('People & Access')).toBeInTheDocument();
    expect(screen.getByText('Company Brain')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
  });

  it('keys route visibility to the current broker session identity', () => {
    authMock.user = null;
    customerContextMock.roles = ['owner'];

    renderSider();

    expect(customerContextMock.useEvaosCustomerContext).toHaveBeenCalledWith(
      true,
      expect.stringContaining('admin@100yen.org'),
      undefined
    );
  });

  it('shows broker session identity in the footer when desktop auth has no web user', () => {
    authMock.user = null;
    customerContextMock.roles = ['owner'];

    renderSider();

    expect(screen.getByText('Viewing')).toBeInTheDocument();
    expect(screen.getByText('admin@100yen.org')).toBeInTheDocument();
  });

  it('renders old Workbench Home, Approvals, and People & Access labels for eligible sessions', () => {
    customerContextMock.roles = ['owner'];
    customerContextMock.scopes = ['manage_members', 'approve_actions'];

    renderSider();

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Approvals')).toBeInTheDocument();
    expect(screen.getByText('People & Access')).toBeInTheDocument();
    expect(screen.queryByText('Approval Center')).not.toBeInTheDocument();
    expect(screen.queryByText('People Access')).not.toBeInTheDocument();
  });

  it('keeps old Workbench footer sign-in and sign-out affordances reachable', async () => {
    const user = userEvent.setup();
    authMock.status = 'unauthenticated';
    authMock.user = null;
    brokerSessionMock.session = {
      state: 'missing',
      authenticated: false,
      expired: false,
      source: 'none',
      message: 'Sign in required',
    };

    renderSider();

    const signIn = screen.getByRole('button', { name: 'Sign In' });
    expect(signIn).toBeInTheDocument();
    expect(screen.queryByText('Sign in to open Eva workspaces')).not.toBeInTheDocument();
    await user.click(signIn);

    expect(brokerMocks.beginDesktopAuth).toHaveBeenCalledTimes(1);
  });

  it('keeps evaOS broker sign-in visible when the upstream shell account is signed in but broker session is missing', async () => {
    const user = userEvent.setup();
    authMock.status = 'authenticated';
    authMock.user = {
      id: 'shell-user-1',
      username: 'admin@100yen.org',
    };
    brokerSessionMock.session = {
      state: 'missing',
      authenticated: false,
      expired: false,
      source: 'none',
      message: 'Sign in required',
    };

    renderSider();

    expect(screen.getByText('admin@100yen.org')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.queryByText('Sign in to open Eva workspaces')).not.toBeInTheDocument();
    expect(screen.getByText('Design Workspace')).toBeInTheDocument();
    expect(screen.getByText('Business Browser')).toBeInTheDocument();
    expect(screen.getByText('Creative Studio')).toBeInTheDocument();
    expect(screen.getByText('Connected Apps')).toBeInTheDocument();
    expect(screen.getByText('People & Access')).toBeInTheDocument();
    expect(screen.getByText('Company Brain')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(brokerMocks.beginDesktopAuth).toHaveBeenCalledTimes(1);
  });

  it('keeps evaOS broker sign-in reachable in the collapsed sidebar when broker session is missing', async () => {
    const user = userEvent.setup();
    authMock.status = 'authenticated';
    authMock.user = {
      id: 'shell-user-1',
      username: 'admin@100yen.org',
    };
    brokerSessionMock.session = {
      state: 'missing',
      authenticated: false,
      expired: false,
      source: 'none',
      message: 'Sign in required',
    };

    renderSider('/guid', { collapsed: true });

    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(brokerMocks.beginDesktopAuth).toHaveBeenCalledTimes(1);
  });

  it('renders beta account footer metadata and an admin customer switcher', async () => {
    const user = userEvent.setup();
    customerContextMock.roles = ['admin'];
    customerContextMock.isOperator = true;
    customerContextMock.selectedCustomerId = 'david-poku';
    customerContextMock.targets = [
      {
        customerId: 'david-poku',
        displayName: 'David Poku Co',
        email: 'ops@example.test',
        status: 'active',
        healthStatus: 'ready',
        isDefault: true,
      },
      {
        customerId: 'second-customer',
        displayName: 'Second Customer',
        status: 'active',
        healthStatus: 'ready',
        isDefault: false,
      },
    ];

    renderSider();

    expect(screen.getByText('admin@100yen.org')).toBeInTheDocument();
    expect(screen.getByText(/controlled beta/i)).toBeInTheDocument();
    expect(screen.getByText(/v2\.1\.12-evaos-beta\.0/i)).toBeInTheDocument();

    const customerSelect = screen.getByLabelText('Selected customer');
    expect(customerSelect).toHaveValue('david-poku');

    await user.selectOptions(customerSelect, 'second-customer');

    expect(customerContextMock.selectCustomer).toHaveBeenCalledWith('second-customer');
  });

  it('keeps non-admin users fixed to their selected customer in the footer', () => {
    customerContextMock.roles = ['member'];
    customerContextMock.isOperator = false;
    customerContextMock.selectedCustomerId = 'member-customer';
    customerContextMock.targets = [
      {
        customerId: 'member-customer',
        displayName: 'Member Customer',
        status: 'active',
        healthStatus: 'ready',
        isDefault: true,
      },
    ];
    brokerSessionMock.session = {
      ...brokerSessionMock.session,
      userEmail: 'member@example.test',
    };

    renderSider();

    expect(screen.getByText('member@example.test')).toBeInTheDocument();
    expect(screen.getByText('Member Customer')).toBeInTheDocument();
    expect(screen.queryByLabelText('Selected customer')).not.toBeInTheDocument();
  });

  it('signs out by revoking the broker session before clearing the shell auth state', async () => {
    const user = userEvent.setup();
    const sessionClearedListener = vi.fn();
    customerContextMock.roles = ['owner'];
    window.addEventListener('evaos:desktop-session-cleared', sessionClearedListener);

    renderSider();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => {
      expect(brokerMocks.revokeSession).toHaveBeenCalledTimes(1);
      expect(authMock.logout).toHaveBeenCalledTimes(1);
    });
    expect(customerContextMock.clearEvaosCustomerContext).toHaveBeenCalledTimes(1);
    expect(sessionClearedListener).toHaveBeenCalledTimes(1);
    expect(sessionClearedListener.mock.calls[0][0]).toMatchObject({ detail: { source: 'footer' } });
    window.removeEventListener('evaos:desktop-session-cleared', sessionClearedListener);
  });

  it('keeps the beta shell account footer active when only the broker desktop session is authenticated', async () => {
    const user = userEvent.setup();
    authMock.status = 'unauthenticated';
    authMock.user = null;
    customerContextMock.roles = ['admin'];
    customerContextMock.isOperator = true;
    customerContextMock.selectedCustomerId = 'david-poku';
    customerContextMock.targets = [
      {
        customerId: 'david-poku',
        displayName: 'David Poku Co',
        email: 'ops@example.test',
        status: 'active',
        healthStatus: 'ready',
        isDefault: true,
      },
      {
        customerId: 'second-customer',
        displayName: 'Second Customer',
        status: 'active',
        healthStatus: 'ready',
        isDefault: false,
      },
    ];

    renderSider();

    expect(screen.getByText('Viewing')).toBeInTheDocument();
    expect(screen.getByText('admin@100yen.org')).toBeInTheDocument();
    expect(screen.getByText(/controlled beta/i)).toBeInTheDocument();
    expect(screen.getByText(/v2\.1\.12-evaos-beta\.0/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Selected customer')).toHaveValue('david-poku');
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('evaOS')).toBeInTheDocument();
    expect(screen.getByText('Hermes')).toBeInTheDocument();
    expect(screen.getByText('Mission Control')).toBeInTheDocument();
    expect(screen.getByText('Business Browser')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('People & Access')).toBeInTheDocument();
    expect(screen.getByText('Mac & iPhone')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => {
      expect(brokerMocks.revokeSession).toHaveBeenCalledTimes(1);
      expect(authMock.logout).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps evaOS sidebar broker context warm while settings are open', async () => {
    customerContextMock.roles = ['owner'];

    renderSider('/settings/model');

    expect(await screen.findByTestId('mock-settings-sider')).toBeInTheDocument();
    expect(customerContextMock.useEvaosCustomerContext).toHaveBeenCalledWith(
      true,
      expect.stringContaining('admin@100yen.org'),
      undefined
    );
  });
});
