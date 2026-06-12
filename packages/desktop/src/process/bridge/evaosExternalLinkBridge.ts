/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IEvaosExternalLinkOpenRequest, IEvaosExternalLinkOpenResult } from '@/common/evaos/bridgeTypes';
import { openEvaosExternalLink } from '@process/services/evaosExternalLink';
import { evaosBrokerErrorMessage } from '@process/services/evaosBrokerSession';
import { assertEvaosRendererSafePayload } from './evaosRendererSecretGuard';

interface BridgeResponse<D = {}> {
  success: boolean;
  data?: D;
  msg?: string;
}

export function initEvaosExternalLinkBridge(): void {
  ipcBridge.evaosExternalLink.open.provider(
    async (request: IEvaosExternalLinkOpenRequest): Promise<BridgeResponse<IEvaosExternalLinkOpenResult>> =>
      toBridgeResponse(() => openEvaosExternalLink(request))
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
