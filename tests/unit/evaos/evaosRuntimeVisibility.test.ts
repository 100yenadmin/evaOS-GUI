/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  EVAOS_RUNTIME_CATALOG,
  EVAOS_ROUTE_POLICIES,
  canAccessEvaosAdminRuntimes,
  evaosRouteAllowsMissingBroker,
  evaosRuntimeRouteDecision,
  visibleEvaosRuntimeCatalog,
} from '@/renderer/evaos/evaosRuntimeVisibility';

describe('evaosRuntimeVisibility', () => {
  it('mirrors the released Workbench runtime catalog with evaOS presentation routes', () => {
    expect(EVAOS_RUNTIME_CATALOG.map((runtime) => runtime.key)).toEqual([
      'openclaw',
      'hermes',
      'paperclip',
      'opendesign',
      'browser',
      'terminal',
      'creative_studio',
      'team_chat',
    ]);
    expect(EVAOS_RUNTIME_CATALOG.find((runtime) => runtime.key === 'openclaw')).toMatchObject({
      title: 'evaOS',
      routePath: '/evaos',
      section: 'technical',
      requiresAdmin: true,
      brokered: true,
    });
    expect(EVAOS_RUNTIME_CATALOG.find((runtime) => runtime.key === 'hermes')).toMatchObject({
      title: 'Hermes',
      routePath: '/hermes',
      section: 'technical',
      requiresAdmin: true,
      brokered: true,
    });
    expect(EVAOS_RUNTIME_CATALOG.find((runtime) => runtime.key === 'creative_studio')).toMatchObject({
      title: 'Creative Studio',
      brokered: false,
      externalUrl: 'https://www.comfy.org/cloud',
    });
    expect(EVAOS_RUNTIME_CATALOG.find((runtime) => runtime.key === 'team_chat')).toMatchObject({
      deferred: true,
      featureFlag: 'team_chat',
    });
  });

  it('grants technical dashboard access only to owner/admin, support operator, or admin@100yen.org', () => {
    expect(
      canAccessEvaosAdminRuntimes({
        authenticated: true,
        roles: ['owner'],
      })
    ).toBe(true);
    expect(
      canAccessEvaosAdminRuntimes({
        authenticated: true,
        roles: ['support'],
        isOperator: true,
      })
    ).toBe(true);
    expect(
      canAccessEvaosAdminRuntimes({
        authenticated: true,
        roles: ['member'],
        userEmail: 'admin@100yen.org',
      })
    ).toBe(true);
    expect(
      canAccessEvaosAdminRuntimes({
        authenticated: true,
        roles: ['member'],
        userEmail: 'teammate@example.com',
      })
    ).toBe(false);
    expect(canAccessEvaosAdminRuntimes({ authenticated: false, roles: ['owner'] })).toBe(false);
  });

  it('hides admin-only and deferred runtimes from normal members while preserving assigned workspaces', () => {
    expect(
      visibleEvaosRuntimeCatalog({
        authenticated: true,
        roles: ['member'],
      }).map((runtime) => runtime.key)
    ).toEqual([]);

    const visibleKeys = visibleEvaosRuntimeCatalog({
      authenticated: true,
      roles: ['member'],
      scopes: ['open_business_browser', 'use_design_workspace', 'use_creative_studio'],
      teamChatEnabled: false,
    }).map((runtime) => runtime.key);

    expect(visibleKeys).toEqual(['opendesign', 'browser', 'creative_studio']);
  });

  it('shows admin technical runtimes and keeps team chat deferred until enabled', () => {
    const hiddenTeamKeys = visibleEvaosRuntimeCatalog({
      authenticated: true,
      roles: ['admin'],
      scopes: ['access_terminal'],
      teamChatEnabled: false,
    }).map((runtime) => runtime.key);

    expect(hiddenTeamKeys).toContain('openclaw');
    expect(hiddenTeamKeys).toContain('hermes');
    expect(hiddenTeamKeys).toContain('paperclip');
    expect(hiddenTeamKeys).toContain('terminal');
    expect(hiddenTeamKeys).not.toContain('team_chat');

    const visibleTeamKeys = visibleEvaosRuntimeCatalog({
      authenticated: true,
      roles: ['admin'],
      scopes: ['access_terminal'],
      teamChatEnabled: true,
    }).map((runtime) => runtime.key);

    expect(visibleTeamKeys).toContain('team_chat');
  });

  it('fails closed for direct technical-dashboard routes when the session is not allowed', () => {
    expect(
      evaosRuntimeRouteDecision('/terminal', {
        authenticated: true,
        roles: ['member'],
        scopes: ['open_business_browser'],
      })
    ).toEqual({ allowed: false, fallbackPath: '/guid', reason: 'admin_runtime_required' });
    expect(
      evaosRuntimeRouteDecision('/openclaw', {
        authenticated: false,
        roles: ['admin'],
      })
    ).toEqual({ allowed: false, fallbackPath: '/login', reason: 'signed_out' });
  });

  it('defines explicit route policies for all evaOS product and setup routes', () => {
    expect(EVAOS_ROUTE_POLICIES.map((policy) => policy.routePath)).toEqual([
      '/evaos',
      '/openclaw',
      '/hermes',
      '/mission-control',
      '/design-workspace',
      '/beta-readiness',
      '/terminal',
      '/native-companion',
      '/people-access',
      '/connected-apps',
      '/approval-center',
      '/business-browser',
      '/creative-studio',
      '/company-brain',
    ]);

    expect(evaosRouteAllowsMissingBroker('/evaos')).toBe(true);
    expect(evaosRouteAllowsMissingBroker('/openclaw')).toBe(true);
    expect(evaosRouteAllowsMissingBroker('/hermes')).toBe(true);
    expect(evaosRouteAllowsMissingBroker('/mission-control')).toBe(true);
    expect(evaosRouteAllowsMissingBroker('/native-companion')).toBe(true);
    expect(evaosRouteAllowsMissingBroker('/design-workspace')).toBe(false);
    expect(evaosRouteAllowsMissingBroker('/creative-studio')).toBe(false);
    expect(evaosRouteAllowsMissingBroker('/people-access')).toBe(false);
  });

  it('lets signed-in admins reach evaOS and Hermes routes while preserving broker repair states', () => {
    const context = {
      authenticated: true,
      roles: ['owner'],
      scopes: [],
      userEmail: 'admin@100yen.org',
    };

    expect(evaosRuntimeRouteDecision('/evaos', context).allowed).toBe(true);
    expect(evaosRuntimeRouteDecision('/hermes', context).allowed).toBe(true);
  });

  it('derives product route decisions from account policy scopes', () => {
    expect(
      evaosRuntimeRouteDecision('/people-access', {
        authenticated: true,
        roles: ['member'],
        scopes: ['manage_members'],
      })
    ).toEqual({ allowed: true, fallbackPath: '/guid' });

    expect(
      evaosRuntimeRouteDecision('/people-access', {
        authenticated: true,
        roles: ['member'],
        scopes: [],
      })
    ).toEqual({ allowed: false, fallbackPath: '/guid', reason: 'scope_required' });

    expect(
      evaosRuntimeRouteDecision('/company-brain', {
        authenticated: true,
        roles: ['member'],
        scopes: ['view_company_brain'],
      })
    ).toEqual({ allowed: true, fallbackPath: '/guid' });

    expect(
      evaosRuntimeRouteDecision('/connected-apps', {
        authenticated: true,
        roles: ['member'],
        scopes: ['manage_integrations'],
      })
    ).toEqual({ allowed: true, fallbackPath: '/guid' });

    expect(
      evaosRuntimeRouteDecision('/design-workspace', {
        authenticated: true,
        roles: ['member'],
        scopes: ['use_design_workspace'],
      })
    ).toEqual({ allowed: true, fallbackPath: '/guid' });

    expect(
      evaosRuntimeRouteDecision('/creative-studio', {
        authenticated: true,
        roles: ['member'],
        scopes: ['use_creative_studio'],
      })
    ).toEqual({ allowed: true, fallbackPath: '/guid' });

    expect(
      evaosRuntimeRouteDecision('/creative-studio', {
        authenticated: true,
        roles: ['member'],
        scopes: [],
      })
    ).toEqual({ allowed: false, fallbackPath: '/guid', reason: 'scope_required' });
  });
});
