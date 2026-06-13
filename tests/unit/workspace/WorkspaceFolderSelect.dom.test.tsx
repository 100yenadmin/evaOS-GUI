/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceFolderSelect from '@/renderer/components/workspace/WorkspaceFolderSelect';
import { ipcBridge } from '@/common';

vi.mock('@/common', () => ({
  ipcBridge: {
    dialog: {
      showOpen: {
        invoke: vi.fn(),
      },
    },
  },
}));

describe('WorkspaceFolderSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    delete (window as Window & { electronAPI?: unknown }).electronAPI;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('uses the clickable folder picker in WebUI mode instead of a text-only input', async () => {
    vi.mocked(ipcBridge.dialog.showOpen.invoke).mockResolvedValue(['/workspace/demo']);
    const onChange = vi.fn();

    render(
      <WorkspaceFolderSelect
        value=''
        onChange={onChange}
        placeholder='Select folder'
        recentLabel='Recent'
        chooseDifferentLabel='Choose a different folder'
        triggerTestId='workspace-trigger'
      />
    );

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workspace-trigger'));

    await waitFor(() => {
      expect(ipcBridge.dialog.showOpen.invoke).toHaveBeenCalledWith({
        properties: ['openDirectory', 'createDirectory'],
      });
    });
    expect(onChange).toHaveBeenCalledWith('/workspace/demo');
  });
});
