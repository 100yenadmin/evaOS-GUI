from __future__ import annotations

import json
import os
import stat
import tempfile
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

try:
    import fcntl
except ImportError:  # pragma: no cover - the connector is released for macOS; the process lock remains for imports elsewhere.
    fcntl = None  # type: ignore[assignment]

from ..contracts.redaction import redact_audit_value, redact_value
from .audit import default_state_dir

LATEST_FILE = "latest.json"
AUDIT_FILE = "audit.jsonl"
CONTROL_SESSION_FILE = "control-session.json"
CONTROL_SESSION_LOCK_FILE = "control-session.lock"
APPROVAL_AUDIT_MAX_AGE_SECONDS = 15 * 60
CONTROL_MODES = {"full_access", "ask_permission"}
TAKEOVER_WARNING_SECONDS = 10
CONTROL_SESSION_MAX_BYTES = 64 * 1024
_CONTROL_SESSION_PROCESS_LOCK = threading.RLock()
_CONTROL_SESSION_LOCK_STATE = threading.local()


class ControlKillSwitchActiveError(RuntimeError):
    pass


class ControlSessionChangedError(RuntimeError):
    pass


def latest_path(state_dir: Path | None = None) -> Path:
    return (state_dir or default_state_dir()) / LATEST_FILE


def write_latest(envelope: dict[str, Any], state_dir: Path | None = None) -> Path:
    root = state_dir or default_state_dir()
    root.mkdir(parents=True, exist_ok=True)
    path = root / LATEST_FILE
    path.write_text(json.dumps(redact_value(envelope), sort_keys=True) + "\n", encoding="utf-8")
    return path


def read_latest(state_dir: Path | None = None) -> dict[str, Any] | None:
    path = latest_path(state_dir)
    if not path.exists():
        return None
    return redact_value(json.loads(path.read_text(encoding="utf-8")))


def read_audit_tail(limit: int = 20, state_dir: Path | None = None) -> list[dict[str, Any]]:
    if limit < 1:
        raise ValueError("limit must be >= 1")
    root = state_dir or default_state_dir()
    path = root / AUDIT_FILE
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    records: list[dict[str, Any]] = []
    for line in lines[-limit:]:
        if not line.strip():
            continue
        records.append(redact_audit_value(json.loads(line)))
    return records


def read_audit_record(audit_id: str, state_dir: Path | None = None) -> dict[str, Any] | None:
    if not isinstance(audit_id, str) or not audit_id.startswith("audit-"):
        return None
    root = state_dir or default_state_dir()
    path = root / AUDIT_FILE
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if record.get("audit_id") == audit_id:
            return redact_audit_value(record)
    return None


def approval_audit_freshness_error(record: dict[str, Any], *, max_age_seconds: int = APPROVAL_AUDIT_MAX_AGE_SECONDS) -> str | None:
    timestamp = record.get("timestamp")
    if not isinstance(timestamp, str) or not timestamp.strip():
        return "approval_audit_id has no timestamp; run a new dry-run."
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return "approval_audit_id has an invalid timestamp; run a new dry-run."
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    age_seconds = (datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).total_seconds()
    if age_seconds < -60:
        return "approval_audit_id timestamp is in the future; run a new dry-run."
    if age_seconds > max_age_seconds:
        minutes = max(1, max_age_seconds // 60)
        return f"approval_audit_id is older than {minutes} minutes; run a new dry-run."
    return None


def control_session_path(state_dir: Path | None = None) -> Path:
    return (state_dir or default_state_dir()) / CONTROL_SESSION_FILE


@contextmanager
def control_session_transaction(state_dir: Path | None = None) -> Iterator[None]:
    root = state_dir or default_state_dir()
    lock_path = root / CONTROL_SESSION_LOCK_FILE
    with _CONTROL_SESSION_PROCESS_LOCK:
        depth = int(getattr(_CONTROL_SESSION_LOCK_STATE, "depth", 0))
        active_lock_path = getattr(_CONTROL_SESSION_LOCK_STATE, "lock_path", None)
        if depth > 0:
            if active_lock_path != str(lock_path):
                raise RuntimeError("Nested control-session transactions must use the same state directory.")
            _CONTROL_SESSION_LOCK_STATE.depth = depth + 1
            try:
                yield
            finally:
                _CONTROL_SESSION_LOCK_STATE.depth = depth
            return

        root.mkdir(parents=True, exist_ok=True)
        flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(lock_path, flags, 0o600)
        try:
            os.fchmod(descriptor, 0o600)
            if fcntl is not None:
                fcntl.flock(descriptor, fcntl.LOCK_EX)
            _CONTROL_SESSION_LOCK_STATE.depth = 1
            _CONTROL_SESSION_LOCK_STATE.lock_path = str(lock_path)
            yield
        finally:
            _CONTROL_SESSION_LOCK_STATE.depth = 0
            _CONTROL_SESSION_LOCK_STATE.lock_path = None
            if fcntl is not None:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)


