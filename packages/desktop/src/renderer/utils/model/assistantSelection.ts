/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Assistant } from '@/common/types/agent/assistantTypes';
import { isEvaosAssistantVisibleInRc } from '@/renderer/evaos/evaosAssistantPresentation';

type AssistantSelectionInput = Pick<Assistant, 'id' | 'enabled' | 'sort_order'> & {
  source: string;
};

/** Group weight - lower comes first. Bare CLI < user-created < official. */
const sourceGroupWeight = (source: string): number => {
  switch (source) {
    case 'generated':
      return 0;
    case 'user':
    case 'extension':
      return 1;
    case 'builtin':
      return 2;
    default:
      return 1;
  }
};

/**
 * Return enabled assistants ordered for a selection list:
 * bare CLI -> user/custom -> official, each group sorted by `sort_order`.
 */
export const selectableAssistants = <T extends AssistantSelectionInput>(assistants: readonly T[]): T[] =>
  assistants
    .map((assistant, index) => ({ assistant, index }))
    .filter(({ assistant }) => assistant.enabled !== false)
    .toSorted((left, right) => {
      const groupDelta = sourceGroupWeight(left.assistant.source) - sourceGroupWeight(right.assistant.source);
      if (groupDelta !== 0) return groupDelta;

      const sortOrderDelta = left.assistant.sort_order - right.assistant.sort_order;
      if (sortOrderDelta !== 0) return sortOrderDelta;

      return left.index - right.index;
    })
    .map(({ assistant }) => assistant);

const evaosPrimaryAssistantWeight = (assistant: Pick<Assistant, 'id'>): number => {
  const normalizedId = assistant.id.replace(/^builtin-/, '');
  return normalizedId === 'cowork' ? 0 : 1;
};

/**
 * evaOS RC selection order keeps the branded Cowork entry first while applying
 * upstream's enabled/source/sort ordering to every other selectable assistant.
 */
export const selectableEvaosAssistants = <T extends AssistantSelectionInput>(assistants: readonly T[]): T[] =>
  selectableAssistants(assistants.filter(isEvaosAssistantVisibleInRc))
    .map((assistant, index) => ({ assistant, index }))
    .toSorted((left, right) => {
      const primaryDelta = evaosPrimaryAssistantWeight(left.assistant) - evaosPrimaryAssistantWeight(right.assistant);
      if (primaryDelta !== 0) return primaryDelta;
      return left.index - right.index;
    })
    .map(({ assistant }) => assistant);
