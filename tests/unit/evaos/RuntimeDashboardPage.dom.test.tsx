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

  it.each([
    ['openclaw', 'evaOS', '#181'],
    ['hermes', 'Hermes', '#181'],
    ['paperclip', 'Mission Control', '#181'],
  ] as const)(
    'mounts an embedded %s runtime surface when the broker returns an opaque surface handle',
    async (runtimeKey, title, issueRef) => {
      evaosBrokerMock.runtimeStatus.mockResolvedValueOnce({
        success: true,
        data: {
          schemaVersion: 'evaos.runtime_status.v1',
          customerId: 'fixture-customer-acme',
          customerAccountId: 'fixture-account-acme',
          runtimeKey,
          displayLabel: title,
          status: 'running',
          healthSummary: `${title} runtime live`,
          actions: ['attach_dashboard'],
          sourcePointer: `broker:runtime_status:${runtimeKey}`,
          auditId: `audit-runtime-status-${runtimeKey}`,
        },
      });
      evaosBrokerMock.runtimeAction.mockResolvedValueOnce({
        success: true,
        data: {
          status: 'attached',
          runtimeKey,
          customerId: 'fixture-customer-acme',
          message: `Attached ${title} runtime surface.`,
          runtimeSurface: {
            schemaVersion: 'evaos.runtime_surface.v1',
            surfaceId: `surface-${runtimeKey}-fixture`,
            surfaceUri: `evaos-runtime-surface://surface-${runtimeKey}-fixture/`,
            customerId: 'fixture-customer-acme',
            runtimeKey,
            displayLabel: title,
            status: 'attached',
            sourcePointer: `broker:runtime_launch:${runtimeKey}`,
            auditId: `audit-runtime-launch-${runtimeKey}`,
          },
          backendEnforced: true,
        },
      });

      render(
        <RuntimeDashboardPage
          runtimeKey={runtimeKey}
          title={title}
          subtitle='Primary evaOS agent workspace.'
          issueRef={issueRef}
        />
      );

      expect(await screen.findByText('Broker action available')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Start / Attach' }));

      const surface = await screen.findByTestId(`evaos-runtime-surface-${runtimeKey}`);
      expect(surface).toHaveAttribute('src', `evaos-runtime-surface://surface-${runtimeKey}-fixture/`);
      expect(surface).toHaveAttribute('partition', `evaos-runtime-surface-${runtimeKey}-fixture`);
      expect(surface).not.toHaveAttribute('allowpopups', 'true');
      expect(document.body.textContent).not.toMatch(/desktop_session|eds_|Bearer|token=|launch_url/i);
      expect(document.body.textContent).not.toContain('runtime.example.test');
    }
  );

  it('loads brokered runtime status automatically for the selected customer', async () => {
    render(
      <RuntimeDashboardPage
        runtimeKey='openclaw'
        title='evaOS'
        subtitle='Primary evaOS agent workspace.'
        issueRef='#181'
      />
    );

    await waitFor(() =>
      expect(evaosBrokerMock.runtimeStatus).toHaveBeenCalledWith({
        customerId: 'fixture-customer-acme',
        runtime: 'openclaw',
      })
    );
    expect(await screen.findByText('Broker action available')).toBeInTheDocument();
    expect(screen.getByText('live')).toBeInTheDocument();
  });

  it('does not advertise runtime actions when status omits advisory actions', async () => {
    evaosBrokerMock.runtimeStatus.mockResolvedValueOnce({
      success: true,
      data: {
        schemaVersion: 'evaos.runtime_status.v1',
        customerId: 'fixture-customer-acme',
        customerAccountId: 'fixture-account-acme',
        runtimeKey: 'openclaw',
        displayLabel: 'evaOS',
        status: 'running',
        healthSummary: 'Runtime live without advisory action list',
        sourcePointer: 'broker:runtime_status:openclaw',
        auditId: 'audit-runtime-status',
      },
    });

    render(
      <RuntimeDashboardPage
        runtimeKey='openclaw'
        title='evaOS'
        subtitle='Primary evaOS agent workspace.'
        issueRef='#181'
      />
    );

    expect(await screen.findByText('Runtime action blocked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start / Attach' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    expect(evaosBrokerMock.runtimeAction).not.toHaveBeenCalled();
  });

  it('settles denied broker evidence without exposing attach or open actions', async () => {
    evaosBrokerMock.runtimeStatus.mockResolvedValueOnce({
      success: true,
      data: {
        schemaVersion: 'evaos.runtime_status.v1',
        customerId: 'fixture-customer-acme',
        customerAccountId: 'fixture-account-acme',
        runtimeKey: 'openclaw',
        displayLabel: 'evaOS',
        status: 'denied',
        healthSummary: 'Runtime denied by broker policy',
        actions: [],
        sourcePointer: 'broker:runtime_status:openclaw',
        auditId: 'audit-runtime-denied',
      },
    });

    render(
      <RuntimeDashboardPage
        runtimeKey='openclaw'
        title='evaOS'
        subtitle='Primary evaOS agent workspace.'
        issueRef='#181'
      />
    );

    expect((await screen.findAllByText('denied')).length).toBeGreaterThan(0);
    expect(screen.getByText('Runtime action blocked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start / Attach' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('maps open-dashboard evidence to a safe broker open action', async () => {
    evaosBrokerMock.runtimeStatus.mockResolvedValueOnce({
      success: true,
      data: {
        schemaVersion: 'evaos.runtime_status.v1',
        customerId: 'fixture-customer-acme',
        customerAccountId: 'fixture-account-acme',
        runtimeKey: 'openclaw',
        displayLabel: 'evaOS',
        status: 'repair_required',
        healthSummary: 'Runtime needs broker repair before attach.',
        actions: ['open_dashboard'],
        sourcePointer: 'broker:runtime_status:openclaw',
        auditId: 'audit-runtime-repair',
      },
    });
    evaosBrokerMock.runtimeAction.mockResolvedValueOnce({
      success: true,
      data: {
        status: 'opened',
        runtimeKey: 'openclaw',
        customerId: 'fixture-customer-acme',
        message: 'access_token hidden by renderer fallback',
        urlSummary: {
          scheme: 'https',
          host: 'openclaw.fixture.example.test',
          displayText: 'openclaw.fixture.example.test/workspace',
          redacted: true,
        },
        sourcePointer: 'broker:runtime_launch:openclaw',
        auditId: 'audit-runtime-open',
        backendEnforced: true,
      },
    });

    render(
      <RuntimeDashboardPage
        runtimeKey='openclaw'
        title='evaOS'
        subtitle='Primary evaOS agent workspace.'
        issueRef='#181'
      />
    );

    expect(await screen.findByText('repair')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() =>
      expect(evaosBrokerMock.runtimeAction).toHaveBeenCalledWith({
        customerId: 'fixture-customer-acme',
        runtime: 'openclaw',
        action: 'open',
      })
    );
    expect(await screen.findByText(/Target openclaw.fixture.example.test\/workspace/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/access_token|desktop_session|Bearer|token=/i);
  });
});
