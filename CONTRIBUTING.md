# Contributing to Nox

Nox is an Obsidian **desktop** plugin. Contributions are welcome as small, testable behavior changes with clear ownership.

## Local setup

Requires Node.js 22 and pnpm 10. Clone the repo and run:

```sh
pnpm install --frozen-lockfile
pnpm verify
```

The build outputs `dist/main.js`, `dist/manifest.json`, `dist/styles.css`, and a dev-only brand copy. Install into a **test vault** with the documented dev/deploy workflow. Never run automated tests against your personal notes without a backup.

## Engineering rules

- Read [AGENTS.md](AGENTS.md) and the [engineering design](.agents/ENGINEERING_DESIGN.md) for ownership boundaries.
- Keep product behavior consistent with [product design](.agents/PRODUCT_DESIGN.md).
- Prefer unit/integration tests for a changed invariant; add manual acceptance instructions for any Obsidian UI, browser OAuth, or native OS behavior.
- Do not include secrets, client tokens, real vault data, or generated bundles in PRs.
- Do not introduce network telemetry, unapproved vault writes, self-install/update behavior, or hidden external file access.
- Keep external provider and privacy disclosures accurate in [PROVIDERS.md](docs/PROVIDERS.md).

## Pull requests

Use concise [Conventional Commit](https://www.conventionalcommits.org/) titles:
`feat: add ...`, `fix: prevent ...`, `docs: clarify ...`, or `chore: ...`.
Describe **what changed, why, risk, tests run, and manual test evidence**. Keep release-specific version bumps in a dedicated release PR; do not directly publish from a feature branch. For user-facing features update the relevant page in [docs](docs/README.md) during the same PR.

## Releasing

Maintainers use the [controlled release workflow](docs/RELEASING.md). Do not manually push release tags or rewrite published release assets.

## Security

Do not disclose credentials or security issues publicly; follow [SECURITY.md](SECURITY.md).
