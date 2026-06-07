/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  evaosBetaVisibleSkillCards,
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

  it('sanitizes beta-visible Skills Hub cards without mutating backend skill ids', () => {
    const cards = evaosBetaVisibleSkillCards([
      {
        name: 'aionui-skills',
        description: 'Access the AionUI Skills registry and manage credentials on the AionUI Skills platform.',
        source: 'builtin' as const,
      },
      {
        name: 'Aionui Official',
        description: 'Bundled from AionHub by iOfficeAI. Learn more at https://www.aionui.com.',
        source: 'builtin' as const,
      },
      {
        name: 'aionui-webui-setup',
        description: 'AionUi WebUI configuration expert for remote access through the settings interface.',
        source: 'builtin' as const,
      },
      {
        name: 'cron',
        description: 'Scheduled task management.',
        source: 'builtin' as const,
      },
    ]);

    expect(cards.map((skill) => skill.name)).toEqual(['aionui-skills', 'Aionui Official', 'cron']);
    expect(cards[0].evaosDisplayName).toBe('upstream-skills-registry');
    expect(cards[0].evaosDisplayDescription).toBe(
      'Discover and manage reusable agent skills from the upstream shell registry.'
    );
    const visibleText = cards.flatMap((skill) => [
      skill.description,
      skill.evaosDisplayName,
      skill.evaosDisplayDescription,
    ]);
    expect(JSON.stringify(visibleText)).not.toMatch(/AionUi|Aionui Official|AionHub|iOfficeAI|aionui\.com/i);
  });
});
