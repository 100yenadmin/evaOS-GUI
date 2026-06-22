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

  it('fails closed for unpackaged public beta without telemetry opt-ins', () => {
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

  it('enables packaged beta updates from the evaOS-owned feed by default', () => {
    const env = {
      AIONUI_EVAOS_BETA: '1',
    };

    expect(getEvaosBetaUpdateRepo(env, { isPackaged: true })).toBe('100yenadmin/evaOS-GUI');
    expect(shouldDisableAutoUpdate(env, { isPackaged: true })).toBe(false);
    expect(shouldDisableAutoUpdate(env, { isPackaged: false })).toBe(true);
  });

  it('forces bundled backend GitHub access to the evaOS-owned repo in beta mode', () => {
    expect(getEvaosBetaBackendGithubRepo({ AIONUI_EVAOS_BETA: '1' })).toBe('100yenadmin/evaOS-GUI');
    expect(
      getEvaosBetaBackendGithubRepo({
        AIONUI_EVAOS_BETA: '1',
        AIONUI_EVAOS_BETA_UPDATE_REPO: 'iOfficeAI/AionUi',
      })
    ).toBe('100yenadmin/evaOS-GUI');
    expect(
      getEvaosBetaBackendGithubRepo({
        AIONUI_EVAOS_BETA: '1',
        AIONUI_EVAOS_BETA_UPDATE_REPO: '100yenadmin/evaOS-GUI',
      })
    ).toBe('100yenadmin/evaOS-GUI');
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

  it('requires a beta-owned repo and packaged runtime before beta auto-update can be enabled', () => {
    expect(
      shouldDisableAutoUpdate(
        {
          AIONUI_EVAOS_BETA: '1',
          AIONUI_EVAOS_BETA_ALLOW_AUTO_UPDATE: '1',
        },
        { isPackaged: true }
      )
    ).toBe(false);

    expect(
      shouldDisableAutoUpdate(
        {
          AIONUI_EVAOS_BETA: '1',
          AIONUI_EVAOS_BETA_ALLOW_AUTO_UPDATE: '1',
        },
        { isPackaged: false }
      )
    ).toBe(true);

    expect(
      shouldDisableAutoUpdate(
        {
          AIONUI_EVAOS_BETA: '1',
          AIONUI_EVAOS_BETA_ALLOW_AUTO_UPDATE: '1',
          AIONUI_EVAOS_BETA_UPDATE_REPO: 'iOfficeAI/AionUi',
        },
        { isPackaged: true }
      )
    ).toBe(true);

    expect(isAllowedEvaosBetaUpdateRepo('iOfficeAI/AionUi')).toBe(false);
    expect(isAllowedEvaosBetaUpdateRepo('100yenadmin/evaOS-GUI')).toBe(true);

    expect(
      shouldDisableAutoUpdate(
        {
          AIONUI_EVAOS_BETA: '1',
          AIONUI_EVAOS_BETA_ALLOW_AUTO_UPDATE: '1',
          AIONUI_EVAOS_BETA_UPDATE_REPO: '100yenadmin/evaOS-GUI',
        },
        { isPackaged: true }
      )
    ).toBe(false);

    expect(
      shouldDisableAutoUpdate(
        {
          AIONUI_EVAOS_BETA: '1',
          AIONUI_EVAOS_BETA_ALLOW_AUTO_UPDATE: '0',
        },
        { isPackaged: true }
      )
    ).toBe(true);

    expect(
      shouldDisableAutoUpdate(
        {
          AIONUI_EVAOS_BETA: '1',
          AIONUI_DISABLE_AUTO_UPDATE: '1',
        },
        { isPackaged: true }
      )
    ).toBe(true);
  });

  it('locks the expected evaOS Workbench identity constants', () => {
    expect(EVAOS_BETA_IDENTITY).toEqual({
      productName: 'evaOS Workbench',
      macAppBundleName: 'evaOS Workbench.app',
      macExecutableName: 'evaOS Workbench',
      executableName: 'EvaOSWorkbench',
      appId: 'com.evaos.workbench',
      protocolScheme: 'evaos-workbench',
      loopbackCallbackPath: '/auth/evaos-workbench/callback',
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
