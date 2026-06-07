/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, test } from '../fixtures';
import { GOLDEN_WORKBENCH_PARITY_MANIFEST } from '../../../packages/desktop/src/renderer/evaos/__fixtures__/goldenWorkbenchParityManifest';

test.describe('golden Workbench parity smoke', () => {
  test.skip(
    process.env.EVAOS_GOLDEN_WORKBENCH_E2E !== '1',
    'Live golden Workbench app harness is not ready; unit manifest gate enforces coverage and explicit waivers.'
  );

  for (const row of GOLDEN_WORKBENCH_PARITY_MANIFEST.filter(
    (manifestRow) => manifestRow.expectedRoute && manifestRow.testId && !manifestRow.waiverIssue
  )) {
    test(`smokes ${row.id} at ${row.expectedRoute}`, async ({ page }) => {
      await page.evaluate((routePath) => window.location.assign(`#${routePath}`), row.expectedRoute);
      await page.waitForFunction((routePath) => window.location.hash === `#${routePath}`, row.expectedRoute);
      await expect(page.locator('body')).toContainText(row.sidebarLabel ?? row.oldSurface ?? row.id);
    });
  }
});
