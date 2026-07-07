/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const openAIConstructorMock = vi.hoisted(() =>
  vi.fn(function MockOpenAI() {
    return { chat: {}, images: {}, embeddings: {} };
  })
);

vi.mock('openai', () => ({
  default: openAIConstructorMock,
}));

import { OpenAIRotatingClient } from '@/common/api/OpenAIRotatingClient';

describe('OpenAIRotatingClient', () => {
  beforeEach(() => {
    openAIConstructorMock.mockClear();
  });

  it('passes cleaned keys through the OpenAI SDK apiKey option', () => {
    new OpenAIRotatingClient(' sk-test-key\n', {
      baseURL: 'https://gateway.example.com/v1',
      defaultHeaders: {
        'X-Title': 'evaOS Workbench',
      },
    });

    expect(openAIConstructorMock).toHaveBeenCalledOnce();
    const config = openAIConstructorMock.mock.calls[0][0];
    expect(config).toMatchObject({
      apiKey: 'sk-test-key',
      baseURL: 'https://gateway.example.com/v1',
      defaultHeaders: {
        'X-Title': 'evaOS Workbench',
      },
    });
    expect(config).not.toHaveProperty('api_key');
  });
});
