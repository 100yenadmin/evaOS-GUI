import { createHash } from 'node:crypto';

import canonicalize from 'canonicalize';
import { z } from 'zod';

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const base64Url = z
  .string()
  .min(1)
  .max(16_384)
  .regex(/^[A-Za-z0-9_-]+$/);
const installationNonce = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
const instant = z.string().datetime({ offset: true });
const safePositiveCounter = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const safeNonnegativeCounter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

function hasValidUnicode(value: unknown): boolean {
  if (typeof value === 'string') {
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
        index += 1;
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
    }
    return true;
  }
  if (Array.isArray(value)) return value.every(hasValidUnicode);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).every(([key, child]) => hasValidUnicode(key) && hasValidUnicode(child));
  }
  return true;
}

function canonicalJson(value: unknown): string | null {
  if (!hasValidUnicode(value)) return null;
  const serialized = canonicalize(value);
  return serialized ?? null;
}

function canonicalJsonSha256(value: unknown): string | null {
  const serialized = canonicalJson(value);
  return serialized === null ? null : createHash('sha256').update(serialized).digest('hex');
}

export const auditCursorSchema = z
  .object({
    sequence: safePositiveCounter,
    record_sha256: sha256,
  })
  .strict();

export const macControlCapabilitySchema = z.enum([
  'customer_mac.desktop_see',
  'customer_mac.desktop_click',
  'customer_mac.desktop_type',
  'customer_mac.desktop_set_value',
  'customer_mac.desktop_scroll',
  'customer_mac.desktop_drag',
  'customer_mac.desktop_hotkey',
  'customer_mac.desktop_focus_app',
  'customer_mac.desktop_window',
  'customer_mac.desktop_menu',
  'customer_mac.desktop_browser_action',
]);

const accessEvidenceStateSchema = z.enum([
  'unpaired',
  'paired',
  'revoked',
  'off',
  'ask_every_time',
  'full_access',
  'paused',
  'active',
  'kill_switch_active',
]);
const transportStateSchema = z.enum(['disconnected', 'connecting', 'connected', 'revoked', 'blocked']);
const auditReasonCodeSchema = z.enum([
  'approved_exact_scope',
  'denied_access_off',
  'denied_approval',
  'denied_audit_unhealthy',
  'denied_binding_mismatch',
  'denied_expired_authority',
  'denied_policy_epoch',
  'denied_replay',
  'denied_tcc',
  'denied_transport',
  'grant_expired',
  'local_full_access_confirmed',
  'local_kill_switch',
  'local_pause',
  'local_resume',
  'local_revoke',
  'local_stop',
  'pairing_confirmed',
  'pairing_failed',
  'runtime_restart',
]);
const auditDetailCodeSchema = z.enum([
  'actuation_cancelled',
  'actuation_failed',
  'actuation_succeeded',
  'anchor_mismatch',
  'anchor_unavailable',
  'approval_expired',
  'approval_rejected',
  'approval_satisfied',
  'audit_append_failed',
  'binding_mismatch',
  'command_expired',
  'command_replayed',
  'grant_expired',
  'policy_epoch_stale',
  'request_digest_mismatch',
  'tcc_unavailable',
  'transport_unavailable',
]);
const accessStateReasonCodeSchema = z.enum([
  'not_paired',
  'pairing_confirmed',
  'pairing_failed',
  'local_full_access_confirmed',
  'local_mode_changed',
  'local_pause',
  'local_resume',
  'local_stop',
  'local_revoke',
  'local_kill_switch',
  'runtime_restart',
  'tcc_lost',
  'audit_failed',
  'binding_changed',
  'grant_expired',
]);
const auditActorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local_user'), identity: z.literal('console_user') }).strict(),
  z.object({ kind: z.literal('workbench'), identity: z.literal('workbench_main') }).strict(),
  z.object({ kind: z.literal('broker_runtime'), identity: z.enum(['openclaw', 'hermes']) }).strict(),
  z
    .object({
      kind: z.literal('system'),
      identity: z.enum(['audit_subsystem', 'connector_core', 'policy_engine', 'updater']),
    })
    .strict(),
]);

export const MAC_ACCESS_IDENTITIES = {
  teamId: 'TC6MS3T6NN',
  appBundleId: 'com.evaos.mac-access',
  helperServiceId: 'com.evaos.mac-access.helper',
  connectorServiceId: 'com.evaos.mac-access.connector',
  appDesignatedRequirement:
    'anchor apple generic and certificate leaf[subject.OU] = "TC6MS3T6NN" and identifier "com.evaos.mac-access"',
  helperDesignatedRequirement:
    'anchor apple generic and certificate leaf[subject.OU] = "TC6MS3T6NN" and identifier "com.evaos.mac-access.helper"',
  connectorDesignatedRequirement:
    'anchor apple generic and certificate leaf[subject.OU] = "TC6MS3T6NN" and identifier "com.evaos.mac-access.connector"',
  workbenchDesignatedRequirement:
    'anchor apple generic and certificate leaf[subject.OU] = "TC6MS3T6NN" and identifier "com.evaos.workbench"',
  legacyWorkbenchDesignatedRequirement:
    'anchor apple generic and certificate leaf[subject.OU] = "TC6MS3T6NN" and identifier "com.electricsheephq.EvaDesktop"',
  appDesignatedRequirementSha256: 'da635352f249b4213aa1a96c41d7979d8b25d86b056b9f0929c1b414e35896fb',
  helperDesignatedRequirementSha256: '222107bb855cfc463805777c76ca8cfdac0d1145957c5f190c234e52bfd277aa',
  connectorDesignatedRequirementSha256: '0c3de778270de5b4a1992d0e13d4f27e41929c7ace94ae143bcba92a555be422',
  workbenchDesignatedRequirementSha256: 'ff4fc126bb70bbf7fcc3cc0957377d67185124b5e31b19760357333a8a0ae329',
  legacyWorkbenchDesignatedRequirementSha256: 'c6038eaf8a20c83a1aabfd1bf8eb4053877b7af5627e570eb1de37721e76b776',
  productionKeychainAccessGroupSuffix: 'com.evaos.mac-access.credentials',
  developmentKeychainAccessGroupSuffix: 'com.evaos.mac-access.development.credentials',
  connectorCredentialService: 'com.evaos.mac-access.connector-credential',
  auditAnchorAccessGroupSuffix: 'com.evaos.mac-access.audit-anchor',
  auditAnchorService: 'com.evaos.mac-access.audit-anchor',
} as const;

export const selectedBindingSchema = z
  .object({
    customer_id: identifier,
    customer_vm_id: identifier,
    device_id: identifier,
    grant_id: identifier,
    runtime: z.enum(['openclaw', 'hermes']),
    binding_id: identifier,
    binding_version: identifier,
    grant_expires_at: instant,
    connector_installation_id: identifier,
    connector_key_id: identifier,
    binding_fingerprint_sha256: sha256,
  })
  .strict();

function selectedBindingsEqual(
  left: z.infer<typeof selectedBindingSchema>,
  right: z.infer<typeof selectedBindingSchema>
): boolean {
  return (
    left.customer_id === right.customer_id &&
    left.customer_vm_id === right.customer_vm_id &&
    left.device_id === right.device_id &&
    left.grant_id === right.grant_id &&
    left.runtime === right.runtime &&
    left.binding_id === right.binding_id &&
    left.binding_version === right.binding_version &&
    left.grant_expires_at === right.grant_expires_at &&
    left.connector_installation_id === right.connector_installation_id &&
    left.connector_key_id === right.connector_key_id &&
    left.binding_fingerprint_sha256 === right.binding_fingerprint_sha256
  );
}

export const buildIdentitySchema = z
  .object({
    build_version: identifier,
    source_commit: z.string().regex(/^[a-f0-9]{40}$/),
    signed_lineage_id: identifier,
    security_epoch: safeNonnegativeCounter,
    schema_reader_version: safePositiveCounter,
    schema_writer_version: safePositiveCounter,
    rollback_authorization_id: identifier.nullable(),
  })
  .strict();

