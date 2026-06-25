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
  canAccessEvaosCustomerAdminScope,
  evaosRouteAllowsMissingBroker,
  evaosRuntimeRouteDecision,
  visibleEvaosRuntimeCatalog,
} from '@/renderer/evaos/evaosRuntimeVisibility';

describe('evaosRuntimeVisibility', () => {
  const employeeScopes = [
    'assign_agents',
    'manage_integrations',
    'open_business_browser',
    'use_creative_studio',
    'use_design_workspace',
    'access_openclaw_dashboard',
    'access_hermes_dashboard',
    'access_terminal',
    'access_technical_diagnostics',
  ] as const;

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
      requiresAdmin: false,
      brokered: true,
      requiredScopes: ['access_openclaw_dashboard'],
    });
    expect(EVAOS_RUNTIME_CATALOG.find((runtime) => runtime.key === 'hermes')).toMatchObject({
      title: 'Hermes',
      routePath: '/hermes',
      section: 'technical',
      requiresAdmin: false,
      brokered: true,
      requiredScopes: ['access_hermes_dashboard'],
    });
    expect(EVAOS_RUNTIME_CATALOG.find((runtime) => runtime.key === 'paperclip')).toMatchObject({
      title: 'Mission Control',
      routePath: '/mission-control',
      section: 'technical',
      requiresAdmin: false,
      brokered: true,
      requiredScopes: ['access_technical_diagnostics'],
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

  it('grants global technical dashboard access only to admin@100yen.org', () => {
    expect(
      canAccessEvaosAdminRuntimes({
        authenticated: true,
        roles: ['owner'],
      })
    ).toBe(false);
    expect(
      canAccessEvaosAdminRuntimes({
        authenticated: true,
        roles: ['support'],
        isOperator: true,
      })
    ).toBe(false);
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

  it('keeps customer admin scope separate from global technical routes', () => {
    expect(
      canAccessEvaosCustomerAdminScope({
        authenticated: true,
        roles: ['owner'],
        userEmail: 'owner@example.test',
      })
    ).toBe(true);
    expect(
      canAccessEvaosCustomerAdminScope({
        authenticated: true,
        roles: ['support'],
        isOperator: true,
        userEmail: 'support@example.test',
      })
    ).toBe(true);
    expect(
      evaosRuntimeRouteDecision('/evaos', {
        authenticated: true,
        roles: ['owner'],
        userEmail: 'owner@example.test',
      })
    ).toEqual({ allowed: false, fallbackPath: '/guid', reason: 'scope_required' });
    expect(
      evaosRuntimeRouteDecision('/connected-apps', {
        authenticated: true,
        roles: ['owner'],
        userEmail: 'owner@example.test',
      })
    ).toEqual({ allowed: false, fallbackPath: '/guid', reason: 'scope_required' });
    expect(
      evaosRuntimeRouteDecision('/connected-apps', {
        authenticated: true,
        roles: ['owner'],
        scopes: ['manage_integrations'],
        userEmail: 'owner@example.test',
      })
    ).toEqual({ allowed: true, fallbackPath: '/guid' });
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

  it('lets customer-scoped technical admins open technical runtimes with matching scopes', () => {
    const context = {
      authenticated: true,
      roles: ['technical_admin'],
      scopes: [
        'manage_integrations',
        'open_business_browser',
        'use_creative_studio',
        'use_design_workspace',
        'view_company_brain',
        'access_openclaw_dashboard',
        'access_hermes_dashboard',
        'access_terminal',
        'access_technical_diagnostics',
      ],
      userEmail: 'benjamin@example.test',
    };

    expect(canAccessEvaosAdminRuntimes(context)).toBe(false);
    expect(visibleEvaosRuntimeCatalog(context).map((runtime) => runtime.key)).toEqual([
      'openclaw',
      'hermes',
      'paperclip',
      'opendesign',
      'browser',
      'terminal',
      'creative_studio',
    ]);
    expect(evaosRuntimeRouteDecision('/evaos', context)).toEqual({ allowed: true, fallbackPath: '/guid' });
    expect(evaosRuntimeRouteDecision('/openclaw', context)).toEqual({ allowed: true, fallbackPath: '/guid' });
    expect(evaosRuntimeRouteDecision('/hermes', context)).toEqual({ allowed: true, fallbackPath: '/guid' });
    expect(evaosRuntimeRouteDecision('/mission-control', context)).toEqual({ allowed: true, fallbackPath: '/guid' });
    expect(evaosRuntimeRouteDecision('/terminal', context)).toEqual({ allowed: true, fallbackPath: '/guid' });
    expect(evaosRuntimeRouteDecision('/people-access', context)).toEqual({
      allowed: false,
      fallbackPath: '/guid',
      reason: 'scope_required',
    });
    expect(evaosRuntimeRouteDecision('/approval-center', context)).toEqual({
      allowed: false,
      fallbackPath: '/guid',
      reason: 'scope_required',
    });
    expect(evaosRuntimeRouteDecision('/company-brain', context)).toEqual({ allowed: true, fallbackPath: '/guid' });
  });

  it('pins scoped employees to Workbench tools without People Access or Company Brain', () => {
    const context = {
      authenticated: true,
      roles: ['employee'],
      scopes: [...employeeScopes],
      userEmail: 'employee@example.test',
    };

    expect(canAccessEvaosAdminRuntimes(context)).toBe(false);
    expect(visibleEvaosRuntimeCatalog(context).map((runtime) => runtime.key)).toEqual([
      'openclaw',
      'hermes',
      'paperclip',
      'opendesign',
      'browser',
      'terminal',
      'creative_studio',
    ]);
    for (const routePath of [
      '/evaos',
      '/openclaw',
      '/hermes',
      '/mission-control',
      '/terminal',
      '/business-browser',
      '/design-workspace',
      '/creative-studio',
      '/connected-apps',
      '/team/customer-team',
      '/native-companion',
    ]) {
      expect(evaosRuntimeRouteDecision(routePath, context)).toEqual({ allowed: true, fallbackPath: '/guid' });
    }
    for (const routePath of ['/people-access', '/approval-center', '/company-brain']) {
      expect(evaosRuntimeRouteDecision(routePath, context)).toEqual({
        allowed: false,
        fallbackPath: '/guid',
        reason: 'scope_required',
      });
    }
  });

  it('shows admin technical runtimes and keeps team chat deferred until enabled', () => {
    const hiddenTeamKeys = visibleEvaosRuntimeCatalog({
      authenticated: true,
      roles: ['admin'],
      userEmail: 'admin@100yen.org',
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
      userEmail: 'admin@100yen.org',
      scopes: ['access_terminal'],
      teamChatEnabled: true,
    }).map((runtime) => runtime.key);

    expect(visibleTeamKeys).toContain('team_chat');
  });

  it('keeps customer admins scoped to broker policy while preserving the global evaOS admin override', () => {
    expect(
      evaosRuntimeRouteDecision('/people-access', {
        authenticated: true,
        roles: ['admin'],
        scopes: [],
        userEmail: 'company-admin@example.test',
      })
    ).toEqual({ allowed: false, fallbackPath: '/guid', reason: 'scope_required' });

    expect(
      evaosRuntimeRouteDecision('/people-access', {
        authenticated: true,
        roles: ['admin'],
        scopes: ['manage_members'],
        userEmail: 'company-admin@example.test',
      })
    ).toEqual({ allowed: true, fallbackPath: '/guid' });

    expect(
      evaosRuntimeRouteDecision('/people-access', {
        authenticated: true,
        roles: ['member'],
        scopes: [],
        userEmail: 'admin@100yen.org',
      })
    ).toEqual({ allowed: true, fallbackPath: '/guid' });
  });

  it('fails closed for direct technical-dashboard routes when the session is not allowed', () => {
    expect(
      evaosRuntimeRouteDecision('/terminal', {
        authenticated: true,
        roles: ['member'],
        scopes: ['open_business_browser'],
      })
    ).toEqual({ allowed: false, fallbackPath: '/guid', reason: 'scope_required' });
    expect(
      evaosRuntimeRouteDecision('/openclaw', {
        authenticated: false,
        roles: ['admin'],
      })
    ).toEqual({ allowed: false, fallbackPath: '/login', reason: 'signed_out' });
  });

  it('defines explicit route policies for all evaOS product and setup routes', () => {
    expect(EVAOS_ROUTE_POLICIES.map((policy) => policy.routePath)).toEqual([
      '/home',
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
      '/team',
    ]);

    expect(
      EVAOS_ROUTE_POLICIES.filter((policy) => policy.allowMissingBroker).map((policy) => policy.routePath)
    ).toEqual(['/home', '/native-companion']);
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
        userEmail: 'analyst@example.test',
      })
    ).toEqual({ allowed: true, fallbackPath: '/guid' });

    expect(
      evaosRuntimeRouteDecision('/company-brain', {
        authenticated: true,
        roles: ['member'],
        scopes: ['view_company_brain'],
        userEmail: 'admin@100yen.org',
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

    expect(
      evaosRuntimeRouteDecision('/team/customer-team', {
        authenticated: true,
        roles: ['member'],
        scopes: [],
      })
    ).toEqual({ allowed: false, fallbackPath: '/guid', reason: 'scope_required' });

    expect(
      evaosRuntimeRouteDecision('/team/customer-team', {
        authenticated: true,
        roles: ['member'],
        scopes: ['assign_agents'],
      })
    ).toEqual({ allowed: true, fallbackPath: '/guid' });
  });

  it('lets authenticated employees reach Mac & iPhone repair without opening admin/runtime surfaces', () => {
    const employeeContext = {
      authenticated: true,
      roles: ['member'],
      scopes: [] as const,
      userEmail: 'employee@example.test',
    };

    expect(evaosRuntimeRouteDecision('/native-companion', employeeContext)).toEqual({
      allowed: true,
      fallbackPath: '/guid',
    });
    expect(evaosRuntimeRouteDecision('/evaos', employeeContext)).toEqual({
      allowed: false,
      fallbackPath: '/guid',
      reason: 'scope_required',
    });
    expect(evaosRuntimeRouteDecision('/hermes', employeeContext)).toEqual({
      allowed: false,
      fallbackPath: '/guid',
      reason: 'scope_required',
    });
    expect(evaosRuntimeRouteDecision('/terminal', employeeContext)).toEqual({
      allowed: false,
      fallbackPath: '/guid',
      reason: 'scope_required',
    });
  });
});
