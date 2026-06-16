/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { safeEvaosUiText } from '@/renderer/utils/evaosSafeText';

describe('safeEvaosUiText', () => {
  it('rejects secret-like primary and fallback text', () => {
    expect(safeEvaosUiText('desktop_session=eds_secret_value', 'access_token=epg_secret_value')).toBe('');
  });

  it('uses sanitized fallback text when the primary value is unsafe', () => {
    expect(safeEvaosUiText('Bearer hidden-token', 'Connected Apps failed closed.')).toBe(
      'Connected Apps failed closed.'
    );
  });

  it('clamps short max lengths and truncates long safe values', () => {
    expect(safeEvaosUiText('abcdefghij', 'fallback', 2)).toBe('...');
  });
});