def default_control_session() -> dict[str, Any]:
    return {
        "active": False,
        "generation": 0,
        "mode": "ask_permission",
        "agent_label": None,
        "started_at": None,
        "stopped_at": None,
        "kill_switch": False,
        "takeover_warning_started_at": None,
        "takeover_warning_until": None,
        "takeover_warning_seconds": TAKEOVER_WARNING_SECONDS,
        "takeover_alert_signal_status": {},
    }


def _fail_closed_control_session(*, code: str, payload: object | None = None) -> dict[str, Any]:
    session = default_control_session()
    if isinstance(payload, dict):
        generation = payload.get("generation")
        if type(generation) is int and generation >= 0:
            session["generation"] = generation
    session.update(
        {
            "active": False,
            "kill_switch": True,
            "state_integrity": "invalid",
            "state_error_code": code,
            "recovery_required": True,
        }
    )
    return annotate_control_session(session)


def _valid_optional_control_timestamp(value: object) -> bool:
    return value is None or (
        isinstance(value, str) and bool(value.strip()) and _parse_control_timestamp(value) is not None
    )


def _valid_control_session_payload(payload: object) -> bool:
    if not isinstance(payload, dict):
        return False
    if type(payload.get("active")) is not bool or type(payload.get("kill_switch")) is not bool:
        return False
    generation = payload.get("generation")
    if type(generation) is not int or generation < 0:
        return False
    if payload.get("mode") not in CONTROL_MODES:
        return False
    agent_label = payload.get("agent_label")
    if agent_label is not None and (not isinstance(agent_label, str) or len(agent_label) > 160):
        return False
    for field in ("started_at", "stopped_at", "takeover_warning_started_at", "takeover_warning_until"):
        if not _valid_optional_control_timestamp(payload.get(field)):
            return False
    warning_started = payload.get("takeover_warning_started_at")
    warning_until = payload.get("takeover_warning_until")
    if (warning_started is None) != (warning_until is None):
        return False
    if isinstance(warning_started, str) and isinstance(warning_until, str):
        parsed_started = _parse_control_timestamp(warning_started)
        parsed_until = _parse_control_timestamp(warning_until)
        if parsed_started is None or parsed_until is None or parsed_until < parsed_started:
            return False
    warning_seconds = payload.get("takeover_warning_seconds")
    if type(warning_seconds) is not int or warning_seconds <= 0:
        return False
    if not isinstance(payload.get("takeover_alert_signal_status"), dict):
        return False
    return True


def _read_control_session_unlocked(state_dir: Path | None = None) -> dict[str, Any]:
    path = control_session_path(state_dir)
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor: int | None = None
    try:
        descriptor = os.open(path, flags)
    except FileNotFoundError:
        return annotate_control_session(default_control_session())
    except OSError:
        return _fail_closed_control_session(code="control_session_state_unreadable")
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            return _fail_closed_control_session(code="control_session_state_invalid")
        with os.fdopen(descriptor, "r", encoding="utf-8") as handle:
            descriptor = None
            raw = handle.read(CONTROL_SESSION_MAX_BYTES + 1)
    except (OSError, UnicodeError):
        return _fail_closed_control_session(code="control_session_state_unreadable")
    finally:
        if descriptor is not None:
            os.close(descriptor)
    if len(raw.encode("utf-8")) > CONTROL_SESSION_MAX_BYTES:
        return _fail_closed_control_session(code="control_session_state_invalid")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return _fail_closed_control_session(code="control_session_state_invalid")
    if not _valid_control_session_payload(payload):
        return _fail_closed_control_session(code="control_session_state_invalid", payload=payload)
    merged = default_control_session()
    merged.update(redact_value(payload))
    return annotate_control_session(merged)


def read_control_session(state_dir: Path | None = None) -> dict[str, Any]:
    with control_session_transaction(state_dir):
        return _read_control_session_unlocked(state_dir)


