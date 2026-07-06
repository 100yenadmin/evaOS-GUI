import { describe, expect, it } from 'vitest';
import {
  EVAOS_ADMIN_FOLLOW_UP_MODULES,
  EVAOS_CORE_RELEASE_MODULES,
  EVAOS_WORKBENCH_MODULE_TAXONOMY,
  isEvaosBrokerRuntimeRoute,
  isEvaosNativeMacConnectorRoute,
} from '@/renderer/evaos/evaosModuleTaxonomy';
import { EVAOS_RUNTIME_CATALOG, EVAOS_ROUTE_POLICIES } from '@/renderer/evaos/evaosRuntimeVisibility';

describe('evaOS Workbench module taxonomy', () => {
  it('pins the v2.1.30 release-critical modules separately from admin follow-up modules', () => {
    expect(EVAOS_CORE_RELEASE_MODULES.map((module) => module.title)).toEqual([
      'evaOS',
      'Hermes',
      'Mission Control',
      'Shared Browser',
      'Design Workspace',
      'Creative Studio',
      'Terminal',
      'Mac & iPhone',
    ]);

    expect(EVAOS_ADMIN_FOLLOW_UP_MODULES.map((module) => module.title)).toEqual([
      'Connected Apps',
      'People & Access',
      'Company Brain',
    ]);

    expect(EVAOS_ADMIN_FOLLOW_UP_MODULES.every((module) => module.releaseCritical === false)).toBe(true);
  });

  it('keeps broker/runtime surfaces from becoming Mac-connector gated by taxonomy drift', () => {
    const macConnectorModules = EVAOS_WORKBENCH_MODULE_TAXONOMY.filter((module) => module.requiresMacConnector);

    expect(macConnectorModules.map((module) => module.routePath)).toEqual(['/native-companion']);
    expect(isEvaosNativeMacConnectorRoute('/native-companion')).toBe(true);
    expect(isEvaosNativeMacConnectorRoute('/evaos')).toBe(false);

    for (const module of EVAOS_CORE_RELEASE_MODULES) {
      if (module.routePath === '/native-companion') continue;
      expect(module.requiresMacConnector, module.title).toBe(false);
      expect(module.surface, module.title).not.toBe('native_mac_connector');
    }
  });

  it('matches route-policy and runtime catalog truth for core broker modules', () => {
    const routePolicyPaths = new Set(EVAOS_ROUTE_POLICIES.map((policy) => policy.routePath));
    const brokeredRuntimePaths = new Set(
      EVAOS_RUNTIME_CATALOG.filter((runtime) => runtime.brokered).map((runtime) => runtime.routePath)
    );

    for (const module of EVAOS_WORKBENCH_MODULE_TAXONOMY) {
      expect(routePolicyPaths.has(module.routePath), module.title).toBe(true);
    }

    expect(isEvaosBrokerRuntimeRoute('/evaos')).toBe(true);
    expect(isEvaosBrokerRuntimeRoute('/business-browser')).toBe(true);
    expect(isEvaosBrokerRuntimeRoute('/native-companion')).toBe(false);
    expect(isEvaosBrokerRuntimeRoute('/creative-studio')).toBe(false);

    for (const module of EVAOS_CORE_RELEASE_MODULES.filter((candidate) => candidate.surface === 'broker_runtime')) {
      expect(brokeredRuntimePaths.has(module.routePath), module.title).toBe(true);
    }
  });
});
