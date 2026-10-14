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

Cloudflare **Workers Static Assets** serves Astro's pre-rendered `dist/` folder. No adapter or SSR worker is needed.

```bash
cd landing
pnpm install
pnpm exec wrangler login
pnpm build
pnpm exec wrangler deploy
```

Use `pnpm exec wrangler whoami` to confirm the target account before deploying.
The first manual deploy creates the `nox-landing` Worker; later deploys update it. Assign a custom domain in Cloudflare Dashboard → Workers & Pages → nox-landing → Settings/Domains. Do not turn on Git integration or Workers Builds.

If sponsorship becomes available, set a verified public URL at build time and redeploy:

```bash
PUBLIC_SPONSOR_URL=https://your-verified-sponsor-page pnpm build
pnpm exec wrangler deploy
```

Without `PUBLIC_SPONSOR_URL` the Sponsor control displays an honest "coming soon" dialog and makes no payment request. Never embed API keys or private tokens in PUBLIC_ variables.

## Architecture

```text
landing/
  src/pages/index.astro       # SEO and static content
  src/components/FloatingNav.tsx  # React island, accessible capsule navigation
  src/components/LearningDemo.tsx # React island, Arc segmented control + Motion
  src/components/MascotMotion.tsx # lightweight Motion mascot entrance/idle
  src/components/arc/         # verbatim MIT Arc UI free component sources
  src/styles/global.css       # Tailwind CSS v4 + NOX theme override
  public/nox.png              # original repo asset
  public/nox-mascot.svg       # optimized vector reconstruction
  public/noise.svg            # static SVG grain overlay
```

Arc UI components imported locally: Button, Segmented Control, Text Reveal, plus Arc foundation and motion tokens. Original project: https://github.com/kuratlielia/arc-library (MIT). The floating site navigation is custom because UIArc Morph Nav is Pro and not installed. Brand tokens are mapped from NOX and scoped to this landing, without modifying plugin stylesheet.

The logo and mascot represent original NOX branding; the interactive learning example is illustrative. Supported product claims derive from the NOX README and implemented controller capabilities. There is no implied automatic execution of code, web search, or guaranteed mastery.

## Verification checklist

- `pnpm check && pnpm build`
- Keyboard: tab across navigation, mobile menu, practice segmented control, Sponsor disclosure
- Viewports: 390px, 768px, 1440px; no horizontal scrolling
- Reduced motion: OS setting disables continuous motion
- Smoke-test `wrangler deploy --dry-run` after build; only deploy after authenticating to your account
- Check GitHub destination and verified Sponsor URL before promotion
