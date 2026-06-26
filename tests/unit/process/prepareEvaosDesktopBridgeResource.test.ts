import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const bridgeResource = require('../../../scripts/prepareEvaosDesktopBridgeResource.js') as {
  bridgeWrapperScript: () => string;
  isMachOExecutable: (filePath: string) => boolean;
  sourceCandidates: () => string[];
};

describe('prepareEvaosDesktopBridgeResource', () => {
  it('isolates the packaged desktop bridge wrapper from ambient Python paths', () => {
    const wrapper = bridgeResource.bridgeWrapperScript();

    expect(wrapper).toContain('unset PYTHONHOME');
    expect(wrapper).toContain('unset PYTHONUSERBASE');
    expect(wrapper).toContain('export PYTHONNOUSERSITE=1');
    expect(wrapper).toContain('export PYTHONPATH="$BRIDGE_DIR/src"');
    expect(wrapper).toContain('CACHE_ROOT="$HOME/Library/Caches/evaos-desktop-bridge"');
    expect(wrapper).toContain('export PYTHONPYCACHEPREFIX="$CACHE_ROOT/pycache"');
    expect(wrapper).toContain('exec "$PYTHON_BIN" -S -m evaos_desktop_bridge.cli "$@"');
    expect(wrapper).not.toContain('${PYTHONPATH:+:$PYTHONPATH}');
    expect(wrapper).not.toContain('site-packages');
  });

  it('detects native Mach-O executables before release packaging trusts a control helper', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evaos-bridge-mach-o-'));
    const machO = join(dir, 'peekaboo');
    const script = join(dir, 'peekaboo.sh');
    try {
      writeFileSync(machO, Buffer.from('cffaedfe00000000', 'hex'));
      chmodSync(machO, 0o755);
      writeFileSync(script, '#!/bin/sh\nexit 0\n');
      chmodSync(script, 0o755);

      expect(bridgeResource.isMachOExecutable(machO)).toBe(true);
      expect(bridgeResource.isMachOExecutable(script)).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('does not use local mutable bridge checkouts when a source ref is pinned', () => {
    const previousSourceDir = process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_DIR;
    const previousSourceRef = process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_REF;
    const previousDisableDefault = process.env.EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES;

    try {
      delete process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_DIR;
      delete process.env.EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES;
      process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_REF = '8cdc02cee0f1e5d53ae430a942848c721762b00a';

      expect(bridgeResource.sourceCandidates()).toEqual([]);

      process.env.EVAOS_DESKTOP_BRIDGE_SOURCE_DIR = '/Volumes/LEXAR/repos/evaos-desktop-bridge';

      expect(bridgeResource.sourceCandidates()).toEqual(['/Volumes/LEXAR/repos/evaos-desktop-bridge']);
    } finally {
      restoreEnv('EVAOS_DESKTOP_BRIDGE_SOURCE_DIR', previousSourceDir);
      restoreEnv('EVAOS_DESKTOP_BRIDGE_SOURCE_REF', previousSourceRef);
      restoreEnv('EVAOS_DESKTOP_BRIDGE_DISABLE_DEFAULT_CANDIDATES', previousDisableDefault);
    }
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
