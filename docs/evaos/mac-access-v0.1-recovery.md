# evaOS Mac Access v0.1 Recovery Contract

## Product decision

evaOS Mac Access v0.1 is a small native menu-bar connector that pairs one broker-selected evaOS VM agent with the installed Mac and exposes the existing owned Mac computer-use implementation.

The first product gate is the signed installed journey:

```text
install
  -> open setup
  -> pair
  -> Full Access
  -> desktop_see
  -> click
  -> type
  -> scroll
  -> emergency stop
  -> later command denied
```

The VM agent uses the existing evaOS CUA/MCP tools. The Mac app is the authenticated execution connector. It is not another agent-policy system, remote-control API, or MCP daemon.

## Minimum architecture

```text
evaOS VM agent CUA/MCP tools
        |
        v
broker-selected authenticated outbound WSS
        |
        v
evaOS Mac Access app/helper
        |
        v
existing CustomerMacAdapter
        |
        +--> CUA driver
        +--> Peekaboo fallback
        +--> built-in Accessibility/screen fallback
```

Keep one stable identity set:

- app: `com.evaos.mac-access`
- helper: `com.evaos.mac-access.helper`
- connector: `com.evaos.mac-access.connector`

The archived `electricsheephq/evaos-desktop-bridge` repository is provenance only. The owned source in evaOS-GUI is the implementation source of truth.

## Required v0.1 behavior

- Guided setup works without terminal instructions.
- One-use code pairing stores credentials in Keychain.
- Remote transport is outbound-only and accepts only the broker-selected customer/device/grant/runtime binding.
- `Off` denies remote action.
- `Ask Every Time` requests exact-action local approval.
- `Full Access` permits continuous action within the selected binding until the owner disconnects, pauses, revokes, stops, or the grant expires.
- Full Access must not silently become Ask Every Time after connect, resume, or restart.
- Disconnect, unpair, revoke, and emergency stop close control and deny later action.
- Activity evidence is minimal and redacted.
- The private runtime is bundled. Normal onboarding requires no Workbench, system Python, Homebrew, Tailscale, public inbound port, or terminal setup.
- The exact private test artifact is Developer ID signed, notarized, and stapled before installed-Mac proof.

## Reuse before new code

The existing `CustomerMacAdapter` already supplies desktop observation and actions through CUA-driver, Peekaboo, and built-in fallbacks. The recovery must wire broker commands into that adapter.

Do not create another click/type/scroll implementation while this adapter remains available.
Do not run another broad engine-selection spike unless the installed vertical slice produces concrete evidence that the existing engine order cannot perform a required action.

The recovery may extract these proven pieces from superseded branches:

- native menu shell and onboarding;
- stable app/helper targets and signing identities;
- pairing redemption and Keychain vault;
- selected-binding WSS parsing and validation;
- bundled private runtime;
- essential signing, notarization, stapling, and bundle checks;
- a small local lifecycle CLI.

## Explicitly deferred

The following are not v0.1 blockers:

- Workbench coexistence and client migration;
- updater, appcast, and rollback authorization;
- broad audit retention or cryptographic audit chains;
- a second local policy authority;
- public release, website distribution, or customer rollout;
- Windows and iPhone Mirroring.

Audit persistence must not become permission to execute ordinary CUA. Full Access must not require per-action approval.

## Current runtime blocker

The signed candidate receives relay registration acknowledgement, then closes its WebSocket client-side within approximately 0.48-0.89 seconds before dispatch.

XPC service lifetime is a hypothesis. The next implementation action is one bounded installed-app canary using balanced XPC activity lifetime management and redacted process/socket terminal evidence.

If that canary fails, move long-lived WSS ownership to the already-frozen persistent app/connector identity. Do not introduce another identity or daemon.

## Sprint and branch boundary

- Sprint source of truth: GitHub issues #698 and #724.
- Reset baseline observed on 2026-07-18: `evaos/beta-rc-20260612@511b23e58d3062b9f6af6a38956946ec398f9b1a`.
- The v2.1.36 source-merge freeze remains active.
- Documentation and isolated recovery development may proceed from the verified reset baseline.
- No Mac Access source may merge into canonical beta until the v2.1.36 release owner explicitly lifts or supersedes the freeze.
- Recovery must not start from the superseded stacked PR chain.
- Before merge, refresh recovery to the exact canonical beta head named by the release owner after the freeze lifts or is superseded.

## Validation and proof boundary

The first runtime evaluation is `evaos-mac-access-thin-vertical-slice-v1`.

It requires:

1. one signed installed app;
2. one non-customer staging binding;
3. authenticated results for `desktop_see`, click, type, and scroll;
4. wrong-binding denial;
5. Off, Ask Every Time, and Full Access semantic checks;
6. emergency stop followed by a denied command;
7. one clean supported Mac repetition.

Passing establishes only the named private internal-alpha path. It does not establish public-release readiness, customer readiness, updater safety, Workbench coexistence, or rollout authorization.

## Stop-doing rules

- No additional architecture/schema expansion before the vertical slice.
- No general or adversarial review loops before installed behavior works.
- No new CUA executor while the existing adapter is unwired.
- No per-action approval under Full Access.
- No audit-chain health as actuation authority.
- No updater, rollback, Workbench, migration, publication, or customer work.
- No signed candidate without one named hypothesis and binary pass/fail result.
- No claim beyond the exact source, artifact, or runtime evidence produced.
