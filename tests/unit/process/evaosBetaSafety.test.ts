import { describe, expect, it } from 'vitest';
import {
  EVAOS_BETA_IDENTITY,
  getEvaosBetaBackendGithubRepo,
  getEvaosBetaUpdateRepo,
  isEvaosBetaBuild,
  isAllowedEvaosBetaUpdateRepo,
  shouldAllowRemoteWebUI,
  shouldAttachSentryDeviceId,
  shouldDisableAutoUpdate,
  shouldDisableSentry,
  shouldRegisterDefaultProtocolClient,
  shouldSendStartupLogReport,
} from '../../../packages/desktop/src/process/evaosBetaSafety';

describe('evaosBetaSafety', () => {
  it('keeps normal AionUi defaults outside evaOS beta mode', () => {
    const env = {
      AIONUI_EVAOS_BETA: '0',
      SENTRY_DSN: 'https://example@sentry.invalid/1',
    };

    expect(isEvaosBetaBuild(env)).toBe(false);
    expect(shouldDisableAutoUpdate(env)).toBe(false);
    expect(shouldDisableSentry(env)).toBe(false);
    expect(shouldAttachSentryDeviceId(env)).toBe(true);
    expect(shouldSendStartupLogReport(env)).toBe(true);
    expect(shouldAllowRemoteWebUI(env)).toBe(true);
  });

  it('fails closed for public beta without explicit beta update feed or telemetry opt-ins', () => {
    const env = {
      AIONUI_EVAOS_BETA: '1',
      SENTRY_DSN: 'https://example@sentry.invalid/1',
    };

    expect(isEvaosBetaBuild(env)).toBe(true);
    expect(getEvaosBetaUpdateRepo(env)).toBeUndefined();
    expect(shouldDisableAutoUpdate(env)).toBe(true);
    expect(shouldDisableSentry(env)).toBe(true);
    expect(shouldAttachSentryDeviceId(env)).toBe(false);
    expect(shouldSendStartupLogReport(env)).toBe(false);
    expect(shouldAllowRemoteWebUI(env)).toBe(false);
  });

  it('forces bundled backend GitHub access to the evaOS-owned repo in beta mode', () => {
    expect(getEvaosBetaBackendGithubRepo({ AIONUI_EVAOS_BETA: '1' })).toBe('100yenadmin/AionUi');
    expect(
      getEvaosBetaBackendGithubRepo({
        AIONUI_EVAOS_BETA: '1',
        AIONUI_EVAOS_BETA_UPDATE_REPO: 'iOfficeAI/AionUi',
      })
    ).toBe('100yenadmin/AionUi');
    expect(
      getEvaosBetaBackendGithubRepo({
        AIONUI_EVAOS_BETA: '1',
        AIONUI_EVAOS_BETA_UPDATE_REPO: '100yenadmin/AionUi',
      })
    ).toBe('100yenadmin/AionUi');
    expect(getEvaosBetaBackendGithubRepo({ AIONUI_EVAOS_BETA: '0' })).toBeUndefined();
  });

  it('defaults to public beta fail-closed behavior when the beta env is omitted', () => {
    const env = {
      SENTRY_DSN: 'https://example@sentry.invalid/1',
    };

    expect(isEvaosBetaBuild(env)).toBe(true);
    expect(getEvaosBetaUpdateRepo(env)).toBeUndefined();
    expect(shouldDisableAutoUpdate(env)).toBe(true);
    expect(shouldDisableSentry(env)).toBe(true);
    expect(shouldAttachSentryDeviceId(env)).toBe(false);
    expect(shouldSendStartupLogReport(env)).toBe(false);
    expect(shouldAllowRemoteWebUI(env)).toBe(false);
  });

  it('requires a beta-owned repo before beta auto-update can be enabled', () => {
    expect(
      shouldDisableAutoUpdate({
        AIONUI_EVAOS_BETA: '1',
        AIONUI_EVAOS_BETA_ALLOW_AUTO_UPDATE: '1',
      })
    ).toBe(true);

    expect(
      shouldDisableAutoUpdate({
        AIONUI_EVAOS_BETA: '1',
        AIONUI_EVAOS_BETA_ALLOW_AUTO_UPDATE: '1',
        AIONUI_EVAOS_BETA_UPDATE_REPO: 'iOfficeAI/AionUi',
      })
    ).toBe(true);

    expect(isAllowedEvaosBetaUpdateRepo('iOfficeAI/AionUi')).toBe(false);
    expect(isAllowedEvaosBetaUpdateRepo('100yenadmin/AionUi')).toBe(true);

    expect(
      shouldDisableAutoUpdate({
        AIONUI_EVAOS_BETA: '1',
        AIONUI_EVAOS_BETA_ALLOW_AUTO_UPDATE: '1',
        AIONUI_EVAOS_BETA_UPDATE_REPO: '100yenadmin/AionUi',
      })
    ).toBe(false);
  });

  it('locks the expected evaOS beta identity constants', () => {
    expect(EVAOS_BETA_IDENTITY).toEqual({
      productName: 'evaOS Workbench Beta',
      macAppBundleName: 'evaOS Workbench Beta.app',
      macExecutableName: 'evaOS Workbench Beta',
      executableName: 'EvaOSWorkbenchBeta',
      appId: 'com.evaos.workbench.beta',
      protocolScheme: 'evaos-workbench-beta',
      loopbackCallbackPath: '/auth/evaos-workbench-beta/callback',
    });
  });

  it('does not let raw dev Electron claim the evaOS beta URL scheme', () => {
    expect(
      shouldRegisterDefaultProtocolClient({
        protocolScheme: EVAOS_BETA_IDENTITY.protocolScheme,
        isPackaged: false,
        isDefaultApp: true,
      })
    ).toBe(false);
  });

  it('allows packaged beta builds and non-beta dev schemes to register protocol clients', () => {
    expect(
      shouldRegisterDefaultProtocolClient({
        protocolScheme: EVAOS_BETA_IDENTITY.protocolScheme,
        isPackaged: true,
        isDefaultApp: false,
      })
    ).toBe(true);

    expect(
      shouldRegisterDefaultProtocolClient({
        protocolScheme: 'aionui',
        isPackaged: false,
        isDefaultApp: true,
      })
    ).toBe(true);
  });
});
