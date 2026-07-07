/**
 * AssistantListPanel — Renders the collapsible list of assistants
 * with avatar, name, enabled switch, and persistent row actions.
 */
import type { DragEndEvent } from '@dnd-kit/core';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import type { AssistantListItem } from './types';
import AssistantAvatar from './AssistantAvatar';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, Switch, Tag } from '@arco-design/web-react';
import { Drag, Plus } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type AssistantListPanelProps = {
  assistants: AssistantListItem[];
  localeKey: string;
  avatarImageMap: Record<string, string>;
  onEdit: (assistant: AssistantListItem) => void;
  onDuplicate: (assistant: AssistantListItem) => void;
  onDelete: (assistant: AssistantListItem) => void;
  onCreate: () => void;
  onToggleEnabled: (assistant: AssistantListItem, checked: boolean) => void;
  onReorder: (activeId: string, overId: string) => void | Promise<void>;
  setActiveAssistantId: (id: string) => void;
  /** When set, scroll to and highlight the matching assistant card */
  highlightId?: string | null;
  /** Called after the highlight animation completes so the parent can clear the param */
  onHighlightConsumed?: () => void;
};

type AssistantHomeTab = 'mine' | 'official';

type SortableAssistantCardProps = {
  assistant: AssistantListItem;
  localeKey: string;
  avatarImageMap: Record<string, string>;
  highlightedId: string | null;
  onEdit: (assistant: AssistantListItem) => void;
  onDuplicate: (assistant: AssistantListItem) => void;
  onDelete: (assistant: AssistantListItem) => void;
  onToggleEnabled: (assistant: AssistantListItem, checked: boolean) => void;
  setActiveAssistantId: (id: string) => void;
  renderSourceTag: (assistant: AssistantListItem) => React.ReactNode;
  cardRefSetter: (id: string) => (el: HTMLDivElement | null) => void;
  sortingEnabled: boolean;
};

const SortableAssistantCard: React.FC<SortableAssistantCardProps> = ({
  assistant,
  localeKey,
  avatarImageMap,
  highlightedId,
  onEdit,
  onDuplicate,
  onDelete,
  onToggleEnabled,
  setActiveAssistantId,
  renderSourceTag,
  cardRefSetter,
  sortingEnabled,
}) => {
  const { t } = useTranslation();
  const canDelete = assistant.source === 'user';
  const canDuplicate = assistant.source !== 'user';
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id: assistant.id,
    disabled: !sortingEnabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : undefined,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        cardRefSetter(assistant.id)(node);
      }}
      key={assistant.id}
      style={style}
      data-testid={`assistant-card-${assistant.id}`}
      className={`group flex cursor-pointer items-center justify-between gap-12px rounded-12px border border-solid px-14px py-10px transition-all duration-180 hover:border-border-1 hover:bg-fill-1 ${highlightedId === assistant.id ? 'border-primary-5 bg-primary-1' : 'border-transparent bg-base'}`}
      onClick={() => {
        setActiveAssistantId(assistant.id);
        onEdit(assistant);
      }}
    >
      <div className='flex min-w-0 flex-1 items-center gap-12px'>
        <Button
          ref={setActivatorNodeRef}
          type='text'
          size='small'
          disabled={!sortingEnabled}
          data-testid={`assistant-reorder-handle-${assistant.id}`}
          className={`!min-w-0 !rounded-6px !px-4px !py-0 !text-t-tertiary ${sortingEnabled ? 'cursor-grab active:cursor-grabbing' : '!opacity-40'}`}
          onClick={(event) => event.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <Drag size={16} fill='currentColor' />
        </Button>
        <AssistantAvatar assistant={assistant} size={28} avatarImageMap={avatarImageMap} />
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-8px font-medium text-t-primary'>
            <span className='truncate'>{assistant.name_i18n?.[localeKey] || assistant.name}</span>
            <div className='flex flex-shrink-0 items-center gap-6px'>{renderSourceTag(assistant)}</div>
          </div>
          <div className='truncate text-12px text-t-secondary'>
            {assistant.description_i18n?.[localeKey] || assistant.description || ''}
          </div>
        </div>
      </div>
      <div
        className='ml-12px flex flex-shrink-0 items-center gap-8px text-t-secondary'
        onClick={(e) => e.stopPropagation()}
      >
        <Switch
          size='small'
          data-testid={`switch-enabled-${assistant.id}`}
          checked={assistant.enabled !== false}
          onChange={(checked) => {
            onToggleEnabled(assistant, checked);
          }}
        />
        <Button
          type='outline'
          size='small'
          className='!h-30px !rounded-8px !border-border-2 !bg-base !px-10px !text-12px !font-500 !text-t-primary hover:!border-border-1 hover:!bg-fill-1'
          data-testid={`btn-edit-${assistant.id}`}
          onClick={() => {
            onEdit(assistant);
          }}
        >
          {t('common.edit', { defaultValue: 'Edit' })}
        </Button>
        {canDuplicate ? (
          <Button
            type='outline'
            size='small'
            className='!h-30px !rounded-8px !border-border-2 !bg-base !px-8px !text-12px !font-500 !text-t-primary hover:!border-border-1 hover:!bg-fill-1'
            data-testid={`btn-duplicate-${assistant.id}`}
            onClick={() => {
              onDuplicate(assistant);
            }}
          >
            {t('settings.duplicateAssistant', { defaultValue: 'Duplicate' })}
          </Button>
        ) : null}
        {canDelete ? (
          <Button
            type='outline'
            size='small'
            status='danger'
            className='!h-30px !rounded-8px !border-danger-2 !bg-base !px-8px !text-12px !font-500'
            data-testid={`btn-delete-${assistant.id}`}
            onClick={() => {
              onDelete(assistant);
            }}
          >
            {t('common.delete', { defaultValue: 'Delete' })}
          </Button>
        ) : null}
      </div>
    </div>
  );
};

