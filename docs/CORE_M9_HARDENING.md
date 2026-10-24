# M9 — Core trust boundary and persistence hardening

Target: preserve one canonical NOX learning engine across the Obsidian and Node/headless hosts. No new UI, provider or cross-file transaction layer is added.

## Changes and proof obligations

1. **Source-bound inference:** all program Practice/Teach turns check `AgentRuntimePort.supportsSourceIsolation()` before resolving material or invoking the adapter. A display identity such as `chatgpt` is never authorization. Missing capability fails closed.
2. **No ambient reads in bounded turns:** `RunLearningTurn` sets `includeAmbient: false` for source-bound programs. Authorized explicit note references are resolved by the context adapter. Unapproved selection and current note are neither read nor sent.
3. **Atomic session start:** `LearningProgramOrchestrator.startSession()` takes active-note **path metadata only** and performs both the session transition and initial material attribution in one program CAS write. Subsequent file-open events continue to call `focusMaterial()`.
4. **CAS parity:** both `VaultProgramStore` and `FileWorkspace.programs` reject overwriting an existing collection without a loaded snapshot. Missing collections can be created without `expected`. Existing legacy-v1 backups remain required before version upgrades.
5. **Uncertain fsync:** Node/headless reports `WorkspaceDurabilityUncertain` when atomic rename committed but parent-directory sync failed. Callers must reload authoritative state before retry. Tests cover injected start/end failures, restart recovery and no duplicated session history. Windows retains its previously documented directory-sync limitation.

## Non-goals

- Do not claim multi-file ACID transactions. Session transcript, progress evidence and program collection remain separate durable documents.
- Do not infer browser adaptive-program parity, production provider credentials or Obsidian native desktop UI acceptance from this milestone.
- Do not report an uncertain post-rename operation as definitely committed or definitely rolled back.

## CI

The gate is the completed PR-head GitHub Actions CI run, including architecture checks, typecheck/lint, unit and integration conformance, standalone ESM/CJS core, Chromium IndexedDB, Obsidian build and artifact verification.
