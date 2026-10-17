# NOX Adaptive Learning — Milestone execution

Integration branch: `feat/adaptive-learning-m1-integrated-on-m0`
Pull request: #102 (draft, targeting master to exercise CI).
Upstream development branches: M0 #99 and standalone M1 #96.
Do not merge or release automatically.

## Milestone status

- M0 — Self-paced global objective focus: implemented on PR #99, CI passed; not merged into master.
- M1 — Feedback engine and evidence v3: integrated onto M0 in PR #102; integrated CI and Obsidian desktop acceptance are release gates.
- M2 — Evidence-backed structural curriculum revision: implemented on PR #105, CI and desktop acceptance are release gates.
- M3 — Evidence-backed derived learner model: implemented in draft PR #106; CI and desktop acceptance gate.
- M4 — Adaptive Activity Engine: implemented in draft PR #107; CI and desktop acceptance are release gates.
- M5 — Context orchestration: pending.
- M6 — Compact UI: pending.
- M7 — Recovery and provider-backed Obsidian desktop acceptance: pending.

## M1: Program<A, E, R>

A: focus-authorized practice answer → validated evaluation → canonical transcript commit → versioned evidence projection → deterministic criterion gap status → self-paced feedback decision.

E: invalid rubric, stale or replaced focus, mismatched question and failed stream cannot commit a new verdict. An already-committed transcript outcome with failed progress write must be replayed by `reconcileTranscriptEvidence`, not reevaluated.

R: existing SessionPort, LearningStatePort, AgentRuntimePort, program vault store, injected clock for pure projections. No new agent roles or authoritative memory store.

### Cross-boundary invariants

1. Application stamps program/objective/revision/focus IDs; a provider-generated ID never changes the authority of a committed practice turn.
2. Pending questions are bound to a specific focus instance and chat; ended or replaced focus cannot inherit an old question.
3. Evidence from a previous rubric revision cannot satisfy current revision mastery, even if the criterion count is identical.
4. Criterion repair uses per-criterion failure, independent correction, then delayed independent recall. Failed recall reopens the gap.
5. Assisted answers and single-item MCQ remain formative; neither establishes mastery by itself.
6. Self-paced focus ignores legacy session deadlines and timeboxes without losing legacy timed-session compatibility.
7. The transcript remains the canonical evaluation outcome, including recovery after progress projection failure.
8. M0 and M1 remain in draft PRs until integrated CI, code review and actual Obsidian desktop provider acceptance are complete.

## Acceptance and evidence

Unit tests: `tests/domain/learner-model/feedback-policy.test.ts`, `tests/domain/learning-program/focus-transitions.test.ts`, `tests/domain/learning-state/gap-projection.test.ts`, `tests/domain/practice/PracticeStateMachine.test.ts`, `tests/persistence/learning-state-schema.test.ts`.

CI gates: `pnpm check:boundaries`, `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:integration`, `pnpm build`. Desktop acceptance cannot be claimed from CI.


## M2 — Dynamic Curriculum Revision

### Objective
Adjust curriculum structure when **committed learner evidence** shows a structural gap, while keeping the existing evidence log and active focus authoritative. This is a safe extension to M0/M1, not a new orchestration framework.

### Program<A, E, R>
- **A**: committed evidence → deterministic `detectStructuralGap` (repeated prerequisite failures, too-broad objective, or unexpected prior mastery) → optional bounded provider proposal → strict decoder → pure `applyCurriculumRevision` preview → explicit learner approval → storage CAS → persisted revision lineage.
- **E**: no verified evidence for automatic reason, invalid source, unknown objective, cyclic dependency, active/paused focus, timed session, obsolete version, overwritten preview, provider terminal failure, or concurrent vault mutation: **no canonical program change**. A successful focus termination stays committed even if proposal generation subsequently fails.
- **R**: existing `AgentRuntimePort`, `ContextPort`, `LearningStatePort`, `ProgramStorePort`; no second truth store and no multi-agent dependencies.

### Commands
- `/replan`: generate a bounded structural revision proposal only when evidence-backed trigger exists.
- `/replan goal-change`: explicitly request a scope adjustment (never claims new learning evidence).
- `/approve-replan <operation-id>`: validate preview freshness, operation identity, graph, focus and base version, then atomic persist.
- `/cancel-replan <operation-id>`: discard in-memory preview without mutating the program.
- `/end-focus`: if a structural trigger exists, offer an optional replan **preview**, never auto-commit.

### Supported operations
`add`, `revise`, `change-prerequisites`, `deprecate`; deletions are prohibited. Source-bounded revisions resolve only explicitly approved vault notes, fail closed on missing sources, and always enforce existing source path authorization. The model cannot set operation identity, evidence references, constraints or version counters.

### Compatibility
- `planVersion` increments only upon a successful structural commit.
- `objectiveRevision` advances for changed objectives only; unchanged objectives preserve existing M1 mastery evidence and stable criterion IDs. Evidence from an earlier revision cannot establish readiness against a revised rubric.
- Deprecated objectives remain in the stored graph for auditability, with optional replacement lineage; active dependents cannot reference them.
- Legacy `programs.json` v1/v2 reads remain supported; M2 changes are validated before vault writes. An Obsidian `Vault.process` compare-and-swap rejects stale concurrent revision approval.

