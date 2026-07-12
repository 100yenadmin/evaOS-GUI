/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import AionModal from '@/renderer/components/base/AionModal';
import { useManagedAgents } from '@/renderer/hooks/agent/useAgents';
import { Alert, Button, Typography } from '@arco-design/web-react';
import { Home, Plus } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import AgentCard from './AgentCard';
import { AgentHubModal } from './AgentHubModal';
import InlineAgentEditor, { type CustomAgentDraft } from './InlineAgentEditor';
import { getAgentKey } from '@/renderer/pages/guid/hooks/agentSelectionUtils';
import { sortEvaosDetectedAgentsForPresentation } from '@/renderer/evaos/evaosAgentPresentation';
import {
  applyEvaosNativeCompanionStatusToAgent,
  type EvaosNativeAgentAvailability,
  getEvaosNativeAgentAvailability,
} from '@/renderer/evaos/evaosNativeAgentAvailability';
import { useEvaosNativeCompanionStatus } from '@/renderer/evaos/useEvaosNativeCompanionStatus';

type AgentAvailabilityFilter = 'all' | 'available' | 'setup';

type DetectedAgentCard = {
  agent: AgentMetadata;
  nativeAvailability: EvaosNativeAgentAvailability;
};

function needsSetup({ agent, nativeAvailability }: DetectedAgentCard): boolean {
  if (agent.available === false) return true;
  if (!nativeAvailability.isNativeDependent) return false;
  return nativeAvailability.statusLabelKey !== 'settings.agentManagement.nativePaired';
}

