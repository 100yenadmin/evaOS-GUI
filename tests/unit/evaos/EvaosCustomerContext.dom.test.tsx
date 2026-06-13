/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearEvaosCustomerContext,
  useEvaosBrokeredCustomerContext,
  useEvaosCustomerContext,
} from '@/renderer/hooks/context/EvaosCustomerContext';

const brokerMocks = vi.hoisted(() => ({
  getSessionStatus: vi.fn(),
  getCustomerTargets: vi.fn(),
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
}));

function customerTargets(selectedCustomerId = 'david-poku') {
  return {
    success: true,
    data: {
      roles: ['admin'],
      isOperator: true,
      defaultCustomerId: 'david-poku',
      selectedCustomerId,
      customers: [
        {
          customerId: 'david-poku',
          customerAccountId: 'acct_david',
          membershipId: 'mem_david_admin',
          membershipRole: 'admin',
          targetKind: 'customer_account',
          displayName: 'David Poku Co',
          status: 'active',
          healthStatus: 'ready',
          isDefault: true,
        },
        {
          customerId: 'second-customer',
          customerAccountId: 'acct_second',
          membershipId: 'mem_second_owner',
          membershipRole: 'owner',
          targetKind: 'customer',
          accountOnly: false,
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
      roles: ['viewer'],
      isOperator: false,
      customers: [],
      summaryText: 'No customer targets available for this desktop session.',
    },
  };
}

function memberCustomerTargets() {
  return {
    success: true,
    data: {
      roles: ['member'],
      isOperator: false,
      defaultCustomerId: 'member-customer',
      selectedCustomerId: 'member-customer',
      customers: [
        {
          customerId: 'member-customer',
          displayName: 'Member Customer',
          status: 'active',
          healthStatus: 'ready',
          isDefault: true,
        },
      ],
      summaryText: '1 customer target loaded',
    },
  };
}

function brokerSession(userEmail = 'admin@100yen.org') {
  return {
    success: true,
    data: {
      state: 'authenticated',
      authenticated: true,
      expired: false,
      userEmail,
      expiresAt: userEmail === 'admin@100yen.org' ? '2026-06-06T12:00:00.000Z' : '2026-06-06T13:00:00.000Z',
      source: 'callback',
      message: 'Session active',
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

const CustomerContextProbe: React.FC = () => {
  const context = useEvaosCustomerContext(true);

  return (
    <div>
      <p>{context.summaryText}</p>
      <p>{context.error ?? 'no error'}</p>
      <p>{context.selectedTarget?.displayName ?? 'no selected target'}</p>
      <button onClick={() => void context.refreshTargets()}>Refresh</button>
    </div>
  );
};

describe('EvaosCustomerContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEvaosCustomerContext();
    brokerMocks.getSessionStatus.mockResolvedValue(brokerSession());
  });

  it('fails closed for unauthenticated sessions without asking the broker for customer targets', () => {
    const { result } = renderHook(() => useEvaosCustomerContext(false));

    expect(result.current.targets).toEqual([]);
    expect(result.current.selectedCustomerId).toBeUndefined();
    expect(result.current.selectedTarget).toBeUndefined();
    expect(result.current.summaryText).toBe('No customer targets loaded');
    expect(result.current.loaded).toBe(false);
    expect(brokerMocks.getCustomerTargets).not.toHaveBeenCalled();
  });

  it('loads valid customer targets and lets the operator switch the shared selection', async () => {
    brokerMocks.getCustomerTargets.mockResolvedValue(customerTargets());

    const { result } = renderHook(() => useEvaosCustomerContext(true));

    await waitFor(() => expect(result.current.selectedCustomerId).toBe('david-poku'));
    expect(result.current.selectedTarget?.displayName).toBe('David Poku Co');
    expect(result.current.selectedTarget).toMatchObject({
      customerAccountId: 'acct_david',
      membershipId: 'mem_david_admin',
      membershipRole: 'admin',
      targetKind: 'customer_account',
    });
    expect(result.current.roles).toEqual(['admin']);
    expect(result.current.isOperator).toBe(true);
    expect(result.current.loaded).toBe(true);

    act(() => {
      result.current.selectCustomer('second-customer');
    });

    expect(result.current.selectedCustomerId).toBe('second-customer');
    expect(result.current.selectedTarget?.displayName).toBe('Second Customer');
    expect(result.current.error).toBeUndefined();
  });

  it('renders a no-customer shell state when the session has no available customer target', async () => {
    brokerMocks.getCustomerTargets.mockResolvedValue(emptyCustomerTargets());

    const { result } = renderHook(() => useEvaosCustomerContext(true));

    await waitFor(() =>
      expect(result.current.summaryText).toBe('No customer targets available for this desktop session.')
    );
    expect(result.current.targets).toEqual([]);
    expect(result.current.selectedCustomerId).toBeUndefined();
    expect(result.current.selectedTarget).toBeUndefined();
    expect(result.current.loaded).toBe(true);
  });

  it('clears customer state on session loss and ignores stale target responses', async () => {
    const staleTargets = deferred<ReturnType<typeof customerTargets>>();
    brokerMocks.getCustomerTargets
      .mockReturnValueOnce(staleTargets.promise)
      .mockResolvedValueOnce(customerTargets('second-customer'));

    const { result, rerender } = renderHook(({ authenticated }) => useEvaosCustomerContext(authenticated), {
      initialProps: { authenticated: true },
    });

    await waitFor(() => expect(result.current.loading).toBe(true));

    rerender({ authenticated: false });
    expect(result.current.targets).toEqual([]);
    expect(result.current.selectedCustomerId).toBeUndefined();
    expect(result.current.roles).toEqual([]);
    expect(result.current.isOperator).toBe(false);
    expect(result.current.loaded).toBe(false);

    await act(async () => {
      staleTargets.resolve(customerTargets());
      await staleTargets.promise;
    });

    expect(result.current.targets).toEqual([]);
    expect(result.current.selectedCustomerId).toBeUndefined();

    rerender({ authenticated: true });

    await waitFor(() => expect(result.current.selectedCustomerId).toBe('second-customer'));
    expect(result.current.selectedTarget?.displayName).toBe('Second Customer');
  });

  it('preserves already-loaded customer context while an independent broker check is pending', async () => {
    brokerMocks.getCustomerTargets.mockResolvedValue(customerTargets());

    const { result, rerender } = renderHook(
      ({ authenticated, clearOnUnauthenticated }) =>
        useEvaosCustomerContext(authenticated, undefined, { clearOnUnauthenticated }),
      {
        initialProps: { authenticated: true, clearOnUnauthenticated: true },
      }
    );

    await waitFor(() => expect(result.current.selectedCustomerId).toBe('david-poku'));

    rerender({ authenticated: false, clearOnUnauthenticated: false });

    expect(result.current.selectedCustomerId).toBe('david-poku');
    expect(result.current.selectedTarget?.displayName).toBe('David Poku Co');
    expect(result.current.loaded).toBe(true);
    expect(brokerMocks.getCustomerTargets).toHaveBeenCalledTimes(1);
  });

  it('clears and refetches role state when the authenticated broker session identity changes', async () => {
    brokerMocks.getCustomerTargets
      .mockResolvedValueOnce(customerTargets())
      .mockResolvedValueOnce(memberCustomerTargets());

    const { result, rerender } = renderHook(
      ({ authenticated, sessionKey }) => useEvaosCustomerContext(authenticated, sessionKey),
      {
        initialProps: { authenticated: true, sessionKey: 'admin-session' },
      }
    );

    await waitFor(() => expect(result.current.roles).toEqual(['admin']));
    expect(result.current.isOperator).toBe(true);
    expect(result.current.selectedCustomerId).toBe('david-poku');

    rerender({ authenticated: true, sessionKey: 'member-session' });

    await waitFor(() => expect(result.current.roles).toEqual(['member']));
    expect(result.current.isOperator).toBe(false);
    expect(result.current.selectedCustomerId).toBe('member-customer');
    expect(result.current.selectedTarget?.displayName).toBe('Member Customer');
    expect(brokerMocks.getCustomerTargets).toHaveBeenCalledTimes(2);
  });

  it('brokered customer context refreshes targets when the broker session identity changes', async () => {
    brokerMocks.getSessionStatus
      .mockResolvedValueOnce(brokerSession())
      .mockResolvedValueOnce(brokerSession('member@example.test'));
    brokerMocks.getCustomerTargets
      .mockResolvedValueOnce(customerTargets())
      .mockResolvedValueOnce(memberCustomerTargets());

    const { result } = renderHook(() => useEvaosBrokeredCustomerContext());

    await waitFor(() => expect(result.current.customerContext.roles).toEqual(['admin']));
    expect(result.current.brokerAuthenticated).toBe(true);
    expect(result.current.customerContext.selectedCustomerId).toBe('david-poku');

    await act(async () => {
      await result.current.refreshBrokerSession();
    });

    await waitFor(() => expect(result.current.customerContext.roles).toEqual(['member']));
    expect(result.current.brokerSession?.userEmail).toBe('member@example.test');
    expect(result.current.customerContext.selectedCustomerId).toBe('member-customer');
    expect(brokerMocks.getCustomerTargets).toHaveBeenCalledTimes(2);
  });

  it('brokered customer context refreshes after a sanitized desktop session import event', async () => {
    brokerMocks.getSessionStatus
      .mockResolvedValueOnce(brokerSession())
      .mockResolvedValueOnce(brokerSession('member@example.test'));
    brokerMocks.getCustomerTargets
      .mockResolvedValueOnce(customerTargets())
      .mockResolvedValueOnce(memberCustomerTargets());

    const { result } = renderHook(() => useEvaosBrokeredCustomerContext());

    await waitFor(() => expect(result.current.customerContext.roles).toEqual(['admin']));

    await act(async () => {
      window.dispatchEvent(new CustomEvent('evaos:desktop-session-imported', { detail: { source: 'protocol' } }));
    });

    await waitFor(() => expect(result.current.brokerSession?.userEmail).toBe('member@example.test'));
    await waitFor(() => expect(result.current.customerContext.roles).toEqual(['member']));
    expect(result.current.customerContext.selectedCustomerId).toBe('member-customer');
    expect(brokerMocks.getSessionStatus).toHaveBeenCalledTimes(2);
    expect(brokerMocks.getCustomerTargets).toHaveBeenCalledTimes(2);
  });

  it('sanitizes broker denial text before it can enter renderer-visible context state', async () => {
    brokerMocks.getCustomerTargets.mockResolvedValue({
      success: false,
      msg: 'desktop_session=eds_raw_customer_target_secret Authorization: Bearer raw-token',
    });

    const { result } = renderHook(() => useEvaosCustomerContext(true));

    await waitFor(() => expect(result.current.error).toBe('Customer targets failed closed.'));
    expect(result.current.loaded).toBe(true);
    expect(JSON.stringify(result.current)).not.toMatch(/eds_raw_customer_target_secret|Bearer|desktop_session/);
  });

  it('sanitizes secret-shaped customer target display names and summary text', async () => {
    const user = userEvent.setup();
    brokerMocks.getCustomerTargets.mockResolvedValue({
      success: true,
      data: {
        roles: ['admin'],
        isOperator: true,
        defaultCustomerId: 'customer_safe',
        selectedCustomerId: 'customer_safe',
        customers: [
          {
            customerId: 'customer_safe',
            displayName: 'eds_target_secret should not render',
            status: 'active',
            healthStatus: 'ready',
            isDefault: true,
          },
        ],
        summaryText: 'Bearer desktop_session should not render',
      },
    });

    const { container } = render(<CustomerContextProbe />);

    await user.click(screen.getByRole('button', { name: /^refresh$/i }));

    expect(await screen.findByText('1 customer target loaded')).toBeInTheDocument();
    expect(screen.getByText('customer_safe')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/eds_target_secret|Bearer|desktop_session/i);
  });

  it('does not render a secret-shaped customer id as display fallback', async () => {
    const user = userEvent.setup();
    brokerMocks.getCustomerTargets.mockResolvedValue({
      success: true,
      data: {
        roles: ['admin'],
        isOperator: true,
        defaultCustomerId: 'eds_customer_secret',
        selectedCustomerId: 'eds_customer_secret',
        customers: [
          {
            customerId: 'eds_customer_secret',
            displayName: 'refresh_token should not render',
            status: 'active',
            healthStatus: 'ready',
            isDefault: true,
          },
        ],
        summaryText: '1 customer target loaded',
      },
    });

    const { container } = render(<CustomerContextProbe />);

    await user.click(screen.getByRole('button', { name: /^refresh$/i }));

    expect(await screen.findByText('Customer target')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/eds_customer_secret|refresh_token/i);
  });

  it('preserves safe account target metadata without surfacing secret-shaped membership fields', async () => {
    brokerMocks.getCustomerTargets.mockResolvedValue({
      success: true,
      data: {
        roles: ['admin'],
        isOperator: true,
        defaultCustomerId: 'customer_safe',
        selectedCustomerId: 'customer_safe',
        customers: [
          {
            customerId: 'customer_safe',
            customerAccountId: 'acct_safe',
            membershipId: 'mem_safe_admin',
            membershipRole: 'technical_admin',
            targetKind: 'customer_account',
            accountOnly: true,
            displayName: 'Safe Customer',
            status: 'active',
            healthStatus: 'ready',
            isDefault: true,
          },
          {
            customerId: 'customer_dirty',
            customerAccountId: 'eds_account_secret',
            membershipId: 'provider_grant_should_not_render',
            membershipRole: 'root',
            targetKind: 'secret',
            accountOnly: true,
            displayName: 'Dirty Customer',
            status: 'active',
            healthStatus: 'ready',
            isDefault: false,
          },
        ],
        summaryText: '2 customer targets loaded',
      },
    });

    const { result } = renderHook(() => useEvaosCustomerContext(true));

    await waitFor(() => expect(result.current.selectedCustomerId).toBe('customer_safe'));
    expect(result.current.targets[0]).toMatchObject({
      customerAccountId: 'acct_safe',
      membershipId: 'mem_safe_admin',
      membershipRole: 'technical_admin',
      targetKind: 'customer_account',
      accountOnly: true,
    });
    expect(result.current.targets[1]).toMatchObject({
      displayName: 'Dirty Customer',
      targetKind: 'customer_account',
      accountOnly: true,
    });
    expect(result.current.targets[1].customerAccountId).toBeUndefined();
    expect(result.current.targets[1].membershipId).toBeUndefined();
    expect(result.current.targets[1].membershipRole).toBeUndefined();
    expect(JSON.stringify(result.current)).not.toMatch(/eds_account_secret|provider_grant_should_not_render/);
  });
});
