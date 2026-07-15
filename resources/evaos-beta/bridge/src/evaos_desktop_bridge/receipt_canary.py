from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .audit import default_state_dir
from .state import read_audit_record

REQUEST_SCHEMA = "evaos.mac_control.canary_request.v1"
CONTEXT_SCHEMA = "evaos.mac_control_execution_context.v1"
RECEIPT_SCHEMA = "evaos.mac_control.runtime_receipt.v1"
RECEIPT_ENVELOPE_SCHEMA = "evaos.mac_control.runtime_receipt_envelope.v1"
RECEIPT_NAMESPACE = "evaos-mac-control-receipt-v1"
RECEIPT_BUNDLE_SCHEMA = "evaos.mac_control.runtime_receipt_bundle.v2"
PUBLIC_ATTESTATION_SCHEMA = "evaos.mac_control.public_runtime_attestation.v1"
PUBLIC_ATTESTATION_ENVELOPE_SCHEMA = (
    "evaos.mac_control.public_runtime_attestation_envelope.v1"
)
PUBLIC_ATTESTATION_NAMESPACE = "evaos-mac-control-public-attestation-v1"
NATIVE_VERIFIER_NAME = "evaos-ed25519-verify"
REPLAY_FILE = "mac-control-canary-replay.jsonl"
MAX_CONTEXT_BYTES = 64 * 1024
MAX_CONTEXT_AGE_SECONDS = 60
MAX_FUTURE_SKEW_SECONDS = 5

_TOKEN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_CHALLENGE_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_AUDIT_ID_RE = re.compile(r"^audit-[0-9A-Za-z_-]{8,128}$")
_CONTEXT_FIELDS = frozenset(
    {
        "schema_version",
        "key_id",
        "runtime",
        "customer_id",
        "customer_vm_id",
        "binding_id",
        "binding_version",
        "issued_at",
        "expires_at",
        "context_id",
    }
)
_REQUEST_FIELDS = frozenset(
    {"schema", "challenge", "runRef", "executionContext", "binding"}
)
_SIGNED_CONTEXT_FIELDS = frozenset({"payload", "signature", "keyId"})
_BINDING_FIELDS = frozenset({"bindingId", "bindingVersion", "bindingExpiresAt"})


