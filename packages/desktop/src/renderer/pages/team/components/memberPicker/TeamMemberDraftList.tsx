import { Button } from '@arco-design/web-react';
import { CloseSmall, Crown } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { AgentOptionLabel } from '../agentSelectUtils';
import type { TeamMemberDraft } from './teamMemberDrafts';

type Props = {
  members: TeamMemberDraft[];
  leaderSelectionId?: string;
  onLeaderChange: (selectionId: string) => void;
  onRemove: (selectionId: string) => void;
};

const TeamMemberDraftList: React.FC<Props> = ({ members, leaderSelectionId, onLeaderChange, onRemove }) => {
  const { t } = useTranslation();

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-8px'>
      <div className='flex items-center justify-between gap-8px'>
        <span className='text-13px font-600 text-t-secondary'>
          {t('team.create.selectedMembersTitleWithCount', {
            count: members.length,
            defaultValue: 'Selected members {{count}}',
          })}
        </span>
        <span className='text-11px text-t-tertiary'>
          {t('team.create.membersHelper', { defaultValue: 'Choose exactly one leader.' })}
        </span>
      </div>
      <div
        data-testid='team-create-member-list-box'
        className='min-h-112px flex-1 overflow-y-auto rounded-10px border border-border-2 bg-fill-1 p-8px'
      >
        {members.length === 0 ? (
          <div className='flex h-full min-h-94px items-center justify-center px-12px text-center text-12px text-t-tertiary'>
            {t('team.create.selectAtLeastOneMember', {
              defaultValue: 'Select at least one team member.',
            })}
          </div>
        ) : (
          <div className='flex flex-col gap-6px'>
            {members.map((member) => {
              const isLeader = member.selectionId === leaderSelectionId;
              return (
                <div
                  key={member.selectionId}
                  data-testid={`team-create-member-draft-${member.selectionId}`}
                  className='flex h-40px items-center gap-8px rounded-8px bg-dialog-fill-0 px-8px'
                >
                  <div className='min-w-0 flex-1'>
                    <AgentOptionLabel agent={member.agent} />
                  </div>
                  <Button
                    type='text'
                    icon={<Crown theme={isLeader ? 'filled' : 'outline'} size='15' />}
                    aria-label={
                      isLeader
                        ? t('team.create.currentLeader', { defaultValue: 'Current leader' })
                        : t('team.create.setAsLeader', { defaultValue: 'Set as leader' })
                    }
                    aria-pressed={isLeader}
                    className={`!h-28px !w-28px !min-w-28px !p-0 ${isLeader ? '!text-warning-6' : '!text-t-tertiary'}`}
                    onClick={() => onLeaderChange(member.selectionId)}
                  />
                  <Button
                    type='text'
                    icon={<CloseSmall size='16' />}
                    aria-label={t('team.create.removeMember', { defaultValue: 'Remove member' })}
                    className='!h-28px !w-28px !min-w-28px !p-0 !text-t-tertiary hover:!text-danger-6'
                    onClick={() => onRemove(member.selectionId)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamMemberDraftList;
