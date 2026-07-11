/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IMcpServer, IProvider, TProviderWithModel } from '@/common/config/storage';
import AgentModeSelector from '@/renderer/components/agent/AgentModeSelector';
import MobileActionSheet from '@/renderer/components/chat/MobileActionSheet';
import type {
  MobileActionSheetEntry,
  MobileActionSheetOption,
} from '@/renderer/components/chat/MobileActionSheet/types';
import { useAgentModesForBackend } from '@/renderer/hooks/agent/useAgentModesForBackend';
import { supportsModeSwitch, type AgentModeOption } from '@/renderer/utils/model/agentModes';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { getCleanFileNames, FileService } from '@/renderer/services/FileService';
import { iconColors } from '@/renderer/styles/colors';
import { isElectronDesktop } from '@/renderer/utils/platform';
import type { AcpModelInfo, AvailableAgent } from '../types';
import { getAvailableModels } from '../utils/modelUtils';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import PresetAgentTag, { type AgentSwitcherItem } from './PresetAgentTag';
import { Button, Checkbox, Dropdown, Menu, Message, Tooltip } from '@arco-design/web-react';
import { ArrowUp, Brain, FolderUpload, Lightning, Plus, Shield, UploadOne } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../index.module.css';

type GuidActionRowProps = {
  // File handling
  files: string[];
  onFilesUploaded: (paths: string[]) => void;

  // Model selector node (rendered by parent on desktop)
  modelSelectorNode: React.ReactNode;
  isGeminiMode: boolean;
  modelList: IProvider[];
  current_model?: TProviderWithModel;
  setCurrentModel: (model: TProviderWithModel) => Promise<void>;
  currentAcpCachedModelInfo: AcpModelInfo | null;
  selectedAcpModel: string | null;
  setSelectedAcpModel: (model: string | null) => void;
  onAddModel: () => void;

  // Agent mode
  selectedAgent: string | 'custom';
  effectiveModeAgent?: string;
  selectedMode: string;
  onModeSelect: (mode: string) => void;

  // Preset agent tag
  is_presetAgent: boolean;
  selectedAgentInfo: AvailableAgent | undefined;
  /**
   * Backend-merged preset catalog — drives the preset tag label lookup. Not
   * the ACP engine-config list (custom agents from the AgentRegistry).
   */
  assistants: Assistant[];
  localeKey: string;
  onClosePresetTag: () => void;
  agentLogo?: string | null;
  agentSwitcherItems?: AgentSwitcherItem[];
  onAgentSwitch?: (key: string) => void;
  hidePresetTag?: boolean;

  // Skills management
  allSkills: Array<{ name: string; description: string; isAuto: boolean }>;
  disabledBuiltinSkills: string[];
  enabledSkills: string[];
  onToggleSkill: (name: string, isAuto: boolean) => void;
  mcpServers: IMcpServer[];
  selectedMcpServerIds: string[];
  onToggleMcpServer: (serverId: string) => void;

  // Send button
  loading: boolean;
  isButtonDisabled: boolean;
  speechInputNode?: React.ReactNode;
  onSend: () => void;
};

