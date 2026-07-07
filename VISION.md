# Vision

evaOS-GUI is the downloadable desktop GUI customers use to reach their Eva
agent — a maintained fork of [AionUi](https://github.com/iOfficeAI/AionUi),
one of the three access surfaces customers get (alongside the Electric Sheep
dashboard and Telegram). It talks to the customer's per-VM OpenClaw gateway
through `evaos-ws-proxy`, the same authenticated edge the dashboard and
Telegram integrations go through.

It exists so customers who want a native, local, Cowork-style desktop
experience (multi-agent sessions, file access, MCP tools, cron automation) —
not just a chat window — have one, without us building an agent desktop app
from scratch. Upstream AionUi provides the Cowork/multi-agent engine; this
fork layers on evaOS-specific wiring (see `AGENTS.md` → "Shared Owned-Repo
Policy" and the release/workbench tooling under `.github/workflows/`).

## Why this matters

- **This is a customer-facing product surface, not an internal tool.** Bugs
  here are a customer's first (and recurring) impression of Eva, on their own
  machine — treat crash/data-loss/update-safety bugs as release blockers, not
  routine issues.
- **It is a fork, not an independent product.** Upstream AionUi ships fast and
  broad (30+ CLI agent integrations, Team Mode, i18n in 10 languages). Our job
  is to track useful upstream improvements while keeping the evaOS-specific
  layer (connection to `evaos-ws-proxy`, evaOS branding/support surfaces,
  Mac-control/Workbench integration) intact — see the `codex/upstream-v*`
  history in this repo's git log for how upstream merges have been handled so
  far.
- **Fork identity is still incomplete** — see `AGENTS.md` for the specific,
  verified gap (release badge + `package.json` name still pointing at
  upstream). Don't assume every "AionUi"-branded string in this repo is a bug
  to fix; some of it is pending a deliberate release-identity pass, not an
  oversight to silently patch.

## Risk profile

This app runs unattended on a customer's own machine with real file-system
and (per Team Mode / multi-agent config) real API-key access. The main
risk surfaces:

- **Update safety.** This ships as a signed, auto-updating desktop app
  (see `.github/workflows/build-and-release.yml`,
  `evaos-beta-rc-canary.yml`, `bump-homebrew.yml`). A bad release reaches
  customers' desktops directly, not behind a staged rollout you control after
  the fact the way a server deploy is.
- **The IPC/process boundary.** Main (`packages/desktop/src/process/`) vs.
  renderer (`packages/desktop/src/renderer/`) must not mix APIs — see
  `AGENTS.md` → Architecture. Getting this wrong is a security boundary
  issue, not just a style nit.
- **The connection to `evaos-ws-proxy`.** This app is a client of the same
  proxy the dashboard and Telegram go through — changes to how it
  authenticates or reconnects can affect a customer's only way to reach Eva
  from their desktop.
