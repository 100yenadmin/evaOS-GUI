/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <div data-testid='monaco-editor'>{value}</div>,
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    useMessage: () => [{ info: vi.fn(), success: vi.fn(), error: vi.fn() }, null],
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import HTMLViewer from '@/renderer/pages/conversation/Preview/components/viewers/HTMLViewer';
import HTMLRenderer from '@/renderer/pages/conversation/Preview/components/renderers/HTMLRenderer';

describe('HTMLViewer', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('renders iframe with HTML content', () => {
    const { container } = render(<HTMLViewer content='<h1>Test</h1>' />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
  });

  it('hides toolbar when hideToolbar is true', () => {
    const { container } = render(<HTMLViewer content='<h1>Test</h1>' hideToolbar />);
    expect(container.querySelector('[class*="toolbar"]')).not.toBeInTheDocument();
  });

  it('accepts file_path prop', () => {
    const { container } = render(<HTMLViewer content='<h1>Test</h1>' file_path='/test/index.html' />);
    expect(container.querySelector('iframe')).toBeInTheDocument();
  });
});

describe('HTMLRenderer', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('loads clean local HTML through file URL in Electron', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {},
    });

    const { container } = render(
      <HTMLRenderer content='<h1>Test</h1>' file_path='/workspace/financial-wechat-miniapp.html' />
    );

    const webview = container.querySelector('webview');
    expect(webview).toBeInTheDocument();
    expect(webview?.getAttribute('src')).toBe('file:///workspace/financial-wechat-miniapp.html');
  });

  it('reloads clean local HTML when backing content changes in Electron', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {},
    });

    const { container, rerender } = render(
      <HTMLRenderer content='<h1>Initial</h1>' file_path='/workspace/index.html' />
    );
    const initialWebview = container.querySelector('webview');
    expect(initialWebview?.getAttribute('src')).toBe('file:///workspace/index.html');

    rerender(<HTMLRenderer content='<h1>Updated</h1>' file_path='/workspace/index.html' />);

    const updatedWebview = container.querySelector('webview');
    expect(updatedWebview?.getAttribute('src')).toBe('file:///workspace/index.html');
    expect(updatedWebview).not.toBe(initialWebview);
  });

  it('keeps dirty local HTML content in memory in Electron', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {},
    });

    const { container } = render(
      <HTMLRenderer content='<h1>Unsaved edit</h1>' file_path='/workspace/index.html' isDirty />
    );

    const webview = container.querySelector('webview');
    expect(webview).toBeInTheDocument();
    expect(webview?.getAttribute('src')).toContain('data:text/html');
    expect(webview?.getAttribute('src')).toContain('Unsaved%20edit');
  });
});
