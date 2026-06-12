# evaOS Workbench Beta Packaging And Rollback

This document defines the controlled macOS RC packaging, distribution, rollback, and support proof gate for the AionUi-based evaOS Workbench Beta shell.

## Beta Identity

- App name: `evaOS Workbench Beta`
- macOS bundle id: `com.evaos.workbench.beta`
- Executable name: `EvaOSWorkbenchBeta`
- Protocol scheme: `evaos-workbench-beta`
- GitHub release repo: `100yenadmin/evaOS-GUI`
- Release tag prefix: `evaos-beta-`
- Artifact identity marker: `evaOS Workbench Beta`, `EvaOSWorkbenchBeta`, or `evaos-workbench-beta`

The controlled beta must not ship as upstream `AionUi`, use the upstream `iOfficeAI/AionUi` release feed, or publish installer assets with upstream AionUi branding.

## Release Workflow

1. Run `Build and Release` with `beta_release_ack=evaos-beta`.
2. Keep `EVAOS_BETA_RELEASE_PUBLISH_ENABLED` disabled for internal smoke builds.
3. Enable `EVAOS_BETA_RELEASE_PUBLISH_ENABLED=true` only when the release decision is ready for controlled beta distribution.
4. Set `EVAOS_BETA_RELEASE_BRANCH` to the audited release branch before creating public beta tags.
5. Run `evaOS Beta RC Canary` for the same non-dev tag and keep the successful workflow run id.
6. Distribute assets only with `Distribute evaOS Beta Release Assets`, `beta_distribution_ack=evaos-beta`, and a tag that starts with `evaos-beta-`.
7. Do not distribute `-dev-` beta tags. Public distribution requires a non-dev `evaos-beta-` tag reachable from `EVAOS_BETA_RELEASE_BRANCH`.
8. Distribution must validate `evaos-beta-release-manifest.json`, matching asset checksums, the tag commit, the successful `Build and Release` workflow run, and the successful `evaOS Beta RC Canary` proof run before publishing the GitHub prerelease.

No AWS, S3, external bucket, or CDN distribution is required for this controlled RC. The distribution surface is the existing GitHub Release in `100yenadmin/evaOS-GUI`.

## Signing And Notarization

Public beta publishing requires real macOS signing and notarization. Ad-hoc signing is not a distributable release candidate.

Before any signed local or release build, locate the macOS release credential preflight helper and run it. In the Codex operator environment this is provided by the `macos-release-credential-bootstrap` skill; other operators should set the path explicitly.

```bash
export MACOS_RELEASE_CREDENTIAL_PREFLIGHT="/path/to/macos_release_credential_preflight.sh"
"$MACOS_RELEASE_CREDENTIAL_PREFLIGHT" \
  --mode bootstrap \
  --test-codesign \
  --check-notary
```

If a Keychain or signing GUI prompt appears, stop and fix signing/keychain ACLs. Do not ask a user to click through the prompt.

## Updater And Feed Boundary

- `electron-builder` publish config points at `100yenadmin/evaOS-GUI`.
- `publishAutoUpdate` is `false`.
- Releases are created as draft prereleases and are published only after RC canary proof.
- Runtime auto-update is disabled by default for evaOS beta builds.
- Manual update/download surfaces in beta mode must not point at upstream `iOfficeAI/AionUi`.
- Distribution refuses upstream AionUi asset names and non-evaOS beta tags.

## Smoke Proof

Before sharing a controlled beta link, attach proof to the release gate issue:

- Signed macOS arm64 artifact exists.
- Signed macOS x64 artifact exists or x64 is explicitly blocked.
- `codesign --verify --deep --strict --verbose=2 <app>` passes.
- `spctl --assess --type execute --verbose <app>` reports `accepted`.
- Launch smoke proves `com.evaos.workbench.beta` and `evaOS Workbench Beta`.
- Updater/feed audit proves no upstream `iOfficeAI/AionUi` or `aionui.com` feed/support reference in shipped app resources.
- Rollback smoke proves the beta app can be removed and the released fallback `/Applications/evaOS.app` can launch.

## Rollback

The released Workbench app remains the fallback. If a controlled beta artifact fails after publication:

1. Mark the GitHub prerelease as draft or unavailable.
2. Remove the beta app bundle from `/Applications/evaOS Workbench Beta.app`.
3. Restore or launch `/Applications/evaOS.app`.
4. Record whether user data, cache, protocol handler state, and broker login/session state were changed.

## Operator rollback-proof commands

```bash
codesign --verify --deep --strict --verbose=2 "/Applications/evaOS Workbench Beta.app"
spctl --assess --type execute --verbose "/Applications/evaOS Workbench Beta.app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -dump | grep -A5 -B5 evaos-workbench-beta
open -n "/Applications/evaOS.app"
```

## Support

Support reports for release candidates must include the tag, app version, bundle id, route, selected customer summary, non-secret audit ids, screenshot/proof folder, signing/notarization/Gatekeeper status, and rollback result.
