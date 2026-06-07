/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEvaosLoadedUiFixture } from './fixtures/loadedUiFixture';

const repoRoot = path.resolve(__dirname, '../../..');

const RUNTIME_RENDERER_VIEW_INTERFACES = [
  'IEvaosSafeUrlSummary',
  'IEvaosRuntimeStatusView',
  'IEvaosBusinessBrowserView',
];

const FORBIDDEN_RENDERER_FIELD_NAMES = [
  /^accessToken$/i,
  /^refreshToken$/i,
  /^idToken$/i,
  /^desktopSession$/i,
  /^desktopSessionToken$/i,
  /^credential$/i,
  /^credentials$/i,
  /^rawUrl$/i,
  /^rawURL$/i,
  /^currentUrl$/i,
  /^launchUrl$/i,
  /^authUrl$/i,
  /^callbackUrl$/i,
  /^providerGrant$/i,
  /^grantHandle$/i,
  /^authorization$/i,
  /^bearer$/i,
];

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractInterfaceBody(source: string, interfaceName: string): string {
  const start = source.indexOf(`interface ${interfaceName}`);
  if (start === -1) {
    throw new Error(`Missing interface ${interfaceName}`);
  }

  const openBrace = source.indexOf('{', start);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace + 1, index);
    }
  }

  throw new Error(`Could not parse interface ${interfaceName}`);
}

function interfaceFieldNames(interfaceBody: string): string[] {
  return Array.from(interfaceBody.matchAll(/^\s*([A-Za-z_$][\w$]*)\??:/gm), (match) => match[1]);
}

function collectObjectKeyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectObjectKeyPaths(item, `${prefix}[${index}]`));
  }

  if (!value || typeof value !== 'object') return [];

  const keyPaths: string[] = [];
  for (const [key, nestedValue] of Object.entries(value)) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    keyPaths.push(keyPath);
    keyPaths.push(...collectObjectKeyPaths(nestedValue, keyPath));
  }
  return keyPaths;
}

function forbiddenFieldViolations(fieldNames: string[]): string[] {
  return fieldNames.filter((fieldName) => FORBIDDEN_RENDERER_FIELD_NAMES.some((pattern) => pattern.test(fieldName)));
}

describe('runtimeSecretBoundaryGolden', () => {
  it('keeps renderer runtime view types free of token, credential, and raw URL fields', () => {
    const bridgeTypesSource = readSource('packages/desktop/src/common/evaos/bridgeTypes.ts');
    const fieldNames = RUNTIME_RENDERER_VIEW_INTERFACES.flatMap((interfaceName) =>
      interfaceFieldNames(extractInterfaceBody(bridgeTypesSource, interfaceName)).map(
        (fieldName) => `${interfaceName}.${fieldName}`
      )
    );

    expect(forbiddenFieldViolations(fieldNames)).toEqual([]);
    expect(fieldNames).toContain('IEvaosRuntimeStatusView.currentUrlSummary');
    expect(fieldNames).toContain('IEvaosBusinessBrowserView.currentUrlSummary');
  });

  it('keeps loaded product proof fixtures free of renderer-forbidden runtime field names', () => {
    const keyPaths = collectObjectKeyPaths(createEvaosLoadedUiFixture());

    expect(forbiddenFieldViolations(keyPaths.map((keyPath) => keyPath.split('.').at(-1) ?? keyPath))).toEqual([]);
  });
});
