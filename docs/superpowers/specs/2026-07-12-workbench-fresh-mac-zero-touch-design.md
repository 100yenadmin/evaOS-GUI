# Workbench Fresh-Mac Zero-Touch Design

Status: proposed for written-spec review

Date: 2026-07-12

GitHub: [#662](https://github.com/100yenadmin/evaOS-GUI/issues/662), bridge producer [evaos-desktop-bridge#310](https://github.com/electricsheephq/evaos-desktop-bridge/issues/310), companion [#655](https://github.com/100yenadmin/evaOS-GUI/issues/655), parent [#623](https://github.com/100yenadmin/evaOS-GUI/issues/623), contract tracker [#480](https://github.com/100yenadmin/evaOS-GUI/issues/480)

## Outcome

A customer installing evaOS Workbench on a pristine supported Mac must not need Homebrew, host Python, pip, terminal commands, or prior private-network state. Workbench must provide one guided setup flow and must not report end-to-end readiness until the exact active customer, device, and grant pass the canonical broker/runtime Mac-control tools.

The design preserves the existing broker, Headscale ACL, connector, TCC, stop/revoke, kill-switch, diagnostics, app identity, updater, no-ACP, and redaction contracts. CUA remains the preferred action engine when available; its absence does not affect pairing and must use the bundled Peekaboo fallback.

## Decision

### Selected approach: frozen self-contained bridge payload

The Desktop Bridge producer will build a pinned macOS arm64 **one-directory frozen payload**. Its root `evaos-desktop-bridge` entry point is an arm64 Mach-O executable; its private runtime, Python modules, GUI fallback dependencies, libraries, and licenses live beside it under the payload directory. Workbench consumes that payload as an opaque, immutable resource at the existing `Contents/Resources/Bridge/` path.

The producer build must pin the complete CPython, freezing-tool, bridge-source, PyObjC, GUI fallback, and transitive dependency set in a checked-in lock/manifest. It must use a one-directory form, not a one-file extractor, so code signing, notarization, runtime paths, and TCC identity remain inspectable inside the app bundle. The first producer PR chooses and freezes the exact toolchain through its own current-head review; later Workbench code must rely only on the payload contract, not on a specific freezer implementation.

### Alternatives considered

1. **Pinned relocatable Python plus shell launcher:** viable fallback if the frozen payload cannot be produced, but it leaves more interpreter/dylib relocation, signing, license, and manifest surface inside Workbench. It must never search host paths.
2. **Guided installation of host Python/Homebrew/pip:** rejected. It improves instructions but does not make Workbench self-contained and repeats David's failure mode.
3. **Immediate Swift/native rewrite of the entire bridge:** rejected for the P0 because it broadens scope and delays customer recovery. A later native rewrite may replace the frozen payload without changing the Workbench contract.

## Architecture

### 1. Desktop Bridge artifact contract

The bridge repository owns production of a versioned payload containing:

- `evaos-desktop-bridge`: executable arm64 Mach-O root entry point;
- private runtime/library directories required by every supported bridge command;
- bundled GUI fallback dependencies currently represented by the bridge's `gui` dependency set;
- licenses and an artifact manifest;
- source commit, immutable build-tool/dependency lock identity, target OS/architecture, root executable digest, payload digest, and bridge version.

Required producer smoke runs in a scrubbed environment with no Homebrew or system-Python dependency and exercises `--version`, JSON status, connector status/startup preflight, and a non-destructive fallback-capability probe. It must not exercise customer control or expose connector material.

### 2. Workbench packaging consumer

`scripts/prepareEvaosDesktopBridgeResource.js` stops generating the release-mode host-Python wrapper. It accepts only a pinned payload directory/archive plus expected immutable identity, copies the whole payload to `resources/Bridge`, and records the producer identity in the existing Bridge manifest.

Strict release preparation and post-pack validation must fail when:

- the root bridge is a script or is not Mach-O;
- architecture does not match the target;
- requested source/artifact identity or digest is missing/mismatched;
- required payload files or licenses are absent;
- the root bridge or a nested executable/library escapes signing verification;
- the payload contains a host-Python/Homebrew fallback path;
- a placeholder or mutable source ref is used.

`electron-builder` continues copying `resources/Bridge` as `extraResources`; the bridge does not move into AionCore managed resources and does not change the no-ACP contract. `afterSign` verifies the root bridge and every nested Mach-O against the expected Developer ID Team ID before notarization.

### 3. Private-network client contract

Workbench standardizes the customer path on Tailscale's signed Standalone macOS variant, which Tailscale currently recommends over the App Store and CLI-only variants. An already-installed compatible App Store variant is supported, but Workbench must detect the variant and must never install both variants on one Mac. The unattended CLI-only `tailscaled` variant is not a customer onboarding target.

When the client is missing, the Workbench release manifest supplies an approved vendor package URL, exact version, digest, signing identity, and license/source notice. The **Install secure network** action downloads to a temporary private location, verifies the pinned identity, and opens the normal macOS installer. Workbench does not bypass Installer, VPN, system-extension, administrator, Touch ID, or System Settings consent. It deletes temporary material after success or cancellation and then re-probes the installed app.

The main process locates the installed standalone or App Store bundle, invokes its bundled CLI through an explicit absolute path, and uses structured status output—not only the presence of a `100.x` interface—to classify state. It may prompt the client to install/approve its VPN or system extension through the vendor-supported flow. It never asks the customer to install CLI integration or type a terminal command.

For Headscale enrollment, a user click authorizes a main-process call using the authenticated broker session. The main process invokes the vendor client with the approved custom login server and either an interactive browser login or a single-use short-lived enrollment key. The server URL and enrollment material never cross into renderer state or logs. Existing broker/support services remain responsible for minting, binding, expiring, and revoking enrollment material.

Primary behavior references: [Tailscale macOS installation](https://tailscale.com/docs/install/mac), [Tailscale macOS variants](https://tailscale.com/docs/concepts/macos-variants), [Tailscale CLI](https://tailscale.com/docs/reference/tailscale-cli?tab=macos), and [Headscale Apple clients](https://headscale.net/stable/usage/connect/apple/).

### 4. Typed prerequisite model

The existing `evaos.native_companion_status.v1` response gains optional, backward-compatible prerequisite details instead of replacing the schema:

```ts
type NativeCompanionPrerequisites = {
  bridgeRuntime: 'missing' | 'incompatible' | 'ready' | 'error';
  privateNetwork:
    | 'client_missing'
    | 'client_stopped'
    | 'unenrolled'
    | 'wrong_control_plane'
    | 'acl_blocked'
    | 'offline'
    | 'online'
    | 'error';
  actionEngine: 'cua_ready' | 'peekaboo_ready' | 'native_fallback_ready' | 'unavailable';
};
```

The main process owns probing and classification. The renderer receives typed, redacted state only—never private addresses, control-plane URLs, enrollment credentials, or raw command output. Existing broad `secure_network_link_required` remains as a compatibility summary, while the optional prerequisite state selects precise copy and actions.

### 5. Guided recovery actions

Workbench presents the first unmet prerequisite with one primary action:

| State | Customer action | Workbench behavior |
| --- | --- | --- |
| Bridge missing/incompatible | Reinstall/Update Workbench | Open the approved updater or public artifact; never request Python |
| Network client missing | Install secure network | Open the approved macOS installation surface and recheck after installation |
| Network client stopped | Open secure network | Open/activate the client and recheck |
| Unenrolled | Connect this Mac | Request short-lived broker-owned enrollment material only after the click; keep it in the main process and redact all output |
| Wrong control plane | Reconnect correctly | Fail closed, revoke unusable pending material, and run the approved re-enrollment flow |
| ACL blocked/offline | Retry or contact support | Report the exact layer without displaying addresses or ACL contents |
| CUA absent, Peekaboo ready | Continue | Mark CUA optional and automatically select bundled Peekaboo |
| No action engine | Repair Workbench | Fail before pairing/control, with a precise packaged-resource error |

The first release does not silently install system extensions or enroll a Mac without a user click. Any privilege or macOS VPN approval remains an unavoidable signed OS prompt for the correct identity.

### 6. Readiness composition

The product keeps these gates separate:

```text
installed app
→ self-contained bridge runnable
→ action-engine fallback available
→ TCC permissions correct
→ private network online and correctly enrolled
→ connector authenticated/reachable
→ broker grant active for exact identity
→ VM runtime/plugin configured
→ customer_mac_status succeeds
→ desktop_control_status succeeds
→ desktop_see succeeds
→ end-to-end ready
```

Local readiness may show progress but cannot produce the green end-to-end label. #655 remains the companion exit gate for exact-candidate, exact-identity live proof.

## Process And Data Flow

1. Main process resolves the bundled bridge at the existing resource path and runs a safe version/status preflight.
2. Main process probes the installed network client through explicit approved paths and maps output/errors to the typed prerequisite state.
3. Existing IPC/preload status transport carries only the backward-compatible redacted status object.
4. The renderer view model selects the first blocking prerequisite and corresponding i18n key/action.
5. A user action returns to the main process through the existing native-companion action bridge.
6. Enrollment material, if needed, is obtained through the authenticated broker session, used once in the main process, and never persisted in renderer state, logs, issue evidence, or analytics.
7. Status refreshes after each action. End-to-end readiness remains controlled by exact live runtime-tool proof.

## Error And Security Behavior

- Missing or incompatible bundled runtime is a release/package defect, not a customer prerequisite.
- Unknown network output maps to `error`, not `online` or `ready`.
- Stale/pending devices or grants cannot win selection over the exact active identity.
- Enrollment expiry, wrong control plane, ACL denial, offline peer, broker expiry, and runtime-tool failure remain distinct.
- Stop/revoke/kill-switch and offline transitions immediately clear live-ready state and fail closed.
- No issue, PR, test artifact, screenshot, log, diagnostic packet, or analytics payload may contain enrollment material, connector URLs, private addresses, ports, customer data, raw command output, or credentials.

## Atomic Delivery Sequence

### PR A — Desktop Bridge frozen payload producer

Owner repo: `electricsheephq/evaos-desktop-bridge`, issue [#310](https://github.com/electricsheephq/evaos-desktop-bridge/issues/310).

- Add the pinned one-directory macOS arm64 producer and immutable manifest.
- Include all normal and GUI fallback dependencies and licenses.
- Prove scrubbed-environment non-destructive commands.
- Publish only a reviewed candidate artifact; no Workbench/customer claim.

### PR B — Workbench strict payload consumption

Owner repo: `100yenadmin/evaOS-GUI`.

- Add failing tests that strict release mode rejects the current shell bridge.
- Consume and manifest the pinned payload.
- Enforce architecture/digest/license checks in prepare, after-pack, after-sign, Functional Smoke, and release-asset inspection.
- Keep UI, private-network onboarding, and readiness behavior out of this PR.

PR A and PR B may be developed in parallel against a fixture contract, but PR B cannot merge as a host-Python-removal claim until the real PR A artifact is pinned and its CI path is green.

### PR C — Typed prerequisite classification

- Add optional shared prerequisite types and pure classifiers.
- Cover missing/stopped/unenrolled/wrong-control-plane/ACL/offline/online/error states.
- Preserve compatibility summary reasons and broker/connector contracts.

### PR D — Guided actions and localized UX

- Add the minimum main-process actions and renderer recovery mapping.
- Reuse existing IPC/native-companion boundaries.
- Add every new key to every configured locale and regenerate types.
- Preserve explicit user approval for install/enroll operations.

### PR E — Clean-host and pristine-Mac gates

- Functional Smoke verifies Mach-O shape, architecture, signing, manifest identity, and safe startup with scrubbed `HOME`, `PATH`, and Python variables.
- Run supported-version clean-host lanes; Sonoma-only smoke is not supported-version proof.
- Run the exact signed/notarized candidate on a genuinely pristine supported Mac and separately on the prepared upgrade canary.
- Then execute #655 canonical live tools, approved low-impact action, stop/revoke, kill-switch, reboot/offline recovery, RC, update metadata, public URL, installed-app, dashboard-launch, and customer setup proof.

## Test Strategy

The first RED test is the current release-packaging contradiction: strict macOS packaging must reject a shell root bridge even when Peekaboo and the helper are native.

```bash
bunx vitest run tests/unit/bootstrap/afterPackBundledResources.test.ts \
  -t "rejects a script desktop bridge for release-mode macOS builds"
```

Additional focused suites cover payload copy/manifest identity, architecture mismatch, digest mismatch, missing nested dependency, signature identity, scrubbed-environment startup, each private-network state, CUA absence with Peekaboo fallback, stale/pending identity selection, exact runtime proof, stop/revoke/kill-switch, and offline/reboot recovery.

Broad checks and app builds run in GitHub Actions. Local checks remain focused in the isolated Lexar worktree.

## Proof Boundaries

- Unit tests prove source contracts only.
- Functional Smoke proves packaged resource shape and safe non-TCC startup for one named artifact only.
- Signing/notarization proves artifact identity, not permissions or Mac control.
- Prepared-Mac proof establishes upgrade/non-regression only.
- Pristine-Mac proof establishes clean onboarding only.
- Customer readiness requires pristine onboarding plus #655 exact-target live proof for the same signed candidate, followed by distribution and customer setup proof.

## Non-Goals

- No broad rebase or upstream UI port.
- No transport redesign, public connector endpoint, or Headscale ACL weakening.
- No Tailscale/Headscale replacement decision.
- No removal of Peekaboo fallback.
- No broad #480 contract refactor.
- No changes to Matt's setup.
- No release, updater, dashboard publish, customer send, or customer-ready claim during PR A–D.
