# Changelog

## evaOS Workbench 2.1.36 (2026-07-13)

### Listener-Safe Mac Access Recovery

- Preserves any live Workbench-tracked Mac Access listener when bridge
  discovery changes paths or current ownership cannot be proven, instead of
  implicitly stopping or replacing the fixed-port listener.
- Requires normal Workbench connector starts and grant recovery to use a proven
  private tailnet host; loopback-only and unresolved listener evidence fails
  closed without spawning, stopping, or granting.
- Removes repeated start actions after an unproven handoff or once Mac Access
  is already ready, and routes recovery through the existing status refresh.

### Selected-Binding Mac-control Canary

- Adds a separately acknowledged, staging-only live canary for the deployed
  selected-binding `mac_control_tools` launch and ws-proxy callback path while
  leaving the ordinary `dashboard_surface` canary behavior unchanged.
- Uses dedicated staging configuration and one short-lived desktop session;
  cleanup revokes only that temporary session, and proof artifacts omit private
  customer, binding, endpoint, callback, cookie, and credential material.
- Requires the next release proof packet to contain exactly one successful
  same-head Mac-control canary result with all binding, capability, launch, and
  proxy-session assertions true.

### Release Boundary

- This entry identifies candidate source only. Signed, notarized, stapled,
  installed-app, live broker/Mac-control, distribution, pristine-Mac setup,
  and customer-readiness claims remain bound to exact release evidence.

## evaOS Workbench 2.1.35 (2026-07-13)

### Installed Connector Recovery

- Carries forward the corrected connector-host consistency and serialized
  start/stop recovery behavior from the held v2.1.34 candidate so Workbench
  probes the same bundled Desktop Bridge it starts.
- Preserves the broker-owned grant model, authenticated runtime proof,
  stop/revoke and kill-switch authority, CUA-primary control path, and Peekaboo
  fallback. This candidate does not introduce a new Mac-control architecture.
- Keeps Python execution self-contained through the bundled pinned runtime and
  keeps secure-network enrollment Workbench-owned, avoiding a
  customer-installed Python package or manual tailnet enrollment.

### Release Integrity

- Accepts safe ZIP-normalized permissions for declared bundled-Python symlinks
  while continuing to enforce entry type, exact link target, safe resolution,
  and regular-file and directory permissions.
- Runs the authoritative final-ZIP manifest, updater metadata, checksum,
  provenance, and bundled-runtime verification before creating any non-dev
  beta or RC draft.

### Release Boundary

- This entry identifies a new immutable v2.1.35 candidate source. The held
  v2.1.34 tag and draft remain unchanged. Signed, notarized, stapled,
  installed-app, live broker/Mac-control, distribution, pristine-Mac setup,
  and customer-readiness claims remain bound to their exact release evidence.

## evaOS Workbench 2.1.34 (2026-07-13)

### Installed Connector Readiness

- Reconciles the intentionally redacted public connector-status envelope with
  the private bind host selected inside the Workbench main process, so a
  healthy bundled Desktop Bridge is no longer started on one interface and
  probed on another.
- Keeps private addresses out of renderer state and fails closed when no safe
  local bind host can be resolved or when a concrete foreign process owns the
  connector endpoint.
- Extends cold-start readiness polling to a bounded elapsed-time deadline and
  accepts a healthy same-bridge child without changing the broker contract,
  Mac-control grant model, CUA-primary route, or Peekaboo fallback.
- Serializes connector stop operations and cancels stale start generations so
  explicit Stop, overlapping Start, stop/revoke, and kill-switch boundaries
  remain authoritative during recovery races.

### Release Boundary

- This entry identifies the corrected v2.1.34 release candidate source.
  Signed, notarized, stapled, installed-app, live broker/Mac-control,
  distribution, pristine-Mac setup, and customer-readiness claims remain bound
  to their exact release evidence and are not implied by the version bump.

## evaOS Workbench 2.1.33 (2026-07-13)

### Broker-Owned Private Network Authority

- Stops accepting control-plane and ACL claims from the local Desktop Bridge;
  Workbench now merges only local installed, running, enrolled, and online
  observations with a fresh authenticated broker attestation for the selected
  customer and exact Mac device.
- Rejects stale, overlong, mismatched, incomplete, or contradictory authority
  responses and clears customer-scoped renderer status during target switches,
  so readiness cannot reuse another customer's proof.
- Keeps broker identifiers and Headscale policy, node, address, and endpoint
  details in the main process; renderer output remains limited to the existing
  classified readiness and safe recovery guidance.

