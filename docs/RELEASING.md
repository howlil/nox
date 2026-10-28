# NOX release operations

The authoritative version is `manifest.json` in `x.y.z` format.
See [CI ownership and recovery](RELEASE_CI.md).

## Publication workflow

```text
Feature/fix PR → plugin CI → merge code to master (unchanged public manifest)
  → manually dispatch Prepare release PR on master (auto SemVer by default)
  → guard dispatch SHA against current master before creating release/x.y.z
  → release-certified (Linux reproducibility, Windows providers, Community scanner)
  → explicitly dispatch publication on release/x.y.z
  → validate current source SHA, signed attestations and SHA-256 asset allowlist
  → publish PUBLIC GitHub Release x.y.z containing exactly three plugin assets
  → public-release-parity check succeeds for version PR
  → merge version metadata to master
```

**Invariant:** `master/manifest.json` must always refer to an already-public
non-draft GitHub Release with the exact unprefixed tag and three valid assets:
`main.js`, `manifest.json`, `styles.css`. PR CI verifies the live release.
Do not merge a manifest version that has not been published.

Candidate publication requires an explicit workflow dispatch against
`release/x.y.z`, source SHA identity, Linux/Windows release certification,
Community scanner, signed build attestations, exact artifact digests and
strict asset allowlist. The publication workflow has no master-push
trigger: ordinary development merges cannot invoke it.

**The former D01–D10 desktop acceptance gate is retired.** CI does not prove
live Obsidian UI interactions, real provider entitlement or Community Directory
approval. Document manual smoke testing accurately if performed; it is not a
required release attestation.

## Ownership

GitHub Actions owns the NOX plugin release; Cloudflare owns the `landing/`
deployment. Explicitly dispatch `Prepare release PR` on `master`: the default
`auto` option infers SemVer from conventional commits and skips unchanged
releases; `current`, `patch`, `minor`, and `major` are explicit overrides.
Preparation uses the dispatch commit SHA and refuses to create a release
branch if `master` has moved. The workflow synchronizes `manifest.json`, `package.json`, `versions.json`,
`CHANGELOG.md`, and `.release-plan.json` on the release branch.
The standard plugin CI remains on PRs and `master`; superseded PR runs
are canceled to save runner time. Cosmetic architecture graphs are available
on demand via `pnpm architecture:graph`, not generated on every CI run.

## Recovery and security

`publish-release.yml` is a manual recovery path for an existing draft,
requiring the explicit approved source SHA, complete three-file allowlist,
signed artifact provenance and release metadata consistency.

Never replace an already-public release, bypass release certification,
publish from an unverified source, or place unpublished version metadata
on `master`.
