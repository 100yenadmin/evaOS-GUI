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
- the production executor returns `policy_unavailable` until issue #703 supplies the policy and
  execution slice; a fixture executor proves the single-command receipt path without granting
  production authority;
- local stop closes the channel, clears current work, and preserves the paired helper credential;
  local revoke and an authenticated relay `grant_revoked` additionally erase that credential,
  while other relay closure reasons preserve pairing for recovery;
- unavailable authority actions are disabled or return a typed blocker;
- emergency stop synchronously latches local `Off`, issues one helper stop, and remains latched if
  helper cleanup fails;
- quit records cleanup intent and requests an orderly local stop before termination;
- no application UI authority state is persisted, so relaunch cannot restore `Full Access`;
- no Computer Use, updater, or TCC implementation is present.

The source contract is pinned to dashboard #669 and evaos-ws-proxy #73. Production composition
still requires deployment-owned values that those wire responses intentionally do not contain: the
relay host URL, pinned command-authority public key, and pinned execution-context public keys. No
direct-network, guessed endpoint/key, token, or Workbench fallback is provided. `MacAccessConnector`
remains inert. Missing deployment inputs return a redacted typed blocker over XPC.

Binding-scoped replay protection and the revocation fail-closed latch are currently helper-process
memory only. Durable replay/authority persistence across a helper restart remains acceptance work
for issues #702/#703, so this draft does not close issue #702.

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

## Developer ID artifact identity

Issue #705's release scripts sign the complete embedded Mach-O closure before signing the connector,
helper, and outer app inside-out. They require a secure timestamp and hardened runtime everywhere,
apply the release Keychain entitlement only to the helper, and freeze the three designated
requirements instead of accepting bundle-ID equality.

```bash
packages/mac-access/scripts/release/sign-bundle.js sign \
  --app '/absolute/path/evaOS Mac Access.app' \
  --identity 'Developer ID Application: Andrew Ryan (TC6MS3T6NN)' \
  --keychain '/absolute/path/evaos-release-signing.keychain-db' \
  --manifest '/absolute/path/mac-access-artifact.json' \
  --sbom '/absolute/path/mac-access-sbom.spdx.json' \
  --source-sha "$(git rev-parse HEAD)"
```

The verifier recomputes the signed bundle-tree checksum, embedded core/source/runtime inventory,
SPDX dependency and license inventory, role/executable ownership, helper relationship, Team ID,
designated requirements, entitlements, hardened runtime, timestamp, architecture, and schema,
security, and credential epochs. Any drift fails closed:

```bash
packages/mac-access/scripts/release/sign-bundle.js verify \
  --app '/absolute/path/evaOS Mac Access.app' \
  --manifest '/absolute/path/mac-access-artifact.json' \
  --sbom '/absolute/path/mac-access-sbom.spdx.json'
```

These scripts do not submit to Apple, staple a ticket, publish an update feed, or prove Gatekeeper
acceptance, pristine-Mac launch, live VM control, rollback, uninstall, or customer readiness.
