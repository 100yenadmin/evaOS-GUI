# evaOS Workbench Module Taxonomy

This release line keeps Workbench module families explicit so future fixes do not accidentally mix broker surfaces, native Mac control, and upstream AION UI concepts.

## Core evaOS Release Modules

These are release-critical for the current customer Workbench line:

- `evaOS` (`/evaos`) - broker/runtime dashboard surface.
- `Hermes` (`/hermes`) - broker/runtime dashboard surface.
- `Mission Control` (`/mission-control`) - broker/runtime dashboard surface.
- `Shared Browser` (`/business-browser`) - broker/runtime browser surface.
- `Design Workspace` (`/design-workspace`) - broker/runtime workspace surface.
- `Creative Studio` (`/creative-studio`) - external creative workspace handoff.
- `Terminal` (`/terminal`) - broker/runtime terminal surface.
- `Mac & iPhone` (`/native-companion`) - native Mac connector and iPhone helper surface.

Only `Mac & iPhone` is the native Mac connector. The broker/runtime modules above must not require Mac connector material just to load their dashboards.

## Admin Follow-Up Modules

These remain staged after v2.1.30 unless a release plan explicitly promotes them:

- `Connected Apps` (`/connected-apps`)
- `People & Access` (`/people-access`)
- `Company Brain` (`/company-brain`)

They are evaOS modules, but they are not release blockers for v2.1.30.

## Separate Systems

- Built-in AION UI modules: chat, scheduled tasks, settings, and base conversation UI.
- Native Mac connector: `Mac & iPhone`, bridge pairing, local TCC/control, CUA/Peekaboo fallback.
- ACP/chat Mac-control path: future Workbench-to-agent tool-call path, tracked separately from direct Mac control.

Guardrail source: `packages/desktop/src/renderer/evaos/evaosModuleTaxonomy.ts`.
