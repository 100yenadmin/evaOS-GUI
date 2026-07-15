"""Fail-closed, helper-launched connector-core host API.

This module is intentionally dependency-injected.  It owns request sequencing and
policy-safe lifecycle transitions, while native, transport, audit, pairing, and
status effects are supplied by the signed helper.  It must remain importable in
the private embedded Python runtime without Electron, HTTP, PATH discovery, or a
customer-managed interpreter.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass
from typing import Any, Mapping, Protocol, runtime_checkable

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
_INSTALLATION_NONCE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
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
class ActionPort(Protocol):
    def execute(self, envelope: Mapping[str, Any]) -> Mapping[str, Any]: ...

    def cancel_all(self) -> None: ...


@runtime_checkable
class StatusPort(Protocol):
    def snapshot(self, state: Mapping[str, Any]) -> Mapping[str, Any]: ...


@dataclass(frozen=True)
class HostPorts:
    state: StatePort
    pairing: PairingPort
    transport: TransportPort
    authority: AuthorityPort
    replay: ReplayPort
    audit: AuditPort
    action: ActionPort
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

    def handle(self, request: Mapping[str, Any]) -> dict[str, Any]:
        request_id = str(request.get("request_id") or "invalid-request")
        host_session_id = str(request.get("host_session_id") or "invalid-session")
        sequence = request.get("sequence") if _safe_positive(request.get("sequence")) else 1
        operation = str(request.get("operation") or "status")

        try:
            normalized = _validate_request(request)
            state = self._reserve_sequence(normalized)
            result, state = self._dispatch(normalized, state)
            self._store(state)
            return _success(normalized, state["policy_epoch"], result)
        except HostError as error:
            current = self._ports.state.load()
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

        if operation == "status":
            return {"kind": "status", "status": dict(self._ports.status.snapshot(state))}, state
        if operation == "pair":
            return self._pair(request, state)
        if operation == "unpair":
            self._safe_cancel_disconnect(state)
            state.update(pairing_state="unpaired", selected_binding=None, transport_state="disconnected")
            self._force_off(state, clear_configured=True)
            self._advance_epoch(state)
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
            self._ports.transport.disconnect()
            state["transport_state"] = "disconnected"
            state["effective_mode"] = "off"
            return _lifecycle_result(state), state
        if operation == "set_access_mode":
            return self._set_access_mode(request, state)
        if operation == "dispatch_action":
            return self._dispatch_action(request, state)
        if operation == "audit_summary":
            return dict(self._ports.audit.summary(request["after_cursor"], request["limit"])), state
        if operation == "pause":
            state["paused"] = True
            self._force_off(state, clear_configured=False)
            self._invalidate_and_cancel()
            self._advance_epoch(state)
            return _lifecycle_result(state), state
        if operation == "resume":
            state["paused"] = False
            if state["configured_mode"] == "full_access":
                state["effective_mode"] = "ask_every_time"
                state["requested_target_mode"] = "full_access"
            elif state["pairing_state"] == "paired" and not state["kill_switch"]:
                state["effective_mode"] = state["configured_mode"]
            self._advance_epoch(state)
            return _lifecycle_result(state), state
        if operation == "stop":
            self._safe_cancel_disconnect(state)
            self._force_off(state, clear_configured=False)
            self._advance_epoch(state)
            return _lifecycle_result(state), state
        if operation == "revoke":
            self._invalidate_and_cancel()
            self._ports.transport.revoke()
            state.update(pairing_state="revoked", selected_binding=None, transport_state="revoked")
            self._force_off(state, clear_configured=True)
            self._advance_epoch(state)
            return _lifecycle_result(state), state
        if operation == "activate_kill_switch":
            self._invalidate_and_cancel()
            self._ports.transport.block()
            state.update(kill_switch=True, transport_state="blocked")
            self._force_off(state, clear_configured=True)
            self._advance_epoch(state)
            return _lifecycle_result(state), state
        if operation == "shutdown":
            if state["effective_mode"] != "off" or state["transport_state"] in {"connected", "connecting"}:
                raise HostError("stop_required_before_shutdown")
            state["shutdown"] = True
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
        if target == "off" or state["paused"]:
            self._invalidate_and_cancel()
            state["effective_mode"] = "off"
        elif target == "ask_every_time":
            state["effective_mode"] = "ask_every_time"
        elif self._ports.authority.confirm_full_access(state):
            state["effective_mode"] = "full_access"
        else:
            state["effective_mode"] = "ask_every_time"
        return _lifecycle_result(state), state

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
            execution = dict(self._ports.action.execute(envelope))
            outcome = str(execution.get("outcome") or "executed")
            if outcome not in {"executed", "failed", "stopped"}:
                outcome = "failed"
            result = self._ports.audit.command_result(
                envelope,
                decision=decision,
                outcome=outcome,
                reason_code=str(execution.get("reason_code") or "action_completed"),
            )
        except Exception as error:
            self._force_off(state, clear_configured=False)
            raise HostError("action_or_result_audit_failed", audit_id=str(decision.get("audit_id") or "") or None) from error
        return _action_result(envelope, outcome, decision, result), state

    def _action_rejection(self, envelope: Mapping[str, Any], state: Mapping[str, Any]) -> str | None:
        if state["pairing_state"] != "paired" or state["selected_binding"] is None:
            return "not_paired"
        if state["paused"] or state["kill_switch"] or state["effective_mode"] == "off":
            return "access_off"
        if envelope.get("policy_epoch") != state["policy_epoch"]:
            return "stale_command_policy_epoch"
        if not _bindings_equal(envelope.get("binding"), state["selected_binding"]):
            return "selected_binding_mismatch"
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
            return dict(self._ports.audit.command_decision(envelope, allowed=allowed, reason_code=reason_code))
        except Exception as error:
            self._force_off(state, clear_configured=False)
            self._invalidate_and_cancel()
            raise HostError("audit_write_failed") from error

    def _safe_cancel_disconnect(self, state: dict[str, Any]) -> None:
        self._invalidate_and_cancel()
        self._ports.transport.disconnect()
        state["transport_state"] = "disconnected"

    def _invalidate_and_cancel(self) -> None:
        self._ports.replay.invalidate_pending()
        self._ports.action.cancel_all()

    @staticmethod
    def _force_off(state: dict[str, Any], *, clear_configured: bool) -> None:
        state["effective_mode"] = "off"
        state["requested_target_mode"] = None
        if clear_configured:
            state["configured_mode"] = "off"

    @staticmethod
    def _advance_epoch(state: dict[str, Any]) -> None:
        state["policy_epoch"] += 1


def _validate_request(request: Mapping[str, Any]) -> dict[str, Any]:
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
        if not isinstance(request.get("envelope"), Mapping):
            raise HostError("invalid_command_envelope")
        if request["expected_policy_epoch"] != request["envelope"].get("policy_epoch"):
            raise HostError("stale_command_policy_epoch")
    elif operation == "audit_summary":
        if request.get("after_cursor") is not None and not isinstance(request.get("after_cursor"), Mapping):
            raise HostError("invalid_audit_cursor")
        if not isinstance(request.get("limit"), int) or isinstance(request.get("limit"), bool) or not 1 <= request["limit"] <= 100:
            raise HostError("invalid_audit_limit")
    return normalized


def _validate_binding(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != _BINDING_FIELDS:
        raise HostError("invalid_selected_binding")
    binding = copy.deepcopy(dict(value))
    for field in _BINDING_FIELDS - {"runtime", "binding_fingerprint_sha256", "grant_expires_at"}:
        if not _identifier(binding.get(field)):
            raise HostError("invalid_selected_binding")
    if binding.get("runtime") not in {"openclaw", "hermes"}:
        raise HostError("invalid_selected_binding")
    if not isinstance(binding.get("grant_expires_at"), str) or not binding["grant_expires_at"]:
        raise HostError("invalid_selected_binding")
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


def _lifecycle_result(state: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "kind": "lifecycle",
        "configured_mode": state["configured_mode"],
        "effective_mode": state["effective_mode"],
        "requested_target_mode": state.get("requested_target_mode"),
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
