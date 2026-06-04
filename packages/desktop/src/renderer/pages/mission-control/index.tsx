/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { Button, Spin, Tag } from '@arco-design/web-react';
import { Attention, CheckOne, Computer, Refresh, Robot } from '@icon-park/react';
import { useEvaosCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import {
  evaosBroker,
  type IEvaosBrokerSessionStatus,
  type IEvaosRuntimeKey,
  type IEvaosRuntimeStatusView,
} from '@/common/adapter/ipcBridge';

type RuntimeTarget = {
  key: IEvaosRuntimeKey;
  label: string;
  role: string;
  kind: 'browser' | 'agent' | 'execution';
};

type RuntimeLoadState = {
  target: RuntimeTarget;
  view?: IEvaosRuntimeStatusView;
  error?: string;
  loading: boolean;
};

type StatusBucket = 'running' | 'done' | 'blocked' | 'waiting';

type BetaGateItem = {
  label: string;
  detail: string;
};

type MissionRealitySnapshot = {
  customerLabel: string;
  customerStatus: string;
  customerHealth: string;
  loadedRuntimeCount: number;
  sessionSource: string;
  latestEvidenceAt?: string;
  auditRefs: string[];
  sourceRefs: string[];
};

const RUNTIME_TARGETS: RuntimeTarget[] = [
  {
    key: 'browser',
    label: 'Business Browser',
    role: 'Customer browser session',
    kind: 'browser',
  },
  {
    key: 'openclaw',
    label: 'OpenClaw',
    role: 'Agent workspace',
    kind: 'agent',
  },
  {
    key: 'hermes',
    label: 'Hermes',
    role: 'Dashboard and operator console',
    kind: 'agent',
  },
  {
    key: 'paperclip',
    label: 'Paperclip',
    role: 'Execution queue',
    kind: 'execution',
  },
];

const PUBLIC_BETA_GATE_ITEMS: BetaGateItem[] = [
  {
    label: 'Local shell smoke',
    detail: 'Start evaOS Workbench Beta locally and screenshot the beta routes before new feature slices.',
  },
  {
    label: 'Live staging canaries',
    detail: 'evaos-staging still needs real session, customer, provider, Company Brain, and browser fixtures.',
  },
  {
    label: 'Signed macOS artifact',
    detail: 'No signed and notarized beta artifact has install and launch evidence yet.',
  },
  {
    label: 'Role and org denial proof',
    detail: 'People, approvals, providers, Company Brain, and browser controls still need live denial evidence.',
  },
  {
    label: 'Rollback and support path',
    detail: 'Fallback app launch, rollback state, and support notes still need artifact-backed proof.',
  },
];

const SECRET_TEXT_PATTERN =
  /(eds_|epg_|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|authorization|bearer|secret|password)/i;

function safeUiText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) {
    return fallback;
  }
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
}

function emptyRuntimeStates(): RuntimeLoadState[] {
  return RUNTIME_TARGETS.map((target) => ({ target, loading: false }));
}

function statusBucket(state: RuntimeLoadState): StatusBucket {
  if (state.loading) return 'waiting';
  if (state.error) return 'blocked';

  const status = state.view?.status.toLowerCase() ?? '';
  if (!status) return 'waiting';
  if (/(running|active|ready|online|healthy)/.test(status)) return 'running';
  if (/(done|complete|completed|idle|ok|available)/.test(status)) return 'done';
  return 'blocked';
}

function statusLabel(bucket: StatusBucket): string {
  if (bucket === 'running') return 'Running';
  if (bucket === 'done') return 'Done';
  if (bucket === 'blocked') return 'Blocked';
  return 'Waiting';
}

function statusColor(bucket: StatusBucket): 'green' | 'arcoblue' | 'orange' | 'gray' {
  if (bucket === 'running') return 'green';
  if (bucket === 'done') return 'arcoblue';
  if (bucket === 'blocked') return 'orange';
  return 'gray';
}

function sessionTitle(session: IEvaosBrokerSessionStatus | null, error: string | null): string {
  if (error) return 'Broker unavailable';
  if (!session) return 'Checking session';
  if (session.state === 'authenticated') return 'Session active';
  if (session.state === 'expired') return 'Session expired';
  return 'Sign in required';
}

function sessionBucket(session: IEvaosBrokerSessionStatus | null, error: string | null): StatusBucket {
  if (error) return 'blocked';
  if (!session) return 'waiting';
  return session.state === 'authenticated' ? 'running' : 'blocked';
}

