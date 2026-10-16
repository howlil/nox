# NOX release operations

This document describes the maintainer release contract. The authoritative release
version is the `manifest.json` version in `x.y.z` format (never `v1.2.3`).
For CI ownership and recovery details see [Release CI](RELEASE_CI.md).

## State machine

```text
Feature / fix PR → CI (fast) → merge master
                          ↓
                Prepare release PR
                          ↓
                 release/x.y.z PR
                          ↓
             CI / Release certification
              ├─ Obsidian advisory scan + blocking P0
              ├─ Linux reproducible artifacts
              └─ Windows OAuth / DPAPI
                          ↓
                  review + merge
                          ↓
         source SHA verified + release draft
          ├─ Linux checks + attestation
          ├─ Windows tests
          └─ Community scanner (advisory)
                          ↓
          desktop test of exact draft assets
                          ↓
       explicit Publish approved Obsidian release
             (SHA + version + approval)
                          ↓
                 public GitHub Release
```

**Merging a release PR cannot make a GitHub Release public.** It only prepares
a verified draft. Publication requires an explicit manual workflow run and
evidence of desktop acceptance. Published version binaries must never be replaced.

## Repository settings (one-time manual setup)

1. Allow GitHub Actions to create release pull requests using its token.
   GITHUB_TOKEN-created PR checks may require approval before they run.
2. Protect `master`: require a PR and green `CI` jobs
   (notably `build`, `landing` and `pr-title` on PRs). For
   `release/*` candidates require successful `release-certified`
   on the real pull_request SHA. Dispatched workflow checks are supplemental,
   not a substitute for required PR checks. A single ruleset applying the release
   check to all development PRs is unsuitable because it is skipped on normal PRs.
3. Configure Environment `public-release` with a required reviewer
   (and a second maintainer if enabling prevent-self-review). Without that
   configuration, the explicit publish checkbox is still necessary but
   does not constitute independent review.
4. Test Obsidian desktop using an isolated test vault, a supported Obsidian
   version, and exact GitHub release assets. Record OS, Obsidian version, full
   merged SHA, version, settings, provider login, streaming, editor approval,
   persisted sessions, and popout behavior.
5. Review [Obsidian developer policy](https://docs.obsidian.md/community-directory/developer-policies)
   and [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins).

Environment protection and branch rules are GitHub repository settings: adding
workflow YAML alone does not activate those protections.

## Automatic release candidate preparation

The `Prepare release PR` workflow remains triggered after a successful
`CI` run on a push to `master`. It selects the version from conventional commits
and creates `release/x.y.z` with synchronized `package.json`,
`manifest.json`, `versions.json`, `CHANGELOG.md` and
`.release-plan.json`.

`GITHUB_TOKEN`-created PRs can be approval-gated by GitHub. The prepare
workflow also explicitly dispatches `ci-release.yml` on the candidate
branch. That dispatch verifies the branch but does not itself satisfy the
pull_request required check. Reviewers must verify the candidate SHA
before merging.

Conventional commits drive version selection:
- `feat:` → minor
- `fix:`, `perf:`, `refactor:`, `build:` → patch
- breaking change → major
- docs / tests / CI-only changes → no release by default

Manual recovery: Actions → Prepare release PR → Run workflow, on master.
Do not overwrite an existing release branch, tag or published asset.

## Draft creation after merge

`.github/workflows/release.yml` detects a merged release plan.
Linux validates code and metadata, then attests the three exact plugin
distribution assets. Windows validates native OAuth, DPAPI, and inference.
The upstream Community scanner runs separately and remains advisory for
historical warnings; the P0 Settings heading rule is a blocking AST check.

The workflow verifies attestations and creates a GitHub Release **draft** with:
`main.js`, `manifest.json` and `styles.css`.
No step publishes it automatically.

Use a disposable Obsidian vault and test those exact draft assets. Do
not substitute the source archive or a separate local build. Record
acceptance evidence before issuing the manual publication command.

## Manual public publication

Run GitHub Actions → **Publish approved Obsidian release** from the workflow on
`master` and supply the **approved earlier merged commit SHA**. The job checks
out that exact SHA, even if `master` has advanced during desktop acceptance. Supply:
- `version`: exact version (e.g., `1.1.3`)
- `expected_sha`: full 40-character merged commit SHA
- `desktop_acceptance`: only set true after the actual desktop check

The job checks out the approved SHA, verifies the draft targets that SHA,
requires exactly three expected assets (no unverified extras), and checks
that each asset's GitHub attestation was generated for that same source SHA.
It then publishes the *existing* draft.

To verify provenance locally:
```sh
gh attestation verify main.js --repo howlil/nox
gh attestation verify manifest.json --repo howlil/nox
gh attestation verify styles.css --repo howlil/nox
```

If any check fails, leave the draft unpublished and correct the source
and candidate version. Do not force-publish or mutate a published binary.

## Distribution versus marketing deployment

The Astro landing in `landing/` is built independently by
Cloudflare Workers Builds. NOX GitHub Actions does not deploy it. Landing
runs a separate Dev CI job for typechecking, lint and Astro build, but
is not shipped as an Obsidian plugin artifact.

A public GitHub Release does not automatically submit a new plugin to
the Obsidian Community Directory. Initial submission and any reviewer
responses are handled via [Obsidian Community](https://community.obsidian.md).
Future published versions are discovered through the version/tag and assets.

## Invariants

- Never publish from a feature branch or unverified candidate SHA.
- Never report an advisory scanner run as zero remaining warnings.
- Never publish a draft before exact-artifact desktop acceptance.
- Never replace already-public main.js, manifest.json or styles.css.
- Keep all external provider, permission and privacy changes documented in
  the same feature PR.