export const keychainCustodySchema = z
  .object({
    custodian_signing_identifier: z.literal(MAC_ACCESS_IDENTITIES.helperServiceId),
    access_group_suffix: z.string().regex(/^com\.evaos\.mac-access\.credentials\.epoch-[1-9][0-9]*$/),
    credential_security_epoch: safePositiveCounter,
    service: z.literal(MAC_ACCESS_IDENTITIES.connectorCredentialService),
    accessibility: z.literal('kSecAttrAccessibleWhenUnlockedThisDeviceOnly'),
    synchronizable: z.literal(false),
    exportable_private_key: z.literal(false),
  })
  .strict()
  .superRefine((custody, context) => {
    if (!custody.access_group_suffix.endsWith(`.epoch-${custody.credential_security_epoch}`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'production credential access group must match its security epoch',
        path: ['access_group_suffix'],
      });
    }
  });

export const auditAnchorSchema = z
  .object({
    schema_version: z.literal('evaos.mac_access.audit_anchor.v1'),
    custodian_signing_identifier: z.literal(MAC_ACCESS_IDENTITIES.helperServiceId),
    access_group_suffix: z.string().regex(/^com\.evaos\.mac-access\.audit-anchor\.epoch-[1-9][0-9]*$/),
    security_epoch: safePositiveCounter,
    service: z.literal(MAC_ACCESS_IDENTITIES.auditAnchorService),
    accessibility: z.literal('kSecAttrAccessibleWhenUnlockedThisDeviceOnly'),
    synchronizable: z.literal(false),
    journal_id: identifier,
    committed_sequence: safeNonnegativeCounter,
    committed_audit_id: identifier.nullable(),
    committed_record_sha256: sha256.nullable(),
    pending_sequence: safePositiveCounter.nullable(),
    pending_audit_id: identifier.nullable(),
    pending_record_sha256: sha256.nullable(),
  })
  .strict()
  .superRefine((anchor, context) => {
    if (!anchor.access_group_suffix.endsWith(`.epoch-${anchor.security_epoch}`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'audit anchor access group must match its security epoch',
        path: ['access_group_suffix'],
      });
    }
    const committedEmpty = anchor.committed_sequence === 0;
    if (
      committedEmpty !== (anchor.committed_audit_id === null) ||
      committedEmpty !== (anchor.committed_record_sha256 === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'committed audit anchor fields must be empty only at sequence zero',
        path: ['committed_sequence'],
      });
    }
    const pendingFields = [anchor.pending_sequence, anchor.pending_audit_id, anchor.pending_record_sha256];
    const hasPending = pendingFields.some((value) => value !== null);
    if (hasPending && pendingFields.some((value) => value === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pending audit anchor fields must be committed as one complete tuple',
        path: ['pending_sequence'],
      });
    }
    if (anchor.pending_sequence !== null && anchor.pending_sequence !== anchor.committed_sequence + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pending audit anchor must name exactly the next journal sequence',
        path: ['pending_sequence'],
      });
    }
  });

const rollbackBuildSchema = z
  .object({
    build_version: identifier,
    source_commit: z.string().regex(/^[a-f0-9]{40}$/),
    signed_lineage_id: identifier,
    security_epoch: safeNonnegativeCounter,
    credential_security_epoch: safePositiveCounter,
    schema_reader_version: safePositiveCounter,
    schema_writer_version: safePositiveCounter,
  })
  .strict();

export const rollbackAuthorizationPayloadSchema = z
  .object({
    schema_version: z.literal('evaos.mac_access.rollback_authorization_payload.v1'),
    domain: z.literal('evaos.mac-access/rollback-authorization/v1'),
    authorization_id: identifier,
    source: rollbackBuildSchema,
    target: rollbackBuildSchema,
    resulting_minimum_reader_security_epoch: safeNonnegativeCounter,
    resulting_minimum_writer_security_epoch: safeNonnegativeCounter,
    resulting_minimum_reader_schema_version: safePositiveCounter,
    resulting_minimum_writer_schema_version: safePositiveCounter,
    issued_at: instant,
    expires_at: instant,
  })
  .strict()
  .superRefine((authorization, context) => {
    if (Date.parse(authorization.expires_at) <= Date.parse(authorization.issued_at)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rollback authorization must expire after it is issued',
        path: ['expires_at'],
      });
    }
    if (
      authorization.source.build_version === authorization.target.build_version &&
      authorization.source.source_commit === authorization.target.source_commit &&
      authorization.source.security_epoch === authorization.target.security_epoch &&
      authorization.source.credential_security_epoch === authorization.target.credential_security_epoch
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rollback authorization must name distinct source and target builds',
        path: ['target'],
      });
    }
  });

export const signedRollbackAuthorizationSchema = z
  .object({
    schema_version: z.literal('evaos.mac_access.signed_rollback_authorization.v1'),
    canonicalization: z.literal('RFC8785-JCS'),
    payload: rollbackAuthorizationPayloadSchema,
    payload_sha256: sha256,
    broker_key_id: identifier,
    signature_base64url: base64Url,
  })
  .strict();

export const rollbackAuthorizationGoldenSchema = signedRollbackAuthorizationSchema.extend({
  canonical_payload_utf8: z.string().min(1).max(65_536),
  public_key_spki_base64url: base64Url,
});

export const executionContextClaimsSchema = z
  .object({
    schema_version: z.literal('evaos.mac_control_execution_context.v1'),
    key_id: identifier,
    runtime: z.enum(['openclaw', 'hermes']),
    customer_id: identifier,
    customer_vm_id: identifier,
    binding_id: identifier,
    binding_version: identifier,
    issued_at: safeNonnegativeCounter,
    expires_at: safePositiveCounter,
    context_id: base64Url,
  })
  .strict()
  .superRefine((claims, context) => {
    if (claims.expires_at <= claims.issued_at) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'execution context must expire after it is issued',
        path: ['expires_at'],
      });
    }
  });

export const authenticatedPeerSchema = z
  .object({
    verification: z.literal('verified_designated_requirement'),
    role: z.enum(['mac_access_menu', 'workbench_main']),
    team_id: z.literal(MAC_ACCESS_IDENTITIES.teamId),
    signing_identifier: z.enum(['com.evaos.mac-access', 'com.evaos.workbench', 'com.electricsheephq.EvaDesktop']),
    audit_token_sha256: sha256,
    designated_requirement_sha256: sha256,
  })
  .strict()
  .superRefine((peer, context) => {
    const macAccessPeer = peer.role === 'mac_access_menu' && peer.signing_identifier === 'com.evaos.mac-access';
    const workbenchPeer =
      peer.role === 'workbench_main' &&
      ['com.evaos.workbench', 'com.electricsheephq.EvaDesktop'].includes(peer.signing_identifier);
    if (!macAccessPeer && !workbenchPeer) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'peer role and verified signing identifier do not match',
        path: ['signing_identifier'],
      });
    }
    const requirementDigestByIdentifier = {
      'com.evaos.mac-access': MAC_ACCESS_IDENTITIES.appDesignatedRequirementSha256,
      'com.evaos.workbench': MAC_ACCESS_IDENTITIES.workbenchDesignatedRequirementSha256,
      'com.electricsheephq.EvaDesktop': MAC_ACCESS_IDENTITIES.legacyWorkbenchDesignatedRequirementSha256,
    } as const;
    if (peer.designated_requirement_sha256 !== requirementDigestByIdentifier[peer.signing_identifier]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'peer designated requirement digest is not in the frozen role allowlist',
        path: ['designated_requirement_sha256'],
      });
    }
  });

