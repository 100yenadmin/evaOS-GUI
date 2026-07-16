# evaOS Mac Access

`packages/mac-access` is the standalone native macOS 15 menu-bar product for issue
[#701](https://github.com/100yenadmin/evaOS-GUI/issues/701). It builds and tests without
`packages/desktop`, Workbench, backend access, Homebrew, or a customer-managed Python runtime.

This first A2 slice is intentionally local-only and fail closed:

- fresh launch is unpaired, `Off`, and `Blocked`;
- the menu exposes truthful local setup/status, connection, access-mode, activity, pause, revoke,
  emergency-stop, diagnostics, update, and quit surfaces; unavailable pairing and permission
  authority controls remain disabled;
- unavailable authority actions are disabled or return a typed blocker;
- emergency stop synchronously forces local `Off` and is idempotent;
- quit records cleanup intent and requests an orderly local stop before termination;
- no state persistence exists in this slice, so relaunch cannot restore `Full Access`;
- no production entitlements, Keychain, network, Computer Use, updater, or TCC implementation is
  present.

Public one-use code issue/redemption remains blocked on
[dashboard #669](https://github.com/electricsheephq/electric-sheep-website-dashboard-6158a244/issues/669).
The outbound selected-binding relay remains blocked on
[evaos-ws-proxy #73](https://github.com/electricsheephq/evaos-ws-proxy/issues/73). There is no
direct-network, endpoint/token, or Workbench fallback.

## Local proof

```bash
packages/mac-access/scripts/build-and-test.sh
```

The script runs the frozen-identity contract check, an unsigned clean build, hostless pure Swift
tests, and exact nested-bundle verification. `CODE_SIGNING_ALLOWED=NO` is deliberate. Passing this
proves source/local build and bundle shape only. It does **not** prove Developer ID signing,
designated-requirement enforcement, notarization, stapling, SMAppService registration, TCC
attribution, Accessibility/Screen Recording, pairing, relay transport, live Computer Use, update,
release, or customer readiness.

The native catalog owns all 50 current keys and reserves all 12 repository locales without `jq` or
Homebrew. English is the only completed translation in this draft; the 550 non-English units are
explicitly `needs_review` and cannot be reported as translated by the validation script.
