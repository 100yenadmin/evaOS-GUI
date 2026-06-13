/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import classNames from 'classnames';
import { Button, Tag } from '@arco-design/web-react';
import { Comment, Computer, Link, Shield } from '@icon-park/react';
import { EVAOS_BETA_IDENTITY } from '@/common/evaos/betaIdentity';
import {
  EVAOS_NATIVE_COMPANION_BOUNDARY,
  EVAOS_NATIVE_COMPANION_STATUS_MATRIX,
  getEvaosNativeCompanionBoundaryViolations,
  type EvaosBoundaryCapability,
  type EvaosNativeCompanionCanary,
  type EvaosNativeCompanionStatusScenario,
  type EvaosNativeCompanionStatusSeverity,
} from '@/common/evaos/nativeCompanionBoundary';
import type { IEvaosNativeCompanionRepairAction, IEvaosNativeCompanionStatusView } from '@/common/evaos/bridgeTypes';
import { useEvaosNativeCompanionStatus } from '@/renderer/evaos/useEvaosNativeCompanionStatus';
import { isEvaosSupportDiagnosticsEnabled } from '@/renderer/evaos/supportDiagnostics';
import {
  getNativeCompanionRepairViewModel,
  type NativeCompanionReadinessItem,
  type NativeCompanionRepairStep,
  type NativeCompanionTone,
} from '@/renderer/evaos/nativeCompanionViewModel';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { openEvaosSupportEmail } from '@/renderer/utils/platform';

