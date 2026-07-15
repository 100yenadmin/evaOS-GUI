from __future__ import annotations

import base64
import hashlib
import json
import threading
import unittest
from pathlib import Path
from typing import Any, Mapping

from evaos_desktop_bridge.host.api import CoreHost, HostPorts, InMemoryStatePort, SAFE_INTEGER_MAX

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
        return {"binding": BINDING, "confirmed": True}


class FakeIdentity:
    def __init__(self) -> None:
        self.current = True
        self.calls = 0

    def runtime_is_current(self, state: Mapping[str, Any]) -> bool:
        self.calls += 1
        return self.current


class FakeCredential:
    def __init__(self) -> None:
        self.erases = 0

    def erase_active(self) -> None:
        self.erases += 1


class FakeQueue:
    def __init__(self) -> None:
        self.clears = 0
        self.fail = False

    def clear(self) -> None:
        self.clears += 1
        if self.fail:
            raise OSError("queue unavailable")


class FakeClock:
    def __init__(self) -> None:
        self.rejection: str | None = None
        self.online = True
        self.calls = 0

    def validate_authority_window(self, envelope: Mapping[str, Any]) -> str | None:
        self.calls += 1
        if not self.online:
            return "broker_authority_offline"
        return self.rejection


class FakeTransport:
    def __init__(self) -> None:
        self.state = "disconnected"
        self.fail = False

    def connect(self, binding: Mapping[str, Any]) -> Mapping[str, Any]:
        self.state = "connected"
        return {"state": self.state, "binding": dict(binding)}

    def disconnect(self) -> None:
        if self.fail:
            raise OSError("transport unavailable")
        self.state = "disconnected"

    def revoke(self) -> None:
        if self.fail:
            raise OSError("transport unavailable")
        self.state = "revoked"

    def block(self) -> None:
        if self.fail:
            raise OSError("transport unavailable")
        self.state = "blocked"


class FakeAuthority:
    def __init__(self) -> None:
        self.rejection: str | None = None
        self.approval_rejection: str | None = None
        self.approval_calls = 0
        self.revoked_grants: set[str] = set()

    def confirm_full_access(self, state: Mapping[str, Any]) -> bool:
        return True

    def validate_action(self, envelope: Mapping[str, Any], state: Mapping[str, Any]) -> str | None:
        execution_context = envelope["execution_context"]
        try:
            payload = base64.urlsafe_b64decode(execution_context["payload_base64url"] + "==")
            decoded_claims = json.loads(payload)
        except Exception:
            return "execution_context_digest_or_signature_mismatch"
        if (
            hashlib.sha256(payload).hexdigest() != execution_context["payload_sha256"]
            or decoded_claims != execution_context["claims"]
        ):
            return "execution_context_digest_or_signature_mismatch"
        request_bytes = json.dumps(
            envelope["command"]["request"],
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        if hashlib.sha256(request_bytes).hexdigest() != envelope["command"]["request_digest_sha256"]:
            return "request_digest_mismatch"
        if envelope["binding"]["grant_id"] in self.revoked_grants:
            return "grant_revoked"
        return self.rejection

    def approve_action(self, envelope: Mapping[str, Any], state: Mapping[str, Any]) -> str | None:
        self.approval_calls += 1
        return self.approval_rejection


class FakeReplay:
    def __init__(self) -> None:
        self.context_ids: set[str] = set()
        self.command_ids: set[str] = set()
        self.nonces: set[str] = set()
        self.channel_sequences: set[tuple[str, str, int]] = set()
        self.invalidations = 0
        self.fail = False

    def burn(self, envelope: Mapping[str, Any]) -> bool:
        claims = envelope["execution_context"]["claims"]
        channel_sequence = (
            envelope["session_id"], envelope["channel_generation_id"], envelope["sequence"]
        )
        if (
            claims["context_id"] in self.context_ids
            or envelope["command_id"] in self.command_ids
            or envelope["nonce"] in self.nonces
            or channel_sequence in self.channel_sequences
        ):
            return False
        self.context_ids.add(claims["context_id"])
        self.command_ids.add(envelope["command_id"])
        self.nonces.add(envelope["nonce"])
        self.channel_sequences.add(channel_sequence)
        return True

    def invalidate_pending(self) -> None:
        self.invalidations += 1
        if self.fail:
            raise OSError("replay unavailable")


class FakeAudit:
    def __init__(self) -> None:
        self.sequence = 0
        self.fail = False
        self.healthy = True
        self.previous_record_sha256: str | None = None
        self.received_reason_codes: list[str] = []

    def anchor_healthy(self) -> bool:
        return self.healthy

    def committed_cursor(self) -> Mapping[str, Any] | None:
        if self.sequence == 0:
            return None
        return {"sequence": self.sequence, "record_sha256": self.previous_record_sha256}

    def _record(
        self,
        envelope: Mapping[str, Any],
        event_type: str,
        outcome: str,
        causation: str | None,
        reason_code: str,
    ) -> dict[str, Any]:
        if self.fail:
            raise OSError("audit unavailable")
        self.sequence += 1
        record = {
            "schema_version": "evaos.mac_access.audit_event.v1",
            "audit_id": f"audit-{self.sequence:08d}",
            "sequence": self.sequence,
            "previous_record_sha256": self.previous_record_sha256,
            "occurred_at": "2026-07-15T08:00:00Z",
            "event_type": event_type,
            "actor": {"kind": "broker_runtime", "identity": "openclaw"},
            "binding_fingerprint_sha256": BINDING["binding_fingerprint_sha256"],
            "command_id": envelope["command_id"],
            "request_digest_sha256": envelope["command"]["request_digest_sha256"],
            "causation_audit_id": causation,
            "access_mode": "ask_every_time",
            "outcome": outcome,
            "reason_code": reason_code,
            "evidence": {"redaction_policy": "default_v1"},
        }
        canonical = json.dumps(record, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))
        record["record_sha256"] = hashlib.sha256(canonical.encode()).hexdigest()
        self.previous_record_sha256 = record["record_sha256"]
        return record

    def command_decision(
        self,
        envelope: Mapping[str, Any],
        *,
        allowed: bool,
        reason_code: str,
        detail_code: str | None,
    ) -> Mapping[str, Any]:
        self.received_reason_codes.append(reason_code)
        record = self._record(
            envelope,
            "command_decision",
            "allowed" if allowed else "denied",
            None,
            reason_code,
        )
        if detail_code is not None:
            record["evidence"]["detail_code"] = detail_code
            payload = {key: value for key, value in record.items() if key != "record_sha256"}
            canonical = json.dumps(payload, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))
            record["record_sha256"] = hashlib.sha256(canonical.encode()).hexdigest()
            self.previous_record_sha256 = record["record_sha256"]
        return record

    def command_result(
        self,
        envelope: Mapping[str, Any],
        *,
        decision: Mapping[str, Any],
        outcome: str,
        reason_code: str,
        detail_code: str,
    ) -> Mapping[str, Any]:
        record = self._record(
            envelope,
            "command_result",
            outcome,
            str(decision["audit_id"]),
            reason_code,
        )
        record["evidence"]["detail_code"] = detail_code
        payload = {key: value for key, value in record.items() if key != "record_sha256"}
        canonical = json.dumps(payload, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))
        record["record_sha256"] = hashlib.sha256(canonical.encode()).hexdigest()
        self.previous_record_sha256 = record["record_sha256"]
        return record

    def summary(self, after_cursor: Mapping[str, Any] | None, limit: int) -> Mapping[str, Any]:
        return {"kind": "audit_summary", "page_anchor": after_cursor, "events": [], "causal_decisions": [], "next_cursor": None}


