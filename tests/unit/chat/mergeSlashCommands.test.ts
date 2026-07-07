/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildGuidSlashCommands,
  mapAgentAvailableCommandsToSlashCommands,
} from '@/common/chat/slash/guidSlashCommands';
import { buildSkillSlashCommands, mergeSlashCommands } from '@/common/chat/slash/mergeSlashCommands';
import type { SlashCommandItem } from '@/common/chat/slash/types';

const builtin = (name: string): SlashCommandItem => ({
  name,
  description: `builtin ${name}`,
  kind: 'builtin',
  source: 'builtin',
});

const acp = (name: string): SlashCommandItem => ({
  name,
  description: `acp ${name}`,
  kind: 'template',
  source: 'acp',
});

describe('buildSkillSlashCommands', () => {
  it('returns nothing when no skills are loaded', () => {
    expect(buildSkillSlashCommands(undefined, new Map(), 'Skill')).toEqual([]);
    expect(buildSkillSlashCommands([], new Map(), 'Skill')).toEqual([]);
  });

  it('maps each loaded skill to an insert-style template command', () => {
    const commands = buildSkillSlashCommands(['cron', 'officecli'], new Map([['cron', 'Scheduled tasks']]), 'Skill');

    expect(commands).toEqual([
      { name: 'cron', description: 'Scheduled tasks', kind: 'template', source: 'skill', selectionBehavior: 'insert' },
      { name: 'officecli', description: 'Skill', kind: 'template', source: 'skill', selectionBehavior: 'insert' },
    ]);
  });
});

describe('mergeSlashCommands', () => {
  it('keeps priority builtin > acp > skills on name collisions', () => {
    const skills = buildSkillSlashCommands(['copy', 'cron'], new Map(), 'Skill');
    const merged = mergeSlashCommands([builtin('copy')], [acp('copy'), acp('review')], skills);

    expect(merged.find((command) => command.name === 'copy')?.source).toBe('builtin');
    expect(merged.find((command) => command.name === 'review')?.source).toBe('acp');
    expect(merged.find((command) => command.name === 'cron')?.source).toBe('skill');
    expect(merged.map((command) => command.name)).toEqual(['copy', 'review', 'cron']);
  });

  it('surfaces session skills when there are no other commands', () => {
    const skills = buildSkillSlashCommands(['cron'], new Map([['cron', 'Scheduled tasks']]), 'Skill');
    const merged = mergeSlashCommands([], [], skills);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ name: 'cron', source: 'skill', selectionBehavior: 'insert' });
  });
});

describe('mapAgentAvailableCommandsToSlashCommands', () => {
  it('maps selected-agent handshake command payloads to slash commands', () => {
    const commands = mapAgentAvailableCommandsToSlashCommands({
      available_commands: [
        {
          name: 'review',
          description: 'Review the current diff',
          input: { hint: '⌘R' },
          _meta: {
            completion_behavior: 'neutral_tip_on_empty',
            empty_turn_tip_code: 'acp.empty_turn.choose_command',
            empty_turn_tip_params: { command_count: 1 },
          },
        },
      ],
    });

    expect(commands).toEqual([
      {
        name: 'review',
        description: 'Review the current diff',
        kind: 'template',
        source: 'acp',
        selectionBehavior: 'insert',
        hint: '⌘R',
        completionBehavior: 'neutral_tip_on_empty',
        emptyTurnTipCode: 'acp.empty_turn.choose_command',
        emptyTurnTipParams: { command_count: 1 },
      },
    ]);
  });

  it('accepts JSON encoded command payloads and ignores invalid entries', () => {
    const commands = mapAgentAvailableCommandsToSlashCommands(
      JSON.stringify({
        commands: [
          { command: 'fix', description: 'Fix the selected issue' },
          { command: 'broken' },
          { description: 'missing command name' },
        ],
      })
    );

    expect(commands.map((command) => command.name)).toEqual(['fix']);
  });
});

describe('buildGuidSlashCommands', () => {
  it('uses selected-agent commands before selected skill fallbacks', () => {
    const commands = buildGuidSlashCommands({
      builtinCommands: [builtin('open')],
      agentCommands: [acp('review'), acp('cron')],
      selectedSkills: ['cron', 'officecli'],
      descriptionByName: new Map([
        ['cron', 'Scheduled tasks'],
        ['officecli', 'Office automation'],
      ]),
      skillFallbackDescription: 'Skill',
    });

    expect(commands.map((command) => `${command.name}:${command.source}`)).toEqual([
      'open:builtin',
      'review:acp',
      'cron:acp',
    ]);
  });

  it('falls back to selected skills when the selected agent has no commands', () => {
    const commands = buildGuidSlashCommands({
      builtinCommands: [builtin('open')],
      selectedSkills: ['cron'],
      descriptionByName: new Map([['cron', 'Scheduled tasks']]),
      skillFallbackDescription: 'Skill',
    });

    expect(commands.map((command) => `${command.name}:${command.source}`)).toEqual(['open:builtin', 'cron:skill']);
  });
});
