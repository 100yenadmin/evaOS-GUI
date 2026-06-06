/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearEvaosCustomerContext } from '@/renderer/hooks/context/EvaosCustomerContext';
import MissionControlPage from '@/renderer/pages/mission-control';

const brokerMocks = vi.hoisted(() => ({
  beginDesktopAuth: vi.fn(),
  claimDeviceCode: vi.fn(),
  getSessionStatus: vi.fn(),
  getCustomerTargets: vi.fn(),
  runtimeStatus: vi.fn(),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  evaosBroker: {
    beginDesktopAuth: {
      invoke: brokerMocks.beginDesktopAuth,
    },
    claimDeviceCode: {
      invoke: brokerMocks.claimDeviceCode,
    },
    getSessionStatus: {
      invoke: brokerMocks.getSessionStatus,
    },
    getCustomerTargets: {
      invoke: brokerMocks.getCustomerTargets,
    },
    runtimeStatus: {
      invoke: brokerMocks.runtimeStatus,
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
          email: 'ops@example.test',
          status: 'active',
          healthStatus: 'ready',
          isDefault: true,
        },
        {
          customerId: 'second-customer',
          displayName: 'Second Customer',
          status: 'active',
          healthStatus: 'needs_attention',
          isDefault: false,
        },
      ],
      summaryText: '2 customer targets loaded',
    },
  };
}

