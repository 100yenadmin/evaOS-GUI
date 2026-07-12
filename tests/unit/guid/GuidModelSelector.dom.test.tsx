/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import GuidModelSelector from '@/renderer/pages/guid/components/GuidModelSelector';
import type { AcpModelInfo } from '@/renderer/pages/guid/types';
import type { AcpDerivedOption } from '@/renderer/hooks/agent/useAcpConfigOptions';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  providerConfig: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({ data: mocks.providerConfig }),
}));

vi.mock('@/renderer/pages/guid/utils/modelUtils', () => ({
  getAvailableModels: (provider: { models?: string[] }) => provider.models ?? [],
}));

vi.mock('@/renderer/styles/colors', () => ({
  iconColors: { secondary: 'currentColor' },
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  getModelDisplayLabel: ({
    selected_value,
    selectedLabel,
    defaultModelLabel,
    fallbackLabel,
  }: {
    selected_value?: string | null;
    selectedLabel?: string | null;
    defaultModelLabel: string;
    fallbackLabel: string;
  }) => {
    if (!selectedLabel) return fallbackLabel;
    const text = `${selected_value || ''} ${selectedLabel}`.toLowerCase();
    return text.includes('default') || text.includes('recommended') || text.includes('默认')
      ? defaultModelLabel
      : selectedLabel;
  },
}));

