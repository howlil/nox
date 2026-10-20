# NOX release operations

The authoritative release version is `manifest.json` in `x.y.z` format. See [CI ownership and recovery](RELEASE_CI.md).

## Workflow

```text
Obsidian plugin fix/feature PR → plugin CI → merge master
    → Prepare release PR → release/x.y.z candidate
    → release-certified (Community scan, reproducible build, Windows OAuth/Node HTTPS)
    → native Obsidian D01–D10 evidence recorded for tested source
    → merge candidate → revalidate exact master SHA + native acceptance
    → attest main.js, manifest.json, styles.css
    → create/refresh unpublished draft
    → download, byte-compare and verify remote artifact attestations
    → publish GitHub Release automatically
```

A release blocks on failed automated checks **and** missing native Obsidian D01–D10 acceptance. The normal publication and recovery workflows run `scripts/verify-desktop-acceptance.mjs` against `docs/desktop-acceptance.json`. This record is supplied only after a real disposable-vault desktop test, includes ten evidence links, and must refer to an ancestor of the source being published with no intervening runtime/release-critical code changes. Absence or stale evidence means the release remains unpublished. Unit tests cannot produce this record. Obsidian Community Directory performs an independent review; Actions do not guarantee upstream acceptance.

## Ownership and scope

NOX GitHub Actions are plugin-only. `landing/` builds and deployment, including their external GitHub checks, are owned by Cloudflare and must not be recreated as GitHub CI jobs. Landing-only changes do not trigger plugin CI.

## Release preparation

`Prepare release PR` runs after successful plugin CI on `master` and derives a SemVer version from conventional commits: `feat` for minor; `fix`, `perf`, `refactor`, `build` for patch; breaking changes for major. The release PR updates `manifest.json`, `package.json`, `versions.json`, `CHANGELOG.md` and `.release-plan.json`.

The candidate must pass Obsidian Community scanning, Windows native-provider and Node HTTPS/SSE tests, policy checks and deterministic production build. Do not merge a failing release candidate.

## Release and recovery

The `.github/workflows/release.yml` workflow runs from `master`, rebuilds the exact source, checks all proof stages and publishes only remote assets that match the local build and source-digest attestation. If a version already has an unpublished draft, a later plugin fix merged into `master` refreshes that draft's asset bytes and source SHA before publishing. Published assets must not be mutated.

For an interrupted publication after a verified draft, `publish-release.yml` provides a recovery-only manual route using an explicit full source SHA, version and attestation checks; recovery still requires the same recorded desktop acceptance; it cannot bypass native testing.

Check real Obsidian Community review status after publication. If upstream reports a blocking failure, fix the root cause and issue a new patch release. The Directory may show warnings on source code or legacy CSS that do not indicate a failure in compiled assets; categorize these rather than suppressing them without evidence.

## Security invariants

- Never publish feature-branch bytes or different asset hashes than the attested source build.
- Never publish with a failing strict Community scanner or Windows release gate.
- Never publish with missing or extra assets; only `main.js`, `manifest.json` and `styles.css` are allowed.
- Never replace an already-public release.
- Never report mocked tests as an actual Obsidian desktop acceptance result.
