import { describe, expect, it } from 'vitest';
import {
  getEvaosAssistantDisplayDescription,
  getEvaosAssistantDisplayName,
} from '@/renderer/evaos/evaosAssistantPresentation';
import type { Assistant } from '@/common/types/agent/assistantTypes';

function assistant(overrides: Partial<Assistant>): Assistant {
  return {
    id: 'openclaw-setup',
    source: 'builtin',
    name: 'OpenClaw Setup Expert',
    name_i18n: { 'en-US': 'OpenClaw Setup Expert' },
    description: 'Expert guide for installing, deploying, configuring, and troubleshooting OpenClaw.',
    description_i18n: {
      'en-US': 'Expert guide for installing, deploying, configuring, and troubleshooting OpenClaw.',
    },
    avatar: '🦞',
    enabled: true,
    preset_agent_type: 'openclaw-gateway',
    enabled_skills: [],
    disabled_builtin_skills: [],
    ...overrides,
  } as Assistant;
}

describe('evaOS assistant presentation', () => {
  it('renames the OpenClaw setup preset on beta surfaces without changing its backend id', () => {
    const preset = assistant({});

    expect(getEvaosAssistantDisplayName(preset, 'en-US')).toBe('evaOS Setup Expert');
    expect(getEvaosAssistantDisplayDescription(preset, 'en-US')).toContain('troubleshooting evaOS');
    expect(getEvaosAssistantDisplayDescription(preset, 'en-US')).not.toContain('OpenClaw');
  });

  it('leaves unrelated assistant display values unchanged', () => {
    const preset = assistant({
      id: 'cowork',
      name: 'Cowork',
      name_i18n: { 'en-US': 'Cowork' },
      description: 'Autonomous task execution.',
      description_i18n: { 'en-US': 'Autonomous task execution.' },
    });

    expect(getEvaosAssistantDisplayName(preset, 'en-US')).toBe('Cowork');
    expect(getEvaosAssistantDisplayDescription(preset, 'en-US')).toBe('Autonomous task execution.');
  });
});
