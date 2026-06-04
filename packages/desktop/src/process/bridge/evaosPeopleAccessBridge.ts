/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  IEvaosApprovalCenterRequest,
  IEvaosApprovalCenterView,
  IEvaosApprovalDecisionResult,
  IEvaosApprovalDenyRequest,
  IEvaosBusinessBrowserActionResult,
  IEvaosBusinessBrowserOpenUrlRequest,
  IEvaosBusinessBrowserRequest,
  IEvaosBusinessBrowserView,
  IEvaosCompanyBrainAccount360View,
  IEvaosCompanyBrainAccountRequest,
  IEvaosCompanyBrainDirectoryRequest,
  IEvaosCompanyBrainDirectoryView,
  IEvaosCompanyBrainQueryRequest,
  IEvaosCompanyBrainQueryResult,
  IEvaosProviderActionRequest,
  IEvaosProviderActionResult,
  IEvaosProviderHubRequest,
  IEvaosProviderHubView,
  IEvaosPeopleAccessInviteMemberRequest,
  IEvaosPeopleAccessMutationResult,
  IEvaosPeopleAccessPolicyRequest,
  IEvaosPeopleAccessPolicyView,
} from '@/common/adapter/ipcBridge';
import {
  evaosBrokerErrorMessage,
  getDefaultEvaosBrokerSessionClient,
  type EvaosBrokerSessionClient,
} from '@process/services/evaosBrokerSession';
import {
  evaosLocalProductFixtureProviderAction,
  evaosLocalProductFixtureProviderHub,
  isEvaosLocalProductFixtureEnabled,
} from '@process/services/evaosLocalProductFixture';
import { assertEvaosRendererSafePayload } from './evaosRendererSecretGuard';

interface BridgeResponse<D = {}> {
  success: boolean;
  data?: D;
  msg?: string;
}

export function initEvaosPeopleAccessBridge(
  client: EvaosBrokerSessionClient = getDefaultEvaosBrokerSessionClient()
): void {
  ipcBridge.evaosPeopleAccess.getPolicy.provider(
    async (request: IEvaosPeopleAccessPolicyRequest): Promise<BridgeResponse<IEvaosPeopleAccessPolicyView>> =>
      toBridgeResponse(() => client.peopleAccessPolicy(request))
  );

  ipcBridge.evaosPeopleAccess.inviteMember.provider(
    async (request: IEvaosPeopleAccessInviteMemberRequest): Promise<BridgeResponse<IEvaosPeopleAccessMutationResult>> =>
      toBridgeResponse(() => client.invitePeopleAccessMember(request))
  );
}

export function initEvaosApprovalCenterBridge(
  client: EvaosBrokerSessionClient = getDefaultEvaosBrokerSessionClient()
): void {
  ipcBridge.evaosApprovalCenter.getApprovals.provider(
    async (request: IEvaosApprovalCenterRequest): Promise<BridgeResponse<IEvaosApprovalCenterView>> =>
      toBridgeResponse(() => client.approvalCenter(request))
  );

  ipcBridge.evaosApprovalCenter.denyApproval.provider(
    async (request: IEvaosApprovalDenyRequest): Promise<BridgeResponse<IEvaosApprovalDecisionResult>> =>
      toBridgeResponse(() => client.denyApproval(request))
  );
}

