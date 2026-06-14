import type { Assistant } from '@/common/types/agent/assistantTypes';

type AssistantPresentation = {
  name?: string;
  description?: string;
};

const EVAOS_ASSISTANT_PRESENTATION = new Map<string, AssistantPresentation>([
  [
    'openclaw-setup',
    {
      name: 'Gateway Debug Expert',
      description:
        'Debugs evaOS/OpenClaw and Hermes gateways by checking the API docs first, then walking through safe setup, routing, and repair steps.',
    },
  ],
  [
    'hermes-setup',
    {
      name: 'Hermes Setup Expert',
      description:
        'Expert guide for configuring Hermes, repairing native Mac access, and getting Hermes ready for customer work.',
    },
  ],
  [
    'hermes-expert',
    {
      name: 'Hermes Expert',
      description: 'Specialist for Hermes agent setup, workflow planning, and customer handoff support.',
    },
  ],
]);

const EVAOS_HIDDEN_RC_ASSISTANT_IDS = new Set(['moltbook']);

function normalizeAssistantId(id: string): string {
  return id.replace(/^builtin-/, '');
}

function presentationForAssistant(assistant: Pick<Assistant, 'id'>): AssistantPresentation | undefined {
  return EVAOS_ASSISTANT_PRESENTATION.get(normalizeAssistantId(assistant.id));
}

export function isEvaosAssistantVisibleInRc(assistant: Pick<Assistant, 'id'>): boolean {
  return !EVAOS_HIDDEN_RC_ASSISTANT_IDS.has(normalizeAssistantId(assistant.id));
}

export function getEvaosAssistantDisplayName(
  assistant: Pick<Assistant, 'id' | 'name' | 'name_i18n'>,
  localeKey: string
): string {
  const presentation = presentationForAssistant(assistant);
  return (
    presentation?.name ||
    assistant.name_i18n?.[localeKey] ||
    assistant.name_i18n?.['en-US'] ||
    assistant.name ||
    assistant.id
  );
}

export function getEvaosAssistantDisplayDescription(
  assistant: Pick<Assistant, 'id' | 'description' | 'description_i18n'>,
  localeKey: string
): string {
  const presentation = presentationForAssistant(assistant);
  return (
    presentation?.description ||
    assistant.description_i18n?.[localeKey] ||
    assistant.description_i18n?.['en-US'] ||
    assistant.description ||
    ''
  );
}
