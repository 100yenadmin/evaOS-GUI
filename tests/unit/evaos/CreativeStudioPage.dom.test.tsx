/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CreativeStudioPage from '@/renderer/pages/creative-studio';

const platformMocks = vi.hoisted(() => ({
  openEvaosExternalUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  openEvaosExternalUrl: platformMocks.openEvaosExternalUrl,
}));

function renderCreativeStudio() {
  return render(
    <ConfigProvider>
      <CreativeStudioPage />
    </ConfigProvider>
  );
}

describe('CreativeStudioPage RC handoff', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a hosted creative studio handoff instead of a missing broker repair state', async () => {
    const user = userEvent.setup();
    renderCreativeStudio();

    expect(screen.getByText('Creative Studio')).toBeInTheDocument();
    expect(screen.getByText('Website handoff')).toBeInTheDocument();
    expect(screen.getByText('https://www.comfy.org/cloud')).toBeInTheDocument();
    expect(screen.getByText(/native broker-owned generation runtime parity is tracked in #272/i)).toBeInTheDocument();
    expect(screen.queryByText(/broker endpoint was not found/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry|Refresh/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open Creative Studio' }));

    await waitFor(() => expect(platformMocks.openEvaosExternalUrl).toHaveBeenCalledWith('https://www.comfy.org/cloud'));
    expect(await screen.findByText('Opened Creative Studio in your browser.')).toBeInTheDocument();
  });
});