class FakeNativeAction:
    def __init__(self, native: "FakeNative", envelope: Mapping[str, Any]) -> None:
        self.native = native
        self.envelope = envelope

    def wait(self) -> Mapping[str, Any]:
        self.native.executions += 1
        if self.native.fail:
            raise OSError("native action failed")
        return {"outcome": "executed", "reason_code": "action_completed"}


class FakeNative:
    def __init__(self) -> None:
        self.executions = 0
        self.cancellations = 0
        self.fail = False
        self.cancel_fail = False

    def begin(self, envelope: Mapping[str, Any]) -> FakeNativeAction:
        return FakeNativeAction(self, envelope)

    def cancel_all(self) -> None:
        self.cancellations += 1
        if self.cancel_fail:
            raise OSError("native cancellation failed")


class FakeStatus:
    def snapshot(self, state: Mapping[str, Any]) -> Mapping[str, Any]:
        status = json.loads((FIXTURES / "valid" / "state" / "local-status.json").read_text())
        status["leader"]["runtime_instance_id"] = state["runtime_instance_id"]
        status["access"]["runtime_instance_id"] = state["runtime_instance_id"]
        status["access"]["policy_epoch"] = state["policy_epoch"]
        status["access"]["pairing_state"] = state["pairing_state"]
        status["access"]["configured_mode"] = state["configured_mode"]
        status["access"]["effective_mode"] = state["effective_mode"]
        status["access"]["paused"] = state["paused"]
        status["access"]["kill_switch"] = state["kill_switch"]
        status["access"]["local_confirmation_required"] = state["local_confirmation_required"]
        status["access"]["confirmed_runtime_instance_id"] = state["confirmed_runtime_instance_id"]
        status["access"]["confirmed_policy_epoch"] = state["confirmed_policy_epoch"]
        status["access"]["confirmed_binding_fingerprint_sha256"] = state[
            "confirmed_binding_fingerprint_sha256"
        ]
        status["access"]["binding"] = state["selected_binding"]
        status["transport"]["state"] = state["transport_state"]
        status["transport"]["channel_id"] = "channel-01" if state["transport_state"] == "connected" else None
        return status


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


