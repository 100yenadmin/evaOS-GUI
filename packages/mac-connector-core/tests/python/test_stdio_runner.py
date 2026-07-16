from __future__ import annotations

import ast
import copy
import json
import queue
import threading
import unittest
from pathlib import Path
from typing import Any, Mapping
from unittest import mock

from evaos_desktop_bridge.host import stdio_runner
from evaos_desktop_bridge.host.stdio_runner import (
    MAX_MESSAGE_BYTES,
    STDIO_SCHEMA,
    StdioRunner,
)
from test_host_api import BINDING, FakeAudit, FakeStatus, broker_envelope, request

HOST_SESSION = "host-session-01"
RUNTIME_INSTANCE = "runtime-instance-01"
FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "v1" / "fixtures"


class QueueInput:
    def __init__(self) -> None:
        self.lines: queue.Queue[bytes] = queue.Queue()

    def readline(self, _limit: int = -1) -> bytes:
        return self.lines.get(timeout=5)

    def feed(self, line: bytes) -> None:
        self.lines.put(line)


class QueueOutput:
    def __init__(self) -> None:
        self.lines: queue.Queue[bytes] = queue.Queue()

    def write(self, data: bytes) -> int:
        self.lines.put(data)
        return len(data)

    def flush(self) -> None:
        pass


def paired_state() -> dict[str, Any]:
    return {
        "revision": 0,
        "host_session_id": HOST_SESSION,
        "last_sequence": 0,
        "policy_epoch": 7,
        "runtime_instance_id": RUNTIME_INSTANCE,
        "pairing_state": "paired",
        "configured_mode": "ask_every_time",
        "effective_mode": "ask_every_time",
        "requested_target_mode": None,
        "paused": False,
        "kill_switch": False,
        "selected_binding": copy.deepcopy(BINDING),
        "transport_state": "connected",
        "shutdown": False,
        "local_confirmation_required": False,
        "confirmed_runtime_instance_id": None,
        "confirmed_policy_epoch": None,
        "confirmed_binding_fingerprint_sha256": None,
    }


def pristine_state() -> dict[str, Any]:
    state = paired_state()
    state.update(
        policy_epoch=0,
        runtime_instance_id=None,
        pairing_state="unpaired",
        configured_mode="off",
        effective_mode="off",
        selected_binding=None,
        transport_state="disconnected",
    )
    return state


class HelperBackend:
    def __init__(self, *, state: Mapping[str, Any] | None = None) -> None:
        self.state = copy.deepcopy(dict(state or pristine_state()))
        self.audit = FakeAudit()
        self.fail: set[tuple[str, str]] = set()
        self.cancel_calls = 0

    def call(self, port: str, method: str, arguments: Mapping[str, Any]) -> Any:
        if (port, method) in self.fail:
            raise RuntimeError("redacted_port_failure")
        if port == "state":
            if method == "load":
                return copy.deepcopy(self.state)
            if method == "compare_and_swap":
                if self.state["revision"] != arguments["expected_revision"]:
                    return False
                replacement = copy.deepcopy(arguments["state"])
                replacement["revision"] = arguments["expected_revision"] + 1
                self.state = replacement
                return True
            if method == "replace_corrupt":
                replacement = copy.deepcopy(arguments["state"])
                replacement["revision"] = self.state.get("revision", 0) + 1
                self.state = replacement
                return True
        if (port, method) == ("identity", "runtime_is_current"):
            return True
        if (port, method) == ("status", "snapshot"):
            return FakeStatus().snapshot(arguments["state"])
        if (port, method) == ("clock", "validate_authority_window"):
            return None
        if (port, method) in {
            ("authority", "validate_action"),
            ("authority", "approve_action"),
        }:
            return None
        if (port, method) == ("authority", "confirm_full_access"):
            return True
        if (port, method) == ("replay", "burn"):
            return True
        if (port, method) == ("audit", "anchor_healthy"):
            return True
        if (port, method) == ("audit", "committed_cursor"):
            return self.audit.committed_cursor()
        if (port, method) == ("audit", "command_decision"):
            return self.audit.command_decision(**arguments)
        if (port, method) == ("audit", "command_result"):
            return self.audit.command_result(**arguments)
        if (port, method) == ("audit", "summary"):
            return self.audit.summary(**arguments)
        if (port, method) == ("native", "begin"):
            return {"action_id": "native-action-01"}
        if (port, method) == ("native", "cancel_all"):
            self.cancel_calls += 1
            return None
        if (port, method) == ("transport", "connect"):
            return {"state": "connected", "binding": copy.deepcopy(arguments["binding"])}
        if (port, method) in {
            ("credential", "erase_active"),
            ("queue", "clear"),
            ("replay", "invalidate_pending"),
            ("transport", "disconnect"),
            ("transport", "revoke"),
            ("transport", "block"),
        }:
            return None
        raise AssertionError(f"unexpected callback {port}.{method}")