class CanaryError(RuntimeError):
    def __init__(self, code: str, *, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class CanaryConfig:
    context_key_id: str
    context_public_key: bytes
    receipt_key_id: str
    receipt_private_key: Path


def load_canary_config(env: dict[str, str] | None = None) -> CanaryConfig:
    source = os.environ if env is None else env

    def required(name: str) -> str:
        value = str(source.get(name) or "").strip()
        if not value:
            raise CanaryError("canary_config_unavailable", status=503)
        return value

    context_key_id = required("EVAOS_MAC_CONTROL_CONTEXT_KEY_ID")
    receipt_key_id = required("EVAOS_MAC_CONTROL_RECEIPT_KEY_ID")
    if not _TOKEN_RE.fullmatch(context_key_id) or not _TOKEN_RE.fullmatch(
        receipt_key_id
    ):
        raise CanaryError("canary_config_invalid", status=503)
    try:
        public_key = _base64url_decode(required("EVAOS_MAC_CONTROL_CONTEXT_PUBLIC_KEY"))
    except CanaryError as exc:
        raise CanaryError("canary_config_invalid", status=503) from exc
    if len(public_key) != 32:
        raise CanaryError("canary_config_invalid", status=503)
    return CanaryConfig(
        context_key_id=context_key_id,
        context_public_key=public_key,
        receipt_key_id=receipt_key_id,
        receipt_private_key=Path(
            required("EVAOS_MAC_CONTROL_RECEIPT_PRIVATE_KEY_PATH")
        ),
    )


def native_verifier_path(*, module_file: str | Path = __file__) -> Path:
    package_dir = Path(module_file).resolve().parent
    return package_dir.parents[1] / "bin" / NATIVE_VERIFIER_NAME


def verify_execution_context_signature(
    *,
    public_key: bytes,
    message: bytes,
    signature: bytes,
    module_file: str | Path = __file__,
    run_process: Callable[..., subprocess.CompletedProcess[bytes]] = subprocess.run,
) -> None:
    if (
        len(public_key) != 32
        or len(message) > MAX_CONTEXT_BYTES
        or len(signature) != 64
    ):
        raise CanaryError("execution_context_invalid")
    helper = native_verifier_path(module_file=module_file)
    try:
        metadata = helper.lstat()
    except OSError as exc:
        raise CanaryError("execution_context_verifier_unavailable", status=503) from exc
    if (
        helper.is_symlink()
        or not stat.S_ISREG(metadata.st_mode)
        or not os.access(helper, os.X_OK)
    ):
        raise CanaryError("execution_context_verifier_unavailable", status=503)
    request = json.dumps(
        {
            "publicKey": base64.b64encode(public_key).decode("ascii"),
            "message": base64.b64encode(message).decode("ascii"),
            "signature": base64.b64encode(signature).decode("ascii"),
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("ascii")
    try:
        result = run_process(
            [str(helper)],
            input=request,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=3,
            check=False,
            env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
            close_fds=True,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise CanaryError("execution_context_verifier_unavailable", status=503) from exc
    if result.returncode == 0:
        return
    if result.returncode == 3:
        raise CanaryError("execution_context_signature_invalid", status=403)
    if result.returncode == 2:
        raise CanaryError("execution_context_invalid")
    raise CanaryError("execution_context_verifier_unavailable", status=503)


def validate_canary_request(
    payload: dict[str, Any],
    config: CanaryConfig,
    *,
    now: datetime | None = None,
    signature_verifier: Callable[..., None] = verify_execution_context_signature,
) -> tuple[dict[str, Any], bytes, bytes]:
    if set(payload) != _REQUEST_FIELDS or payload.get("schema") != REQUEST_SCHEMA:
        raise CanaryError("canary_request_invalid")
    _bounded_token(payload.get("challenge"), _CHALLENGE_RE, "canary_challenge_invalid")
    _bounded_token(payload.get("runRef"), _TOKEN_RE, "canary_run_ref_invalid")
    signed = payload.get("executionContext")
    binding = payload.get("binding")
    if not isinstance(signed, dict) or set(signed) != _SIGNED_CONTEXT_FIELDS:
        raise CanaryError("execution_context_invalid")
    if not isinstance(binding, dict) or set(binding) != _BINDING_FIELDS:
        raise CanaryError("canary_binding_invalid", status=403)
    if signed.get("keyId") != config.context_key_id:
        raise CanaryError("execution_context_key_mismatch", status=403)
    try:
        raw_context = _base64url_decode(str(signed.get("payload") or ""))
        signature = _base64url_decode(str(signed.get("signature") or ""))
    except CanaryError as exc:
        raise CanaryError("execution_context_invalid") from exc
    if not raw_context or len(raw_context) > MAX_CONTEXT_BYTES or len(signature) != 64:
        raise CanaryError("execution_context_invalid")
    signature_verifier(
        public_key=config.context_public_key, message=raw_context, signature=signature
    )
    try:
        context = json.loads(raw_context.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CanaryError("execution_context_invalid") from exc
    if not isinstance(context, dict) or set(context) != _CONTEXT_FIELDS:
        raise CanaryError("execution_context_invalid")
    if (
        context.get("schema_version") != CONTEXT_SCHEMA
        or context.get("key_id") != config.context_key_id
        or context.get("runtime") != "openclaw"
    ):
        raise CanaryError("execution_context_mismatch", status=403)
    for field in (
        "customer_id",
        "customer_vm_id",
        "binding_id",
        "binding_version",
        "context_id",
    ):
        _bounded_identifier(context.get(field), "execution_context_invalid", 256)
    binding_expires_at = _parse_timestamp(
        binding.get("bindingExpiresAt"), "canary_binding_invalid", status=403
    )
    if binding.get("bindingId") != context.get("binding_id") or binding.get(
        "bindingVersion"
    ) != context.get("binding_version"):
        raise CanaryError("execution_context_binding_mismatch", status=403)
    current = int((now or datetime.now(timezone.utc)).timestamp())
    issued_at = context.get("issued_at")
    expires_at = context.get("expires_at")
    if (
        isinstance(issued_at, bool)
        or not isinstance(issued_at, int)
        or isinstance(expires_at, bool)
        or not isinstance(expires_at, int)
    ):
        raise CanaryError("execution_context_invalid")
    age = current - issued_at
    if age < -MAX_FUTURE_SKEW_SECONDS or age > MAX_CONTEXT_AGE_SECONDS:
        raise CanaryError("execution_context_expired", status=403)
    if (
        expires_at <= current
        or expires_at <= issued_at
        or binding_expires_at.timestamp() <= current
        or expires_at > int(binding_expires_at.timestamp())
    ):
        raise CanaryError("execution_context_expired", status=403)
    if expires_at - issued_at > MAX_CONTEXT_AGE_SECONDS:
        raise CanaryError("execution_context_expired", status=403)
    return context, raw_context, signature


def require_canary_authority_fresh(
    context: dict[str, Any],
    binding_expires_at: Any,
    *,
    now: datetime | None = None,
) -> None:
    """Recheck short-lived authority immediately before a live Mac mutation."""
    current = int((now or datetime.now(timezone.utc)).timestamp())
    expires_at = context.get("expires_at")
    binding_expiry = _parse_timestamp(
        binding_expires_at, "canary_binding_invalid", status=403
    )
    if (
        isinstance(expires_at, bool)
        or not isinstance(expires_at, int)
        or expires_at <= current
        or binding_expiry.timestamp() <= current
        or expires_at > int(binding_expiry.timestamp())
    ):
        raise CanaryError("execution_context_expired", status=403)


def replay_digest(raw_context: bytes, signature: bytes) -> str:
    return hashlib.sha256(
        b"evaos-mac-control-context-v1\0" + raw_context + b"\0" + signature
    ).hexdigest()


def burn_replay_token(
    raw_context: bytes,
    signature: bytes,
    context_id: str,
    *,
    state_dir: Path | None = None,
) -> None:
    root = state_dir or default_state_dir()
    root.mkdir(parents=True, exist_ok=True)
    replay_path = root / REPLAY_FILE
    digest = replay_digest(raw_context, signature)
    context_id_digest = hashlib.sha256(context_id.encode("utf-8")).hexdigest()
    if replay_path.exists():
        metadata = replay_path.lstat()
        if replay_path.is_symlink() or not stat.S_ISREG(metadata.st_mode):
            raise CanaryError("canary_replay_store_unavailable", status=503)
        try:
            if metadata.st_size > 4 * 1024 * 1024:
                raise CanaryError("canary_replay_store_unavailable", status=503)
            for line in replay_path.read_text(encoding="utf-8").splitlines():
                record = json.loads(line)
                if isinstance(record, dict) and (
                    record.get("digest") == digest
                    or record.get("contextIdDigest") == context_id_digest
                ):
                    raise CanaryError("execution_context_replayed", status=409)
        except CanaryError:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise CanaryError("canary_replay_store_unavailable", status=503) from exc
    flags = (
        os.O_APPEND
        | os.O_CREAT
        | os.O_WRONLY
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        descriptor = os.open(replay_path, flags, 0o600)
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "a", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {"contextIdDigest": context_id_digest, "digest": digest},
                    sort_keys=True,
                    separators=(",", ":"),
                )
                + "\n"
            )
            handle.flush()
            os.fsync(handle.fileno())
    except OSError as exc:
        raise CanaryError("canary_replay_store_unavailable", status=503) from exc


def stable_control_state(session: dict[str, Any]) -> dict[str, Any]:
    warning = (
        session.get("takeover_warning")
        if isinstance(session.get("takeover_warning"), dict)
        else {}
    )
    generation = session.get("generation")
    return {
        "active": session.get("active") is True,
        "generation": generation
        if isinstance(generation, int) and generation >= 0
        else None,
        "killSwitch": session.get("kill_switch") is True,
        "mode": session.get("mode"),
        "ready": session.get("ready") is True,
        "takeoverActive": warning.get("active") is True,
    }


def require_canary_control_state(session: dict[str, Any]) -> dict[str, Any]:
    stable = stable_control_state(session)
    if (
        stable["active"] is not True
        or stable["ready"] is not True
        or stable["mode"] != "full_access"
        or stable["killSwitch"] is True
        or stable["takeoverActive"] is True
        or stable["generation"] is None
    ):
        raise CanaryError("canary_control_state_not_ready", status=403)
    return stable


def validate_action_audit(
    response: dict[str, Any],
    *,
    state_dir: Path | None,
    action_started_at: datetime,
) -> tuple[dict[str, Any], str]:
    audit_id = response.get("audit_id")
    if (
        response.get("ok") is not True
        or not isinstance(audit_id, str)
        or not _AUDIT_ID_RE.fullmatch(audit_id)
    ):
        raise CanaryError("canary_action_failed", status=422)
    record = read_audit_record(audit_id, state_dir=state_dir)
    if not isinstance(record, dict):
        raise CanaryError("canary_audit_missing", status=422)
    args = record.get("args")
    expected_args = {
        "approval_audit_id": None,
        "customer_mac_command": "desktop",
        "desktop_command": "hotkey",
        "dry_run": False,
        "json": True,
        "keys": "escape",
        "scope": "customer-mac",
    }
    if (
        record.get("audit_id") != audit_id
        or record.get("command") != "customer_mac.desktop_hotkey"
        or record.get("target") != "customer_mac"
        or record.get("ok") is not True
        or args != expected_args
    ):
        raise CanaryError("canary_audit_mismatch", status=422)
    timestamp = _parse_timestamp(
        record.get("timestamp"), "canary_audit_mismatch", status=422
    )
    current = datetime.now(timezone.utc)
    if timestamp < action_started_at - _seconds(5) or timestamp > current + _seconds(
        MAX_FUTURE_SKEW_SECONDS
    ):
        raise CanaryError("canary_audit_mismatch", status=422)
    digest = hashlib.sha256(_canonical_json(record)).hexdigest()
    return record, digest


def build_receipt(
    *,
    config: CanaryConfig,
    context: dict[str, Any],
    raw_context: bytes,
    challenge: str,
    run_ref: str,
    candidate: dict[str, Any],
    owner: dict[str, Any] | None,
    process: dict[str, Any],
    before: dict[str, Any],
    after: dict[str, Any],
    audit_record: dict[str, Any],
    audit_digest: str,
    executed_at: str,
    binding_expires_at: str,
) -> dict[str, Any]:
    packaged_candidate = candidate_snapshot(candidate, owner=owner, process=process)
    before_digest = hashlib.sha256(_canonical_json(before)).hexdigest()
    after_digest = hashlib.sha256(_canonical_json(after)).hexdigest()
    if before != after or before_digest != after_digest:
        raise CanaryError("canary_control_state_changed", status=409)
    binding_id = str(context["binding_id"])
    session_seed = f"{binding_id}\0{before['generation']}"
    action_args = {"keys": "escape", "dryRun": False}
    action = {"command": "customer_mac.desktop_hotkey", "args": action_args}
    return {
        "schema": RECEIPT_SCHEMA,
        "keyId": config.receipt_key_id,
        "namespace": RECEIPT_NAMESPACE,
        "executedAt": executed_at,
        "runtime": "openclaw",
        "challenge": challenge,
        "runRef": run_ref,
        "contextKeyId": config.context_key_id,
        "executionContextDigest": _salted_hash(challenge, raw_context),
        "contextRef": _salted_hash(challenge, str(context["context_id"])),
        "contextIssuedAt": context["issued_at"],
        "contextExpiresAt": context["expires_at"],
        "customerRef": _salted_hash(challenge, str(context["customer_id"])),
        "vmRef": _salted_hash(challenge, str(context["customer_vm_id"])),
        "bindingRef": _salted_hash(challenge, binding_id),
        "bindingVersion": context["binding_version"],
        "bindingExpiresAt": binding_expires_at,
        "sessionRef": _salted_hash(challenge, session_seed),
        "controlStateBefore": before,
        "controlStateAfter": after,
        "controlStateBeforeDigest": before_digest,
        "controlStateAfterDigest": after_digest,
        "candidate": packaged_candidate,
        "action": action,
        "actionArgsDigest": hashlib.sha256(_canonical_json(action_args)).hexdigest(),
        "auditId": audit_record["audit_id"],
        "auditTimestamp": audit_record.get("timestamp"),
        "auditRecordDigest": audit_digest,
    }


def sign_payload(
    payload: dict[str, Any],
    config: CanaryConfig,
    *,
    namespace: str,
    run_process: Callable[..., subprocess.CompletedProcess[bytes]] = subprocess.run,
) -> str:
    key_path, before = validate_receipt_signer_key(config)
    message = _canonical_json(payload)
    try:
        result = run_process(
            [
                "/usr/bin/ssh-keygen",
                "-Y",
                "sign",
                "-q",
                "-f",
                str(key_path),
                "-n",
                namespace,
                "-",
            ],
            input=message,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=4,
            check=False,
            env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
            close_fds=True,
        )
        after = key_path.lstat()
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise CanaryError("receipt_signer_unavailable", status=503) from exc
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    ):
        raise CanaryError("receipt_signer_unavailable", status=503)
    try:
        signature = result.stdout.decode("ascii")
    except UnicodeDecodeError as exc:
        raise CanaryError("receipt_signer_unavailable", status=503) from exc
    if (
        result.returncode != 0
        or len(signature) > 8192
        or not signature.startswith("-----BEGIN SSH SIGNATURE-----\n")
        or not signature.endswith("-----END SSH SIGNATURE-----\n")
    ):
        raise CanaryError("receipt_signer_unavailable", status=503)
    return signature


def sign_receipt(
    receipt: dict[str, Any],
    config: CanaryConfig,
    *,
    run_process: Callable[..., subprocess.CompletedProcess[bytes]] = subprocess.run,
) -> str:
    return sign_payload(
        receipt,
        config,
        namespace=RECEIPT_NAMESPACE,
        run_process=run_process,
    )


def build_public_attestation(
    receipt: dict[str, Any], config: CanaryConfig
) -> dict[str, Any]:
    candidate = receipt.get("candidate")
    if not isinstance(candidate, dict):
        raise CanaryError("receipt_public_attestation_invalid", status=503)
    private_receipt = _canonical_json(receipt)
    return {
        "schema": PUBLIC_ATTESTATION_SCHEMA,
        "keyId": config.receipt_key_id,
        "namespace": PUBLIC_ATTESTATION_NAMESPACE,
        "proofKind": "selected_binding_direct_mac_control",
        "runtime": "openclaw",
        "tool": "customer_mac.desktop_hotkey",
        "outcome": "succeeded",
        "runRef": receipt.get("runRef"),
        "executedAt": receipt.get("executedAt"),
        "authorityIssuedAt": receipt.get("contextIssuedAt"),
        "authorityExpiresAt": receipt.get("contextExpiresAt"),
        "contextKeyId": receipt.get("contextKeyId"),
        "controlState": "ready_unchanged",
        "auditRecorded": True,
        "privateReceiptSha256": hashlib.sha256(private_receipt).hexdigest(),
        "connectorCandidate": {
            "sourceCommit": candidate.get("sourceCommit"),
            "sourceSha256": candidate.get("sourceSha256"),
            "appVersion": candidate.get("appVersion"),
            "appBuild": candidate.get("appBuild"),
        },
    }


def sign_public_attestation(
    attestation: dict[str, Any],
    config: CanaryConfig,
    *,
    run_process: Callable[..., subprocess.CompletedProcess[bytes]] = subprocess.run,
) -> str:
    return sign_payload(
        attestation,
        config,
        namespace=PUBLIC_ATTESTATION_NAMESPACE,
        run_process=run_process,
    )


def validate_receipt_signer_key(config: CanaryConfig) -> tuple[Path, os.stat_result]:
    key_path = config.receipt_private_key
    if not key_path.is_absolute():
        raise CanaryError("receipt_signer_unavailable", status=503)
    try:
        parent = key_path.parent.lstat()
        before = key_path.lstat()
    except OSError as exc:
        raise CanaryError("receipt_signer_unavailable", status=503) from exc
    if (
        key_path.is_symlink()
        or key_path.parent.is_symlink()
        or not stat.S_ISREG(before.st_mode)
        or not stat.S_ISDIR(parent.st_mode)
        or before.st_uid != os.getuid()
        or parent.st_uid != os.getuid()
        or stat.S_IMODE(before.st_mode) != 0o600
        or stat.S_IMODE(parent.st_mode) & 0o077
    ):
        raise CanaryError("receipt_signer_unavailable", status=503)
    return key_path, before


def receipt_envelope(
    receipt: dict[str, Any], sshsig: str, config: CanaryConfig
) -> dict[str, Any]:
    return {
        "schema": RECEIPT_ENVELOPE_SCHEMA,
        "receiptBase64": _base64url_encode(_canonical_json(receipt)),
        "signature": sshsig,
        "keyId": config.receipt_key_id,
        "namespace": RECEIPT_NAMESPACE,
    }


def public_attestation_envelope(
    attestation: dict[str, Any], sshsig: str, config: CanaryConfig
) -> dict[str, Any]:
    return {
        "schema": PUBLIC_ATTESTATION_ENVELOPE_SCHEMA,
        "attestationBase64": _base64url_encode(_canonical_json(attestation)),
        "signature": sshsig,
        "keyId": config.receipt_key_id,
        "namespace": PUBLIC_ATTESTATION_NAMESPACE,
    }


def receipt_bundle(
    *,
    receipt: dict[str, Any],
    receipt_signature: str,
    public_attestation: dict[str, Any],
    public_signature: str,
    config: CanaryConfig,
) -> dict[str, Any]:
    return {
        "schema": RECEIPT_BUNDLE_SCHEMA,
        "privateReceipt": receipt_envelope(receipt, receipt_signature, config),
        "publicAttestation": public_attestation_envelope(
            public_attestation, public_signature, config
        ),
    }


def candidate_snapshot(
    candidate: dict[str, Any], *, owner: dict[str, Any] | None, process: dict[str, Any]
) -> dict[str, Any]:
    required_candidate = {
        "sourceCommit": candidate.get("source_commit"),
        "sourceSha256": candidate.get("source_sha256"),
        "sourcePath": candidate.get("source_path"),
        "sourceOwner": candidate.get("owner"),
        "status": candidate.get("status"),
        "appPath": candidate.get("app_path"),
        "appVersion": candidate.get("app_version"),
        "appBuild": candidate.get("app_build"),
        "appBundleId": candidate.get("app_bundle_id"),
        "appName": candidate.get("app_name"),
    }
    owner = owner if isinstance(owner, dict) else {}
    owner_program = (
        owner.get("program_path") if isinstance(owner.get("program_path"), dict) else {}
    )
    owner_app = owner.get("app_path") if isinstance(owner.get("app_path"), dict) else {}
    owner_manifest = (
        owner.get("manifest_path")
        if isinstance(owner.get("manifest_path"), dict)
        else {}
    )
    owner_plist = (
        owner.get("plist_path") if isinstance(owner.get("plist_path"), dict) else {}
    )
    executable = process.get("executable")
    argv0 = process.get("argv0")
    if (
        candidate.get("ok") is not True
        or not _COMMIT_RE.fullmatch(str(required_candidate["sourceCommit"] or ""))
        or not _SHA256_RE.fullmatch(str(required_candidate["sourceSha256"] or ""))
        or required_candidate["sourcePath"] != "resources/evaos-beta/bridge"
        or required_candidate["sourceOwner"] != "100yenadmin/evaOS-GUI"
        or required_candidate["status"] != "vendored"
        or required_candidate["appPath"] != "/Applications/evaOS Workbench.app"
        or required_candidate["appBundleId"] != "com.evaos.workbench"
        or required_candidate["appName"] != "evaOS Workbench"
        or owner.get("label") != "com.electricsheep.evaos-desktop-bridge"
        or owner.get("classification") != "workbench_bundle"
        or owner.get("bundle_id") != "com.evaos.workbench"
        or owner.get("source_commit") != required_candidate["sourceCommit"]
        or owner_program
        != {
            "kind": "path",
            "value": "/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge",
        }
        or owner_app != {"kind": "path", "value": "/Applications/evaOS Workbench.app"}
        or owner_manifest
        != {
            "kind": "path",
            "value": "/Applications/evaOS Workbench.app/Contents/Resources/Bridge/manifest.json",
        }
        or owner_plist.get("kind") != "path"
        or not isinstance(owner_plist.get("value"), str)
        or not str(owner_plist["value"]).endswith(
            "/Library/LaunchAgents/com.electricsheep.evaos-desktop-bridge.plist"
        )
        or not isinstance(executable, str)
        or not re.fullmatch(
            r"/Applications/evaOS Workbench\.app/Contents/Resources/Bridge/python/bin/python3(?:\.12)?",
            executable,
        )
        or argv0
        != "/Applications/evaOS Workbench.app/Contents/Resources/Bridge/src/evaos_desktop_bridge/cli.py"
    ):
        raise CanaryError("canary_candidate_identity_invalid", status=503)
    return {
        **required_candidate,
        "executable": executable,
        "argv0": argv0,
        "owner": {
            "label": owner.get("label"),
            "classification": owner.get("classification"),
            "bundleId": owner.get("bundle_id"),
            "sourceCommit": owner.get("source_commit"),
            "programPath": owner_program,
            "appPath": owner_app,
            "manifestPath": owner_manifest,
            "plistPath": owner_plist,
        },
    }


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def _salted_hash(challenge: str, value: str | bytes) -> str:
    raw = value if isinstance(value, bytes) else value.encode("utf-8")
    return hashlib.sha256(challenge.encode("ascii") + b"\0" + raw).hexdigest()


def _base64url_decode(value: str) -> bytes:
    if not value or "=" in value or re.fullmatch(r"[A-Za-z0-9_-]+", value) is None:
        raise CanaryError("base64url_invalid")
    try:
        return base64.b64decode(
            value + "=" * (-len(value) % 4), altchars=b"-_", validate=True
        )
    except (ValueError, binascii.Error) as exc:
        raise CanaryError("base64url_invalid") from exc


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _bounded_token(value: Any, pattern: re.Pattern[str], code: str) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise CanaryError(code)
    return value


def _bounded_identifier(value: Any, code: str, maximum: int) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value.encode("utf-8")) > maximum
        or any(ord(char) < 32 for char in value)
    ):
        raise CanaryError(code)
    return value


def _parse_timestamp(value: Any, code: str, *, status: int = 400) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise CanaryError(code, status=status)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise CanaryError(code, status=status) from exc
    if parsed.tzinfo is None:
        raise CanaryError(code, status=status)
    return parsed.astimezone(timezone.utc)


def _timestamp_now() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _seconds(value: int):
    from datetime import timedelta

    return timedelta(seconds=value)


def default_process_identity() -> dict[str, Any]:
    return {
        "executable": str(Path(sys.executable).resolve()),
        "argv0": str(Path(sys.argv[0]).resolve()) if sys.argv else None,
    }
