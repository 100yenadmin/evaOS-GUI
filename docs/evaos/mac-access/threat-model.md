# evaOS Mac Access v0.1 threat model

Issue: [#699](https://github.com/100yenadmin/evaOS-GUI/issues/699)
Contract version: `2026-07-15.v1`

## Scope

This model covers the standalone Mac Access app, its embedded helper and private runtime, authenticated Workbench client, broker-selected outbound relay, local access policy, audit, update/rollback, and coexistence migration.

It does not claim that any mitigation is implemented or live. Source contracts, code-sign proof, signed artifacts, pristine-Mac setup, VM-to-Mac CUA, deployment, customer readiness, and rollout are separate gates.

## Security objectives

1. Only the locally installed, correctly signed Mac Access helper can exercise macOS Accessibility and Screen Recording authority.
2. Only a broker-selected and locally enrolled customer/VM/Mac/grant/runtime/binding can request a command.
3. The local user can always deny, pause, stop, revoke, or kill access without broker cooperation.
4. `Off` is the default and uncertainty state; Full Access never silently survives a helper runtime restart.
5. Workbench coexistence never creates a second connector, listener, grant, TCC identity, updater, or audit authority.
6. Pairing credentials, device keys, broker channel authority, and raw CUA data never cross renderer, logs, clipboard, issues, or support evidence.
7. Every allowed or denied command has a durable redacted local decision record before actuation.

## Assets

- Mac device credential and connector private key in Keychain.
- Selected customer, VM, Mac device, grant, runtime, and binding state.
- Local access mode, policy epoch, approval state, pause/revoke/kill state.
- macOS TCC grants and the responsible signed identity.
- Broker command authority, nonce/sequence replay window, and channel state.
- Local redacted audit journal and optional separately approved artifacts.
- Signed app/helper/update lineage and rollback metadata.
- Customer Mac pixels, Accessibility metadata, pointer/keyboard actions, and typed content while in memory.

## Actors and capabilities

| Actor                      | Assumed capability                                                        | Not automatically trusted                                                                  |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Local Mac user             | Can install apps, approve TCC, choose access mode, pause/revoke/kill.     | A click is not approval unless the native UI binds it to exact scope.                      |
| Mac Access menu app        | Correctly signed local UI process.                                        | Cannot execute CUA, read Keychain device secrets, or self-attest identity.                 |
| Mac Access helper          | Correctly signed native authority process.                                | Remote input still requires valid binding, policy, audit, and command authority.           |
| Workbench main             | Correctly signed compatible client during coexistence.                    | Cannot own connector lifecycle, TCC, Keychain, broker channel, or CUA after cutover.       |
| Workbench renderer/content | Potentially compromised web content.                                      | No native secret, channel, raw binding, generic action, or direct XPC authority.           |
| Embedded Python            | Potentially exploitable parser/planner code.                              | No Keychain, broker credential, leader, audit, TCC, CUA, updater, or public IPC authority. |
| Broker/ws-proxy            | Selects binding and signs bounded command authority.                      | Cannot override local Off/pause/revoke/kill or manufacture local approval.                 |
| Selected VM runtime        | Produces tool requests within broker-selected scope.                      | Cannot nominate a different customer/device/grant/runtime or reach the Mac directly.       |
| Other same-user process    | Can inspect user files it can access and connect to discoverable sockets. | Same UID, PID, path, environment, or bearer-token knowledge is insufficient.               |
| Network attacker           | Can observe/drop/replay/tamper subject to TLS protections.                | Cannot create a valid selected-binding or command signature.                               |
| Old/unsigned replacement   | Can exist on disk or race launch/update.                                  | Cannot inherit credentials, leadership, TCC, policy, or channel authority.                 |

Root/admin compromise and malicious signed code with the same approved designated requirement are outside the v0.1 prevention boundary, but must remain visible as residual risk. The product still limits secret persistence and supports local revoke/uninstall.

## Trust boundaries

1. Menu app/Workbench to helper XPC connection.
2. Renderer to Workbench main IPC.
3. Helper to private Python subprocess/IPC.
4. Helper to Keychain and append-only audit files.
5. Helper to macOS TCC/CUA frameworks.
6. Helper outbound WebSocket to broker relay.
7. Broker relay to selected VM runtime.
8. Installed version to updater/replacement/rollback version.
9. Workbench-owned legacy connector to Mac Access-owned connector during migration.

Data crossing each boundary is allowlisted, length-bounded, versioned, and fail closed. Unknown fields are rejected at authority boundaries rather than ignored.

## Threat table

| Threat                         | Attack or failure                                                                                       | Required prevention/detection                                                                                                                                                                 | Fail-closed response                                                                                | Proof gate                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Replay                         | Reuse context ID, session/channel generation, command ID, nonce, sequence, approval, or result receipt. | Complete RFC 8785 signed command payload; bounded replay cache persisted across reconnect/helper restart until maximum expiry; single-use approval.                                           | Deny before prompt/audit decision; record `command_replayed`; never extend expiry.                  | Submit the same valid envelope twice and across reconnect/restart. Second and later attempts fail.                    |
| Stale binding                  | Use old binding ID/version after selection changes.                                                     | Compare signed context, outer tuple, Keychain enrollment, and current policy epoch exactly.                                                                                                   | Invalidate queue/approvals; close old channel; effective `Off` until new binding is confirmed.      | Old and new bindings interleaved; only current binding is accepted.                                                   |
| Wrong customer                 | Cross-tenant command or mismatched customer/VM.                                                         | Server-owned context plus local tuple equality before policy.                                                                                                                                 | Deny and raise a high-severity redacted audit event; no prompt.                                     | Mutate outer and signed customer/VM independently and together. All fail without matching enrollment.                 |
| Wrong Mac/device               | Command targets another connector device or key.                                                        | Device, installation, and connector-key identity bound to enrollment and command authorization.                                                                                               | Deny; rotate/disable channel if broker claims disagree.                                             | Structurally valid wrong-device fixture fails at runtime.                                                             |
| Duplicate process              | Old Workbench connector and Mac Access both run, or two helpers race.                                   | Atomic local leader lease plus one broker compare-and-swap that swaps the legacy and prepared grant/lease; signed identity/liveness checks.                                                   | Both clients deny work during ambiguity and never unlink/kill an unknown owner.                     | Launch/race/upgrade/reverse-handoff tests show one listener/channel/grant/audit writer.                               |
| Local untrusted client         | Same-user malware steals token or connects to socket/XPC.                                               | XPC audit token, `SecCode`, team/anchor, identifier, hardened runtime, designated requirement, per-connection nonce/epoch.                                                                    | Reject connection before decoding mutation; no status details beyond generic denial.                | Unsigned, ad-hoc, wrong-team, renderer, shell child, stale PID, and stolen-token tests.                               |
| Host interface escape          | Renderer, Electron, shell child, or stale embedded process invokes/replays a core operation.            | Helper-created inherited private channel; fixed host schema; host-session ID; monotonic sequence; expected policy epoch; no HTTP/public socket/generic command.                               | Reject before state or native-port access; rotate host session; effective Off on channel ambiguity. | Unknown operation/field, wrong session, duplicate/reordered sequence, stale epoch, Electron import, and orphan tests. |
| Stolen pairing code            | Attacker claims a copied public code.                                                                   | High-entropy one-time code, short expiry, rate limit, atomic claim, installation nonce, local customer/device confirmation before state transition.                                           | Claim expires/locks; pairing remains Off; rotate code.                                              | Reuse, concurrent claim, expired code, wrong installation, wrong customer, and dismissed confirmation.                |
| Revoked grant                  | Broker or local revoke occurs while commands are queued/in flight.                                      | Local revocation tombstone and policy epoch checked before prompt, before actuation, and at safe cancellation boundaries.                                                                     | Block new work synchronously; clear queue/approvals; close channel; erase active credential.        | Race revoke against queued, prompted, executing, reconnecting, and offline commands.                                  |
| Offline broker                 | Existing channel drops but queued authority remains.                                                    | Monotonic authority deadline; disconnect barrier; no offline extension.                                                                                                                       | New remote actuation denied. Local status, stop, revoke, kill, and audit remain available.          | Disconnect before/after prompt and execution; no command starts after barrier.                                        |
| Helper replacement             | Attacker or stale updater swaps helper binary/service.                                                  | Signed embedding, designated requirement pin, code validity, expected path plus identity, versioned Keychain credential group, update handoff protocol.                                       | Refuse leadership/Keychain/channel; effective Off; show repair path.                                | Replace, ad-hoc sign, wrong team, moved path, old signed version, and partial update tests.                           |
| Downgrade                      | Old but validly signed app reads new state or reacquires credentials.                                   | Broker rejects missing/below-floor immutable build identity; critical floor rotation creates a new credential/access-group epoch and revokes the old credential; rollback names exact target. | Refuse transport/Keychain leadership and remain Off; preserve state for compatible recovery.        | Install old signed builds below/above the floor and interrupt every credential rotation/update/rollback transition.   |
| Crash recovery                 | Full Access or stale approval silently resumes.                                                         | Runtime-instance-bound Full Access confirmation; ephemeral approval store; policy epoch increment on recovery.                                                                                | Effective Ask Every Time or Off; queue and approvals cleared.                                       | Kill -9 menu/helper/Python at every transition and relaunch.                                                          |
| Request tampering              | Change command body after approval/signature.                                                           | Canonical request digest in command authorization and local approval; recompute immediately before execution.                                                                                 | Deny without executing; invalidate approval.                                                        | Mutate every approved field, target snapshot/path, capability, and encoding.                                          |
| Malicious/compromised renderer | Invoke generic native IPC or obtain secrets.                                                            | Main-process allowlist and redaction; authenticated helper accepts only signed main processes and fixed actions.                                                                              | Deny; renderer gets generic code and audit ID only.                                                 | XSS/DevTools-like calls cannot reach raw XPC, CUA, Keychain, channel, or logs.                                        |
| Python compromise              | Planner process reads secrets or calls CUA directly.                                                    | Sandboxed/minimal environment; no secret FDs; native ports; normalized bounded messages; helper revalidates output.                                                                           | Terminate Python; effective Off for command path; helper and local controls remain available.       | Python emits unknown action, oversized payload, forged result, path traversal, or direct framework attempt.           |
| Secret/log leakage             | Token, typed text, screenshot, AX tree, path, env, or address enters audit/support logs.                | Redaction schema denylist plus allowlisted evidence; bounded errors; secret scan.                                                                                                             | Reject audit event/receipt; actuation denied if decision cannot be recorded safely.                 | Negative fixture and recursive scans over logs, crashes, diagnostics, issue packets.                                  |
| Audit deletion/tamper          | User malware truncates or edits local audit.                                                            | Owner-only files, append-only API, contract-required monotonic sequence/previous-record/record digests, optional broker receipt correlation.                                                  | Mark chain broken, effective Off, preserve evidence, require repair.                                | Edit/delete/reorder records and verify detection before next action.                                                  |
| Audit unavailable              | Disk full, permissions wrong, corruption, I/O failure.                                                  | Pre-execution durable decision write and health check.                                                                                                                                        | Effective Off; no actuation; minimal local blocker if possible.                                     | Fault injection for open/write/fsync/rename/disk-full failures.                                                       |
| Kill-switch race               | Command starts while local kill is activating.                                                          | In-memory atomic deny barrier first; policy epoch rotation; checks before prompt and actuation; safe cancellation.                                                                            | No new action after barrier; in-flight action stops at safe boundary; channel cleanup best effort.  | High-rate command stream while kill switch is toggled.                                                                |
| Approval confusion             | Prompt label differs from executable target or is reused.                                               | Approval binds selected tuple, capability, normalized target, request digest, policy epoch, and expiry.                                                                                       | Dismiss/change/timeout denies; changed target requires new prompt.                                  | TOCTOU mutation between preview, prompt, and execution.                                                               |
| Broker key rotation            | Connector accepts an old/unknown signing key or bricks on valid rotation.                               | Signed keyset with activation/retirement windows; key ID pinning; rollback plan.                                                                                                              | Unknown/retired key denies; never fall back unsigned.                                               | Overlap, early/late rotation, rollback, missing keyset, and clock skew.                                               |
| Clock manipulation             | Wall clock extends expiry or breaks ordering.                                                           | Signed absolute time plus monotonic elapsed deadline established on receipt; bounded clock skew.                                                                                              | Suspicious jump denies current channel and reconnects.                                              | Move wall clock forward/back during queued/prompted commands.                                                         |
| Oversized/flooded input        | Memory/CPU/disk exhaustion via WebSocket or XPC.                                                        | Frame limits, rate limits, bounded queue, backpressure, timeouts, bounded audit text.                                                                                                         | Drop/reject and eventually close abusive channel; local kill remains responsive.                    | Oversized, fragmented, high-rate, and slow-loris scenarios.                                                           |
| Direct-network bypass          | Runtime discovers a Mac URL/IP/token or public listener.                                                | No target listener; outbound relay only; firewall/listener checks; no renderer/broker payload contains endpoint.                                                                              | Pairing/transport blocked if an unauthorized listener is detected.                                  | `lsof`/packet evidence on pristine and coexistence Macs; prompt/output secret scans.                                  |
| Update split-brain             | New menu with old helper or vice versa accepts incompatible authority.                                  | Compatibility handshake, signed build identity, atomic handoff, access Off during update.                                                                                                     | Refuse channel and mutations; rollback to exact signed compatible pair.                             | Interrupt update at each file/service transition.                                                                     |
| Orphan cleanup abuse           | Installer kills/deletes unrelated same-name process/file.                                               | Match recorded path plus signed identity and installation ID; never trust name/PID alone.                                                                                                     | Leave unknown process untouched and show support blocker.                                           | Decoy binaries/processes and relocated prior versions.                                                                |
| Workbench fallback takeover    | Workbench silently starts its legacy connector while Mac Access is leader.                              | Exclusive ownership status and #704 client cutover; legacy start guarded by proven absence/relinquish.                                                                                        | Workbench shows Mac Access status or blocker; no fallback start.                                    | Start both apps in every order, crash either, upgrade/downgrade each.                                                 |

## Pairing analysis

The pairing code is public by design and therefore is not a long-term secret. It is only a short-lived rendezvous capability. Security comes from atomic one-time claim, local installation binding, broker authentication, selected customer/device confirmation in the native UI, and Keychain device-key issuance after confirmation.

The pairing UI must display the selected customer and this Mac's human-readable device name without trusting text supplied by the remote runtime. It must not display or copy raw customer IDs by default, connector URLs, IPs, ports, tokens, SSH/VNC/CDP text, or broker JSON. A code claim never changes mode directly to Full Access; explicit consent moves unpaired Off to paired Ask Every Time.

## Local code-identity analysis

The current PR #697 helper IPC uses an owner-only Unix socket, file capability token, and same-UID peer check. Those controls reduce accidental access but do not distinguish Workbench main from any other process owned by the same user that can obtain the token. Environment-provided bundle/path attribution also does not prove the caller's signature.

The target XPC boundary uses the kernel-provided audit token and Security.framework code validation for the exact connection process. PID, path, bundle ID, or environment is supplemental evidence only. Designated requirements must bind the expected release team/anchor and signing identifier. Debug/ad-hoc builds use an explicit development requirement and cannot read production Keychain items or connect to production relay authority.

Production Keychain items use an epoch group derived from the `com.evaos.mac-access.credentials` base and the `com.evaos.mac-access.connector-credential` service, are non-synchronizing and ThisDeviceOnly/WhenUnlocked, and are granted only to the production helper target accepted for that security epoch. Development uses the disjoint `com.evaos.mac-access.development.credentials` base. Menu, Workbench, Python, debug, old, and replacement-helper denial is a required installed-artifact test. Because old signed code cannot enforce a new local rule, ws-proxy #73 must reject old build/security identities and old credentials; critical rotations re-enroll into a new access group before revoking/deleting the old credential. A valid same-team signature without the exact broker-accepted build, credential epoch, helper requirement, and protected security floor is insufficient.

## TCC analysis

The frozen product identity is `com.evaos.mac-access`; the embedded helper service is `com.evaos.mac-access.helper`. The native helper is the only process permitted to call CUA frameworks, but actual macOS TCC responsibility must be verified on signed installed artifacts. Until that evidence exists, the source design must not claim that prompts or grants attach to the intended identity.

Workbench and Python must not retain direct CUA fallback after cutover. If native helper permission is missing, the only allowed response is a truthful blocked status and local System Settings handoff.

## Remote authority analysis

The ws-proxy #69 execution context signs runtime, customer, VM, binding ID/version, issue/expiry, key ID, and context ID. It intentionally does not sign a command. Mac Access therefore also requires the ws-proxy #73 Ed25519 authorization over the RFC 8785 canonical `command_authority_payload.v1`. That payload includes the entire selected tuple, session/channel generation, exact request/context digests, capability, nonce/sequence, and contained authority interval. The committed golden vector freezes canonical bytes, digest, public key, and signature. Verifying only #69 would permit a trusted runtime boundary to substitute a different command within the same short-lived context.

The connector never treats TLS, channel authentication, or a valid signature alone as permission to act. Local selected-binding equality, access mode, approval, audit health, revocation, pause, and kill switch are independent mandatory checks.

## Data minimization and retention

Persistent default data is limited to:

- Keychain device credential/key and opaque broker registration metadata;
- versioned selected-binding state and revocation tombstone;
- access configuration, policy epoch, and lifecycle state;
- redacted audit journal and updater/rollback metadata.

Full screenshots, AX trees, clipboard content, typed strings, command payloads, and raw native errors remain in bounded memory only for the shortest execution window. Crash reports and analytics must exclude them. Optional evidence artifacts require a separate design and consent; they are not implied by v0.1.

## Residual risks

- Root/admin or malicious software signed under the same permitted requirement can subvert local controls.
- macOS TCC attribution and login-item behavior may differ across supported OS versions and require installed-artifact proof.
- Broker signing-key compromise can create otherwise valid remote authority, though local policy and kill controls still apply.
- Accessibility APIs can expose sensitive UI content in memory even when persistence is forbidden.
- A user can intentionally grant Full Access; the product must make that state continuously visible and easy to stop.

These risks do not justify weaker local identity, direct networking, silent fallback, or broader logging.

## Required adversarial evidence before downstream completion

- Every negative fixture under `packages/mac-connector-core/contracts/v1/fixtures/invalid` is exercised at its declared schema or runtime gate.
- Signed-client impersonation and helper replacement matrix passes on supported macOS versions.
- Binding/signature/digest/replay/expiry/key-rotation matrix passes against source-only relay canary before deployment.
- Crash, update, downgrade, uninstall, offline, audit-failure, stop/revoke/kill races remain fail closed.
- Workbench coexistence proves one leader, channel, grant, TCC identity, audit writer, and updater.
- Redaction scan covers audit, diagnostics, crash logs, CI artifacts, PR/issue evidence, and renderer payloads.

Passing this model is necessary but not sufficient for release or customer readiness.
