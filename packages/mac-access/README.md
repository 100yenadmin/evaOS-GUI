# evaOS Mac Access

`packages/mac-access` is the standalone native macOS 15 menu-bar product for issue
[#701](https://github.com/100yenadmin/evaOS-GUI/issues/701). It builds and tests without
`packages/desktop`, Workbench, backend access, Homebrew, or a customer-managed Python runtime.

The issue #702 helper-owned pairing and relay transport slice is now present in source and remains
fail closed at the application boundary:

- fresh launch is unpaired, `Off`, and `Blocked`;
- onboarding accepts the public 12-character pairing-code shape and carries it through the typed
  controller action to the embedded helper over a fixed, bounded XPC protocol;
- both XPC peers pin frozen designated requirements with `NSXPCConnection` code-signing checks;
  only the signed app and connector requirements are accepted by the helper, and the app pins the
  signed helper requirement;
- the helper owns Ed25519 installation-key creation, exact dashboard redemption proof bytes,
  device-only nonsynchronizable generic-password Keychain custody, the selected 11-field binding,
  and the opaque relay credential;
- the helper relay client permits only outbound `wss` at `/mac-access-relay/v1`, registers the
  stored credential, verifies a command-authority signature and an independently pinned execution
  context, enforces binding/digest/expiry and binding-scoped replay limits, canonicalizes signed
  values with RFC 8785 JCS, invokes one injected
  executor, and returns one structured receipt;
- the production executor invokes the existing evaOS `CustomerMacObserver` through a one-request,
  bounded private Python runner; it accepts only `desktop_see`, `desktop_click`, `desktop_type`,
  and `desktop_scroll`, and uses the bundled CuaDriver MCP implementation in embedded mode so the
  helper remains the host identity;
- Release builds require the pinned private CPython/PyObjC runtime and pinned CuaDriver binary as
  build inputs, then embed both under the helper resources; the installed product does not use a
  system/Homebrew Python or a separately installed CuaDriver;
- local stop closes the channel, clears current work, and preserves the paired helper credential;
  local revoke and an authenticated relay `grant_revoked` additionally erase that credential,
  while other relay closure reasons preserve pairing for recovery;
- unavailable authority actions are disabled or return a typed blocker;
- emergency stop synchronously latches local `Off`, issues one helper stop, and remains latched if
  helper cleanup fails;
- quit records cleanup intent and requests an orderly local stop before termination;
- no application UI authority state is persisted, so relaunch cannot restore `Full Access`;
- the helper applies literal `Off`, `Ask Every Time`, and `Full Access` policy before execution;
  `Off` returns a denied receipt without actuation, `Ask Every Time` requires one uncached approval
  from the running signed app, and `Full Access` permits the four bounded CUA capabilities;
- the relay returns bounded redacted receipts with bounded observation/action result payloads; and
- the installed binary exposes `setup`, status, permissions, pairing, connect/disconnect, literal
  modes, stop, unpair, and revoke through a same-user local CLI routed to the running app-owned
  helper, so separate CLI invocations operate one authoritative connector session.

Updater, rollback, Workbench integration, public distribution, and rollout remain deferred from the
installed internal-alpha gate.

The source contract is pinned to dashboard #669 and evaos-ws-proxy #73. Production composition
still requires deployment-owned values that those wire responses intentionally do not contain: the
relay host URL, pinned command-authority public key, and pinned execution-context public keys. No
direct-network, guessed endpoint/key, token, or Workbench fallback is provided. `MacAccessConnector`
remains inert. Missing deployment inputs return a redacted typed blocker over XPC.

Binding-scoped replay protection and the revocation fail-closed latch are currently helper-process
memory only. Durable replay/authority persistence across a helper restart remains acceptance work
for issues #702/#703, so this draft does not close issue #702.

## Private runtime inputs

The customer artifact embeds its own runtime. Prepare the pinned build inputs into an environment
file, source it in the same shell, and then build:

```bash
RUNNER_TEMP=/absolute/cache scripts/prepareEvaosDesktopBridgePythonRuntime.sh arm64 /absolute/runtime.env
RUNNER_TEMP=/absolute/cache packages/mac-access/scripts/prepare-cua-driver.sh /absolute/runtime.env
```

The CuaDriver archive is the upstream MIT-licensed `cua-driver-rs-v0.7.1` universal macOS binary.
Its release checksum and license are pinned by the package scripts and resources.

## Local proof

```bash
packages/mac-access/scripts/build-and-test.sh
```

The script runs the frozen-identity contract check, an unsigned clean build, hostless pure Swift
tests, and exact nested-bundle verification. `CODE_SIGNING_ALLOWED=NO` is deliberate. Passing this
proves source/local build and bundle shape only. It does **not** prove Developer ID signing,
designated-requirement enforcement, notarization, stapling, SMAppService registration, TCC
attribution, production pairing/relay reachability, live Computer Use, update, release, or customer
readiness.

The native catalog reserves all 12 repository locales without `jq` or Homebrew. English is the only
completed translation in this draft; non-English units are explicitly `needs_review` and cannot be
reported as translated by the validation script.

## Installed local CLI

The signed app must remain installed at `/Applications/evaOS Mac Access.app`. The CLI launches the
menu-bar app when needed and routes each request to that running app over a bounded same-user Unix
socket; it does not start an independent helper session.

```bash
MAC_ACCESS="/Applications/evaOS Mac Access.app/Contents/MacOS/evaOS Mac Access"
"$MAC_ACCESS" setup --json
"$MAC_ACCESS" status --json
"$MAC_ACCESS" mode full --json
"$MAC_ACCESS" connect --json
"$MAC_ACCESS" stop --json
```

Pairing codes are accepted only on standard input:

```bash
printf '%s\n' 'PUBLICCODE12' | "$MAC_ACCESS" pair --code-stdin --json
```
