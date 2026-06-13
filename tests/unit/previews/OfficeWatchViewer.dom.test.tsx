/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * N4c V8: OfficeWatchViewer export-shape smoke test.
 *
 * Design note:
 * OfficeWatchViewer mounts long-lived watch polling via useEffect. Rendering it
 * under jsdom (even with fully stubbed ipcBridge / Arco / WebviewHost) spins
 * setInterval/setTimeout cycles that don't settle inside worker-fork timeouts
 * and cause the vitest pool to hang (see plan §2.4 WS reconnect hazard).
 *
 * We therefore validate only the static module surface: exports, component
 * type, displayName-ish identity. Runtime render coverage for this file is
 * deferred to e2e (where the real watch backend is online) — this trade-off
 * is recorded in N4c-final.md Deviations.
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest';

describe('OfficeWatchViewer module shape', () => {
  it('module loads and exposes a default export', async () => {
    const mod = await import('@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer');
    expect(mod).toBeDefined();
    expect(mod.default).toBeDefined();
  });

  it('default export is a function (React component)', async () => {
    const mod = await import('@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer');
    expect(typeof mod.default).toBe('function');
  });

  it('module exports object has no thrown side effects during import', async () => {
    // Importing the module a second time should use the cached copy and not throw.
    const mod = await import('@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer');
    expect(mod.default).toBeDefined();
    // Component functions in React typically have at most one required argument (props).
    expect((mod.default as { length: number }).length).toBeLessThanOrEqual(2);
  });
});

const loadResolveOfficeWatchUrl = async () => {
  const mod = await import('@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer');
  return mod.resolveOfficeWatchUrl;
};

describe('resolveOfficeWatchUrl in WebUI mode', () => {
  let electronApiStub: unknown;

  beforeEach(() => {
    const w = window as Window & { electronAPI?: unknown };
    electronApiStub = w.electronAPI;
    delete w.electronAPI;
  });

  afterEach(() => {
    (window as Window & { electronAPI?: unknown }).electronAPI = electronApiStub;
  });

  it('returns the backend proxy URL without appending a trailing slash', async () => {
    const resolveOfficeWatchUrl = await loadResolveOfficeWatchUrl();
    expect(resolveOfficeWatchUrl('/api/ppt-proxy/59324', 'ppt')).toBe('/api/ppt-proxy/59324');
  });

  it('drops a bare trailing slash from the proxy URL', async () => {
    const resolveOfficeWatchUrl = await loadResolveOfficeWatchUrl();
    expect(resolveOfficeWatchUrl('/api/office-watch-proxy/59324/', 'word')).toBe('/api/office-watch-proxy/59324');
  });

  it('keeps a real sub-path on the proxy URL', async () => {
    const resolveOfficeWatchUrl = await loadResolveOfficeWatchUrl();
    expect(resolveOfficeWatchUrl('/api/office-watch-proxy/59324/index.html', 'excel')).toBe(
      '/api/office-watch-proxy/59324/index.html'
    );
  });

  it('maps an absolute localhost watch URL to the proxy path without a trailing slash', async () => {
    const resolveOfficeWatchUrl = await loadResolveOfficeWatchUrl();
    expect(resolveOfficeWatchUrl('http://127.0.0.1:59324', 'ppt')).toBe('/api/ppt-proxy/59324');
  });
});

describe('resolveOfficeWatchUrl in Electron mode', () => {
  it('still resolves proxy paths to the direct loopback URL', async () => {
    const resolveOfficeWatchUrl = await loadResolveOfficeWatchUrl();
    expect(resolveOfficeWatchUrl('/api/ppt-proxy/59324', 'ppt')).toBe('http://127.0.0.1:59324/');
  });
});
