import { describe, expect, it } from 'vitest';
import {
  EvaosBrokerSessionClient,
  EvaosBrokerSessionError,
  type EvaosBrokerFetch,
} from '@/process/services/evaosBrokerSession';

const activeSessionEnv = {
  AIONUI_EVAOS_DESKTOP_SESSION: 'eds_test_desktop_session_for_unit_123456',
  AIONUI_EVAOS_DESKTOP_SESSION_EMAIL: 'admin@100yen.org',
  AIONUI_EVAOS_DESKTOP_SESSION_EXPIRES_AT: '2099-01-01T00:00:00.000Z',
};

function clientForBrokerResponse(responseBody: unknown, status = 409): EvaosBrokerSessionClient {
  const fetchImpl: EvaosBrokerFetch = async () =>
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  return new EvaosBrokerSessionClient({
    env: activeSessionEnv,
    fetchImpl,
  });
}

describe('EvaosBrokerSessionClient broker errors', () => {
  it('surfaces safe backend denial copy from non-OK broker responses', async () => {
    const client = clientForBrokerResponse({
      error: 'Seat limit reached',
      backend_enforced: true,
    });

    const error = await client.customerTargets().catch((caught) => caught);

    expect(error).toBeInstanceOf(EvaosBrokerSessionError);
    expect(error).toMatchObject({
      code: 'broker_http_error',
      message: 'Seat limit reached',
      status: 409,
    });
  });

  it('keeps generic broker copy when the backend denial contains secret-shaped material', async () => {
    const client = clientForBrokerResponse({
      error: 'access_token=should-not-render',
      backend_enforced: true,
    });

    const error = await client.customerTargets().catch((caught) => caught);

    expect(error).toBeInstanceOf(EvaosBrokerSessionError);
    expect(error).toMatchObject({
      code: 'broker_http_error',
      message: 'The evaOS broker rejected the request.',
      status: 409,
    });
  });
});
