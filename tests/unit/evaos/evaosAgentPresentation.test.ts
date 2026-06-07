import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import {
  getEvaosAgentDisplayName,
  sortEvaosDetectedAgentsForPresentation,
} from '@/renderer/evaos/evaosAgentPresentation';
import { PRESET_THEMES } from '@/renderer/pages/settings/DisplaySettings/presets';

function agent(agent_type: AgentMetadata['agent_type'], name: string, backend?: string): AgentMetadata {
  return {
    id: `${backend ?? agent_type}-${name}`,
    name,
    backend,
    agent_type,
    agent_source: 'builtin',
    enabled: true,
    available: true,
  };
}

function collectJsonStringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectJsonStringValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectJsonStringValues);
  return [];
}

function collectJsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const fullPath = path.join(dir, name);
    if (statSync(fullPath).isDirectory()) return collectJsonFiles(fullPath);
    return name.endsWith('.json') ? [fullPath] : [];
  });
}

describe('evaOS agent presentation', () => {
  it('keeps internal backend keys stable while presenting evaOS names', () => {
    expect(getEvaosAgentDisplayName(agent('openclaw-gateway', 'OpenClaw', 'openclaw-gateway'))).toBe('evaOS');
    expect(getEvaosAgentDisplayName(agent('aionrs', 'Aion CLI', 'aionrs'))).toBe('Custom');
    expect(getEvaosAgentDisplayName(agent('acp', 'Hermes', 'hermes'))).toBe('Hermes');
  });

  it('orders evaOS first, Hermes second, detected third-party agents next, and Custom last', () => {
    const ordered = sortEvaosDetectedAgentsForPresentation([
      agent('aionrs', 'Aion CLI', 'aionrs'),
      agent('acp', 'Codex CLI', 'codex'),
      agent('acp', 'Hermes', 'hermes'),
      agent('openclaw-gateway', 'OpenClaw', 'openclaw-gateway'),
      agent('acp', 'Claude Code', 'claude'),
    ]);

    expect(ordered.map((candidate) => candidate.backend ?? candidate.agent_type)).toEqual([
      'openclaw-gateway',
      'hermes',
      'codex',
      'claude',
      'aionrs',
    ]);
  });

  it('keeps default theme presentation owned by evaOS beta', () => {
    const defaultTheme = PRESET_THEMES.find((theme) => theme.id === 'default-theme');

    expect(defaultTheme?.name).toBe('evaOS Default');
    expect(defaultTheme?.name).not.toMatch(/AionUi|Aion CLI/i);
  });

  it('does not expose upstream Aion branding in visible locale copy', () => {
    const localeDir = path.join(process.cwd(), 'packages/desktop/src/renderer/services/i18n/locales');
    const upstreamBranding = /AionUi|AionUI|AionHub|AionCore|Aion CLI|CLI do Aion|aionui\.com/i;

    for (const localeFile of collectJsonFiles(localeDir)) {
      const values = collectJsonStringValues(JSON.parse(readFileSync(localeFile, 'utf8')));

      for (const value of values) {
        expect(value, localeFile).not.toMatch(upstreamBranding);
      }
    }
  });

  it('does not send DingTalk setup help to upstream AionUi docs', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'packages/desktop/src/renderer/components/settings/SettingsModal/contents/channels/DingTalkConfigForm.tsx'
      ),
      'utf8'
    );

    expect(source).not.toContain('github.com/iOfficeAI/AionUi');
  });

  it('keeps evaOS runtime pages free of visible upstream shell branding', () => {
    const visibleRuntimeSources = [
      'packages/desktop/src/renderer/pages/terminal/index.tsx',
      'packages/desktop/src/renderer/pages/runtime-dashboard/RuntimeDashboardPage.tsx',
    ];

    for (const relativePath of visibleRuntimeSources) {
      const source = readFileSync(path.join(process.cwd(), relativePath), 'utf8');

      expect(source, relativePath).not.toMatch(/AionUi does not|AionUi owns|AionUi shell/i);
    }
  });
});
