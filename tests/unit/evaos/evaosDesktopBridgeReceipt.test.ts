import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const bridgeSource = join(repoRoot, 'resources', 'evaos-beta', 'bridge', 'src');

describe('evaOS signed Mac-control receipt connector', () => {
  it('fails closed around the fixed authenticated canary route and emits a verifiable sanitized receipt', () => {
    const script = String.raw`
import base64
import json
import os
import subprocess
import tempfile
import threading
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path

from evaos_desktop_bridge import connector_server, receipt_canary
from evaos_desktop_bridge.audit import append_audit

root = Path(tempfile.mkdtemp(prefix="evaos-receipt-http-"))
key_dir = root / "signer"
key_dir.mkdir(mode=0o700)
key_path = key_dir / "receipt-key"
subprocess.run(["/usr/bin/ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key_path)], check=True)
os.chmod(key_path, 0o600)

def b64url(value):
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")

os.environ.update({
    "EVAOS_MAC_CONTROL_CONTEXT_KEY_ID": "ws-proxy-context-v1",
    "EVAOS_MAC_CONTROL_CONTEXT_PUBLIC_KEY": b64url(b"p" * 32),
    "EVAOS_MAC_CONTROL_RECEIPT_KEY_ID": "staging-connector-receipt-v1",
    "EVAOS_MAC_CONTROL_RECEIPT_PRIVATE_KEY_PATH": str(key_path),
})

control = {
    "active": True,
    "generation": 7,
    "mode": "full_access",
    "agent_label": "staging-canary",
    "started_at": "2026-07-14T00:00:00Z",
    "stopped_at": None,
    "kill_switch": False,
    "takeover_warning_started_at": None,
    "takeover_warning_until": None,
    "takeover_warning_seconds": 10,
}
(root / "control-session.json").write_text(json.dumps(control), encoding="utf-8")
os.chmod(root / "control-session.json", 0o600)

signature_mode = {"forged": False}
original_validate = receipt_canary.validate_canary_request
def validate_request(payload, config):
    def verifier(**kwargs):
        if signature_mode["forged"]:
            raise receipt_canary.CanaryError("execution_context_signature_invalid", status=403)
    return original_validate(payload, config, signature_verifier=verifier)
connector_server.validate_canary_request = validate_request

candidate = {
    "ok": True,
    "source_commit": "a" * 40,
    "source_sha256": "b" * 64,
    "source_path": "resources/evaos-beta/bridge",
    "owner": "100yenadmin/evaOS-GUI",
    "status": "vendored",
    "app_path": "/Applications/evaOS Workbench.app",
    "app_version": "2.1.36",
    "app_build": "2.1.36",
    "app_bundle_id": "com.evaos.workbench",
    "app_name": "evaOS Workbench",
}
owner = {
    "label": "com.electricsheep.evaos-desktop-bridge",
    "classification": "workbench_bundle",
    "bundle_id": "com.evaos.workbench",
    "source_commit": "a" * 40,
    "program_path": {"kind": "path", "value": "/Applications/evaOS Workbench.app/Contents/Resources/Bridge/evaos-desktop-bridge"},
    "app_path": {"kind": "path", "value": "/Applications/evaOS Workbench.app"},
    "manifest_path": {"kind": "path", "value": "/Applications/evaOS Workbench.app/Contents/Resources/Bridge/manifest.json"},
    "plist_path": {"kind": "path", "value": "~/Library/LaunchAgents/com.electricsheep.evaos-desktop-bridge.plist"},
}
process = {
    "executable": "/Applications/evaOS Workbench.app/Contents/Resources/Bridge/python/bin/python3.12",
    "argv0": "/Applications/evaOS Workbench.app/Contents/Resources/Bridge/src/evaos_desktop_bridge/cli.py",
}
action_calls = []
tamper_audit = {"enabled": False}
def runner(argv):
    action_calls.append(list(argv))
    args = {
        "approval_audit_id": None,
        "customer_mac_command": "desktop",
        "desktop_command": "hotkey",
        "dry_run": False,
        "json": True,
        "keys": "cmd+l" if tamper_audit["enabled"] else "escape",
        "scope": "customer-mac",
    }
    audit_id = append_audit(
        command="customer_mac.desktop_hotkey",
        target="customer_mac",
        args=args,
        ok=True,
        warnings=[],
        errors=[],
        state_dir=root,
    )
    return 0, json.dumps({"ok": True, "audit_id": audit_id})

handler = connector_server._make_handler(
    token="connector-test-token",
    command_runner=runner,
    state_dir=root,
    owner_provider=lambda: owner,
    candidate_provider=lambda: candidate,
    process_provider=lambda: process,
)
server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
endpoint = f"http://127.0.0.1:{server.server_address[1]}/v1/canary/mac-control"

counter = 0
def payload(*, expired=False, cross_binding=False):
    global counter
    counter += 1
    now = datetime.now(timezone.utc).replace(microsecond=0)
    context = {
        "schema_version": "evaos.mac_control_execution_context.v1",
        "key_id": "ws-proxy-context-v1",
        "runtime": "openclaw",
        "customer_id": "customer-sensitive-id",
        "customer_vm_id": "vm-sensitive-id",
        "binding_id": "binding-sensitive-id",
        "binding_version": "42",
        "issued_at": (now - timedelta(seconds=180 if expired else 1)).isoformat().replace("+00:00", "Z"),
        "expires_at": (now - timedelta(seconds=1) if expired else now + timedelta(seconds=60)).isoformat().replace("+00:00", "Z"),
        "context_id": f"context-sensitive-{counter}",
    }
    raw = json.dumps(context, sort_keys=True, separators=(",", ":")).encode()
    return {
        "schema": "evaos.mac_control.canary_request.v1",
        "challenge": "C" * 32,
        "runRef": f"run-{counter}",
        "executionContext": {
            "payload": b64url(raw),
            "signature": b64url(b"s" * 64),
            "keyId": "ws-proxy-context-v1",
        },
        "binding": {
            "bindingId": "other-binding" if cross_binding else "binding-sensitive-id",
            "bindingVersion": "42",
            "bindingExpiresAt": (now + timedelta(seconds=300)).isoformat().replace("+00:00", "Z"),
        },
    }

def post(body, token="connector-test-token"):
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())

try:
    valid = payload()
    status, envelope = post(valid)
    assert status == 200, (status, envelope)
    assert action_calls == [["customer-mac", "--remote-control-generation", "7", "desktop", "hotkey", "--json", "--keys", "escape"]]
    assert envelope["schema"] == "evaos.mac_control.runtime_receipt_envelope.v1"
    assert envelope["namespace"] == "evaos-mac-control-receipt-v1"
    receipt_bytes = base64.urlsafe_b64decode(envelope["receiptBase64"] + "=" * (-len(envelope["receiptBase64"]) % 4))
    receipt = json.loads(receipt_bytes)
    assert receipt_bytes == json.dumps(receipt, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    assert receipt["action"] == {"command": "customer_mac.desktop_hotkey", "args": {"dryRun": False, "keys": "escape"}}
    assert receipt["controlStateBefore"] == receipt["controlStateAfter"]
    assert receipt["candidate"]["sourceCommit"] == "a" * 40
    serialized = json.dumps(envelope, sort_keys=True)
    for forbidden in [
        "customer-sensitive-id",
        "vm-sensitive-id",
        "binding-sensitive-id",
        "context-sensitive-1",
        "connector-test-token",
        str(key_path),
        "http://",
        "127.0.0.1",
    ]:
        assert forbidden not in serialized, forbidden

    allowed = root / "allowed_signers"
    public = (key_path.with_suffix(".pub")).read_text(encoding="utf-8").strip()
    allowed.write_text(f"evaos {public}\n", encoding="utf-8")
    signature_path = root / "receipt.sshsig"
    signature_path.write_text(envelope["signature"], encoding="ascii")
    verified = subprocess.run(
        ["/usr/bin/ssh-keygen", "-Y", "verify", "-f", str(allowed), "-I", "evaos", "-n", envelope["namespace"], "-s", str(signature_path)],
        input=receipt_bytes,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    assert verified.returncode == 0

    count = len(action_calls)
    assert post(valid)[0] == 409
    assert len(action_calls) == count
    assert post({"schema": "evaos.mac_control.canary_request.v1"})[0] == 400
    assert len(action_calls) == count
    assert post(payload(expired=True))[0] == 403
    assert len(action_calls) == count
    assert post(payload(cross_binding=True))[0] == 403
    assert len(action_calls) == count
    signature_mode["forged"] = True
    assert post(payload())[0] == 403
    signature_mode["forged"] = False
    assert len(action_calls) == count

    control["mode"] = "ask_permission"
    (root / "control-session.json").write_text(json.dumps(control), encoding="utf-8")
    assert post(payload())[0] == 403
    assert len(action_calls) == count
    control["mode"] = "full_access"
    (root / "control-session.json").write_text(json.dumps(control), encoding="utf-8")

    os.chmod(key_path, 0o644)
    assert post(payload())[0] == 503
    assert len(action_calls) == count
    os.chmod(key_path, 0o600)

    real_key_path = str(key_path)
    symlink_path = key_dir / "receipt-key-link"
    symlink_path.symlink_to(key_path)
    os.environ["EVAOS_MAC_CONTROL_RECEIPT_PRIVATE_KEY_PATH"] = str(symlink_path)
    assert post(payload())[0] == 503
    assert len(action_calls) == count
    os.environ["EVAOS_MAC_CONTROL_RECEIPT_PRIVATE_KEY_PATH"] = real_key_path

    tamper_audit["enabled"] = True
    state_before = (root / "control-session.json").read_text(encoding="utf-8")
    status, error = post(payload())
    assert status == 422 and error["error"] == "canary_audit_mismatch"
    assert len(action_calls) == count + 1
    assert (root / "control-session.json").read_text(encoding="utf-8") == state_before

    try:
        receipt_canary.verify_execution_context_signature(
            public_key=b"p" * 32,
            message=b"message",
            signature=b"s" * 64,
            module_file=root / "missing" / "src" / "evaos_desktop_bridge" / "receipt_canary.py",
        )
    except receipt_canary.CanaryError as error:
        assert error.code == "execution_context_verifier_unavailable"
    else:
        raise AssertionError("missing native verifier did not fail closed")
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)
`;

    expect(() =>
      execFileSync('python3', ['-c', script], {
        cwd: repoRoot,
        env: {
          ...process.env,
          PYTHONPATH: bridgeSource,
          PYTHONDONTWRITEBYTECODE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      })
    ).not.toThrow();
  }, 40_000);
});
