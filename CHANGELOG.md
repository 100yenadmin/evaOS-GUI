# Changelog

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
