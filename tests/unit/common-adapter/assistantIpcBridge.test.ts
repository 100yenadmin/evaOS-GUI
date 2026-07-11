import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platformMock = vi.hoisted(() => ({
  buildProvider: vi.fn(() => ({ provider: vi.fn(), invoke: vi.fn() })),
  buildEmitter: vi.fn(() => ({ emit: vi.fn(), on: vi.fn() })),
}));

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildEmitter: platformMock.buildEmitter,
    buildProvider: platformMock.buildProvider,
  },
}));

const canonicalAssistant = {
  id: 'cowork',
  source: 'builtin',
  name: 'Cowork',
  name_i18n: {},
  description_i18n: {},
  enabled: true,
  sort_order: 1000,
  agent_id: 'agent-claude-row',
  agent: { type: 'acp', source: 'builtin', acp_backend: 'claude' },
  enabled_skills: [],
  custom_skill_names: [],
  disabled_builtin_skills: [],
  context_i18n: {},
  prompts: [],
  prompts_i18n: {},
  models: [],
  agent_status: 'online',
  team_selectable: true,
  deletable: false,
};

describe('assistant IPC bridge contract', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('maps canonical list responses to the current renderer compatibility shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [canonicalAssistant] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const { assistants } = await import('@/common/adapter/ipcBridge');
    const result = await assistants.list.invoke();

    expect(result[0]).toMatchObject({
      agent_id: 'agent-claude-row',
      preset_agent_type: 'claude',
    });
  });

  it('sends only canonical update fields and maps the response', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: canonicalAssistant }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchSpy);

    const { assistants } = await import('@/common/adapter/ipcBridge');
    const result = await assistants.update.invoke({
      id: 'cowork',
      preset_agent_type: 'agent-claude-row',
    });

    expect(fetchSpy.mock.calls[0][0]).toContain('/api/assistants/cowork');
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('PUT');
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({
      agent_id: 'agent-claude-row',
    });
    expect(result).toMatchObject({
      agent_id: 'agent-claude-row',
      preset_agent_type: 'claude',
    });
  });

  it('canonicalizes create and import payloads', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: canonicalAssistant }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { imported: 1, skipped: 0, failed: 0, errors: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    vi.stubGlobal('fetch', fetchSpy);

    const { assistants } = await import('@/common/adapter/ipcBridge');
    await assistants.create.invoke({ name: 'Mine', preset_agent_type: 'agent-claude-row' });
    await assistants.import.invoke({
      assistants: [{ id: 'legacy', name: 'Legacy', preset_agent_type: 'agent-claude-row' }],
    });

    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({
      name: 'Mine',
      agent_id: 'agent-claude-row',
    });
    expect(JSON.parse(String(fetchSpy.mock.calls[1][1]?.body))).toEqual({
      assistants: [{ id: 'legacy', name: 'Legacy', agent_id: 'agent-claude-row' }],
    });
  });
});
