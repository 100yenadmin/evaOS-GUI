/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EvaosBrokerSessionClient } from '@/process/services/evaosBrokerSession';
import { beginEvaosDesktopAuth, stopEvaosDesktopAuthLoopback } from '@/process/services/evaosDesktopAuth';
import * as deepLink from '@/process/utils/deepLink';

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(async () => undefined),
  },
}));

describe('beginEvaosDesktopAuth', () => {
  afterEach(() => {
    stopEvaosDesktopAuthLoopback();
    deepLink.clearPendingDeepLinkPayload();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('opens the ElectricSheep desktop-auth page and imports the loopback callback in main process', async () => {
    const importCallback = vi.fn(() => ({
      state: 'authenticated',
      authenticated: true,
      expired: false,
      source: 'callback',
      message: 'evaOS desktop session is active.',
    }));
    const client = {
      importDesktopSessionFromCallbackUrl: importCallback,
    } as unknown as EvaosBrokerSessionClient;
    const openedUrls: string[] = [];

    const handoff = await beginEvaosDesktopAuth(client, {
      dashboardBaseUrl: 'https://www.electricsheephq.com',
      openExternal: async (url) => {
        openedUrls.push(url);
      },
      timeoutMs: 5000,
    });

    expect(openedUrls).toEqual([handoff.authUrl]);
    const authUrl = new URL(handoff.authUrl);
    expect(authUrl.origin).toBe('https://www.electricsheephq.com');
    expect(authUrl.pathname).toBe('/desktop-auth');
    expect(authUrl.searchParams.get('desktop_app')).toBe('1');
    expect(authUrl.searchParams.get('fresh')).toBe(handoff.fallbackDeviceCode);
    expect(authUrl.searchParams.get('desktop_callback')).toBe(handoff.callbackUrl);
    expect(authUrl.searchParams.get('app_id')).toBe('com.evaos.workbench.beta');
    expect(authUrl.searchParams.get('callback_scheme')).toBe('evaos-workbench-beta');
    expect(authUrl.searchParams.get('switch_account')).toBe('1');
    expect(authUrl.searchParams.get('prompt')).toBe('select_account');
    const callbackState = authUrl.searchParams.get('desktop_auth_state');
    expect(callbackState).toMatch(/^[A-F0-9-]{36}$/);
    expect(handoff.callbackUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback\?desktop_auth_state=/);
    expect(JSON.stringify(handoff)).not.toMatch(/eds_|desktop_session|access_token|Bearer/i);

    const callbackUrl = new URL(handoff.callbackUrl);
    expect(callbackUrl.searchParams.get('desktop_auth_state')).toBe(callbackState);
    callbackUrl.searchParams.set('desktop_session', 'eds_loopback_session_secret_for_test');
    callbackUrl.searchParams.set('desktop_session_expires_at', '2026-06-03T16:00:00.000Z');
    const response = await fetch(callbackUrl);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('connected');
    expect(importCallback).toHaveBeenCalledTimes(1);
    const importedUrl = new URL(importCallback.mock.calls[0][0]);
    expect(importedUrl.pathname).toBe('/auth/evaos-workbench-beta/callback');
    expect(importedUrl.searchParams.get('desktop_auth_state')).toBe(callbackState);
    expect(importedUrl.searchParams.get('desktop_session')).toBe('eds_loopback_session_secret_for_test');
  });

  it('rejects loopback callbacks that do not match the AionUi auth state', async () => {
    const importCallback = vi.fn();
    const client = {
      importDesktopSessionFromCallbackUrl: importCallback,
    } as unknown as EvaosBrokerSessionClient;

    const handoff = await beginEvaosDesktopAuth(client, {
      dashboardBaseUrl: 'https://www.electricsheephq.com',
      openExternal: async () => undefined,
      timeoutMs: 5000,
    });

    const missingStateCallback = new URL(handoff.callbackUrl);
    missingStateCallback.searchParams.delete('desktop_auth_state');
    missingStateCallback.searchParams.set('desktop_session', 'eds_loopback_session_secret_for_test');
    missingStateCallback.searchParams.set('desktop_session_expires_at', '2026-06-03T16:00:00.000Z');
    const missingStateResponse = await fetch(missingStateCallback);
    expect(missingStateResponse.status).toBe(400);
    expect(importCallback).not.toHaveBeenCalled();

    const wrongStateCallback = new URL(handoff.callbackUrl);
    wrongStateCallback.searchParams.set('desktop_auth_state', '00000000-0000-0000-0000-000000000000');
    wrongStateCallback.searchParams.set('desktop_session', 'eds_loopback_session_secret_for_test');
    wrongStateCallback.searchParams.set('desktop_session_expires_at', '2026-06-03T16:00:00.000Z');
    const wrongStateResponse = await fetch(wrongStateCallback);
    expect(wrongStateResponse.status).toBe(400);
    expect(importCallback).not.toHaveBeenCalled();
  });

  it('does not accept dashboard-compatible loopback callbacks without the beta auth state', async () => {
    const importCallback = vi.fn();
    const client = {
      importDesktopSessionFromCallbackUrl: importCallback,
    } as unknown as EvaosBrokerSessionClient;

    const handoff = await beginEvaosDesktopAuth(client, {
      dashboardBaseUrl: 'https://www.electricsheephq.com',
      openExternal: async () => undefined,
      timeoutMs: 5000,
    });

    const betaCallback = new URL(handoff.callbackUrl);
    const unsafeCallback = new URL(betaCallback.toString());
    unsafeCallback.searchParams.delete('desktop_auth_state');
    unsafeCallback.searchParams.set('desktop_session', 'eds_loopback_session_secret_for_test');
    unsafeCallback.searchParams.set('desktop_session_expires_at', '2026-06-03T16:00:00.000Z');

    const response = await fetch(unsafeCallback);

    expect(response.status).toBe(400);
    expect(importCallback).not.toHaveBeenCalled();
  });

  it('automatically claims the app-owned fallback code when loopback delivery is blocked', async () => {
    vi.useFakeTimers();
    const claimDeviceCode = vi.fn().mockRejectedValueOnce(new Error('not minted yet')).mockResolvedValueOnce({
      state: 'authenticated',
      authenticated: true,
      expired: false,
      source: 'memory',
      message: 'evaOS desktop session is active.',
    });
    const client = {
      importDesktopSessionFromCallbackUrl: vi.fn(),
      claimDeviceCode,
    } as unknown as EvaosBrokerSessionClient;

    const handoff = await beginEvaosDesktopAuth(client, {
      dashboardBaseUrl: 'https://www.electricsheephq.com',
      openExternal: async () => undefined,
      timeoutMs: 5000,
      deviceCodePollIntervalMs: 500,
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(claimDeviceCode).toHaveBeenCalledTimes(1);
    expect(claimDeviceCode).toHaveBeenLastCalledWith(handoff.fallbackDeviceCode);
    expect(deepLink.getPendingDeepLinkPayload()).toBeNull();

    await vi.advanceTimersByTimeAsync(500);
    expect(claimDeviceCode).toHaveBeenCalledTimes(2);
    expect(claimDeviceCode).toHaveBeenLastCalledWith(handoff.fallbackDeviceCode);
    expect(deepLink.getPendingDeepLinkPayload()).toEqual({
      action: deepLink.EVAOS_DESKTOP_SESSION_IMPORTED_ACTION,
      params: { source: 'device-code' },
    });
    expect(client.importDesktopSessionFromCallbackUrl).not.toHaveBeenCalled();
  });
});
