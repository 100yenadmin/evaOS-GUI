import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertEvaosBetaLegacyLocalActionAllowed,
  EvaosBetaLegacyLocalActionError,
  isEvaosBetaBlockedLegacyLocalActionPath,
  isEvaosBetaLocalActionFenceEnabled,
} from '../../../packages/desktop/src/common/adapter/httpBridge';

describe('evaOS beta legacy local action fence', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to blocking shell launches and filesystem mutations in beta mode', () => {
    vi.stubEnv('AIONUI_EVAOS_BETA', undefined);
    vi.stubEnv('AIONUI_EVAOS_ALLOW_LEGACY_LOCAL_ACTIONS', undefined);

    expect(isEvaosBetaLocalActionFenceEnabled()).toBe(true);

    for (const path of [
      '/api/shell/open-file',
      '/api/shell/open-folder-with',
      '/api/fs/write',
      '/api/fs/remove',
      '/api/fs/rename',
      '/api/fs/copy',
      '/api/fs/upload',
      '/api/fs/watch/start',
      '/api/fs/office-watch/start',
      '/api/fs/snapshot/stage',
      '/api/fs/snapshot/discard',
      '/api/ppt-preview/start',
      '/api/word-preview/start',
      '/api/excel-preview/start',
    ]) {
      expect(isEvaosBetaBlockedLegacyLocalActionPath(path), path).toBe(true);
      expect(() => assertEvaosBetaLegacyLocalActionAllowed(path), path).toThrow(EvaosBetaLegacyLocalActionError);
    }
  });

  it('does not block read-only filesystem status paths in the static beta fence', () => {
    vi.stubEnv('AIONUI_EVAOS_BETA', undefined);
    vi.stubEnv('AIONUI_EVAOS_ALLOW_LEGACY_LOCAL_ACTIONS', undefined);

    for (const path of [
      '/api/fs/read',
      '/api/fs/metadata',
      '/api/fs/list',
      '/api/fs/browse?path=%2FUsers',
      '/api/fs/snapshot/compare',
      '/api/fs/snapshot/info',
    ]) {
      expect(isEvaosBetaBlockedLegacyLocalActionPath(path), path).toBe(false);
      expect(() => assertEvaosBetaLegacyLocalActionAllowed(path), path).not.toThrow();
    }
  });

  it('preserves non-beta and explicit diagnostic override behavior', () => {
    vi.stubEnv('AIONUI_EVAOS_BETA', '0');
    expect(isEvaosBetaBlockedLegacyLocalActionPath('/api/shell/open-file')).toBe(false);

    vi.stubEnv('AIONUI_EVAOS_BETA', '1');
    vi.stubEnv('AIONUI_EVAOS_ALLOW_LEGACY_LOCAL_ACTIONS', '1');
    expect(isEvaosBetaBlockedLegacyLocalActionPath('/api/shell/open-file')).toBe(false);
  });
});
