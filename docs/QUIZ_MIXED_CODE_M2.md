# M2 — Mixed Code/MCQ Quiz (2026-10-19)

Status: implementation in PR #119. Obsidian Desktop acceptance is a separate gate.
Scope: extend read-only model response presentation; **do not change** native
learning-practice generation, execution policy, scoring or durable mastery evidence.

## §1 Shapes — discriminated question union

- Existing MCQ: { id, question, options, correctOptionId, explanation? }.
  Optional type="multiple-choice" may be supplied; old type-less stored
  response JSON still decodes unchanged.
- New coding question: { id, type:"code", question, description?, language,
  starterCode?, criteria?, executionMode:"review-only" }.
- Quiz: version=1, kind="quiz", title, 1–50 questions with globally unique IDs.
- Local answer storage: Map<QuestionId, string>, shared between MCQ option ID
  and code source; only each question's variant interprets the corresponding value.
- Result: MCQ score and incorrect count; code responses count as "awaiting review"
  **without** being graded or executed.
- Current question index is independent of content-height calculations.

## §2 A — implementation graph

~~~text
User requests coding/mixed interactive quiz in Ask/Explain
    -> model fenced nox-quiz JSON
    -> parseNoxQuiz checks bounded discriminated union and unique IDs
    -> response-visuals.ts invokes renderNoxQuiz
    -> current question MCQ? Render options from textContent
                     code? Mount shared M1 CodeAnswerEditor
                           using draft if Map.has(id), else starterCode
    -> user types in CodeMirror -> local Map<QuestionId, string>
    -> Next/Previous
         -> destroy current CodeMirror instance explicitly
         -> replace current question DOM with next/previous single view
         -> remount code editor using saved draft, including an empty string
    -> Finish
         -> grade MCQ only; denominator is number of MCQs, even skipped MCQs
         -> count edited code as "awaiting review"; show submitted code as text
         -> no executable test/AI grader and no claim of correct code
    -> Restart clears Map and reinitializes editor from original scaffold
~~~

## §3 Execution

At most one mounted code editor is active in a response quiz. Explicit
destroy() occurs before changing questions, entering results or restarting.
Code entry emits synchronous onChange events to local component state; it
does not create network requests, shell calls, timers or persisted grades.
Displaying the next question does not advance automatically on input.

## §4 E / failure

- Invalid source >80 KB, >50 questions, duplicate IDs, unsupported type,
  missing code language, overlong starterCode, criteria beyond bounds,
  incompatible "execute" mode, options/correctOptionId attached to code,
  or any extraneous execution claim fails validation to the original JSON.
- Code never has a model-supplied "correctOptionId" or answer key.
- Source is rendered with textContent only; not eval, innerHTML, iframe or
  markdown interpreted as executable code.
- M1 CodeMirror initialization failure reuses its existing auto-sizing textarea
  fallback, retaining question navigation.
- Modified code text is not considered a passing solution. Untouched starterCode
  and blank response are counted as skipped.

## §5 R and §6 trust boundaries

- No new dependency. Uses bounded parser in response-quiz.ts and shared
  CodeAnswerEditor from M1 (host CodeMirror 6 or textarea fallback).
- Input boundary: user-authored model response JSON is untrusted data.
- Output boundary: native DOM text nodes only; code answer remains plain text.
- Practice aggregate, progress, persistence and evaluation remain untouched.

## §7 Policy, §8 lifetime

- Coding questions are editor-only formative practice; NOX does not claim
  to compile, run, test or grade the code.
- Answer Map lasts for the mounted quiz visual, including code empty-draft state.
  Navigating between questions preserves drafts; restart clears all drafts.
- Re-rendering a restored transcript starts a new attempt (not persisted).
- Code editor disposal occurs before DOM replacement; M1 handles detached
  host cleanup for external transcript removal.
- The host chat owns vertical scrolling; nested code editor height uses M1
  intrinsic sizing and syntax coloring with light flat tokens.

## §9 Verification

- Parse legacy MCQ JSON unchanged and explicit MCQ + code variants.
- Reject invalid execution modes, oversized scaffolds, duplicate IDs,
  mixed code/MCQ fields, unsupported language strings/criteria.
- Verify score excludes code, MCQ denominator includes skipped MCQs.
- Real input event drives local draft updates; navigate Next/Previous,
  verify editable code persisted and a deliberately empty draft remains empty.
- Explicitly destroy the previous editor on question change.
- Finish, inspect ungraded code, navigate back, restart from original scaffold.
- All-code quiz must show "No automatically graded questions".
- CI: TypeScript, lint, architecture, CSS, unit/integration/build/artifacts.
- Pending manual desktop: long (>100-line) code height and shrink,
  keyboard Tab and focus on Next/Previous, 320px sidebar and pop-out,
  transcript restoration semantics, dark Obsidian host forced flat-light UI.

## Explicit M3 deferrals

Stress/profile 50-question mixed tests, unmount leak instrumentation,
very long source limits and CodeMirror compatibility across Obsidian
desktop versions; manual acceptance and release gates are not M2 claims.
