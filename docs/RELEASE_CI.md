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

Require `build`, `pr-title`, `public-release-parity`, and `release-certified`
from GitHub Actions on PRs into `master`. Enable these repository settings
only after the updated workflows have run and all four check names exist.
Require PRs and block force pushes and deletion of `master`; keep any
administrator recovery bypass explicit. Settings require administrator access.

Both CI workflows run for every PR. The diff classifier uses base/head commit
SHAs, manifest version changes and release-policy paths as well as branch names.
Landing-only PRs get a lightweight `build` result; master pushes run the full
plugin suite. `release-certified` explicitly reports that certification is
unnecessary for an ordinary diff, or requires successful Linux artifacts,
Windows provider proof and Community policy for a release-sensitive diff.
Failed classification, cancellation or an unexpectedly skipped proof blocks
the final check. Cloudflare remains responsible for landing builds/deployment.

`public-release-parity` always runs independently, including on `release/*`
PRs. An unpublished candidate can finish certification while parity correctly
blocks merging its version metadata. After explicit publication, re-run the
failed parity job on the unchanged candidate; publication itself does not
refresh the PR check. Re-certify after any candidate source change.

Plugin CI uses `.node-version` and the root `packageManager` pin. Release
preparation, staging and publication share those pins. These workflows do not
automatically publish when code merges to `master`.

## Recovery

Fix a candidate branch and re-run certification. Refresh only unpublished
drafts. Never change existing public release assets or bypass provenance
verification.
