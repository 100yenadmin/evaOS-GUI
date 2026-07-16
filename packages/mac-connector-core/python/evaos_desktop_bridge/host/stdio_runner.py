"""Private inherited-stdio runner for the connector-core host API.

The signed helper owns every operating-system capability.  This process only
evaluates :class:`CoreHost` policy and calls the helper back over the inherited
stdin/stdout channel; it never opens a listener or discovers an interpreter.
"""

from __future__ import annotations

import json
import re
import secrets
import sys
import threading
from collections import deque
from dataclasses import dataclass
from typing import Any, BinaryIO, Mapping

from .api import CoreHost, HostPorts, NativeActionPort, OPERATIONS, RESPONSE_SCHEMA

STDIO_SCHEMA = "evaos.mac_connector_core.stdio.v1"
MAX_MESSAGE_BYTES = 1_048_576
MAX_IN_FLIGHT_REQUESTS = 64
RECENT_REQUEST_IDS = 4_096
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


class ProtocolError(RuntimeError):
    """A redacted terminal protocol failure."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class RemotePortError(RuntimeError):
    """A redacted helper callback failure."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass
class _PendingCall:
    event: threading.Event
    result: Any = None
    error_code: str | None = None
    resolved: bool = False


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ProtocolError("duplicate_json_key")
        result[key] = value
    return result


def _strict_json(raw: bytes) -> Any:
    try:
        text = raw.decode("utf-8", errors="strict")
        return json.loads(
            text,
            object_pairs_hook=_strict_object,
            parse_constant=lambda _value: (_ for _ in ()).throw(ProtocolError("invalid_json_number")),
        )
    except ProtocolError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProtocolError("malformed_json") from error


