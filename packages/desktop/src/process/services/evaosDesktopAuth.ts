/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import { createServer, type Server } from 'http';
import { shell } from 'electron';
import type { IEvaosBrokerBeginDesktopAuthResult } from '@/common/evaos/bridgeTypes';
import { EVAOS_BETA_IDENTITY } from '../evaosBetaSafety';
import {
  EvaosBrokerSessionError,
  getDefaultEvaosBrokerSessionClient,
  type EvaosBrokerSessionClient,
} from './evaosBrokerSession';

const DEFAULT_DASHBOARD_BASE_URL = 'https://www.electricsheephq.com';
const AUTH_LOOPBACK_HOST = '127.0.0.1';
const AUTH_LOOPBACK_PATH = EVAOS_BETA_IDENTITY.loopbackCallbackPath;
const AUTH_LOOPBACK_STATE_PARAM = 'desktop_auth_state';
const AUTH_LOOPBACK_TIMEOUT_MS = 180_000;

type OpenExternal = (url: string) => Promise<void>;

interface ActiveLoopback {
  server: Server;
  timeout: NodeJS.Timeout;
}

let activeLoopback: ActiveLoopback | null = null;

export interface BeginEvaosDesktopAuthOptions {
  dashboardBaseUrl?: string;
  openExternal?: OpenExternal;
  timeoutMs?: number;
}

export async function beginEvaosDesktopAuth(
  client: EvaosBrokerSessionClient = getDefaultEvaosBrokerSessionClient(),
  options: BeginEvaosDesktopAuthOptions = {}
): Promise<IEvaosBrokerBeginDesktopAuthResult> {
  stopActiveLoopback();

  const fallbackDeviceCode = randomUUID().toUpperCase();
  const desktopAuthState = randomUUID().toUpperCase();
  const timeoutMs = options.timeoutMs ?? AUTH_LOOPBACK_TIMEOUT_MS;
  const { server, callbackUrl } = await startLoopbackReceiver(client, desktopAuthState);
  const timeout = setTimeout(() => stopActiveLoopback(server), timeoutMs);
  activeLoopback = { server, timeout };

  const authUrl = buildDesktopAuthUrl({
    dashboardBaseUrl: options.dashboardBaseUrl ?? process.env.AIONUI_EVAOS_DASHBOARD_BASE_URL,
    fallbackDeviceCode,
    callbackUrl,
    desktopAuthState,
  });

  try {
    const openExternal = options.openExternal ?? ((url: string) => shell.openExternal(url));
    await openExternal(authUrl);
  } catch {
    stopActiveLoopback(server);
    throw new EvaosBrokerSessionError(
      'broker_network_error',
      'evaOS Workbench could not open the ElectricSheep desktop sign-in page.'
    );
  }

  return {
    authUrl,
    callbackUrl,
    fallbackDeviceCode,
    message:
      'ElectricSheep sign-in opened. Choose the intended Google account, finish sign-in, then return and refresh evaOS.',
  };
}

export function stopEvaosDesktopAuthLoopback(): void {
  stopActiveLoopback();
}

function buildDesktopAuthUrl({
  dashboardBaseUrl,
  fallbackDeviceCode,
  callbackUrl,
  desktopAuthState,
}: {
  dashboardBaseUrl?: string;
  fallbackDeviceCode: string;
  callbackUrl: string;
  desktopAuthState: string;
}): string {
  let baseUrl: URL;
  try {
    baseUrl = new URL(dashboardBaseUrl?.trim() || DEFAULT_DASHBOARD_BASE_URL);
  } catch {
    baseUrl = new URL(DEFAULT_DASHBOARD_BASE_URL);
  }

  const authUrl = new URL('/desktop-auth', baseUrl);
  authUrl.searchParams.set('desktop_app', '1');
  authUrl.searchParams.set('app_id', EVAOS_BETA_IDENTITY.appId);
  authUrl.searchParams.set('callback_scheme', EVAOS_BETA_IDENTITY.protocolScheme);
  authUrl.searchParams.set('fresh', fallbackDeviceCode);
  authUrl.searchParams.set(AUTH_LOOPBACK_STATE_PARAM, desktopAuthState);
  authUrl.searchParams.set('desktop_callback', callbackUrl);
  authUrl.searchParams.set('switch_account', '1');
  authUrl.searchParams.set('prompt', 'select_account');
  return authUrl.toString();
}

async function startLoopbackReceiver(
  client: EvaosBrokerSessionClient,
  desktopAuthState: string
): Promise<{ server: Server; callbackUrl: string }> {
  const server = createServer((request, response) => {
    const requestUrl = request.url ?? '';
    const host = typeof request.headers.host === 'string' ? request.headers.host : AUTH_LOOPBACK_HOST;
    const callbackUrl = `http://${host}${requestUrl}`;
    let parsedCallback: URL;
    try {
      parsedCallback = new URL(callbackUrl);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('evaOS Workbench Beta callback route not found.');
      return;
    }

    if (parsedCallback.pathname !== AUTH_LOOPBACK_PATH) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('evaOS Workbench Beta callback route not found.');
      return;
    }

    if (parsedCallback.searchParams.get(AUTH_LOOPBACK_STATE_PARAM) !== desktopAuthState) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Invalid evaOS Workbench Beta callback.');
      return;
    }

    try {
      client.importDesktopSessionFromCallbackUrl(callbackUrl);
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('evaOS Workbench Beta is connected. You can return to the app.');
      stopActiveLoopback(server);
    } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Invalid evaOS Workbench Beta callback.');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, AUTH_LOOPBACK_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new EvaosBrokerSessionError(
      'broker_network_error',
      'evaOS Workbench could not create a local sign-in callback.'
    );
  }

  return {
    server,
    callbackUrl: `http://${AUTH_LOOPBACK_HOST}:${address.port}${AUTH_LOOPBACK_PATH}?${AUTH_LOOPBACK_STATE_PARAM}=${encodeURIComponent(
      desktopAuthState
    )}`,
  };
}

function stopActiveLoopback(server?: Server): void {
  const active = activeLoopback;
  if (!active) {
    if (server?.listening) {
      server.close();
    }
    return;
  }

  if (!server || active.server === server) {
    clearTimeout(active.timeout);
    if (active.server.listening) {
      active.server.close();
    }
    activeLoopback = null;
    return;
  }

  if (server.listening) {
    server.close();
  }
}
