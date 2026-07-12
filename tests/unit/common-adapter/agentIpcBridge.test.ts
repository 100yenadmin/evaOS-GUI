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

describe('agent IPC bridge contract', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('routes every catalog read through the AionCore v0.1.43 management endpoint', async () => {
    const fetchSpy = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchSpy);

    const { acpConversation } = await import('@/common/adapter/ipcBridge');
    await acpConversation.getAvailableAgents.invoke();
    await acpConversation.getManagedAgents.invoke();
    await acpConversation.getAssistantAgentCatalog.invoke();

    expect(
      fetchSpy.mock.calls.map(([url, init]) => ({
        method: init?.method,
        path: new URL(String(url)).pathname,
      }))
    ).toEqual([
      { method: 'GET', path: '/api/agents/management' },
      { method: 'GET', path: '/api/agents/management' },
      { method: 'GET', path: '/api/agents/management' },
    ]);
  });

  it('checks health by canonical management-row id and maps the status', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'claude-row',
            status: 'online',
            installed: true,
            last_check_latency_ms: 42,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchSpy);

    const { acpConversation } = await import('@/common/adapter/ipcBridge');
    const result = await acpConversation.checkAgentHealth.invoke({ id: 'claude-row' });

    expect({
      method: fetchSpy.mock.calls[0][1]?.method,
      path: new URL(String(fetchSpy.mock.calls[0][0])).pathname,
      result,
    }).toEqual({
      method: 'POST',
      path: '/api/agents/claude-row/health-check',
      result: { available: true, latency: 42, error: undefined },
    });
  });
});
