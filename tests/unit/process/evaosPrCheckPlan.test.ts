import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const prCheckPlan = require('../../../scripts/evaosPrCheckPlan.js') as {
  planPrChecks: (
    changedFiles: string[],
    options?: { runWindowsChecks?: boolean }
  ) => {
    runWindowsChecks: boolean;
    reasons: string[];
  };
};

describe('evaOS PR check plan', () => {
  it('skips Windows checks for docs, canary scripts, and renderer-only beta shell routes', () => {
    const plan = prCheckPlan.planPrChecks([
      'docs/evaos/95-confidence-decision-packet.md',
      'scripts/evaosBusinessBrowserLiveCanary.js',
      'tests/unit/evaos/evaosBusinessBrowserLiveCanary.test.ts',
      'packages/desktop/src/renderer/pages/mission-control/index.tsx',
      'packages/desktop/src/renderer/components/layout/Router.tsx',
    ]);

    expect(plan.runWindowsChecks).toBe(false);
    expect(plan.reasons).toEqual([]);
  });

  it('runs Windows checks for Windows packaging and installer surfaces', () => {
    const plan = prCheckPlan.planPrChecks(['packages/desktop/electron-builder.yml', '.github/workflows/pr-checks.yml']);

    expect(plan.runWindowsChecks).toBe(true);
    expect(plan.reasons).toContain('packages/desktop/electron-builder.yml');
    expect(plan.reasons).toContain('.github/workflows/pr-checks.yml');
  });

  it('keeps macOS beta packaging release-safety scripts out of the Windows build gate', () => {
    const plan = prCheckPlan.planPrChecks([
      '.github/workflows/evaos-beta-rc-canary.yml',
      'docs/evaos/public-beta-packaging-rollback.md',
      'scripts/evaosBetaReleaseGate.js',
      'scripts/prepare-release-assets.sh',
      'scripts/verify-release-assets.sh',
    ]);

    expect(plan.runWindowsChecks).toBe(false);
    expect(plan.reasons).toEqual([]);
  });

  it('runs Windows checks for cross-platform runtime process and dependency surfaces', () => {
    const plan = prCheckPlan.planPrChecks([
      'package.json',
      'bun.lock',
      'packages/desktop/src/process/services/evaosBrokerSession.ts',
      'packages/desktop/src/preload/main.ts',
    ]);

    expect(plan.runWindowsChecks).toBe(true);
    expect(plan.reasons).toContain('package.json');
    expect(plan.reasons).toContain('bun.lock');
    expect(plan.reasons).toContain('packages/desktop/src/process/services/evaosBrokerSession.ts');
    expect(plan.reasons).toContain('packages/desktop/src/preload/main.ts');
  });

  it('allows manual workflow dispatch to force Windows checks', () => {
    const plan = prCheckPlan.planPrChecks(['docs/evaos/readme.md'], { runWindowsChecks: true });

    expect(plan.runWindowsChecks).toBe(true);
    expect(plan.reasons).toContain('manual override');
  });
});
