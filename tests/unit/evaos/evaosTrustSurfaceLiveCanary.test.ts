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
const trustCanary = require('../../../scripts/evaosTrustSurfaceLiveCanary.js') as {
  CANARY_ACTIONS: Array<{ action: string }>;
  runTrustSurfaceLiveCanary: (options: {
    env: Record<string, string | undefined>;
    fetchImpl: typeof fetch;
  }) => Promise<Record<string, unknown>>;
  summarizeTrustSurfaceResponse: (
    raw: unknown,
    request: { action: string; customerId: string }
  ) => Record<string, unknown>;
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('evaOS trust-surface live canary', () => {
  it('summarizes clean trust-surface responses without raw broker payloads', () => {
    const summary = trustCanary.summarizeTrustSurfaceResponse(
      {
        schema_version: 'evaos.provider_hub.v1',
        customer_id: 'cus_123',
        provider_profiles: [{ provider_key: 'google_workspace', status: 'connected' }],
        backend_enforced: true,
        source_pointer: 'broker:provider_profiles:cus_123',
        audit_id: 'audit_provider_123',
      },
      { action: 'provider_profiles', customerId: 'cus_123' }
    );

    expect(summary).toEqual({
      action: 'provider_profiles',
      customerId: 'cus_123',
      customerAccountId: undefined,
      schemaVersion: 'evaos.provider_hub.v1',
      status: undefined,
      routeDenied: undefined,
      backendEnforced: true,
      sourcePointer: 'broker:provider_profiles:cus_123',
      auditId: 'audit_provider_123',
      rowCount: 1,
      secretScan: 'passed',
    });
  });

  it('fails closed when a trust-surface response contains provider secret material', () => {
    expect(() =>
      trustCanary.summarizeTrustSurfaceResponse(
        {
          customer_id: 'cus_123',
          provider_profiles: [{ provider_key: 'github', access_token: 'raw-token' }],
        },
        { action: 'provider_profiles', customerId: 'cus_123' }
      )
    ).toThrow(/secret material/);
  });

  it('runs the expected trust-surface action sequence with Authorization but no session in output', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const actionSpec of trustCanary.CANARY_ACTIONS) {
      fetchImpl.mockResolvedValueOnce(
        jsonResponse({
          schema_version: `schema.${actionSpec.action}`,
          customer_id: 'cus_123',
          backend_enforced: true,
          source_pointer: `broker:${actionSpec.action}:cus_123`,
          audit_id: `audit_${actionSpec.action}`,
        })
      );
    }

    const proof = await trustCanary.runTrustSurfaceLiveCanary({
      env: {
        AIONUI_EVAOS_DESKTOP_SESSION: 'eds_valid_session_for_test',
        AIONUI_EVAOS_CUSTOMER_ID: 'cus_123',
        AIONUI_EVAOS_BROKER_ENDPOINT: 'https://broker.example.test/runtime',
      },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(trustCanary.CANARY_ACTIONS.length);
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer eds_valid_session_for_test',
      'Content-Type': 'application/json',
    });
    expect(proof).toMatchObject({
      schema: 'evaos-trust-surface-live-canary/v1',
      customerId: 'cus_123',
      actionCount: trustCanary.CANARY_ACTIONS.length,
    });
    expect(JSON.stringify(proof)).not.toContain('eds_valid_session_for_test');
  });
});
