# evaOS AionUi Public Beta 95% Decision Packet

Issue: https://github.com/100yenadmin/AionUi/issues/13

Milestone: https://github.com/100yenadmin/AionUi/milestone/1

Decision date: 2026-06-05

## 2026-06-06 RC Parity Addendum

The original sprint decision packet is superseded for release-candidate testing by the RC parity audit packet at `/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/rc-parity-audit-2026-06-06/`.

Do not call the AionUi/evaOS fork RC-ready until the exact candidate proves 100% evaOS desktop parity, native Mac adapter canaries, upstream AionUi self-regression, visible beta branding, signing/notarization, rollback, updater/feed behavior, and secret-safety.

Current RC recommendation: continue R&D with RC parity blockers.

## Final Recommendation

Continue R&D with blockers.

Do not ship the public beta from this packet. Do not kill the AionUi fork path. The sprint has enough evidence to continue using AionUi as the updateable evaOS shell, and the latest product and packaging proofs materially changed the risk profile. The remaining blockers are now operating and release-channel gates, not a lack of basic product proof.

The next move is a short containment-and-release-control pass: provision reusable staging canary fixtures, finish or formally waive the GitHub Project v2 board gate, rehearse the publish channel without touching upstream AionUi release paths, and keep the current released macOS app as fallback.

## Internal Evidence Maturity Score

Internal R&D evidence maturity: 91/100.

This is not a 95% ship gate. It is a 95% confidence decision that the correct recommendation is to continue R&D with blockers.

Reasoning:

- Upstream-maintainable shell containment: 92/100.
- Real admin product proof across core surfaces: 91/100.
- Broker/session/provider/permission trust proof: 90/100.
- Company Brain/browser/runtime/native-boundary proof: 90/100.
- Packaging/signing/rollback proof: 94/100.
- Reusable CI/staging/operator workflow: 76/100.

Customer-distributable public beta readiness remains blocked while any unwaived release-channel or reusable-canary Sev-2 risk remains.

## Why Not Ship

Public beta distribution is blocked by operating gates:

- Issue #41 is still open. The sprint now has real `admin@100yen.org` product proof, but the same live canaries are not yet provisioned as reusable GitHub/staging fixtures that any agent can run safely.
- Issue #1 is still open. The milestone and issue queue are usable, but the GitHub Project v2 control board still needs the required token scope or an explicit milestone-only waiver.
- The signed/notarized/stapled macOS candidate exists as a local app-only artifact. The public publish channel still needs final release/feed control review before customers are pointed at it.
- The release must not auto-publish into upstream AionUi channels, reuse upstream updater feeds, or collide with the released evaOS macOS fallback app.

## Why Not Kill

The fork path should continue because the sprint now has concrete evidence rather than shell optimism:

- AionUi is contained as the shell/workflow layer; evaOS remains authority for auth, customer/session context, permissions, broker state, provider grants, Company Brain, VM/browser runtime, audit, and native Mac trust.
- The real `admin@100yen.org` product pass proved loaded or backend-denied states for the core surfaces that previously looked empty.
- Connected Apps now has current-state proof plus controlled lifecycle proof for connected, needs-login, expired, and revoked states without touching real Google/OpenAI grants.
- The macOS beta candidate was signed, notarized, stapled, separated by bundle id/protocol, and rollback-proofed against the released app.
- The old released macOS app remains fallback, so continuing R&D does not force users onto an unproven shell.

## Current Sprint State

