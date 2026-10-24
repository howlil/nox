# M8 — Headless full-learning program conformance

Status: implemented on feature branch; require source-bound CI before merge.

## Acceptance scope

This milestone extends the existing headless Ask/Practice proof to use the
**canonical** `LearningProgramOrchestrator` and a durable `ProgramStorePort`,
not a parallel headless learning domain. It proves program-preview approval,
CAS persistence, objective focus, a program-scoped assessment + evaluation,
versioned learner evidence, session recovery and the confirmed-time ledger.

```text
Headless composition
  ├─ FileWorkspace (one process lock / one serialized I/O lane)
  │   ├─ sessions.json       SessionDataPort
  │   ├─ progress.json       LearningStatePort + evidence CAS
  │   └─ programs.json       ProgramStorePort + collection CAS
  ├─ canonical @nox/core LearningProgramOrchestrator
  └─ canonical @nox/core LearningController
            → RunLearningTurn → Practice → transcript → evidence
```

## State and security contract

- A shared, pure program-collection decoder validates Obsidian and headless
  program documents. Corrupt program JSON fails closed; existing bytes remain
  untouched. Both host adapters preserve v1-to-v2 focus upgrades.
- `programs.json` uses same-directory temporary file, fsync, rename, and
  best-effort parent-directory fsync, under the FileWorkspace process lock.
  Load returns CAS-bound snapshots; unguarded/stale writes cannot replace data.
- Program preview never writes a collection; commit requires a stable operation
  ID and idempotent approval. Focus admission uses the shared learner profile.
- Every headless restart runs the same recovery policy as the Obsidian host:
  active objective focus becomes paused, and elapsed closed-app wall time is
  not counted as active study time.
- A paused focus may be resumed explicitly from its owning conversation.
  The headless provider remains a scripted fixture, never live credentials.
- Headless continues to advertise **no ambient note discovery, editor Apply,
  native Undo, onboarding workspace materialization or cloud sync**.
  Source-bound planning without explicitly available approved material fails
  before inference. No unsupported capability is silently emulated.
- Session, evidence, and program JSON are independent files. Individual
  replacements are atomic, but **cross-file transactions are not atomic**.
  Transcript-first reconciliation and per-document CAS remain necessary.

## Verification

```sh
pnpm test:integration
pnpm headless:check
pnpm core:verify
pnpm core:hosts
pnpm browser:verify
pnpm verify
```

`tests/integration/headless/program-conformance.test.ts` covers stale
snapshot rejection, corrupt-file preservation, preview/approval idempotency,
prerequisite focus blocking, pending question recovery, transcript-first
evaluation, scoped learner evidence, focus resume and session timing recovery.

## Out of scope

Production headless CLI, non-fixture AI transport/auth, real note ingestion,
workspace materialization, onboarding draft storage, remote sync, and independent
Undo capability. M8 proves **portable learning behavior**, not equivalence
of every Obsidian feature or a new deployable product.
