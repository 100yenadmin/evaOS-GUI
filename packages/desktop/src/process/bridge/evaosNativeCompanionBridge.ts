/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  IEvaosNativeCompanionOpenResult,
  IEvaosNativeCompanionRepairActionRequest,
  IEvaosNativeCompanionRepairActionResult,
  IEvaosNativeCompanionStatusView,
} from '@/common/evaos/bridgeTypes';
import {
  getEvaosNativeCompanionStatus,
  openNativeCompanionRepairAction,
  openReleasedEvaosWorkbench,
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
