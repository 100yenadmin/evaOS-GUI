/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GOLDEN_WORKBENCH_PARITY_MANIFEST,
  GOLDEN_WORKBENCH_PARITY_REQUIRED_IDS,
} from '@/renderer/evaos/__fixtures__/goldenWorkbenchParityManifest';
import { EVAOS_ROUTE_POLICIES, EVAOS_RUNTIME_CATALOG } from '@/renderer/evaos/evaosRuntimeVisibility';

const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const settledShellSmokePlan = require('../../../scripts/evaosSettledShellSmokePlan.js') as {
  SETTLED_SHELL_SCREENSHOT_PLAN: Array<{
    id: string;
    route: string;
    screenshot: string;
    waitSelectors: string[];
  }>;
};
const installedProofManifest = require('../../../scripts/evaosInstalledProofManifest.js') as {
  GOLDEN_WORKBENCH_INSTALLED_PROOF_MANIFEST: Array<{
    manifestRowId: string;
    id: string;
    route: string | undefined;
    screenshot: string;
    artifactName: string;
    closeoutState: string;
    settledMarkers: string[];
  }>;
};

const OLD_SOURCE_FILES = [
  'RuntimeDefinition.swift',
  'SidebarView.swift',
  'ContentView.swift',
  'RuntimeDetailView.swift',
  'RuntimeWebView.swift',
  'RuntimeSessionBrokerClient.swift',
  'DesktopSession.swift',
  'BridgePanelView.swift',
  'AppBrand.swift',
];

