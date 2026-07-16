/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const agentToolsRoot = join(process.cwd(), 'resources', 'evaos-beta', 'bridge', 'agent-tools');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    return [relative(agentToolsRoot, absolutePath)];
  });
}

describe('evaOS agent-tools source provenance', () => {
  it('binds the exact vendored file inventory and bytes', () => {
    const sourceManifest = JSON.parse(readFileSync(join(agentToolsRoot, 'SOURCE.json'), 'utf8')) as {
      sourceDigests: Record<string, string>;
    };
    const declaredPaths = Object.keys(sourceManifest.sourceDigests).toSorted();
    const actualPaths = sourceFiles(agentToolsRoot)
      .filter((path) => path !== 'SOURCE.json')
      .toSorted();

    expect(declaredPaths).toEqual(actualPaths);
    for (const path of declaredPaths) {
      const digest = createHash('sha256')
        .update(readFileSync(join(agentToolsRoot, path)))
        .digest('hex');
      expect(sourceManifest.sourceDigests[path]).toBe(`sha256:${digest}`);
    }
  });
});
