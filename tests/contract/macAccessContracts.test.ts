import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  accessStateSchema,
  accessTransitionSchema,
  auditEventSchema,
  authenticatedLocalActionSchema,
  brokerControlEnvelopeSchema,
  localStatusSchema,
  negativeFixtureCaseSchema,
} from '../../packages/mac-connector-core/contracts/v1';

const contractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../packages/mac-connector-core/contracts/v1'
);
const validRoot = path.join(contractRoot, 'fixtures/valid');
const invalidRoot = path.join(contractRoot, 'fixtures/invalid');

const schemas = {
  access_state: accessStateSchema,
  access_transition: accessTransitionSchema,
  local_status: localStatusSchema,
  authenticated_local_action: authenticatedLocalActionSchema,
  broker_control: brokerControlEnvelopeSchema,
  audit_event: auditEventSchema,
} as const;

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function applyMutation(
  target: unknown,
  mutation: { operation?: 'set' | 'remove'; pointer?: string; value?: unknown }
): void {
  if (!mutation.operation || !mutation.pointer) {
    throw new Error('Fixture mutation is missing its operation or pointer');
  }
  const parts = mutation.pointer
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (!target || typeof target !== 'object' || parts.length === 0) {
    throw new Error(`Cannot apply fixture mutation ${mutation.pointer}`);
  }
  let current = target as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      throw new Error(`Fixture mutation parent does not exist: ${mutation.pointer}`);
    }
    current = next as Record<string, unknown>;
  }
  const key = parts.at(-1)!;
  if (mutation.operation === 'remove') {
    delete current[key];
  } else {
    current[key] = mutation.value;
  }
}

const negativeFixtures = fs
  .readdirSync(invalidRoot)
  .filter((name) => name.endsWith('.json'))
  .flatMap((manifestName) => {
    const manifestPath = path.join(invalidRoot, manifestName);
    const cases = readJson(manifestPath);
    if (!Array.isArray(cases)) throw new Error(`Negative fixture manifest must be an array: ${manifestPath}`);
    return cases.map((rawCase) => ({ manifestPath, fixture: negativeFixtureCaseSchema.parse(rawCase) }));
  });

const expectedIssuePathByError: Record<string, string> = {
  execution_context_binding_mismatch: 'execution_context/claims',
  selected_device_mismatch: 'authorization/payload',
  selected_grant_mismatch: 'authorization/payload',
  selected_runtime_mismatch: 'execution_context/claims',
  connector_installation_mismatch: 'authorization/payload',
  connector_key_mismatch: 'authorization/payload',
  peer_designated_requirement_mismatch: 'peer/signing_identifier',
  leader_runtime_mismatch: 'leader/runtime_instance_id',
  helper_identity_mismatch: 'leader/helper_service_id',
  stop_pending_authority_not_invalidated: 'event',
  rollback_authorization_id_mismatch: 'relay_authorization/rollback_authorization',
  rollback_target_mismatch: 'relay_authorization/rollback_authorization/payload/target',
  rollback_authorization_expired: 'relay_authorization/rollback_authorization/payload/expires_at',
  full_access_reconfirmation_required: 'effective_mode',
  audit_forbidden_field: 'evidence',
  unsupported_schema: 'schema_version',
  audit_failure_not_off: 'audit/writable',
  effective_mode_exceeds_configured_mode: 'effective_mode',
  tcc_loss_not_off: 'tcc',
  connected_channel_missing: 'transport/channel_id',
  pairing_epoch_required: 'request/expected_policy_epoch',
  audit_evidence_not_allowlisted: 'evidence',
  audit_secret_bearing_value: 'evidence/detail_code',
  audit_previous_digest_required: 'previous_record_sha256',
  build_below_security_floor: 'leader/build/security_epoch',
  pairing_must_default_to_ask_every_time: 'event',
  full_access_policy_epoch_mismatch: 'confirmed_policy_epoch',
  full_access_binding_mismatch: 'confirmed_binding_fingerprint_sha256',
  command_authority_too_long: 'expires_at',
  channel_generation_mismatch: 'authorization/payload',
  authority_outlives_execution_context: 'expires_at',
};

describe('evaOS Mac Access v1 contracts', () => {
  const validFixtures = [
    ['access_state', 'access-state.json'],
    ['access_state', 'full-access-state.json'],
    ['access_transition', 'access-transition.json'],
    ['access_transition', 'access-transition-stop.json'],
    ['local_status', 'local-status.json'],
    ['authenticated_local_action', 'local-action.json'],
    ['broker_control', 'broker-control.json'],
    ['audit_event', 'audit-event.json'],
  ] as const;

  it.each(validFixtures)('accepts the valid %s fixture', (contract, fileName) => {
    expect(schemas[contract].safeParse(readJson(path.join(validRoot, fileName))).success).toBe(true);
  });

  it('keeps every required adversarial threat in the versioned negative fixture set', () => {
    const requiredThreats = new Set([
      'replay',
      'stale_binding',
      'wrong_customer',
      'wrong_device',
      'duplicate_process',
      'local_untrusted_client',
      'stolen_pairing_code',
      'revoked_grant',
      'offline_broker',
      'helper_replacement',
      'downgrade',
      'crash_recovery',
      'request_tampering',
      'log_secret_exposure',
      'audit_unavailable',
    ]);
    const seen = new Set<string>();

    for (const { manifestPath, fixture } of negativeFixtures) {
      expect(seen.has(fixture.id)).toBe(false);
      seen.add(fixture.id);
      requiredThreats.delete(fixture.threat);

      const payload = cloneJson(readJson(path.resolve(path.dirname(manifestPath), fixture.base_fixture)));
      for (const mutation of fixture.mutations) applyMutation(payload, mutation);
      const parsed = schemas[fixture.contract].safeParse(payload);
      if (fixture.expected_stage === 'schema') {
        expect(parsed.success, fixture.id).toBe(false);
        if (parsed.success) throw new Error(`Expected schema rejection for ${fixture.id}`);
        const expectedPath = expectedIssuePathByError[fixture.expected_error];
        expect(expectedPath, `${fixture.id} must register a stable issue path`).toBeTruthy();
        expect(
          parsed.error.issues.some((issue) => issue.path.join('/') === expectedPath),
          `${fixture.id} must reject at ${expectedPath}; got ${parsed.error.issues
            .map((issue) => issue.path.join('/'))
            .join(', ')}`
        ).toBe(true);
      } else {
        expect(parsed.success, fixture.id).toBe(true);
        expect(fixture.required_runtime_rejection, fixture.id).toBeTruthy();
      }
    }

    expect([...requiredThreats]).toEqual([]);
  });

  for (const { fixture: runtimeFixture } of negativeFixtures.filter(
    (entry) => entry.fixture.expected_stage === 'runtime'
  )) {
    it.todo(`runtime rejection ${runtimeFixture.id} must return ${runtimeFixture.expected_error}`);
  }
});
