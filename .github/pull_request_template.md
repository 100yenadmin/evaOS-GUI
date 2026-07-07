# Pull Request

> Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting. PRs that ignore the rules below may be closed and asked to resubmit.

## Description

<!-- Provide a clear and concise description of what this PR does and why. -->

## Related Issues

<!-- Link related issues. Use "Closes #123" / "Fixes #123" only when merge should close the issue. -->

- Closes #

## Type of Change

- [ ] `fix` - Bug fix (non-breaking change which fixes an issue)
- [ ] `feat` - New feature (non-breaking change which adds functionality)
- [ ] `perf` - Performance improvement
- [ ] `refactor` - Code restructuring (no behavior change)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] `docs` - Documentation update

## Atomic PR Checklist (Rule 1)

- [ ] This PR contains exactly one feature or bug fix that cannot be further decomposed
- [ ] The PR title follows Conventional Commit format: `<type>(<scope>): <subject>` in English

## Local Checks (Rule 2)

<!-- Run the relevant checks before pushing. CI will reject PRs that fail required checks. -->

- [ ] `bun run format` or `bunx oxfmt --check <changed files>` - formatting passes
- [ ] `bun run lint` or targeted `bunx oxlint <changed files>` - no lint errors, skip if no `.ts`/`.tsx` changed
- [ ] `bunx tsc --noEmit` - no type errors, skip if no `.ts`/`.tsx` changed
- [ ] `bunx vitest run` or focused `bun run test -- <files>` - tests pass, skip only for docs/config-only changes with explanation
- [ ] i18n validated (`bun run i18n:types` + `node scripts/check-i18n.js`) - only if renderer, locale, or i18n config changed; N/A otherwise
- [ ] New or changed user-facing text uses i18n keys; N/A otherwise
- [ ] `git diff --check` - no whitespace errors

## Runtime Verification

<!-- Which platforms or proof gates did you actually run? Leave unchecked when not applicable. -->

- [ ] Verified on macOS
- [ ] Verified on Windows
- [ ] Verified on Linux
- [ ] I have performed a self-review of my own code

## Agent Handoff

- Source repos:
- Systems touched:
- Modules/files:
- Contracts:
- Dependencies:
- Non-goals:
- Mutation boundary:
- Proof path:
- Rollback:
- Confidence gate:
  - [ ] Primitive canary
  - [ ] Scenario canary
  - [ ] Negative-path proof
  - [ ] Adversarial replay
  - [ ] Takeover packet

## Screenshots

<!-- If applicable, add screenshots to help explain your changes. -->

## Additional Context

<!-- Add any other context about the pull request here. -->

---

<!-- Commits and PR titles must not contain AI signatures such as Co-Authored-By or "Generated with". -->

**Thank you for contributing.**
