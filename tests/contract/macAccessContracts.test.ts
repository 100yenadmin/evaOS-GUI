import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CORE_HOST_OPERATIONS,
  accessStateSchema,
  accessTransitionSchema,
  auditEventSchema,
  authenticatedLocalActionSchema,
  brokerControlEnvelopeSchema,
  coreHostRequestSchema,
  coreHostResponseSchema,
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
  core_host_request: coreHostRequestSchema,
  core_host_response: coreHostResponseSchema,
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
  let current: unknown = target;
  for (const part of parts.slice(0, -1)) {
    const next = Array.isArray(current)
      ? current[Number.parseInt(part, 10)]
      : (current as Record<string, unknown>)[part];
    if (!next || typeof next !== 'object') {
      throw new Error(`Fixture mutation parent does not exist: ${mutation.pointer}`);
    }
    current = next;
  }
  const key = parts.at(-1)!;
  if (Array.isArray(current)) {
    const index = Number.parseInt(key, 10);
    if (mutation.operation === 'remove') current.splice(index, 1);
    else current[index] = mutation.value;
  } else {
    const record = current as Record<string, unknown>;
    if (mutation.operation === 'remove') delete record[key];
    else record[key] = mutation.value;
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
  peer_team_identifier_mismatch: 'peer/team_id',
  peer_designated_requirement_hash_mismatch: 'peer/designated_requirement_sha256',
  peer_designated_requirement_mismatch: 'peer/signing_identifier',
  leader_runtime_mismatch: 'leader/runtime_instance_id',
  helper_identity_mismatch: 'leader/helper_service_id',
  app_requirement_mismatch: 'leader/app_designated_requirement_sha256',
  helper_requirement_mismatch: 'leader/helper_designated_requirement_sha256',
  connector_requirement_mismatch: 'leader/connector_designated_requirement_sha256',
  stop_pending_authority_not_invalidated: 'event',
  destructive_transition_preserves_authority: 'event',
  rollback_authorization_id_mismatch: 'relay_authorization/rollback_authorization',
  rollback_target_mismatch: 'relay_authorization/rollback_authorization/payload/target',
  rollback_source_mismatch: 'relay_authorization/verified_pre_rollback_source',
  rollback_authorization_expired: 'relay_authorization/rollback_authorization/payload/expires_at',
  full_access_reconfirmation_required: 'effective_mode',
  audit_forbidden_field: 'evidence',
  unsupported_schema: 'schema_version',
  audit_failure_not_off: 'audit/writable',
  effective_mode_exceeds_configured_mode: 'effective_mode',
  tcc_loss_not_off: 'tcc',
  connected_channel_missing: 'transport/channel_id',
  grant_expiry_not_fail_closed: 'access/binding/grant_expires_at',
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
  host_operation_not_allowlisted: 'operation',
  host_counter_not_safe_integer: 'sequence',
  host_policy_epoch_not_safe_integer: 'policy_epoch',
  broker_sequence_not_safe_integer: 'sequence',
  authority_sequence_not_safe_integer: 'authorization/payload/sequence',
  status_policy_epoch_not_safe_integer: 'access/policy_epoch',
  audit_sequence_not_safe_integer: 'sequence',
  host_response_outcome_ambiguous: 'result',
};

