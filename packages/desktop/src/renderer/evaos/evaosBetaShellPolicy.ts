/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const EVAOS_BETA_WEBUI_SETTINGS_ENABLED = false;
export const EVAOS_BETA_WEBUI_FALLBACK_ROUTE = '/guid';
const EVAOS_BETA_HIDDEN_SKILL_NAMES = new Set(['aionui-webui-setup']);
const EVAOS_BETA_UPSTREAM_SKILLS_REGISTRY_DISPLAY = {
  name: 'upstream-skills-registry',
  description: 'Discover and manage reusable agent skills from the upstream shell registry.',
};
const EVAOS_BETA_SKILL_DISPLAY_OVERRIDES = new Map([
  ['aionui-skills', EVAOS_BETA_UPSTREAM_SKILLS_REGISTRY_DISPLAY],
  ['aionui official', EVAOS_BETA_UPSTREAM_SKILLS_REGISTRY_DISPLAY],
]);
const EVAOS_BETA_SKILL_DISPLAY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/https?:\/\/(?:www\.)?aionui\.com\/?/gi, 'the upstream project site'],
  [/aionui\.com/gi, 'the upstream project site'],
  [/Aionui Official/gi, 'upstream-skills-registry'],
  [/AionUi Official/gi, 'upstream-skills-registry'],
  [/AionUI Skills/gi, 'agent skills'],
  [/AionUi Skills/gi, 'agent skills'],
  [/AionUi WebUI/gi, 'WebUI'],
  [/AionHub/gi, 'upstream hub'],
  [/iOfficeAI/gi, 'upstream maintainers'],
  [/AionUi/gi, 'upstream shell'],
];

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

function sanitizeEvaosBetaSkillDisplayText(value: string): string {
  return EVAOS_BETA_SKILL_DISPLAY_REPLACEMENTS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value
  );
}

export function evaosBetaVisibleSkillCards<T extends { name: string; description?: string }>(
  skills: readonly T[]
): Array<EvaosBetaSkillDisplay<T>> {
  return skills
    .filter((skill) => !EVAOS_BETA_HIDDEN_SKILL_NAMES.has(skill.name))
    .map((skill) => {
      const override = EVAOS_BETA_SKILL_DISPLAY_OVERRIDES.get(skill.name.trim().toLowerCase());
      const displayName = sanitizeEvaosBetaSkillDisplayText(override?.name ?? skill.name);
      const displayDescription = sanitizeEvaosBetaSkillDisplayText(override?.description ?? skill.description ?? '');
      return Object.assign({}, skill, {
        evaosDisplayName: displayName,
        description: displayDescription,
        evaosDisplayDescription: displayDescription,
      });
    });
}
