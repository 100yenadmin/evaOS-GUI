/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GOLDEN_WORKBENCH_PARITY_MANIFEST,
  GOLDEN_WORKBENCH_PARITY_REQUIRED_IDS,
} from '@/renderer/evaos/__fixtures__/goldenWorkbenchParityManifest';
import { EVAOS_ROUTE_POLICIES, EVAOS_RUNTIME_CATALOG } from '@/renderer/evaos/evaosRuntimeVisibility';

const repoRoot = path.resolve(__dirname, '../../..');

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

  it('keeps old Workbench visible navigation labels and Home as an owned route', () => {
    const homeRow = GOLDEN_WORKBENCH_PARITY_MANIFEST.find((row) => row.id === 'home');

    expect(homeRow).toMatchObject({
      expectedRoute: '/home',
      sidebarSection: 'Home',
      sidebarLabel: 'Home',
    });
    expect(homeRow?.waiverIssue).toBeUndefined();
    expect(GOLDEN_WORKBENCH_PARITY_MANIFEST.find((row) => row.id === 'approvals')).toMatchObject({
      expectedRoute: '/approval-center',
      sidebarSection: 'Home',
      sidebarLabel: 'Approvals',
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
        expect(sidebarSectionSource, `${row.id}: sidebar navigate target`).toContain(
          `onNavigate('${row.expectedRoute}')`
        );
        expect(sidebarEntrySource, `${row.id}: sidebar label`).toContain(`const label = '${row.sidebarLabel}'`);
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
