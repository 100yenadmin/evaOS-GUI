from __future__ import annotations

import hashlib
import json
import plistlib
import re
from pathlib import Path
from typing import Any

FULL_COMMIT_RE = re.compile(r"^[0-9a-fA-F]{40}$")
FULL_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
SOURCE_PROVENANCE_SCHEMA = "evaos-mac-connector-core-source/v1"
SOURCE_OWNER = "100yenadmin/evaOS-GUI"
SOURCE_PATH = "packages/mac-connector-core"
SOURCE_STATUS = "canonical"
PUBLIC_CANDIDATE_SCHEMA = "evaos.workbench.bridge_candidate.v1"


def source_tree_sha256(package_dir: str | Path) -> str:
    root = Path(package_dir).resolve()
    if not root.is_dir() or root.name != "evaos_desktop_bridge":
        raise ValueError("packaged bridge source root is invalid")

    entries: list[Path] = []
    for entry in root.rglob("*"):
        relative = entry.relative_to(root)
        if "__pycache__" in relative.parts:
            continue
        if entry.is_symlink():
            raise ValueError(f"packaged bridge source contains a symbolic link: {relative.as_posix()}")
        if entry.is_dir():
            continue
        if not entry.is_file():
            raise ValueError(f"packaged bridge source contains an unsupported entry: {relative.as_posix()}")
        entries.append(entry)

    if not entries:
        raise ValueError("packaged bridge source tree is empty")
    digest = hashlib.sha256()
    for entry in sorted(entries, key=lambda candidate: candidate.relative_to(root).as_posix()):
        digest.update(entry.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(entry.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _app_identity(package_dir: Path) -> dict[str, Any]:
    app_path = next((parent for parent in package_dir.parents if parent.name.endswith(".app")), None)
    if app_path is None:
        return {
            "app_identity_present": False,
            "app_identity_valid": None,
            "app_path": None,
            "app_version": None,
            "app_build": None,
            "app_bundle_id": None,
            "app_name": None,
        }
    info_path = app_path / "Contents" / "Info.plist"
    try:
        with info_path.open("rb") as stream:
            info = plistlib.load(stream)
    except (OSError, plistlib.InvalidFileException):
        return {
            "app_identity_present": True,
            "app_identity_valid": False,
            "app_path": str(app_path),
            "app_version": None,
            "app_build": None,
            "app_bundle_id": None,
            "app_name": None,
        }
    version = info.get("CFBundleShortVersionString")
    build = info.get("CFBundleVersion")
    bundle_id = info.get("CFBundleIdentifier")
    app_name = info.get("CFBundleName")
    return {
        "app_identity_present": True,
        "app_identity_valid": (
            str(app_path) == "/Applications/evaOS Workbench.app"
            and isinstance(version, str)
            and bool(version.strip())
            and isinstance(build, str)
            and bool(build.strip())
            and bundle_id == "com.evaos.workbench"
            and app_name == "evaOS Workbench"
        ),
        "app_path": str(app_path),
        "app_version": version if isinstance(version, str) else None,
        "app_build": build if isinstance(build, str) else None,
        "app_bundle_id": bundle_id if isinstance(bundle_id, str) else None,
        "app_name": app_name if isinstance(app_name, str) else None,
    }


def packaged_bridge_source_identity(*, module_file: str | Path = __file__) -> dict[str, Any]:
    module_path = Path(module_file).resolve()
    package_dir = module_path.parent.parent
    manifest_path = package_dir.parents[1] / "manifest.json"
    result: dict[str, Any] = {
        "ok": False,
        "manifest_path": str(manifest_path),
        **_app_identity(package_dir),
    }
    if package_dir.name != "evaos_desktop_bridge":
        result["reason"] = "packaged_bridge_source_root_invalid"
        return result
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        result["reason"] = "packaged_bridge_manifest_unavailable"
        return result

    provenance = manifest.get("sourceProvenance") if isinstance(manifest.get("sourceProvenance"), dict) else {}
    try:
        actual_source_sha256 = source_tree_sha256(package_dir)
    except (OSError, ValueError):
        result["reason"] = "packaged_bridge_source_tree_invalid"
        return result

    result.update(
        {
            "source_commit": manifest.get("sourceCommit"),
            "requested_source_ref": manifest.get("requestedSourceRef"),
            "source_path": manifest.get("sourcePath"),
            "source_sha256": provenance.get("sourceSha256"),
            "actual_source_sha256": actual_source_sha256,
            "owner": provenance.get("owner"),
            "status": provenance.get("status"),
            "imported_commit": provenance.get("importedCommit"),
        }
    )
    manifest_identity_valid = (
        manifest.get("placeholder") is False
        and FULL_COMMIT_RE.fullmatch(str(manifest.get("sourceCommit") or "")) is not None
        and manifest.get("requestedSourceRef") == manifest.get("sourceCommit")
        and manifest.get("sourcePath") == SOURCE_PATH
        and provenance.get("schema") == SOURCE_PROVENANCE_SCHEMA
        and provenance.get("owner") == SOURCE_OWNER
        and provenance.get("status") == SOURCE_STATUS
        and FULL_COMMIT_RE.fullmatch(str(provenance.get("importedCommit") or "")) is not None
        and FULL_SHA256_RE.fullmatch(str(provenance.get("sourceSha256") or "")) is not None
    )
    source_integrity_valid = provenance.get("sourceSha256") == actual_source_sha256
    app_identity_valid = result["app_identity_valid"] is not False
    result["manifest_identity_valid"] = manifest_identity_valid
    result["source_integrity_valid"] = source_integrity_valid
    result["ok"] = manifest_identity_valid and source_integrity_valid and app_identity_valid
    if result["ok"] is not True:
        if not manifest_identity_valid:
            result["reason"] = "packaged_bridge_manifest_identity_mismatch"
        elif not source_integrity_valid:
            result["reason"] = "packaged_bridge_source_integrity_mismatch"
        else:
            result["reason"] = "packaged_workbench_app_identity_mismatch"
    return result


def packaged_bridge_source_binding(
    expected_source_commit: str,
    *,
    module_file: str | Path = __file__,
) -> dict[str, Any]:
    expected = str(expected_source_commit or "").strip()
    identity = packaged_bridge_source_identity(module_file=module_file)
    result = {**identity, "expected_source_commit": expected}
    if FULL_COMMIT_RE.fullmatch(expected) is None:
        result["ok"] = False
        result["reason"] = "expected_source_commit_invalid"
        return result
    result["ok"] = (
        identity.get("ok") is True
        and identity.get("source_commit") == expected
        and identity.get("requested_source_ref") == expected
    )
    if result["ok"] is not True and identity.get("ok") is True:
        result["reason"] = "packaged_bridge_source_binding_mismatch"
    return result


def public_packaged_bridge_candidate(*, module_file: str | Path = __file__) -> dict[str, Any]:
    identity = packaged_bridge_source_identity(module_file=module_file)
    return {
        "schema": PUBLIC_CANDIDATE_SCHEMA,
        "ok": identity.get("ok") is True,
        "reason": identity.get("reason"),
        "source_commit": identity.get("source_commit"),
        "source_sha256": identity.get("actual_source_sha256"),
        "source_path": identity.get("source_path"),
        "owner": identity.get("owner"),
        "status": identity.get("status"),
        "app_path": identity.get("app_path"),
        "app_version": identity.get("app_version"),
        "app_build": identity.get("app_build"),
        "app_bundle_id": identity.get("app_bundle_id"),
        "app_name": identity.get("app_name"),
    }
