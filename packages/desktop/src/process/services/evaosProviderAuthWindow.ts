/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserWindow, session } from 'electron';

const PROVIDER_AUTH_WINDOW_PARTITION = 'evaos-provider-auth';
const PROVIDER_AUTH_WINDOW_TITLE = 'evaOS Connected Apps';
const PROVIDER_AUTH_WEB_PREFERENCES: Electron.BrowserWindowConstructorOptions['webPreferences'] = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  partition: PROVIDER_AUTH_WINDOW_PARTITION,
};

let providerAuthWindow: BrowserWindow | null = null;

export async function openEvaosProviderAuthWindow(url: string): Promise<void> {
  const startUrl = normalizeProviderAuthWindowUrl(url);
  if (!startUrl) {
    throw new Error('Invalid evaOS provider auth URL.');
  }

  await session.fromPartition(PROVIDER_AUTH_WINDOW_PARTITION).clearStorageData();

  closeCurrentProviderAuthWindow();
  const authWindow = new BrowserWindow(buildProviderAuthWindowOptions());

  providerAuthWindow = authWindow;
  configureProviderAuthWindow(authWindow);

  await authWindow.loadURL(startUrl);
  authWindow.show();
}

function buildProviderAuthWindowOptions(): Electron.BrowserWindowConstructorOptions {
  return {
    title: PROVIDER_AUTH_WINDOW_TITLE,
    width: 1080,
    height: 820,
    minWidth: 720,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: '#111111',
    show: false,
    webPreferences: PROVIDER_AUTH_WEB_PREFERENCES,
  };
}

function configureProviderAuthWindow(authWindow: BrowserWindow): void {
  authWindow.setMenuBarVisibility(false);
  authWindow.on('closed', () => {
    if (providerAuthWindow === authWindow) {
      providerAuthWindow = null;
    }
  });

  authWindow.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    const safeUrl = normalizeProviderAuthWindowUrl(nextUrl);
    if (safeUrl) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: buildProviderAuthWindowOptions(),
      };
    }
    return { action: 'deny' };
  });

  const blockUnsafeNavigation = (event: Electron.Event, nextUrl: string): void => {
    if (!normalizeProviderAuthWindowUrl(nextUrl)) {
      event.preventDefault();
    }
  };
  authWindow.webContents.on('will-navigate', blockUnsafeNavigation);
  authWindow.webContents.on('will-redirect', blockUnsafeNavigation);
  authWindow.webContents.on('did-create-window', (childWindow) => {
    configureProviderAuthWindow(childWindow);
  });
}

function closeCurrentProviderAuthWindow(): void {
  if (providerAuthWindow && !providerAuthWindow.isDestroyed()) {
    providerAuthWindow.close();
  }
  providerAuthWindow = null;
}

function normalizeProviderAuthWindowUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}
