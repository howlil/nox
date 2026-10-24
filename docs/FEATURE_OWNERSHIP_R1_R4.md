# NOX — R1–R4 Feature Ownership Migration

Status: **implemented under PR #121**, with automated boundary and host tests; native UI compatibility is not inferred from CI.
Baseline: `docs/ARCHITECTURE_BOUNDARY_REDESIGN.md`; W1–W4 behavior: `docs/WORKFLOW_SIMPLIFICATION_IMPLEMENTATION.md`.
This is a bounded follow-up to M5, **not** a wholesale migration of `src/chat/` and `src/application/`.

## §1 — Shapes and owners

- `CurriculumRevisionPreview`: portable, read-only domain contract in `src/domain/learning-program/curriculum-preview.ts`.
- `CurriculumRevision`: validated proposal/versioned operations; **not** a durable state change until approved.
- `OnboardingDraft` and `OnboardingStage`: user-intent snapshot; `OnboardingWorkflow` projects immutable transformations but never reads or writes plugin data.
- `PracticeQuestion`, `PracticeEvaluation`: the persisted Practice stream; only existing session/learning services can commit question/evidence.
- `NoxQuizSpec`, `NoxQuizScore`: ephemeral, read-only generated quiz; scoring never becomes learning evidence.
- `ProgramCollection`: still only persisted by the pre-existing `VaultProgramStore` CAS coordinator.

New physical feature ownership:

```text
src/features/
  learning/
    program/
      CurriculumRevisionGenerator.ts      # R1 provider-backed validated revision candidate
      ProgramFocusService.ts              # M3 existing focus transitions
      ProgramMutationQueue.ts             # M3 single serialized program writer lane
      ProgramPlanGenerator.ts             # M3 existing program generation
      ProgramReadModel.ts                 # W1 pure projection
    onboarding/
      OnboardingWorkflow.ts               # R2 pure draft restoration / constraints
  practice/
    view/
      quiz-card.ts                         # R3 durable Practice UI callbacks
      practice-instructions.ts             # R3 legacy/new instructions
      PracticeCards.ts                    # R3 question + committed evaluation projection
  conversation/
    view/
      response-quiz.ts                    # R3 legacy Quick Quiz decoding / local score
      response-quiz-render.ts             # R3 ephemeral DOM renderer
      session-clock.ts                    # W1 view-only projection
src/domain/learning-program/
  curriculum-preview.ts                  # R1 portable DTO (no runtime dependency)
```

`src/chat/ChatView.ts`, `src/chat/onboarding-flow.ts`,
`src/chat/response-visuals.ts`, `src/chat/learning-card-renderers.ts`,
`src/application/LearningController.ts` and
`src/application/LearningProgramOrchestrator.ts` remain host/application integration entry points.

## §2–3 — Successful graph, ordering, cardinality

```text
User /replan (explicit)
  -> LearningController -> LearningProgramOrchestrator
  -> current program and evidence, verify source-bound isolation
  -> CurriculumRevisionGenerator -> provider (one bounded request)
  -> decode output -> applyCurriculumRevision (dry validation)
  -> CurriculumRevisionPreview (pure DTO)
  -> user approval -> ProgramMutationQueue -> VaultProgramStore CAS

Guided onboarding
  -> Obsidian onboarding-flow adapter
  -> OnboardingWorkflow restores/updates draft and projects constraints
  -> LearningController.previewLearningProgram
  -> ProgramPlanGenerator -> blueprint
  -> explicit approveLearningWorkspace -> program CAS then workspace writer

Persisted Practice question/evaluation
  -> ChatView -> features/practice/view/PracticeCards
  -> quiz-card UI callback -> LearningController canonical command
  -> RunLearningTurn terminal transcript -> learning evidence reconciliation

Quick Quiz response (legacy schema remains v1)
  -> MarkdownRenderer -> response-visuals adapter
  -> features/conversation/view/response-quiz parser
  -> ephemeral response-quiz-render + local MCQ scoring
  -X-> SessionController durable practice evidence
```

