/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { openEvaosExternalLink } from '@/process/services/evaosExternalLink';

const electronMock = vi.hoisted(() => ({
  shell: {
    openExternal: vi.fn(async () => undefined),
  },
}));

vi.mock('electron', () => electronMock);

describe('evaosExternalLink', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('allows controlled RC dashboard, support, and release links', async () => {
    await expect(
      openEvaosExternalLink({ url: 'https://www.electricsheephq.com/dashboard/providers' })
    ).resolves.toMatchObject({ opened: true });
    await expect(openEvaosExternalLink({ url: 'mailto:support@electricsheephq.com' })).resolves.toMatchObject({
      opened: true,
    });
    await expect(
      openEvaosExternalLink({ url: 'https://github.com/100yenadmin/evaOS-GUI/releases/tag/evaos-beta-test' })
    ).resolves.toMatchObject({ opened: true });

    expect(electronMock.shell.openExternal).toHaveBeenCalledTimes(3);
  });

  it('blocks unrelated external links from evaOS release surfaces', async () => {
    await expect(openEvaosExternalLink({ url: 'https://aionui.com/docs' })).rejects.toThrow(
      'Unsupported evaOS external link.'
    );
    await expect(openEvaosExternalLink({ url: 'mailto:help@example.test' })).rejects.toThrow(
      'Unsupported evaOS support mailbox.'
    );
    expect(electronMock.shell.openExternal).not.toHaveBeenCalled();
  });
});
