/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  signedMacControlAttestation,
  TEST_CONTEXT_KEY_ID,
  TEST_RECEIPT_KEY_ID,
} from './fixtures/signedMacControlAttestation';

const TRUST_FIXTURE = signedMacControlAttestation({
  runRef: 'gha:12345:111111111111111111111111',
  executedAt: '2026-07-15T00:00:00Z',
  authorityIssuedAt: 1784073600,
  authorityExpiresAt: 1784073660,
  candidate: {
    sourceCommit: 'a'.repeat(40),
    sourceSha256: 'b'.repeat(64),
    appVersion: '2.1.36',
    appBuild: '2.1.36',
  },
});
const TRUST_ENV = {
  EVAOS_LIVE_CANARY_CONTEXT_KEY_ID: TRUST_FIXTURE.trust.contextKeyId,
  EVAOS_LIVE_CANARY_RECEIPT_KEY_ID: TRUST_FIXTURE.trust.receiptKeyId,
  EVAOS_LIVE_CANARY_RECEIPT_PUBLIC_KEY: TRUST_FIXTURE.trust.receiptPublicKey,
};

const require = createRequire(import.meta.url);
const releaseGate = require('../../../scripts/evaosBetaReleaseGate.js') as {
  verifyMacControlLiveCanaryProof: (
    proofDir: string,
    env: Record<string, string>,
    options?: { now?: Date; maxAgeHours?: number }
  ) => boolean;
};
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
  resolveMacControlCanaryConfig: (env: Record<string, string | undefined>) => {
    desktopSession: string;
    customerId: string;
    endpoint: string;
    expectedCallbackHost: string;
    receiptKeyId: string;
    receiptPublicKey: string;
    contextKeyId: string;
  };
  runMacControlLiveCanary: (options: {
    env: Record<string, string | undefined>;
    fetchImpl: typeof fetch;
    now?: () => number;
    randomBytes?: (size: number) => Uint8Array;
    onDeployedProbe?: (proof: Record<string, unknown>) => void | Promise<void>;
  }) => Promise<Record<string, unknown>>;
  expectedMacControlCandidate: (env: Record<string, string | undefined>) => {
    sourceCommit: string;
    sourceSha256: string;
    appVersion: string;
    appBuild: string;
  };
  sanitizeMacControlRuntimeProof: (
    raw: unknown,
    options: {
      runRef: string;
      expectedCandidate: Record<string, string>;
      bindingExpiry: number;
      requestStartedAt: number;
      now: number;
      receiptKeyId: string;
      receiptPublicKey: string;
      contextKeyId: string;
    }
  ) => Record<string, unknown>;
  sanitizeMacControlRuntimeLaunchCanaryResponse: (
    raw: unknown,
    request: { customerId: string; runtime: string; expectedCallbackHost: string },
    now?: number
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

  it('requires an explicit broker canary target for release proof instead of falling back to default credentials', () => {
    expect(() =>
      liveCanary.resolveBrokerCanaryCredentials({
        AIONUI_EVAOS_REQUIRE_BROKER_CANARY_TARGET: 'true',
        AIONUI_EVAOS_DESKTOP_SESSION: 'eds_default_session_for_test',
        AIONUI_EVAOS_CUSTOMER_ID: 'evaos-support',
      })
    ).toThrow(/requires AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION \+ AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID/);
  });

  it('rejects internal support or golden VM targets before issuing broker requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      liveCanary.runBrokerLiveCanary({
        env: {
          AIONUI_EVAOS_REQUIRE_BROKER_CANARY_TARGET: 'true',
          AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION: 'eds_broker_session_for_test',
          AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID: 'evaos-support',
          AIONUI_EVAOS_BROKER_RUNTIME: 'openclaw',
          AIONUI_EVAOS_BROKER_ENDPOINT: 'https://broker.example.test/runtime',
        },
        fetchImpl,
      })
    ).rejects.toThrow(/internal support or golden VM target/);

    expect(fetchImpl).not.toHaveBeenCalled();
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

  it('requires the exact Mac-control acknowledgement and a complete dedicated staging configuration', () => {
    expect(() =>
      liveCanary.resolveMacControlCanaryConfig({
        AIONUI_EVAOS_MAC_CONTROL_CANARY_ACK: 'yes',
        AIONUI_EVAOS_DESKTOP_SESSION: 'eds_generic_session_for_test',
        AIONUI_EVAOS_CUSTOMER_ID: 'generic-customer',
        AIONUI_EVAOS_BROKER_ENDPOINT: 'https://generic.example.test/runtime',
      })
    ).toThrow(/evaos-mac-control-canary/);

    expect(() =>
      liveCanary.resolveMacControlCanaryConfig({
        AIONUI_EVAOS_MAC_CONTROL_CANARY_ACK: 'evaos-mac-control-canary',
        AIONUI_EVAOS_DESKTOP_SESSION: 'eds_generic_session_for_test',
        AIONUI_EVAOS_CUSTOMER_ID: 'generic-customer',
        AIONUI_EVAOS_BROKER_ENDPOINT: 'https://generic.example.test/runtime',
      })
    ).toThrow(/dedicated Mac-control canary configuration/);
  });

  it('strictly validates and normalizes the dedicated callback host', () => {
    const env = {
      ...TRUST_ENV,
      AIONUI_EVAOS_MAC_CONTROL_CANARY_ACK: 'evaos-mac-control-canary',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_DESKTOP_SESSION: 'eds_mac_canary_session_for_test',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID: 'staging-mac-owner',
      AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT: 'https://dashboard-staging.example.test/runtime',
    };

    expect(
      liveCanary.resolveMacControlCanaryConfig({
        ...env,
        AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST: 'OPENCLAW-STAGING.EXAMPLE.TEST:443',
      }).expectedCallbackHost
    ).toBe('openclaw-staging.example.test');

    for (const callbackHost of [
      '.openclaw-staging.example.test',
      'openclaw-staging.example.test.',
      'openclaw-staging.example.test:',
    ]) {
      expect(() =>
        liveCanary.resolveMacControlCanaryConfig({
          ...env,
          AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST: callbackHost,
        })
      ).toThrow(/callback host is invalid/i);
    }
  });

  it('proves selected-binding Mac-control launch and callback acceptance without persisting private identifiers', async () => {
    const now = Date.parse('2026-07-14T05:00:00.000Z');
    const sourceHeadSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
    const challengeBytes = Buffer.alloc(32, 13);
    const runNonceBytes = Buffer.alloc(12, 14);
    const challenge = challengeBytes.toString('base64url');
    const runRef = `gha:123456789:${runNonceBytes.toString('hex')}`;
    const expectedCandidate = liveCanary.expectedMacControlCandidate({ GITHUB_SHA: sourceHeadSha });
    const signedProof = signedMacControlAttestation({
      runRef,
      executedAt: new Date(now).toISOString(),
      authorityIssuedAt: Math.floor(now / 1000) - 1,
      authorityExpiresAt: Math.floor(now / 1000) + 15,
      candidate: expectedCandidate,
      keyId: TEST_RECEIPT_KEY_ID,
      contextKeyId: TEST_CONTEXT_KEY_ID,
      keyPair: TRUST_FIXTURE.keyPair,
    });
    const bindingExpiresAt = new Date(now + 20_000).toISOString();
    const binding = {
      schema_version: 'evaos.mac_control_runtime_readiness.v1',
      required: true,
      customer_id: 'staging-mac-owner',
      runtime: 'openclaw',
      grant_state: 'active',
      tools_ready: true,
      binding_id: '11111111-1111-4111-8111-111111111111',
      binding_version: '7',
      binding_expires_at: bindingExpiresAt,
      allowed_capabilities: ['customer_mac_status', 'desktop_see', 'desktop_control'],
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'attached',
          customer_id: 'staging-mac-owner',
          runtime: 'openclaw',
          runtime_key: 'openclaw',
          launch_mode: 'mac_control_tools',
          launch_url:
            'https://openclaw-staging.example.test/auth/callback?customer_id=staging-mac-owner&session=callback_secret_for_test',
          expires_at: '2026-07-14T09:00:00.000Z',
          source_pointer: 'broker:runtime_launch:openclaw',
          audit_id: 'broker:runtime_launch:staging-mac-owner:openclaw',
          mac_control: binding,
          runtime_status: {
            status: 'running',
            tools_ready: true,
            mac_control: { ...binding },
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            Location: '/ui/',
            'Set-Cookie': 'evaos_session=proxy_session_secret_for_test; Path=/; Max-Age=300; Secure; HttpOnly',
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse(signedProof.envelope))
      .mockResolvedValueOnce(jsonResponse({ ok: false }, { status: 401 }))
      .mockResolvedValueOnce(
        jsonResponse(
          { ok: false, error: { code: 'method_not_allowed' } },
          { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST' } }
        )
      )
      .mockResolvedValueOnce(jsonResponse({ ok: false }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: { code: 'invalid_request' } }, { status: 400 }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: { code: 'invalid_request' } }, { status: 400 }));

    let deployedProbe: Record<string, unknown> | undefined;

    const proof = await liveCanary.runMacControlLiveCanary({
      env: {
        AIONUI_EVAOS_MAC_CONTROL_CANARY_ACK: 'evaos-mac-control-canary',
        AIONUI_EVAOS_MAC_CONTROL_CANARY_DESKTOP_SESSION: 'eds_mac_canary_session_for_test',
        AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID: 'staging-mac-owner',
        AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT: 'https://dashboard-staging.example.test/runtime',
        AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST: 'openclaw-staging.example.test',
        ...TRUST_ENV,
        GITHUB_SHA: sourceHeadSha,
        GITHUB_RUN_ID: '123456789',
      },
      fetchImpl,
      now: () => now,
      randomBytes: (size: number) => (size === 32 ? challengeBytes : runNonceBytes),
      onDeployedProbe: (value) => {
        deployedProbe = value;
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(8);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
      action: 'runtime_launch',
      customer_id: 'staging-mac-owner',
      runtime: 'openclaw',
      launch_mode: 'mac_control_tools',
    });
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(fetchImpl.mock.calls[2][0]).toBe(
      'https://openclaw-staging.example.test/api/v1/evaos/mac-control/runtime-receipt'
    );
    expect(fetchImpl.mock.calls[2][1]).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      headers: {
        Cookie: 'evaos_session=proxy_session_secret_for_test',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[2][1]?.body))).toEqual({ challenge, runRef });
    expect(proof).toEqual(signedProof.envelope);
    expect(deployedProbe).toMatchObject({
      schema: 'evaos.mac_control.deployed_route_probe.v1',
      sourceHeadSha,
      sourceRunId: '123456789',
      assertions: {
        gatewayAuthRequired: true,
        postOnly: true,
        exactMatch: true,
        strictBody: true,
        callerAuthorityBodyRejected: true,
        sensitiveOutputAbsent: true,
      },
    });
    const publicAttestation = JSON.parse(Buffer.from(signedProof.envelope.attestationBase64, 'base64url').toString());
    expect(JSON.stringify(proof)).not.toMatch(
      /staging-mac-owner|11111111-1111-4111-8111-111111111111|binding_version|binding_expires_at|callback_secret|proxy_session_secret|example\.test|eds_/
    );
    expect(publicAttestation).not.toHaveProperty('challenge');
    expect(publicAttestation).not.toHaveProperty('bindingRef');
    expect(publicAttestation).not.toHaveProperty('sessionRef');
    expect(publicAttestation).not.toHaveProperty('auditRef');

    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-mac-control-contract-'));
    try {
      const proofPath = path.join(proofDir, 'mac-control-runtime.json');
      fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
      fs.writeFileSync(
        path.join(proofDir, 'mac-control-session-provisioning.json'),
        `${JSON.stringify({
          schema: 'evaos-mac-control-canary-session-provision/v1',
          accountConfigured: true,
          customerConfigured: true,
          activeMembershipVerified: true,
          stagingMarkerVerified: true,
          sessionMinted: true,
          sessionExpiryPresent: true,
          sensitiveOutput: 'passed',
        })}\n`
      );
      fs.writeFileSync(
        path.join(proofDir, 'mac-control-session-cleanup.json'),
        `${JSON.stringify({
          schema: 'evaos-mac-control-canary-session-cleanup/v1',
          sessionRevoked: true,
          sensitiveOutput: 'passed',
        })}\n`
      );
      fs.writeFileSync(
        path.join(proofDir, 'mac-control-runtime-negative.json'),
        `${JSON.stringify({
          schema: 'evaos.mac_control.runtime_receipt_negative_proof.v1',
          sourceHeadSha,
          sourceRunId: '123456789',
          assertions: {
            forgedContextRejected: true,
            expiredContextRejected: true,
            replayRejected: true,
            authorityRedacted: true,
          },
        })}\n`
      );
      fs.writeFileSync(path.join(proofDir, 'mac-control-deployed-route.json'), `${JSON.stringify(deployedProbe)}\n`);

      expect(
        releaseGate.verifyMacControlLiveCanaryProof(
          proofDir,
          {
            EVAOS_LIVE_CANARY_EXPECTED_SOURCE_HEAD_SHA: sourceHeadSha,
            EVAOS_LIVE_CANARY_EXPECTED_SOURCE_RUN_ID: '123456789',
            ...TRUST_ENV,
          },
          { now: new Date(now), maxAgeHours: 24 }
        )
      ).toBe(true);

      const pythonSource = [
        'import sys',
        'from pathlib import Path',
        'from evaos_desktop_bridge import qa_canary',
        'result = qa_canary.selected_binding_proof_binding(',
        '    Path(sys.argv[1]),',
        `    expected_source_commit=${JSON.stringify(sourceHeadSha)},`,
        '    expected_source_run_id="123456789",',
        `    expected_source_sha256=${JSON.stringify(expectedCandidate.sourceSha256)},`,
        '    expected_version="2.1.36",',
        '    expected_build="2.1.36",',
        `    verification_time_seconds=${now / 1000},`,
        ')',
        'assert result["ok"] is True, result',
        'print("ok")',
      ].join('\n');
      expect(
        execFileSync('python3', ['-B', '-c', pythonSource, proofPath], {
          encoding: 'utf8',
          env: {
            ...process.env,
            PYTHONDONTWRITEBYTECODE: '1',
            PYTHONPATH: path.join(process.cwd(), 'resources', 'evaos-beta', 'bridge', 'src'),
            ...TRUST_ENV,
          },
        }).trim()
      ).toBe('ok');

      const nonAsciiProofPath = path.join(proofDir, 'mac-control-runtime-non-ascii-signature.json');
      fs.writeFileSync(
        nonAsciiProofPath,
        `${JSON.stringify({ ...proof, signature: `${proof.signature}\u2603` }, null, 2)}\n`
      );
      const malformedPythonSource = pythonSource.replace(
        'assert result["ok"] is True, result',
        'assert result["ok"] is False and result["reason"] == "selected_binding_proof_signature_invalid", result'
      );
      expect(
        execFileSync('python3', ['-B', '-c', malformedPythonSource, nonAsciiProofPath], {
          encoding: 'utf8',
          env: {
            ...process.env,
            PYTHONDONTWRITEBYTECODE: '1',
            PYTHONPATH: path.join(process.cwd(), 'resources', 'evaos-beta', 'bridge', 'src'),
            ...TRUST_ENV,
          },
        }).trim()
      ).toBe('ok');
    } finally {
      fs.rmSync(proofDir, { recursive: true, force: true });
    }
  });

  it('rejects unsigned, forged, stale, overlong, future-dated, or cross-run attestations', () => {
    const now = Date.parse('2026-07-15T00:00:20.000Z');
    const runRef = 'gha:123456789:111111111111111111111111';
    const expectedCandidate = {
      sourceCommit: 'a'.repeat(40),
      sourceSha256: 'b'.repeat(64),
      appVersion: '2.1.36',
      appBuild: '2.1.36',
    };
    const valid = signedMacControlAttestation({
      runRef,
      executedAt: '2026-07-15T00:00:20.000Z',
      authorityIssuedAt: Math.floor(now / 1000) - 1,
      authorityExpiresAt: Math.floor(now / 1000) + 59,
      candidate: expectedCandidate,
      keyId: TEST_RECEIPT_KEY_ID,
      contextKeyId: TEST_CONTEXT_KEY_ID,
      keyPair: TRUST_FIXTURE.keyPair,
    });
    const options = {
      runRef,
      expectedCandidate,
      bindingExpiry: now + 120_000,
      requestStartedAt: now,
      now,
      receiptKeyId: TRUST_ENV.EVAOS_LIVE_CANARY_RECEIPT_KEY_ID,
      receiptPublicKey: TRUST_ENV.EVAOS_LIVE_CANARY_RECEIPT_PUBLIC_KEY,
      contextKeyId: TRUST_ENV.EVAOS_LIVE_CANARY_CONTEXT_KEY_ID,
    };

    const resigned = (overrides: Partial<Parameters<typeof signedMacControlAttestation>[0]>) =>
      signedMacControlAttestation({
        runRef,
        executedAt: '2026-07-15T00:00:20.000Z',
        authorityIssuedAt: Math.floor(now / 1000) - 1,
        authorityExpiresAt: Math.floor(now / 1000) + 59,
        candidate: expectedCandidate,
        keyId: TEST_RECEIPT_KEY_ID,
        contextKeyId: TEST_CONTEXT_KEY_ID,
        keyPair: TRUST_FIXTURE.keyPair,
        ...overrides,
      }).envelope;
    for (const invalid of [
      { schema: 'evaos.mac_control.runtime_proof.v2' },
      { ...valid.envelope, unexpected: true },
      { ...valid.envelope, signature: valid.envelope.signature.replace('A', 'B') },
      resigned({ runRef: 'gha:123456789:222222222222222222222222' }),
      resigned({ candidate: { ...expectedCandidate, sourceCommit: 'd'.repeat(40) } }),
      resigned({ executedAt: '2026-07-15T00:00:14.999Z' }),
      resigned({ executedAt: '2026-07-15T00:00:25.001Z' }),
      resigned({ executedAt: '2026-07-15 00:00:20Z' }),
      resigned({ authorityExpiresAt: Math.floor(now / 1000) + 60 }),
      resigned({ contextKeyId: 'wrong-context-key' }),
    ]) {
      expect(() => liveCanary.sanitizeMacControlRuntimeProof(invalid, options)).toThrow(/attestation/i);
    }
  });

  it('rejects an incomplete top-level capability set even when runtime status is complete', () => {
    const now = Date.parse('2026-07-14T05:00:00.000Z');
    const binding = {
      schema_version: 'evaos.mac_control_runtime_readiness.v1',
      required: true,
      customer_id: 'staging-mac-owner',
      runtime: 'openclaw',
      grant_state: 'active',
      tools_ready: true,
      binding_id: '11111111-1111-4111-8111-111111111111',
      binding_version: '7',
      binding_expires_at: new Date(now + 20_000).toISOString(),
      allowed_capabilities: ['customer_mac_status', 'desktop_see'],
    };

    expect(() =>
      liveCanary.sanitizeMacControlRuntimeLaunchCanaryResponse(
        {
          status: 'attached',
          customer_id: 'staging-mac-owner',
          runtime: 'openclaw',
          launch_mode: 'mac_control_tools',
          launch_url:
            'https://openclaw-staging.example.test/auth/callback?customer_id=staging-mac-owner&session=callback_secret_for_test',
          source_pointer: 'broker:runtime_launch:openclaw',
          audit_id: 'broker:runtime_launch:staging-mac-owner:openclaw',
          mac_control: binding,
          runtime_status: {
            tools_ready: true,
            mac_control: {
              ...binding,
              allowed_capabilities: ['customer_mac_status', 'desktop_see', 'desktop_control'],
            },
          },
        },
        {
          customerId: 'staging-mac-owner',
          runtime: 'openclaw',
          expectedCallbackHost: 'openclaw-staging.example.test',
        },
        now
      )
    ).toThrow(/capability/i);
  });

  it('rejects an incomplete runtime-status capability set even when the top-level binding is complete', () => {
    const now = Date.parse('2026-07-14T05:00:00.000Z');
    const binding = {
      schema_version: 'evaos.mac_control_runtime_readiness.v1',
      required: true,
      customer_id: 'staging-mac-owner',
      runtime: 'openclaw',
      grant_state: 'active',
      tools_ready: true,
      binding_id: '11111111-1111-4111-8111-111111111111',
      binding_version: '7',
      binding_expires_at: new Date(now + 20_000).toISOString(),
      allowed_capabilities: ['customer_mac_status', 'desktop_see', 'desktop_control'],
    };

    expect(() =>
      liveCanary.sanitizeMacControlRuntimeLaunchCanaryResponse(
        {
          status: 'attached',
          customer_id: 'staging-mac-owner',
          runtime: 'openclaw',
          launch_mode: 'mac_control_tools',
          launch_url:
            'https://openclaw-staging.example.test/auth/callback?customer_id=staging-mac-owner&session=callback_secret_for_test',
          source_pointer: 'broker:runtime_launch:openclaw',
          audit_id: 'broker:runtime_launch:staging-mac-owner:openclaw',
          mac_control: binding,
          runtime_status: {
            tools_ready: true,
            mac_control: {
              ...binding,
              allowed_capabilities: ['customer_mac_status', 'desktop_see'],
            },
          },
        },
        {
          customerId: 'staging-mac-owner',
          runtime: 'openclaw',
          expectedCallbackHost: 'openclaw-staging.example.test',
        },
        now
      )
    ).toThrow(/capability/i);
  });

  it('rejects different normalized capability sets even when both copies satisfy every required group', () => {
    const now = Date.parse('2026-07-14T05:00:00.000Z');
    const binding = {
      schema_version: 'evaos.mac_control_runtime_readiness.v1',
      required: true,
      customer_id: 'staging-mac-owner',
      runtime: 'openclaw',
      grant_state: 'active',
      tools_ready: true,
      binding_id: '11111111-1111-4111-8111-111111111111',
      binding_version: '7',
      binding_expires_at: new Date(now + 20_000).toISOString(),
      allowed_capabilities: ['customer_mac_status', 'desktop_see', 'desktop_control'],
    };

    expect(() =>
      liveCanary.sanitizeMacControlRuntimeLaunchCanaryResponse(
        {
          status: 'attached',
          customer_id: 'staging-mac-owner',
          runtime: 'openclaw',
          launch_mode: 'mac_control_tools',
          launch_url:
            'https://openclaw-staging.example.test/auth/callback?customer_id=staging-mac-owner&session=callback_secret_for_test',
          source_pointer: 'broker:runtime_launch:openclaw',
          audit_id: 'broker:runtime_launch:staging-mac-owner:openclaw',
          mac_control: binding,
          runtime_status: {
            tools_ready: true,
            mac_control: {
              ...binding,
              allowed_capabilities: ['desktop_control', 'customer_mac_status', 'customer_mac_snapshot'],
            },
          },
        },
        {
          customerId: 'staging-mac-owner',
          runtime: 'openclaw',
          expectedCallbackHost: 'openclaw-staging.example.test',
        },
        now
      )
    ).toThrow(/capability set mismatch/i);
  });

  it('requires the exact configured callback host and port', () => {
    const now = Date.parse('2026-07-14T05:00:00.000Z');
    const binding = {
      schema_version: 'evaos.mac_control_runtime_readiness.v1',
      required: true,
      customer_id: 'staging-mac-owner',
      runtime: 'openclaw',
      grant_state: 'active',
      tools_ready: true,
      binding_id: '11111111-1111-4111-8111-111111111111',
      binding_version: '7',
      binding_expires_at: new Date(now + 20_000).toISOString(),
      allowed_capabilities: ['customer_mac_status', 'desktop_see', 'desktop_control'],
    };

    expect(() =>
      liveCanary.sanitizeMacControlRuntimeLaunchCanaryResponse(
        {
          status: 'attached',
          customer_id: 'staging-mac-owner',
          runtime: 'openclaw',
          launch_mode: 'mac_control_tools',
          launch_url:
            'https://openclaw-staging.example.test:9443/auth/callback?customer_id=staging-mac-owner&session=callback_secret_for_test',
          source_pointer: 'broker:runtime_launch:openclaw',
          audit_id: 'broker:runtime_launch:staging-mac-owner:openclaw',
          mac_control: binding,
          runtime_status: { tools_ready: true, mac_control: { ...binding } },
        },
        {
          customerId: 'staging-mac-owner',
          runtime: 'openclaw',
          expectedCallbackHost: 'openclaw-staging.example.test',
        },
        now
      )
    ).toThrow(/launch target/i);
  });

  it('requires exactly one customer_id and one session query parameter with no extras', () => {
    const now = Date.parse('2026-07-14T05:00:00.000Z');
    const binding = {
      schema_version: 'evaos.mac_control_runtime_readiness.v1',
      required: true,
      customer_id: 'staging-mac-owner',
      runtime: 'openclaw',
      grant_state: 'active',
      tools_ready: true,
      binding_id: '11111111-1111-4111-8111-111111111111',
      binding_version: '7',
      binding_expires_at: new Date(now + 20_000).toISOString(),
      allowed_capabilities: ['customer_mac_status', 'desktop_see', 'desktop_control'],
    };
    const response = (launchUrl: string) => ({
      status: 'attached',
      customer_id: 'staging-mac-owner',
      runtime: 'openclaw',
      launch_mode: 'mac_control_tools',
      launch_url: launchUrl,
      source_pointer: 'broker:runtime_launch:openclaw',
      audit_id: 'broker:runtime_launch:staging-mac-owner:openclaw',
      mac_control: binding,
      runtime_status: { tools_ready: true, mac_control: { ...binding } },
    });
    const request = {
      customerId: 'staging-mac-owner',
      runtime: 'openclaw',
      expectedCallbackHost: 'openclaw-staging.example.test',
    };

    expect(() =>
      liveCanary.sanitizeMacControlRuntimeLaunchCanaryResponse(
        response(
          'https://openclaw-staging.example.test/auth/callback?customer_id=staging-mac-owner&customer_id=staging-mac-owner&session=callback_secret_for_test'
        ),
        request,
        now
      )
    ).toThrow(/exactly one customer_id and one session/i);
    expect(() =>
      liveCanary.sanitizeMacControlRuntimeLaunchCanaryResponse(
        response(
          'https://openclaw-staging.example.test/auth/callback?customer_id=staging-mac-owner&session=callback_secret_for_test&session=second_secret_for_test'
        ),
        request,
        now
      )
    ).toThrow(/exactly one customer_id and one session/i);
    expect(() =>
      liveCanary.sanitizeMacControlRuntimeLaunchCanaryResponse(
        response(
          'https://openclaw-staging.example.test/auth/callback?customer_id=staging-mac-owner&session=callback_secret_for_test&access_token=credential_for_test'
        ),
        request,
        now
      )
    ).toThrow(/secret material/i);
  });

  it('fails closed when the runtime-status binding copy contradicts the selected customer scope', () => {
    const now = Date.parse('2026-07-14T05:00:00.000Z');
    const binding = {
      schema_version: 'evaos.mac_control_runtime_readiness.v1',
      required: true,
      customer_id: 'staging-mac-owner',
      runtime: 'openclaw',
      grant_state: 'active',
      tools_ready: true,
      binding_id: '11111111-1111-4111-8111-111111111111',
      binding_version: '7',
      binding_expires_at: new Date(now + 20_000).toISOString(),
      allowed_capabilities: ['customer_mac_status', 'desktop_see', 'desktop_control'],
    };

    expect(() =>
      liveCanary.sanitizeMacControlRuntimeLaunchCanaryResponse(
        {
          status: 'attached',
          customer_id: 'staging-mac-owner',
          runtime: 'openclaw',
          launch_mode: 'mac_control_tools',
          launch_url:
            'https://openclaw-staging.example.test/auth/callback?customer_id=staging-mac-owner&session=callback_secret_for_test',
          source_pointer: 'broker:runtime_launch:openclaw',
          audit_id: 'broker:runtime_launch:staging-mac-owner:openclaw',
          mac_control: binding,
          runtime_status: {
            tools_ready: true,
            mac_control: { ...binding, customer_id: 'other-staging-customer' },
          },
        },
        {
          customerId: 'staging-mac-owner',
          runtime: 'openclaw',
          expectedCallbackHost: 'openclaw-staging.example.test',
        },
        now
      )
    ).toThrow(/customer scope mismatch/i);
  });

  it('fails with binding-missing evidence before reading tools_ready when runtime status is absent', () => {
    const now = Date.parse('2026-07-14T05:00:00.000Z');
    const binding = {
      schema_version: 'evaos.mac_control_runtime_readiness.v1',
      required: true,
      customer_id: 'staging-mac-owner',
      runtime: 'openclaw',
      grant_state: 'active',
      tools_ready: true,
      binding_id: '11111111-1111-4111-8111-111111111111',
      binding_version: '7',
      binding_expires_at: new Date(now + 20_000).toISOString(),
      allowed_capabilities: ['customer_mac_status', 'desktop_see', 'desktop_control'],
    };

    expect(() =>
      liveCanary.sanitizeMacControlRuntimeLaunchCanaryResponse(
        {
          status: 'attached',
          customer_id: 'staging-mac-owner',
          runtime: 'openclaw',
          launch_mode: 'mac_control_tools',
          launch_url:
            'https://openclaw-staging.example.test/auth/callback?customer_id=staging-mac-owner&session=callback_secret_for_test',
          source_pointer: 'broker:runtime_launch:openclaw',
          audit_id: 'broker:runtime_launch:staging-mac-owner:openclaw',
          mac_control: binding,
        },
        {
          customerId: 'staging-mac-owner',
          runtime: 'openclaw',
          expectedCallbackHost: 'openclaw-staging.example.test',
        },
        now
      )
    ).toThrow(/omitted selected-binding readiness/i);
  });

  it('fails closed when the selected binding is expired or the callback exchange is rejected', async () => {
    const now = Date.parse('2026-07-14T05:00:00.000Z');
    const binding = {
      schema_version: 'evaos.mac_control_runtime_readiness.v1',
      required: true,
      customer_id: 'staging-mac-owner',
      runtime: 'openclaw',
      grant_state: 'active',
      tools_ready: true,
      binding_id: '11111111-1111-4111-8111-111111111111',
      binding_version: '7',
      binding_expires_at: new Date(now - 1_000).toISOString(),
      allowed_capabilities: ['customer_mac_status', 'desktop_see', 'desktop_control'],
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        status: 'attached',
        customer_id: 'staging-mac-owner',
        runtime: 'openclaw',
        launch_mode: 'mac_control_tools',
        launch_url:
          'https://openclaw-staging.example.test/auth/callback?customer_id=staging-mac-owner&session=callback_secret_for_test',
        source_pointer: 'broker:runtime_launch:openclaw',
        audit_id: 'broker:runtime_launch:staging-mac-owner:openclaw',
        mac_control: binding,
        runtime_status: { tools_ready: true, mac_control: { ...binding } },
      })
    );

    await expect(
      liveCanary.runMacControlLiveCanary({
        env: {
          AIONUI_EVAOS_MAC_CONTROL_CANARY_ACK: 'evaos-mac-control-canary',
          AIONUI_EVAOS_MAC_CONTROL_CANARY_DESKTOP_SESSION: 'eds_mac_canary_session_for_test',
          AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID: 'staging-mac-owner',
          AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT: 'https://dashboard-staging.example.test/runtime',
          AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST: 'openclaw-staging.example.test',
          ...TRUST_ENV,
        },
        fetchImpl,
        now: () => now,
      })
    ).rejects.toMatchObject({
      proof: expect.objectContaining({
        schema: 'evaos-mac-control-live-canary/v1',
        ok: false,
        reason: 'binding_expired',
        secretScan: 'passed',
      }),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails when the selected binding expires while the callback exchange is in flight', async () => {
    const launchNow = Date.parse('2026-07-14T05:00:00.000Z');
    const callbackNow = launchNow + 20_000;
    const binding = {
      schema_version: 'evaos.mac_control_runtime_readiness.v1',
      required: true,
      customer_id: 'staging-mac-owner',
      runtime: 'openclaw',
      grant_state: 'active',
      tools_ready: true,
      binding_id: '11111111-1111-4111-8111-111111111111',
      binding_version: '7',
      binding_expires_at: new Date(launchNow + 10_000).toISOString(),
      allowed_capabilities: ['customer_mac_status', 'desktop_see', 'desktop_control'],
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'attached',
          customer_id: 'staging-mac-owner',
          runtime: 'openclaw',
          launch_mode: 'mac_control_tools',
          launch_url:
            'https://openclaw-staging.example.test/auth/callback?customer_id=staging-mac-owner&session=callback_secret_for_test',
          source_pointer: 'broker:runtime_launch:openclaw',
          audit_id: 'broker:runtime_launch:staging-mac-owner:openclaw',
          mac_control: binding,
          runtime_status: { tools_ready: true, mac_control: { ...binding } },
        })
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            Location: '/ui/',
            'Set-Cookie': 'evaos_session=proxy_session_secret_for_test; Path=/; Max-Age=300; Secure; HttpOnly',
          },
        })
      );
    const times = [launchNow, callbackNow];

    await expect(
      liveCanary.runMacControlLiveCanary({
        env: {
          AIONUI_EVAOS_MAC_CONTROL_CANARY_ACK: 'evaos-mac-control-canary',
          AIONUI_EVAOS_MAC_CONTROL_CANARY_DESKTOP_SESSION: 'eds_mac_canary_session_for_test',
          AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID: 'staging-mac-owner',
          AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT: 'https://dashboard-staging.example.test/runtime',
          AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST: 'openclaw-staging.example.test',
          ...TRUST_ENV,
        },
        fetchImpl,
        now: () => times.shift() ?? callbackNow,
      })
    ).rejects.toMatchObject({
      proof: expect.objectContaining({ ok: false, reason: 'binding_expired' }),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects unusable or non-host-only proxy session cookies', async () => {
    const now = Date.parse('2026-07-14T05:00:00.000Z');
    const binding = {
      schema_version: 'evaos.mac_control_runtime_readiness.v1',
      required: true,
      customer_id: 'staging-mac-owner',
      runtime: 'openclaw',
      grant_state: 'active',
      tools_ready: true,
      binding_id: '11111111-1111-4111-8111-111111111111',
      binding_version: '7',
      binding_expires_at: new Date(now + 20_000).toISOString(),
      allowed_capabilities: ['customer_mac_status', 'desktop_see', 'desktop_control'],
    };
    const launchResponse = {
      status: 'attached',
      customer_id: 'staging-mac-owner',
      runtime: 'openclaw',
      launch_mode: 'mac_control_tools',
      launch_url:
        'https://openclaw-staging.example.test/auth/callback?customer_id=staging-mac-owner&session=callback_secret_for_test',
      source_pointer: 'broker:runtime_launch:openclaw',
      audit_id: 'broker:runtime_launch:staging-mac-owner:openclaw',
      mac_control: binding,
      runtime_status: { tools_ready: true, mac_control: { ...binding } },
    };
    const invalidCookies = [
      'evaos_session=deleted; Path=/; Max-Age=300; Secure; HttpOnly',
      'evaos_session=proxy_session_secret_for_test; Path=/; Max-Age=0; Secure; HttpOnly',
      'evaos_session=proxy_session_secret_for_test; Path=/; Expires=Tue, 14 Jul 2026 04:59:59 GMT; Secure; HttpOnly',
      'evaos_session=proxy_session_secret_for_test; Max-Age=300; Secure; HttpOnly',
      'evaos_session=proxy_session_secret_for_test; Path=/ui; Max-Age=300; Secure; HttpOnly',
      'evaos_session=proxy_session_secret_for_test; Path=/; Domain=example.test; Max-Age=300; Secure; HttpOnly',
      'evaos_session=proxy_session_secret_for_test; Path=/; Max-Age=300; HttpOnly',
      'evaos_session=proxy_session_secret_for_test; Path=/; Max-Age=300; Secure',
      'evaos_session=proxy_session_secret_for_test; Path=/; Secure; HttpOnly',
    ];

    await Promise.all(
      invalidCookies.map((setCookie) => {
        const fetchImpl = vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(jsonResponse(launchResponse))
          .mockResolvedValueOnce(
            new Response(null, {
              status: 302,
              headers: { Location: '/ui/', 'Set-Cookie': setCookie },
            })
          );

        return expect(
          liveCanary.runMacControlLiveCanary({
            env: {
              AIONUI_EVAOS_MAC_CONTROL_CANARY_ACK: 'evaos-mac-control-canary',
              AIONUI_EVAOS_MAC_CONTROL_CANARY_DESKTOP_SESSION: 'eds_mac_canary_session_for_test',
              AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID: 'staging-mac-owner',
              AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT: 'https://dashboard-staging.example.test/runtime',
              AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST: 'openclaw-staging.example.test',
              ...TRUST_ENV,
            },
            fetchImpl,
            now: () => now,
          })
        ).rejects.toMatchObject({
          proof: expect.objectContaining({ ok: false, reason: 'callback_rejected' }),
        });
      })
    );
  });
});
