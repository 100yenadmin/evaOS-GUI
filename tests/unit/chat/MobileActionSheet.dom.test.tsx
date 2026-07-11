/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import MobileActionSheet from '@/renderer/components/chat/MobileActionSheet';
import type { MobileActionSheetEntry } from '@/renderer/components/chat/MobileActionSheet/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('@icon-park/react', () => ({
  Left: () => <span aria-hidden='true'>‹</span>,
  Right: () => <span aria-hidden='true'>›</span>,
}));

describe('MobileActionSheet', () => {
  it('does not render when closed', () => {
    render(<MobileActionSheet open={false} onClose={vi.fn()} entries={[]} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps a multi-select submenu active across several toggles', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const entries = [
      {
        key: 'skills',
        label: 'Skills',
        submenu: {
          title: 'Skills',
          multiSelect: true,
          options: [
            { key: 's1', label: 'Code review', active: true },
            { key: 's2', label: 'PPT' },
            { key: 's3', label: 'Research' },
          ],
          onSelect,
        },
      },
    ] as MobileActionSheetEntry[];

    render(<MobileActionSheet open onClose={onClose} entries={entries} />);
    fireEvent.click(screen.getByTestId('mobile-action-sheet-skills'));
    fireEvent.click(screen.getByTestId('mobile-action-sheet-option-s2'));
    fireEvent.click(screen.getByTestId('mobile-action-sheet-option-s3'));

    expect(onSelect).toHaveBeenNthCalledWith(1, 's2');
    expect(onSelect).toHaveBeenNthCalledWith(2, 's3');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('exposes multi-select option state to assistive technology', async () => {
    const entries: MobileActionSheetEntry[] = [
      {
        key: 'skills',
        label: 'Skills',
        submenu: {
          title: 'Skills',
          multiSelect: true,
          options: [
            { key: 'enabled', label: 'Enabled skill', active: true },
            { key: 'disabled', label: 'Disabled skill', active: false },
          ],
          onSelect: vi.fn(),
        },
      },
    ];

    render(<MobileActionSheet open onClose={vi.fn()} entries={entries} />);
    fireEvent.click(screen.getByTestId('mobile-action-sheet-skills'));

    await waitFor(() =>
      expect(screen.getByTestId('mobile-action-sheet-option-enabled')).toHaveAttribute('tabindex', '0')
    );

    expect(screen.getByRole('checkbox', { name: 'Enabled skill' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: 'Disabled skill' })).toHaveAttribute('aria-checked', 'false');
  });

  it('runs an action entry and closes the sheet', () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    const entries: MobileActionSheetEntry[] = [{ key: 'attach', label: 'Add files', onClick }];

    render(<MobileActionSheet open onClose={onClose} entries={entries} />);
    fireEvent.click(screen.getByTestId('mobile-action-sheet-attach'));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not activate a disabled entry', () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    const entries: MobileActionSheetEntry[] = [{ key: 'attach', label: 'Add files', disabled: true, onClick }];

    render(<MobileActionSheet open onClose={onClose} entries={entries} />);
    const entry = screen.getByTestId('mobile-action-sheet-attach');

    expect(entry).toHaveAttribute('aria-disabled', 'true');
    expect(entry).toHaveAttribute('tabindex', '-1');
    fireEvent.click(entry);
    expect(onClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders an empty submenu message when no options are available', () => {
    const entries: MobileActionSheetEntry[] = [
      {
        key: 'model',
        label: 'Model',
        submenu: {
          title: 'Model',
          options: [],
          emptyText: 'No models available',
          onSelect: vi.fn(),
        },
      },
    ];

    render(<MobileActionSheet open onClose={vi.fn()} entries={entries} />);
    fireEvent.click(screen.getByTestId('mobile-action-sheet-model'));

    expect(screen.getByText('No models available')).toBeInTheDocument();
  });

  it('moves keyboard focus into and back out of submenu options', async () => {
    const onSelect = vi.fn();
    const entries: MobileActionSheetEntry[] = [
      {
        key: 'model',
        label: 'Model',
        submenu: {
          title: 'Model',
          options: [{ key: 'model-b', label: 'Model B' }],
          onSelect,
        },
      },
      { key: 'attach', label: 'Add files', onClick: vi.fn() },
    ];

    const Host = () => {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type='button' onClick={() => setOpen(true)}>
            Open sheet
          </button>
          <MobileActionSheet open={open} onClose={() => setOpen(false)} entries={entries} />
        </>
      );
    };

    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Open sheet' });
    opener.focus();
    fireEvent.click(opener);

    const modelEntry = screen.getByTestId('mobile-action-sheet-model');
    const attachEntry = screen.getByTestId('mobile-action-sheet-attach');
    await waitFor(() => expect(modelEntry).toHaveFocus());

    attachEntry.focus();
    fireEvent.keyDown(attachEntry, { key: 'Tab' });
    expect(modelEntry).toHaveFocus();
    fireEvent.keyDown(modelEntry, { key: 'Tab', shiftKey: true });
    expect(attachEntry).toHaveFocus();

    modelEntry.focus();
    fireEvent.keyDown(modelEntry, { key: 'Enter' });

    const modelOption = screen.getByTestId('mobile-action-sheet-option-model-b');
    await waitFor(() => expect(modelOption).toHaveFocus());
    expect(modelEntry).toHaveAttribute('tabindex', '-1');
    expect(modelOption).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(modelOption, { key: ' ' });

    expect(onSelect).toHaveBeenCalledWith('model-b');
    await waitFor(() => expect(modelEntry).toHaveFocus());
    expect(modelEntry).toHaveAttribute('tabindex', '0');
    expect(modelOption).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(modelEntry, { key: 'Escape' });
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
