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


@runtime_checkable
class ReplayPort(Protocol):
    def burn(self, command_id: str, request_digest_sha256: str) -> bool: ...

    def invalidate_pending(self) -> None: ...


@runtime_checkable
class AuditPort(Protocol):
    def anchor_healthy(self) -> bool: ...

    def command_decision(
        self, envelope: Mapping[str, Any], *, allowed: bool, reason_code: str
    ) -> Mapping[str, Any]: ...

    def command_result(
        self,
        envelope: Mapping[str, Any],
        *,
        decision: Mapping[str, Any],
        outcome: str,
        reason_code: str,
    ) -> Mapping[str, Any]: ...

    def summary(self, after_cursor: Mapping[str, Any] | None, limit: int) -> Mapping[str, Any]: ...


@runtime_checkable
class NativePort(Protocol):
    def execute(self, envelope: Mapping[str, Any]) -> Mapping[str, Any]: ...

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
            "pairing_state": "unpaired",
            "configured_mode": "off",
            "effective_mode": "off",
            "requested_target_mode": None,
            "paused": False,
            "kill_switch": False,
            "selected_binding": None,
            "transport_state": "disconnected",
            "shutdown": False,
        }

    def load(self) -> dict[str, Any]:
        return copy.deepcopy(self._state)

    def compare_and_swap(self, expected_revision: int, state: Mapping[str, Any]) -> bool:
        if self._state["revision"] != expected_revision:
            return False
        replacement = copy.deepcopy(dict(state))
        replacement["revision"] = expected_revision + 1
        self._state = replacement
        return True


