/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BusinessBrowserPage from '@/renderer/pages/business-browser';

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

describe('BusinessBrowserPage', () => {
  beforeEach(() => {
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

    await user.type(screen.getByLabelText('Customer context'), 'david-poku');
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

    const customerInput = screen.getByLabelText('Customer context');
    await user.type(customerInput, 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('app.one.test/dashboard')).toBeInTheDocument();

    await user.clear(customerInput);
    await user.type(customerInput, 'second-customer');

    expect(screen.queryByText('app.one.test/dashboard')).not.toBeInTheDocument();
    expect(screen.getByText('Load a customer account to view browser runtime evidence.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^load$/i }));
    expect(await screen.findByText('app.two.test/home')).toBeInTheDocument();
  });

  it('renders route denial and keeps browser actions off the mutation path', async () => {
    const user = userEvent.setup();
    browserMocks.getStatus.mockResolvedValue({
      success: true,
      data: browserView({ routeDenied: true }),
    });

    render(<BusinessBrowserPage />);

    await user.type(screen.getByLabelText('Customer context'), 'david-poku');
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

    await user.type(screen.getByLabelText('Customer context'), 'david-poku');
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    await screen.findByText('app.example.test/dashboard');

    await user.click(screen.getByRole('button', { name: /^launch$/i }));

    expect(await screen.findByText('Backend denied the browser action.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('eds_raw_backend_secret');
  });
});
