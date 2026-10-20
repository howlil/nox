# NOX CI ownership and release certification

## Ownership

GitHub Actions handles **only NOX as an Obsidian desktop plugin**: typecheck, lint, unit/integration tests, build verification, Community scanner, Windows OAuth/DPAPI and attested releases. GitHub does not build the Astro landing. Cloudflare exclusively owns `landing/` CI/CD and deployment, including any external GitHub checks it publishes.

`.github/workflows/ci.yml` ignores landing-only commits and PRs. For mixed plugin and landing commits, only the plugin runs in GitHub Actions.

## Automated release pipeline

1. A plugin change merged into `master` passes plugin CI. `Prepare release PR` selects the next SemVer bump using conventional commits.
2. The version PR synchronizes manifest, package, changelog, `versions.json` and the release plan, then must pass `release-certified`.
3. Release certification includes policy checks, Linux reproducible artifacts, Windows provider/DPAPI and Node HTTPS/SSE regression tests, and the upstream Obsidian scanner with `strict: "true"`. A finding that fails strict mode blocks publication.
4. After the release PR merges, `.github/workflows/release.yml` rechecks the exact merged source SHA, then builds, attests and validates the three assets (`main.js`, `manifest.json`, `styles.css`).
5. A pending draft can be refreshed by merging another reviewed plugin fix. The workflow updates its target to the **new** source SHA and replaces only the unpublished assets. It re-downloads them, byte-compares them against the candidate build, and verifies GitHub attestation against that SHA before automatically publishing.
6. Public releases are immutable. Later fixes require a new SemVer version. If any check fails, release stays unpublished until repaired.

**Manual desktop D01–D10 acceptance is required before automatic or recovery publication.** The source-bound evidence lives in `docs/desktop-acceptance.json` and is validated by `scripts/verify-desktop-acceptance.mjs`; there is intentionally no synthetic PASS record in the repository. A CI pass alone is not native Obsidian acceptance. GitHub CI cannot guarantee all Community Directory behavior or real provider compatibility. The Community Directory performs its own separate review of published assets and source.

The fallback `publish-release.yml` workflow is a recovery-only manual dispatch that checks SHA, version and attestations. It invokes the same source-bound desktop acceptance check; manual dispatch cannot bypass that evidence.

## Community-review controls

`scripts/ci/obsidian-critical-policy.mjs` blocks direct manual settings headings. TypeScript/ESLint/CSS source checks and release artifact verification are mandatory. Both candidate and public release workflow run the Community scanner in strict mode, not advisory mode. The former 1.1.2 failure involved a manual settings heading; it is now a native `Setting.setHeading()` with an executable regression test.

## Branch protection

Require plugin CI `build` and PR title checks; release PRs additionally require `release-certified`. Do not require retired `landing` jobs or Cloudflare checks as NOX release conditions. Updating GitHub branch-protection settings, if they currently reference removed jobs, is a repository-admin action.

## Recovery

Failed check → inspect logs → fix source in a reviewed PR → retry candidate or refresh unpublished draft from new master SHA. Never overwrite a published release or bypass an attestation. A published GitHub release does not guarantee immediate Community Directory approval.