class CoreHost:
    """Dispatch the fixed 14-operation private host protocol."""

    def __init__(self, ports: HostPorts) -> None:
        self._ports = ports

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
            state = self._reserve_sequence(normalized)
            result, state = self._dispatch(normalized, state)
            self._store(state)
            return _success(normalized, state["policy_epoch"], result)
        except HostError as error:
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
            expected_revision = state.get("revision")
            recovered = {
                "revision": expected_revision,
                "host_session_id": request["host_session_id"],
                "last_sequence": request["sequence"],
                "policy_epoch": min(
                    _nonnegative(state.get("policy_epoch"), default=0) + 1,
                    SAFE_INTEGER_MAX,
                ),
                "pairing_state": "revoked",
                "configured_mode": "off",
                "effective_mode": "off",
                "requested_target_mode": None,
                "paused": True,
                "kill_switch": True,
                "selected_binding": None,
                "transport_state": "blocked",
                "shutdown": False,
            }
            if not self._ports.state.compare_and_swap(expected_revision, recovered):
                raise HostError("host_state_conflict")
            try:
                self._run_safety_effects(self._ports.transport.block)
            except Exception:
                pass
            raise HostError("corrupt_state_recovered_off")
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
            return {"kind": "status", "status": dict(self._ports.status.snapshot(state))}, state
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
            transport = self._ports.transport.connect(request["binding"])
            state["transport_state"] = str(transport.get("state") or "connected")
            return _lifecycle_result(state), state
        if operation == "disconnect":
            state["effective_mode"] = "off"
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
            if state["transport_state"] != "connected":
                state["effective_mode"] = "off"
                state["requested_target_mode"] = (
                    "full_access" if state["configured_mode"] == "full_access" else None
                )
            elif state["configured_mode"] == "full_access":
                state["effective_mode"] = "ask_every_time"
                state["requested_target_mode"] = "full_access"
            elif state["pairing_state"] == "paired" and not state["kill_switch"]:
                state["effective_mode"] = state["configured_mode"]
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
        if target == "off" or state["paused"] or state["transport_state"] != "connected":
            state["effective_mode"] = "off"
            if target == "off":
                state = self._checkpoint(state)
                self._run_safety_effects()
        elif target == "ask_every_time":
            state["effective_mode"] = "ask_every_time"
        elif self._ports.authority.confirm_full_access(state):
            state["effective_mode"] = "full_access"
        else:
            state["effective_mode"] = "ask_every_time"
        return _lifecycle_result(state, requested_target_mode=target), state

    def _dispatch_action(
        self, request: Mapping[str, Any], state: dict[str, Any]
    ) -> tuple[Mapping[str, Any], dict[str, Any]]:
        envelope = request["envelope"]
        command = envelope.get("command") if isinstance(envelope.get("command"), Mapping) else {}
        command_id = str(envelope.get("command_id") or "")
        request_digest = str(command.get("request_digest_sha256") or "")
        reason = self._action_rejection(envelope, state)
        if reason is None and not self._ports.replay.burn(command_id, request_digest):
            reason = "replayed_command"
        if reason is not None:
            decision = self._write_decision(envelope, allowed=False, reason_code=reason, state=state)
            return _action_result(envelope, "denied", decision, None), state

        decision = self._write_decision(envelope, allowed=True, reason_code="policy_allowed", state=state)
        try:
            execution = dict(self._ports.native.execute(envelope))
            outcome = str(execution.get("outcome") or "executed")
            if outcome not in {"executed", "failed", "stopped"}:
                outcome = "failed"
        except Exception:
            outcome = "failed"
            execution = {"reason_code": "action_failed"}
            state = self._persist_fail_closed(state)
        try:
            result = dict(
                self._ports.audit.command_result(
                    envelope,
                    decision=decision,
                    outcome=outcome,
                    reason_code=str(execution.get("reason_code") or "action_completed"),
                )
            )
            _validate_audit_receipt(
                result,
                envelope,
                event_type="command_result",
                outcome=outcome,
                causation=decision,
            )
        except Exception as error:
            self._persist_fail_closed(state)
            raise HostError(
                "action_result_audit_failed", audit_id=str(decision.get("audit_id") or "") or None
            ) from error
        return _action_result(envelope, outcome, decision, result), state

    def _action_rejection(self, envelope: Mapping[str, Any], state: Mapping[str, Any]) -> str | None:
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

    def _write_decision(
        self,
        envelope: Mapping[str, Any],
        *,
        allowed: bool,
        reason_code: str,
        state: dict[str, Any],
    ) -> Mapping[str, Any]:
        try:
            decision = dict(
                self._ports.audit.command_decision(envelope, allowed=allowed, reason_code=reason_code)
            )
            _validate_audit_receipt(
                decision,
                envelope,
                event_type="command_decision",
                outcome="allowed" if allowed else "denied",
                causation=None,
            )
            return decision
        except Exception as error:
            self._persist_fail_closed(state)
            raise HostError("audit_write_failed") from error

    def _persist_fail_closed(self, state: dict[str, Any]) -> dict[str, Any]:
        self._force_off(state, clear_configured=False)
        state = self._checkpoint(state)
        self._run_safety_effects()
        return state

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
            self._run_safety_effects()
        except Exception:
            pass

    @staticmethod
    def _force_off(state: dict[str, Any], *, clear_configured: bool) -> None:
        state["effective_mode"] = "off"
        state["requested_target_mode"] = None
        if clear_configured:
            state["configured_mode"] = "off"

    @staticmethod
    def _advance_epoch(state: dict[str, Any]) -> None:
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
) -> None:
    if not isinstance(receipt, Mapping) or not audit_value_is_redacted(receipt):
        raise HostError("unsafe_audit_receipt")
    command = envelope["command"]
    if (
        not _identifier(receipt.get("audit_id"))
        or receipt.get("event_type") != event_type
        or receipt.get("outcome") != outcome
        or receipt.get("command_id") != envelope["command_id"]
        or receipt.get("request_digest_sha256") != command["request_digest_sha256"]
        or receipt.get("binding_fingerprint_sha256") != envelope["binding"]["binding_fingerprint_sha256"]
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
    if not isinstance(events, list) or not isinstance(decisions, list) or len(events) > limit:
        raise HostError("invalid_audit_summary")
    if not audit_value_is_redacted(value):
        raise HostError("unsafe_audit_summary")
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
        "pairing_state",
        "configured_mode",
        "effective_mode",
        "requested_target_mode",
        "paused",
        "kill_switch",
        "selected_binding",
        "transport_state",
        "shutdown",
    }
    if not isinstance(state, Mapping) or set(state) != required:
        return False
    if (
        not _safe_nonnegative(state.get("revision"))
        or not _identifier(state.get("host_session_id"))
        or not _safe_nonnegative(state.get("last_sequence"))
        or not _safe_nonnegative(state.get("policy_epoch"))
        or state.get("pairing_state") not in {"unpaired", "paired", "revoked"}
        or state.get("configured_mode") not in ACCESS_MODES
        or state.get("effective_mode") not in ACCESS_MODES
        or state.get("requested_target_mode") not in ACCESS_MODES | {None}
        or not isinstance(state.get("paused"), bool)
        or not isinstance(state.get("kill_switch"), bool)
        or state.get("transport_state") not in {"disconnected", "connecting", "connected", "revoked", "blocked"}
        or not isinstance(state.get("shutdown"), bool)
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
