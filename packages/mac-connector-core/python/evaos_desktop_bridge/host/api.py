"""Fail-closed, helper-launched connector-core host API.

This module is intentionally dependency-injected.  It owns request sequencing and
policy-safe lifecycle transitions, while native, transport, audit, pairing, and
status effects are supplied by the signed helper.  It must remain importable in
the private embedded Python runtime without Electron, HTTP, PATH discovery, or a
customer-managed interpreter.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
import secrets
import threading
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Mapping, Protocol, runtime_checkable

from ..contracts.redaction import audit_value_is_redacted

REQUEST_SCHEMA = "evaos.mac_connector_core.host_request.v1"
RESPONSE_SCHEMA = "evaos.mac_connector_core.host_response.v1"
SAFE_INTEGER_MAX = 9_007_199_254_740_991
ACCESS_MODES = frozenset({"off", "ask_every_time", "full_access"})
OPERATIONS = (
    "status",
    "pair",
    "unpair",
    "connect",
    "disconnect",
    "set_access_mode",
    "dispatch_action",
    "audit_summary",
    "pause",
    "resume",
    "stop",
    "revoke",
    "activate_kill_switch",
    "shutdown",
)
_AUTHORITY_MUTATIONS = frozenset(
    {"unpair", "disconnect", "set_access_mode", "pause", "resume", "stop", "revoke", "activate_kill_switch", "shutdown"}
)

_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_PAIRING_CODE = re.compile(r"^[A-Z0-9]{6,12}$")
_INSTALLATION_NONCE = re.compile(r"^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_BASE64URL = re.compile(r"^[A-Za-z0-9_-]{1,16384}$")
_CAPABILITIES = frozenset(
    {
        "customer_mac.desktop_see",
        "customer_mac.desktop_click",
        "customer_mac.desktop_type",
        "customer_mac.desktop_set_value",
        "customer_mac.desktop_scroll",
        "customer_mac.desktop_drag",
        "customer_mac.desktop_hotkey",
        "customer_mac.desktop_focus_app",
        "customer_mac.desktop_window",
        "customer_mac.desktop_menu",
        "customer_mac.desktop_browser_action",
    }
)
_BINDING_FIELDS = frozenset(
    {
        "customer_id",
        "customer_vm_id",
        "device_id",
        "grant_id",
        "runtime",
        "binding_id",
        "binding_version",
        "grant_expires_at",
        "connector_installation_id",
        "connector_key_id",
        "binding_fingerprint_sha256",
    }
)

_TRANSPORT_STATES = frozenset({"disconnected", "connecting", "connected", "revoked", "blocked"})
_AUDIT_EVENT_FIELDS = frozenset(
    {
        "schema_version",
        "audit_id",
        "sequence",
        "previous_record_sha256",
        "occurred_at",
        "event_type",
        "actor",
        "binding_fingerprint_sha256",
        "command_id",
        "request_digest_sha256",
        "causation_audit_id",
        "access_mode",
        "outcome",
        "reason_code",
        "evidence",
        "record_sha256",
    }
)
_AUDIT_EVENT_TYPES = frozenset(
    {"pairing", "policy_transition", "command_decision", "command_result", "pause", "revoke", "kill_switch", "lifecycle"}
)
_AUDIT_OUTCOMES = frozenset({"allowed", "denied", "executed", "failed", "revoked", "stopped"})
_AUDIT_REASON_CODES = frozenset(
    {
        "approved_exact_scope",
        "denied_access_off",
        "denied_approval",
        "denied_audit_unhealthy",
        "denied_binding_mismatch",
        "denied_expired_authority",
        "denied_policy_epoch",
        "denied_replay",
        "denied_tcc",
        "denied_transport",
        "grant_expired",
        "local_full_access_confirmed",
        "local_kill_switch",
        "local_pause",
        "local_resume",
        "local_revoke",
        "local_stop",
        "pairing_confirmed",
        "pairing_failed",
        "runtime_restart",
    }
)
_AUDIT_DETAIL_CODES = frozenset(
    {
        "actuation_cancelled",
        "actuation_failed",
        "actuation_succeeded",
        "anchor_mismatch",
        "anchor_unavailable",
        "approval_expired",
        "approval_rejected",
        "approval_satisfied",
        "audit_append_failed",
        "binding_mismatch",
        "command_expired",
        "command_replayed",
        "grant_expired",
        "policy_epoch_stale",
        "request_digest_mismatch",
        "tcc_unavailable",
        "transport_unavailable",
    }
)
_AUDIT_EVIDENCE_FIELDS = frozenset(
    {
        "capability",
        "target_path_hash",
        "target_fingerprint_sha256",
        "state_from",
        "state_to",
        "transport_state",
        "detail_code",
        "build_version",
        "schema_version",
        "artifact_count",
        "record_count",
        "redaction_policy",
    }
)
_AUDIT_EVIDENCE_STATES = frozenset(
    {"unpaired", "paired", "off", "ask_every_time", "full_access", "paused", "active", "kill_switch_active"}
)
_AUDIT_EVIDENCE_SCHEMAS = frozenset(
    {
        "evaos.mac_access.access_state.v1",
        "evaos.mac_access.audit_anchor.v1",
        "evaos.mac_access.audit_event.v1",
        "evaos.mac_access.broker_control.v1",
        "evaos.mac_access.command_authority_payload.v1",
        "evaos.mac_access.local_action.v1",
        "evaos.mac_access.local_status.v1",
        "evaos.mac_connector_core.host_request.v1",
        "evaos.mac_connector_core.host_response.v1",
    }
)
_ACCESS_REASON_CODES = frozenset(
    {
        "not_paired",
        "pairing_confirmed",
        "pairing_failed",
        "local_full_access_confirmed",
        "local_mode_changed",
        "local_pause",
        "local_resume",
        "local_stop",
        "local_revoke",
        "local_kill_switch",
        "runtime_restart",
        "tcc_lost",
        "audit_failed",
        "binding_changed",
        "grant_expired",
    }
)


class HostError(RuntimeError):
    """A terminal, redacted host error safe to place on the wire."""

    def __init__(self, code: str, *, audit_id: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.audit_id = audit_id


@runtime_checkable
class StatePort(Protocol):
    def load(self) -> dict[str, Any]: ...

    def compare_and_swap(self, expected_revision: int, state: Mapping[str, Any]) -> bool: ...

    def replace_corrupt(self, state: Mapping[str, Any]) -> bool: ...


@runtime_checkable
class PairingPort(Protocol):
    def claim(self, pairing_code: str, local_installation_nonce: str) -> Mapping[str, Any]: ...


@runtime_checkable
class IdentityPort(Protocol):
    def runtime_is_current(self, state: Mapping[str, Any]) -> bool: ...


@runtime_checkable
class CredentialPort(Protocol):
    def erase_active(self) -> None: ...


@runtime_checkable
class QueuePort(Protocol):
    def clear(self) -> None: ...


@runtime_checkable
class ClockPort(Protocol):
    def validate_authority_window(self, envelope: Mapping[str, Any]) -> str | None: ...


@runtime_checkable
class TransportPort(Protocol):
    def connect(self, binding: Mapping[str, Any]) -> Mapping[str, Any]: ...

    def disconnect(self) -> None: ...

    def revoke(self) -> None: ...

    def block(self) -> None: ...


@runtime_checkable
class AuthorityPort(Protocol):
    def confirm_full_access(self, state: Mapping[str, Any]) -> bool: ...

    def validate_action(self, envelope: Mapping[str, Any], state: Mapping[str, Any]) -> str | None: ...

    def approve_action(self, envelope: Mapping[str, Any], state: Mapping[str, Any]) -> str | None: ...


@runtime_checkable
class ReplayPort(Protocol):
    def burn(self, envelope: Mapping[str, Any]) -> bool: ...

    def invalidate_pending(self) -> None: ...


@runtime_checkable
class AuditPort(Protocol):
    def anchor_healthy(self) -> bool: ...

    def committed_cursor(self) -> Mapping[str, Any] | None: ...

    def command_decision(
        self,
        envelope: Mapping[str, Any],
        *,
        allowed: bool,
        reason_code: str,
        detail_code: str | None,
    ) -> Mapping[str, Any]: ...

    def command_result(
        self,
        envelope: Mapping[str, Any],
        *,
        decision: Mapping[str, Any],
        outcome: str,
        reason_code: str,
        detail_code: str,
    ) -> Mapping[str, Any]: ...

    def summary(self, after_cursor: Mapping[str, Any] | None, limit: int) -> Mapping[str, Any]: ...


@runtime_checkable
class NativeActionPort(Protocol):
    def wait(self) -> Mapping[str, Any]: ...


@runtime_checkable
class NativePort(Protocol):
    def begin(self, envelope: Mapping[str, Any]) -> NativeActionPort: ...

    def cancel_all(self) -> None: ...


@runtime_checkable
class StatusPort(Protocol):
    def snapshot(self, state: Mapping[str, Any]) -> Mapping[str, Any]: ...


@dataclass(frozen=True)
class HostPorts:
    state: StatePort
    pairing: PairingPort
    identity: IdentityPort
    credential: CredentialPort
    queue: QueuePort
    clock: ClockPort
    transport: TransportPort
    authority: AuthorityPort
    replay: ReplayPort
    audit: AuditPort
    native: NativePort
    status: StatusPort


class InMemoryStatePort:
    """Deterministic state port for parity tests and private host embedding."""

    def __init__(self, host_session_id: str, *, policy_epoch: int = 0) -> None:
        self._state: dict[str, Any] = {
            "revision": 0,
            "host_session_id": host_session_id,
            "last_sequence": 0,
            "policy_epoch": policy_epoch,
            "runtime_instance_id": None,
            "pairing_state": "unpaired",
            "configured_mode": "off",
            "effective_mode": "off",
            "requested_target_mode": None,
            "paused": False,
            "kill_switch": False,
            "selected_binding": None,
            "transport_state": "disconnected",
            "shutdown": False,
            "local_confirmation_required": False,
            "confirmed_runtime_instance_id": None,
            "confirmed_policy_epoch": None,
            "confirmed_binding_fingerprint_sha256": None,
        }

    def load(self) -> dict[str, Any]:
        return copy.deepcopy(self._state)

    def compare_and_swap(self, expected_revision: int, state: Mapping[str, Any]) -> bool:
        if self._state.get("revision") != expected_revision:
            return False
        replacement = copy.deepcopy(dict(state))
        replacement["revision"] = expected_revision + 1
        self._state = replacement
        return True

    def replace_corrupt(self, state: Mapping[str, Any]) -> bool:
        replacement = copy.deepcopy(dict(state))
        current_revision = self._state.get("revision")
        replacement["revision"] = current_revision + 1 if _safe_nonnegative(current_revision) else 0
        self._state = replacement
        return True


class CoreHost:
    """Dispatch the fixed 14-operation private host protocol."""

    def __init__(
        self,
        ports: HostPorts,
        *,
        host_session_id: str,
        runtime_instance_id: str | None = None,
    ) -> None:
        self._ports = ports
        self._authority_lock = threading.RLock()
        self._host_session_id = host_session_id
        self._runtime_instance_id = runtime_instance_id or f"runtime-{secrets.token_hex(16)}"
        if not _identifier(self._runtime_instance_id) or not _identifier(self._host_session_id):
            raise ValueError("runtime and host-session IDs must be bounded identifiers")

    def handle(self, request: Any) -> dict[str, Any]:
        request_id = "invalid-request"
        host_session_id = "invalid-session"
        sequence = 1
        operation = "status"
        state: dict[str, Any] | None = None
        try:
            normalized = _validate_request(request)
            request_id = normalized["request_id"]
            host_session_id = normalized["host_session_id"]
            sequence = normalized["sequence"]
            operation = normalized["operation"]
            if operation in _AUTHORITY_MUTATIONS:
                with self._authority_lock:
                    state = self._reserve_sequence(normalized)
                    result, state = self._dispatch(normalized, state)
                    self._store(state)
            else:
                with self._authority_lock:
                    state = self._reserve_sequence(normalized)
                result, state = self._dispatch(normalized, state)
                if operation != "dispatch_action":
                    self._store(state)
            return _success(normalized, state["policy_epoch"], result)
        except HostError as error:
            if error.code in {"host_state_conflict", "policy_epoch_exhausted"}:
                self._emergency_fail_closed(state)
            return self._failure_response(
                request_id, host_session_id, sequence, operation, error
            )
        except Exception:
            self._emergency_fail_closed(state)
            return self._failure_response(
                request_id,
                host_session_id,
                sequence,
                operation,
                HostError("host_internal_error"),
            )

    def _failure_response(
        self,
        request_id: str,
        host_session_id: str,
        sequence: int,
        operation: str,
        error: HostError,
    ) -> dict[str, Any]:
        try:
            current = self._ports.state.load()
        except Exception:
            current = {}
        return {
            "schema_version": RESPONSE_SCHEMA,
            "request_id": request_id,
            "host_session_id": host_session_id,
            "sequence": sequence,
            "operation": operation if operation in OPERATIONS else "status",
            "ok": False,
            "policy_epoch": _nonnegative(current.get("policy_epoch"), default=0),
            "result": None,
            "error": {"code": error.code, "audit_id": error.audit_id},
        }

    def _reserve_sequence(self, request: Mapping[str, Any]) -> dict[str, Any]:
        state = self._ports.state.load()
        if not _state_is_valid(state):
            recovered = {
                "revision": 0,
                "host_session_id": request["host_session_id"],
                "last_sequence": request["sequence"],
                "policy_epoch": (
                    min(state["policy_epoch"] + 1, SAFE_INTEGER_MAX)
                    if _safe_nonnegative(state.get("policy_epoch"))
                    else SAFE_INTEGER_MAX
                ),
                "runtime_instance_id": self._runtime_instance_id,
                "pairing_state": "revoked",
                "configured_mode": "off",
                "effective_mode": "off",
                "requested_target_mode": None,
                "paused": True,
                "kill_switch": True,
                "selected_binding": None,
                "transport_state": "blocked",
                "shutdown": False,
                "local_confirmation_required": False,
                "confirmed_runtime_instance_id": None,
                "confirmed_policy_epoch": None,
                "confirmed_binding_fingerprint_sha256": None,
            }
            try:
                replaced = self._ports.state.replace_corrupt(recovered)
            except Exception as error:
                self._run_safety_effects(self._ports.transport.block)
                raise HostError("corrupt_state_unrecoverable") from error
            if not replaced:
                self._run_safety_effects(self._ports.transport.block)
                raise HostError("corrupt_state_unrecoverable")
            try:
                self._run_safety_effects(self._ports.transport.block)
            except Exception:
                pass
            raise HostError("corrupt_state_recovered_off")
        state = self._bind_runtime_instance(state)
        if state.get("shutdown") is True:
            raise HostError("host_shutdown")
        if request["host_session_id"] != state.get("host_session_id"):
            raise HostError("stale_core_host_session")
        if request["sequence"] <= _nonnegative(state.get("last_sequence"), default=0):
            raise HostError("replayed_core_host_sequence")
        revision = _nonnegative(state.get("revision"), default=0)
        state["last_sequence"] = request["sequence"]
        if not self._ports.state.compare_and_swap(revision, state):
            raise HostError("host_state_conflict")
        return self._ports.state.load()

    def _bind_runtime_instance(self, state: dict[str, Any]) -> dict[str, Any]:
        persisted = state.get("runtime_instance_id")
        if persisted == self._runtime_instance_id:
            return state
        revision = _nonnegative(state.get("revision"), default=0)
        pristine = (
            state.get("pairing_state") == "unpaired"
            and state.get("configured_mode") == "off"
            and state.get("effective_mode") == "off"
            and state.get("transport_state") == "disconnected"
            and state.get("policy_epoch") == 0
            and state.get("last_sequence") == 0
            and state.get("selected_binding") is None
            and not state.get("paused")
            and not state.get("kill_switch")
        )
        if persisted is None and pristine:
            state["runtime_instance_id"] = self._runtime_instance_id
            state["host_session_id"] = self._host_session_id
            state["last_sequence"] = 0
            if not self._ports.state.compare_and_swap(revision, state):
                raise HostError("host_state_conflict")
            return self._ports.state.load()

        state["runtime_instance_id"] = self._runtime_instance_id
        state["host_session_id"] = self._host_session_id
        state["last_sequence"] = 0
        self._force_off(state, clear_configured=False)
        state["transport_state"] = "disconnected"
        self._advance_epoch(state)
        if not self._ports.state.compare_and_swap(revision, state):
            raise HostError("host_state_conflict")
        self._run_safety_effects(self._ports.transport.disconnect)
        raise HostError("runtime_restarted")

    def _store(self, state: Mapping[str, Any]) -> None:
        revision = _nonnegative(state.get("revision"), default=0)
        if not self._ports.state.compare_and_swap(revision, state):
            raise HostError("host_state_conflict")

    def _dispatch(
        self, request: Mapping[str, Any], state: dict[str, Any]
    ) -> tuple[Mapping[str, Any], dict[str, Any]]:
        operation = request["operation"]
        if operation != "status" and request["expected_policy_epoch"] != state["policy_epoch"]:
            raise HostError("stale_command_policy_epoch")

        if operation not in {"status", "stop", "revoke", "activate_kill_switch", "shutdown"}:
            if not self._ports.identity.runtime_is_current(state):
                raise HostError("runtime_identity_mismatch")

        if operation == "status":
            status = dict(self._ports.status.snapshot(state))
            try:
                _validate_local_status(status, state)
            except Exception as error:
                self._commit_invalid_status_barrier()
                raise HostError("invalid_local_status") from error
            return {"kind": "status", "status": status}, state
        if operation == "pair":
            return self._pair(request, state)
        if operation == "unpair":
            state.update(pairing_state="unpaired", selected_binding=None, transport_state="disconnected")
            self._force_off(state, clear_configured=True)
            self._advance_epoch(state)
            state = self._checkpoint(state)
            self._run_safety_effects(self._ports.transport.disconnect)
            return _pairing_result(state), state
        if operation == "connect":
            if state["pairing_state"] != "paired" or state["kill_switch"]:
                raise HostError("connector_not_pairable")
            if not _bindings_equal(request["binding"], state.get("selected_binding")):
                raise HostError("selected_binding_mismatch")
            try:
                transport = _strict_mapping(
                    self._ports.transport.connect(request["binding"]),
                    {"state", "binding"},
                    "invalid_transport_receipt",
                )
                if transport.get("state") != "connected" or not _bindings_equal(
                    _validate_binding(transport.get("binding")), request["binding"]
                ):
                    raise HostError("invalid_transport_receipt")
            except Exception as error:
                self._run_safety_effects(self._ports.transport.block)
                raise HostError("invalid_transport_receipt") from error
            state["transport_state"] = "connected"
            return _lifecycle_result(state), state
        if operation == "disconnect":
            self._force_off(state, clear_configured=False)
            state = self._checkpoint(state)
            self._run_safety_effects(self._ports.transport.disconnect)
            state["transport_state"] = "disconnected"
            return _lifecycle_result(state), state
        if operation == "set_access_mode":
            return self._set_access_mode(request, state)
        if operation == "dispatch_action":
            return self._dispatch_action(request, state)
        if operation == "audit_summary":
            summary = dict(self._ports.audit.summary(request["after_cursor"], request["limit"]))
            _validate_audit_summary(summary, request["after_cursor"], request["limit"])
            return summary, state
        if operation == "pause":
            state["paused"] = True
            self._force_off(state, clear_configured=False)
            self._advance_epoch(state)
            state = self._checkpoint(state)
            self._run_safety_effects()
            return _lifecycle_result(state), state
        if operation == "resume":
            state["paused"] = False
            self._clear_full_access_confirmation(state)
            if state["transport_state"] != "connected":
                state["effective_mode"] = "off"
                state["requested_target_mode"] = (
                    "full_access" if state["configured_mode"] == "full_access" else None
                )
                state["local_confirmation_required"] = state["configured_mode"] == "full_access"
            elif state["configured_mode"] == "full_access":
                state["effective_mode"] = "ask_every_time"
                state["requested_target_mode"] = "full_access"
                state["local_confirmation_required"] = True
            elif state["pairing_state"] == "paired" and not state["kill_switch"]:
                state["effective_mode"] = state["configured_mode"]
                state["local_confirmation_required"] = False
            self._advance_epoch(state)
            return _lifecycle_result(state), state
        if operation == "stop":
            self._force_off(state, clear_configured=False)
            self._advance_epoch(state)
            state = self._checkpoint(state)
            self._run_safety_effects(self._ports.transport.disconnect)
            state["transport_state"] = "disconnected"
            return _lifecycle_result(state), state
        if operation == "revoke":
            state.update(pairing_state="revoked", selected_binding=None, transport_state="revoked")
            self._force_off(state, clear_configured=True)
            self._advance_epoch(state)
            state = self._checkpoint(state)
            self._run_safety_effects(self._ports.transport.revoke, self._ports.credential.erase_active)
            return _lifecycle_result(state), state
        if operation == "activate_kill_switch":
            state.update(kill_switch=True, transport_state="blocked")
            self._force_off(state, clear_configured=True)
            self._advance_epoch(state)
            state = self._checkpoint(state)
            self._run_safety_effects(self._ports.transport.block)
            return _lifecycle_result(state), state
        if operation == "shutdown":
            if state["effective_mode"] != "off" or state["transport_state"] in {"connected", "connecting"}:
                raise HostError("stop_required_before_shutdown")
            state["shutdown"] = True
            state = self._checkpoint(state)
            self._run_safety_effects(self._ports.transport.disconnect)
            state["transport_state"] = "disconnected"
            return _lifecycle_result(state), state
        raise HostError("unknown_operation")

    def _pair(
        self, request: Mapping[str, Any], state: dict[str, Any]
    ) -> tuple[Mapping[str, Any], dict[str, Any]]:
        if state["kill_switch"] or state["pairing_state"] == "revoked":
            raise HostError("pairing_blocked")
        try:
            claim = dict(
                self._ports.pairing.claim(request["pairing_code"], request["local_installation_nonce"])
            )
            if set(claim) != {"binding", "confirmed"} or claim.get("confirmed") is not True:
                raise HostError("pairing_confirmation_required")
            binding = _validate_binding(claim.get("binding"))
        except HostError:
            raise
        except Exception as error:
            raise HostError("stolen_pairing_code") from error
        state.update(
            pairing_state="paired",
            configured_mode="ask_every_time",
            effective_mode="off",
            requested_target_mode=None,
            selected_binding=binding,
            transport_state="disconnected",
            local_confirmation_required=False,
            confirmed_runtime_instance_id=None,
            confirmed_policy_epoch=None,
            confirmed_binding_fingerprint_sha256=None,
        )
        self._advance_epoch(state)
        return _pairing_result(state), state

    def _set_access_mode(
        self, request: Mapping[str, Any], state: dict[str, Any]
    ) -> tuple[Mapping[str, Any], dict[str, Any]]:
        target = request["target_mode"]
        if state["pairing_state"] != "paired" and target != "off":
            raise HostError("access_requires_pairing")
        if state["kill_switch"] and target != "off":
            raise HostError("kill_switch_active")
        state["configured_mode"] = target
        state["requested_target_mode"] = target
        self._advance_epoch(state)
        self._clear_full_access_confirmation(state)
        if target == "off" or state["paused"] or state["transport_state"] != "connected":
            state["effective_mode"] = "off"
            state["local_confirmation_required"] = target == "full_access"
            if target == "off":
                state = self._checkpoint(state)
                self._run_safety_effects()
        elif target == "ask_every_time":
            state["effective_mode"] = "ask_every_time"
            state["local_confirmation_required"] = False
        elif self._ports.authority.confirm_full_access(state):
            state["effective_mode"] = "full_access"
            state["local_confirmation_required"] = False
            state["confirmed_runtime_instance_id"] = state["runtime_instance_id"]
            state["confirmed_policy_epoch"] = state["policy_epoch"]
            state["confirmed_binding_fingerprint_sha256"] = state["selected_binding"][
                "binding_fingerprint_sha256"
            ]
        else:
            state["effective_mode"] = "ask_every_time"
            state["local_confirmation_required"] = True
        return _lifecycle_result(state, requested_target_mode=target), state

    def _dispatch_action(
        self, request: Mapping[str, Any], state: dict[str, Any]
    ) -> tuple[Mapping[str, Any], dict[str, Any]]:
        envelope = request["envelope"]
        reason = self._preapproval_rejection(envelope, state)
        terminal_grant_reason = reason if reason in {"grant_expired", "grant_revoked"} else None
        if reason is None and not self._ports.replay.burn(envelope):
            reason = "replayed_command"
        if reason is None:
            reason = self._ports.authority.approve_action(envelope, state)
        native_action: NativeActionPort | None = None
        decision: Mapping[str, Any]
        with self._authority_lock:
            if reason is None or terminal_grant_reason is not None:
                latest = self._ports.state.load()
                if not _state_is_valid(latest):
                    raise HostError("invalid_runtime_state")
                state = latest
                reason = self._preapproval_rejection(envelope, state)
                terminal_grant_reason = reason if reason in {"grant_expired", "grant_revoked"} else None
                if terminal_grant_reason is not None:
                    state = self._expire_grant(state)
            if reason is not None:
                decision = self._write_decision(envelope, allowed=False, reason_code=reason, state=state)
                if terminal_grant_reason is not None:
                    raise HostError(terminal_grant_reason, audit_id=str(decision["audit_id"]))
                return _action_result(envelope, "denied", decision, None), state

            decision = self._write_decision(envelope, allowed=True, reason_code="policy_allowed", state=state)
            try:
                native_action = self._ports.native.begin(envelope)
                if not isinstance(native_action, NativeActionPort):
                    raise TypeError("native begin did not return a waitable action")
            except Exception:
                state = self._persist_fail_closed(state)

        if native_action is None:
            outcome = "failed"
        else:
            try:
                execution = dict(native_action.wait())
                outcome = str(execution.get("outcome") or "executed")
                if outcome not in {"executed", "failed", "stopped"}:
                    outcome = "failed"
            except Exception:
                outcome = "failed"
        with self._authority_lock:
            latest = self._ports.state.load()
            if not _state_is_valid(latest):
                self._run_safety_effects(self._ports.transport.block)
                raise HostError("invalid_runtime_state")
            state = latest
            completion_rejection = self._preapproval_rejection(envelope, state)
            if completion_rejection is not None:
                if completion_rejection in {"grant_expired", "grant_revoked"}:
                    state = self._expire_grant(state)
                outcome = "stopped"
            elif outcome == "failed":
                state = self._persist_fail_closed(state)

        try:
            result_anchor = self._audit_cursor()
            result = dict(
                self._ports.audit.command_result(
                    envelope,
                    decision=decision,
                    outcome=outcome,
                    reason_code="approved_exact_scope",
                    detail_code={
                        "executed": "actuation_succeeded",
                        "failed": "actuation_failed",
                        "stopped": "actuation_cancelled",
                    }[outcome],
                )
            )
            _validate_audit_receipt(
                result,
                envelope,
                event_type="command_result",
                outcome=outcome,
                causation=decision,
                previous_cursor=result_anchor,
                expected_reason_code="approved_exact_scope",
                expected_detail_code={
                    "executed": "actuation_succeeded",
                    "failed": "actuation_failed",
                    "stopped": "actuation_cancelled",
                }[outcome],
            )
            self._require_committed_audit(result)
        except Exception as error:
            with self._authority_lock:
                latest = self._ports.state.load()
                if _state_is_valid(latest):
                    state = self._persist_fail_closed(latest)
                else:
                    self._run_safety_effects(self._ports.transport.block)
            raise HostError(
                "action_result_audit_failed", audit_id=str(decision.get("audit_id") or "") or None
            ) from error
        return _action_result(envelope, outcome, decision, result), state

    def _preapproval_rejection(self, envelope: Mapping[str, Any], state: Mapping[str, Any]) -> str | None:
        if state["pairing_state"] != "paired" or state["selected_binding"] is None:
            return "not_paired"
        if state["paused"] or state["kill_switch"] or state["effective_mode"] == "off":
            return "access_off"
        if state["transport_state"] != "connected":
            return "transport_unavailable"
        if envelope.get("policy_epoch") != state["policy_epoch"]:
            return "stale_command_policy_epoch"
        if not _bindings_equal(envelope.get("binding"), state["selected_binding"]):
            return "selected_binding_mismatch"
        if not self._ports.identity.runtime_is_current(state):
            return "runtime_identity_mismatch"
        if not self._ports.audit.anchor_healthy():
            return "audit_anchor_unhealthy"
        clock_rejection = self._ports.clock.validate_authority_window(envelope)
        if clock_rejection is not None:
            return clock_rejection
        return self._ports.authority.validate_action(envelope, state)

    def _expire_grant(self, state: dict[str, Any]) -> dict[str, Any]:
        state.update(pairing_state="revoked", selected_binding=None, transport_state="revoked")
        self._force_off(state, clear_configured=True)
        self._advance_epoch(state)
        state = self._checkpoint(state)
        try:
            self._run_safety_effects(self._ports.transport.revoke, self._ports.credential.erase_active)
        except Exception:
            pass
        return state

    def _write_decision(
        self,
        envelope: Mapping[str, Any],
        *,
        allowed: bool,
        reason_code: str,
        state: dict[str, Any],
    ) -> Mapping[str, Any]:
        try:
            audit_reason, detail_code = _decision_audit_codes(reason_code, allowed=allowed)
            decision_anchor = self._audit_cursor()
            decision = dict(
                self._ports.audit.command_decision(
                    envelope,
                    allowed=allowed,
                    reason_code=audit_reason,
                    detail_code=detail_code,
                )
            )
            _validate_audit_receipt(
                decision,
                envelope,
                event_type="command_decision",
                outcome="allowed" if allowed else "denied",
                causation=None,
                previous_cursor=decision_anchor,
                expected_reason_code=audit_reason,
                expected_detail_code=detail_code,
            )
            self._require_committed_audit(decision)
            return decision
        except Exception as error:
            self._persist_fail_closed(state)
            raise HostError("audit_write_failed") from error

    def _audit_cursor(self) -> dict[str, Any] | None:
        cursor = self._ports.audit.committed_cursor()
        return _validate_audit_cursor(cursor)

    def _require_committed_audit(self, receipt: Mapping[str, Any]) -> None:
        cursor = self._audit_cursor()
        if cursor != {
            "sequence": receipt.get("sequence"),
            "record_sha256": receipt.get("record_sha256"),
        }:
            raise HostError("audit_anchor_mismatch")

    def _persist_fail_closed(self, state: dict[str, Any]) -> dict[str, Any]:
        self._force_off(state, clear_configured=False)
        state = self._checkpoint(state)
        self._run_safety_effects()
        return state

    def _commit_invalid_status_barrier(self) -> None:
        with self._authority_lock:
            state = self._ports.state.load()
            if not _state_is_valid(state):
                self._run_safety_effects(self._ports.transport.block)
                raise HostError("invalid_runtime_state")
            self._force_off(state, clear_configured=False)
            state["transport_state"] = "blocked"
            self._advance_epoch(state)
            self._checkpoint(state)
            self._run_safety_effects(self._ports.transport.block)

    def _checkpoint(self, state: Mapping[str, Any]) -> dict[str, Any]:
        self._store(state)
        return self._ports.state.load()

    def _run_safety_effects(self, *extra_effects: Any) -> None:
        first_error: Exception | None = None
        effects = (
            *extra_effects,
            self._ports.queue.clear,
            self._ports.replay.invalidate_pending,
            self._ports.native.cancel_all,
        )
        for effect in effects:
            try:
                effect()
            except Exception as error:
                if first_error is None:
                    first_error = error
        if first_error is not None:
            raise first_error

    def _emergency_fail_closed(self, state: dict[str, Any] | None) -> None:
        if state is None:
            try:
                state = self._ports.state.load()
            except Exception:
                return
        self._force_off(state, clear_configured=False)
        try:
            self._store(state)
        except Exception:
            pass
        try:
            self._run_safety_effects(self._ports.transport.block)
        except Exception:
            pass

    @staticmethod
    def _force_off(state: dict[str, Any], *, clear_configured: bool) -> None:
        state["effective_mode"] = "off"
        if clear_configured:
            state["configured_mode"] = "off"
        state["requested_target_mode"] = (
            "full_access" if not clear_configured and state.get("configured_mode") == "full_access" else None
        )
        state["local_confirmation_required"] = (
            not clear_configured and state.get("configured_mode") == "full_access"
        )
        CoreHost._clear_full_access_confirmation(state)

    @staticmethod
    def _clear_full_access_confirmation(state: dict[str, Any]) -> None:
        state["confirmed_runtime_instance_id"] = None
        state["confirmed_policy_epoch"] = None
        state["confirmed_binding_fingerprint_sha256"] = None

    @staticmethod
    def _advance_epoch(state: dict[str, Any]) -> None:
        if not _safe_nonnegative(state.get("policy_epoch")) or state["policy_epoch"] >= SAFE_INTEGER_MAX:
            raise HostError("policy_epoch_exhausted")
        state["policy_epoch"] += 1


def _validate_request(request: Any) -> dict[str, Any]:
    if not isinstance(request, Mapping):
        raise HostError("invalid_request")
    operation = request.get("operation")
    if operation not in OPERATIONS:
        raise HostError("unknown_operation")
    common = {"schema_version", "request_id", "host_session_id", "sequence", "operation", "expected_policy_epoch"}
    extras = {
        "pair": {"pairing_code", "local_installation_nonce"},
        "connect": {"binding"},
        "set_access_mode": {"target_mode"},
        "dispatch_action": {"envelope"},
        "audit_summary": {"after_cursor", "limit"},
    }.get(operation, set())
    if set(request) != common | extras:
        raise HostError("invalid_request_fields")
    if request.get("schema_version") != REQUEST_SCHEMA:
        raise HostError("unsupported_schema")
    if not _identifier(request.get("request_id")) or not _identifier(request.get("host_session_id")):
        raise HostError("invalid_request_identity")
    if not _safe_positive(request.get("sequence")):
        raise HostError("invalid_sequence")
    if operation == "status":
        if request.get("expected_policy_epoch") is not None:
            raise HostError("status_epoch_must_be_null")
    elif not _safe_nonnegative(request.get("expected_policy_epoch")):
        raise HostError("invalid_policy_epoch")
    normalized = copy.deepcopy(dict(request))
    if operation == "pair":
        if not isinstance(request.get("pairing_code"), str) or not _PAIRING_CODE.fullmatch(request["pairing_code"]):
            raise HostError("invalid_pairing_code")
        nonce = request.get("local_installation_nonce")
        if not isinstance(nonce, str) or not _INSTALLATION_NONCE.fullmatch(nonce):
            raise HostError("invalid_installation_nonce")
    elif operation == "connect":
        normalized["binding"] = _validate_binding(request.get("binding"))
    elif operation == "set_access_mode" and request.get("target_mode") not in ACCESS_MODES:
        raise HostError("invalid_access_mode")
    elif operation == "dispatch_action":
        normalized["envelope"] = _validate_envelope(request.get("envelope"))
        if request["expected_policy_epoch"] != normalized["envelope"]["policy_epoch"]:
            raise HostError("stale_command_policy_epoch")
    elif operation == "audit_summary":
        normalized["after_cursor"] = _validate_audit_cursor(request.get("after_cursor"))
        if not isinstance(request.get("limit"), int) or isinstance(request.get("limit"), bool) or not 1 <= request["limit"] <= 100:
            raise HostError("invalid_audit_limit")
    return normalized


def _validate_audit_cursor(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    cursor = _strict_mapping(value, {"sequence", "record_sha256"}, "invalid_audit_cursor")
    if not _safe_positive(cursor.get("sequence")) or not _sha256(cursor.get("record_sha256")):
        raise HostError("invalid_audit_cursor")
    return copy.deepcopy(cursor)


def _validate_envelope(value: Any) -> dict[str, Any]:
    envelope = _strict_mapping(
        value,
        {
            "schema_version",
            "message_type",
            "session_id",
            "channel_generation_id",
            "command_id",
            "issued_at",
            "expires_at",
            "sequence",
            "policy_epoch",
            "nonce",
            "binding",
            "execution_context",
            "command",
            "authorization",
        },
        "invalid_command_envelope",
    )
    if envelope.get("schema_version") != "evaos.mac_access.broker_control.v1" or envelope.get("message_type") != "command":
        raise HostError("invalid_command_envelope")
    for field in ("session_id", "channel_generation_id", "command_id"):
        if not _identifier(envelope.get(field)):
            raise HostError("invalid_command_envelope")
    if not _safe_positive(envelope.get("sequence")) or not _safe_nonnegative(envelope.get("policy_epoch")):
        raise HostError("invalid_command_envelope")
    if not _base64url(envelope.get("nonce")):
        raise HostError("invalid_command_envelope")
    issued_at = _instant(envelope.get("issued_at"), "invalid_command_envelope")
    expires_at = _instant(envelope.get("expires_at"), "invalid_command_envelope")
    if expires_at <= issued_at or (expires_at - issued_at).total_seconds() > 60:
        raise HostError("invalid_command_envelope")

    binding = _validate_binding(envelope.get("binding"))
    grant_expires_at = _instant(binding["grant_expires_at"], "invalid_command_envelope")
    if expires_at >= grant_expires_at:
        raise HostError("invalid_command_envelope")

    execution_context = _strict_mapping(
        envelope.get("execution_context"),
        {"claims", "payload_base64url", "payload_sha256", "signature_base64url", "key_id"},
        "invalid_command_envelope",
    )
    claims = _strict_mapping(
        execution_context.get("claims"),
        {
            "schema_version",
            "key_id",
            "runtime",
            "customer_id",
            "customer_vm_id",
            "binding_id",
            "binding_version",
            "issued_at",
            "expires_at",
            "context_id",
        },
        "invalid_command_envelope",
    )
    if claims.get("schema_version") != "evaos.mac_control_execution_context.v1":
        raise HostError("invalid_command_envelope")
    for field in ("key_id", "customer_id", "customer_vm_id", "binding_id", "binding_version"):
        if not _identifier(claims.get(field)):
            raise HostError("invalid_command_envelope")
    if claims.get("runtime") not in {"openclaw", "hermes"}:
        raise HostError("invalid_command_envelope")
    if not _safe_nonnegative(claims.get("issued_at")) or not _safe_positive(claims.get("expires_at")):
        raise HostError("invalid_command_envelope")
    if claims["expires_at"] <= claims["issued_at"] or not _base64url(claims.get("context_id")):
        raise HostError("invalid_command_envelope")
    if (
        not _base64url(execution_context.get("payload_base64url"))
        or not _sha256(execution_context.get("payload_sha256"))
        or not _base64url(execution_context.get("signature_base64url"))
        or not _identifier(execution_context.get("key_id"))
        or execution_context["key_id"] != claims["key_id"]
    ):
        raise HostError("invalid_command_envelope")
    for field in ("runtime", "customer_id", "customer_vm_id", "binding_id", "binding_version"):
        if claims[field] != binding[field]:
            raise HostError("invalid_command_envelope")
    if issued_at.timestamp() < claims["issued_at"] or expires_at.timestamp() > claims["expires_at"]:
        raise HostError("invalid_command_envelope")

    command = _strict_mapping(
        envelope.get("command"),
        {"capability", "request", "request_digest_sha256"},
        "invalid_command_envelope",
    )
    if command.get("capability") not in _CAPABILITIES or not _sha256(command.get("request_digest_sha256")):
        raise HostError("invalid_command_envelope")
    if not isinstance(command.get("request"), Mapping):
        raise HostError("invalid_command_envelope")
    _canonical_json(command["request"], "invalid_command_envelope")

    authorization = _strict_mapping(
        envelope.get("authorization"),
        {"schema_version", "canonicalization", "payload", "payload_sha256", "key_id", "signature_base64url"},
        "invalid_command_envelope",
    )
    if (
        authorization.get("schema_version") != "evaos.mac_access.command_authorization.v1"
        or authorization.get("canonicalization") != "RFC8785-JCS"
        or not _sha256(authorization.get("payload_sha256"))
        or not _identifier(authorization.get("key_id"))
        or not _base64url(authorization.get("signature_base64url"))
    ):
        raise HostError("invalid_command_envelope")
    authority = _strict_mapping(
        authorization.get("payload"),
        {
            "schema_version",
            "domain",
            "session_id",
            "channel_generation_id",
            "command_id",
            "issued_at",
            "expires_at",
            "sequence",
            "policy_epoch",
            "nonce",
            "binding",
            "execution_context_sha256",
            "capability",
            "request_digest_sha256",
        },
        "invalid_command_envelope",
    )
    if authority.get("schema_version") != "evaos.mac_access.command_authority_payload.v1" or authority.get("domain") != "evaos.mac-access/command-authority/v1":
        raise HostError("invalid_command_envelope")
    for field in ("session_id", "channel_generation_id", "command_id"):
        if not _identifier(authority.get(field)):
            raise HostError("invalid_command_envelope")
    if (
        not _safe_positive(authority.get("sequence"))
        or not _safe_nonnegative(authority.get("policy_epoch"))
        or not _base64url(authority.get("nonce"))
        or not _sha256(authority.get("execution_context_sha256"))
        or authority.get("capability") not in _CAPABILITIES
        or not _sha256(authority.get("request_digest_sha256"))
    ):
        raise HostError("invalid_command_envelope")
    _instant(authority.get("issued_at"), "invalid_command_envelope")
    _instant(authority.get("expires_at"), "invalid_command_envelope")
    authority_binding = _validate_binding(authority.get("binding"))
    if hashlib.sha256(_canonical_json(authority, "invalid_command_envelope")).hexdigest() != authorization["payload_sha256"]:
        raise HostError("invalid_command_envelope")
    mirror_fields = (
        "session_id",
        "channel_generation_id",
        "command_id",
        "issued_at",
        "expires_at",
        "sequence",
        "policy_epoch",
        "nonce",
    )
    if any(authority[field] != envelope[field] for field in mirror_fields):
        raise HostError("invalid_command_envelope")
    if (
        not _bindings_equal(authority_binding, binding)
        or authority["execution_context_sha256"] != execution_context["payload_sha256"]
        or authority["capability"] != command["capability"]
        or authority["request_digest_sha256"] != command["request_digest_sha256"]
    ):
        raise HostError("invalid_command_envelope")
    encoded = _canonical_json(envelope, "invalid_command_envelope")
    if len(encoded) > 65_536:
        raise HostError("invalid_command_envelope")
    return copy.deepcopy(dict(envelope))


def _validate_audit_receipt(
    receipt: Any,
    envelope: Mapping[str, Any],
    *,
    event_type: str,
    outcome: str,
    causation: Mapping[str, Any] | None,
    previous_cursor: Mapping[str, Any] | None,
    expected_reason_code: str,
    expected_detail_code: str | None,
) -> None:
    _validate_audit_event(receipt)
    command = envelope["command"]
    if (
        not _identifier(receipt.get("audit_id"))
        or receipt.get("event_type") != event_type
        or receipt.get("outcome") != outcome
        or receipt.get("command_id") != envelope["command_id"]
        or receipt.get("request_digest_sha256") != command["request_digest_sha256"]
        or receipt.get("binding_fingerprint_sha256") != envelope["binding"]["binding_fingerprint_sha256"]
        or receipt.get("reason_code") != expected_reason_code
        or receipt.get("evidence", {}).get("detail_code") != expected_detail_code
    ):
        raise HostError("invalid_audit_receipt")
    if causation is None:
        if receipt.get("causation_audit_id") is not None:
            raise HostError("invalid_audit_receipt")
    elif (
        receipt.get("causation_audit_id") != causation.get("audit_id")
        or not _safe_positive(receipt.get("sequence"))
        or not _safe_positive(causation.get("sequence"))
        or receipt["sequence"] <= causation["sequence"]
    ):
        raise HostError("invalid_audit_receipt")
    expected_sequence = 1 if previous_cursor is None else previous_cursor["sequence"] + 1
    expected_previous = None if previous_cursor is None else previous_cursor["record_sha256"]
    if receipt.get("sequence") != expected_sequence or receipt.get("previous_record_sha256") != expected_previous:
        raise HostError("invalid_audit_receipt")


def _decision_audit_codes(reason_code: str, *, allowed: bool) -> tuple[str, str | None]:
    if allowed:
        return "approved_exact_scope", None
    mapping = {
        "not_paired": ("denied_access_off", None),
        "access_off": ("denied_access_off", None),
        "transport_unavailable": ("denied_transport", "transport_unavailable"),
        "broker_authority_offline": ("denied_transport", "transport_unavailable"),
        "stale_command_policy_epoch": ("denied_policy_epoch", "policy_epoch_stale"),
        "selected_binding_mismatch": ("denied_binding_mismatch", "binding_mismatch"),
        "runtime_identity_mismatch": ("denied_binding_mismatch", "binding_mismatch"),
        "audit_anchor_unhealthy": ("denied_audit_unhealthy", "anchor_unavailable"),
        "replayed_command": ("denied_replay", "command_replayed"),
        "execution_context_digest_or_signature_mismatch": ("denied_approval", None),
        "request_digest_mismatch": ("denied_approval", "request_digest_mismatch"),
        "grant_revoked": ("grant_expired", "grant_expired"),
        "grant_expired": ("grant_expired", "grant_expired"),
        "approval_denied": ("denied_approval", "approval_rejected"),
        "approval_expired": ("denied_approval", "approval_expired"),
        "tcc_unavailable": ("denied_tcc", "tcc_unavailable"),
        "expired_authority": ("denied_expired_authority", "command_expired"),
    }
    return mapping.get(reason_code, ("denied_approval", None))


def _validate_audit_summary(summary: Any, after_cursor: Any, limit: int) -> None:
    value = _strict_mapping(
        summary,
        {"kind", "page_anchor", "events", "causal_decisions", "next_cursor"},
        "invalid_audit_summary",
    )
    if value.get("kind") != "audit_summary" or value.get("page_anchor") != after_cursor:
        raise HostError("invalid_audit_summary")
    events = value.get("events")
    decisions = value.get("causal_decisions")
    if (
        not isinstance(events, list)
        or not isinstance(decisions, list)
        or len(events) > limit
        or len(decisions) > 1
    ):
        raise HostError("invalid_audit_summary")
    if not audit_value_is_redacted(value):
        raise HostError("unsafe_audit_summary")
    for event in [*events, *decisions]:
        _validate_audit_event(event)
    previous_sequence = after_cursor.get("sequence") if isinstance(after_cursor, Mapping) else None
    previous_digest = after_cursor.get("record_sha256") if isinstance(after_cursor, Mapping) else None
    for event in events:
        if not isinstance(event, Mapping) or not _safe_positive(event.get("sequence")) or not _sha256(event.get("record_sha256")):
            raise HostError("invalid_audit_summary")
        if previous_sequence is not None and event["sequence"] != previous_sequence + 1:
            raise HostError("invalid_audit_summary")
        if event.get("previous_record_sha256") != previous_digest:
            raise HostError("invalid_audit_summary")
        previous_sequence = event["sequence"]
        previous_digest = event["record_sha256"]
    next_cursor = _validate_audit_cursor(value.get("next_cursor"))
    expected_cursor = (
        {"sequence": previous_sequence, "record_sha256": previous_digest}
        if events
        else None
    )
    if next_cursor != expected_cursor:
        raise HostError("invalid_audit_summary")
    for decision in decisions:
        if (
            decision.get("event_type") != "command_decision"
            or not isinstance(after_cursor, Mapping)
            or decision.get("sequence") != after_cursor.get("sequence")
            or decision.get("record_sha256") != after_cursor.get("record_sha256")
        ):
            raise HostError("invalid_audit_summary")
    decision_by_id = {
        item.get("audit_id"): item
        for item in [*events, *decisions]
        if isinstance(item, Mapping) and item.get("event_type") == "command_decision"
    }
    for event in events:
        if not isinstance(event, Mapping) or event.get("event_type") != "command_result":
            continue
        decision = decision_by_id.get(event.get("causation_audit_id"))
        if (
            not isinstance(decision, Mapping)
            or decision.get("outcome") != "allowed"
            or decision.get("sequence", 0) >= event.get("sequence", 0)
            or decision.get("command_id") != event.get("command_id")
            or decision.get("request_digest_sha256") != event.get("request_digest_sha256")
            or decision.get("binding_fingerprint_sha256") != event.get("binding_fingerprint_sha256")
        ):
            raise HostError("invalid_audit_summary")


def _validate_audit_event(value: Any) -> dict[str, Any]:
    event = _strict_mapping(value, set(_AUDIT_EVENT_FIELDS), "invalid_audit_receipt")
    if not audit_value_is_redacted(event):
        raise HostError("unsafe_audit_receipt")
    if (
        event.get("schema_version") != "evaos.mac_access.audit_event.v1"
        or not _identifier(event.get("audit_id"))
        or not _safe_positive(event.get("sequence"))
        or event.get("event_type") not in _AUDIT_EVENT_TYPES
        or event.get("access_mode") not in ACCESS_MODES
        or event.get("outcome") not in _AUDIT_OUTCOMES
        or event.get("reason_code") not in _AUDIT_REASON_CODES
        or not _sha256(event.get("record_sha256"))
    ):
        raise HostError("invalid_audit_receipt")
    _instant(event.get("occurred_at"), "invalid_audit_receipt")
    if event["sequence"] == 1:
        if event.get("previous_record_sha256") is not None:
            raise HostError("invalid_audit_receipt")
    elif not _sha256(event.get("previous_record_sha256")):
        raise HostError("invalid_audit_receipt")

    actor = _strict_mapping(event.get("actor"), {"kind", "identity"}, "invalid_audit_receipt")
    actor_identities = {
        "local_user": {"console_user"},
        "workbench": {"workbench_main"},
        "broker_runtime": {"openclaw", "hermes"},
        "system": {"audit_subsystem", "connector_core", "policy_engine", "updater"},
    }
    if actor.get("identity") not in actor_identities.get(actor.get("kind"), set()):
        raise HostError("invalid_audit_receipt")

    binding = event.get("binding_fingerprint_sha256")
    command_id = event.get("command_id")
    request_digest = event.get("request_digest_sha256")
    causation = event.get("causation_audit_id")
    if binding is not None and not _sha256(binding):
        raise HostError("invalid_audit_receipt")
    if command_id is not None and not _identifier(command_id):
        raise HostError("invalid_audit_receipt")
    if request_digest is not None and not _sha256(request_digest):
        raise HostError("invalid_audit_receipt")
    if causation is not None and not _identifier(causation):
        raise HostError("invalid_audit_receipt")

    command_event = event["event_type"] in {"command_decision", "command_result"}
    if command_event and (binding is None or command_id is None or request_digest is None):
        raise HostError("invalid_audit_receipt")
    if not command_event and (command_id is not None or request_digest is not None or causation is not None):
        raise HostError("invalid_audit_receipt")
    if event["event_type"] == "command_decision" and (
        causation is not None or event["outcome"] not in {"allowed", "denied"}
    ):
        raise HostError("invalid_audit_receipt")
    if event["event_type"] == "command_result" and (
        causation is None
        or causation == event["audit_id"]
        or event["outcome"] not in {"executed", "failed", "stopped"}
    ):
        raise HostError("invalid_audit_receipt")

    _validate_audit_evidence(event.get("evidence"))
    payload = {key: event[key] for key in event if key != "record_sha256"}
    digest = hashlib.sha256(_canonical_json(payload, "invalid_audit_receipt")).hexdigest()
    if digest != event["record_sha256"]:
        raise HostError("invalid_audit_receipt")
    return copy.deepcopy(event)


def _validate_audit_evidence(value: Any) -> None:
    if not isinstance(value, Mapping) or not set(value).issubset(_AUDIT_EVIDENCE_FIELDS):
        raise HostError("invalid_audit_receipt")
    evidence = dict(value)
    if evidence.get("redaction_policy") != "default_v1":
        raise HostError("invalid_audit_receipt")
    if "capability" in evidence and evidence["capability"] not in _CAPABILITIES:
        raise HostError("invalid_audit_receipt")
    for key in ("target_path_hash", "target_fingerprint_sha256"):
        if key in evidence and not _sha256(evidence[key]):
            raise HostError("invalid_audit_receipt")
    for key in ("state_from", "state_to"):
        if key in evidence and evidence[key] not in _AUDIT_EVIDENCE_STATES:
            raise HostError("invalid_audit_receipt")
    if "transport_state" in evidence and evidence["transport_state"] not in _TRANSPORT_STATES:
        raise HostError("invalid_audit_receipt")
    if "detail_code" in evidence and evidence["detail_code"] not in _AUDIT_DETAIL_CODES:
        raise HostError("invalid_audit_receipt")
    if "build_version" in evidence and (
        not isinstance(evidence["build_version"], str)
        or len(evidence["build_version"]) > 128
        or re.fullmatch(r"^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$", evidence["build_version"]) is None
    ):
        raise HostError("invalid_audit_receipt")
    if "schema_version" in evidence and evidence["schema_version"] not in _AUDIT_EVIDENCE_SCHEMAS:
        raise HostError("invalid_audit_receipt")
    if "artifact_count" in evidence and (
        not isinstance(evidence["artifact_count"], int)
        or isinstance(evidence["artifact_count"], bool)
        or not 0 <= evidence["artifact_count"] <= 16
    ):
        raise HostError("invalid_audit_receipt")
    if "record_count" in evidence and (
        not isinstance(evidence["record_count"], int)
        or isinstance(evidence["record_count"], bool)
        or not 0 <= evidence["record_count"] <= 10_000
    ):
        raise HostError("invalid_audit_receipt")


def _validate_local_status(value: Any, host_state: Mapping[str, Any]) -> None:
    status = _strict_mapping(
        value,
        {"schema_version", "observed_at", "leader", "keychain", "relay_authorization", "access", "transport", "tcc", "audit"},
        "invalid_local_status",
    )
    if status.get("schema_version") != "evaos.mac_access.local_status.v1":
        raise HostError("invalid_local_status")
    _instant(status.get("observed_at"), "invalid_local_status")

    leader = _strict_mapping(
        status.get("leader"),
        {
            "runtime_instance_id", "pid", "app_bundle_id", "helper_service_id", "connector_service_id",
            "team_id", "app_designated_requirement_sha256", "helper_designated_requirement_sha256",
            "connector_designated_requirement_sha256", "build",
        },
        "invalid_local_status",
    )
    if (
        not _identifier(leader.get("runtime_instance_id"))
        or not _safe_positive(leader.get("pid"))
        or leader.get("app_bundle_id") != "com.evaos.mac-access"
        or leader.get("helper_service_id") != "com.evaos.mac-access.helper"
        or leader.get("connector_service_id") != "com.evaos.mac-access.connector"
        or leader.get("team_id") != "TC6MS3T6NN"
        or leader.get("app_designated_requirement_sha256") != "da635352f249b4213aa1a96c41d7979d8b25d86b056b9f0929c1b414e35896fb"
        or leader.get("helper_designated_requirement_sha256") != "222107bb855cfc463805777c76ca8cfdac0d1145957c5f190c234e52bfd277aa"
        or leader.get("connector_designated_requirement_sha256") != "0c3de778270de5b4a1992d0e13d4f27e41929c7ace94ae143bcba92a555be422"
    ):
        raise HostError("invalid_local_status")
    build = _validate_build_identity(leader.get("build"), rollback=False)

    keychain = _strict_mapping(
        status.get("keychain"),
        {"custodian_signing_identifier", "access_group_suffix", "credential_security_epoch", "service", "accessibility", "synchronizable", "exportable_private_key"},
        "invalid_local_status",
    )
    if (
        keychain.get("custodian_signing_identifier") != "com.evaos.mac-access.helper"
        or not _safe_positive(keychain.get("credential_security_epoch"))
        or keychain.get("access_group_suffix") != f"com.evaos.mac-access.credentials.epoch-{keychain.get('credential_security_epoch')}"
        or keychain.get("service") != "com.evaos.mac-access.connector-credential"
        or keychain.get("accessibility") != "kSecAttrAccessibleWhenUnlockedThisDeviceOnly"
        or keychain.get("synchronizable") is not False
        or keychain.get("exportable_private_key") is not False
    ):
        raise HostError("invalid_local_status")

    relay = _strict_mapping(
        status.get("relay_authorization"),
        {"accepted_build_version", "accepted_source_commit", "accepted_security_epoch", "credential_security_epoch", "verified_pre_rollback_source", "rollback_authorization"},
        "invalid_local_status",
    )
    if (
        not _identifier(relay.get("accepted_build_version"))
        or not isinstance(relay.get("accepted_source_commit"), str)
        or re.fullmatch(r"^[a-f0-9]{40}$", relay["accepted_source_commit"]) is None
        or not _safe_positive(relay.get("accepted_security_epoch"))
        or not _safe_positive(relay.get("credential_security_epoch"))
    ):
        raise HostError("invalid_local_status")
    rollback_source = relay.get("verified_pre_rollback_source")
    if rollback_source is not None:
        _validate_build_identity(rollback_source, rollback=True)
    rollback_authorization = relay.get("rollback_authorization")
    if rollback_authorization is not None:
        _validate_rollback_authorization(rollback_authorization)

    access = _strict_mapping(
        status.get("access"),
        {
            "schema_version", "runtime_instance_id", "state_security_epoch", "minimum_reader_security_epoch",
            "minimum_writer_security_epoch", "minimum_reader_schema_version", "minimum_writer_schema_version",
            "policy_epoch", "pairing_state", "configured_mode", "effective_mode", "paused", "kill_switch",
            "local_confirmation_required", "confirmed_runtime_instance_id", "confirmed_policy_epoch",
            "confirmed_binding_fingerprint_sha256", "binding", "changed_at", "reason_code",
        },
        "invalid_local_status",
    )
    if (
        access.get("schema_version") != "evaos.mac_access.access_state.v1"
        or access.get("runtime_instance_id") != leader["runtime_instance_id"]
        or access.get("runtime_instance_id") != host_state.get("runtime_instance_id")
        or not all(_safe_nonnegative(access.get(key)) for key in ("state_security_epoch", "minimum_reader_security_epoch", "minimum_writer_security_epoch", "policy_epoch"))
        or not all(_safe_positive(access.get(key)) for key in ("minimum_reader_schema_version", "minimum_writer_schema_version"))
        or access.get("pairing_state") not in {"unpaired", "paired", "revoked"}
        or access.get("configured_mode") not in ACCESS_MODES
        or access.get("effective_mode") not in ACCESS_MODES
        or not isinstance(access.get("paused"), bool)
        or not isinstance(access.get("kill_switch"), bool)
        or not isinstance(access.get("local_confirmation_required"), bool)
        or access.get("reason_code") not in _ACCESS_REASON_CODES
    ):
        raise HostError("invalid_local_status")
    _instant(access.get("changed_at"), "invalid_local_status")
    binding = access.get("binding")
    if binding is not None:
        binding = _validate_binding(binding)
    for key in ("confirmed_runtime_instance_id",):
        if access.get(key) is not None and not _identifier(access[key]):
            raise HostError("invalid_local_status")
    if access.get("confirmed_policy_epoch") is not None and not _safe_nonnegative(access["confirmed_policy_epoch"]):
        raise HostError("invalid_local_status")
    if access.get("confirmed_binding_fingerprint_sha256") is not None and not _sha256(access["confirmed_binding_fingerprint_sha256"]):
        raise HostError("invalid_local_status")
    if access["policy_epoch"] != host_state.get("policy_epoch"):
        raise HostError("invalid_local_status")
    if access["pairing_state"] != host_state.get("pairing_state") or not _bindings_equal_or_none(binding, host_state.get("selected_binding")):
        raise HostError("invalid_local_status")
    if access["configured_mode"] != host_state.get("configured_mode") or access["effective_mode"] != host_state.get("effective_mode"):
        raise HostError("invalid_local_status")
    if access["paused"] != host_state.get("paused") or access["kill_switch"] != host_state.get("kill_switch"):
        raise HostError("invalid_local_status")
    if access["local_confirmation_required"] != host_state.get("local_confirmation_required"):
        raise HostError("invalid_local_status")
    if (
        access.get("confirmed_runtime_instance_id") != host_state.get("confirmed_runtime_instance_id")
        or access.get("confirmed_policy_epoch") != host_state.get("confirmed_policy_epoch")
        or access.get("confirmed_binding_fingerprint_sha256")
        != host_state.get("confirmed_binding_fingerprint_sha256")
    ):
        raise HostError("invalid_local_status")
    if access["effective_mode"] == "full_access" and (
        access.get("confirmed_runtime_instance_id") != access["runtime_instance_id"]
        or access.get("confirmed_policy_epoch") != access["policy_epoch"]
        or not isinstance(binding, Mapping)
        or access.get("confirmed_binding_fingerprint_sha256") != binding["binding_fingerprint_sha256"]
    ):
        raise HostError("invalid_local_status")
    if access["effective_mode"] != "full_access" and any(
        access.get(key) is not None
        for key in (
            "confirmed_runtime_instance_id",
            "confirmed_policy_epoch",
            "confirmed_binding_fingerprint_sha256",
        )
    ):
        raise HostError("invalid_local_status")
    if access["local_confirmation_required"] and (
        access["configured_mode"] != "full_access" or access["effective_mode"] == "full_access"
    ):
        raise HostError("invalid_local_status")

    transport = _strict_mapping(status.get("transport"), {"responsible_identity", "state", "channel_id", "last_error_code"}, "invalid_local_status")
    if (
        transport.get("responsible_identity") != "com.evaos.mac-access.helper"
        or transport.get("state") not in _TRANSPORT_STATES
        or transport.get("state") != host_state.get("transport_state")
        or (transport.get("channel_id") is not None and not _identifier(transport["channel_id"]))
        or (transport.get("last_error_code") is not None and transport["last_error_code"] not in _AUDIT_DETAIL_CODES)
    ):
        raise HostError("invalid_local_status")
    tcc = _strict_mapping(status.get("tcc"), {"responsible_identity", "accessibility", "screen_recording"}, "invalid_local_status")
    if (
        tcc.get("responsible_identity") != "com.evaos.mac-access"
        or tcc.get("accessibility") not in {"unknown", "missing", "granted", "denied"}
        or tcc.get("screen_recording") not in {"unknown", "missing", "granted", "denied"}
    ):
        raise HostError("invalid_local_status")
    audit = _strict_mapping(status.get("audit"), {"writable", "anchor_healthy", "anchor"}, "invalid_local_status")
    if not isinstance(audit.get("writable"), bool) or not isinstance(audit.get("anchor_healthy"), bool):
        raise HostError("invalid_local_status")
    anchor = _validate_audit_anchor(audit.get("anchor"))
    if (
        (not audit["writable"] or not audit["anchor_healthy"] or anchor.get("pending_sequence") is not None)
        and access["effective_mode"] != "off"
    ):
        raise HostError("invalid_local_status")
    if (tcc["accessibility"] != "granted" or tcc["screen_recording"] != "granted") and access["effective_mode"] != "off":
        raise HostError("invalid_local_status")
    if build["security_epoch"] < max(access["minimum_reader_security_epoch"], access["minimum_writer_security_epoch"]):
        raise HostError("invalid_local_status")
    if (
        access["state_security_epoch"]
        < max(access["minimum_reader_security_epoch"], access["minimum_writer_security_epoch"])
        or build["schema_reader_version"] < access["minimum_reader_schema_version"]
        or build["schema_writer_version"] < access["minimum_writer_schema_version"]
        or anchor["security_epoch"] != build["security_epoch"]
        or relay["accepted_build_version"] != build["build_version"]
        or relay["accepted_source_commit"] != build["source_commit"]
        or relay["accepted_security_epoch"] != build["security_epoch"]
        or relay["credential_security_epoch"] != relay["accepted_security_epoch"]
        or keychain["credential_security_epoch"] != relay["credential_security_epoch"]
    ):
        raise HostError("invalid_local_status")
    rollback_payload = rollback_authorization.get("payload") if isinstance(rollback_authorization, Mapping) else None
    if (rollback_payload.get("authorization_id") if isinstance(rollback_payload, Mapping) else None) != build.get(
        "rollback_authorization_id"
    ):
        raise HostError("invalid_local_status")
    if isinstance(rollback_payload, Mapping):
        if not isinstance(rollback_source, Mapping) or not _rollback_builds_equal(
            rollback_source, rollback_payload["source"]
        ):
            raise HostError("invalid_local_status")
        target = rollback_payload["target"]
        if (
            target["build_version"] != build["build_version"]
            or target["source_commit"] != build["source_commit"]
            or target["signed_lineage_id"] != build["signed_lineage_id"]
            or target["security_epoch"] != build["security_epoch"]
            or target["credential_security_epoch"] != keychain["credential_security_epoch"]
            or target["schema_reader_version"] != build["schema_reader_version"]
            or target["schema_writer_version"] != build["schema_writer_version"]
            or rollback_payload["resulting_minimum_reader_security_epoch"]
            != access["minimum_reader_security_epoch"]
            or rollback_payload["resulting_minimum_writer_security_epoch"]
            != access["minimum_writer_security_epoch"]
            or rollback_payload["resulting_minimum_reader_schema_version"]
            != access["minimum_reader_schema_version"]
            or rollback_payload["resulting_minimum_writer_schema_version"]
            != access["minimum_writer_schema_version"]
        ):
            raise HostError("invalid_local_status")
        observed_at = _instant(status["observed_at"], "invalid_local_status")
        if not (
            _instant(rollback_payload["issued_at"], "invalid_local_status")
            <= observed_at
            < _instant(rollback_payload["expires_at"], "invalid_local_status")
        ):
            raise HostError("invalid_local_status")
    elif rollback_source is not None:
        raise HostError("invalid_local_status")
    if isinstance(binding, Mapping) and _instant(status["observed_at"], "invalid_local_status") >= _instant(
        binding["grant_expires_at"], "invalid_local_status"
    ):
        raise HostError("invalid_local_status")
    connected = transport["state"] == "connected"
    if (
        connected != (transport["channel_id"] is not None)
        or (transport["state"] == "revoked" and access["pairing_state"] != "revoked")
        or (connected and (access["pairing_state"] != "paired" or binding is None))
        or (not connected and access["effective_mode"] != "off")
    ):
        raise HostError("invalid_local_status")


def _validate_build_identity(value: Any, *, rollback: bool) -> dict[str, Any]:
    fields = {"build_version", "source_commit", "signed_lineage_id", "security_epoch", "schema_reader_version", "schema_writer_version"}
    fields.add("credential_security_epoch" if rollback else "rollback_authorization_id")
    build = _strict_mapping(value, fields, "invalid_local_status")
    if (
        not _identifier(build.get("build_version"))
        or not isinstance(build.get("source_commit"), str)
        or re.fullmatch(r"^[a-f0-9]{40}$", build["source_commit"]) is None
        or not _identifier(build.get("signed_lineage_id"))
        or not _safe_nonnegative(build.get("security_epoch"))
        or not _safe_positive(build.get("schema_reader_version"))
        or not _safe_positive(build.get("schema_writer_version"))
    ):
        raise HostError("invalid_local_status")
    if rollback:
        if not _safe_positive(build.get("credential_security_epoch")):
            raise HostError("invalid_local_status")
    elif build.get("rollback_authorization_id") is not None and not _identifier(build["rollback_authorization_id"]):
        raise HostError("invalid_local_status")
    return build


def _rollback_builds_equal(left: Mapping[str, Any], right: Mapping[str, Any]) -> bool:
    return all(
        left.get(key) == right.get(key)
        for key in (
            "build_version",
            "source_commit",
            "signed_lineage_id",
            "security_epoch",
            "credential_security_epoch",
            "schema_reader_version",
            "schema_writer_version",
        )
    )


def _validate_rollback_authorization(value: Any) -> None:
    authorization = _strict_mapping(value, {"schema_version", "canonicalization", "payload", "payload_sha256", "broker_key_id", "signature_base64url"}, "invalid_local_status")
    if (
        authorization.get("schema_version") != "evaos.mac_access.signed_rollback_authorization.v1"
        or authorization.get("canonicalization") != "RFC8785-JCS"
        or not _sha256(authorization.get("payload_sha256"))
        or not _identifier(authorization.get("broker_key_id"))
        or not _base64url(authorization.get("signature_base64url"))
    ):
        raise HostError("invalid_local_status")
    payload = _strict_mapping(
        authorization.get("payload"),
        {"schema_version", "domain", "authorization_id", "source", "target", "resulting_minimum_reader_security_epoch", "resulting_minimum_writer_security_epoch", "resulting_minimum_reader_schema_version", "resulting_minimum_writer_schema_version", "issued_at", "expires_at"},
        "invalid_local_status",
    )
    if (
        payload.get("schema_version") != "evaos.mac_access.rollback_authorization_payload.v1"
        or payload.get("domain") != "evaos.mac-access/rollback-authorization/v1"
        or not _identifier(payload.get("authorization_id"))
        or not _safe_nonnegative(payload.get("resulting_minimum_reader_security_epoch"))
        or not _safe_nonnegative(payload.get("resulting_minimum_writer_security_epoch"))
        or not _safe_positive(payload.get("resulting_minimum_reader_schema_version"))
        or not _safe_positive(payload.get("resulting_minimum_writer_schema_version"))
    ):
        raise HostError("invalid_local_status")
    _validate_build_identity(payload.get("source"), rollback=True)
    _validate_build_identity(payload.get("target"), rollback=True)
    if _instant(payload.get("expires_at"), "invalid_local_status") <= _instant(payload.get("issued_at"), "invalid_local_status"):
        raise HostError("invalid_local_status")
    if hashlib.sha256(_canonical_json(payload, "invalid_local_status")).hexdigest() != authorization["payload_sha256"]:
        raise HostError("invalid_local_status")


def _validate_audit_anchor(value: Any) -> dict[str, Any]:
    anchor = _strict_mapping(
        value,
        {"schema_version", "custodian_signing_identifier", "access_group_suffix", "security_epoch", "service", "accessibility", "synchronizable", "journal_id", "committed_sequence", "committed_audit_id", "committed_record_sha256", "pending_sequence", "pending_audit_id", "pending_record_sha256"},
        "invalid_local_status",
    )
    if (
        anchor.get("schema_version") != "evaos.mac_access.audit_anchor.v1"
        or anchor.get("custodian_signing_identifier") != "com.evaos.mac-access.helper"
        or not _safe_positive(anchor.get("security_epoch"))
        or anchor.get("access_group_suffix") != f"com.evaos.mac-access.audit-anchor.epoch-{anchor.get('security_epoch')}"
        or anchor.get("service") != "com.evaos.mac-access.audit-anchor"
        or anchor.get("accessibility") != "kSecAttrAccessibleWhenUnlockedThisDeviceOnly"
        or anchor.get("synchronizable") is not False
        or not _identifier(anchor.get("journal_id"))
        or not _safe_nonnegative(anchor.get("committed_sequence"))
    ):
        raise HostError("invalid_local_status")
    committed_empty = anchor["committed_sequence"] == 0
    if committed_empty != (anchor.get("committed_audit_id") is None) or committed_empty != (anchor.get("committed_record_sha256") is None):
        raise HostError("invalid_local_status")
    if anchor.get("committed_audit_id") is not None and not _identifier(anchor["committed_audit_id"]):
        raise HostError("invalid_local_status")
    if anchor.get("committed_record_sha256") is not None and not _sha256(anchor["committed_record_sha256"]):
        raise HostError("invalid_local_status")
    pending = (anchor.get("pending_sequence"), anchor.get("pending_audit_id"), anchor.get("pending_record_sha256"))
    if any(item is not None for item in pending):
        if any(item is None for item in pending) or not _safe_positive(pending[0]) or not _identifier(pending[1]) or not _sha256(pending[2]) or pending[0] != anchor["committed_sequence"] + 1:
            raise HostError("invalid_local_status")
    return anchor


def _strict_mapping(value: Any, fields: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != fields:
        raise HostError(code)
    return dict(value)


def _canonical_json(value: Any, code: str) -> bytes:
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeError) as error:
        raise HostError(code) from error
    return encoded


def _instant(value: Any, code: str) -> datetime:
    if not isinstance(value, str):
        raise HostError(code)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise HostError(code) from error
    if parsed.tzinfo is None:
        raise HostError(code)
    return parsed


def _base64url(value: Any) -> bool:
    return isinstance(value, str) and _BASE64URL.fullmatch(value) is not None and len(value) % 4 != 1


def _sha256(value: Any) -> bool:
    return isinstance(value, str) and _SHA256.fullmatch(value) is not None


def _state_is_valid(state: Any) -> bool:
    required = {
        "revision",
        "host_session_id",
        "last_sequence",
        "policy_epoch",
        "runtime_instance_id",
        "pairing_state",
        "configured_mode",
        "effective_mode",
        "requested_target_mode",
        "paused",
        "kill_switch",
        "selected_binding",
        "transport_state",
        "shutdown",
        "local_confirmation_required",
        "confirmed_runtime_instance_id",
        "confirmed_policy_epoch",
        "confirmed_binding_fingerprint_sha256",
    }
    if not isinstance(state, Mapping) or set(state) != required:
        return False
    if (
        not _safe_nonnegative(state.get("revision"))
        or not _identifier(state.get("host_session_id"))
        or not _safe_nonnegative(state.get("last_sequence"))
        or not _safe_nonnegative(state.get("policy_epoch"))
        or (state.get("runtime_instance_id") is not None and not _identifier(state.get("runtime_instance_id")))
        or state.get("pairing_state") not in {"unpaired", "paired", "revoked"}
        or state.get("configured_mode") not in ACCESS_MODES
        or state.get("effective_mode") not in ACCESS_MODES
        or state.get("requested_target_mode") not in ACCESS_MODES | {None}
        or not isinstance(state.get("paused"), bool)
        or not isinstance(state.get("kill_switch"), bool)
        or state.get("transport_state") not in _TRANSPORT_STATES
        or not isinstance(state.get("shutdown"), bool)
        or not isinstance(state.get("local_confirmation_required"), bool)
        or (state.get("confirmed_runtime_instance_id") is not None and not _identifier(state.get("confirmed_runtime_instance_id")))
        or (state.get("confirmed_policy_epoch") is not None and not _safe_nonnegative(state.get("confirmed_policy_epoch")))
        or (state.get("confirmed_binding_fingerprint_sha256") is not None and not _sha256(state.get("confirmed_binding_fingerprint_sha256")))
    ):
        return False
    pairing_state = state["pairing_state"]
    binding = state.get("selected_binding")
    if pairing_state == "paired":
        try:
            _validate_binding(binding)
        except HostError:
            return False
    elif binding is not None or state["configured_mode"] != "off" or state["effective_mode"] != "off":
        return False
    if state["kill_switch"] and (state["configured_mode"] != "off" or state["effective_mode"] != "off"):
        return False
    mode_rank = {"off": 0, "ask_every_time": 1, "full_access": 2}
    if mode_rank[state["effective_mode"]] > mode_rank[state["configured_mode"]]:
        return False
    if state["transport_state"] != "connected" and state["effective_mode"] != "off":
        return False
    if state["transport_state"] == "connected" and pairing_state != "paired":
        return False
    if state["kill_switch"] and state["transport_state"] != "blocked":
        return False
    confirmations = (
        state.get("confirmed_runtime_instance_id"),
        state.get("confirmed_policy_epoch"),
        state.get("confirmed_binding_fingerprint_sha256"),
    )
    if state["effective_mode"] == "full_access":
        if (
            state["local_confirmation_required"]
            or state.get("runtime_instance_id") is None
            or confirmations[0] != state["runtime_instance_id"]
            or confirmations[1] != state["policy_epoch"]
            or not isinstance(binding, Mapping)
            or confirmations[2] != binding["binding_fingerprint_sha256"]
        ):
            return False
    elif any(value is not None for value in confirmations):
        return False
    if state["local_confirmation_required"] and state["configured_mode"] != "full_access":
        return False
    return True


def _validate_binding(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != _BINDING_FIELDS:
        raise HostError("invalid_selected_binding")
    binding = copy.deepcopy(dict(value))
    for field in _BINDING_FIELDS - {"runtime", "binding_fingerprint_sha256", "grant_expires_at"}:
        if not _identifier(binding.get(field)):
            raise HostError("invalid_selected_binding")
    if binding.get("runtime") not in {"openclaw", "hermes"}:
        raise HostError("invalid_selected_binding")
    _instant(binding.get("grant_expires_at"), "invalid_selected_binding")
    if not isinstance(binding.get("binding_fingerprint_sha256"), str) or not _SHA256.fullmatch(binding["binding_fingerprint_sha256"]):
        raise HostError("invalid_selected_binding")
    return binding


def _bindings_equal(left: Any, right: Any) -> bool:
    return isinstance(left, Mapping) and isinstance(right, Mapping) and all(left.get(key) == right.get(key) for key in _BINDING_FIELDS)


def _bindings_equal_or_none(left: Any, right: Any) -> bool:
    return (left is None and right is None) or _bindings_equal(left, right)


def _identifier(value: Any) -> bool:
    return isinstance(value, str) and _IDENTIFIER.fullmatch(value) is not None


def _safe_positive(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= SAFE_INTEGER_MAX


def _safe_nonnegative(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= SAFE_INTEGER_MAX


def _nonnegative(value: Any, *, default: int) -> int:
    return value if _safe_nonnegative(value) else default


def _success(request: Mapping[str, Any], policy_epoch: int, result: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": RESPONSE_SCHEMA,
        "request_id": request["request_id"],
        "host_session_id": request["host_session_id"],
        "sequence": request["sequence"],
        "operation": request["operation"],
        "ok": True,
        "policy_epoch": policy_epoch,
        "result": dict(result),
        "error": None,
    }


def _lifecycle_result(
    state: Mapping[str, Any], *, requested_target_mode: str | None = None
) -> dict[str, Any]:
    return {
        "kind": "lifecycle",
        "configured_mode": state["configured_mode"],
        "effective_mode": state["effective_mode"],
        "requested_target_mode": requested_target_mode,
        "pairing_state": state["pairing_state"],
        "transport_state": state["transport_state"],
        "selected_binding": copy.deepcopy(state.get("selected_binding")),
    }


def _pairing_result(state: Mapping[str, Any]) -> dict[str, Any]:
    binding = state.get("selected_binding")
    return {
        "kind": "pairing",
        "pairing_state": state["pairing_state"],
        "device_id": binding.get("device_id") if isinstance(binding, Mapping) else None,
        "binding_fingerprint_sha256": binding.get("binding_fingerprint_sha256") if isinstance(binding, Mapping) else None,
    }


def _action_result(
    envelope: Mapping[str, Any], outcome: str, decision: Mapping[str, Any], result: Mapping[str, Any] | None
) -> dict[str, Any]:
    command = envelope.get("command") if isinstance(envelope.get("command"), Mapping) else {}
    return {
        "kind": "action",
        "command_id": envelope.get("command_id"),
        "request_digest_sha256": command.get("request_digest_sha256"),
        "outcome": outcome,
        "decision_audit_id": decision.get("audit_id"),
        "result_audit_id": result.get("audit_id") if result is not None else None,
        "decision_audit": dict(decision),
        "result_audit": dict(result) if result is not None else None,
    }
