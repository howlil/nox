# Contributing

Nox is an Obsidian **desktop** plugin. Prefer small changes with a reproducible test.

## Start

Requires Node.js 22 and pnpm 10.

\`\`\`sh
pnpm install --frozen-lockfile
pnpm verify
\`\`\`

Develop in a disposable vault; see [Development](docs/DEVELOPMENT.md). Read [AGENTS.md](AGENTS.md) and the [engineering boundaries](.agents/ENGINEERING_DESIGN.md) before moving responsibilities.

## Pull requests

- Use a concise Conventional Commit title: \`feat:\`, \`fix:\`, \`docs:\`, or \`chore:\`.
- State **problem, change, risk, tests, and manual Obsidian evidence**.
- Add focused regression tests and update user-facing docs when behavior changes.
- Never commit credentials, private notes, generated bundles, or telemetry. Keep note-edit approval and provider/data disclosures intact.

Release/version changes use a separate [release workflow](docs/RELEASING.md), not a feature-branch tag. Report vulnerabilities through [Security](SECURITY.md).
