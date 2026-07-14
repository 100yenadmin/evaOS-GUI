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

describe('vendored desktop bridge control-session P0 boundaries', () => {
  it('fails closed for unreadable or invalid existing state while preserving local recovery', () => {
    const output = runPython(`
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from evaos_desktop_bridge.state import (
    ControlKillSwitchActiveError,
    default_control_session,
    read_control_session,
    start_control_session,
)

def assert_failed_closed(session, code):
    assert session["active"] is False
    assert session["ready"] is False
    assert session["kill_switch"] is True
    assert session["state_integrity"] == "invalid"
    assert session["state_error_code"] == code
    assert session["recovery_required"] is True

with TemporaryDirectory() as temporary_root:
    root = Path(temporary_root)
    state_path = root / "control-session.json"

    absent = read_control_session(root)
    assert absent["active"] is False and absent["kill_switch"] is False
    assert "state_error_code" not in absent

    state_path.write_text("{not-json", encoding="utf-8")
    corrupt = read_control_session(root)
    assert_failed_closed(corrupt, "control_session_state_invalid")
    try:
        start_control_session(mode="full_access", state_dir=root)
        raise AssertionError("remote/default start cleared corrupt-state kill switch")
    except ControlKillSwitchActiveError:
        pass

    recovered = start_control_session(
        mode="full_access",
        reset_kill_switch=True,
        expected_generation=corrupt["generation"],
        state_dir=root,
    )
    assert recovered["active"] is True and recovered["kill_switch"] is False
    assert "state_error_code" not in recovered

    real_open = os.open
    def unreadable_state(path, flags, mode=0o777):
        if Path(path).name == "control-session.json":
            raise PermissionError("simulated unreadable state")
        return real_open(path, flags, mode)

    with patch("evaos_desktop_bridge.state.os.open", side_effect=unreadable_state):
        unreadable = read_control_session(root)
        recovered_unreadable = start_control_session(
            mode="full_access",
            reset_kill_switch=True,
            expected_generation=unreadable["generation"],
            state_dir=root,
        )
    assert_failed_closed(unreadable, "control_session_state_unreadable")
    assert recovered_unreadable["active"] is True and recovered_unreadable["kill_switch"] is False
    assert "state_error_code" not in recovered_unreadable

    invalid_mutations = [
        ("active", "false"),
        ("kill_switch", 0),
        ("generation", True),
        ("generation", -1),
        ("mode", "owner"),
        ("takeover_warning_seconds", True),
        ("takeover_warning_until", "not-a-timestamp"),
        ("takeover_alert_signal_status", []),
    ]
    for field, value in invalid_mutations:
        payload = default_control_session()
        payload[field] = value
        state_path.write_text(json.dumps(payload), encoding="utf-8")
        assert_failed_closed(read_control_session(root), "control_session_state_invalid")

print("ok")
`);

    expect(output).toBe('ok');
  });

  it('holds kill behind a direct live adapter mutation without a remote generation', () => {
    const output = runPython(`
import io
import json
import threading
from pathlib import Path
from tempfile import TemporaryDirectory
from evaos_desktop_bridge.cli import main
from evaos_desktop_bridge.state import (
    kill_control_session,
    read_control_session,
    start_control_session,
    write_control_session,
)
from evaos_desktop_bridge.types import CommandResult

with TemporaryDirectory() as temporary_root:
    root = Path(temporary_root)
    mutation_entered = threading.Event()
    release_mutation = threading.Event()
    kill_attempted = threading.Event()
    kill_completed = threading.Event()
    order = []
    failures = []
    action_result = {}

    session = start_control_session(mode="full_access", state_dir=root)
    session["takeover_warning_started_at"] = None
    session["takeover_warning_until"] = None
    session = write_control_session(session, state_dir=root)

    class BlockingCustomerMac:
        def desktop_hotkey(self, *, keys, dry_run=False):
            assert keys == "escape" and dry_run is False
            order.append("mutation-start")
            mutation_entered.set()
            assert release_mutation.wait(5)
            order.append("mutation-end")
            return CommandResult(ok=True, data={"pressed": True})

    customer_mac = BlockingCustomerMac()

    def action():
        try:
            stdout = io.StringIO()
            action_result["exit_code"] = main(
                [
                    "customer-mac",
                    "desktop",
                    "hotkey",
                    "--keys",
                    "escape",
                    "--json",
                ],
                observer_factory=lambda: object(),
                customer_mac_factory=lambda: customer_mac,
                app_server_factory=lambda: object(),
                stdout=stdout,
                state_dir=root,
            )
            action_result["payload"] = json.loads(stdout.getvalue())
        except Exception as exc:
            failures.append(repr(exc))

    def kill():
        try:
            kill_attempted.set()
            killed = kill_control_session(root)
            order.append("kill")
            assert killed["kill_switch"] is True
            kill_completed.set()
        except Exception as exc:
            failures.append(repr(exc))

    action_thread = threading.Thread(target=action)
    action_thread.start()
    assert mutation_entered.wait(5)

    kill_thread = threading.Thread(target=kill)
    kill_thread.start()
    assert kill_attempted.wait(5)
    assert kill_completed.wait(0.2) is False
    assert kill_thread.is_alive() is True

    release_mutation.set()
    action_thread.join(5)
    kill_thread.join(5)
    assert not action_thread.is_alive() and not kill_thread.is_alive()
    assert failures == [], failures
    assert action_result["exit_code"] == 0
    assert action_result["payload"]["ok"] is True
    assert order == ["mutation-start", "mutation-end", "kill"], order
    final = read_control_session(root)
    assert final["active"] is False and final["kill_switch"] is True

print("ok")
`);

    expect(output).toBe('ok');
  });

  it('serializes legacy named Mac mutations with the kill switch', () => {
    const output = runPython(`
import io
import json
import threading
from pathlib import Path
from tempfile import TemporaryDirectory

from evaos_desktop_bridge.audit import append_audit
from evaos_desktop_bridge.cli import main
from evaos_desktop_bridge.state import (
    kill_control_session,
    read_control_session,
    start_control_session,
    write_control_session,
)
from evaos_desktop_bridge.types import CommandResult

with TemporaryDirectory() as temporary_root:
    root = Path(temporary_root)
    mutation_entered = threading.Event()
    release_mutation = threading.Event()
    kill_completed = threading.Event()
    failures = []
    order = []
    action_result = {}

    session = start_control_session(mode="full_access", state_dir=root)
    session["takeover_warning_started_at"] = None
    session["takeover_warning_until"] = None
    session = write_control_session(session, state_dir=root)
    approval_id = append_audit(
        command="customer_mac.app_focus",
        target="customer_mac",
        args={"app_name": "Finder", "dry_run": True},
        ok=True,
        warnings=[],
        errors=[],
        state_dir=root,
    )

    class BlockingCustomerMac:
        def app_focus(self, *, app_name, dry_run=False):
            assert app_name == "Finder" and dry_run is False
            order.append("mutation-start")
            mutation_entered.set()
            assert release_mutation.wait(5)
            order.append("mutation-end")
            return CommandResult(ok=True, data={"focused": True})

    def action():
        try:
            stdout = io.StringIO()
            action_result["exit_code"] = main(
                [
                    "customer-mac",
                    "--remote-control-generation",
                    str(session["generation"]),
                    "app-focus",
                    "--json",
                    "--app-name",
                    "Finder",
                    "--approval-audit-id",
                    approval_id,
                ],
                observer_factory=lambda: object(),
                customer_mac_factory=BlockingCustomerMac,
                app_server_factory=lambda: object(),
                stdout=stdout,
                state_dir=root,
            )
            action_result["payload"] = json.loads(stdout.getvalue())
        except Exception as exc:
            failures.append(repr(exc))

    def kill():
        try:
            killed = kill_control_session(root)
            order.append("kill")
            assert killed["kill_switch"] is True
            kill_completed.set()
        except Exception as exc:
            failures.append(repr(exc))

    action_thread = threading.Thread(target=action)
    action_thread.start()
    assert mutation_entered.wait(5)
    kill_thread = threading.Thread(target=kill)
    kill_thread.start()
    assert kill_completed.wait(0.2) is False
    assert kill_thread.is_alive() is True

    release_mutation.set()
    action_thread.join(5)
    kill_thread.join(5)
    assert not action_thread.is_alive() and not kill_thread.is_alive()
    assert failures == [], failures
    assert action_result["exit_code"] == 0
    assert action_result["payload"]["ok"] is True
    assert order == ["mutation-start", "mutation-end", "kill"], order
    final = read_control_session(root)
    assert final["active"] is False and final["kill_switch"] is True

print("ok")
`);

    expect(output).toBe('ok');
  });

  it('generation-binds every remote legacy named Mac mutation', () => {
    const output = runPython(`
import hashlib
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

from evaos_desktop_bridge.audit import append_audit
from evaos_desktop_bridge.connector_server import _make_handler
from evaos_desktop_bridge.state import start_control_session, write_control_session

def short_hash(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]

with TemporaryDirectory() as temporary_root:
    root = Path(temporary_root)
    session = start_control_session(mode="full_access", state_dir=root)
    session["takeover_warning_started_at"] = None
    session["takeover_warning_until"] = None
    session = write_control_session(session, state_dir=root)
    commands = [
        (
            "customerMacAppFocus",
            "customer_mac.app_focus",
            {"app_name": "Finder"},
            {"app_name": "Finder", "dry_run": True},
        ),
        (
            "customerMacLocalSiteOpen",
            "customer_mac.local_site_open",
            {"url": "http://127.0.0.1:3000"},
            {"url_hash": short_hash("http://127.0.0.1:3000"), "dry_run": True},
        ),
        (
            "customerMacLocalSiteAction",
            "customer_mac.local_site_action",
            {"action": "reload"},
            {"action": "reload", "dry_run": True},
        ),
    ]
    captured = []

    def runner(argv):
        captured.append(list(argv))
        return 0, json.dumps({
            "schema_version": "2026-05-02.mvp1",
            "command": "customer_mac.test",
            "target": "customer_mac",
            "timestamp": "2026-07-15T00:00:00Z",
            "ok": True,
            "data": {},
            "warnings": [],
            "errors": [],
            "audit_id": "audit-runner",
        })

    handler = _make_handler(token="connector-test-token", command_runner=runner, state_dir=root)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    endpoint = f"http://127.0.0.1:{server.server_address[1]}/v1/commands"

    for remote_command, audit_command, params, audit_args in commands:
        approval_id = append_audit(
            command=audit_command,
            target="customer_mac",
            args=audit_args,
            ok=True,
            warnings=[],
            errors=[],
            state_dir=root,
        )
        request_params = {**params, "dry_run": False, "approval_audit_id": approval_id}
        request = urllib.request.Request(
            endpoint,
            method="POST",
            data=json.dumps({"command": remote_command, "params": request_params}).encode("utf-8"),
            headers={"Authorization": "Bearer connector-test-token", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=8) as response:
            assert response.status == 200, (remote_command, response.status, response.read())

    assert len(captured) == 3, captured
    for argv in captured:
        assert argv[:3] == [
            "customer-mac",
            "--remote-control-generation",
            str(session["generation"]),
        ], argv

    server.shutdown()
    server.server_close()

print("ok")
`);

    expect(output).toBe('ok');
  });
});
