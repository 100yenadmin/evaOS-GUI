# Milestone 2 Upstream Commit Ledger

This ledger covers the raw upstream range `iOfficeAI/AionUi v2.1.12..v2.1.18` for the evaOS Workbench fork.

Current evaOS anchor: `evaos/beta-rc-20260612@9c11cb275cbc1a74c19b0ba4fcbb79140809e24a`.

Provenance:

- Generated during the 2026-06-14 Milestone 2 full-import sprint.
- Upstream remote: `https://github.com/iOfficeAI/AionUi.git`.
- Source range command: `git log --format='%h%x09%cs%x09%s' --reverse upstream-v2.1.12..upstream-v2.1.18`.
- Ledger rows: 63 upstream release-range commits plus 2 post-tag candidates.
- Post-tag command: `git log --format='%h%x09%s' --reverse upstream-v2.1.18..upstream/main`.
- Guardrail classifier: `node scripts/evaosUpstreamGuardrailAudit.js --classify <changed-path> [...]`.

Classification meanings:

- `already-present`: exact upstream commit or equivalent baseline behavior is already present.
- `adapted`: imported through an evaOS-specific PR or equivalent narrow port.
- `defer`: not part of the active macOS Milestone 2 lane unless separately promoted.
- `needs-decision`: import needs a dedicated canary, proof, or product decision.
- `danger`: direct conflict with evaOS release, native trust, or renderer boundary without dedicated proof.

