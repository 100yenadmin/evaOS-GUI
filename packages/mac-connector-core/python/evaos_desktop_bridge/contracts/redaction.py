from __future__ import annotations

import re
from pathlib import Path
from typing import Any

SECRET_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9_-]{10,}"),
    re.compile(r"(Bearer\s+)[A-Za-z0-9._-]{10,}", re.IGNORECASE),
    re.compile(r"(?i)(authorization:\s*)[^\s]+"),
)
GENERIC_HOME_PATTERN = re.compile(r"/Users/[^/\s]+")
AUDIT_URL_PATTERN = re.compile(r"https?://[^\s)'\"<>]+", re.IGNORECASE)
AUDIT_IPV4_PATTERN = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b")
AUDIT_IPV6_PATTERN = re.compile(r"\b(?:[A-Fa-f0-9]{0,4}:){2,}[A-Fa-f0-9]{0,4}\b")
AUDIT_TEMP_PATH_PATTERN = re.compile(r"(?:/private)?/(?:var/folders|tmp)/[^\s)'\"<>]+")
AUDIT_RFC3339_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")
AUDIT_SENSITIVE_KEYS = frozenset(
    {
        "auth_key",
        "authorization",
        "connector_url",
        "customer_id",
        "error",
        "guidance",
        "login_server",
        "message",
        "message_file",
        "message_preview",
        "pairing_code",
        "password",
        "prompt",
        "recipient_context",
        "selected_visible_target_id",
        "setup_prompt",
        "target_label",
        "temp_path",
        "text",
        "thread_id",
        "token",
        "url",
        "value",
        "value_file",
        "warning",
        "warnings",
        "stderr",
        "stdout",
    }
)


def cap_text(text: str | None, max_chars: int) -> tuple[str | None, bool]:
    if text is None:
        return None, False
    if max_chars < 0:
        max_chars = 0
    if len(text) <= max_chars:
        return text, False
    return text[:max_chars], True


def redact_string(value: str) -> str:
    redacted = value.replace(str(Path.home()), "~")
    redacted = GENERIC_HOME_PATTERN.sub("~", redacted)
    redacted = SECRET_PATTERNS[0].sub("<redacted-secret>", redacted)
    redacted = SECRET_PATTERNS[1].sub(r"\1<redacted-secret>", redacted)
    redacted = SECRET_PATTERNS[2].sub(r"\1<redacted-secret>", redacted)
    return redacted


def redact_value(value: Any) -> Any:
    if isinstance(value, str):
        return redact_string(value)
    if isinstance(value, Path):
        return redact_string(str(value))
    if isinstance(value, dict):
        return {str(key): redact_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    if isinstance(value, tuple):
        return [redact_value(item) for item in value]
    return value


def redact_audit_string(value: str) -> str:
    redacted = redact_string(value)
    redacted = AUDIT_URL_PATTERN.sub("<redacted-url>", redacted)
    redacted = AUDIT_IPV4_PATTERN.sub("<redacted-ip>", redacted)
    redacted = AUDIT_IPV6_PATTERN.sub("<redacted-ip>", redacted)
    redacted = AUDIT_TEMP_PATH_PATTERN.sub("<redacted-path>", redacted)
    return redacted


def _audit_key_is_sensitive(key: str | None) -> bool:
    if not key:
        return False
    normalized = key.strip().lower()
    if normalized.endswith("_hash") or normalized.endswith("_sha256"):
        return False
    return (
        normalized in AUDIT_SENSITIVE_KEYS
        or normalized.endswith("_token")
        or normalized.endswith("_secret")
        or normalized.endswith("_password")
        or normalized.endswith("_url")
        or normalized.endswith("_ip")
        or normalized.endswith("_path")
    )


def redact_audit_value(value: Any, *, key: str | None = None) -> Any:
    if key == "warnings" and isinstance(value, (list, tuple)):
        return [redact_audit_value(item, key="warning") for item in value]
    if key == "timestamp" and isinstance(value, str) and AUDIT_RFC3339_PATTERN.fullmatch(value):
        return value
    if _audit_key_is_sensitive(key):
        return "<redacted>" if value is not None else None
    if isinstance(value, str):
        return redact_audit_string(value)
    if isinstance(value, Path):
        return redact_audit_string(str(value))
    if isinstance(value, dict):
        return {str(item_key): redact_audit_value(item, key=str(item_key)) for item_key, item in value.items()}
    if isinstance(value, list):
        return [redact_audit_value(item) for item in value]
    if isinstance(value, tuple):
        return [redact_audit_value(item) for item in value]
    return value


def audit_value_is_redacted(value: Any, *, key: str | None = None) -> bool:
    if _audit_key_is_sensitive(key):
        return value is None or value == "<redacted>"
    if isinstance(value, str):
        return AUDIT_RFC3339_PATTERN.fullmatch(value) is not None or redact_audit_string(value) == value
    if isinstance(value, Path):
        return False
    if isinstance(value, dict):
        return all(audit_value_is_redacted(item, key=str(item_key)) for item_key, item in value.items())
    if isinstance(value, (list, tuple)):
        return all(audit_value_is_redacted(item) for item in value)
    return True
