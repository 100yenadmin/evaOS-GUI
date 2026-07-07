/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommandItem } from './types';

/**
 * Builds slash command items for the skills loaded into the current
 * conversation. Skills are inserted as `/name ` templates so the user can add
 * arguments before sending.
 */
export function buildSkillSlashCommands(
  loadedSkills: readonly string[] | undefined,
  descriptionByName: ReadonlyMap<string, string>,
  fallbackDescription: string
): SlashCommandItem[] {
  if (!loadedSkills || loadedSkills.length === 0) {
    return [];
  }
  return loadedSkills.map((name) => ({
    name,
    description: descriptionByName.get(name) ?? fallbackDescription,
    kind: 'template',
    source: 'skill',
    selectionBehavior: 'insert',
  }));
}

/**
 * Merges slash command groups into a de-duplicated list. Earlier groups win, so
 * the intended priority is builtin > ACP agent commands > session skills.
 */
export function mergeSlashCommands(
  builtin: readonly SlashCommandItem[],
  acp: readonly SlashCommandItem[],
  skills: readonly SlashCommandItem[]
): SlashCommandItem[] {
  const map = new Map<string, SlashCommandItem>();
  for (const group of [builtin, acp, skills]) {
    for (const command of group) {
      if (!map.has(command.name)) {
        map.set(command.name, command);
      }
    }
  }
  return Array.from(map.values());
}
