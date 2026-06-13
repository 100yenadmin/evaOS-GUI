/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: vi.fn(() => {
      const handlerMap = new Map<string, Function>();
      return {
        provider: vi.fn((handler: Function) => {
          handlerMap.set('handler', handler);
          return vi.fn();
        }),
        invoke: vi.fn(),
        _getHandler: () => handlerMap.get('handler'),
      };
    }),
    buildEmitter: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn(),
    })),
  },
  storage: {
    buildStorage: () => ({
      getSync: () => undefined,
      setSync: () => {},
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
    }),
  },
}));

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/test/path'),
    exit: vi.fn(),
    isPackaged: true,
  },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    logger: null,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: false,
    setFeedURL: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    checkForUpdatesAndNotify: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'info' } },
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const makeGitHubReleaseResponse = () => [
  {
    tag_name: 'v1.9.22',
    name: 'v1.9.22',
    body: 'release notes',
    html_url: 'https://github.com/iOfficeAI/AionUi/releases/tag/v1.9.22',
    published_at: '2026-04-29T00:00:00Z',
    prerelease: false,
    draft: false,
    assets: [
      {
        name: 'AionUi-1.9.22-mac-arm64.dmg',
        browser_download_url:
          'https://github.com/iOfficeAI/AionUi/releases/download/v1.9.22/AionUi-1.9.22-mac-arm64.dmg',
        size: 123,
        content_type: 'application/x-apple-diskimage',
      },
      {
        name: 'AionUi-1.9.22-win-x64.exe',
        browser_download_url: 'https://github.com/iOfficeAI/AionUi/releases/download/v1.9.22/AionUi-1.9.22-win-x64.exe',
        size: 456,
        content_type: 'application/vnd.microsoft.portable-executable',
      },
      {
        name: 'AionUi-1.9.22-linux-amd64.deb',
        browser_download_url:
          'https://github.com/iOfficeAI/AionUi/releases/download/v1.9.22/AionUi-1.9.22-linux-amd64.deb',
        size: 789,
      },
    ],
  },
];

const makeBetaGitHubReleaseResponse = () => [
  {
    tag_name: 'evaos-beta-v2.1.11-evaos-beta.0',
    name: 'evaOS Workbench Beta 2.1.11',
    body: 'beta release notes',
    html_url: 'https://github.com/100yenadmin/evaOS-GUI/releases/tag/evaos-beta-v2.1.11-evaos-beta.0',
    published_at: '2026-06-04T00:00:00Z',
    prerelease: true,
    draft: false,
    assets: [
      {
        name: 'evaOS Workbench Beta-2.1.11-evaos-beta.0-mac-arm64.dmg',
        browser_download_url:
          'https://github.com/100yenadmin/evaOS-GUI/releases/download/evaos-beta-v2.1.11-evaos-beta.0/evaOS%20Workbench%20Beta-2.1.11-evaos-beta.0-mac-arm64.dmg',
        size: 123,
        content_type: 'application/x-apple-diskimage',
      },
    ],
  },
];

const getCheckHandler = async () => {
  vi.resetModules();
  const { initUpdateBridge } = await import('@process/bridge/updateBridge');
  const { ipcBridge } = await import('@/common');

  initUpdateBridge();

  const provider = vi.mocked(ipcBridge.update.check.provider);
  const lastCall = provider.mock.calls.at(-1);
  if (!lastCall) throw new Error('update.check handler not registered');
  return lastCall[0];
};

const getDownloadHandler = async () => {
  vi.resetModules();
  const { initUpdateBridge } = await import('@process/bridge/updateBridge');
  const { ipcBridge } = await import('@/common');

  initUpdateBridge();

  const provider = vi.mocked(ipcBridge.update.download.provider);
  const lastCall = provider.mock.calls.at(-1);
  if (!lastCall) throw new Error('update.download handler not registered');
  return lastCall[0];
};

const getAutoUpdateQuitAndInstallHandler = async () => {
  const { initUpdateBridge } = await import('@process/bridge/updateBridge');
  const { ipcBridge } = await import('@/common');

  initUpdateBridge();

  const provider = vi.mocked(ipcBridge.autoUpdate.quitAndInstall.provider);
  const lastCall = provider.mock.calls.at(-1);
  if (!lastCall) throw new Error('autoUpdate.quitAndInstall handler not registered');
  return lastCall[0];
};

const makeDeferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

