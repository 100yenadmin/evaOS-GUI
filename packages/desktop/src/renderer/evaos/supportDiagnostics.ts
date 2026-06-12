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
