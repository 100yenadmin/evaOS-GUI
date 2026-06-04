/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { evaosBroker, type IEvaosCustomerTargetView, type IEvaosCustomerTargetsView } from '@/common/adapter/ipcBridge';

const SECRET_TEXT_PATTERN =
  /\b(?:eds|epg)_[A-Za-z0-9_-]{4,}\b|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|authorization|bearer|secret|password/i;

type EvaosCustomerContextState = {
  targets: IEvaosCustomerTargetView[];
  selectedCustomerId?: string;
  summaryText: string;
  loading: boolean;
  error?: string;
};

const EMPTY_STATE: EvaosCustomerContextState = {
  targets: [],
  selectedCustomerId: undefined,
  summaryText: 'No customer targets loaded',
  loading: false,
  error: undefined,
};

let state: EvaosCustomerContextState = EMPTY_STATE;
let requestEpoch = 0;
const listeners = new Set<() => void>();

function emit(next: EvaosCustomerContextState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): EvaosCustomerContextState {
  return state;
}

function safeUiText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
}

function chooseSelectedCustomer(view: IEvaosCustomerTargetsView): string | undefined {
  return (
    view.customers.find((target) => target.customerId === view.selectedCustomerId)?.customerId ??
    view.customers.find((target) => target.customerId === view.defaultCustomerId)?.customerId ??
    view.customers.find((target) => target.isDefault)?.customerId ??
    view.customers[0]?.customerId
  );
}

export function clearEvaosCustomerContext(): void {
  requestEpoch += 1;
  emit(EMPTY_STATE);
}

export function selectEvaosCustomer(customerId: string): void {
  const selectedCustomerId = state.targets.find((target) => target.customerId === customerId)?.customerId;
  emit({
    ...state,
    selectedCustomerId,
    error: selectedCustomerId ? undefined : 'Selected customer is not available for this session.',
  });
}

export async function refreshEvaosCustomerTargets(): Promise<void> {
  const epoch = requestEpoch + 1;
  requestEpoch = epoch;
  emit({
    ...state,
    loading: true,
    error: undefined,
  });

  try {
    const response = await evaosBroker.getCustomerTargets.invoke();
    if (epoch !== requestEpoch) {
      return;
    }
    if (!response.success || !response.data) {
      emit({
        ...EMPTY_STATE,
        error: safeUiText(response.msg, 'Customer targets failed closed.'),
      });
      return;
    }

    if (epoch !== requestEpoch) {
      return;
    }
    emit({
      targets: response.data.customers,
      selectedCustomerId: chooseSelectedCustomer(response.data),
      summaryText: response.data.summaryText,
      loading: false,
      error: undefined,
    });
  } catch {
    if (epoch !== requestEpoch) {
      return;
    }
    emit({
      ...EMPTY_STATE,
      error: 'Customer targets broker request failed closed.',
    });
  }
}

export function useEvaosCustomerContext(authenticated: boolean): EvaosCustomerContextState & {
  selectedTarget?: IEvaosCustomerTargetView;
  refreshTargets: () => Promise<void>;
  selectCustomer: (customerId: string) => void;
} {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (!authenticated) {
      clearEvaosCustomerContext();
      return;
    }
    if (state.targets.length === 0 && !state.loading) {
      void refreshEvaosCustomerTargets();
    }
  }, [authenticated]);

  const refreshTargets = useCallback(async () => {
    if (!authenticated) {
      clearEvaosCustomerContext();
      return;
    }
    await refreshEvaosCustomerTargets();
  }, [authenticated]);

  const selectCustomer = useCallback((customerId: string) => {
    selectEvaosCustomer(customerId);
  }, []);

  return {
    ...current,
    selectedTarget: current.targets.find((target) => target.customerId === current.selectedCustomerId),
    refreshTargets,
    selectCustomer,
  };
}
