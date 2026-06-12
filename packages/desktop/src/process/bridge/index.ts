/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { initApplicationBridge } from './applicationBridge';
import { initDialogBridge } from './dialogBridge';
import { initUpdateBridge } from './updateBridge';
import { initSystemSettingsBridge } from './systemSettingsBridge';
import { initWindowControlsBridge } from './windowControlsBridge';
import { initNotificationBridge } from './notificationBridge';
import { initWebuiBridge } from './webuiBridge';
import { initEvaosBrokerBridge } from './evaosBrokerBridge';
import {
  initEvaosApprovalCenterBridge,
  initEvaosBusinessBrowserBridge,
  initEvaosCompanyBrainBridge,
  initEvaosPeopleAccessBridge,
  initEvaosProviderHubBridge,
} from './evaosPeopleAccessBridge';
import { initEvaosNativeCompanionBridge } from './evaosNativeCompanionBridge';
import { initEvaosExternalLinkBridge } from './evaosExternalLinkBridge';

export type BridgeDependencies = Record<string, never>;

export function initAllBridges(_deps: BridgeDependencies = {}): void {
  initDialogBridge();
  initApplicationBridge();
  initWindowControlsBridge();
  initUpdateBridge();
  initSystemSettingsBridge();
  initNotificationBridge();
  initWebuiBridge();
  initEvaosBrokerBridge();
  initEvaosPeopleAccessBridge();
  initEvaosApprovalCenterBridge();
  initEvaosProviderHubBridge();
  initEvaosBusinessBrowserBridge();
  initEvaosCompanyBrainBridge();
  initEvaosNativeCompanionBridge();
  initEvaosExternalLinkBridge();
}

export {
  initApplicationBridge,
  initDialogBridge,
  initEvaosApprovalCenterBridge,
  initEvaosBrokerBridge,
  initEvaosBusinessBrowserBridge,
  initEvaosCompanyBrainBridge,
  initEvaosExternalLinkBridge,
  initEvaosNativeCompanionBridge,
  initEvaosPeopleAccessBridge,
  initEvaosProviderHubBridge,
  initNotificationBridge,
  initSystemSettingsBridge,
  initUpdateBridge,
  initWindowControlsBridge,
  initWebuiBridge,
};
export { registerWindowMaximizeListeners } from './windowControlsBridge';
export const disposeAllTeamSessions = (): Promise<void> => Promise.resolve();