const LocalAgents: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [hubModalVisible, setHubModalVisible] = useState(false);
  const [agentFilter, setAgentFilter] = useState<AgentAvailabilityFilter>('all');
  const { status: nativeCompanionStatus } = useEvaosNativeCompanionStatus();

  // Settings management view includes disabled custom agents so they remain
  // visible and can be re-enabled; chat/team pickers still use useAgents().
  const { agents: allAgents, error: catalogError, revalidate: mutateAgents } = useManagedAgents();

  const detectedAgents = useMemo(
    () =>
      allAgents
        .filter((a) => a.agent_type !== 'remote' && a.agent_source !== 'custom')
        .map((agent) => applyEvaosNativeCompanionStatusToAgent(agent, nativeCompanionStatus)),
    [allAgents, nativeCompanionStatus]
  );

  const customAgents: AgentMetadata[] = useMemo(
    () => allAgents.filter((a) => a.agent_source === 'custom'),
    [allAgents]
  );

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentMetadata | null>(null);

  const handleSaveCustomAgent = useCallback(
    async (draft: CustomAgentDraft) => {
      const body = {
        name: draft.name,
        command: draft.command,
        icon: draft.icon,
        args: draft.args,
        env: draft.env,
        advanced: draft.advanced,
      };
      try {
        if (editingAgent) {
          await ipcBridge.acpConversation.updateCustomAgent.invoke({ id: editingAgent.id, ...body });
        } else {
          await ipcBridge.acpConversation.createCustomAgent.invoke(body);
        }
        await mutateAgents();
        setEditorVisible(false);
        setEditingAgent(null);
      } catch (err) {
        // Surface backend rejection (e.g. cli_not_found / acp_init_failed) without crashing.
        console.error('save custom agent failed:', err);
      }
    },
    [editingAgent, mutateAgents]
  );

  const handleDeleteCustomAgent = useCallback(
    async (agentId: string) => {
      try {
        await ipcBridge.acpConversation.deleteCustomAgent.invoke({ id: agentId });
        await mutateAgents();
      } catch (err) {
        console.error('delete custom agent failed:', err);
      }
    },
    [mutateAgents]
  );

  const handleToggleCustomAgent = useCallback(
    async (agentId: string, enabled: boolean) => {
      try {
        await ipcBridge.acpConversation.setAgentEnabled.invoke({ id: agentId, enabled });
        await mutateAgents();
      } catch (err) {
        console.error('toggle custom agent failed:', err);
      }
    },
    [mutateAgents]
  );

  const orderedDetectedAgents = useMemo(() => sortEvaosDetectedAgentsForPresentation(detectedAgents), [detectedAgents]);

  const detectedAgentCards = useMemo<DetectedAgentCard[]>(
    () =>
      orderedDetectedAgents.map((agent) => ({
        agent,
        nativeAvailability: getEvaosNativeAgentAvailability(agent),
      })),
    [orderedDetectedAgents]
  );

  const filterStats = useMemo(
    () =>
      detectedAgentCards.reduce(
        (stats, card) => {
          if (needsSetup(card)) {
            stats.setup += 1;
          } else {
            stats.available += 1;
          }
          return stats;
        },
        { all: detectedAgentCards.length, available: 0, setup: 0 }
      ),
    [detectedAgentCards]
  );

  const visibleDetectedAgentCards = useMemo(() => {
    if (agentFilter === 'available') return detectedAgentCards.filter((card) => !needsSetup(card));
    if (agentFilter === 'setup') return detectedAgentCards.filter(needsSetup);
    return detectedAgentCards;
  }, [agentFilter, detectedAgentCards]);

  const renderFilterTab = (key: AgentAvailabilityFilter, label: string, count: number) => (
    <button
      type='button'
      data-testid={`agent-filter-${key}`}
      onClick={() => setAgentFilter(key)}
      className={`relative inline-flex cursor-pointer items-center border-none bg-transparent px-2px pb-12px text-14px leading-none transition-colors ${
        agentFilter === key ? 'font-600 text-t-primary' : 'font-500 text-t-tertiary hover:text-t-secondary'
      }`}
    >
      <span>{label}</span>
      <span
        className={`ml-6px inline-flex h-16px min-w-16px items-center justify-center rounded-999px px-5px text-10px font-500 leading-none ${
          agentFilter === key ? 'bg-primary-1 text-primary-6' : 'bg-fill-2 text-t-quaternary'
        }`}
      >
        {count}
      </span>
      {agentFilter === key ? <span className='absolute inset-x-0 -bottom-1px h-2px rounded-2px bg-primary-6' /> : null}
    </button>
  );

  const openCustomAgentEditor = useCallback(() => {
    setEditingAgent(null);
    setEditorVisible(true);
  }, []);

  const goToChatWithAgent = useCallback(
    (agent: AgentMetadata) => {
      const nativeAvailability = getEvaosNativeAgentAvailability(agent);
      if (nativeAvailability.status === 'repair_required') {
        navigate(nativeAvailability.repairRoute, {
          state: {
            repairAgent: nativeAvailability.displayName,
            repairReason: t(nativeAvailability.reasonKey, nativeAvailability.reasonParams ?? {}),
          },
        });
        return;
      }
      navigate('/guid', { state: { selectedAgentKey: getAgentKey(agent) } });
    },
    [navigate, t]
  );

  return (
    <div className='flex flex-col gap-8px py-16px'>
      <div className='px-16px text-12px text-t-secondary'>
        <span>{t('settings.agentManagement.localAgentsDescription')} </span>
        <Button
          type='text'
          size='mini'
          className='!h-auto !p-0 !align-baseline !text-12px !font-normal !text-primary-6 hover:!text-primary-7 hover:!underline underline-offset-2'
          onClick={openCustomAgentEditor}
        >
          {t('settings.agentManagement.detectCustomAgent')}
        </Button>
      </div>

      {catalogError ? (
        <Alert
          type='error'
          data-testid='agent-catalog-error'
          className='mx-16px'
          content={
            <div className='flex items-center justify-between gap-12px'>
              <span>{t('common.failed')}</span>
              <Button size='small' onClick={() => void mutateAgents()}>
                {t('common.retry')}
              </Button>
            </div>
          }
        />
      ) : null}

      {process.env.NODE_ENV === 'development' && (
        <div className='px-16px mt-8px'>
          <div className='flex flex-col gap-14px rounded-16px border border-solid border-[rgba(var(--primary-6),0.18)] bg-[rgba(var(--primary-6),0.06)] p-16px md:flex-row md:items-center md:justify-between'>
            <div className='flex items-center gap-12px'>
              <div className='flex h-40px w-40px items-center justify-center leading-none rounded-12px border border-solid border-[rgba(var(--primary-6),0.12)] bg-[rgba(var(--primary-6),0.10)] text-primary-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]'>
                <Home theme='outline' size='20' strokeWidth={2} className='block' />
              </div>
              <div className='min-w-0'>
                <Typography.Text className='mb-4px block text-15px font-medium text-t-primary'>
                  {t('settings.agentManagement.installFromMarket')}
                </Typography.Text>
                <Typography.Text className='block text-12px leading-18px text-t-secondary'>
                  {t('settings.agentManagement.discoverMoreAgents')}
                </Typography.Text>
              </div>
            </div>

            <Button
              type='primary'
              size='small'
              icon={<Plus size='14' />}
              className='!rounded-10px md:!min-w-144px'
              onClick={() => setHubModalVisible(true)}
            >
              {t('settings.agentManagement.installFromMarket')}
            </Button>
          </div>
        </div>
      )}

      {/* Detected Agents section */}
      <div className='px-16px mt-8px'>
        <Typography.Text className='text-12px font-medium text-t-secondary mb-4px block'>
          {t('settings.agentManagement.detected')}
        </Typography.Text>
      </div>
      {detectedAgentCards.length > 0 && (
        <div className='flex gap-26px px-16px' data-testid='agent-availability-filter'>
          {renderFilterTab('all', t('settings.agentManagement.filterAll', { defaultValue: 'All' }), filterStats.all)}
          {renderFilterTab(
            'available',
            t('settings.agentManagement.filterAvailable', { defaultValue: 'Available' }),
            filterStats.available
          )}
          {renderFilterTab(
            'setup',
            t('settings.agentManagement.filterSetupNeeded', { defaultValue: 'Needs setup' }),
            filterStats.setup
          )}
        </div>
      )}
      <div className='grid grid-cols-2 gap-10px px-16px md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
        {visibleDetectedAgentCards.map(({ agent, nativeAvailability }) => (
          <AgentCard
            key={agent.backend || agent.agent_type}
            type='detected'
            agent={agent}
            nativeAvailability={nativeAvailability}
            onGoToChat={() => goToChatWithAgent(agent)}
          />
        ))}
      </div>
      {!catalogError && (!detectedAgents || detectedAgents.length === 0 || visibleDetectedAgentCards.length === 0) && (
        <Typography.Text type='secondary' className='block px-16px py-16px text-center text-12px'>
          {t('settings.agentManagement.localAgentsEmpty')}
        </Typography.Text>
      )}

      {/* Custom Agents section */}
      {(editorVisible || (customAgents && customAgents.length > 0)) && (
        <div className='px-16px mt-16px'>
          <Typography.Text className='text-12px font-medium text-t-secondary mb-4px block'>
            {t('settings.agentManagement.customAgents', { defaultValue: 'Custom Agents' })}
          </Typography.Text>
        </div>
      )}

      <AionModal
        visible={editorVisible}
        onCancel={() => {
          setEditorVisible(false);
          setEditingAgent(null);
        }}
        header={{
          title: editingAgent
            ? t('settings.agentManagement.editCustomAgent')
            : t('settings.agentManagement.detectCustomAgent'),
          showClose: true,
        }}
        footer={null}
        style={{ maxWidth: '92vw', borderRadius: 16 }}
        contentStyle={{
          background: 'var(--dialog-fill-0)',
          borderRadius: 16,
          padding: '20px 24px 16px',
          overflow: 'auto',
        }}
      >
        {/* Conditional mount + key unmounts the editor on close so the
            next `创建自定义 Agent` click always starts from a blank form.
            The inner useEffect([agent]) only resets when the `agent`
            reference changes; two consecutive `null` values would not
            retrigger it. */}
        {editorVisible && (
          <InlineAgentEditor
            key={editingAgent?.id ?? 'new'}
            agent={editingAgent}
            onSave={(agent) => void handleSaveCustomAgent(agent)}
            onCancel={() => {
              setEditorVisible(false);
              setEditingAgent(null);
            }}
          />
        )}
      </AionModal>

      <div className='flex flex-col gap-4px px-0'>
        {customAgents?.map((agent) => (
          <AgentCard
            key={agent.id}
            type='custom'
            agent={agent}
            onGoToChat={() => goToChatWithAgent(agent)}
            onEdit={() => {
              setEditingAgent(agent);
              setEditorVisible(true);
            }}
            onDelete={() => void handleDeleteCustomAgent(agent.id)}
            onToggle={(enabled) => void handleToggleCustomAgent(agent.id, enabled)}
          />
        ))}
      </div>

      {hubModalVisible && <AgentHubModal visible={hubModalVisible} onCancel={() => setHubModalVisible(false)} />}
    </div>
  );
};

export default LocalAgents;
