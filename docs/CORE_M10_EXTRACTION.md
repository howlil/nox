# M10 — Physical Core Extraction

## M10.1 — Completed on the parent PR

All 31 original domain implementations moved to `packages/core/src/domain/**` without rewrites. Legacy `src/domain/**` modules are exact re-exports.

## M10.2 — Application, Session and Runtime Extraction

This stacked milestone moves **37 more canonical TypeScript implementations** physically into `packages/core/src/**`:
- Application: learning controller, streaming turn, learning program orchestrator, commands, context preparation and contract ports
- Session: durable session controller, codec/schema and message/transcript types
- Runtime and parser: agent runtime, streaming parser
- Context: resolver, source ports, budget and local research
- Feature internals: conversation turn pipeline and program planning/state transitions
- Pure persistence decoder and root shared types

The runtime logic is moved using the original source blobs; no duplicated engine or feature rewrite. The old `src/**` paths are temporary compatibility-only re-exports. Host-specific adapters remain in root `src/` (Obsidian Vault/Editor, UI, provider/OAuth/process transports, settings, telemetry, lifecycle and quota process).

**Core package API:** `packages/core/src/index.ts` resolves its application, session, runtime and domain exports entirely inside `packages/core/src/`, rather than importing implementation from `../../../src/`.

**Permanent contract:** `scripts/check-physical-domain.mjs` verifies matching compatibility modules and rejects all escaped imports from physically extracted engine source. `scripts/portable-boundaries.mjs` checks every core TS file for host globals/imports. `scripts/check-core-hosts.mjs` verifies one copy of each canonical constructor in both host builds. New identity tests verify Legacy === Canonical runtime constructors.

### Acceptance and limitations

The original Obsidian/Node/browser code paths, on-disk schema decoders and public core API remain compatible. CI must pass full architecture/typecheck, unit/integration, ESM+CJS+types isolated consumer, single-instance identity, real Chromium/IndexedDB, Obsidian build and artifact verification.

**Not yet M10.3:** legacy source shims still exist; host imports may still use their previous internal paths. No standalone production browser provider or public npm package is claimed. Physical extraction is an ownership change, not new runtime functionality.
