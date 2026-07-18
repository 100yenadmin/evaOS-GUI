#!/usr/bin/env python3
"""One-request adapter boundary for the native Mac Access helper."""

from __future__ import annotations

import json
import math
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any

MAX_INPUT_BYTES = 64 * 1024
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
CAPABILITIES = {
    "customer_mac.desktop_see",
    "customer_mac.desktop_click",
    "customer_mac.desktop_type",
    "customer_mac.desktop_scroll",
}
ERROR_CODE_RE = re.compile(r"[^a-z0-9_.-]+")


class RequestError(ValueError):
    pass


def _bounded_integer(value: Any, *, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise RequestError(f"{name}_invalid")
    return value


def _click_coordinates(x: Any, y: Any) -> tuple[int, int]:
    if isinstance(x, int) and not isinstance(x, bool):
        return (
            _bounded_integer(x, name="x", minimum=-20_000, maximum=20_000),
            _bounded_integer(y, name="y", minimum=-20_000, maximum=20_000),
        )
    if (
        isinstance(x, float)
        and isinstance(y, float)
        and math.isfinite(x)
        and math.isfinite(y)
        and 0 <= x <= 1
        and 0 <= y <= 1
    ):
        try:
            import Quartz  # noqa: PLC0415

            bounds = Quartz.CGDisplayBounds(Quartz.CGMainDisplayID())
            width = int(bounds.size.width)
            height = int(bounds.size.height)
            if width < 1 or height < 1:
                raise RequestError("display_bounds_unavailable")
            return (
                int(round(bounds.origin.x + x * (width - 1))),
                int(round(bounds.origin.y + y * (height - 1))),
            )
        except RequestError:
            raise
        except Exception as error:
            raise RequestError("display_bounds_unavailable") from error
    raise RequestError("x_invalid")


def _optional_string(value: Any, *, name: str, maximum: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise RequestError(f"{name}_invalid")
    return value


def _exact_keys(request: dict[str, Any], allowed: set[str]) -> None:
    if not set(request).issubset(allowed):
        raise RequestError("request_fields_invalid")


def normalized_call(capability: str, request: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    if capability not in CAPABILITIES:
        raise RequestError("capability_unsupported")
    if not isinstance(request, dict):
        raise RequestError("request_invalid")

    if capability == "customer_mac.desktop_see":
        _exact_keys(request, {"max_chars", "max_nodes"})
        return "desktop_see", {
            "max_chars": _bounded_integer(
                request.get("max_chars", 4000), name="max_chars", minimum=256, maximum=20_000
            ),
            "max_nodes": _bounded_integer(
                request.get("max_nodes", 200), name="max_nodes", minimum=1, maximum=500
            ),
        }

    if capability == "customer_mac.desktop_click":
        _exact_keys(request, {"target_label", "x", "y", "snapshot_id", "element_id", "dry_run"})
        x = request.get("x")
        y = request.get("y")
        if (x is None) != (y is None):
            raise RequestError("coordinates_incomplete")
        if x is not None:
            x, y = _click_coordinates(x, y)
        target_label = _optional_string(request.get("target_label"), name="target_label", maximum=256)
        snapshot_id = _optional_string(request.get("snapshot_id"), name="snapshot_id", maximum=128)
        element_id = _optional_string(request.get("element_id"), name="element_id", maximum=128)
        if target_label is None and x is None and element_id is None:
            raise RequestError("desktop_click_target_required")
        dry_run = request.get("dry_run", False)
        if not isinstance(dry_run, bool):
            raise RequestError("dry_run_invalid")
        return "desktop_click", {
            "target_label": target_label,
            "x": x,
            "y": y,
            "snapshot_id": snapshot_id,
            "element_id": element_id,
            "dry_run": dry_run,
        }

    if capability == "customer_mac.desktop_type":
        _exact_keys(request, {"text", "dry_run"})
        text = request.get("text")
        if not isinstance(text, str) or not text or len(text) > 4000:
            raise RequestError("desktop_text_invalid")
        dry_run = request.get("dry_run", False)
        if not isinstance(dry_run, bool):
            raise RequestError("dry_run_invalid")
        return "desktop_type", {"text": text, "dry_run": dry_run}

    _exact_keys(request, {"direction", "amount", "dry_run"})
    direction = request.get("direction", "down")
    if direction not in {"up", "down", "left", "right"}:
        raise RequestError("desktop_scroll_direction_invalid")
    dry_run = request.get("dry_run", False)
    if not isinstance(dry_run, bool):
        raise RequestError("dry_run_invalid")
    return "desktop_scroll", {
        "direction": direction,
        "amount": _bounded_integer(
            request.get("amount", 600), name="amount", minimum=1, maximum=5000
        ),
        "dry_run": dry_run,
    }


def _safe_error_code(value: Any, fallback: str) -> str:
    normalized = ERROR_CODE_RE.sub("_", str(value or fallback).strip().lower()).strip("_.-")
    return (normalized or fallback)[:96]


def _runtime_error_code(error: Exception) -> str:
    return _safe_error_code(
        f"adapter_runtime_{type(error).__name__}",
        "adapter_runtime_failed",
    )


def execute(payload: dict[str, Any]) -> dict[str, Any]:
    audit_id = f"mac-access-{uuid.uuid4()}"
    try:
        if set(payload) != {"capability", "request"}:
            raise RequestError("envelope_invalid")
        capability = payload["capability"]
        if not isinstance(capability, str):
            raise RequestError("capability_invalid")
        method_name, arguments = normalized_call(capability, payload["request"])

        source_root = Path(os.environ["EVAOS_MAC_ACCESS_BRIDGE_SOURCE"]).resolve()
        state_dir = Path(os.environ["EVAOS_MAC_ACCESS_STATE_DIR"]).resolve()
        cua_driver = Path(os.environ["EVAOS_MAC_ACCESS_CUA_DRIVER_BIN"]).resolve()
        if not source_root.is_dir() or not state_dir.is_dir() or not cua_driver.is_file():
            raise RequestError("runtime_unavailable")

        sys.path.insert(0, str(source_root))
        from evaos_desktop_bridge.adapters.customer_mac import (  # noqa: PLC0415
            CuaDriverMcpClient,
            CustomerMacObserver,
        )

        os.environ["CUA_DRIVER_EMBEDDED"] = "1"
        os.environ["EVAOS_DESKTOP_BRIDGE_CUA_ACTIONS"] = "1"
        observer = CustomerMacObserver(
            state_dir=state_dir,
            cua_driver_client=CuaDriverMcpClient(str(cua_driver)),
        )
        result = getattr(observer, method_name)(**arguments)
        error_code = None
        if not result.ok:
            first_error = result.errors[0] if result.errors else {}
            error_code = _safe_error_code(first_error.get("code"), "adapter_failed")
        return {
            "schema_version": "evaos.mac_access.adapter_result.v1",
            "audit_id": audit_id,
            "ok": bool(result.ok),
            "error_code": error_code,
            "data": result.data,
            "warnings": result.warnings,
            "errors": result.errors,
            "provenance": result.provenance,
        }
    except RequestError as error:
        return {
            "schema_version": "evaos.mac_access.adapter_result.v1",
            "audit_id": audit_id,
            "ok": False,
            "error_code": _safe_error_code(error, "request_invalid"),
            "data": {},
            "warnings": [],
            "errors": [],
            "provenance": {},
        }
    except Exception as error:
        return {
            "schema_version": "evaos.mac_access.adapter_result.v1",
            "audit_id": audit_id,
            "ok": False,
            "error_code": _runtime_error_code(error),
            "data": {},
            "warnings": [],
            "errors": [],
            "provenance": {},
        }


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        output = execute({"invalid": True})
        output["error_code"] = "request_too_large"
    else:
        try:
            payload = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            payload = {"invalid": True}
        output = execute(payload) if isinstance(payload, dict) else execute({"invalid": True})

    encoded = json.dumps(output, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    if len(encoded) > MAX_OUTPUT_BYTES:
        encoded = json.dumps(
            {
                "schema_version": "evaos.mac_access.adapter_result.v1",
                "audit_id": output["audit_id"],
                "ok": False,
                "error_code": "result_too_large",
                "data": {},
                "warnings": [],
                "errors": [],
                "provenance": {},
            },
            separators=(",", ":"),
        ).encode("utf-8")
    sys.stdout.buffer.write(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