| Bucket | Upstream commit |    PR | Class           | Subject                                                | evaOS status                                        |
| ------ | --------------: | ----: | --------------- | ------------------------------------------------------ | --------------------------------------------------- |
| 2.1.13 |     `a205755df` | #3217 | already-present | canonicalize boundary errors                           | Exact merge-base behavior present.                  |
| 2.1.13 |     `b5b4fce4f` | #3220 | adapted         | align installation integrity dialogs                   | Adapted by PR #308.                                 |
| 2.1.13 |     `7ec78c497` | #3221 | adapted         | validate packaged node runtime layout                  | Adapted by PR #308.                                 |
| 2.1.13 |     `0350f6a13` | #3219 | needs-decision  | unify theme system                                     | Import in appearance/UX lane only.                  |
| 2.1.13 |     `2dd956418` | #3218 | adapted         | preserve backend startup error codes                   | Adapted by PR #308.                                 |
| 2.1.13 |     `2bec332ce` | #3222 | defer           | preview zoom/history defaults                          | Later preview polish unless promoted.               |
| 2.1.13 |     `a0b6e663b` | #3223 | needs-decision  | font sizes and Display to Appearance                   | Import in appearance/UX lane only.                  |
| 2.1.13 |     `52da67878` | #3224 | needs-decision  | stabilize conversation runtime view contract           | Runtime/team lane.                                  |
| 2.1.13 |     `441dae69a` | #3226 | needs-decision  | message scrollbar flush                                | Appearance/UX lane.                                 |
| 2.1.13 |     `c3144cc89` | #3229 | defer           | bump 2.1.13 and AionCore v0.1.23                       | Do not import package identity.                     |
| 2.1.14 |     `cc54b905e` | #3234 | defer           | add CDN metadata sync workflow                         | Not used by evaOS release lane; upstream reverted.  |
| 2.1.14 |     `3c906e1f0` | #3232 | adapted         | block wrong macOS package architecture                 | Adapted by PR #308.                                 |
| 2.1.14 |     `2dc14891f` | #3235 | defer           | bump 2.1.14 and AionCore v0.1.24                       | Do not import package identity.                     |
| 2.1.15 |     `c4864365a` |   n/a | defer           | update WeChat QR code                                  | Upstream docs/assets only.                          |
| 2.1.15 |     `0a86101d4` | #3233 | needs-decision  | make log directory configurable                        | Low-risk completion lane.                           |
| 2.1.15 |     `272193408` | #3248 | defer           | merge WeChat QR update                                 | Upstream docs/assets only.                          |
| 2.1.15 |     `1695975ac` | #3239 | needs-decision  | publish updater metadata during release distribution   | Release lane only; preserve evaOS feed.             |
| 2.1.15 |     `f6c6e37d8` | #3250 | adapted         | pass parent pid to bundled backend                     | Adapted by PR #309.                                 |
| 2.1.15 |     `1ee70b7f4` |   n/a | defer           | mobile language selector layout                        | Mobile login CSS, not macOS beta critical.          |
| 2.1.15 |     `1ea4a3c67` |   n/a | defer           | stop button glow clipping                              | Mobile CSS, not macOS beta critical.                |
| 2.1.15 |     `cf7880a09` |   n/a | needs-decision  | hide conversation export UI entries                    | Appearance/UX lane.                                 |
| 2.1.15 |     `4828107d0` |   n/a | defer           | raise PreviewPanel import test timeout                 | Test-only; optional if flake appears.               |
| 2.1.15 |     `4774f7251` | #3254 | defer           | merge mobile login layout                              | Mobile UI only.                                     |
| 2.1.15 |     `485412b05` | #3251 | needs-decision  | localized ACP empty-turn tips                          | Runtime/team lane.                                  |
| 2.1.15 |     `bada3a350` | #3253 | needs-decision  | enforce agent runtime policy and turn-aware UI         | Runtime/team lane.                                  |
| 2.1.15 |     `a8b9c52ad` | #3256 | defer           | revert CDN metadata workflow                           | No action; cancels #3234.                           |
| 2.1.15 |     `f0c1e566a` | #3257 | needs-decision  | align header model label with selector                 | Appearance/UX lane.                                 |
| 2.1.15 |     `2eb7f64aa` | #3259 | defer           | bump 2.1.15 and AionCore v0.1.26                       | Do not import package identity.                     |
| 2.1.16 |     `0f5a4fa61` | #3263 | needs-decision  | handle empty release prefix check                      | Low-risk completion lane if compatible.             |
| 2.1.16 |     `1877e994a` | #3262 | adapted         | read HTTP error body once                              | Adapted by PR #307.                                 |
| 2.1.16 |     `eab63d064` | #3264 | needs-decision  | point OfficeCLI install help to official releases      | Low-risk completion lane.                           |
| 2.1.16 |     `77c6be13f` | #3273 | defer           | bump 2.1.16 and AionCore v0.1.27                       | Do not import package identity.                     |
| 2.1.17 |     `bf6e2ef1f` | #3274 | danger          | send multipart request matching backend STT contract   | Voice/STT lane with signed mic proof.               |
| 2.1.17 |     `d5aad7f0c` | #3280 | needs-decision  | support AionCore manual artifacts                      | AionCore/runtime lane.                              |
| 2.1.17 |     `1cdbf3f08` |   n/a | needs-decision  | allow editing Base URL when editing model platform     | Provider/settings lane.                             |
| 2.1.17 |     `584b46d44` |   n/a | needs-decision  | support multi-select models when adding platform       | Provider/settings lane.                             |
| 2.1.17 |     `62f4e4764` | #3282 | needs-decision  | add Follow System theme mode                           | Appearance/UX lane.                                 |
| 2.1.17 |     `515414e2c` |   n/a | needs-decision  | add global feedback/report entry to toolbar            | Appearance/support lane; avoid support duplication. |
| 2.1.17 |     `aef44a59b` | #3283 | needs-decision  | voice input settings revamp                            | Voice/STT lane.                                     |
| 2.1.17 |     `74c739f77` |   n/a | needs-decision  | sticky platform group titles                           | Provider/settings lane.                             |
| 2.1.17 |     `070c97abe` |   n/a | needs-decision  | keep sticky platform title above scrolling items       | Provider/settings lane.                             |
| 2.1.17 |     `e8c8ad786` | #3285 | needs-decision  | merge UX polish                                        | Provider/settings and appearance lane.              |
| 2.1.17 |     `c04e53169` | #3286 | adapted         | normalize Windows verbatim paths from directory picker | Adapted by PR #313 where applicable.                |
| 2.1.17 |     `cfd8dcbc6` | #3288 | defer           | bump 2.1.17 and AionCore v0.1.28                       | Do not import package identity.                     |
| 2.1.18 |     `f44886eac` | #3287 | adapted         | drop bare slash from office watch proxy URL            | Adapted by PR #313.                                 |
| 2.1.18 |     `0e2623973` | #3289 | needs-decision  | stop clobbering real out artifacts in build test       | Low-risk completion lane.                           |
| 2.1.18 |     `af255a7f4` | #3291 | needs-decision  | streaming voice input with live transcript             | Voice/STT lane.                                     |
| 2.1.18 |     `b8d8eda62` | #3294 | danger          | add macOS audio-input entitlement                      | Voice/STT lane with signed mic proof.               |
| 2.1.18 |     `d84bc80ab` | #3296 | defer           | Windows long-path uninstall recovery                   | Windows lane, outside macOS Milestone 2.            |
| 2.1.18 |     `20724fc11` |   n/a | adapted         | enable clickable folder picker in WebUI                | Adapted by PR #313.                                 |
| 2.1.18 |     `4a2168651` |   n/a | adapted         | float directory picker above modals                    | Adapted by PR #313.                                 |
| 2.1.18 |     `70974c59a` | #3301 | adapted         | merge folder picker polish                             | Adapted by PR #313.                                 |
| 2.1.18 |     `2ad0de449` |   n/a | needs-decision  | tighten factory default font sizes and zoom            | Appearance/UX lane.                                 |
| 2.1.18 |     `3dbf8a08e` |   n/a | needs-decision  | tighten desktop chat body line-height                  | Appearance/UX lane.                                 |
| 2.1.18 |     `762a8b0a7` | #3277 | needs-decision  | phase-1 assistant governance settings                  | Assistant governance lane.                          |
| 2.1.18 |     `ae3aaf139` |   n/a | needs-decision  | show AI copy/timestamp row only at turn end            | Appearance/UX lane.                                 |
| 2.1.18 |     `c879f3544` |   n/a | needs-decision  | tighten desktop paragraph spacing                      | Appearance/UX lane.                                 |
| 2.1.18 |     `b51ee3931` |   n/a | needs-decision  | nudge feedback icon alignment                          | Appearance/support lane.                            |
| 2.1.18 |     `10f510013` | #3306 | needs-decision  | merge conversation UX polish                           | Appearance/UX lane.                                 |
| 2.1.18 |     `5c3faf00e` | #3298 | defer           | cover cron busy retry flow                             | Optional e2e import.                                |
| 2.1.18 |     `d0ce9f8f5` | #3307 | needs-decision  | gate sends during cancelling runtime                   | Runtime/team lane.                                  |
| 2.1.18 |     `4702cc48b` | #3309 | needs-decision  | stabilize team mode conversation runtime               | Runtime/team lane.                                  |
| 2.1.18 |     `163b7a6a6` | #3270 | adapted         | wait for backend shutdown before install               | Adapted by PR #312.                                 |
| 2.1.18 |     `554439ab5` | #3311 | needs-decision  | bump 2.1.18 and AionCore v0.1.29                       | AionCore/runtime lane; preserve evaOS identity.     |
| 2.1.18 |     `ddd20d380` | #3313 | needs-decision  | increase web-cli build heap                            | Low-risk completion lane.                           |

Post-tag candidates:

| Upstream commit |    PR | Class          | Subject                                                   | evaOS status                         |
| --------------: | ----: | -------------- | --------------------------------------------------------- | ------------------------------------ |
|       `57aa0d0` | #3317 | needs-decision | keep recording when streaming fails before it establishes | Voice/STT lane.                      |
|       `87f1d14` | #3310 | needs-decision | actionable server-side OfficeCLI install guidance         | Appearance/UX or low-risk help lane. |
