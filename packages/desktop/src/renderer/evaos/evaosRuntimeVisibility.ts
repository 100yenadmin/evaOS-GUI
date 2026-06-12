/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IEvaosAccountPolicyScope, IEvaosRuntimeKey } from '@/common/evaos/bridgeTypes';

type EvaosRuntimeSection = 'workspace' | 'technical';
type EvaosRuntimeFeatureFlag = 'team_chat';
type EvaosRouteDenialReason = 'signed_out' | 'admin_runtime_required' | 'scope_required' | 'unknown_route';

export type EvaosRoutePolicy = {
  routePath: string;
  requiresAdmin?: boolean;
  requiredScopes?: IEvaosAccountPolicyScope[];
  anyRequiredScopes?: IEvaosAccountPolicyScope[];
  allowMissingBroker?: boolean;
};

export interface EvaosRuntimeDefinition {
  key: IEvaosRuntimeKey;
  title: string;
  subtitle: string;
  section: EvaosRuntimeSection;
  routePath: string;
  brokered: boolean;
  requiresAdmin: boolean;
  technicalDashboard: boolean;
  deferred?: boolean;
  featureFlag?: EvaosRuntimeFeatureFlag;
  externalUrl?: string;
  requiredScopes?: IEvaosAccountPolicyScope[];
}

export interface EvaosRuntimeVisibilityContext {
  authenticated: boolean;
  roles?: string[];
  isOperator?: boolean;
  userEmail?: string | null;
  scopes?: IEvaosAccountPolicyScope[];
  teamChatEnabled?: boolean;
}

export interface EvaosRuntimeRouteDecision {
  allowed: boolean;
  fallbackPath: '/login' | '/guid';
  reason?: EvaosRouteDenialReason;
}

const ADMIN_RUNTIME_ROLES = new Set(['owner', 'admin', 'technical_admin']);
const OPERATOR_ADMIN_ROLES = new Set(['customer_service', 'support']);
const ELECTRIC_SHEEP_COMPANY_BRAIN_ADMINS = new Set(['admin@100yen.org']);

export const EVAOS_RUNTIME_CATALOG: EvaosRuntimeDefinition[] = [
  {
    key: 'openclaw',
    title: 'evaOS',
    subtitle: 'Primary evaOS agent workspace.',
    section: 'technical',
    routePath: '/evaos',
    brokered: true,
    requiresAdmin: true,
    technicalDashboard: true,
    requiredScopes: ['access_openclaw_dashboard'],
  },
  {
    key: 'hermes',
    title: 'Hermes',
    subtitle: 'Hermes agent workspace.',
    section: 'technical',
    routePath: '/hermes',
    brokered: true,
    requiresAdmin: true,
    technicalDashboard: true,
    requiredScopes: ['access_hermes_dashboard'],
  },
  {
    key: 'paperclip',
    title: 'Mission Control',
    subtitle: 'Agent run dashboard and operating queue.',
    section: 'technical',
    routePath: '/mission-control',
    brokered: true,
    requiresAdmin: true,
    technicalDashboard: true,
  },
  {
    key: 'opendesign',
    title: 'Design Workspace',
    subtitle: 'OpenDesign workspace.',
    section: 'workspace',
    routePath: '/design-workspace',
    brokered: true,
    requiresAdmin: false,
    technicalDashboard: false,
    requiredScopes: ['use_design_workspace'],
  },
  {
    key: 'browser',
    title: 'Business Browser',
    subtitle: 'Brokered customer browser workspace.',
    section: 'workspace',
    routePath: '/business-browser',
    brokered: true,
    requiresAdmin: false,
    technicalDashboard: false,
    requiredScopes: ['open_business_browser'],
  },
  {
    key: 'terminal',
    title: 'Terminal',
    subtitle: 'Admin terminal surface.',
    section: 'technical',
    routePath: '/terminal',
    brokered: true,
    requiresAdmin: true,
    technicalDashboard: true,
    requiredScopes: ['access_terminal'],
  },
  {
    key: 'creative_studio',
    title: 'Creative Studio',
    subtitle: 'External creative generation workspace.',
    section: 'workspace',
    routePath: '/creative-studio',
    brokered: false,
    requiresAdmin: false,
    technicalDashboard: false,
    externalUrl: 'https://www.comfy.org/cloud',
    requiredScopes: ['use_creative_studio'],
  },
  {
    key: 'team_chat',
    title: 'Team Chat',
    subtitle: 'Company chat workspace.',
    section: 'workspace',
    routePath: '/team',
    brokered: true,
    requiresAdmin: false,
    technicalDashboard: false,
    deferred: true,
    featureFlag: 'team_chat',
  },
];