### Pristine Mac Enrollment

- Bundles a pinned, checksum-verified CPython 3.12 runtime with the desktop
  bridge, including the pinned PyObjC frameworks used by direct Accessibility
  control, so connector setup no longer depends on Homebrew, a system Python,
  or a customer-installed Python package; release packaging fails closed if
  the runtime, architecture, dependency provenance, native signing closure, or
  license notices are missing.
- Adds an authenticated, customer-scoped Workbench action for the typed
  `unenrolled` secure-network state; wrong-control-plane, ACL, missing-client,
  and incomplete-evidence states remain fail closed.
- Verifies the installed Tailscale app against the official macOS team and
  bundle identifiers, passes a broker-issued one-use key through a mode-0600
  temporary file, and attempts fail-closed removal without exposing the key to
  renderer state, logs, shell history, or process arguments.
- Attempts broker cancellation after a local enrollment failure, reports any
  unconfirmed cleanup or cancellation, and keeps the Mac blocked pending
  authoritative Headscale node and access-policy proof; this is source
  behavior, not customer-ready or production-runtime proof.

### Mac Control Runtime Proof

- Keep local connector and macOS permission readiness visibly separate from
  end-to-end Jane/OpenClaw and Hermes tool readiness.
- Treat an active account-scoped connector grant as `test needed`; only an
  explicit `tools_ready` runtime proof may label Mac control and the two agent
  proof cards ready/proven.
- Reject stale or contradictory runtime proof when the control-status command
  failed, pairing is incomplete/failed, or the kill switch is engaged.
- Bind ready/proven labels to the selected customer and the canonical current
  Mac-control scope; pairing and runtime proof must both match that opaque
  grant/device scope, or remain `test needed` instead of reusing stale proof.
- Preserve the existing broker grant, stop/revoke, kill-switch, diagnostics,
  TCC, and no-ACP boundaries while preventing local readiness from masking a
  broken VM/WebChat tool path.

### Release Boundary

- This entry identifies the v2.1.33 release candidate source. Signed,
  notarized, stapled, installed-app, live broker/Mac-control, distribution, and
  customer-readiness claims remain bound to their exact release evidence and
  are not implied by the version bump.

## evaOS Workbench 2.1.32 (2026-07-11)

### Upstream Runtime And Workbench UX Sync

- Includes the merged macOS update-install readiness fix, OpenAI-provider and log-rotation corrections, corrupted-database recovery confirmation, ACP runtime request deduplication, and team-chat capability propagation.
- Includes the merged scheduled-task reliability, conversation-sidebar reveal, assistant avatar consistency, Skills Hub and skill-slash-command, assistant-management, assistant-selection, GUID slash-command, and settings-polish updates.
- Closes known translation gaps, removes stale locale branding, and adds Spanish and Persian locale resources.
- These upstream-derived changes are part of the exact v2.1.32 source tree that passed the release gates below; customer broker attachment, Mac-control execution, permissions, and setup proof remain separately open.

### Runtime Recovery

- Adds the existing Workbench sign-in recovery flow to runtime dashboards when the app is web-authenticated but its opaque desktop broker session is missing.
- Refreshes broker and customer state after recovery while keeping raw session material, callback data, and launch URLs out of renderer output.
- Aligns the bundled AionCore source pin with the v0.1.43 runtime baseline already observed in the v2.1.31 installed-app investigation.

### Mac Control Reliability

- Pins the official Peekaboo 3.8.0 universal CLI as the packaged first recovery fallback, with exact source and license verification and fail-closed release archive checks.
- Runs Workbench Functional Smoke on macOS 15 so the pinned helper can be executed and verified at its declared minimum OS version.
- Adds localized repair guidance that names `evaOS Workbench.app`, explains how to add it to the macOS permission app list when absent, and tells the user to return and refresh status.
- Preserves the existing TryCUA/CUA-primary route, native connector boundary, Accessibility/manual fallback, broker controls, stop/revoke behavior, and kill switch.

### Release Boundary

- Published the Apple Silicon beta prerelease from `408ee2bee0b52ceebf511896302f8a8f4108932a` after exact-source build, Developer ID signing, Apple notarization, stapling, mounted no-ACP inspection, trusted-manifest verification, RC canary, staging live broker canary, distribution, public-URL checks, and canonical `/Applications` install/launch proof passed.
- The published proof applies only to the macOS arm64 prerelease and its exact artifacts. This Mac's existing Workbench setup has no broker endpoint configured, so local dashboard attachment, CUA-primary and fallback execution, stop/revoke and kill-switch checks, permission setup, and customer setup proof remain open before a customer-readiness claim.

