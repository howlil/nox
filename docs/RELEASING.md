# NOX release operations

The authoritative release version is `manifest.json` in `x.y.z` format. See [CI ownership and recovery](RELEASE_CI.md).

## Workflow — public manifest parity

```text
Feature/fix PR → plugin CI → merge code to master (manifest stays at published tag)
  → prepare release/x.y.z branch + changelog/manifest/package/versions
  → release-certified candidate (Linux, Windows, Community policy)
  → run real native Obsidian Desktop D01–D10 on candidate
  → record reviewable D01–D10 evidence on release branch
  → Actions > Verify and publish Obsidian release > Run workflow
      choose branch release/x.y.z
  → validate source SHA, native acceptance, signed attestations and assets
  → publish PUBLIC GitHub Release tagged exactly x.y.z (no v prefix)
      containing exactly main.js, manifest.json, styles.css
  → public-release-parity check succeeds on candidate PR
  → merge version metadata into master
  → Obsidian Community Directory scans a published/installable version
```

**Non-negotiable invariant:** the version in `master/manifest.json` must always
already exist as a public GitHub Release with matching unprefixed tag and three
nonempty plugin assets. PR CI enforces this with
`node scripts/ci/check-public-release.mjs` using the GitHub Releases API.
The check rejects absent or draft releases, prereleases, prefixed tags, and
missing or unexpected assets. Never merge a version bump before its public
release is published.

The release workflow supports an explicit `workflow_dispatch` from
`release/x.y.z` before merge; it validates that branch's exact HEAD SHA,
build attestations and real Obsidian acceptance. No synthetic D01–D10 evidence
is allowed. The existing `master` release trigger remains for compatible
recovery and skips already published versions. Publishing a release does not
automatically merge a PR: merge only after its public-parity check becomes
green (re-run the GitHub PR check after publication if required).

**Recovery from mismatched versions:** restore only the public version
metadata in `master` to the last published version while keeping the staged
new release branch intact; never rewrite an already published GitHub Release
or mark a native test passed without actually running it. This is the
repair for the 2026-10-20 case (`master=1.3.1` but last public
release `1.3.0`).

## Ownership and scope

NOX GitHub Actions are plugin-only. `landing/` builds and deployment, including their external GitHub checks, are owned by Cloudflare and must not be recreated as GitHub CI jobs. Landing-only changes do not trigger plugin CI.

## Release preparation

`Prepare release PR` runs after successful plugin CI on `master` and derives a SemVer version on a staging branch from conventional commits: `feat` for minor; `fix`, `perf`, `refactor`, `build` for patch; breaking changes for major. The release PR updates `manifest.json`, `package.json`, `versions.json`, `CHANGELOG.md` and `.release-plan.json`.

The candidate must pass Obsidian Community scanning, Windows native-provider and Node HTTPS/SSE tests, policy checks, deterministic production build, and real native desktop acceptance before it can be published. A version-bump PR stays unmerged until the matching public release with the three validated assets exists.

## Release and recovery

Select `release/x.y.z` in the `Verify and publish Obsidian release`
workflow's **Run workflow** control. The workflow enforces a matching
`release/x.y.z` ref, verifies native D01–D10 acceptance, builds from that
branch, checks attestations and SHA-256 of exactly three uploaded artifacts,
and publishes the exact `x.y.z` GitHub tag. Once publication is confirmed,
re-run PR CI if necessary and merge that release PR into `master`.

The `publish-release.yml` workflow is a recovery-only manual route for a
verified **draft**: it validates the explicit SHA, all assets and desktop
acceptance. It cannot bypass missing acceptance. Published release assets
must never be replaced. The Obsidian Community Directory performs an
independent review; successful local or hosted CI does not guarantee approval.

## Security invariants

- Never publish feature-branch bytes or different asset hashes than the attested source build.
- Never publish with a failing strict Community scanner or Windows release gate.
- Never publish with missing or extra assets; only `main.js`, `manifest.json` and `styles.css` are allowed.
- Never replace an already-public release.
- Never report mocked tests as an actual Obsidian desktop acceptance result.
- Never merge a manifest version absent from public GitHub Releases. A complete public release must exist before version metadata reaches master.
