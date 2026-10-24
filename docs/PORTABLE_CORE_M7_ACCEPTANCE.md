# NOX portable core — automated acceptance (M0–M7)

Portable NOX shares one learning engine between Obsidian, Node/headless and
browser/IndexedDB hosts, with host-specific capabilities.

## Automated verification graph

```text
M0 AST portable boundaries ─────────┐
M1 session/runtime ports ───────────┤
M2 headless recovery, file CAS ─────┤
M3 Obsidian host composition ───────┤
M4 private @nox/core ESM/CJS/types ─┼→ CI against exact source SHA
M5 one-engine host identity ────────┤   ├─ failed: block merge/release
M6 real Chromium/IndexedDB proof ───┤   └─ pass: eligible for review
M7 release/build gate auditing ─────┘
```

`pnpm acceptance:portable` checks CI commands, private core exports and
source aliases, release job dependency on Linux/Windows/Community
certification, and mandatory signed artifact and SHA checks. It audits
**configuration only**; a successful run is not evidence that the entire
CI workflow completed.

`pnpm verify` validates typing, lint, domain/host boundaries, storage
transactions and CAS, legacy schema compatibility, outside-consumer
ESM/CJS runtime identity, real Chromium restart/recovery, Obsidian bundle
and artifact checks. Release candidates require `release-certified` and
source-bound artifact provenance before publication.

## Explicit limits

Browser and headless inference proofs use scripted fixtures, not
live AI accounts. The core package is a private public API facade over
canonical `src/` modules, not a complete physical source extraction.
Native Obsidian UI behavior, browser OAuth, remote sync and real provider
entitlement are not certified by portable tests. Do not invent edit or
Undo capability for hosts without such adapters.