describe('evaOS Mac Access v1 contracts', () => {
  const validFixtures = [
    ['access_state', 'access-state.json'],
    ['access_state', 'full-access-state.json'],
    ['access_transition', 'access-transition.json'],
    ['access_transition', 'access-transition-stop.json'],
    ['access_transition', 'access-transition-grant-expired.json'],
    ['local_status', 'local-status.json'],
    ['authenticated_local_action', 'local-action.json'],
    ['broker_control', 'broker-control.json'],
    ['audit_event', 'audit-event.json'],
    ['core_host_request', '../host/host-request.json'],
    ['core_host_response', '../host/host-response.json'],
  ] as const;

  it.each(validFixtures)('accepts the valid %s fixture', (contract, fileName) => {
    expect(schemas[contract].safeParse(readJson(path.join(validRoot, fileName))).success).toBe(true);
  });

  it('freezes the complete non-Electron connector-core host operation surface', () => {
    expect(CORE_HOST_OPERATIONS).toEqual([
      'status',
      'pair',
      'unpair',
      'connect',
      'disconnect',
      'set_access_mode',
      'dispatch_action',
      'audit_summary',
      'pause',
      'resume',
      'stop',
      'revoke',
      'activate_kill_switch',
      'shutdown',
    ]);

    const envelope = brokerControlEnvelopeSchema.parse(readJson(path.join(validRoot, 'broker-control.json')));
    const identity = {
      schema_version: 'evaos.mac_connector_core.host_request.v1',
      host_session_id: 'host-session-01',
      expected_policy_epoch: 7,
    };
    const reason = { reason_code: 'local_user_request' };
    const requests = [
      { ...identity, request_id: 'host-status', operation: 'status', expected_policy_epoch: null, sequence: 1 },
      {
        ...identity,
        request_id: 'host-pair',
        operation: 'pair',
        sequence: 2,
        pairing_code: 'ABC123',
        local_installation_nonce: 'bm9uY2U',
      },
      { ...identity, ...reason, request_id: 'host-unpair', operation: 'unpair', sequence: 3 },
      { ...identity, request_id: 'host-connect', operation: 'connect', sequence: 4, binding: envelope.binding },
      { ...identity, ...reason, request_id: 'host-disconnect', operation: 'disconnect', sequence: 5 },
      {
        ...identity,
        request_id: 'host-mode',
        operation: 'set_access_mode',
        sequence: 6,
        target_mode: 'ask_every_time',
      },
      { ...identity, request_id: 'host-dispatch', operation: 'dispatch_action', sequence: 7, envelope },
      {
        ...identity,
        request_id: 'host-audit',
        operation: 'audit_summary',
        sequence: 8,
        after_sequence: null,
        limit: 25,
      },
      { ...identity, ...reason, request_id: 'host-pause', operation: 'pause', sequence: 9 },
      { ...identity, ...reason, request_id: 'host-resume', operation: 'resume', sequence: 10 },
      { ...identity, ...reason, request_id: 'host-stop', operation: 'stop', sequence: 11 },
      { ...identity, ...reason, request_id: 'host-revoke', operation: 'revoke', sequence: 12 },
      { ...identity, ...reason, request_id: 'host-kill', operation: 'activate_kill_switch', sequence: 13 },
      { ...identity, ...reason, request_id: 'host-shutdown', operation: 'shutdown', sequence: 14 },
    ];

    for (const request of requests) expect(coreHostRequestSchema.safeParse(request).success).toBe(true);
  });

  it('rejects unsafe integers in every nested security counter exposed by the host DTOs', () => {
    const unsafeInteger = Number.MAX_SAFE_INTEGER + 1;
    const envelope = brokerControlEnvelopeSchema.parse(readJson(path.join(validRoot, 'broker-control.json')));
    const dispatchRequest = {
      schema_version: 'evaos.mac_connector_core.host_request.v1',
      request_id: 'host-dispatch-unsafe',
      host_session_id: 'host-session-01',
      sequence: 1,
      operation: 'dispatch_action',
      expected_policy_epoch: 7,
      envelope: cloneJson(envelope),
    };
    applyMutation(dispatchRequest, {
      operation: 'set',
      pointer: '/envelope/sequence',
      value: unsafeInteger,
    });
    const dispatchResult = coreHostRequestSchema.safeParse(dispatchRequest);
    expect(dispatchResult.success).toBe(false);
    if (!dispatchResult.success) {
      expect(dispatchResult.error.issues.some((issue) => issue.path.join('/') === 'envelope/sequence')).toBe(true);
    }

    const statusResponse = {
      schema_version: 'evaos.mac_connector_core.host_response.v1',
      request_id: 'host-status-unsafe',
      host_session_id: 'host-session-01',
      sequence: 2,
      operation: 'status',
      ok: true,
      policy_epoch: 7,
      result: { kind: 'status', status: cloneJson(readJson(path.join(validRoot, 'local-status.json'))) },
      error: null,
    };
    applyMutation(statusResponse, {
      operation: 'set',
      pointer: '/result/status/access/policy_epoch',
      value: unsafeInteger,
    });
    const statusResult = coreHostResponseSchema.safeParse(statusResponse);
    expect(statusResult.success).toBe(false);
    if (!statusResult.success) {
      expect(
        statusResult.error.issues.some((issue) => issue.path.join('/') === 'result/status/access/policy_epoch')
      ).toBe(true);
    }

    const auditResponse = {
      schema_version: 'evaos.mac_connector_core.host_response.v1',
      request_id: 'host-audit-unsafe',
      host_session_id: 'host-session-01',
      sequence: 3,
      operation: 'audit_summary',
      ok: true,
      policy_epoch: 7,
      result: {
        kind: 'audit_summary',
        events: [cloneJson(readJson(path.join(validRoot, 'audit-event.json')))],
        next_sequence: null,
      },
      error: null,
    };
    applyMutation(auditResponse, {
      operation: 'set',
      pointer: '/result/events/0/sequence',
      value: unsafeInteger,
    });
    const auditResult = coreHostResponseSchema.safeParse(auditResponse);
    expect(auditResult.success).toBe(false);
    if (!auditResult.success) {
      expect(auditResult.error.issues.some((issue) => issue.path.join('/') === 'result/events/0/sequence')).toBe(true);
    }
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
      'host_interface_escape',
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
