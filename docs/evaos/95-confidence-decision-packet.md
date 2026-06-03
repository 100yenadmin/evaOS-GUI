# evaOS AionUi Public Beta 95% Decision Packet

Issue: https://github.com/100yenadmin/AionUi/issues/13

Milestone: https://github.com/100yenadmin/AionUi/milestone/1

Decision date: 2026-06-04

## Final Recommendation

Continue R&D with blockers.

Do not ship a public beta from the current stack. Do not kill the AionUi fork path. The sprint produced enough evidence to keep AionUi as the evaOS shell/control-board candidate, but it did not produce enough live trust proof to distribute a public beta to customers.

The current best path is to continue the AionUi fork for one more gated sprint, focused only on converting mock/static/PR-local proofs into live broker, signed artifact, install, rollback, and role-scoped scenario proof.

## Readiness Score

Overall public beta readiness: 66/100.

Reasoning:

- Shell/fork/release safety foundation: 86/100.
- Broker/session/provider/permission trust: 58/100.
- Company Brain/browser/runtime live proof: 68/100.
- Native companion and local trust boundary: 72/100.
- Packaging/rollback release process: 75/100.
- Stack mergeability and operating process: 61/100.

This is not a 95% ship gate. It is a 95% confidence decision that the correct recommendation is to continue R&D with blockers.

## Why Not Ship

Public beta is blocked by Sev-1 and Sev-2 unknowns:

- The stack is not merged. Root PR #15 still requires review before the stacked PR chain can land.
- Most product slices are PR-local or mock-proven, not staging/live-proven.
- Broker/session, provider grant, approval deny, People Access, Company Brain, and browser runtime flows still need role-scoped live scenario execution.
- No signed/notarized public beta artifact has been produced.
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

| Issue                                            | Status             |              Confidence | Public Beta Impact                                                                                                                                    |
| ------------------------------------------------ | ------------------ | ----------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1 Sprint Control Board + Agent Handoff Template | Blocked            |                     40% | GitHub Project v2 token scope missing; milestone/issues are usable fallback.                                                                          |
| #2 Upstream Sync + Fork Safety Baseline          | PR-local partial   |                     85% | Good baseline, still needs merge/review closeout.                                                                                                     |
| #3 evaOS Shell Guardrails                        | PR-local partial   |                     85% | First guardrails exist; additional team/remote-agent claim fencing remains.                                                                           |
| #4 Broker Auth + Desktop Session Handoff         | PR-local primitive |                     78% | Needs live/session scenario and secret-exposure proof after merge.                                                                                    |
| #5 Session Center / Mission Control              | PR #37 pending CI  |                     82% | Linearized onto active stack; needs visual shell proof and live runtime scenario.                                                                      |
| #6 Connected Apps Provider Hub                   | PR-local           |                     93% | Needs live provider grant/auth/revoke scenario and backend denial proof.                                                                              |
| #7 Approval Center + Deny Loop                   | PR-local           |                     93% | Needs requester/approver live fixture and audit enforcement proof.                                                                                    |
| #8 People Access + Account Policy                | PR-local           |                     84% | Needs live account-policy fixture and role denial agreement.                                                                                          |
| #9 Company Brain Directory + Account 360         | PR canary ready    |                     94% | Live canary now covers org-scoped directory/account/query plus mandatory directory/account/query negative fixtures; staging credentials still needed. |
| #10 Business Browser / VM Control Proof          | PR canary green    |                     93% | PR #36 is green; staging execution, screenshots, and customer isolation proof still needed.                                                           |
| #11 Native Companion Boundary                    | PR-local           |                     93% | Static boundary is strong; live native pairing/helper proof remains outside shell.                                                                    |
| #12 Public Beta Packaging + Rollback             | PR-local passed    |                     95% | Release safety gate is strong; real signed artifact/install/rollback proof remains.                                                                   |
| #13 95% Confidence Decision Packet               | Current            | 95% decision confidence | This packet recommends continue R&D with blockers and is updated through PR #37/#14 closeout.                                                         |
| #14 Forgejo Company Brain Sidecar Spike          | Completed/closed   |                     80% | Use now only as read-only Company Brain public-source input; defer infrastructure, packages, Actions, private indexing, and code copy/porting.        |

