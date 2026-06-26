# evaOS Workbench Mac Pairing Functional Proof

Issue: #363

Use this runbook before cutting a public macOS Workbench release that changes Mac & iPhone, Mac control, bridge packaging, pairing prompts, OpenClaw/Hermes connector tools, or update metadata.

## Rule

Do not start the public notarized release loop as the first proof for Mac pairing changes.

The required order is:

1. Focused unit tests for the touched bridge, pairing, updater, and UI seams.
2. Local unpacked or development app proof with the packaged Workbench bridge path, not a Homebrew-only bridge.
3. Local OpenClaw-compatible pairing smoke using a code-only prompt.
4. VM OpenClaw pairing smoke against the selected proof customer.
5. Hermes smoke through the same connector contract.
6. Only then build, sign, notarize, staple, publish, and run installed-app proof.

## Bridge Packaging Gate

Pull request build smoke may set `EVAOS_DESKTOP_BRIDGE_ALLOW_PLACEHOLDER=1` so CI can verify Electron packaging even when the private `evaos-desktop-bridge` source is not readable from a pull request runner.

That placeholder is never release proof. Any public or signed release build must set or inherit `EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL=1` and must provide one of:

- `EVAOS_DESKTOP_BRIDGE_SOURCE_DIR` pointing at a checkout with `src/evaos_desktop_bridge/cli.py`
- `EVAOS_DESKTOP_BRIDGE_SOURCE_TOKEN` with read access to `electricsheephq/evaos-desktop-bridge`
- `EVAOS_DESKTOP_BRIDGE_SOURCE_REPO` / `EVAOS_DESKTOP_BRIDGE_SOURCE_REF` for an approved, reachable bridge source

For CI release builds, `EVAOS_DESKTOP_BRIDGE_SOURCE_REF` must be a pinned tag or commit SHA, not `main`, `master`, or `HEAD`. If those inputs are missing, mutable, or inaccessible, the release build must fail before a public artifact is created.

## Functional Acceptance

The pairing prompt must include only:

- customer target
- pairing code
- expiry
- `customer_mac_complete_pairing`
- status, capabilities, control status, see, and audit-tail smoke instructions

The prompt must not include connector URL, IP address, port, token, SSH, VNC, CDP, browser debug wording, or raw broker output.

The local and VM proof must show:

- Workbench starts Mac Access from the packaged bridge.
- Workbench creates and copies a code-only pairing prompt.
- OpenClaw can claim the code and run status/capabilities/control-status/see/audit-tail.
- Hermes can use the same connector contract.
- Full Access can start only after agent pairing proof.
- One low-impact action succeeds.
- Stop/revoke works.
- Kill switch fails closed.

## Release Acceptance

The release candidate may proceed only after the functional proof packet names:

- source SHA
- app version
- bridge path and bridge version
- selected account/customer target
- release canary account `admin@electricsheephq.com`
- release canary support VM target kind `customer_vm`
- confirmation that Golden VM stayed secretless/template-only and was not used as the authenticated product canary
- local proof result
- VM OpenClaw proof result
- Hermes proof result
- non-secret audit IDs
- updater metadata path proving macOS auto-update points to ZIP

Final release gates still require signed/notarized/stapled app and DMG, Gatekeeper accepted, updater/feed isolation, protocol isolation, installed-app smoke, support path, and rollback proof.

For the no-code first-party Mac-control flow, the release canary lane is the
support-admin account and support VM, not Golden. Required non-secret CI/runtime
metadata:

- `AIONUI_EVAOS_RELEASE_CANARY_ACCOUNT_EMAIL=admin@electricsheephq.com`
- `AIONUI_EVAOS_RELEASE_CANARY_CUSTOMER_ID=<support-vm-customer-id>`
- `AIONUI_EVAOS_RELEASE_CANARY_TARGET_KIND=customer_vm`
- `AIONUI_EVAOS_RELEASE_CANARY_TARGET_LABEL=<human-visible support VM label>`

The canary must prove New Chat receives a visible assistant response and
Mac & iPhone reaches no-code Mac-control ready from the signed installed app.
Pairing/export prompts remain an advanced support fallback only.
