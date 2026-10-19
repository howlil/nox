# NOX Workflow Simplification — Graph-first W1–W4 Implementation

Branch: `docs/architecture-responsibility-audit-20261019`, draft PR #121.
Canonical engineering contract: `.agents/ENGINEERING_DESIGN.md`.
This document inventories existing flows, records the four low-risk changes that have been implemented, and explicitly keeps source/data compatibility.

## 1. Workflow shapes and authorities

- `ChatSession`, `LearningRequest`, `LearningEvent`: `SessionController` owns durable transcript, `RunLearningTurn` owns a single terminal outcome and its cancellation.
- `LearningProgram`, `ProgramCollection`, `LearningFocus`, `SessionTiming`: `VaultProgramStore` owns CAS persistence; `ProgramMutationQueue` sequences same-process program mutations.
- `LearningState`, `LearningEvidence`: `VaultLearningStore` owns the versioned ledger, and an authoritative transcript outcome precedes idempotent evidence projection.
- `EditProposal`: `MutationService` uses the authorized Obsidian editor, preserves native Undo and durable proposal receipts.
- `SessionClockSnapshot`: **presentation only**, disposable, not a program snapshot, never an input to persistence or learning decisions.
- Provider quota, usage telemetry, and progress reports remain separate read-models for different purposes.

## 2. Implementation graph A / E / R

### W1 — Read-model efficiency

```text
VaultProgramStore.load() [fresh]
  ├─ getTurnFocusSnapshot() -> current + globalFocus -> LearningController admission
  ├─ getProgramOverview() -> one learner profile + one adaptive decision
  │                        -> evidence attempt counts indexed once by current revision
  │                        -> getSessionTime(existing program snapshot)
  └─ ChatView.refreshSessionClock() -> SessionClockSnapshot + syncedAt
                                     -> 2s presentation-only tick
                                     -> refresh authoritative snapshot every 30s
```

- **A:** fewer Vault reads, same domain outputs; null program hides the clock, active sessions progress locally.
- **E:** a failed Vault read retains the last visible clock and is retried at the next tick; cannot publish a new program state. CAS conflicts and malformed persisted programs still fail closed on state transitions.
- **R:** existing program store, clock and view lifecycle; no event bus, filesystem reader or writer added.
- **Ordering:** `getTurnFocusSnapshot` reads one authoritative collection for *both* related admission facts; the turn executor retains its independent terminal authority revalidation. The UI clock is a cosmetic projection, not fresh authorization.
- **Freshness:** 2-second ticks are local. Normal steady-state authoritative polling is one read/30s/pane, rather than one/2s/pane. Interpolation refuses negative and suspended (>120s) intervals and never treats pause/AI waiting as active study time. Normal refreshes and the existing 30-second authoritative checkpoint continue.
- **Scope:** view disposes its interval/snapshot on close; orchestrator owns the real checkpoint and program lifetime, unchanged.
- **Physical owner (M5-aligned):** pure visual projection `src/features/conversation/view/session-clock.ts`; immutable admission projection `src/features/learning/program/ProgramReadModel.ts`. `ChatView` and `LearningProgramOrchestrator` remain their approved public facades. No duplicate implementation remains in `src/chat/session-clock.ts`.


### W2 — End focus without unrequested inference

```text
/end-focus
  -> focus admission -> ProgramMutationQueue -> VaultProgramStore CAS
  -> read-only structural gap detection
  -> completed event + optional "Use /replan" hint

/replan [explicit action]
  -> prerequisite checks + source authorization
  -> provider-backed revision proposal (existing timeout/cancellation)
  -> user previews and explicitly approves
  -> VaultProgramStore CAS (unchanged)
```

- **A:** focus completion no longer automatically triggers a second AI generation call. Detecting a gap is cheap read-only advice.
- **E:** after a successful focus mutation, advisory gap read failures are reported as optional guidance and **never reclassify the already-committed end focus as failed**. `/replan` remains a separate, retryable user action.
- **R:** no new service or provider. Existing `detectRevisionCandidate`, `prepareCurriculumRevision`, approval and per-operation CAS unchanged.
- **Scope:** no generated preview, leaked timer or dangling provider abort controller is created on end-focus.

### W3 — Fewer ambiguous UI entry points

```text
Quick plan  (/plan goal)                Guided setup (onboarding)
     └─ createProgram()                  └─ previewLearningProgram()
             └─ ProgramPlanGenerator         └─ ProgramPlanGenerator
             └─ commitPrepared()              └─ approveLearningWorkspace()
                                                   └─ VaultWorkspaceWriter.ensure()

Quick Quiz: local renderer answers + MCQ score (not tracked)
Practice: session-persisted question + answer + evaluation; eligible evidence only through canonical rules
```

- Both plan paths already use a single domain generator; W3 **clarifies labels**, rather than changing onboarding persistence/approval or silently scaffolding files for Quick Plan.
- Quiz remains untracked, ephemeral, and does not count towards verified mastery. Tracked practice retains all durable receipts and historical decoders.
- The command menu's **single-character prefix search** is protected; the primary label is `Create plan · quick`. Labels starting with `Quick` unexpectedly matched `/q`, so descriptive naming must preserve existing command-prefix semantics.
- No changes to note access, request authorizations, visual source validation or question grading.

### W4 — Low-value surface and delivery-contract cleanup

