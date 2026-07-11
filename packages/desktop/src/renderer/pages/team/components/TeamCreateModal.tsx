import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, Input, Message, Tooltip } from '@arco-design/web-react';
import type { RefInputType } from '@arco-design/web-react/es/Input/interface';
import { Close, Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { TeamAgent, TTeam } from '@/common/types/team/teamTypes';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { useConversationAgents } from '@renderer/pages/conversation/hooks/useConversationAgents';
import AionModal from '@renderer/components/base/AionModal';
import { WorkspaceFolderSelect } from '@renderer/components/workspace';
import { getConversationCreateErrorMessage } from '@renderer/pages/conversation/utils/conversationCreateError';
import {
  agentKey,
  resolveConversationType,
  resolveTeamAgentType,
  filterTeamSupportedAgents,
  AgentOptionLabel,
  cliAgentToOption,
  assistantToOption,
  compactTeamAgentOptions,
  sortTeamLeaderOptions,
} from './agentSelectUtils';
import type { TeamAgentOption } from './agentSelectUtils';
import { resolveDefaultTeamAgentModel } from './teamCreateModelResolver';
import TeamMemberDraftList from './memberPicker/TeamMemberDraftList';
import {
  orderTeamMemberDraftsLeaderFirst,
  removeTeamMemberDraft,
  type TeamMemberDraft,
} from './memberPicker/teamMemberDrafts';

const FormItem = Form.Item;

// [E2E SYNC] Preserve team-create-name-input, team-create-leader-select,
// team-create-agent-option-*, workspace selectors, and the primary create action.
type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: (team: TTeam) => void;
};

const TeamAgentPickerRow: React.FC<{
  agent: TeamAgentOption;
  onSelect: () => void;
}> = ({ agent, onSelect }) => {
  const { t } = useTranslation();
  const button = (
    <Button
      type='text'
      long
      onClick={onSelect}
      data-testid={`team-create-agent-option-${agentKey(agent)}`}
      aria-label={`${t('team.create.addMember', { defaultValue: 'Add member' })}: ${agent.name}`}
      className='!h-40px !justify-start !rounded-8px !px-10px !text-t-primary hover:!bg-fill-2'
    >
      <div className='flex w-full min-w-0 items-center gap-8px'>
        <div className='min-w-0 flex-1 text-left'>
          <AgentOptionLabel agent={agent} />
        </div>
        <Plus size='15' className='shrink-0 text-t-tertiary' />
      </div>
    </Button>
  );

  return agent.description ? (
    <Tooltip content={agent.description} position='right'>
      {button}
    </Tooltip>
  ) : (
    button
  );
};

