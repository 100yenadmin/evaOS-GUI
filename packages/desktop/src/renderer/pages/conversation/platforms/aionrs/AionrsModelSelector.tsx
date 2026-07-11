/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AionrsModelSelection } from './useAionrsModelSelection';
import {
  RUNTIME_SELECTOR_MENU_CLASS_NAME,
  type RuntimeSelectorModelGroup,
  useRuntimeSelectorModelMenu,
} from '@/renderer/components/agent/runtimeSelectorOptions';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { getModelDisplayLabel } from '@/renderer/utils/model/agentLogo';
import { iconColors } from '@/renderer/styles/colors';
import { Button, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import { Brain, Down } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';

/** Collision-safe key for mapping shared model rows back to AionRS provider/model pairs. */
const providerModelKey = (providerId: string, modelName: string): string => JSON.stringify([providerId, modelName]);

const AionrsModelSelector: React.FC<{
  selection?: AionrsModelSelection;
  disabled?: boolean;
}> = ({ selection, disabled = false }) => {
  const { t } = useTranslation();
  const { isOpen: isPreviewOpen } = usePreviewContext();
  const layout = useLayoutContext();
  const compact = isPreviewOpen || layout?.isMobile;
  const isMobileHeaderCompact = Boolean(layout?.isMobile);
  const defaultModelLabel = t('common.defaultModel');

  const current_model = selection?.current_model;
  const providers = selection?.providers ?? [];
  const modelGroups: RuntimeSelectorModelGroup[] = [];
  const modelLookup = new Map<string, { provider: (typeof providers)[number]; modelName: string }>();

  for (const provider of providers) {
    const availableModels = selection?.getAvailableModels(provider) ?? [];
    if (!availableModels.length) continue;
    modelGroups.push({
      key: provider.id,
      title: provider.name,
      models: availableModels.map((modelName) => {
        const id = providerModelKey(provider.id, modelName);
        modelLookup.set(id, { provider, modelName });
        return { id, label: modelName };
      }),
    });
  }

  const currentModelId = current_model?.use_model
    ? providerModelKey(current_model.id, current_model.use_model)
    : undefined;
  const modelMenu = useRuntimeSelectorModelMenu({
    groups: modelGroups,
    currentModelId,
    onSelect: (id) => {
      const entry = modelLookup.get(id);
      if (entry && selection) void selection.handleSelectModel(entry.provider, entry.modelName);
    },
  });

  const renderLogo = () => <Brain theme='outline' size='14' fill={iconColors.secondary} className='shrink-0' />;

  if (disabled || !selection) {
    return (
      <Tooltip content={t('conversation.welcome.modelSwitchNotSupported')} position='top'>
        <Button
          className={classNames(
            'sendbox-model-btn header-model-btn',
            compact && '!max-w-[120px]',
            isMobileHeaderCompact && '!max-w-[160px]'
          )}
          shape='round'
          size='small'
          style={{ cursor: 'default' }}
        >
          <span className='flex items-center gap-6px min-w-0'>
            {renderLogo()}
            <span className={compact ? 'block truncate' : undefined}>{t('conversation.welcome.useCliModel')}</span>
          </span>
        </Button>
      </Tooltip>
    );
  }

  const label = getModelDisplayLabel({
    selected_value: current_model?.use_model,
    selectedLabel: current_model?.use_model || '',
    defaultModelLabel,
    fallbackLabel: t('conversation.welcome.selectModel'),
  });

  return (
    <Dropdown
      trigger='click'
      // Mobile: portal the popup to <body> so it escapes the titlebar slot.
      // Desktop: leave default container so click events reach Menu.Item normally.
      {...(isMobileHeaderCompact ? { getPopupContainer: () => document.body } : {})}
      droplist={<Menu className={RUNTIME_SELECTOR_MENU_CLASS_NAME}>{modelMenu}</Menu>}
    >
      <Button
        data-testid='aionrs-model-selector'
        className={classNames(
          'sendbox-model-btn header-model-btn',
          compact && '!max-w-[120px]',
          isMobileHeaderCompact && '!max-w-[160px]'
        )}
        shape='round'
        size='small'
      >
        <span className='flex items-center gap-6px min-w-0'>
          {renderLogo()}
          <span className={compact ? 'block truncate' : undefined}>{label}</span>
          <Down theme='outline' size={12} fill={iconColors.secondary} className='shrink-0' />
        </span>
      </Button>
    </Dropdown>
  );
};

export default AionrsModelSelector;
