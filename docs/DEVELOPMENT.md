# Development and local testing

This guide is for contributors building NOX from source. To install a published plugin without a development toolchain, start with [Getting started](GETTING_STARTED.md).

## Requirements and build

- Node.js 22, pnpm 10, and a separate Obsidian **desktop** test vault.
- Read [engineering ownership](../.agents/ENGINEERING_DESIGN.md) and [contribution rules](../AGENTS.md) before changing source boundaries.

Install and verify:

```sh
pnpm install --frozen-lockfile
pnpm verify
```

Use targeted checks while developing:

```sh
pnpm check:boundaries
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm test:artifacts
```

The production build bundles `src/main.ts` into `dist/main.js`, copies `manifest.json` to `dist/manifest.json`, and compiles `dist/styles.css`. The official three-file installation does not require a separate PNG; the brand asset is embedded in the bundle. Never edit or commit generated `dist/` files.

## Develop inside a test vault

NOX has an incremental JavaScript/CSS watcher that can deploy completed builds into a local Obsidian vault and request a reload. Create an untracked `.env.local` at repository root:

```dotenv
NOX_DEV_VAULT=C:\\Path\\To\\TestVault
NOX_DEV_RELOAD=cli
# Optional when the Obsidian CLI vault selector differs:
# NOX_DEV_VAULT_NAME=TestVault
```

Enable the Obsidian CLI and confirm it is available before using `NOX_DEV_RELOAD=cli`. With that test vault open and the plugin enabled, start:

```sh
pnpm dev
```

If the CLI is unavailable, use the separate developer **Hot-Reload** community plugin and `NOX_DEV_RELOAD=hot-reload`. Use `NOX_DEV_RELOAD=none` to build/deploy without reloading. Never enable both reload strategies for the same vault. Failed builds should not replace the last working installed `main.js`; reloads can interrupt an in-flight AI request.

A one-off explicit production deploy is available:

```sh
pnpm run deploy "C:\\Path\\To\\TestVault"
```

The public plugin ID is `nox`. Its default vault directory is `.obsidian/plugins/nox/`. Earlier development installations used `nox-obsidian`; this is a **directory/identity migration**, not an in-place update. Back up plugin data and vault learning state before migration. See [Troubleshooting](TROUBLESHOOTING.md).

## Acceptance checks

GitHub CI validates architecture boundaries, TypeScript, lint, unit/integration behavior, build artifacts, and Windows transport/DPAPI regressions. **CI cannot verify the live Obsidian UI or account entitlements.**

In a fresh test vault, install *only* the three release artifacts, then verify sidebar and mascot, commands, current-note/selection context, practice and review, proposed edit approval, restart/recovery, provider authentication, model access, and streaming. Check **Settings → Nox → Loaded plugin build** when an older bundle appears to be running.

## Security and release process

Never commit `.env.local`, OAuth callback URLs, access tokens, local credential stores, or real notes. Provider setup and data disclosure live in [Providers and privacy](PROVIDERS.md). The [release runbook](RELEASING.md) is authoritative for version changes, tag creation, and publishing; do not publish tags from feature branches. Add product documentation whenever user-visible behavior changes.
