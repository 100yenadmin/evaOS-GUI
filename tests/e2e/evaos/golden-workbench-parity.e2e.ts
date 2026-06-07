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
    'Golden Workbench exact-candidate e2e is opt-in; unit manifest gate enforces coverage and proof targets.'
  );

  for (const row of GOLDEN_WORKBENCH_PARITY_MANIFEST.filter(
    (manifestRow) =>
      manifestRow.expectedRoute && manifestRow.testId && !manifestRow.waiverIssue && manifestRow.proofTarget
  )) {
    test(`captures settled proof for ${row.id} at ${row.expectedRoute}`, async ({ page }, testInfo) => {
      await page.evaluate((routePath) => window.location.assign(`#${routePath}`), row.expectedRoute);
      await page.waitForFunction((routePath) => window.location.hash === `#${routePath}`, row.expectedRoute);

      await Promise.all(
        row.proofTarget.settledMarkers.map((marker) =>
          expect(page.locator('body'), `${row.id}: settled marker ${marker}`).toContainText(marker, {
            timeout: 20_000,
          })
        )
      );

      const screenshot = await page.screenshot({ fullPage: true });
      await testInfo.attach(row.proofTarget.screenshot, {
        body: screenshot,
        contentType: 'image/png',
      });
    });
  }
});
