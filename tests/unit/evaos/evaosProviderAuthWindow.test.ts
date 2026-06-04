/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openEvaosProviderAuthWindow } from '@/process/services/evaosProviderAuthWindow';

type FakeNavigationEvent = {
  preventDefault: ReturnType<typeof vi.fn>;
};

type FakeWebContents = {
  loadURL: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
  events: Map<string, (...args: unknown[]) => void>;
  windowOpenHandler?: (details: { url: string }) => {
    action: 'allow' | 'deny';
    overrideBrowserWindowOptions?: unknown;
  };
};

type FakeWindow = {
  close: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  setMenuBarVisibility: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  webContents: FakeWebContents;
  options: unknown;
};

const createdWindows: FakeWindow[] = [];
const clearStorageData = vi.fn(async () => undefined);

vi.mock('electron', () => {
  class FakeBrowserWindow {
    close = vi.fn();
    isDestroyed = vi.fn(() => false);
    loadURL = vi.fn(async (url: string) => {
      this.loadedUrl = url;
    });
    loadedUrl = '';
    on = vi.fn();
    setMenuBarVisibility = vi.fn();
    show = vi.fn();
    webContents: FakeWebContents;
    options: unknown;

    constructor(options: unknown) {
      this.options = options;
      this.webContents = {
        events: new Map(),
        loadURL: this.loadURL,
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          this.webContents.events.set(event, handler);
        }),
        setWindowOpenHandler: vi.fn(
          (
            handler: (details: { url: string }) => { action: 'allow' | 'deny'; overrideBrowserWindowOptions?: unknown }
          ) => {
            this.webContents.windowOpenHandler = handler;
          }
        ),
      };
      createdWindows.push(this as unknown as FakeWindow);
    }
  }

  return {
    BrowserWindow: FakeBrowserWindow,
    session: {
      fromPartition: vi.fn(() => ({ clearStorageData })),
    },
  };
});

describe('openEvaosProviderAuthWindow', () => {
  beforeEach(() => {
    createdWindows.length = 0;
    clearStorageData.mockClear();
  });

  it('opens provider auth in an isolated AionUi-owned browser window', async () => {
    await openEvaosProviderAuthWindow('https://connect.pipedream.com/oauth/start?token=fake-provider-token');

    expect(clearStorageData).toHaveBeenCalledTimes(1);
    expect(createdWindows).toHaveLength(1);
    const win = createdWindows[0];
    expect(win.options).toMatchObject({
      title: 'evaOS Connected Apps',
      width: 1080,
      height: 820,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        partition: 'evaos-provider-auth',
      },
    });
    expect(win.loadURL).toHaveBeenCalledWith('https://connect.pipedream.com/oauth/start?token=fake-provider-token');
    expect(win.show).toHaveBeenCalledTimes(1);
  });

  it('allows OAuth popups only as isolated child auth windows', async () => {
    await openEvaosProviderAuthWindow('https://connect.pipedream.com/oauth/start?token=fake-provider-token');
    const win = createdWindows[0];

    const result = win.webContents.windowOpenHandler?.({ url: 'https://accounts.google.com/o/oauth2/v2/auth' });

    expect(result).toMatchObject({
      action: 'allow',
      overrideBrowserWindowOptions: {
        title: 'evaOS Connected Apps',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          partition: 'evaos-provider-auth',
        },
      },
    });
    expect(win.loadURL).toHaveBeenCalledTimes(1);
  });

  it('denies non-http OAuth popups', async () => {
    await openEvaosProviderAuthWindow('https://connect.pipedream.com/oauth/start?token=fake-provider-token');
    const win = createdWindows[0];

    const result = win.webContents.windowOpenHandler?.({ url: 'file:///Users/lume/.ssh/id_rsa' });

    expect(result).toEqual({ action: 'deny' });
  });

  it('blocks non-http navigation instead of handing it to the OS', async () => {
    await openEvaosProviderAuthWindow('https://connect.pipedream.com/oauth/start?token=fake-provider-token');
    const win = createdWindows[0];
    const event: FakeNavigationEvent = { preventDefault: vi.fn() };

    win.webContents.events.get('will-navigate')?.(event, 'file:///Users/lume/.ssh/id_rsa');
    win.webContents.events.get('will-redirect')?.(event, 'javascript:alert(1)');

    expect(event.preventDefault).toHaveBeenCalledTimes(2);
  });

  it('closes the previous provider auth window before opening a new handoff', async () => {
    await openEvaosProviderAuthWindow('https://connect.pipedream.com/oauth/start?token=first');
    await openEvaosProviderAuthWindow('https://connect.pipedream.com/oauth/start?token=second');

    expect(createdWindows).toHaveLength(2);
    expect(createdWindows[0].close).toHaveBeenCalledTimes(1);
    expect(createdWindows[1].loadURL).toHaveBeenCalledWith('https://connect.pipedream.com/oauth/start?token=second');
  });
});