const RUNTIME_BY_ROUTE_PATH = new Map(EVAOS_RUNTIME_CATALOG.map((runtime) => [runtime.routePath, runtime]));

export const EVAOS_ROUTE_POLICIES: EvaosRoutePolicy[] = [
  {
    routePath: '/home',
    allowMissingBroker: true,
  },
  {
    routePath: '/evaos',
    requiresAdmin: true,
    requiredScopes: ['access_openclaw_dashboard'],
  },
  {
    routePath: '/openclaw',
    requiresAdmin: true,
    requiredScopes: ['access_openclaw_dashboard'],
  },
  {
    routePath: '/hermes',
    requiresAdmin: true,
    requiredScopes: ['access_hermes_dashboard'],
  },
  {
    routePath: '/mission-control',
    requiresAdmin: true,
  },
  {
    routePath: '/design-workspace',
    anyRequiredScopes: ['use_design_workspace'],
  },
  {
    routePath: '/beta-readiness',
    requiresAdmin: true,
  },
  {
    routePath: '/terminal',
    requiresAdmin: true,
    requiredScopes: ['access_terminal'],
  },
  {
    routePath: '/native-companion',
    allowMissingBroker: true,
  },
  {
    routePath: '/people-access',
    anyRequiredScopes: ['manage_members'],
  },
  {
    routePath: '/connected-apps',
    anyRequiredScopes: ['manage_integrations'],
  },
  {
    routePath: '/approval-center',
    anyRequiredScopes: ['approve_actions'],
  },
  {
    routePath: '/business-browser',
    anyRequiredScopes: ['open_business_browser'],
  },
  {
    routePath: '/creative-studio',
    anyRequiredScopes: ['use_creative_studio'],
  },
  {
    routePath: '/company-brain',
    anyRequiredScopes: ['view_company_brain', 'manage_company_brain'],
  },
];

const ROUTE_POLICY_BY_PATH = new Map(EVAOS_ROUTE_POLICIES.map((policy) => [policy.routePath, policy]));

export function canAccessEvaosAdminRuntimes(context: EvaosRuntimeVisibilityContext): boolean {
  if (!context.authenticated) return false;
  if (normalizeEmail(context.userEmail) === 'admin@100yen.org') return true;

  const roles = normalizedRoles(context.roles);
  if (roles.some((role) => ADMIN_RUNTIME_ROLES.has(role))) return true;
  return Boolean(context.isOperator && roles.some((role) => OPERATOR_ADMIN_ROLES.has(role)));
}

export function canAccessEvaosCompanyBrain(context: EvaosRuntimeVisibilityContext): boolean {
  return context.authenticated && ELECTRIC_SHEEP_COMPANY_BRAIN_ADMINS.has(normalizeEmail(context.userEmail) ?? '');
}

export function visibleEvaosRuntimeCatalog(context: EvaosRuntimeVisibilityContext): EvaosRuntimeDefinition[] {
  if (!context.authenticated) return [];
  return EVAOS_RUNTIME_CATALOG.filter((runtime) => canOpenRuntime(runtime, context));
}

