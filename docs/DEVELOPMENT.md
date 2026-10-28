# Development

Requires **Node.js 22** and **pnpm 10**. A disposable vault is optional for manual smoke testing.

## Build and verify

```sh
pnpm install --frozen-lockfile
pnpm verify
```

For a shorter feedback loop use `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, or `pnpm build`. The default lint command checks `src/`, `packages/core/src/`, `headless/src/`, and `browser/src/` with baseline TypeScript rules. Targeted type-aware safety rules remain limited to the high-risk files listed in `eslint.config.mjs`; broader typed/CSS scanner triage is tracked separately in Issue #82. Built release assets are `dist/main.js`, `dist/manifest.json`, and `dist/styles.css`. Do not commit generated bundles.

## Test-vault development

Create an untracked `.env.local`:

```dotenv
NOX_DEV_VAULT=C:\Path\To\TestVault
NOX_DEV_RELOAD=cli
```

Run `pnpm dev`. The Obsidian CLI must be enabled for `cli` reload mode. Alternatives: `NOX_DEV_RELOAD=hot-reload` with the separate Hot-Reload plugin, or `none` for build/deploy only. Use **one** reload method at a time.

For one-off deployment: `pnpm run deploy "C:\Path\To\TestVault"`.

## Pull requests and acceptance

Follow [Contributing](../CONTRIBUTING.md) and the [engineering boundaries](../.agents/ENGINEERING_DESIGN.md). Include regression tests and update user docs when behavior changes.

CI checks code, architecture, provider mocks, and release artifacts. **It does not prove native Obsidian UI behavior, OAuth entitlement, or real-provider streaming.** Manually test install/enable/reload, sidebar, note context, Practice, approval, recovery, and provider connection before claiming native compatibility.

Never commit `.env.local`, provider tokens, real vault data, or generated assets. See [Providers & privacy](PROVIDERS.md) and [Releasing](RELEASING.md).