export const accessStateSchema = z
  .object({
    schema_version: z.literal('evaos.mac_access.access_state.v1'),
    runtime_instance_id: identifier,
    state_security_epoch: safeNonnegativeCounter,
    minimum_reader_security_epoch: safeNonnegativeCounter,
    minimum_writer_security_epoch: safeNonnegativeCounter,
    minimum_reader_schema_version: safePositiveCounter,
    minimum_writer_schema_version: safePositiveCounter,
    policy_epoch: safeNonnegativeCounter,
    pairing_state: z.enum(['unpaired', 'paired', 'revoked']),
    configured_mode: z.enum(['off', 'ask_every_time', 'full_access']),
    effective_mode: z.enum(['off', 'ask_every_time', 'full_access']),
    paused: z.boolean(),
    kill_switch: z.boolean(),
    local_confirmation_required: z.boolean(),
    confirmed_runtime_instance_id: identifier.nullable(),
    confirmed_policy_epoch: safeNonnegativeCounter.nullable(),
    confirmed_binding_fingerprint_sha256: sha256.nullable(),
    binding: selectedBindingSchema.nullable(),
    changed_at: instant,
    reason_code: accessStateReasonCodeSchema,
  })
  .strict()
  .superRefine((state, context) => {
    const modeRank = { off: 0, ask_every_time: 1, full_access: 2 } as const;
    const forceOff = state.pairing_state !== 'paired' || state.paused || state.kill_switch || state.binding === null;
    if (forceOff && state.effective_mode !== 'off') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unpaired, revoked, paused, killed, or unbound state must be effectively off',
        path: ['effective_mode'],
      });
    }
    if (state.pairing_state === 'paired' && state.binding === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'paired state requires a selected binding',
        path: ['binding'],
      });
    }
    if (state.pairing_state !== 'paired' && state.binding !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unpaired or revoked state cannot retain an active binding',
        path: ['binding'],
      });
    }
    if (state.pairing_state !== 'paired' && state.configured_mode !== 'off') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unpaired or revoked state must be configured off',
        path: ['configured_mode'],
      });
    }
    if (modeRank[state.effective_mode] > modeRank[state.configured_mode]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'effective access cannot exceed configured user intent',
        path: ['effective_mode'],
      });
    }
    if (
      state.state_security_epoch < state.minimum_reader_security_epoch ||
      state.state_security_epoch < state.minimum_writer_security_epoch
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'state security epoch is below its protected compatibility floor',
        path: ['state_security_epoch'],
      });
    }
    if (state.effective_mode === 'full_access') {
      if (state.configured_mode !== 'full_access' || state.local_confirmation_required) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'effective full access requires configured full access and local confirmation',
          path: ['effective_mode'],
        });
      }
      if (state.confirmed_runtime_instance_id !== state.runtime_instance_id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'full access confirmation must be bound to the current runtime instance',
          path: ['confirmed_runtime_instance_id'],
        });
      }
      if (state.confirmed_policy_epoch !== state.policy_epoch) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'full access confirmation must be bound to the current policy epoch',
          path: ['confirmed_policy_epoch'],
        });
      }
      if (state.confirmed_binding_fingerprint_sha256 !== state.binding?.binding_fingerprint_sha256) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'full access confirmation must be bound to the current selected binding',
          path: ['confirmed_binding_fingerprint_sha256'],
        });
      }
    } else if (
      state.confirmed_runtime_instance_id !== null ||
      state.confirmed_policy_epoch !== null ||
      state.confirmed_binding_fingerprint_sha256 !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'non-full-access state must clear full access confirmation',
        path: ['confirmed_runtime_instance_id'],
      });
    }
    if (state.local_confirmation_required && state.effective_mode === 'full_access') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'full access cannot remain effective while reconfirmation is required',
        path: ['local_confirmation_required'],
      });
    }
    if (state.local_confirmation_required && state.configured_mode !== 'full_access') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'reconfirmation is only meaningful for configured full access',
        path: ['local_confirmation_required'],
      });
    }
  });

export const localStatusSchema = z
  .object({
    schema_version: z.literal('evaos.mac_access.local_status.v1'),
    observed_at: instant,
    leader: z
      .object({
        runtime_instance_id: identifier,
        pid: z.number().int().positive(),
        app_bundle_id: z.literal(MAC_ACCESS_IDENTITIES.appBundleId),
        helper_service_id: z.literal(MAC_ACCESS_IDENTITIES.helperServiceId),
        connector_service_id: z.literal(MAC_ACCESS_IDENTITIES.connectorServiceId),
        team_id: z.literal(MAC_ACCESS_IDENTITIES.teamId),
        app_designated_requirement_sha256: z.literal(MAC_ACCESS_IDENTITIES.appDesignatedRequirementSha256),
        helper_designated_requirement_sha256: z.literal(MAC_ACCESS_IDENTITIES.helperDesignatedRequirementSha256),
        connector_designated_requirement_sha256: z.literal(MAC_ACCESS_IDENTITIES.connectorDesignatedRequirementSha256),
        build: buildIdentitySchema,
      })
      .strict(),
    keychain: keychainCustodySchema,
    relay_authorization: z
      .object({
        accepted_build_version: identifier,
        accepted_source_commit: z.string().regex(/^[a-f0-9]{40}$/),
        accepted_security_epoch: safePositiveCounter,
        credential_security_epoch: safePositiveCounter,
        verified_pre_rollback_source: rollbackBuildSchema.nullable(),
        rollback_authorization: signedRollbackAuthorizationSchema.nullable(),
      })
      .strict(),
    access: accessStateSchema,
    transport: z
      .object({
        responsible_identity: z.literal(MAC_ACCESS_IDENTITIES.helperServiceId),
        state: z.enum(['disconnected', 'connecting', 'connected', 'revoked', 'blocked']),
        channel_id: identifier.nullable(),
        last_error_code: auditDetailCodeSchema.nullable(),
      })
      .strict(),
    tcc: z
      .object({
        responsible_identity: z.literal(MAC_ACCESS_IDENTITIES.appBundleId),
        accessibility: z.enum(['unknown', 'missing', 'granted', 'denied']),
        screen_recording: z.enum(['unknown', 'missing', 'granted', 'denied']),
      })
      .strict(),
    audit: z
      .object({
        writable: z.boolean(),
        anchor_healthy: z.boolean(),
        anchor: auditAnchorSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((status, context) => {
    if (status.leader.runtime_instance_id !== status.access.runtime_instance_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'leader and access state must describe the same runtime instance',
        path: ['leader', 'runtime_instance_id'],
      });
    }
    if (!status.audit.writable && status.access.effective_mode !== 'off') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'audit failure must force effective access off',
        path: ['audit', 'writable'],
      });
    }
    if (!status.audit.anchor_healthy && status.access.effective_mode !== 'off') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'audit anchor failure must force effective access off',
        path: ['audit', 'anchor_healthy'],
      });
    }
    if (status.audit.anchor.pending_sequence !== null && status.access.effective_mode !== 'off') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pending audit anchor commit must force effective access off',
        path: ['audit', 'anchor', 'pending_sequence'],
      });
    }
    const tccGranted = status.tcc.accessibility === 'granted' && status.tcc.screen_recording === 'granted';
    if (!tccGranted && status.access.effective_mode !== 'off') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'missing, denied, or unknown TCC state must force effective access off',
        path: ['tcc'],
      });
    }
    if (status.leader.build.security_epoch < status.access.minimum_reader_security_epoch) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'helper build is below the protected state reader security floor',
        path: ['leader', 'build', 'security_epoch'],
      });
    }
    if (status.leader.build.security_epoch < status.access.minimum_writer_security_epoch) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'helper build is below the protected state writer security floor',
        path: ['leader', 'build', 'security_epoch'],
      });
    }
    if (status.leader.build.schema_reader_version < status.access.minimum_reader_schema_version) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'helper build is below the protected state reader schema floor',
        path: ['leader', 'build', 'schema_reader_version'],
      });
    }
    if (status.leader.build.schema_writer_version < status.access.minimum_writer_schema_version) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'helper build is below the protected state writer schema floor',
        path: ['leader', 'build', 'schema_writer_version'],
      });
    }
    const relayBuild = status.relay_authorization;
    const localBuild = status.leader.build;
    if (status.audit.anchor.security_epoch !== localBuild.security_epoch) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'audit anchor security epoch must match the accepted helper build',
        path: ['audit', 'anchor', 'security_epoch'],
      });
    }
    if (
      relayBuild.accepted_build_version !== localBuild.build_version ||
      relayBuild.accepted_source_commit !== localBuild.source_commit ||
      relayBuild.accepted_security_epoch !== localBuild.security_epoch
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'relay authorization must name the exact immutable local build identity',
        path: ['relay_authorization'],
      });
    }
    if (
      relayBuild.credential_security_epoch !== relayBuild.accepted_security_epoch ||
      status.keychain.credential_security_epoch !== relayBuild.credential_security_epoch
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'relay and Keychain credential epochs must match the accepted security epoch',
        path: ['relay_authorization', 'credential_security_epoch'],
      });
    }
    const rollback = relayBuild.rollback_authorization?.payload ?? null;
    if ((rollback?.authorization_id ?? null) !== localBuild.rollback_authorization_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'relay and local build must agree on exact rollback authorization',
        path: ['relay_authorization', 'rollback_authorization'],
      });
    }
    if (rollback !== null) {
      const source = relayBuild.verified_pre_rollback_source;
      const sourceMatches =
        source !== null &&
        source.build_version === rollback.source.build_version &&
        source.source_commit === rollback.source.source_commit &&
        source.signed_lineage_id === rollback.source.signed_lineage_id &&
        source.security_epoch === rollback.source.security_epoch &&
        source.credential_security_epoch === rollback.source.credential_security_epoch &&
        source.schema_reader_version === rollback.source.schema_reader_version &&
        source.schema_writer_version === rollback.source.schema_writer_version;
      if (!sourceMatches) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'rollback authorization source must match the persisted verified pre-rollback build',
          path: ['relay_authorization', 'verified_pre_rollback_source'],
        });
      }
      const targetMatches =
        rollback.target.build_version === localBuild.build_version &&
        rollback.target.source_commit === localBuild.source_commit &&
        rollback.target.signed_lineage_id === localBuild.signed_lineage_id &&
        rollback.target.security_epoch === localBuild.security_epoch &&
        rollback.target.credential_security_epoch === status.keychain.credential_security_epoch &&
        rollback.target.schema_reader_version === localBuild.schema_reader_version &&
        rollback.target.schema_writer_version === localBuild.schema_writer_version &&
        rollback.resulting_minimum_reader_security_epoch === status.access.minimum_reader_security_epoch &&
        rollback.resulting_minimum_writer_security_epoch === status.access.minimum_writer_security_epoch &&
        rollback.resulting_minimum_reader_schema_version === status.access.minimum_reader_schema_version &&
        rollback.resulting_minimum_writer_schema_version === status.access.minimum_writer_schema_version;
      if (!targetMatches) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'rollback authorization target and resulting floors must match current status exactly',
          path: ['relay_authorization', 'rollback_authorization', 'payload', 'target'],
        });
      }
      const observedAt = Date.parse(status.observed_at);
      if (observedAt < Date.parse(rollback.issued_at) || observedAt >= Date.parse(rollback.expires_at)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'rollback authorization must be current at the observed status time',
          path: ['relay_authorization', 'rollback_authorization', 'payload', 'expires_at'],
        });
      }
    } else if (relayBuild.verified_pre_rollback_source !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pre-rollback source is valid only with an exact rollback authorization',
        path: ['relay_authorization', 'verified_pre_rollback_source'],
      });
    }
    if (
      status.access.binding !== null &&
      Date.parse(status.observed_at) >= Date.parse(status.access.binding.grant_expires_at)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expired grant must clear the selected binding and force access off',
        path: ['access', 'binding', 'grant_expires_at'],
      });
    }
    const connected = status.transport.state === 'connected';
    if (connected !== (status.transport.channel_id !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'only connected transport may carry an active channel id',
        path: ['transport', 'channel_id'],
      });
    }
    if (status.transport.state === 'revoked' && status.access.pairing_state !== 'revoked') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'revoked transport requires revoked access state',
        path: ['transport', 'state'],
      });
    }
    if (connected && (status.access.pairing_state !== 'paired' || status.access.binding === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'connected transport requires an actively paired selected binding',
        path: ['transport', 'state'],
      });
    }
    if (!connected && status.access.effective_mode !== 'off') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unavailable transport must force effective access off',
        path: ['transport', 'state'],
      });
    }
  });

