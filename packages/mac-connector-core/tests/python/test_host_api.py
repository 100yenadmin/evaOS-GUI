from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path
from typing import Any, Mapping

from evaos_desktop_bridge.host.api import CoreHost, HostPorts, InMemoryStatePort

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "v1" / "fixtures"
HOST_SESSION = "host-session-01"
FINGERPRINT = "11" * 32

BINDING = {
    "customer_id": "customer-01",
    "customer_vm_id": "vm-01",
    "device_id": "mac-01",
    "grant_id": "grant-01",
    "runtime": "openclaw",
    "binding_id": "binding-01",
    "binding_version": "v3",
    "grant_expires_at": "2026-07-15T09:00:00Z",
    "connector_installation_id": "install-01",
    "connector_key_id": "mac-key-01",
    "binding_fingerprint_sha256": FINGERPRINT,
}


class FakePairing:
    def __init__(self) -> None:
        self.claimed = False

    def claim(self, pairing_code: str, local_installation_nonce: str) -> Mapping[str, Any]:
        if self.claimed:
            raise RuntimeError("already claimed")
        self.claimed = True
        return {"binding": BINDING}


class FakeTransport:
    def __init__(self) -> None:
        self.state = "disconnected"

    def connect(self, binding: Mapping[str, Any]) -> Mapping[str, Any]:
        self.state = "connected"
        return {"state": self.state}

    def disconnect(self) -> None:
        self.state = "disconnected"

    def revoke(self) -> None:
        self.state = "revoked"

    def block(self) -> None:
        self.state = "blocked"


class FakeAuthority:
    def __init__(self) -> None:
        self.rejection: str | None = None

    def confirm_full_access(self, state: Mapping[str, Any]) -> bool:
        return True

    def validate_action(self, envelope: Mapping[str, Any], state: Mapping[str, Any]) -> str | None:
        return self.rejection


class FakeReplay:
    def __init__(self) -> None:
        self.burned: set[tuple[str, str]] = set()
        self.invalidations = 0

    def burn(self, command_id: str, request_digest_sha256: str) -> bool:
        key = (command_id, request_digest_sha256)
        if key in self.burned:
            return False
        self.burned.add(key)
        return True

    def invalidate_pending(self) -> None:
        self.invalidations += 1


class FakeAudit:
    def __init__(self) -> None:
        self.sequence = 0
        self.fail = False

    def _record(self, envelope: Mapping[str, Any], event_type: str, outcome: str, causation: str | None) -> dict[str, Any]:
        if self.fail:
            raise OSError("audit unavailable")
        self.sequence += 1
        return {
            "schema_version": "evaos.mac_access.audit_event.v1",
            "audit_id": f"audit-{self.sequence:08d}",
            "sequence": self.sequence,
            "previous_record_sha256": None if self.sequence == 1 else "cd" * 32,
            "occurred_at": "2026-07-15T08:00:00Z",
            "event_type": event_type,
            "actor": {"kind": "broker", "id": "broker-01"},
            "binding_fingerprint_sha256": BINDING["binding_fingerprint_sha256"],
            "command_id": envelope["command_id"],
            "request_digest_sha256": envelope["command"]["request_digest_sha256"],
            "causation_audit_id": causation,
            "access_mode": "ask_every_time",
            "outcome": outcome,
            "reason_code": "policy_allowed" if outcome == "allowed" else "action_completed",
            "evidence": {"redaction_policy": "default_v1"},
            "record_sha256": "ef" * 32,
        }

    def command_decision(self, envelope: Mapping[str, Any], *, allowed: bool, reason_code: str) -> Mapping[str, Any]:
        return self._record(envelope, "command_decision", "allowed" if allowed else "denied", None)

    def command_result(
        self,
        envelope: Mapping[str, Any],
        *,
        decision: Mapping[str, Any],
        outcome: str,
        reason_code: str,
    ) -> Mapping[str, Any]:
        return self._record(envelope, "command_result", outcome, str(decision["audit_id"]))

    def summary(self, after_cursor: Mapping[str, Any] | None, limit: int) -> Mapping[str, Any]:
        return {"kind": "audit_summary", "page_anchor": after_cursor, "events": [], "causal_decisions": [], "next_cursor": None}


