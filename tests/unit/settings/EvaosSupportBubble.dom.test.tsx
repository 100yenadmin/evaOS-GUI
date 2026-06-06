import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EvaosSupportBubble from '@/renderer/components/base/EvaosSupportBubble';

const feedbackMocks = vi.hoisted(() => ({
  openFeedback: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({
  useFeedback: () => ({
    openFeedback: feedbackMocks.openFeedback,
  }),
}));

describe('EvaosSupportBubble', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens first-party evaOS feedback without secret-bearing metadata', async () => {
    const user = userEvent.setup();
    render(<EvaosSupportBubble />);

    await user.click(screen.getByRole('button', { name: 'Open evaOS support' }));

    expect(feedbackMocks.openFeedback).toHaveBeenCalledWith({
      module: 'other',
      autoScreenshot: true,
      tags: {
        support_surface: 'evaos_beta_bubble',
      },
      extra: {
        route: expect.any(String),
        product: 'evaOS Workbench Beta',
      },
    });
  });
});
