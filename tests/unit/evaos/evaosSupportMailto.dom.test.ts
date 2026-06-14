/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openEvaosSupportEmail } from '@/renderer/utils/platform';

const ipcMock = vi.hoisted(() => ({
  evaosExternalLinkOpen: vi.fn(),
  shellOpenExternal: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    evaosExternalLink: {
      open: {
        invoke: ipcMock.evaosExternalLinkOpen,
      },
    },
    shell: {
      openExternal: {
        invoke: ipcMock.shellOpenExternal,
      },
    },
  },
}));

describe('openEvaosSupportEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {},
    });
  });

  it('opens support through the restricted evaOS mailto bridge', async () => {
    ipcMock.evaosExternalLinkOpen.mockResolvedValue({ success: true });

    await openEvaosSupportEmail({ subject: 'evaOS support', body: 'Route: /guid' });

    expect(ipcMock.evaosExternalLinkOpen).toHaveBeenCalledWith({
      url: 'mailto:support@electricsheephq.com?subject=evaOS+support&body=Route%3A+%2Fguid',
    });
    expect(ipcMock.shellOpenExternal).not.toHaveBeenCalled();
  });

  it('fails closed without falling back to generic external browsing', async () => {
    ipcMock.evaosExternalLinkOpen.mockResolvedValue({
      success: false,
      msg: 'Unsupported evaOS support link.',
    });

    await expect(openEvaosSupportEmail()).rejects.toThrow('Unsupported evaOS support link.');

    expect(ipcMock.evaosExternalLinkOpen).toHaveBeenCalledTimes(1);
    expect(ipcMock.shellOpenExternal).not.toHaveBeenCalled();
  });
});
