/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import classNames from 'classnames';
import { Button, Message, Tag } from '@arco-design/web-react';
import { Comment, Computer, Link, Shield } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
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
import type {
  IEvaosCustomerTargetView,
  IEvaosNativeCompanionActionRequest,
  IEvaosNativeCompanionActionResult,
  IEvaosNativeCompanionAgentPairingStatus,
  IEvaosNativeCompanionRepairAction,
  IEvaosNativeCompanionRuntimeToolReadiness,
  IEvaosNativeCompanionStatusView,
  IEvaosWorkbenchDiagnosticPacketV1,
} from '@/common/evaos/bridgeTypes';
import { useEvaosNativeCompanionStatus } from '@/renderer/evaos/useEvaosNativeCompanionStatus';
import { canShowEvaosSupportDiagnostics } from '@/renderer/evaos/supportDiagnostics';
import { buildEvaosSupportReportContext } from '@/renderer/evaos/supportReportContext';
import {
  canCreateNativeCompanionPairingPrompt,
  connectorServiceReady,
  getNativeCompanionRepairViewModel,
  type NativeCompanionReadinessItem,
  type NativeCompanionRepairStep,
  type NativeCompanionTone,
  type NativeCompanionNextAction,
} from '@/renderer/evaos/nativeCompanionViewModel';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { useEvaosBrokeredCustomerContext } from '@renderer/hooks/context/EvaosCustomerContext';
import { useFeedback } from '@renderer/hooks/context/FeedbackContext';
import { evaosBrokerSessionKey } from '@renderer/hooks/useEvaosBrokerSessionStatus';
import { EVAOS_DESKTOP_SESSION_IMPORTED_EVENT } from '@renderer/hooks/system/useDeepLink';
import { openExternalUrl } from '@/renderer/utils/platform';
import { evaosBroker } from '@/common/adapter/ipcBridge';

const MAC_TARGET_BOUND_NATIVE_COMPANION_ACTIONS: ReadonlySet<IEvaosNativeCompanionActionRequest['action']> = new Set([
  'connector_start',
  'connector_stop',
  'setup_check',
  'ensure_customer_mac_connector_grant',
  'control_status',
  'control_start',
  'control_stop',
  'kill_switch',
  'audit_tail',
  'create_pairing_prompt',
  'secure_network_enroll',
]);

