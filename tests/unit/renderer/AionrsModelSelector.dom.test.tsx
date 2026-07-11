/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider } from '@/common/config/storage';
import AionrsModelSelector from '@/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector';
import type { AionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isMobile: false,
  dropdownProps: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ isOpen: false }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: mocks.isMobile }),
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  getModelDisplayLabel: ({ selectedLabel, fallbackLabel }: { selectedLabel?: string; fallbackLabel: string }) =>
    selectedLabel || fallbackLabel,
}));

vi.mock('@/renderer/styles/colors', () => ({
  iconColors: { secondary: 'currentColor' },
}));

vi.mock('@icon-park/react', () => ({
  Brain: () => <span aria-hidden='true'>brain</span>,
  Down: () => <span aria-hidden='true'>down</span>,
  Search: () => <span aria-hidden='true'>search</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@arco-design/web-react', () => {
  const MenuRoot = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div role='menu' className={className}>
      {children}
    </div>
  );
  const Menu = Object.assign(MenuRoot, {
    Item: ({
      children,
      onClick,
      disabled,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & { disabled?: boolean }) => (
      <div role='menuitem' aria-disabled={disabled || undefined} onClick={disabled ? undefined : onClick} {...props}>
        {children}
      </div>
    ),
    ItemGroup: ({
      children,
      title,
      className,
    }: {
      children?: React.ReactNode;
      title?: React.ReactNode;
      className?: string;
    }) => (
      <div role='group' aria-label={typeof title === 'string' ? title : undefined} className={className}>
        {title}
        {children}
      </div>
    ),
  });
  const Input = ({
    prefix,
    onChange,
    ref,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & {
    prefix?: React.ReactNode;
    ref?: React.Ref<HTMLInputElement>;
    onChange?: (value: string, event: React.ChangeEvent<HTMLInputElement>) => void;
  }) => (
    <span>
      {prefix}
      <input {...props} ref={ref} onChange={(event) => onChange?.(event.target.value, event)} />
    </span>
  );

  return {
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    Dropdown: ({
      children,
      droplist,
      ...props
    }: {
      children?: React.ReactNode;
      droplist?: React.ReactNode;
      getPopupContainer?: () => HTMLElement;
    }) => {
      mocks.dropdownProps(props);
      return (
        <div>
          {children}
          {droplist}
        </div>
      );
    },
    Input,
    Menu,
    Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

const providers = [
  { id: 'provider-a', name: 'Provider A' },
  { id: 'provider-b', name: 'Provider B' },
  { id: 'provider-empty', name: 'Empty Provider' },
] as IProvider[];

const modelsByProvider: Record<string, string[]> = {
  'provider-a': ['alpha-1', 'alpha-2', 'alpha-3', 'alpha-4'],
  'provider-b': ['beta-1', 'beta-2', 'beta-3'],
  'provider-empty': [],
};

const makeSelection = (): AionrsModelSelection => ({
  current_model: { id: 'provider-b', use_model: 'beta-2' } as AionrsModelSelection['current_model'],
  providers,
  getAvailableModels: (provider) => modelsByProvider[provider.id] ?? [],
  handleSelectModel: vi.fn().mockResolvedValue(undefined),
  getDisplayModelName: (modelName) => modelName ?? '',
});

describe('AionrsModelSelector', () => {
  beforeEach(() => {
    mocks.isMobile = false;
    mocks.dropdownProps.mockClear();
  });

  it('searches available models across providers and maps selection back to its provider', () => {
    const selection = makeSelection();
    render(<AionrsModelSelector selection={selection} />);

    expect(screen.queryByRole('group', { name: 'Empty Provider' })).not.toBeInTheDocument();
    const selectedItem = within(screen.getByRole('group', { name: 'Provider B' }))
      .getByText('beta-2')
      .closest('[role="menuitem"]');
    expect(selectedItem).toHaveAttribute('aria-current', 'true');

    const search = screen.getByTestId('runtime-selector-model-search');
    expect(search).toHaveAccessibleName('Search models');
    fireEvent.change(search, { target: { value: 'ALPHA-4' } });

    expect(screen.getByText('alpha-4')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Provider B' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('alpha-4'));
    expect(selection.handleSelectModel).toHaveBeenCalledWith(providers[0], 'alpha-4');
  });

  it('preserves unsupported and mobile popup behavior', () => {
    const { rerender } = render(<AionrsModelSelector disabled selection={makeSelection()} />);
    expect(screen.queryByTestId('aionrs-model-selector')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    mocks.isMobile = true;
    rerender(<AionrsModelSelector selection={makeSelection()} />);
    const popupContainer = mocks.dropdownProps.mock.lastCall?.[0]?.getPopupContainer as (() => HTMLElement) | undefined;
    expect(popupContainer?.()).toBe(document.body);
  });
});
