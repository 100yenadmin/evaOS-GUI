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
import ConnectedAppsPage from '@/renderer/pages/connected-apps';

const platformMocks = vi.hoisted(() => ({
  openEvaosExternalUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  openEvaosExternalUrl: platformMocks.openEvaosExternalUrl,
}));

function renderConnectedApps() {
  return render(
    <ConfigProvider>
      <ConnectedAppsPage />
    </ConfigProvider>
  );
}

describe('ConnectedAppsPage RC handoff', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a production dashboard handoff instead of the unfinished native surface', async () => {
    const user = userEvent.setup();
    renderConnectedApps();

    expect(screen.getByText('Connected Apps')).toBeInTheDocument();
    expect(screen.getByText('Website handoff')).toBeInTheDocument();
    expect(screen.getByText('https://www.electricsheephq.com/dashboard/providers')).toBeInTheDocument();
    expect(screen.getByText(/native Workbench parity is tracked in #262/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Load|Refresh/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/broker request|provider grant|desktop_session/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }));

    await waitFor(() =>
      expect(platformMocks.openEvaosExternalUrl).toHaveBeenCalledWith(
        'https://www.electricsheephq.com/dashboard/providers'
      )
    );
    expect(await screen.findByText('Opened the Electric Sheep dashboard in your browser.')).toBeInTheDocument();
  });
});
