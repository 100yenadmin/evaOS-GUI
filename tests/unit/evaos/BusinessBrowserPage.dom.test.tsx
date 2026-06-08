/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearEvaosCustomerContext, selectEvaosCustomer } from '@/renderer/hooks/context/EvaosCustomerContext';
import BusinessBrowserPage from '@/renderer/pages/business-browser';

const brokerMocks = vi.hoisted(() => ({
  getSessionStatus: vi.fn(),
  getCustomerTargets: vi.fn(),
}));

const browserMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  launch: vi.fn(),
  openUrl: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  evaosBroker: {
    getSessionStatus: {
      invoke: brokerMocks.getSessionStatus,
    },
    getCustomerTargets: {
      invoke: brokerMocks.getCustomerTargets,
    },
  },
  evaosBusinessBrowser: {
    getStatus: {
      invoke: browserMocks.getStatus,
    },
    launch: {
      invoke: browserMocks.launch,
    },
    openUrl: {
      invoke: browserMocks.openUrl,
    },
    stop: {
      invoke: browserMocks.stop,
    },
  },
}));

function customerTargets() {
  return {
    success: true,
    data: {
      roles: ['admin'],
      isOperator: true,
      defaultCustomerId: 'david-poku',
      selectedCustomerId: 'david-poku',
      customers: [
        {
          customerId: 'david-poku',
          displayName: 'David Poku Co',
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
      ],
      summaryText: '2 customer targets loaded',
    },
  };
}

function browserView(
  overrides: Partial<{
    customerId: string;
    routeDenied: boolean;
    routeDenialReason: string;
    status: string;
    currentUrlDisplay: string;
    canLaunch: boolean;
    canOpenUrl: boolean;
    canStop: boolean;
  }> = {}
) {
  const routeDenied = overrides.routeDenied ?? false;
  const customerId = overrides.customerId ?? 'david-poku';
  return {
    schemaVersion: 'evaos.browser_status.v1',
    customerId,
    customerAccountId: 'acct_123',
    membershipId: 'mem_admin',
    membershipRole: 'admin',
    routeDenied,
    routeDenialReason: routeDenied
      ? (overrides.routeDenialReason ??
        'Business Browser requires the open_business_browser scope for this customer account.')
      : undefined,
    backendEnforced: true,
    displayLabel: 'Business Browser',
    status: overrides.status ?? (routeDenied ? 'denied' : 'running'),
    healthSummary: routeDenied ? 'Business Browser denied by account policy' : 'Browser is ready',
    currentUrlSummary: routeDenied
      ? undefined
      : {
          scheme: 'https',
          host: overrides.currentUrlDisplay?.split('/')[0] ?? 'app.example.test',
          path: `/${overrides.currentUrlDisplay?.split('/').slice(1).join('/') || 'dashboard'}`,
          displayText: overrides.currentUrlDisplay ?? 'app.example.test/dashboard',
          redacted: true,
        },
    authNeeded: false,
    captchaNeeded: false,
    waitingOnUser: false,
    controlSessionActive: !routeDenied,
    canLaunch: overrides.canLaunch ?? !routeDenied,
    canOpenUrl: overrides.canOpenUrl ?? !routeDenied,
    canStop: overrides.canStop ?? !routeDenied,
    actions: routeDenied ? [] : ['browser_open_url', 'browser_stop'],
    sourcePointer: routeDenied ? undefined : 'broker:runtime_status:browser',
    auditId: routeDenied ? undefined : 'audit_browser_123',
    policyAuditId: 'audit_policy_123',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('BusinessBrowserPage', () => {
  beforeEach(() => {
    clearEvaosCustomerContext();
    brokerMocks.getSessionStatus.mockReset();
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'authenticated',
        authenticated: true,
        expired: false,
        userEmail: 'admin@100yen.org',
        expiresAt: '2026-06-06T12:00:00.000Z',
        source: 'callback',
        message: 'Session active',
      },
    });
    brokerMocks.getCustomerTargets.mockReset();
    brokerMocks.getCustomerTargets.mockResolvedValue(customerTargets());
    browserMocks.getStatus.mockReset();
    browserMocks.launch.mockReset();
    browserMocks.openUrl.mockReset();
    browserMocks.stop.mockReset();
  });

  it('loads browser status and sends brokered controls without rendering secrets', async () => {
    const user = userEvent.setup();
    browserMocks.getStatus.mockResolvedValue({
      success: true,
      data: browserView(),
    });
    browserMocks.launch.mockResolvedValue({
      success: true,
      data: {
        status: 'opened',
        message: 'Browser launched.',
        browser: browserView({ currentUrlDisplay: 'chatgpt.com/codex' }),
        urlSummary: {
          host: 'chatgpt.com',
          path: '/codex',
          displayText: 'chatgpt.com/codex',
          redacted: false,
        },
        auditId: 'audit_launch_123',
        backendEnforced: true,
      },
    });
    browserMocks.openUrl.mockResolvedValue({
      success: true,
      data: {
        status: 'opened',
        message: 'Browser URL opened.',
        browser: browserView({ currentUrlDisplay: 'workspace.example.test/app' }),
        urlSummary: {
          host: 'workspace.example.test',
          path: '/app',
          displayText: 'workspace.example.test/app',
          redacted: true,
        },
        auditId: 'audit_open_123',
        backendEnforced: true,
      },
    });
    browserMocks.stop.mockResolvedValue({
      success: true,
      data: {
        status: 'stopped',
        message: 'Browser stopped.',
        auditId: 'audit_stop_123',
        backendEnforced: true,
      },
    });

    const { container } = render(<BusinessBrowserPage />);

    expect(await screen.findByRole('button', { name: 'David Poku Co' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('app.example.test/dashboard')).toBeInTheDocument();
    expect(screen.getByText('Browser is ready')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^launch$/i }));
    await waitFor(() => {
      expect(browserMocks.launch).toHaveBeenCalledWith({ customerId: 'david-poku' });
    });
    expect(
      await screen.findByText('Browser launched. URL chatgpt.com/codex. Audit audit_launch_123.')
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Open URL'), 'https://workspace.example.test/app?view=alpha#section');
    await user.click(screen.getByRole('button', { name: /^open$/i }));
    await waitFor(() => {
      expect(browserMocks.openUrl).toHaveBeenCalledWith({
        customerId: 'david-poku',
        url: 'https://workspace.example.test/app?view=alpha#section',
      });
    });
    expect(
      await screen.findByText('Browser URL opened. URL workspace.example.test/app. Audit audit_open_123.')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^stop$/i }));
    await waitFor(() => {
      expect(browserMocks.stop).toHaveBeenCalledWith({ customerId: 'david-poku' });
    });
    expect(await screen.findByText('Browser stopped. Audit audit_stop_123.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(
      /\b(?:eds|epg)_[A-Za-z0-9_-]+\b|access_token|refresh_token|desktop_session|provider_grant_handle|grant_handle|Bearer/i
    );
  });

  it('mounts an embedded Business Browser surface from an opaque broker handle', async () => {
    const user = userEvent.setup();
    browserMocks.getStatus.mockResolvedValue({
      success: true,
      data: browserView(),
    });
    browserMocks.launch.mockResolvedValue({
      success: true,
      data: {
        status: 'attached',
        message: 'Attached Business Browser.',
        browser: browserView({ currentUrlDisplay: 'workspace.example.test/app' }),
        runtimeSurface: {
          schemaVersion: 'evaos.runtime_surface.v1',
          surfaceId: 'surface-browser-fixture',
          surfaceUri: 'evaos-runtime-surface://surface-browser-fixture/',
          customerId: 'david-poku',
          runtimeKey: 'browser',
          displayLabel: 'Business Browser',
          status: 'attached',
          sourcePointer: 'broker:runtime_launch:browser',
          auditId: 'audit-browser-launch',
        },
        backendEnforced: true,
      },
    });

    const { container } = render(<BusinessBrowserPage />);

    expect(await screen.findByRole('button', { name: 'David Poku Co' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    await user.click(screen.getByRole('button', { name: /^launch$/i }));

    const surface = await screen.findByTestId('evaos-business-browser-surface');
    expect(surface).toHaveAttribute('src', 'evaos-runtime-surface://surface-browser-fixture/');
    expect(surface).toHaveAttribute('partition', 'evaos-runtime-surface-browser-fixture');
    expect(surface).not.toHaveAttribute('allowpopups', 'true');
    expect(container.textContent).not.toMatch(/launch_url|desktop_session|eds_|Bearer|token=/i);
    expect(container.textContent).not.toContain('runtime.example.test');
  });

  it('clears browser status when customer context changes before loading the next customer', async () => {
    const user = userEvent.setup();
    browserMocks.getStatus
      .mockResolvedValueOnce({
        success: true,
        data: browserView({ customerId: 'david-poku', currentUrlDisplay: 'app.one.test/dashboard' }),
      })
      .mockResolvedValueOnce({
        success: true,
        data: browserView({ customerId: 'second-customer', currentUrlDisplay: 'app.two.test/home' }),
      });

    render(<BusinessBrowserPage />);

    expect(await screen.findByRole('button', { name: 'David Poku Co' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('app.one.test/dashboard')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Second Customer' }));

    expect(screen.queryByText('app.one.test/dashboard')).not.toBeInTheDocument();
    expect(screen.getByText('Load a customer account to view browser runtime evidence.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('app.two.test/home')).toBeInTheDocument();
  });

  it('uses the selected non-default customer for brokered browser controls', async () => {
    const user = userEvent.setup();
    browserMocks.getStatus.mockResolvedValue({
      success: true,
      data: browserView({ customerId: 'second-customer', currentUrlDisplay: 'app.two.test/home' }),
    });
    browserMocks.launch.mockResolvedValue({
      success: true,
      data: {
        status: 'opened',
        message: 'Browser launched.',
        browser: browserView({ customerId: 'second-customer', currentUrlDisplay: 'chatgpt.com/codex' }),
        auditId: 'audit_launch_second',
        backendEnforced: true,
      },
    });
    browserMocks.openUrl.mockResolvedValue({
      success: true,
      data: {
        status: 'opened',
        message: 'Browser URL opened.',
        browser: browserView({ customerId: 'second-customer', currentUrlDisplay: 'workspace.example.test/app' }),
        urlSummary: {
          host: 'workspace.example.test',
          path: '/app',
          displayText: 'workspace.example.test/app',
          redacted: true,
        },
        auditId: 'audit_open_second',
        backendEnforced: true,
      },
    });
    browserMocks.stop.mockResolvedValue({
      success: true,
      data: {
        status: 'stopped',
        message: 'Browser stopped.',
        auditId: 'audit_stop_second',
        backendEnforced: true,
      },
    });

    render(<BusinessBrowserPage />);

    expect(await screen.findByRole('button', { name: 'David Poku Co' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Second Customer' }));
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('app.two.test/home')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^launch$/i }));
    await waitFor(() => {
      expect(browserMocks.launch).toHaveBeenCalledWith({ customerId: 'second-customer' });
    });

    await user.type(screen.getByLabelText('Open URL'), 'https://workspace.example.test/app');
    await user.click(screen.getByRole('button', { name: /^open$/i }));
    await waitFor(() => {
      expect(browserMocks.openUrl).toHaveBeenCalledWith({
        customerId: 'second-customer',
        url: 'https://workspace.example.test/app',
      });
    });

    await user.click(screen.getByRole('button', { name: /^stop$/i }));
    await waitFor(() => {
      expect(browserMocks.stop).toHaveBeenCalledWith({ customerId: 'second-customer' });
    });
  });

  it('ignores stale browser status when the customer context changes before the request settles', async () => {
    const user = userEvent.setup();
    const firstStatus = deferred<{ success: true; data: ReturnType<typeof browserView> }>();
    browserMocks.getStatus.mockReturnValueOnce(firstStatus.promise).mockResolvedValueOnce({
      success: true,
      data: browserView({ customerId: 'second-customer', currentUrlDisplay: 'app.two.test/home' }),
    });

    render(<BusinessBrowserPage />);

    expect(await screen.findByRole('button', { name: 'David Poku Co' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    await user.click(screen.getByRole('button', { name: 'Second Customer' }));

    await act(async () => {
      firstStatus.resolve({
        success: true,
        data: browserView({ customerId: 'david-poku', currentUrlDisplay: 'app.one.test/dashboard' }),
      });
    });

    expect(screen.queryByText('app.one.test/dashboard')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('app.two.test/home')).toBeInTheDocument();
  });

  it('accepts broker-canonical browser evidence for the selected customer target', async () => {
    const user = userEvent.setup();
    browserMocks.getStatus.mockResolvedValue({
      success: true,
      data: browserView({ customerId: 'canonical-david', currentUrlDisplay: 'canonical.example.test/home' }),
    });
    browserMocks.launch.mockResolvedValue({
      success: true,
      data: {
        status: 'opened',
        message: 'Browser launched.',
        browser: browserView({ customerId: 'canonical-david', currentUrlDisplay: 'canonical.example.test/launched' }),
        auditId: 'audit_canonical_customer',
        backendEnforced: true,
      },
    });

    render(<BusinessBrowserPage />);

    expect(await screen.findByRole('button', { name: 'David Poku Co' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('canonical.example.test/home')).toBeInTheDocument();
    expect(screen.getByText('Customer: canonical-david')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^launch$/i }));
    await waitFor(() => {
      expect(browserMocks.launch).toHaveBeenCalledWith({ customerId: 'david-poku' });
    });
    expect(await screen.findByText('canonical.example.test/launched')).toBeInTheDocument();
  });

  it('clears external customer-context changes and ignores stale status responses', async () => {
    const user = userEvent.setup();
    const staleStatus = deferred<{ success: true; data: ReturnType<typeof browserView> }>();
    browserMocks.getStatus.mockResolvedValueOnce({
      success: true,
      data: browserView({ customerId: 'david-poku', currentUrlDisplay: 'app.one.test/dashboard' }),
    });
    browserMocks.getStatus.mockReturnValueOnce(staleStatus.promise);

    render(<BusinessBrowserPage />);

    expect(await screen.findByRole('button', { name: 'David Poku Co' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('app.one.test/dashboard')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^load$/i }));
    await act(async () => {
      selectEvaosCustomer('second-customer');
    });

    expect(screen.queryByText('app.one.test/dashboard')).not.toBeInTheDocument();
    expect(screen.getByText('Load a customer account to view browser runtime evidence.')).toBeInTheDocument();

    await act(async () => {
      staleStatus.resolve({
        success: true,
        data: browserView({ customerId: 'david-poku', currentUrlDisplay: 'stale.example.test/dashboard' }),
      });
    });

    expect(screen.queryByText('stale.example.test/dashboard')).not.toBeInTheDocument();
    expect(screen.getByText('Load a customer account to view browser runtime evidence.')).toBeInTheDocument();
  });

  it('disables competing browser controls while an action is in flight', async () => {
    const user = userEvent.setup();
    const launchResult = deferred<{
      success: true;
      data: {
        status: 'opened';
        message: string;
        browser: ReturnType<typeof browserView>;
        auditId: string;
        backendEnforced: true;
      };
    }>();
    browserMocks.getStatus.mockResolvedValue({
      success: true,
      data: browserView(),
    });
    browserMocks.launch.mockReturnValueOnce(launchResult.promise);

    render(<BusinessBrowserPage />);

    expect(await screen.findByRole('button', { name: 'David Poku Co' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    await screen.findByText('app.example.test/dashboard');
    await user.type(screen.getByLabelText('Open URL'), 'https://workspace.example.test/app');

    await user.click(screen.getByRole('button', { name: /^launch$/i }));
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^open$/i })).toBeDisabled();
    expect(screen.getByLabelText('Open URL')).toBeDisabled();

    await act(async () => {
      launchResult.resolve({
        success: true,
        data: {
          status: 'opened',
          message: 'Browser launched.',
          browser: browserView({ currentUrlDisplay: 'launched.example.test/home' }),
          auditId: 'audit_launch_123',
          backendEnforced: true,
        },
      });
    });

    expect(await screen.findByText('launched.example.test/home')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^stop$/i })).not.toBeDisabled();
  });

  it('renders route denial and keeps browser actions off the mutation path', async () => {
    const user = userEvent.setup();
    browserMocks.getStatus.mockResolvedValue({
      success: true,
      data: browserView({ routeDenied: true }),
    });

    render(<BusinessBrowserPage />);

    expect(await screen.findByRole('button', { name: 'David Poku Co' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText('Route denied')).toBeInTheDocument();
    expect(
      screen.getByText('Business Browser requires the open_business_browser scope for this customer account.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^launch$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^open$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeDisabled();
    expect(browserMocks.launch).not.toHaveBeenCalled();
    expect(browserMocks.openUrl).not.toHaveBeenCalled();
    expect(browserMocks.stop).not.toHaveBeenCalled();
  });

  it('renders backend denial without leaking broker secret text', async () => {
    const user = userEvent.setup();
    browserMocks.getStatus.mockResolvedValue({
      success: true,
      data: browserView(),
    });
    browserMocks.launch.mockResolvedValue({
      success: false,
      msg: 'eds_raw_backend_secret should not render',
    });

    const { container } = render(<BusinessBrowserPage />);

    expect(await screen.findByRole('button', { name: 'David Poku Co' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    await screen.findByText('app.example.test/dashboard');

    await user.click(screen.getByRole('button', { name: /^launch$/i }));

    expect(await screen.findByText('Backend denied the browser action.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('eds_raw_backend_secret');
  });
});
