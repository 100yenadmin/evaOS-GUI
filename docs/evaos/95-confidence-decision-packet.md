# evaOS AionUi Public Beta 95% Decision Packet

Issue: https://github.com/100yenadmin/AionUi/issues/13

Milestone: https://github.com/100yenadmin/AionUi/milestone/1

Decision date: 2026-06-04

## Final Recommendation

Continue R&D with blockers.

Do not ship a public beta from the current stack. Do not kill the AionUi fork path. The sprint produced enough evidence to keep AionUi as the evaOS shell/control-board candidate, but it did not produce enough live trust proof to distribute a public beta to customers.

The current best path is to continue the AionUi fork for one more gated sprint, focused only on converting merged mock/static proofs into live broker, signed artifact, install, rollback, and role-scoped scenario proof.

## Readiness Score

Overall public beta readiness: 70/100.

Reasoning:

- Shell/fork/release safety foundation: 86/100.
- Broker/session/provider/permission trust: 58/100.
- Company Brain/browser/runtime live proof: 68/100.
- Native companion and local trust boundary: 72/100.
- Packaging/rollback release process: 75/100.
- Stack mergeability and operating process: 82/100.

This is not a 95% ship gate. It is a 95% confidence decision that the correct recommendation is to continue R&D with blockers.

## Why Not Ship

Public beta is blocked by Sev-1 and Sev-2 unknowns:

- The integration stack is merged, but most product slices are still mock/static-proven rather than staging/live-proven.
- Broker/session, provider grant, approval deny, People Access, Company Brain, and browser runtime flows still need role-scoped live scenario execution.
- No signed/notarized public beta artifact has been produced.
- Required beta signing/distribution credential names and live staging fixture names are not provisioned.
- No install smoke, launch smoke, updater/feed audit on a real artifact, or old-app rollback smoke has passed.
- The issue #1 control-board/project setup remains blocked on GitHub Project token scope.

## Why Not Kill

The fork path should continue because the sprint did produce useful, mergeable structure:

- AionUi now has an evaOS shell direction instead of extending the old browser-wrapper app.
- The trust boundary is explicit: evaOS owns broker, permissions, provider grants, Company Brain, VM/browser runtime, audit, and native companion authority; AionUi owns presentation/workflow composition.
- Issue #12 proved the packaging/release guardrail can be made rigorous with remote CI and adversarial review.
- The stack now contains concrete routes, adapters, tests, and takeover packets that another agent can continue.
- The current released macOS app remains fallback while the fork continues.

## Current Sprint State

| Issue                                            | Status            |              Confidence | Public Beta Impact                                                                                                                                                                  |
| ------------------------------------------------ | ----------------- | ----------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1 Sprint Control Board + Agent Handoff Template | Blocked           |                     40% | GitHub Project v2 token scope missing; milestone/issues are usable fallback.                                                                                                        |
| #2 Upstream Sync + Fork Safety Baseline          | Merged            |                     86% | Baseline is landed; upstream intake remains frozen unless security-critical while beta blockers are resolved.                                                                       |
| #3 evaOS Shell Guardrails                        | Merged guardrails |                     90% | Team mode, remote-agent pairing, insecure remote-agent connections, and full-auto modes are fenced by default; final beta review still needs read-only legacy surface confirmation. |
| #4 Broker Auth + Desktop Session Handoff         | Merged primitive  |                     78% | Needs live/session scenario and secret-exposure proof.                                                                                                                              |
| #5 Session Center / Mission Control              | Merged            |                     84% | Mission Control is landed with beta-gate strip; needs visual shell proof and live runtime scenario.                                                                                 |
| #6 Connected Apps Provider Hub                   | Merged            |                     93% | Needs live provider grant/auth/revoke scenario and backend denial proof.                                                                                                            |
| #7 Approval Center + Deny Loop                   | Merged            |                     93% | Needs requester/approver live fixture and audit enforcement proof.                                                                                                                  |
| #8 People Access + Account Policy                | Merged            |                     84% | Needs live account-policy fixture and role denial agreement.                                                                                                                        |
| #9 Company Brain Directory + Account 360         | Merged canary     |                     94% | Canary script covers org-scoped directory/account/query plus mandatory negative fixtures; staging credentials still needed.                                                         |
| #10 Business Browser / VM Control Proof          | Merged canary     |                     93% | Runtime canary is landed; staging execution, screenshots, and customer isolation proof still needed.                                                                                |
| #11 Native Companion Boundary                    | Merged static     |                     93% | Static boundary is strong; live native pairing/helper proof remains outside shell.                                                                                                  |
| #12 Public Beta Packaging + Rollback             | Merged guardrails |                     95% | Release safety and credential inventory gates are strong; real signed artifact/install/rollback proof remains.                                                                      |
| #13 95% Confidence Decision Packet               | Current           | 95% decision confidence | This packet recommends continue R&D with blockers and is updated through PR #48/#49 merged-stack evidence.                                                                          |
| #14 Forgejo Company Brain Sidecar Spike          | Completed/closed  |                     80% | Use now only as read-only Company Brain public-source input; defer infrastructure, packages, Actions, private indexing, and code copy/porting.                                      |