export const accessTransitionSchema = z
  .object({
    schema_version: z.literal('evaos.mac_access.access_transition.v1'),
    transition_id: identifier,
    event: z.enum([
      'pair_confirmed',
      'set_mode',
      'restart',
      'pause',
      'stop',
      'resume',
      'revoke',
      'kill_switch',
      'tcc_lost',
      'audit_failed',
      'binding_changed',
      'grant_expired',
    ]),
    explicit_user_consent: z.boolean(),
    invalidated_pending_authority: z.boolean(),
    safe_cancellation_requested: z.boolean(),
    target_mode: z.enum(['off', 'ask_every_time', 'full_access']).nullable(),
    from: accessStateSchema,
    to: accessStateSchema,
  })
  .strict()
  .superRefine((transition, context) => {
    const { from, to } = transition;
    const bindingUnchanged =
      (from.binding === null && to.binding === null) ||
      (from.binding !== null && to.binding !== null && selectedBindingsEqual(from.binding, to.binding));
    const bindingMutationEvents = new Set(['pair_confirmed', 'binding_changed', 'revoke', 'grant_expired']);
    if (!bindingUnchanged && !bindingMutationEvents.has(transition.event)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'selected binding may change only through an explicit binding authority transition',
        path: ['to', 'binding'],
      });
    }
    const configuredModeMutationEvents = new Set([
      'pair_confirmed',
      'set_mode',
      'revoke',
      'kill_switch',
      'grant_expired',
    ]);
    if (from.configured_mode !== to.configured_mode && !configuredModeMutationEvents.has(transition.event)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'configured user intent may change only through an explicit mode-authority transition',
        path: ['to', 'configured_mode'],
      });
    }
    if (transition.event !== 'restart' && from.runtime_instance_id !== to.runtime_instance_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'runtime instance may change only through an explicit restart transition',
        path: ['to', 'runtime_instance_id'],
      });
    }
    if (to.policy_epoch !== from.policy_epoch + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'every authority transition must advance the policy epoch exactly once',
        path: ['to', 'policy_epoch'],
      });
    }
    const accessModeRank = { off: 0, ask_every_time: 1, full_access: 2 } as const;
    const narrowsAccess =
      transition.event === 'set_mode' &&
      transition.target_mode !== null &&
      accessModeRank[transition.target_mode] < accessModeRank[from.configured_mode];
    const authorityInvalidating =
      [
        'restart',
        'pause',
        'stop',
        'revoke',
        'kill_switch',
        'tcc_lost',
        'audit_failed',
        'binding_changed',
        'grant_expired',
      ].includes(transition.event) ||
      (transition.event === 'set_mode' && transition.target_mode === 'off') ||
      narrowsAccess;
    if (
      authorityInvalidating &&
      (!transition.invalidated_pending_authority || !transition.safe_cancellation_requested)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'destructive or authority-changing transition must invalidate pending authority and request safe cancellation',
        path: ['event'],
      });
    }
    if (transition.event === 'pair_confirmed') {
      const validPairing =
        transition.explicit_user_consent &&
        transition.target_mode === 'ask_every_time' &&
        from.pairing_state === 'unpaired' &&
        from.configured_mode === 'off' &&
        from.effective_mode === 'off' &&
        from.binding === null &&
        to.pairing_state === 'paired' &&
        to.configured_mode === 'ask_every_time' &&
        to.effective_mode === 'ask_every_time' &&
        to.binding !== null;
      if (!validPairing) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'pairing requires explicit consent and may transition only from unpaired off to paired ask every time',
          path: ['event'],
        });
      }
    }
    if (transition.event === 'restart') {
      const validRestart =
        from.runtime_instance_id !== to.runtime_instance_id &&
        to.configured_mode === from.configured_mode &&
        to.confirmed_runtime_instance_id === null &&
        to.confirmed_policy_epoch === null &&
        to.confirmed_binding_fingerprint_sha256 === null &&
        (to.configured_mode !== 'full_access' ||
          (to.effective_mode === 'ask_every_time' && to.local_confirmation_required));
      if (!validRestart) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'restart must clear confirmation and downgrade configured full access to ask every time',
          path: ['event'],
        });
      }
    }
    if (transition.event === 'set_mode') {
      const validSetMode =
        transition.target_mode !== null &&
        to.configured_mode === transition.target_mode &&
        (transition.target_mode !== 'full_access' || transition.explicit_user_consent);
      if (!validSetMode) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'mode changes require an exact target and full access requires explicit local consent',
          path: ['target_mode'],
        });
      }
    }
    if (transition.event === 'pause' && (!to.paused || to.effective_mode !== 'off')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pause must synchronously force effective access off',
        path: ['to'],
      });
    }
    if (transition.event === 'stop') {
      const validStop =
        to.effective_mode === 'off' &&
        transition.invalidated_pending_authority &&
        transition.safe_cancellation_requested &&
        to.confirmed_runtime_instance_id === null &&
        to.confirmed_policy_epoch === null &&
        to.confirmed_binding_fingerprint_sha256 === null &&
        (to.configured_mode !== 'full_access' || to.local_confirmation_required);
      if (!validStop) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'stop must rotate policy, force off, invalidate pending authority, and request safe cancellation',
          path: ['event'],
        });
      }
    }
    if (transition.event === 'resume') {
      const validResume =
        from.paused &&
        !to.paused &&
        to.configured_mode === from.configured_mode &&
        (to.configured_mode !== 'full_access' ||
          (to.effective_mode === 'ask_every_time' && to.local_confirmation_required));
      if (!validResume) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'resume must clear pause without silently restoring full access',
          path: ['to'],
        });
      }
    }
    if (transition.event === 'revoke') {
      const validRevoke =
        to.pairing_state === 'revoked' &&
        to.configured_mode === 'off' &&
        to.effective_mode === 'off' &&
        to.binding === null;
      if (!validRevoke) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'revoke must tombstone pairing and clear binding and authority',
          path: ['to'],
        });
      }
    }
    if (transition.event === 'grant_expired') {
      const validExpiry =
        to.pairing_state === 'revoked' &&
        to.configured_mode === 'off' &&
        to.effective_mode === 'off' &&
        to.binding === null;
      if (!validExpiry) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'grant expiry must tombstone authority, clear the binding, and force access off',
          path: ['to'],
        });
      }
    }
    if (
      transition.event === 'kill_switch' &&
      (!to.kill_switch || to.configured_mode !== 'off' || to.effective_mode !== 'off')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'kill switch must synchronously clear configured and effective access',
        path: ['to'],
      });
    }
    if (['tcc_lost', 'audit_failed'].includes(transition.event) && to.effective_mode !== 'off') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TCC or audit failure must force effective access off',
        path: ['to', 'effective_mode'],
      });
    }
    if (
      transition.event === 'binding_changed' &&
      (from.binding === null ||
        to.binding === null ||
        selectedBindingsEqual(from.binding, to.binding) ||
        to.confirmed_binding_fingerprint_sha256 !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'binding change must rotate the binding fingerprint and clear full access confirmation',
        path: ['to', 'binding'],
      });
    }
  });

