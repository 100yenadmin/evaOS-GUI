/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpConfigSetStatus, AcpDerivedOption } from '@/renderer/hooks/agent/useAcpConfigOptions';
import AionInlineSearchInput from '@/renderer/components/base/AionInlineSearchInput';
import { Menu, Tooltip } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const MODEL_SEARCH_THRESHOLD = 5;

export const RUNTIME_SUBMENU_TRIGGER_PROPS = { position: 'lt', autoFitPosition: true } as const;

type RuntimeSelectorModel = { id: string; label?: string; description?: string };

export type RuntimeSelectorModelGroup = { key: string; title: string; models: RuntimeSelectorModel[] };

const matchesModelQuery = (model: RuntimeSelectorModel, keyword: string): boolean =>
  [model.label, model.id].some((value) => value?.toLowerCase().includes(keyword));

export const getCurrentThoughtLevelLabel = (thoughtLevel: AcpDerivedOption | null | undefined): string => {
  if (!thoughtLevel) return '';
  return (
    thoughtLevel.options.find((item) => item.value === thoughtLevel.currentValue)?.label ||
    thoughtLevel.currentValue ||
    ''
  );
};

export const composeRuntimeSelectorLabel = ({
  modelLabel,
  thoughtLevel,
}: {
  modelLabel: string;
  thoughtLevel?: AcpDerivedOption | null;
}): string => {
  const thoughtLevelLabel = getCurrentThoughtLevelLabel(thoughtLevel);
  if (!thoughtLevelLabel) return modelLabel;
  return `${modelLabel} · ${thoughtLevelLabel}`;
};

export const isConfigSetting = (setStatus?: AcpConfigSetStatus): boolean => setStatus?.state === 'setting';

export const RuntimeSelectorMenuDivider: React.FC = () => (
  <div role='separator' data-testid='runtime-selector-menu-divider' className='h-1px my-4px bg-[var(--color-fill-3)]' />
);

export const RuntimeSelectorCheckedItem: React.FC<{
  selected: boolean;
  description?: React.ReactNode;
  children: React.ReactNode;
}> = ({ selected, description, children }) => {
  const content = (
    <div className='flex items-center gap-8px w-full min-w-0'>
      <span aria-hidden='true' className='w-16px shrink-0 text-primary'>
        {selected ? '\u2713' : ''}
      </span>
      <span className='min-w-0 truncate'>{children}</span>
    </div>
  );

  return description ? (
    <Tooltip content={description} position='right'>
      {content}
    </Tooltip>
  ) : (
    content
  );
};

export const RuntimeSelectorSubMenuTitle: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className='flex items-center justify-between gap-8px w-full min-w-0'>
    <span className='shrink-0'>{label}</span>
    <span className='min-w-0 truncate text-t-tertiary'>{value}</span>
  </div>
);

export const RuntimeSelectorModelList: React.FC<{
  models?: RuntimeSelectorModel[];
  groups?: RuntimeSelectorModelGroup[];
  currentModelId?: string | null;
  disabled?: boolean;
  onSelect: (modelId: string) => void;
}> = ({ models, groups, currentModelId, disabled = false, onSelect }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const totalCount = groups ? groups.reduce((sum, group) => sum + group.models.length, 0) : (models?.length ?? 0);
  const keyword = query.trim().toLowerCase();
  const searchLabel = t('agent.model.searchPlaceholder', { defaultValue: 'Search models' });

  const filteredModels = useMemo(() => {
    if (!models || !keyword) return models ?? [];
    return models.filter((model) => matchesModelQuery(model, keyword));
  }, [models, keyword]);

  const filteredGroups = useMemo(() => {
    if (!groups) return [];
    return groups
      .map((group) => ({
        ...group,
        models: keyword ? group.models.filter((model) => matchesModelQuery(model, keyword)) : group.models,
      }))
      .filter((group) => group.models.length > 0);
  }, [groups, keyword]);

  const renderRow = (model: RuntimeSelectorModel) => (
    <Menu.Item
      key={model.id}
      className={model.id === currentModelId ? 'bg-2!' : ''}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onSelect(model.id);
      }}
    >
      <RuntimeSelectorCheckedItem selected={model.id === currentModelId} description={model.description}>
        {model.label || model.id}
      </RuntimeSelectorCheckedItem>
    </Menu.Item>
  );

  const isEmpty = groups ? filteredGroups.length === 0 : filteredModels.length === 0;

  return (
    <>
      {totalCount > MODEL_SEARCH_THRESHOLD && (
        <div className='px-6px pt-4px pb-6px' style={{ background: 'var(--color-bg-popup)' }}>
          <AionInlineSearchInput
            value={query}
            onChange={setQuery}
            placeholder={searchLabel}
            data-testid='runtime-selector-model-search'
            inputProps={{ 'aria-label': searchLabel }}
          />
        </div>
      )}
      <div className='runtime-model-scroll max-h-280px overflow-y-auto'>
        {isEmpty ? (
          <div className='px-12px py-10px text-12px text-t-tertiary text-center'>
            {t('agent.model.noResults', { defaultValue: 'No matching models' })}
          </div>
        ) : groups ? (
          filteredGroups.map((group) => (
            <Menu.ItemGroup key={group.key} title={group.title}>
              {group.models.map(renderRow)}
            </Menu.ItemGroup>
          ))
        ) : (
          filteredModels.map(renderRow)
        )}
      </div>
    </>
  );
};

export const renderThoughtLevelMenuGroup = ({
  thoughtLevel,
  setStatus,
  title,
  onSelect,
}: {
  thoughtLevel: AcpDerivedOption | null | undefined;
  setStatus?: AcpConfigSetStatus;
  title: string;
  onSelect: (value: string) => void;
}): React.ReactNode => {
  if (!thoughtLevel) return null;
  const setting = isConfigSetting(setStatus);
  return (
    <Menu.ItemGroup title={title}>
      {thoughtLevel.options.map((item) => (
        <Menu.Item
          key={item.value}
          className={item.value === thoughtLevel.currentValue ? 'bg-2!' : ''}
          onClick={() => {
            if (!setting) onSelect(item.value);
          }}
        >
          <RuntimeSelectorCheckedItem selected={item.value === thoughtLevel.currentValue}>
            {item.label}
          </RuntimeSelectorCheckedItem>
        </Menu.Item>
      ))}
    </Menu.ItemGroup>
  );
};