## evaOS Workbench 2.1.31 (2026-07-07)

### Admin Modules V1

- Adds release-proofed admin module coverage for Connected Apps, People & Access, and Company Brain.
- Preserves the working core broker/workspace modules: evaOS, Hermes, Mission Control, Shared Browser, Design Workspace, Creative Studio, and Terminal.
- Preserves the direct Mac & iPhone connector path and keeps Mac-control as a separate non-regression gate.
- Keeps the no-ACP bundled resource profile for a smaller Workbench package.

### Release Proof

- Published the v2.1.31 beta prerelease from `7acc835e41d058f97155a70ed283933dd07e3855` after the build/release, Functional Smoke, live broker/admin canary, signed DMG, notarization, RC canary, and distribution gates passed for that exact candidate.

### Release Boundary

- The v2.1.31 proof applies only to that exact candidate and its core broker/admin modules plus direct Mac-control non-regression.
- ACP/chat visible-agent Mac-control, TryCUA-priority refresh work, desktop pet replacement, and deeper upstream/AionCore parity remain later lanes.

## evaOS Workbench 2.1.30 (2026-07-06)

### Release Guardrails

- Adds a test-backed module taxonomy so evaOS, Hermes, Mission Control, Shared Browser, Design Workspace, Creative Studio, and Terminal stay separated from the native Mac & iPhone connector.
- Documents Connected Apps, People & Access, and Company Brain as evaOS admin follow-up modules for later releases rather than v2.1.30 release blockers.
- Keeps the v2.1.30 scope intentionally narrow: customer polish and proof rerun only, with no broker refactor, Mac connector redesign, AionCore bump, or ACP/chat Mac-control change.

### Release Boundary

- Requires the same proof chain before distribution: Functional Smoke, live broker canary, signed installed-app proof, direct Mac-control non-regression, and distribution gate.
- Preserves the v2.1.29 working broker/proxy modules and native Mac-control path.

## evaOS Workbench 2.1.29 (2026-07-06)

### Release Proof

- Published the v2.1.29 beta prerelease from `b1e279d25067a1ebffd8044a7d44396d189cad88`.
- Passed the customer-facing release proof chain: Workbench Functional Smoke, build/release artifact generation, manifest proof, RC canary, live broker canary, and distribution workflow.
- Preserved the working core modules: evaOS, Hermes, Mission Control, Shared Browser, Design Workspace, Creative Studio, Terminal, and Mac & iPhone.

### Release Boundary

- Keeps ACP/chat Mac-control, Connected Apps, People & Access, Company Brain parity, AionCore/runtime sync, and desktop pet replacement in staged follow-up releases.

## evaOS Workbench 2.1.28 (2026-07-06)

### Customer Polish

- Prevents the updater from briefly showing a failed update state while a manual "Check for updates" request is still resolving.
- Preserves the working Support/Report Issue flow, Visit ElectricSheep link handling, non-admin diagnostics hiding, and evaOS module icon presentation verified after 2.1.27.

### Release Boundary

- Keeps the working broker/proxy modules and native Mac & iPhone connector path unchanged.
- Requires the same release proof chain before distribution: Functional Smoke, live broker canary, signed installed-app proof, and direct Mac-control non-regression.

## evaOS Workbench 2.1.27 (2026-07-06)

### Mac Control

- Makes TryCUA the preferred Mac-control engine when it is available, so supported desktop observation and actions can run through the background CUA driver first.
- Keeps Peekaboo bundled as the first recovery fallback and preserves the existing helper, Accessibility, and System Events fallback path.
- Adds installed-candidate proof that the bundled bridge reports `cua_driver` as the active primary engine and that `desktop_see` succeeds through CUA.

### Release Boundary

- Preserves the working broker/proxy modules from 2.1.26: evaOS, Hermes, Mission Control, Shared Browser, Design Workspace, Creative Studio, Terminal, and Mac & iPhone.
- Does not change ACP/chat Mac-control, Connected Apps, People & Access, Company Brain parity, AionCore runtime sync, or desktop pet replacement lanes.

## evaOS Workbench 2.1.26 (2026-07-05)

### Admin Module Readiness

- Added release guardrails for the native Connected Apps and People & Access pages so Workbench verifies the broker-backed in-app views instead of stale dashboard handoff paths.
- Tightened customer switching proof for operator sessions, including the Electric Sheep support VM target, the 100yen Golden target, and corrected customer display labels.
- Clarified reduced employee mode versus broker-scoped operator access so employee accounts stay limited unless the broker explicitly grants broader evaOS module access.

