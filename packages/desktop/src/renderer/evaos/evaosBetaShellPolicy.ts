/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const EVAOS_BETA_WEBUI_SETTINGS_ENABLED = false;
export const EVAOS_BETA_WEBUI_FALLBACK_ROUTE = '/guid';
const EVAOS_BETA_HIDDEN_SKILL_NAMES = new Set(['aionui-webui-setup']);
const EVAOS_BETA_SKILL_DISPLAY_OVERRIDES = new Map([
  [
    'aionui-skills',
    {
      name: 'upstream-skills-registry',
      description: 'Discover and manage reusable agent skills from the upstream shell registry.',
    },
  ],
]);

export type EvaosBetaSkillDisplay<T extends { name: string; description?: string }> = T & {
  evaosDisplayName: string;
  evaosDisplayDescription: string;
};

export function isEvaosBetaWebUISettingsEnabled(): boolean {
  return EVAOS_BETA_WEBUI_SETTINGS_ENABLED;
}

export function isEvaosBetaSettingsTabVisible(tabId: string): boolean {
  if (tabId === 'webui') {
    return isEvaosBetaWebUISettingsEnabled();
  }
  return true;
}

export function evaosBetaWebUIRouteElement<T>(allowedElement: T, blockedElement: T): T {
  return isEvaosBetaWebUISettingsEnabled() ? allowedElement : blockedElement;
}

export function evaosBetaVisibleSkillCards<T extends { name: string; description?: string }>(
  skills: readonly T[]
): Array<EvaosBetaSkillDisplay<T>> {
  return skills
    .filter((skill) => !EVAOS_BETA_HIDDEN_SKILL_NAMES.has(skill.name))
    .map((skill) => {
      const override = EVAOS_BETA_SKILL_DISPLAY_OVERRIDES.get(skill.name);
      const displayDescription = override?.description ?? skill.description ?? '';
      return Object.assign({}, skill, {
        evaosDisplayName: override?.name ?? skill.name,
        description: displayDescription,
        evaosDisplayDescription: displayDescription,
      });
    });
}
