/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearEvaosCustomerContext, useEvaosCustomerContext } from '@/renderer/hooks/context/EvaosCustomerContext';

const brokerMocks = vi.hoisted(() => ({
  getCustomerTargets: vi.fn(),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  evaosBroker: {
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
          displayName: 'David Poku Co',
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
      roles: ['viewer'],
      isOperator: false,
      customers: [],
      summaryText: 'No customer targets available for this desktop session.',
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

describe('EvaosCustomerContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEvaosCustomerContext();
  });

  it('fails closed for unauthenticated sessions without asking the broker for customer targets', () => {
    const { result } = renderHook(() => useEvaosCustomerContext(false));

    expect(result.current.targets).toEqual([]);
    expect(result.current.selectedCustomerId).toBeUndefined();
    expect(result.current.selectedTarget).toBeUndefined();
    expect(result.current.summaryText).toBe('No customer targets loaded');
    expect(brokerMocks.getCustomerTargets).not.toHaveBeenCalled();
  });

  it('loads valid customer targets and lets the operator switch the shared selection', async () => {
    brokerMocks.getCustomerTargets.mockResolvedValue(customerTargets());

    const { result } = renderHook(() => useEvaosCustomerContext(true));

    await waitFor(() => expect(result.current.selectedCustomerId).toBe('david-poku'));
    expect(result.current.selectedTarget?.displayName).toBe('David Poku Co');

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

  it('sanitizes broker denial text before it can enter renderer-visible context state', async () => {
    brokerMocks.getCustomerTargets.mockResolvedValue({
      success: false,
      msg: 'desktop_session=eds_raw_customer_target_secret Authorization: Bearer raw-token',
    });

    const { result } = renderHook(() => useEvaosCustomerContext(true));

    await waitFor(() => expect(result.current.error).toBe('Customer targets failed closed.'));
    expect(JSON.stringify(result.current)).not.toMatch(/eds_raw_customer_target_secret|Bearer|desktop_session/);
  });
});
