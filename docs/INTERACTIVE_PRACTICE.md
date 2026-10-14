# Interactive Practice Cards (M0–M5)

## Scope and behavior

Nox turns a validated AI-generated `learning-practice` question into an
interactive **multiple-choice, essay, or code** card directly inside the
Obsidian conversation. One active question per chat session is authoritative in
`PracticeStateMachine` (reconstructed from the durable transcript). Legacy
untyped questions render as essay cards.

A question is not answerable until the AI turn completes and the transcript
commit succeeds. An evaluation is not progress until it commits to the
transcript; `progress.json` is a projection of that evidence and can be
reconciled after a failed progress write.

## Architecture

```text
AgentAdapter (AGY/Codex/ChatGPT)
  -> StructuredStreamParser (validated learning-practice)
  -> RunLearningTurn (question activation, submission, evaluation)
  -> SessionController (canonical transcript and per-session drafts)
  -> ChatView -> quiz-card (MCQ/essay/code widgets)

                           completed evaluation
                                    |
                                    v
                         LearningState evidence
                                    |
                                    v
                     LearningProgramOrchestrator
                   (recall/remediation/prerequisites)
```

The `quiz-card` UI never imports a provider, session persistence adapter, or
learning-state store. Draft updates and submits go through
`LearningController`. There is no parallel quiz progress database.

## M0 — Typed protocol

Existing `PracticeQuestion` fields remain compatible. New input variants:

- `multiple-choice`: 2–6 distinct options, `correctOptionId`, explanation.
- `essay`: optional evaluation criteria and word count guard.
- `code`: language, optional starter code, criteria, **review-only** execution.

`question-schema.ts` bounds input/answer sizes and checks answer type,
option membership, and code language. The model's option key is validated; it
is not proof of factual correctness. User answers and code are treated as
untrusted inputs.

## M1 — Generation

`buildPracticeQuestionInstruction` requests exactly one typed question.
`StructuredStreamParser` validates before exposing the candidate, and
`RunLearningTurn` commits the question only on a valid terminal completion.
Cancelled, truncated, malformed, duplicate-question, or failed turns cannot
leave an active new question.

The entry point is the existing **Practice** action and program session
practice; there is no independent quiz command parser or automatic quiz in
every Ask/Explain message.

## M2 — Interactive rendering

`src/chat/quiz-card.ts` renders a compact radio group, essay textarea, or
monospace code textarea. Keyboard focus, radio semantics, Tab indentation,
hints, read-only history, and async submit feedback are supported. The code
widget edits text **only**: no shell, filesystem, network, compiler, or
JavaScript execution is permitted.

Answers appear as input controls in the Nox message, not as separate forms
outside the chat. A committed question can be restored after reloading Nox;
evaluated questions appear as read-only cards.

## M3 — Answer durability and evaluation

- `questionId` is the stable submit target. Stale and repeated submissions
  are rejected before a new question can be generated.
- Edits are debounced, and the latest full draft is committed before submitting.
  The session snapshot owns `practiceDrafts`.
- The same transaction commits an evaluation and removes its draft.
- MCQ selection is checked **deterministically** against the stored key.
- Essays and code are evaluated by the connected AI provider against criteria;
  **code is not executed, compiled or test-verified**.
- Evaluation commit uses existing idempotent
  `practice:<sessionId>:<questionId>` operation identity.
- Failed/cancelled evaluator requests keep the active question available for
  retry, with the draft preserved.

## M4 — Learning OS

The generated question retains `programId`, `objectiveId`, and task kind.
Its evaluation flows through existing evidence/gap update logic. Correct
single-choice answers tagged `assessmentCoverage=single-item` do **not**
qualify an objective as mastered or unlock prerequisites. The scheduler asks
for guided practice to test a broader rubric; independent essay/code results
follow existing rubric and delayed-recall gating.

The feature is domain-agnostic: maths, history, language, and software topics
can use essay/MCQ, while programming problems can use code.

## M5 — Test and acceptance matrix

Automated behavior regression coverage includes:

- legacy + new schema, invalid/duplicate MCQ options, mismatched answer;
- incremental streamed parsing including malformed question JSON;
- deterministic MCQ grading and program mastery guard;
- successful MCQ/code use cases, stale/duplicate submit rejection;
- draft persistence across session reload and rejected disk writes;
- in-thread MCQ selection, read-only completed controls, essay/code draft hydration;
- existing session/evidence reconciliation and provider cancellation suites.

Manual acceptance still required inside real Obsidian desktop:

1. Generate MCQ, select an option, submit, and verify feedback/evidence.
2. Generate essay and Java code tasks and submit via cards; verify rubric
   feedback and no false claim of running tests.
3. Change draft and reload Obsidian; confirm it remains editable.
4. Submit then immediately click again; verify one evaluation and evidence.
5. Interrupt provider evaluation, retry; confirm same question and draft.
6. Switch chat sessions while unanswered; return and confirm origin/session
   isolation.
7. Check dark theme, narrow sidebar, keyboard navigation, focus and scaling.
8. Exercise both ChatGPT-plan and local CLI providers.

Passing CI **does not** replace Obsidian UI smoke tests or inference with a
real authenticated account.

## Boundaries / follow-ons

MVP provides one active card at a time; a sequence comes from completing the
current card and requesting the next Practice activity. A pooled multi-question
exam interface, automatic Ask/Explain inline checks, secure sandboxed code
execution, syntax-aware editor integration, timer/leaderboard and numeric
grading are follow-on features, not silently part of this release.
