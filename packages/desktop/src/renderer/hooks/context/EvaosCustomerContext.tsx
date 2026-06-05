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
  roles: string[];
  isOperator: boolean;
  selectedCustomerId?: string;
  summaryText: string;
  loaded: boolean;
  loading: boolean;
  error?: string;
};

const EMPTY_STATE: EvaosCustomerContextState = {
  targets: [],
  roles: [],
  isOperator: false,
  selectedCustomerId: undefined,
  summaryText: 'No customer targets loaded',
  loaded: false,
  loading: false,
  error: undefined,
};

let state: EvaosCustomerContextState = EMPTY_STATE;
let requestEpoch = 0;
let activeSessionKey: string | undefined;
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

function safeOptionalUiText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return undefined;
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
}

function safeRoleList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => safeOptionalUiText(item))
    .filter((item): item is string => Boolean(item))
    .map((item) => item.slice(0, 80));
}

function customerTargetsSummary(count: number): string {
  return count === 1 ? '1 customer target loaded' : `${count} customer targets loaded`;
}

function safeCustomerTarget(target: IEvaosCustomerTargetView): IEvaosCustomerTargetView {
  return {
    ...target,
    displayName: safeUiText(target.displayName, safeOptionalUiText(target.customerId) ?? 'Customer target'),
    email: safeOptionalUiText(target.email),
    status: safeOptionalUiText(target.status),
    healthStatus: safeOptionalUiText(target.healthStatus),
  };
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
  activeSessionKey = undefined;
  requestEpoch += 1;
  emit(EMPTY_STATE);
}

function resetEvaosCustomerContextForSession(sessionKey: string): void {
  activeSessionKey = sessionKey;
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
    loaded: false,
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
        loaded: true,
        error: safeUiText(response.msg, 'Customer targets failed closed.'),
      });
      return;
    }

    if (epoch !== requestEpoch) {
      return;
    }
    const customers = response.data.customers.map(safeCustomerTarget);
    const sanitizedView = {
      ...response.data,
      customers,
      summaryText: safeUiText(response.data.summaryText, customerTargetsSummary(customers.length)),
    };

    emit({
      targets: sanitizedView.customers,
      roles: safeRoleList(sanitizedView.roles),
      isOperator: sanitizedView.isOperator === true,
      selectedCustomerId: chooseSelectedCustomer(sanitizedView),
      summaryText: sanitizedView.summaryText,
      loaded: true,
      loading: false,
      error: undefined,
    });
  } catch {
    if (epoch !== requestEpoch) {
      return;
    }
    emit({
      ...EMPTY_STATE,
      loaded: true,
      error: 'Customer targets broker request failed closed.',
    });
  }
}

export function useEvaosCustomerContext(
  authenticated: boolean,
  sessionKey?: string | null
): EvaosCustomerContextState & {
  selectedTarget?: IEvaosCustomerTargetView;
  refreshTargets: () => Promise<void>;
  selectCustomer: (customerId: string) => void;
} {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const normalizedSessionKey = authenticated ? normalizeSessionKey(sessionKey) : undefined;

  useEffect(() => {
    if (!authenticated) {
      clearEvaosCustomerContext();
      return;
    }
    if (normalizedSessionKey && activeSessionKey !== normalizedSessionKey) {
      resetEvaosCustomerContextForSession(normalizedSessionKey);
      void refreshEvaosCustomerTargets();
      return;
    }
    if (!state.loaded && !state.loading) {
      void refreshEvaosCustomerTargets();
    }
  }, [authenticated, normalizedSessionKey]);

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

function normalizeSessionKey(sessionKey: string | null | undefined): string {
  const normalized = sessionKey?.trim();
  return normalized || 'authenticated';
}
