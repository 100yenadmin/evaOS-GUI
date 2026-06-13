# evaOS Native Companion Boundary

Issue: https://github.com/100yenadmin/evaOS-GUI/issues/133

Version: `2026-06-06.rc-parity`

## Position

AionUi is the evaOS beta shell and workflow compositor. It can render broker-provided state, request brokered actions, and show native-companion health or denial states. It is not the local trust authority for the Mac.

The evaOS native companion and broker remain authoritative for Mac pairing, TCC/local control, secure callbacks, signed helper behavior, local credential custody, and audited local machine actions. The current released Workbench app remains the fallback until exact RC candidate passes native adapter, release, rollback, and support gates.

## Ownership Matrix

| Capability                  | Owner                    | Shell may                                                                         | Shell must not                                                                                | Required proof                                                                         |
| --------------------------- | ------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `desktop-session`           | `evaos-broker`           | Show session status, request refresh, clear shell session view.                   | Mint sessions, expose tokens to renderer, log broker credentials.                             | `backend_enforced`, `audit_id`, `customer_account_id`                                  |
| `business-browser-runtime`  | `evaos-broker`           | Render status, request browser open/stop through broker actions.                  | Control customer VMs directly, reuse state across customers, expose runtime credentials.      | `backend_enforced`, `audit_id`, `source_pointer`, `customer_id`, `customer_account_id` |
| `mac-pairing-authority`     | `evaos-native-companion` | Show pairing status, open broker-provided pairing handoff.                        | Issue pairing codes, trust renderer-created pairing claims, write native pairing state.       | `native_companion_id`, `pairing_audit_id`, `broker_session_id`                         |
| `mac-tcc-prompting`         | `evaos-native-companion` | Show required permission state and setup/recovery links.                          | Prompt or bypass TCC directly, claim Accessibility or Screen Recording permission.            | `native_permission_status`, `native_permission_audit_id`                               |
| `local-input-control`       | `evaos-native-companion` | Request audited local-control actions through broker/native companion.            | Send keystrokes, move pointer, drive local UI directly from renderer or generic IPC.          | `backend_enforced`, `native_action_audit_id`, `operator_ack`                           |
| `screen-recording-control`  | `evaos-native-companion` | Display native-provided status/screenshot metadata after authorization.           | Capture pixels, stream screen content, persist screenshots without native audit.              | `native_capture_audit_id`, `customer_account_id`, `retention_policy`                   |
| `secure-callback-exchange`  | `evaos-native-companion` | Parse the beta protocol scheme, hand callback params to broker-owned claim flows. | Accept callback secrets in renderer, complete provider grants locally, cache callback tokens. | `validated_protocol_scheme`, `broker_claim_audit_id`                                   |
| `signed-helper-install`     | `evaos-native-companion` | Show helper installed/version/health status.                                      | Install privileged helpers, ad-hoc sign helper code, mutate launch services or daemons.       | `helper_team_id`, `helper_bundle_id`, `codesign_verification`, `notarization_status`   |
| `local-machine-audit-write` | `evaos-native-companion` | Display audit ids and evidence links returned by broker/native companion.         | Invent local audit events, mark local actions approved, write native audit truth.             | `append_only_native_audit_id`, `broker_decision_id`                                    |
| `local-credential-vault`    | `evaos-native-companion` | Show connected/expired/revoked status from broker/provider hub.                   | Store provider secrets, read keychain items, decrypt native callbacks or grants.              | `broker_grant_id`, `provider_audit_id`                                                 |

## Callback And Session Cache Rules

- Public beta protocol scheme is `evaos-workbench-beta`.
- Main process validates the scheme before forwarding parsed callback metadata.
- Renderer must not receive callback secrets, broker tokens, provider grant secrets, or native credential material.
- Broker owns desktop session cache truth; AionUi may render status and clear its shell-local view.
- Unknown local trust actions fail closed until the native companion contract explicitly allows them.

## Status And Handoff Matrix

The AionUi beta shell may render these status-only native companion states. It may show a handoff label and target, but Mac pairing, TCC prompts, helper state, iPhone readiness, local control, and native audit truth remain owned by the native companion or released Workbench fallback.

| State               | Source                              | Handoff                             | Shell enabled | Owner                         |
| ------------------- | ----------------------------------- | ----------------------------------- | ------------- | ----------------------------- |
| `not_installed`     | `native-companion:missing`          | Install released Workbench fallback | `false`       | `released-workbench-fallback` |
| `not_paired`        | `native-companion:pairing-required` | Open native pairing handoff         | `false`       | `evaos-native-companion`      |
| `permission_needed` | `native-companion:tcc-required`     | Open native permission handoff      | `false`       | `evaos-native-companion`      |
| `ready`             | `native-companion:ready`            | Open native companion               | `true`        | `evaos-native-companion`      |
| `unavailable`       | `native-companion:unavailable`      | Use support and rollback path       | `false`       | `released-workbench-fallback` |

The ready handoff target is `evaos-workbench-beta://native-companion/status`. It is protocol metadata for the package/protocol proof path, not proof that AionUi owns local device control.

## Legacy Local Action Fence

Public beta mode blocks legacy shell-launch and filesystem mutation endpoints by default. This includes `/api/shell/*`, `/api/fs/write`, `/api/fs/remove`, `/api/fs/rename`, `/api/fs/copy`, `/api/fs/upload`, `/api/fs/watch/*`, `/api/fs/office-watch/*`, mutating `/api/fs/snapshot/*` routes, and Office preview watch routes under `/api/ppt-preview/*`, `/api/word-preview/*`, and `/api/excel-preview/*`.

The diagnostic override `AIONUI_EVAOS_ALLOW_LEGACY_LOCAL_ACTIONS=1` is not a public beta setting. It exists only for development and migration checks while the released Workbench fallback remains available.

Read-only legacy filesystem browse/preview routes are not native-companion authority proof. They remain a final public-beta review item and must not be used to claim Mac pairing, TCC/local control, helper, credential, or local audit readiness.

## Beta Release Note

evaOS Workbench Beta is a shell/workflow compositor. Mac pairing, TCC/local control, secure callbacks, signed helpers, local credential custody, and local machine audit authority remain in the evaOS native companion and broker-backed Workbench fallback until exact-candidate native canaries pass.

## Remaining Beta Blockers

- Live native companion unavailable/denied/pending/healthy status is not yet wired into this shell.
- Signed helper identity, notarization status, and native audit append-only proof still require issue #12 packaging evidence.
- Existing upstream AionUi local-agent/file-management read-only surfaces must remain fenced by issue #3 guardrails or must be blocked before public beta.
- This issue proves the boundary contract and static fail-closed policy; it does not replace live Mac pairing, TCC, or local-control canaries.
