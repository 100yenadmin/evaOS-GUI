/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MODEL_SEARCH_THRESHOLD,
  RuntimeSelectorSubMenuTitle,
  useRuntimeSelectorModelMenu,
} from '@/renderer/components/agent/runtimeSelectorOptions';
import { Menu } from '@arco-design/web-react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@icon-park/react', () => ({
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
    Input,
    Menu,
    Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

const models = Array.from({ length: MODEL_SEARCH_THRESHOLD + 2 }, (_, index) => ({
  id: `model-${index}`,
  label: `Model ${index}`,
}));

type ModelMenuProps = Parameters<typeof useRuntimeSelectorModelMenu>[0];

const RuntimeSelectorModelMenuHarness: React.FC<ModelMenuProps> = (props) => {
  const modelMenu = useRuntimeSelectorModelMenu(props);
  return <Menu>{modelMenu}</Menu>;
};

describe('runtime selector options', () => {
  it('renders a compact submenu title with its current value', () => {
    render(<RuntimeSelectorSubMenuTitle label='Model' value='GPT-5.2' />);

    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('GPT-5.2')).toBeInTheDocument();
  });

  it('shows search only above the threshold and filters by label or ID', () => {
    const { rerender } = render(
      <RuntimeSelectorModelMenuHarness models={models.slice(0, MODEL_SEARCH_THRESHOLD)} onSelect={vi.fn()} />
    );
    expect(screen.queryByTestId('runtime-selector-model-search')).not.toBeInTheDocument();

    rerender(<RuntimeSelectorModelMenuHarness models={models} onSelect={vi.fn()} />);
    const search = screen.getByTestId('runtime-selector-model-search');
    expect(search).toHaveAccessibleName('Search models');
    fireEvent.change(search, { target: { value: 'MODEL-6' } });

    expect(screen.getByText('Model 6')).toBeInTheDocument();
    expect(screen.queryByText('Model 5')).not.toBeInTheDocument();
  });

  it('filters across provider groups and renders an empty state', () => {
    render(
      <RuntimeSelectorModelMenuHarness
        groups={[
          { key: 'a', title: 'Provider A', models: models.slice(0, 4) },
          { key: 'b', title: 'Provider B', models: models.slice(4) },
        ]}
        onSelect={vi.fn()}
      />
    );

    const search = screen.getByTestId('runtime-selector-model-search');
    fireEvent.change(search, { target: { value: 'Model 5' } });
    expect(screen.queryByRole('group', { name: 'Provider A' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Provider B' })).getByText('Model 5')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'missing' } });
    expect(screen.getByText('No matching models')).toBeInTheDocument();
  });

  it('preserves selection and global disabled semantics', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <RuntimeSelectorModelMenuHarness models={models.slice(0, 2)} currentModelId='model-0' onSelect={onSelect} />
    );

    const selectedItem = screen.getByText('Model 0').closest('[role="menuitem"]');
    expect(selectedItem?.textContent?.trim().startsWith('✓')).toBe(true);
    expect(selectedItem).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByText('Model 1'));
    expect(onSelect).toHaveBeenCalledWith('model-1');

    onSelect.mockClear();
    rerender(<RuntimeSelectorModelMenuHarness models={models.slice(0, 2)} disabled onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Model 1'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('announces and displays the selected model inside provider groups', () => {
    render(
      <RuntimeSelectorModelMenuHarness
        groups={[
          { key: 'a', title: 'Provider A', models: models.slice(0, 2) },
          { key: 'b', title: 'Provider B', models: models.slice(2, 4) },
        ]}
        currentModelId='model-2'
        onSelect={vi.fn()}
      />
    );

    const selectedItem = within(screen.getByRole('group', { name: 'Provider B' }))
      .getByText('Model 2')
      .closest('[role="menuitem"]');
    expect(selectedItem?.textContent?.trim().startsWith('✓')).toBe(true);
    expect(selectedItem).toHaveAttribute('aria-current', 'true');
  });
});
