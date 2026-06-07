/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { ipcBridge } from '@/common';
import { EVAOS_BETA_IDENTITY, isEvaosBetaBuild } from '../evaosBetaSafety';
import { getDefaultEvaosBrokerSessionClient } from '../services/evaosBrokerSession';

export const PROTOCOL_SCHEME = isEvaosBetaBuild() ? EVAOS_BETA_IDENTITY.protocolScheme : 'aionui';

export type DeepLinkPayload = { action: string; params: Record<string, string> };

export const EVAOS_DESKTOP_SESSION_IMPORTED_ACTION = 'evaos-auth/session-imported';

const RENDERER_SECRET_PARAM_NAMES = new Set([
  'api_key',
  'apikey',
  'key',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'secret',
  'client_secret',
  'code',
  'password',
  'credential',
  'credentials',
  'desktop_session',
  'grant',
  'grant_handle',
  'jwt',
  'provider_grant',
  'provider_grant_handle',
  'session',
  'session_token',
]);

export const isRendererSecretDeepLinkParam = (name: string): boolean => {
  const normalized = name.trim().toLowerCase().replace(/-/g, '_');
  return (
    RENDERER_SECRET_PARAM_NAMES.has(normalized) ||
    normalized.endsWith('_token') ||
    normalized.endsWith('_secret') ||
    normalized.endsWith('_credential')
  );
};

export const stripRendererSecretDeepLinkParams = (params: Record<string, string>): Record<string, string> => {
  const safeParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (isRendererSecretDeepLinkParam(key)) continue;
    safeParams[key] = value;
  }
  return safeParams;
};

type DesktopSessionImporter = (url: string) => boolean;

const defaultDesktopSessionImporter: DesktopSessionImporter = (url: string): boolean => {
  try {
    getDefaultEvaosBrokerSessionClient().importDesktopSessionFromCallbackUrl(url);
    return true;
  } catch {
    return false;
  }
};

let desktopSessionImporter = defaultDesktopSessionImporter;

export const setDeepLinkDesktopSessionImporterForTest = (importer: DesktopSessionImporter | null): void => {
  desktopSessionImporter = importer ?? defaultDesktopSessionImporter;
};

/**
 * Parse an app deep-link URL into action and params.
 * Supports two formats:
 *   1. <scheme>://add-provider?base_url=xxx&api_key=xxx
 *   2. <scheme>://provider/add?v=1&data=<base64 JSON>  (one-api / new-api style)
 */
export const parseDeepLinkUrl = (url: string): DeepLinkPayload | null => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${PROTOCOL_SCHEME}:`) return null;

    const hostname = parsed.hostname || '';
    const pathname = parsed.pathname.replace(/^\/+/, '');
    const action = pathname ? `${hostname}/${pathname}` : hostname;

    const params: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    // If data param exists, decode base64 JSON and merge into params
    if (params.data) {
      try {
        const json = JSON.parse(Buffer.from(params.data, 'base64').toString('utf-8'));
        if (json && typeof json === 'object') {
          for (const [key, value] of Object.entries(json)) {
            if (typeof value === 'string') {
              params[key] = value;
            }
          }
        }
      } catch {
        // Ignore decode errors
      }
      delete params.data;
    }

    return {
      action,
      params: isEvaosBetaBuild() ? stripRendererSecretDeepLinkParams(params) : params,
    };
  } catch {
    return null;
  }
};

let mainWindowRef: BrowserWindow | null = null;
let pendingDeepLinkPayload: DeepLinkPayload | null =
  parseDeepLinkUrl(process.argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`)) || '') || null;

export const setDeepLinkMainWindow = (win: BrowserWindow): void => {
  mainWindowRef = win;
};

export const getPendingDeepLinkPayload = (): DeepLinkPayload | null => pendingDeepLinkPayload;

export const clearPendingDeepLinkPayload = (): void => {
  pendingDeepLinkPayload = null;
};

/**
 * Send the deep-link payload to the renderer via IPC bridge.
 * If the window isn't ready yet, queue it.
 */
function emitOrQueueDeepLinkPayload(payload: DeepLinkPayload): void {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    pendingDeepLinkPayload = payload;
    return;
  }

  ipcBridge.deepLink.received.emit(payload);
}

export function notifyEvaosDesktopSessionImported(source: 'loopback' | 'protocol' | 'device-code'): void {
  emitOrQueueDeepLinkPayload({
    action: EVAOS_DESKTOP_SESSION_IMPORTED_ACTION,
    params: { source },
  });
}

export const handleDeepLinkUrl = (url: string): void => {
  if (desktopSessionImporter(url)) {
    notifyEvaosDesktopSessionImported('protocol');
    return;
  }

  const parsed = parseDeepLinkUrl(url);
  if (!parsed) return;

  emitOrQueueDeepLinkPayload(parsed);
};

export const emitDeepLinkPayload = (payload: DeepLinkPayload): void => {
  ipcBridge.deepLink.received.emit(payload);
};