const TeamCreateModal: React.FC<Props> = ({ visible, onClose, onCreated }) => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const { cliAgents, presetAssistants } = useConversationAgents();
  const [name, setName] = useState('');
  const [members, setMembers] = useState<TeamMemberDraft[]>([]);
  const [leaderSelectionId, setLeaderSelectionId] = useState<string>();
  const [workspace, setWorkspace] = useState('');
  const [loading, setLoading] = useState(false);
  const nextSelectionIdRef = useRef(0);
  const nameInputRef = useRef<RefInputType | null>(null);

  const generatedAssistantIds = useMemo(
    () =>
      new Set(cliAgents.map((agent) => `bare:${agent.id}`).filter((id) => presetAssistants.some((a) => a.id === id))),
    [cliAgents, presetAssistants]
  );
  const cliAgentOptions = useMemo(
    () =>
      compactTeamAgentOptions(
        cliAgents.map((agent) => {
          const assistantId = `bare:${agent.id}`;
          return generatedAssistantIds.has(assistantId)
            ? { ...cliAgentToOption(agent), assistant_id: assistantId }
            : undefined;
        })
      ),
    [cliAgents, generatedAssistantIds]
  );
  const teamCapableKeys = useMemo(
    () =>
      new Set(
        cliAgents
          .filter((agent) => agent.team_capable)
          .flatMap((agent) => [agent.id, agent.backend, agent.agent_type].filter(Boolean) as string[])
      ),
    [cliAgents]
  );
  const presetAssistantOptions = useMemo(
    () =>
      compactTeamAgentOptions(
        presetAssistants
          .filter((assistant) => !generatedAssistantIds.has(assistant.id))
          .map((assistant) => assistantToOption(assistant, teamCapableKeys, i18n.language))
      ),
    [generatedAssistantIds, i18n.language, presetAssistants, teamCapableKeys]
  );
  const allAgents = useMemo(
    () => sortTeamLeaderOptions(filterTeamSupportedAgents([...cliAgentOptions, ...presetAssistantOptions])),
    [cliAgentOptions, presetAssistantOptions]
  );
  useEffect(() => {
    if (visible) setTimeout(() => nameInputRef.current?.focus(), 50);
  }, [visible]);

  const reset = () => {
    setName('');
    setMembers([]);
    setLeaderSelectionId(undefined);
    setWorkspace('');
    nextSelectionIdRef.current = 0;
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSelectAgent = (agent: TeamAgentOption) => {
    nextSelectionIdRef.current += 1;
    const draft = { selectionId: `member-${nextSelectionIdRef.current}`, agent };
    setMembers((current) => [...current, draft]);
    setLeaderSelectionId((current) => current ?? draft.selectionId);
  };

  const handleRemoveMember = (selectionId: string) => {
    const next = removeTeamMemberDraft(members, leaderSelectionId, selectionId);
    setMembers(next.members);
    setLeaderSelectionId(next.leaderSelectionId);
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      Message.warning(t('team.create.nameRequired', { defaultValue: 'Please enter a team name' }));
      nameInputRef.current?.focus();
      return;
    }

    const orderedMembers = orderTeamMemberDraftsLeaderFirst(members, leaderSelectionId);
    if (orderedMembers.length === 0) {
      Message.warning(t('team.create.selectAtLeastOneMember', { defaultValue: 'Select at least one team member.' }));
      return;
    }

    setLoading(true);
    try {
      const agents = await Promise.all(
        orderedMembers.map(async (member, index): Promise<Omit<TeamAgent, 'slot_id' | 'conversation_id'>> => {
          const agentType = resolveTeamAgentType(member.agent, 'acp');
          const conversationType = resolveConversationType(agentType);
          let model: string;
          try {
            model = await resolveDefaultTeamAgentModel({
              agent_type: agentType,
              conversation_type: conversationType,
            });
          } catch (error) {
            throw new Error(`${member.agent.name}: ${getConversationCreateErrorMessage(error, t)}`, { cause: error });
          }
          return {
            role: index === 0 ? 'leader' : 'teammate',
            status: 'pending',
            agent_type: agentType,
            agent_name: member.agent.name,
            conversation_type: conversationType,
            icon: member.agent.icon,
            custom_agent_id: member.agent.assistant_id,
            model,
          };
        })
      );

      const team = await ipcBridge.team.create.invoke({
        user_id: user?.id ?? 'system_default_user',
        name: name.trim(),
        workspace,
        workspace_mode: 'shared',
        agents,
      });
      const result = team as unknown as { __bridgeError?: boolean; message?: string };
      if (result.__bridgeError) {
        Message.error(getConversationCreateErrorMessage(result.message ?? t('team.create.error'), t));
        return;
      }
      onCreated(team);
      reset();
      onClose();
    } catch (error) {
      Message.error(getConversationCreateErrorMessage(error, t));
    } finally {
      setLoading(false);
    }
  };

  const pickerPane = (
    <section data-testid='team-create-agent-pane' className='flex min-h-0 flex-col gap-8px'>
      <span data-testid='team-create-leader-select' className='text-13px font-600 text-t-secondary'>
        {t('team.create.allAssistantsWithCount', {
          count: allAgents.length,
          defaultValue: 'Available members ({{count}})',
        })}
      </span>
      <div className='min-h-112px flex-1 overflow-y-auto rounded-10px border border-border-2 bg-fill-1 p-6px'>
        {allAgents.length === 0 ? (
          <div className='flex h-full min-h-94px items-center justify-center text-12px text-t-tertiary'>
            {t('team.create.noSupportedAgents', { defaultValue: 'No supported agents installed' })}
          </div>
        ) : (
          <div className='flex flex-col gap-4px'>
            {allAgents.map((agent) => (
              <TeamAgentPickerRow key={agentKey(agent)} agent={agent} onSelect={() => handleSelectAgent(agent)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );

  const detailsPane = (
    <section data-testid='team-create-details-pane' className='flex min-h-0 flex-col gap-16px'>
      <TeamMemberDraftList
        members={members}
        leaderSelectionId={leaderSelectionId}
        onLeaderChange={setLeaderSelectionId}
        onRemove={handleRemoveMember}
      />
      <Form layout='vertical' className='shrink-0'>
        <FormItem
          label={
            <span className='text-12px font-500 text-t-secondary'>
              {t('team.create.namePlaceholder', { defaultValue: 'Team name' })}
              <span className='ml-4px text-danger-6'>*</span>
            </span>
          }
        >
          <Input
            ref={nameInputRef}
            placeholder={t('team.create.namePlaceholder', { defaultValue: 'Team name' })}
            value={name}
            onChange={setName}
            data-testid='team-create-name-input'
          />
        </FormItem>
        <FormItem
          label={
            <span className='text-12px font-500 text-t-secondary'>
              {t('team.create.step.workspace', { defaultValue: 'Project' })}
              <span className='ml-4px text-11px font-normal text-t-tertiary'>
                {t('common.optional', { defaultValue: '(optional)' })}
              </span>
            </span>
          }
        >
          <WorkspaceFolderSelect
            value={workspace}
            onChange={setWorkspace}
            placeholder={t('team.create.selectFolder', { defaultValue: 'Select folder' })}
            recentLabel={t('team.create.recentLabel', { defaultValue: 'Recent' })}
            chooseDifferentLabel={t('team.create.chooseDifferentFolder', {
              defaultValue: 'Choose a different folder',
            })}
            triggerTestId='team-create-workspace-trigger'
            menuTestId='team-create-workspace-menu'
          />
        </FormItem>
      </Form>
    </section>
  );

  return (
    <AionModal
      visible={visible}
      onCancel={handleClose}
      className='team-create-modal'
      style={{
        width: isMobile ? 'calc(100vw - 32px)' : 880,
        maxWidth: isMobile ? 'calc(100vw - 32px)' : 'calc(100vw - 72px)',
      }}
      wrapStyle={{ zIndex: 10000 }}
      maskStyle={{ zIndex: 9999 }}
      autoFocus={false}
      unmountOnExit={false}
      contentStyle={{ background: 'var(--dialog-fill-0)', padding: 0, overflow: 'hidden' }}
      header={{
        render: () => (
          <div className='flex items-center justify-between border-b border-border-2 bg-dialog-fill-0 px-24px py-18px'>
            <div className='flex items-center gap-6px'>
              <h3 className='m-0 text-16px font-600 text-t-primary'>
                {t('team.create.title', { defaultValue: 'Create Team' })}
              </h3>
              <Tooltip content={t('team.create.tooltip')} position='right'>
                <span
                  className='inline-flex size-16px items-center justify-center rounded-full border border-border-2 text-11px font-600 text-t-tertiary'
                  aria-label={t('team.create.tooltipLabel', { defaultValue: 'What are teams?' })}
                >
                  ?
                </span>
              </Tooltip>
            </div>
            <Button
              type='text'
              icon={<Close size='18' fill='currentColor' className='text-t-secondary' />}
              aria-label={t('common.close', { defaultValue: 'Close' })}
              onClick={handleClose}
              className='!h-28px !w-28px !min-w-28px !p-0 !rd-8px hover:!bg-fill-2'
            />
          </div>
        ),
      }}
      footer={
        <div className='flex justify-end gap-10px border-t border-border-2 bg-dialog-fill-0 px-24px py-16px'>
          <Button onClick={handleClose} className='min-w-80px' style={{ borderRadius: 8 }}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type='primary'
            onClick={handleCreate}
            loading={loading}
            disabled={!name.trim() || !leaderSelectionId}
            className='min-w-80px'
            style={{ borderRadius: 8 }}
          >
            {t('team.create.confirm', { defaultValue: 'Create Team' })}
          </Button>
        </div>
      }
    >
      {isMobile ? (
        <div
          data-testid='team-create-layout-mobile'
          className='flex max-h-[72vh] flex-col gap-16px overflow-y-auto p-16px'
        >
          {pickerPane}
          {detailsPane}
        </div>
      ) : (
        <div
          data-testid='team-create-layout'
          className='grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-20px p-20px'
          style={{ height: 'min(66vh, 620px)', minHeight: 440 }}
        >
          {pickerPane}
          {detailsPane}
        </div>
      )}
    </AionModal>
  );
};

export default TeamCreateModal;
