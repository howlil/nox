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
- M5 — Bounded, objective-scoped context orchestration: implemented in draft PR #108; CI and desktop acceptance gate.
- M6 — Compact focus, evidence and curriculum approval UI: implemented on draft PR #109; CI and desktop acceptance gate.
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

## M5 — Context Orchestration

### Objective and ownership
NOX uses current objective identity and committed evidence to build the smallest bounded provider context that can explain or assess the objective. This is an application-boundary projection, not a new memory store, chat summary, or background agent.

### Program<A,E,R>
- **A**: M0 objective authorization + M4 selected objective → sourceRefs/approved source scope → latest ContextPort note snapshots → ephemeral local lexical retrieval → cited path/line/heading snippets → M3-derived criterion context and at most six evidence IDs → existing ContextBudget → provider. The transcript remains canonical for pending questions and evaluation recovery.
- **E**: unknown/deprecated objective, missing or unauthorized source, empty approved note, no matching source excerpt for a source-bound objective, oversized explicit selection, stale rubric evidence, or context budget overflow aborts the turn before provider inference. Provider-authored feedback prose and global unrelated progress are not forwarded as learning authority.
- **R**: source and evidence projections are reconstructed on every turn from fresh vault buffers and durable event log. No cached summaries, migration, persistent vector index, or hidden provider conversation required for learning; an interrupted evaluation recovers through the existing transcript-first path.

### Selection, privacy and budget
- Source-bound learning restricts vault-note references **before** file resolution. Active focus and pending challenge resolve only their objective's `sourceRefs` (a subset of the program allowlist). Unbound learning prioritizes objective `sourceRefs` plus explicitly selected text; ambient unrelated notes are excluded where references exist.
- An in-memory LocalResearchIndex is built only from authorized turn-local note snapshots (up to 120,000 chars each) and selects at most six traceable chunks. This index is never persisted or shared across vault scopes. The source contract remains exactly the note content, not an AI-authored summary.
- M5 includes only the current objective's revision-scoped validated learner evidence. Six newest practice events maximum; twelve rubric results per event; no raw evaluator free-form narrative or cross-program material evidence. The M3 profile is generated once for the selected objective rather than scanning every program objective.
- Previous chat history and provider-owned conversation cursors remain excluded from program learning turns. The bounded context envelope continues to enforce a conservative estimated token ceiling. Source-bound learning fails closed if a required excerpt or selection cannot fit.
- Context trace is deterministic and read-only: selected source paths/lines/headings plus evidence IDs. It cannot confer mastery, revise curriculum, or override M4 activity selection.

### Verification
`tests/application/LearningContextOrchestrator.test.ts` covers approved-source isolation, citation provenance, stale revision and foreign evidence exclusion, thousands of attempts, deterministic recomputation, oversized selection, missing/off-topic sources, source revision freshness, injected evaluator prose, and strict budget handling. Existing ContextResolver, ContextBudget, RunLearningTurn and transcript recovery tests remain active.

### Release gates
Draft PR #108 is built on top of draft PR #107 (M4). No merge/release, no Cloudflare CI changes, and no manual desktop testing in this workflow. Real Obsidian/provider acceptance, failure-injection and privacy review remain outstanding; M6 Learning UI is next.


## M6 — Adaptive Learning UI

### Objective
Keep the NOX Obsidian sidebar compact and self-paced: surface M0 focus, M1 rubric feedback, M3 criterion evidence, M4 next decision and M2 pending revision approval without adding a new page or making the UI authoritative. Existing quiz/hint/feedback cards remain intact.

### Program<A,E,R>
- A: LearningController loads active program plus committed evidence → M3 profile + M4 policy → `NoxProgramOverview` → pure `projectLearningPanel` → existing learning map + compact focus strip. UI actions submit application-owned slash commands, never mutate program or evidence directly.
- E: stale / expired pending revision preview, focus-locked program, missing objective or unverified rubric criteria never expose misleading Apply/mastered controls. A preview only appears while it matches the current program version and has not expired. The server rechecks on approval and rejects concurrent edits.
- R: the panel and focus strip reconstruct entirely from the current vault-backed program and learner evidence when reopened or after turns. A restart discards in-memory revision proposals instead of replaying stale approvals. Existing transcript-backed answer/hint evaluation remains authoritative.

### UX contract
- Focus strip beneath NOX header indicates pinned objective, paused status or pending curriculum approval. Clicking opens the existing learning map; no pop-up or additional form.
- Learning map shows active objective, current revision's rubric criteria (`unknown`, `assisted`, `needs-repair`, `provisional`, `verified`), bounded evidence IDs and self-paced focus controls; existing graph remains navigable.
- Next-action explanations show M4 policy trigger and failed criterion IDs; recall timestamps are displayed only when present.
- Pending revision preview shows reason, version delta, bounded evidence, concise operation diff, and explicit Approve/Reject buttons. Commands route via `LearningController` and preserve M2 compare-and-swap, evidence provenance and expiration guards.
- Flat token-based style, compact spacing, keyboard-operable native controls, readable disclosure widgets and reduced-motion support.

### Verification
`tests/chat/learning-panel-state.test.ts` covers active/paused/no focus, accurate non-mastered criterion presentation, bounded provenance, revision approval commands, stale or expired proposal guards, and deterministic projection. The existing M0–M5 test suite and GitHub CI checks remain mandatory. Real Obsidian desktop and provider acceptance has **not** been performed.

No merge or release for draft PR #109. M7 final acceptance and system hardening follow.
