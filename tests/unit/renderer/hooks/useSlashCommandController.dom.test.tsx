import { describe, expect, it } from 'vitest';
import {
  filterSlashCommands,
  getFuzzyMatchIndices,
  matchSlashQuery,
} from '@/renderer/hooks/chat/useSlashCommandController';
import type { SlashCommandItem } from '@/common/chat/slash/types';

const command = (name: string): SlashCommandItem => ({
  name,
  description: name,
  kind: 'template',
  source: 'acp',
});

describe('slash command controller helpers', () => {
  it('matches slash queries without accepting free-form text', () => {
    expect(matchSlashQuery('/')).toBe('');
    expect(matchSlashQuery('/review')).toBe('review');
    expect(matchSlashQuery('/review-now')).toBe('review-now');
    expect(matchSlashQuery('please /review')).toBeNull();
    expect(matchSlashQuery('/review now')).toBeNull();
  });

  it('filters by contained command text instead of prefix only', () => {
    const commands = [command('open'), command('review'), command('officecli')];

    expect(filterSlashCommands(commands, 'vie').map((item) => item.name)).toEqual(['review']);
    expect(filterSlashCommands(commands, 'ice').map((item) => item.name)).toEqual(['officecli']);
    expect(filterSlashCommands(commands, '').map((item) => item.name)).toEqual(['open', 'review', 'officecli']);
  });

  it('returns highlight indices for the matching command segment', () => {
    expect(getFuzzyMatchIndices('officecli', 'ice')).toEqual([3, 4, 5]);
    expect(getFuzzyMatchIndices('Review', 'rev')).toEqual([0, 1, 2]);
    expect(getFuzzyMatchIndices('review', 'zzz')).toBeNull();
  });
});