R1 does not own active revision preview storage or commit; these stay in `LearningProgramOrchestrator`.
R2 does not create a second onboarding draft writer or abort controller; the Obsidian adapter owns request epoch, cancellation, and persistence via `LearningController`.
R3 has one physical copy of each moved parser/renderer. Review finding cards remain in the chat host adapter because they are not Practice evaluations.

## §4–5 — Failure/capability ownership

- **Provider failure / timeout / cancellation:** R1 throws the same expected errors, has unchanged 70,000-char response limit, requires one terminal completed event and decodes only a known curriculum revision fence. Pending previews remain short-lived and uncommitted.
- **Program CAS conflict / expired preview:** the original orchestrator rejects stale approvals and preserves version receipts; no new writer, queue, or rollback mechanism.
- **Restart during onboarding generation/preview/apply:** ephemeral stage becomes form. Existing approval uses stable operation ID to recover a committed workspace mutation. UI state restoration never creates a proposal automatically.
- **Obsidian vault source scope:** R2 only projects explicit source paths. R1 enforces existing source isolation/allowlist at the original application boundary.
- **Quick Quiz model content:** decoded with existing size/schema limits, inserted as text-only DOM; no arbitrary HTML/script and no durable mastery event.
- **Practice:** persisted question status and hint receipt are owned by existing application/session services; renderer calls supplied callbacks only. CodeMirror editor lifecycle and native Obsidian UI primitives are reused.

Injected capabilities are unchanged: `AgentRuntimePort`, `ProgramStorePort`, `LearningStatePort`, `WorkspaceWriterPort` and the Obsidian host adapter. No new framework or global event bus.

## §6–8 — Trust, lifetime, architecture boundaries

- Domain DTO contains no provider/Obsidian imports.
- Feature-private onboarding imports only `domain/onboarding/types` and `domain/learning-program/types`.
- Feature-private Practice presentation imports only Practice domain contracts and explicitly permitted host UI adapters (`chat/primitives`, `chat/code-answer-editor`).
- Conversation view imports only the declared host UI bridge helpers and its own local quiz renderer; it cannot import Practice private views or persistence.
- `scripts/boundaries.mjs` allows `ChatView -> practice/view`, `response-visuals -> conversation/view`, `onboarding-flow -> learning/onboarding`, and `LearningProgramOrchestrator -> learning/program`. Other cross-feature private imports remain forbidden.
- Onboarding request cancellation stays epoch-scoped in the host adapter; Quick Quiz code editors have per-renderer cleanup. No additional intervals or background work introduced.

## §9–11 — Verification and acceptance

- R1: existing curriculum proposal/approval, invalid provider payload, CAS conflict and source-bound regression tests; architecture regression protects generator privacy and DTO reachability.
- R2: `tests/application/OnboardingWorkflow.test.ts` covers restart of ephemeral stages, source reset, immutable projections and unchanged constraints; existing guided onboarding approval path remains intact.
- R3: original quiz/Practice renderer tests now import canonical paths; historical quiz v1 and legacy instruction decoding remain tested; direct architecture regression denies a Practice UI import of private Quick Quiz renderer.
- R4: boundary tests reject importing arbitrary learner model policy from onboarding/practice presentation, while allowing explicit models and UI helpers; architecture graph must have 0 cycles and unresolved imports.
- Release-critical and dev orchestrator tests remain part of the existing CI. `getBuildDiagnostics` and the dev timestamp placeholder stay intact. Release workflows, signature verification and Cloudflare automation are not changed.
- The release remains governed by source-bound CI, signed artifact provenance and public version parity; this archived milestone alone authorizes no release.

The migration intentionally keeps shared Obsidian UI primitives and the CodeMirror host adapter in `src/chat/` for this slice. Moving these host-owned utilities would require a separate shared host-adapter contract and is not a prerequisite for reducing the present coupling.