const localActionName = z.enum([
  'get_status',
  'begin_pairing',
  'set_access_mode',
  'pause',
  'resume',
  'revoke',
  'activate_kill_switch',
  'open_permissions',
  'stop',
]);

export const localActionRequestSchema = z
  .object({
    schema_version: z.literal('evaos.mac_access.local_action.v1'),
    request_id: identifier,
    action: localActionName,
    client_nonce: base64Url,
    expected_policy_epoch: safeNonnegativeCounter.nullable(),
    target_mode: z.enum(['off', 'ask_every_time', 'full_access']).nullable(),
    pairing_code: z
      .string()
      .regex(/^[A-Z0-9]{6,12}$/)
      .nullable(),
    local_installation_nonce: installationNonce.nullable(),
  })
  .strict()
  .superRefine((request, context) => {
    const mutation = !['get_status', 'open_permissions'].includes(request.action);
    if (mutation && request.expected_policy_epoch === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'mutating local actions require the expected policy epoch',
        path: ['expected_policy_epoch'],
      });
    }
    if (request.action === 'set_access_mode' && request.target_mode === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'set_access_mode requires target_mode',
        path: ['target_mode'],
      });
    }
    if (request.action !== 'set_access_mode' && request.target_mode !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'target_mode is only valid for set_access_mode',
        path: ['target_mode'],
      });
    }
    if ((request.action === 'begin_pairing') !== (request.pairing_code !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pairing_code is required only for begin_pairing',
        path: ['pairing_code'],
      });
    }
    if ((request.action === 'begin_pairing') !== (request.local_installation_nonce !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'local_installation_nonce is required only for begin_pairing',
        path: ['local_installation_nonce'],
      });
    }
  });

export const authenticatedLocalActionSchema = z
  .object({
    schema_version: z.literal('evaos.mac_access.authenticated_local_action.v1'),
    connection_id: identifier,
    peer: authenticatedPeerSchema,
    request: localActionRequestSchema,
  })
  .strict();

export const commandAuthorityPayloadSchema = z
  .object({
    schema_version: z.literal('evaos.mac_access.command_authority_payload.v1'),
    domain: z.literal('evaos.mac-access/command-authority/v1'),
    session_id: identifier,
    channel_generation_id: identifier,
    command_id: identifier,
    issued_at: instant,
    expires_at: instant,
    sequence: safePositiveCounter,
    policy_epoch: safeNonnegativeCounter,
    nonce: base64Url,
    binding: selectedBindingSchema,
    execution_context_sha256: sha256,
    capability: macControlCapabilitySchema,
    request_digest_sha256: sha256,
  })
  .strict();

export const commandAuthorityGoldenSchema = z
  .object({
    schema_version: z.literal('evaos.mac_access.command_authority_golden.v1'),
    canonicalization: z.literal('RFC8785-JCS'),
    payload: commandAuthorityPayloadSchema,
    canonical_payload_utf8: z.string().min(1).max(65_536),
    payload_sha256: sha256,
    public_key_spki_base64url: base64Url,
    signature_base64url: base64Url,
  })
  .strict();

export const brokerControlEnvelopeSchema = z
  .object({
    schema_version: z.literal('evaos.mac_access.broker_control.v1'),
    message_type: z.literal('command'),
    session_id: identifier,
    channel_generation_id: identifier,
    command_id: identifier,
    issued_at: instant,
    expires_at: instant,
    sequence: safePositiveCounter,
    policy_epoch: safeNonnegativeCounter,
    nonce: base64Url,
    binding: selectedBindingSchema,
    execution_context: z
      .object({
        claims: executionContextClaimsSchema,
        payload_base64url: base64Url,
        payload_sha256: sha256,
        signature_base64url: base64Url,
        key_id: identifier,
      })
      .strict(),
    command: z
      .object({
        capability: macControlCapabilitySchema,
        request: z.record(z.string(), z.unknown()),
        request_digest_sha256: sha256,
      })
      .strict(),
    authorization: z
      .object({
        schema_version: z.literal('evaos.mac_access.command_authorization.v1'),
        canonicalization: z.literal('RFC8785-JCS'),
        payload: commandAuthorityPayloadSchema,
        payload_sha256: sha256,
        key_id: identifier,
        signature_base64url: base64Url,
      })
      .strict(),
  })
  .strict()
  .superRefine((envelope, context) => {
    const issuedAt = Date.parse(envelope.issued_at);
    const expiresAt = Date.parse(envelope.expires_at);
    if (expiresAt <= issuedAt || expiresAt - issuedAt > 60_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'command authority must be positive and no longer than 60 seconds',
        path: ['expires_at'],
      });
    }
    if (expiresAt >= Date.parse(envelope.binding.grant_expires_at)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'command authority must expire before the selected grant',
        path: ['binding', 'grant_expires_at'],
      });
    }
    const claims = envelope.execution_context.claims;
    const binding = envelope.binding;
    const matches =
      claims.customer_id === binding.customer_id &&
      claims.customer_vm_id === binding.customer_vm_id &&
      claims.runtime === binding.runtime &&
      claims.binding_id === binding.binding_id &&
      claims.binding_version === binding.binding_version;
    if (!matches) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'execution context does not match the selected binding',
        path: ['execution_context', 'claims'],
      });
    }
    if (envelope.execution_context.key_id !== claims.key_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'execution context key id must match its signed claims',
        path: ['execution_context', 'key_id'],
      });
    }
    const contextIssuedAt = claims.issued_at * 1_000;
    const contextExpiresAt = claims.expires_at * 1_000;
    if (issuedAt < contextIssuedAt || expiresAt > contextExpiresAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'command authority must be contained by the signed execution context interval',
        path: ['expires_at'],
      });
    }
    const authority = envelope.authorization.payload;
    const authorityMatches =
      authority.session_id === envelope.session_id &&
      authority.channel_generation_id === envelope.channel_generation_id &&
      authority.command_id === envelope.command_id &&
      authority.issued_at === envelope.issued_at &&
      authority.expires_at === envelope.expires_at &&
      authority.sequence === envelope.sequence &&
      authority.policy_epoch === envelope.policy_epoch &&
      authority.nonce === envelope.nonce &&
      authority.execution_context_sha256 === envelope.execution_context.payload_sha256 &&
      authority.capability === envelope.command.capability &&
      authority.request_digest_sha256 === envelope.command.request_digest_sha256 &&
      selectedBindingsEqual(authority.binding, envelope.binding);
    if (!authorityMatches) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'signed command authority payload does not exactly match the delivered command envelope',
        path: ['authorization', 'payload'],
      });
    }
  });

export const CORE_HOST_OPERATIONS = [
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
] as const;

