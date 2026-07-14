/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const bridgeSourceDir = join(process.cwd(), 'resources', 'evaos-beta', 'bridge', 'src');

function runPython(script: string): string {
  return execFileSync('python3', ['-B', '-c', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPATH: bridgeSourceDir,
    },
  }).trim();
}

describe('vendored desktop bridge safety boundaries', () => {
  it('linearizes start, stop, kill, and takeover metadata with a generation-bound state file', () => {
    const output = runPython(`
import stat
from pathlib import Path
from tempfile import TemporaryDirectory
from evaos_desktop_bridge.state import (
    ControlKillSwitchActiveError,
    ControlSessionChangedError,
    kill_control_session,
    merge_takeover_signal_status,
    start_control_session,
)

with TemporaryDirectory() as temporary_root:
    root = Path(temporary_root)
    killed = kill_control_session(root)
    assert killed["active"] is False and killed["kill_switch"] is True
    killed_generation = killed["generation"]

    try:
        start_control_session(mode="full_access", state_dir=root)
        raise AssertionError("remote/default start cleared the kill switch")
    except ControlKillSwitchActiveError:
        pass

    restarted = start_control_session(
        mode="full_access",
        reset_kill_switch=True,
        expected_generation=killed_generation,
        state_dir=root,
    )
    assert restarted["active"] is True and restarted["kill_switch"] is False
    assert restarted["generation"] > killed_generation

    try:
        start_control_session(
            mode="full_access",
            reset_kill_switch=True,
            expected_generation=killed_generation,
            state_dir=root,
        )
        raise AssertionError("stale Workbench generation restarted control")
    except ControlSessionChangedError:
        pass

    killed_again = kill_control_session(root)
    merged, applied = merge_takeover_signal_status(
        expected_generation=restarted["generation"],
        signal_status={"notification": {"available": True}},
        state_dir=root,
    )
    assert applied is False
    assert merged["active"] is False and merged["kill_switch"] is True
    assert merged["generation"] == killed_again["generation"]
    assert stat.S_IMODE((root / "control-session.json").stat().st_mode) == 0o600
    assert stat.S_IMODE((root / "control-session.lock").stat().st_mode) == 0o600

print("ok")
`);

    expect(output).toBe('ok');
  });

  it('hashes guarded customer content while preserving exact approval matching', () => {
    const output = runPython(`
import json
import stat
from argparse import Namespace
from pathlib import Path
from tempfile import TemporaryDirectory
from evaos_desktop_bridge.audit import append_audit
from evaos_desktop_bridge.cli import _audit_args, _prepare_audit_hashes, _validate_guarded_approval
from evaos_desktop_bridge.state import read_audit_record, read_audit_tail

sentinel = "ordinary-private-password-42 https://private.example/path?token=abc 100.64.0.9 /tmp/private-value Bearer secret-token-value"
with TemporaryDirectory() as temporary_root:
    root = Path(temporary_root)
    dry_run = Namespace(
        command_id="customer_mac.desktop_type",
        target="customer_mac",
        state_dir=root,
        text=sentinel,
        dry_run=True,
        approval_audit_id=None,
    )
    _prepare_audit_hashes("customer_mac.desktop_type", dry_run)
    safe_args = _audit_args("customer_mac.desktop_type", dry_run)
    assert "text" not in safe_args
    assert safe_args["text_hash"] and safe_args["text_length"] == len(sentinel)
    audit_id = append_audit(
        command="customer_mac.desktop_type",
        target="customer_mac",
        args=safe_args,
        ok=True,
        warnings=[sentinel],
        errors=[],
        provenance={"url": "https://private.example", "ip": "100.64.0.9", "temp_path": "/tmp/private-value"},
        state_dir=root,
    )

    live = Namespace(
        command_id="customer_mac.desktop_type",
        target="customer_mac",
        state_dir=root,
        text=sentinel,
        dry_run=False,
        approval_audit_id=audit_id,
    )
    _prepare_audit_hashes("customer_mac.desktop_type", live)
    assert _validate_guarded_approval("customer_mac.desktop_type", live, root).ok is True

    raw_audit = (root / "audit.jsonl").read_text(encoding="utf-8")
    tail = json.dumps(read_audit_tail(state_dir=root))
    for forbidden in (
        "ordinary-private-password-42",
        "https://private.example",
        "100.64.0.9",
        "/tmp/private-value",
        "secret-token-value",
    ):
        assert forbidden not in raw_audit
        assert forbidden not in tail
    assert stat.S_IMODE((root / "audit.jsonl").stat().st_mode) == 0o600

    legacy_id = "audit-legacy-private"
    legacy_record = {
        "audit_id": legacy_id,
        "timestamp": "2026-07-01T00:00:00Z",
        "command": "customer_mac.desktop_type",
        "target": "customer_mac",
        "args": {"text": sentinel, "customer_id": "private-customer", "target_label": "Private Target"},
        "ok": True,
        "warnings": [sentinel],
        "errors": [{"message": sentinel, "guidance": sentinel}],
        "provenance": {"url": "https://private.example", "ip": "100.64.0.9", "temp_path": "/tmp/private-value"},
    }
    with (root / "audit.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(legacy_record, separators=(",", ":")) + "\\n")
    legacy_tail = json.dumps(read_audit_tail(state_dir=root))
    legacy_exact = json.dumps(read_audit_record(legacy_id, state_dir=root))
    for forbidden in (
        "ordinary-private-password-42",
        "private-customer",
        "Private Target",
        "https://private.example",
        "100.64.0.9",
        "/tmp/private-value",
        "secret-token-value",
    ):
        assert forbidden not in legacy_tail
        assert forbidden not in legacy_exact

print("ok")
`);

    expect(output).toBe('ok');
  });

  it('does not let a remote action execute after a completed kill-switch request', () => {
    const output = runPython(`
import json
import os
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from evaos_desktop_bridge.cli import _run_bridge_argv
from evaos_desktop_bridge.connector_server import _make_handler
from evaos_desktop_bridge.state import read_control_session, start_control_session, write_control_session

os.environ["EVAOS_DESKTOP_BRIDGE_DISABLE_TAKEOVER_WARNING_UI"] = "1"
with TemporaryDirectory() as temporary_root:
    root = Path(temporary_root)
    start_entered = threading.Event()
    release_start = threading.Event()
    kill_completed = threading.Event()
    order = []

    session = start_control_session(mode="full_access", state_dir=root)
    session["takeover_warning_started_at"] = None
    session["takeover_warning_until"] = None
    write_control_session(session, state_dir=root)

    def runner(argv):
        if "desktop" in argv and "hotkey" in argv:
            assert argv[:3] == ["customer-mac", "--remote-control-generation", str(session["generation"])]
            start_entered.set()
            assert release_start.wait(5)
            result = _run_bridge_argv(argv, state_dir=root)
            order.append("action")
            return result
        if argv == ["customer-mac", "control", "kill-switch", "--json"]:
            result = _run_bridge_argv(argv, state_dir=root)
            order.append("kill")
            return result
        raise AssertionError(argv)

    handler = _make_handler(token="connector-test-token", command_runner=runner, state_dir=root)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    endpoint = f"http://127.0.0.1:{server.server_address[1]}/v1/commands"
    failures = []

    def post(command, params=None):
        request = urllib.request.Request(
            endpoint,
            method="POST",
            data=json.dumps({"command": command, "params": params or {}}).encode("utf-8"),
            headers={"Authorization": "Bearer connector-test-token", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def start_request():
        try:
            status, payload = post("desktopHotkey", {"keys": "escape", "dry_run": False})
            assert status == 422 and payload["ok"] is False
            assert payload["errors"][0]["code"] == "control_session_changed"
        except Exception as exc:
            failures.append(repr(exc))

    def kill_request():
        try:
            status, payload = post("customerMacControlKillSwitch")
            assert status == 200 and payload["ok"] is True
            kill_completed.set()
        except Exception as exc:
            failures.append(repr(exc))

    start_thread = threading.Thread(target=start_request)
    start_thread.start()
    assert start_entered.wait(5)
    kill_thread = threading.Thread(target=kill_request)
    kill_thread.start()
    assert kill_completed.wait(5)
    release_start.set()
    start_thread.join(8)
    kill_thread.join(8)
    assert not start_thread.is_alive() and not kill_thread.is_alive()
    assert failures == [], failures
    assert kill_completed.is_set() is True
    assert order == ["kill", "action"], order
    final = read_control_session(root)
    assert final["active"] is False and final["kill_switch"] is True
    server.shutdown()
    server.server_close()

print("ok")
`);

    expect(output).toBe('ok');
  });
});
