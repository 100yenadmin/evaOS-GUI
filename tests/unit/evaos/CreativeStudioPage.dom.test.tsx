/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, render, screen } from '@testing-library/react';
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

describe('CreativeStudioPage RC embedded surface', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('embeds the hosted creative studio surface instead of sending users to an external handoff first', () => {
    renderCreativeStudio();

    const surface = screen.getByTestId('evaos-creative-studio-surface');
    expect(surface).toHaveAttribute('src', 'https://www.comfy.org/cloud');
    expect(surface).toHaveAttribute('partition', 'persist:evaos-creative-studio');
    expect(screen.queryByText('Website handoff')).not.toBeInTheDocument();
    expect(screen.queryByText('https://www.comfy.org/cloud')).not.toBeInTheDocument();
    expect(screen.queryByText(/native broker-owned generation runtime parity/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/broker endpoint was not found/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry|Refresh/i })).not.toBeInTheDocument();
    expect(platformMocks.openEvaosExternalUrl).not.toHaveBeenCalled();
  });
});