def _write_control_session_unlocked(payload: dict[str, Any], state_dir: Path | None = None) -> dict[str, Any]:
    root = state_dir or default_state_dir()
    root.mkdir(parents=True, exist_ok=True)
    normalized = default_control_session()
    normalized.update(payload)
    normalized.pop("ready", None)
    normalized.pop("takeover_warning", None)
    normalized.pop("state_integrity", None)
    normalized.pop("state_error_code", None)
    normalized.pop("recovery_required", None)
    if not _valid_control_session_payload(normalized):
        raise ValueError("Control-session state contains invalid persisted field types.")
    path = root / CONTROL_SESSION_FILE
    descriptor, temporary_name = tempfile.mkstemp(prefix=".control-session.", suffix=".tmp", dir=root)
    temporary_path = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(redact_value(normalized), sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
        os.chmod(path, 0o600)
    finally:
        temporary_path.unlink(missing_ok=True)
    return annotate_control_session(normalized)


def write_control_session(payload: dict[str, Any], state_dir: Path | None = None) -> dict[str, Any]:
    with control_session_transaction(state_dir):
        return _write_control_session_unlocked(payload, state_dir)


def start_control_session(
    *,
    mode: str,
    agent_label: str | None = None,
    reset_kill_switch: bool = False,
    expected_generation: int | None = None,
    state_dir: Path | None = None,
) -> dict[str, Any]:
    with control_session_transaction(state_dir):
        normalized_mode = mode if mode in CONTROL_MODES else "ask_permission"
        existing = _read_control_session_unlocked(state_dir)
        if expected_generation is not None and existing.get("generation") != expected_generation:
            raise ControlSessionChangedError("The customer Mac control session changed before start.")
        if existing.get("kill_switch") is True and not reset_kill_switch:
            raise ControlKillSwitchActiveError("The customer Mac kill switch is active.")
        now = datetime.now(timezone.utc).replace(microsecond=0)
        warning = existing.get("takeover_warning") if isinstance(existing.get("takeover_warning"), dict) else {}
        if existing.get("active") is True and warning.get("active") is True:
            warning_started = existing.get("takeover_warning_started_at")
            warning_until = existing.get("takeover_warning_until")
        else:
            warning_started = now.isoformat().replace("+00:00", "Z")
            warning_until = (now + timedelta(seconds=TAKEOVER_WARNING_SECONDS)).isoformat().replace("+00:00", "Z")
        return _write_control_session_unlocked(
            {
                "active": True,
                "generation": int(existing.get("generation", 0)) + 1,
                "mode": normalized_mode,
                "agent_label": agent_label.strip()[:160]
                if isinstance(agent_label, str) and agent_label.strip()
                else None,
                "started_at": now.isoformat().replace("+00:00", "Z"),
                "stopped_at": None,
                "kill_switch": False,
                "takeover_warning_started_at": warning_started,
                "takeover_warning_until": warning_until,
                "takeover_warning_seconds": TAKEOVER_WARNING_SECONDS,
            },
            state_dir=state_dir,
        )


def stop_control_session(state_dir: Path | None = None) -> dict[str, Any]:
    with control_session_transaction(state_dir):
        session = _read_control_session_unlocked(state_dir)
        session["active"] = False
        session["generation"] = int(session.get("generation", 0)) + 1
        session["stopped_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        session["takeover_warning_started_at"] = None
        session["takeover_warning_until"] = None
        return _write_control_session_unlocked(session, state_dir=state_dir)


def kill_control_session(state_dir: Path | None = None) -> dict[str, Any]:
    with control_session_transaction(state_dir):
        session = _read_control_session_unlocked(state_dir)
        session["active"] = False
        session["generation"] = int(session.get("generation", 0)) + 1
        session["stopped_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        session["kill_switch"] = True
        session["takeover_warning_started_at"] = None
        session["takeover_warning_until"] = None
        return _write_control_session_unlocked(session, state_dir=state_dir)


def merge_takeover_signal_status(
    *,
    expected_generation: int,
    signal_status: dict[str, Any],
    state_dir: Path | None = None,
) -> tuple[dict[str, Any], bool]:
    with control_session_transaction(state_dir):
        session = _read_control_session_unlocked(state_dir)
        if (
            session.get("generation") != expected_generation
            or session.get("active") is not True
            or session.get("kill_switch") is True
        ):
            return session, False
        session["takeover_alert_signal_status"] = redact_value(signal_status)
        return _write_control_session_unlocked(session, state_dir=state_dir), True


def annotate_control_session(session: dict[str, Any]) -> dict[str, Any]:
    session = dict(session)
    warning = takeover_warning_state(session)
    signal_status = session.get("takeover_alert_signal_status")
    if isinstance(signal_status, dict):
        warning["signal_status"] = signal_status
    session["takeover_warning"] = warning
    session["ready"] = bool(session.get("active")) and not bool(session.get("kill_switch")) and not warning["active"]
    return session


def takeover_warning_state(session: dict[str, Any]) -> dict[str, Any]:
    seconds = TAKEOVER_WARNING_SECONDS
    raw_seconds = session.get("takeover_warning_seconds")
    if isinstance(raw_seconds, int) and raw_seconds > 0:
        seconds = raw_seconds
    started_at = session.get("takeover_warning_started_at")
    until = session.get("takeover_warning_until")
    if not session.get("active") or not isinstance(until, str) or not until.strip():
        return {
            "active": False,
            "seconds": seconds,
            "remaining_seconds": 0,
            "started_at": started_at if isinstance(started_at, str) else None,
            "until": until if isinstance(until, str) else None,
        }
    parsed = _parse_control_timestamp(until)
    if parsed is None:
        return {
            "active": False,
            "seconds": seconds,
            "remaining_seconds": 0,
            "started_at": started_at if isinstance(started_at, str) else None,
            "until": until,
        }
    remaining = (parsed - datetime.now(timezone.utc)).total_seconds()
    return {
        "active": remaining > 0,
        "seconds": seconds,
        "remaining_seconds": max(0, int(remaining + 0.999)),
        "started_at": started_at if isinstance(started_at, str) else None,
        "until": until,
    }


def _parse_control_timestamp(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