function formatDate(value?: string): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(time));
}

function latestTimestamp(values: Array<string | undefined>): string | undefined {
  const latest = values.reduce<number | undefined>((acc, value) => {
    if (!value) return acc;
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return acc;
    return acc === undefined || time > acc ? time : acc;
  }, undefined);
  return latest === undefined ? undefined : new Date(latest).toISOString();
}

const MissionControlPage: React.FC = () => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [session, setSession] = useState<IEvaosBrokerSessionStatus | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [runtimeStates, setRuntimeStates] = useState<RuntimeLoadState[]>(() => emptyRuntimeStates());
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingRuntime, setLoadingRuntime] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const customerContext = useEvaosCustomerContext(session?.authenticated === true);
  const selectedCustomerRef = useRef<string | undefined>(customerContext.selectedCustomerId);
  const requestEpochRef = useRef(0);

  const loadSession = useCallback(async (): Promise<IEvaosBrokerSessionStatus | null> => {
    setLoadingSession(true);
    setSessionError(null);
    try {
      const response = await evaosBroker.getSessionStatus.invoke();
      if (!response.success || !response.data) {
        setSession(null);
        setSessionError(safeUiText(response.msg, 'The evaOS broker session check failed safely.'));
        return null;
      }
      setSession(response.data);
      return response.data;
    } catch {
      setSession(null);
      setSessionError('The evaOS broker could not be reached.');
      return null;
    } finally {
      setLoadingSession(false);
    }
  }, []);

  useEffect(() => {
    selectedCustomerRef.current = customerContext.selectedCustomerId;
    requestEpochRef.current += 1;
  }, [customerContext.selectedCustomerId]);

  const isCurrentRequest = useCallback((epoch: number, customerId: string) => {
    return requestEpochRef.current === epoch && selectedCustomerRef.current === customerId;
  }, []);

  const refreshMissionControl = useCallback(async () => {
    const nextSession = await loadSession();
    if (!nextSession?.authenticated) {
      requestEpochRef.current += 1;
      setRuntimeStates(emptyRuntimeStates());
      setLastRefreshedAt(null);
      setLoadingRuntime(false);
      return;
    }

    const selectedCustomerId = selectedCustomerRef.current ?? customerContext.selectedCustomerId;
    if (!selectedCustomerId) {
      setRuntimeStates(
        RUNTIME_TARGETS.map((target) => ({
          target,
          loading: false,
          error: 'Choose a customer target before checking runtime status.',
        }))
      );
      setLastRefreshedAt(null);
      return;
    }

    const requestEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = requestEpoch;
    selectedCustomerRef.current = selectedCustomerId;
    setLoadingRuntime(true);
    setRuntimeStates(RUNTIME_TARGETS.map((target) => ({ target, loading: true })));

    const results = await Promise.all(
      RUNTIME_TARGETS.map(async (target): Promise<RuntimeLoadState> => {
        try {
          const response = await evaosBroker.runtimeStatus.invoke({
            customerId: selectedCustomerId,
            runtime: target.key,
          });
          if (!response.success || !response.data) {
            return {
              target,
              loading: false,
              error: safeUiText(response.msg, 'The evaOS broker returned no runtime evidence.'),
            };
          }
          return { target, loading: false, view: response.data };
        } catch {
          return {
            target,
            loading: false,
            error: 'The evaOS broker could not be reached.',
          };
        }
      })
    );

    if (!isCurrentRequest(requestEpoch, selectedCustomerId)) {
      return;
    }
    setRuntimeStates(results);
    setLastRefreshedAt(new Date().toISOString());
    setLoadingRuntime(false);
  }, [customerContext.selectedCustomerId, isCurrentRequest, loadSession]);

  const selectCustomer = useCallback(
    (customerId: string) => {
      selectedCustomerRef.current = customerId;
      requestEpochRef.current += 1;
      customerContext.selectCustomer(customerId);
      setRuntimeStates(emptyRuntimeStates());
      setLastRefreshedAt(null);
      setLoadingRuntime(false);
    },
    [customerContext]
  );

  const refreshCustomerTargets = useCallback(async () => {
    requestEpochRef.current += 1;
    selectedCustomerRef.current = undefined;
    setRuntimeStates(emptyRuntimeStates());
    setLastRefreshedAt(null);
    setLoadingRuntime(false);
    await customerContext.refreshTargets();
  }, [customerContext]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const counts = useMemo(() => {
    return runtimeStates.reduce(
      (acc, state) => {
        acc[statusBucket(state)] += 1;
        return acc;
      },
      { running: 0, done: 0, blocked: 0, waiting: 0 } satisfies Record<StatusBucket, number>
    );
  }, [runtimeStates]);

  const activeSessionBucket = sessionBucket(session, sessionError);
  const sessionMessage = sessionError ?? session?.message ?? 'Checking evaOS broker session status.';
  const expiresAt = formatDate(session?.expiresAt);
  const refreshedAt = formatDate(lastRefreshedAt ?? undefined);
  const selectedCustomerLabel = customerContext.selectedTarget?.displayName ?? customerContext.selectedCustomerId;
  const realitySnapshot = useMemo<MissionRealitySnapshot>(() => {
    const views = runtimeStates
      .map((state) => state.view)
      .filter((view): view is IEvaosRuntimeStatusView => Boolean(view));
    const auditRefs = views.map((view) => view.auditId).filter((value): value is string => Boolean(value));
    const sourceRefs = views.map((view) => view.sourcePointer).filter((value): value is string => Boolean(value));

    return {
      customerLabel: selectedCustomerLabel ?? 'No customer selected',
      customerStatus: safeUiText(customerContext.selectedTarget?.status, 'unknown'),
      customerHealth: safeUiText(customerContext.selectedTarget?.healthStatus, 'unknown'),
      loadedRuntimeCount: views.length,
      sessionSource: session?.source ?? 'none',
      latestEvidenceAt: latestTimestamp(views.flatMap((view) => [view.lastActivityAt, view.lastCheckedAt])),
      auditRefs,
      sourceRefs,
    };
  }, [customerContext.selectedTarget, runtimeStates, selectedCustomerLabel, session?.source]);

  return (
    <div
      className={classNames(
        'w-full min-h-full box-border overflow-y-auto',
        isMobile ? 'px-16px py-14px' : 'px-12px py-24px md:px-40px md:py-32px'
      )}
    >
      <div className='mx-auto flex w-full max-w-1100px box-border flex-col gap-16px'>
        <header className='flex flex-col gap-10px'>
          <div className='flex flex-wrap items-start justify-between gap-12px'>
            <div className='min-w-0'>
              <h1 className='m-0 text-28px leading-34px font-bold text-t-primary max-sm:text-24px'>Mission Control</h1>
              <p className='m-0 mt-4px max-w-720px text-14px leading-22px text-t-secondary'>
                Runtime, customer session, and agent status from evaOS broker evidence.
              </p>
            </div>
            <Button
              type='primary'
              icon={<Refresh theme='outline' size='16' />}
              loading={loadingSession || loadingRuntime}
              onClick={() => void refreshMissionControl()}
            >
              Refresh
            </Button>
          </div>

          <section
            className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'
            aria-label='Public beta gate'
          >
            <div className='flex flex-wrap items-start justify-between gap-10px'>
              <div className='min-w-0'>
                <div className='flex flex-wrap items-center gap-8px'>
                  <span className='text-14px font-semibold leading-20px text-t-primary'>Public beta gated</span>
                  <Tag color='orange'>Continue R&amp;D with blockers</Tag>
                </div>
                <p className='m-0 mt-4px max-w-760px text-13px leading-20px text-t-secondary'>
                  evaOS Workbench Beta is the beta shell candidate. Public distribution stays blocked until the proof
                  gates below pass.
                </p>
              </div>
              <Tag color='gray'>Issue #73</Tag>
            </div>
            <div className='mt-12px grid grid-cols-1 gap-8px md:grid-cols-5'>
              {PUBLIC_BETA_GATE_ITEMS.map((item) => (
                <BetaGateCard key={item.label} item={item} />
              ))}
            </div>
          </section>

          <section className='grid grid-cols-1 gap-10px md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]'>
            <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
              <div className='flex flex-wrap items-center justify-between gap-10px'>
                <div className='flex min-w-0 items-center gap-10px'>
                  <span className='flex size-32px shrink-0 items-center justify-center rounded-8px bg-fill-3 text-t-primary'>
                    <Computer theme='outline' size='18' />
                  </span>
                  <div className='min-w-0'>
                    <div className='flex flex-wrap items-center gap-8px'>
                      <span className='text-14px font-semibold leading-20px text-t-primary'>
                        {sessionTitle(session, sessionError)}
                      </span>
                      <Tag color={statusColor(activeSessionBucket)}>{statusLabel(activeSessionBucket)}</Tag>
                    </div>
                    <div className='mt-3px text-13px leading-20px text-t-secondary'>
                      {safeUiText(sessionMessage, '')}
                    </div>
                  </div>
                </div>
                {session?.userEmail ? (
                  <span className='min-w-0 truncate text-12px leading-18px text-t-secondary'>{session.userEmail}</span>
                ) : null}
              </div>
              <div className='mt-12px grid grid-cols-1 gap-8px text-12px leading-18px text-t-secondary sm:grid-cols-3'>
                <span>Source: {session?.source ?? 'none'}</span>
                <span>Expires: {expiresAt ?? 'not active'}</span>
                <span>Refreshed: {refreshedAt ?? 'not yet'}</span>
              </div>
            </div>

            <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
              <div className='flex items-center justify-between gap-10px'>
                <div className='min-w-0'>
                  <div className='text-13px font-medium leading-20px text-t-primary'>Customer context</div>
                  <div className='mt-2px truncate text-12px leading-18px text-t-secondary'>
                    {customerContext.loading
                      ? 'Loading customer targets...'
                      : (selectedCustomerLabel ?? 'No customer selected')}
                  </div>
                </div>
                <div className='flex shrink-0 flex-wrap gap-8px'>
                  <Button loading={customerContext.loading} onClick={() => void refreshCustomerTargets()}>
                    Refresh targets
                  </Button>
                  <Button
                    icon={<Refresh theme='outline' size='15' />}
                    loading={loadingRuntime || customerContext.loading}
                    onClick={() => void refreshMissionControl()}
                  >
                    Check
                  </Button>
                </div>
              </div>
              <div className='mt-10px flex flex-wrap gap-8px'>
                {customerContext.targets.length === 0 ? (
                  <Tag color={customerContext.error ? 'orange' : 'gray'}>
                    {customerContext.error ?? customerContext.summaryText}
                  </Tag>
                ) : (
                  customerContext.targets.map((target) => (
                    <Button
                      key={target.customerId}
                      size='small'
                      type={target.customerId === customerContext.selectedCustomerId ? 'primary' : 'secondary'}
                      onClick={() => selectCustomer(target.customerId)}
                    >
                      {target.displayName}
                    </Button>
                  ))
                )}
              </div>
              <p className='m-0 mt-8px text-12px leading-18px text-t-secondary'>
                {customerContext.summaryText}. Runtime checks stay scoped to the selected customer.
              </p>
            </div>
          </section>
        </header>

        <section className='grid grid-cols-2 gap-10px md:grid-cols-4' aria-label='Runtime status summary'>
          <SummaryTile label='Running' value={counts.running} bucket='running' />
          <SummaryTile label='Done' value={counts.done} bucket='done' />
          <SummaryTile label='Blocked' value={counts.blocked} bucket='blocked' />
          <SummaryTile label='Waiting' value={counts.waiting} bucket='waiting' />
        </section>

        <section
          className='grid grid-cols-1 gap-10px rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px md:grid-cols-4'
          aria-label='Mission reality snapshot'
        >
          <SnapshotCell label='Customer' value={realitySnapshot.customerLabel} />
          <SnapshotCell
            label='Customer state'
            value={`${realitySnapshot.customerStatus} / ${realitySnapshot.customerHealth}`}
          />
          <SnapshotCell
            label='Loaded runtimes'
            value={`${realitySnapshot.loadedRuntimeCount} of ${RUNTIME_TARGETS.length}`}
          />
          <SnapshotCell label='Session source' value={realitySnapshot.sessionSource} />
          <SnapshotCell label='Latest evidence' value={formatDate(realitySnapshot.latestEvidenceAt) ?? 'none'} />
          <SnapshotCell label='Audit refs' value={realitySnapshot.auditRefs[0] ?? 'none'} />
          <SnapshotCell label='Source refs' value={realitySnapshot.sourceRefs[0] ?? 'none'} />
          <SnapshotCell label='Proof scope' value='Broker or fixture evidence only' />
        </section>

        <section className='grid grid-cols-1 gap-12px lg:grid-cols-2' aria-label='Runtime cards'>
          {runtimeStates.map((state) => (
            <RuntimeCard key={state.target.key} state={state} />
          ))}
        </section>
      </div>
    </div>
  );
};