## Verified Green Evidence

Merged integration evidence:

- PR #48 merged the combined stack into `evaos/dev` at merge commit `bbead8b7f83f127d18b178d5b90d729afadae9c1`.
- PR #48 CI passed PR Check Plan, Code Quality, Ubuntu/macOS unit tests, Coverage, I18n, Release Script Test, macOS arm64/x64 builds, Linux build, and Windows unit tests.
- PR #48 CI run: https://github.com/100yenadmin/AionUi/actions/runs/26934731469
- PR #49 added the beta release credential inventory and merged into `evaos/dev` at merge commit `6d1e58375c7c40c2395c5f18f971b1c0ef7c8a5e`.
- PR #49 CI passed PR Check Plan, Code Quality, Coverage, Ubuntu/macOS unit tests, I18n, Release Script Test, macOS arm64/x64 builds, and Linux build; Windows checks were skipped by path gate.
- PR #49 CI run: https://github.com/100yenadmin/AionUi/actions/runs/26935552051

Issue #12 final attached PR Checks run passed at head `f412346d693bab7a550fada1f6cbf29193078089`:

- https://github.com/100yenadmin/AionUi/actions/runs/26913870744
- Release Script Test, Code Quality, I18n Check, Coverage Test.
- Unit tests on Ubuntu, macOS, and Windows.
- Build tests on macOS arm64, macOS x64, Linux, Windows arm64, and Windows x64.
- CodeRabbit passed.
- Current-head review-thread query returned zero unresolved threads.

## macOS-First CI Policy

The public beta target is macOS-first. The current PR gate keeps code quality, unit tests, coverage, release-script safety, macOS builds, Linux build coverage, and CodeRabbit review as normal required evidence for beta slices.

Windows checks are release/nightly or Windows-touching gates during this public-beta sprint. They should run for Windows packaging, Electron builder config, installer metadata, workflow/build surfaces, dependency lockfiles, preload/main-process/common runtime code, or manual override. They should be skipped for docs, canary scripts, renderer-only beta routes, and macOS beta packaging slices that do not touch cross-platform runtime code.

Intentionally skipped Windows jobs are not public-beta blockers when the `PR Check Plan` job reports `run_windows_checks=false` and no Windows-touching path is present. They remain required before any Windows release, nightly matrix, or Windows-touching change.

Local evidence root:

- `/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/`

## Post-Merge Sprint State

- The sprint stack is landed on `evaos/dev`.
- PR #39 codifies the macOS-first PR-check planner.
- PR #40 adds the live canary readiness checklist.
- PR #42 adds the manual `evaOS Live Canary Proof` workflow.
- PR #43 adds the `evaos-staging` environment inventory audit.
- PR #48 proves the fast route for stacked work: retarget the top integration PR, run one combined PR gate, then close contained PRs after ancestry verification.
- PR #49 adds a safe release credential inventory; the current live repo has zero required release secret names and zero required release variable names configured.
- Issue #14 Forgejo Company Brain Sidecar Spike is closed as completed for read-only spike scope; packet is under `/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/14-forgejo-company-brain-sidecar-spike/`.

