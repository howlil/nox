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

## M1 — Feedback & evidence (v3 core integrated; advanced assistance pending)

- [x] Criterion-complete independent answer followed by genuine delayed recall is required for objective mastery.
- [x] Existing positive evidence cannot automatically resolve a newly opened misconception.
- [x] Gap resolution requires unassisted correction and criterion-specific delayed recall after latest failure.
- [x] Deterministic repair/scaffold/independent-check feedback policy with unit tests.
- [x] Attach canonical commit time to new practice evaluations and reuse it during evidence replay.
- [x] Add correction-first prompt policy without introducing another practice state machine.
- [x] Versioned v1/v2/v3 decoder and migration; old evidence remains unmodified with unknown provenance.
- [x] Stable criterion IDs are assigned to validated curricula and checked against revisioned v3 mastery evidence.
- [x] App-assigned evaluator provenance (`deterministic` MCQ or `llm-review`), objective revision, question and focus IDs.
- [x] Assistance metadata persists independent and observed hint level 0/1; provider cannot forge it.
- [x] End-to-end fault injection: committed transcript outcome replays identical timestamp, question ID and provenance after a failed progress write.
- [x] Provider-facing parser and vault decoders reject malformed v3 provenance.
- [ ] Interactive hint levels 2–4, verified-execution assessor, and corresponding end-to-end tests.
- [ ] Acceptance of reworded/revised curriculum against historical rubric evidence in a real vault.

## M2 — Dynamic curriculum (existing micro-replan only)

- [x] Pure DAG-safe evidence-based prerequisite-remediation proposal and explicit `/replan`.
- [ ] Automatic structural revision trigger using committed evidence and versioned provenance.
- [ ] General `revise`, `change-prerequisites`, and `deprecate` operations.
- [ ] Preview/approval for large changes, rollback/lineage and vault note reconciliation.

## M3 — Derived learner memory (partial)

- [x] Program/objective-scoped evidence projection and bounded context.
- [ ] Revision/fingerprint tracking, recall readiness and episodic evidence retrieval policy.

## M4 — Adaptive activity decision (partial)

- [x] Objective pinning, diagnostic, recall, transfer, repair and scaffold decision flow.
- [x] Feedback decisions carry specific failed criteria and evidence IDs.
- [ ] Separate readiness, eligible-objective selection and learning-activity decision contracts.
- [ ] Criterion-ID-native feedback routing, anti-thrashing and configurable scaffolding/retention thresholds.

## M5 — Context and provider orchestration (partial)

- [x] Use existing provider runtime with source-bound prompt policy.
- [x] Revalidate persisted authority at canonical practice commits.
- [ ] Full `LearningAuthoritySnapshot` at all agent/write boundaries and race/fault proof.
- [ ] Explicit versioned learning context builder with provenance and budget priorities.

## M6 — Compact UX (partial)

- [x] Goal-first onboarding, focus actions and quiz/rubric feedback.
- [x] Correction CTA routes to self-paced `/next` or `/resume-focus` rather than implicit timed session.
- [ ] Graduated hint controls, clarification and revision diff UI.
- [ ] Full Obsidian desktop accessibility and visual acceptance.

## M7 — Verification/release (open)

- [x] CI including typecheck, lint, unit/integration and build passed at commit `c0e608f894fde67e1ac2c0587776bccd4d8c17ea`.
- [ ] CI verified for current PR head (new documentation commit requires a run).
- [x] Unit and integration tests for v3 migration, malformed metadata, provider attribution and transcript-success/progress-write-failure replay.
- [ ] Full migration/restore and concurrency fault-injection matrix.
- [ ] Manual Obsidian desktop provider and vault acceptance.
- [ ] Release review and merge approval.

**Policy:** Do not merge this draft PR solely because unit tests or CI pass. Remaining M1 hint/evaluator acceptance, M5 concurrency and M7 desktop acceptance remain release-critical.
