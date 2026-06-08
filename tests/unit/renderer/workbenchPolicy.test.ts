/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SETTINGS_TAB_IDS,
  canAccessBuiltinSettingsTab,
  canAccessExtensionSettings,
  canAccessWorkbenchRoute,
  getDefaultSettingsPath,
  getWorkbenchRouteFallback,
  hasWorkbenchScope,
  type WorkbenchBrokerPolicy,
} from '@/renderer/hooks/context/WorkbenchPolicyContext';

const agentOnlyPolicy: WorkbenchBrokerPolicy = {
  role: 'agent_only',
  scopes: [],
  customerAccountId: 'acct_eric',
  profileId: 'profile_neal',
};

describe('WorkbenchPolicyContext access helpers', () => {
  it('keeps standalone/local sessions permissive when no broker policy has loaded', () => {
    expect(canAccessWorkbenchRoute('/settings/system', null)).toBe(true);
    expect(canAccessWorkbenchRoute('/settings/ext/openclaw', null)).toBe(true);
    expect(canAccessBuiltinSettingsTab('model', null)).toBe(true);
    expect(canAccessExtensionSettings(null)).toBe(true);
    expect(getDefaultSettingsPath(BUILTIN_SETTINGS_TAB_IDS, null)).toBe('/settings/model');
  });

  it('defaults agent_only employees to assigned-agent routes and about only settings', () => {
    expect(canAccessWorkbenchRoute('/guid', agentOnlyPolicy)).toBe(true);
    expect(canAccessWorkbenchRoute('/conversation/abc123', agentOnlyPolicy)).toBe(true);
    expect(canAccessWorkbenchRoute('/settings/about', agentOnlyPolicy)).toBe(true);

    expect(canAccessWorkbenchRoute('/settings/model', agentOnlyPolicy)).toBe(false);
    expect(canAccessWorkbenchRoute('/settings/capabilities', agentOnlyPolicy)).toBe(false);
    expect(canAccessWorkbenchRoute('/settings/webui', agentOnlyPolicy)).toBe(false);
    expect(canAccessWorkbenchRoute('/settings/system', agentOnlyPolicy)).toBe(false);
    expect(canAccessWorkbenchRoute('/settings/ext/provider-admin', agentOnlyPolicy)).toBe(false);
    expect(canAccessWorkbenchRoute('/scheduled', agentOnlyPolicy)).toBe(false);
    expect(canAccessWorkbenchRoute('/team/dawson', agentOnlyPolicy)).toBe(false);
    expect(canAccessWorkbenchRoute('/test/components', agentOnlyPolicy)).toBe(false);

    expect(getDefaultSettingsPath(BUILTIN_SETTINGS_TAB_IDS, agentOnlyPolicy)).toBe('/settings/about');
    expect(getWorkbenchRouteFallback('/settings/model', BUILTIN_SETTINGS_TAB_IDS, agentOnlyPolicy)).toBe(
      '/settings/about'
    );
  });

  it('denies legacy capability routes for agent_only employees', () => {
    expect(canAccessWorkbenchRoute('/settings/skills-hub', agentOnlyPolicy)).toBe(false);
    expect(canAccessWorkbenchRoute('/settings/tools', agentOnlyPolicy)).toBe(false);
  });

  it('allows owner role to use all settings without enumerated scopes', () => {
    const policy: WorkbenchBrokerPolicy = { role: 'owner', scopes: [] };

    expect(canAccessBuiltinSettingsTab('model', policy)).toBe(true);
    expect(canAccessBuiltinSettingsTab('capabilities', policy)).toBe(true);
    expect(canAccessWorkbenchRoute('/settings/webui', policy)).toBe(true);
    expect(canAccessWorkbenchRoute('/settings/ext/operator', policy)).toBe(true);
    expect(canAccessWorkbenchRoute('/team/ops', policy)).toBe(true);
  });

  it('keeps admin role on management surfaces without granting technical routes', () => {
    const policy: WorkbenchBrokerPolicy = { role: 'admin', scopes: [] };

    expect(canAccessBuiltinSettingsTab('model', policy)).toBe(true);
    expect(canAccessBuiltinSettingsTab('capabilities', policy)).toBe(true);
    expect(canAccessWorkbenchRoute('/team/ops', policy)).toBe(true);
    expect(canAccessWorkbenchRoute('/settings/system', policy)).toBe(false);
    expect(canAccessWorkbenchRoute('/settings/webui', policy)).toBe(false);
    expect(canAccessWorkbenchRoute('/test/components', policy)).toBe(false);
  });

  it('uses technical_admin role defaults for technical and provider surfaces', () => {
    const policy: WorkbenchBrokerPolicy = { role: 'technical_admin', scopes: [] };

    expect(canAccessWorkbenchRoute('/settings/model', policy)).toBe(true);
    expect(canAccessWorkbenchRoute('/settings/capabilities', policy)).toBe(true);
    expect(canAccessWorkbenchRoute('/settings/webui', policy)).toBe(true);
    expect(canAccessWorkbenchRoute('/settings/system', policy)).toBe(true);
    expect(canAccessWorkbenchRoute('/scheduled/job-1', policy)).toBe(true);
    expect(canAccessExtensionSettings(policy)).toBe(true);
  });

  it('lets explicit broker scopes grant narrow access without widening everything', () => {
    const policy: WorkbenchBrokerPolicy = { role: 'agent_only', scopes: ['manage_integrations'] };

    expect(hasWorkbenchScope(policy, ['manage_integrations'])).toBe(true);
    expect(canAccessBuiltinSettingsTab('model', policy)).toBe(true);
    expect(canAccessBuiltinSettingsTab('capabilities', policy)).toBe(true);
    expect(canAccessExtensionSettings(policy)).toBe(true);
    expect(canAccessWorkbenchRoute('/settings/system', policy)).toBe(false);
    expect(canAccessWorkbenchRoute('/team/ops', policy)).toBe(false);
  });

  it('keeps desktop-only tabs hidden in browser mode even when policy allows them', () => {
    const policy: WorkbenchBrokerPolicy = { role: 'owner', scopes: [] };

    expect(canAccessBuiltinSettingsTab('pet', policy, { isDesktop: false })).toBe(false);
    expect(canAccessBuiltinSettingsTab('pet', policy, { isDesktop: true })).toBe(true);
  });
});
