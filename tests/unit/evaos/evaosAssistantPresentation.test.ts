import { describe, expect, it } from 'vitest';
import {
  getEvaosAssistantDisplayDescription,
  getEvaosAssistantDisplayName,
  isEvaosAssistantVisibleInRc,
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
  it('hides OpenClaw setup and Moltbook from the controlled RC catalog', () => {
    const preset = assistant({});

    expect(isEvaosAssistantVisibleInRc(preset)).toBe(false);
    expect(isEvaosAssistantVisibleInRc(assistant({ id: 'builtin-moltbook' }))).toBe(false);
  });

  it('curates Hermes setup and expert assistants for the controlled RC catalog', () => {
    const setup = assistant({
      id: 'hermes-setup',
      name: 'Setup',
      name_i18n: { 'en-US': 'Setup' },
      description: 'Generic setup.',
      description_i18n: { 'en-US': 'Generic setup.' },
    });
    const expert = assistant({
      id: 'builtin-hermes-expert',
      name: 'Expert',
      name_i18n: { 'en-US': 'Expert' },
      description: 'Generic expert.',
      description_i18n: { 'en-US': 'Generic expert.' },
    });

    expect(isEvaosAssistantVisibleInRc(setup)).toBe(true);
    expect(getEvaosAssistantDisplayName(setup, 'en-US')).toBe('Hermes Setup Expert');
    expect(getEvaosAssistantDisplayDescription(setup, 'en-US')).toContain('configuring Hermes');
    expect(getEvaosAssistantDisplayName(expert, 'en-US')).toBe('Hermes Expert');
    expect(getEvaosAssistantDisplayDescription(expert, 'en-US')).toContain('Hermes agent setup');
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
