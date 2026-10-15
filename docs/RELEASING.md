# Release and Community Directory operations

This is the **maintainer how-to**, not a user installation tutorial. The authoritative version is `manifest.json` and every public GitHub Release tag must be exactly `x.y.z` without a `v` prefix.

## State machine

`feature PR → master (no public release) → Prepare release PR → review + CI + desktop acceptance → merge to master → Linux + Windows release gates → draft release with three assets → verify → publish → Obsidian update`

Normal merges never publish a release. The latest merge must change `.release-plan.json` and pass metadata checks; the publishing workflow checks this before doing expensive builds.

## One-time setup

1. Merge the community readiness PR **only after** reviewing the proposed MIT license, dependencies/attribution, minimum Obsidian desktop version, and migration behavior.
2. In **GitHub → Settings → Actions → General**, enable Actions write permission and **Allow GitHub Actions to create and approve pull requests** if the automated preparation job reports insufficient permissions. Do not use an unrestricted personal access token just to bypass settings.
3. Protect `master` using a branch ruleset: require pull requests and passing CI jobs **build** and **windows-dpapi**; prevent force pushes and tag rewrites where available. These settings must be applied in the repository UI and are **not** created by source files.
4. Test a fresh install using only the official three assets on a supported Obsidian desktop. Recheck real provider connectivity, note read/write approval, and credential logout. CI cannot replace this acceptance test.
5. Review [Obsidian policy](https://docs.obsidian.md/community-directory/developer-policies) and [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins).

## Prepare a version PR

Go to **GitHub → Actions → Prepare release PR → Run workflow**, select branch `master` and bump:

| Choice | When | Example from 0.1.0 |
| --- | --- | --- |
| `current` | First public release only, when no version tags exist | 0.1.0 |
| `patch` | Backward-compatible bug or behavior fix | 0.1.1 |
| `minor` | Backward-compatible user feature | 0.2.0 |
| `major` | Breaking changes, including data migration | 1.0.0 |

The workflow updates `manifest.json` and `package.json` together, generates a [changelog](../CHANGELOG.md) section from conventional commit subjects, maintains [versions.json](../versions.json) for Obsidian compatibility, records `.release-plan.json`, creates a `release/<version>` branch, and opens a reviewable PR. If GitHub forbids bot-created PRs, change repository Actions permissions and rerun. Existing release branches/tags are not overwritten.

The release PR must be manually reviewed/merged. Before merge, confirm a disposable-vault installation, three assets, the exact version, license/credit notices, security/privacy policy, provider connectivity, and any backwards compatibility change. Add manual evidence to the PR.

## Automated publish

When the **release PR** merges, `Publish Obsidian plugin` runs on `master`. It:

1. Confirms the latest commit changed the release plan and the versions/changelog match.
2. Runs Linux `pnpm verify` plus documentation and release checks.
3. Runs Windows OAuth, DPAPI, and inference regression tests.
4. Downloads **the tested build** and creates a **draft** GitHub Release tagged `x.y.z` (no `v`).
5. Verifies `main.js`, `manifest.json`, `styles.css` assets, then publishes the draft.

Failures stop before public publication. A rerun can resume an existing draft, while a previously published release is left alone. Do not push tags directly to produce a release. Use **Run workflow** on the publishing workflow for recovery only when the last master commit still contains a release-plan change.

## First Community submission

A GitHub Release **does not** submit the plugin to Obsidian. Sign in at [Obsidian Community](https://community.obsidian.md), connect GitHub, submit `https://github.com/howlil/nox`, and handle automated reviewer feedback. The submission uses the **default-branch HEAD manifest** and downloads the three matching release assets. Submit only after the public release exists. Future versions do not require repeating initial submission.

## Release rules

- Never tag a feature branch or publish an incomplete bundle.
- Never change a published release's three binaries in place. Ship another version.
- Never mix historical `nox-obsidian` directories with the public `nox` installation without a backup/migration plan.
- Never imply that GitHub CI proves live OpenAI entitlements or Windows Obsidian interaction tests.
- Use Conventional Commit subjects (`feat:`, `fix:`, `perf:`, `docs:`) so changelog generation remains meaningful.
- Changelog and README statements must be supported by code/tests; disclose incomplete features or platform limits.
- Document changes to settings, storage, external providers, permissions, or vault I/O in the **same feature PR**.
- Keep release credentials scoped to `GITHUB_TOKEN` and only grant `contents: write` to the publishing job.

If the release PR is still open, nothing should be published. If a release is blocked, fix the branch via a reviewed PR rather than editing binaries inside an existing published tag.