vi.mock('@icon-park/react', () => ({
  Brain: () => <span aria-hidden='true'>brain</span>,
  Down: () => <span aria-hidden='true'>down</span>,
  Plus: () => <span aria-hidden='true'>plus</span>,
  Search: () => <span aria-hidden='true'>search</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
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
    Dropdown: ({ children, droplist }: { children?: React.ReactNode; droplist?: React.ReactNode }) => (
      <div>
        {children}
        {droplist}
      </div>
    ),
    Input,
    Menu,
    Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

const providerList = [
  { id: 'provider-a', name: 'Provider A', enabled: true, models: ['shared', 'alpha-2', 'alpha-3', 'alpha-4'] },
  { id: 'provider-b', name: 'Provider B', enabled: true, models: ['shared', 'beta-2', 'beta-3'] },
  { id: 'provider-disabled', name: 'Disabled Provider', enabled: false, models: ['disabled-model'] },
] as IProvider[];

const baseProps = () => ({
  isGeminiMode: true,
  modelList: providerList,
  current_model: { ...providerList[1], use_model: 'shared' } as TProviderWithModel,
  setCurrentModel: vi.fn().mockResolvedValue(undefined),
  currentAcpCachedModelInfo: null,
  selectedAcpModel: null,
  setSelectedAcpModel: vi.fn(),
  thoughtLevelOption: null,
  onThoughtLevelSelect: vi.fn(),
});

describe('GuidModelSelector desktop menus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.providerConfig = [
      {
        id: 'acp-health-fixture',
        platform: '',
        model_health: { 'model-2': { status: 'healthy' } },
      },
      {
        id: 'provider-a',
        platform: 'openai',
        model_health: { 'alpha-4': { status: 'healthy' } },
      },
      { id: 'provider-b', platform: 'anthropic', model_health: { 'beta-3': { status: 'unhealthy' } } },
    ];
  });

  it('searches enabled provider groups, preserves health, and routes model/add-model actions', () => {
    const props = baseProps();
    render(<GuidModelSelector {...props} />);

    expect(screen.queryByRole('group', { name: 'Disabled Provider' })).not.toBeInTheDocument();
    const selected = within(screen.getByRole('group', { name: 'Provider B' }))
      .getByText('shared')
      .closest('[role="menuitem"]');
    expect(selected).toHaveAttribute('aria-current', 'true');
    fireEvent.click(selected!);
    expect(props.setCurrentModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'provider-b', use_model: 'shared' })
    );
    props.setCurrentModel.mockClear();

    const search = screen.getByTestId('runtime-selector-model-search');
    fireEvent.change(search, { target: { value: 'BETA-3' } });
    const beta3 = screen.getByText('beta-3');
    expect(beta3.parentElement?.querySelector('.bg-red-500')).not.toBeNull();
    fireEvent.click(beta3);
    expect(props.setCurrentModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'provider-b', use_model: 'beta-3' })
    );

    fireEvent.click(screen.getByText('settings.addModel'));
    expect(mocks.navigate).toHaveBeenCalledWith('/settings/model');
  });

  it('keeps small provider lists grouped without adding search', () => {
    const props = baseProps();
    render(
      <GuidModelSelector
        {...props}
        modelList={
          [{ id: 'provider-a', name: 'Provider A', enabled: true, models: ['alpha-1', 'alpha-2'] }] as IProvider[]
        }
        current_model={{ id: 'provider-a', use_model: 'alpha-1' } as TProviderWithModel}
      />
    );

    expect(screen.queryByTestId('runtime-selector-model-search')).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Provider A' })).getByText('alpha-2')).toBeInTheDocument();
  });

  it('clears a stale provider search when the model source changes to a small list', () => {
    const props = baseProps();
    const { rerender } = render(<GuidModelSelector {...props} />);

    fireEvent.change(screen.getByTestId('runtime-selector-model-search'), { target: { value: 'beta-3' } });
    expect(screen.getByText('beta-3')).toBeInTheDocument();

    rerender(
      <GuidModelSelector
        {...props}
        modelList={
          [{ id: 'provider-c', name: 'Provider C', enabled: true, models: ['gamma-1', 'gamma-2'] }] as IProvider[]
        }
        current_model={{ id: 'provider-c', use_model: 'gamma-1' } as TProviderWithModel}
      />
    );

    expect(screen.queryByTestId('runtime-selector-model-search')).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Provider C' })).getByText('gamma-2')).toBeInTheDocument();
    expect(screen.queryByText('agent.model.noResults')).not.toBeInTheDocument();
  });

  it('keeps the no-model recovery menu when no enabled provider has models', () => {
    const props = baseProps();
    render(<GuidModelSelector {...props} modelList={[]} current_model={undefined} />);

    expect(screen.getByText('settings.noAvailableModels')).toBeInTheDocument();
    fireEvent.click(screen.getByText('settings.addModel'));
    expect(mocks.navigate).toHaveBeenCalledWith('/settings/model');
  });

  it('searches ACP cached models, preserves selection/health, and routes the cached model id', () => {
    const setSelectedAcpModel = vi.fn();
    const available_models = Array.from({ length: 6 }, (_, index) => ({
      id: `model-${index + 1}`,
      label: `Model ${index + 1}`,
    }));
    const info: AcpModelInfo = {
      current_model_id: 'model-1',
      current_model_label: 'Model 1',
      available_models,
    };

    render(
      <GuidModelSelector
        {...baseProps()}
        isGeminiMode={false}
        currentAcpCachedModelInfo={info}
        selectedAcpModel='model-1'
        setSelectedAcpModel={setSelectedAcpModel}
      />
    );

    expect(within(screen.getByRole('menu')).getByText('Model 1').closest('[role="menuitem"]')).toHaveAttribute(
      'aria-current',
      'true'
    );
    const search = screen.getByTestId('runtime-selector-model-search');
    fireEvent.change(search, { target: { value: 'MODEL-2' } });
    const model2 = screen.getByText('Model 2');
    expect(model2.parentElement?.querySelector('.bg-green-500')).not.toBeNull();
    fireEvent.click(model2);
    expect(setSelectedAcpModel).toHaveBeenCalledWith('model-2');
  });

  it('shows and routes compatible thought-level choices alongside ACP models', () => {
    const onThoughtLevelSelect = vi.fn();
    const thoughtLevelOption: AcpDerivedOption = {
      id: 'reasoning_effort',
      category: 'thought_level',
      currentValue: 'medium',
      options: [
        { value: 'medium', label: 'Balanced' },
        { value: 'high', label: 'High' },
      ],
    };
    const info: AcpModelInfo = {
      current_model_id: 'model-1',
      current_model_label: 'Model 1',
      available_models: [{ id: 'model-1', label: 'Model 1' }],
    };

    render(
      <GuidModelSelector
        {...baseProps()}
        isGeminiMode={false}
        currentAcpCachedModelInfo={info}
        selectedAcpModel='model-1'
        thoughtLevelOption={thoughtLevelOption}
        onThoughtLevelSelect={onThoughtLevelSelect}
      />
    );

    expect(screen.getByRole('button')).toHaveTextContent('Model 1 · Balanced');
    expect(screen.getByRole('group', { name: 'agent.thoughtLevel.label' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('High'));
    expect(onThoughtLevelSelect).toHaveBeenCalledWith('high');
  });

  it('shows thought-level choices when the ACP runtime has no switchable models', () => {
    const onThoughtLevelSelect = vi.fn();
    const thoughtLevelOption: AcpDerivedOption = {
      id: 'reasoning_effort',
      category: 'thought_level',
      currentValue: 'medium',
      options: [
        { value: 'medium', label: 'Balanced' },
        { value: 'high', label: 'High' },
      ],
    };

    render(
      <GuidModelSelector
        {...baseProps()}
        isGeminiMode={false}
        currentAcpCachedModelInfo={null}
        thoughtLevelOption={thoughtLevelOption}
        onThoughtLevelSelect={onThoughtLevelSelect}
      />
    );

    expect(screen.getByRole('button')).toHaveTextContent('common.defaultModel · Balanced');
    expect(screen.getByRole('group', { name: 'agent.thoughtLevel.label' })).toBeInTheDocument();
    expect(screen.queryByTestId('runtime-selector-menu-divider')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('High'));
    expect(onThoughtLevelSelect).toHaveBeenCalledWith('high');
  });
});
