/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { safeEvaosUiText } from './evaosSafeText';

const SAFE_BROKER_CODES = new Set([
  'missing_session',
  'expired_session',
  'invalid_customer',
  'action_denied',
  'broker_http_error',
  'broker_invalid_response',
  'broker_network_error',
]);

interface EvaosBridgeFailureLike {
  msg?: string;
  errorCode?: string;
  status?: number;
}

function safeBrokerCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return SAFE_BROKER_CODES.has(value) ? value : undefined;
}

function safeStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value < 600 ? value : undefined;
}

export function evaosBrokerBlockerText(
  t: (key: string, values?: Record<string, unknown>) => string,
  response: EvaosBridgeFailureLike | undefined,
  fallback: string
): string {
  const code = safeBrokerCode(response?.errorCode);
  const status = safeStatus(response?.status);

  if (code === 'missing_session' || code === 'expired_session') {
    return t('evaos.shared.blockers.signInRequired');
  }
  if (code === 'invalid_customer') {
    return t('evaos.shared.blockers.chooseCustomer');
  }
  if (code === 'action_denied') {
    return t('evaos.shared.blockers.policyDenied');
  }
  if (code === 'broker_invalid_response') {
    return t('evaos.shared.blockers.backendContractIncomplete');
  }
  if (code === 'broker_network_error') {
    return t('evaos.shared.blockers.brokerUnavailable');
  }
  if (code === 'broker_http_error') {
    if (status === 401) return t('evaos.shared.blockers.signInRequired');
    if (status === 403) return t('evaos.shared.blockers.policyDenied');
    if (status === 404) return t('evaos.shared.blockers.endpointMissing');
    if (status && status >= 500) return t('evaos.shared.blockers.brokerUnavailable');
    return t('evaos.shared.blockers.brokerRejected');
  }

  return safeEvaosUiText(response?.msg, fallback);
}
