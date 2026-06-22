/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { containsEvaosSecretMaterial, EvaosBrokerSessionError } from '@process/services/evaosBrokerSession';

const SAFE_SECRET_METADATA_KEYS = new Set(['rawSecretsStoredInWorkbench', 'hasBrokeredGrant']);

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
    if (isSafePairingSetupPrompt(path, value)) {
      return;
    }
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
    if (containsEvaosSecretMaterial(key) && !isSafeSecretMetadata(key, child)) {
      throwRendererSecretError(`${path}.${key}`);
    }
    assertEvaosRendererSafePayloadAt(child, `${path}.${key}`, seen, depth + 1);
  }
}

function isSafeSecretMetadata(key: string, value: unknown): boolean {
  return SAFE_SECRET_METADATA_KEYS.has(key) && typeof value === 'boolean';
}

function isSafePairingSetupPrompt(path: string, value: string): boolean {
  if (path !== '$.pairing.setupPrompt') {
    return false;
  }
  if (
    !value.includes('customer_mac_complete_pairing') ||
    !/\bPairing code:\s*[A-Za-z0-9-]+\b/i.test(value) ||
    !/\bCustomer:\s*[A-Za-z0-9._-]+\b/i.test(value)
  ) {
    return false;
  }
  return !/https?:\/\/|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:localhost|127\.0\.0\.1)\b|connector[_\s-]?url|connector[_\s-]?token|bearer|access[_\s-]?token|refresh[_\s-]?token|desktop[_\s-]?session|provider[_\s-]?grant|ssh|vnc|cdp|browser\s+debug/i.test(
    value
  );
}

function throwRendererSecretError(path: string): never {
  throw new EvaosBrokerSessionError(
    'broker_invalid_response',
    `The evaOS broker response included renderer-visible secret material at ${path}.`
  );
}