def broker_envelope(epoch: int = 7, *, command_id: str = "command-01") -> dict[str, Any]:
    envelope = json.loads((FIXTURES / "valid" / "authority" / "broker-control.json").read_text())
    envelope["policy_epoch"] = epoch
    envelope["command_id"] = command_id
    return rehash_envelope(envelope)


def rehash_envelope(envelope: dict[str, Any]) -> dict[str, Any]:
    claims = envelope["execution_context"]["claims"]
    claims_bytes = json.dumps(claims, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")).encode()
    envelope["execution_context"]["payload_base64url"] = base64.urlsafe_b64encode(claims_bytes).decode().rstrip("=")
    envelope["execution_context"]["payload_sha256"] = hashlib.sha256(claims_bytes).hexdigest()
    request_bytes = json.dumps(
        envelope["command"]["request"],
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    envelope["command"]["request_digest_sha256"] = hashlib.sha256(request_bytes).hexdigest()
    authority = envelope["authorization"]["payload"]
    for field in ("session_id", "channel_generation_id", "command_id", "issued_at", "expires_at", "sequence", "policy_epoch", "nonce"):
        authority[field] = envelope[field]
    authority["binding"] = json.loads(json.dumps(envelope["binding"]))
    authority["execution_context_sha256"] = envelope["execution_context"]["payload_sha256"]
    authority["request_digest_sha256"] = envelope["command"]["request_digest_sha256"]
    canonical = json.dumps(authority, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))
    envelope["authorization"]["payload_sha256"] = hashlib.sha256(canonical.encode()).hexdigest()
    return envelope


class CoreHostTests(unittest.TestCase):
    def setUp(self) -> None:
        self.state = InMemoryStatePort(HOST_SESSION)
        self.pairing = FakePairing()
        self.identity = FakeIdentity()
        self.credential = FakeCredential()
        self.queue = FakeQueue()
        self.clock = FakeClock()
        self.transport = FakeTransport()
        self.authority = FakeAuthority()
        self.replay = FakeReplay()
        self.audit = FakeAudit()
        self.native = FakeNative()
        self.host = CoreHost(
            HostPorts(
                state=self.state,
                pairing=self.pairing,
                identity=self.identity,
                credential=self.credential,
                queue=self.queue,
                clock=self.clock,
                transport=self.transport,
                authority=self.authority,
                replay=self.replay,
                audit=self.audit,
                native=self.native,
                status=FakeStatus(),
            ),
            host_session_id=HOST_SESSION,
            runtime_instance_id="runtime-instance-01",
        )

    def pair(self, sequence: int = 1, epoch: int = 0) -> dict[str, Any]:
        return self.host.handle(
            request(
                "pair",
                sequence,
                epoch,
                pairing_code="ABC123",
                local_installation_nonce="A" * 43,
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
        envelope = broker_envelope(2)
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
            request("pair", 3, 1, pairing_code="ABC123", local_installation_nonce="A" * 43)
        )
        self.assertEqual(reused["error"]["code"], "stolen_pairing_code")
        self.assertEqual(self.host.handle(request("pause", 4, 0))["error"]["code"], "stale_command_policy_epoch")

        self.assertTrue(self.host.handle(request("connect", 5, 1, binding=BINDING))["ok"])
        self.assertTrue(self.host.handle(request("set_access_mode", 6, 1, target_mode="ask_every_time"))["ok"])
        base = broker_envelope(2)
        sequence = 7
        for case_id, code in {
            "execution-context-payload-tampered": "denied_approval",
            "offline-broker-actuation": "denied_transport",
            "request-digest-mismatch": "denied_approval",
        }.items():
            envelope = broker_envelope(2, command_id=f"command-{case_id}")
            if case_id == "execution-context-payload-tampered":
                envelope["execution_context"]["payload_base64url"] = "dGFtcGVyZWQ"
            elif case_id == "offline-broker-actuation":
                self.clock.online = False
            elif case_id == "request-digest-mismatch":
                envelope["command"]["request"]["target_snapshot_id"] = "snapshot-tampered"
            response = self.host.handle(request("dispatch_action", sequence, 2, envelope=envelope))
            self.assertEqual(response["result"]["outcome"], "denied", case_id)
            self.assertEqual(self.audit.received_reason_codes[-1], code, case_id)
            self.assertEqual(self.authority.approval_calls, 0, case_id)
            self.clock.online = True
            sequence += 1
        replay_envelope = broker_envelope(2, command_id="command-replay")
        first = self.host.handle(request("dispatch_action", sequence, 2, envelope=replay_envelope))
        self.assertEqual(first["result"]["outcome"], "executed")
        sequence += 1
        second = self.host.handle(request("dispatch_action", sequence, 2, envelope=replay_envelope))
        self.assertEqual(second["result"]["outcome"], "denied")
        self.assertEqual(self.authority.approval_calls, 1)
        self.assertEqual(self.native.executions, 1)
        sequence += 1
        self.authority.revoked_grants.add("grant-01")
        revoked = self.host.handle(
            request(
                "dispatch_action",
                sequence,
                2,
                envelope=broker_envelope(2, command_id="command-revoked-grant"),
            )
        )
        self.assertFalse(revoked["ok"])
        self.assertEqual(revoked["error"]["code"], "grant_revoked")
        self.assertIsNotNone(revoked["error"]["audit_id"])
        self.assertEqual(self.audit.received_reason_codes[-1], "grant_expired")
        self.assertEqual(self.state.load()["pairing_state"], "revoked")
        self.assertEqual(self.native.executions, 1)

    def test_audit_failure_forces_off_and_prevents_actuation(self) -> None:
        self.assertTrue(self.pair()["ok"])
        self.assertTrue(self.host.handle(request("set_access_mode", 2, 1, target_mode="ask_every_time"))["ok"])
        self.audit.fail = True
        envelope = broker_envelope(2)
        response = self.host.handle(request("dispatch_action", 3, 2, envelope=envelope))
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "audit_write_failed")
        self.assertEqual(self.native.executions, 0)
        self.assertEqual(self.state.load()["effective_mode"], "off")

    def test_unknown_fields_fail_before_port_access(self) -> None:
        invalid = request("status", 1, None, renderer_secret="forbidden")
        response = self.host.handle(invalid)
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "invalid_request_fields")
        self.assertEqual(self.state.load()["last_sequence"], 0)

    def test_malformed_and_nested_secret_inputs_are_contained_before_ports(self) -> None:
        response = self.host.handle([])
        self.assertFalse(response["ok"])
        self.assertEqual(response["request_id"], "invalid-request")
        self.assertEqual(response["error"]["code"], "invalid_request")

        malformed_identity = request("status", 1, None)
        malformed_identity["request_id"] = "raw secret with spaces"
        response = self.host.handle(malformed_identity)
        self.assertEqual(response["request_id"], "invalid-request")
        self.assertEqual(response["host_session_id"], "invalid-session")

        envelope = broker_envelope(0)
        envelope["renderer_secret"] = "must-not-cross"
        response = self.host.handle(request("dispatch_action", 1, 0, envelope=envelope))
        self.assertEqual(response["error"]["code"], "invalid_command_envelope")
        self.assertEqual(self.state.load()["last_sequence"], 0)
        self.assertEqual(self.identity.calls, 0)
        self.assertEqual(self.audit.sequence, 0)
        self.assertEqual(self.native.executions, 0)
        self.assertEqual(self.clock.calls, 0)

        cursor = {"sequence": 1, "record_sha256": "aa" * 32, "token": "forbidden"}
        response = self.host.handle(request("audit_summary", 1, 0, after_cursor=cursor, limit=10))
        self.assertEqual(response["error"]["code"], "invalid_audit_cursor")
        self.assertEqual(self.audit.sequence, 0)

    def test_disconnected_transport_cannot_enable_or_execute(self) -> None:
        self.assertTrue(self.pair()["ok"])
        access = self.host.handle(request("set_access_mode", 2, 1, target_mode="ask_every_time"))
        self.assertTrue(access["ok"])
        self.assertEqual(access["result"]["effective_mode"], "off")
        response = self.host.handle(request("dispatch_action", 3, 2, envelope=broker_envelope(2)))
        self.assertTrue(response["ok"])
        self.assertEqual(response["result"]["outcome"], "denied")
        self.assertEqual(self.native.executions, 0)

    def test_transport_requires_exact_connected_binding_receipt(self) -> None:
        self.assertTrue(self.pair()["ok"])
        self.transport.connect = lambda binding: {}
        response = self.host.handle(request("connect", 2, 1, binding=BINDING))
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "invalid_transport_receipt")
        self.assertEqual(self.state.load()["transport_state"], "disconnected")
        self.assertEqual(self.transport.state, "blocked")
        access = self.host.handle(request("set_access_mode", 3, 1, target_mode="ask_every_time"))
        self.assertEqual(access["result"]["effective_mode"], "off")
        action = self.host.handle(request("dispatch_action", 4, 2, envelope=broker_envelope(2)))
        self.assertEqual(action["result"]["outcome"], "denied")
        self.assertEqual(self.native.executions, 0)

    def test_audit_records_are_closed_redacted_and_digest_verified_before_actuation(self) -> None:
        for mutation in ("digest", "evidence", "extra", "anchor", "reason"):
            with self.subTest(mutation=mutation):
                host = self._fresh_host()
                self.assertTrue(host.pair()["ok"])
                self.assertTrue(host.host.handle(request("connect", 2, 1, binding=BINDING))["ok"])
                self.assertTrue(host.host.handle(request("set_access_mode", 3, 1, target_mode="ask_every_time"))["ok"])
                original = host.audit._record

                def malformed(*args: Any, **kwargs: Any) -> dict[str, Any]:
                    record = original(*args, **kwargs)
                    if mutation == "digest":
                        record["record_sha256"] = "00" * 32
                    elif mutation == "evidence":
                        record["evidence"]["clipboard_content"] = "private text"
                    elif mutation in {"extra", "anchor"}:
                        if mutation == "extra":
                            record["raw_customer_data"] = "Alice home documents"
                        else:
                            host.audit.previous_record_sha256 = "ff" * 32
                    else:
                        record["reason_code"] = "denied_access_off"
                        payload = {key: value for key, value in record.items() if key != "record_sha256"}
                        canonical = json.dumps(
                            payload,
                            ensure_ascii=False,
                            allow_nan=False,
                            sort_keys=True,
                            separators=(",", ":"),
                        )
                        record["record_sha256"] = hashlib.sha256(canonical.encode()).hexdigest()
                        host.audit.previous_record_sha256 = record["record_sha256"]
                    return record

                host.audit._record = malformed
                response = host.host.handle(request("dispatch_action", 4, 2, envelope=broker_envelope(2)))
                self.assertFalse(response["ok"])
                self.assertEqual(response["error"]["code"], "audit_write_failed")
                self.assertEqual(host.native.executions, 0)
                self.assertEqual(host.state.load()["effective_mode"], "off")

    def test_replay_identities_burn_before_local_approval(self) -> None:
        mutations = {
            "context_id": lambda envelope: (
                envelope.update(command_id="command-02", nonce="bm9uY2UtMDI", sequence=43)
            ),
            "command_id": lambda envelope: (
                envelope["execution_context"]["claims"].update(context_id="Y29udGV4dC0wMg"),
                envelope.update(nonce="bm9uY2UtMDI", sequence=43),
            ),
            "nonce": lambda envelope: (
                envelope["execution_context"]["claims"].update(context_id="Y29udGV4dC0wMg"),
                envelope.update(command_id="command-02", sequence=43),
            ),
            "channel_sequence": lambda envelope: (
                envelope["execution_context"]["claims"].update(context_id="Y29udGV4dC0wMg"),
                envelope.update(command_id="command-02", nonce="bm9uY2UtMDI"),
            ),
        }
        for identity, mutate in mutations.items():
            with self.subTest(identity=identity):
                host = self._fresh_host()
                self.assertTrue(host.pair()["ok"])
                self.assertTrue(host.host.handle(request("connect", 2, 1, binding=BINDING))["ok"])
                self.assertTrue(host.host.handle(request("set_access_mode", 3, 1, target_mode="ask_every_time"))["ok"])
                first = broker_envelope(2)
                self.assertEqual(
                    host.host.handle(request("dispatch_action", 4, 2, envelope=first))["result"]["outcome"],
                    "executed",
                )
                second = broker_envelope(2)
                mutate(second)
                rehash_envelope(second)
                response = host.host.handle(request("dispatch_action", 5, 2, envelope=second))
                self.assertEqual(response["result"]["outcome"], "denied")
                self.assertEqual(host.authority.approval_calls, 1)
                self.assertEqual(host.native.executions, 1)

    def test_restart_downgrades_full_access_and_requires_reconfirmation(self) -> None:
        self.assertTrue(self.pair()["ok"])
        self.assertTrue(self.host.handle(request("connect", 2, 1, binding=BINDING))["ok"])
        enabled = self.host.handle(request("set_access_mode", 3, 1, target_mode="full_access"))
        self.assertEqual(enabled["result"]["effective_mode"], "full_access")
        restarted = CoreHost(
            self.host._ports,
            host_session_id="host-session-02",
            runtime_instance_id="runtime-instance-02",
        )
        restart_request = request("status", 1, None)
        restart_request["host_session_id"] = "host-session-02"
        response = restarted.handle(restart_request)
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "runtime_restarted")
        state = self.state.load()
        self.assertEqual(state["configured_mode"], "full_access")
        self.assertEqual(state["effective_mode"], "off")
        self.assertTrue(state["local_confirmation_required"])
        self.assertIsNone(state["confirmed_runtime_instance_id"])
        self.assertEqual(state["transport_state"], "disconnected")
        accepted = restarted.handle(restart_request)
        self.assertTrue(accepted["ok"])
        old_session = request("status", 4, None)
        self.assertEqual(restarted.handle(old_session)["error"]["code"], "stale_core_host_session")

    def test_grant_expiry_is_a_persistent_revocation_transition(self) -> None:
        self.assertTrue(self.pair()["ok"])
        self.assertTrue(self.host.handle(request("connect", 2, 1, binding=BINDING))["ok"])
        self.assertTrue(self.host.handle(request("set_access_mode", 3, 1, target_mode="ask_every_time"))["ok"])
        self.clock.rejection = "grant_expired"
        response = self.host.handle(request("dispatch_action", 4, 2, envelope=broker_envelope(2)))
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "grant_expired")
        self.assertIsNotNone(response["error"]["audit_id"])
        state = self.state.load()
        self.assertEqual(state["pairing_state"], "revoked")
        self.assertIsNone(state["selected_binding"])
        self.assertEqual(state["effective_mode"], "off")
        self.assertEqual(state["transport_state"], "revoked")
        self.assertEqual(state["policy_epoch"], 3)
        self.assertEqual(self.credential.erases, 1)
        self.assertEqual(self.native.executions, 0)

    def test_expiry_during_local_approval_is_rechecked_before_actuation(self) -> None:
        self.assertTrue(self.pair()["ok"])
        self.assertTrue(self.host.handle(request("connect", 2, 1, binding=BINDING))["ok"])
        self.assertTrue(self.host.handle(request("set_access_mode", 3, 1, target_mode="ask_every_time"))["ok"])

        def expire_during_approval(envelope: Mapping[str, Any], state: Mapping[str, Any]) -> str | None:
            self.authority.approval_calls += 1
            self.clock.rejection = "grant_expired"
            return None

        self.authority.approve_action = expire_during_approval
        response = self.host.handle(request("dispatch_action", 4, 2, envelope=broker_envelope(2)))
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "grant_expired")
        self.assertEqual(self.native.executions, 0)
        self.assertEqual(self.state.load()["pairing_state"], "revoked")

    def test_invalid_safety_status_forces_off_and_blocks_transport(self) -> None:
        self.assertTrue(self.pair()["ok"])
        self.assertTrue(self.host.handle(request("connect", 2, 1, binding=BINDING))["ok"])
        self.assertEqual(
            self.host.handle(request("set_access_mode", 3, 1, target_mode="full_access"))["result"][
                "effective_mode"
            ],
            "full_access",
        )
        original = self.host._ports.status.snapshot

        def denied_tcc(state: Mapping[str, Any]) -> Mapping[str, Any]:
            status = dict(original(state))
            status["tcc"] = {**status["tcc"], "accessibility": "denied"}
            return status

        self.host._ports.status.snapshot = denied_tcc
        response = self.host.handle(request("status", 4, None))
        self.assertFalse(response["ok"])
        state = self.state.load()
        self.assertEqual(state["effective_mode"], "off")
        self.assertEqual(state["transport_state"], "blocked")
        self.assertIsNone(state["confirmed_runtime_instance_id"])
        self.assertEqual(self.transport.state, "blocked")
        denied = self.host.handle(request("dispatch_action", 5, 3, envelope=broker_envelope(3)))
        self.assertEqual(denied["result"]["outcome"], "denied")
        self.assertEqual(self.native.executions, 0)

    def test_nonpristine_missing_runtime_identity_is_a_restart_barrier(self) -> None:
        self.assertTrue(self.pair()["ok"])
        self.assertTrue(self.host.handle(request("connect", 2, 1, binding=BINDING))["ok"])
        self.assertTrue(self.host.handle(request("set_access_mode", 3, 1, target_mode="ask_every_time"))["ok"])
        self.state._state["runtime_instance_id"] = None
        restarted = CoreHost(
            self.host._ports,
            host_session_id="host-session-02",
            runtime_instance_id="runtime-instance-02",
        )
        restart_request = request("status", 1, None)
        restart_request["host_session_id"] = "host-session-02"
        response = restarted.handle(restart_request)
        self.assertEqual(response["error"]["code"], "runtime_restarted")
        state = self.state.load()
        self.assertEqual(state["effective_mode"], "off")
        self.assertEqual(state["transport_state"], "disconnected")
        self.assertEqual(state["policy_epoch"], 3)

    def test_status_rejects_relay_build_drift_and_forces_off(self) -> None:
        original = self.host._ports.status.snapshot

        def drifted(state: Mapping[str, Any]) -> Mapping[str, Any]:
            status = dict(original(state))
            status["relay_authorization"] = {
                **status["relay_authorization"],
                "accepted_source_commit": "b" * 40,
            }
            return status

        self.host._ports.status.snapshot = drifted
        response = self.host.handle(request("status", 1, None))
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "invalid_local_status")
        self.assertEqual(self.state.load()["effective_mode"], "off")

    def test_policy_epoch_exhaustion_never_wraps_authority(self) -> None:
        self.assertTrue(self.host.handle(request("status", 1, None))["ok"])
        self.state._state["policy_epoch"] = SAFE_INTEGER_MAX
        response = self.host.handle(request("stop", 2, SAFE_INTEGER_MAX))
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "policy_epoch_exhausted")
        self.assertEqual(self.state.load()["policy_epoch"], SAFE_INTEGER_MAX)
        self.assertEqual(self.state.load()["effective_mode"], "off")
        self.assertEqual(self.transport.state, "blocked")

    def test_status_rejects_unknown_secret_bearing_output(self) -> None:
        original = self.host._ports.status.snapshot
        self.host._ports.status.snapshot = lambda state: {
            **original(state),
            "authorization": "Bearer raw-secret-value",
        }
        response = self.host.handle(request("status", 1, None))
        self.assertFalse(response["ok"])
        self.assertNotIn("raw-secret-value", json.dumps(response))

    def test_kill_switch_wins_a_concurrent_connect_race(self) -> None:
        self.assertTrue(self.pair()["ok"])
        entered = threading.Event()
        release = threading.Event()

        def delayed_connect(binding: Mapping[str, Any]) -> Mapping[str, Any]:
            entered.set()
            self.assertTrue(release.wait(5))
            self.transport.state = "connected"
            return {"state": "connected", "binding": dict(binding)}

        self.transport.connect = delayed_connect
        connect_response: list[dict[str, Any]] = []
        thread = threading.Thread(
            target=lambda: connect_response.append(
                self.host.handle(request("connect", 2, 1, binding=BINDING))
            )
        )
        thread.start()
        self.assertTrue(entered.wait(5))
        killed = self.host.handle(request("activate_kill_switch", 3, 1))
        self.assertTrue(killed["ok"])
        release.set()
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertFalse(connect_response[0]["ok"])
        self.assertEqual(connect_response[0]["error"]["code"], "host_state_conflict")
        self.assertEqual(self.transport.state, "blocked")
        self.assertTrue(self.state.load()["kill_switch"])

    def test_kill_switch_owns_reservation_through_commit_and_denies_waiting_action(self) -> None:
        self.assertTrue(self.pair()["ok"])
        self.assertTrue(self.host.handle(request("connect", 2, 1, binding=BINDING))["ok"])
        self.assertTrue(self.host.handle(request("set_access_mode", 3, 1, target_mode="ask_every_time"))["ok"])
        entered = threading.Event()
        release = threading.Event()
        original_reserve = self.host._reserve_sequence

        def delayed_kill_reservation(value: Mapping[str, Any]) -> dict[str, Any]:
            state = original_reserve(value)
            if value["operation"] == "activate_kill_switch":
                entered.set()
                self.assertTrue(release.wait(5))
            return state

        self.host._reserve_sequence = delayed_kill_reservation
        responses: dict[str, dict[str, Any]] = {}
        kill = threading.Thread(
            target=lambda: responses.setdefault(
                "kill", self.host.handle(request("activate_kill_switch", 4, 2))
            )
        )
        action = threading.Thread(
            target=lambda: responses.setdefault(
                "action", self.host.handle(request("dispatch_action", 5, 2, envelope=broker_envelope(2)))
            )
        )
        kill.start()
        self.assertTrue(entered.wait(5))
        action.start()
        release.set()
        kill.join(5)
        action.join(5)
        self.assertFalse(kill.is_alive())
        self.assertFalse(action.is_alive())
        self.assertTrue(responses["kill"]["ok"])
        self.assertFalse(responses["action"]["ok"])
        self.assertEqual(responses["action"]["error"]["code"], "stale_command_policy_epoch")
        self.assertEqual(self.native.executions, 0)
        state = self.state.load()
        self.assertTrue(state["kill_switch"])
        self.assertEqual(state["configured_mode"], "off")
        self.assertEqual(state["effective_mode"], "off")
        self.assertEqual(state["transport_state"], "blocked")

    def test_kill_switch_cancels_registered_action_without_waiting_for_native_completion(self) -> None:
        self.assertTrue(self.pair()["ok"])
        self.assertTrue(self.host.handle(request("connect", 2, 1, binding=BINDING))["ok"])
        self.assertTrue(self.host.handle(request("set_access_mode", 3, 1, target_mode="ask_every_time"))["ok"])
        entered = threading.Event()
        release = threading.Event()
        registered = threading.Event()

        class BlockingAction:
            def wait(action_self) -> Mapping[str, Any]:
                self.native.executions += 1
                entered.set()
                self.assertTrue(release.wait(5))
                return {"outcome": "executed", "reason_code": "action_completed"}

        def begin(envelope: Mapping[str, Any]) -> BlockingAction:
            registered.set()
            return BlockingAction()

        self.native.begin = begin
        responses: dict[str, dict[str, Any]] = {}
        action = threading.Thread(
            target=lambda: responses.setdefault(
                "action", self.host.handle(request("dispatch_action", 4, 2, envelope=broker_envelope(2)))
            )
        )
        action.start()
        self.assertTrue(registered.wait(5))
        self.assertTrue(entered.wait(5))
        kill = threading.Thread(
            target=lambda: responses.setdefault(
                "kill", self.host.handle(request("activate_kill_switch", 5, 2))
            )
        )
        kill.start()
        kill.join(1)
        self.assertFalse(kill.is_alive())
        self.assertTrue(responses["kill"]["ok"])
        self.assertTrue(self.state.load()["kill_switch"])
        self.assertEqual(self.state.load()["effective_mode"], "off")
        self.assertEqual(self.native.cancellations, 1)
        self.assertTrue(action.is_alive())
        release.set()
        action.join(5)
        self.assertFalse(action.is_alive())
        self.assertTrue(responses["action"]["ok"])
        self.assertEqual(responses["action"]["result"]["outcome"], "stopped")
        self.assertEqual(self.native.executions, 1)

    def test_invalid_status_barrier_reloads_after_concurrent_action_commit(self) -> None:
        self.assertTrue(self.pair()["ok"])
        self.assertTrue(self.host.handle(request("connect", 2, 1, binding=BINDING))["ok"])
        self.assertTrue(self.host.handle(request("set_access_mode", 3, 1, target_mode="ask_every_time"))["ok"])
        entered = threading.Event()
        release = threading.Event()
        original_snapshot = self.host._ports.status.snapshot

        def delayed_denied_tcc(state: Mapping[str, Any]) -> Mapping[str, Any]:
            status = dict(original_snapshot(state))
            entered.set()
            self.assertTrue(release.wait(5))
            status["tcc"] = {**status["tcc"], "accessibility": "denied"}
            return status

        self.host._ports.status.snapshot = delayed_denied_tcc
        responses: dict[str, dict[str, Any]] = {}
        status_thread = threading.Thread(
            target=lambda: responses.setdefault("status", self.host.handle(request("status", 4, None)))
        )
        status_thread.start()
        self.assertTrue(entered.wait(5))
        action = self.host.handle(request("dispatch_action", 5, 2, envelope=broker_envelope(2)))
        self.assertTrue(action["ok"])
        self.assertEqual(action["result"]["outcome"], "executed")
        release.set()
        status_thread.join(5)
        self.assertFalse(status_thread.is_alive())
        self.assertFalse(responses["status"]["ok"])
        self.assertEqual(responses["status"]["error"]["code"], "invalid_local_status")
        state = self.state.load()
        self.assertEqual(state["configured_mode"], "ask_every_time")
        self.assertEqual(state["effective_mode"], "off")
        self.assertEqual(state["transport_state"], "blocked")
        self.assertEqual(self.transport.state, "blocked")
        fresh = broker_envelope(state["policy_epoch"], command_id="command-02")
        fresh["sequence"] = 2
        fresh["nonce"] = "nonce-02"
        fresh["execution_context"]["claims"]["context_id"] = "context-02"
        rehash_envelope(fresh)
        denied = self.host.handle(
            request("dispatch_action", 6, state["policy_epoch"], envelope=fresh)
        )
        self.assertTrue(denied["ok"])
        self.assertEqual(denied["result"]["outcome"], "denied")
        self.assertEqual(self.native.executions, 1)

    def test_action_failure_writes_causal_result_and_forces_off(self) -> None:
        self.assertTrue(self.pair()["ok"])
        self.assertTrue(self.host.handle(request("connect", 2, 1, binding=BINDING))["ok"])
        self.assertTrue(self.host.handle(request("set_access_mode", 3, 1, target_mode="ask_every_time"))["ok"])
        self.native.fail = True
        response = self.host.handle(request("dispatch_action", 4, 2, envelope=broker_envelope(2)))
        self.assertTrue(response["ok"])
        self.assertEqual(response["result"]["outcome"], "failed")
        self.assertIsNotNone(response["result"]["result_audit_id"])
        self.assertEqual(
            response["result"]["result_audit"]["causation_audit_id"],
            response["result"]["decision_audit_id"],
        )
        self.assertEqual(self.state.load()["effective_mode"], "off")

    def test_stop_revoke_and_kill_persist_barriers_before_failing_cleanup(self) -> None:
        for operation in ("stop", "revoke", "activate_kill_switch"):
            with self.subTest(operation=operation):
                host = self._fresh_host()
                self.assertTrue(host.pair()["ok"])
                self.assertTrue(host.host.handle(request("connect", 2, 1, binding=BINDING))["ok"])
                self.assertTrue(
                    host.host.handle(request("set_access_mode", 3, 1, target_mode="ask_every_time"))["ok"]
                )
                host.queue.fail = True
                host.replay.fail = True
                host.native.cancel_fail = True
                host.transport.fail = True
                response = host.host.handle(request(operation, 4, 2))
                self.assertFalse(response["ok"])
                state = host.state.load()
                self.assertEqual(state["effective_mode"], "off")
                self.assertEqual(state["policy_epoch"], 3)
                self.assertGreaterEqual(host.queue.clears, 1)
                self.assertGreaterEqual(host.replay.invalidations, 1)
                self.assertGreaterEqual(host.native.cancellations, 1)
                if operation == "revoke":
                    self.assertEqual(state["pairing_state"], "revoked")
                    self.assertIsNone(state["selected_binding"])
                    self.assertEqual(host.credential.erases, 1)
                elif operation == "activate_kill_switch":
                    self.assertTrue(state["kill_switch"])
                    self.assertEqual(state["configured_mode"], "off")

    def test_corrupt_state_recovers_to_persistent_blocked_off(self) -> None:
        self.state._state["effective_mode"] = "full_access"
        self.state._state["configured_mode"] = "off"
        self.transport.state = "connected"
        del self.state._state["revision"]
        response = self.host.handle(request("status", 1, None))
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "corrupt_state_recovered_off")
        state = self.state.load()
        self.assertEqual(state["pairing_state"], "revoked")
        self.assertEqual(state["effective_mode"], "off")
        self.assertTrue(state["kill_switch"])
        self.assertEqual(state["transport_state"], "blocked")
        self.assertEqual(self.transport.state, "blocked")


if __name__ == "__main__":
    unittest.main()
