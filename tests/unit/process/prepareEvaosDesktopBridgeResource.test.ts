import { describe, expect, it } from 'vitest';

const bridgeResource = require('../../../scripts/prepareEvaosDesktopBridgeResource.js') as {
  bridgeWrapperScript: () => string;
  sourceCandidates: () => string[];
};

describe('prepareEvaosDesktopBridgeResource', () => {
  it('isolates the packaged desktop bridge wrapper from ambient Python paths', () => {
    const wrapper = bridgeResource.bridgeWrapperScript();

    expect(wrapper).toContain('unset PYTHONHOME');
    expect(wrapper).toContain('unset PYTHONUSERBASE');
    expect(wrapper).toContain('export PYTHONNOUSERSITE=1');
    expect(wrapper).toContain('export PYTHONPATH="$BRIDGE_DIR/src"');
    expect(wrapper).toContain('exec "$PYTHON_BIN" -S -m evaos_desktop_bridge.cli "$@"');
    expect(wrapper).not.toContain('${PYTHONPATH:+:$PYTHONPATH}');
    expect(wrapper).not.toContain('site-packages');
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
