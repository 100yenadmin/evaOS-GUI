import type { Assistant } from '@/common/types/agent/assistantTypes';

type AssistantPresentation = {
  name?: string;
  description?: string;
};

const EVAOS_ASSISTANT_PRESENTATION = new Map<string, AssistantPresentation>([
  [
    'openclaw-setup',
    {
      name: 'evaOS Setup Expert',
      description:
        'Expert guide for installing, deploying, configuring, and troubleshooting evaOS. Proactively helps with setup, diagnoses issues, and provides security best practices.',
    },
  ],
]);

function normalizeAssistantId(id: string): string {
  return id.replace(/^builtin-/, '');
}

function presentationForAssistant(assistant: Pick<Assistant, 'id'>): AssistantPresentation | undefined {
  return EVAOS_ASSISTANT_PRESENTATION.get(normalizeAssistantId(assistant.id));
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
