/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EVAOS_BETA_IDENTITY } from '@/common/evaos/betaIdentity';
import type { IEvaosRuntimeKey } from '@/common/evaos/bridgeTypes';

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

const SECRET_TEXT_PATTERN =
  /\b(?:eds|epg)_[A-Za-z0-9_-]{4,}\b|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|grant[_-]?handle|authorization|bearer|secret|password/i;
const MAX_FIELD_LENGTH = 220;
const MAX_AUDIT_IDS = 8;

export type EvaosSupportCustomerContext = {
  selectedCustomerId?: string | null;
  selectedCustomerLabel?: string | null;
  summaryText?: string | null;
  accountEmail?: string | null;
  roles?: readonly string[];
  scopes?: readonly string[];
};

export type EvaosSupportReportInput = {
  surface: string;
  route?: string;
  runtimeKey?: IEvaosRuntimeKey;
  issueRef?: string;
  settledState?: string;
  status?: string | null;
  healthSummary?: string | null;
  blocker?: string | null;
  sourcePointer?: string | null;
  auditIds?: readonly (string | null | undefined)[];
  customer?: EvaosSupportCustomerContext;
};

export type EvaosSupportReportContext = {
  module: string;
  autoScreenshot: true;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
};

export function buildEvaosSupportReportContext(input: EvaosSupportReportInput): EvaosSupportReportContext {
  const route = safeSupportText(input.route, currentRoute());
  const surface = safeSupportText(input.surface, 'evaos');
  const settledState = safeSupportText(input.settledState, 'unknown');
  const auditIds = uniqueSafeList(input.auditIds ?? []);
  const customer = buildCustomerContext(input.customer);

  return {
    module: 'other',
    autoScreenshot: true,
    tags: compactTags({
      support_surface: surface,
      evaos_route: route,
      evaos_state: settledState,
      evaos_runtime: safeSupportText(input.runtimeKey, undefined),
      evaos_issue: safeSupportText(input.issueRef, undefined),
      evaos_product: 'workbench_beta',
    }),
    extra: {
      support_packet_version: 'evaos.support_report.v1',
      product: EVAOS_BETA_IDENTITY.productName,
      app_version: appVersion(),
      app_commit: appCommit(),
      bundle_id: EVAOS_BETA_IDENTITY.appId,
      protocol_scheme: EVAOS_BETA_IDENTITY.protocolScheme,
      route,
      surface,
      runtime_key: safeSupportText(input.runtimeKey, undefined),
      issue_ref: safeSupportText(input.issueRef, undefined),
      settled_state: settledState,
      status: safeSupportText(input.status, undefined),
      health_summary: safeSupportText(input.healthSummary, undefined),
      blocker: safeSupportText(input.blocker, undefined),
      source_pointer: safeSupportText(input.sourcePointer, undefined),
      audit_ids: auditIds,
      customer,
      screenshot: {
        auto_capture_requested: true,
        user_can_attach_more: true,
      },
    },
  };
}

export function currentRoute(): string {
  if (typeof window === 'undefined') {
    return 'unknown';
  }
  const hashRoute = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  const route = hashRoute || `${window.location.pathname}${window.location.search}`;
  return safeSupportText(route, 'unknown') ?? 'unknown';
}

function buildCustomerContext(customer: EvaosSupportCustomerContext | undefined): Record<string, unknown> {
  return {
    selected_customer_id: safeSupportText(customer?.selectedCustomerId, undefined),
    selected_customer_label: safeSupportText(customer?.selectedCustomerLabel, undefined),
    summary: safeSupportText(customer?.summaryText, 'No customer context loaded'),
    account_email: safeSupportText(customer?.accountEmail, undefined),
    roles: uniqueSafeList(customer?.roles ?? []),
    scopes: uniqueSafeList(customer?.scopes ?? []),
  };
}

function appVersion(): string {
  return typeof __APP_VERSION__ === 'undefined' ? '0.0.0' : (safeSupportText(__APP_VERSION__, '0.0.0') ?? '0.0.0');
}

function appCommit(): string {
  return typeof __APP_COMMIT__ === 'undefined' ? 'unknown' : (safeSupportText(__APP_COMMIT__, 'unknown') ?? 'unknown');
}

function uniqueSafeList(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const safeValues: string[] = [];
  values.forEach((value) => {
    const safe = safeSupportText(value, undefined);
    if (!safe || seen.has(safe)) return;
    seen.add(safe);
    safeValues.push(safe);
  });
  return safeValues.slice(0, MAX_AUDIT_IDS);
}

function compactTags(tags: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tags)
      .map(([key, value]) => [key, tagValue(value)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
  );
}

function tagValue(value: string | undefined): string | undefined {
  const safe = safeSupportText(value, undefined);
  if (!safe) return undefined;
  return safe.replace(/\s+/g, '_').slice(0, 120);
}

function safeSupportText(value: unknown, fallback: string | undefined): string | undefined {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed.length > MAX_FIELD_LENGTH ? `${trimmed.slice(0, MAX_FIELD_LENGTH - 3)}...` : trimmed;
}
