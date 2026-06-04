/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { containsEvaosSecretMaterial, EvaosBrokerSessionError } from '@process/services/evaosBrokerSession';

export function assertEvaosRendererSafePayload(value: unknown): void {
  assertEvaosRendererSafePayloadAt(value, '$', new WeakSet<object>(), 0);
}

function assertEvaosRendererSafePayloadAt(value: unknown, path: string, seen: WeakSet<object>, depth: number): void {
  if (depth > 10) {
    throw new EvaosBrokerSessionError(
      'broker_invalid_response',
      'The evaOS broker returned a response that is too deeply nested for renderer IPC.'
    );
  }

  if (typeof value === 'string') {
    if (containsEvaosSecretMaterial(value)) {
      throwRendererSecretError(path);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertEvaosRendererSafePayloadAt(item, `${path}[${index}]`, seen, depth + 1));
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (containsEvaosSecretMaterial(key)) {
      throwRendererSecretError(`${path}.${key}`);
    }
    assertEvaosRendererSafePayloadAt(child, `${path}.${key}`, seen, depth + 1);
  }
}

function throwRendererSecretError(path: string): never {
  throw new EvaosBrokerSessionError(
    'broker_invalid_response',
    `The evaOS broker response included renderer-visible secret material at ${path}.`
  );
}
