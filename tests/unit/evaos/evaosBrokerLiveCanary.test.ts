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
  resolveBrokerCanaryCredentials: (env: Record<string, string | undefined>) => {
    desktopSession: string;
    customerId: string;
    credentialSource: string;
  };
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
        source_pointer: 'broker:runtime_status:browser',
        audit_id: 'audit_safe_copy',
      },
      { customerId: 'cus_123', runtime: 'browser' }
    );

    expect(proof.secretScan).toBe('passed');
  });

  it('fails fast when runtime_status omits source or audit evidence', () => {
    expect(() =>
      liveCanary.sanitizeBrokerRuntimeCanaryResponse(
        {
          customer_id: 'cus_123',
          runtime_key: 'browser',
          status: 'running',
          source_pointer: 'broker:runtime_status:browser',
        },
        { customerId: 'cus_123', runtime: 'browser' }
      )
    ).toThrow(/source and audit evidence/);
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
            source_pointer: `broker:runtime_status:${surface.runtime}`,
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
      credentialSource: 'default',
      requiredSurfaces: ['evaos', 'hermes', 'mission-control', 'shared-browser', 'terminal'],
      secretScan: 'passed',
    });
    expect((proof.surfaces as Array<Record<string, unknown>>).map((surface) => surface.surface)).toEqual([
      'evaos',
      'hermes',
      'mission-control',
      'shared-browser',
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
    expect(JSON.stringify(proof)).not.toMatch(
      /eds_valid_session_for_test|callback_secret_for_test|launch_url|runtime\\.example\\.test/
    );
  });

  it('can run a focused single-runtime canary for debugging without satisfying distribution proof shape', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          customer_id: 'cus_123',
          runtime_key: 'hermes',
          status: 'running',
          source_pointer: 'broker:runtime_status:hermes',
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
        AIONUI_EVAOS_BROKER_RUNTIME: 'hermes',
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

  it('prefers the dedicated broker canary customer and session over fixture values', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          customer_id: 'broker-customer',
          runtime_key: 'hermes',
          status: 'running',
          source_pointer: 'broker:runtime_status:hermes',
          audit_id: 'audit_status_hermes',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          customer_id: 'broker-customer',
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
        AIONUI_EVAOS_DESKTOP_SESSION: 'eds_fixture_session_for_test',
        AIONUI_EVAOS_CUSTOMER_ID: 'fixture-customer',
        AIONUI_EVAOS_RELEASE_CANARY_CUSTOMER_ID: 'fixture-customer',
        AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID: 'broker-customer',
        AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION: 'eds_broker_session_for_test',
        AIONUI_EVAOS_BROKER_RUNTIME: 'hermes',
        AIONUI_EVAOS_BROKER_ENDPOINT: 'https://broker.example.test/runtime',
      },
      fetchImpl,
    });

    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer eds_broker_session_for_test',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      action: 'runtime_status',
      customer_id: 'broker-customer',
      runtime: 'hermes',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toMatchObject({
      action: 'runtime_launch',
      customer_id: 'broker-customer',
      runtime: 'hermes',
    });
    expect(proof).toMatchObject({
      customerId: 'broker-customer',
      credentialSource: 'broker-specific',
      releaseCanaryCustomerId: 'fixture-customer',
      requiredSurfaces: ['hermes'],
    });
  });

  it('rejects mixed broker-specific and default credential pairs', () => {
    expect(() =>
      liveCanary.resolveBrokerCanaryCredentials({
        AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION: 'eds_broker_session_for_test',
        AIONUI_EVAOS_CUSTOMER_ID: 'fixture-customer',
      })
    ).toThrow(/Incomplete broker-specific canary credential pair/);
  });

  it('accepts session-bearing broker launch targets without leaking the target URL', () => {
    const proof = liveCanary.sanitizeBrokerRuntimeLaunchCanaryResponse(
      {
        customer_id: 'cus_123',
        runtime_key: 'openclaw',
        status: 'attached',
        message: 'Attached runtime surface through the evaOS broker.',
        launch_mode: 'dashboard_surface',
        launch_url: 'https://runtime.example.test/openclaw/auth/callback?desktop_session=eds_secret_for_test',
        source_pointer: 'broker:runtime_launch:openclaw',
        audit_id: 'audit_launch_openclaw',
        runtime_status: {
          customer_id: 'cus_123',
          runtime_key: 'openclaw',
          status: 'running',
          source_pointer: 'broker:runtime_status:openclaw',
          audit_id: 'audit_status_openclaw',
        },
      },
      { customerId: 'cus_123', runtime: 'openclaw' }
    );

    expect(proof).toMatchObject({
      status: 'attached',
      launchMode: 'dashboard_surface',
      sourcePointer: 'broker:runtime_launch:openclaw',
      auditId: 'audit_launch_openclaw',
      launchUrlRedacted: true,
      secretScan: 'passed',
    });
    expect(JSON.stringify(proof)).not.toMatch(/eds_secret_for_test|runtime\\.example\\.test|launch_url/);
  });

  it('aggregates multi-surface failures instead of stopping at the first broken surface', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const surface of liveCanary.REQUIRED_BROKER_SURFACES) {
      fetchImpl.mockResolvedValueOnce(
        jsonResponse({
          customer_id: 'cus_123',
          runtime_key: surface.runtime,
          status: 'running',
          source_pointer: `broker:runtime_status:${surface.runtime}`,
          ...(surface.surface === 'hermes' ? {} : { audit_id: `audit_status_${surface.surface}` }),
        })
      );
      fetchImpl.mockResolvedValueOnce(
        jsonResponse({
          customer_id: 'cus_123',
          runtime_key: surface.runtime,
          status: ['hermes', 'terminal'].includes(surface.surface) ? 'blocked' : 'attached',
          launch_mode: 'dashboard_surface',
          launch_url: `https://runtime.example.test/${surface.surface}/auth/callback`,
          source_pointer: `broker:runtime_launch:${surface.runtime}`,
          audit_id: `audit_launch_${surface.surface}`,
        })
      );
    }

    await expect(
      liveCanary.runBrokerLiveCanary({
        env: {
          AIONUI_EVAOS_DESKTOP_SESSION: 'eds_valid_session_for_test',
          AIONUI_EVAOS_CUSTOMER_ID: 'cus_123',
          AIONUI_EVAOS_BROKER_ENDPOINT: 'https://broker.example.test/runtime',
        },
        fetchImpl,
      })
    ).rejects.toThrow(
      /hermes\/hermes: status: .*source and audit evidence.*launch: .*denied runtime_launch.*terminal\/terminal/s
    );
    expect(fetchImpl).toHaveBeenCalledTimes(liveCanary.REQUIRED_BROKER_SURFACES.length * 2);
  });

  it('preserves redacted broker error details for non-OK responses', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'VM not found',
            code: 'wrong_customer',
            route_denied: true,
            launch_url: 'https://runtime.example.test/auth/callback?desktop_session=eds_secret_for_test',
          },
          { status: 404 }
        )
      )
      .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));

    try {
      await liveCanary.runBrokerLiveCanary({
        env: {
          AIONUI_EVAOS_DESKTOP_SESSION: 'eds_valid_session_for_test',
          AIONUI_EVAOS_CUSTOMER_ID: 'cus_123',
          AIONUI_EVAOS_BROKER_RUNTIME: 'openclaw',
          AIONUI_EVAOS_BROKER_ENDPOINT: 'https://broker.example.test/runtime',
        },
        fetchImpl,
      });
      throw new Error('Expected broker live canary to fail.');
    } catch (error) {
      const proof = (error as { proof?: Record<string, unknown> }).proof as {
        failures: Array<{ phases: Array<{ responseShape: Record<string, unknown> }> }>;
      };
      expect(proof.failures[0].phases[0].responseShape).toMatchObject({
        httpStatus: 404,
        contentType: 'application/json',
        responseShape: {
          topLevelKeys: ['code', 'error', 'launch_url', 'route_denied'],
          code: 'wrong_customer',
          error: 'VM not found',
          launchTargetPresent: true,
        },
      });
      expect(proof.failures[0].phases[1].responseShape).toMatchObject({
        httpStatus: 500,
        bodyClass: 'internal_server_error',
      });
      expect(JSON.stringify(proof)).not.toMatch(/eds_secret_for_test|runtime\\.example\\.test/);
    }
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

  it('fails closed when runtime_launch hides denial in nested runtime surface state', () => {
    expect(() =>
      liveCanary.sanitizeBrokerRuntimeLaunchCanaryResponse(
        {
          customer_id: 'cus_123',
          runtime_key: 'openclaw',
          status: 'attached',
          launch_mode: 'dashboard_surface',
          launch_url: 'https://runtime.example.test/auth/callback',
          source_pointer: 'broker:runtime_launch:openclaw',
          audit_id: 'audit_launch_nested_forbidden',
          runtime_surface: {
            status: 'forbidden',
            message: 'forbidden for selected customer',
          },
        },
        { customerId: 'cus_123', runtime: 'openclaw' }
      )
    ).toThrow(/denied runtime_launch/);
  });
});
