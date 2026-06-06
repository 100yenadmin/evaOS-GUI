import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingDeepLinkPayload,
  getPendingDeepLinkPayload,
  handleDeepLinkUrl,
  isRendererSecretDeepLinkParam,
  parseDeepLinkUrl,
  setDeepLinkDesktopSessionImporterForTest,
} from '../../../packages/desktop/src/process/utils/deepLink';

const encodeData = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

describe('evaOS beta deep links', () => {
  beforeEach(() => {
    clearPendingDeepLinkPayload();
    setDeepLinkDesktopSessionImporterForTest(null);
  });

  it('strips secret-bearing query params before renderer delivery', () => {
    const payload = parseDeepLinkUrl(
      'evaos-workbench-beta://add-provider?base_url=https%3A%2F%2Fprovider.example&api_key=sk-live&key=raw-key&desktop_session=eds_callback_session_secret_for_test&name=Provider&platform=new-api'
    );

    expect(payload).toEqual({
      action: 'add-provider',
      params: {
        base_url: 'https://provider.example',
        name: 'Provider',
        platform: 'new-api',
      },
    });
  });

  it('strips secret-bearing base64 data params before renderer delivery', () => {
    const data = encodeData({
      base_url: 'https://provider.example',
      name: 'Provider',
      key: 'raw-key',
      access_token: 'access-token',
      client_secret: 'client-secret',
      code: 'oauth-code',
    });

    const payload = parseDeepLinkUrl(`evaos-workbench-beta://provider/add?data=${encodeURIComponent(data)}`);

    expect(payload).toEqual({
      action: 'provider/add',
      params: {
        base_url: 'https://provider.example',
        name: 'Provider',
      },
    });
  });

  it('imports desktop-session callbacks in main and queues only a safe renderer refresh event', () => {
    const importer = vi.fn(() => true);
    setDeepLinkDesktopSessionImporterForTest(importer);
    clearPendingDeepLinkPayload();

    handleDeepLinkUrl(
      'evaos-workbench-beta://auth/callback?desktop_session=eds_callback_session_secret_for_test&desktop_session_expires_at=2026-06-03T16%3A00%3A00.000Z&email=admin%40100yen.org'
    );

    expect(importer).toHaveBeenCalledTimes(1);
    expect(importer.mock.calls[0][0]).toContain('desktop_session=eds_callback_session_secret_for_test');
    expect(getPendingDeepLinkPayload()).toEqual({
      action: 'evaos-auth/session-imported',
      params: { source: 'protocol' },
    });
    expect(JSON.stringify(getPendingDeepLinkPayload())).not.toMatch(/eds_|desktop_session|access_token|Bearer/i);
  });

  it('queues only sanitized payloads before the window is ready', () => {
    clearPendingDeepLinkPayload();

    handleDeepLinkUrl('evaos-workbench-beta://add-provider?base_url=https%3A%2F%2Fprovider.example&api_key=sk-live');

    expect(getPendingDeepLinkPayload()).toEqual({
      action: 'add-provider',
      params: {
        base_url: 'https://provider.example',
      },
    });
  });

  it('classifies callback and provider secret names as renderer-forbidden', () => {
    expect(isRendererSecretDeepLinkParam('api_key')).toBe(true);
    expect(isRendererSecretDeepLinkParam('access-token')).toBe(true);
    expect(isRendererSecretDeepLinkParam('client_secret')).toBe(true);
    expect(isRendererSecretDeepLinkParam('desktop_session')).toBe(true);
    expect(isRendererSecretDeepLinkParam('oauth_token')).toBe(true);
    expect(isRendererSecretDeepLinkParam('provider-grant-handle')).toBe(true);
    expect(isRendererSecretDeepLinkParam('route')).toBe(false);
    expect(isRendererSecretDeepLinkParam('base_url')).toBe(false);
  });
});
