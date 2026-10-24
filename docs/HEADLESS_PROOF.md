# NOX M2 — Headless portability proof

**M8 extension:** Durable program planning, objective focus, scoped evidence and timed-session recovery are implemented separately in [Headless program conformance](HEADLESS_PROGRAM_CONFORMANCE_M8.md). The M2-specific limitations below describe the earlier Ask/Practice proof.

Status: **M2 proof**, not a production alternative to Obsidian. Related architecture: `.agents/ENGINEERING_DESIGN.md`.

## Run

```sh
pnpm headless:check
pnpm headless:demo --data-dir ./scratch/nox-headless
```

The second command uses a **scripted fixture provider (no external AI)**, but
the actual NOX `LearningController`, `RunLearningTurn`, `SessionController`,
`SessionStore`, Practice state machine and evidence reconciler. The fixture
returns one Ask response, one Practice question and one evaluation. It stores
`sessions.json` and `progress.json` in the explicitly supplied directory.

To add a real host/provider, inject a real `AgentAdapter` into
`openHeadlessNox(root, adapter)`. This proof does not ship production auth,
material ingestion, a transactional editor, a general-purpose interactive
CLI, cross-device sync or a remote API. It is **not** an Obsidian replacement.

## Graph: A / E / R

```text
CLI fixture driver
  → openHeadlessNox
    → FileWorkspace (exclusive lock, atomic JSON replace, evidence CAS)
    → SessionController → SessionStore → canonical transcript
    → AgentRuntime(ScriptedProvider) → LearningController → RunLearningTurn
    → Practice evaluation -> committed transcript -> evidence reconciler
  → close runtime -> release process workspace lock

A: Ask response + practice question + committed evaluation and durable learner evidence.
E: lock contention, malformed stored JSON, stale evidence snapshot, failed terminal
   event or I/O failure. No evidence may be awarded before transcript commit.
R: Node filesystem only in host; injected SessionDataPort, LearningStatePort,
   ContextPort, PolicyPort, MutationPort and AgentAdapter.
```

## Persistence and trust contract

- The **headless** host has one local authority per data directory. An exclusive
  lock file is acquired before loading or writing state; a second running
  process fails closed. A leftover lock after an abrupt crash requires manual
  investigation/recovery; it is not automatically overwritten.
- Writes serialize within one workspace instance and use a same-directory temp
  file, `fsync` and rename. Evidence state uses the loaded snapshot as its CAS
  token. Two different files are **not one atomic transaction**: the real NOX
  transcript-first evidence reconciler retains recovery/idempotence semantics.
- The host has **no ambient notes** and advertises **no editor mutation**.
  Replacing scripted inference with a real provider must respect source
  permissions and credential lifetime; no production provider credentials
  are introduced by this proof.
- Legacy session and evidence decoders are reused, but this workspace uses
  headless JSON filenames. There is **no migration** of existing Obsidian vault
  data in M2, and the actual Obsidian `manifest.json`/bundle is unchanged.

## Verification

`pnpm headless:check` bundles the CLI with esbuild and fails if concrete
Obsidian/desktop adapters enter the dependency graph. The integration suite
starts the real engine, persists a pending Practice question, closes the
workspace, resumes on a fresh engine, verifies one committed evaluation and
evidence, tests a stale evidence CAS, lock contention and corrupt-session
fail-closed behavior, and executes the demo CLI from a separate Node process.

M2 establishes **a portable Ask/Practice slice**. Program planning/timers,
host-specific note selection, desktop providers/auth and edit Apply remain
future conformance targets rather than implied capabilities.

## Crash consistency correction

FileWorkspace now fsyncs the temporary file, atomically renames it, then
fsyncs the parent directory on POSIX before acknowledging a successful
commit. On Windows, directory fsync is not consistently available: file
fsync and rename are retained but full power-loss durability is not claimed.
If directory sync fails after rename, the write reports failure; reopen and
reload the workspace before retrying to avoid an ambiguous commit.
