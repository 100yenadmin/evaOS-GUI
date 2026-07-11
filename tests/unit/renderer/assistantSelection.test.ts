/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import {
  canSwitchAssistantAgent,
  isBuiltinAssistant,
  isGeneratedAssistant,
  isSystemAssistant,
  selectableAssistants,
  selectableEvaosAssistants,
} from '@/renderer/utils/model/assistantSelection';

type SelectionFixtureAssistant = Pick<Assistant, 'id' | 'enabled' | 'sort_order' | 'agent_status'> & {
  source: Assistant['source'] | 'generated';
};

const assistant = (
  overrides: Partial<SelectionFixtureAssistant> & Pick<SelectionFixtureAssistant, 'id' | 'source'>
): SelectionFixtureAssistant => ({
  id: overrides.id,
  source: overrides.source,
  enabled: overrides.enabled ?? true,
  sort_order: overrides.sort_order ?? 1000,
  agent_status: overrides.agent_status ?? 'online',
  ...overrides,
});

describe('assistantSelection', () => {
  it('classifies backend-owned assistant identities consistently', () => {
    expect(isBuiltinAssistant({ source: 'builtin' })).toBe(true);
    expect(isGeneratedAssistant({ source: 'generated' })).toBe(true);
    expect(isSystemAssistant({ source: 'builtin' })).toBe(true);
    expect(isSystemAssistant({ source: 'generated' })).toBe(true);
    expect(isSystemAssistant({ source: 'user' })).toBe(false);
  });

  it('keeps generated assistant agent bindings immutable', () => {
    expect(canSwitchAssistantAgent({ source: 'generated' } as Assistant)).toBe(false);
    expect(canSwitchAssistantAgent({ source: 'builtin' } as Assistant)).toBe(true);
    expect(canSwitchAssistantAgent({ source: 'user' } as Assistant)).toBe(true);
  });

  it('orders enabled assistants by source group then sort order', () => {
    const selected = selectableAssistants([
      assistant({ id: 'official-low', source: 'builtin', sort_order: 1 }),
      assistant({ id: 'disabled-user', source: 'user', sort_order: 1, enabled: false }),
      assistant({ id: 'custom-high', source: 'user', sort_order: 200 }),
      assistant({ id: 'custom-low', source: 'user', sort_order: 10 }),
      assistant({ id: 'extension-low', source: 'extension', sort_order: 20 }),
      assistant({ id: 'generated-cli', source: 'generated', sort_order: 999 }),
    ]);

    expect(selected.map((item) => item.id)).toEqual([
      'generated-cli',
      'custom-low',
      'extension-low',
      'custom-high',
      'official-low',
    ]);
  });

  it('keeps equal source/order entries stable', () => {
    const selected = selectableAssistants([
      assistant({ id: 'first', source: 'user', sort_order: 100 }),
      assistant({ id: 'second', source: 'user', sort_order: 100 }),
      assistant({ id: 'third', source: 'user', sort_order: 100 }),
    ]);

    expect(selected.map((item) => item.id)).toEqual(['first', 'second', 'third']);
  });

  it('does not expose assistants whose canonical agent row is missing', () => {
    const selected = selectableAssistants([
      assistant({ id: 'available', source: 'user' }),
      assistant({ id: 'orphaned', source: 'user', agent_status: 'missing' }),
    ]);

    expect(selected.map((item) => item.id)).toEqual(['available']);
  });

  it('applies evaOS RC visibility while pinning Cowork first', () => {
    const selected = selectableEvaosAssistants([
      assistant({ id: 'builtin-moltbook', source: 'builtin', sort_order: 1 }),
      assistant({ id: 'official-low', source: 'builtin', sort_order: 2 }),
      assistant({ id: 'writer', source: 'user', sort_order: 1000 }),
      assistant({ id: 'cowork', source: 'builtin', sort_order: 5000 }),
    ]);

    expect(selected.map((item) => item.id)).toEqual(['cowork', 'writer', 'official-low']);
  });
});
