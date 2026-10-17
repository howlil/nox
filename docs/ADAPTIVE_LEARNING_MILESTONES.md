# NOX Adaptive Learning — Milestone execution

Work branch: `feat/adaptive-learning-m1-feedback-evidence`.
Base: `master`; no automatic merge or release.

## Milestone status

- M0 — Objective focus lock: **not in master**; previous closed, unmerged PR #93 is not a prerequisite for the additive M1 schema.
- M1 — Feedback & evidence v3: implementation branch; verification pending GitHub CI.
- M2 — Curriculum revision: next after M1.
- M3 — Evidence-backed learner model: pending.
- M4 — Adaptive activity policy: pending.
- M5 — Context orchestration: pending.
- M6 — Compact UI: pending.
- M7 — Integration, recovery, manual Obsidian desktop acceptance: pending.

## M1: Program<A, E, R>

A: active practice answer → validated evaluation → canonical transcript commit → versioned evidence projection → deterministic criterion gap status and feedback decision.

E: invalid rubric, stale question and failed stream cannot commit a verdict. A completed transcript outcome with failed progress write must be replayed by `reconcileTranscriptEvidence`, not reevaluated. Duplicate questionId/operationId must not append evidence.

R: existing SessionPort, LearningStatePort, AgentRuntimePort, program store, explicit injected clock for pure transitions. No new agent roles or canonical memory store.

Invariants:
1. Model-supplied program/objective/criterion IDs are not authority; application stamps them.
2. Legacy evidence without question/revision/assistance metadata stays unknown; no inferred mastery.
3. Rubric gaps resolve only with independent correction followed by delayed independent recall; failed recall reopens.
4. Single-item MCQ and assisted success are insufficient for full mastery.
5. Learner evidence is isolated by program/objective/revision.
6. Existing serialized transcript-first recovery remains owner of commit/reconciliation.

## Acceptance

Unit tests: `tests/domain/learner-model/feedback-policy.test.ts`, `tests/domain/learning-state/gap-projection.test.ts`, `tests/domain/practice/PracticeStateMachine.test.ts`, `tests/persistence/learning-state-schema.test.ts`.

CI gates: `pnpm typecheck`, `pnpm check:boundaries`, `pnpm lint`, `pnpm test:unit`, `pnpm test:integration`. Desktop acceptance remains a release gate.

Risk: M1 extends the current learning-program workflow; M0 objective focus is not yet authoritative on master. Do not represent M1 as a full adaptive engine or claim M0 focus enforcement.
