# evaOS Workbench Beta Packaging And Rollback

This document is the issue #12 release gate for the AionUi-based evaOS public beta shell. It defines the beta identity, release workflow, updater/feed boundary, smoke proof, rollback path, and support route.

## Beta Identity

- App name: `evaOS Workbench Beta`
- macOS bundle id: `com.evaos.workbench.beta`
- Executable name: `EvaOSWorkbenchBeta`
- Protocol scheme: `evaos-workbench-beta`
- GitHub release repo: `100yenadmin/evaOS-GUI`
- Release tag prefix: `evaos-beta-`
- Artifact identity marker: `evaOS Workbench Beta`, `EvaOSWorkbenchBeta`, or `evaos-workbench-beta`

The public beta must not ship as upstream `AionUi`, use the upstream `iOfficeAI/AionUi` release feed, or publish assets whose installer names contain upstream AionUi branding.

## Release Workflow

The beta release path is manual-only:

1. Run `Build and Release` with `beta_release_ack=evaos-beta`.
2. Keep `EVAOS_BETA_RELEASE_PUBLISH_ENABLED` disabled for internal smoke builds.
3. Enable `EVAOS_BETA_RELEASE_PUBLISH_ENABLED=true` only after the #13 decision packet says `ship public beta`.
4. Set `EVAOS_BETA_RELEASE_BRANCH` to the audited release branch before enabling public beta tag creation.
5. Distribute assets only with `Distribute evaOS Beta Release Assets`, `beta_distribution_ack=evaos-beta`, and a tag that starts with `evaos-beta-`.
6. Run `evaOS Beta RC Canary` for the same non-dev tag and keep the successful workflow run id.
7. Do not distribute `-dev-` beta tags. Public distribution requires a non-dev `evaos-beta-` tag that is reachable from `EVAOS_BETA_RELEASE_BRANCH`.
8. Distribution must validate `evaos-beta-release-manifest.json`, matching asset checksums, the tag commit, the trusted manifest artifact, and the successful `evaOS Beta RC Canary` proof run before GitHub prerelease promotion/distribution.

Release target profile:

- Default `EVAOS_RELEASE_TARGET_PLATFORMS=all` keeps the existing Windows, macOS, and Linux artifact contract for future all-platform releases.
- Controlled Apple-Silicon RC runs set `EVAOS_RELEASE_TARGET_PLATFORMS=macos-arm64` or select `release_target_platforms=macos-arm64` in the manual workflow. This profile requires only the macOS arm64 DMG/ZIP assets plus `latest-arm64-mac.yml`.
- Universal macOS RC runs set `EVAOS_RELEASE_TARGET_PLATFORMS=macos` or select `release_target_platforms=macos` in the manual workflow. This profile requires macOS x64/arm64 DMG/ZIP assets plus `latest-mac.yml` and `latest-arm64-mac.yml`.
- Windows and Linux installers, packages, and updater metadata are explicitly deferred while the macOS profile is active. Their absence is not a controlled 1.0 RC blocker.

PR release-script safety checks use mock or staged assets; they do not imply a finished RC artifact. RC artifact publication uses the manual release workflow, signing/notarization proof, trusted manifest registration, RC canary, and distribution workflow:

```bash
node scripts/evaosBetaReleaseGate.js audit-config
EVAOS_RELEASE_TARGET_PLATFORMS=macos-arm64 bash scripts/prepare-release-assets.sh build-artifacts release-assets
EVAOS_RELEASE_TARGET_PLATFORMS=macos-arm64 bash scripts/verify-release-assets.sh release-assets
node scripts/evaosBetaReleaseGate.js write-manifest release-assets evaos-beta-v<version>
node scripts/evaosBetaReleaseGate.js verify-manifest release-assets evaos-beta-v<version>
```

For the current macOS controlled RC, `Build and Release` should use `macos_dmg_finalization=local`. That mode stages app-notarized DMGs as workflow artifacts and intentionally stops before tag/release creation. After local Developer ID DMG signing, DMG notarization, stapling, and Gatekeeper primary-signature validation, run `Register evaOS Beta Local-Signed DMG Manifest`, then pass its run id to the RC canary and distribution workflows as `trusted_manifest_run_id` with `local_signed_dmg_fallback_ack=evaos-local-signed-dmg`.

## Signing And Notarization

