import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canEvaosShellPerformLocalTrustAction,
  EVAOS_FORBIDDEN_LOCAL_TRUST_ACTIONS,
  EVAOS_NATIVE_COMPANION_BOUNDARY,
  EVAOS_NATIVE_COMPANION_STATUS_MATRIX,
  getEvaosNativeCompanionBoundaryViolations,
} from '../../../packages/desktop/src/process/evaosNativeCompanionBoundary';
import { EVAOS_BETA_IDENTITY } from '../../../packages/desktop/src/process/evaosBetaSafety';

const repoRoot = resolve(__dirname, '../../..');

describe('evaosNativeCompanionBoundary', () => {
  it('keeps the shell out of local trust authority', () => {
    expect(getEvaosNativeCompanionBoundaryViolations()).toEqual([]);
    expect(EVAOS_NATIVE_COMPANION_BOUNDARY.shell.isLocalTrustAuthority).toBe(false);
    expect(EVAOS_NATIVE_COMPANION_BOUNDARY.shell.rendererReceivesNativeSecrets).toBe(false);
    expect(EVAOS_NATIVE_COMPANION_BOUNDARY.shell.rendererReceivesSessionTokens).toBe(false);
  });

  it('fails closed for forbidden and unknown local trust actions', () => {
    for (const actionId of EVAOS_FORBIDDEN_LOCAL_TRUST_ACTIONS) {
      const decision = canEvaosShellPerformLocalTrustAction(actionId);
      expect(decision.allowed, actionId).toBe(false);
      expect(decision.reason, actionId).toContain('native-companion owned');
    }

    expect(canEvaosShellPerformLocalTrustAction('new-local-control-surface')).toEqual({
      allowed: false,
      reason: 'Unknown local trust actions fail closed until the native companion contract explicitly allows them.',
    });
  });

  it('documents every broker and native capability in the boundary doc', () => {
    const doc = readFileSync(resolve(repoRoot, 'docs/evaos/native-companion-boundary.md'), 'utf8');
    const changelog = readFileSync(resolve(repoRoot, 'CHANGELOG.md'), 'utf8');

    expect(doc).toContain(EVAOS_NATIVE_COMPANION_BOUNDARY.version);
    expect(doc).toContain(EVAOS_NATIVE_COMPANION_BOUNDARY.betaReleaseNote);
    expect(doc).toContain(EVAOS_NATIVE_COMPANION_BOUNDARY.releasedWorkbenchFallback.requiredUntil);
    expect(changelog).toContain(EVAOS_NATIVE_COMPANION_BOUNDARY.betaReleaseNote);

    for (const capability of [
      ...EVAOS_NATIVE_COMPANION_BOUNDARY.brokerCapabilities,
      ...EVAOS_NATIVE_COMPANION_BOUNDARY.nativeCompanionCapabilities,
    ]) {
      expect(doc, capability.id).toContain(`\`${capability.id}\``);
      expect(doc, capability.id).toContain(capability.owner);
      for (const proof of capability.proofRequired) {
        expect(doc, `${capability.id}:${proof}`).toContain(`\`${proof}\``);
      }
    }

    for (const scenario of EVAOS_NATIVE_COMPANION_STATUS_MATRIX) {
      expect(doc, scenario.key).toContain(`\`${scenario.key}\``);
      expect(doc, scenario.statusSource).toContain(`\`${scenario.statusSource}\``);
      expect(doc, scenario.handoff.owner).toContain(`\`${scenario.handoff.owner}\``);
    }
  });

  it('keeps callback/session policy aligned with beta identity and away from renderer secrets', () => {
    expect(EVAOS_NATIVE_COMPANION_BOUNDARY.callbackPolicy.acceptedProtocolScheme).toBe(
      EVAOS_BETA_IDENTITY.protocolScheme
    );
    expect(EVAOS_NATIVE_COMPANION_BOUNDARY.callbackPolicy.mainProcessValidatesScheme).toBe(true);
    expect(EVAOS_NATIVE_COMPANION_BOUNDARY.callbackPolicy.rendererReceivesCallbackSecrets).toBe(false);
    expect(EVAOS_NATIVE_COMPANION_BOUNDARY.callbackPolicy.sessionCacheOwner).toBe('evaos-broker');
  });

  it('defines the beta native-companion status and handoff matrix without making the shell authority', () => {
    expect(EVAOS_NATIVE_COMPANION_STATUS_MATRIX.map((scenario) => scenario.key)).toEqual([
      'not_installed',
      'not_paired',
      'permission_needed',
      'ready',
      'unavailable',
    ]);

    for (const scenario of EVAOS_NATIVE_COMPANION_STATUS_MATRIX) {
      expect(scenario.statusSource).toMatch(/^native-companion:/);
      expect(scenario.evidence.length).toBeGreaterThan(0);
      expect(scenario.handoff.target).not.toMatch(/token|secret|grant|session/i);
      expect(['evaos-native-companion', 'released-workbench-fallback']).toContain(scenario.handoff.owner);
    }

    const readyScenario = EVAOS_NATIVE_COMPANION_STATUS_MATRIX.find((scenario) => scenario.key === 'ready');
    expect(readyScenario?.handoff).toEqual({
      label: 'Open native companion',
      owner: 'evaos-native-companion',
      enabled: true,
      target: 'evaos-workbench-beta://native-companion/status',
    });

    for (const scenario of EVAOS_NATIVE_COMPANION_STATUS_MATRIX.filter((entry) => entry.key !== 'ready')) {
      expect(scenario.handoff.enabled, scenario.key).toBe(false);
    }
  });

  it('does not grant macOS automation or device-control entitlements to the beta shell', () => {
    const entitlements = readFileSync(resolve(repoRoot, 'entitlements.plist'), 'utf8');
    const forbiddenEntitlements = [
      'com.apple.security.automation.apple-events',
      'com.apple.security.device.bluetooth',
      'com.apple.security.device.camera',
      'com.apple.security.device.usb',
      'com.apple.security.personal-information.location',
      'com.apple.security.personal-information.photos-library',
    ];

    for (const key of forbiddenEntitlements) {
      expect(entitlements, key).not.toContain(key);
    }
  });

  it('allows only the microphone entitlement added for Milestone 2 voice input', () => {
    const entitlements = readFileSync(resolve(repoRoot, 'entitlements.plist'), 'utf8');

    expect(entitlements).toContain('com.apple.security.device.audio-input');
    expect(entitlements).not.toContain('com.apple.security.device.camera');
    expect(entitlements).not.toContain('com.apple.security.automation.apple-events');
  });
});