## Severity-Ranked Risks

| Severity | Risk                                                                                                                                 | Owner               | Next Test                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Sev-1    | Public beta artifact has not been signed, notarized, installed, launched, or rolled back.                                            | Release agent       | Provision release credentials, then run manual `Build and Release` on approved release branch plus install/launch/rollback smoke. |
| Sev-1    | Permission and approval flows are not live-backend proven across requester/approver/denied roles.                                    | Permissions agent   | Staging fixture with requester, approver, revoked member, backend denial, and audit evidence.                                     |
| Sev-2    | Broker/session handoff is primitive-proven but not live expired-session/no-token/secret-scan proven in a signed shell.               | Broker agent        | Signed or debug shell scenario canary with renderer storage/log/URL/IPC secret audit.                                             |
| Sev-2    | Provider grant hub lacks live provider states for connected, needs-auth, expired, revoked, approval-required.                        | Provider agent      | Broker fixture exercising provider profile/auth/revoke/mint-grant with no renderer secrets.                                       |
| Sev-2    | Company Brain access boundaries have a PR-local live canary but still need staging execution with cross-org or denied-session proof. | Company Brain agent | Run `scripts/evaosCompanyBrainLiveCanary.js` against Org A/Org B fixtures and attach sanitized proof plus screenshots.            |
| Sev-2    | Business Browser/VM control has a PR-local action canary but still needs staging execution with visual/customer isolation evidence.  | Runtime agent       | Run `scripts/evaosBusinessBrowserLiveCanary.js` with action ack, denied-session or wrong-customer fixture, and screenshots.       |
| Sev-3    | GitHub Project board is blocked by token scope; milestone is the fallback control surface.                                           | Ops/admin           | Grant Project v2 scope and create the Project board, or formally accept milestone-only operation for sprint 2.                    |
| Sev-3    | Forgejo sidecar is safe only as a read-only public source; private/package indexing and self-hosting remain unreviewed.              | Company Brain agent | Add read-only public-source indexing only if it does not compete with beta blockers; defer private/self-hosted paths.             |

## Next Sprint Issue Slate

Sprint 2 should be one proof sprint, not a feature-expansion sprint.

1. Provision Staging And Release Credentials
   - Add required `evaos-staging` live canary fixtures and issue #12 release credential names.
   - Required proof: name-only inventory passes without printing values; strict readiness is still allowed to fail only on intentionally deferred live actions.

2. Signed Artifact Release Candidate
   - Run manual Build and Release from the approved release branch.
   - Required proof: signed/notarized artifact, release manifest, trusted manifest artifact, no upstream feed collision, no dev tag distribution.

3. Install, Launch, Rollback Smoke
   - Install the signed beta on macOS, launch it, verify bundle id/protocol/app identity, then roll back to the released macOS app.
   - Required proof: screenshots/logs, Gatekeeper/notarization evidence, rollback commands and results.

4. Broker Session Live Secret Audit
   - Exercise login/session creation, missing session, expired session, and runtime status in a live or staging shell.
   - Required proof: no desktop-session token in renderer state, logs, URLs, localStorage, screenshots, or generic IPC.

5. People Access And Approval Live Fixture
   - Use requester, approver, denied member, and revoked member fixtures.
   - Required proof: route denial, action denial, backend denial, deny audit id, and requester-cannot-approve evidence.
   - Canary command: `node scripts/evaosPeopleApprovalLiveCanary.js` with `AIONUI_EVAOS_APPROVAL_DENY_ACK=evaos-deny-test`, `AIONUI_EVAOS_CUSTOMER_ID`, `AIONUI_EVAOS_APPROVAL_ID`, `AIONUI_EVAOS_REQUESTER_SESSION`, and `AIONUI_EVAOS_APPROVER_SESSION`; optional `AIONUI_EVAOS_DENIED_SESSION` proves a denied member cannot list approvals.

