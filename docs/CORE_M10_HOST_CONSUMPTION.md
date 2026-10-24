# M10.3 — Host consumption cleanup

Parent: M10.2 physical canonical application/session/runtime extraction.

## Changes

- Obsidian provider adapters, host lifecycle, Vault stores, settings, chat UI and learning/practice presenters import shared types, rules and engine source **directly** from `packages/core/src/**`, rather than traversing `src/**` compatibility modules.
- Obsidian composition continues to use the curated `@nox/core` public API for runtime controllers.
- Node/headless workspace now consumes its storage contracts, decoders and conflict errors solely from `@nox/core`; browser already uses the same public API.
- Production boundary verification resolves package modules back to their logical layer owners to preserve existing SOLID dependency rules, and rejects source import edges through `src/**` compatibility shims.
- Cross-host bundle identity now checks Obsidian, headless and browser composition inputs for **zero** root shim dependencies or compiled-package duplicates.

## Why old source files still exist

Old `src/**` shim files remain as compatibility-only exports for tests and external imports that predate extraction. They contain no business logic. M10.4 can remove them only after safely retargeting all tests/build tools and establishing standalone package-mode verification. This milestone intentionally avoids duplicating runtime objects or rewriting legacy data schemas.

## Acceptance

All standard CI gates: architecture boundary graph, lint and typecheck, unit/integration, portable outside-repo ESM/CJS/types, host identity, real Chromium IndexedDB, Obsidian production build and artifact checks. Explicit regression test requires every production input to bypass shims.