export function initEvaosProviderHubBridge(
  client: EvaosBrokerSessionClient = getDefaultEvaosBrokerSessionClient()
): void {
  ipcBridge.evaosProviderHub.getProfiles.provider(
    async (request: IEvaosProviderHubRequest): Promise<BridgeResponse<IEvaosProviderHubView>> =>
      toBridgeResponse(() =>
        isEvaosLocalProductFixtureEnabled() ? evaosLocalProductFixtureProviderHub(request) : client.providerHub(request)
      )
  );

  ipcBridge.evaosProviderHub.startAuth.provider(
    async (request: IEvaosProviderActionRequest): Promise<BridgeResponse<IEvaosProviderActionResult>> =>
      toBridgeResponse(() =>
        isEvaosLocalProductFixtureEnabled()
          ? evaosLocalProductFixtureProviderAction(request, 'provider_auth_start')
          : client.startProviderAuth(request)
      )
  );

  ipcBridge.evaosProviderHub.switchProvider.provider(
    async (request: IEvaosProviderActionRequest): Promise<BridgeResponse<IEvaosProviderActionResult>> =>
      toBridgeResponse(() =>
        isEvaosLocalProductFixtureEnabled()
          ? evaosLocalProductFixtureProviderAction(request, 'provider_switch')
          : client.switchProvider(request)
      )
  );

  ipcBridge.evaosProviderHub.revokeProvider.provider(
    async (request: IEvaosProviderActionRequest): Promise<BridgeResponse<IEvaosProviderActionResult>> =>
      toBridgeResponse(() =>
        isEvaosLocalProductFixtureEnabled()
          ? evaosLocalProductFixtureProviderAction(request, 'provider_revoke')
          : client.revokeProvider(request)
      )
  );

  ipcBridge.evaosProviderHub.mintGrant.provider(
    async (request: IEvaosProviderActionRequest): Promise<BridgeResponse<IEvaosProviderActionResult>> =>
      toBridgeResponse(() =>
        isEvaosLocalProductFixtureEnabled()
          ? evaosLocalProductFixtureProviderAction(request, 'provider_mint_grant')
          : client.mintProviderGrant(request)
      )
  );
}

export function initEvaosBusinessBrowserBridge(
  client: EvaosBrokerSessionClient = getDefaultEvaosBrokerSessionClient()
): void {
  ipcBridge.evaosBusinessBrowser.getStatus.provider(
    async (request: IEvaosBusinessBrowserRequest): Promise<BridgeResponse<IEvaosBusinessBrowserView>> =>
      toBridgeResponse(() => client.businessBrowserStatus(request))
  );

  ipcBridge.evaosBusinessBrowser.launch.provider(
    async (request: IEvaosBusinessBrowserRequest): Promise<BridgeResponse<IEvaosBusinessBrowserActionResult>> =>
      toBridgeResponse(() => client.launchBusinessBrowser(request))
  );

  ipcBridge.evaosBusinessBrowser.openUrl.provider(
    async (request: IEvaosBusinessBrowserOpenUrlRequest): Promise<BridgeResponse<IEvaosBusinessBrowserActionResult>> =>
      toBridgeResponse(() => client.openBusinessBrowserUrl(request))
  );

  ipcBridge.evaosBusinessBrowser.stop.provider(
    async (request: IEvaosBusinessBrowserRequest): Promise<BridgeResponse<IEvaosBusinessBrowserActionResult>> =>
      toBridgeResponse(() => client.stopBusinessBrowser(request))
  );
}

export function initEvaosCompanyBrainBridge(
  client: EvaosBrokerSessionClient = getDefaultEvaosBrokerSessionClient()
): void {
  ipcBridge.evaosCompanyBrain.getDirectory.provider(
    async (request: IEvaosCompanyBrainDirectoryRequest): Promise<BridgeResponse<IEvaosCompanyBrainDirectoryView>> =>
      toBridgeResponse(() => client.companyBrainDirectory(request))
  );

  ipcBridge.evaosCompanyBrain.getAccount360.provider(
    async (request: IEvaosCompanyBrainAccountRequest): Promise<BridgeResponse<IEvaosCompanyBrainAccount360View>> =>
      toBridgeResponse(() => client.companyBrainAccount360(request))
  );

  ipcBridge.evaosCompanyBrain.query.provider(
    async (request: IEvaosCompanyBrainQueryRequest): Promise<BridgeResponse<IEvaosCompanyBrainQueryResult>> =>
      toBridgeResponse(() => client.companyBrainQuery(request))
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