| Issue                                                            | Issue Gate                                  |              Confidence | Public Beta Impact                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------- | ----------------------: | -------------------------------------------------------------------------------------------------------------------------- |
| #1 Sprint Control Board + Agent Handoff Template                 | Open; blocked on Project v2 scope or waiver |                     70% | Milestone/issues are usable fallback. Project board remains an operating blocker, not a product blocker.                   |
| #2 Upstream Sync + Fork Safety Baseline                          | Closed                                      |                     95% | Fork safety baseline and upstream intake rules are in place.                                                               |
| #3 evaOS Shell Guardrails                                        | Closed                                      |                     95% | Unsafe or overclaiming beta surfaces are fenced by default.                                                                |
| #4 Broker Auth + Desktop Session Handoff                         | Closed for sprint proof                     |                     91% | Real session/customer proof exists; reusable staging canary wiring still belongs to #41.                                   |
| #5 Session Center / Mission Control                              | Closed for sprint proof                     |                     91% | Product status surfaces render honestly with real context or settled denied/empty states.                                  |
| #6 Connected Apps Provider Hub                                   | Closed                                      |                     94% | Current and lifecycle provider states proved; direct provider secrets remain outside the shell.                            |
| #7 Approval Center + Deny Loop                                   | Closed for sprint proof                     |                     91% | Requester/approver deny proof and backend/audit enforcement are covered in the product pass.                               |
| #8 People Access + Account Policy                                | Closed for sprint proof                     |                     90% | Real member/account policy proof exists; reusable role fixtures are tracked in #41.                                        |
| #9 Company Brain Directory + Account 360                         | Closed for sprint proof                     |                     90% | Org-scoped loaded/denied behavior is covered in the product pass.                                                          |
| #10 Business Browser / VM Control Proof                          | Closed for sprint proof                     |                     90% | Runtime and customer isolation proof exists; reusable live canary fixtures remain #41.                                     |
| #11 Native Companion Boundary                                    | Closed                                      |                     95% | AionUi remains shell/workflow composition only, not local trust authority.                                                 |
| #12 Public Beta Packaging + Rollback                             | Closed as packaging-ready                   |                     94% | Signed/notarized/stapled app-only candidate exists; public release-channel publish remains blocked.                        |
| #13 95% Confidence Decision Packet                               | Current closeout                            | 95% decision confidence | Recommendation is continue R&D with blockers, not ship beta.                                                               |
| #14 Forgejo Company Brain Sidecar Spike                          | Closed                                      |                     80% | Use only as optional read-only reference/source work; do not merge Forgejo into AionUi.                                    |
| #41 Provision staging fixtures for live beta canaries            | Open                                        |                     72% | Main reusable proof blocker. Product proof passed locally/with real admin context, but CI-ready fixtures are not complete. |
| #67 Product Reality Pass: admin@100yen.org Real Customer Context | Closed                                      |                     92% | Real admin product proof is complete enough for the decision packet.                                                       |
| #81 Live Customer End-to-End Proof Run                           | Closed                                      |                     92% | Aggregate live-product proof is complete enough for the decision packet.                                                   |

## macOS-First CI Policy

The beta target is macOS-first. Windows checks are release/nightly or Windows-touching gates, not blockers for docs, canary scripts, renderer-only routes, or macOS beta packaging work.

Required PR gates remain code quality, unit tests, coverage, release-script safety, and macOS build where relevant. Intentionally skipped Windows jobs are not public-beta blockers unless the change touches Windows packaging, Electron builder Windows config, installer metadata, or cross-platform runtime behavior.

## Post-Merge Sprint State

PR #48 merged the combined stack into `evaos/dev`.

PR #49 added the beta release credential inventory.

Current post-merge state: the fork is viable for continued R&D, but not customer-distributable while #41 reusable live canaries, #1 governance closure or waiver, and release-channel publish review remain open or unwaived.

## Local Shell Smoke Gate

Before adding new feature slices, run an interactive local AionUi shell smoke. Start the app, wait for routes to settle, capture screenshots for Mission Control, People Access, Approval Center, Connected Apps, Business Browser, Company Brain, and Agent Settings, verify unsafe/overclaim surfaces are hidden, and verify honest empty/error states.

Staging fixtures only block live backend canaries. They do not block the local shell smoke, and shell smoke must not be reported as product readiness.

## Live Canary Fixture Provisioning

Use the repo-owned fixture workflow before claiming reusable live beta proof:

```bash
npm run evaos:live-canary-fixtures -- --provisioning-template
```

The template is placeholder-only. It must be filled with safe staging values through secrets/fixtures that another agent can rerun without local-only magic.

After provisioning, rerun the strict inventory:

```bash
node scripts/evaosLiveCanaryReadiness.js --strict
```

## Verified Evidence

Repository and issue evidence:

- Issue #115 closed the upstream-maintainability containment pass and reduced route/sidebar/broker risk behind evaOS modules.
- Issue #6 was closed after provider current-state and lifecycle proof against `admin@100yen.org`/`golden`.
- Dashboard PR #373 was merged and deployed to support provider `expired` lifecycle state end to end.
- Issues #67 and #81 were closed as real admin product-proof lanes, not as public beta ship approval.
- Issue #12 was closed as packaging-ready, not beta-ready.

