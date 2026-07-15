# ADR-0001: independent Mac product in the evaOS-GUI repository

- Status: proposed for #699; blocks implementation issues
- Date: 2026-07-15
- Decision owners: evaOS Mac Access epic #698 and architecture issue #699
- Inspected source: PR #697 head `fff813ef1da6b766ae09344b20021b4a4b0672c4`, merge `0ac9742cc8c42d777da627adb9cf4179567d1373`; PR #708 head `5b1308fadc481f83116c54de2b9713ab2363bed2`, merge `5c86e8e91660772da5b1b6f49b43f2de3afee737`; PR #709 head `f92d45f984db29c132e65f458df85567f04186ca`, merge `27b28cd234d537a491028e9024070cf8d33b9611`

## Context

The customer-facing goal is a standalone native macOS menu-bar connector that does not require evaOS Workbench. At the same time, Workbench must coexist as a client of the same connector behavior, and PR #697 establishes `100yenadmin/evaOS-GUI` as the owned connector-source repository.

The prior `electricsheephq/evaos-desktop-bridge` repository is archived. It is useful provenance but cannot remain implementation truth or return as a private build/runtime dependency. Duplicating its source into a separate Mac Access repository would immediately create two policy, audit, transport, helper, and migration owners. Keeping Mac Access inside the Workbench application target would preserve the opposite problem: Workbench would remain a customer dependency and could continue owning TCC, connector lifecycle, and release timing.

macOS code identity, TCC continuity, signing/notarization, updater metadata, rollback, and uninstall behavior are product/artifact concerns. Repository location alone neither couples nor isolates them; build graph, bundle identity, credentials, workflows, artifacts, appcasts, and release authorization do.

## Decision

Keep Mac Access and the reusable connector core in `100yenadmin/evaOS-GUI`, but ship Mac Access as an independent product.

- `packages/mac-connector-core` is the single source for versioned contracts, embedded Python behavior, native ports, and parity tests.
- `packages/mac-access` owns the native menu app, signed helper, embedded runtime resources, tests, and product-specific build scripts.
- `packages/desktop` consumes Mac Access only through the authenticated local client protocol after #704. It does not link or copy a second connector runtime into an authoritative Workbench path.
- Mac Access uses frozen bundle/helper/service identities, its own signing/notarization job, updater/appcast namespace, artifacts, release notes, rollback metadata, and installed-app proof.
- Workbench v2.1.36 and later Workbench releases retain their own independent release truth. A Mac Access change cannot edit, delay, reuse, or publish a Workbench tag, artifact, appcast, draft, or update channel.
- The archived bridge repository is never cloned by CI, referenced as a package/source URL, or loaded at runtime.

## Repository and build boundaries

Sharing a Git repository permits atomic contract changes and one review graph. It does not permit implicit product coupling.

| Surface          | Shared                                                                         | Isolated                                                                                    |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Source review    | Connector contracts/core, cross-client compatibility fixtures, ownership docs. | Product implementation PRs remain one child issue each.                                     |
| Build            | Reproducible source inputs and contract fixture generation.                    | Mac Access Xcode build, embedded runtime, entitlements, signing, notarization, packaging.   |
| Identity         | Contract constants and proof expectations.                                     | Bundle IDs, helper service, Keychain access groups, login item, TCC evidence.               |
| Release          | Repository CI conventions and exact source SHA.                                | Version, tag, release draft, artifacts, appcast, promotion, rollback, publication approval. |
| Runtime          | Workbench may query/request through authenticated local IPC.                   | Mac Access is sole connector leader, Keychain/policy/audit/TCC/CUA/transport authority.     |
| Support evidence | Redaction schema and proof taxonomy.                                           | Product-specific logs, audit IDs, installed version, artifact lineage.                      |

Root workspace tooling may discover both directories, but Mac Access release workflows must name their own paths and artifacts. A root version bump or Workbench package command must not publish Mac Access. A Mac Access updater workflow must not write Workbench metadata.

## Dependency rules

Allowed dependencies:

- Mac Access app/helper -> connector-core contracts, native ports, and packaged private Python core.
- Workbench main -> generated/local client contract adapter.
- Cross-language tests -> shared JSON fixtures.
- Broker relay -> independently versioned compatible wire schemas.

