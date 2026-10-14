# NOX Learning Orchestrator — Product and Engineering Contract

Status: implemented vertical slice on the feature branch (2026-10-14). This document takes precedence over the historical MVP limitations on curriculum and scheduling in `.agents/PRODUCT_DESIGN.md`.

## Design thinking

**Empathize:** Learners should be able to express a target, time budget, deadline, and allowed materials without being required to understand curriculum design, spaced repetition, prompt engineering, or a specific agent provider.

**Define:** A single-turn chatbot can generate exercises but does not reliably choose the next activity. The missing product unit is a durable learning program with explicit, testable objectives and evidence-based activity decisions.

**Ideate:** Keep the existing sidebar, provider-agnostic runtime, practice machine, material review and safe-edit boundaries; add one program model, an objective DAG, a deterministic decision policy, and vault persistence. Avoid a general agent framework or parallel learner-progress database.

**Prototype:** `/plan`, `/start-session`, `/next`, `/hint`, `/progress`, and `/end-session` use the existing thread/composer. A user is not forced into a dashboard or form.

**Test:** Verify graph invariants, hard limits, deadline feasibility, source restrictions, delayed recall, hint-assisted answers, recovery, and multiple domains. Manual Obsidian GUI/Undo checks remain distinct from unit and integration proofs.

## Product contract

NOX is a provider-agnostic, domain-neutral learning assistant that turns an explicit goal and its constraints into a curriculum, chooses activities from structured evidence, and preserves study progress in the vault.

- **Goal:** User authored and version-independent; one active program per vault, prior programs remain saved.
- **Objective:** Unique ID, observable outcome, prerequisite IDs, estimated minutes, rubric, source references, and priority.
- **Hard constraints:** Deadline when provided; session minutes (10–240); weekly sessions (1–7); approved source paths if source-bound. Unsupported or unknown options are rejected rather than inferred.
- **Assumptions:** Without user constraints, the command uses **45 minutes/session and 3 sessions/week**. These must be disclosed, not represented as preferences the learner provided. Deadline stays unset.
- **Feasibility:** Estimates a review/assessment allowance of 40% on top of objective minutes and compares the result to deadline capacity. This is a heuristic estimate, not a guarantee.
- **Teaching policy:** For each newly eligible objective, elicit a diagnostic answer before making a mastery claim. Following weak performance, remediate the failed objective. Scheduled delayed recall takes priority over new topics.
- **Mastery:** The current heuristic requires two independent, unassisted correct responses at least 12 hours apart. One correct answer remains provisional. This is a conservative product rule, not a universal empirically calibrated mastery estimator.
- **Retrieval interval:** Initially 24 hours after a successful response; after independent mastery, review after three days. This heuristic needs validation with real retention data and may later be replaced by a calibrated scheduler.
- **Hint:** User explicitly requests `/hint`; hints are not shown automatically. Assisted answers cannot establish independent mastery.
- **Session boundary:** New program activities require an explicit `/start-session`. New activities are blocked after the timebox is exhausted; completing an already active question remains possible.
- **Source boundary:** Source-bound curricula must cite only selected materials, and model inputs used for program Practice are restricted to those notes. A source-bound plan requires an active Markdown note.
- **Provider boundary:** LLM proposes curricula/questions/feedback. Application validates outputs and owns state, selection, authorization and persistence. Model output never directly establishes mastery.

## User workflow

```text
/plan Speak conversational Spanish | deadline=2026-12-01 | minutes=45 | sessions=3
  → generate curriculum with goal, testable outcomes, prerequisites and rubric
  → validate graph + source refs + constraints
  → save program to 00-learning-os/programs.json
  → show curriculum, feasibility, and controls

/start-session
  → persist startedAt and timeBudgetMinutes

/next
  → due review first; otherwise targeted remediation; otherwise eligible diagnostic
  → Practice question with programId + objectiveId
  → answer via existing Practice composer
  → evaluation, rubric feedback, evidence in progress.json
  → next decision recomputed from evidence

/hint
  → reveal help without treating it as independent recall
/progress
  → objective mastery count, feasibility, upcoming activity and review due date
/end-session
  → preserve evidence, clear session timer
```

Source-only example:

```text
Open notes/physics.md in Obsidian
/plan Learn these optics notes | sources=active | minutes=30
```

## Responsibility graph

```text
ChatView (commands, messages, cards)
    ↓
LearningController (UI facade, routing)
    ├── LearningProgramOrchestrator (planning I/O + serialized store updates)
    │      ├── AgentRuntimePort → AGY / Codex / ChatGPT adapter
    │      ├── ProgramStorePort → VaultProgramStore
    │      └── LearningStatePort → VaultLearningStore
    └── RunLearningTurn (one Practice action, stream, commit, recovery)
           ├── rules.ts (chooseNextActivity, objectiveProgress)
           ├── PracticeStateMachine (one active Q→A→evaluation)
           ├── SessionPort (committed practice transcript)
           └── LearningStatePort (objective-scoped evidence)
```

Canonical state: `00-learning-os/programs.json` owns program data; `progress.json` owns learner evidence and knowledge gaps; session transcript owns completed practice questions and evaluations. Review dates and mastery are **derived** from evidence; no independent due-queue database.

## Invariants

1. No circular, orphaned or duplicate prerequisite IDs.
2. Source-bound objectives must refer only to user-approved source paths.
3. No invented date or hard constraint; malformed constraints fail before invoking the provider.
4. A model result is not a commit until the complete structured curriculum has been validated and stored successfully.
5. Unrelated material-review findings are never evidence of learner mastery.
6. Evidence across programs cannot be merged merely because concepts share a label.
7. Hint-assisted responses cannot satisfy independent delayed-recall mastery.
8. A timed-out session cannot silently begin another learning activity.
9. Curriculum content never changes directly through the editor Apply mechanism; program writing uses one persistence boundary.
10. A cancelled or failed provider turn cannot produce committed practice progress.
11. Historic backend-only scope commands remain opt-in for old workflows; new programs use domain-neutral activities rather than silently migrating old assessment state.

## Phase boundaries / exclusions

The implemented source selection currently covers explicit Obsidian notes and active Markdown context. It does not include a semantic embedding index, external websites, audio pronunciation evaluation, calibrated psychometric ability measurement, or background notifications. The new commands are a minimal working UI, not a separate visual course dashboard. Real user evaluation should validate the schedule heuristic before replacing it with FSRS/knowledge tracing.

## Acceptance matrix

- Language learning, mathematics and backend engineering produce different goal-aligned objective graphs without hardcoded domain terminology.
- Invalid graph/missing source causes no persistent program write.
- Runtime failure, malformed program output and partial streams cause no committed plan.
- Deadline/capacity mismatch is disclosed.
- Diagnostic failures prioritize remediation; due recall takes priority over new topics.
- A hinted correct answer cannot produce mastery.
- A delayed second independent success unlocks dependent objectives.
- Program, objective IDs and evidence remain correctly scoped across vault restart and session switching.
- Architecture boundaries, typecheck, lint, unit and integration suites and production build all pass.