class RunnerHarness:
    def __init__(self, backend: HelperBackend | None = None) -> None:
        self.input = QueueInput()
        self.output = QueueOutput()
        self.backend = backend or HelperBackend()
        self.runner = StdioRunner(
            self.input,
            self.output,
            host_session_id=HOST_SESSION,
            runtime_instance_id=RUNTIME_INSTANCE,
        )
        self.exit_code: int | None = None
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()
        self.deferred_native_wait: Mapping[str, Any] | None = None

    def _serve(self) -> None:
        self.exit_code = self.runner.serve()

    def send(self, message: Mapping[str, Any]) -> None:
        self.send_raw(json.dumps(message, separators=(",", ":")).encode() + b"\n")

    def send_raw(self, line: bytes) -> None:
        self.input.feed(line)

    def receive(self) -> dict[str, Any]:
        return json.loads(self.output.lines.get(timeout=5))

    def host_request(self, value: Mapping[str, Any]) -> None:
        self.send(
            {
                "schema_version": STDIO_SCHEMA,
                "message_type": "host_request",
                "request": dict(value),
            }
        )

    def respond(self, call: Mapping[str, Any], *, result: Any = None, code: str | None = None) -> None:
        self.send(
            {
                "schema_version": STDIO_SCHEMA,
                "message_type": "port_result",
                "call_id": call["call_id"],
                "ok": code is None,
                "result": result if code is None else None,
                "error": None if code is None else {"code": code},
            }
        )

    def service_call(self, message: Mapping[str, Any], *, defer_native_wait: bool = False) -> None:
        port = message["port"]
        method = message["method"]
        if defer_native_wait and (port, method) == ("native", "wait"):
            self.deferred_native_wait = message
            return
        try:
            result = self.backend.call(port, method, message["arguments"])
        except RuntimeError:
            self.respond(message, code="helper_port_failed")
            return
        self.respond(message, result=result)
        if (port, method) == ("native", "cancel_all") and self.deferred_native_wait is not None:
            pending = self.deferred_native_wait
            self.deferred_native_wait = None
            self.respond(
                pending,
                result={"outcome": "stopped", "reason_code": "local_kill_switch"},
            )

    def pump_until_responses(
        self,
        count: int,
        *,
        defer_native_wait: bool = False,
        on_deferred_wait: Any = None,
    ) -> list[dict[str, Any]]:
        responses: list[dict[str, Any]] = []
        notified = False
        while len(responses) < count:
            message = self.receive()
            if message["message_type"] == "port_call":
                self.service_call(message, defer_native_wait=defer_native_wait)
                if self.deferred_native_wait is not None and not notified and on_deferred_wait is not None:
                    notified = True
                    on_deferred_wait()
            elif message["message_type"] == "host_response":
                responses.append(message["response"])
            else:
                raise AssertionError(f"unexpected runner message: {message}")
        return responses