const AssistantListPanel: React.FC<AssistantListPanelProps> = ({
  assistants,
  localeKey,
  avatarImageMap,
  onEdit,
  onDuplicate,
  onDelete,
  onCreate,
  onToggleEnabled,
  onReorder,
  setActiveAssistantId,
  highlightId,
  onHighlightConsumed,
}) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [activeTab, setActiveTab] = useState<AssistantHomeTab>('mine');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );
  const cardRefSetter = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      cardRefs.current[id] = el;
    },
    []
  );

  // Scroll to and highlight an assistant card when navigated with ?highlight=id
  // Depends on `assistants` so it re-runs after async data loads and refs are populated.
  // Uses a short delay to ensure the page layout is fully settled on first mount.
  useEffect(() => {
    if (!highlightId || assistants.length === 0) return;
    const highlightedAssistant = assistants.find((assistant) => assistant.id === highlightId);
    if (!highlightedAssistant) return;
    const targetTab: AssistantHomeTab = highlightedAssistant.source === 'builtin' ? 'official' : 'mine';
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
      return;
    }

    const el = cardRefs.current[highlightId];
    if (!el) return;

    const timer = setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedId(highlightId);
      setTimeout(() => {
        setHighlightedId(null);
        onHighlightConsumed?.();
      }, 2000);
    }, 150);

    return () => clearTimeout(timer);
  }, [highlightId, assistants, activeTab, onHighlightConsumed]);

  const tabCounts = useMemo(
    () =>
      assistants.reduce(
        (counts, assistant) => {
          if (assistant.source === 'builtin') {
            counts.official += 1;
          } else {
            counts.mine += 1;
          }
          return counts;
        },
        { mine: 0, official: 0 }
      ),
    [assistants]
  );

  const listAssistants = useMemo(
    () =>
      activeTab === 'official'
        ? assistants.filter((assistant) => assistant.source === 'builtin')
        : assistants.filter((assistant) => assistant.source !== 'builtin'),
    [assistants, activeTab]
  );

  const sortingEnabled = activeTab === 'mine';

  const renderSourceTag = (assistant: AssistantListItem) => {
    if (assistant.source === 'builtin') {
      return (
        <Tag
          size='small'
          bordered={false}
          className='!rounded-10px !bg-fill-1 !px-8px !py-1px !text-10px !font-600 !leading-16px !text-primary-6'
        >
          {t('settings.builtin', { defaultValue: 'Built-in' })}
        </Tag>
      );
    }

    return (
      <Tag
        size='small'
        bordered={false}
        className='!rounded-10px !bg-fill-1 !px-8px !py-1px !text-10px !font-600 !leading-16px !text-[rgb(var(--success-6))]'
      >
        {t('settings.assistantSourceCustom', { defaultValue: 'Custom' })}
      </Tag>
    );
  };

  const handleSectionDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!sortingEnabled || !over || active.id === over.id) {
        return;
      }

      void onReorder(String(active.id), String(over.id));
    },
    [onReorder, sortingEnabled]
  );

  const tabButton = (key: AssistantHomeTab, label: string, count: number) => (
    <button
      type='button'
      data-testid={`assistant-tab-${key}`}
      onClick={() => setActiveTab(key)}
      className={`relative inline-flex cursor-pointer items-center border-none bg-transparent px-2px pb-12px text-14px leading-none transition-colors ${
        activeTab === key ? 'font-600 text-t-primary' : 'font-500 text-t-tertiary hover:text-t-secondary'
      }`}
    >
      <span>{label}</span>
      <span
        className={`ml-6px inline-flex h-16px min-w-16px items-center justify-center rounded-999px px-5px text-10px font-500 leading-none ${
          activeTab === key ? 'bg-primary-1 text-primary-6' : 'bg-fill-2 text-t-quaternary'
        }`}
      >
        {count}
      </span>
      {activeTab === key ? <span className='absolute inset-x-0 -bottom-1px h-2px rounded-2px bg-primary-6' /> : null}
    </button>
  );

  const renderList = (sectionAssistants: AssistantListItem[]) => {
    const sectionCards = sectionAssistants.map((assistant) => (
      <SortableAssistantCard
        key={assistant.id}
        assistant={assistant}
        localeKey={localeKey}
        avatarImageMap={avatarImageMap}
        highlightedId={highlightedId}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onToggleEnabled={onToggleEnabled}
        setActiveAssistantId={setActiveAssistantId}
        renderSourceTag={renderSourceTag}
        cardRefSetter={cardRefSetter}
        sortingEnabled={sortingEnabled}
      />
    ));

    return (
      <div className='rounded-12px border border-border-2 bg-2 p-8px md:rounded-16px md:p-10px'>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
          <SortableContext
            items={sectionAssistants.map((assistant) => assistant.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className='space-y-8px'>{sectionCards}</div>
          </SortableContext>
        </DndContext>
      </div>
    );
  };

  return (
    <div data-testid='assistant-list-shell' className='flex h-full min-h-0 flex-col overflow-hidden bg-transparent'>
      <div
        data-testid='assistant-list-header'
        className={`sticky top-0 z-10 border-b border-border-2 bg-bg-0 ${isMobile ? 'px-8px py-12px' : 'px-18px py-18px'}`}
      >
        <div className='mx-auto w-full max-w-760px'>
          <div className={`flex gap-12px ${isMobile ? 'flex-col' : 'items-start justify-between'}`}>
            <div className='min-w-0'>
              <h2 className='m-0 text-16px font-600 leading-[1.2] text-t-primary'>
                {t('settings.assistants', { defaultValue: 'Assistants' })}
              </h2>
              <p className='mt-4px text-12px text-t-tertiary'>
                {t('settings.assistantsListDescription', {
                  defaultValue: 'Manage your assistants, control visibility, and adjust their order.',
                })}
              </p>
            </div>
            <div className={`${isMobile ? 'w-full' : 'flex-shrink-0'}`}>
              <Button
                type='primary'
                size='small'
                className={`!rounded-8px ${isMobile ? '!h-36px !w-full' : '!h-32px !px-14px'}`}
                icon={<Plus size={14} fill='currentColor' />}
                onClick={onCreate}
                data-testid='btn-create-assistant'
              >
                {t('settings.createAssistant', { defaultValue: 'Create Assistant' })}
              </Button>
            </div>
          </div>
          <div className='mt-16px flex gap-26px' data-testid='assistant-management-tabs'>
            {tabButton('mine', t('settings.assistantTabMine', { defaultValue: 'My Assistants' }), tabCounts.mine)}
            {tabButton(
              'official',
              t('settings.assistantTabOfficial', { defaultValue: 'Official' }),
              tabCounts.official
            )}
          </div>
        </div>
      </div>

      <div
        data-testid='assistant-list-body'
        className={`min-h-0 flex-1 overflow-auto ${isMobile ? 'px-8px pt-0 pb-12px' : 'px-18px pt-0 pb-24px'}`}
      >
        <div className='mx-auto w-full max-w-760px'>
          <p className='my-14px text-12px leading-18px text-t-tertiary'>
            {activeTab === 'official'
              ? t('settings.officialAssistantsHintShort', {
                  defaultValue:
                    'Official assistants bundled with evaOS Workbench, maintained and updated with each release; duplicate one as My Assistant to customize it freely.',
                })
              : t('settings.myAssistantsHintShort', {
                  defaultValue:
                    'Assistants you created or duplicated, plus local assistant entries. Drag to change the order they appear in assistant pickers.',
                })}
          </p>
          {listAssistants.length > 0 ? (
            renderList(listAssistants)
          ) : (
            <div className='py-12px text-center text-t-secondary'>
              {activeTab === 'official'
                ? t('settings.assistantNoOfficialAssistants', {
                    defaultValue: 'No official assistants are available.',
                  })
                : t('settings.assistantNoMyAssistants', {
                    defaultValue: 'No personal assistants yet. Create one or duplicate an official assistant.',
                  })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AssistantListPanel;
