/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('evaOS controlled beta visible branding guard', () => {
  it('keeps rendered release and support surfaces off legacy AionUi URLs', () => {
    const aboutSource = readSource(
      'packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx'
    );
    const rendererMainSource = readSource('packages/desktop/src/renderer/main.tsx');
    const electronBuilderConfig = readSource('packages/desktop/electron-builder.yml');
    const desktopPackage = JSON.parse(readSource('packages/desktop/package.json')) as { description?: string };

    expect(aboutSource).not.toContain('https://github.com/100yenadmin/AionUi');
    expect(rendererMainSource).not.toContain('https://github.com/100yenadmin/AionUi/releases');
    expect(electronBuilderConfig).not.toMatch(/repo:\s*AionUi\b/);
    expect(desktopPackage.description).not.toMatch(/AionUi/i);
  });
});
