from __future__ import annotations

import argparse
import base64
import json
import os
import posixpath
import re
import struct
import subprocess
import sys
import time
import tempfile
import uuid
import urllib.error
import urllib.parse
import urllib.request
import zlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Protocol

from .pre_canary import packaged_bridge_source_binding
from .state import kill_control_session, read_control_session

DEFAULT_RUN_ROOT = Path("/Volumes/LEXAR/Codex/evaos-workbench-qa-runs")
LIVE_CONTROL_SUITES = {
    "all",
    "control_start",
    "full",
    "full_access",
    "primitive",
    "desktop",
    "iphone",
    "desktop_scenario",
    "iphone_scenario",
    "ask_permission",
    "real_world_optional",
    "kill_switch",
}
ACTION_COMMANDS = {
    "desktop_browser_action",
    "desktop_click",
    "desktop_drag",
    "desktop_focus_app",
    "desktop_hotkey",
    "desktop_menu",
    "desktop_scroll",
    "desktop_type",
    "desktop_window",
    "iphone_swipe",
    "iphone_tap",
    "iphone_type",
    "customer_mac_iphone_mirroring_app_switcher",
    "customer_mac_iphone_mirroring_home",
    "customer_mac_iphone_mirroring_open_app",
    "customer_mac_iphone_mirroring_spotlight",
}
VISUAL_RETRY_COMMANDS = {
    "desktop_see",
    "iphone_see",
    "customer_mac_snapshot",
    "customer_mac_ax_tree",
}
REAL_WORLD_ENV_KEYS = (
    "QA_BUMBLE_TEXT",
    "QA_SMS_CONTACT",
    "QA_SMS_TEXT",
    "QA_SOCIAL_APP",
    "QA_SOCIAL_TEXT",
)
UNAVAILABLE_CODES = (
    "iphone_mirroring_not_running",
    "iphone_mirroring_not_installed",
    "permission_missing",
    "screen_recording_missing",
    "accessibility_missing",
    "app_not_found",
    "window_not_found",
    "artifact_not_found",
    "not_found",
)
SELECTED_BINDING_PROOF_FIELDS = {
    "schema",
    "attestationBase64",
    "signature",
    "keyId",
    "namespace",
}
SELECTED_BINDING_CANDIDATE_FIELDS = {
    "sourceCommit",
    "sourceSha256",
    "appVersion",
    "appBuild",
}
SELECTED_BINDING_ATTESTATION_FIELDS = {
    "schema",
    "keyId",
    "namespace",
    "proofKind",
    "runtime",
    "tool",
    "outcome",
    "runRef",
    "executedAt",
    "authorityIssuedAt",
    "authorityExpiresAt",
    "contextKeyId",
    "controlState",
    "auditRecorded",
    "privateReceiptSha256",
    "connectorCandidate",
}
SELECTED_BINDING_PROOF_MAX_AGE_SECONDS = 60 * 60
LOCAL_WORKBENCH_CONTROL_START = "local_workbench_control_start"
INSTALLED_WORKBENCH_BRIDGE_CLI = Path(
    "/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge"
)


@dataclass(frozen=True)
class CanaryStep:
    id: str
    suite: str
    command: str
    params: dict[str, Any] = field(default_factory=dict)
    lane: str = "primitive"
    description: str = ""
    skip_on_unavailable: bool = False
    expect_error_code: str | None = None
    skip_if_unresolved: bool = False
    env_required: tuple[str, ...] = ()
    requires_visual_evidence: bool = False
    visual_assert: dict[str, Any] = field(default_factory=dict)
    visual_assert_retries: int = 0
    visual_retry_delay_seconds: float = 1.0
    assert_from_step: str | None = None
    delay_before_seconds: float = 0.0


@dataclass
class SurfaceResponse:
    payload: dict[str, Any]
    ok: bool
    audit_id: str | None
    engine: str | None
    snapshot_id: str | None
    artifact_path: str | None
    errors: list[dict[str, Any]]
    warnings: list[Any]

    @classmethod
    def from_payload(
        cls, payload: dict[str, Any], artifact_path: str | None = None
    ) -> "SurfaceResponse":
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        errors = (
            payload.get("errors") if isinstance(payload.get("errors"), list) else []
        )
        warnings = (
            payload.get("warnings") if isinstance(payload.get("warnings"), list) else []
        )
        return cls(
            payload=payload,
            ok=payload.get("ok") is True,
            audit_id=payload.get("audit_id")
            if isinstance(payload.get("audit_id"), str)
            else None,
            engine=_extract_string(
                data,
                (
                    "engine",
                    "screenshot.engine",
                    "screenshot.screenshot.engine",
                    "image.engine",
                ),
            ),
            snapshot_id=_extract_string(
                data,
                (
                    "snapshot_id",
                    "screenshot.snapshot_id",
                    "screenshot.screenshot.snapshot_id",
                    "image.snapshot_id",
                    "screenshot.image.snapshot_id",
                ),
            ),
            artifact_path=artifact_path
            or _extract_string(
                data,
                (
                    "vm_visual_artifact_path",
                    "screenshot.vm_artifact_path",
                    "screenshot.screenshot.vm_artifact_path",
                    "image.vm_artifact_path",
                ),
            ),
            errors=[error for error in errors if isinstance(error, dict)],
            warnings=warnings,
        )


@dataclass
class CanaryResult:
    id: str
    suite: str
    lane: str
    command: str
    params_redacted: dict[str, Any]
    ok: bool
    status: str
    audit_id: str | None
    engine: str | None
    snapshot_id: str | None
    artifact_path: str | None
    duration_ms: int
    errors: list[dict[str, Any]]
    warnings: list[Any]
    payload: dict[str, Any] = field(repr=False, default_factory=dict)

    def to_report_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "suite": self.suite,
            "lane": self.lane,
            "command": self.command,
            "params_redacted": redact_for_report(self.params_redacted),
            "ok": self.ok,
            "status": self.status,
            "audit_id": self.audit_id,
            "engine": self.engine,
            "snapshot_id": self.snapshot_id,
            "artifact_path": self.artifact_path,
            "duration_ms": self.duration_ms,
            "errors": redact_for_report(self.errors),
            "warnings": redact_for_report(self.warnings),
        }


class CanarySurface(Protocol):
    def run(self, command: str, params: dict[str, Any]) -> SurfaceResponse: ...


