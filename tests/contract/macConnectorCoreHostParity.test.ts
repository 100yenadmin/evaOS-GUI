import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CORE_HOST_OPERATIONS, coreHostExchangeSchema } from '../../packages/mac-connector-core/contracts/v1';

describe('embedded Mac connector core host parity', () => {
  it('validates all fourteen live Python host exchanges with the TypeScript contract', () => {
    const python = process.env.EVAOS_CORE_TEST_PYTHON || 'python3';
    const script = path.join(process.cwd(), 'packages', 'mac-connector-core', 'tests', 'python', 'host_matrix.py');
    const exchanges = JSON.parse(
      execFileSync(python, ['-I', '-B', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          EVAOS_CORE_TEST_PYTHON: undefined,
          PYTHONHOME: undefined,
          PYTHONPATH: undefined,
          VIRTUAL_ENV: undefined,
        },
      })
    ) as unknown[];
    const parsed = exchanges.map((candidate) => coreHostExchangeSchema.parse(candidate));
    expect([...new Set(parsed.map((entry) => entry.request.operation))].toSorted()).toEqual(
      [...CORE_HOST_OPERATIONS].toSorted()
    );
    expect(
      parsed.some(
        (entry) =>
          entry.request.operation === 'dispatch_action' &&
          !entry.response.ok &&
          entry.response.error?.code === 'grant_expired' &&
          entry.response.policy_epoch === entry.request.expected_policy_epoch! + 1
      )
    ).toBe(true);
  });
});
