/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import i18nConfig from '@/common/config/i18n-config.json';
import { normalizeLanguageCode } from '@/common/config/i18n';

describe('French locale configuration', () => {
  it('normalizes French language variants to fr-FR', () => {
    expect(normalizeLanguageCode('fr')).toBe('fr-FR');
    expect(normalizeLanguageCode('fr-FR')).toBe('fr-FR');
    expect(normalizeLanguageCode('FR_fr')).toBe('fr-FR');
  });

  it('registers fr-FR as a supported locale', () => {
    expect(i18nConfig.supportedLanguages).toContain('fr-FR');
  });
});
