/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const bridgeSourceDir = join(process.cwd(), 'packages', 'mac-connector-core', 'python');
const coreTestPython = process.env.EVAOS_CORE_TEST_PYTHON || 'python3';

function runPython(script: string): string {
  return execFileSync(coreTestPython, ['-B', '-c', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPATH: bridgeSourceDir,
    },
  }).trim();
}

describe('qa canary local Workbench control consent', () => {
  it('treats missing optional Peekaboo candidates as unavailable', () => {
    const output = runPython(`
from evaos_desktop_bridge.adapters import customer_mac as customer_mac_module
from evaos_desktop_bridge.adapters.customer_mac import CustomerMacObserver

customer_mac_module.PEEKABOO_BIN_CANDIDATES = ("/definitely/missing/evaos-test-peekaboo",)
runner_calls = []

def unexpected_runner(argv, timeout_seconds):
    runner_calls.append((argv, timeout_seconds))
    raise AssertionError("missing candidates must not be executed")

status = CustomerMacObserver(runner=unexpected_runner)._peekaboo_status()
assert status["available"] is False
assert runner_calls == []
print("ok")
`);

    expect(output).toBe('ok');
  });

  it('never sends control-start through a remote canary surface', () => {
    const output = runPython(`
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from evaos_desktop_bridge.host.cli import _run_bridge_argv
from evaos_desktop_bridge.proof.qa_canary import (
    INSTALLED_WORKBENCH_BRIDGE_CLI,
    LOCAL_WORKBENCH_CONTROL_START,
    OperatorAcknowledgedLocalControlSurface,
    SurfaceResponse,
    _suite_requires_selected_binding_proof,
    build_scenarios,
)
from evaos_desktop_bridge.persistence.state import kill_control_session, read_control_session

os.environ["EVAOS_DESKTOP_BRIDGE_DISABLE_TAKEOVER_WARNING_UI"] = "1"

class RecordingSurface:
    def __init__(self, status_reader):
        self.calls = []
        self.status_reader = status_reader

    def run(self, command, params):
        self.calls.append((command, params))
        data = {"session": self.status_reader()} if command == "desktop_control_status" else {}
        payload = {
            "schema_version": "2026-05-02.mvp1",
            "command": command,
            "target": "customer_mac",
            "ok": True,
            "data": data,
            "warnings": [],
            "errors": [],
            "audit_id": "audit-remote",
        }
        return SurfaceResponse.from_payload(payload)

steps = build_scenarios("all", allow_real_world_actions=False)
commands = [step.command for step in steps]
assert commands.count(LOCAL_WORKBENCH_CONTROL_START) == 2, commands
assert "desktop_control_start" not in commands
assert "customerMacControlStart" not in commands
control_start_commands = [
    step.command for step in build_scenarios("control_start", allow_real_world_actions=False)
]
assert control_start_commands == [
    "desktop_bridge_status",
    LOCAL_WORKBENCH_CONTROL_START,
    LOCAL_WORKBENCH_CONTROL_START,
    "desktop_control_stop",
    "desktop_kill_switch",
]
assert _suite_requires_selected_binding_proof(
    "control_start", allow_real_world_actions=False
) is False

with TemporaryDirectory() as temporary_root:
    root = Path(temporary_root)
    remote = RecordingSurface(lambda: read_control_session(root))
    local_argv = []

    def local_runner(executable, argv, timeout_seconds):
        assert executable == INSTALLED_WORKBENCH_BRIDGE_CLI
        assert timeout_seconds == 30
        local_argv.append(list(argv))
        return _run_bridge_argv(argv, state_dir=root)

    surface = OperatorAcknowledgedLocalControlSurface(
        remote,
        operator_ack_live_control=True,
        local_runner=local_runner,
        session_reader=lambda: read_control_session(root),
        local_kill_switch=lambda: kill_control_session(root),
    )
    full = surface.run(
        LOCAL_WORKBENCH_CONTROL_START,
        {"mode": "full-access", "agent_label": "evaOS QA Canary"},
    )
    assert full.ok is True, full.payload
    full_state = read_control_session(root)
    assert full_state["active"] is True and full_state["mode"] == "full_access"

    ask = surface.run(
        LOCAL_WORKBENCH_CONTROL_START,
        {"mode": "ask-permission", "agent_label": "evaOS QA Canary"},
    )
    assert ask.ok is True, ask.payload
    ask_state = read_control_session(root)
    assert ask_state["active"] is True and ask_state["mode"] == "ask_permission"
    assert ask_state["agent_label"].startswith("evaOS QA Canary [")
    assert ask_state["generation"] > full_state["generation"]
    assert len(local_argv) == 2
    assert local_argv[0][:4] == ["customer-mac", "control", "start", "--json"]
    assert "--local-workbench-restart" in local_argv[0]
    assert local_argv[0][local_argv[0].index("--expected-control-generation") + 1] == "0"
    assert local_argv[1][local_argv[1].index("--expected-control-generation") + 1] == str(full_state["generation"])
    assert remote.calls == [
        ("desktop_control_status", {}),
        ("desktop_control_status", {}),
    ]

    delegated = surface.run("desktop_control_status", {})
    assert delegated.ok is True
    assert remote.calls == [
        ("desktop_control_status", {}),
        ("desktop_control_status", {}),
        ("desktop_control_status", {}),
    ]
    assert surface.teardown_local_control() is True
    final_state = read_control_session(root)
    assert final_state["active"] is False and final_state["kill_switch"] is True
    assert surface.teardown_local_control() is None

print(json.dumps({"ok": True, "local_calls": len(local_argv), "remote_calls": len(remote.calls)}))
`);

    expect(JSON.parse(output)).toEqual({ ok: true, local_calls: 2, remote_calls: 3 });
  });

  it('activates the local kill switch when an all-suite action is interrupted', () => {
    const output = runPython(`
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from evaos_desktop_bridge.host.cli import _run_bridge_argv
from evaos_desktop_bridge.proof.qa_canary import (
    CanaryStep,
    LOCAL_WORKBENCH_CONTROL_START,
    OperatorAcknowledgedLocalControlSurface,
    SurfaceResponse,
    run_steps_with_local_control_cleanup,
)
from evaos_desktop_bridge.persistence.state import kill_control_session, read_control_session

os.environ["EVAOS_DESKTOP_BRIDGE_DISABLE_TAKEOVER_WARNING_UI"] = "1"

class InterruptingSurface:
    def __init__(self, state_reader):
        self.state_reader = state_reader

    def run(self, command, params):
        if command == "desktop_control_status":
            return SurfaceResponse.from_payload({
                "ok": True,
                "data": {"session": self.state_reader()},
                "warnings": [],
                "errors": [],
                "audit_id": "audit-status",
            })
        raise KeyboardInterrupt("simulated operator cancellation")

with TemporaryDirectory() as temporary_root:
    root = Path(temporary_root)
    cleanup_calls = []

    def cleanup():
        cleanup_calls.append(True)
        return kill_control_session(root)

    surface = OperatorAcknowledgedLocalControlSurface(
        InterruptingSurface(lambda: read_control_session(root)),
        operator_ack_live_control=True,
        local_runner=lambda executable, argv, timeout_seconds: _run_bridge_argv(argv, state_dir=root),
        session_reader=lambda: read_control_session(root),
        local_kill_switch=cleanup,
    )
    steps = [
        CanaryStep(
            id="all.start",
            suite="all",
            command=LOCAL_WORKBENCH_CONTROL_START,
            params={"mode": "ask-permission", "agent_label": "evaOS QA Canary"},
        ),
        CanaryStep(
            id="all.interrupted_action",
            suite="all",
            command="desktop_hotkey",
            params={"keys": "escape", "dry_run": False},
        ),
    ]
    try:
        run_steps_with_local_control_cleanup(steps, surface, suite="all")
    except KeyboardInterrupt:
        pass
    else:
        raise AssertionError("simulated operator cancellation did not propagate")

    final = read_control_session(root)
    assert final["active"] is False and final["kill_switch"] is True
    assert cleanup_calls == [True]
    assert surface.local_control_cleanup_required is False

print("ok")
`);

    expect(output).toBe('ok');
  });

  it('converts SIGTERM job cancellation into local kill-switch cleanup', () => {
    const output = runPython(`
import os
import signal
from pathlib import Path
from tempfile import TemporaryDirectory

from evaos_desktop_bridge.host.cli import _run_bridge_argv
from evaos_desktop_bridge.proof.qa_canary import (
    CanaryStep,
    LOCAL_WORKBENCH_CONTROL_START,
    OperatorAcknowledgedLocalControlSurface,
    SurfaceResponse,
    run_steps_with_local_control_cleanup,
)
from evaos_desktop_bridge.persistence.state import kill_control_session, read_control_session

os.environ["EVAOS_DESKTOP_BRIDGE_DISABLE_TAKEOVER_WARNING_UI"] = "1"

class TerminatingSurface:
    def __init__(self, state_reader):
        self.state_reader = state_reader

    def run(self, command, params):
        if command == "desktop_control_status":
            return SurfaceResponse.from_payload({
                "ok": True,
                "data": {"session": self.state_reader()},
                "warnings": [],
                "errors": [],
                "audit_id": "audit-status",
            })
        os.kill(os.getpid(), signal.SIGTERM)
        raise AssertionError("SIGTERM did not stop the active canary step")

with TemporaryDirectory() as temporary_root:
    root = Path(temporary_root)
    surface = OperatorAcknowledgedLocalControlSurface(
        TerminatingSurface(lambda: read_control_session(root)),
        operator_ack_live_control=True,
        local_runner=lambda executable, argv, timeout_seconds: _run_bridge_argv(argv, state_dir=root),
        session_reader=lambda: read_control_session(root),
        local_kill_switch=lambda: kill_control_session(root),
    )
    steps = [
        CanaryStep(
            id="all.start",
            suite="all",
            command=LOCAL_WORKBENCH_CONTROL_START,
            params={"mode": "full-access", "agent_label": "evaOS QA Canary"},
        ),
        CanaryStep(
            id="all.cancelled_action",
            suite="all",
            command="desktop_hotkey",
            params={"keys": "escape", "dry_run": False},
        ),
    ]
    try:
        run_steps_with_local_control_cleanup(steps, surface, suite="all")
    except SystemExit as error:
        assert error.code == 128 + signal.SIGTERM
    else:
        raise AssertionError("SIGTERM was not converted into an orderly canary exit")

    final = read_control_session(root)
    assert final["active"] is False and final["kill_switch"] is True
    assert signal.getsignal(signal.SIGTERM) == signal.SIG_DFL

print("ok")
`);

    expect(output).toBe('ok');
  });

  it('fails closed without operator acknowledgement or with an inconsistent local CLI response', () => {
    const output = runPython(`
import json
import subprocess

from evaos_desktop_bridge.proof.qa_canary import (
    INSTALLED_WORKBENCH_BRIDGE_CLI,
    LOCAL_WORKBENCH_CONTROL_START,
    OperatorAcknowledgedLocalControlSurface,
    SurfaceResponse,
)

class RecordingSurface:
    def __init__(self):
        self.calls = []

    def run(self, command, params):
        self.calls.append((command, params))
        raise AssertionError("remote delegate must not receive local control start")

remote = RecordingSurface()
runner_called = []
def confirmed_cleanup():
    return {"active": False, "kill_switch": True}

def unconfirmed_cleanup():
    raise RuntimeError("cleanup unavailable")

denied = OperatorAcknowledgedLocalControlSurface(
    remote,
    operator_ack_live_control=False,
    local_runner=lambda executable, argv, timeout_seconds: runner_called.append((executable, argv, timeout_seconds)),
    session_reader=lambda: {"generation": 7},
).run(LOCAL_WORKBENCH_CONTROL_START, {"mode": "full-access"})
assert denied.ok is False
assert denied.errors[0]["code"] == "local_control_operator_ack_required"
assert runner_called == [] and remote.calls == []

inconsistent = OperatorAcknowledgedLocalControlSurface(
    remote,
    operator_ack_live_control=True,
    local_runner=lambda executable, argv, timeout_seconds: (0, json.dumps({
        "schema_version": "2026-05-02.mvp1",
        "command": "customer_mac.control_start",
        "target": "customer_mac",
        "timestamp": "2026-07-15T00:00:00Z",
        "ok": False,
        "data": {},
        "warnings": [],
        "errors": [],
        "audit_id": "audit-local",
    })),
    session_reader=lambda: {"generation": 7},
    local_kill_switch=confirmed_cleanup,
).run(LOCAL_WORKBENCH_CONTROL_START, {"mode": "full-access"})
assert inconsistent.ok is False
assert inconsistent.errors[0]["code"] == "local_control_cli_contract_invalid"
assert remote.calls == []

wrong_state = OperatorAcknowledgedLocalControlSurface(
    remote,
    operator_ack_live_control=True,
    local_runner=lambda executable, argv, timeout_seconds: (0, json.dumps({
        "schema_version": "2026-05-02.mvp1",
        "command": "customer_mac.control_start",
        "target": "customer_mac",
        "timestamp": "2026-07-15T00:00:00Z",
        "ok": True,
        "data": {
            "started": True,
            "session": {
                "active": True,
                "kill_switch": False,
                "mode": "ask_permission",
                "generation": 8,
            },
        },
        "warnings": [],
        "errors": [],
        "audit_id": "audit-local",
    })),
    session_reader=lambda: {"generation": 7},
    local_kill_switch=unconfirmed_cleanup,
).run(LOCAL_WORKBENCH_CONTROL_START, {"mode": "full-access"})
assert wrong_state.ok is False
assert wrong_state.errors[0]["code"] == "local_control_state_transition_invalid_cleanup_unconfirmed"
assert remote.calls == []

def unavailable_runner(executable, argv, timeout_seconds):
    assert executable == INSTALLED_WORKBENCH_BRIDGE_CLI
    raise FileNotFoundError("do not expose this path")

unavailable = OperatorAcknowledgedLocalControlSurface(
    remote,
    operator_ack_live_control=True,
    local_runner=unavailable_runner,
    session_reader=lambda: {"generation": 7},
    local_kill_switch=confirmed_cleanup,
).run(LOCAL_WORKBENCH_CONTROL_START, {"mode": "ask-permission"})
assert unavailable.ok is False
assert unavailable.errors[0]["code"] == "local_control_cli_unavailable"
assert "path" not in unavailable.errors[0]["message"]
assert remote.calls == []

malformed = OperatorAcknowledgedLocalControlSurface(
    remote,
    operator_ack_live_control=True,
    local_runner=lambda executable, argv, timeout_seconds: (0, "not-json"),
    session_reader=lambda: {"generation": 7},
    local_kill_switch=confirmed_cleanup,
).run(LOCAL_WORKBENCH_CONTROL_START, {"mode": "full-access"})
assert malformed.ok is False
assert malformed.errors[0]["code"] == "local_control_cli_response_invalid"

def timeout_runner(executable, argv, timeout_seconds):
    raise subprocess.TimeoutExpired(str(executable), timeout_seconds)

timed_out = OperatorAcknowledgedLocalControlSurface(
    remote,
    operator_ack_live_control=True,
    local_runner=timeout_runner,
    session_reader=lambda: {"generation": 7},
    local_kill_switch=confirmed_cleanup,
).run(LOCAL_WORKBENCH_CONTROL_START, {"mode": "full-access"})
assert timed_out.ok is False
assert timed_out.errors[0]["code"] == "local_control_cli_timeout"
assert remote.calls == []

print("ok")
`);

    expect(output).toBe('ok');
  });

  it('kills a possibly started local session and blocks actions after an unconfirmed response', () => {
    const output = runPython(`
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from evaos_desktop_bridge.host.cli import _run_bridge_argv
from evaos_desktop_bridge.proof.qa_canary import (
    LOCAL_WORKBENCH_CONTROL_START,
    OperatorAcknowledgedLocalControlSurface,
)
from evaos_desktop_bridge.persistence.state import kill_control_session, read_control_session

os.environ["EVAOS_DESKTOP_BRIDGE_DISABLE_TAKEOVER_WARNING_UI"] = "1"

class RejectRemoteSurface:
    def __init__(self):
        self.calls = []

    def run(self, command, params):
        self.calls.append((command, params))
        raise AssertionError("remote surface must remain blocked")

with TemporaryDirectory() as temporary_root:
    root = Path(temporary_root)
    remote = RejectRemoteSurface()

    def corrupt_after_start(executable, argv, timeout_seconds):
        exit_code, output = _run_bridge_argv(argv, state_dir=root)
        assert exit_code == 0 and '"ok": true' in output
        return 0, "not-json-after-start"

    surface = OperatorAcknowledgedLocalControlSurface(
        remote,
        operator_ack_live_control=True,
        local_runner=corrupt_after_start,
        session_reader=lambda: read_control_session(root),
        local_kill_switch=lambda: kill_control_session(root),
    )
    failed = surface.run(
        LOCAL_WORKBENCH_CONTROL_START,
        {"mode": "full-access", "agent_label": "evaOS QA Canary"},
    )
    assert failed.ok is False
    assert failed.errors[0]["code"] == "local_control_cli_response_invalid"
    final = read_control_session(root)
    assert final["active"] is False and final["kill_switch"] is True

    blocked = surface.run("desktop_type", {"text": "must not run", "dry_run": False})
    assert blocked.ok is False
    assert blocked.errors[0]["code"] == "local_control_start_chain_blocked"
    assert remote.calls == []

print("ok")
`);

    expect(output).toBe('ok');
  });

  it('binds local consent to the configured connector session nonce', () => {
    const output = runPython(`
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from evaos_desktop_bridge.host.cli import _run_bridge_argv
from evaos_desktop_bridge.proof.qa_canary import (
    LOCAL_WORKBENCH_CONTROL_START,
    OperatorAcknowledgedLocalControlSurface,
    SurfaceResponse,
)
from evaos_desktop_bridge.persistence.state import kill_control_session, read_control_session

os.environ["EVAOS_DESKTOP_BRIDGE_DISABLE_TAKEOVER_WARNING_UI"] = "1"

class WrongTargetSurface:
    def __init__(self, state_reader):
        self.state_reader = state_reader
        self.calls = []

    def run(self, command, params):
        self.calls.append((command, params))
        wrong_session = dict(self.state_reader())
        wrong_session["agent_label"] = "different-target-session"
        return SurfaceResponse.from_payload({
            "schema_version": "2026-05-02.mvp1",
            "command": "customer_mac.control_status",
            "target": "customer_mac",
            "timestamp": "2026-07-15T00:00:00Z",
            "ok": True,
            "data": {"session": wrong_session},
            "warnings": [],
            "errors": [],
            "audit_id": "audit-wrong-target",
        })

with TemporaryDirectory() as temporary_root:
    root = Path(temporary_root)
    remote = WrongTargetSurface(lambda: read_control_session(root))
    surface = OperatorAcknowledgedLocalControlSurface(
        remote,
        operator_ack_live_control=True,
        local_runner=lambda executable, argv, timeout_seconds: _run_bridge_argv(argv, state_dir=root),
        session_reader=lambda: read_control_session(root),
        local_kill_switch=lambda: kill_control_session(root),
    )
    result = surface.run(
        LOCAL_WORKBENCH_CONTROL_START,
        {"mode": "ask-permission", "agent_label": "evaOS QA Canary"},
    )
    assert result.ok is False
    assert result.errors[0]["code"] == "local_control_target_binding_failed"
    assert remote.calls == [("desktop_control_status", {})]
    final = read_control_session(root)
    assert final["active"] is False and final["kill_switch"] is True

print("ok")
`);

    expect(output).toBe('ok');
  });
});
