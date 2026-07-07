/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { selectableAssistants, selectableEvaosAssistants } from '@/renderer/utils/model/assistantSelection';

type SelectionFixtureAssistant = Pick<Assistant, 'id' | 'enabled' | 'sort_order'> & {
  source: Assistant['source'] | 'generated';
};

const assistant = (
  overrides: Partial<SelectionFixtureAssistant> & Pick<SelectionFixtureAssistant, 'id' | 'source'>
): SelectionFixtureAssistant => ({
  id: overrides.id,
  source: overrides.source,
  enabled: overrides.enabled ?? true,
  sort_order: overrides.sort_order ?? 1000,
  ...overrides,
});

describe('assistantSelection', () => {
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