Public beta publishing requires real macOS signing and notarization. When `EVAOS_BETA_RELEASE_PUBLISH_ENABLED=true`, the reusable build workflow sets `EVAOS_BETA_REQUIRE_SIGNING` and requires:

- `BUILD_CERTIFICATE_BASE64`
- `P12_PASSWORD`
- `IDENTITY`
- `APPLE_ID`
- `APPLE_ID_PASSWORD`
- `TEAM_ID`

Run the name-only credential inventory before attempting a signed beta candidate. It lists required repository secret and variable names without printing credential values:

```bash
node scripts/evaosBetaReleaseCredentialInventory.js --repo 100yenadmin/evaOS-GUI --strict --markdown
```

In public beta mode, ad-hoc signing is a hard failure and notarization failure is a hard failure. The ad-hoc path remains available only for internal smoke builds where public publishing is disabled.

## Updater And Feed Boundary

- `electron-builder` publish config points at `100yenadmin/evaOS-GUI`.
- `publishAutoUpdate` is `false`.
- Releases are created as draft releases.
- Runtime auto-update is disabled by default for evaOS beta builds.
- Manual update downloads in beta mode are allowed only from the configured evaOS beta update repo.
- Distribution refuses upstream AionUi asset names and non-evaOS beta tags.

## Smoke Proof

Before sharing a public beta link, attach proof to issue #12:

- Signed and stapled macOS arm64 DMG exists.
- Signed macOS x64 artifact exists or x64 is explicitly blocked.
- `xcrun stapler validate <dmg>` passes.
- `spctl --assess --type open --context context:primary-signature --verbose <dmg>` passes.
- `codesign --verify --deep --strict --verbose=2 <app>` passes.
- `xcrun stapler validate <app>` passes.
- `spctl --assess --type execute --verbose <app>` passes or the exact notarization/Gatekeeper blocker is recorded.
- Install smoke: DMG opens and app copies to `/Applications` without replacing the old released app identity.
- Launch smoke: app starts, shows beta identity, and does not require upstream AionUi update/feed state.
- Updater/feed audit: no public beta artifact can auto-update from upstream channels.
- Rollback smoke: old released macOS app still installs and launches independently.

Create a machine-checkable release-candidate proof packet before asking for the
final #13 public beta decision:

```bash
node scripts/evaosBetaReleaseGate.js write-rc-proof-template \
  /Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/rc-proof/<tag> \
  <tag>

node scripts/evaosBetaReleaseGate.js verify-rc-proof \
  /Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/rc-proof/<tag> \
  <tag>
```

GitHub RC canary workflow:

1. Dispatch `evaOS Beta RC Canary`.
2. Set `beta_rc_ack=evaos-beta-rc`.
3. Set `tag` to the existing non-dev `evaos-beta-*` release tag.
4. Set `fallback_release_repo`, `fallback_release_tag`, `fallback_asset_pattern`, and `fallback_app_name` to the currently released macOS fallback app.
5. Set `broker_session_proof_ref` to a non-secret issue, packet, or canary reference proving broker login/session state for the fallback.
6. Before manifest registration for locally finalized DMGs, regenerate `latest-arm64-mac.yml` from the finalized arm64 DMG, and regenerate `latest-mac.yml` only when x64 is included. Do not reuse updater metadata from the unsigned staged DMGs.
7. For locally finalized DMGs, set `trusted_manifest_run_id` to the successful manifest-registration workflow run id and set `local_signed_dmg_fallback_ack=evaos-local-signed-dmg`.
8. Download the uploaded artifact named `evaos-beta-rc-proof-<tag>`.
9. Pass the successful canary workflow run id to `Distribute evaOS Beta Release Assets` as `rc_proof_run_id`.

The proof packet must include:

- `release-assets/` with the audited `evaos-beta-release-manifest.json`, updater metadata, and `release-assets-reference.json` listing release asset names, sizes, and SHA256 values without embedding DMG/ZIP installer bytes.
- `trusted-manifest/evaos-beta-release-manifest.json` downloaded from the release workflow artifact, not copied from the mutable GitHub Release assets.
- `codesign-dmg-macos-arm64.txt`, `stapler-dmg-macos-arm64.txt`, and `spctl-dmg-macos-arm64.txt`.
- `codesign-macos-arm64.txt`, `stapler-macos-arm64.txt`, and `spctl-macos-arm64.txt`.
- `install-smoke.md`, `launch-smoke.md`, `updater-feed-audit.md`, `rollback-smoke.md`, and `support-notes.md`.
- macOS x64 signing/Gatekeeper proof, or a concrete `macosX64.status=blocked` reason in `evaos-beta-rc-proof.json`.

