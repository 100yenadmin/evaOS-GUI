/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock('@renderer/utils/chat/latexDelimiters', () => ({
  convertLatexDelimiters: (text: string) => text,
}));

vi.mock('@renderer/components/media/LocalImageView', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img data-testid='local-image' src={src} alt={alt} />,
}));

vi.mock('@/renderer/components/Markdown/CodeBlock', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <code>{children}</code>,
}));

vi.mock('@/renderer/components/Markdown/ShadowView', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import MarkdownView from '@/renderer/components/Markdown';

describe('Markdown local and external image handling', () => {
  it('adds an empty alt fallback for external raw HTML images', () => {
    const { container } = render(<MarkdownView allowHtml>{'<img src="https://example.com/image.png">'}</MarkdownView>);

    const image = container.querySelector('img[src="https://example.com/image.png"]');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('alt')).toBe('');
  });
});
