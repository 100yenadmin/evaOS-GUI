from __future__ import annotations

import json
import os
import platform
import uuid
from pathlib import Path
from typing import Any

from .redaction import redact_audit_value
from .schema import SCHEMA_VERSION, timestamp_utc

STATE_DIR_ENV = "EVAOS_DESKTOP_BRIDGE_STATE_DIR"


def default_state_dir() -> Path:
    override = os.environ.get(STATE_DIR_ENV)
    if override:
        return Path(override).expanduser()
    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Application Support" / "evaos-desktop-bridge"
    return Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "evaos-desktop-bridge"


def append_audit(
    *,
    command: str,
    target: str,
    args: dict[str, Any],
    ok: bool,
    warnings: list[str],
    errors: list[dict[str, Any]],
    provenance: dict[str, Any] | None = None,
    state_dir: Path | None = None,
    audit_id: str | None = None,
) -> str:
    if audit_id is not None and (not isinstance(audit_id, str) or not audit_id.startswith("audit-")):
        raise ValueError("audit_id must start with audit-")
    record_audit_id = audit_id or f"audit-{uuid.uuid4().hex}"
    root = state_dir or default_state_dir()
    root.mkdir(parents=True, exist_ok=True)
    record = {
        "schema_version": SCHEMA_VERSION,
        "audit_id": record_audit_id,
        "timestamp": timestamp_utc(),
        "command": command,
        "target": target,
        "args": redact_audit_value(args),
        "ok": ok,
        "warnings": [redact_audit_value(warning, key="warning") for warning in warnings],
        "errors": redact_audit_value(errors),
        "provenance": redact_audit_value(provenance or {}),
    }
    audit_path = root / "audit.jsonl"
    flags = os.O_APPEND | os.O_CREAT | os.O_WRONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(audit_path, flags, 0o600)
    os.fchmod(descriptor, 0o600)
    with os.fdopen(descriptor, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")
    return record_audit_id