export function evaosRuntimeRouteDecision(
  routePath: string,
  context: EvaosRuntimeVisibilityContext
): EvaosRuntimeRouteDecision {
  if (!context.authenticated) {
    return { allowed: false, fallbackPath: '/login', reason: 'signed_out' };
  }

  const normalizedRoutePath = normalizeRoutePath(routePath);
  const runtime = RUNTIME_BY_ROUTE_PATH.get(normalizedRoutePath);
  const routePolicy = ROUTE_POLICY_BY_PATH.get(normalizedRoutePath);
  if (!runtime && !routePolicy) {
    return { allowed: false, fallbackPath: '/guid', reason: 'unknown_route' };
  }

  if (routePolicy && canOpenRoutePolicy(routePolicy, context)) {
    return { allowed: true, fallbackPath: '/guid' };
  }

  if (runtime && canOpenRuntime(runtime, context)) {
    return { allowed: true, fallbackPath: '/guid' };
  }

  return {
    allowed: false,
    fallbackPath: '/guid',
    reason: routePolicy?.requiresAdmin || runtime?.requiresAdmin ? 'admin_runtime_required' : 'scope_required',
  };
}

export function evaosRouteAllowsMissingBroker(routePath: string): boolean {
  return ROUTE_POLICY_BY_PATH.get(normalizeRoutePath(routePath))?.allowMissingBroker === true;
}

function canOpenRuntime(runtime: EvaosRuntimeDefinition, context: EvaosRuntimeVisibilityContext): boolean {
  if (!context.authenticated) return false;
  if (runtime.deferred && runtime.featureFlag === 'team_chat' && !context.teamChatEnabled) return false;
  if (runtime.requiresAdmin) return canAccessEvaosAdminRuntimes(context);
  if (!hasRequiredScopes(runtime, context.scopes)) return false;
  return true;
}

function hasRequiredScopes(runtime: EvaosRuntimeDefinition, scopes: IEvaosAccountPolicyScope[] | undefined): boolean {
  if (!runtime.requiredScopes?.length) return true;
  if (!scopes) return false;
  return runtime.requiredScopes.every((scope) => scopes.includes(scope));
}

function canOpenRoutePolicy(policy: EvaosRoutePolicy, context: EvaosRuntimeVisibilityContext): boolean {
  if (!context.authenticated) return false;
  if (normalizeRoutePath(policy.routePath) === '/company-brain' && !canAccessEvaosCompanyBrain(context)) return false;
  const adminAccess = canAccessEvaosAdminRuntimes(context);
  if (adminAccess) return true;
  if (policy.requiresAdmin) return false;
  if (!hasAllPolicyScopes(policy.requiredScopes, context.scopes)) return false;
  if (!hasAnyPolicyScope(policy.anyRequiredScopes, context.scopes)) return false;
  return true;
}

function hasAllPolicyScopes(
  requiredScopes: IEvaosAccountPolicyScope[] | undefined,
  scopes: IEvaosAccountPolicyScope[] | undefined
): boolean {
  if (!requiredScopes?.length) return true;
  if (!scopes) return false;
  return requiredScopes.every((scope) => scopes.includes(scope));
}

function hasAnyPolicyScope(
  requiredScopes: IEvaosAccountPolicyScope[] | undefined,
  scopes: IEvaosAccountPolicyScope[] | undefined
): boolean {
  if (!requiredScopes?.length) return true;
  if (!scopes) return false;
  return requiredScopes.some((scope) => scopes.includes(scope));
}

function normalizedRoles(roles: string[] | undefined): string[] {
  return (roles ?? []).map((role) => role.trim().toLowerCase().replace(/-/g, '_')).filter(Boolean);
}

function normalizeEmail(email: string | null | undefined): string | undefined {
  const normalized = email?.trim().toLowerCase();
  return normalized || undefined;
}

function normalizeRoutePath(path: string): string {
  const [routePath] = path.split(/[?#]/, 1);
  return routePath || '/';
}