export const coreHostOperationSchema = z.enum(CORE_HOST_OPERATIONS);

const coreHostRequestIdentity = {
  schema_version: z.literal('evaos.mac_connector_core.host_request.v1'),
  request_id: identifier,
  host_session_id: identifier,
  sequence: safePositiveCounter,
};

const coreHostLifecycleRequest = (
  operation: 'unpair' | 'disconnect' | 'pause' | 'resume' | 'stop' | 'revoke' | 'activate_kill_switch' | 'shutdown'
) =>
  z
    .object({
      ...coreHostRequestIdentity,
      operation: z.literal(operation),
      expected_policy_epoch: safeNonnegativeCounter,
    })
    .strict();

export const coreHostRequestSchema = z
  .discriminatedUnion('operation', [
    z
      .object({
        ...coreHostRequestIdentity,
        operation: z.literal('status'),
        expected_policy_epoch: z.null(),
      })
      .strict(),
    z
      .object({
        ...coreHostRequestIdentity,
        operation: z.literal('pair'),
        expected_policy_epoch: safeNonnegativeCounter,
        pairing_code: z.string().regex(/^[A-Z0-9]{6,12}$/),
        local_installation_nonce: installationNonce,
      })
      .strict(),
    coreHostLifecycleRequest('unpair'),
    z
      .object({
        ...coreHostRequestIdentity,
        operation: z.literal('connect'),
        expected_policy_epoch: safeNonnegativeCounter,
        binding: selectedBindingSchema,
      })
      .strict(),
    coreHostLifecycleRequest('disconnect'),
    z
      .object({
        ...coreHostRequestIdentity,
        operation: z.literal('set_access_mode'),
        expected_policy_epoch: safeNonnegativeCounter,
        target_mode: z.enum(['off', 'ask_every_time', 'full_access']),
      })
      .strict(),
    z
      .object({
        ...coreHostRequestIdentity,
        operation: z.literal('dispatch_action'),
        expected_policy_epoch: safeNonnegativeCounter,
        envelope: brokerControlEnvelopeSchema,
      })
      .strict(),
    z
      .object({
        ...coreHostRequestIdentity,
        operation: z.literal('audit_summary'),
        expected_policy_epoch: safeNonnegativeCounter,
        after_cursor: auditCursorSchema.nullable(),
        limit: z.number().int().min(1).max(100),
      })
      .strict(),
    coreHostLifecycleRequest('pause'),
    coreHostLifecycleRequest('resume'),
    coreHostLifecycleRequest('stop'),
    coreHostLifecycleRequest('revoke'),
    coreHostLifecycleRequest('activate_kill_switch'),
    coreHostLifecycleRequest('shutdown'),
  ])
  .superRefine((request, context) => {
    if (request.operation === 'dispatch_action' && request.expected_policy_epoch !== request.envelope.policy_epoch) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'dispatch host epoch must exactly match the signed broker envelope epoch',
        path: ['expected_policy_epoch'],
      });
    }
  });

export const auditEvidenceSchema = z
  .object({
    capability: macControlCapabilitySchema.optional(),
    target_path_hash: sha256.optional(),
    target_fingerprint_sha256: sha256.optional(),
    state_from: accessEvidenceStateSchema.optional(),
    state_to: accessEvidenceStateSchema.optional(),
    transport_state: transportStateSchema.optional(),
    detail_code: auditDetailCodeSchema.optional(),
    build_version: z
      .string()
      .max(128)
      .regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/)
      .optional(),
    schema_version: z
      .enum([
        'evaos.mac_access.access_state.v1',
        'evaos.mac_access.audit_anchor.v1',
        'evaos.mac_access.audit_event.v1',
        'evaos.mac_access.broker_control.v1',
        'evaos.mac_access.command_authority_payload.v1',
        'evaos.mac_access.local_action.v1',
        'evaos.mac_access.local_status.v1',
        'evaos.mac_connector_core.host_request.v1',
        'evaos.mac_connector_core.host_response.v1',
      ])
      .optional(),
    artifact_count: z.number().int().min(0).max(16).optional(),
    record_count: z.number().int().min(0).max(10_000).optional(),
    redaction_policy: z.literal('default_v1'),
  })
  .strict();

const auditRecordPayloadBaseSchema = z
  .object({
    schema_version: z.literal('evaos.mac_access.audit_event.v1'),
    audit_id: identifier,
    sequence: safePositiveCounter,
    previous_record_sha256: sha256.nullable(),
    occurred_at: instant,
    event_type: z.enum([
      'pairing',
      'policy_transition',
      'command_decision',
      'command_result',
      'pause',
      'revoke',
      'kill_switch',
      'lifecycle',
    ]),
    actor: auditActorSchema,
    binding_fingerprint_sha256: sha256.nullable(),
    command_id: identifier.nullable(),
    request_digest_sha256: sha256.nullable(),
    causation_audit_id: identifier.nullable(),
    access_mode: z.enum(['off', 'ask_every_time', 'full_access']),
    outcome: z.enum(['allowed', 'denied', 'executed', 'failed', 'revoked', 'stopped']),
    reason_code: auditReasonCodeSchema,
    evidence: auditEvidenceSchema,
  })
  .strict();

function requireCommandAuditCorrelation(
  event: z.infer<typeof auditRecordPayloadBaseSchema>,
  context: z.RefinementCtx
): void {
  const commandEvent = ['command_decision', 'command_result'].includes(event.event_type);
  if (
    commandEvent &&
    (event.binding_fingerprint_sha256 === null || event.command_id === null || event.request_digest_sha256 === null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'command audit events require binding, command, and request-digest correlation',
      path: ['command_id'],
    });
  }
  if (
    !commandEvent &&
    (event.command_id !== null || event.request_digest_sha256 !== null || event.causation_audit_id !== null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'non-command audit events cannot carry command correlation fields',
      path: ['command_id'],
    });
  }
  if (
    event.event_type === 'command_decision' &&
    (event.causation_audit_id !== null || !['allowed', 'denied'].includes(event.outcome))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'command decisions must be root records with allowed or denied outcomes',
      path: ['causation_audit_id'],
    });
  }
  if (
    event.event_type === 'command_result' &&
    (event.causation_audit_id === null ||
      event.causation_audit_id === event.audit_id ||
      !['executed', 'failed', 'stopped'].includes(event.outcome))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'command results must cite their decision audit and use a terminal execution outcome',
      path: ['causation_audit_id'],
    });
  }
}

export const auditRecordPayloadSchema = auditRecordPayloadBaseSchema.superRefine(requireCommandAuditCorrelation);

export const auditEventSchema = auditRecordPayloadBaseSchema
  .extend({ record_sha256: sha256 })
  .superRefine((event, context) => {
    requireCommandAuditCorrelation(event, context);
    const { record_sha256: expectedDigest, ...payload } = event;
    if (canonicalJsonSha256(payload) !== expectedDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'audit record digest must match the exact RFC 8785 payload',
        path: ['record_sha256'],
      });
    }
    if (event.sequence === 1 && event.previous_record_sha256 !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'the first audit record must not claim a previous record digest',
        path: ['previous_record_sha256'],
      });
    }
    if (event.sequence > 1 && event.previous_record_sha256 === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'subsequent audit records must chain the previous record digest',
        path: ['previous_record_sha256'],
      });
    }
  });

export const auditChainGoldenSchema = z
  .object({
    schema_version: z.literal('evaos.mac_access.audit_chain_golden.v1'),
    canonicalization: z.literal('RFC8785-JCS'),
    records: z
      .array(
        z
          .object({
            payload: auditRecordPayloadSchema,
            canonical_payload_utf8: z.string().min(1).max(65_536),
            record_sha256: sha256,
          })
          .strict()
      )
      .length(2),
  })
  .strict()
  .superRefine((golden, context) => {
    for (const [index, record] of golden.records.entries()) {
      const canonical = canonicalJson(record.payload);
      if (canonical === null || canonical !== record.canonical_payload_utf8) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'audit golden canonical bytes must match the exact RFC 8785 payload',
          path: ['records', index, 'canonical_payload_utf8'],
        });
      }
      if (canonicalJsonSha256(record.payload) !== record.record_sha256) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'audit golden record digest must match its exact payload',
          path: ['records', index, 'record_sha256'],
        });
      }
      const previous = golden.records[index - 1];
      if (
        record.payload.sequence !== index + 1 ||
        record.payload.previous_record_sha256 !== (previous?.record_sha256 ?? null)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'audit golden records must form one contiguous digest chain',
          path: ['records', index, 'payload', 'previous_record_sha256'],
        });
      }
    }

    const [decision, result] = golden.records.map((record) => record.payload);
    if (
      decision.event_type !== 'command_decision' ||
      result.event_type !== 'command_result' ||
      result.causation_audit_id !== decision.audit_id ||
      result.command_id !== decision.command_id ||
      result.request_digest_sha256 !== decision.request_digest_sha256 ||
      result.binding_fingerprint_sha256 !== decision.binding_fingerprint_sha256 ||
      result.sequence <= decision.sequence
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'audit golden records must be one causally bound command decision and result',
        path: ['records', 1, 'payload', 'causation_audit_id'],
      });
    }
  });