const GuidActionRow: React.FC<GuidActionRowProps> = ({
  files,
  onFilesUploaded,
  modelSelectorNode,
  isGeminiMode,
  modelList,
  current_model,
  setCurrentModel,
  currentAcpCachedModelInfo,
  selectedAcpModel,
  setSelectedAcpModel,
  onAddModel,
  selectedAgent,
  effectiveModeAgent,
  selectedMode,
  onModeSelect,
  is_presetAgent,
  selectedAgentInfo,
  assistants,
  localeKey,
  onClosePresetTag,
  agentLogo,
  agentSwitcherItems,
  onAgentSwitch,
  allSkills,
  disabledBuiltinSkills,
  enabledSkills,
  onToggleSkill,
  mcpServers,
  selectedMcpServerIds,
  onToggleMcpServer,
  hidePresetTag = false,
  loading,
  isButtonDisabled,
  speechInputNode,
  onSend,
}) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [isPlusDropdownOpen, setIsPlusDropdownOpen] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const modeBackend = effectiveModeAgent || selectedAgent;
  const availableModeOptions = useAgentModesForBackend(modeBackend);
  const showModeSwitch = supportsModeSwitch(modeBackend);
  const configOptionCount = (modelSelectorNode ? 1 : 0) + (showModeSwitch ? 1 : 0);

  // Browser file picker ref (WebUI only)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!isMobile) setIsSheetOpen(false);
  }, [isMobile]);

  const handleLocalFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      setUploading(true);
      try {
        const processed = await FileService.processDroppedFiles(fileList);
        if (processed.length > 0) {
          onFilesUploaded(processed.map((f) => f.path));
        }
      } catch {
        Message.error(t('common.fileAttach.failed'));
      } finally {
        setUploading(false);
      }
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [onFilesUploaded, t]
  );

  const getModeDisplayLabel = (mode: AgentModeOption): string =>
    t(`agentMode.${mode.value}`, { defaultValue: mode.label });

  const isWebUI = !isElectronDesktop();

  const isSkillChecked = (skill: { name: string; isAuto: boolean }) =>
    skill.isAuto ? !disabledBuiltinSkills.includes(skill.name) : enabledSkills.includes(skill.name);

  const activeSkillCount = allSkills.filter(isSkillChecked).length;
  const activeMcpCount = selectedMcpServerIds.length;

  const openHostFilePicker = useCallback(() => {
    ipcBridge.dialog.showOpen
      .invoke({ properties: ['openFile', 'multiSelections'] })
      .then((uploadedFiles) => {
        if (uploadedFiles && uploadedFiles.length > 0) {
          onFilesUploaded(uploadedFiles);
        }
      })
      .catch((error) => {
        console.error('Failed to open file dialog:', error);
      });
  }, [onFilesUploaded]);

  const sheetEntries = useMemo<MobileActionSheetEntry[]>(() => {
    if (!isMobile) return [];

    const entries: MobileActionSheetEntry[] = [];
    let modelOptions: MobileActionSheetOption[] = [];
    let currentModelLabel = '';
    let onModelSelect: (key: string) => void = () => undefined;

    if (isGeminiMode) {
      const enabledProviders = modelList.filter((provider) => provider.enabled !== false);
      const modelTargets = new Map<string, { provider: IProvider; modelName: string }>();
      modelOptions = enabledProviders.flatMap((provider, providerIndex) =>
        getAvailableModels(provider).map((modelName, modelIndex) => {
          const key = `provider-model-${providerIndex}-${modelIndex}`;
          modelTargets.set(key, { provider, modelName });
          return {
            key,
            label: modelName,
            description: provider.name,
            active: current_model?.id === provider.id && current_model?.use_model === modelName,
          };
        })
      );
      currentModelLabel = current_model?.use_model || '';
      onModelSelect = (key) => {
        const target = modelTargets.get(key);
        if (target) {
          void setCurrentModel({ ...target.provider, use_model: target.modelName } as TProviderWithModel);
        }
      };
    } else {
      const availableModels = currentAcpCachedModelInfo?.available_models ?? [];
      modelOptions = availableModels.map((model) => ({
        key: model.id,
        label: model.label || model.id,
        active: model.id === selectedAcpModel,
      }));
      currentModelLabel =
        availableModels.find((model) => model.id === selectedAcpModel)?.label ||
        currentAcpCachedModelInfo?.current_model_label ||
        currentAcpCachedModelInfo?.current_model_id ||
        '';
      onModelSelect = setSelectedAcpModel;
    }

    if (modelOptions.length > 0 || isGeminiMode) {
      const hasModels = modelOptions.length > 0;
      entries.push({
        key: 'model',
        icon: <Brain theme='outline' size='16' />,
        label: t('common.model'),
        meta: hasModels ? currentModelLabel : t('settings.noAvailableModels'),
        submenu: {
          title: t('common.model'),
          options: hasModels
            ? isGeminiMode
              ? [...modelOptions, { key: 'add-model', label: t('settings.addModel') }]
              : modelOptions
            : [
                {
                  key: 'add-model',
                  label: t('settings.addModel'),
                  description: t('settings.noAvailableModels'),
                },
              ],
          selectable: hasModels,
          onSelect: hasModels
            ? (key) => {
                if (key === 'add-model') onAddModel();
                else onModelSelect(key);
              }
            : onAddModel,
        },
      });
    }

    const modeOptions = availableModeOptions;
    if (modeOptions.length > 0) {
      const options = modeOptions.map((mode) => ({
        key: mode.value,
        label: getModeDisplayLabel(mode),
        description: mode.description,
        active: mode.value === selectedMode,
      }));
      entries.push({
        key: 'permission',
        icon: <Shield theme='outline' size='16' />,
        label: t('agentMode.permission'),
        meta: options.find((option) => option.active)?.label,
        submenu: {
          title: t('agentMode.permission'),
          options,
          onSelect: onModeSelect,
        },
      });
    }

    entries.push({
      key: 'attach',
      icon: <FolderUpload theme='outline' size='16' />,
      label: t('common.fileAttach.addFiles'),
      variant: 'muted',
      dividerBefore: true,
      onClick: openHostFilePicker,
    });

    if (isWebUI) {
      entries.push({
        key: 'attach-device',
        icon: <UploadOne theme='outline' size='16' />,
        label: t('common.fileAttach.myDevice'),
        variant: 'muted',
        onClick: () => fileInputRef.current?.click(),
      });
    }

    if (allSkills.length > 0) {
      entries.push({
        key: 'skills',
        icon: <Lightning theme='outline' size='16' />,
        label: t('settings.capabilitiesTab.skills'),
        meta: activeSkillCount > 0 ? String(activeSkillCount) : undefined,
        variant: 'muted',
        submenu: {
          title: t('settings.capabilitiesTab.skills'),
          multiSelect: true,
          options: allSkills.map((skill) => ({
            key: skill.name,
            label: skill.name,
            description: skill.description || undefined,
            active: isSkillChecked(skill),
          })),
          onSelect: (name) => {
            const skill = allSkills.find((candidate) => candidate.name === name);
            if (skill) onToggleSkill(skill.name, skill.isAuto);
          },
        },
      });
    }

    if (mcpServers.length > 0) {
      entries.push({
        key: 'mcp',
        icon: <Shield theme='outline' size='16' />,
        label: t('mcp.label'),
        meta: activeMcpCount > 0 ? String(activeMcpCount) : undefined,
        variant: 'muted',
        submenu: {
          title: t('mcp.label'),
          multiSelect: true,
          options: mcpServers.map((server) => ({
            key: server.id,
            label: server.name,
            description: server.tools?.length ? `${server.tools.length} ${t('mcp.tools')}` : undefined,
            active: selectedMcpServerIds.includes(server.id),
          })),
          onSelect: onToggleMcpServer,
        },
      });
    }

    return entries;
  }, [
    activeMcpCount,
    activeSkillCount,
    allSkills,
    availableModeOptions,
    currentAcpCachedModelInfo,
    current_model,
    disabledBuiltinSkills,
    enabledSkills,
    isGeminiMode,
    onAddModel,
    isMobile,
    isWebUI,
    mcpServers,
    modeBackend,
    modelList,
    onModeSelect,
    onToggleMcpServer,
    onToggleSkill,
    openHostFilePicker,
    selectedAcpModel,
    selectedMcpServerIds,
    selectedMode,
    setCurrentModel,
    setSelectedAcpModel,
    t,
  ]);

  const menuContent = (
    <Menu
      className='min-w-200px'
      onClickMenuItem={(key) => {
        if (key === 'file') {
          ipcBridge.dialog.showOpen
            .invoke({ properties: ['openFile', 'multiSelections'] })
            .then((uploadedFiles) => {
              if (uploadedFiles && uploadedFiles.length > 0) {
                onFilesUploaded(uploadedFiles);
              }
            })
            .catch((error) => {
              console.error('Failed to open file dialog:', error);
            });
        } else if (key === 'device') {
          fileInputRef.current?.click();
        }
      }}
    >
      {isWebUI ? (
        <>
          <Menu.Item key='file'>
            <div className='flex items-center gap-8px'>
              <UploadOne theme='outline' size='16' fill={iconColors.secondary} style={{ lineHeight: 0 }} />
              <span>{t('common.fileAttach.addFiles')}</span>
            </div>
          </Menu.Item>
          <Menu.Item key='device'>
            <div className='flex items-center gap-8px'>
              <UploadOne theme='outline' size='16' fill={iconColors.secondary} style={{ lineHeight: 0 }} />
              <span>{t('common.fileAttach.myDevice')}</span>
            </div>
          </Menu.Item>
        </>
      ) : (
        <Menu.Item key='file'>
          <div className='flex items-center gap-8px'>
            <UploadOne theme='outline' size='16' fill={iconColors.secondary} style={{ lineHeight: 0 }} />
            <span>{t('common.fileAttach.addFiles')}</span>
          </div>
        </Menu.Item>
      )}
      {allSkills.length > 0 && (
        <Menu.SubMenu
          key='skills'
          title={
            <div className='flex items-center gap-8px'>
              <Lightning theme='filled' size='16' fill={iconColors.primary} style={{ lineHeight: 0 }} />
              <span>
                {t('settings.capabilitiesTab.skills')} ({activeSkillCount}/{allSkills.length})
              </span>
            </div>
          }
          triggerProps={{
            popupStyle: {
              maxHeight: 360,
              overflowY: 'auto',
              overflowX: 'hidden',
            },
          }}
        >
          {allSkills.map((skill) => (
            <Menu.Item
              key={`skill-${skill.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSkill(skill.name, skill.isAuto);
              }}
            >
              <Checkbox
                checked={isSkillChecked(skill)}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                onChange={() => onToggleSkill(skill.name, skill.isAuto)}
              >
                <span className='text-13px'>{skill.name}</span>
              </Checkbox>
            </Menu.Item>
          ))}
        </Menu.SubMenu>
      )}
      {mcpServers.length > 0 && (
        <Menu.SubMenu
          key='mcp'
          title={
            <div className='flex items-center gap-8px'>
              <Shield theme='outline' size='16' fill={iconColors.primary} style={{ lineHeight: 0 }} />
              <span>
                {t('mcp.label')} ({activeMcpCount}/{mcpServers.length})
              </span>
            </div>
          }
          triggerProps={{
            popupStyle: {
              maxHeight: 360,
              overflowY: 'auto',
              overflowX: 'hidden',
            },
          }}
        >
          {mcpServers.map((server) => (
            <Menu.Item
              key={`mcp-${server.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleMcpServer(server.id);
              }}
            >
              <Checkbox
                checked={selectedMcpServerIds.includes(server.id)}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                onChange={() => onToggleMcpServer(server.id)}
              >
                <span className='text-13px'>
                  {server.name}
                  {server.tools?.length ? ` (${server.tools.length} ${t('mcp.tools')})` : ''}
                </span>
              </Checkbox>
            </Menu.Item>
          ))}
        </Menu.SubMenu>
      )}
    </Menu>
  );

  return (
    <div className={styles.actionRow}>
      <div className={styles.actionTools}>
        <div className={styles.actionEntry}>
          {isMobile ? (
            <span className='flex items-center gap-4px cursor-pointer lh-[1]'>
              <Button
                type='secondary'
                shape='circle'
                icon={<Plus theme='outline' size='14' strokeWidth={2} fill={iconColors.primary} />}
                loading={uploading}
                disabled={uploading}
                data-testid='file-upload-btn'
                onClick={() => setIsSheetOpen(true)}
              />
              {files.length > 0 && (
                <Tooltip
                  className={'!max-w-max'}
                  content={<span className='whitespace-break-spaces'>{getCleanFileNames(files).join('\n')}</span>}
                >
                  <span className='text-t-primary'>File({files.length})</span>
                </Tooltip>
              )}
            </span>
          ) : (
            <Dropdown trigger='hover' onVisibleChange={setIsPlusDropdownOpen} droplist={menuContent}>
              <span className='flex items-center gap-4px cursor-pointer lh-[1]'>
                <Button
                  type='secondary'
                  shape='circle'
                  className={isPlusDropdownOpen ? styles.plusButtonRotate : ''}
                  icon={<Plus theme='outline' size='14' strokeWidth={2} fill={iconColors.primary} />}
                  loading={uploading}
                  disabled={uploading}
                  data-testid='file-upload-btn'
                />
                {files.length > 0 && (
                  <Tooltip
                    className={'!max-w-max'}
                    content={<span className='whitespace-break-spaces'>{getCleanFileNames(files).join('\n')}</span>}
                  >
                    <span className='text-t-primary'>File({files.length})</span>
                  </Tooltip>
                )}
              </span>
            </Dropdown>
          )}
          {isWebUI && (
            <input
              ref={fileInputRef}
              type='file'
              multiple
              style={{ display: 'none' }}
              onChange={handleLocalFileChange}
            />
          )}
        </div>
      </div>
      {isMobile && (
        <MobileActionSheet
          open={isSheetOpen}
          onClose={() => setIsSheetOpen(false)}
          title={t('common.more')}
          entries={sheetEntries}
        />
      )}
      <div className={styles.actionSubmit}>
        {!isMobile && configOptionCount > 0 && (
          <div className={styles.actionConfigGroup} data-mobile={isMobile ? 'true' : undefined}>
            {modelSelectorNode}

            {showModeSwitch && (
              <AgentModeSelector
                backend={modeBackend}
                compact
                initialMode={selectedMode}
                onModeSelect={onModeSelect}
                compactLeadingIcon={<Shield theme='outline' size='14' fill={iconColors.secondary} />}
                modeLabelFormatter={getModeDisplayLabel}
              />
            )}
          </div>
        )}

        {!hidePresetTag && is_presetAgent && selectedAgentInfo && (
          <div className={styles.actionPresetAgent}>
            <PresetAgentTag
              agentInfo={selectedAgentInfo}
              assistants={assistants}
              localeKey={localeKey}
              onClose={onClosePresetTag}
              agentLogo={agentLogo}
              agentSwitcherItems={agentSwitcherItems}
              onAgentSwitch={onAgentSwitch}
            />
          </div>
        )}

        {speechInputNode}
        <Button
          shape='circle'
          type='primary'
          loading={loading}
          disabled={isButtonDisabled}
          className='send-button-custom'
          style={{
            backgroundColor: isButtonDisabled ? undefined : '#000000',
            borderColor: isButtonDisabled ? undefined : '#000000',
          }}
          icon={<ArrowUp theme='filled' size='14' fill='white' strokeWidth={5} />}
          onClick={onSend}
          data-testid='guid-send-btn'
        />
      </div>
    </div>
  );
};

export default GuidActionRow;
