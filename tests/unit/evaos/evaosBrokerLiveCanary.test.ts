/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const liveCanary = require('../../../scripts/evaosBrokerLiveCanary.js') as {
  REQUIRED_BROKER_SURFACES: Array<{ surface: string; runtime: string }>;
  runBrokerLiveCanary: (options: {
    env: Record<string, string | undefined>;
    fetchImpl: typeof fetch;
  }) => Promise<Record<string, unknown>>;
  sanitizeBrokerRuntimeCanaryResponse: (
    raw: unknown,
    request: { customerId: string; runtime: string }
  ) => Record<string, unknown>;
  sanitizeBrokerRuntimeLaunchCanaryResponse: (
    raw: unknown,
    request: { customerId: string; runtime: string }
  ) => Record<string, unknown>;
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('evaOS broker live canary', () => {
  it('returns a sanitized runtime proof summary for clean broker responses', () => {
    const proof = liveCanary.sanitizeBrokerRuntimeCanaryResponse(
      {
        customer_id: 'cus_123',
        runtime_key: 'browser',
        status: 'running',
        display_label: 'Business Browser',
        source_pointer: 'broker:runtime_status:browser',
        audit_id: 'audit_123',
      },
      { customerId: 'cus_123', runtime: 'browser' }
    );

    expect(proof).toMatchObject({
      schema: 'evaos-broker-live-canary/v1',
      customerId: 'cus_123',
      runtime: 'browser',
      status: 'running',
      displayLabel: 'Business Browser',
      sourcePointer: 'broker:runtime_status:browser',
      auditId: 'audit_123',
      secretScan: 'passed',
    });
    expect(JSON.stringify(proof)).not.toMatch(/eds_|access_token|Bearer|desktop_session/);
  });

  it('fails closed when the broker runtime response exposes URL or provider secret material', () => {
    expect(() =>
      liveCanary.sanitizeBrokerRuntimeCanaryResponse(
        {
          customer_id: 'cus_123',
          runtime_key: 'browser',
          status: 'running',
          current_url: 'https://app.example.test/callback?access_token=raw-token',
        },
        { customerId: 'cus_123', runtime: 'browser' }
      )
    ).toThrow(/secret material/);

    expect(() =>
      liveCanary.sanitizeBrokerRuntimeCanaryResponse(
        {
          customer_id: 'cus_123',
          runtime_key: 'browser',
          status: 'running',
          provider_secret: 'redacted',
        },
        { customerId: 'cus_123', runtime: 'browser' }
      )
    ).toThrow(/secret material/);
  });

  it('allows normal beta copy that refers to secret-safety policy without raw secret material', () => {
    const proof = liveCanary.sanitizeBrokerRuntimeCanaryResponse(
      {
        customer_id: 'cus_123',
        runtime_key: 'browser',
        status: 'running',
        provider_profiles: [
          {
            key: 'slack',
            status: 'connected',
            subtitle: 'No raw provider secrets in the Mac app.',
          },
        ],
      },
      { customerId: 'cus_123', runtime: 'browser' }
    );

    expect(proof.secretScan).toBe('passed');
  });

  it('dispatches status and dashboard launch for every required broker surface without leaking sessions', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const surface of liveCanary.REQUIRED_BROKER_SURFACES) {
      fetchImpl
        .mockResolvedValueOnce(
          jsonResponse({
            customer_id: 'cus_123',
            runtime_key: surface.runtime,
            status: 'running',
            audit_id: `audit_status_${surface.surface}`,
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            customer_id: 'cus_123',
            runtime_key: surface.runtime,
            status: 'attached',
            launch_mode: 'dashboard_surface',
            launch_url: `https://runtime.example.test/${surface.surface}/auth/callback?session=callback_secret_for_test`,
            source_pointer: `broker:runtime_launch:${surface.runtime}`,
            audit_id: `audit_launch_${surface.surface}`,
          })
        );
    }

    const proof = await liveCanary.runBrokerLiveCanary({
      env: {
        AIONUI_EVAOS_DESKTOP_SESSION: 'eds_valid_session_for_test',
        AIONUI_EVAOS_CUSTOMER_ID: 'cus_123',
        AIONUI_EVAOS_BROKER_ENDPOINT: 'https://broker.example.test/runtime',
      },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(liveCanary.REQUIRED_BROKER_SURFACES.length * 2);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://broker.example.test/runtime');
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer eds_valid_session_for_test',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual({
      action: 'runtime_launch',
      customer_id: 'cus_123',
      runtime: 'openclaw',
      launch_mode: 'dashboard_surface',
    });
    expect(proof).toMatchObject({
      schema: 'evaos-broker-live-canary/v3',
      customerId: 'cus_123',
      requiredSurfaces: ['evaos', 'hermes', 'mission-control', 'business-browser', 'terminal'],
      secretScan: 'passed',
    });
    expect((proof.surfaces as Array<Record<string, unknown>>).map((surface) => surface.surface)).toEqual([
      'evaos',
      'hermes',
      'mission-control',
      'business-browser',
      'terminal',
    ]);
    expect(proof).toMatchObject({
      surfaces: expect.arrayContaining([
        expect.objectContaining({
          surface: 'evaos',
          runtime: 'openclaw',
          status: 'running',
          launch: expect.objectContaining({
            status: 'attached',
            launchMode: 'dashboard_surface',
            sourcePointer: 'broker:runtime_launch:openclaw',
            auditId: 'audit_launch_evaos',
            launchUrlRedacted: true,
          }),
        }),
      ]),
    });
    expect(JSON.stringify(proof)).not.toMatch(/eds_valid_session_for_test|callback_secret_for_test|launch_url|runtime\\.example\\.test/);
  });

  it('can run a focused single-runtime canary for debugging without satisfying distribution proof shape', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          customer_id: 'cus_123',
          runtime_key: 'hermes',
          status: 'running',
          audit_id: 'audit_status_hermes',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          customer_id: 'cus_123',
          runtime_key: 'hermes',
          status: 'attached',
          launch_mode: 'dashboard_surface',
          launch_url: 'https://runtime.example.test/hermes/auth/callback',
          source_pointer: 'broker:runtime_launch:hermes',
          audit_id: 'audit_launch_hermes',
        })
      );

    const proof = await liveCanary.runBrokerLiveCanary({
      env: {
        AIONUI_EVAOS_DESKTOP_SESSION: 'eds_valid_session_for_test',
        AIONUI_EVAOS_CUSTOMER_ID: 'cus_123',
        AIONUI_EVAOS_RUNTIME: 'hermes',
        AIONUI_EVAOS_BROKER_ENDPOINT: 'https://broker.example.test/runtime',
      },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(proof).toMatchObject({
      schema: 'evaos-broker-live-canary/v3',
      requiredSurfaces: ['hermes'],
      surfaces: [expect.objectContaining({ surface: 'hermes', runtime: 'hermes' })],
    });
  });

  it('fails closed when runtime_launch returns a denied broker surface response', () => {
    expect(() =>
      liveCanary.sanitizeBrokerRuntimeLaunchCanaryResponse(
        {
          customer_id: 'cus_123',
          runtime_key: 'openclaw',
          status: 'forbidden',
          message: 'forbidden',
          launch_mode: 'dashboard_surface',
          launch_url: 'https://runtime.example.test/auth/callback?session=callback_secret_for_test',
          source_pointer: 'broker:runtime_launch:openclaw',
          audit_id: 'audit_launch_forbidden',
        },
        { customerId: 'cus_123', runtime: 'openclaw' }
      )
    ).toThrow(/denied runtime_launch/);
  });
});
