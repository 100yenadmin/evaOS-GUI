import { describe, expect, it } from 'vitest';
import {
  clearPendingDeepLinkPayload,
  getPendingDeepLinkPayload,
  handleDeepLinkUrl,
  isRendererSecretDeepLinkParam,
  parseDeepLinkUrl,
} from '../../../packages/desktop/src/process/utils/deepLink';

const encodeData = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

describe('evaOS beta deep links', () => {
  it('strips secret-bearing query params before renderer delivery', () => {
    const payload = parseDeepLinkUrl(
      'evaos-workbench-beta://add-provider?base_url=https%3A%2F%2Fprovider.example&api_key=sk-live&key=raw-key&name=Provider&platform=new-api'
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
    expect(isRendererSecretDeepLinkParam('oauth_token')).toBe(true);
    expect(isRendererSecretDeepLinkParam('route')).toBe(false);
    expect(isRendererSecretDeepLinkParam('base_url')).toBe(false);
  });
});