describe('updateBridge CDN URL rewriting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AIONUI_EVAOS_BETA = '0';
  });

  afterEach(() => {
    delete process.env.AIONUI_EVAOS_BETA;
  });

  it('rewrites asset.url to the CDN path and keeps GitHub URL in fallbackUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeGitHubReleaseResponse(),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const handler = await getCheckHandler();
      const result = await handler({ repo: 'iOfficeAI/AionUi' });

      expect(result.success).toBe(true);
      const assets = result.data?.latest?.assets ?? [];
      expect(assets.length).toBe(3);

      const macAsset = assets.find((a: { name: string }) => a.name === 'AionUi-1.9.22-mac-arm64.dmg');
      expect(macAsset).toBeDefined();
      expect(macAsset?.url).toBe('https://static.aionui.com/releases/1.9.22/AionUi-1.9.22-mac-arm64.dmg');
      expect(macAsset?.fallbackUrl).toBe(
        'https://github.com/iOfficeAI/AionUi/releases/download/v1.9.22/AionUi-1.9.22-mac-arm64.dmg'
      );

      const linuxAsset = assets.find((a: { name: string }) => a.name === 'AionUi-1.9.22-linux-amd64.deb');
      expect(linuxAsset?.url).toBe('https://static.aionui.com/releases/1.9.22/AionUi-1.9.22-linux-amd64.deb');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the normalized version (no v prefix) in the CDN path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeGitHubReleaseResponse(),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const handler = await getCheckHandler();
      const result = await handler({ repo: 'iOfficeAI/AionUi' });
      const asset = result.data?.latest?.assets?.[0];
      expect(asset?.url).toMatch(/^https:\/\/static\.aionui\.com\/releases\/1\.9\.22\//);
      expect(asset?.url).not.toMatch(/\/v1\.9\.22\//);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('updateBridge allowlist includes CDN host', () => {
  beforeEach(() => {
    process.env.AIONUI_EVAOS_BETA = '0';
  });

  afterEach(() => {
    delete process.env.AIONUI_EVAOS_BETA;
    delete process.env.AIONUI_EVAOS_BETA_ALLOW_AUTO_UPDATE;
    delete process.env.AIONUI_EVAOS_BETA_UPDATE_REPO;
  });

  it('accepts static.aionui.com URLs for download', async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '0' }),
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
        }),
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const handler = await getDownloadHandler();

      const result = await handler({
        url: 'https://static.aionui.com/releases/1.9.22/AionUi-1.9.22-mac-arm64.dmg',
        file_name: 'AionUi-1.9.22-mac-arm64.dmg',
      });

      expect(result.success).toBe(true);
      expect(result.data?.downloadId).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects non-allowlisted hosts', async () => {
    vi.clearAllMocks();

    const handler = await getDownloadHandler();

    const result = await handler({
      url: 'https://evil.example.com/fake.dmg',
      file_name: 'fake.dmg',
    });

    // Download is refused before any network I/O; exact error text comes from i18n and isn't asserted here.
    expect(result.success).toBe(false);
  });

  it('rejects upstream GitHub release URLs for beta manual downloads', async () => {
    vi.clearAllMocks();
    process.env.AIONUI_EVAOS_BETA = '1';
    process.env.AIONUI_EVAOS_BETA_ALLOW_AUTO_UPDATE = '1';
    process.env.AIONUI_EVAOS_BETA_UPDATE_REPO = '100yenadmin/evaOS-GUI';

    const handler = await getDownloadHandler();

    const result = await handler({
      url: 'https://github.com/iOfficeAI/AionUi/releases/download/v1.9.22/AionUi-1.9.22-mac-arm64.dmg',
      fallbackUrl: 'https://github.com/iOfficeAI/AionUi/releases/download/v1.9.22/AionUi-1.9.22-mac-arm64.dmg',
      file_name: 'AionUi-1.9.22-mac-arm64.dmg',
    });

    expect(result.success).toBe(false);
    expect(result.msg).toContain('evaOS beta update feed');
  });

  it('accepts configured beta repo GitHub release URLs for beta manual downloads', async () => {
    vi.clearAllMocks();
    process.env.AIONUI_EVAOS_BETA = '1';
    process.env.AIONUI_EVAOS_BETA_ALLOW_AUTO_UPDATE = '1';
    process.env.AIONUI_EVAOS_BETA_UPDATE_REPO = '100yenadmin/evaOS-GUI';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '0' }),
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
        }),
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const handler = await getDownloadHandler();

      const result = await handler({
        url: 'https://github.com/100yenadmin/evaOS-GUI/releases/download/evaos-beta-v2.1.10-evaos-beta/evaOS%20Workbench%20Beta-2.1.10-evaos-beta.0-mac-arm64.dmg',
        fallbackUrl:
          'https://github.com/100yenadmin/evaOS-GUI/releases/download/evaos-beta-v2.1.10-evaos-beta/evaOS%20Workbench%20Beta-2.1.10-evaos-beta.0-mac-arm64.dmg',
        file_name: 'evaOS Workbench Beta-2.1.10-evaos-beta.0-mac-arm64.dmg',
      });

      expect(result.success).toBe(true);
      expect(result.data?.downloadId).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('parses evaOS beta release tags when checking the configured beta feed', async () => {
    vi.clearAllMocks();
    process.env.AIONUI_EVAOS_BETA = '1';
    process.env.AIONUI_EVAOS_BETA_ALLOW_AUTO_UPDATE = '1';
    process.env.AIONUI_EVAOS_BETA_UPDATE_REPO = '100yenadmin/evaOS-GUI';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeBetaGitHubReleaseResponse(),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const handler = await getCheckHandler();
      const result = await handler({ includePrerelease: true });

      expect(result.success).toBe(true);
      expect(result.data?.updateAvailable).toBe(true);
      expect(result.data?.latest?.tagName).toBe('evaos-beta-v2.1.11-evaos-beta.0');
      expect(result.data?.latest?.version).toBe('2.1.11-evaos-beta.0');
      expect(result.data?.latest?.assets[0]?.url).toContain('github.com/100yenadmin/evaOS-GUI');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('autoUpdate quitAndInstall lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env.AIONUI_EVAOS_BETA = '1';
    process.env.AIONUI_EVAOS_BETA_ALLOW_AUTO_UPDATE = '1';
    process.env.AIONUI_EVAOS_BETA_UPDATE_REPO = '100yenadmin/evaOS-GUI';
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete process.env.AIONUI_EVAOS_BETA;
    delete process.env.AIONUI_EVAOS_BETA_ALLOW_AUTO_UPDATE;
    delete process.env.AIONUI_EVAOS_BETA_UPDATE_REPO;
  });

  it('waits for the pre-install cleanup before starting the installer', async () => {
    const cleanup = makeDeferred();
    const { autoUpdaterService } = await import('@process/services/autoUpdaterService');
    const { autoUpdater } = await import('electron-updater');

    autoUpdaterService.resetForTest();
    autoUpdaterService.setBeforeQuitAndInstall(async () => cleanup.promise);

    const installPromise = autoUpdaterService.quitAndInstall();
    await Promise.resolve();

    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();

    cleanup.resolve();
    await installPromise;

    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('does not start the installer when the pre-install cleanup fails', async () => {
    const cleanupError = new Error('backend did not stop');
    const { autoUpdaterService } = await import('@process/services/autoUpdaterService');
    const { autoUpdater } = await import('electron-updater');

    autoUpdaterService.resetForTest();
    autoUpdaterService.setBeforeQuitAndInstall(async () => {
      throw cleanupError;
    });

    await expect(autoUpdaterService.quitAndInstall()).rejects.toThrow('backend did not stop');
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('keeps the IPC request pending until quitAndInstall cleanup completes', async () => {
    const cleanup = makeDeferred();
    const { autoUpdaterService } = await import('@process/services/autoUpdaterService');

    autoUpdaterService.resetForTest();
    autoUpdaterService.setBeforeQuitAndInstall(async () => cleanup.promise);

    const handler = await getAutoUpdateQuitAndInstallHandler();
    let handlerSettled = false;
    const handlerPromise = handler().then(() => {
      handlerSettled = true;
    });

    await Promise.resolve();

    expect(handlerSettled).toBe(false);

    cleanup.resolve();
    await handlerPromise;

    expect(handlerSettled).toBe(true);
  });

  it('surfaces IPC cleanup failures instead of starting the installer', async () => {
    const { autoUpdaterService } = await import('@process/services/autoUpdaterService');
    const { autoUpdater } = await import('electron-updater');

    autoUpdaterService.resetForTest();
    autoUpdaterService.setBeforeQuitAndInstall(async () => {
      throw new Error('backend did not stop');
    });

    const handler = await getAutoUpdateQuitAndInstallHandler();

    await expect(handler()).rejects.toThrow('backend did not stop');
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });
});
