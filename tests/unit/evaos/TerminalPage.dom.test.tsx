/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearEvaosCustomerContext } from '@/renderer/hooks/context/EvaosCustomerContext';
import TerminalPage from '@/renderer/pages/terminal';

const brokerMocks = vi.hoisted(() => ({
  getSessionStatus: vi.fn(),
  getCustomerTargets: vi.fn(),
  runtimeStatus: vi.fn(),
  runtimeAction: vi.fn(),
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
    runtimeStatus: {
      invoke: brokerMocks.runtimeStatus,
    },
    runtimeAction: {
      invoke: brokerMocks.runtimeAction,
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

describe('TerminalPage', () => {
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
    brokerMocks.runtimeStatus.mockReset();
    brokerMocks.runtimeAction.mockReset();
    brokerMocks.getCustomerTargets.mockResolvedValue(customerTargets());
  });

  it('loads terminal runtime evidence through the broker and renders no secrets', async () => {
    brokerMocks.runtimeStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.runtime_status.v1',
        customerId: 'david-poku',
        customerAccountId: 'acct_terminal',
        runtimeKey: 'terminal',
        displayLabel: 'Terminal',
        status: 'offline',
        healthSummary: 'Customer VM shell is offline.',
        owner: 'support',
        sourcePointer: 'broker://runtime/terminal/audit_123',
        auditId: 'audit_terminal_123',
      },
    });

    const { container } = render(<TerminalPage />);

    expect(await screen.findByText('Customer VM shell is offline.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Diagnostics' }));
    expect(screen.getByText('broker://runtime/terminal/audit_123')).toBeInTheDocument();
    expect(screen.getByText('audit_terminal_123')).toBeInTheDocument();
    await waitFor(() => {
      expect(brokerMocks.runtimeStatus).toHaveBeenCalledWith({ customerId: 'david-poku', runtime: 'terminal' });
    });
    expect(container.textContent).not.toMatch(/eds_|epg_|access_token|desktop_session|provider_grant|Bearer/i);
  });

  it('mounts the brokered VM shell surface when Terminal attach returns an opaque surface handle', async () => {
    brokerMocks.runtimeStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.runtime_status.v1',
        customerId: 'david-poku',
        customerAccountId: 'acct_terminal',
        runtimeKey: 'terminal',
        displayLabel: 'Terminal',
        status: 'running',
        healthSummary: 'Terminal VM shell is ready.',
        actions: ['attach_dashboard'],
        sourcePointer: 'broker://runtime/terminal/audit_status',
        auditId: 'audit_terminal_status',
      },
    });
    brokerMocks.runtimeAction.mockResolvedValue({
      success: true,
      data: {
        status: 'attached',
        runtimeKey: 'terminal',
        customerId: 'david-poku',
        message: 'Attached Terminal VM shell.',
        runtimeSurface: {
          schemaVersion: 'evaos.runtime_surface.v1',
          surfaceId: 'surface-terminal-shell',
          surfaceUri: 'evaos-runtime-surface://surface-terminal-shell/',
          partition: 'evaos-runtime-terminal-shell',
          customerId: 'david-poku',
          runtimeKey: 'terminal',
          displayLabel: 'Terminal',
          status: 'attached',
          sourcePointer: 'broker://runtime/terminal/attach',
          auditId: 'audit_terminal_attach',
        },
        backendEnforced: true,
      },
    });

    const { container } = render(<TerminalPage />);

    await waitFor(() => {
      expect(brokerMocks.runtimeAction).toHaveBeenCalledWith({
        customerId: 'david-poku',
        runtime: 'terminal',
        action: 'attach',
      });
    });
    const surface = await screen.findByTestId('evaos-runtime-surface-terminal');
    expect(surface).toHaveAttribute('src', 'evaos-runtime-surface://surface-terminal-shell/');
    expect(surface).toHaveAttribute('partition', 'evaos-runtime-terminal-shell');
    expect(surface).not.toHaveAttribute('allowpopups', 'true');
    expect(container.textContent).not.toMatch(
      /eds_|epg_|access_token|desktop_session|provider_grant|Bearer|launch_url/i
    );
  });

  it('shows the precise broker blocker when Terminal attach omits the VM shell surface', async () => {
    brokerMocks.runtimeStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.runtime_status.v1',
        customerId: 'david-poku',
        customerAccountId: 'acct_terminal',
        runtimeKey: 'terminal',
        displayLabel: 'Terminal',
        status: 'running',
        healthSummary: 'Terminal VM shell is ready.',
        actions: ['attach_dashboard'],
        sourcePointer: 'broker://runtime/terminal/audit_status',
        auditId: 'audit_terminal_status',
      },
    });
    brokerMocks.runtimeAction.mockResolvedValue({
      success: true,
      data: {
        status: 'attached',
        runtimeKey: 'terminal',
        customerId: 'david-poku',
        message: 'Attached Terminal VM shell.',
        backendEnforced: true,
      },
    });

    render(<TerminalPage />);

    expect(
      await screen.findByText(
        'Terminal broker did not return a VM shell runtime surface. Backend runtime_launch must return a customer-scoped launch_url or opaque runtimeSurface handle.'
      )
    ).toBeInTheDocument();
  });

  it('clears stale terminal evidence when customer context changes', async () => {
    const user = userEvent.setup();
    brokerMocks.runtimeStatus
      .mockResolvedValueOnce({
        success: true,
        data: {
          schemaVersion: 'evaos.runtime_status.v1',
          customerId: 'david-poku',
          runtimeKey: 'terminal',
          displayLabel: 'Terminal',
          status: 'offline',
          healthSummary: 'First terminal evidence',
          sourcePointer: 'broker://runtime/terminal/first',
          auditId: 'audit_first',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          schemaVersion: 'evaos.runtime_status.v1',
          customerId: 'second-customer',
          runtimeKey: 'terminal',
          displayLabel: 'Terminal',
          status: 'denied',
          healthSummary: 'Second terminal denied',
          sourcePointer: 'broker://runtime/terminal/second',
          auditId: 'audit_second',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          schemaVersion: 'evaos.runtime_status.v1',
          customerId: 'second-customer',
          runtimeKey: 'terminal',
          displayLabel: 'Terminal',
          status: 'denied',
          healthSummary: 'Second terminal denied',
          sourcePointer: 'broker://runtime/terminal/second',
          auditId: 'audit_second',
        },
      });

    render(<TerminalPage />);

    expect(await screen.findByText('First terminal evidence')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Diagnostics' }));
    await user.click(screen.getByRole('button', { name: /^Second Customer$/ }));
    expect(screen.queryByText('First terminal evidence')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^check status$/i }));
    expect(await screen.findByText('Second terminal denied')).toBeInTheDocument();
    expect(screen.queryByText('broker://runtime/terminal/first')).not.toBeInTheDocument();
  });

  it('fails closed when the broker returns mismatched runtime evidence', async () => {
    brokerMocks.runtimeStatus.mockResolvedValue({
      success: true,
      data: {
        customerId: 'david-poku',
        runtimeKey: 'browser',
        displayLabel: 'Browser',
        status: 'running',
      },
    });

    render(<TerminalPage />);

    expect(
      (await screen.findAllByText('Terminal broker returned evidence for a different runtime or customer.')).length
    ).toBeGreaterThan(0);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Diagnostics' }));
    expect(
      screen.getByText('Fail-closed until evaOS broker returns customer-scoped Terminal evidence.')
    ).toBeInTheDocument();
  });
});
