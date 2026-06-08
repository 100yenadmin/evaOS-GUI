/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { protocol } from 'electron';
import type { IEvaosRuntimeKey, IEvaosRuntimeSurfaceView } from '@/common/evaos/bridgeTypes';

export const EVAOS_RUNTIME_SURFACE_SCHEME = 'evaos-runtime-surface';
const DEFAULT_RUNTIME_SURFACE_TTL_MS = 5 * 60 * 1000;

interface EvaosRuntimeSurfaceRecord {
  launchUrl: string;
  customerId: string;
  runtimeKey: IEvaosRuntimeKey;
  displayLabel: string;
  sourcePointer?: string;
  auditId?: string;
  expiresAt?: string;
  createdAt: number;
}

export interface EvaosRuntimeSurfaceCreateInput {
  customerId: string;
  runtimeKey: IEvaosRuntimeKey;
  displayLabel: string;
  sourcePointer?: string;
  auditId?: string;
  expiresAt?: string;
}

const surfaces = new Map<string, EvaosRuntimeSurfaceRecord>();
let protocolInstalled = false;

export function createEvaosRuntimeSurface(
  launchUrl: string,
  input: EvaosRuntimeSurfaceCreateInput
): IEvaosRuntimeSurfaceView {
  const surfaceId = crypto.randomUUID();
  surfaces.set(surfaceId, {
    launchUrl,
    customerId: input.customerId,
    runtimeKey: input.runtimeKey,
    displayLabel: input.displayLabel,
    sourcePointer: input.sourcePointer,
    auditId: input.auditId,
    expiresAt: input.expiresAt ?? new Date(Date.now() + DEFAULT_RUNTIME_SURFACE_TTL_MS).toISOString(),
    createdAt: Date.now(),
  });

  const surface = surfaces.get(surfaceId);
  return {
    schemaVersion: 'evaos.runtime_surface.v1',
    surfaceId,
    surfaceUri: `${EVAOS_RUNTIME_SURFACE_SCHEME}://${surfaceId}/`,
    customerId: input.customerId,
    runtimeKey: input.runtimeKey,
    displayLabel: input.displayLabel,
    status: 'attached',
    sourcePointer: input.sourcePointer,
    auditId: input.auditId,
    expiresAt: surface?.expiresAt,
  };
}

export function registerEvaosRuntimeSurfaceProtocol(): void {
  if (protocolInstalled) return;
  protocolInstalled = true;

  protocol.handle(EVAOS_RUNTIME_SURFACE_SCHEME, (request) => {
    const surfaceId = surfaceIdFromRequestUrl(request.url);
    const surface = surfaceId ? surfaces.get(surfaceId) : undefined;
    if (!surface || isRuntimeSurfaceExpired(surface)) {
      if (surfaceId) surfaces.delete(surfaceId);
      return new Response(runtimeSurfaceMissingHtml(), {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    return Response.redirect(surface.launchUrl, 302);
  });
}

export function clearEvaosRuntimeSurfacesForCustomer(customerId: string): void {
  for (const [surfaceId, surface] of surfaces.entries()) {
    if (surface.customerId === customerId) {
      surfaces.delete(surfaceId);
    }
  }
}

export function clearEvaosRuntimeSurfaces(): void {
  surfaces.clear();
}

function surfaceIdFromRequestUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.hostname || parsed.pathname.replace(/^\/+/, '') || undefined;
  } catch {
    return undefined;
  }
}

function isRuntimeSurfaceExpired(surface: EvaosRuntimeSurfaceRecord): boolean {
  if (!surface.expiresAt) {
    return Date.now() - surface.createdAt > DEFAULT_RUNTIME_SURFACE_TTL_MS;
  }
  const expiresAt = Date.parse(surface.expiresAt);
  return Number.isNaN(expiresAt) || expiresAt <= Date.now();
}

function runtimeSurfaceMissingHtml(): string {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Runtime surface unavailable</title></head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px;">
    <h1>Runtime surface unavailable</h1>
    <p>This evaOS runtime surface is no longer attached. Reconnect the workspace from Workbench.</p>
  </body>
</html>`;
}