6. Provider Hub Live Fixture
   - Exercise connected, needs-auth, expired, revoked, and approval-required provider states.
   - Required proof: no raw provider secrets in renderer, logs, URLs, screenshots, or generic IPC.
   - Canary command: `node scripts/evaosProviderHubLiveCanary.js` with `AIONUI_EVAOS_DESKTOP_SESSION`, `AIONUI_EVAOS_CUSTOMER_ID`, and optional `AIONUI_EVAOS_PROVIDER_REQUIRED_STATES=connected,needs_login,expired,revoked,approval_required`.

7. Company Brain Live Boundary
   - Exercise org-scoped directory, account 360, query, empty, ingesting, error, and cross-org denial.
   - Required proof: visual screenshots and audit/source pointers.
   - Canary command: `node scripts/evaosCompanyBrainLiveCanary.js` with `AIONUI_EVAOS_DESKTOP_SESSION`, `AIONUI_EVAOS_CUSTOMER_ID`, `AIONUI_EVAOS_COMPANY_BRAIN_ACCOUNT_ID`, `AIONUI_EVAOS_COMPANY_BRAIN_QUERY`, and at least one negative fixture: `AIONUI_EVAOS_COMPANY_BRAIN_WRONG_CUSTOMER_ID` or `AIONUI_EVAOS_COMPANY_BRAIN_DENIED_SESSION`. Acceptance proof requires directory, account 360, and query denial source/audit evidence.
   - Optional strict ingestion proof: `AIONUI_EVAOS_COMPANY_BRAIN_REQUIRED_INGESTION_STATES=ready,ingesting,error,empty`.

8. Business Browser/VM Runtime Scenario
   - Launch/open/stop browser runtime across customer switch.
   - Required proof: before/after visual state, backend action proof, audit id, and customer isolation evidence.
   - Canary command: `node scripts/evaosBusinessBrowserLiveCanary.js` with `AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK=evaos-browser-test`, `AIONUI_EVAOS_DESKTOP_SESSION`, `AIONUI_EVAOS_CUSTOMER_ID`, `AIONUI_EVAOS_BUSINESS_BROWSER_TEST_URL`, `AIONUI_EVAOS_BUSINESS_BROWSER_ALLOWED_HOSTS`, `AIONUI_EVAOS_BUSINESS_BROWSER_DENIED_SESSION`, and `AIONUI_EVAOS_BUSINESS_BROWSER_WRONG_CUSTOMER_ID`.
   - Acceptance proof requires runtime status, open URL, post-open running status, stop, post-stop stopped status, denied runtime/open/stop source/audit evidence, and wrong-customer isolation. Denied-session-only proof is non-acceptance evidence.

9. Final Public Beta Decision Recut
   - Re-run this decision packet after live proofs.
   - Required proof: zero Sev-1/Sev-2 unknowns, all beta blockers green, support path reviewed.

10. Optional Forgejo Read-Only Source

- Add public Forgejo/Codeberg repositories or docs to Company Brain as read-only sources only if it does not displace beta-blocker proof work.
- Required proof: scoped read-token strategy before private access, package visibility exclusion, and no Forgejo Actions/self-hosting dependency.

## Required Stop Rules

- Do not publish a public beta while any Sev-1 or Sev-2 unknown remains.
- Do not treat a mock release artifact as customer-distributable.
- Do not close issue #12 as shipped until signed/notarized install/rollback proof exists.
- Do not claim People Access, Approval Center, Provider Hub, Company Brain, or Browser/VM as beta-ready until live role/org/customer denial proof exists.
- Do not replace GitHub with Forgejo during sprint 2.

## Fallback

The current released macOS app remains the fallback if sprint 2 cannot close the Sev-1 and Sev-2 gates. Nothing in this decision requires forcing users onto an unproven shell.
