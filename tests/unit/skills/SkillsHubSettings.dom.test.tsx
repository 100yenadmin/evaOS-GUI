import React from 'react';
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for SkillsHubSettings component (SK3 in N4a).
 * Shallow verification: module import + basic structure.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const bridgeMocks = vi.hoisted(() => ({
  listAvailableSkills: vi.fn(),
  getSkillPaths: vi.fn(),
  listBuiltinAutoSkills: vi.fn(),
  importSkillWithSymlink: vi.fn(),
  deleteSkill: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: bridgeMocks.listAvailableSkills },
      getSkillPaths: { invoke: bridgeMocks.getSkillPaths },
      listBuiltinAutoSkills: { invoke: bridgeMocks.listBuiltinAutoSkills },
      importSkillWithSymlink: { invoke: bridgeMocks.importSkillWithSymlink },
      deleteSkill: { invoke: bridgeMocks.deleteSkill },
    },
    dialog: {
      showOpen: { invoke: vi.fn() },
    },
  },
}));

import SkillsHubSettings from '@/renderer/pages/settings/SkillsHubSettings';

function renderSkillsHub() {
  return render(
    <MemoryRouter>
      <SkillsHubSettings withWrapper={false} />
    </MemoryRouter>
  );
}

describe('SkillsHubSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeMocks.listAvailableSkills.mockResolvedValue([
      {
        name: 'custom-skill',
        description: 'Custom workflow description',
        location: '/skills/custom',
        is_custom: true,
        source: 'custom',
      },
      {
        name: 'builtin-skill',
        description: 'Built-in bundled skill description',
        location: '/skills/builtin',
        is_custom: false,
        source: 'builtin',
      },
      {
        name: 'extension-skill',
        description: 'Extension workflow description',
        location: '/skills/extension',
        is_custom: false,
        source: 'extension',
      },
    ]);
    bridgeMocks.getSkillPaths.mockResolvedValue({
      user_skills_dir: '/workspace/user-skills',
      builtin_skills_dir: '/workspace/builtin-skills',
    });
    bridgeMocks.listBuiltinAutoSkills.mockResolvedValue([
      {
        name: 'auto-skill',
        description: 'Auto-loaded workflow description',
      },
    ]);
  });

  it('exports a component (smoke)', () => {
    expect(SkillsHubSettings).toBeDefined();
    expect(typeof SkillsHubSettings).toBe('function');
  });

  it('has display name or name property (structure check)', () => {
    expect(SkillsHubSettings.displayName || SkillsHubSettings.name).toBeTruthy();
  });

  it('can be instantiated as JSX element (shallow)', () => {
    const element = <SkillsHubSettings />;
    expect(element.type).toBe(SkillsHubSettings);
  });

  it('describes skill origins at section level instead of per-card badges', async () => {
    renderSkillsHub();

    const customCard = await screen.findByTestId('my-skill-card-custom-skill');
    const builtinCard = await screen.findByTestId('my-skill-card-builtin-skill');
    const extensionCard = await screen.findByTestId('extension-skill-card-extension-skill');
    const autoCard = await screen.findByTestId('auto-skill-card-auto-skill');

    expect(screen.getByTestId('skills-hub-my-hint')).toHaveTextContent('Import a skill folder');
    expect(screen.getByTestId('skills-hub-extension-hint')).toHaveTextContent('installed extensions');
    expect(screen.getByTestId('skills-hub-auto-hint')).toHaveTextContent('Loaded automatically');

    expect(customCard).toHaveTextContent('Custom workflow description');
    expect(builtinCard).toHaveTextContent('Built-in bundled skill description');
    expect(extensionCard).toHaveTextContent('Extension workflow description');
    expect(autoCard).toHaveTextContent('Auto-loaded workflow description');

    expect(within(customCard).queryByText(/^Custom$/, { selector: 'span' })).not.toBeInTheDocument();
    expect(within(builtinCard).queryByText(/^Built-in$/, { selector: 'span' })).not.toBeInTheDocument();
    expect(within(extensionCard).queryByText(/^Extension$/, { selector: 'span' })).not.toBeInTheDocument();
    expect(within(autoCard).queryByText(/^Auto$/, { selector: 'span' })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(bridgeMocks.listAvailableSkills).toHaveBeenCalled();
      expect(bridgeMocks.getSkillPaths).toHaveBeenCalled();
      expect(bridgeMocks.listBuiltinAutoSkills).toHaveBeenCalled();
    });
  });
});
