/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import NativeCompanionPage from '@/renderer/pages/native-companion';

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

describe('NativeCompanionPage', () => {
  it('renders native boundary status without granting local trust authority', () => {
    const { container } = render(<NativeCompanionPage />);

    expect(screen.getByText('Mac & iPhone')).toBeInTheDocument();
    expect(screen.getByText('Native companion status matrix')).toBeInTheDocument();
    expect(screen.getByText('Native companion boundary')).toBeInTheDocument();
    expect(screen.getByText('Boundary clean')).toBeInTheDocument();
    expect(screen.getAllByText('Not installed')).toHaveLength(2);
    expect(screen.getAllByText('Not paired')).toHaveLength(2);
    expect(screen.getAllByText('Permission needed')).toHaveLength(2);
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(container.textContent).toContain('AionUi shell is local trust authority: false');
    expect(container.textContent).toContain('Renderer receives native secrets: false');
    expect(container.textContent).toContain('Deep-link scheme: evaos-workbench-beta');
    expect(container.textContent).toContain('Open-native handoff: Open native companion');
    expect(container.textContent).toContain('Handoff target: evaos-workbench-beta://native-companion/status');
    expect(container.textContent).toContain('Handoff owner: evaos-native-companion');
    expect(container.textContent).toContain('Handoff enabled by shell: true');
    expect(container.textContent).toContain('Handoff enabled by shell: false');
    expect(container.textContent).toContain('Status source: native-companion:ready');
    expect(container.textContent).toContain('Renderer receives callback secrets: false');
    expect(container.textContent).toContain('broker session handoff');
    expect(container.textContent).toContain('signed beta passes issue #12 packaging, rollback, and support gates');
    expect(container.textContent).not.toMatch(/eds_|epg_|access_token|desktop[_-]?session|provider_grant|Bearer/i);
  });
});
