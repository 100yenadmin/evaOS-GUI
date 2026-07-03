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
    window.location.hash = '';
  });

  it('opens first-party evaOS feedback without secret-bearing metadata', async () => {
    window.location.hash = '#/terminal';
    const user = userEvent.setup();
    render(<EvaosSupportBubble />);

    const button = screen.getByRole('button', { name: 'Open evaOS support' });
    expect(button).toHaveAttribute('data-testid', 'evaos-support-bubble');
    expect(button).toBeVisible();

    await user.click(button);

    expect(feedbackMocks.openFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'evaos-support',
        autoScreenshot: true,
        tags: expect.objectContaining({
          evaos_product: 'workbench_beta',
          evaos_route: '/terminal',
          evaos_state: 'support_requested',
          support_surface: 'evaos_beta_bubble',
        }),
        extra: expect.objectContaining({
          app_version: expect.any(String),
          audit_ids: [],
          bundle_id: 'com.evaos.workbench',
          customer: expect.objectContaining({
            roles: [],
            scopes: [],
            summary: 'Use the route-level report action when customer or broker audit context is visible.',
          }),
          product: 'evaOS Workbench',
          protocol_scheme: 'evaos-workbench',
          route: '/terminal',
          screenshot: {
            auto_capture_requested: true,
            user_can_attach_more: true,
          },
          settled_state: 'support_requested',
          support_packet_version: 'evaos.support_report.v1',
          surface: 'evaos_beta_bubble',
        }),
      })
    );
    expect(JSON.stringify(feedbackMocks.openFeedback.mock.calls[0][0])).not.toMatch(
      /desktop_session|eds_|Bearer|token=/i
    );
  });
});
