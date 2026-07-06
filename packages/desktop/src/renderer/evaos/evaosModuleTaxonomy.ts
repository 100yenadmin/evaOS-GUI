/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type EvaosModuleReleaseGroup = 'core_release' | 'admin_follow_up';
export type EvaosModuleSurface =
  | 'broker_runtime'
  | 'external_workspace'
  | 'native_mac_connector'
  | 'broker_admin_module';

export type EvaosWorkbenchModuleDefinition = {
  title: string;
  routePath: string;
  releaseGroup: EvaosModuleReleaseGroup;
  surface: EvaosModuleSurface;
  releaseCritical: boolean;
  requiresMacConnector: boolean;
};

export const EVAOS_WORKBENCH_MODULE_TAXONOMY = [
  {
    title: 'evaOS',
    routePath: '/evaos',
    releaseGroup: 'core_release',
    surface: 'broker_runtime',
    releaseCritical: true,
    requiresMacConnector: false,
  },
  {
    title: 'Hermes',
    routePath: '/hermes',
    releaseGroup: 'core_release',
    surface: 'broker_runtime',
    releaseCritical: true,
    requiresMacConnector: false,
  },
  {
    title: 'Mission Control',
    routePath: '/mission-control',
    releaseGroup: 'core_release',
    surface: 'broker_runtime',
    releaseCritical: true,
    requiresMacConnector: false,
  },
  {
    title: 'Shared Browser',
    routePath: '/business-browser',
    releaseGroup: 'core_release',
    surface: 'broker_runtime',
    releaseCritical: true,
    requiresMacConnector: false,
  },
  {
    title: 'Design Workspace',
    routePath: '/design-workspace',
    releaseGroup: 'core_release',
    surface: 'broker_runtime',
    releaseCritical: true,
    requiresMacConnector: false,
  },
  {
    title: 'Creative Studio',
    routePath: '/creative-studio',
    releaseGroup: 'core_release',
    surface: 'external_workspace',
    releaseCritical: true,
    requiresMacConnector: false,
  },
  {
    title: 'Terminal',
    routePath: '/terminal',
    releaseGroup: 'core_release',
    surface: 'broker_runtime',
    releaseCritical: true,
    requiresMacConnector: false,
  },
  {
    title: 'Mac & iPhone',
    routePath: '/native-companion',
    releaseGroup: 'core_release',
    surface: 'native_mac_connector',
    releaseCritical: true,
    requiresMacConnector: true,
  },
  {
    title: 'Connected Apps',
    routePath: '/connected-apps',
    releaseGroup: 'admin_follow_up',
    surface: 'broker_admin_module',
    releaseCritical: false,
    requiresMacConnector: false,
  },
  {
    title: 'People & Access',
    routePath: '/people-access',
    releaseGroup: 'admin_follow_up',
    surface: 'broker_admin_module',
    releaseCritical: false,
    requiresMacConnector: false,
  },
  {
    title: 'Company Brain',
    routePath: '/company-brain',
    releaseGroup: 'admin_follow_up',
    surface: 'broker_admin_module',
    releaseCritical: false,
    requiresMacConnector: false,
  },
] as const satisfies readonly EvaosWorkbenchModuleDefinition[];

export const EVAOS_CORE_RELEASE_MODULES = EVAOS_WORKBENCH_MODULE_TAXONOMY.filter(
  (module) => module.releaseGroup === 'core_release'
);

export const EVAOS_ADMIN_FOLLOW_UP_MODULES = EVAOS_WORKBENCH_MODULE_TAXONOMY.filter(
  (module) => module.releaseGroup === 'admin_follow_up'
);

export function isEvaosNativeMacConnectorRoute(routePath: string): boolean {
  return EVAOS_WORKBENCH_MODULE_TAXONOMY.some(
    (module) => module.routePath === routePath && module.surface === 'native_mac_connector'
  );
}

export function isEvaosBrokerRuntimeRoute(routePath: string): boolean {
  return EVAOS_WORKBENCH_MODULE_TAXONOMY.some(
    (module) => module.routePath === routePath && module.surface === 'broker_runtime'
  );
}
