# NOX Dev CI, Release CI and manual publication

## CI / Dev

The existing .github/workflows/ci.yml retains its workflow name "CI" for compatibility with prepare-release.yml. Pull requests and master pushes run local fast checks: typecheck, lint, selected typed lint, targeted AST P0 policy, CSS syntax, unit/integration tests, build and artifact checks. Landing Astro retains its independent CI job and Cloudflare deployment. Windows regression, official scanner and reproducibility double-build are no longer on the ordinary PR critical path.

## CI / Release

.github/workflows/ci-release.yml handles release PRs or explicitly dispatched release candidate checks. It runs release policy and the **advisory** official Community scanner, a repeatable production build, and Windows OAuth/DPAPI tests. The release-certified check only passes if ALL three independent jobs succeed. A workflow_dispatch check does not replace a required pull_request status.

prepare-release.yml keeps its master CI-success → automatic release PR trigger. Because GitHub may require approval to run pull_request checks created by GITHUB_TOKEN, it also dispatches CI / Release for the new branch. Approve actual release PR checks before merging. Do not treat a skipped or advisory scan as certified.

## Draft and publication

1. Review and merge release/x.y.z only after its candidate checks pass.
2. .github/workflows/release.yml runs on the merged release plan: critical policy, full verification, Windows DPAPI, advisory scanner and attestation. It creates a GitHub Release DRAFT only; its code never makes the release public.
3. Download exactly the three GitHub draft assets (main.js, manifest.json, styles.css) into a disposable Obsidian desktop vault. Record the OS, Obsidian version, version/SHA, scenarios and actual outcomes. Do not test an independently rebuilt binary and call it equivalent.
4. Run .github/workflows/publish-release.yml manually from master with the approved full merged SHA and explicit desktop-acceptance confirmation. The job checks out that SHA even if master moved later, rejects unexpected assets, and verifies each asset attestation's exact source digest before publication.
5. Configure GitHub Settings → Environments → public-release with required reviewer approval. Creating the environment and repository branch rules is a GitHub settings operation, not something this source PR can enforce. Without required reviewers, the manual dispatch + explicit acceptance input still prevents push-triggered publication but is not independent approval.

For a small single-maintainer repository, prevent-self-review may block progress if enabled without another reviewer. Consider reviewer ownership accordingly.

## Scanner findings and debt

Official scanner still uses strict: false because historical warning debt is not yet formally baselined. Its successful step is NOT proof of zero findings. New P0 manual HTML headings in PluginSettingTab are separately blocked by the local TypeScript AST gate, exercised by negative regression fixtures. Other Obsidian warnings remain advisory and require owner triage.

Do not invent a warning baseline or use only a count. First capture a pinned machine-readable linter report containing rule, file and diagnostic fingerprint, then explicitly approve known findings with owners and proof before enforcing delta-based release failure. Landing source may be scanned by Community tooling despite being built separately; distinguish source policy from shipped plugin artifact.

## Recommended branch rules

Require ordinary CI jobs on all development PRs; require fresh release candidate proof before merging release/* PRs. GitHub App/PAT-created PR checks may eliminate GITHUB_TOKEN approval requirements. A workflow_dispatch run alone is not necessarily an eligible branch required check. Keep the master branch releasable, do not bypass candidate verification and do not publish if the PR state cannot be proven.

## Recovery and guarantees

- CI Dev failure: fix regression and rerun focused checks.
- CI Release failure: update candidate branch and rerun policy, reproducibility and Windows.
- Draft build failure: leave release unpublished; repair and issue a fresh candidate.
- Acceptance failure: retain draft, fix source, rebuild, and retest exact artifacts.
- SHA/version/attestation mismatch: fail closed. Never force-publish a different artifact.
- Published releases are immutable; changes require a new patch version.
