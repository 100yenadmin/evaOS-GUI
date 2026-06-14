/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ConnectedAppsPage from '@/renderer/pages/connected-apps';

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

describe('ConnectedAppsPage', () => {
  it('uses the controlled-RC dashboard handoff instead of the unfinished native view', () => {
    render(<ConnectedAppsPage />);

    expect(screen.getByRole('heading', { name: 'Connected Apps' })).toBeInTheDocument();
    expect(screen.getByText('Provider access')).toBeInTheDocument();
    expect(screen.getByText('Website handoff')).toBeInTheDocument();
    expect(screen.getByText('https://www.electricsheephq.com/dashboard/providers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open dashboard/i })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /^load$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^connect$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/brokered grant|route denied|selected evaOS customer/i)).not.toBeInTheDocument();
  });
});
