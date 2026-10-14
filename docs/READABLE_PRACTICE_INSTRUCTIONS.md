# Readable Practice Instructions — Design Thinking & Engineering Plan

## Empathize
The learner saw a long Spring Boot assignment mixing goal, endpoints, annotations,
service assumptions and response requirements. A large code editor competed for
attention. Main user job: understand what to implement before writing code.

## Define
A practice card must separate title, short brief, tasks, technical constraints,
given context, expected output, optional reference code, and answer input.
Checklist items are instructions, not proof of mastery.
Never fabricate endpoints or acceptance criteria when the model omits them.
Existing persisted questions and answer drafts must remain fully compatible.

## Ideate / Decisions
- Choose one provider-agnostic structured instructions object in PracticeQuestion.
- Reject parsing long natural-language tasks heuristically: it can invent facts.
- Reject an extra AI summarization request: it adds latency and drift.
- Use native details/summary only for long reference code, not the primary task.
- Keep editable starterCode separate from read-only referenceCode.
- Reuse existing transcript and PracticeStateMachine; no new progress store.

## Prototype / Visual hierarchy
1. Practice kind and concept
2. Title at 17px and short brief at 13px
3. Numbered subtasks
4. Requirements and given assumptions
5. Expected output
6. Collapsible code reference if present
7. Editor with label Your answer/Your solution
8. Existing hint and submit actions

Use NOX tokens and Obsidian-compatible surface. Avoid nested extra cards,
large accent fills and fake completion indicators.

## M1 — Contract
Optional instructions: title, brief, tasks, requirements, given, expectedOutput,
referenceCode. Enforce bounds in question-schema; the same validation is used
by stream parsing and transcript recovery. Old questions remain valid.

## M2 — Generation
Practice prompt requests a concise question and structured sections.
Omit unavailable facts. Provided service classes go into referenceCode;
editable starterCode contains only minimal solution scaffold.

## M3 — Reusable components
practice-instructions.ts is a safe presentational renderer. quiz-card.ts and
learning-card-renderers.ts reuse it for live and restored conversation cards.
No provider, filesystem, or scoring logic in the renderer.

## M4 — Backward compatibility
Legacy instructions remain identical in persisted data. The renderer inserts
only sentence and paragraph breaks; it does not infer tasks or grading rules.
Never move/delete old starterCode or drafts.

## M5 — Verification
Unit: schema bounds, sections, legacy fidelity, safe model text.
Integration: parser/transcript restoration, existing MCQ/essay/code submit.
UI: narrow sidebar, keyboard, dark theme, long reference code disclosure,
reload, answer drafts, hints and submit. CI checks typecheck, lint, tests,
architecture and build. Real Obsidian UI tests remain manual until performed.

## Acceptance
Readable task hierarchy; reference code cannot be submitted accidentally;
no fabricated checklist; no new learning evidence from viewing tasks.
All old questions and typed answer flows retain existing behavior.
