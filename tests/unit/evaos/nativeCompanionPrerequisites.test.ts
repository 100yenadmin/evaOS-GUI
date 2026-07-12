/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  classifyNativeCompanionActionEngine,
  classifyNativeCompanionBridgeRuntime,
  classifyNativeCompanionPrivateNetwork,
} from '@/common/evaos/nativeCompanionPrerequisites';

describe('nativeCompanionPrerequisites', () => {
  it.each([
    [{ installed: false }, 'missing'],
    [{ installed: true, commandSucceeded: false, compatible: true }, 'error'],
    [{ installed: true, commandSucceeded: true, compatible: false }, 'incompatible'],
    [{ installed: true, commandSucceeded: true, compatible: true }, 'ready'],
    [{ installed: true, commandSucceeded: true }, 'error'],
  ] as const)('classifies bridge runtime evidence %j as %s', (evidence, expected) => {
    expect(classifyNativeCompanionBridgeRuntime(evidence)).toBe(expected);
  });

  it.each([
    [{ clientInstalled: false }, 'client_missing'],
    [{ clientInstalled: true, clientRunning: false }, 'client_stopped'],
    [{ clientInstalled: true, clientRunning: true, enrolled: false }, 'unenrolled'],
    [{ clientInstalled: true, clientRunning: true, enrolled: true, correctControlPlane: false }, 'wrong_control_plane'],
    [
      {
        clientInstalled: true,
        clientRunning: true,
        enrolled: true,
        correctControlPlane: true,
        aclAllowed: false,
      },
      'acl_blocked',
    ],
    [
      {
        clientInstalled: true,
        clientRunning: true,
        enrolled: true,
        correctControlPlane: true,
        aclAllowed: true,
        online: false,
      },
      'offline',
    ],
    [
      {
        clientInstalled: true,
        clientRunning: true,
        enrolled: true,
        correctControlPlane: true,
        aclAllowed: true,
        online: true,
      },
      'online',
    ],
    [
      {
        clientInstalled: true,
        clientRunning: true,
        enrolled: true,
        correctControlPlane: true,
        online: true,
      },
      'error',
    ],
    [undefined, 'error'],
  ] as const)('classifies redacted private-network evidence %j as %s', (evidence, expected) => {
    expect(classifyNativeCompanionPrivateNetwork(evidence)).toBe(expected);
  });

  it.each([
    [{ cuaAvailable: true, cuaActiveForActions: true, peekabooAvailable: true }, 'cua_ready'],
    [{ cuaAvailable: true, cuaActiveForActions: false, peekabooAvailable: true }, 'peekaboo_ready'],
    [{ peekabooAvailable: true }, 'peekaboo_ready'],
    [{ nativeFallbackAvailable: true }, 'native_fallback_ready'],
    [{ cuaAvailable: true, cuaActiveForActions: false }, 'unavailable'],
    [undefined, 'unavailable'],
  ] as const)('classifies action-engine evidence %j as %s', (evidence, expected) => {
    expect(classifyNativeCompanionActionEngine(evidence)).toBe(expected);
  });
});
