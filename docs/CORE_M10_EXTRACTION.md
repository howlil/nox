# M10.1 — Physical domain extraction

**Implemented:** all 31 canonical domain modules now live in `packages/core/src/domain/`; the existing `src/domain/` paths contain re-export compatibility shims only.

## Contract

- Canonical rules, codecs, state machines, learning evidence, program transitions, focus and usage accounting have **one** source implementation.
- All imports originating from package-owned domain source resolve solely to package-owned domain modules. No Node, Obsidian, Electron, browser APIs or host adapters are allowed.
- The `@nox/core` package entrypoint points directly to package-owned domain exports for public domain symbols.
- Existing application, Obsidian, headless and browser code may continue importing the old paths for now without duplicated constructors or error classes.
- `scripts/check-physical-domain.mjs` and architecture/type/unit/integration/standalone-package/browser/Obsidian CI block duplicate implementations and regressions.

## Deliberate next steps

M10.2 migrates application orchestration, session state and runtime *after* verifying their inbound/outbound graph. The package remains private and host parity is not claimed. Avoid a speculative rewrite or inventing editor/Undo capabilities in headless/browser.

The migration is not complete until `src/` no longer owns domain logic and `@nox/core` can be built and consumed with one engine identity by all hosts.
