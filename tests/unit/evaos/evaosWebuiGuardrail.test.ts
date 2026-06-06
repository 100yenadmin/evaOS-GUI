/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  evaosBetaWebUIRouteElement,
  isEvaosBetaSettingsTabVisible,
  isEvaosBetaWebUISettingsEnabled,
} from '@/renderer/evaos/evaosBetaShellPolicy';
import { BUILTIN_TAB_IDS } from '@/renderer/pages/settings/components/SettingsSider';
import { getBuiltinSettingsNavItems } from '@/renderer/pages/settings/components/SettingsPageWrapper';

const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

describe('evaOS beta WebUI guardrail', () => {
  it('keeps upstream WebUI catalogued while beta policy hides the setting', () => {
    expect(BUILTIN_TAB_IDS).toContain('webui');
    expect(isEvaosBetaWebUISettingsEnabled()).toBe(false);
    expect(isEvaosBetaSettingsTabVisible('webui')).toBe(false);
    expect(isEvaosBetaSettingsTabVisible('system')).toBe(true);
  });

  it('hides the WebUI settings entry from beta settings navigation', () => {
    expect(getBuiltinSettingsNavItems(true, t).map((item) => item.id)).not.toContain('webui');
  });

  it('blocks direct WebUI route rendering by default', () => {
    expect(evaosBetaWebUIRouteElement('allowed', 'blocked')).toBe('blocked');
  });
});
