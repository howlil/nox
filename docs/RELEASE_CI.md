# NOX CI ownership and release certification

GitHub Actions handles Obsidian plugin typecheck, lint, architecture, unit and
integration tests, Linux artifact reproducibility, Windows OAuth/DPAPI and
provider transport regressions, and upstream Community policy. Cloudflare
exclusively owns `landing/` deployment.

## Source-bound publication

1. Code merges into `master` after plugin CI without advancing the public
   manifest version prematurely.
2. Manually dispatch `Prepare release PR` from `master` (default `auto`
   derives SemVer from conventional commits; explicit overrides are available).
   The checkout is pinned to the dispatch SHA and a fresh `master` ref check
   rejects stale preparation before publishing `release/x.y.z`, with
   synchronized version metadata, changelog and release plan.
3. `ci-release.yml` certifies the exact candidate SHA (Linux reproducible
   plugin assets, Windows provider transport, Community scanner and policy).
4. Explicitly dispatch `.github/workflows/release.yml` on the certified
   `release/x.y.z` branch **before merging version metadata**.
5. Publication verifies SHA, signed attestations, uploaded digests and the
   exact `main.js`, `manifest.json`, `styles.css` allowlist.
6. The public GitHub Release must exist before the version PR can merge
   into `master`; live public-release parity is blocking.

`publish-release.yml` is a recovery-only workflow that requires the explicit
source SHA and an existing draft with verified assets and attestations.
Published releases are immutable.

Routine `master` pushes no longer run the release-preparation or publication
workflows. `stage-release-draft.yml` is also manual-only. Candidate CI,
attestations, Windows verification and signed-asset checks remain mandatory
for real releases.

The historical D01–D10 human evidence gate has been retired. CI alone does
not certify live Obsidian behavior, provider credentials, or Community
Directory approval.

## Branch protection

Require plugin `build` and PR title checks, and `release-certified` for
candidate release PRs. Do not require retired landing or desktop-acceptance
jobs. Repository branch-protection settings may require administrator access.

## Recovery

Fix a candidate branch and re-run certification. Refresh only unpublished
drafts. Never change existing public release assets or bypass provenance
verification.
