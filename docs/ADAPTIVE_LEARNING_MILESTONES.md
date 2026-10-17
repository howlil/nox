# NOX Adaptive Learning — Milestone execution

Integration branch: `feat/adaptive-learning-m1-integrated-on-m0`
Pull request: #102 (draft, targeting master to exercise CI).
Upstream development branches: M0 #99 and standalone M1 #96.
Do not merge or release automatically.

## Milestone status

- M0 — Self-paced global objective focus: implemented on PR #99, CI passed; not merged into master.
- M1 — Feedback engine and evidence v3: integrated onto M0 in PR #102; integrated CI and Obsidian desktop acceptance are release gates.
- M2 — Curriculum revision: next development milestone after M0/M1 integration is verified.
- M3 — Evidence-backed learner model: pending.
- M4 — Adaptive activity policy: pending.
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