const NativeCompanionPage: React.FC = () => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const violations = getEvaosNativeCompanionBoundaryViolations();
  const { customerContext, brokerSession, brokerAuthenticated, brokerSessionLoading } =
    useEvaosBrokeredCustomerContext();
  const { openFeedback } = useFeedback();
  const { selectedCustomerId, selectedTarget, targets = [], isOperator } = customerContext;
  const [lockedPairingCustomerId, setLockedPairingCustomerId] = React.useState<string | undefined>();
  const pairableMacControlTargets = React.useMemo(() => targets.filter(isPairableMacControlTarget), [targets]);
  const selectedPairingTarget = React.useMemo(
    () =>
      selectMacPairingTarget({
        targets: pairableMacControlTargets,
        selectedCustomerId,
        selectedTarget,
        lockedPairingCustomerId,
        isOperator,
      }),
    [isOperator, lockedPairingCustomerId, pairableMacControlTargets, selectedCustomerId, selectedTarget]
  );
  const selectedPairingCustomerId = selectedPairingTarget?.customerId;
  const { status, loading, error, refresh, openReleasedWorkbench, openRepairAction, runAction, getDiagnosticPacket } =
    useEvaosNativeCompanionStatus(true, selectedPairingCustomerId);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [connectorActionsOpen, setConnectorActionsOpen] = React.useState(false);
  const [handoffMessage, setHandoffMessage] = React.useState<string | null>(null);
  const [actionResult, setActionResult] = React.useState<IEvaosNativeCompanionActionResult | null>(null);
  const [actionInFlight, setActionInFlight] = React.useState<IEvaosNativeCompanionActionRequest['action'] | null>(null);
  const [authInFlight, setAuthInFlight] = React.useState(false);
  const [copyMessage, setCopyMessage] = React.useState<string | null>(null);
  const [authUrl, setAuthUrl] = React.useState<string | null>(null);
  const [takeoverCue, setTakeoverCue] = React.useState<string | null>(null);
  const [takeoverCueWarning, setTakeoverCueWarning] = React.useState<string | null>(null);
  const [actionResultCustomerId, setActionResultCustomerId] = React.useState<string | undefined>();
  const brokerSessionKey = evaosBrokerSessionKey(brokerSession);
  const lastBrokerSessionKeyRef = React.useRef<string | undefined>(brokerSessionKey);
  const selectedPairingCustomerRef = React.useRef<string | undefined>(selectedPairingCustomerId);
  React.useEffect(() => {
    const previousSessionKey = lastBrokerSessionKeyRef.current;
    lastBrokerSessionKeyRef.current = brokerSessionKey;
    if (!brokerSessionKey || brokerSessionKey === previousSessionKey) {
      return;
    }

    setActionResult((current) => (isPairingBrokerSessionRequired(current) ? null : current));
    setActionResultCustomerId(undefined);
    setCopyMessage(null);
    setHandoffMessage(null);
    setAuthUrl(null);
    setTakeoverCue(null);
    setTakeoverCueWarning(null);
  }, [brokerSessionKey]);
  React.useEffect(() => {
    const handleDesktopSessionImported = () => {
      setActionResult((current) => (isPairingBrokerSessionRequired(current) ? null : current));
      setActionResultCustomerId(undefined);
      setCopyMessage(null);
      setHandoffMessage(null);
      setAuthUrl(null);
      setTakeoverCue(null);
      setTakeoverCueWarning(null);
    };
    window.addEventListener(EVAOS_DESKTOP_SESSION_IMPORTED_EVENT, handleDesktopSessionImported);
    return () => {
      window.removeEventListener(EVAOS_DESKTOP_SESSION_IMPORTED_EVENT, handleDesktopSessionImported);
    };
  }, []);
  React.useEffect(() => {
    selectedPairingCustomerRef.current = selectedPairingCustomerId;
    setActionResult(null);
    setActionResultCustomerId(undefined);
    setCopyMessage(null);
    setHandoffMessage(null);
    setAuthUrl(null);
    setTakeoverCue(null);
    setTakeoverCueWarning(null);
  }, [selectedPairingCustomerId]);
  const currentActionResult = React.useMemo(
    () =>
      actionResultForCurrentPairingCustomer(actionResult, selectedPairingCustomerId, actionResultCustomerId, status),
    [actionResult, actionResultCustomerId, selectedPairingCustomerId, status]
  );
  const currentActionResultMessage = currentActionResult
    ? localizedNativeCompanionActionResultMessage(currentActionResult, t)
    : undefined;
  const selectedPairingStatus = React.useMemo(
    () => statusForSelectedPairingCustomer(status, selectedPairingCustomerId),
    [selectedPairingCustomerId, status]
  );
  React.useEffect(() => {
    if (!actionResult || currentActionResult) return;
    setActionResult(null);
    setActionResultCustomerId(undefined);
    setCopyMessage(null);
    setHandoffMessage(null);
  }, [actionResult, currentActionResult]);
  const permissionGuideDetail = t('evaos.nativeCompanion.permissionGuideDetail');
  const prerequisiteCopy = React.useMemo(
    () => ({
      repairWorkbenchTitle: t('evaos.nativeCompanion.onboarding.repairWorkbenchTitle'),
      repairWorkbenchMissingDetail: t('evaos.nativeCompanion.onboarding.repairWorkbenchMissingDetail'),
      repairWorkbenchIncompatibleDetail: t('evaos.nativeCompanion.onboarding.repairWorkbenchIncompatibleDetail'),
      repairControlToolsTitle: t('evaos.nativeCompanion.onboarding.repairControlToolsTitle'),
      repairControlToolsDetail: t('evaos.nativeCompanion.onboarding.repairControlToolsDetail'),
      clientMissingTitle: t('evaos.nativeCompanion.onboarding.clientMissingTitle'),
      clientMissingStateTitle: t('evaos.nativeCompanion.onboarding.clientMissingStateTitle'),
      clientMissingDetail: t('evaos.nativeCompanion.onboarding.clientMissingDetail'),
      clientStoppedTitle: t('evaos.nativeCompanion.onboarding.clientStoppedTitle'),
      clientStoppedDetail: t('evaos.nativeCompanion.onboarding.clientStoppedDetail'),
      unenrolledTitle: t('evaos.nativeCompanion.onboarding.unenrolledTitle'),
      unenrolledDetail: t('evaos.nativeCompanion.onboarding.unenrolledDetail'),
      wrongControlPlaneTitle: t('evaos.nativeCompanion.onboarding.wrongControlPlaneTitle'),
      wrongControlPlaneDetail: t('evaos.nativeCompanion.onboarding.wrongControlPlaneDetail'),
      aclBlockedTitle: t('evaos.nativeCompanion.onboarding.aclBlockedTitle'),
      aclBlockedDetail: t('evaos.nativeCompanion.onboarding.aclBlockedDetail'),
      offlineTitle: t('evaos.nativeCompanion.onboarding.offlineTitle'),
      offlineDetail: t('evaos.nativeCompanion.onboarding.offlineDetail'),
      errorTitle: t('evaos.nativeCompanion.onboarding.errorTitle'),
      errorDetail: t('evaos.nativeCompanion.onboarding.errorDetail'),
      refreshSessionLabel: t('evaos.nativeCompanion.onboarding.refreshSessionLabel'),
      refreshSessionTitle: t('evaos.nativeCompanion.onboarding.refreshSessionTitle'),
      refreshSessionDetail: t('evaos.nativeCompanion.onboarding.refreshSessionDetail'),
      checkingSessionLabel: t('evaos.nativeCompanion.onboarding.checkingSessionLabel'),
      checkingSessionTitle: t('evaos.nativeCompanion.onboarding.checkingSessionTitle'),
      checkingSessionDetail: t('evaos.nativeCompanion.onboarding.checkingSessionDetail'),
      signInLabel: t('evaos.nativeCompanion.onboarding.signInLabel'),
      signInTitle: t('evaos.nativeCompanion.onboarding.signInTitle'),
      signInDetail: t('evaos.nativeCompanion.onboarding.signInDetail'),
      selectCustomerLabel: t('evaos.nativeCompanion.onboarding.selectCustomerLabel'),
      selectCustomerTitle: t('evaos.nativeCompanion.onboarding.selectCustomerTitle'),
      selectCustomerDetail: t('evaos.nativeCompanion.onboarding.selectCustomerDetail'),
      chooseMacTargetLabel: t('evaos.nativeCompanion.onboarding.chooseMacTargetLabel'),
      chooseMacTargetTitle: t('evaos.nativeCompanion.onboarding.chooseMacTargetTitle'),
      chooseMacTargetDetail: t('evaos.nativeCompanion.onboarding.chooseMacTargetDetail'),
    }),
    [t]
  );
  const viewModel = getNativeCompanionRepairViewModel({
    status: selectedPairingStatus,
    loading,
    error,
    hasSelectedCustomer: Boolean(selectedCustomerId || lockedPairingCustomerId),
    hasPairableCustomer: selectedCustomerId || lockedPairingCustomerId ? Boolean(selectedPairingCustomerId) : undefined,
    brokerAuthenticated,
    brokerSessionLoading,
    actionResult: currentActionResult,
    pairingPromptCopied: Boolean(copyMessage),
    permissionGuideDetail,
    prerequisiteCopy,
  });
  const showDiagnostics = canShowEvaosSupportDiagnostics({
    authenticated: brokerAuthenticated,
    userEmail: brokerSession?.userEmail,
    roles: customerContext.roles,
    isOperator,
  });
  const showOperatorDetails = Boolean(isOperator);
  const agentPairingStatus = effectiveAgentPairingStatus(selectedPairingStatus, currentActionResult);
  const runtimeToolReadiness = selectedPairingStatus?.runtimeToolReadiness ?? 'not_ready';
  const shouldShowAgentProof = selectedPairingStatus?.readiness === 'ready' && isAgentProofVisible(agentPairingStatus);
  const brokerSessionRequired = isPairingBrokerSessionRequired(currentActionResult);
  const connectorStartAvailable =
    !connectorServiceReady(selectedPairingStatus) &&
    currentActionResult?.blockerReason !== 'listener_replacement_unproven';
  const canCreatePairingPrompt = canCreateNativeCompanionPairingPrompt({
    status: selectedPairingStatus,
    loading,
    error,
    hasSelectedCustomer: Boolean(selectedCustomerId || lockedPairingCustomerId),
    hasPairableCustomer: selectedCustomerId || lockedPairingCustomerId ? Boolean(selectedPairingCustomerId) : undefined,
    brokerAuthenticated,
    brokerSessionLoading,
    actionResult: currentActionResult,
    pairingPromptCopied: Boolean(copyMessage),
    permissionGuideDetail,
    prerequisiteCopy,
  });
  const guidedGrantActive = agentPairingStatus === 'agent_paired' || currentActionResult?.connectorGrant?.ok === true;
  const guidedSetupReady = runtimeToolReadiness === 'tools_ready';

  const handleOpenReleasedWorkbench = React.useCallback(async () => {
    const result = await openReleasedWorkbench();
    setHandoffMessage(result.message);
  }, [openReleasedWorkbench]);

  const handleOpenRepairAction = React.useCallback(
    async (action: IEvaosNativeCompanionRepairAction) => {
      const result = await openRepairAction(action);
      setHandoffMessage(result.message);
    },
    [openRepairAction]
  );

  const handleRunAction = React.useCallback(
    async (request: IEvaosNativeCompanionActionRequest) => {
      setActionInFlight(request.action);
      setCopyMessage(null);
      setTakeoverCueWarning(null);
      if (request.action === 'secure_network_enroll') {
        setHandoffMessage('Connecting this Mac securely. This can take a few minutes; do not click again.');
      }
      const targetsMacControlCustomer = MAC_TARGET_BOUND_NATIVE_COMPANION_ACTIONS.has(request.action);
      const requestCustomerId =
        request.customerId ?? (targetsMacControlCustomer ? selectedPairingCustomerId : selectedCustomerId);
      if (targetsMacControlCustomer && requestCustomerId) {
        setLockedPairingCustomerId(requestCustomerId);
      }
      try {
        if (request.action === 'control_start') {
          const cueResult = await runMacControlTakeoverCue(setTakeoverCue);
          if (cueResult.warning) {
            setTakeoverCueWarning(cueResult.warning);
          }
        }
        const result = await runAction({
          ...request,
          customerId: requestCustomerId,
          agentLabel: request.agentLabel ?? 'evaOS Workbench',
        });
        if (targetsMacControlCustomer && requestCustomerId !== selectedPairingCustomerRef.current) {
          return;
        }
        if (
          request.action === 'create_pairing_prompt' &&
          result.status !== 'succeeded' &&
          result.sourcePointer !== 'native-companion:pairing-broker-session-required'
        ) {
          setLockedPairingCustomerId(undefined);
        }
        setActionResult(result);
        setActionResultCustomerId(targetsMacControlCustomer ? requestCustomerId : undefined);
        setHandoffMessage(localizedNativeCompanionActionResultMessage(result, t));
        if (result.refreshRecommended) {
          await refresh();
        }
      } finally {
        setTakeoverCue(null);
        setActionInFlight(null);
      }
    },
    [refresh, runAction, selectedCustomerId, selectedPairingCustomerId, t]
  );

  const handleCopyPairingPrompt = React.useCallback(async () => {
    const prompt = currentActionResult?.pairing?.setupPrompt;
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopyMessage('Pairing prompt copied.');
  }, [currentActionResult?.pairing?.setupPrompt]);

  const handlePairingTargetChange = React.useCallback((customerId: string) => {
    setLockedPairingCustomerId(customerId || undefined);
  }, []);

  const handleReconnectWorkbench = React.useCallback(async () => {
    if (selectedPairingCustomerId) {
      setLockedPairingCustomerId(selectedPairingCustomerId);
    }
    setAuthInFlight(true);
    setHandoffMessage(null);
    setCopyMessage(null);
    setAuthUrl(null);
    try {
      const response = await evaosBroker.beginDesktopAuth.invoke();
      if (!response.success || !response.data) {
        setHandoffMessage(response.msg || t('evaos.nativeCompanion.desktopAuthStartFailed'));
        return;
      }
      setAuthUrl(response.data.authUrl ?? null);
      setHandoffMessage(response.data.message || t('evaos.nativeCompanion.desktopAuthContinue'));
    } catch {
      setHandoffMessage(t('evaos.nativeCompanion.desktopAuthStartFailed'));
    } finally {
      setAuthInFlight(false);
    }
  }, [selectedPairingCustomerId, t]);

  const handleOpenAuthUrl = React.useCallback(async () => {
    if (!authUrl) return;
    try {
      await openExternalUrl(authUrl);
    } catch (openError) {
      console.error('evaOS sign-in link open failed:', openError);
      await navigator.clipboard.writeText(authUrl);
      Message.warning('Copied the sign-in link. Paste it into your browser to continue.');
    }
  }, [authUrl]);

  const handleCopyAuthUrl = React.useCallback(async () => {
    if (!authUrl) return;
    await navigator.clipboard.writeText(authUrl);
    Message.success('Copied the sign-in link.');
  }, [authUrl]);

  const handleNextAction = React.useCallback(
    async (nextAction: NativeCompanionNextAction) => {
      if (nextAction.disabled || nextAction.kind === 'none') return;
      if (nextAction.kind === 'refresh') {
        await refresh();
        return;
      }
      if (nextAction.kind === 'reconnect') {
        await handleReconnectWorkbench();
        return;
      }
      if (nextAction.kind === 'repair' && nextAction.repairAction) {
        await handleOpenRepairAction(nextAction.repairAction);
        return;
      }
      if (nextAction.kind === 'copy') {
        await handleCopyPairingPrompt();
        return;
      }
      if (nextAction.kind === 'run' && nextAction.action) {
        await handleRunAction({
          action: nextAction.action,
          mode: nextAction.mode,
        });
      }
    },
    [handleCopyPairingPrompt, handleOpenRepairAction, handleReconnectWorkbench, handleRunAction, refresh]
  );

  const handleOpenSupportReport = React.useCallback(async () => {
    try {
      const diagnosticPacket = await getDiagnosticPacket({
        route: '/native-companion',
        accountEmail: brokerSession?.userEmail,
        customerId: selectedPairingCustomerId ?? selectedCustomerId,
        customerLabel: selectedPairingTarget?.displayName ?? selectedTarget?.displayName,
        vmTarget: selectedPairingTarget?.displayName ?? selectedTarget?.displayName,
        lastAction: safeDiagnosticLastAction(currentActionResult),
      });
      const report = buildEvaosSupportReportContext({
        surface: 'native_companion_mac_control',
        route: '/native-companion',
        issueRef: '#432',
        settledState: viewModel.state,
        status: status?.readiness ?? viewModel.statusLabel,
        blocker: error ?? currentActionResult?.message ?? status?.blockerReason ?? status?.pairingBlockedReason,
        sourcePointer: currentActionResult?.sourcePointer ?? status?.sourcePointer,
        auditIds: [
          currentActionResult?.auditId,
          ...(currentActionResult?.auditIds ?? []),
          ...(status?.audit.auditIds ?? []),
        ],
        customer: {
          selectedCustomerId: selectedPairingCustomerId ?? selectedCustomerId,
          selectedCustomerLabel: selectedPairingTarget?.displayName ?? selectedTarget?.displayName,
          accountEmail: brokerSession?.userEmail,
          summaryText: status?.summaryText ?? viewModel.summary,
        },
      });
      await openFeedback({
        ...report,
        extra: {
          ...report.extra,
          ...(takeoverCueWarning
            ? {
                takeover_cue: {
                  status: 'warning',
                  warning: takeoverCueWarning,
                },
              }
            : {}),
          mac_control_diagnostic_packet:
            diagnosticPacket ?? diagnosticPacketCollectionFailed(status, currentActionResult),
        },
      });
    } catch (supportError) {
      console.error('[NativeCompanionPage] Failed to open evaOS support report:', supportError);
    }
  }, [
    brokerSession?.userEmail,
    currentActionResult,
    error,
    getDiagnosticPacket,
    openFeedback,
    selectedCustomerId,
    selectedPairingCustomerId,
    selectedPairingTarget?.displayName,
    selectedTarget?.displayName,
    status,
    takeoverCueWarning,
    viewModel.state,
    viewModel.statusLabel,
    viewModel.summary,
  ]);

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
              Check Mac control readiness for evaOS and Hermes. iPhone Mirroring is deferred for this Mac release.
            </p>
          </div>
          {showOperatorDetails ? (
            <div className='flex flex-wrap items-center gap-8px'>
              <Tag color={tagColorForTone(viewModel.statusTone)}>{viewModel.statusLabel}</Tag>
              <Tag color={violations.length === 0 ? 'green' : 'orange'}>
                {violations.length === 0 ? 'Boundary clean' : 'Boundary blocked'}
              </Tag>
            </div>
          ) : null}
        </header>

        {showOperatorDetails ? (
          <section className='grid grid-cols-1 gap-10px md:grid-cols-3' aria-label='Mac control readiness'>
            {viewModel.readinessStrip.map((item) => (
              <ReadinessTile key={item.label} item={item} />
            ))}
          </section>
        ) : null}

        <section
          data-testid='native-companion-repair-card'
          className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'
        >
          <div className='flex flex-wrap items-start justify-between gap-12px'>
            <div className='min-w-0'>
              {showOperatorDetails ? (
                <p className='m-0 text-12px font-semibold uppercase tracking-1px text-t-tertiary'>Mac control repair</p>
              ) : null}
              <h2 className='m-0 mt-4px text-20px font-semibold leading-26px text-t-primary'>{viewModel.title}</h2>
              <p className='m-0 mt-6px max-w-760px text-13px leading-20px text-t-secondary'>{viewModel.summary}</p>
              {showOperatorDetails && viewModel.reportedSummary && (
                <p className='m-0 mt-6px max-w-760px text-12px leading-18px text-t-secondary'>
                  Connector report: {viewModel.reportedSummary}
                </p>
              )}
              {handoffMessage && <p className='m-0 mt-6px text-12px leading-18px text-t-secondary'>{handoffMessage}</p>}
              {takeoverCue ? (
                <p
                  data-testid='native-companion-takeover-cue'
                  className='m-0 mt-6px rounded-6px bg-warning-1 px-10px py-6px text-12px font-semibold leading-18px text-warning-7'
                >
                  {takeoverCue}
                </p>
              ) : null}
              {takeoverCueWarning ? (
                <p
                  data-testid='native-companion-takeover-cue-warning'
                  className='m-0 mt-6px text-12px leading-18px text-warning-7'
                >
                  Takeover cue warning: {takeoverCueWarning}
                </p>
              ) : null}
              {authUrl && (
                <div className='mt-8px flex flex-wrap gap-8px'>
                  <Button size='mini' onClick={handleOpenAuthUrl}>
                    Open sign-in page
                  </Button>
                  <Button size='mini' onClick={handleCopyAuthUrl}>
                    Copy sign-in link
                  </Button>
                </div>
              )}
            </div>
          </div>

          {showOperatorDetails ? (
            <div className='mt-16px grid grid-cols-1 gap-10px md:grid-cols-4'>
              {viewModel.repairSteps.map((step, index) => (
                <RepairStep key={step.title} step={step} index={index + 1} />
              ))}
            </div>
          ) : null}

          <div className='mt-14px rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-2 p-12px'>
            <div className='flex flex-wrap items-start justify-between gap-10px'>
              <div className='min-w-0'>
                {showOperatorDetails ? (
                  <>
                    <h3 className='m-0 text-14px font-semibold leading-20px text-t-primary'>
                      Guided Mac control setup
                    </h3>
                    <p className='m-0 mt-4px max-w-720px text-12px leading-18px text-t-secondary'>
                      Workbench starts the local connector, then connects Mac control to the selected account-scoped
                      evaOS/OpenClaw and Hermes agent context.
                    </p>
                  </>
                ) : null}
                <MacPairingTargetControl
                  targets={pairableMacControlTargets}
                  selectedCustomerId={selectedPairingCustomerId}
                  selectedTarget={selectedPairingTarget}
                  disabled={actionInFlight !== null}
                  onChange={handlePairingTargetChange}
                />
              </div>
              {showOperatorDetails ? (
                <Tag color={guidedSetupReady ? 'green' : 'orange'}>
                  {guidedSetupReady
                    ? 'End-to-end ready'
                    : guidedGrantActive
                      ? 'Grant active; test needed'
                      : 'Setup needed'}
                </Tag>
              ) : null}
            </div>

            <div className='mt-12px rounded-8px bg-fill-1 p-12px'>
              {showOperatorDetails ? (
                <>
                  <p className='m-0 text-12px font-semibold uppercase tracking-1px text-t-tertiary'>
                    Step {viewModel.nextAction.step} of {viewModel.nextAction.totalSteps}
                  </p>
                  <div className='mt-6px min-w-0'>
                    <h4 className='m-0 text-16px font-semibold leading-22px text-t-primary'>
                      {viewModel.nextAction.title}
                    </h4>
                    <p className='m-0 mt-4px max-w-720px text-12px leading-18px text-t-secondary'>
                      {viewModel.nextAction.detail}
                    </p>
                  </div>
                </>
              ) : null}
              <div className={showOperatorDetails ? 'mt-6px flex justify-end' : 'flex justify-end'}>
                <Button
                  data-testid='native-companion-next-action'
                  type='primary'
                  disabled={viewModel.nextAction.disabled || actionInFlight !== null}
                  loading={
                    viewModel.nextAction.kind === 'reconnect'
                      ? authInFlight
                      : viewModel.nextAction.action
                        ? actionInFlight === viewModel.nextAction.action
                        : loading
                  }
                  onClick={() => void handleNextAction(viewModel.nextAction)}
                >
                  {viewModel.nextAction.label}
                </Button>
              </div>
            </div>

            {showOperatorDetails && shouldShowAgentProof ? (
              <div className='mt-12px grid grid-cols-1 gap-10px md:grid-cols-2' aria-label='Agent connector proof'>
                <AgentProofCard
                  title='Test with evaOS / OpenClaw'
                  runtimeToolReadiness={runtimeToolReadiness}
                  detail='Use the evaOS/OpenClaw plugin to run status, desktop see, one low-impact action, audit tail, and stop or kill-switch proof through this connector.'
                />
                <AgentProofCard
                  title='Test with Hermes'
                  runtimeToolReadiness={runtimeToolReadiness}
                  detail='Run the same connector contract through Hermes. Hermes must use the shared Workbench connector, not a second Mac-control backend.'
                />
              </div>
            ) : null}

            {showOperatorDetails ? (
              <Button
                type='text'
                size='small'
                aria-expanded={connectorActionsOpen}
                className='mt-12px !px-0 text-12px font-semibold leading-18px text-t-secondary hover:text-t-primary'
                onClick={() => setConnectorActionsOpen((open) => !open)}
              >
                {connectorActionsOpen ? 'Hide advanced connector controls' : 'Show advanced connector controls'}
              </Button>
            ) : null}

            {showOperatorDetails && connectorActionsOpen ? (
              <div className='mt-12px flex flex-wrap gap-8px' aria-label='Advanced Workbench connector actions'>
                {connectorStartAvailable ? (
                  <Button
                    type='secondary'
                    loading={actionInFlight === 'connector_start'}
                    onClick={() => void handleRunAction({ action: 'connector_start' })}
                  >
                    Turn On Mac Access
                  </Button>
                ) : null}
                <Button
                  type='secondary'
                  loading={actionInFlight === 'setup_check'}
                  onClick={() => void handleRunAction({ action: 'setup_check' })}
                >
                  Run Setup Check
                </Button>
                <Button
                  type='secondary'
                  disabled={!canCreatePairingPrompt || brokerSessionRequired || brokerAuthenticated === false}
                  loading={actionInFlight === 'create_pairing_prompt'}
                  onClick={() => void handleRunAction({ action: 'create_pairing_prompt' })}
                >
                  Export Pairing Prompt
                </Button>
                {agentPairingStatus === 'agent_paired' ? (
                  <Button
                    type='secondary'
                    loading={actionInFlight === 'control_start'}
                    onClick={() => void handleRunAction({ action: 'control_start', mode: 'full-access' })}
                  >
                    Full Access
                  </Button>
                ) : null}
                <Button
                  type='secondary'
                  loading={actionInFlight === 'control_start'}
                  onClick={() => void handleRunAction({ action: 'control_start', mode: 'ask-permission' })}
                >
                  Ask Permission
                </Button>
                <Button
                  type='secondary'
                  loading={actionInFlight === 'audit_tail'}
                  onClick={() => void handleRunAction({ action: 'audit_tail' })}
                >
                  Show Audit Tail
                </Button>
              </div>
            ) : null}

            {showOperatorDetails && currentActionResult ? (
              <div data-testid='native-companion-action-result' className='mt-12px rounded-8px bg-fill-1 p-12px'>
                <div className='flex flex-wrap items-center gap-8px'>
                  <Tag color={tagColorForActionStatus(currentActionResult.status)}>{currentActionResult.status}</Tag>
                  <span className='text-12px leading-18px text-t-secondary'>{currentActionResultMessage}</span>
                </div>
                {currentActionResult.setup ? (
                  <div className='mt-8px grid grid-cols-1 gap-6px text-12px leading-18px text-t-secondary md:grid-cols-4'>
                    <EvidenceRow
                      label='Connector'
                      value={currentActionResult.setup.connectorReady ? 'ready' : 'repair'}
                    />
                    <EvidenceRow label='Mac control' value={currentActionResult.setup.macReady ? 'ready' : 'repair'} />
                    <EvidenceRow
                      label='Agent control'
                      value={currentActionResult.setup.controlReady ? 'ready' : 'repair'}
                    />
                    <EvidenceRow label='iPhone' value='deferred' />
                  </div>
                ) : null}
                {currentActionResult.pairing ? (
                  <div className='mt-10px'>
                    <span className='mb-6px block text-12px font-semibold leading-18px text-t-primary'>
                      Agent setup prompt
                    </span>
                    <pre className='m-0 max-h-220px overflow-auto rounded-8px bg-fill-3 p-10px text-11px leading-16px text-t-secondary'>
                      {currentActionResult.pairing.setupPrompt}
                    </pre>
                    {copyMessage ? <p className='m-0 mt-6px text-12px text-t-secondary'>{copyMessage}</p> : null}
                  </div>
                ) : null}
                {currentActionResult.events?.length ? (
                  <div className='mt-10px grid grid-cols-1 gap-6px text-12px leading-18px text-t-secondary md:grid-cols-2'>
                    {currentActionResult.events.slice(0, 6).map((event) => (
                      <EvidenceRow key={event.id} label={event.action} value={`${event.outcome}: ${event.id}`} />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className='mt-12px flex flex-wrap gap-8px' aria-label='Mac control safety controls'>
              <Button
                type='secondary'
                disabled={selectedPairingStatus?.controlSession?.active !== true}
                loading={actionInFlight === 'control_stop'}
                onClick={() => void handleRunAction({ action: 'control_stop' })}
              >
                Stop Agent Control
              </Button>
              <Button
                type='secondary'
                disabled={
                  selectedPairingStatus?.customerMac.killSwitchAvailable !== true &&
                  selectedPairingStatus?.controlSession?.active !== true
                }
                loading={actionInFlight === 'kill_switch'}
                onClick={() => void handleRunAction({ action: 'kill_switch' })}
              >
                Kill Switch
              </Button>
              <Button
                type='secondary'
                disabled={selectedPairingStatus?.connectorService?.running !== true}
                loading={actionInFlight === 'connector_stop'}
                onClick={() => void handleRunAction({ action: 'connector_stop' })}
              >
                Stop Mac Access
              </Button>
            </div>
          </div>

          {viewModel.statusTone !== 'ready' && viewModel.nextAction.repairAction !== 'secure_network_install' ? (
            <div className='mt-14px flex flex-wrap gap-8px' aria-label='Mac repair support'>
              <Button
                type='secondary'
                icon={<Comment theme='outline' size='16' />}
                onClick={() => void handleOpenSupportReport()}
              >
                Report to support
              </Button>
            </div>
          ) : null}

          {showOperatorDetails ? (
            <div className='mt-14px rounded-8px bg-fill-2 px-14px py-12px text-12px leading-18px text-t-secondary'>
              {viewModel.supportText}
            </div>
          ) : null}
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

function AgentProofCard({
  title,
  detail,
  runtimeToolReadiness,
}: {
  title: string;
  detail: string;
  runtimeToolReadiness: IEvaosNativeCompanionRuntimeToolReadiness;
}) {
  const label = agentProofLabel(runtimeToolReadiness);
  return (
    <div className='rounded-8px border border-solid border-[var(--color-border-2)] bg-fill-1 p-12px'>
      <div className='flex flex-wrap items-center justify-between gap-8px'>
        <p className='m-0 text-14px font-semibold leading-20px text-t-primary'>{title}</p>
        <Tag color={tagColorForTone(label.tone)}>{label.text}</Tag>
      </div>
      <p className='m-0 mt-4px text-12px leading-18px text-t-secondary'>{detail}</p>
    </div>
  );
}

function effectiveAgentPairingStatus(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  actionResult: IEvaosNativeCompanionActionResult | null
): IEvaosNativeCompanionAgentPairingStatus {
  if (actionResultCanDriveAgentPairing(status, actionResult)) {
    if (actionResult?.agentPairingStatus) return actionResult.agentPairingStatus;
    if (actionResult?.pairing?.setupPrompt) return 'pairing_prompt_created';
  }
  return status?.agentPairingStatus ?? (status?.readiness === 'ready' ? 'ready_for_agent_pairing' : 'not_ready');
}

function statusForSelectedPairingCustomer(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  selectedPairingCustomerId: string | undefined
): IEvaosNativeCompanionStatusView | null | undefined {
  if (!status) return status;
  const pairingMatches = Boolean(
    selectedPairingCustomerId &&
    status.agentPairingCustomerId === selectedPairingCustomerId &&
    status.agentPairingProofScopeId &&
    status.activeMacControlScopeId &&
    status.agentPairingProofScopeId === status.activeMacControlScopeId
  );
  const proofMatches = Boolean(
    pairingMatches &&
    status.runtimeToolProofCustomerId === selectedPairingCustomerId &&
    status.runtimeToolProofScopeId &&
    status.runtimeToolProofScopeId === status.agentPairingProofScopeId &&
    status.runtimeToolProofScopeId === status.activeMacControlScopeId
  );
  const pairingNeedsScope =
    status.agentPairingStatus === 'agent_paired' || status.agentPairingStatus === 'proof_failed';
  const scopedAgentPairingStatus =
    pairingNeedsScope && !pairingMatches ? 'ready_for_agent_pairing' : status.agentPairingStatus;
  const proofNeedsScope =
    status.runtimeToolReadiness === 'tools_ready' || status.runtimeToolReadiness === 'proof_failed';
  const scopedRuntimeToolReadiness = proofNeedsScope && !proofMatches ? 'pairing_ready' : status.runtimeToolReadiness;
  if (
    scopedAgentPairingStatus === status.agentPairingStatus &&
    scopedRuntimeToolReadiness === status.runtimeToolReadiness
  ) {
    return status;
  }
  return {
    ...status,
    agentPairingStatus: scopedAgentPairingStatus,
    runtimeToolReadiness: scopedRuntimeToolReadiness,
  };
}

function actionResultForCurrentPairingCustomer(
  actionResult: IEvaosNativeCompanionActionResult | null,
  selectedPairingCustomerId: string | undefined,
  actionResultCustomerId: string | undefined,
  status: IEvaosNativeCompanionStatusView | null | undefined
): IEvaosNativeCompanionActionResult | null {
  if (actionResultCustomerId && actionResultCustomerId !== selectedPairingCustomerId) return null;
  if (!actionResultMatchesCurrentConnectorStatus(status, actionResult)) return null;
  if (!actionResult?.pairing) return actionResult;
  return actionResult.pairing.customerId === selectedPairingCustomerId ? actionResult : null;
}

function actionResultCanDriveAgentPairing(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  actionResult: IEvaosNativeCompanionActionResult | null | undefined
): boolean {
  if (!actionResult) return false;
  // setup_check is an observation, not durable pairing proof. The refreshed
  // status owns pairing truth so a result from an older grant cannot override it.
  if (actionResult.action === 'setup_check') return false;
  if (!actionResultMatchesCurrentConnectorStatus(status, actionResult)) return false;
  return actionResult.status === 'succeeded';
}

function actionResultMatchesCurrentConnectorStatus(
  status: IEvaosNativeCompanionStatusView | null | undefined,
  actionResult: IEvaosNativeCompanionActionResult | null | undefined
): boolean {
  if (!actionResult) return true;
  if (actionResult.status !== 'succeeded') return true;
  if (!actionResultRequiresLiveConnector(actionResult)) return true;
  const connectorReady =
    status?.readiness === 'ready' &&
    status.connectorService?.status === 'ready' &&
    status.connectorService?.running === true &&
    status.connectorService?.reachable === true &&
    status.customerMac?.status === 'ready';
  if (!connectorReady) return false;
  if (!actionResultRequiresCurrentPairingProof(actionResult)) return true;
  const currentPairingStatus = status.agentPairingStatus ?? 'ready_for_agent_pairing';
  return currentPairingStatus !== 'not_ready' && currentPairingStatus !== 'proof_failed';
}

function actionResultRequiresLiveConnector(actionResult: IEvaosNativeCompanionActionResult): boolean {
  return (
    actionResult.action === 'connector_start' ||
    actionResult.action === 'ensure_customer_mac_connector_grant' ||
    actionResult.action === 'setup_check' ||
    actionResult.action === 'control_start' ||
    actionResult.action === 'control_stop' ||
    actionResult.action === 'kill_switch'
  );
}

function actionResultRequiresCurrentPairingProof(actionResult: IEvaosNativeCompanionActionResult): boolean {
  return actionResult.action === 'ensure_customer_mac_connector_grant';
}

function isAgentProofVisible(status: IEvaosNativeCompanionAgentPairingStatus): boolean {
  return status === 'pairing_prompt_created' || status === 'agent_paired' || status === 'proof_failed';
}

function isPairingBrokerSessionRequired(actionResult: IEvaosNativeCompanionActionResult | null): boolean {
  return (
    actionResult?.sourcePointer === 'native-companion:pairing-broker-session-required' ||
    actionResult?.sourcePointer === 'native-companion:connector-grant-broker-session-required' ||
    actionResult?.sourcePointer === 'native-companion:secure-network-enrollment-broker-session-required'
  );
}

function selectMacPairingTarget(input: {
  targets: IEvaosCustomerTargetView[];
  selectedCustomerId: string | undefined;
  selectedTarget: IEvaosCustomerTargetView | undefined;
  lockedPairingCustomerId?: string;
  isOperator?: boolean;
}): IEvaosCustomerTargetView | undefined {
  const pairableTargets = input.targets;
  const lockedTargetFromList = input.lockedPairingCustomerId
    ? pairableTargets.find((target) => target.customerId === input.lockedPairingCustomerId)
    : undefined;
  if (lockedTargetFromList) return lockedTargetFromList;
  if (pairableTargets.length > 1) return undefined;

  const selectedTargetFromList = input.selectedCustomerId
    ? pairableTargets.find((target) => target.customerId === input.selectedCustomerId)
    : undefined;
  if (selectedTargetFromList) return selectedTargetFromList;
  if (input.selectedTarget && isPairableMacControlTarget(input.selectedTarget)) return input.selectedTarget;
  if (input.selectedCustomerId) return undefined;

  return (
    pairableTargets.find((target) => target.isDefault) ??
    (input.isOperator ? pairableTargets.find((target) => target.customerId === 'golden') : undefined) ??
    pairableTargets[0]
  );
}

function localizedNativeCompanionActionResultMessage(
  actionResult: IEvaosNativeCompanionActionResult,
  translate: (key: string) => string
): string {
  if (actionResult.sourcePointer === 'native-companion:secure-network-enrollment-submitted') {
    return translate('evaos.nativeCompanion.onboarding.enrollmentSubmittedDetail');
  }
  if (actionResult.sourcePointer === 'native-companion:secure-network-enrollment-broker-session-required') {
    return translate('evaos.nativeCompanion.onboarding.enrollmentSessionDetail');
  }
  if (actionResult.sourcePointer.startsWith('native-companion:secure-network-enrollment-')) {
    const summary = translate('evaos.nativeCompanion.onboarding.enrollmentFailedDetail');
    const diagnostic = privateNetworkEnrollmentDiagnosticMessage(actionResult);
    return diagnostic ? `${summary} ${diagnostic}` : summary;
  }
  return actionResult.message;
}

function privateNetworkEnrollmentDiagnosticMessage(
  actionResult: IEvaosNativeCompanionActionResult
): string | undefined {
  const diagnostic = actionResult.enrollmentDiagnostic;
  if (!diagnostic) return undefined;
  const parts: string[] = [];
  if (diagnostic.code === 'tailscale_cli_failed') {
    parts.push(
      diagnostic.exitCode ? `Tailscale exited with code ${diagnostic.exitCode}.` : 'Tailscale enrollment failed.'
    );
  } else if (diagnostic.code === 'enrollment_setup_failed') {
    parts.push('Workbench could not prepare temporary enrollment material.');
  } else if (diagnostic.code === 'enrollment_secret_cleanup_failed') {
    parts.push('Workbench could not confirm temporary enrollment-material cleanup.');
  } else if (diagnostic.code === 'enrollment_state_changed') {
    parts.push('The local Tailscale state changed before enrollment.');
  }
  if (diagnostic.message) parts.push(diagnostic.message);
  if (diagnostic.cancellationState === 'cancelled') {
    parts.push('Unused key cancellation was confirmed.');
  } else if (diagnostic.cancellationState === 'unconfirmed_not_found') {
    parts.push('The broker reported the key consumed or not found; cancellation remains unconfirmed.');
  } else if (diagnostic.cancellationState === 'unconfirmed') {
    parts.push('Unused key cancellation remains unconfirmed.');
  }
  return parts.join(' ') || undefined;
}

function MacPairingTargetControl({
  targets,
  selectedCustomerId,
  selectedTarget,
  disabled,
  onChange,
}: {
  targets: IEvaosCustomerTargetView[];
  selectedCustomerId?: string;
  selectedTarget?: IEvaosCustomerTargetView;
  disabled?: boolean;
  onChange: (customerId: string) => void;
}) {
  const targetText = selectedTarget ? macPairingTargetLabel(selectedTarget) : 'Choose Mac target';
  if (targets.length > 1 || (!selectedTarget && targets.length > 0)) {
    return (
      <div className='mt-4px flex max-w-420px flex-col gap-4px text-12px leading-18px text-t-secondary'>
        <p className='m-0'>Mac control target: {targetText}</p>
        <select
          data-testid='native-companion-mac-target-select'
          aria-label='Mac control target'
          value={selectedCustomerId ?? ''}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          className='h-30px w-full min-w-0 rd-6px border border-solid border-[var(--color-border-2)] bg-fill-1 px-8px text-12px text-t-primary outline-none'
        >
          {selectedCustomerId ? null : (
            <option value='' disabled>
              Choose Mac target
            </option>
          )}
          {targets.map((target) => (
            <option key={target.customerId} value={target.customerId}>
              {macPairingTargetLabel(target)}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (selectedTarget) {
    return (
      <p className='m-0 mt-4px text-12px leading-18px text-t-secondary'>
        Mac control target: {macPairingTargetLabel(selectedTarget)}
      </p>
    );
  }
  return <p className='m-0 mt-4px text-12px leading-18px text-t-secondary'>Mac control target: Choose Mac target</p>;
}

function macPairingTargetLabel(target: IEvaosCustomerTargetView): string {
  const displayName = target.displayName?.trim();
  if (!displayName || displayName === target.customerId) return target.customerId;
  if (target.customerId === 'golden' && displayName.includes('@')) return `Golden VM (${displayName})`;
  if (displayName.includes('@')) return `${target.customerId} (${displayName})`;
  return displayName;
}

function isPairableMacControlTarget(target: IEvaosCustomerTargetView): boolean {
  if (!target.customerId) return false;
  if (target.targetKind !== 'customer' && target.targetKind !== 'customer_vm') return false;
  if (target.accountOnly === true) return false;
  if (target.customerId.includes('@')) return false;
  return true;
}

function agentProofLabel(status: IEvaosNativeCompanionRuntimeToolReadiness): {
  text: string;
  tone: NativeCompanionTone;
} {
  if (status === 'tools_ready') {
    return { text: 'Proven', tone: 'ready' };
  }
  if (status === 'proof_failed') {
    return { text: 'Needs retry', tone: 'attention' };
  }
  return { text: 'Pending', tone: 'neutral' };
}

function tagColorForTone(tone: NativeCompanionTone): string {
  if (tone === 'ready') return 'green';
  if (tone === 'attention') return 'orange';
  if (tone === 'offline') return 'red';
  return 'gray';
}

function tagColorForActionStatus(status: IEvaosNativeCompanionActionResult['status']): string {
  if (status === 'succeeded') return 'green';
  if (status === 'repair_required') return 'orange';
  if (status === 'unsupported') return 'gray';
  return 'red';
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

function safeDiagnosticLastAction(
  actionResult: IEvaosNativeCompanionActionResult | null
): IEvaosWorkbenchDiagnosticPacketV1['lastAction'] | undefined {
  if (!actionResult) return undefined;
  return {
    action: actionResult.action,
    status: actionResult.status,
    message: safeFeedbackDiagnosticText(actionResult.message),
    blockerReason: actionResult.blockerReason,
    auditId: safeFeedbackDiagnosticText(actionResult.auditId),
  };
}

function diagnosticPacketCollectionFailed(
  status: IEvaosNativeCompanionStatusView | null,
  actionResult: IEvaosNativeCompanionActionResult | null
): Record<string, unknown> {
  return {
    schemaVersion: 'evaos.workbench.diagnostic_packet.v1',
    collectionStatus: 'failed',
    fallbackBlockerCategory:
      actionResult?.blockerReason ?? status?.blockerReason ?? status?.pairingBlockedReason ?? 'unknown',
    sourcePointer: safeFeedbackDiagnosticText(actionResult?.sourcePointer ?? status?.sourcePointer),
    auditIds: [...(actionResult?.auditIds ?? []), ...(status?.audit.auditIds ?? [])]
      .map((auditId) => safeFeedbackDiagnosticText(auditId))
      .filter(Boolean)
      .slice(0, 12),
    redaction: {
      rawSecretsStoredInWorkbench: false,
      urlsIpsPortsRedacted: true,
      rawPromptMaterialIncluded: false,
    },
  };
}

function safeFeedbackDiagnosticText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/https?:\/\/[^\s"')]+/gi, '[redacted-url]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[redacted-ip]')
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, '[redacted]')
    .replace(
      /\b(?:access[_-]?token|refresh[_-]?token|connector[_-]?(?:token|url)|desktop[_-]?session|provider[_-]?grant|api[_-]?key|password|credential|client[_-]?secret|service[_-]?role|grant[_-]?handle|private[_-]?key|secret)\b[^\s,.;)]*/gi,
      '[redacted]'
    )
    .trim();
  return cleaned ? cleaned.slice(0, 260) : undefined;
}

export default NativeCompanionPage;

type WebAudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

type TakeoverCueResult = {
  warning?: string;
};

async function runMacControlTakeoverCue(onStep: (message: string | null) => void): Promise<TakeoverCueResult> {
  let warning: string | undefined;
  const steps = ['3', '2', '1'];
  for (const step of steps) {
    onStep(`Agent control starting in ${step}...`);
    try {
      await playTakeoverBeep(step === '1' ? 1046 : 784);
    } catch {
      warning = warning ?? 'takeover_sound_unavailable';
      await waitForCueStep(180);
    }
  }
  onStep('Agent control starting now.');
  await waitForCueStep(220);
  return { warning };
}

async function playTakeoverBeep(frequency: number): Promise<void> {
  const AudioContextCtor =
    typeof AudioContext !== 'undefined' ? AudioContext : (window as WebAudioWindow).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('audio_context_unavailable');
  }
  const audioContext = new AudioContextCtor();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  gain.gain.value = 0.08;
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.14);
  await waitForCueStep(180);
  await audioContext.close();
}

function waitForCueStep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