`rollback-smoke.md` must explicitly record beta app absence, released fallback launch, beta data/cache disposition, protocol handler state, and broker login/session proof.

## Rollback

The fallback remains the current released macOS app until #13 ships the public beta. Rollback procedure:

1. Quit `evaOS Workbench Beta`.
2. Remove `/Applications/evaOS Workbench Beta.app`.
3. Keep the old released macOS app installed under its existing app identity.
4. Launch the released app and confirm broker login/session state still works.
5. If the beta changed local data during a test, preserve logs and restore from the last known-good customer account or VM/browser session state before inviting more users.

Rollback must not require deleting the old released app, changing its bundle id, or moving users to an upstream AionUi update channel.

## Protocol Handler Repair

If a browser `Open Workbench` action opens the raw Electron default screen that says `path-to-app`, the macOS beta protocol handler is stale or incorrectly registered. The handler must resolve `evaos-workbench-beta` to `com.evaos.workbench.beta`, never to `com.github.Electron` or a repo-local `node_modules/.bun/electron.../Electron.app`.

Operator repair proof commands:

```bash
# Re-register the installed beta app with LaunchServices.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "/Applications/evaOS Workbench Beta.app"

# Launch the beta app by bundle id so the packaged app can reclaim the beta scheme.
open -b com.evaos.workbench.beta "evaos-workbench-beta://diagnostics/protocol-check"

# Verify the beta protocol is no longer owned by raw Electron.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -dump \
  | grep -A4 -B2 "handlerpref id:             evaos-workbench-beta"
```

The installed-app proof gate also checks this state and fails before screenshots when LaunchServices maps the beta scheme to raw Electron.

Operator rollback proof commands:

```bash
osascript -e 'quit app "evaOS Workbench Beta"' || true
test ! -d "/Applications/evaOS Workbench Beta.app" || rm -rf "/Applications/evaOS Workbench Beta.app"

# Confirm the old released app still exists independently.
ls -ld "/Applications/evaOS Workbench.app" "/Applications/OpenClaw Workbench.app" 2>/dev/null || true

# Inspect beta-only local state without deleting evidence.
ls -la "$HOME/Library/Application Support/evaOS Workbench Beta" 2>/dev/null || true
ls -la "$HOME/Library/Logs/evaOS Workbench Beta" 2>/dev/null || true
ls -la "$HOME/Library/Caches/evaOS Workbench Beta" 2>/dev/null || true

# Confirm Launch Services sees the released fallback app and the beta app is absent after removal.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -dump \
  | grep -E "evaOS Workbench Beta|evaOS Workbench|OpenClaw Workbench" || true

# Confirm the beta protocol handler is not the only route left for users.
plutil -extract CFBundleURLTypes raw -o - "/Applications/evaOS Workbench.app/Contents/Info.plist" 2>/dev/null || true
```

Rollback verification must capture:

- whether `/Applications/evaOS Workbench Beta.app` is absent after rollback;
- whether the released fallback app still launches;
- whether beta user-data, logs, and caches were preserved or intentionally removed;
- whether protocol handler state still leaves the released app usable;
- whether broker login/session state works in the released fallback app.

## Support

Public beta support must point to evaOS-owned channels:

- GitHub issue: `100yenadmin/evaOS-GUI` issue #12 for packaging, issue #13 for final ship/continue/kill decision.
- Evidence packet: `/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/12-public-beta-packaging-rollback/`
- User-facing support note: beta is gated, can be withdrawn, and the released macOS app remains the fallback until public beta gates pass.

## Ship Blockers

Do not publish public beta assets while any of these are true:

- Auth/session handoff is not proven.
- People Access/permissions are not proven.
- Approval deny loop is not backend-enforced.
- Provider hub exposes or stores raw provider secrets.
- Business Browser/VM status is not customer-scoped.
- Company Brain access boundaries are not org-scoped.
- Native companion boundary is not enforced.
- Signing, notarization, install smoke, launch smoke, rollback, or support notes are missing.