### Release Safety

- Keeps the working evaOS, Hermes, Mission Control, Shared Browser, Design Workspace, Creative Studio, Terminal, and Mac & iPhone release paths separate from unfinished admin-module follow-up work.
- Preserves the direct Mac-control connector path and broker/proxy module split from 2.1.25.
- Leaves deeper employee-policy rollout, Company Brain parity, TryCUA priority, ACP/chat Mac-control, desktop pet replacement, and upstream runtime sync for later releases.

## evaOS Workbench 2.1.25 (2026-07-05)

### Customer-Facing Fixes

- Support actions now open the in-app Report Issue flow instead of launching a blank browser target.
- New Chat quick-action links now route through the safe external-link handler so user-facing Electric Sheep links can open correctly.
- Mac-control takeover now shows a visible countdown before control starts, with an audio cue when the browser audio policy allows it.
- The native companion installed-app proof now checks the current Mac & iPhone ready-state copy instead of stale proof text.

### Release Guardrails

- Preserves the working broker/proxy modules as separate from the native Mac & iPhone connector.
- Functional Smoke and live broker-surface canary are required before distribution proof.
- `Connected Apps`, `People & Access`, `Company Brain`, TryCUA priority, ACP/chat Mac-control, and the desktop pet replacement remain follow-up release lanes.

## evaOS Workbench Stable R&D (unreleased)

### Mac Connector RC Preservation

- Preserved the known-good evaOS Workbench 2.1.23 direct Mac connector RC anchor at `ed458a05c9c62d5f2a6cac1fef725bc9968c31ba`, tagged `evaos-mac-control-support-vm-proof-20260630`.
- That anchor passed direct support VM -> Workbench Mac-control proof for the native Mac & iPhone connector path. It remains the rollback/proof reference while brokered proxy modules are repaired separately.
- Known release blocker at that anchor: brokered proxy/runtime modules (`evaOS`, `Hermes`, `Mission Control`, `Shared Browser`) were not release-usable even though the native Mac connector proof passed.

### Broker Runtime Surfaces

- Classified `evaOS`, `Hermes`, `Mission Control`, `Shared Browser`, and `Terminal` as brokered proxy/runtime modules, separate from the native Mac & iPhone connector and separate from ACP/chat Mac-control follow-up work.
- Runtime dashboard launches now use a dashboard-surface contract so `openclaw` and `hermes` pages do not require Mac connector material unless a caller explicitly asks for Mac-control tools.
- Runtime dashboard route switches now clear stale broker surface state and remount the embedded surface per runtime, so `Hermes` and `Mission Control` cannot inherit an already-attached `evaOS`/OpenClaw frame.
- Shared Browser now lets the broker runtime/status/action contract authorize support/operator access instead of failing early on a duplicate customer-account preflight.
- Validation added in this change: broker/session unit coverage for `dashboard_surface` launch payloads, explicit Shared Browser broker customer/enforcement proof, denied-route clearing, and renderer runtime-surface attachment. Signed installed-app live proxy smoke remains a separate release gate before any public/customer readiness claim.

### Native Companion Boundary

- evaOS Workbench is a shell/workflow compositor. Mac pairing, TCC/local control, secure callbacks, signed helpers, local credential custody, and local machine audit authority remain in the evaOS native companion and broker-backed Workbench fallback until exact-candidate native canaries pass.
- Stable builds block legacy shell-launch, Office preview watch, and local filesystem mutation/upload/watch actions by default unless an explicit diagnostic override is set.

### Stable Packaging

- Stable release builds and distribution now fail closed unless the release path keeps the evaOS app identity, blocks upstream-branded assets, validates release provenance, and requires real macOS signing/notarization when publishing is enabled.
- Added rollback and support notes for the evaOS Workbench artifact while the release pairing proof lane remains blocked.

## [2.1.12](https://github.com/iOfficeAI/AionUi/compare/v2.1.11...v2.1.12) (2026-06-05)

### Desktop

#### Features

