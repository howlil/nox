# NOX landing

Static marketing site for [NOX](https://github.com/howlil/nox), isolated in `landing/` so Obsidian plugin builds stay unchanged.

## Local

Requirements: Node 22+ and pnpm.

```bash
cd landing
pnpm install
pnpm dev
pnpm check
pnpm build
pnpm preview
```

## Manual Cloudflare deployment (NO CI/CD)

Live production: https://nox.howlil.site (Cloudflare Worker name: `nox`). GitHub commits do **not** update the live site until `pnpm build && pnpm exec wrangler deploy` runs successfully.

Cloudflare **Workers Static Assets** serves Astro's pre-rendered `dist/` folder. No adapter or SSR worker is needed.

```bash
cd landing
pnpm install
pnpm exec wrangler login
pnpm build
pnpm exec wrangler deploy
```

Use `pnpm exec wrangler whoami` to confirm the target account before deploying.
The first manual deploy creates the `nox` Worker; later deploys update it. Assign a custom domain in Cloudflare Dashboard → Workers & Pages → nox → Settings/Domains. Do not turn on Git integration or Workers Builds.

The landing page exposes a single **Download plugin** action in the header and hero. Both use the free Arc UI Action Button component and open the official NOX GitHub Releases page. The button confirms opening the page, **not** successful downloading or installation. Publish and verify an installable Obsidian plugin release before advertising a direct artifact download.

## Architecture

```text
landing/
  src/pages/index.astro       # SEO and static content
  src/components/FloatingNav.tsx        # transparent-to-floating header; brand + one CTA
  src/components/DownloadPluginButton.tsx  # reusable Arc UI release CTA
  src/components/LearningDemo.tsx      # React island, Arc segmented control + Motion
  src/components/MascotMotion.tsx # lightweight Motion mascot entrance/idle
  src/components/arc/         # verbatim MIT Arc UI free component sources
  src/styles/global.css       # Tailwind CSS v4 + NOX theme override
  public/nox.png              # original repo asset, retained for social image
  public/nox-96.webp         # 96px optimized icon for initial load
  public/nox-mascot.svg       # optimized hero mascot vector; navbar embeds the same transparent paths inline
  public/noise.svg            # static SVG grain overlay
```

Arc UI components imported locally: Action Button, Button, Segmented Control, Text Reveal, plus Arc foundation and motion tokens. Original project: https://github.com/kuratlielia/arc-library (MIT). The floating site navigation is custom because UIArc Morph Nav is Pro and not installed. Brand tokens are mapped from NOX and scoped to this landing, without modifying plugin stylesheet.

The logo and mascot represent original NOX branding; the interactive learning example is illustrative. Supported product claims derive from the NOX README and implemented controller capabilities. There is no implied automatic execution of code, web search, or guaranteed mastery.

## Verification checklist

- `pnpm check && pnpm build`
- Keyboard: tab to the logo and Download plugin CTA; activate via Enter/Space; test practice segmented control
- Viewports: 390px, 768px, 1440px; no horizontal scrolling
- Reduced motion: OS setting disables continuous motion
- Smoke-test `wrangler deploy --dry-run` after build; only deploy after authenticating to your account
- Check the GitHub Releases destination and confirm an installable plugin artifact is available before promotion