const auditSummaryResultSchema = z
  .object({
    kind: z.literal('audit_summary'),
    page_anchor: auditCursorSchema.nullable(),
    events: z.array(auditEventSchema).max(100),
    causal_decisions: z.array(auditEventSchema).max(1),
    next_cursor: auditCursorSchema.nullable(),
  })
  .strict()
  .superRefine((summary, context) => {
    for (const [index, decision] of summary.causal_decisions.entries()) {
      if (
        summary.page_anchor === null ||
        decision.sequence !== summary.page_anchor.sequence ||
        decision.record_sha256 !== summary.page_anchor.record_sha256
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'off-page causal decision must be the exact digest-bound page anchor record',
          path: ['causal_decisions', index, 'record_sha256'],
        });
      }
    }
    if (summary.events.length === 0) {
      if (summary.next_cursor !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'empty audit summary cannot advertise a continuation cursor',
          path: ['next_cursor'],
        });
      }
      return;
    }

    const first = summary.events[0];
    const expectedFirstSequence = summary.page_anchor === null ? 1 : summary.page_anchor.sequence + 1;
    if (first.sequence !== expectedFirstSequence) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'audit summary must begin immediately after its echoed cursor',
        path: ['events', 0, 'sequence'],
      });
    }
    const expectedFirstPreviousDigest = summary.page_anchor?.record_sha256 ?? null;
    if (first.previous_record_sha256 !== expectedFirstPreviousDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'audit summary first record must link to the echoed page anchor',
        path: ['events', 0, 'previous_record_sha256'],
      });
    }
    for (let index = 1; index < summary.events.length; index += 1) {
      const previous = summary.events[index - 1];
      const current = summary.events[index];
      if (current.sequence !== previous.sequence + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'audit summary events must have ascending contiguous sequences',
          path: ['events', index, 'sequence'],
        });
      }
      if (current.previous_record_sha256 !== previous.record_sha256) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'audit summary events must preserve previous-record digest links',
          path: ['events', index, 'previous_record_sha256'],
        });
      }
    }
    const last = summary.events.at(-1)!;
    if (
      summary.next_cursor === null ||
      summary.next_cursor.sequence !== last.sequence ||
      summary.next_cursor.record_sha256 !== last.record_sha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'every nonempty audit page must return the final record as its continuation cursor',
        path: ['next_cursor'],
      });
    }

    const decisions = new Map<string, z.infer<typeof auditEventSchema>>();
    for (const [index, decision] of summary.causal_decisions.entries()) {
      if (decision.event_type !== 'command_decision') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'causal decision proofs may contain only command-decision audit records',
          path: ['causal_decisions', index, 'event_type'],
        });
      }
    }
    for (const decision of [...summary.events, ...summary.causal_decisions]) {
      if (decision.event_type !== 'command_decision') continue;
      const existing = decisions.get(decision.audit_id);
      if (existing !== undefined && existing.record_sha256 !== decision.record_sha256) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'causal decision audit id cannot resolve to multiple records',
          path: ['causal_decisions'],
        });
      }
      decisions.set(decision.audit_id, decision);
    }
    for (const [index, event] of summary.events.entries()) {
      if (event.event_type !== 'command_result') continue;
      const decision = event.causation_audit_id === null ? undefined : decisions.get(event.causation_audit_id);
      if (
        decision === undefined ||
        decision.sequence >= event.sequence ||
        decision.command_id !== event.command_id ||
        decision.request_digest_sha256 !== event.request_digest_sha256 ||
        decision.binding_fingerprint_sha256 !== event.binding_fingerprint_sha256
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'command result must resolve to a matching causal decision record',
          path: ['events', index, 'causation_audit_id'],
        });
      }
    }
  });

const lifecycleResultSchema = z
  .object({
    kind: z.literal('lifecycle'),
    configured_mode: z.enum(['off', 'ask_every_time', 'full_access']),
    effective_mode: z.enum(['off', 'ask_every_time', 'full_access']),
    requested_target_mode: z.enum(['off', 'ask_every_time', 'full_access']).nullable(),
    pairing_state: z.enum(['unpaired', 'paired', 'revoked']),
    transport_state: transportStateSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const modeRank = { off: 0, ask_every_time: 1, full_access: 2 } as const;
    if (modeRank[result.effective_mode] > modeRank[result.configured_mode]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'lifecycle effective access cannot exceed configured user intent',
        path: ['effective_mode'],
      });
    }
    if (result.pairing_state !== 'paired' && (result.configured_mode !== 'off' || result.effective_mode !== 'off')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unpaired or revoked lifecycle state must be configured and effective off',
        path: ['pairing_state'],
      });
    }
    if (result.transport_state === 'connected' && result.pairing_state !== 'paired') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'connected lifecycle transport requires paired state',
        path: ['transport_state'],
      });
    }
    if (result.transport_state === 'revoked' && result.pairing_state !== 'revoked') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'revoked lifecycle transport requires revoked pairing state',
        path: ['transport_state'],
      });
    }
  });

const coreHostResultSchema = z.union([
  z.object({ kind: z.literal('status'), status: localStatusSchema }).strict(),
  z
    .object({
      kind: z.literal('pairing'),
      pairing_state: z.enum(['unpaired', 'paired', 'revoked']),
      device_id: identifier.nullable(),
      binding_fingerprint_sha256: sha256.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('action'),
      command_id: identifier,
      request_digest_sha256: sha256,
      outcome: z.enum(['denied', 'executed', 'failed', 'stopped']),
      decision_audit_id: identifier,
      result_audit_id: identifier.nullable(),
      decision_audit: auditEventSchema,
      result_audit: auditEventSchema.nullable(),
    })
    .strict()
    .superRefine((result, context) => {
      const denied = result.outcome === 'denied';
      if (
        result.decision_audit_id !== result.decision_audit.audit_id ||
        result.decision_audit.event_type !== 'command_decision' ||
        result.decision_audit.outcome !== (denied ? 'denied' : 'allowed')
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'action decision receipt must name the exact allowed or denied decision audit',
          path: ['decision_audit_id'],
        });
      }
      if (
        (denied && (result.result_audit_id !== null || result.result_audit !== null)) ||
        (!denied && (result.result_audit_id === null || result.result_audit === null))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'denied actions have only a decision audit; attempted actions require a result audit',
          path: ['result_audit_id'],
        });
      }
      if (
        result.result_audit !== null &&
        (result.result_audit_id !== result.result_audit.audit_id ||
          result.result_audit.event_type !== 'command_result' ||
          result.result_audit.outcome !== result.outcome ||
          result.result_audit.causation_audit_id !== result.decision_audit.audit_id ||
          result.result_audit.sequence <= result.decision_audit.sequence)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'action result receipt must be the exact later causal result audit',
          path: ['result_audit_id'],
        });
      }
    }),
  auditSummaryResultSchema,
  lifecycleResultSchema,
]);