- **i18n:** add Brazilian Portuguese (pt-BR) translation (#3209)
- **preview:** native Streamdown markdown rendering + full theming (#3204)

#### Bug Fixes

- **conversation:** align workspace path availability handling (#3207)
- **preview:** dedupe @codemirror/language so markdown source highlight survives (#3206)

### Core ([v0.1.22](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.22))

#### Bug Fixes

- **acp:** stabilize mode and model source of truth ([#409](https://github.com/iOfficeAI/AionCore/issues/409))
- **conversation:** align workspace path availability handling ([#410](https://github.com/iOfficeAI/AionCore/issues/410))
- **file:** lazy load browse roots ([#406](https://github.com/iOfficeAI/AionCore/issues/406))
- prepare managed acp tools locally without cdn ([#408](https://github.com/iOfficeAI/AionCore/issues/408))

#### Refactoring

- **error:** finish ApiError phase3 ([#398](https://github.com/iOfficeAI/AionCore/issues/398))

---

## [2.1.11](https://github.com/iOfficeAI/AionUi/compare/v2.1.10...v2.1.11) (2026-06-04)

### Desktop

#### Features

- **preview:** unify code viewing & editing on CodeMirror 6 (#3194)
- **preview:** unify code view font and fix view-mode/line-height regressions (#3185)
- **workspace:** VSCode-style file tree icons + smoother preview browsing (#3181)
- add managed acp artifact mirror workflow (#3182)

#### Bug Fixes

- **web-host:** use aioncore reported backend port (#3193)
- **settings:** apply UI scale only on slider release (#3190)

### Core ([v0.1.20](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.20))

#### Bug Fixes

- **app:** bind backend before startup services ([#397](https://github.com/iOfficeAI/AionCore/issues/397))
- stabilize agent runtime terminal lifecycle ([#396](https://github.com/iOfficeAI/AionCore/pull/396))

#### Refactoring

- **error:** ACP error classification ([#393](https://github.com/iOfficeAI/AionCore/issues/393))
- **error:** migrate phase2 service errors ([#395](https://github.com/iOfficeAI/AionCore/issues/395))

---

## [2.1.10](https://github.com/iOfficeAI/AionUi/compare/v2.1.9...v2.1.10) (2026-06-02)

### Desktop

#### Bug Fixes

- **runtime:** show runtime-specific MCP missing command hints (#3167)
- **startup:** add health polling diagnostics (#3168)
- **acp:** show model switch feedback
- **acp:** avoid duplicate runtime sync requests
- **acp:** wait for warmup before runtime sync
- **sentry:** split incomplete install diagnostics (#3164)
- normalize workspace path error handling (#3158)
- **acp:** fix model state sync after session recovery (#3162)
- **desktop:** persist close-to-tray setting (#3150)

### Core ([v0.1.19](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.19))

#### Bug Fixes

- **aionui-ai-agent:** classify aionrs API connection errors ([#389](https://github.com/iOfficeAI/AionCore/issues/389))
- classify missing MCP launcher runtimes ([#387](https://github.com/iOfficeAI/AionCore/issues/387))
- enforce workspace path whitespace errors across create and runtime ([#381](https://github.com/iOfficeAI/AionCore/issues/381))
- **startup:** add startup phase diagnostics ([#388](https://github.com/iOfficeAI/AionCore/issues/388))

---

## [2.1.9](https://github.com/iOfficeAI/AionUi/compare/v2.1.8...v2.1.9) (2026-06-01)

### Desktop

#### Bug Fixes

- **web-host:** skip fetch-blocked backend ports (#3146)
- **i18n:** clarify incomplete installation recovery (#3145)
- **conversation:** map 409 already-processing to CONVERSATION_BUSY (#3142)
- **i18n:** localize MCP check strings (#3141)

#### Features

- Allow importing skill folders and zip archives (#3144)

### Core ([v0.1.18](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.18))

#### Bug Fixes

- **agent:** classify Bedrock 'model identifier is invalid' as model-not-found (AIO-12) ([#377](https://github.com/iOfficeAI/AionCore/issues/377))
- **agent:** preserve process-group cleanup after leader exit ([#369](https://github.com/iOfficeAI/AionCore/issues/369))
- **agent:** tighten send_error classifier (AIO-87, AIO-89, AIO-90) ([#375](https://github.com/iOfficeAI/AionCore/issues/375))
- **aionui-ai-agent:** strip HTML body from sanitized error detail (AIO-13) ([#380](https://github.com/iOfficeAI/AionCore/issues/380))
- recover deleted conversation workspaces ([#379](https://github.com/iOfficeAI/AionCore/issues/379))

---

## [2.1.8](https://github.com/iOfficeAI/AionUi/compare/v2.1.7...v2.1.8) (2026-05-30)

### Desktop

#### Bug Fixes

- **desktop:** improve incomplete backend install diagnostics (#3121)
- **web-host:** enrich backend health timeout diagnostics (#3120)
- **feedback:** preserve structured live error tips (#3116)

### Core ([v0.1.17](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.17))

#### Bug Fixes

- **agent:** make codex sandbox sync non-fatal ([#370](https://github.com/iOfficeAI/AionCore/issues/370))

---

## [2.1.7](https://github.com/iOfficeAI/AionUi/compare/v2.1.6...v2.1.7) (2026-05-29)

### Desktop

#### Features

- **mcp:** move MCP management to conversation scope (#3109)

#### Bug Fixes

- **feedback:** tag agent error reports (#3113)
- **conversation:** render structured agent errors (#3093)
- **web-host:** reuse backend port after crash restart (#3111)
- **webui:** auto-open local url on startup (#3110)
- **startup:** ignore cancelled backend startup (#3108)
- **mcp:** validate json imports (#3106)
- **team:** avoid sidebar confirmation fan-out (#3105)
- **web-host:** add health timeout diagnostics (#3102)
- **settings:** avoid blue switch during image generation loading (#3091)

### Core ([v0.1.16](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.16))

#### Features

- **agent:** classify structured agent send errors ([#356](https://github.com/iOfficeAI/AionCore/issues/356))
- **mcp:** support session scoped MCP injection ([#363](https://github.com/iOfficeAI/AionCore/issues/363))

#### Bug Fixes

- channel reply stream cold start ([#366](https://github.com/iOfficeAI/AionCore/issues/366))
- **mcp:** clean up stdio test process trees ([#368](https://github.com/iOfficeAI/AionCore/issues/368))

---

## [2.1.6](https://github.com/iOfficeAI/AionUi/compare/v2.1.5...v2.1.6) (2026-05-28)

### Desktop

#### Bug Fixes

- **model-selector:** trust backend current model and persist preferences (#3084)
- **build:** align bundled aioncore target arch (#3092)
- **settings:** use provider health check probe (#3090)
- **settings:** use health check error message (#3080)
- **backend:** handle incomplete bundled aioncore installs (#3078)

#### Performance

- lazy-load full tool message content (#3086)
- improve message startup latency (#3082)

### Core ([v0.1.15](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.15))

#### Bug Fixes

- **agent:** add provider health check probe ([#358](https://github.com/iOfficeAI/AionCore/issues/358))

---

## [2.1.5](https://github.com/iOfficeAI/AionUi/compare/v2.1.4...v2.1.5) (2026-05-27)

### Desktop

#### Features

- **settings:** use backend MCP settings source (#3069)
- **settings:** rename capabilities tab + collapse speech/image-gen when disabled
- **settings:** clarify builtin assistant readonly state in editor
- **update:** add install warning on downloaded state in UpdateModal
- **tools:** allowlist image-gen models and document supported set

#### Bug Fixes

- **acp:** surface raw send errors (#3067)
- **guid:** use startsWith('custom:') to detect preset agent on New Chat reset
- **guid:** preserve CLI agent selection on New Chat, only reset preset agents
- **guid:** restore last selected agent on initial render without flash
- **guid:** include user skills in action-row Skills count
- **update:** polish downloaded state — remove desc text, drop icon from warning
- **startup:** show incompatible backend runtime (#3062)
- **image-gen:** strip response_format from gpt-image requests + remove double-save
- **tools:** use Form.Item tooltip prop for image model help icon
- **tools:** align help icon vertically with image model label
- **sendbox:** map workspace file paths for mentions (#3060)
- **settings:** route provider health check via aionrs (#3058)
- **settings:** localize sentence terminator on builtin readonly banner
- **electron:** tolerate pending backend startup (#3057)
- recover pending permission prompts (#3059)
- preserve timezone for scheduled tasks (#3056)

### Core ([v0.1.14](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.14))

#### Bug Fixes

- preserve cron timezone on legacy schedule updates ([#344](https://github.com/iOfficeAI/AionCore/issues/344))
- **startup:** add backend readiness diagnostics ([#346](https://github.com/iOfficeAI/AionCore/issues/346))

#### Refactoring

- four-layer architecture (connect / conv / biz) ([#349](https://github.com/iOfficeAI/AionCore/issues/349))

---

## [2.1.4](https://github.com/iOfficeAI/AionUi/compare/v2.1.3...v2.1.4) (2026-05-27)

### Desktop

#### Bug Fixes

- **messages:** ignore non-renderable stream events (#3053)
- **messages:** stabilize stream scrolling and initial loading (#3042)

---