def _exact_mapping(value: Any, fields: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != fields:
        raise ProtocolError(code)
    return dict(value)


def _identifier(value: Any) -> bool:
    return isinstance(value, str) and _IDENTIFIER.fullmatch(value) is not None


def _optional_code(value: Any) -> str | None:
    if value is None:
        return None
    if not _identifier(value):
        raise RemotePortError("invalid_port_result")
    return value


class HelperChannel:
    """Thread-safe request/response callback channel to the signed helper."""

    def __init__(self, output: BinaryIO) -> None:
        self._output = output
        self._write_lock = threading.Lock()
        self._pending_lock = threading.Lock()
        self._pending: dict[str, _PendingCall] = {}
        self._closed = False

    def call(self, port: str, method: str, arguments: Mapping[str, Any]) -> Any:
        if not _identifier(port) or not _identifier(method):
            raise RemotePortError("invalid_port_call")
        call_id = f"call-{secrets.token_hex(16)}"
        pending = _PendingCall(threading.Event())
        with self._pending_lock:
            if self._closed:
                raise RemotePortError("helper_channel_closed")
            self._pending[call_id] = pending
        try:
            self.write(
                {
                    "schema_version": STDIO_SCHEMA,
                    "message_type": "port_call",
                    "call_id": call_id,
                    "port": port,
                    "method": method,
                    "arguments": dict(arguments),
                }
            )
            pending.event.wait()
            if pending.error_code is not None:
                raise RemotePortError(pending.error_code)
            return pending.result
        finally:
            with self._pending_lock:
                self._pending.pop(call_id, None)

    def resolve(self, message: Mapping[str, Any]) -> None:
        normalized = _exact_mapping(
            message,
            {"schema_version", "message_type", "call_id", "ok", "result", "error"},
            "invalid_port_result",
        )
        call_id = normalized["call_id"]
        if not _identifier(call_id) or not isinstance(normalized["ok"], bool):
            raise ProtocolError("invalid_port_result")
        with self._pending_lock:
            pending = self._pending.get(call_id)
            if pending is None:
                raise ProtocolError("unknown_port_result")
            if pending.resolved:
                raise ProtocolError("duplicate_port_result")
            if normalized["ok"]:
                if normalized["error"] is not None:
                    raise ProtocolError("invalid_port_result")
                pending.result = normalized["result"]
            else:
                error = _exact_mapping(normalized["error"], {"code"}, "invalid_port_result")
                if normalized["result"] is not None or not _identifier(error["code"]):
                    raise ProtocolError("invalid_port_result")
                pending.error_code = error["code"]
            pending.resolved = True
            pending.event.set()

    def write(self, message: Mapping[str, Any]) -> None:
        try:
            encoded = json.dumps(
                message,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
            ).encode("utf-8") + b"\n"
        except (TypeError, ValueError) as error:
            raise ProtocolError("invalid_outbound_message") from error
        if len(encoded) > MAX_MESSAGE_BYTES:
            raise ProtocolError("outbound_message_too_large")
        with self._write_lock:
            if self._closed:
                raise RemotePortError("helper_channel_closed")
            self._output.write(encoded)
            self._output.flush()

    def close(self) -> None:
        with self._pending_lock:
            self._closed = True
            pending = list(self._pending.values())
            for call in pending:
                if not call.resolved:
                    call.error_code = "helper_channel_closed"
                    call.resolved = True
                    call.event.set()


class _StateProxy:
    def __init__(self, channel: HelperChannel) -> None:
        self._channel = channel

    def load(self) -> dict[str, Any]:
        return dict(self._channel.call("state", "load", {}))

    def compare_and_swap(self, expected_revision: int, state: Mapping[str, Any]) -> bool:
        result = self._channel.call(
            "state", "compare_and_swap", {"expected_revision": expected_revision, "state": dict(state)}
        )
        return result is True

    def replace_corrupt(self, state: Mapping[str, Any]) -> bool:
        return self._channel.call("state", "replace_corrupt", {"state": dict(state)}) is True


class _PairingProxy:
    def __init__(self, channel: HelperChannel) -> None:
        self._channel = channel

    def claim(self, pairing_code: str, local_installation_nonce: str) -> Mapping[str, Any]:
        return dict(
            self._channel.call(
                "pairing",
                "claim",
                {"pairing_code": pairing_code, "local_installation_nonce": local_installation_nonce},
            )
        )


class _IdentityProxy:
    def __init__(self, channel: HelperChannel) -> None:
        self._channel = channel

    def runtime_is_current(self, state: Mapping[str, Any]) -> bool:
        return self._channel.call("identity", "runtime_is_current", {"state": dict(state)}) is True


class _CredentialProxy:
    def __init__(self, channel: HelperChannel) -> None:
        self._channel = channel

    def erase_active(self) -> None:
        self._channel.call("credential", "erase_active", {})


class _QueueProxy:
    def __init__(self, channel: HelperChannel) -> None:
        self._channel = channel

    def clear(self) -> None:
        self._channel.call("queue", "clear", {})


class _ClockProxy:
    def __init__(self, channel: HelperChannel) -> None:
        self._channel = channel

    def validate_authority_window(self, envelope: Mapping[str, Any]) -> str | None:
        result = self._channel.call(
            "clock", "validate_authority_window", {"envelope": dict(envelope)}
        )
        return _optional_code(result)


class _TransportProxy:
    def __init__(self, channel: HelperChannel) -> None:
        self._channel = channel

    def connect(self, binding: Mapping[str, Any]) -> Mapping[str, Any]:
        return dict(self._channel.call("transport", "connect", {"binding": dict(binding)}))

    def disconnect(self) -> None:
        self._channel.call("transport", "disconnect", {})

    def revoke(self) -> None:
        self._channel.call("transport", "revoke", {})

    def block(self) -> None:
        self._channel.call("transport", "block", {})


class _AuthorityProxy:
    def __init__(self, channel: HelperChannel) -> None:
        self._channel = channel

    def confirm_full_access(self, state: Mapping[str, Any]) -> bool:
        return self._channel.call("authority", "confirm_full_access", {"state": dict(state)}) is True

    def validate_action(self, envelope: Mapping[str, Any], state: Mapping[str, Any]) -> str | None:
        result = self._channel.call(
            "authority", "validate_action", {"envelope": dict(envelope), "state": dict(state)}
        )
        return _optional_code(result)

    def approve_action(self, envelope: Mapping[str, Any], state: Mapping[str, Any]) -> str | None:
        result = self._channel.call(
            "authority", "approve_action", {"envelope": dict(envelope), "state": dict(state)}
        )
        return _optional_code(result)


class _ReplayProxy:
    def __init__(self, channel: HelperChannel) -> None:
        self._channel = channel

    def burn(self, envelope: Mapping[str, Any]) -> bool:
        return self._channel.call("replay", "burn", {"envelope": dict(envelope)}) is True

    def invalidate_pending(self) -> None:
        self._channel.call("replay", "invalidate_pending", {})


class _AuditProxy:
    def __init__(self, channel: HelperChannel) -> None:
        self._channel = channel

    def anchor_healthy(self) -> bool:
        return self._channel.call("audit", "anchor_healthy", {}) is True

    def committed_cursor(self) -> Mapping[str, Any] | None:
        result = self._channel.call("audit", "committed_cursor", {})
        return None if result is None else dict(result)

    def command_decision(
        self,
        envelope: Mapping[str, Any],
        *,
        allowed: bool,
        reason_code: str,
        detail_code: str | None,
    ) -> Mapping[str, Any]:
        return dict(
            self._channel.call(
                "audit",
                "command_decision",
                {
                    "envelope": dict(envelope),
                    "allowed": allowed,
                    "reason_code": reason_code,
                    "detail_code": detail_code,
                },
            )
        )

    def command_result(
        self,
        envelope: Mapping[str, Any],
        *,
        decision: Mapping[str, Any],
        outcome: str,
        reason_code: str,
        detail_code: str,
    ) -> Mapping[str, Any]:
        return dict(
            self._channel.call(
                "audit",
                "command_result",
                {
                    "envelope": dict(envelope),
                    "decision": dict(decision),
                    "outcome": outcome,
                    "reason_code": reason_code,
                    "detail_code": detail_code,
                },
            )
        )

    def summary(self, after_cursor: Mapping[str, Any] | None, limit: int) -> Mapping[str, Any]:
        return dict(
            self._channel.call(
                "audit",
                "summary",
                {"after_cursor": None if after_cursor is None else dict(after_cursor), "limit": limit},
            )
        )


class _RemoteNativeAction(NativeActionPort):
    def __init__(self, channel: HelperChannel, action_id: str) -> None:
        self._channel = channel
        self._action_id = action_id

    def wait(self) -> Mapping[str, Any]:
        return dict(self._channel.call("native", "wait", {"action_id": self._action_id}))


class _NativeProxy:
    def __init__(self, channel: HelperChannel) -> None:
        self._channel = channel

    def begin(self, envelope: Mapping[str, Any]) -> NativeActionPort:
        result = _exact_mapping(
            self._channel.call("native", "begin", {"envelope": dict(envelope)}),
            {"action_id"},
            "invalid_native_action",
        )
        if not _identifier(result["action_id"]):
            raise RemotePortError("invalid_native_action")
        return _RemoteNativeAction(self._channel, result["action_id"])

    def cancel_all(self) -> None:
        self._channel.call("native", "cancel_all", {})


class _StatusProxy:
    def __init__(self, channel: HelperChannel) -> None:
        self._channel = channel

    def snapshot(self, state: Mapping[str, Any]) -> Mapping[str, Any]:
        return dict(self._channel.call("status", "snapshot", {"state": dict(state)}))


def remote_host_ports(channel: HelperChannel) -> HostPorts:
    """Build the complete helper-callback port set for :class:`CoreHost`."""

    return HostPorts(
        state=_StateProxy(channel),
        pairing=_PairingProxy(channel),
        identity=_IdentityProxy(channel),
        credential=_CredentialProxy(channel),
        queue=_QueueProxy(channel),
        clock=_ClockProxy(channel),
        transport=_TransportProxy(channel),
        authority=_AuthorityProxy(channel),
        replay=_ReplayProxy(channel),
        audit=_AuditProxy(channel),
        native=_NativeProxy(channel),
        status=_StatusProxy(channel),
    )


class StdioRunner:
    """Keep the reader live while independent workers execute host requests."""

    def __init__(
        self,
        input_stream: BinaryIO,
        output_stream: BinaryIO,
        *,
        host_session_id: str,
        runtime_instance_id: str,
    ) -> None:
        self._input = input_stream
        self._channel = HelperChannel(output_stream)
        self._host = CoreHost(
            remote_host_ports(self._channel),
            host_session_id=host_session_id,
            runtime_instance_id=runtime_instance_id,
        )
        self._requests_lock = threading.Lock()
        self._active_requests: dict[str, dict[str, Any]] = {}
        self._recent_request_ids: set[str] = set()
        self._recent_request_order: deque[str] = deque()
        self._workers: set[threading.Thread] = set()
        self._terminal = threading.Event()
        self._response_lock = threading.Lock()

    def serve(self) -> int:
        try:
            while not self._terminal.is_set():
                raw = self._input.readline(MAX_MESSAGE_BYTES + 1)
                if raw == b"":
                    break
                if len(raw) > MAX_MESSAGE_BYTES:
                    raise ProtocolError("message_too_large")
                if not raw.endswith(b"\n"):
                    raise ProtocolError("unterminated_message")
                message = _strict_json(raw)
                normalized = _exact_mapping(
                    message,
                    set(message) if isinstance(message, Mapping) else set(),
                    "invalid_message",
                )
                if normalized.get("schema_version") != STDIO_SCHEMA:
                    raise ProtocolError("unsupported_schema")
                message_type = normalized.get("message_type")
                if message_type == "port_result":
                    self._channel.resolve(normalized)
                elif message_type == "host_request":
                    self._accept_request(normalized)
                else:
                    raise ProtocolError("unknown_message_type")
        except ProtocolError as error:
            with self._response_lock:
                self._terminal.set()
                self._write_terminal_failures()
                self._write_protocol_error(error.code)
            return 2
        finally:
            self._terminal.set()
            self._channel.close()
        return 0

    def _accept_request(self, message: Mapping[str, Any]) -> None:
        normalized = _exact_mapping(
            message,
            {"schema_version", "message_type", "request"},
            "invalid_host_request",
        )
        request = normalized["request"]
        if not isinstance(request, Mapping) or not _identifier(request.get("request_id")):
            raise ProtocolError("invalid_host_request")
        request_id = str(request["request_id"])
        with self._requests_lock:
            if request_id in self._active_requests or request_id in self._recent_request_ids:
                raise ProtocolError("duplicate_host_request")
            if len(self._active_requests) >= MAX_IN_FLIGHT_REQUESTS:
                raise ProtocolError("too_many_in_flight_requests")
            self._active_requests[request_id] = dict(request)
            worker = threading.Thread(
                target=self._run_request,
                args=(dict(request), request_id),
                name="mac-connector-core-request",
                daemon=True,
            )
            self._workers.add(worker)
        worker.start()

    def _run_request(self, request: Mapping[str, Any], request_id: str) -> None:
        try:
            response = self._host.handle(request)
            self._mark_request_complete(request_id)
            with self._response_lock:
                if self._terminal.is_set():
                    return
                self._channel.write(
                    {
                        "schema_version": STDIO_SCHEMA,
                        "message_type": "host_response",
                        "response": response,
                    }
                )
        except Exception:
            self._mark_request_complete(request_id)
            with self._response_lock:
                if not self._terminal.is_set():
                    self._write_worker_failure(request)
        finally:
            with self._requests_lock:
                self._workers.discard(threading.current_thread())

    def _mark_request_complete(self, request_id: str) -> None:
        with self._requests_lock:
            self._active_requests.pop(request_id, None)
            if request_id not in self._recent_request_ids:
                if len(self._recent_request_order) >= RECENT_REQUEST_IDS:
                    expired = self._recent_request_order.popleft()
                    self._recent_request_ids.discard(expired)
                self._recent_request_order.append(request_id)
                self._recent_request_ids.add(request_id)

    def _write_terminal_failures(self) -> None:
        with self._requests_lock:
            active = list(self._active_requests.values())
            self._active_requests.clear()
        for request in active:
            self._write_worker_failure(request)

    def _write_worker_failure(self, request: Mapping[str, Any]) -> None:
        operation = request.get("operation")
        response = {
            "schema_version": RESPONSE_SCHEMA,
            "request_id": request.get("request_id") if _identifier(request.get("request_id")) else "invalid-request",
            "host_session_id": (
                request.get("host_session_id")
                if _identifier(request.get("host_session_id"))
                else "invalid-session"
            ),
            "sequence": (
                request.get("sequence")
                if isinstance(request.get("sequence"), int)
                and not isinstance(request.get("sequence"), bool)
                and request["sequence"] > 0
                else 1
            ),
            "operation": operation if operation in OPERATIONS else "status",
            "ok": False,
            "policy_epoch": 0,
            "result": None,
            "error": {"code": "host_internal_error", "audit_id": None},
        }
        try:
            self._channel.write(
                {
                    "schema_version": STDIO_SCHEMA,
                    "message_type": "host_response",
                    "response": response,
                }
            )
        except (ProtocolError, RemotePortError):
            pass

    def _write_protocol_error(self, code: str) -> None:
        try:
            self._channel.write(
                {
                    "schema_version": STDIO_SCHEMA,
                    "message_type": "protocol_error",
                    "error": {"code": code},
                }
            )
        except (ProtocolError, RemotePortError):
            pass


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if len(arguments) != 4 or arguments[0] != "--host-session-id" or arguments[2] != "--runtime-instance-id":
        return 64
    host_session_id = arguments[1]
    runtime_instance_id = arguments[3]
    if not _identifier(host_session_id) or not _identifier(runtime_instance_id):
        return 64
    runner = StdioRunner(
        sys.stdin.buffer,
        sys.stdout.buffer,
        host_session_id=host_session_id,
        runtime_instance_id=runtime_instance_id,
    )
    return runner.serve()


if __name__ == "__main__":
    raise SystemExit(main())
