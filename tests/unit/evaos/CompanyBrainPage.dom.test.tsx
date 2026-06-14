/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CompanyBrainPage from '@/renderer/pages/company-brain';

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

describe('CompanyBrainPage', () => {
  it('uses a controlled-RC handoff while native Company Brain remains unfinished', () => {
    render(<CompanyBrainPage />);

    expect(screen.getByRole('heading', { name: 'Company Brain' })).toBeInTheDocument();
    expect(screen.getByText('Company intelligence')).toBeInTheDocument();
    expect(screen.getByText('Website handoff')).toBeInTheDocument();
    expect(screen.getByText('https://www.electricsheephq.com/dashboard/company-brain')).toBeInTheDocument();
    expect(screen.getByText(/not yet a finished native Workbench surface/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open dashboard/i })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /^load$/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/ask about accounts/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ingestion|account 360|broker returned/i)).not.toBeInTheDocument();
  });
});