function emptyCustomerTargets() {
  return {
    success: true,
    data: {
      roles: ['admin'],
      isOperator: true,
      defaultCustomerId: undefined,
      selectedCustomerId: undefined,
      customers: [],
      summaryText: 'No customer targets loaded',
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('MissionControlPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEvaosCustomerContext();
    brokerMocks.getCustomerTargets.mockResolvedValue(customerTargets());
  });

  it('fails closed without querying runtime status when the desktop session is missing', async () => {
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'missing',
        authenticated: false,
        expired: false,
        source: 'none',
        message: 'Sign in to evaOS to connect this desktop shell.',
      },
    });

    render(<MissionControlPage />);

    expect(await screen.findByText('Sign in required')).toBeInTheDocument();
    expect(screen.getByText('Sign in to evaOS to connect this desktop shell.')).toBeInTheDocument();
    expect(brokerMocks.runtimeStatus).not.toHaveBeenCalled();
    expect(screen.getByTestId('mission-runtime-card-browser')).toHaveTextContent('No runtime evidence loaded yet.');
  });

  it('renders public beta gate blockers without claiming the shell is shippable', async () => {
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'missing',
        authenticated: false,
        expired: false,
        source: 'none',
        message: 'Sign in to evaOS to connect this desktop shell.',
      },
    });

    const { container } = render(<MissionControlPage />);

    expect(await screen.findByText('RC parity gated')).toBeInTheDocument();
    expect(screen.getByText('Parity audit active')).toBeInTheDocument();
    expect(screen.getByText('RC parity proof')).toBeInTheDocument();
    expect(screen.getByText('Native adapter canaries')).toBeInTheDocument();
    expect(screen.getByText('Upstream regression')).toBeInTheDocument();
    expect(screen.getByText('Visible branding')).toBeInTheDocument();
    expect(screen.getByText('Exact RC canary')).toBeInTheDocument();
    expect(container.textContent).toContain('user-testing distribution stays blocked');
    expect(container.textContent).toContain('Start evaOS Workbench Beta locally for RC proof');
    expect(container.textContent).not.toContain('Stack approval');
    expect(container.textContent).not.toContain('Root PR #15');
    expect(container.textContent).not.toMatch(/ship public beta|ready to ship|eds_|desktop_session|Bearer/i);
  });

  it('claims a browser backup code from Mission Control without rendering desktop-session material', async () => {
    const user = userEvent.setup();
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'missing',
        authenticated: false,
        expired: false,
        source: 'none',
        message: 'Sign in to evaOS to connect this desktop shell.',
      },
    });
    brokerMocks.beginDesktopAuth.mockResolvedValue({
      success: true,
      data: {
        authUrlSummary: {
          displayText: 'electricsheephq.com/desktop-auth',
          host: 'electricsheephq.com',
          path: '/desktop-auth',
          redacted: true,
          scheme: 'https',
        },
        fallbackDeviceCode: 'ABCD-EFGH',
        message: 'Continue in the browser or paste the backup code.',
        state: 'auth_state_123',
      },
    });
    brokerMocks.claimDeviceCode.mockResolvedValue({
      success: true,
      data: {
        state: 'authenticated',
        authenticated: true,
        expired: false,
        source: 'device-code',
        userEmail: 'admin@100yen.org',
        expiresAt: '2026-06-04T18:00:00.000Z',
        message: 'evaOS desktop session is active.',
      },
    });

    const { container } = render(<MissionControlPage />);

    expect(await screen.findByText('Sign in required')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText('Continue in the browser or paste the backup code.')).toBeInTheDocument();
    expect(screen.getByText('Paste the short code shown on the browser page.')).toBeInTheDocument();
    expect(screen.queryByText('ABCD-EFGH')).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /backup code/i }), 'WXYZ-1234');
    await user.click(screen.getByRole('button', { name: /claim backup code/i }));

    await waitFor(() => {
      expect(brokerMocks.claimDeviceCode).toHaveBeenCalledWith({ deviceCode: 'WXYZ-1234' });
    });
    expect(await screen.findByText('Session active')).toBeInTheDocument();
    expect(screen.getByText('admin@100yen.org')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/eds_|desktop_session|Bearer/i);
  });

  it('does not render the auth URL fresh code as a browser backup code', async () => {
    const user = userEvent.setup();
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'missing',
        authenticated: false,
        expired: false,
        source: 'none',
        message: 'Sign in to evaOS to connect this desktop shell.',
      },
    });
    brokerMocks.beginDesktopAuth.mockResolvedValue({
      success: true,
      data: {
        authUrl: 'https://www.electricsheephq.com/desktop-auth?fresh=abcd-efgh-1234-5678-9012-3456',
        callbackUrl: 'http://127.0.0.1:51234/auth/evaos-workbench-beta/callback?desktop_auth_state=state-123',
        fallbackDeviceCode: '',
        message: 'Continue in the browser or paste the backup code.',
      },
    });

    const { container } = render(<MissionControlPage />);

    expect(await screen.findByText('Sign in required')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText('Continue in the browser or paste the backup code.')).toBeInTheDocument();
    expect(screen.getByText('Paste the short code shown on the browser page.')).toBeInTheDocument();
    expect(screen.queryByText('ABCD-EFGH-1234-5678-9012-3456')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/desktop_session|Bearer|eds_/i);
  });

  it('clears a stale backup-code handoff before starting a new sign-in', async () => {
    const user = userEvent.setup();
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'missing',
        authenticated: false,
        expired: false,
        source: 'none',
        message: 'Sign in to evaOS to connect this desktop shell.',
      },
    });
    brokerMocks.beginDesktopAuth
      .mockResolvedValueOnce({
        success: true,
        data: {
          authUrl: 'https://www.electricsheephq.com/desktop-auth?fresh=stal-ecod-1234-5678-9012-3456',
          callbackUrl: 'http://127.0.0.1:51234/auth/evaos-workbench-beta/callback?desktop_auth_state=state-123',
          fallbackDeviceCode: 'STAL-ECOD-1234-5678-9012-3456',
          message: 'Continue in the browser or paste the backup code.',
        },
      })
      .mockResolvedValueOnce({
        success: false,
        msg: 'ElectricSheep sign-in could not start safely.',
      });

    render(<MissionControlPage />);

    expect(await screen.findByText('Sign in required')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText('Paste the short code shown on the browser page.')).toBeInTheDocument();
    expect(screen.queryByText('STAL-ECOD-1234-5678-9012-3456')).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /backup code/i }), 'STAL-ECOD-1234');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText('ElectricSheep sign-in could not start safely.')).toBeInTheDocument();
    expect(screen.queryByText('STAL-ECOD-1234-5678-9012-3456')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('STAL-ECOD-1234')).not.toBeInTheDocument();
  });

  it('loads sanitized runtime evidence for the chosen customer', async () => {
    const user = userEvent.setup();
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'authenticated',
        authenticated: true,
        expired: false,
        source: 'memory',
        userEmail: 'operator@example.test',
        expiresAt: '2026-06-03T18:00:00.000Z',
        message: 'evaOS desktop session is active.',
      },
    });
    brokerMocks.runtimeStatus.mockImplementation(({ customerId, runtime }) =>
      Promise.resolve({
        success: true,
        data: {
          customerId,
          runtimeKey: runtime,
          displayLabel: runtime === 'browser' ? 'Business Browser' : runtime,
          status: runtime === 'browser' ? 'running' : 'done',
          healthSummary: runtime === 'browser' ? 'Browser is ready' : 'Runtime is complete',
          owner: 'operations',
          customerAccountId: 'acct_david_poku',
          auditId: runtime === 'browser' ? 'audit_123' : undefined,
          sourcePointer: runtime === 'browser' ? 'broker://runtime/browser/audit_123' : `broker://runtime/${runtime}`,
          lastCheckedAt: '2026-06-03T17:45:00.000Z',
          lastActivityAt: runtime === 'browser' ? '2026-06-03T17:50:00.000Z' : undefined,
          currentUrlSummary:
            runtime === 'browser'
              ? {
                  scheme: 'https',
                  host: 'app.example.test',
                  path: '/work',
                  displayText: 'app.example.test/work',
                  redacted: true,
                }
              : undefined,
        },
      })
    );

    const { container } = render(<MissionControlPage />);

    expect(await screen.findByText('Session active')).toBeInTheDocument();
    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /check/i }));

    await waitFor(() => {
      expect(brokerMocks.runtimeStatus).toHaveBeenCalledTimes(5);
    });
    expect(brokerMocks.runtimeStatus).toHaveBeenCalledWith({ customerId: 'david-poku', runtime: 'browser' });
    expect(brokerMocks.runtimeStatus).toHaveBeenCalledWith({ customerId: 'david-poku', runtime: 'terminal' });
    expect(screen.getByRole('region', { name: 'Mission reality snapshot' })).toHaveTextContent('David Poku Co');
    expect(screen.getByRole('region', { name: 'Mission reality snapshot' })).toHaveTextContent('Loaded runtimes');
    expect(screen.getByRole('region', { name: 'Mission reality snapshot' })).toHaveTextContent('5 of 5');
    expect(screen.getByRole('region', { name: 'Mission reality snapshot' })).toHaveTextContent('memory');
    expect(screen.getByRole('region', { name: 'Mission reality snapshot' })).toHaveTextContent('audit_123');
    expect(screen.getByRole('region', { name: 'Mission reality snapshot' })).toHaveTextContent(
      'broker://runtime/browser/audit_123'
    );
    expect(screen.getByTestId('mission-runtime-card-browser')).toHaveTextContent('Browser is ready');
    expect(screen.getByTestId('mission-runtime-card-browser')).toHaveTextContent('acct_david_poku');
    expect(screen.getByTestId('mission-runtime-card-browser')).toHaveTextContent('broker://runtime/browser/audit_123');
    expect(screen.getByTestId('mission-runtime-card-terminal')).toHaveTextContent('Runtime is complete');
    expect(screen.getByText('app.example.test/work')).toBeInTheDocument();
    expect(screen.getAllByText('audit_123').length).toBeGreaterThan(1);
    expect(container.textContent).not.toMatch(/eds_|epg_|access_token|desktop_session|provider_grant|Bearer/i);
  });

  it('shows negative offline proof without leaking broker response secrets', async () => {
    const user = userEvent.setup();
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'authenticated',
        authenticated: true,
        expired: false,
        source: 'memory',
        expiresAt: '2026-06-03T18:00:00.000Z',
        message: 'evaOS desktop session is active.',
      },
    });
    brokerMocks.runtimeStatus.mockResolvedValue({
      success: false,
      msg: 'eds_raw_session should not render',
    });

    render(<MissionControlPage />);

    expect(await screen.findByText('Session active')).toBeInTheDocument();
    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /check/i }));

    const browserCard = screen.getByTestId('mission-runtime-card-browser');
    const terminalCard = screen.getByTestId('mission-runtime-card-terminal');
    await waitFor(() => {
      expect(within(browserCard).getAllByText('Blocked').length).toBeGreaterThan(0);
    });
    expect(browserCard).toHaveTextContent('The evaOS broker returned no runtime evidence.');
    expect(browserCard).toHaveTextContent('Fail-closed until evaOS broker evidence is available.');
    expect(browserCard).not.toHaveTextContent('eds_raw_session');
    expect(terminalCard).toHaveTextContent('The evaOS broker returned no runtime evidence.');
    expect(terminalCard).not.toHaveTextContent('eds_raw_session');
  });

  it('keeps runtime cards waiting when an authenticated operator has no selected customer', async () => {
    const user = userEvent.setup();
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'authenticated',
        authenticated: true,
        expired: false,
        source: 'memory',
        expiresAt: '2026-06-03T18:00:00.000Z',
        message: 'evaOS desktop session is active.',
      },
    });
    brokerMocks.getCustomerTargets.mockResolvedValue(emptyCustomerTargets());

    render(<MissionControlPage />);

    expect(await screen.findByText('Session active')).toBeInTheDocument();
    expect(await screen.findByText('No customer targets loaded')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Mission reality snapshot' })).toHaveTextContent('No customer selected');
    await user.click(screen.getByRole('button', { name: /check/i }));

    expect(brokerMocks.runtimeStatus).not.toHaveBeenCalled();
    expect(screen.getByTestId('mission-runtime-card-browser')).toHaveTextContent(
      'Choose a customer target before checking runtime status.'
    );
    expect(screen.getByTestId('mission-runtime-card-terminal')).toHaveTextContent(
      'Choose a customer target before checking runtime status.'
    );
  });

  it('renders expired session state as blocked and avoids runtime queries', async () => {
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'expired',
        authenticated: false,
        expired: true,
        source: 'memory',
        expiresAt: '2026-06-03T18:00:00.000Z',
        message: 'evaOS desktop session expired. Sign in again.',
      },
    });

    render(<MissionControlPage />);

    expect(await screen.findByText('Session expired')).toBeInTheDocument();
    expect(screen.getByText('evaOS desktop session expired. Sign in again.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Mission reality snapshot' })).toHaveTextContent('none');
    expect(brokerMocks.runtimeStatus).not.toHaveBeenCalled();
  });

  it('renders broker-denied runtime evidence without live proof claims', async () => {
    const user = userEvent.setup();
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'authenticated',
        authenticated: true,
        expired: false,
        source: 'memory',
        expiresAt: '2026-06-03T18:00:00.000Z',
        message: 'evaOS desktop session is active.',
      },
    });
    brokerMocks.runtimeStatus.mockImplementation(({ customerId, runtime }) =>
      Promise.resolve({
        success: true,
        data: {
          customerId,
          runtimeKey: runtime,
          displayLabel: runtime,
          status: runtime === 'browser' ? 'denied' : 'waiting',
          healthSummary: runtime === 'browser' ? 'Backend policy denied Business Browser control.' : 'Waiting.',
          owner: 'access-control',
          sourcePointer: 'fixture://mission-control/denied',
          auditId: runtime === 'browser' ? 'deny_audit_73' : undefined,
        },
      })
    );

    const { container } = render(<MissionControlPage />);

    expect(await screen.findByText('Session active')).toBeInTheDocument();
    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /check/i }));

    const browserCard = screen.getByTestId('mission-runtime-card-browser');
    await waitFor(() => {
      expect(browserCard).toHaveTextContent('Backend policy denied Business Browser control.');
    });
    expect(browserCard).toHaveTextContent('Blocked');
    expect(browserCard).toHaveTextContent('deny_audit_73');
    expect(screen.getByRole('region', { name: 'Mission reality snapshot' })).toHaveTextContent(
      'fixture://mission-control/denied'
    );
    expect(container.textContent).not.toMatch(/live beta proof|ready to ship|ship public beta/i);
  });

  it('clears runtime evidence when the selected customer changes', async () => {
    const user = userEvent.setup();
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'authenticated',
        authenticated: true,
        expired: false,
        source: 'memory',
        expiresAt: '2026-06-03T18:00:00.000Z',
        message: 'evaOS desktop session is active.',
      },
    });
    brokerMocks.runtimeStatus.mockResolvedValue({
      success: true,
      data: {
        customerId: 'david-poku',
        runtimeKey: 'browser',
        displayLabel: 'Business Browser',
        status: 'running',
        healthSummary: 'Browser is ready',
      },
    });

    render(<MissionControlPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /check/i }));

    await waitFor(() => {
      expect(screen.getByTestId('mission-runtime-card-browser')).toHaveTextContent('Browser is ready');
    });

    await user.click(screen.getByRole('button', { name: 'Second Customer' }));

    expect(screen.getByTestId('mission-runtime-card-browser')).toHaveTextContent('No runtime evidence loaded yet.');
    expect(screen.getByText(/2 customer targets loaded/)).toBeInTheDocument();
  });

  it('lets operators retry customer targets after a broker failure', async () => {
    const user = userEvent.setup();
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'authenticated',
        authenticated: true,
        expired: false,
        source: 'memory',
        expiresAt: '2026-06-03T18:00:00.000Z',
        message: 'evaOS desktop session is active.',
      },
    });
    brokerMocks.getCustomerTargets.mockReset();
    brokerMocks.getCustomerTargets
      .mockResolvedValueOnce({
        success: false,
        msg: 'eds_raw_customer_target_secret should not render',
      })
      .mockResolvedValueOnce(customerTargets());

    const { container } = render(<MissionControlPage />);

    expect(await screen.findByText('Customer targets failed closed.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('eds_raw_customer_target_secret');

    await user.click(screen.getByRole('button', { name: /^refresh targets$/i }));

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    expect(brokerMocks.getCustomerTargets).toHaveBeenCalledTimes(2);
  });

  it('ignores stale customer targets that resolve after the session becomes unauthenticated', async () => {
    const user = userEvent.setup();
    const pendingTargets = deferred<ReturnType<typeof customerTargets>>();
    brokerMocks.getSessionStatus
      .mockResolvedValueOnce({
        success: true,
        data: {
          state: 'authenticated',
          authenticated: true,
          expired: false,
          source: 'memory',
          expiresAt: '2026-06-03T18:00:00.000Z',
          message: 'evaOS desktop session is active.',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          state: 'missing',
          authenticated: false,
          expired: false,
          source: 'none',
          message: 'Sign in to evaOS to connect this desktop shell.',
        },
      });
    brokerMocks.getCustomerTargets.mockReset();
    brokerMocks.getCustomerTargets.mockReturnValueOnce(pendingTargets.promise);

    render(<MissionControlPage />);

    expect(await screen.findByText('Session active')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^refresh$/i }));
    expect(await screen.findByText('Sign in required')).toBeInTheDocument();

    await act(async () => {
      pendingTargets.resolve(customerTargets());
      await pendingTargets.promise;
    });

    expect(screen.queryByText('David Poku Co')).not.toBeInTheDocument();
    expect(screen.getByText('No customer targets loaded')).toBeInTheDocument();
  });

  it('does not render stale runtime evidence when the selected customer changes before the broker responds', async () => {
    const user = userEvent.setup();
    const pendingRuntimeResponses = Array.from({ length: 5 }, () =>
      deferred<{
        success: boolean;
        data: {
          customerId: string;
          runtimeKey: string;
          displayLabel: string;
          status: string;
          healthSummary: string;
        };
      }>()
    );
    const pendingRuntimeQueue = [...pendingRuntimeResponses];
    brokerMocks.getSessionStatus.mockResolvedValue({
      success: true,
      data: {
        state: 'authenticated',
        authenticated: true,
        expired: false,
        source: 'memory',
        expiresAt: '2026-06-03T18:00:00.000Z',
        message: 'evaOS desktop session is active.',
      },
    });
    brokerMocks.runtimeStatus.mockImplementation(({ runtime }) => {
      const next = pendingRuntimeQueue.shift();
      if (!next) throw new Error('unexpected runtime request');
      return next.promise.then((response) => ({
        ...response,
        data: {
          ...response.data,
          runtimeKey: runtime,
        },
      }));
    });

    render(<MissionControlPage />);

    expect((await screen.findAllByText('David Poku Co')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /check/i }));
    await waitFor(() => {
      expect(brokerMocks.runtimeStatus).toHaveBeenCalledTimes(5);
    });

    await user.click(screen.getByRole('button', { name: 'Second Customer' }));

    await act(async () => {
      pendingRuntimeResponses.forEach((pending) => {
        pending.resolve({
          success: true,
          data: {
            customerId: 'david-poku',
            runtimeKey: 'browser',
            displayLabel: 'Business Browser',
            status: 'running',
            healthSummary: 'Browser is ready',
          },
        });
      });
      await Promise.all(pendingRuntimeResponses.map((pending) => pending.promise));
    });

    expect(screen.getByTestId('mission-runtime-card-browser')).not.toHaveTextContent('Browser is ready');
    expect(screen.getByTestId('mission-runtime-card-browser')).toHaveTextContent('No runtime evidence loaded yet.');
  });
});
