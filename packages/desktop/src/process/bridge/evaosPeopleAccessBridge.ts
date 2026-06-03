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

async function toBridgeResponse<D>(operation: () => Promise<D>): Promise<BridgeResponse<D>> {
  try {
    return {
      success: true,
      data: await operation(),
    };
  } catch (error) {
    return {
      success: false,
      msg: evaosBrokerErrorMessage(error),
    };
  }
}
