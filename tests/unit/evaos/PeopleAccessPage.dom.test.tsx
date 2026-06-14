/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PeopleAccessPage from '@/renderer/pages/people-access';

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

describe('PeopleAccessPage', () => {
  it('uses the controlled-RC dashboard handoff instead of the unfinished native view', () => {
    render(<PeopleAccessPage />);

    expect(screen.getByRole('heading', { name: 'People & Access' })).toBeInTheDocument();
    expect(screen.getByText('Team permissions')).toBeInTheDocument();
    expect(screen.getByText('Website handoff')).toBeInTheDocument();
    expect(screen.getByText('https://www.electricsheephq.com/dashboard/invites')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open dashboard/i })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /^load$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^send invite$/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('email@company.com')).not.toBeInTheDocument();
    expect(screen.queryByText(/selected evaOS customer|route denied|seat limit/i)).not.toBeInTheDocument();
  });
});