### Tests
`tests/domain/learning-program/curriculum-revision.test.ts` covers graph insertion, invalid cycles/references, deprecation, idempotence, source constraints, stale versions, historical evidence, and active focus rejection.
`tests/application/CurriculumRevisionService.test.ts` covers provider failure, preview-only behavior, explicit approval, duplicate approval, source-bound isolation, stale versions and write conflicts.
`tests/persistence/VaultProgramStore.test.ts` covers real persistence-layer byte-level compare-and-swap.

### Remaining acceptance
- NOX desktop with a real provider; do not perform manual testing in chat.
- Independent review of atomic mutation failure, workspace note sync, and provider privacy boundaries before shipping.
- PR #105 is draft. M0/M1 PR #102 and upstream M0 #99 remain unmerged. Do not release until integration is approved.


## M3 — Derived Learner Model

### Scope
M3 introduces `src/domain/learner-model/learner-profile.ts`, a pure, reproducible read model computed from the durable `LearningState.evidence` ledger and the active `LearningProgram`. It creates **no new persisted or model-authored learner-memory authority**. Recomputing from the same inputs and an injected timestamp yields the same result; obsolete profiles cannot override current evidence.

### Program<A, E, R>
- **A**: committed and revision-scoped evidence → deterministic per-criterion profile → bounded prompt context → guided practice decisions that remain owned by M1. A read-only `/learner-profile` command explains the projection with provenance IDs.
- **E**: missing evidence, legacy unversioned evidence, stale objective revisions, material-review evidence, single-item success, or an assisted answer never fabricate verified competence. Failed delayed retrieval reopens the corresponding criterion. No provider response can write directly to the projection.
- **R**: derive afresh from committed evidence; duplicate committed replay does not add new profile records. The transcript and evidence remain canonical; on plugin restart no profile cache needs migration or repair.

### Data contract
- Per objective: active objective identity, current revision, derived readiness status, retrieval due timestamp and a small list of recent evidence IDs.
- Per criterion: stable rubric criterion ID, observable status (`unknown`, `needs-repair`, `assisted`, `provisional`, `verified`) and bounded provenance IDs.
- Per program: plan version, sampled evidence provenance and total committed learner-practice event count. Deprecated objectives and material-only review entries cannot establish new proficiency.
- Prompt-facing context is capped at 16 objectives, 12 criteria per objective and 4 evidence IDs per criterion; the full evidence log remains in LearningState and is never rewritten from a summary.
- No invented numeric ability scores, personality type, learning-style labels, or inferred behavioral traits. Unknown means not yet demonstrated by qualifying evidence.

### Verification
`tests/domain/learner-model/learner-profile.test.ts` covers zero-evidence, assisted success, delayed independent recall, regression, revised rubric, material-only evidence, bounded context, deterministic re-derivation and source immutability. Existing learning-state schema and transcript-first integration tests remain unchanged.

No automatic merge or release. M4 adaptive activity selection is the next milestone after M3 verification; desktop provider acceptance remains a release gate.

## M4 — Adaptive Activity Engine

### Goal
Select the smallest effective learning action from M1 validated rubric feedback and M3 revision-scoped learner profile while respecting the M0 focus lock and M2 curriculum lifecycle. The selector is a pure read-only function. No new agent, timer authority, cache, memory store or persisted schedule.

### Program<A,E,R>
- A: committed evidence → M3 derived profile → M4 `selectAdaptiveActivity` → typed activity with bounded criterion/evidence provenance → orchestrator and practice runtime. Both call one selector.
- E: paused or stale focus, expired timed session, obsolete objective revision, unmet prerequisites, assisted/single-item answer, failed delayed recall and absent evidence have explicit safe outcomes. M4 never declares mastery or edits curriculum.
- R: recompute from persisted program/evidence after restart. No M4-specific migration. Unversioned legacy v1/v2 program attempts use the original selector when no current revision-scoped v3 evidence exists.

### Deterministic priority
1. A persisted active focus is pinned to its objective, ignoring deadline/timebox. Paused/stale focus returns `wait`.
2. Outside focus, enforce legacy deadline, remaining study budget and manual/recovery pause state.
3. Earliest overdue independent recall among prerequisite-eligible objectives.
4. Rubric-targeted remediation: first failure → teach; repeated criterion failure → graduated guided scaffolding; assisted or single-item success → independent verification.
5. Independent transfer where explicitly required by the rubric contract.
6. New prerequisite-eligible objective: core > supporting > optional, with stable ordering.
7. Otherwise wait with reason and earliest pending retrieval date; no silent completion claims.

### Observability and boundaries
`AdaptiveActivityDecision` includes derived provenance (`policy=m4-v1`, trigger, objectiveRevision, evidenceIds, criterionIds, optional scaffoldLevel). This is context and explanation, not authority for the provider. `/progress` surfaces why a given activity was chosen. Do not persist model summaries as learner state.

### Verification
`tests/domain/learner-model/activity-policy.test.ts` covers recall, prerequisites, assistance/MCQ, regression, scaffold, required transfer, focus lock, session timeboxing, priorities, stale revisions, legacy fallback, and determinism. Existing M0–M3 CI checks remain required.

Desktop acceptance with a real provider remains a release gate. PR #107 remains draft; do not merge or publish automatically. M5 Context Orchestration follows M4.
