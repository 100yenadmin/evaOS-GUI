import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEAM_MODE_ENABLED } from '../../../packages/desktop/src/common/config/constants';
import { getFullAutoMode } from '../../../packages/desktop/src/common/types/agent/agentModes';
import {
  CODEX_MODE_NATIVE_DEFAULT,
  CODEX_MODE_NATIVE_FULL_ACCESS,
} from '../../../packages/desktop/src/common/types/codex/codexModes';
import { getAgentModes, mergeWithCapabilities } from '../../../packages/desktop/src/renderer/utils/model/agentModes';

const repoRoot = resolve(__dirname, '../../..');

describe('evaOS shell guardrails', () => {
  it('keeps team mode disabled by default for the public beta shell', () => {
    expect(TEAM_MODE_ENABLED).toBe(false);
  });

  it('filters full-auto and unrestricted modes from static and dynamic selectors', () => {
    expect(getAgentModes('aionrs').map((mode) => mode.value)).toEqual(['default', 'auto_edit']);
    expect(getAgentModes('claude').map((mode) => mode.value)).not.toContain('bypassPermissions');
    expect(getAgentModes('codex').map((mode) => mode.value)).not.toContain(CODEX_MODE_NATIVE_FULL_ACCESS);

    expect(mergeWithCapabilities('aionrs', ['default', 'auto_edit', 'yolo']).map((mode) => mode.value)).toEqual([
      'default',
      'auto_edit',
    ]);
  });

  it('maps scheduled full-auto requests to safe beta defaults', () => {
    expect(getFullAutoMode('aionrs')).toBe('default');
    expect(getFullAutoMode('claude')).toBe('default');
    expect(getFullAutoMode('codex')).toBe(CODEX_MODE_NATIVE_DEFAULT);
    expect(getFullAutoMode('opencode')).toBe('plan');
  });

  it('keeps team and insecure remote-agent UI surfaces fenced', () => {
    const sider = readFileSync(
      resolve(repoRoot, 'packages/desktop/src/renderer/components/layout/Sider/index.tsx'),
      'utf8'
    );
    const remoteAgents = readFileSync(
      resolve(repoRoot, 'packages/desktop/src/renderer/pages/settings/AgentSettings/RemoteAgentManagement.tsx'),
      'utf8'
    );

    expect(sider).toContain('TEAM_MODE_ENABLED ? (');
    expect(sider).toContain('<TeamSiderSection');
    expect(remoteAgents).toContain('EVAOS_BETA_REMOTE_AGENT_CONNECTIONS_ENABLED = false');
    expect(remoteAgents).toContain('EVAOS_BETA_REMOTE_AGENT_ALLOW_INSECURE = false');
    expect(remoteAgents).toContain('allow_insecure: false');
    expect(remoteAgents).toContain('betaDisabled');
    expect(remoteAgents).toContain('allowInsecureBetaDisabled');
  });
});