const EXPECTED_MANIFEST_IDS = [
  'home',
  'approvals',
  'design-workspace',
  'business-browser',
  'creative-studio',
  'connected-apps',
  'people-access',
  'company-brain',
  'evaos-dashboard',
  'hermes-dashboard',
  'mission-control',
  'terminal',
  'native-companion',
  'footer',
  'branding',
];
const ACCEPTED_CLOSEOUT_STATES = ['loaded', 'denied', 'repair', 'waived'];

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('goldenWorkbenchParityManifest', () => {
  it('pins the required Workbench parity rows from issue #183', () => {
    expect(GOLDEN_WORKBENCH_PARITY_REQUIRED_IDS).toEqual(EXPECTED_MANIFEST_IDS);
    expect(GOLDEN_WORKBENCH_PARITY_MANIFEST.map((row) => row.id)).toEqual(EXPECTED_MANIFEST_IDS);
  });

  it('requires every old Workbench surface to have source refs plus coverage or an explicit waiver', () => {
    for (const row of GOLDEN_WORKBENCH_PARITY_MANIFEST) {
      expect(row.oldSourceRefs.length, `${row.id}: oldSourceRefs`).toBeGreaterThan(0);
      expect(Boolean(row.expectedRoute || row.oldSurface), `${row.id}: expectedRoute or oldSurface`).toBe(true);
      if (row.expectedRoute || row.sidebarLabel) {
        expect(row.sidebarSection, `${row.id}: sidebarSection`).toBeTruthy();
      }
      expect(
        row.oldSourceRefs.some((ref) => OLD_SOURCE_FILES.some((fileName) => ref.includes(fileName))),
        `${row.id}: old source ref must point at the release baseline files`
      ).toBe(true);
      expect(row.requiredRole, `${row.id}: requiredRole`).toBeTruthy();
      expect(row.statusRequirement, `${row.id}: statusRequirement`).toBeTruthy();
      expect(Boolean(row.testId || row.waiverIssue), `${row.id}: testId or waiverIssue`).toBe(true);

      if (row.waiverIssue) {
        expect(row.waiverIssue, `${row.id}: waiverIssue`).toMatch(
          /^https:\/\/github\.com\/100yenadmin\/evaOS-GUI\/issues\/\d+$/
        );
      }
    }
  });

  it('requires every manifest row to carry a settled exact-candidate proof target or explicit waiver', () => {
    const screenshotPlanById = new Map(
      settledShellSmokePlan.SETTLED_SHELL_SCREENSHOT_PLAN.map((entry) => [entry.id, entry])
    );

    for (const row of GOLDEN_WORKBENCH_PARITY_MANIFEST) {
      expect(row.proofTarget, `${row.id}: proofTarget`).toBeTruthy();
      expect(ACCEPTED_CLOSEOUT_STATES, `${row.id}: accepted closeout state`).toContain(row.proofTarget?.closeoutState);

      if (row.proofTarget?.closeoutState === 'waived') {
        expect(row.waiverIssue, `${row.id}: waiver requires issue`).toMatch(
          /^https:\/\/github\.com\/100yenadmin\/evaOS-GUI\/issues\/\d+$/
        );
        continue;
      }

      expect(row.waiverIssue, `${row.id}: non-waived row should not carry waiverIssue`).toBeUndefined();
      expect(row.proofTarget?.planId, `${row.id}: proof plan id`).toBeTruthy();
      expect(row.proofTarget?.screenshot, `${row.id}: proof screenshot`).toMatch(/\.png$/);
      expect(row.proofTarget?.artifactName, `${row.id}: proof artifact`).toBe(
        `screenshots/${row.proofTarget?.screenshot}`
      );
      expect(row.proofTarget?.settledMarkers.length, `${row.id}: settled markers`).toBeGreaterThan(0);

      const planEntry = screenshotPlanById.get(row.proofTarget!.planId);
      expect(planEntry, `${row.id}: screenshot plan entry`).toBeTruthy();
      expect(planEntry?.screenshot, `${row.id}: screenshot name`).toBe(row.proofTarget?.screenshot);
      if (row.expectedRoute) {
        expect(planEntry?.route, `${row.id}: proof route`).toBe(row.expectedRoute);
      }
    }
  });

  it('keeps the Node installed-app proof manifest aligned to golden parity rows', () => {
    const screenshotPlanById = new Map(
      settledShellSmokePlan.SETTLED_SHELL_SCREENSHOT_PLAN.map((entry) => [entry.id, entry])
    );

    expect(installedProofManifest.GOLDEN_WORKBENCH_INSTALLED_PROOF_MANIFEST).toEqual(
      GOLDEN_WORKBENCH_PARITY_MANIFEST.map((row) => ({
        manifestRowId: row.id,
        id: row.proofTarget.planId,
        route: row.expectedRoute || screenshotPlanById.get(row.proofTarget.planId)?.route,
        screenshot: row.proofTarget.screenshot,
        artifactName: row.proofTarget.artifactName,
        closeoutState: row.proofTarget.closeoutState,
        settledMarkers: [...row.proofTarget.settledMarkers],
      }))
    );
  });

  it('tracks hidden RC routes separately from visible Workbench navigation labels', () => {
    const homeRow = GOLDEN_WORKBENCH_PARITY_MANIFEST.find((row) => row.id === 'home');

    expect(homeRow).toMatchObject({
      expectedRoute: '/home',
      sidebarSection: 'Home',
      sidebarLabel: 'Home',
      waiverIssue: 'https://github.com/100yenadmin/evaOS-GUI/issues/275',
      proofTarget: expect.objectContaining({ closeoutState: 'waived' }),
    });
    expect(GOLDEN_WORKBENCH_PARITY_MANIFEST.find((row) => row.id === 'approvals')).toMatchObject({
      expectedRoute: '/approval-center',
      sidebarSection: 'Home',
      sidebarLabel: 'Approvals',
      waiverIssue: 'https://github.com/100yenadmin/evaOS-GUI/issues/275',
      proofTarget: expect.objectContaining({ closeoutState: 'waived' }),
    });
    expect(GOLDEN_WORKBENCH_PARITY_MANIFEST.find((row) => row.id === 'business-browser')).toMatchObject({
      expectedRoute: '/business-browser',
      sidebarSection: 'Workspaces',
      sidebarLabel: 'Shared Browser',
    });
    expect(GOLDEN_WORKBENCH_PARITY_MANIFEST.find((row) => row.id === 'people-access')).toMatchObject({
      expectedRoute: '/people-access',
      sidebarSection: 'Business Admin',
      sidebarLabel: 'People & Access',
    });
  });

  it('maps every requested old Workbench baseline file at least once', () => {
    const allSourceRefs = GOLDEN_WORKBENCH_PARITY_MANIFEST.flatMap((row) => row.oldSourceRefs).join('\n');

    for (const fileName of OLD_SOURCE_FILES) {
      expect(allSourceRefs, fileName).toContain(fileName);
    }
  });

  it('keeps implemented manifest routes aligned with discoverable AionUi route and sidebar policy', () => {
    const evaosRoutesSource = readSource('packages/desktop/src/renderer/evaos/evaosRoutes.tsx');
    const sidebarSectionSource = readSource('packages/desktop/src/renderer/evaos/EvaosSidebarSection.tsx');
    const siderSource = readSource('packages/desktop/src/renderer/components/layout/Sider/index.tsx');
    const sidebarNavigationSource = `${sidebarSectionSource}\n${siderSource}`;
    const sidebarEntrySource = fs
      .readdirSync(path.join(repoRoot, 'packages/desktop/src/renderer/evaos/sidebar'))
      .filter((fileName) => fileName.endsWith('.tsx'))
      .map((fileName) => readSource(`packages/desktop/src/renderer/evaos/sidebar/${fileName}`))
      .join('\n');
    const discoverableRoutePaths = new Set([
      ...EVAOS_ROUTE_POLICIES.map((policy) => policy.routePath),
      ...EVAOS_RUNTIME_CATALOG.map((runtime) => runtime.routePath),
    ]);

    const implementedRouteRows = GOLDEN_WORKBENCH_PARITY_MANIFEST.filter(
      (row) => row.expectedRoute && row.testId && !row.waiverIssue
    );

    for (const row of implementedRouteRows) {
      expect(discoverableRoutePaths.has(row.expectedRoute!), `${row.id}: route policy`).toBe(true);
      expect(evaosRoutesSource, `${row.id}: renderer route`).toContain(`path='${row.expectedRoute}'`);

      if (row.sidebarLabel) {
        const expectedNavigationSnippet =
          row.id === 'terminal' ? `handleEvaosNavigate('${row.expectedRoute}')` : `onNavigate('${row.expectedRoute}')`;
        expect(sidebarNavigationSource, `${row.id}: sidebar navigate target`).toContain(expectedNavigationSnippet);
        const canonicalLabel = `const label = '${row.sidebarLabel}'`;
        const nestedRcLabel = `const label = '- ${row.sidebarLabel}'`;
        expect(
          sidebarEntrySource.includes(canonicalLabel) || sidebarEntrySource.includes(nestedRcLabel),
          `${row.id}: sidebar label`
        ).toBe(true);
      }
    }
  });

  it('tracks released Workbench runtime keys and external surfaces without silently dropping rows', () => {
    const runtimeKeys = new Set(EVAOS_RUNTIME_CATALOG.map((runtime) => runtime.key));

    for (const row of GOLDEN_WORKBENCH_PARITY_MANIFEST) {
      if (row.runtimeKey) {
        expect(runtimeKeys.has(row.runtimeKey), `${row.id}: runtimeKey`).toBe(true);
      }
    }

    expect(GOLDEN_WORKBENCH_PARITY_MANIFEST.find((row) => row.id === 'creative-studio')).toMatchObject({
      runtimeKey: 'creative_studio',
      oldSurface: 'https://www.comfy.org/cloud',
      statusRequirement: 'external-runtime-route-plus-sidebar-entry',
    });
    expect(EVAOS_RUNTIME_CATALOG.find((runtime) => runtime.key === 'creative_studio')).toMatchObject({
      externalUrl: 'https://www.comfy.org/cloud',
      routePath: '/creative-studio',
    });
  });
});
