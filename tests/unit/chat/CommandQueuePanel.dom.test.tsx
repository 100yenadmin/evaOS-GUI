/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationCommandQueueItem } from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import CommandQueuePanel from '@/renderer/components/chat/CommandQueuePanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

const confirmMock = vi.fn();

vi.mock('@arco-design/web-react', () => {
  const Button = ({
    children,
    ...props
  }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement> & { status?: string }>) => (
    <button type='button' {...props}>
      {children}
    </button>
  );
  const Dropdown = ({ children, droplist }: React.PropsWithChildren<{ droplist: React.ReactNode }>) => (
    <div>
      {children}
      {droplist}
    </div>
  );
  const Menu = ({ children }: React.PropsWithChildren) => <div>{children}</div>;
  Menu.Item = ({
    children,
    onClick,
  }: React.PropsWithChildren<{
    onClick?: () => void;
  }>) => (
    <button type='button' onClick={onClick}>
      {children}
    </button>
  );
  const Typography = {
    Ellipsis: ({ children, ...props }: React.PropsWithChildren) => <span {...props}>{children}</span>,
  };
  const Tooltip = ({ children }: React.PropsWithChildren) => <>{children}</>;
  const Modal = {
    confirm: (config: { onOk?: () => void }) => confirmMock(config),
  };
  return { Button, Dropdown, Menu, Modal, Tooltip, Typography };
});

vi.mock('@icon-park/react', () => ({
  CornerDownRight: () => <span data-testid='corner-down-right-icon' />,
  Delete: () => <span data-testid='delete-icon' />,
  Drag: () => <span data-testid='drag-icon' />,
  Edit: () => <span data-testid='edit-icon' />,
  Inbox: () => <span data-testid='inbox-icon' />,
  SortTwo: () => <span data-testid='sort-two-icon' />,
  MoreOne: () => <span data-testid='more-icon' />,
  SendOne: () => <span data-testid='send-icon' />,
}));

const item: ConversationCommandQueueItem = {
  id: 'queued-1',
  input: 'queued follow-up',
  files: [],
  created_at: 1,
};

const secondItem: ConversationCommandQueueItem = {
  id: 'queued-2',
  input: 'second queued follow-up',
  files: [],
  created_at: 2,
};

const renderPanel = (overrides: Partial<React.ComponentProps<typeof CommandQueuePanel>> = {}) => {
  const props: React.ComponentProps<typeof CommandQueuePanel> = {
    items: [item],
    mode: 'auto',
    paused: false,
    interactionLocked: false,
    onPause: vi.fn(),
    onResume: vi.fn(),
    onInteractionLock: vi.fn(),
    onInteractionUnlock: vi.fn(),
    onEdit: vi.fn(),
    onSendNow: vi.fn(),
    onToggleMode: vi.fn(),
    onReorder: vi.fn(),
    onRemove: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };

  render(<CommandQueuePanel {...props} />);
  return props;
};

describe('CommandQueuePanel', () => {
  it('renders the three per-item actions: send now, edit, remove', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: 'Send now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('wires send now, edit and remove callbacks per item', () => {
    const onSendNow = vi.fn();
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    renderPanel({ onSendNow, onEdit, onRemove });

    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onSendNow).toHaveBeenCalledExactlyOnceWith(item);
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(item);
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('queued-1');
  });

  it('shows the current mode and toggles it', () => {
    const onToggleMode = vi.fn();
    renderPanel({ mode: 'auto', onToggleMode });

    const toggle = screen.getByRole('button', { name: 'Toggle send mode' });
    expect(toggle).toHaveTextContent('Auto');
    fireEvent.click(toggle);
    expect(onToggleMode).toHaveBeenCalledTimes(1);
  });

  it('renders the manual label when in manual mode', () => {
    renderPanel({ mode: 'manual' });
    expect(screen.getByRole('button', { name: 'Toggle send mode' })).toHaveTextContent('Manual');
  });

  it('preserves paused failure recovery through an explicit resume action', () => {
    const onResume = vi.fn();
    renderPanel({ paused: true, onResume });

    fireEvent.click(screen.getByRole('button', { name: 'Resume queue' }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('keeps mobile rows scrollable and exposes one functional drag handle', () => {
    renderPanel({ isMobile: true });

    const row = screen.getByLabelText('queued follow-up');
    const dragHandle = screen.getByRole('button', { name: 'Drag to reorder queued command' });

    expect(row).not.toHaveAttribute('role', 'button');
    expect(row).not.toHaveStyle({ touchAction: 'none' });
    expect(dragHandle).toHaveAttribute('data-drag-handle', 'enabled');
    expect(dragHandle).toHaveStyle({ touchAction: 'none' });
    expect(dragHandle).toHaveClass('min-h-44px', 'min-w-44px');
    expect(dragHandle).toHaveStyle({ left: '0' });
    expect(dragHandle.parentElement).toHaveClass('h-44px', 'w-44px');
    expect(row).toHaveClass('min-h-44px');
  });

  it('activates and cancels sorting from the keyboard drag handle', async () => {
    const props = renderPanel({ items: [item, secondItem] });

    const handles = screen.getAllByRole('button', { name: 'Drag to reorder queued command' });
    handles[0].focus();
    fireEvent.keyDown(handles[0], { key: ' ', code: 'Space' });
    await waitFor(() => expect(props.onInteractionLock).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(handles[0], { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(props.onInteractionUnlock).toHaveBeenCalledTimes(1));
  });

  it('does not render a separate help button (help lives on the mode toggle)', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument();
  });

  it('clears the draft box through a confirm dialog', () => {
    confirmMock.mockReset();
    const onClear = vi.fn();
    renderPanel({ onClear });

    fireEvent.click(screen.getByRole('button', { name: 'Clear draft box' }));
    // Clearing must go through a confirm step, not fire immediately.
    expect(onClear).not.toHaveBeenCalled();
    expect(confirmMock).toHaveBeenCalledTimes(1);

    // Simulate the user confirming.
    const config = confirmMock.mock.calls[0][0] as { onOk?: () => void };
    config.onOk?.();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
