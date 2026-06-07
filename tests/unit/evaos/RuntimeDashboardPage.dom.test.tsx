/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RuntimeDashboardPage from '@/renderer/pages/runtime-dashboard/RuntimeDashboardPage';

const evaosBrokerMock = vi.hoisted(() => ({
  runtimeStatus: vi.fn(),
  runtimeAction: vi.fn(),
}));

const customerContextMock = vi.hoisted(() => ({
  selectedCustomerId: 'fixture-customer-acme',
  selectedTarget: {
    customerId: 'fixture-customer-acme',
    displayName: 'Acme Fixture Co',
    isDefault: true,
  },
  targets: [
    {
      customerId: 'fixture-customer-acme',
      displayName: 'Acme Fixture Co',
      isDefault: true,
    },
  ],
  loading: false,
  summaryText: '1 customer target loaded',
  refreshTargets: vi.fn(),
  selectCustomer: vi.fn(),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@renderer/hooks/context/EvaosCustomerContext', () => ({
  useEvaosBrokeredCustomerContext: () => ({
    customerContext: customerContextMock,
  }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  evaosBroker: {
    runtimeStatus: {
      invoke: evaosBrokerMock.runtimeStatus,
    },
    runtimeAction: {
      invoke: evaosBrokerMock.runtimeAction,
    },
  },
}));

describe('RuntimeDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evaosBrokerMock.runtimeStatus.mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 'evaos.runtime_status.v1',
        customerId: 'fixture-customer-acme',
        customerAccountId: 'fixture-account-acme',
        runtimeKey: 'openclaw',
        displayLabel: 'evaOS',
        status: 'running',
        healthSummary: 'Runtime live',
        actions: ['attach_dashboard'],
        sourcePointer: 'broker:runtime_status:openclaw',
        auditId: 'audit-runtime-status',
      },
    });
    evaosBrokerMock.runtimeAction.mockResolvedValue({
      success: true,
      data: {
        status: 'opened',
        runtimeKey: 'openclaw',
        customerId: 'fixture-customer-acme',
        message: 'Opened evaOS through the evaOS broker.',
        sourcePointer: 'broker:runtime_launch:openclaw',
        auditId: 'audit-runtime-launch',
        backendEnforced: true,
      },
    });
  });

  it('invokes brokered runtime attach from the renderer without raw dashboard URLs', async () => {
    render(
      <RuntimeDashboardPage
        runtimeKey='openclaw'
        title='evaOS'
        subtitle='Primary evaOS agent workspace.'
        issueRef='#181'
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load status' }));

    expect(await screen.findByText('Broker action available')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start / Attach' }));

    await waitFor(() =>
      expect(evaosBrokerMock.runtimeAction).toHaveBeenCalledWith({
        customerId: 'fixture-customer-acme',
        runtime: 'openclaw',
        action: 'attach',
      })
    );
    expect(await screen.findByText(/Opened evaOS through the evaOS broker/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/desktop_session|eds_|Bearer|token=/i);
  });
});
