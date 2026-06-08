/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const protocolHandle = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  protocol: {
    handle: protocolHandle,
  },
}));

async function loadRegistry() {
  vi.resetModules();
  protocolHandle.mockClear();
  return import('@process/services/evaosRuntimeSurfaceRegistry');
}

function registeredHandler(): (request: { url: string }) => Response | Promise<Response> {
  const handler = protocolHandle.mock.calls.at(-1)?.[1];
  if (!handler) throw new Error('runtime surface protocol handler was not registered');
  return handler as (request: { url: string }) => Response | Promise<Response>;
}

describe('evaOS runtime surface registry', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('redirects opaque runtime surface handles without exposing the launch URL in the renderer payload', async () => {
    const registry = await loadRegistry();
    registry.registerEvaosRuntimeSurfaceProtocol();
    const surface = registry.createEvaosRuntimeSurface(
      'https://runtime.example.test/openclaw?desktop_session=eds_runtime_launch_secret#token=bad',
      {
        customerId: 'fixture-customer-acme',
        runtimeKey: 'openclaw',
        displayLabel: 'evaOS',
        sourcePointer: 'broker:runtime_launch:openclaw',
        auditId: 'audit-runtime-launch',
        expiresAt: '2099-01-01T00:00:00.000Z',
      }
    );

    const response = await registeredHandler()({ url: surface.surfaceUri });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://runtime.example.test/openclaw?desktop_session=eds_runtime_launch_secret#token=bad'
    );
    expect(JSON.stringify(surface)).not.toMatch(/runtime\\.example\\.test|desktop_session|token=bad|launch_url/i);
  });

  it('expires and clears runtime surface handles in main-process custody', async () => {
    const registry = await loadRegistry();
    registry.registerEvaosRuntimeSurfaceProtocol();
    const expiredSurface = registry.createEvaosRuntimeSurface('https://runtime.example.test/openclaw', {
      customerId: 'fixture-customer-acme',
      runtimeKey: 'openclaw',
      displayLabel: 'evaOS',
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    const activeSurface = registry.createEvaosRuntimeSurface('https://runtime.example.test/hermes', {
      customerId: 'fixture-customer-acme',
      runtimeKey: 'hermes',
      displayLabel: 'Hermes',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    expect((await registeredHandler()({ url: expiredSurface.surfaceUri })).status).toBe(404);
    expect((await registeredHandler()({ url: activeSurface.surfaceUri })).status).toBe(302);

    registry.clearEvaosRuntimeSurfaces();

    expect((await registeredHandler()({ url: activeSurface.surfaceUri })).status).toBe(404);
  });
});
