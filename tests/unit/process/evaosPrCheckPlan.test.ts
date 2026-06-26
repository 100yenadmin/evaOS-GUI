import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const plannerScript = require.resolve('../../../scripts/evaosPrCheckPlan.js');
const prCheckPlan = require('../../../scripts/evaosPrCheckPlan.js') as {
  planPrChecks: (
    changedFiles: string[],
    options?: { runWindowsChecks?: boolean; forcePackageSmoke?: boolean }
  ) => {
    runWindowsChecks: boolean;
    reasons: string[];
    runPackageSmoke: boolean;
    packageSmokeReasons: string[];
  };
};

describe('evaOS PR check plan', () => {
  it('does not run package smoke for renderer-only changes', () => {
    const plan = prCheckPlan.planPrChecks([
      'packages/desktop/src/renderer/pages/runtime-dashboard/RuntimeDashboardPage.tsx',
    ]);

    expect(plan.runPackageSmoke).toBe(false);
    expect(plan.packageSmokeReasons).toEqual([]);
  });

  it('does not run package smoke for docs or non-release workflow changes', () => {
    const plan = prCheckPlan.planPrChecks(['docs/evaos/readme.md', '.github/workflows/labeler.yml']);

    expect(plan.runPackageSmoke).toBe(false);
    expect(plan.packageSmokeReasons).toEqual([]);
  });

  it('does not run package smoke for shared type-only changes', () => {
    const plan = prCheckPlan.planPrChecks(['packages/desktop/src/common/types/runtime.ts']);

    expect(plan.runPackageSmoke).toBe(false);
    expect(plan.packageSmokeReasons).toEqual([]);
  });

  it('does not run package smoke for ordinary process-only utility changes', () => {
    const plan = prCheckPlan.planPrChecks(['packages/desktop/src/process/utils/initBridge.ts']);

    expect(plan.runPackageSmoke).toBe(false);
    expect(plan.packageSmokeReasons).toEqual([]);
  });

  it('runs package smoke for package and resource surfaces', () => {
    const plan = prCheckPlan.planPrChecks(['packages/desktop/electron-builder.yml', 'scripts/build-with-builder.js']);

    expect(plan.runPackageSmoke).toBe(true);
    expect(plan.packageSmokeReasons.length).toBeGreaterThan(0);
  });

  it('runs package smoke for release workflow and runtime surfaces', () => {
    const plan = prCheckPlan.planPrChecks([
      '.github/workflows/workbench-functional-smoke.yml',
      'packages/desktop/src/process/backend/binaryResolver.ts',
      'packages/desktop/src/process/startup/backendInstallDiagnostics.ts',
    ]);

    expect(plan.runPackageSmoke).toBe(true);
    expect(plan.packageSmokeReasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('.github/workflows/workbench-functional-smoke.yml'),
        expect.stringContaining('packages/desktop/src/process/backend/binaryResolver.ts'),
        expect.stringContaining('packages/desktop/src/process/startup/backendInstallDiagnostics.ts'),
      ])
    );
  });

  it('fails closed for unknown paths', () => {
    const plan = prCheckPlan.planPrChecks(['tools/new-packaging-helper.ts']);

    expect(plan.runPackageSmoke).toBe(true);
    expect(plan.packageSmokeReasons[0]).toContain('unknown path');
  });

  it('does not rewrite changed paths into safe-skip paths', () => {
    const plan = prCheckPlan.planPrChecks([' docs/evaos/readme.md', './docs/evaos/readme.md']);

    expect(plan.runPackageSmoke).toBe(true);
    expect(plan.packageSmokeReasons).toEqual([
      ' docs/evaos/readme.md: unknown path, package smoke fails closed',
      './docs/evaos/readme.md: unknown path, package smoke fails closed',
    ]);
  });

  it('allows manual workflow dispatch to force package smoke', () => {
    const plan = prCheckPlan.planPrChecks(['docs/evaos/readme.md'], { forcePackageSmoke: true });

    expect(plan.runPackageSmoke).toBe(true);
    expect(plan.packageSmokeReasons).toContain('manual override');
  });

  it('keeps Windows checks off by default for the macOS-first beta lane', () => {
    const plan = prCheckPlan.planPrChecks(['packages/desktop/electron-builder.yml']);

    expect(plan.runWindowsChecks).toBe(false);
    expect(plan.reasons).toEqual([]);
  });

  it('allows manual workflow dispatch to force Windows checks', () => {
    const plan = prCheckPlan.planPrChecks(['docs/evaos/readme.md'], { runWindowsChecks: true });

    expect(plan.runWindowsChecks).toBe(true);
    expect(plan.reasons).toContain('manual override');
  });

  it('prints the GitHub Actions output contract from the CLI', () => {
    const output = execFileSync(process.execPath, [plannerScript, 'github-output'], {
      encoding: 'utf8',
      input: 'packages/desktop/electron-builder.yml\n',
    });

    expect(output.trim().split('\n')).toEqual([
      'run_windows_checks=false',
      'windows_reasons_json=[]',
      'run_package_smoke=true',
      'package_smoke_reasons_json=["packages/desktop/electron-builder.yml: packaged-app smoke surface"]',
    ]);
  });
});
