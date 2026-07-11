/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MODEL_SEARCH_THRESHOLD,
  RuntimeSelectorModelList,
  RuntimeSelectorSubMenuTitle,
} from '@/renderer/components/agent/runtimeSelectorOptions';
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
  const Menu = {
    Item: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
      <div role='menuitem' onClick={onClick}>
        {children}
      </div>
    ),
    ItemGroup: ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => (
      <div role='group' aria-label={String(title)}>
        {children}
      </div>
    ),
  };
  return {
    Menu,
    Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

const models = Array.from({ length: MODEL_SEARCH_THRESHOLD + 2 }, (_, index) => ({
  id: `model-${index}`,
  label: `Model ${index}`,
}));

describe('runtime selector options', () => {
  it('renders a compact submenu title with its current value', () => {
    render(<RuntimeSelectorSubMenuTitle label='Model' value='GPT-5.2' />);

    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('GPT-5.2')).toBeInTheDocument();
  });

  it('shows search only above the threshold and filters by label or ID', () => {
    const { rerender } = render(
      <RuntimeSelectorModelList models={models.slice(0, MODEL_SEARCH_THRESHOLD)} onSelect={vi.fn()} />
    );
    expect(screen.queryByTestId('runtime-selector-model-search')).not.toBeInTheDocument();

    rerender(<RuntimeSelectorModelList models={models} onSelect={vi.fn()} />);
    const search = screen.getByTestId('runtime-selector-model-search');
    expect(search).toHaveAccessibleName('Search models');
    fireEvent.change(search, { target: { value: 'MODEL-6' } });

    expect(screen.getByText('Model 6')).toBeInTheDocument();
    expect(screen.queryByText('Model 5')).not.toBeInTheDocument();
  });

  it('filters across provider groups and renders an empty state', () => {
    render(
      <RuntimeSelectorModelList
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
      <RuntimeSelectorModelList models={models.slice(0, 2)} currentModelId='model-0' onSelect={onSelect} />
    );

    expect(screen.getByText('Model 0').closest('[role="menuitem"]')?.textContent?.trim().startsWith('✓')).toBe(true);
    fireEvent.click(screen.getByText('Model 1'));
    expect(onSelect).toHaveBeenCalledWith('model-1');

    onSelect.mockClear();
    rerender(<RuntimeSelectorModelList models={models.slice(0, 2)} disabled onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Model 1'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