const BetaGateCard: React.FC<{ item: BetaGateItem }> = ({ item }) => (
  <div className='min-h-96px rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-10px'>
    <div className='flex items-center gap-6px'>
      <Attention theme='outline' size='14' />
      <span className='text-12px font-semibold leading-18px text-t-primary'>{item.label}</span>
    </div>
    <p className='m-0 mt-6px text-12px leading-18px text-t-secondary'>{item.detail}</p>
  </div>
);

const SummaryTile: React.FC<{ label: string; value: number; bucket: StatusBucket }> = ({ label, value, bucket }) => (
  <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 px-14px py-12px'>
    <div className='flex items-center justify-between gap-8px'>
      <span className='text-13px leading-20px text-t-secondary'>{label}</span>
      <Tag color={statusColor(bucket)}>{statusLabel(bucket)}</Tag>
    </div>
    <div className='mt-8px text-26px font-semibold leading-30px text-t-primary'>{value}</div>
  </div>
);

const SnapshotCell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className='min-w-0 rounded-8px bg-fill-2 px-10px py-9px'>
    <div className='text-11px font-medium uppercase leading-16px text-t-tertiary'>{label}</div>
    <div className='mt-3px break-words text-13px leading-20px text-t-primary'>{safeUiText(value, '-')}</div>
  </div>
);