Forbidden dependencies:

- Mac Access -> Workbench renderer, Electron main, Workbench app resources, appcast, or installed app.
- Workbench renderer -> Mac Access XPC, Keychain, broker credential, raw binding, or command body.
- Connector core -> Workbench UI/lifecycle/update code.
- Any product -> archived bridge checkout, mutable private source reference, system/Homebrew Python, Tailscale, public listener, or direct connector endpoint.
- Mac Access release -> Workbench release credential namespace or publication job.

## Why this is preferable

1. A single repository makes the migration from PR #697 reviewable and prevents connector-source drift.
2. An independent product target removes Workbench from pristine-Mac onboarding and gives Mac Access a stable TCC/helper identity.
3. A shared contract package lets Workbench become a client without embedding a second authority.
4. Atomic source changes can update schemas, all consumers, fixtures, and migration docs in one graph while release gates stay independent.
5. The repository already contains Workbench source, packaging knowledge, and the owned Python bridge after #697; a new repository would add provenance and release complexity without removing runtime coupling by itself.

## Consequences

Positive:

- One connector source and threat model.
- One place to prove Workbench compatibility.
- Independent customer installation, permissions, updater, rollback, and release cadence.
- The archived repository can remain permanently non-authoritative.

Costs:

- CI and release workflows must enforce path/product isolation explicitly.
- Root workspace and code owners need clear boundaries to avoid accidental Workbench coupling.
- Native Swift/Xcode and Electron/TypeScript/Python tooling coexist in one repository.
- Version compatibility must be maintained between Mac Access, Workbench client, broker relay, and VM runtimes.

Risks and controls:

- **Accidental joint release:** separate workflows, artifact names, version files, appcasts, environments, and approval gates.
- **Shared-core breaking change:** versioned contracts, compatibility matrix, fixtures in every consumer language, unknown-schema fail closed.
- **Two runtime copies:** Mac Access is exclusive leader; Workbench client contains no authoritative connector after #704.
- **Repository size/tooling complexity:** path-filtered focused CI and the existing ten-child/pure-logic rules.
- **Premature readiness claim:** proof taxonomy in #698/#699; source, artifact, installed-app, live-control, publication, and rollout remain separate.

## Alternatives considered

### Restore or reuse the archived desktop-bridge repository

Rejected. It would reintroduce private/mutable source acquisition, split implementation truth, and contradict the explicit provenance-only constraint.

### Create a new Mac Access repository immediately

Rejected for v0.1. It would require cross-repository atomic changes for core, Workbench migration, and fixtures while PR #697 has already moved ownership here. A later extraction can be reconsidered after the public interfaces and independent release are stable; repository extraction must not change bundle/TCC identity.

### Keep Mac Access inside the Workbench app

Rejected. It fails standalone onboarding, independent release, and the single stable TCC identity goal for customers who do not need Workbench.

### Duplicate the Python connector into both products

Rejected. Even identical initial copies would create two policy/audit/transport owners and no safe coexistence or rollback authority.

### Make the broker or VM the local policy authority

Rejected. Offline local stop/revoke/kill and macOS TCC authority must remain on the Mac. Remote authority can narrow access but cannot expand local permission.

## Verification

This ADR is satisfied only when:

- code and fixtures live in the declared paths with no archived-repo dependency;
- Mac Access builds without Workbench and Workbench builds without embedding an authoritative second connector;
- product IDs, signing, notarization, appcast, artifacts, and rollback are independent;
- Workbench coexistence shows one helper/connector/TCC/audit owner;
- path/product isolation tests prove neither release workflow mutates the other;
- all named proof gates retain exact source and artifact identity.

Those are downstream acceptance gates. This ADR records the decision; it does not prove them.

## Revisit conditions

Revisit repository placement only after v0.1 has a stable public contract and independent release lineage, or if current-code evidence proves repository tooling makes isolation impossible. Any move must preserve the frozen app/helper/service identities, Keychain/TCC continuity, selected-binding protocol, audit state, updater trust, and Workbench client compatibility. It cannot be used to revive the archived bridge as authority.