class ConnectorSurface:
    def __init__(self, *, connector_url: str, token: str, artifact_dir: Path) -> None:
        self.connector_url = connector_url.rstrip("/")
        self.token = token
        self.artifact_dir = artifact_dir

    def run(self, command: str, params: dict[str, Any]) -> SurfaceResponse:
        payload = self._post_json(
            "/v1/commands", {"command": command, "params": params}
        )
        artifact_path = self._materialize_visual_artifact(payload)
        return SurfaceResponse.from_payload(payload, artifact_path=artifact_path)

    def _post_json(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            self.connector_url + path,
            data=json.dumps(body, separators=(",", ":")).encode("utf-8"),
            method="POST",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
        )
        command = str(body.get("command") or "connector.command")
        try:
            with urllib.request.urlopen(
                request, timeout=timeout_for_command(command) + 5
            ) as response:  # noqa: S310 - operator-supplied private connector URL.
                return _loads_json_response(response.read())
        except urllib.error.HTTPError as exc:
            body_bytes = exc.read()
            try:
                return _loads_json_response(body_bytes)
            except ValueError:
                return _error_payload(
                    command=command,
                    code="connector_http_error",
                    message=body_bytes.decode("utf-8", errors="replace")
                    or f"HTTP {exc.code}",
                )
        except TimeoutError:
            return _error_payload(
                command=command,
                code="connector_timeout",
                message=f"{command} timed out after {timeout_for_command(command)} seconds.",
            )

    def _materialize_visual_artifact(self, payload: dict[str, Any]) -> str | None:
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        artifact_url = _extract_string(
            data,
            (
                "image.artifact_url",
                "screenshot.artifact_url",
                "screenshot.screenshot.artifact_url",
                "screenshot.image.artifact_url",
            ),
        )
        if not artifact_url:
            return None
        endpoint = urllib.parse.urljoin(self.connector_url + "/", artifact_url)
        parsed_endpoint = urllib.parse.urlparse(endpoint)
        parsed_connector = urllib.parse.urlparse(self.connector_url)
        if (
            parsed_endpoint.netloc != parsed_connector.netloc
            or not parsed_endpoint.path.startswith("/v1/artifacts/")
        ):
            payload.setdefault("warnings", []).append(
                "Connector returned an artifact URL outside the paired connector."
            )
            return None
        request = urllib.request.Request(
            endpoint, method="GET", headers={"Authorization": f"Bearer {self.token}"}
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:  # noqa: S310 - validated same-origin connector artifact URL.
                content = response.read()
        except Exception as exc:  # noqa: BLE001 - report evidence fetch failure without hiding command result.
            payload.setdefault("warnings", []).append(
                f"Unable to fetch connector artifact: {exc}"
            )
            return None
        snapshot_id = (
            _extract_string(
                data,
                (
                    "snapshot_id",
                    "screenshot.snapshot_id",
                    "screenshot.screenshot.snapshot_id",
                    "image.artifact_id",
                ),
            )
            or Path(parsed_endpoint.path).stem
        )
        output_dir = self.artifact_dir / "evidence"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"{_safe_filename(snapshot_id)}.png"
        output_path.write_bytes(content)
        return str(output_path)


class OperatorAcknowledgedLocalControlSurface:
    """Start control in the local Workbench process; delegate every remote action."""

    def __init__(
        self,
        delegate: CanarySurface,
        *,
        operator_ack_live_control: bool,
        local_runner: Callable[[Path, list[str], int], tuple[int, str]] | None = None,
        session_reader: Callable[[], dict[str, Any]] | None = None,
        local_kill_switch: Callable[[], dict[str, Any]] | None = None,
    ) -> None:
        self.delegate = delegate
        self.operator_ack_live_control = operator_ack_live_control
        self.local_runner = local_runner or _run_local_workbench_cli
        self.session_reader = session_reader or read_control_session
        self.local_kill_switch = local_kill_switch or kill_control_session
        self.control_start_failed = False

    def run(self, command: str, params: dict[str, Any]) -> SurfaceResponse:
        if command == LOCAL_WORKBENCH_CONTROL_START:
            if self.control_start_failed:
                return SurfaceResponse.from_payload(
                    _error_payload(
                        command=command,
                        code="local_control_start_chain_blocked",
                        message="A prior local Workbench control start failed; further starts are blocked for this canary run.",
                    )
                )
            payload = self._start_local_control(params)
            self.control_start_failed = payload.get("ok") is not True
            return SurfaceResponse.from_payload(payload)
        if self.control_start_failed and command not in {
            "desktop_control_status",
            "desktop_control_stop",
            "desktop_kill_switch",
        }:
            return SurfaceResponse.from_payload(
                _error_payload(
                    command=command,
                    code="local_control_start_chain_blocked",
                    message="Remote actions are blocked because local Workbench control start did not complete safely.",
                )
            )
        return self.delegate.run(command, params)

    def _start_local_control(self, params: dict[str, Any]) -> dict[str, Any]:
        if not self.operator_ack_live_control:
            return _error_payload(
                command=LOCAL_WORKBENCH_CONTROL_START,
                code="local_control_operator_ack_required",
                message="Local Workbench control requires explicit operator acknowledgement.",
            )
        if set(params) - {"mode", "agent_label"}:
            return _error_payload(
                command=LOCAL_WORKBENCH_CONTROL_START,
                code="local_control_params_invalid",
                message="Local Workbench control received unsupported parameters.",
            )
        mode = params.get("mode")
        if mode not in {"full-access", "ask-permission"}:
            return _error_payload(
                command=LOCAL_WORKBENCH_CONTROL_START,
                code="local_control_mode_invalid",
                message="Local Workbench control mode is invalid.",
            )
        agent_label = params.get("agent_label")
        if agent_label is not None and (
            not isinstance(agent_label, str)
            or not agent_label.strip()
            or len(agent_label.strip()) > 160
        ):
            return _error_payload(
                command=LOCAL_WORKBENCH_CONTROL_START,
                code="local_control_agent_label_invalid",
                message="Local Workbench control agent label is invalid.",
            )
        label_prefix = (
            agent_label.strip() if isinstance(agent_label, str) else "evaOS QA Canary"
        )
        binding_nonce = uuid.uuid4().hex
        bound_agent_label = f"{label_prefix[:120]} [{binding_nonce}]"
        generation = self.session_reader().get("generation")
        if type(generation) is not int or generation < 0:
            return _error_payload(
                command=LOCAL_WORKBENCH_CONTROL_START,
                code="local_control_state_invalid",
                message="Local Workbench control state has no valid generation.",
            )
        argv = [
            "customer-mac",
            "control",
            "start",
            "--json",
            "--mode",
            mode,
            "--local-workbench-restart",
            "--expected-control-generation",
            str(generation),
        ]
        argv.extend(["--agent-label", bound_agent_label])
        try:
            exit_code, output = self.local_runner(
                INSTALLED_WORKBENCH_BRIDGE_CLI,
                argv,
                timeout_for_command(LOCAL_WORKBENCH_CONTROL_START),
            )
        except subprocess.TimeoutExpired:
            cleanup_confirmed = self._activate_local_kill_switch()
            return _error_payload(
                command=LOCAL_WORKBENCH_CONTROL_START,
                code=(
                    "local_control_cli_timeout"
                    if cleanup_confirmed
                    else "local_control_cli_timeout_cleanup_unconfirmed"
                ),
                message=(
                    "The installed Workbench control command timed out; local cleanup was confirmed."
                    if cleanup_confirmed
                    else "The installed Workbench control command timed out and local cleanup could not be confirmed."
                ),
            )
        except Exception:  # noqa: BLE001 - fail closed without exposing launcher or host details.
            cleanup_confirmed = self._activate_local_kill_switch()
            return _error_payload(
                command=LOCAL_WORKBENCH_CONTROL_START,
                code=(
                    "local_control_cli_unavailable"
                    if cleanup_confirmed
                    else "local_control_cli_unavailable_cleanup_unconfirmed"
                ),
                message=(
                    "The installed Workbench control command is unavailable; local cleanup was confirmed."
                    if cleanup_confirmed
                    else "The installed Workbench control command is unavailable and local cleanup could not be confirmed."
                ),
            )
        try:
            payload = _loads_json_response(output.encode("utf-8"))
        except (UnicodeError, ValueError):
            cleanup_confirmed = self._activate_local_kill_switch()
            return _error_payload(
                command=LOCAL_WORKBENCH_CONTROL_START,
                code=(
                    "local_control_cli_response_invalid"
                    if cleanup_confirmed
                    else "local_control_cli_response_invalid_cleanup_unconfirmed"
                ),
                message=(
                    "Local Workbench control returned an invalid response; local cleanup was confirmed."
                    if cleanup_confirmed
                    else "Local Workbench control returned an invalid response and local cleanup could not be confirmed."
                ),
            )
        expected_fields = {
            "schema_version",
            "command",
            "target",
            "timestamp",
            "ok",
            "data",
            "warnings",
            "errors",
            "audit_id",
        }
        valid_exit = (exit_code == 0 and payload.get("ok") is True) or (
            exit_code == 2 and payload.get("ok") is False
        )
        if not (
            set(payload) == expected_fields
            and payload.get("schema_version") == "2026-05-02.mvp1"
            and payload.get("command") == "customer_mac.control_start"
            and payload.get("target") == "customer_mac"
            and type(payload.get("ok")) is bool
            and isinstance(payload.get("data"), dict)
            and isinstance(payload.get("warnings"), list)
            and isinstance(payload.get("errors"), list)
            and isinstance(payload.get("timestamp"), str)
            and payload.get("timestamp", "").endswith("Z")
            and isinstance(payload.get("audit_id"), str)
            and payload.get("audit_id", "").startswith("audit-")
            and valid_exit
        ):
            cleanup_confirmed = self._activate_local_kill_switch()
            return _error_payload(
                command=LOCAL_WORKBENCH_CONTROL_START,
                code=(
                    "local_control_cli_contract_invalid"
                    if cleanup_confirmed
                    else "local_control_cli_contract_invalid_cleanup_unconfirmed"
                ),
                message=(
                    "Local Workbench control returned an inconsistent response; local cleanup was confirmed."
                    if cleanup_confirmed
                    else "Local Workbench control returned an inconsistent response and local cleanup could not be confirmed."
                ),
            )
        if payload.get("ok") is not True:
            cleanup_confirmed = self._activate_local_kill_switch()
            if cleanup_confirmed:
                payload.setdefault("warnings", []).append(
                    "Local kill-switch cleanup was confirmed after the control-start failure."
                )
                return payload
            return _error_payload(
                command=LOCAL_WORKBENCH_CONTROL_START,
                code="local_control_start_failed_cleanup_unconfirmed",
                message="Local Workbench control failed and local cleanup could not be confirmed.",
            )
        if payload.get("ok") is True:
            data = payload.get("data")
            session = data.get("session") if isinstance(data, dict) else None
            expected_mode = mode.replace("-", "_")
            if not (
                data.get("started") is True
                and isinstance(session, dict)
                and session.get("active") is True
                and session.get("kill_switch") is False
                and session.get("mode") == expected_mode
                and session.get("agent_label") == bound_agent_label
                and type(session.get("generation")) is int
                and session.get("generation") > generation
            ):
                cleanup_confirmed = self._activate_local_kill_switch()
                return _error_payload(
                    command=LOCAL_WORKBENCH_CONTROL_START,
                    code=(
                        "local_control_state_transition_invalid"
                        if cleanup_confirmed
                        else "local_control_state_transition_invalid_cleanup_unconfirmed"
                    ),
                    message=(
                        "Local Workbench control did not enter the requested state; local cleanup was confirmed."
                        if cleanup_confirmed
                        else "Local Workbench control did not enter the requested state and local cleanup could not be confirmed."
                    ),
                )
            try:
                remote_status = self.delegate.run("desktop_control_status", {})
            except Exception:  # noqa: BLE001 - convert target binding failures into sanitized proof data.
                remote_status = None
            remote_session = (
                remote_status.payload.get("data", {}).get("session")
                if remote_status is not None
                and remote_status.ok is True
                and isinstance(remote_status.payload.get("data"), dict)
                and isinstance(
                    remote_status.payload.get("data", {}).get("session"), dict
                )
                else None
            )
            if not (
                isinstance(remote_session, dict)
                and remote_session.get("active") is True
                and remote_session.get("kill_switch") is False
                and remote_session.get("mode") == session.get("mode")
                and remote_session.get("agent_label") == session.get("agent_label")
                and remote_session.get("generation") == session.get("generation")
                and remote_session.get("started_at") == session.get("started_at")
            ):
                cleanup_confirmed = self._activate_local_kill_switch()
                return _error_payload(
                    command=LOCAL_WORKBENCH_CONTROL_START,
                    code=(
                        "local_control_target_binding_failed"
                        if cleanup_confirmed
                        else "local_control_target_binding_failed_cleanup_unconfirmed"
                    ),
                    message=(
                        "Local Workbench control did not bind to the configured connector; local cleanup was confirmed."
                        if cleanup_confirmed
                        else "Local Workbench control did not bind to the configured connector and local cleanup could not be confirmed."
                    ),
                )
        return payload

    def _activate_local_kill_switch(self) -> bool:
        try:
            session = self.local_kill_switch()
        except Exception:  # noqa: BLE001 - cleanup is reported only as a boolean.
            return False
        return (
            isinstance(session, dict)
            and session.get("active") is False
            and session.get("kill_switch") is True
        )


def _run_local_workbench_cli(
    executable: Path,
    argv: list[str],
    timeout_seconds: int,
) -> tuple[int, str]:
    if (
        executable != INSTALLED_WORKBENCH_BRIDGE_CLI
        or executable.is_symlink()
        or not executable.is_file()
        or not os.access(executable, os.X_OK)
        or executable.resolve(strict=True) != executable
    ):
        raise FileNotFoundError("installed Workbench bridge launcher is unavailable")
    child_env = {
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        **{
            key: value
            for key in (
                "HOME",
                "TMPDIR",
                "USER",
                "LOGNAME",
                "LANG",
                "LC_ALL",
                "__CF_USER_TEXT_ENCODING",
            )
            if (value := os.environ.get(key))
        },
    }
    completed = subprocess.run(
        [str(executable), *argv],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        timeout=timeout_seconds,
        check=False,
        env=child_env,
    )
    return completed.returncode, completed.stdout


def evaluate_connector_candidate_identity(
    payload: dict[str, Any],
    *,
    expected_source_commit: str,
    expected_source_sha256: str,
    expected_version: str,
    expected_build: str,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "ok": False,
        "expected_source_commit": expected_source_commit,
        "expected_source_sha256": expected_source_sha256,
        "expected_version": expected_version,
        "expected_build": expected_build,
    }
    bridge = payload.get("bridge") if isinstance(payload.get("bridge"), dict) else {}
    candidate = (
        bridge.get("candidate") if isinstance(bridge.get("candidate"), dict) else {}
    )
    process = payload.get("process") if isinstance(payload.get("process"), dict) else {}
    connector = (
        payload.get("connector") if isinstance(payload.get("connector"), dict) else {}
    )
    connector_owner = (
        connector.get("owner") if isinstance(connector.get("owner"), dict) else {}
    )
    expected_app_path = "/Applications/evaOS Workbench.app"
    expected_bridge_root = expected_app_path + "/Contents/Resources/Bridge"
    expected_argv0 = expected_bridge_root + "/src/evaos_desktop_bridge/cli.py"
    expected_manifest_path = expected_bridge_root + "/manifest.json"
    process_executable = process.get("executable")
    process_argv0 = process.get("argv0")
    result.update(
        {
            "schema": candidate.get("schema"),
            "source_commit": candidate.get("source_commit"),
            "source_sha256": candidate.get("source_sha256"),
            "source_path": candidate.get("source_path"),
            "owner": candidate.get("owner"),
            "status": candidate.get("status"),
            "app_path": candidate.get("app_path"),
            "app_version": candidate.get("app_version"),
            "app_build": candidate.get("app_build"),
            "app_bundle_id": candidate.get("app_bundle_id"),
            "app_name": candidate.get("app_name"),
            "process_executable": process_executable,
            "process_argv0": process_argv0,
            "connector_owner": connector_owner,
        }
    )
    result["ok"] = (
        payload.get("ok") is True
        and payload.get("schema") == "evaos.desktop_bridge.diagnostics.v1"
        and payload.get("service") == "evaos-desktop-bridge-connector"
        and candidate.get("schema") == "evaos.workbench.bridge_candidate.v1"
        and candidate.get("ok") is True
        and candidate.get("source_commit") == expected_source_commit
        and candidate.get("source_sha256") == expected_source_sha256
        and candidate.get("source_path") == "resources/evaos-beta/bridge"
        and candidate.get("owner") == "100yenadmin/evaOS-GUI"
        and candidate.get("status") == "vendored"
        and candidate.get("app_path") == "/Applications/evaOS Workbench.app"
        and candidate.get("app_version") == expected_version
        and candidate.get("app_build") == expected_build
        and candidate.get("app_bundle_id") == "com.evaos.workbench"
        and candidate.get("app_name") == "evaOS Workbench"
        and _bundled_python_executable(
            process_executable, bridge_root=expected_bridge_root
        )
        and _exact_absolute_path(process_argv0, expected_argv0)
        and connector_owner.get("label") == "com.electricsheep.evaos-desktop-bridge"
        and connector_owner.get("classification") == "workbench_bundle"
        and connector_owner.get("bundle_id") == "com.evaos.workbench"
        and connector_owner.get("source_commit") == expected_source_commit
        and _typed_exact_path(connector_owner.get("program_path"), expected_argv0)
        and _typed_exact_path(connector_owner.get("app_path"), expected_app_path)
        and _typed_exact_path(
            connector_owner.get("manifest_path"), expected_manifest_path
        )
    )
    if result["ok"] is not True:
        result["reason"] = "connector_candidate_identity_mismatch"
    return result


def _exact_absolute_path(value: object, expected: str) -> bool:
    if (
        not isinstance(value, str)
        or not value.startswith("/")
        or ".." in Path(value).parts
    ):
        return False
    return posixpath.normpath(value) == value == expected


def _typed_exact_path(value: object, expected: str) -> bool:
    return (
        isinstance(value, dict)
        and value.get("kind") == "path"
        and _exact_absolute_path(value.get("value"), expected)
    )


def _bundled_python_executable(value: object, *, bridge_root: str) -> bool:
    if (
        not isinstance(value, str)
        or not value.startswith("/")
        or ".." in Path(value).parts
    ):
        return False
    if posixpath.normpath(value) != value:
        return False
    parent, name = posixpath.split(value)
    return (
        parent == bridge_root + "/python/bin"
        and re.fullmatch(r"python3(?:\.\d+)?", name) is not None
    )


def connector_candidate_binding(
    *,
    connector_url: str,
    token: str,
    expected_source_commit: str,
    expected_source_sha256: str,
    expected_version: str,
    expected_build: str,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "ok": False,
        "expected_source_commit": expected_source_commit,
        "expected_source_sha256": expected_source_sha256,
        "expected_version": expected_version,
        "expected_build": expected_build,
    }
    if not re.fullmatch(r"[0-9a-fA-F]{40}", expected_source_commit):
        result["reason"] = "expected_source_commit_invalid"
        return result
    if not re.fullmatch(r"[0-9a-fA-F]{64}", expected_source_sha256):
        result["reason"] = "expected_source_sha256_invalid"
        return result
    if not re.fullmatch(r"\d+\.\d+\.\d+", expected_version) or not re.fullmatch(
        r"\d+(?:\.\d+){0,2}", expected_build
    ):
        result["reason"] = "expected_candidate_version_invalid"
        return result
    request = urllib.request.Request(
        connector_url.rstrip("/") + "/v1/diagnostics",
        method="GET",
        headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:  # noqa: S310 - operator-supplied private connector URL.
            payload = _loads_json_response(response.read())
    except (OSError, TimeoutError, urllib.error.URLError, ValueError):
        result["reason"] = "connector_candidate_diagnostics_unavailable"
        return result
    return evaluate_connector_candidate_identity(
        payload,
        expected_source_commit=expected_source_commit,
        expected_source_sha256=expected_source_sha256,
        expected_version=expected_version,
        expected_build=expected_build,
    )


def selected_binding_proof_binding(
    proof_path: Path | None,
    *,
    expected_source_commit: str,
    expected_source_run_id: str,
    expected_source_sha256: str,
    expected_version: str,
    expected_build: str,
    verification_time_seconds: float | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "ok": False,
        "expected_source_commit": expected_source_commit,
        "expected_source_run_id": expected_source_run_id,
        "expected_source_sha256": expected_source_sha256,
        "expected_version": expected_version,
        "expected_build": expected_build,
    }
    if proof_path is None:
        result["reason"] = "selected_binding_proof_required"
        return result
    try:
        proof = json.loads(proof_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        result["reason"] = "selected_binding_proof_unavailable"
        return result
    if not isinstance(proof, dict) or set(proof) != SELECTED_BINDING_PROOF_FIELDS:
        result["reason"] = "selected_binding_proof_shape_invalid"
        return result
    receipt_key_id = str(
        os.environ.get("EVAOS_LIVE_CANARY_RECEIPT_KEY_ID") or ""
    ).strip()
    receipt_public_key_text = str(
        os.environ.get("EVAOS_LIVE_CANARY_RECEIPT_PUBLIC_KEY") or ""
    ).strip()
    expected_context_key_id = str(
        os.environ.get("EVAOS_LIVE_CANARY_CONTEXT_KEY_ID") or ""
    ).strip()
    try:
        padding = "=" * (-len(str(proof.get("attestationBase64") or "")) % 4)
        attestation_bytes = base64.urlsafe_b64decode(
            str(proof.get("attestationBase64") or "") + padding
        )
        attestation = json.loads(attestation_bytes.decode("utf-8"))
        public_padding = "=" * (-len(receipt_public_key_text) % 4)
        receipt_public_key = base64.urlsafe_b64decode(
            receipt_public_key_text + public_padding
        )
    except (ValueError, UnicodeError, json.JSONDecodeError):
        result["reason"] = "selected_binding_proof_shape_invalid"
        return result
    canonical_attestation = json.dumps(
        attestation, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    if (
        proof.get("schema")
        != "evaos.mac_control.public_runtime_attestation_envelope.v1"
        or proof.get("namespace") != "evaos-mac-control-public-attestation-v1"
        or proof.get("keyId") != receipt_key_id
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", receipt_key_id)
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", expected_context_key_id)
        or len(receipt_public_key) != 32
        or base64.urlsafe_b64encode(receipt_public_key).decode("ascii").rstrip("=")
        != receipt_public_key_text
        or base64.urlsafe_b64encode(attestation_bytes).decode("ascii").rstrip("=")
        != proof.get("attestationBase64")
        or canonical_attestation != attestation_bytes
        or not isinstance(attestation, dict)
        or set(attestation) != SELECTED_BINDING_ATTESTATION_FIELDS
    ):
        result["reason"] = "selected_binding_proof_shape_invalid"
        return result
    candidate = (
        attestation.get("connectorCandidate")
        if isinstance(attestation.get("connectorCandidate"), dict)
        else {}
    )
    signature = str(proof.get("signature") or "")
    signature_verified = False
    if not (
        signature.startswith("-----BEGIN SSH SIGNATURE-----\n")
        and signature.endswith("-----END SSH SIGNATURE-----\n")
        and len(signature) <= 8192
        and signature.isascii()
    ):
        result["reason"] = "selected_binding_proof_signature_invalid"
        return result
    if signature:
        algorithm = b"ssh-ed25519"
        public_blob = (
            struct.pack(">I", len(algorithm))
            + algorithm
            + struct.pack(">I", len(receipt_public_key))
            + receipt_public_key
        )
        with tempfile.TemporaryDirectory(prefix="evaos-proof-verify-") as directory:
            allowed_path = Path(directory) / "allowed_signers"
            signature_path = Path(directory) / "attestation.sshsig"
            allowed_path.write_text(
                "evaos ssh-ed25519 "
                + base64.b64encode(public_blob).decode("ascii")
                + "\n",
                encoding="ascii",
            )
            signature_path.write_text(signature, encoding="ascii")
            os.chmod(allowed_path, 0o600)
            os.chmod(signature_path, 0o600)
            try:
                verified = subprocess.run(
                    [
                        "/usr/bin/ssh-keygen",
                        "-Y",
                        "verify",
                        "-f",
                        str(allowed_path),
                        "-I",
                        "evaos",
                        "-n",
                        "evaos-mac-control-public-attestation-v1",
                        "-s",
                        str(signature_path),
                    ],
                    input=attestation_bytes,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=4,
                    check=False,
                    env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
                    close_fds=True,
                )
                signature_verified = verified.returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                signature_verified = False
    executed_at_text = attestation.get("executedAt")
    try:
        executed_at = datetime.fromisoformat(
            str(executed_at_text or "").replace("Z", "+00:00")
        )
    except ValueError:
        executed_at = None
    issued_at = attestation.get("authorityIssuedAt")
    expires_at = attestation.get("authorityExpiresAt")
    verification_time = (
        time.time()
        if verification_time_seconds is None
        else float(verification_time_seconds)
    )
    result.update(
        {
            "schema": proof.get("schema"),
            "runtime_receipt_verified": signature_verified,
            "direct_mac_control_succeeded": attestation.get("outcome") == "succeeded",
            "candidate": {
                "source_commit": candidate.get("sourceCommit"),
                "source_sha256": candidate.get("sourceSha256"),
                "app_version": candidate.get("appVersion"),
                "app_build": candidate.get("appBuild"),
            },
        }
    )
    result["ok"] = (
        signature_verified
        and attestation.get("schema")
        == "evaos.mac_control.public_runtime_attestation.v1"
        and attestation.get("keyId") == receipt_key_id
        and attestation.get("namespace") == "evaos-mac-control-public-attestation-v1"
        and attestation.get("proofKind") == "selected_binding_direct_mac_control"
        and attestation.get("runtime") == "openclaw"
        and attestation.get("tool") == "customer_mac.desktop_hotkey"
        and attestation.get("outcome") == "succeeded"
        and attestation.get("contextKeyId") == expected_context_key_id
        and attestation.get("controlState") == "ready_unchanged"
        and attestation.get("auditRecorded") is True
        and re.fullmatch(
            r"[0-9a-f]{64}", str(attestation.get("privateReceiptSha256") or "")
        )
        is not None
        and re.fullmatch(r"\d+", expected_source_run_id) is not None
        and re.fullmatch(
            rf"gha:{re.escape(expected_source_run_id)}:[0-9a-f]{{24}}",
            str(attestation.get("runRef") or ""),
        )
        is not None
        and executed_at is not None
        and executed_at.tzinfo is not None
        and type(issued_at) is int
        and type(expires_at) is int
        and issued_at < expires_at <= issued_at + 60
        and issued_at <= verification_time + 5
        and executed_at.timestamp() >= issued_at - 5
        and executed_at.timestamp() <= verification_time + 5
        and verification_time - executed_at.timestamp()
        <= SELECTED_BINDING_PROOF_MAX_AGE_SECONDS
        and int(executed_at.timestamp()) <= expires_at
        and set(candidate) == SELECTED_BINDING_CANDIDATE_FIELDS
        and candidate.get("sourceCommit") == expected_source_commit
        and candidate.get("sourceSha256") == expected_source_sha256
        and candidate.get("appVersion") == expected_version
        and candidate.get("appBuild") == expected_build
    )
    if result["ok"] is not True:
        result["reason"] = "selected_binding_proof_mismatch"
    return result


class OpenClawSurface:
    def __init__(
        self,
        *,
        connector_url: str,
        token: str,
        artifact_dir: Path,
        repo_root: Path | None = None,
    ) -> None:
        self.connector_url = connector_url
        self.token = token
        self.artifact_dir = artifact_dir
        self.repo_root = repo_root or _resolve_repo_root()

    def run(self, command: str, params: dict[str, Any]) -> SurfaceResponse:
        helper = (
            _agent_tools_root(self.repo_root)
            / "openclaw-plugin"
            / "scripts"
            / "qa-run-bridge.mjs"
        )
        env = os.environ.copy()
        env.update(
            {
                "EVAOS_DESKTOP_BRIDGE_URL": self.connector_url,
                "EVAOS_DESKTOP_BRIDGE_TOKEN": self.token,
                "EVAOS_DESKTOP_BRIDGE_ARTIFACT_DIR": str(self.artifact_dir),
            }
        )
        params_json = json.dumps(params, separators=(",", ":"))
        completed = subprocess.run(
            ["node", str(helper), command, "-"],
            cwd=self.repo_root,
            env=env,
            input=params_json,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_for_command(command) + 30,
            check=False,
        )
        payload = _payload_from_completed_process(completed, command)
        return SurfaceResponse.from_payload(payload)


class HermesSurface:
    def __init__(
        self,
        *,
        connector_url: str,
        token: str,
        artifact_dir: Path,
        repo_root: Path | None = None,
    ) -> None:
        self.connector_url = connector_url
        self.token = token
        self.artifact_dir = artifact_dir
        self.repo_root = repo_root or _resolve_repo_root()

    def run(self, command: str, params: dict[str, Any]) -> SurfaceResponse:
        env = os.environ.copy()
        env.update(
            {
                "EVAOS_DESKTOP_BRIDGE_URL": self.connector_url,
                "EVAOS_DESKTOP_BRIDGE_TOKEN": self.token,
                "EVAOS_DESKTOP_BRIDGE_ARTIFACT_DIR": str(self.artifact_dir),
            }
        )
        adapter = (
            _agent_tools_root(self.repo_root)
            / "hermes-adapter"
            / "bin"
            / "evaos-desktop-bridge-command"
        )
        params_json = json.dumps(params, separators=(",", ":"))
        completed = subprocess.run(
            [str(adapter), command, "-"],
            cwd=self.repo_root,
            env=env,
            input=params_json,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_for_command(command) + 30,
            check=False,
        )
        payload = _payload_from_completed_process(completed, command)
        return SurfaceResponse.from_payload(payload)


def run_steps(steps: list[CanaryStep], surface: CanarySurface) -> list[CanaryResult]:
    results: list[CanaryResult] = []
    context: dict[str, CanaryResult] = {}
    for step in steps:
        missing_env = [key for key in step.env_required if not os.environ.get(key)]
        if missing_env:
            result = _skipped_result(
                step, f"Missing local-only QA env: {', '.join(missing_env)}"
            )
            results.append(result)
            context[step.id] = result
            continue
        try:
            params = _resolve_params(step.params, context)
        except _UnresolvedPlaceholder as exc:
            result = (
                _skipped_result(step, str(exc))
                if step.skip_if_unresolved
                else _failed_result(step, str(exc))
            )
            results.append(result)
            context[step.id] = result
            continue
        dependency_error = _scenario_dependency_error(step, context)
        if dependency_error:
            result = _failed_result(
                step, dependency_error, code="qa_required_visual_state_failed"
            )
            results.append(result)
            context[step.id] = result
            continue
        if step.delay_before_seconds > 0:
            time.sleep(step.delay_before_seconds)
        started = time.monotonic()
        try:
            response = surface.run(step.command, params)
            status, errors, warnings = _classify_step_response(response, step, context)
            retry_attempt = 0
            while (
                retry_attempt < step.visual_assert_retries
                and step.command in VISUAL_RETRY_COMMANDS
                and status == "failed"
                and _has_visual_assertion_failure(errors)
            ):
                retry_attempt += 1
                if step.visual_retry_delay_seconds > 0:
                    time.sleep(step.visual_retry_delay_seconds)
                previous_snapshot_id = response.snapshot_id
                response = surface.run(step.command, params)
                status, errors, warnings = _classify_step_response(
                    response, step, context
                )
                warnings = [
                    f"Retried transient visual assertion mismatch ({retry_attempt}/{step.visual_assert_retries}); previous snapshot: {previous_snapshot_id or 'none'}."
                ] + warnings
            duration_ms = int((time.monotonic() - started) * 1000)
            result = CanaryResult(
                id=step.id,
                suite=step.suite,
                lane=step.lane,
                command=step.command,
                params_redacted=params,
                ok=response.ok,
                status=status,
                audit_id=response.audit_id,
                engine=response.engine,
                snapshot_id=response.snapshot_id,
                artifact_path=response.artifact_path,
                duration_ms=duration_ms,
                errors=errors,
                warnings=warnings,
                payload=response.payload,
            )
        except Exception as exc:  # noqa: BLE001 - canary reports failures as data.
            duration_ms = int((time.monotonic() - started) * 1000)
            result = CanaryResult(
                id=step.id,
                suite=step.suite,
                lane=step.lane,
                command=step.command,
                params_redacted=params,
                ok=False,
                status="failed",
                audit_id=None,
                engine=None,
                snapshot_id=None,
                artifact_path=None,
                duration_ms=duration_ms,
                errors=[
                    {
                        "code": "qa_step_exception",
                        "message": str(exc),
                        "guidance": "Inspect the QA canary report and connector logs.",
                    }
                ],
                warnings=[],
                payload={},
            )
        results.append(result)
        context[step.id] = result
    return results


def classify_status(
    payload: dict[str, Any],
    *,
    skip_on_unavailable: bool = False,
    expect_error_code: str | None = None,
) -> str:
    errors = payload.get("errors") if isinstance(payload.get("errors"), list) else []
    error_codes = {
        str(error.get("code") or "") for error in errors if isinstance(error, dict)
    }
    if expect_error_code:
        return (
            "passed"
            if payload.get("ok") is not True and expect_error_code in error_codes
            else "failed"
        )
    if payload.get("ok") is True:
        return "passed"
    if skip_on_unavailable and (error_codes & set(UNAVAILABLE_CODES)):
        return "skipped"
    return "failed"


def _classify_step_response(
    response: SurfaceResponse, step: CanaryStep, context: dict[str, CanaryResult]
) -> tuple[str, list[dict[str, Any]], list[Any]]:
    status = classify_status(
        response.payload,
        skip_on_unavailable=step.skip_on_unavailable,
        expect_error_code=step.expect_error_code,
    )
    errors = list(response.errors)
    warnings = list(response.warnings)
    if (
        status == "passed"
        and step.requires_visual_evidence
        and (not response.snapshot_id or not response.artifact_path)
    ):
        status = "failed"
        errors.append(
            {
                "code": "qa_visual_evidence_missing",
                "message": "Visual see command returned ok:true without a snapshot id and materialized screenshot artifact.",
                "guidance": "Fix screenshot artifact return/materialization before certifying this release.",
            }
        )
    if status == "passed" and step.visual_assert:
        assertion_errors = _visual_assertion_errors(
            response.payload,
            _resolve_params(step.visual_assert, context),
            artifact_path=response.artifact_path,
        )
        if assertion_errors:
            status = "failed"
            errors.extend(assertion_errors)
    return status, errors, warnings


def _has_visual_assertion_failure(errors: list[dict[str, Any]]) -> bool:
    return any(
        error.get("code") == "qa_visual_assertion_failed"
        for error in errors
        if isinstance(error, dict)
    )


def timeout_for_command(command: str) -> int:
    """Per-primitive timeout in seconds. Scenario suites may run many primitives."""
    if command == LOCAL_WORKBENCH_CONTROL_START:
        return 30
    if command in {
        "desktop_see",
        "iphone_see",
        "customer_mac_snapshot",
        "customer_mac_ax_tree",
    }:
        return 60
    if command in {"desktop_click", "iphone_tap"}:
        return 30
    if command in {
        "desktop_drag",
        "desktop_scroll",
        "iphone_swipe",
        "customer_mac_iphone_mirroring_scroll",
    }:
        return 20
    if command in {
        "desktop_menu",
        "desktop_window",
        "desktop_browser_action",
        "desktop_focus_app",
        "customer_mac_iphone_mirroring_open_app",
    }:
        return 20
    if command in {
        "desktop_type",
        "desktop_hotkey",
        "iphone_type",
        "customer_mac_iphone_mirroring_type_approved_text",
        "customer_mac_iphone_mirroring_send_approved_message",
    }:
        return 15
    return 10


def build_scenarios(suite: str, *, allow_real_world_actions: bool) -> list[CanaryStep]:
    normalized = "full_access" if suite == "full" else suite
    if normalized == "desktop":
        normalized = "desktop_scenario"
    if normalized == "iphone":
        normalized = "iphone_scenario"
    suites: dict[str, list[CanaryStep]] = {
        "candidate": [
            CanaryStep(
                id="candidate.bridge_status",
                suite="candidate",
                command="desktop_bridge_status",
            )
        ],
        "control_start": _control_start_steps(),
        "readiness": _readiness_steps(),
        "codex": _codex_steps(),
        "full_access": _full_access_steps(),
        "primitive": _primitive_steps(),
        "desktop_scenario": _desktop_scenario_steps(),
        "iphone_scenario": _iphone_scenario_steps(),
        "ask_permission": _ask_permission_steps(),
        "kill_switch": _kill_switch_steps(),
        "real_world_optional": _real_world_steps() if allow_real_world_actions else [],
    }
    if normalized == "all":
        ordered = [
            "readiness",
            "codex",
            "full_access",
            "primitive",
            "desktop_scenario",
            "iphone_scenario",
            "ask_permission",
        ]
        if allow_real_world_actions:
            ordered.append("real_world_optional")
        return [step for name in ordered for step in suites[name]]
    if normalized not in suites:
        raise ValueError(f"unknown QA suite: {suite}")
    return suites[normalized]


def write_reports(
    *,
    artifact_dir: Path,
    run_id: str,
    started_at: str,
    version_under_test: str,
    build_under_test: str,
    source_commit_under_test: str,
    candidate_binding: dict[str, Any],
    surface: str,
    connector_url: str,
    results: list[CanaryResult],
) -> dict[str, Path]:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    summary = _summary(results)
    report = {
        "run_id": run_id,
        "started_at": started_at,
        "version_under_test": version_under_test,
        "build_under_test": build_under_test,
        "source_commit_under_test": source_commit_under_test,
        "candidate_binding": candidate_binding,
        "surface": surface,
        "connector_url_redacted": redact_connector_url(connector_url),
        "summary": summary,
        "results": [result.to_report_dict() for result in results],
    }
    json_path = artifact_dir / "qa-report.json"
    markdown_path = artifact_dir / "qa-report.md"
    json_path.write_text(
        json.dumps(redact_for_report(report), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    markdown_path.write_text(
        _markdown_report(redact_for_report(report)), encoding="utf-8"
    )
    _sanitize_artifact_files(artifact_dir)
    return {"json": json_path, "markdown": markdown_path}


def redact_for_report(value: Any) -> Any:
    secrets = _secret_values()
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, nested in value.items():
            lowered = str(key).lower()
            if (
                "token" in lowered
                or "secret" in lowered
                or lowered in {"authorization", "recipient_context", "text"}
            ):
                redacted[key] = "[redacted]"
            elif lowered.endswith("url") and isinstance(nested, str):
                redacted[key] = redact_connector_url(nested)
            else:
                redacted[key] = redact_for_report(nested)
        return redacted
    if isinstance(value, list):
        return [redact_for_report(item) for item in value]
    if isinstance(value, str):
        redacted_string = value
        for secret in secrets:
            redacted_string = redacted_string.replace(secret, "[redacted]")
        return redacted_string
    return value


def redact_connector_url(raw_url: str) -> str:
    try:
        parsed = urllib.parse.urlparse(raw_url)
    except Exception:
        return raw_url
    host = parsed.hostname or ""
    redacted_host = host
    parts = host.split(".")
    if len(parts) == 4 and all(part.isdigit() for part in parts):
        redacted_host = f"{parts[0]}.{parts[1]}.x.x"
    netloc = redacted_host
    if parsed.port:
        netloc += f":{parsed.port}"
    return urllib.parse.urlunparse((parsed.scheme, netloc, "", "", "", ""))


def _sanitize_artifact_files(artifact_dir: Path) -> None:
    secrets = [secret for secret in _secret_values() if secret]
    if not artifact_dir.exists():
        return
    for path in artifact_dir.rglob("*"):
        if not path.is_file() or path.stat().st_size > 5 * 1024 * 1024:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        redacted = text
        for secret in secrets:
            redacted = redacted.replace(secret, "[redacted]")
        redacted = re.sub(
            r"(?im)^((?:export\s+)?[A-Z0-9_]*(?:TOKEN|SECRET|AUTHORIZATION|API_KEY)[A-Z0-9_]*=).+$",
            r"\1[redacted]",
            redacted,
        )
        if redacted != text:
            path.write_text(redacted, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run evaOS Workbench connector QA canaries."
    )
    parser.add_argument("--connector-url", required=True)
    parser.add_argument("--token-env", default="EVAOS_DESKTOP_BRIDGE_TOKEN")
    parser.add_argument(
        "--surface", choices=("connector", "openclaw", "hermes"), default="connector"
    )
    parser.add_argument(
        "--suite",
        choices=(
            "candidate",
            "control_start",
            "readiness",
            "codex",
            "desktop",
            "iphone",
            "primitive",
            "desktop_scenario",
            "iphone_scenario",
            "full",
            "full_access",
            "ask_permission",
            "kill_switch",
            "real_world_optional",
            "all",
        ),
        default="readiness",
    )
    parser.add_argument("--artifact-dir", type=Path)
    parser.add_argument("--allow-real-world-actions", action="store_true")
    parser.add_argument(
        "--operator-ack-live-control",
        action="store_true",
        help="Required for suites that may move the mouse, keyboard, or iPhone Mirroring.",
    )
    parser.add_argument(
        "--allow-skips",
        action="store_true",
        help="Exit 0 when required suites contain skipped rows; release certification should not use this.",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        help="evaOS-GUI root containing resources/evaos-beta/bridge/agent-tools for adapter surfaces.",
    )
    parser.add_argument("--version-under-test", default="local-dev")
    parser.add_argument("--build-under-test", default="")
    parser.add_argument("--source-commit-under-test", default="")
    parser.add_argument(
        "--selected-binding-proof",
        type=Path,
        help="Sanitized mac-control-runtime.json proof from the verified selected-binding runtime receipt.",
    )
    parser.add_argument(
        "--selected-binding-proof-run-id",
        default="",
        help="Exact GitHub Actions run id that produced the selected-binding proof artifact.",
    )
    args = parser.parse_args(argv)

    token = os.environ.get(args.token_env)
    if not token:
        parser.error(f"{args.token_env} is required")
    if (
        _suite_requires_operator_ack(
            args.suite, allow_real_world_actions=args.allow_real_world_actions
        )
        and not args.operator_ack_live_control
    ):
        print(
            "Refusing to run live-control QA without operator acknowledgement. "
            "Re-run with --operator-ack-live-control when the Mac/iPhone can be controlled.",
            file=sys.stderr,
        )
        return 2
    if _suite_requires_operator_ack(
        args.suite, allow_real_world_actions=args.allow_real_world_actions
    ):
        print(
            "evaOS QA live-control warning: this suite may move the mouse, type, click, scroll, or operate iPhone Mirroring.",
            file=sys.stderr,
        )
    run_id = f"qa-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    artifact_dir = args.artifact_dir or DEFAULT_RUN_ROOT / run_id
    started_at = (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )
    if args.source_commit_under_test:
        local_candidate_binding = packaged_bridge_source_binding(
            args.source_commit_under_test, module_file=__file__
        )
        connector_binding = (
            connector_candidate_binding(
                connector_url=args.connector_url,
                token=token,
                expected_source_commit=args.source_commit_under_test,
                expected_source_sha256=str(
                    local_candidate_binding.get("actual_source_sha256") or ""
                ),
                expected_version=args.version_under_test,
                expected_build=args.build_under_test,
            )
            if local_candidate_binding.get("ok") is True
            else {"ok": False, "reason": "local_candidate_binding_failed"}
        )
        selected_binding_required = _suite_requires_selected_binding_proof(
            args.suite,
            allow_real_world_actions=args.allow_real_world_actions,
        )
        selected_binding = (
            selected_binding_proof_binding(
                args.selected_binding_proof,
                expected_source_commit=args.source_commit_under_test,
                expected_source_run_id=args.selected_binding_proof_run_id,
                expected_source_sha256=str(
                    local_candidate_binding.get("actual_source_sha256") or ""
                ),
                expected_version=args.version_under_test,
                expected_build=args.build_under_test,
            )
            if selected_binding_required
            else {"ok": None, "reason": "selected_binding_proof_not_required_for_suite"}
        )
        candidate_binding = {
            "ok": (
                local_candidate_binding.get("ok") is True
                and connector_binding.get("ok") is True
                and (
                    not selected_binding_required or selected_binding.get("ok") is True
                )
            ),
            "local": local_candidate_binding,
            "connector": connector_binding,
            "selected_binding": selected_binding,
        }
    else:
        candidate_binding = {"ok": None, "reason": "source_commit_not_requested"}
    if args.source_commit_under_test and candidate_binding.get("ok") is not True:
        report_paths = write_reports(
            artifact_dir=artifact_dir,
            run_id=run_id,
            started_at=started_at,
            version_under_test=args.version_under_test,
            build_under_test=args.build_under_test,
            source_commit_under_test=args.source_commit_under_test,
            candidate_binding=candidate_binding,
            surface=args.surface,
            connector_url=args.connector_url,
            results=[],
        )
        print(
            json.dumps(
                {
                    "ok": False,
                    "run_id": run_id,
                    "artifact_dir": str(artifact_dir),
                    "reports": {key: str(path) for key, path in report_paths.items()},
                    "candidate_binding": candidate_binding,
                },
                sort_keys=True,
            )
        )
        return 2
    if args.repo_root:
        os.environ["EVAOS_DESKTOP_BRIDGE_QA_REPO_ROOT"] = str(args.repo_root)
    remote_surface = _surface_for_name(
        args.surface,
        connector_url=args.connector_url,
        token=token,
        artifact_dir=artifact_dir,
    )
    surface = OperatorAcknowledgedLocalControlSurface(
        remote_surface,
        operator_ack_live_control=args.operator_ack_live_control,
    )
    steps = build_scenarios(
        args.suite, allow_real_world_actions=args.allow_real_world_actions
    )
    results = run_steps(steps, surface)
    report_paths = write_reports(
        artifact_dir=artifact_dir,
        run_id=run_id,
        started_at=started_at,
        version_under_test=args.version_under_test,
        build_under_test=args.build_under_test,
        source_commit_under_test=args.source_commit_under_test,
        candidate_binding=candidate_binding,
        surface=args.surface,
        connector_url=args.connector_url,
        results=results,
    )
    ok = _run_successful(results, allow_skips=args.allow_skips)
    print(
        json.dumps(
            {
                "ok": ok,
                "run_id": run_id,
                "artifact_dir": str(artifact_dir),
                "reports": {key: str(path) for key, path in report_paths.items()},
                "summary": _summary(results),
                "candidate_binding": candidate_binding,
            },
            sort_keys=True,
        )
    )
    return 0 if ok else 1


def _surface_for_name(
    name: str, *, connector_url: str, token: str, artifact_dir: Path
) -> CanarySurface:
    if name == "connector":
        return ConnectorSurface(
            connector_url=connector_url, token=token, artifact_dir=artifact_dir
        )
    if name == "openclaw":
        return OpenClawSurface(
            connector_url=connector_url, token=token, artifact_dir=artifact_dir
        )
    if name == "hermes":
        return HermesSurface(
            connector_url=connector_url, token=token, artifact_dir=artifact_dir
        )
    raise ValueError(f"unknown surface: {name}")


def _suite_requires_operator_ack(suite: str, *, allow_real_world_actions: bool) -> bool:
    normalized = "full_access" if suite == "full" else suite
    if normalized in {"readiness", "codex"}:
        return False
    if normalized == "real_world_optional" and not allow_real_world_actions:
        return False
    return normalized in LIVE_CONTROL_SUITES


def _suite_requires_selected_binding_proof(
    suite: str,
    *,
    allow_real_world_actions: bool,
) -> bool:
    normalized = "full_access" if suite == "full" else suite
    return normalized != "control_start" and _suite_requires_operator_ack(
        normalized,
        allow_real_world_actions=allow_real_world_actions,
    )


def _readiness_steps() -> list[CanaryStep]:
    return [
        CanaryStep(
            id="readiness.bridge_status",
            suite="readiness",
            command="desktop_bridge_status",
        ),
        CanaryStep(
            id="readiness.customer_mac_status",
            suite="readiness",
            command="customer_mac_status",
        ),
        CanaryStep(
            id="readiness.customer_mac_capabilities",
            suite="readiness",
            command="customer_mac_capabilities",
        ),
        CanaryStep(
            id="readiness.control_status",
            suite="readiness",
            command="desktop_control_status",
        ),
        CanaryStep(
            id="readiness.audit_tail",
            suite="readiness",
            command="desktop_bridge_audit_tail",
            params={"limit": 20},
        ),
        CanaryStep(
            id="readiness.iphone_status",
            suite="readiness",
            command="customer_mac_iphone_mirroring_status",
            skip_on_unavailable=True,
        ),
    ]


def _control_start_steps() -> list[CanaryStep]:
    return [
        CanaryStep(
            id="control_start.bridge_status",
            suite="control_start",
            command="desktop_bridge_status",
        ),
        CanaryStep(
            id="control_start.full_access",
            suite="control_start",
            command=LOCAL_WORKBENCH_CONTROL_START,
            params={"mode": "full-access", "agent_label": "evaOS RC Canary"},
        ),
        CanaryStep(
            id="control_start.ask_permission",
            suite="control_start",
            command=LOCAL_WORKBENCH_CONTROL_START,
            params={"mode": "ask-permission", "agent_label": "evaOS RC Canary"},
        ),
        CanaryStep(
            id="control_start.stop",
            suite="control_start",
            command="desktop_control_stop",
        ),
        CanaryStep(
            id="control_start.kill_switch",
            suite="control_start",
            command="desktop_kill_switch",
        ),
    ]


def _codex_steps() -> list[CanaryStep]:
    return [
        CanaryStep(
            id="codex.frontmost",
            suite="codex",
            command="desktop_bridge_codex_frontmost",
            skip_on_unavailable=True,
        ),
        CanaryStep(
            id="codex.windows",
            suite="codex",
            command="desktop_bridge_codex_windows",
            skip_on_unavailable=True,
        ),
        CanaryStep(
            id="codex.threads",
            suite="codex",
            command="desktop_bridge_codex_threads",
            params={"max_items": 20},
            skip_on_unavailable=True,
        ),
        CanaryStep(
            id="codex.connections_status",
            suite="codex",
            command="desktop_bridge_codex_connections_status",
            skip_on_unavailable=True,
        ),
        CanaryStep(
            id="codex.app_server_status",
            suite="codex",
            command="desktop_bridge_codex_app_server_status",
            skip_on_unavailable=True,
        ),
        CanaryStep(
            id="codex.loaded_threads",
            suite="codex",
            command="desktop_bridge_codex_app_server_loaded_threads",
            params={"max_items": 20},
            skip_on_unavailable=True,
        ),
        CanaryStep(
            id="codex.remote_control_status",
            suite="codex",
            command="desktop_bridge_codex_app_server_remote_control_status",
            skip_on_unavailable=True,
        ),
    ]


def _full_access_steps() -> list[CanaryStep]:
    return [
        CanaryStep(
            id="full.start",
            suite="full_access",
            command=LOCAL_WORKBENCH_CONTROL_START,
            params={"mode": "full-access", "agent_label": "evaOS QA Canary"},
        ),
        CanaryStep(
            id="full.status", suite="full_access", command="desktop_control_status"
        ),
        CanaryStep(
            id="full.scroll_no_approval",
            suite="full_access",
            command="desktop_scroll",
            params={"direction": "down", "amount": 200, "dry_run": False},
            delay_before_seconds=10.5,
        ),
        CanaryStep(
            id="full.hotkey_no_approval",
            suite="full_access",
            command="desktop_hotkey",
            params={"keys": "escape", "dry_run": False},
        ),
    ]


def _primitive_steps() -> list[CanaryStep]:
    return [
        CanaryStep(
            id="primitive.desktop_see",
            suite="primitive",
            lane="primitive",
            command="desktop_see",
            params={"max_chars": 4000, "max_nodes": 200},
            requires_visual_evidence=True,
        ),
        CanaryStep(
            id="primitive.desktop_click_element",
            suite="primitive",
            lane="primitive",
            command="desktop_click",
            params={
                "snapshot_id": "${primitive.desktop_see.snapshot_id}",
                "element_id": "${primitive.desktop_see.first_element_id}",
                "dry_run": False,
            },
            skip_on_unavailable=True,
        ),
        CanaryStep(
            id="primitive.desktop_click_coordinates",
            suite="primitive",
            lane="primitive",
            command="desktop_click",
            params={
                "snapshot_id": "${primitive.desktop_see.snapshot_id}",
                "x": 700,
                "y": 15,
                "dry_run": False,
            },
        ),
        CanaryStep(
            id="primitive.desktop_type",
            suite="primitive",
            lane="primitive",
            command="desktop_type",
            params={"text": "evaOS QA smoke", "dry_run": False},
        ),
        CanaryStep(
            id="primitive.desktop_scroll",
            suite="primitive",
            lane="primitive",
            command="desktop_scroll",
            params={"direction": "down", "amount": 400, "dry_run": False},
        ),
        CanaryStep(
            id="primitive.desktop_drag",
            suite="primitive",
            lane="primitive",
            command="desktop_drag",
            params={
                "from_x": 180,
                "from_y": 180,
                "to_x": 260,
                "to_y": 260,
                "dry_run": False,
            },
        ),
        CanaryStep(
            id="primitive.desktop_hotkey",
            suite="primitive",
            lane="primitive",
            command="desktop_hotkey",
            params={"keys": "escape", "dry_run": False},
        ),
        CanaryStep(
            id="primitive.iphone_focus",
            suite="primitive",
            lane="primitive",
            command="customer_mac_iphone_mirroring_focus",
            params={"dry_run": False},
            skip_on_unavailable=True,
        ),
        CanaryStep(
            id="primitive.iphone_open_calculator",
            suite="primitive",
            lane="primitive",
            command="customer_mac_iphone_mirroring_open_app",
            params={"app_name": "Calculator", "dry_run": False},
            skip_on_unavailable=True,
        ),
        CanaryStep(
            id="primitive.iphone_see",
            suite="primitive",
            lane="primitive",
            command="iphone_see",
            params={"max_chars": 4000, "max_nodes": 200},
            skip_on_unavailable=True,
            requires_visual_evidence=True,
        ),
        CanaryStep(
            id="primitive.iphone_tap_coordinates",
            suite="primitive",
            lane="primitive",
            command="iphone_tap",
            params={
                "snapshot_id": "${primitive.iphone_see.snapshot_id}",
                "x": 140,
                "y": 140,
                "dry_run": False,
            },
            skip_on_unavailable=True,
        ),
        CanaryStep(
            id="primitive.iphone_type",
            suite="primitive",
            lane="primitive",
            command="iphone_type",
            params={"text": "evaOS QA", "dry_run": False},
            skip_on_unavailable=True,
        ),
    ]


def _desktop_scenario_steps() -> list[CanaryStep]:
    return [
        CanaryStep(
            id="desktop_scenario.initial_see",
            suite="desktop_scenario",
            lane="scenario",
            command="desktop_see",
            params={"max_chars": 4000, "max_nodes": 200},
            requires_visual_evidence=True,
        ),
        CanaryStep(
            id="desktop_scenario.browser_open",
            suite="desktop_scenario",
            lane="scenario",
            command="desktop_browser_action",
            params={
                "action": "open_url",
                "url": "https://example.com",
                "dry_run": False,
            },
            assert_from_step="desktop_scenario.initial_see",
        ),
        CanaryStep(
            id="desktop_scenario.see_browser",
            suite="desktop_scenario",
            lane="scenario",
            command="desktop_see",
            params={"max_chars": 4000, "max_nodes": 200},
            requires_visual_evidence=True,
            visual_assert={"expected_visible_text": "Example"},
        ),
        CanaryStep(
            id="desktop_scenario.escape",
            suite="desktop_scenario",
            lane="scenario",
            command="desktop_hotkey",
            params={"keys": "escape", "dry_run": False},
            assert_from_step="desktop_scenario.see_browser",
        ),
        CanaryStep(
            id="desktop_scenario.menu_probe",
            suite="desktop_scenario",
            lane="scenario",
            command="desktop_menu",
            params={"menu_path": "Window", "dry_run": True},
            skip_on_unavailable=True,
            assert_from_step="desktop_scenario.see_browser",
        ),
    ]


def _iphone_scenario_steps() -> list[CanaryStep]:
    return [
        CanaryStep(
            id="iphone_scenario.focus",
            suite="iphone_scenario",
            lane="scenario",
            command="customer_mac_iphone_mirroring_focus",
            params={"dry_run": False},
            skip_on_unavailable=True,
        ),
        CanaryStep(
            id="iphone_scenario.pre_open_state",
            suite="iphone_scenario",
            lane="scenario",
            command="iphone_see",
            params={"max_chars": 4000, "max_nodes": 200},
            skip_on_unavailable=True,
            requires_visual_evidence=True,
        ),
        CanaryStep(
            id="iphone_scenario.open_calculator",
            suite="iphone_scenario",
            lane="scenario",
            command="customer_mac_iphone_mirroring_open_app",
            params={"app_name": "Calculator", "dry_run": False},
            skip_on_unavailable=True,
            assert_from_step="iphone_scenario.pre_open_state",
        ),
        CanaryStep(
            id="iphone_scenario.see_calculator",
            suite="iphone_scenario",
            lane="scenario",
            command="iphone_see",
            params={"max_chars": 4000, "max_nodes": 200},
            skip_on_unavailable=True,
            requires_visual_evidence=True,
            visual_assert={
                "expected_visible_text": "Calculator",
                "expected_image_state": "iphone_calculator",
            },
            visual_assert_retries=2,
            visual_retry_delay_seconds=1.0,
        ),
        CanaryStep(
            id="iphone_scenario.calculator_entry",
            suite="iphone_scenario",
            lane="scenario",
            command="iphone_type",
            params={"text": "1+1+1=", "dry_run": False},
            skip_on_unavailable=True,
            assert_from_step="iphone_scenario.see_calculator",
        ),
        CanaryStep(
            id="iphone_scenario.see_result",
            suite="iphone_scenario",
            lane="scenario",
            command="iphone_see",
            params={"max_chars": 4000, "max_nodes": 200},
            skip_on_unavailable=True,
            requires_visual_evidence=True,
            visual_assert={
                "expected_image_state": "iphone_calculator",
                "allowed_states": ["Calculator", "3"],
            },
            visual_assert_retries=2,
            visual_retry_delay_seconds=1.0,
        ),
        CanaryStep(
            id="iphone_scenario.home",
            suite="iphone_scenario",
            lane="scenario",
            command="customer_mac_iphone_mirroring_home",
            params={"dry_run": False},
            skip_on_unavailable=True,
            assert_from_step="iphone_scenario.see_result",
        ),
        CanaryStep(
            id="iphone_scenario.see_home",
            suite="iphone_scenario",
            lane="scenario",
            command="iphone_see",
            params={"max_chars": 4000, "max_nodes": 200},
            skip_on_unavailable=True,
            requires_visual_evidence=True,
        ),
        CanaryStep(
            id="iphone_scenario.spotlight",
            suite="iphone_scenario",
            lane="scenario",
            command="customer_mac_iphone_mirroring_spotlight",
            params={"dry_run": False},
            skip_on_unavailable=True,
            assert_from_step="iphone_scenario.see_home",
        ),
        CanaryStep(
            id="iphone_scenario.app_switcher",
            suite="iphone_scenario",
            lane="scenario",
            command="customer_mac_iphone_mirroring_app_switcher",
            params={"dry_run": False},
            skip_on_unavailable=True,
            assert_from_step="iphone_scenario.see_home",
        ),
    ]


def _ask_permission_steps() -> list[CanaryStep]:
    return [
        CanaryStep(
            id="ask.start",
            suite="ask_permission",
            command=LOCAL_WORKBENCH_CONTROL_START,
            params={"mode": "ask-permission", "agent_label": "evaOS QA Canary"},
        ),
        CanaryStep(
            id="ask.high_impact_denied",
            suite="ask_permission",
            command="desktop_type",
            params={"text": "evaOS QA ask permission", "dry_run": False},
            expect_error_code="approval_audit_required",
            delay_before_seconds=10.5,
        ),
        CanaryStep(
            id="ask.high_impact_dry_run",
            suite="ask_permission",
            command="desktop_type",
            params={"text": "evaOS QA ask permission", "dry_run": True},
        ),
        CanaryStep(
            id="ask.high_impact_approved",
            suite="ask_permission",
            command="desktop_type",
            params={
                "text": "evaOS QA ask permission",
                "dry_run": False,
                "approval_audit_id": "${ask.high_impact_dry_run.audit_id}",
            },
            skip_if_unresolved=True,
        ),
    ]


def _kill_switch_steps() -> list[CanaryStep]:
    return [
        CanaryStep(
            id="kill.activate", suite="kill_switch", command="desktop_kill_switch"
        ),
        CanaryStep(
            id="kill.status", suite="kill_switch", command="desktop_control_status"
        ),
        CanaryStep(
            id="kill.blocks_control",
            suite="kill_switch",
            command="desktop_scroll",
            params={"direction": "down", "amount": 100, "dry_run": False},
            expect_error_code="control_kill_switch_active",
        ),
    ]


def _real_world_steps() -> list[CanaryStep]:
    return [
        CanaryStep(
            id="real.bumble_open",
            suite="real_world_optional",
            lane="real_world",
            command="customer_mac_iphone_mirroring_open_app",
            params={"app_name": "Bumble", "dry_run": False},
            env_required=("QA_BUMBLE_TEXT",),
            skip_on_unavailable=True,
        ),
        CanaryStep(
            id="real.bumble_see",
            suite="real_world_optional",
            lane="real_world",
            command="iphone_see",
            params={"max_chars": 4000, "max_nodes": 200},
            env_required=("QA_BUMBLE_TEXT",),
            skip_on_unavailable=True,
            requires_visual_evidence=True,
            visual_assert={"expected_visible_text": "Bumble"},
        ),
        CanaryStep(
            id="real.bumble_swipe_left",
            suite="real_world_optional",
            lane="real_world",
            command="iphone_swipe",
            params={"direction": "left", "dry_run": False},
            env_required=("QA_BUMBLE_TEXT",),
            skip_on_unavailable=True,
            assert_from_step="real.bumble_see",
        ),
        CanaryStep(
            id="real.bumble_text",
            suite="real_world_optional",
            lane="real_world",
            command="iphone_type",
            params={"text": "${env.QA_BUMBLE_TEXT}", "dry_run": False},
            env_required=("QA_BUMBLE_TEXT",),
            skip_on_unavailable=True,
            assert_from_step="real.bumble_see",
        ),
        CanaryStep(
            id="real.sms_text",
            suite="real_world_optional",
            lane="real_world",
            command="iphone_type",
            params={"text": "${env.QA_SMS_TEXT}", "dry_run": False},
            env_required=("QA_SMS_CONTACT", "QA_SMS_TEXT"),
            skip_on_unavailable=True,
        ),
        CanaryStep(
            id="real.social_open",
            suite="real_world_optional",
            lane="real_world",
            command="customer_mac_iphone_mirroring_open_app",
            params={"app_name": "${env.QA_SOCIAL_APP}", "dry_run": False},
            env_required=("QA_SOCIAL_APP", "QA_SOCIAL_TEXT"),
            skip_on_unavailable=True,
        ),
        CanaryStep(
            id="real.social_see",
            suite="real_world_optional",
            lane="real_world",
            command="iphone_see",
            params={"max_chars": 4000, "max_nodes": 200},
            env_required=("QA_SOCIAL_APP", "QA_SOCIAL_TEXT"),
            skip_on_unavailable=True,
            requires_visual_evidence=True,
            visual_assert={"expected_visible_text": "${env.QA_SOCIAL_APP}"},
        ),
        CanaryStep(
            id="real.social_text",
            suite="real_world_optional",
            lane="real_world",
            command="iphone_type",
            params={"text": "${env.QA_SOCIAL_TEXT}", "dry_run": False},
            env_required=("QA_SOCIAL_APP", "QA_SOCIAL_TEXT"),
            skip_on_unavailable=True,
            assert_from_step="real.social_see",
        ),
    ]


def _resolve_params(
    params: dict[str, Any], context: dict[str, CanaryResult]
) -> dict[str, Any]:
    return {key: _resolve_value(value, context) for key, value in params.items()}


def _resolve_value(value: Any, context: dict[str, CanaryResult]) -> Any:
    if isinstance(value, dict):
        return {key: _resolve_value(nested, context) for key, nested in value.items()}
    if isinstance(value, list):
        return [_resolve_value(item, context) for item in value]
    if (
        not isinstance(value, str)
        or not value.startswith("${")
        or not value.endswith("}")
    ):
        return value
    expression = value[2:-1]
    if expression.startswith("env."):
        env_key = expression.removeprefix("env.")
        env_value = os.environ.get(env_key)
        if not env_value:
            raise _UnresolvedPlaceholder(f"{env_key} is not set")
        return env_value
    if expression.endswith(".audit_id"):
        step_id = expression.removesuffix(".audit_id")
        result = context.get(step_id)
        if not result or not result.audit_id:
            raise _UnresolvedPlaceholder(f"{step_id} did not produce an audit id")
        return result.audit_id
    if expression.endswith(".snapshot_id"):
        step_id = expression.removesuffix(".snapshot_id")
        result = context.get(step_id)
        if not result or not result.snapshot_id:
            raise _UnresolvedPlaceholder(f"{step_id} did not produce a snapshot id")
        return result.snapshot_id
    if expression.endswith(".first_element_id"):
        step_id = expression.removesuffix(".first_element_id")
        result = context.get(step_id)
        element_id = _find_first_element_id(result.payload if result else {})
        if not element_id:
            raise _UnresolvedPlaceholder(f"{step_id} did not expose an element id")
        return element_id
    raise _UnresolvedPlaceholder(f"unknown QA placeholder: {value}")


def _find_first_element_id(payload: dict[str, Any]) -> str | None:
    candidates: list[Any] = []
    data = payload.get("data")
    if isinstance(data, dict):
        for key in ("elements", "items", "nodes"):
            value = data.get(key)
            if isinstance(value, list):
                candidates.extend(value)
        screenshot = data.get("screenshot")
        if isinstance(screenshot, dict):
            for key in ("elements", "items", "nodes"):
                value = screenshot.get(key)
                if isinstance(value, list):
                    candidates.extend(value)
    for candidate in candidates:
        if isinstance(candidate, dict):
            for key in ("element_id", "id"):
                value = candidate.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
    return None


def _scenario_dependency_error(
    step: CanaryStep, context: dict[str, CanaryResult]
) -> str | None:
    if (
        step.lane not in {"scenario", "real_world"}
        or step.command not in ACTION_COMMANDS
    ):
        return None
    if not step.assert_from_step:
        return "Scenario live actions require assert_from_step so the harness acts from a verified visual state."
    dependency = context.get(step.assert_from_step)
    if not dependency:
        return f"{step.assert_from_step} did not run before this live action."
    if dependency.status != "passed":
        return f"{step.assert_from_step} did not pass visual assertions."
    if not dependency.snapshot_id or not dependency.artifact_path:
        return f"{step.assert_from_step} did not produce visual evidence."
    return None


def _visual_assertion_errors(
    payload: dict[str, Any],
    assertion: dict[str, Any],
    *,
    artifact_path: str | None = None,
) -> list[dict[str, Any]]:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    text = _visible_text(data).lower()
    frontmost_app = str(
        data.get("frontmost_app") or data.get("app") or data.get("active_app") or ""
    ).lower()
    image_states = _visual_artifact_states(artifact_path)
    errors: list[dict[str, Any]] = []
    expected_app = assertion.get("expected_app")
    if (
        isinstance(expected_app, str)
        and expected_app.strip()
        and not _visual_state_matches(
            expected_app,
            text=text,
            frontmost_app=frontmost_app,
            image_states=image_states,
        )
    ):
        errors.append(
            _visual_assertion_error(
                f"Expected app/state containing '{expected_app}' but saw '{frontmost_app or text[:80]}'."
            )
        )
    expected_text = assertion.get("expected_visible_text")
    if (
        isinstance(expected_text, str)
        and expected_text.strip()
        and not _visual_state_matches(
            expected_text,
            text=text,
            frontmost_app=frontmost_app,
            image_states=image_states,
        )
    ):
        errors.append(
            _visual_assertion_error(
                f"Expected visible text '{expected_text}' was not found."
            )
        )
    expected_label = assertion.get("expected_label")
    if (
        isinstance(expected_label, str)
        and expected_label.strip()
        and not _visual_state_matches(
            expected_label,
            text=text,
            frontmost_app=frontmost_app,
            image_states=image_states,
        )
    ):
        errors.append(
            _visual_assertion_error(
                f"Expected visible label '{expected_label}' was not found."
            )
        )
    expected_image_state = assertion.get("expected_image_state")
    if (
        isinstance(expected_image_state, str)
        and expected_image_state.strip()
        and not _visual_image_state_matches(
            expected_image_state, image_states=image_states
        )
    ):
        errors.append(
            _visual_assertion_error(
                f"Expected image state '{expected_image_state}' was not found in the materialized visual artifact."
            )
        )
    allowed_states = assertion.get("allowed_states")
    if isinstance(allowed_states, list) and allowed_states:
        states = [str(state) for state in allowed_states if str(state).strip()]
        if states and not any(
            _visual_state_matches(
                state, text=text, frontmost_app=frontmost_app, image_states=image_states
            )
            for state in states
        ):
            errors.append(
                _visual_assertion_error(
                    f"None of the allowed states matched: {', '.join(str(state) for state in allowed_states)}."
                )
            )
    return errors


def _visual_state_matches(
    expected: str, *, text: str, frontmost_app: str, image_states: set[str]
) -> bool:
    raw = expected.strip().lower()
    normalized = _normalize_visual_state(expected)
    normalized_text = _normalize_visual_state(text)
    normalized_frontmost_app = _normalize_visual_state(frontmost_app)
    return (
        raw in text
        or raw in frontmost_app
        or normalized in normalized_text
        or normalized in normalized_frontmost_app
        or _visual_image_state_matches(normalized, image_states=image_states)
    )


def _visual_image_state_matches(expected: str, *, image_states: set[str]) -> bool:
    normalized = _normalize_visual_state(expected)
    aliases = {normalized}
    if normalized == "calculator":
        aliases.add("iphone_calculator")
    if normalized == "iphone_calculator":
        aliases.add("calculator")
    return bool(aliases & image_states)


def _normalize_visual_state(value: str) -> str:
    return "_".join(value.strip().lower().split())


def _visual_artifact_states(artifact_path: str | None) -> set[str]:
    if not artifact_path:
        return set()
    ratios = _image_color_ratios_with_pillow(artifact_path)
    if ratios is None:
        ratios = _image_color_ratios_from_png(artifact_path)
    if ratios is None:
        return set()
    states: set[str] = set()
    if ratios["orange"] > 0.02 and ratios["dark"] > 0.25 and ratios["gray"] > 0.10:
        states.update({"calculator", "iphone_calculator"})
    return states


def _image_color_ratios_with_pillow(artifact_path: str) -> dict[str, float] | None:
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except Exception:
        return None
    try:
        with Image.open(artifact_path) as image:
            rgb_image = image.convert("RGB")
            rgb_image.thumbnail((360, 360))
            pixels = list(rgb_image.getdata())
    except Exception:
        return None
    return _color_ratios_from_pixels(pixels)


def _image_color_ratios_from_png(artifact_path: str) -> dict[str, float] | None:
    try:
        raw = Path(artifact_path).read_bytes()
    except OSError:
        return None
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    offset = 8
    width = 0
    height = 0
    bit_depth = 0
    color_type = 0
    interlace = 0
    idat = bytearray()
    while offset + 8 <= len(raw):
        chunk_length = struct.unpack(">I", raw[offset : offset + 4])[0]
        chunk_type = raw[offset + 4 : offset + 8]
        chunk_data_start = offset + 8
        chunk_data_end = chunk_data_start + chunk_length
        if chunk_data_end + 4 > len(raw):
            return None
        chunk_data = raw[chunk_data_start:chunk_data_end]
        if chunk_type == b"IHDR":
            if chunk_length != 13:
                return None
            try:
                (
                    width,
                    height,
                    bit_depth,
                    color_type,
                    _compression,
                    _filter,
                    interlace,
                ) = struct.unpack(">IIBBBBB", chunk_data)
            except struct.error:
                return None
        elif chunk_type == b"IDAT":
            idat.extend(chunk_data)
        elif chunk_type == b"IEND":
            break
        offset = chunk_data_end + 4
    if (
        width <= 0
        or height <= 0
        or bit_depth != 8
        or interlace != 0
        or color_type not in {2, 6}
        or not idat
    ):
        return None
    channels = 4 if color_type == 6 else 3
    row_stride = width * channels
    try:
        inflated = zlib.decompress(bytes(idat))
    except zlib.error:
        return None
    expected_minimum = (row_stride + 1) * height
    if len(inflated) < expected_minimum:
        return None
    pixels: list[tuple[int, int, int]] = []
    previous = bytearray(row_stride)
    cursor = 0
    sample_every = max(1, (width * height) // 130_000)
    pixel_index = 0
    for _row_index in range(height):
        filter_type = inflated[cursor]
        cursor += 1
        scanline = bytearray(inflated[cursor : cursor + row_stride])
        cursor += row_stride
        if filter_type == 1:
            _png_unfilter_sub(scanline, channels)
        elif filter_type == 2:
            _png_unfilter_up(scanline, previous)
        elif filter_type == 3:
            _png_unfilter_average(scanline, previous, channels)
        elif filter_type == 4:
            _png_unfilter_paeth(scanline, previous, channels)
        elif filter_type != 0:
            return None
        for index in range(0, row_stride, channels):
            if pixel_index % sample_every == 0:
                pixels.append(
                    (scanline[index], scanline[index + 1], scanline[index + 2])
                )
            pixel_index += 1
        previous = scanline
    return _color_ratios_from_pixels(pixels)


def _color_ratios_from_pixels(
    pixels: list[tuple[int, int, int]],
) -> dict[str, float] | None:
    total = len(pixels)
    if total == 0:
        return None
    orange = sum(
        1
        for red, green, blue in pixels
        if red > 190 and 95 < green < 190 and blue < 90 and red > green + 45
    )
    dark = sum(
        1 for red, green, blue in pixels if red < 45 and green < 45 and blue < 45
    )
    gray = sum(
        1
        for red, green, blue in pixels
        if 45 < red < 180
        and 45 < green < 180
        and 45 < blue < 180
        and max(red, green, blue) - min(red, green, blue) < 35
    )
    return {"orange": orange / total, "dark": dark / total, "gray": gray / total}


def _png_unfilter_sub(scanline: bytearray, bytes_per_pixel: int) -> None:
    for index in range(bytes_per_pixel, len(scanline)):
        scanline[index] = (scanline[index] + scanline[index - bytes_per_pixel]) & 0xFF


def _png_unfilter_up(scanline: bytearray, previous: bytearray) -> None:
    for index in range(len(scanline)):
        scanline[index] = (scanline[index] + previous[index]) & 0xFF


def _png_unfilter_average(
    scanline: bytearray, previous: bytearray, bytes_per_pixel: int
) -> None:
    for index in range(len(scanline)):
        left = scanline[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
        up = previous[index]
        scanline[index] = (scanline[index] + ((left + up) // 2)) & 0xFF


def _png_unfilter_paeth(
    scanline: bytearray, previous: bytearray, bytes_per_pixel: int
) -> None:
    for index in range(len(scanline)):
        left = scanline[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
        up = previous[index]
        upper_left = (
            previous[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
        )
        scanline[index] = (
            scanline[index] + _paeth_predictor(left, up, upper_left)
        ) & 0xFF


def _paeth_predictor(left: int, up: int, upper_left: int) -> int:
    estimate = left + up - upper_left
    distance_left = abs(estimate - left)
    distance_up = abs(estimate - up)
    distance_upper_left = abs(estimate - upper_left)
    if distance_left <= distance_up and distance_left <= distance_upper_left:
        return left
    if distance_up <= distance_upper_left:
        return up
    return upper_left


def _visual_assertion_error(message: str) -> dict[str, str]:
    return {
        "code": "qa_visual_assertion_failed",
        "message": message,
        "guidance": "Run a fresh see command, verify the target app/screen, then retry the scenario action.",
    }


def _visible_text(data: dict[str, Any]) -> str:
    chunks: list[str] = []

    def collect(value: Any) -> None:
        if isinstance(value, str):
            chunks.append(value)
            return
        if isinstance(value, list):
            for item in value:
                collect(item)
            return
        if isinstance(value, dict):
            for key in (
                "label",
                "title",
                "text",
                "value",
                "name",
                "description",
                "frontmost_app",
                "app",
                "active_app",
            ):
                nested = value.get(key)
                if isinstance(nested, str):
                    chunks.append(nested)
            for key in ("elements", "items", "nodes", "screenshot", "image"):
                if key in value:
                    collect(value[key])

    collect(data)
    return " ".join(chunks)


class _UnresolvedPlaceholder(ValueError):
    pass


def _skipped_result(step: CanaryStep, message: str) -> CanaryResult:
    return CanaryResult(
        id=step.id,
        suite=step.suite,
        lane=step.lane,
        command=step.command,
        params_redacted=step.params,
        ok=False,
        status="skipped",
        audit_id=None,
        engine=None,
        snapshot_id=None,
        artifact_path=None,
        duration_ms=0,
        errors=[],
        warnings=[message],
        payload={},
    )


def _failed_result(
    step: CanaryStep, message: str, *, code: str = "qa_placeholder_unresolved"
) -> CanaryResult:
    return CanaryResult(
        id=step.id,
        suite=step.suite,
        lane=step.lane,
        command=step.command,
        params_redacted=step.params,
        ok=False,
        status="failed",
        audit_id=None,
        engine=None,
        snapshot_id=None,
        artifact_path=None,
        duration_ms=0,
        errors=[
            {
                "code": code,
                "message": message,
                "guidance": "Inspect previous canary steps.",
            }
        ],
        warnings=[],
        payload={},
    )


def _summary(results: list[CanaryResult]) -> dict[str, int]:
    return {
        "total": len(results),
        "passed": sum(1 for result in results if result.status == "passed"),
        "failed": sum(1 for result in results if result.status == "failed"),
        "skipped": sum(1 for result in results if result.status == "skipped"),
    }


def _run_successful(results: list[CanaryResult], *, allow_skips: bool) -> bool:
    if any(result.status == "failed" for result in results):
        return False
    if allow_skips:
        return True
    return not any(
        result.status == "skipped" and result.suite != "real_world_optional"
        for result in results
    )


def _markdown_report(report: dict[str, Any]) -> str:
    summary = report["summary"]
    lines = [
        "# evaOS Workbench QA Canary Report",
        "",
        f"- Run: `{report['run_id']}`",
        f"- Version under test: `{report['version_under_test']}`",
        f"- Surface: `{report['surface']}`",
        f"- Connector: `{report['connector_url_redacted']}`",
        f"- Summary: {summary['passed']} passed, {summary['failed']} failed, {summary['skipped']} skipped, {summary['total']} total",
        "",
        "| Status | Lane | Suite | Step | Command | Audit | Engine | Snapshot | Artifact | Duration |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for result in report["results"]:
        lines.append(
            "| {status} | {lane} | {suite} | `{id}` | `{command}` | `{audit}` | `{engine}` | `{snapshot}` | `{artifact}` | {duration}ms |".format(
                status=result["status"],
                lane=result.get("lane") or "",
                suite=result["suite"],
                id=result["id"],
                command=result["command"],
                audit=result.get("audit_id") or "",
                engine=result.get("engine") or "",
                snapshot=result.get("snapshot_id") or "",
                artifact=result.get("artifact_path") or "",
                duration=result.get("duration_ms") or 0,
            )
        )
    lines.append("")
    return "\n".join(lines)


def _payload_from_completed_process(
    completed: subprocess.CompletedProcess[str], command: str
) -> dict[str, Any]:
    stdout = (completed.stdout or "").strip()
    if stdout:
        try:
            payload = json.loads(stdout)
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError:
            pass
    message = (
        completed.stderr or stdout or f"adapter exited {completed.returncode}"
    ).strip()
    return _error_payload(command=command, code="qa_adapter_failed", message=message)


def _loads_json_response(body: bytes) -> dict[str, Any]:
    parsed = json.loads(body.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("response body must be a JSON object")
    return parsed


def _error_payload(*, command: str, code: str, message: str) -> dict[str, Any]:
    return {
        "schema_version": "2026-05-02.mvp1",
        "command": command,
        "target": "customer_mac",
        "timestamp": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "ok": False,
        "data": {},
        "warnings": [],
        "errors": [
            {
                "code": code,
                "message": message,
                "guidance": "Inspect the QA canary report and connector logs.",
            }
        ],
        "audit_id": "qa-adapter-failed",
    }


def _extract_string(source: dict[str, Any], paths: tuple[str, ...]) -> str | None:
    for path in paths:
        value: Any = source
        for part in path.split("."):
            if not isinstance(value, dict):
                value = None
                break
            value = value.get(part)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _safe_filename(value: str) -> str:
    return (
        "".join(char if char.isalnum() or char in "._-" else "-" for char in value)[
            :160
        ]
        or "artifact"
    )


def _resolve_repo_root() -> Path:
    candidates: list[Path] = []
    env_root = os.environ.get("EVAOS_DESKTOP_BRIDGE_QA_REPO_ROOT")
    if env_root:
        candidates.append(Path(env_root).expanduser())
    candidates.append(Path.cwd())
    candidates.extend(Path.cwd().parents)
    module_path = Path(__file__).resolve()
    candidates.extend(module_path.parents)
    for candidate in candidates:
        agent_tools = _agent_tools_root(candidate)
        if (agent_tools / "openclaw-plugin" / "dist" / "index.js").exists() and (
            agent_tools / "hermes-adapter" / "bin" / "evaos-desktop-bridge-command"
        ).exists():
            return candidate
    return Path.cwd()


def _agent_tools_root(repo_root: Path) -> Path:
    return repo_root / "resources" / "evaos-beta" / "bridge" / "agent-tools"


def _secret_values() -> list[str]:
    values = []
    for key, value in os.environ.items():
        lowered = key.lower()
        if value and (
            "token" in lowered or "secret" in lowered or key in REAL_WORLD_ENV_KEYS
        ):
            values.append(value)
    return values


if __name__ == "__main__":
    raise SystemExit(main())
