/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const EVAOS_BETA_WEBUI_SETTINGS_ENABLED = false;
export const EVAOS_BETA_WEBUI_FALLBACK_ROUTE = '/guid';

export function isEvaosBetaWebUISettingsEnabled(): boolean {
  return EVAOS_BETA_WEBUI_SETTINGS_ENABLED;
}

export function isEvaosBetaSettingsTabVisible(tabId: string): boolean {
  if (tabId === 'webui') {
    return isEvaosBetaWebUISettingsEnabled();
  }
  return true;
}

export function evaosBetaWebUIRouteElement<T>(allowedElement: T, blockedElement: T): T {
  return isEvaosBetaWebUISettingsEnabled() ? allowedElement : blockedElement;
}
