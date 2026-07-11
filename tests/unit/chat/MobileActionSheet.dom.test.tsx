/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import MobileActionSheet from '@/renderer/components/chat/MobileActionSheet';
import type { MobileActionSheetEntry } from '@/renderer/components/chat/MobileActionSheet/types';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('runs an action entry and closes the sheet', () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    const entries: MobileActionSheetEntry[] = [{ key: 'attach', label: 'Add files', onClick }];

    render(<MobileActionSheet open onClose={onClose} entries={entries} />);
    fireEvent.click(screen.getByTestId('mobile-action-sheet-attach'));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