class FakeAction:
    def __init__(self) -> None:
        self.executions = 0
        self.cancellations = 0

    def execute(self, envelope: Mapping[str, Any]) -> Mapping[str, Any]:
        self.executions += 1
        return {"outcome": "executed", "reason_code": "action_completed"}

    def cancel_all(self) -> None:
        self.cancellations += 1


class FakeStatus:
    def snapshot(self, state: Mapping[str, Any]) -> Mapping[str, Any]:
        return {"schema_version": "evaos.mac_access.local_status.v1", "access": {"policy_epoch": state["policy_epoch"]}}


def request(operation: str, sequence: int, epoch: int | None, **extra: Any) -> dict[str, Any]:
    return {
        "schema_version": "evaos.mac_connector_core.host_request.v1",
        "request_id": f"request-{sequence:02d}",
        "host_session_id": HOST_SESSION,
        "sequence": sequence,
        "operation": operation,
        "expected_policy_epoch": epoch,
        **extra,
    }


def broker_envelope() -> dict[str, Any]:
    return json.loads((FIXTURES / "valid" / "authority" / "broker-control.json").read_text())


class CoreHostTests(unittest.TestCase):
    def setUp(self) -> None:
        self.state = InMemoryStatePort(HOST_SESSION)
        self.pairing = FakePairing()
        self.transport = FakeTransport()
        self.authority = FakeAuthority()
        self.replay = FakeReplay()
        self.audit = FakeAudit()
        self.action = FakeAction()
        self.host = CoreHost(
            HostPorts(
                state=self.state,
                pairing=self.pairing,
                transport=self.transport,
                authority=self.authority,
                replay=self.replay,
                audit=self.audit,
                action=self.action,
                status=FakeStatus(),
            )
        )

    def pair(self, sequence: int = 1, epoch: int = 0) -> dict[str, Any]:
        return self.host.handle(
            request(
                "pair",
                sequence,
                epoch,
                pairing_code="ABC123",
                local_installation_nonce="A" * 32,
            )
        )

    def test_all_fourteen_operations_are_dispatched(self) -> None:
        seen = set()
        response = self.host.handle(request("status", 1, None))
        self.assertTrue(response["ok"])
        seen.add("status")
        self.assertTrue(self.pair(2, 0)["ok"])
        seen.add("pair")
        self.assertTrue(self.host.handle(request("connect", 3, 1, binding=BINDING))["ok"])
        seen.add("connect")
        self.assertTrue(self.host.handle(request("set_access_mode", 4, 1, target_mode="ask_every_time"))["ok"])
        seen.add("set_access_mode")
        envelope = broker_envelope()
        envelope["policy_epoch"] = 2
        response = self.host.handle(request("dispatch_action", 5, 2, envelope=envelope))
        self.assertTrue(response["ok"])
        seen.add("dispatch_action")
        self.assertTrue(self.host.handle(request("audit_summary", 6, 2, after_cursor=None, limit=10))["ok"])
        seen.add("audit_summary")
        self.assertTrue(self.host.handle(request("pause", 7, 2))["ok"])
        seen.add("pause")
        self.assertTrue(self.host.handle(request("resume", 8, 3))["ok"])
        seen.add("resume")
        self.assertTrue(self.host.handle(request("disconnect", 9, 4))["ok"])
        seen.add("disconnect")
        self.assertTrue(self.host.handle(request("stop", 10, 4))["ok"])
        seen.add("stop")
        self.assertTrue(self.host.handle(request("unpair", 11, 5))["ok"])
        seen.add("unpair")

        other = self._fresh_host()
        self.assertTrue(other.pair()["ok"])
        self.assertTrue(other.host.handle(request("revoke", 2, 1))["ok"])
        seen.add("revoke")
        killed = self._fresh_host()
        self.assertTrue(killed.pair()["ok"])
        self.assertTrue(killed.host.handle(request("activate_kill_switch", 2, 1))["ok"])
        seen.add("activate_kill_switch")
        shutdown = self._fresh_host()
        self.assertTrue(shutdown.host.handle(request("shutdown", 1, 0))["ok"])
        seen.add("shutdown")
        self.assertEqual(
            seen,
            {
                "status", "pair", "unpair", "connect", "disconnect", "set_access_mode",
                "dispatch_action", "audit_summary", "pause", "resume", "stop", "revoke",
                "activate_kill_switch", "shutdown",
            },
        )

    def _fresh_host(self) -> "CoreHostTests":
        other = CoreHostTests(methodName="runTest")
        other.setUp()
        return other

    def test_runtime_negative_ledger_executes_all_nine_cases(self) -> None:
        cases = []
        for path in sorted((FIXTURES / "invalid").glob("*.json")):
            cases.extend(json.loads(path.read_text()))
        runtime = {case["id"]: case for case in cases if case["expected_stage"] == "runtime"}
        expected = {
            "execution-context-payload-tampered", "offline-broker-actuation", "replayed-command",
            "replayed-core-host-sequence", "request-digest-mismatch", "revoked-grant",
            "stale-command-policy-epoch", "stale-core-host-session", "stolen-pairing-code",
        }
        self.assertEqual(set(runtime), expected)
        self.assertTrue(all(case["required_runtime_rejection"] for case in runtime.values()))

        stale_session = request("status", 1, None)
        stale_session["host_session_id"] = "host-session-stale"
        self.assertEqual(self.host.handle(stale_session)["error"]["code"], "stale_core_host_session")

        accepted = self.host.handle(request("status", 1, None))
        self.assertTrue(accepted["ok"])
        self.assertEqual(self.host.handle(request("status", 1, None))["error"]["code"], "replayed_core_host_sequence")

        self.assertTrue(self.pair(2, 0)["ok"])
        reused = self.host.handle(
            request("pair", 3, 1, pairing_code="ABC123", local_installation_nonce="A" * 32)
        )
        self.assertEqual(reused["error"]["code"], "stolen_pairing_code")
        self.assertEqual(self.host.handle(request("pause", 4, 0))["error"]["code"], "stale_command_policy_epoch")

        self.assertTrue(self.host.handle(request("set_access_mode", 5, 1, target_mode="ask_every_time"))["ok"])
        base = broker_envelope()
        base["policy_epoch"] = 2
        rejection_by_id = {
            "execution-context-payload-tampered": "execution_context_digest_or_signature_mismatch",
            "offline-broker-actuation": "broker_authority_offline",
            "request-digest-mismatch": "request_digest_mismatch",
            "revoked-grant": "grant_revoked",
        }
        sequence = 6
        for case_id, code in rejection_by_id.items():
            self.authority.rejection = code
            envelope = copy.deepcopy(base)
            envelope["command_id"] = f"command-{case_id}"
            response = self.host.handle(request("dispatch_action", sequence, 2, envelope=envelope))
            self.assertEqual(response["result"]["outcome"], "denied", case_id)
            sequence += 1
        self.authority.rejection = None
        replay_envelope = copy.deepcopy(base)
        replay_envelope["command_id"] = "command-replay"
        first = self.host.handle(request("dispatch_action", sequence, 2, envelope=replay_envelope))
        self.assertEqual(first["result"]["outcome"], "executed")
        sequence += 1
        second = self.host.handle(request("dispatch_action", sequence, 2, envelope=replay_envelope))
        self.assertEqual(second["result"]["outcome"], "denied")
        self.assertEqual(self.action.executions, 1)

    def test_audit_failure_forces_off_and_prevents_actuation(self) -> None:
        self.assertTrue(self.pair()["ok"])
        self.assertTrue(self.host.handle(request("set_access_mode", 2, 1, target_mode="ask_every_time"))["ok"])
        self.audit.fail = True
        envelope = broker_envelope()
        envelope["policy_epoch"] = 2
        response = self.host.handle(request("dispatch_action", 3, 2, envelope=envelope))
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "audit_write_failed")
        self.assertEqual(self.action.executions, 0)

    def test_unknown_fields_fail_before_port_access(self) -> None:
        invalid = request("status", 1, None, renderer_secret="forbidden")
        response = self.host.handle(invalid)
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "invalid_request_fields")
        self.assertEqual(self.state.load()["last_sequence"], 0)


if __name__ == "__main__":
    unittest.main()