const RuntimeCard: React.FC<{ state: RuntimeLoadState }> = ({ state }) => {
  const bucket = statusBucket(state);
  const view = state.view;
  const statusText = safeUiText(view?.status, statusLabel(bucket));
  const healthText = state.error ?? safeUiText(view?.healthSummary, 'No runtime evidence loaded yet.');
  const activityAt = formatDate(view?.lastActivityAt ?? view?.lastCheckedAt);
  const Icon = state.target.kind === 'browser' ? Computer : state.target.kind === 'execution' ? CheckOne : Robot;

  return (
    <article
      className='min-h-190px rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'
      data-testid={`mission-runtime-card-${state.target.key}`}
    >
      <div className='flex items-start justify-between gap-12px'>
        <div className='flex min-w-0 items-start gap-10px'>
          <span className='mt-1px flex size-34px shrink-0 items-center justify-center rounded-8px bg-fill-3 text-t-primary'>
            <Icon theme='outline' size='18' />
          </span>
          <div className='min-w-0'>
            <h2 className='m-0 text-16px font-semibold leading-22px text-t-primary'>{state.target.label}</h2>
            <p className='m-0 mt-2px text-12px leading-18px text-t-secondary'>{state.target.role}</p>
          </div>
        </div>
        <Tag color={statusColor(bucket)}>{statusLabel(bucket)}</Tag>
      </div>

      <div className='mt-14px min-h-44px text-13px leading-20px text-t-secondary'>
        {state.loading ? (
          <span className='inline-flex items-center gap-8px'>
            <Spin size={14} />
            Loading runtime evidence
          </span>
        ) : (
          healthText
        )}
      </div>

      <div className='mt-14px grid grid-cols-1 gap-8px text-12px leading-18px text-t-secondary sm:grid-cols-2'>
        <EvidenceRow label='Status' value={statusText} />
        <EvidenceRow label='Customer' value={view?.customerId} />
        <EvidenceRow label='Owner' value={view?.owner} />
        <EvidenceRow label='Account' value={view?.customerAccountId} />
        <EvidenceRow label='Activity' value={activityAt} />
        <EvidenceRow label='Audit' value={view?.auditId} />
        <EvidenceRow label='Source' value={view?.sourcePointer} />
        <EvidenceRow
          label='URL'
          value={view?.currentUrlSummary?.displayText}
          redacted={view?.currentUrlSummary?.redacted}
        />
      </div>

      {bucket === 'blocked' ? (
        <div className='mt-12px flex items-center gap-6px text-12px leading-18px text-[rgb(var(--warning-6))]'>
          <Attention theme='outline' size='14' />
          Fail-closed until evaOS broker evidence is available.
        </div>
      ) : null}
    </article>
  );
};

const EvidenceRow: React.FC<{ label: string; value?: string; redacted?: boolean }> = ({ label, value, redacted }) => {
  const safeValue = safeUiText(value, '-');
  return (
    <div className='min-w-0'>
      <span className='text-t-tertiary'>{label}: </span>
      <span className='break-words text-t-secondary'>{safeValue}</span>
      {redacted ? <span className='text-t-tertiary'> redacted</span> : null}
    </div>
  );
};

export default MissionControlPage;
