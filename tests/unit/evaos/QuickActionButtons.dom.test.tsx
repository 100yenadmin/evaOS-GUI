/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import QuickActionButtons from '@/renderer/pages/guid/components/QuickActionButtons';

const webuiMocks = vi.hoisted(() => ({
  getStatus: vi.fn(() => Promise.resolve({ running: false })),
  statusChangedOn: vi.fn(() => vi.fn()),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  webui: {
    getStatus: { invoke: webuiMocks.getStatus },
    statusChanged: { on: webuiMocks.statusChangedOn },
  },
}));

vi.mock('@renderer/evaos/evaosBetaShellPolicy', () => ({
  isEvaosBetaWebUISettingsEnabled: () => false,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      if (key === 'conversation.welcome.quickActionFeedback') return 'Report Issue';
      if (key === 'conversation.welcome.quickActionStar') return 'Visit ElectricSheep';
      return options?.defaultValue ?? key;
    },
  }),
}));

function renderQuickActions(overrides?: { onOpenLink?: (url: string) => void; onOpenBugReport?: () => void }) {
  return render(
    <QuickActionButtons
      onOpenLink={overrides?.onOpenLink ?? vi.fn()}
      onOpenBugReport={overrides?.onOpenBugReport ?? vi.fn()}
      inactiveBorderColor='transparent'
      activeShadow='none'
    />
  );
}

describe('QuickActionButtons evaOS release actions', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens the Electric Sheep website from the star quick action', async () => {
    const user = userEvent.setup();
    const onOpenLink = vi.fn();
    renderQuickActions({ onOpenLink });

    await user.click(screen.getByText('Visit ElectricSheep'));

    expect(onOpenLink).toHaveBeenCalledWith('https://www.electricsheephq.com');
  });

  it('keeps report issue in the in-app report flow', async () => {
    const user = userEvent.setup();
    const onOpenBugReport = vi.fn();
    renderQuickActions({ onOpenBugReport });

    await user.click(screen.getByText('Report Issue'));

    expect(onOpenBugReport).toHaveBeenCalledTimes(1);
  });
});