- **Do not remove** `NoxPlugin.getBuildDiagnostics()` or its build timestamp constants merely because no UI calls them. The esbuild dev artifact pipeline requires `__NOX_BUILD_TIMESTAMP__` to survive bundling for each incremental build. Initial removal failed the real dev-orchestrator integration test; we restored the original contract instead of suppressing the test.
- Aligned `prepare-release.yml` comments with the **actual** automatic, signed/attested normal publisher in `release.yml`. `publish-release.yml` remains manual recovery for an existing verified draft. No change to workflow gates, SHA provenance, artifacts, secrets, attestation, Community scanner or Cloudflare ownership.
- Mermaid remains default; `nox-flow` v1 historical decoder, v2, preview formats and `nox-card` are **intentionally retained** pending usage evidence. Low discoverability is not proof of zero impact.

## 3. Workflow inventory and consolidation decisions

| Area | Workflows | Decision |
| --- | --- | --- |
| Runtime | bootstrap, auth, model discovery, provider rotation, quota, usage | Retain distinct authorization and accounting boundaries |
| Conversation | Ask/Explain, Review, Edit, streaming, retry/regenerate, history | Keep one terminal turn commit and durable receipts |
| Context | active note, selection, scoped research, skill/policy loading | Preserve source selection and final envelope authorization |
| Practice | durable question, typed submit, deterministic MCQ, rubric evaluation, evidence | Keep terminal gating and version-scoped provenance |
| Learning | goal discovery, quick plan, guided setup, objective focus, timed study, adaptive next, replan | Simplify read models and UX; never conflate self-paced focus with timebox |
| Presentation | rich quiz, diagrams/graphs, HTML previews, learning panel, activity | Different outcome semantics; no blind deletion |
| Delivery | dev CI, release candidate checks, approved artifacts and publication | Keep signed release proofs; fix inaccurate comments only |

## 4. Verification and acceptance

- `tests/chat/session-clock.test.ts`: no mutation of authoritative snapshot, no active time during AI wait/pause, no charging suspended periods.
- `tests/application/LearningProgramOrchestrator.test.ts`: one preflight collection load and zero extra reads when projecting session time from an existing snapshot.
- `tests/application/LearningController.test.ts`: end-focus never invokes provider or revision preparation, and advisory gap read errors do not invalidate committed focus termination.
- Existing Action Menu regression: `/s` remains prefix-only. Existing schema, provider, history, privacy, edit, concurrency/CAS and release-policy tests remain required.
- GitHub Actions build, unit, integration, typecheck, architecture graph and artifacts must be verified on the final commit. Native Obsidian desktop behavior remains **NOT RUN** unless separately evidenced in `docs/ARCHITECTURE_DESKTOP_ACCEPTANCE.md`.

## 5. Impact and deliberate non-goals

The 30-second clock refresh gives a theoretical upper bound of about 120 timer-induced reads/hour/pane instead of about 1,800, **not a production measurement**. Multiple panes, focus transitions and manual refreshes can change actual reads. No claim of observed provider cost, user retention or real-world elapsed time reduction is made.

Not implemented: a new cache authority, automatic background summary jobs, root folder reorganization, deletion of old conversation/visual formats, rewriting release automation, or any undocumented learning mastery change.

## 6. M5 physical boundary alignment

The W1 additions follow the existing feature-private shape, rather than growing the legacy flat `src/chat` tree:

```
src/
  features/
    conversation/
      view/
        session-clock.ts                  # W1: pure UI interpolation
        stream-text-presenter.ts          # M1: existing presenter
        history-presenter.ts              # M1: existing presenter
        transcript-presenter.ts           # M1: existing presenter
    learning/
      program/
        ProgramReadModel.ts               # W1: one snapshot -> admission view
        ProgramFocusService.ts            # M3/W2: original pure focus transition
        ProgramMutationQueue.ts           # M3: the sole orchestrator mutation lane
  chat/
    ChatView.ts                           # Obsidian host-facing UI entry point
    onboarding-flow.ts                    # Obsidian-dependent onboarding UI adapter
    action-menu.ts                        # Obsidian IconName + capability menu adapter
    quiz-card.ts                          # Obsidian UI editor integration
    response-quiz-render.ts               # DOM/code editor for local quiz
  application/
    LearningController.ts                 # public command/turn facade
    LearningProgramOrchestrator.ts        # public CAS/persistence coordinator
```

W2 does not add another focus transition owner: it simply stops a second provider inference inside the existing controller. W3 copy belongs to actual Obsidian/DOM UI adapters, not a pure domain service: migrating them wholesale would reverse host dependency direction or require broadening architecture exceptions. W4 only corrects release workflow documentation. These existing modules remain where M5 intentionally leaves host shell adapters. **If a later milestone migrates the Obsidian-facing chat shell, move its entire UI capability with an explicit host-adapter contract and tests, rather than adding duplicate delegating shims.**

Architecture regression explicitly checks allowed `ChatView -> conversation/view` and `LearningProgramOrchestrator -> learning/program` edges, and disallows an unrelated chat view from reaching private program projections.

## 7. R1–R4 follow-up ownership implementation

W2's source behavior remains unchanged, but its provider proposal collaborator moved from `src/application/CurriculumRevisionService.ts` into `src/features/learning/program/CurriculumRevisionGenerator.ts`, with a portable domain DTO to avoid importing a private module from public response types.

W3's pure onboarding transitions now live in `src/features/learning/onboarding/OnboardingWorkflow.ts`. The Obsidian renderer remains `src/chat/onboarding-flow.ts`. Tracked Practice UI and ephemeral Quick Quiz are different feature-private view packages; renderer and schema exports have one canonical physical source, with no duplicate shim.

W4's tightened architecture test denies access to arbitrary domain policies by the new private views. Reference: `docs/FEATURE_OWNERSHIP_R1_R4.md`. No runtime changes to release, diagnostics, or legacy visual formats.
