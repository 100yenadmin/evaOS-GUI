/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const evidenceAudit = require('../../../scripts/evaosShellSecretEvidenceAudit.js') as {
  auditShellSecretEvidence: (input: unknown) => {
    ready: boolean;
    blockers: string[];
    categories: Record<string, boolean>;
    findings: Array<{ path: string; pattern: string }>;
  };
  renderMarkdown: (report: ReturnType<typeof evidenceAudit.auditShellSecretEvidence>) => string;
};

const cleanEvidence = {
  renderer: {
    localStorage: {},
    sessionStorage: {},
    console: ['Mission Control loaded runtime evidence for customer cus_123.'],
    urls: ['evaos-workbench-beta://mission-control?customer_id=cus_123'],
  },
  ipc: {
    payloads: [
      {
        channel: 'evaosBroker.runtimeStatus',
        result: {
          ok: true,
          runtime: 'browser',
          status: 'running',
          auditId: 'audit_123',
        },
      },
    ],
  },
  screenshotsText: ['Runtime running. No secret values visible.'],
};

describe('evaOS shell secret evidence audit', () => {
  it('passes complete shell evidence without secret material', () => {
    const report = evidenceAudit.auditShellSecretEvidence(cleanEvidence);

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.findings).toEqual([]);
    expect(report.categories).toMatchObject({
      console: true,
      localStorage: true,
      sessionStorage: true,
      urls: true,
      ipc: true,
    });
  });

  it('fails closed when required live evidence categories are missing', () => {
    const report = evidenceAudit.auditShellSecretEvidence({
      renderer: {
        localStorage: {},
      },
    });

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('missing evidence category: console');
    expect(report.blockers).toContain('missing evidence category: sessionStorage');
    expect(report.blockers).toContain('missing evidence category: urls');
    expect(report.blockers).toContain('missing evidence category: ipc');
  });

  it('finds renderer storage, log, URL, and IPC secret exposure without printing raw secret values', () => {
    const rawSession = 'eds_live_session_should_not_render';
    const providerGrant = 'epg_provider_grant_should_not_render';
    const report = evidenceAudit.auditShellSecretEvidence({
      renderer: {
        localStorage: {
          desktop_session: rawSession,
        },
        sessionStorage: {},
        console: [`Authorization Bearer ${rawSession}`],
        urls: [`evaos-workbench-beta://mission-control?desktop_session=${rawSession}`],
      },
      ipc: {
        payloads: [
          {
            channel: 'evaosBroker.providerAuth',
            result: {
              provider_grant_handle: providerGrant,
            },
          },
        ],
      },
    });
    const rendered = evidenceAudit.renderMarkdown(report);

    expect(report.ready).toBe(false);
    expect(report.findings.map((finding) => finding.path)).toEqual(
      expect.arrayContaining([
        '$.renderer.localStorage.desktop_session',
        '$.renderer.console[0]',
        '$.renderer.urls[0]',
        '$.ipc.payloads[0].result.provider_grant_handle',
      ])
    );
    expect(rendered).toContain('desktop_session');
    expect(rendered).toContain('provider_grant_handle');
    expect(rendered).not.toContain(rawSession);
    expect(rendered).not.toContain(providerGrant);
  });
});
