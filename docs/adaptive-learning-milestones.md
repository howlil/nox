# Adaptive Learning Engine — milestone ledger

Source of truth: [implementation specification](https://github.com/howlil/nox/pull/93) and the domain contracts in this repository.
This ledger is updated when code is committed. An item is checked only if the behavior exists in the PR branch; a passing CI run is not desktop acceptance.

## M0 — Objective focus authority (core implemented; acceptance pending)

- [x] Persisted, program-scoped focus with start, pause, resume, end and crash recovery.
- [x] Explicit focus intent policy for active/paused state, owning chat and objective.
- [x] Reject onboarding activation while any program focus is active, inside serialized program-store mutation.
- [x] Allow switching programs while old focus is paused and preserve its state.
- [x] Bind newly committed questions to `focusSessionId` and reject mismatched recovered questions.
- [x] Recheck active program, focus identity and curriculum version before terminal practice commit.
- [x] Regression tests for authorization and paused-switch persistence.
- [ ] Integration/fault-injection proof for a changed focus during an in-flight provider response.
- [ ] Explicit clarification/deferred-off-topic intent and legacy question compatibility acceptance.

## M1 — Feedback & evidence (v3 + progressive assistance implemented; verified executor pending)

- [x] Criterion-complete independent answer followed by genuine delayed recall is required for objective mastery.
- [x] Existing positive evidence cannot automatically resolve a newly opened misconception.
- [x] Gap resolution requires unassisted correction and criterion-specific delayed recall after latest failure.
- [x] Deterministic repair/scaffold/independent-check feedback policy with unit tests.
- [x] Attach canonical commit time to new practice evaluations and reuse it during evidence replay.
- [x] Add correction-first prompt policy without introducing another practice state machine.
- [x] Versioned v1/v2/v3 decoder and migration; old evidence remains unmodified with unknown provenance.
- [x] Stable criterion IDs are assigned to validated curricula and checked against revisioned v3 mastery evidence.
- [x] App-assigned evaluator provenance (`deterministic` MCQ or `llm-review`), objective revision, question and focus IDs.
- [x] Assistance metadata persists independent and progressive hint levels 0–4; provider cannot forge it.
- [x] End-to-end fault injection: committed transcript outcome replays identical timestamp, question ID and provenance after a failed progress write.
- [x] Provider-facing parser and vault decoders reject malformed v3 provenance.
- [x] Four-level hints are bounded, independently persisted, safely disclosed in quiz cards and reconstructed after restart.
- [x] Idempotent repeated hint-turn IDs cannot skip a level; integration tests verify restart, exhaustion and recorded assistance.
- [x] Reworded rubric retains mastery only through trusted stable criterion ID; legacy evidence uses its original text.
- [x] Persistence tests reload programs.json and progress.json and reject false mastery when criterion identities change.
- [x] Application cannot mint a verified-execution verdict without a trusted sandbox receipt.
- [ ] Implement a sandbox-backed verified-execution assessor with real execution receipts and recovery tests.
- [ ] Manual Obsidian desktop acceptance of reworded curricula, hint UI and historical vaults.

## M2 — Dynamic curriculum (bounded automatic + explicitly approved structural edits; rollback pending)

- [x] Pure DAG-safe evidence-based prerequisite-remediation proposal and explicit `/replan`.
- [x] At `/end-focus`, conservative automatic micro-replan uses two distinct committed LLM-reviewed failures from the same completed focus, stable criterion ID and current plan revision; legacy/foreign evidence does not trigger it.
- [x] Focus end and auto-revision are committed in one serialized programs.json mutation; failed writes retain the original focus, and retry cannot duplicate the revision.
- [x] Automatic proposal skips recovered criteria and full (60-objective) curricula instead of blocking focus end.
- [x] Approved, non-source-bound workspaces receive a create-only Roadmap-vN.md snapshot and remedial lesson, with startup recovery and conflict-safe retry; existing Roadmap.md and personal notes are preserved.
- [x] Domain, persistence and orchestrator tests cover provenance, idempotency, invalid evidence, failed program writes and partial vault note creation.
- [x] Manual `revise` (non-rubric metadata only), `change-prerequisites` (DAG/active prerequisite checks) and `deprecate` (tombstone, no dependent active objectives), without rewriting historic evidence.
- [x] `/curriculum-preview <JSON>` computes a pure versioned before/after diff and creates no files; `/curriculum-approve <operation-id>` is a separate, 15-minute-limited serialized commit.
- [x] Approval rejects stale versions, program switches and paused/active focus; retry is idempotent after failure. Revision history preserves before/after snapshots and rationale.
- [x] Retired objectives are excluded from adaptive scheduling, feasibility and remaining-work/mastery totals, while their evidence remains accessible.
- [x] Create-only Roadmap-vN.md snapshots reconcile explicit revisions and label retired objectives; source-bound and learner-edited notes stay untouched.
- [x] Unit, orchestrator and vault tests cover preview purity, retries, dependency cycles, collisions, tombstones, version conflicts, lineage and safe workspace snapshots.
- [ ] Reversible rollback as a *new* versioned change; full historical roadmap reconciliation.
- [ ] Compact non-JSON UI for structural edits, and Obsidian desktop acceptance including restart and legacy vaults.

## M3 — Derived learner memory (read-only projection integrated; desktop acceptance pending)

- [x] Program-wide derived `LearnerModel` grouped by stable program, objective, criterion and current curriculum revision; objective tombstones retain history but do not schedule activity.
- [x] Deterministic evidence fingerprint (IDs + outcome/rubric/assistance/evaluator provenance and active gaps) for cache invalidation; rejects stale projections after canonical evidence changes or plan revision.
- [x] Derived criterion status, unresolved criterion-linked gap IDs, hint-assisted attempts, latest independent attempt, next recall date and recall readiness from existing mastery rules.
- [x] `selectRelevantLearnerState()` prioritizes current failed criteria, recent independent evidence, active question, and prerequisite episodes with strict episode/gap/criterion bounds and stable evidence IDs.
- [x] Program practice prompts use this read-only bounded snapshot rather than a separate generic 20-evidence progress digest; the active question hint level is included without full transcripts or inferred personality labels.
- [x] Legacy objective projection delegates to the same canonical derived policy (no competing learner state).
- [x] Unit, integration, and persistence tests verify isolation between programs/objectives, rubric rewording, future revisions, restart, stale fingerprint, retrieval budgets and absence of `memory.json`.
- [ ] In-memory performance memoization only if profiling warrants it (must be disposable), and Obsidian desktop/provider acceptance.

## M4 — Adaptive activity policy (pure domain core implemented; desktop acceptance pending)

- [x] Canonical mastery and prerequisite-readiness extracted to pure `objective-readiness.ts`: `objectiveProgress` (backwards compatible), `deriveObjectiveReadiness`, stable failed criterion IDs, evidence IDs, and eligibility.
- [x] Separate pure `selectEligibleObjective`, `decideLearningActivity`, and `decideFocusedLearningActivity` policies for deterministic activity selection and a strict objective-focus pin.
- [x] Priority is explicit: due recall → repair of eligible objective → independent transfer → unseen required goal → unseen optional goal. Paused/active focus, deadlines and legacy timebox gates keep existing authority.
- [x] Correction-first after a first failed criterion, progressive scaffold only after distinct failed questions, bounded level 2–4, no repeated teaching for the same evidence marker, and reset after verified independent recovery.
- [x] Feedback matches current stable criterion IDs across rubric rewording. Recall, remediation, and transfer decisions carry targeted criterion IDs and supporting evidence IDs (read-only provenance).
- [x] Configurable *pure policy* thresholds for scaffolding and retention, with a hard minimum 12h independent mastery gap; no mutable learner policy database or arbitrary timeout used to release focus.
- [x] Program practice prompt maps criterion IDs to the approved rubric descriptions and includes opaque evidence references rather than invented provider verdicts.
- [x] Unit and regression tests cover DAG eligibility, due recall priority, focus lock, source evidence, repeated decisions, scaffold escalation/reset, stale curriculum evidence, and non-weakenable retention thresholds.
- [ ] Product settings/UI for optional threshold configuration, and desktop acceptance of real-provider adaptive turns (especially legacy vaults).
- [ ] Concurrency/fault-injection tests where evidence and focus change during an in-flight provider activity decision (tracked under M5/M7).

## M5 — Context and provider orchestration (versioned core implemented; atomic race acceptance pending)

- [x] Use existing provider runtime with source-bound prompt policy.
- [x] `LearningAuthoritySnapshot` v1 binds program identity, curriculum revision, objective, chat owner, focus ID/status, learning session identity, and M3 evidence+gap fingerprint.
- [x] Revalidate the snapshot before provider inference, at canonical question/evaluation commits and at terminal narrative commits for program turns; stale results fail closed instead of rebinding.
- [x] `buildLearningContext` v1 carries app-validated rubric IDs/descriptions, targeted evidence IDs, active question assistance, bounded M3 learner episodes, and explicit source policy.
- [x] Strict provenance checks reject mismatched objective, program, plan and criterion identity; budget drops low-priority historical episodes before required rubric or active-question context.
- [x] Preserve the existing `prepareContextEnvelope` source-bound enforcement and history isolation; no second provider session or memory database.
- [x] Unit and integration tests cover snapshot drift, context priority/overflow and provider race injection: focus switch, curriculum revision and a different turn committing evidence while the provider streams.
- [ ] Close the remaining cross-file check/commit race (atomicity of focus, evidence and transcript spans separate persistence stores). Re-check at the final write boundary and add concurrent commit fault-injection coverage.
- [ ] Desktop acceptance using supported providers and a source-bound historical vault.

## M6 — Compact UX (partial)

- [x] Goal-first onboarding, focus actions and quiz/rubric feedback.
- [x] Correction CTA routes to self-paced `/next` or `/resume-focus` rather than implicit timed session.
- [x] Graduated hint controls with durable disclosure and no answer-key auto reveal.
- [ ] Clarification and curriculum revision diff UI.
- [ ] Full Obsidian desktop accessibility and visual acceptance.

## M7 — Verification/release (open)

- [x] CI including typecheck, lint, unit/integration and build passed on implementation head `3961e423fafa0279da57c5b03195fc1dd258f154` (GitHub Actions run `38928965249`).
- [ ] Reverify the final PR head and release-specific checks immediately before merging.
- [x] Unit and integration tests for v3 migration, malformed metadata, provider attribution and transcript-success/progress-write-failure replay.
- [x] Automated tests for atomic focus-end auto-replan, evidence isolation and create-only revision note recovery.
- [x] Automated tests for approved structural revision diff/commit, tombstone scheduling, persistence and workspace no-overwrite guarantees.
- [x] M3 tests for evidence-derived learner memory, program isolation, bounded provider context, fingerprint invalidation and reconstruction from persisted progress.
- [x] M4 deterministic activity policy tests for criterion targeting, eligible objective priority, anti-thrashing and safe recall thresholds.
- [x] M5 unit and integration proof for versioned bounded learning context and deterministic mid-inference focus/plan/evidence invalidation.
- [ ] Atomic inter-store check-and-commit concurrency proof after transcript persistence and before progress projection.
- [ ] Full migration/restore and concurrency fault-injection matrix.
- [ ] Manual Obsidian desktop provider and vault acceptance.
- [ ] Release review and merge approval.

**Policy:** Do not merge this draft PR solely because unit tests or CI pass. Remaining verified-execution sandbox capability, M5 concurrency and M7 desktop acceptance remain release-critical.
