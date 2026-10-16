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

## M1 — Feedback & evidence (correctness improvements; schema v3 pending)

- [x] Criterion-complete independent answer followed by genuine delayed recall is required for objective mastery.
- [x] Existing positive evidence cannot automatically resolve a newly opened misconception.
- [x] Gap resolution requires unassisted correction and criterion-specific delayed recall after latest failure.
- [x] Deterministic repair/scaffold/independent-check feedback policy with unit tests.
- [x] Attach canonical commit time to new practice evaluations and reuse it during evidence replay.
- [x] Add correction-first prompt policy without introducing another practice state machine.
- [ ] Versioned evidence v3 decoder/migration, stable criterion IDs and evaluator provenance.
- [ ] Multi-level hint/assistance history (currently only the assisted flag).
- [ ] End-to-end recovery tests covering transcript-success/progress-write-failure.

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
- [ ] Stable criterion IDs, anti-thrashing and configurable scaffolding/retention thresholds.

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

- [x] CI including typecheck, lint, unit/integration and build passed at commit `59af18ee6426245691b1ed6df5d396673f73388e` (before the final UI edits).
- [ ] CI verified for current PR head.
- [ ] Migration/restore and fault-injection matrix.
- [ ] Manual Obsidian desktop provider and vault acceptance.
- [ ] Release review and merge approval.

**Policy:** Do not merge this draft PR solely because unit tests or CI pass. M1 evidence identity, M5 concurrency and M7 desktop acceptance remain release-critical.
