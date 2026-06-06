/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import classNames from 'classnames';
import { Tag } from '@arco-design/web-react';
import { Computer, Link, Shield } from '@icon-park/react';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
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

const NativeCompanionPage: React.FC = () => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const violations = getEvaosNativeCompanionBoundaryViolations();

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
              Native companion status boundary for Mac pairing, permissions, iPhone access, signed helper behavior, and
              secure callbacks.
            </p>
          </div>
          <Tag color={violations.length === 0 ? 'green' : 'orange'}>
            {violations.length === 0 ? 'Boundary clean' : 'Boundary blocked'}
          </Tag>
        </header>

        <section className='grid grid-cols-1 gap-10px md:grid-cols-5'>
          <StatusTile label='Install' value='Not installed' />
          <StatusTile label='Pairing' value='Not paired' />
          <StatusTile label='Permissions' value='Permission needed' />
          <StatusTile label='iPhone' value='Unavailable' />
          <StatusTile label='Trust authority' value='Native companion' />
        </section>

        <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'>
          <div className='flex flex-wrap items-start justify-between gap-12px'>
            <div className='min-w-0'>
              <h2 className='m-0 text-18px font-semibold leading-24px text-t-primary'>
                Native companion status matrix
              </h2>
              <p className='m-0 mt-6px text-13px leading-20px text-t-secondary'>
                Status-only proof for install, pairing, permission, ready, and unavailable states. AionUi may show the
                handoff target, but native trust remains outside the shell.
              </p>
            </div>
            <Tag color='gray'>Status source required</Tag>
          </div>

          <div className='mt-14px grid grid-cols-1 gap-10px lg:grid-cols-2'>
            {EVAOS_NATIVE_COMPANION_STATUS_MATRIX.map((scenario) => (
              <NativeStatusCard key={scenario.key} scenario={scenario} />
            ))}
          </div>
        </section>

        <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'>
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
              label='AionUi shell is local trust authority'
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

        <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'>
          <div className='flex items-start gap-10px'>
            <span className='mt-1px flex size-34px shrink-0 items-center justify-center rounded-8px bg-fill-3 text-t-primary'>
              <Link theme='outline' size='18' />
            </span>
            <div className='min-w-0'>
              <h2 className='m-0 text-17px font-semibold leading-24px text-t-primary'>Secure callback policy</h2>
              <p className='m-0 mt-6px text-13px leading-20px text-t-secondary'>
                Deep-link policy stays main-process and broker-owned. Renderer status proof shows the scheme, handoff
                target, and owner, not callback secrets.
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

        <section className='grid grid-cols-1 gap-10px lg:grid-cols-2'>
          {[
            ...EVAOS_NATIVE_COMPANION_BOUNDARY.brokerCapabilities,
            ...EVAOS_NATIVE_COMPANION_BOUNDARY.nativeCompanionCapabilities,
          ].map((capability) => (
            <CapabilityCard key={capability.id} capability={capability} />
          ))}
        </section>

        <section className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'>
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
      </div>
    </div>
  );
};

const StatusTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 px-14px py-12px'>
    <div className='text-12px leading-18px text-t-secondary'>{label}</div>
    <div className='mt-6px text-18px font-semibold leading-24px text-t-primary'>{value}</div>
  </div>
);

const NativeStatusCard: React.FC<{ scenario: EvaosNativeCompanionStatusScenario }> = ({ scenario }) => (
  <article className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px'>
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
  <article className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-14px'>
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
  <article className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-14px'>
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

function statusSeverityColor(severity: EvaosNativeCompanionStatusSeverity): string {
  if (severity === 'ready') {
    return 'green';
  }
  if (severity === 'warning') {
    return 'orange';
  }
  return 'red';
}

export default NativeCompanionPage;
