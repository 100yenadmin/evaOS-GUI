/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

const SUPPORT_DIAGNOSTICS_STORAGE_KEY = 'evaos.supportDiagnostics';

export function isEvaosSupportDiagnosticsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = window.localStorage?.getItem(SUPPORT_DIAGNOSTICS_STORAGE_KEY);
  if (stored === '1' || stored === 'true') return true;
  const params = new URLSearchParams(window.location.search);
  return params.get('evaos_support_diagnostics') === '1';
}

const SUPPORT_OPERATOR_ROLES = new Set(['customer_service', 'support']);
const GLOBAL_ADMIN_EMAILS = new Set(['admin@100yen.org', 'admin@electricsheephq.com']);

type EvaosSupportDiagnosticsContext = {
  authenticated?: boolean;
  userEmail?: string | null;
  roles?: readonly string[];
  isOperator?: boolean;
};

export function canShowEvaosSupportDiagnostics(context: EvaosSupportDiagnosticsContext): boolean {
  if (!isEvaosSupportDiagnosticsEnabled()) return false;
  if (context.authenticated === false) return false;
  if (isGlobalAdminEmail(context.userEmail)) return true;
  const roles = normalizedRoles(context.roles);
  return Boolean(context.isOperator && roles.some((role) => SUPPORT_OPERATOR_ROLES.has(role)));
}

function normalizedRoles(roles: readonly string[] | undefined): string[] {
  return (roles ?? []).map((role) => role.trim().toLowerCase().replace(/-/g, '_')).filter(Boolean);
}

function isGlobalAdminEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  return Boolean(normalized && GLOBAL_ADMIN_EMAILS.has(normalized));
}
