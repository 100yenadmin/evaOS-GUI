/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  IEvaosBrokerBeginDesktopAuthResult,
  IEvaosBrokerClaimDeviceCodeRequest,
  IEvaosBrokerSessionStatus,
  IEvaosCustomerTargetsView,
  IEvaosRuntimeActionRequest,
  IEvaosRuntimeActionResult,
  IEvaosRuntimeStatusRequest,
  IEvaosRuntimeStatusView,
} from '@/common/evaos/bridgeTypes';
import {
  evaosBrokerErrorMessage,
  getDefaultEvaosBrokerSessionClient,
  type EvaosBrokerSessionClient,
} from '@process/services/evaosBrokerSession';
import { beginEvaosDesktopAuth } from '@process/services/evaosDesktopAuth';
import {
  evaosLocalProductFixtureCustomerTargets,
  evaosLocalProductFixtureRuntimeAction,
  evaosLocalProductFixtureRuntimeStatus,
  evaosLocalProductFixtureSessionStatus,
  isEvaosLocalProductFixtureEnabled,
} from '@process/services/evaosLocalProductFixture';
import { assertEvaosRendererSafePayload } from './evaosRendererSecretGuard';
import { clearEvaosRuntimeSurfaces, createEvaosRuntimeSurface } from '@process/services/evaosRuntimeSurfaceRegistry';

export { assertEvaosRendererSafePayload } from './evaosRendererSecretGuard';

interface BridgeResponse<D = {}> {
  success: boolean;
  data?: D;
  msg?: string;
}

export function initEvaosBrokerBridge(client: EvaosBrokerSessionClient = getDefaultEvaosBrokerSessionClient()): void {
  ipcBridge.evaosBroker.beginDesktopAuth.provider(
    async (): Promise<BridgeResponse<IEvaosBrokerBeginDesktopAuthResult>> =>
      toBridgeResponse(() => beginEvaosDesktopAuth(client))
  );

  ipcBridge.evaosBroker.claimDeviceCode.provider(
    async ({ deviceCode }: IEvaosBrokerClaimDeviceCodeRequest): Promise<BridgeResponse<IEvaosBrokerSessionStatus>> =>
      toBridgeResponse(() => client.claimDeviceCode(deviceCode))
  );

  ipcBridge.evaosBroker.getSessionStatus.provider(
    async (): Promise<BridgeResponse<IEvaosBrokerSessionStatus>> =>
      toBridgeResponse(() =>
        isEvaosLocalProductFixtureEnabled() ? evaosLocalProductFixtureSessionStatus() : client.getSessionStatus()
      )
  );

  ipcBridge.evaosBroker.getCustomerTargets.provider(
    async (): Promise<BridgeResponse<IEvaosCustomerTargetsView>> =>
      toBridgeResponse(() =>
        isEvaosLocalProductFixtureEnabled() ? evaosLocalProductFixtureCustomerTargets() : client.customerTargets()
      )
  );

  ipcBridge.evaosBroker.runtimeStatus.provider(
    async (request: IEvaosRuntimeStatusRequest): Promise<BridgeResponse<IEvaosRuntimeStatusView>> =>
      toBridgeResponse(() =>
        isEvaosLocalProductFixtureEnabled()
          ? evaosLocalProductFixtureRuntimeStatus(request)
          : client.runtimeStatus(request)
      )
  );

  ipcBridge.evaosBroker.runtimeAction.provider(
    async (request: IEvaosRuntimeActionRequest): Promise<BridgeResponse<IEvaosRuntimeActionResult>> =>
      toBridgeResponse(() =>
        isEvaosLocalProductFixtureEnabled()
          ? evaosLocalProductFixtureRuntimeAction(request)
          : client.runtimeAction(request, { createRuntimeSurface: createEvaosRuntimeSurface })
      )
  );

  ipcBridge.evaosBroker.revokeSession.provider(
    async (): Promise<BridgeResponse<IEvaosBrokerSessionStatus>> =>
      toBridgeResponse(async () => {
        clearEvaosRuntimeSurfaces();
        return client.revokeSession();
      })
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