## Verified Green Evidence

Issue #12 final attached PR Checks run passed at head `f412346d693bab7a550fada1f6cbf29193078089`:

- https://github.com/100yenadmin/AionUi/actions/runs/26913870744
- Release Script Test, Code Quality, I18n Check, Coverage Test.
- Unit tests on Ubuntu, macOS, and Windows.
- Build tests on macOS arm64, macOS x64, Linux, Windows arm64, and Windows x64.
- CodeRabbit passed.
- Current-head review-thread query returned zero unresolved threads.

Local evidence root:

- `/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/`

Active stack evidence as of 2026-06-04:

- PRs #31 through #36 are mergeable and have no non-success reported checks.
- PR #36 Business Browser runtime canary is green at head `cd35c6a71334c68e61883d3bd1998bc381d37b98`.
- PR #37 Mission Control linearization is mergeable at head `df76cb316029331b04838a0efed24a308eabdc29`; Windows build checks were still pending when this packet was updated.
- Issue #14 Forgejo Company Brain Sidecar Spike is closed as completed for read-only spike scope; packet is under `/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/14-forgejo-company-brain-sidecar-spike/`.

## Severity-Ranked Risks

| Severity | Risk                                                                                                                                 | Owner               | Next Test                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Sev-1    | Public beta artifact has not been signed, notarized, installed, launched, or rolled back.                                            | Release agent       | Manual `Build and Release` on approved release branch, then install/launch/rollback smoke.                                  |
| Sev-1    | Root stack PR #15 still requires review before the stacked work can land.                                                            | Repo maintainer     | Review/merge PR #15, then advance the stack in order with current-head CI.                                                  |
| Sev-1    | Permission and approval flows are not live-backend proven across requester/approver/denied roles.                                    | Permissions agent   | Staging fixture with requester, approver, revoked member, backend denial, and audit evidence.                               |
| Sev-2    | Broker/session handoff is primitive-proven but not live expired-session/no-token/secret-scan proven in a signed shell.               | Broker agent        | Signed or debug shell scenario canary with renderer storage/log/URL/IPC secret audit.                                       |
| Sev-2    | Provider grant hub lacks live provider states for connected, needs-auth, expired, revoked, approval-required.                        | Provider agent      | Broker fixture exercising provider profile/auth/revoke/mint-grant with no renderer secrets.                                 |
| Sev-2    | Company Brain access boundaries have a PR-local live canary but still need staging execution with cross-org or denied-session proof. | Company Brain agent | Run `scripts/evaosCompanyBrainLiveCanary.js` against Org A/Org B fixtures and attach sanitized proof plus screenshots.      |
| Sev-2    | Business Browser/VM control has a PR-local action canary but still needs staging execution with visual/customer isolation evidence.  | Runtime agent       | Run `scripts/evaosBusinessBrowserLiveCanary.js` with action ack, denied-session or wrong-customer fixture, and screenshots. |
| Sev-3    | GitHub Project board is blocked by token scope; milestone is the fallback control surface.                                           | Ops/admin           | Grant Project v2 scope and create the Project board, or formally accept milestone-only operation for sprint 2.              |
| Sev-3    | Forgejo sidecar is safe only as a read-only public source; private/package indexing and self-hosting remain unreviewed.              | Company Brain agent | Add read-only public-source indexing only if it does not compete with beta blockers; defer private/self-hosted paths.       |

## Next Sprint Issue Slate

Sprint 2 should be one merge-and-proof sprint, not a feature-expansion sprint.

1. Merge Stack Root And Retarget
   - Merge or unblock PR #15.
   - Retarget and merge PRs #16 through #24 in dependency order.
   - Required proof: current-head PR Checks green after each merge or retarget; no unresolved review threads.

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