export const coreHostResponseSchema = z
  .object({
    schema_version: z.literal('evaos.mac_connector_core.host_response.v1'),
    request_id: identifier,
    host_session_id: identifier,
    sequence: safePositiveCounter,
    operation: coreHostOperationSchema,
    ok: z.boolean(),
    policy_epoch: safeNonnegativeCounter,
    result: coreHostResultSchema.nullable(),
    error: z
      .object({
        code: identifier,
        audit_id: identifier.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((response, context) => {
    const successful = response.ok && response.result !== null && response.error === null;
    const failed = !response.ok && response.result === null && response.error !== null;
    if (!successful && !failed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'host response must contain exactly one successful result or terminal error',
        path: ['result'],
      });
    }
    if (!response.ok || response.result === null) return;
    const expectedKind =
      response.operation === 'status'
        ? 'status'
        : ['pair', 'unpair'].includes(response.operation)
          ? 'pairing'
          : response.operation === 'dispatch_action'
            ? 'action'
            : response.operation === 'audit_summary'
              ? 'audit_summary'
              : 'lifecycle';
    if (response.result.kind !== expectedKind) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'host response result kind must match the requested operation',
        path: ['result', 'kind'],
      });
    }

    if (
      response.operation === 'status' &&
      response.result.kind === 'status' &&
      response.policy_epoch !== response.result.status.access.policy_epoch
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'status response policy epoch must match the nested access state',
        path: ['result', 'status', 'access', 'policy_epoch'],
      });
    }
    if (response.operation === 'pair' && response.result.kind === 'pairing') {
      if (
        response.result.pairing_state !== 'paired' ||
        response.result.device_id === null ||
        response.result.binding_fingerprint_sha256 === null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'pair response must establish paired device and binding identity',
          path: ['result', 'pairing_state'],
        });
      }
    }
    if (response.operation === 'unpair' && response.result.kind === 'pairing') {
      if (
        response.result.pairing_state !== 'unpaired' ||
        response.result.device_id !== null ||
        response.result.binding_fingerprint_sha256 !== null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'unpair response must clear paired device and binding identity',
          path: ['result', 'pairing_state'],
        });
      }
    }
    if (response.result.kind !== 'lifecycle') return;

    if (response.operation === 'set_access_mode') {
      if (
        response.result.requested_target_mode === null ||
        response.result.configured_mode !== response.result.requested_target_mode
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'set-access-mode response must echo and establish the requested configured mode',
          path: ['result', 'requested_target_mode'],
        });
      }
    } else if (response.result.requested_target_mode !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'requested target mode is valid only for set-access-mode responses',
        path: ['result', 'requested_target_mode'],
      });
    }

    if (
      response.operation === 'connect' &&
      (response.result.pairing_state !== 'paired' || response.result.transport_state !== 'connected')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'connect response must report paired access and connected transport',
        path: ['result', 'transport_state'],
      });
    }

    if (
      ['pause', 'stop', 'revoke', 'activate_kill_switch', 'shutdown'].includes(response.operation) &&
      response.result.effective_mode !== 'off'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'destructive lifecycle responses must report effective access off',
        path: ['result', 'effective_mode'],
      });
    }
    if (response.operation === 'resume' && response.result.effective_mode === 'full_access') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'resume response cannot silently restore full access',
        path: ['result', 'effective_mode'],
      });
    }
    if (response.result.transport_state !== 'connected' && response.result.effective_mode !== 'off') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unavailable lifecycle transport must report effective access off',
        path: ['result', 'transport_state'],
      });
    }
    if (
      response.operation === 'revoke' &&
      (response.result.pairing_state !== 'revoked' || response.result.transport_state !== 'revoked')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'revoke response must report revoked pairing and transport',
        path: ['result', 'pairing_state'],
      });
    }
    if (
      ['disconnect', 'stop', 'shutdown'].includes(response.operation) &&
      ['connecting', 'connected'].includes(response.result.transport_state)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'disconnect, stop, and shutdown responses cannot retain an active transport',
        path: ['result', 'transport_state'],
      });
    }
    if (response.operation === 'activate_kill_switch' && response.result.transport_state !== 'blocked') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'kill-switch response must report blocked transport',
        path: ['result', 'transport_state'],
      });
    }
  });

export const coreHostExchangeSchema = z
  .object({
    request: coreHostRequestSchema,
    response: coreHostResponseSchema,
  })
  .strict()
  .superRefine(({ request, response }, context) => {
    if (
      request.request_id !== response.request_id ||
      request.host_session_id !== response.host_session_id ||
      request.sequence !== response.sequence ||
      request.operation !== response.operation
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'host response identity must match its exact request',
        path: ['response', 'request_id'],
      });
    }
    if (
      request.operation === 'set_access_mode' &&
      response.ok &&
      response.result?.kind === 'lifecycle' &&
      response.result.requested_target_mode !== request.target_mode
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'set-access-mode response target must match the exact request target',
        path: ['response', 'result', 'requested_target_mode'],
      });
    }
    if (
      ['set_access_mode', 'pause', 'resume', 'stop', 'revoke', 'activate_kill_switch'].includes(request.operation) &&
      typeof request.expected_policy_epoch === 'number' &&
      response.ok &&
      response.result?.kind === 'lifecycle' &&
      response.policy_epoch !== request.expected_policy_epoch + 1
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'policy-changing lifecycle response must advance the exact expected policy epoch once',
        path: ['response', 'policy_epoch'],
      });
    }
    if (
      request.operation === 'dispatch_action' &&
      response.ok &&
      response.result?.kind === 'action' &&
      (response.policy_epoch !== request.expected_policy_epoch ||
        response.result.command_id !== request.envelope.command_id ||
        response.result.request_digest_sha256 !== request.envelope.command.request_digest_sha256 ||
        response.result.decision_audit.command_id !== request.envelope.command_id ||
        response.result.decision_audit.request_digest_sha256 !== request.envelope.command.request_digest_sha256 ||
        response.result.decision_audit.binding_fingerprint_sha256 !==
          request.envelope.binding.binding_fingerprint_sha256 ||
        (response.result.result_audit !== null &&
          (response.result.result_audit.command_id !== request.envelope.command_id ||
            response.result.result_audit.request_digest_sha256 !== request.envelope.command.request_digest_sha256 ||
            response.result.result_audit.binding_fingerprint_sha256 !==
              request.envelope.binding.binding_fingerprint_sha256)) ||
        (response.result.result_audit_id !== null &&
          response.result.result_audit_id === response.result.decision_audit_id))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'action response must match the signed command, request digest, policy epoch, and distinct audits',
        path: ['response', 'result', 'command_id'],
      });
    }
    if (
      request.operation === 'audit_summary' &&
      response.ok &&
      response.result?.kind === 'audit_summary' &&
      JSON.stringify(response.result.page_anchor) !== JSON.stringify(request.after_cursor)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'audit summary must echo the exact requested cursor',
        path: ['response', 'result', 'page_anchor'],
      });
    }
  });

export const negativeFixtureCaseSchema = z
  .object({
    id: identifier,
    threat: identifier,
    contract: z.enum([
      'access_state',
      'access_transition',
      'local_status',
      'authenticated_local_action',
      'broker_control',
      'audit_event',
      'core_host_request',
      'core_host_response',
    ]),
    base_fixture: z.string().min(1),
    mutations: z.array(
      z.discriminatedUnion('operation', [
        z
          .object({
            operation: z.literal('set'),
            pointer: z.string().startsWith('/'),
            value: jsonValueSchema,
          })
          .strict(),
        z
          .object({
            operation: z.literal('remove'),
            pointer: z.string().startsWith('/'),
          })
          .strict(),
      ])
    ),
    expected_stage: z.enum(['schema', 'runtime']),
    expected_error: identifier,
    required_runtime_rejection: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((fixture, context) => {
    if (fixture.expected_stage === 'runtime' && fixture.required_runtime_rejection === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'runtime negative fixtures must name the required rejection behavior',
        path: ['required_runtime_rejection'],
      });
    }
    if (fixture.expected_stage === 'schema' && fixture.required_runtime_rejection !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'schema negative fixtures must not claim runtime evidence',
        path: ['required_runtime_rejection'],
      });
    }
  });

export type SelectedBinding = z.infer<typeof selectedBindingSchema>;
export type AccessState = z.infer<typeof accessStateSchema>;
export type AccessTransition = z.infer<typeof accessTransitionSchema>;
export type LocalStatus = z.infer<typeof localStatusSchema>;
export type LocalActionRequest = z.infer<typeof localActionRequestSchema>;
export type AuthenticatedLocalAction = z.infer<typeof authenticatedLocalActionSchema>;
export type BrokerControlEnvelope = z.infer<typeof brokerControlEnvelopeSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type CoreHostRequest = z.infer<typeof coreHostRequestSchema>;
export type CoreHostResponse = z.infer<typeof coreHostResponseSchema>;
export type CoreHostExchange = z.infer<typeof coreHostExchangeSchema>;
export type NegativeFixtureCase = z.infer<typeof negativeFixtureCaseSchema>;
