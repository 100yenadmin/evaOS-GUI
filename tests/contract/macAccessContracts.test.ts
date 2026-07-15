import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import canonicalize from 'canonicalize';
import { describe, expect, it } from 'vitest';

import {
  CORE_HOST_OPERATIONS,
  MAC_ACCESS_IDENTITIES,
  accessStateSchema,
  accessTransitionSchema,
  auditChainGoldenSchema,
  auditEventSchema,
  authenticatedLocalActionSchema,
  brokerControlEnvelopeSchema,
  coreHostExchangeSchema,
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

for (const requiredRoot of [contractRoot, validRoot, invalidRoot]) {
  if (!fs.existsSync(requiredRoot)) {
    throw new Error(`Mac Access contract fixture directory is missing: ${requiredRoot}`);
  }
}

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
  if (!fs.existsSync(filePath)) {
    throw new Error(`Mac Access contract fixture is missing: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rehashAuditEvent<T extends Record<string, unknown> & { record_sha256: string }>(event: T): T {
  const { record_sha256: _recordSha256, ...payload } = event;
  return {
    ...event,
    record_sha256: createHash('sha256').update(canonicalize(payload)!).digest('hex'),
  };
}

type LifecycleResponseFixture = {
  schema_version: string;
  request_id: string;
  host_session_id: string;
  sequence: number;
  operation: string;
  ok: boolean;
  policy_epoch: number;
  result: {
    kind: 'lifecycle';
    configured_mode: 'off' | 'ask_every_time' | 'full_access';
    effective_mode: 'off' | 'ask_every_time' | 'full_access';
    requested_target_mode: 'off' | 'ask_every_time' | 'full_access' | null;
    pairing_state: 'unpaired' | 'paired' | 'revoked';
    transport_state: 'disconnected' | 'connecting' | 'connected' | 'revoked' | 'blocked';
    selected_binding: Record<string, unknown> | null;
  };
  error: { code: string; audit_id: string | null } | null;
};

function readLifecycleResponseFixture(): LifecycleResponseFixture {
  const response = cloneJson(
    coreHostResponseSchema.parse(readJson(path.join(contractRoot, 'fixtures/host/host-response.json')))
  );
  if (response.result?.kind !== 'lifecycle') throw new Error('Expected lifecycle response fixture');
  return response as unknown as LifecycleResponseFixture;
}

function applyMutation(
  target: unknown,
  mutation: { operation?: 'set' | 'remove'; pointer?: string; value?: unknown }
): void {
  if (!mutation.operation || !mutation.pointer) {
    throw new Error('Fixture mutation is missing its operation or pointer');
  }
  if (mutation.operation === 'set' && !Object.hasOwn(mutation, 'value')) {
    throw new Error('Set fixture mutation is missing its value');
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

const EXPECTED_NEGATIVE_FIXTURE_IDS = [
  'audit-chain-gap',
  'audit-clipboard-field',
  'audit-screenshot-field',
  'audit-secret-bearing-value',
  'audit-write-failure',
  'authority-outlives-context',
  'begin-pairing-without-epoch',
  'configured-off-effective-ask',
  'connected-without-channel',
  'crash-restores-full-access',
  'duplicate-leader',
  'execution-context-payload-tampered',
  'expired-command',
  'expired-grant-remains-active',
  'expired-rollback-authorization',
  'failed-core-host-response-with-result',
  'failed-core-host-response-without-error',
  'forged-app-requirement',
  'forged-connector-requirement',
  'forged-helper-requirement',
  'forged-local-client-requirement',
  'full-access-stale-binding-confirmation',
  'full-access-stale-policy-confirmation',
  'grant-expiry-with-pending-authority',
  'helper-replacement',
  'kill-switch-with-pending-authority',
  'offline-broker-actuation',
  'pairing-directly-enables-full-access',
  'pause-with-pending-authority',
  'raw-secret-audit',
  'replayed-command',
  'replayed-core-host-sequence',
  'request-digest-mismatch',
  'revoke-with-pending-authority',
  'revoked-grant',
  'rollback-wrong-source',
  'rollback-wrong-target',
  'signed-downgrade-below-security-floor',
  'signed-payload-tampered-grant',
  'stale-binding-version',
  'stale-command-policy-epoch',
  'stale-core-host-session',
  'stale-rollback-authorization-id',
  'stolen-pairing-code',
  'stop-with-pending-authority',
  'tcc-denied-with-effective-access',
  'unknown-core-host-operation',
  'unsafe-audit-sequence',
  'unsafe-broker-envelope-sequence',
  'unsafe-command-authority-sequence',
  'unsafe-core-host-policy-epoch',
  'unsafe-core-host-sequence',
  'unsafe-status-policy-epoch',
  'unsupported-downgrade-schema',
  'untrusted-local-client',
  'wrong-channel-generation',
  'wrong-connector-key',
  'wrong-customer',
  'wrong-device',
  'wrong-grant',
  'wrong-installation',
  'wrong-runtime',
  'wrong-team-local-client',
] as const;

const EXPECTED_RUNTIME_PROOF_LEDGER = [
  ['execution-context-payload-tampered', 'execution_context_digest_or_signature_mismatch'],
  ['offline-broker-actuation', 'broker_authority_offline'],
  ['replayed-command', 'command_replayed'],
  ['replayed-core-host-sequence', 'host_sequence_replayed'],
  ['request-digest-mismatch', 'request_digest_mismatch'],
  ['revoked-grant', 'grant_revoked'],
  ['signed-payload-tampered-grant', 'command_authorization_digest_or_signature_mismatch'],
  ['stale-command-policy-epoch', 'command_policy_epoch_stale'],
  ['stale-core-host-session', 'host_session_mismatch'],
  ['stolen-pairing-code', 'pairing_code_reused_or_claimed'],
] as const;

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
  it('reports the exact missing fixture path before attempting to parse it', () => {
    const missingFixture = path.join(contractRoot, 'fixtures/valid/missing-contract-fixture.json');
    expect(() => readJson(missingFixture)).toThrow(`Mac Access contract fixture is missing: ${missingFixture}`);
  });

  const validFixtures = [
    ['access_state', 'state/access-state.json'],
    ['access_state', 'state/full-access-state.json'],
    ['access_transition', 'state/access-transition.json'],
    ['access_transition', 'state/access-transition-stop.json'],
    ['access_transition', 'state/access-transition-grant-expired.json'],
    ['local_status', 'state/local-status.json'],
    ['authenticated_local_action', 'authority/local-action.json'],
    ['authenticated_local_action', 'authority/begin-pairing-action.json'],
    ['broker_control', 'authority/broker-control.json'],
    ['audit_event', 'audit/audit-event.json'],
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

    const envelope = brokerControlEnvelopeSchema.parse(readJson(path.join(validRoot, 'authority/broker-control.json')));
    const identity = {
      schema_version: 'evaos.mac_connector_core.host_request.v1',
      host_session_id: 'host-session-01',
      expected_policy_epoch: 7,
    };
    const requests: unknown[] = [
      { ...identity, request_id: 'host-status', operation: 'status', expected_policy_epoch: null, sequence: 1 },
      {
        ...identity,
        request_id: 'host-pair',
        operation: 'pair',
        sequence: 2,
        pairing_code: 'ABC123',
        local_installation_nonce: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY',
      },
      { ...identity, request_id: 'host-unpair', operation: 'unpair', sequence: 3 },
      { ...identity, request_id: 'host-connect', operation: 'connect', sequence: 4, binding: envelope.binding },
      { ...identity, request_id: 'host-disconnect', operation: 'disconnect', sequence: 5 },
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
        after_cursor: null,
        limit: 25,
      },
      { ...identity, request_id: 'host-pause', operation: 'pause', sequence: 9 },
      { ...identity, request_id: 'host-resume', operation: 'resume', sequence: 10 },
      { ...identity, request_id: 'host-stop', operation: 'stop', sequence: 11 },
      { ...identity, request_id: 'host-revoke', operation: 'revoke', sequence: 12 },
      { ...identity, request_id: 'host-kill', operation: 'activate_kill_switch', sequence: 13 },
      { ...identity, request_id: 'host-shutdown', operation: 'shutdown', sequence: 14 },
    ];

    for (const request of requests) expect(coreHostRequestSchema.safeParse(request).success).toBe(true);
  });

  it('rejects unsafe integers in every nested security counter exposed by the host DTOs', () => {
    const unsafeInteger = Number.MAX_SAFE_INTEGER + 1;
    const envelope = brokerControlEnvelopeSchema.parse(readJson(path.join(validRoot, 'authority/broker-control.json')));
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

    const statusResponse: Record<string, unknown> = {
      schema_version: 'evaos.mac_connector_core.host_response.v1',
      request_id: 'host-status-unsafe',
      host_session_id: 'host-session-01',
      sequence: 2,
      operation: 'status',
      ok: true,
      policy_epoch: 7,
      result: { kind: 'status', status: cloneJson(readJson(path.join(validRoot, 'state/local-status.json'))) },
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

    const auditResponse: Record<string, unknown> = {
      schema_version: 'evaos.mac_connector_core.host_response.v1',
      request_id: 'host-audit-unsafe',
      host_session_id: 'host-session-01',
      sequence: 3,
      operation: 'audit_summary',
      ok: true,
      policy_epoch: 7,
      result: {
        kind: 'audit_summary',
        page_anchor: null,
        events: [cloneJson(readJson(path.join(validRoot, 'audit/audit-event.json')))],
        causal_decisions: [],
        next_cursor: {
          sequence: 1,
          record_sha256: 'a0cf9968470f3ae354e1ef68e7aa80ba34c7b0d715e3db4a07fca5cbe7b6ced9',
        },
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

  it('rejects connected transport after access is unpaired or revoked', () => {
    const status = cloneJson(readJson(path.join(validRoot, 'state/local-status.json'))) as {
      access: {
        pairing_state: string;
        configured_mode: string;
        effective_mode: string;
        binding: unknown;
      };
    };
    status.access.pairing_state = 'revoked';
    status.access.configured_mode = 'off';
    status.access.effective_mode = 'off';
    status.access.binding = null;

    const parsed = localStatusSchema.safeParse(status);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join('/') === 'transport/state')).toBe(true);
    }
  });

  it('keeps configured and effective access off while the kill switch is active', () => {
    const state = cloneJson(accessStateSchema.parse(readJson(path.join(validRoot, 'state/access-state.json'))));
    state.kill_switch = true;
    state.effective_mode = 'off';

    const parsed = accessStateSchema.safeParse(state);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join('/') === 'configured_mode')).toBe(true);
    }
  });

  it('rejects dispatch when the host epoch differs from the signed broker envelope', () => {
    const envelope = brokerControlEnvelopeSchema.parse(readJson(path.join(validRoot, 'authority/broker-control.json')));
    const parsed = coreHostRequestSchema.safeParse({
      schema_version: 'evaos.mac_connector_core.host_request.v1',
      request_id: 'host-dispatch-stale',
      host_session_id: 'host-session-01',
      sequence: 1,
      operation: 'dispatch_action',
      expected_policy_epoch: envelope.policy_epoch - 1,
      envelope,
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join('/') === 'expected_policy_epoch')).toBe(true);
    }
  });

  it('rejects command authority that shares the selected grant expiry boundary', () => {
    const envelope = cloneJson(
      brokerControlEnvelopeSchema.parse(readJson(path.join(validRoot, 'authority/broker-control.json')))
    );
    envelope.expires_at = envelope.binding.grant_expires_at;
    envelope.authorization.payload.expires_at = envelope.expires_at;

    const parsed = brokerControlEnvelopeSchema.safeParse(envelope);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join('/') === 'binding/grant_expires_at')).toBe(true);
    }
  });

  it('rejects silent binding replacement outside an explicit binding transition', () => {
    const transition = cloneJson(readJson(path.join(validRoot, 'state/access-transition-stop.json'))) as {
      to: {
        binding: {
          device_id: string;
          binding_fingerprint_sha256: string;
        };
      };
    };
    transition.to.binding.device_id = 'mac-02';
    transition.to.binding.binding_fingerprint_sha256 = '2'.repeat(64);

    const parsed = accessTransitionSchema.safeParse(transition);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join('/') === 'to/binding')).toBe(true);
    }
  });

  it('invalidates pending authority when access narrows from full access to ask every time', () => {
    const transition = cloneJson(readJson(path.join(validRoot, 'state/access-transition.json'))) as {
      event: string;
      explicit_user_consent: boolean;
      invalidated_pending_authority: boolean;
      safe_cancellation_requested: boolean;
      target_mode: string | null;
      from: { configured_mode: string; effective_mode: string };
      to: { configured_mode: string; effective_mode: string };
    };
    transition.event = 'set_mode';
    transition.explicit_user_consent = true;
    transition.invalidated_pending_authority = false;
    transition.safe_cancellation_requested = false;
    transition.target_mode = 'ask_every_time';
    transition.from.configured_mode = 'full_access';
    transition.from.effective_mode = 'full_access';
    transition.to.configured_mode = 'ask_every_time';
    transition.to.effective_mode = 'ask_every_time';

    const parsed = accessTransitionSchema.safeParse(transition);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join('/') === 'event')).toBe(true);
    }
  });

  it('rejects successful host responses whose operation outcome did not take effect', () => {
    const status = cloneJson(readJson(path.join(validRoot, 'state/local-status.json')));
    const envelope = brokerControlEnvelopeSchema.parse(readJson(path.join(validRoot, 'authority/broker-control.json')));
    const identity: Record<string, unknown> = {
      schema_version: 'evaos.mac_connector_core.host_response.v1',
      request_id: 'host-outcome-check',
      host_session_id: 'host-session-01',
      sequence: 1,
      ok: true,
      policy_epoch: 7,
      error: null,
    };
    const responses: Array<Record<string, unknown> & { operation: string; expectedPath: string }> = [
      {
        ...identity,
        operation: 'status',
        policy_epoch: 8,
        result: { kind: 'status', status },
        expectedPath: 'result/status/access/policy_epoch',
      },
      {
        ...identity,
        operation: 'pair',
        result: {
          kind: 'pairing',
          pairing_state: 'unpaired',
          device_id: null,
          binding_fingerprint_sha256: null,
        },
        expectedPath: 'result/pairing_state',
      },
      {
        ...identity,
        operation: 'unpair',
        result: {
          kind: 'pairing',
          pairing_state: 'paired',
          device_id: 'mac-01',
          binding_fingerprint_sha256: '1'.repeat(64),
        },
        expectedPath: 'result/pairing_state',
      },
      {
        ...identity,
        operation: 'connect',
        result: {
          kind: 'lifecycle',
          configured_mode: 'ask_every_time',
          effective_mode: 'ask_every_time',
          requested_target_mode: null,
          pairing_state: 'paired',
          transport_state: 'disconnected',
          selected_binding: envelope.binding,
        },
        expectedPath: 'result/transport_state',
      },
      {
        ...identity,
        operation: 'disconnect',
        result: {
          kind: 'lifecycle',
          configured_mode: 'ask_every_time',
          effective_mode: 'ask_every_time',
          requested_target_mode: null,
          pairing_state: 'paired',
          transport_state: 'connected',
          selected_binding: envelope.binding,
        },
        expectedPath: 'result/transport_state',
      },
    ];

    for (const response of responses) {
      const parsed = coreHostResponseSchema.safeParse(response);
      expect(parsed.success, response.operation).toBe(false);
      if (!parsed.success) {
        expect(
          parsed.error.issues.some((issue) => issue.path.join('/') === response.expectedPath),
          `${response.operation} must reject at ${response.expectedPath}`
        ).toBe(true);
      }
    }
  });

  it('rejects lifecycle barrier responses that report unsafe operation-specific state', () => {
    const base = cloneJson(readJson(path.join(contractRoot, 'fixtures/host/host-response.json'))) as {
      operation: string;
      result: {
        requested_target_mode: string | null;
        effective_mode: string;
        pairing_state: string;
        transport_state: string;
      };
    };
    const cases = [
      {
        operation: 'stop',
        effective_mode: 'full_access',
        pairing_state: 'paired',
        transport_state: 'connected',
        expectedPaths: ['result/effective_mode', 'result/transport_state'],
      },
      {
        operation: 'revoke',
        effective_mode: 'off',
        pairing_state: 'paired',
        transport_state: 'connected',
        expectedPaths: ['result/pairing_state'],
      },
      {
        operation: 'activate_kill_switch',
        effective_mode: 'off',
        pairing_state: 'paired',
        transport_state: 'connected',
        expectedPaths: ['result/transport_state'],
      },
    ];

    for (const testCase of cases) {
      const response = cloneJson(base);
      response.operation = testCase.operation;
      response.result.requested_target_mode = null;
      response.result.effective_mode = testCase.effective_mode;
      response.result.pairing_state = testCase.pairing_state;
      response.result.transport_state = testCase.transport_state;
      const parsed = coreHostResponseSchema.safeParse(response);
      expect(parsed.success, testCase.operation).toBe(false);
      if (!parsed.success) {
        for (const expectedPath of testCase.expectedPaths) {
          expect(
            parsed.error.issues.some((issue) => issue.path.join('/') === expectedPath),
            `${testCase.operation} must reject at ${expectedPath}`
          ).toBe(true);
        }
      }
    }
  });

  it('forces effective access off for every unavailable transport owner state', () => {
    for (const transportState of ['disconnected', 'connecting', 'revoked', 'blocked'] as const) {
      const status = cloneJson(localStatusSchema.parse(readJson(path.join(validRoot, 'state/local-status.json'))));
      status.transport.state = transportState;
      status.transport.channel_id = null;
      status.access.effective_mode = 'ask_every_time';
      if (transportState === 'revoked') {
        status.access.pairing_state = 'revoked';
        status.access.configured_mode = 'off';
        status.access.binding = null;
      }
      const parsed = localStatusSchema.safeParse(status);
      expect(parsed.success, transportState).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some((issue) => issue.path.join('/') === 'transport/state')).toBe(true);
      }
    }

    const status = cloneJson(localStatusSchema.parse(readJson(path.join(validRoot, 'state/local-status.json'))));
    applyMutation(status, {
      operation: 'set',
      pointer: '/transport/responsible_identity',
      value: MAC_ACCESS_IDENTITIES.connectorServiceId,
    });
    const parsed = localStatusSchema.safeParse(status);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join('/') === 'transport/responsible_identity')).toBe(true);
    }
  });

  it('forces access off while an audit anchor commit is pending', () => {
    const status = cloneJson(localStatusSchema.parse(readJson(path.join(validRoot, 'state/local-status.json'))));
    status.audit.anchor.pending_sequence = 2;
    status.audit.anchor.pending_audit_id = 'audit-02';
    status.audit.anchor.pending_record_sha256 = '8'.repeat(64);
    const parsed = localStatusSchema.safeParse(status);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join('/') === 'audit/anchor/pending_sequence')).toBe(true);
    }
  });

  it('binds successful access-mode responses to the exact request target', () => {
    const request = readJson(path.join(contractRoot, 'fixtures/host/host-request.json'));
    const response = readLifecycleResponseFixture();
    expect(coreHostExchangeSchema.safeParse({ request, response }).success).toBe(true);

    response.result.configured_mode = 'off';
    response.result.effective_mode = 'off';
    response.result.requested_target_mode = 'off';
    const mismatchedExchange = coreHostExchangeSchema.safeParse({ request, response });
    expect(mismatchedExchange.success).toBe(false);
    if (!mismatchedExchange.success) {
      expect(
        mismatchedExchange.error.issues.some(
          (issue) => issue.path.join('/') === 'response/result/requested_target_mode'
        )
      ).toBe(true);
    }

    response.result.configured_mode = 'ask_every_time';
    const inconsistentResponse = coreHostResponseSchema.safeParse(response);
    expect(inconsistentResponse.success).toBe(false);

    const staleEpochResponse = readLifecycleResponseFixture();
    staleEpochResponse.policy_epoch = 999;
    const staleEpochExchange = coreHostExchangeSchema.safeParse({ request, response: staleEpochResponse });
    expect(staleEpochExchange.success).toBe(false);
    if (!staleEpochExchange.success) {
      expect(staleEpochExchange.error.issues.some((issue) => issue.path.join('/') === 'response/policy_epoch')).toBe(
        true
      );
    }
  });

  it('rejects lifecycle receipts that exceed configured or pairing authority', () => {
    const exceedsConfigured = readLifecycleResponseFixture();
    exceedsConfigured.result.configured_mode = 'off';
    exceedsConfigured.result.requested_target_mode = 'off';
    exceedsConfigured.result.effective_mode = 'full_access';
    expect(coreHostResponseSchema.safeParse(exceedsConfigured).success).toBe(false);

    const unpairedConnected = readLifecycleResponseFixture();
    unpairedConnected.result.pairing_state = 'unpaired';
    expect(coreHostResponseSchema.safeParse(unpairedConnected).success).toBe(false);

    const pairedRevoked = readLifecycleResponseFixture();
    pairedRevoked.result.configured_mode = 'off';
    pairedRevoked.result.effective_mode = 'off';
    pairedRevoked.result.requested_target_mode = 'off';
    pairedRevoked.result.transport_state = 'revoked';
    expect(coreHostResponseSchema.safeParse(pairedRevoked).success).toBe(false);

    const unsafeKillReceipt = readLifecycleResponseFixture();
    unsafeKillReceipt.operation = 'activate_kill_switch';
    unsafeKillReceipt.result.configured_mode = 'full_access';
    unsafeKillReceipt.result.effective_mode = 'off';
    unsafeKillReceipt.result.requested_target_mode = null;
    unsafeKillReceipt.result.transport_state = 'blocked';
    const killReceipt = coreHostResponseSchema.safeParse(unsafeKillReceipt);
    expect(killReceipt.success).toBe(false);
    if (!killReceipt.success) {
      expect(killReceipt.error.issues.some((issue) => issue.path.join('/') === 'result/configured_mode')).toBe(true);
    }
  });

  it('binds policy-changing lifecycle receipts to one exact epoch advance', () => {
    const envelope = brokerControlEnvelopeSchema.parse(readJson(path.join(validRoot, 'authority/broker-control.json')));
    const cases = [
      { operation: 'pause', configured: 'ask_every_time', effective: 'off', pairing: 'paired', transport: 'connected' },
      {
        operation: 'resume',
        configured: 'ask_every_time',
        effective: 'ask_every_time',
        pairing: 'paired',
        transport: 'connected',
      },
      {
        operation: 'stop',
        configured: 'ask_every_time',
        effective: 'off',
        pairing: 'paired',
        transport: 'disconnected',
      },
      { operation: 'revoke', configured: 'off', effective: 'off', pairing: 'revoked', transport: 'revoked' },
      {
        operation: 'activate_kill_switch',
        configured: 'off',
        effective: 'off',
        pairing: 'paired',
        transport: 'blocked',
      },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const request = {
        schema_version: 'evaos.mac_connector_core.host_request.v1',
        request_id: `policy-lifecycle-${index}`,
        host_session_id: 'host-session-01',
        sequence: index + 1,
        operation: testCase.operation,
        expected_policy_epoch: 7,
      };
      const response: LifecycleResponseFixture = {
        schema_version: 'evaos.mac_connector_core.host_response.v1',
        request_id: request.request_id,
        host_session_id: request.host_session_id,
        sequence: request.sequence,
        operation: request.operation,
        ok: true,
        policy_epoch: 8,
        result: {
          kind: 'lifecycle',
          configured_mode: testCase.configured,
          effective_mode: testCase.effective,
          requested_target_mode: null,
          pairing_state: testCase.pairing,
          transport_state: testCase.transport,
          selected_binding: testCase.pairing === 'paired' ? envelope.binding : null,
        },
        error: null,
      };
      expect(coreHostExchangeSchema.safeParse({ request, response }).success, testCase.operation).toBe(true);
      response.policy_epoch = 999;
      expect(coreHostExchangeSchema.safeParse({ request, response }).success, testCase.operation).toBe(false);
    }
  });

  it('binds non-advancing lifecycle receipts to the exact expected epoch', () => {
    for (const [index, operation] of ['disconnect', 'shutdown'].entries()) {
      const request = {
        schema_version: 'evaos.mac_connector_core.host_request.v1',
        request_id: `non-advancing-lifecycle-${index}`,
        host_session_id: 'host-session-01',
        sequence: index + 1,
        operation,
        expected_policy_epoch: 7,
      };
      const response = readLifecycleResponseFixture();
      response.request_id = request.request_id;
      response.sequence = request.sequence;
      response.operation = request.operation;
      response.policy_epoch = request.expected_policy_epoch;
      response.result.effective_mode = 'off';
      response.result.requested_target_mode = null;
      response.result.transport_state = 'disconnected';
      expect(coreHostExchangeSchema.safeParse({ request, response }).success, operation).toBe(true);

      for (const policyEpoch of [request.expected_policy_epoch - 1, request.expected_policy_epoch + 1]) {
        const mismatched = cloneJson(response);
        mismatched.policy_epoch = policyEpoch;
        const parsed = coreHostExchangeSchema.safeParse({ request, response: mismatched });
        expect(parsed.success, `${operation}:${policyEpoch}`).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues.some((issue) => issue.path.join('/') === 'response/policy_epoch')).toBe(true);
        }
      }
    }
  });

  it('binds pairing receipts and connect receipts to the exact request authority', () => {
    const identity = {
      schema_version: 'evaos.mac_connector_core.host_request.v1',
      host_session_id: 'host-session-01',
      expected_policy_epoch: 7,
    } as const;
    const pairRequest = {
      ...identity,
      request_id: 'host-pair-authority',
      sequence: 1,
      operation: 'pair',
      pairing_code: 'ABC123',
      local_installation_nonce: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY',
    };
    const pairResponse = {
      schema_version: 'evaos.mac_connector_core.host_response.v1',
      request_id: pairRequest.request_id,
      host_session_id: pairRequest.host_session_id,
      sequence: pairRequest.sequence,
      operation: pairRequest.operation,
      ok: true,
      policy_epoch: 8,
      result: {
        kind: 'pairing',
        pairing_state: 'paired',
        device_id: 'mac-01',
        binding_fingerprint_sha256: '1'.repeat(64),
      },
      error: null as { code: string; audit_id: string | null } | null,
    };
    expect(coreHostExchangeSchema.safeParse({ request: pairRequest, response: pairResponse }).success).toBe(true);

    const stalePairing = cloneJson(pairResponse);
    stalePairing.policy_epoch = 7;
    expect(coreHostExchangeSchema.safeParse({ request: pairRequest, response: stalePairing }).success).toBe(false);
    const skippedPairingEpoch = cloneJson(pairResponse);
    skippedPairingEpoch.policy_epoch = 9;
    expect(coreHostExchangeSchema.safeParse({ request: pairRequest, response: skippedPairingEpoch }).success).toBe(
      false
    );

    const unpairRequest = {
      schema_version: pairRequest.schema_version,
      request_id: 'host-unpair-authority',
      host_session_id: pairRequest.host_session_id,
      sequence: 2,
      operation: 'unpair',
      expected_policy_epoch: 8,
    };
    const unpairResponse = {
      ...cloneJson(pairResponse),
      request_id: unpairRequest.request_id,
      sequence: unpairRequest.sequence,
      operation: unpairRequest.operation,
      policy_epoch: 9,
      result: {
        kind: 'pairing',
        pairing_state: 'unpaired',
        device_id: null as string | null,
        binding_fingerprint_sha256: null as string | null,
      },
    };
    expect(coreHostExchangeSchema.safeParse({ request: unpairRequest, response: unpairResponse }).success).toBe(true);
    unpairResponse.policy_epoch = 8;
    expect(coreHostExchangeSchema.safeParse({ request: unpairRequest, response: unpairResponse }).success).toBe(false);

    const envelope = brokerControlEnvelopeSchema.parse(readJson(path.join(validRoot, 'authority/broker-control.json')));
    const connectRequest = {
      ...identity,
      request_id: 'host-connect-authority',
      sequence: 2,
      operation: 'connect',
      binding: envelope.binding,
    };
    const connectResponse = readLifecycleResponseFixture();
    connectResponse.request_id = connectRequest.request_id;
    connectResponse.sequence = connectRequest.sequence;
    connectResponse.operation = connectRequest.operation;
    connectResponse.policy_epoch = connectRequest.expected_policy_epoch;
    connectResponse.result.requested_target_mode = null;
    expect(coreHostExchangeSchema.safeParse({ request: connectRequest, response: connectResponse }).success).toBe(true);

    const bindingMismatches = [
      ['/result/selected_binding/customer_id', 'customer-02'],
      ['/result/selected_binding/customer_vm_id', 'vm-02'],
      ['/result/selected_binding/device_id', 'mac-02'],
      ['/result/selected_binding/grant_id', 'grant-02'],
      ['/result/selected_binding/runtime', 'hermes'],
      ['/result/selected_binding/binding_id', 'binding-02'],
      ['/result/selected_binding/binding_version', 'v4'],
      ['/result/selected_binding/grant_expires_at', '2026-07-15T08:59:59Z'],
      ['/result/selected_binding/connector_installation_id', 'install-02'],
      ['/result/selected_binding/connector_key_id', 'mac-key-02'],
      ['/result/selected_binding/binding_fingerprint_sha256', '2'.repeat(64)],
    ] as const;
    for (const [pointer, value] of bindingMismatches) {
      const mismatchedConnect = cloneJson(connectResponse);
      applyMutation(mismatchedConnect, { operation: 'set', pointer, value });
      expect(
        coreHostExchangeSchema.safeParse({ request: connectRequest, response: mismatchedConnect }).success,
        pointer
      ).toBe(false);
    }

    const missingConnectBinding = cloneJson(connectResponse);
    missingConnectBinding.result.selected_binding = null;
    expect(coreHostExchangeSchema.safeParse({ request: connectRequest, response: missingConnectBinding }).success).toBe(
      false
    );
  });

  it('rejects runtime identity drift outside restart and preserves configured intent', () => {
    const transition = cloneJson(
      accessTransitionSchema.parse(readJson(path.join(validRoot, 'state/access-transition-stop.json')))
    );
    transition.to.runtime_instance_id = 'runtime-instance-02';
    const drift = accessTransitionSchema.safeParse(transition);
    expect(drift.success).toBe(false);
    if (!drift.success) {
      expect(drift.error.issues.some((issue) => issue.path.join('/') === 'to/runtime_instance_id')).toBe(true);
    }

    const unsafeStop = cloneJson(
      accessTransitionSchema.parse(readJson(path.join(validRoot, 'state/access-transition-stop.json')))
    );
    unsafeStop.to.local_confirmation_required = false;
    const stop = accessTransitionSchema.safeParse(unsafeStop);
    expect(stop.success).toBe(false);
    if (!stop.success) expect(stop.error.issues.some((issue) => issue.path.join('/') === 'event')).toBe(true);

    const intentEscalation = cloneJson(
      accessTransitionSchema.parse(readJson(path.join(validRoot, 'state/access-transition-stop.json')))
    );
    intentEscalation.from.configured_mode = 'ask_every_time';
    intentEscalation.from.effective_mode = 'ask_every_time';
    intentEscalation.from.confirmed_runtime_instance_id = null;
    intentEscalation.from.confirmed_policy_epoch = null;
    intentEscalation.from.confirmed_binding_fingerprint_sha256 = null;
    intentEscalation.from.reason_code = 'pairing_confirmed';
    const escalated = accessTransitionSchema.safeParse(intentEscalation);
    expect(escalated.success).toBe(false);
    if (!escalated.success) {
      expect(escalated.error.issues.some((issue) => issue.path.join('/') === 'to/configured_mode')).toBe(true);
    }
  });

  it('preserves configured full-access intent through restart and resume while requiring reconfirmation', () => {
    const base = accessTransitionSchema.parse(readJson(path.join(validRoot, 'state/access-transition-stop.json')));
    const restart = cloneJson(base);
    restart.event = 'restart';
    restart.to.runtime_instance_id = 'runtime-instance-02';
    restart.to.effective_mode = 'ask_every_time';
    restart.to.reason_code = 'runtime_restart';
    expect(accessTransitionSchema.safeParse(restart).success).toBe(true);

    const restartMutation = cloneJson(restart);
    restartMutation.to.configured_mode = 'ask_every_time';
    restartMutation.to.local_confirmation_required = false;
    expect(accessTransitionSchema.safeParse(restartMutation).success).toBe(false);

    const resume = cloneJson(base);
    resume.event = 'resume';
    resume.invalidated_pending_authority = false;
    resume.safe_cancellation_requested = false;
    resume.from.effective_mode = 'off';
    resume.from.paused = true;
    resume.from.local_confirmation_required = true;
    resume.from.confirmed_runtime_instance_id = null;
    resume.from.confirmed_policy_epoch = null;
    resume.from.confirmed_binding_fingerprint_sha256 = null;
    resume.to.effective_mode = 'ask_every_time';
    resume.to.reason_code = 'local_resume';
    expect(accessTransitionSchema.safeParse(resume).success).toBe(true);

    const resumeMutation = cloneJson(resume);
    resumeMutation.to.configured_mode = 'ask_every_time';
    resumeMutation.to.local_confirmation_required = false;
    expect(accessTransitionSchema.safeParse(resumeMutation).success).toBe(false);
  });

  it('keeps an active kill switch effective off across restart', () => {
    const restart = cloneJson(
      accessTransitionSchema.parse(readJson(path.join(validRoot, 'state/access-transition-stop.json')))
    );
    restart.event = 'restart';
    restart.from.configured_mode = 'off';
    restart.from.effective_mode = 'off';
    restart.from.kill_switch = true;
    restart.from.local_confirmation_required = false;
    restart.from.confirmed_runtime_instance_id = null;
    restart.from.confirmed_policy_epoch = null;
    restart.from.confirmed_binding_fingerprint_sha256 = null;
    restart.to.runtime_instance_id = 'runtime-instance-02';
    restart.to.configured_mode = 'off';
    restart.to.kill_switch = true;
    restart.to.local_confirmation_required = false;
    restart.to.reason_code = 'runtime_restart';
    expect(accessTransitionSchema.safeParse(restart).success).toBe(true);
  });

  it('keeps configured full access effective off when restart preserves pause', () => {
    const restart = cloneJson(
      accessTransitionSchema.parse(readJson(path.join(validRoot, 'state/access-transition-stop.json')))
    );
    restart.event = 'restart';
    restart.from.effective_mode = 'off';
    restart.from.paused = true;
    restart.from.local_confirmation_required = true;
    restart.from.confirmed_runtime_instance_id = null;
    restart.from.confirmed_policy_epoch = null;
    restart.from.confirmed_binding_fingerprint_sha256 = null;
    restart.to.runtime_instance_id = 'runtime-instance-02';
    restart.to.paused = true;
    restart.to.reason_code = 'runtime_restart';
    expect(accessTransitionSchema.safeParse(restart).success).toBe(true);
  });

  it('keeps an active kill switch effective off when clearing pause', () => {
    const resume = cloneJson(
      accessTransitionSchema.parse(readJson(path.join(validRoot, 'state/access-transition-stop.json')))
    );
    resume.event = 'resume';
    resume.invalidated_pending_authority = false;
    resume.safe_cancellation_requested = false;
    resume.from.configured_mode = 'off';
    resume.from.effective_mode = 'off';
    resume.from.paused = true;
    resume.from.kill_switch = true;
    resume.from.local_confirmation_required = false;
    resume.from.confirmed_runtime_instance_id = null;
    resume.from.confirmed_policy_epoch = null;
    resume.from.confirmed_binding_fingerprint_sha256 = null;
    resume.to.configured_mode = 'off';
    resume.to.paused = false;
    resume.to.kill_switch = true;
    resume.to.local_confirmation_required = false;
    resume.to.reason_code = 'local_resume';
    expect(accessTransitionSchema.safeParse(resume).success).toBe(true);
  });

  it('preserves the pause barrier across unrelated mode transitions', () => {
    const base = accessTransitionSchema.parse(readJson(path.join(validRoot, 'state/access-transition-stop.json')));
    const pausedModeChange = cloneJson(base);
    pausedModeChange.event = 'set_mode';
    pausedModeChange.target_mode = 'ask_every_time';
    pausedModeChange.from.effective_mode = 'off';
    pausedModeChange.from.paused = true;
    pausedModeChange.from.local_confirmation_required = true;
    pausedModeChange.from.confirmed_runtime_instance_id = null;
    pausedModeChange.from.confirmed_policy_epoch = null;
    pausedModeChange.from.confirmed_binding_fingerprint_sha256 = null;
    pausedModeChange.to.configured_mode = 'ask_every_time';
    pausedModeChange.to.paused = true;
    pausedModeChange.to.local_confirmation_required = false;
    pausedModeChange.to.reason_code = 'local_mode_changed';
    expect(accessTransitionSchema.safeParse(pausedModeChange).success).toBe(true);

    const clearedPause = cloneJson(pausedModeChange);
    clearedPause.to.paused = false;
    clearedPause.to.effective_mode = 'ask_every_time';
    const pauseResult = accessTransitionSchema.safeParse(clearedPause);
    expect(pauseResult.success).toBe(false);
    if (!pauseResult.success) {
      expect(pauseResult.error.issues.some((issue) => issue.path.join('/') === 'to/paused')).toBe(true);
    }
  });

  it('preserves the kill-switch barrier across unrelated mode transitions', () => {
    const base = accessTransitionSchema.parse(readJson(path.join(validRoot, 'state/access-transition-stop.json')));
    const killedModeChange = cloneJson(base);
    killedModeChange.event = 'set_mode';
    killedModeChange.target_mode = 'off';
    killedModeChange.from.configured_mode = 'off';
    killedModeChange.from.effective_mode = 'off';
    killedModeChange.from.kill_switch = true;
    killedModeChange.from.local_confirmation_required = false;
    killedModeChange.from.confirmed_runtime_instance_id = null;
    killedModeChange.from.confirmed_policy_epoch = null;
    killedModeChange.from.confirmed_binding_fingerprint_sha256 = null;
    killedModeChange.to.configured_mode = 'off';
    killedModeChange.to.kill_switch = true;
    killedModeChange.to.local_confirmation_required = false;
    killedModeChange.to.reason_code = 'local_mode_changed';
    expect(accessTransitionSchema.safeParse(killedModeChange).success).toBe(true);

    const clearedKillSwitch = cloneJson(killedModeChange);
    clearedKillSwitch.target_mode = 'ask_every_time';
    clearedKillSwitch.to.configured_mode = 'ask_every_time';
    clearedKillSwitch.to.effective_mode = 'ask_every_time';
    clearedKillSwitch.to.kill_switch = false;
    const killResult = accessTransitionSchema.safeParse(clearedKillSwitch);
    expect(killResult.success).toBe(false);
    if (!killResult.success) {
      expect(killResult.error.issues.some((issue) => issue.path.join('/') === 'to/kill_switch')).toBe(true);
    }
  });

  it('makes the kill switch a fail-closed configured-off transition', () => {
    const base = accessTransitionSchema.parse(readJson(path.join(validRoot, 'state/access-transition-stop.json')));
    const killSwitch = cloneJson(base);
    killSwitch.event = 'kill_switch';
    killSwitch.to.configured_mode = 'off';
    killSwitch.to.kill_switch = true;
    killSwitch.to.local_confirmation_required = false;
    killSwitch.to.reason_code = 'local_kill_switch';
    expect(accessTransitionSchema.safeParse(killSwitch).success).toBe(true);

    const unsafeIntent = cloneJson(killSwitch);
    unsafeIntent.to.configured_mode = 'full_access';
    unsafeIntent.to.local_confirmation_required = true;
    expect(accessTransitionSchema.safeParse(unsafeIntent).success).toBe(false);
  });

  it('requires pairing code and installation nonce only for begin pairing', () => {
    const pairing = cloneJson(
      authenticatedLocalActionSchema.parse(readJson(path.join(validRoot, 'authority/begin-pairing-action.json')))
    );
    expect(authenticatedLocalActionSchema.safeParse(pairing).success).toBe(true);
    pairing.request.pairing_code = null;
    const missingCode = authenticatedLocalActionSchema.safeParse(pairing);
    expect(missingCode.success).toBe(false);
    if (!missingCode.success) {
      expect(missingCode.error.issues.some((issue) => issue.path.join('/') === 'request/pairing_code')).toBe(true);
    }
    pairing.request.pairing_code = 'ABC123';
    pairing.request.local_installation_nonce = null;
    const missingNonce = authenticatedLocalActionSchema.safeParse(pairing);
    expect(missingNonce.success).toBe(false);
    if (!missingNonce.success) {
      expect(
        missingNonce.error.issues.some((issue) => issue.path.join('/') === 'request/local_installation_nonce')
      ).toBe(true);
    }

    for (const invalidNonce of ['A', 'A'.repeat(44), `${'A'.repeat(42)}B`]) {
      pairing.request.local_installation_nonce = invalidNonce;
      expect(authenticatedLocalActionSchema.safeParse(pairing).success, invalidNonce.length.toString()).toBe(false);
    }

    const hostPair = {
      schema_version: 'evaos.mac_connector_core.host_request.v1',
      request_id: 'host-pair-nonce',
      host_session_id: 'host-session-01',
      sequence: 1,
      operation: 'pair',
      expected_policy_epoch: 7,
      pairing_code: 'ABC123',
      local_installation_nonce: 'A',
    };
    expect(coreHostRequestSchema.safeParse(hostPair).success).toBe(false);
    hostPair.local_installation_nonce = `${'A'.repeat(42)}B`;
    expect(coreHostRequestSchema.safeParse(hostPair).success).toBe(false);
  });

  it('uses unambiguous JSON fixture mutations', () => {
    const base = {
      id: 'mutation-shape',
      threat: 'fixture_integrity',
      contract: 'access_state',
      base_fixture: '../valid/state/access-state.json',
      expected_stage: 'schema',
      expected_error: 'fixture_integrity',
      required_runtime_rejection: null as string | null,
    };
    expect(
      negativeFixtureCaseSchema.safeParse({
        ...base,
        mutations: [{ operation: 'set', pointer: '/reason_code' }],
      }).success
    ).toBe(false);
    expect(
      negativeFixtureCaseSchema.safeParse({
        ...base,
        mutations: [{ operation: 'remove', pointer: '/reason_code', value: 'unexpected' }],
      }).success
    ).toBe(false);
  });

  it('requires closed redacted evidence and causal command audit records', () => {
    const event = cloneJson(auditEventSchema.parse(readJson(path.join(validRoot, 'audit/audit-event.json'))));
    event.command_id = null;
    event.request_digest_sha256 = null;
    const uncorrelated = auditEventSchema.safeParse(event);
    expect(uncorrelated.success).toBe(false);
    if (!uncorrelated.success) {
      expect(uncorrelated.error.issues.some((issue) => issue.path.join('/') === 'command_id')).toBe(true);
    }

    const unsafeEvidence = cloneJson(auditEventSchema.parse(readJson(path.join(validRoot, 'audit/audit-event.json'))));
    applyMutation(unsafeEvidence, {
      operation: 'set',
      pointer: '/evidence/target_path_hash',
      value: 'private-path',
    });
    expect(auditEventSchema.safeParse(unsafeEvidence).success).toBe(false);

    const unsafeReason = cloneJson(auditEventSchema.parse(readJson(path.join(validRoot, 'audit/audit-event.json'))));
    applyMutation(unsafeReason, {
      operation: 'set',
      pointer: '/reason_code',
      value: 'Bearer-secret-material',
    });
    expect(auditEventSchema.safeParse(unsafeReason).success).toBe(false);

    const invalidEvidenceCases = [
      ['/evidence/capability', 'customer_mac.desktop_unknown'],
      ['/evidence/state_from', 'private_state'],
      ['/evidence/transport_state', 'online'],
      ['/evidence/detail_code', 'custom_detail'],
      ['/evidence/schema_version', 'evaos.unknown.v99'],
      ['/evidence/build_version', 'build-secret'],
      ['/evidence/build_version', `1.2.3-${'a'.repeat(129)}`],
    ] as const;
    for (const [pointer, value] of invalidEvidenceCases) {
      const candidate = cloneJson(auditEventSchema.parse(readJson(path.join(validRoot, 'audit/audit-event.json'))));
      applyMutation(candidate, { operation: 'set', pointer, value });
      expect(auditEventSchema.safeParse(candidate).success, pointer).toBe(false);
    }

    const selfCausal = cloneJson(
      auditChainGoldenSchema.parse(readJson(path.join(validRoot, 'audit/audit-chain-golden.json'))).records[1].payload
    );
    selfCausal.causation_audit_id = selfCausal.audit_id;
    expect(auditEventSchema.safeParse({ ...selfCausal, record_sha256: '8'.repeat(64) }).success).toBe(false);
  });

  it('validates audit pages as cursor-bound contiguous digest chains', () => {
    const golden = auditChainGoldenSchema.parse(
      readJson(path.join(validRoot, 'audit/audit-chain-golden.json'))
    ) as unknown as {
      records: Array<{
        payload: Record<string, unknown> & { sequence: number; previous_record_sha256: string | null };
        record_sha256: string;
      }>;
    };
    const events = golden.records.map((record) =>
      Object.assign({}, record.payload, { record_sha256: record.record_sha256 })
    );
    const response = {
      schema_version: 'evaos.mac_connector_core.host_response.v1',
      request_id: 'host-audit-page',
      host_session_id: 'host-session-01',
      sequence: 1,
      operation: 'audit_summary',
      ok: true,
      policy_epoch: 7,
      result: {
        kind: 'audit_summary',
        page_anchor: null as { sequence: number; record_sha256: string } | null,
        events,
        causal_decisions: [] as typeof events,
        next_cursor: { sequence: events[1].sequence, record_sha256: events[1].record_sha256 },
      },
      error: null as { code: string; audit_id: string | null } | null,
    };
    expect(coreHostResponseSchema.safeParse(response).success).toBe(true);

    const reordered = cloneJson(response);
    reordered.result.events.reverse();
    expect(coreHostResponseSchema.safeParse(reordered).success).toBe(false);

    const tamperedRecord = cloneJson(response);
    tamperedRecord.result.events[0].outcome = 'denied';
    expect(coreHostResponseSchema.safeParse(tamperedRecord).success).toBe(false);

    const continuation = cloneJson(response);
    continuation.result.page_anchor = { sequence: events[0].sequence, record_sha256: events[0].record_sha256 };
    continuation.result.events = [events[1]];
    continuation.result.causal_decisions = [events[0]];
    expect(coreHostResponseSchema.safeParse(continuation).success).toBe(true);

    const reorderedCursorRequest = {
      schema_version: 'evaos.mac_connector_core.host_request.v1',
      request_id: continuation.request_id,
      host_session_id: continuation.host_session_id,
      sequence: continuation.sequence,
      operation: 'audit_summary',
      expected_policy_epoch: continuation.policy_epoch,
      after_cursor: {
        record_sha256: continuation.result.page_anchor.record_sha256,
        sequence: continuation.result.page_anchor.sequence,
      },
      limit: 25,
    };
    expect(coreHostExchangeSchema.safeParse({ request: reorderedCursorRequest, response: continuation }).success).toBe(
      true
    );

    for (const policyEpoch of [
      reorderedCursorRequest.expected_policy_epoch - 1,
      reorderedCursorRequest.expected_policy_epoch + 1,
    ]) {
      const mismatchedAuditEpoch = cloneJson(continuation);
      mismatchedAuditEpoch.policy_epoch = policyEpoch;
      const epochResult = coreHostExchangeSchema.safeParse({
        request: reorderedCursorRequest,
        response: mismatchedAuditEpoch,
      });
      expect(epochResult.success, policyEpoch.toString()).toBe(false);
      if (!epochResult.success) {
        expect(epochResult.error.issues.some((issue) => issue.path.join('/') === 'response/policy_epoch')).toBe(true);
      }
    }

    const fullPageRequest = {
      ...reorderedCursorRequest,
      after_cursor: null as { record_sha256: string; sequence: number } | null,
      limit: 2,
    };
    expect(coreHostExchangeSchema.safeParse({ request: fullPageRequest, response }).success).toBe(true);
    const undersizedPageRequest = { ...fullPageRequest, limit: 1 };
    const oversizedPage = coreHostExchangeSchema.safeParse({ request: undersizedPageRequest, response });
    expect(oversizedPage.success).toBe(false);
    if (!oversizedPage.success) {
      expect(oversizedPage.error.issues.some((issue) => issue.path.join('/') === 'response/result/events')).toBe(true);
    }

    for (const afterCursor of [
      null,
      {
        sequence: continuation.result.page_anchor.sequence + 1,
        record_sha256: continuation.result.page_anchor.record_sha256,
      },
      { sequence: continuation.result.page_anchor.sequence, record_sha256: 'f'.repeat(64) },
    ]) {
      const mismatchedCursorRequest = { ...reorderedCursorRequest, after_cursor: afterCursor };
      expect(
        coreHostExchangeSchema.safeParse({ request: mismatchedCursorRequest, response: continuation }).success
      ).toBe(false);
    }

    const wrongDecision = cloneJson(continuation);
    wrongDecision.result.causal_decisions[0].command_id = 'unrelated-command';
    expect(coreHostResponseSchema.safeParse(wrongDecision).success).toBe(false);

    const foreignDecision = cloneJson(continuation);
    const foreignDecisionRecord = cloneJson(events[0]);
    foreignDecisionRecord.occurred_at = '2026-07-14T12:00:02Z';
    const { record_sha256: _foreignDigest, ...foreignDecisionPayload } = foreignDecisionRecord;
    foreignDecisionRecord.record_sha256 = createHash('sha256')
      .update(canonicalize(foreignDecisionPayload)!)
      .digest('hex');
    foreignDecision.result.causal_decisions = [foreignDecisionRecord];
    expect(coreHostResponseSchema.safeParse(foreignDecision).success).toBe(false);

    const hiddenSuffix = cloneJson(response);
    hiddenSuffix.result.next_cursor = null;
    expect(coreHostResponseSchema.safeParse(hiddenSuffix).success).toBe(false);

    continuation.result.page_anchor.record_sha256 = 'f'.repeat(64);
    expect(coreHostResponseSchema.safeParse(continuation).success).toBe(false);
  });

  it('binds action receipts to the exact signed dispatch envelope and distinct audits', () => {
    const envelope = brokerControlEnvelopeSchema.parse(readJson(path.join(validRoot, 'authority/broker-control.json')));
    const auditGolden = auditChainGoldenSchema.parse(readJson(path.join(validRoot, 'audit/audit-chain-golden.json')));
    const [decisionRecord, resultRecord] = auditGolden.records;
    const decisionAudit = { ...decisionRecord.payload, record_sha256: decisionRecord.record_sha256 };
    const resultAudit = { ...resultRecord.payload, record_sha256: resultRecord.record_sha256 };
    const request = {
      schema_version: 'evaos.mac_connector_core.host_request.v1',
      request_id: 'host-dispatch-receipt',
      host_session_id: 'host-session-01',
      sequence: 1,
      operation: 'dispatch_action',
      expected_policy_epoch: envelope.policy_epoch,
      envelope,
    };
    const response = {
      schema_version: 'evaos.mac_connector_core.host_response.v1',
      request_id: request.request_id,
      host_session_id: request.host_session_id,
      sequence: request.sequence,
      operation: request.operation,
      ok: true,
      policy_epoch: request.expected_policy_epoch,
      result: {
        kind: 'action',
        command_id: envelope.command_id,
        request_digest_sha256: envelope.command.request_digest_sha256,
        outcome: 'executed',
        decision_audit_id: decisionAudit.audit_id,
        result_audit_id: resultAudit.audit_id,
        decision_audit: decisionAudit,
        result_audit: resultAudit,
      },
      error: null as { code: string; audit_id: string | null } | null,
    };
    expect(coreHostExchangeSchema.safeParse({ request, response }).success).toBe(true);

    const standaloneAuditMismatch = cloneJson(response);
    standaloneAuditMismatch.result.command_id = 'unrelated-command';
    expect(coreHostResponseSchema.safeParse(standaloneAuditMismatch).success).toBe(false);

    const standaloneDigestMismatch = cloneJson(response);
    standaloneDigestMismatch.result.request_digest_sha256 = '2'.repeat(64);
    expect(coreHostResponseSchema.safeParse(standaloneDigestMismatch).success).toBe(false);

    const standaloneResultBindingMismatch = cloneJson(response);
    standaloneResultBindingMismatch.result.result_audit = rehashAuditEvent({
      ...standaloneResultBindingMismatch.result.result_audit!,
      binding_fingerprint_sha256: '2'.repeat(64),
    });
    expect(coreHostResponseSchema.safeParse(standaloneResultBindingMismatch).success).toBe(false);

    const wrongCommand = cloneJson(response);
    wrongCommand.result.command_id = 'unrelated-command';
    expect(coreHostExchangeSchema.safeParse({ request, response: wrongCommand }).success).toBe(false);

    const reusedAudit = cloneJson(response);
    reusedAudit.result.result_audit_id = reusedAudit.result.decision_audit_id;
    expect(coreHostExchangeSchema.safeParse({ request, response: reusedAudit }).success).toBe(false);

    const arbitraryAudits = cloneJson(response);
    arbitraryAudits.result.decision_audit_id = 'unrelated-decision';
    arbitraryAudits.result.result_audit_id = 'unrelated-result';
    expect(coreHostExchangeSchema.safeParse({ request, response: arbitraryAudits }).success).toBe(false);
  });

  it('rejects resume responses that silently restore full access', () => {
    const response = readLifecycleResponseFixture();
    response.operation = 'resume';
    response.result.configured_mode = 'full_access';
    response.result.effective_mode = 'full_access';
    response.result.requested_target_mode = null;
    const parsed = coreHostResponseSchema.safeParse(response);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join('/') === 'result/effective_mode')).toBe(true);
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
    expect([...seen].toSorted()).toEqual(EXPECTED_NEGATIVE_FIXTURE_IDS);
  });

  it('freezes the downstream runtime-rejection proof ledger without claiming A0 execution', () => {
    const runtimeProofLedger = negativeFixtures
      .filter((entry) => entry.fixture.expected_stage === 'runtime')
      .map(({ fixture }) => {
        expect(fixture.required_runtime_rejection, fixture.id).toBeTruthy();
        return [fixture.id, fixture.expected_error] as const;
      })
      .toSorted(([left], [right]) => left.localeCompare(right));

    expect(runtimeProofLedger).toEqual(EXPECTED_RUNTIME_PROOF_LEDGER);
  });
});