class StdioRunnerTests(unittest.TestCase):
    def test_status_round_trips_through_helper_owned_ports(self) -> None:
        harness = RunnerHarness()
        harness.host_request(request("status", 1, None))

        response = harness.pump_until_responses(1)[0]

        self.assertTrue(response["ok"])
        self.assertEqual(response["result"]["kind"], "status")
        self.assertEqual(response["result"]["status"]["leader"]["runtime_instance_id"], RUNTIME_INSTANCE)

    def test_kill_request_cancels_a_concurrent_native_wait(self) -> None:
        backend = HelperBackend(state=paired_state())
        harness = RunnerHarness(backend)
        harness.host_request(
            request("dispatch_action", 1, 7, envelope=broker_envelope(7))
        )

        def send_kill() -> None:
            harness.host_request(request("activate_kill_switch", 2, 7))

        responses = harness.pump_until_responses(
            2,
            defer_native_wait=True,
            on_deferred_wait=send_kill,
        )
        by_operation = {response["operation"]: response for response in responses}

        self.assertTrue(by_operation["activate_kill_switch"]["ok"])
        self.assertEqual(by_operation["dispatch_action"]["result"]["outcome"], "stopped")
        self.assertGreaterEqual(backend.cancel_calls, 1)

    def test_helper_port_error_returns_redacted_fail_closed_response(self) -> None:
        backend = HelperBackend()
        backend.fail.add(("status", "snapshot"))
        harness = RunnerHarness(backend)
        harness.host_request(request("status", 1, None))

        response = harness.pump_until_responses(1)[0]

        self.assertFalse(response["ok"])
        self.assertEqual(response["error"], {"code": "host_internal_error", "audit_id": None})
        self.assertEqual(backend.state["effective_mode"], "off")

    def test_unknown_duplicate_oversize_and_malformed_messages_are_terminal(self) -> None:
        cases = {
            "unknown": json.dumps(
                {"schema_version": STDIO_SCHEMA, "message_type": "unexpected"}
            ).encode()
            + b"\n",
            "duplicate-key": (
                b'{"schema_version":"'
                + STDIO_SCHEMA.encode()
                + b'","message_type":"unexpected","message_type":"host_request"}\n'
            ),
            "oversize": b"{" + b" " * MAX_MESSAGE_BYTES + b"}\n",
            "malformed": b"{not-json}\n",
        }
        for name, line in cases.items():
            with self.subTest(name=name):
                harness = RunnerHarness()
                harness.send_raw(line)
                message = harness.receive()
                harness.thread.join(timeout=5)
                self.assertEqual(message["message_type"], "protocol_error")
                self.assertEqual(harness.exit_code, 2)

        harness = RunnerHarness()
        duplicate = {
            "schema_version": STDIO_SCHEMA,
            "message_type": "host_request",
            "request": request("status", 1, None),
        }
        harness.send(duplicate)
        harness.send(duplicate)
        messages = []
        while {message["message_type"] for message in messages} != {
            "host_response",
            "protocol_error",
        }:
            message = harness.receive()
            if message["message_type"] == "port_call":
                harness.service_call(message)
            else:
                messages.append(message)
        error = next(message for message in messages if message["message_type"] == "protocol_error")
        self.assertEqual(error["error"]["code"], "duplicate_host_request")

    def test_runner_source_has_no_public_listener_surface(self) -> None:
        source_path = (
            Path(__file__).resolve().parents[2]
            / "python"
            / "evaos_desktop_bridge"
            / "host"
            / "stdio_runner.py"
        )
        source = source_path.read_text()
        tree = ast.parse(source)
        imported_roots = {
            alias.name.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, (ast.Import, ast.ImportFrom))
            for alias in node.names
        }

        self.assertTrue({"socket", "http", "asyncio"}.isdisjoint(imported_roots))
        self.assertNotIn(".listen(", source)
        self.assertNotIn(".bind(", source)

    def test_completed_request_replay_memory_is_bounded(self) -> None:
        with mock.patch.object(stdio_runner, "RECENT_REQUEST_IDS", 2):
            harness = RunnerHarness()
            for sequence in range(1, 4):
                harness.host_request(request("status", sequence, None))
                self.assertTrue(harness.pump_until_responses(1)[0]["ok"])

            with harness.runner._requests_lock:
                workers = list(harness.runner._workers)
            for worker in workers:
                worker.join(timeout=5)

        self.assertEqual(
            harness.runner._recent_request_ids,
            {"request-02", "request-03"},
        )


if __name__ == "__main__":
    unittest.main()
