/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MissionControlPage from '@/renderer/pages/mission-control';

const brokerMocks = vi.hoisted(() => ({
  getSessionStatus: vi.fn(),
  runtimeStatus: vi.fn(),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  evaosBroker: {
    getSessionStatus: {
      invoke: brokerMocks.getSessionStatus,
    },
    runtimeStatus: {
      invoke: brokerMocks.runtimeStatus,
    },
  },
}));

describe('MissionControlPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(await screen.findByText('Public beta gated')).toBeInTheDocument();
    expect(screen.getByText('Local shell smoke')).toBeInTheDocument();
    expect(screen.getByText('Live staging canaries')).toBeInTheDocument();
    expect(screen.getByText('Signed macOS artifact')).toBeInTheDocument();
    expect(screen.getByText('Role and org denial proof')).toBeInTheDocument();
    expect(screen.getByText('Rollback and support path')).toBeInTheDocument();
    expect(container.textContent).toContain('Continue R&D with blockers');
    expect(container.textContent).toContain(
      'Start evaOS Workbench Beta locally and screenshot the beta routes before new feature slices.'
    );
    expect(container.textContent).not.toContain('Stack approval');
    expect(container.textContent).not.toContain('Root PR #15');
    expect(container.textContent).not.toMatch(/ship public beta|ready to ship|eds_|desktop_session|Bearer/i);
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
          auditId: runtime === 'browser' ? 'audit_123' : undefined,
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
    await user.type(screen.getByLabelText('Customer context'), 'cus_123');
    await user.click(screen.getByRole('button', { name: /check/i }));

    await waitFor(() => {
      expect(brokerMocks.runtimeStatus).toHaveBeenCalledTimes(4);
    });
    expect(brokerMocks.runtimeStatus).toHaveBeenCalledWith({ customerId: 'cus_123', runtime: 'browser' });
    expect(screen.getByTestId('mission-runtime-card-browser')).toHaveTextContent('Browser is ready');
    expect(screen.getByText('app.example.test/work')).toBeInTheDocument();
    expect(screen.getByText('audit_123')).toBeInTheDocument();
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
    await user.type(screen.getByLabelText('Customer context'), 'cus_123');
    await user.click(screen.getByRole('button', { name: /check/i }));

    const browserCard = screen.getByTestId('mission-runtime-card-browser');
    await waitFor(() => {
      expect(within(browserCard).getAllByText('Blocked').length).toBeGreaterThan(0);
    });
    expect(browserCard).toHaveTextContent('The evaOS broker returned no runtime evidence.');
    expect(browserCard).toHaveTextContent('Fail-closed until evaOS broker evidence is available.');
    expect(browserCard).not.toHaveTextContent('eds_raw_session');
  });
});