Local proof artifacts:

- Product proof root: `/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/67-real-admin-product-reality-pass/`
- Provider lifecycle proof: `/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/06-connected-apps-provider-hub/artifacts/provider-lifecycle-live-proof-20260605.json`
- Provider current-state proof: `/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/06-connected-apps-provider-hub/artifacts/provider-current-live-proof-20260605.json`
- Packaging proof root: `/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/12-public-beta-packaging-rollback/`
- Decision packet root: `/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/13-95-confidence-decision-packet/`

Signed macOS app-only candidate:

- Artifact: `/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/12-public-beta-packaging-rollback/artifacts/notarization-2026-06-05-current/EvaOSWorkbenchBeta-2.1.10-evaos-beta.0-mac-arm64-notarized-stapled-app.zip`
- SHA256: `4c67fcb1a4c15c1edf813b2c9e965e5e9cab4f64c5777fdfb34cbd56a33b9e04`
- Notary submission: `486cc244-81ce-4157-8ac4-90640f8fb386`
- Bundle id: `com.evaos.workbench.beta`
- Protocol: `evaos-workbench-beta`
- Fallback app: `/Applications/evaOS.app`, version `0.6.27`, protocol `evaos://`

Validation evidence:

- Sprint packet audit passed:

```bash
node scripts/evaosSprintPacketAudit.js audit-packets /Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta
```

- Dashboard provider lifecycle validation passed before PR #373 merge:

```bash
npm test -- src/pages/dashboard/providers-route.test.ts src/lib/workbench-provider-hub.test.ts src/lib/agent-runtimes.test.ts src/services/runtime-authority-policy.test.ts
deno check supabase/functions/desktop-runtime-session/index.ts
```

## Remaining Risks

| Severity | Risk                                                                                | Owner               | Next Test                                                                                               |
| -------- | ----------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| Sev-2    | Reusable staging canary fixtures are not provisioned for every agent/CI run.        | Ops/admin           | Complete #41 and run strict live-canary inventory plus proof workflow.                                  |
| Sev-2    | Public publish channel is not final-reviewed even though app-only packaging passed. | Release agent       | Dry-run or formally review beta feed/update/release publishing without upstream channel collision.      |
| Sev-3    | GitHub Project v2 board remains blocked by token scope.                             | Ops/admin           | Grant Project v2 scope and finish #1, or explicitly waive to milestone-only operation.                  |
| Sev-3    | Forgejo remains reference/sidecar only.                                             | Company Brain agent | Keep it read-only unless security, backups, SSO, runner isolation, and package visibility are reviewed. |

No current Sev-1 unknown is known after product proof and packaging proof. Public beta is still blocked because unwaived Sev-2 operating/release risks remain.

## Next Sprint Issue Slate

Sprint 2 should be a release-control sprint, not a feature-expansion sprint.

1. Finish #41 reusable staging/live canary fixtures.
   - Required proof: strict inventory passes, canaries run from GitHub or a documented agent command, and no secret values appear in logs/artifacts.

2. Finish or waive #1 Project v2 board setup.
   - Required proof: Project board exists and issues are mapped, or a maintainer comment accepts milestone-only control for this sprint.

3. Run public publish-channel dry run or formal release review.
   - Required proof: beta release cannot publish to upstream AionUi channels, cannot hijack the released evaOS updater/protocol, and has a documented rollback/support path.

4. Re-run the product proof only after #41 canaries are reusable.
   - Required proof: screenshots are captured after loaded/denied states settle, not immediately after route navigation.

5. Recut #13 only if blockers change.
   - Required output must say exactly one: `ship beta`, `continue R&D with blockers`, or `kill/revert to released macOS app`.

## Required Stop Rules

- Do not publish a public beta while #41 remains open or unwaived.
- Do not publish a public beta while release/feed/update behavior is not explicitly reviewed.
- Do not treat shell smoke, mocked rows, or immediate route-load screenshots as product readiness.
- Do not move Mac pairing, TCC/local control, signed helper behavior, secure callbacks, or local audit authority into AionUi.
- Do not copy Forgejo code into AionUi or replace GitHub as this sprint control surface.

## Fallback

The current released macOS app remains the fallback. Continuing AionUi R&D is justified, but public beta distribution waits for the remaining operating gates.