const NativeCompanionPage: React.FC = () => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const violations = getEvaosNativeCompanionBoundaryViolations();
  const { status, loading, error, refresh, openReleasedWorkbench, openRepairAction } = useEvaosNativeCompanionStatus();
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [handoffMessage, setHandoffMessage] = React.useState<string | null>(null);
  const viewModel = getNativeCompanionRepairViewModel({ status, loading, error });
  const showDiagnostics = isEvaosSupportDiagnosticsEnabled();

  const handleOpenReleasedWorkbench = React.useCallback(async () => {
    const result = await openReleasedWorkbench();
    setHandoffMessage(result.message);
  }, [openReleasedWorkbench]);

  const handlePrimaryAction = React.useCallback(async () => {
    if (viewModel.primaryAction.kind === 'refresh') {
      await refresh();
    }
  }, [refresh, viewModel.primaryAction.kind]);

  const handleOpenRepairAction = React.useCallback(
    async (action: IEvaosNativeCompanionRepairAction) => {
      const result = await openRepairAction(action);
      setHandoffMessage(result.message);
    },
    [openRepairAction]
  );

  const handleOpenSupportReport = React.useCallback(async () => {
    try {
      await openEvaosSupportEmail({
        subject: 'evaOS Workbench Beta support: Mac control',
        body: [
          'Route: /native-companion',
          `State: ${status?.readiness ?? viewModel.statusLabel}`,
          `Summary: ${status?.summaryText ?? viewModel.summary}`,
          error ? `Blocker: ${error}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      });
    } catch (supportError) {
      console.error('[NativeCompanionPage] Failed to open evaOS support report:', supportError);
    }
  }, [error, status?.readiness, status?.summaryText, viewModel.statusLabel, viewModel.summary]);

  return (
    <div
      className={classNames(
        'w-full min-h-full box-border overflow-y-auto',
        isMobile ? 'px-16px py-14px' : 'px-12px py-24px md:px-40px md:py-32px'
      )}
    >
      <div className='mx-auto flex w-full max-w-1080px box-border flex-col gap-16px'>
        <header className='flex flex-wrap items-start justify-between gap-12px'>
          <div className='min-w-0'>
            <h1 className='m-0 text-28px leading-34px font-bold text-t-primary max-sm:text-24px'>Mac &amp; iPhone</h1>
            <p className='m-0 mt-4px max-w-760px text-14px leading-22px text-t-secondary'>
              Check Mac control readiness for evaOS and Hermes. iPhone Mirroring is deferred for this controlled RC.
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-8px'>
            <Tag color={tagColorForTone(viewModel.statusTone)}>{viewModel.statusLabel}</Tag>
            <Tag color={violations.length === 0 ? 'green' : 'orange'}>
              {violations.length === 0 ? 'Boundary clean' : 'Boundary blocked'}
            </Tag>
          </div>
        </header>

        <section className='grid grid-cols-1 gap-10px md:grid-cols-5' aria-label='Mac control readiness'>
          {viewModel.readinessStrip.map((item) => (
            <ReadinessTile key={item.label} item={item} />
          ))}
        </section>

        <section
          data-testid='native-companion-repair-card'
          className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'
        >
          <div className='flex flex-wrap items-start justify-between gap-12px'>
            <div className='min-w-0'>
              <p className='m-0 text-12px font-semibold uppercase tracking-1px text-t-tertiary'>Mac control repair</p>
              <h2 className='m-0 mt-4px text-20px font-semibold leading-26px text-t-primary'>{viewModel.title}</h2>
              <p className='m-0 mt-6px max-w-760px text-13px leading-20px text-t-secondary'>{viewModel.summary}</p>
              {viewModel.reportedSummary && (
                <p className='m-0 mt-6px max-w-760px text-12px leading-18px text-t-secondary'>
                  Connector report: {viewModel.reportedSummary}
                </p>
              )}
              {handoffMessage && <p className='m-0 mt-6px text-12px leading-18px text-t-secondary'>{handoffMessage}</p>}
            </div>
            <Button
              type='primary'
              loading={loading}
              disabled={viewModel.primaryAction.disabled}
              onClick={() => void handlePrimaryAction()}
            >
              <span className='inline-flex items-center gap-6px'>
                <Computer theme='outline' size='16' />
                {viewModel.primaryAction.label}
              </span>
            </Button>
          </div>

          <div className='mt-16px grid grid-cols-1 gap-10px md:grid-cols-5'>
            {viewModel.repairSteps.map((step, index) => (
              <RepairStep key={step.title} step={step} index={index + 1} />
            ))}
          </div>

          <div className='mt-14px flex flex-wrap gap-8px' aria-label='Mac repair actions'>
            <Button type='secondary' onClick={() => void handleOpenRepairAction('accessibility')}>
              Open Accessibility
            </Button>
            <Button type='secondary' onClick={() => void handleOpenRepairAction('screen_recording')}>
              Open Screen Recording
            </Button>
            <Button type='secondary' loading={loading} onClick={() => void refresh()}>
              Refresh status
            </Button>
            {viewModel.statusTone !== 'ready' ? (
              <Button
                type='secondary'
                icon={<Comment theme='outline' size='16' />}
                onClick={() => void handleOpenSupportReport()}
              >
                Report to support
              </Button>
            ) : null}
          </div>

          <div className='mt-14px rounded-8px bg-fill-2 px-14px py-12px text-12px leading-18px text-t-secondary'>
            {viewModel.supportText}
          </div>
        </section>

        {showDiagnostics ? (
          <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'>
            <button
              type='button'
              aria-expanded={advancedOpen}
              className='flex w-full cursor-pointer items-center justify-between border-0 bg-transparent p-0 text-left'
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              <span>
                <span className='block text-17px font-semibold leading-24px text-t-primary'>Advanced diagnostics</span>
                <span className='mt-4px block text-12px leading-18px text-t-secondary'>
                  Status matrix, native boundary proof, secure callback policy, and RC canary requirements.
                </span>
              </span>
              <Tag color='gray'>{advancedOpen ? 'Open' : 'Collapsed'}</Tag>
            </button>

            {advancedOpen && (
              <div className='mt-16px flex flex-col gap-16px'>
                <AdvancedStatusPanel
                  status={status}
                  loading={loading}
                  onRefresh={() => void refresh()}
                  onOpenReleasedWorkbench={() => void handleOpenReleasedWorkbench()}
                />
                <StatusMatrixSection />
                <BoundarySection />
                <CallbackPolicySection />
                <CapabilitySection />
                <CanarySection />
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
};

const ReadinessTile: React.FC<{ item: NativeCompanionReadinessItem }> = ({ item }) => (
  <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 px-14px py-12px'>
    <div className='flex items-center justify-between gap-8px'>
      <div className='text-12px leading-18px text-t-secondary'>{item.label}</div>
      <span className={classNames('size-8px rounded-full', toneDotClass(item.tone))} aria-hidden='true' />
    </div>
    <div className='mt-6px text-16px font-semibold leading-22px text-t-primary'>{item.value}</div>
    <div className='mt-4px text-11px leading-16px text-t-tertiary'>{item.help}</div>
  </div>
);

const RepairStep: React.FC<{ step: NativeCompanionRepairStep; index: number }> = ({ step, index }) => (
  <article className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-12px'>
    <div className='flex items-start gap-8px'>
      <span className='flex size-24px shrink-0 items-center justify-center rounded-8px bg-fill-3 text-12px font-semibold text-t-primary'>
        {index}
      </span>
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center gap-6px'>
          <h3 className='m-0 text-13px font-semibold leading-18px text-t-primary'>{step.title}</h3>
          <Tag color={tagColorForTone(step.state)}>{step.state}</Tag>
        </div>
        <p className='m-0 mt-6px text-12px leading-18px text-t-secondary'>{step.detail}</p>
      </div>
    </div>
  </article>
);

const AdvancedStatusPanel: React.FC<{
  status: IEvaosNativeCompanionStatusView | null;
  loading: boolean;
  onRefresh: () => void;
  onOpenReleasedWorkbench: () => void;
}> = ({ status, loading, onRefresh, onOpenReleasedWorkbench }) => (
  <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px'>
    <div className='flex flex-wrap items-start justify-between gap-12px'>
      <div className='min-w-0'>
        <h2 className='m-0 text-18px font-semibold leading-24px text-t-primary'>Read-only native proof</h2>
        <p className='m-0 mt-6px text-13px leading-20px text-t-secondary'>
          Detailed proof remains status-only. The renderer does not own pairing, permissions, local audit, or native
          credentials.
        </p>
      </div>
      <div className='flex flex-wrap items-center gap-8px'>
        <Button size='small' loading={loading} onClick={onRefresh}>
          Refresh
        </Button>
        <Button size='small' disabled={!status?.canOpenReleasedWorkbench} onClick={onOpenReleasedWorkbench}>
          Open released Workbench fallback
        </Button>
      </div>
    </div>
    <div className='mt-14px grid grid-cols-1 gap-8px text-12px leading-18px text-t-secondary md:grid-cols-2'>
      <EvidenceRow label='Bridge CLI' value={status?.bridgeCli.status ?? 'checking'} />
      <EvidenceRow label='Bridge audit' value={status?.bridgeCli.auditId ?? 'none'} />
      <EvidenceRow label='Customer Mac' value={status?.customerMac.status ?? 'checking'} />
      <EvidenceRow label='Device label' value={status?.customerMac.deviceLabel ?? 'none'} />
      <EvidenceRow label='Screen sharing' value={status?.customerMac.screenSharing ?? 'unknown'} />
      <EvidenceRow label='iPhone Mirroring' value={status ? iPhoneSummary(status) : 'checking'} />
      <EvidenceRow label='Audit IDs' value={status?.audit.auditIds.join(', ') || 'none'} />
      <EvidenceRow label='Source' value={status?.sourcePointer ?? 'native-companion:checking'} />
      <EvidenceRow
        label='Released Workbench'
        value={status?.releasedWorkbench.installed ? status.releasedWorkbench.path || 'installed' : 'not installed'}
      />
      <EvidenceRow label='Renderer owns trust authority' value='false' />
    </div>
  </section>
);

const StatusMatrixSection: React.FC = () => (
  <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px'>
    <div className='flex flex-wrap items-start justify-between gap-12px'>
      <div className='min-w-0'>
        <h2 className='m-0 text-18px font-semibold leading-24px text-t-primary'>Native companion status matrix</h2>
        <p className='m-0 mt-6px text-13px leading-20px text-t-secondary'>
          Agent-facing status proof for install, pairing, permission, ready, and unavailable states.
        </p>
      </div>
      <Tag color='gray'>Advanced</Tag>
    </div>
    <div className='mt-14px grid grid-cols-1 gap-10px lg:grid-cols-2'>
      {EVAOS_NATIVE_COMPANION_STATUS_MATRIX.map((scenario) => (
        <NativeStatusCard key={scenario.key} scenario={scenario} />
      ))}
    </div>
  </section>
);

const BoundarySection: React.FC = () => (
  <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px'>
    <div className='flex flex-wrap items-start justify-between gap-12px'>
      <div className='flex min-w-0 items-start gap-10px'>
        <span className='mt-1px flex size-38px shrink-0 items-center justify-center rounded-8px bg-fill-3 text-t-primary'>
          <Shield theme='outline' size='20' />
        </span>
        <div className='min-w-0'>
          <h2 className='m-0 text-18px font-semibold leading-24px text-t-primary'>Native companion boundary</h2>
          <p className='m-0 mt-6px text-13px leading-20px text-t-secondary'>
            {EVAOS_NATIVE_COMPANION_BOUNDARY.betaReleaseNote}
          </p>
        </div>
      </div>
      <Tag color='gray'>Issue #109</Tag>
    </div>

    <div className='mt-14px grid grid-cols-1 gap-8px text-12px leading-18px text-t-secondary md:grid-cols-2'>
      <EvidenceRow label='Boundary version' value={EVAOS_NATIVE_COMPANION_BOUNDARY.version} />
      <EvidenceRow label='Shell role' value={EVAOS_NATIVE_COMPANION_BOUNDARY.shell.role} />
      <EvidenceRow
        label='Shell is local trust authority'
        value={String(EVAOS_NATIVE_COMPANION_BOUNDARY.shell.isLocalTrustAuthority)}
      />
      <EvidenceRow
        label='Renderer receives native secrets'
        value={String(EVAOS_NATIVE_COMPANION_BOUNDARY.shell.rendererReceivesNativeSecrets)}
      />
      <EvidenceRow
        label='Renderer receives session tokens'
        value={String(EVAOS_NATIVE_COMPANION_BOUNDARY.shell.rendererReceivesSessionTokens)}
      />
      <EvidenceRow
        label='Fallback requirement'
        value={EVAOS_NATIVE_COMPANION_BOUNDARY.releasedWorkbenchFallback.requiredUntil}
      />
    </div>
  </section>
);

const CallbackPolicySection: React.FC = () => (
  <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px'>
    <div className='flex items-start gap-10px'>
      <span className='mt-1px flex size-34px shrink-0 items-center justify-center rounded-8px bg-fill-3 text-t-primary'>
        <Link theme='outline' size='18' />
      </span>
      <div className='min-w-0'>
        <h2 className='m-0 text-17px font-semibold leading-24px text-t-primary'>Secure callback policy</h2>
        <p className='m-0 mt-6px text-13px leading-20px text-t-secondary'>
          Deep-link policy stays main-process and broker-owned. Renderer status proof shows the scheme, handoff target,
          and owner, not callback secrets.
        </p>
      </div>
    </div>
    <div className='mt-14px grid grid-cols-1 gap-8px text-12px leading-18px text-t-secondary md:grid-cols-2'>
      <EvidenceRow label='Product' value={EVAOS_BETA_IDENTITY.productName} />
      <EvidenceRow label='Bundle id' value={EVAOS_BETA_IDENTITY.appId} />
      <EvidenceRow label='Deep-link scheme' value={EVAOS_BETA_IDENTITY.protocolScheme} />
      <EvidenceRow label='Loopback path' value={EVAOS_BETA_IDENTITY.loopbackCallbackPath} />
      <EvidenceRow
        label='Main process validates scheme'
        value={String(EVAOS_NATIVE_COMPANION_BOUNDARY.callbackPolicy.mainProcessValidatesScheme)}
      />
      <EvidenceRow
        label='Renderer receives callback secrets'
        value={String(EVAOS_NATIVE_COMPANION_BOUNDARY.callbackPolicy.rendererReceivesCallbackSecrets)}
      />
    </div>
  </section>
);

const CapabilitySection: React.FC = () => (
  <section className='grid grid-cols-1 gap-10px lg:grid-cols-2'>
    {[
      ...EVAOS_NATIVE_COMPANION_BOUNDARY.brokerCapabilities,
      ...EVAOS_NATIVE_COMPANION_BOUNDARY.nativeCompanionCapabilities,
    ].map((capability) => (
      <CapabilityCard key={capability.id} capability={capability} />
    ))}
  </section>
);

const CanarySection: React.FC = () => (
  <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px'>
    <div className='flex flex-wrap items-start justify-between gap-12px'>
      <div className='min-w-0'>
        <h2 className='m-0 text-18px font-semibold leading-24px text-t-primary'>RC native canary contract</h2>
        <p className='m-0 mt-6px text-13px leading-20px text-t-secondary'>
          Native Mac parity is blocked until these exact canaries pass for the candidate without skipped rows.
        </p>
      </div>
      <Tag color='orange'>Required for RC</Tag>
    </div>
    <div className='mt-14px grid grid-cols-1 gap-10px lg:grid-cols-2'>
      {EVAOS_NATIVE_COMPANION_BOUNDARY.rcCanaries.map((canary) => (
        <CanaryCard key={canary.id} canary={canary} />
      ))}
    </div>
  </section>
);

const NativeStatusCard: React.FC<{ scenario: EvaosNativeCompanionStatusScenario }> = ({ scenario }) => (
  <article className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
    <div className='flex flex-wrap items-start justify-between gap-8px'>
      <div className='min-w-0'>
        <h3 className='m-0 text-15px font-semibold leading-22px text-t-primary'>{scenario.label}</h3>
        <p className='m-0 mt-4px text-12px leading-18px text-t-secondary'>{scenario.summary}</p>
      </div>
      <Tag color={statusSeverityColor(scenario.severity)}>{scenario.severity}</Tag>
    </div>
    <div className='mt-12px grid grid-cols-1 gap-8px text-12px leading-18px text-t-secondary'>
      <EvidenceRow label='Status source' value={scenario.statusSource} />
      <EvidenceRow label='Evidence' value={scenario.evidence.join('; ')} />
      <EvidenceRow label='Open-native handoff' value={scenario.handoff.label} />
      <EvidenceRow label='Handoff owner' value={scenario.handoff.owner} />
      <EvidenceRow label='Handoff enabled by shell' value={String(scenario.handoff.enabled)} />
      <EvidenceRow label='Handoff target' value={scenario.handoff.target} />
    </div>
  </article>
);

const EvidenceRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className='min-w-0'>
    <span className='text-t-tertiary'>{label}: </span>
    <span className='break-words text-t-secondary'>{value}</span>
  </div>
);

const CapabilityCard: React.FC<{ capability: EvaosBoundaryCapability }> = ({ capability }) => (
  <article className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px'>
    <div className='flex flex-wrap items-start justify-between gap-8px'>
      <div className='flex min-w-0 items-start gap-10px'>
        <span className='mt-1px flex size-32px shrink-0 items-center justify-center rounded-8px bg-fill-3 text-t-primary'>
          <Computer theme='outline' size='17' />
        </span>
        <div className='min-w-0'>
          <h3 className='m-0 break-words text-15px font-semibold leading-22px text-t-primary'>
            {capabilityDisplayName(capability.id)}
          </h3>
          <p className='m-0 mt-4px text-12px leading-18px text-t-secondary'>{capability.owner}</p>
        </div>
      </div>
      <Tag color={capability.owner === 'evaos-native-companion' ? 'orange' : 'arcoblue'}>{capability.owner}</Tag>
    </div>
    <div className='mt-12px grid grid-cols-1 gap-8px text-12px leading-18px text-t-secondary'>
      <EvidenceRow label='Shell may' value={capability.shellMay.join('; ')} />
      <EvidenceRow label='Shell must not' value={capability.shellMustNot.join('; ')} />
      <EvidenceRow label='Proof required' value={capability.proofRequired.join(', ')} />
    </div>
  </article>
);

const CanaryCard: React.FC<{ canary: EvaosNativeCompanionCanary }> = ({ canary }) => (
  <article className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
    <div className='flex flex-wrap items-start justify-between gap-8px'>
      <h3 className='m-0 break-words text-15px font-semibold leading-22px text-t-primary'>{canary.id}</h3>
      <Tag color={canary.forbidsSkips ? 'orange' : 'gray'}>{canary.forbidsSkips ? 'No skips' : 'Skips allowed'}</Tag>
    </div>
    <div className='mt-12px grid grid-cols-1 gap-8px text-12px leading-18px text-t-secondary'>
      <EvidenceRow label='Command' value={canary.command} />
      <EvidenceRow label='Required artifact' value={canary.requiredArtifact} />
    </div>
  </article>
);

function capabilityDisplayName(id: string): string {
  if (id === 'desktop-session') {
    return 'broker session handoff';
  }
  return id;
}

function tagColorForTone(tone: NativeCompanionTone): string {
  if (tone === 'ready') return 'green';
  if (tone === 'attention') return 'orange';
  if (tone === 'offline') return 'red';
  return 'gray';
}

function toneDotClass(tone: NativeCompanionTone): string {
  if (tone === 'ready') return 'bg-[rgb(var(--green-6))]';
  if (tone === 'attention') return 'bg-[rgb(var(--orange-6))]';
  if (tone === 'offline') return 'bg-[rgb(var(--red-6))]';
  return 'bg-[var(--color-text-4)]';
}

function statusSeverityColor(severity: EvaosNativeCompanionStatusSeverity): string {
  if (severity === 'ready') {
    return 'green';
  }
  if (severity === 'warning') {
    return 'orange';
  }
  return 'red';
}

function iPhoneSummary(status: IEvaosNativeCompanionStatusView | null | undefined): string {
  if (!status) {
    return 'checking';
  }
  if (!status.iPhone.installed) {
    return 'unavailable';
  }
  return status.iPhone.running ? 'running' : 'available';
}

export default NativeCompanionPage;
