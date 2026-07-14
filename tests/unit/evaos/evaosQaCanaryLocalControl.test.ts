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

describe('qa canary local Workbench control consent', () => {
  it('never sends control-start through a remote canary surface', () => {
    const output = runPython(`
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from evaos_desktop_bridge.cli import _run_bridge_argv
from evaos_desktop_bridge.qa_canary import (
    INSTALLED_WORKBENCH_BRIDGE_CLI,
    LOCAL_WORKBENCH_CONTROL_START,
    OperatorAcknowledgedLocalControlSurface,
    SurfaceResponse,
    build_scenarios,
)
from evaos_desktop_bridge.state import read_control_session

class RecordingSurface:
    def __init__(self):
        self.calls = []

    def run(self, command, params):
        self.calls.append((command, params))
        payload = {
            "schema_version": "2026-05-02.mvp1",
            "command": command,
            "target": "customer_mac",
            "ok": True,
            "data": {},
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

with TemporaryDirectory() as temporary_root:
    root = Path(temporary_root)
    remote = RecordingSurface()
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
    assert ask_state["generation"] > full_state["generation"]
    assert len(local_argv) == 2
    assert local_argv[0][:4] == ["customer-mac", "control", "start", "--json"]
    assert "--local-workbench-restart" in local_argv[0]
    assert local_argv[0][local_argv[0].index("--expected-control-generation") + 1] == "0"
    assert local_argv[1][local_argv[1].index("--expected-control-generation") + 1] == str(full_state["generation"])
    assert remote.calls == []

    delegated = surface.run("desktop_control_status", {})
    assert delegated.ok is True
    assert remote.calls == [("desktop_control_status", {})]

print(json.dumps({"ok": True, "local_calls": len(local_argv), "remote_calls": len(remote.calls)}))
`);

    expect(JSON.parse(output)).toEqual({ ok: true, local_calls: 2, remote_calls: 1 });
  });

  it('fails closed without operator acknowledgement or with an inconsistent local CLI response', () => {
    const output = runPython(`
import json
import subprocess

from evaos_desktop_bridge.qa_canary import (
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
).run(LOCAL_WORKBENCH_CONTROL_START, {"mode": "full-access"})
assert inconsistent.ok is False
assert inconsistent.errors[0]["code"] == "local_control_cli_contract_invalid"
assert remote.calls == []

def unavailable_runner(executable, argv, timeout_seconds):
    assert executable == INSTALLED_WORKBENCH_BRIDGE_CLI
    raise FileNotFoundError("do not expose this path")

unavailable = OperatorAcknowledgedLocalControlSurface(
    remote,
    operator_ack_live_control=True,
    local_runner=unavailable_runner,
    session_reader=lambda: {"generation": 7},
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
).run(LOCAL_WORKBENCH_CONTROL_START, {"mode": "full-access"})
assert timed_out.ok is False
assert timed_out.errors[0]["code"] == "local_control_cli_timeout"
assert remote.calls == []

print("ok")
`);

    expect(output).toBe('ok');
  });
});
