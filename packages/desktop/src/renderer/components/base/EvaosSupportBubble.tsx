/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import { Comment } from '@icon-park/react';
import { useFeedback } from '@/renderer/hooks/context/FeedbackContext';

const EvaosSupportBubble: React.FC = () => {
  const { openFeedback } = useFeedback();

  const handleClick = useCallback(() => {
    openFeedback({
      module: 'other',
      autoScreenshot: true,
      tags: {
        support_surface: 'evaos_beta_bubble',
      },
      extra: {
        route: window.location.hash || window.location.pathname,
        product: 'evaOS Workbench Beta',
      },
    }).catch((error) => {
      console.error('[EvaosSupportBubble] Failed to open feedback:', error);
    });
  }, [openFeedback]);

  return (
    <button
      type='button'
      aria-label='Open evaOS support'
      title='Open evaOS support'
      data-testid='evaos-support-bubble'
      className='fixed bottom-18px right-18px z-80 flex size-46px items-center justify-center rounded-full border border-solid border-[var(--color-border-2)] bg-[rgb(var(--primary-6))] text-white shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--primary-4))]'
      onClick={handleClick}
    >
      <Comment theme='outline' size='22' fill='currentColor' />
    </button>
  );
};

export default EvaosSupportBubble;
