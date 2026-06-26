/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  IEvaosNativeCompanionActionRequest,
  IEvaosNativeCompanionActionResult,
  IEvaosNativeCompanionOpenResult,
  IEvaosNativeCompanionRepairActionRequest,
  IEvaosNativeCompanionRepairActionResult,
  IEvaosNativeCompanionStatusView,
  IEvaosWorkbenchDiagnosticPacketRequest,
  IEvaosWorkbenchDiagnosticPacketV1,
} from '@/common/evaos/bridgeTypes';
import {
  getEvaosWorkbenchDiagnosticPacket,
  getEvaosNativeCompanionStatus,
  openNativeCompanionRepairAction,
  openReleasedEvaosWorkbench,
  runNativeCompanionAction,
} from '@process/services/evaosNativeCompanionStatus';
import { evaosBrokerErrorMessage } from '@process/services/evaosBrokerSession';
import { assertEvaosRendererSafePayload } from './evaosRendererSecretGuard';

interface BridgeResponse<D = {}> {
  success: boolean;
  data?: D;
  msg?: string;
}

export function initEvaosNativeCompanionBridge(): void {
  ipcBridge.evaosNativeCompanion.getStatus.provider(
    async (): Promise<BridgeResponse<IEvaosNativeCompanionStatusView>> =>
      toBridgeResponse(() => getEvaosNativeCompanionStatus())
  );

  ipcBridge.evaosNativeCompanion.getDiagnosticPacket.provider(
    async (
      request: IEvaosWorkbenchDiagnosticPacketRequest
    ): Promise<BridgeResponse<IEvaosWorkbenchDiagnosticPacketV1>> =>
      toBridgeResponse(() => getEvaosWorkbenchDiagnosticPacket(request))
  );

  ipcBridge.evaosNativeCompanion.openReleasedWorkbench.provider(
    async (): Promise<BridgeResponse<IEvaosNativeCompanionOpenResult>> =>
      toBridgeResponse(() => openReleasedEvaosWorkbench())
  );

  ipcBridge.evaosNativeCompanion.openRepairAction.provider(
    async (
      request: IEvaosNativeCompanionRepairActionRequest
    ): Promise<BridgeResponse<IEvaosNativeCompanionRepairActionResult>> =>
      toBridgeResponse(() => openNativeCompanionRepairAction(request))
  );

  ipcBridge.evaosNativeCompanion.runAction.provider(
    async (request: IEvaosNativeCompanionActionRequest): Promise<BridgeResponse<IEvaosNativeCompanionActionResult>> =>
      toBridgeResponse(() => runNativeCompanionAction(request))
  );
}

async function toBridgeResponse<D>(operation: () => D | Promise<D>): Promise<BridgeResponse<D>> {
  try {
    const data = await operation();
    assertEvaosRendererSafePayload(data);
    return {
      success: true,
      data,
    };
  } catch (error) {
    return {
      success: false,
      msg: evaosBrokerErrorMessage(error),
    };
  }
}
