/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { evaosBroker } from '@/common/adapter/ipcBridge';
import { evaosBrokerSessionKey, useEvaosBrokerSessionStatus } from '@renderer/hooks/useEvaosBrokerSessionStatus';
import type {
  IEvaosAccountPolicyRole,
  IEvaosAccountPolicyScope,
  IEvaosBrokerSessionStatus,
  IEvaosCustomerTargetView,
  IEvaosCustomerTargetKind,
  IEvaosCustomerTargetsView,
} from '@/common/evaos/bridgeTypes';

const SECRET_TEXT_PATTERN =
  /\b(?:eds|epg)_[A-Za-z0-9_-]{4,}\b|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|authorization|bearer|secret|password/i;
const ACCOUNT_POLICY_SCOPES = new Set<IEvaosAccountPolicyScope>([
  'manage_members',
  'manage_billing',
  'manage_integrations',
  'approve_actions',
  'open_business_browser',
  'use_creative_studio',
  'use_design_workspace',
  'view_company_brain',
  'manage_company_brain',
  'assign_agents',
  'access_openclaw_dashboard',
  'access_hermes_dashboard',
  'access_terminal',
  'access_technical_diagnostics',
]);
const ACCOUNT_POLICY_ROLES = new Set<IEvaosAccountPolicyRole>([
  'owner',
  'admin',
  'billing_admin',
  'technical_admin',
  'manager',
  'member',
  'agent_only',
  'support',
]);

type EvaosCustomerContextState = {
  targets: IEvaosCustomerTargetView[];
  roles: string[];
  scopes: IEvaosAccountPolicyScope[];
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
  scopes: [],
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

function safeScopeList(value: unknown): IEvaosAccountPolicyScope[] {
  return safeRoleList(value)
    .map((item) => item.replace(/-/g, '_'))
    .filter((item): item is IEvaosAccountPolicyScope => ACCOUNT_POLICY_SCOPES.has(item as IEvaosAccountPolicyScope));
}

function safeAccountPolicyRole(value: unknown): IEvaosAccountPolicyRole | undefined {
  const role = safeOptionalUiText(value);
  return role && ACCOUNT_POLICY_ROLES.has(role as IEvaosAccountPolicyRole)
    ? (role as IEvaosAccountPolicyRole)
    : undefined;
}

function safeCustomerTargetKind(value: unknown, accountOnly?: boolean): IEvaosCustomerTargetKind | undefined {
  const kind = safeOptionalUiText(value);
  if (kind === 'customer' || kind === 'customer_account') {
    return kind;
  }
  return accountOnly === true ? 'customer_account' : undefined;
}

function customerTargetsSummary(count: number): string {
  return count === 1 ? '1 customer target loaded' : `${count} customer targets loaded`;
}

function safeCustomerTarget(target: IEvaosCustomerTargetView): IEvaosCustomerTargetView {
  const accountOnly = target.accountOnly === true;
  return {
    ...target,
    customerAccountId: safeOptionalUiText(target.customerAccountId),
    membershipId: safeOptionalUiText(target.membershipId),
    membershipRole: safeAccountPolicyRole(target.membershipRole),
    targetKind: safeCustomerTargetKind(target.targetKind, accountOnly),
    accountOnly: target.accountOnly === undefined ? undefined : accountOnly,
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
      scopes: safeScopeList(sanitizedView.scopes),
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
  sessionKey?: string | null,
  options?: { clearOnUnauthenticated?: boolean }
): EvaosCustomerContextState & {
  selectedTarget?: IEvaosCustomerTargetView;
  refreshTargets: () => Promise<void>;
  selectCustomer: (customerId: string) => void;
} {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const normalizedSessionKey = authenticated ? normalizeSessionKey(sessionKey) : undefined;
  const clearOnUnauthenticated = options?.clearOnUnauthenticated !== false;

  useEffect(() => {
    if (!authenticated) {
      if (clearOnUnauthenticated) {
        clearEvaosCustomerContext();
      }
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
  }, [authenticated, clearOnUnauthenticated, normalizedSessionKey]);

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

export function useEvaosBrokeredCustomerContext(): {
  brokerSession: IEvaosBrokerSessionStatus | null;
  brokerSessionLoading: boolean;
  brokerSessionError: string | null;
  brokerAuthenticated: boolean;
  customerContext: EvaosCustomerContextState & {
    selectedTarget?: IEvaosCustomerTargetView;
    refreshTargets: () => Promise<void>;
    selectCustomer: (customerId: string) => void;
  };
  refreshBrokerSession: () => Promise<void>;
} {
  const brokerSessionStatus = useEvaosBrokerSessionStatus(true);
  const brokerAuthenticated =
    brokerSessionStatus.session?.authenticated === true && brokerSessionStatus.session.expired !== true;
  const customerContext = useEvaosCustomerContext(
    brokerAuthenticated,
    evaosBrokerSessionKey(brokerSessionStatus.session),
    brokerSessionStatus.loading ? { clearOnUnauthenticated: false } : undefined
  );

  return {
    brokerSession: brokerSessionStatus.session,
    brokerSessionLoading: brokerSessionStatus.loading,
    brokerSessionError: brokerSessionStatus.error,
    brokerAuthenticated,
    customerContext,
    refreshBrokerSession: brokerSessionStatus.refresh,
  };
}

function normalizeSessionKey(sessionKey: string | null | undefined): string {
  const normalized = sessionKey?.trim();
  return normalized || 'authenticated';
}
