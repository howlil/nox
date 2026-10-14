# NOX Interactive Quiz — Hint, Reveal, Feedback

Status: implemented UI vertical slice on `feat/quiz-hint-reveal-feedback-20261014`
Scope: Obsidian sidebar; MCQ, essay, code review-only; existing Practice aggregate.

## Design thinking

- **Empathize:** A learner answering a question needs help, visible progress, and feedback without abandoning the note or losing a draft.
- **Define:** Prior quiz UI generated /hint in a separate transcript turn, used ad-hoc button styling, and did not expose a grounded answer-reveal action. A hint must not silently become independent mastery evidence.
- **Ideate:** Keep one in-thread card. Progressive disclosure reveals hint only after the existing /hint request is durably accepted. The evaluation card owns feedback and optional post-commit answer/rubric disclosure.
- **Prototype:** Reuse `NoxButton`, `NoxSurface`, the existing `runTurn` and native `<details>`; do not install a React UI library inside Obsidian.
- **Test:** Verify help persisted before reveal, assisted evidence, answer-lock, retry, keyboard navigation, restoration and reduced motion.

Visual references (principles, not imported code):
- https://www.beautifului.dev/ — compact AI-native interaction, progressive affordances, clear task feedback.
- https://uiarc.dev/docs/motion — action-driven motion, reversible disclosure, keyboard/reduced-motion behavior.

## Ownership graph

```text
User action
  -> QuizCard (UI-only disclosure and pending state)
  -> ChatView (session-scoped callback, no direct persistence)
  -> LearningController (application guard / command)
  -> RunLearningTurn / PracticeStateMachine (hint and assisted status)
  -> SessionController (persisted /hint and evaluation transcript)
  -> ChatView (derived hintUsed, committed questionId)
  -> QuizCard / PracticeFeedback (render state)
```

Only the transcript/Practice machine owns assisted evidence. The quiz does not store a second durable hint flag. `hintUsed` is a derived presentation property from the /hint user turn after the same questionId. The source question's `correctOptionId` is never used to display a key before a committed practice-evaluation event.

## State graph

```text
READY -> ANSWERING -> EVALUATING -> EVALUATED
              |           |
              |           +-- failure -> RETRYABLE -> EVALUATING
              |
              +-- Get hint -> HINT_PENDING
                                +-- persisted -> HINT_REVEALED -> ANSWERING
                                +-- failure -> ANSWERING (recoverable)
```

`HINT_REVEALED` is local disclosure state only; persisted intent rehydrates as `hintUsed`. Repeated Show/Hide does not resend the /hint command. The hint explicitly states that this attempt is assisted.

## UI composition

```text
PracticeCard
  Heading: Practice · concept                 answer type
  Task / requirements / given / expected output
  Editable answer surface (MCQ / textarea / code textarea)
  HintDisclosure? (hidden until explicit request)
  Action row: [Get hint / Show hint]  [Submit answer]
  Status: validating / evaluating / retryable

PracticeFeedback
  Outcome icon + label                         Hint used?
  Evaluator feedback
  Misconceptions / what to revisit
  Reveal? (native details, post-commit correct option + rubric criteria)
  [Prepare next activity]?
```

Design constraints:
- Compact 12–13px hierarchy, semantic Nox colors and spacing, no nested floating panel or heavy shadow.
- Primary purple only for action/selection; green/orange/red express evaluated outcome.
- Hint display uses an inline inset surface; explanation and optional rubric use native disclosure.
- Short 160ms opacity/translate affordance on expansion; reduced motion disables it.
- Only animated state transitions; no fake AI thinking or invented progress.
- Touch and keyboard can activate every button; details uses native summary semantics; `aria-expanded` follows the hint panel; status has `aria-live=polite`.
- Code remains review-only; Tab must move keyboard focus instead of trapping the user inside a textarea.
- Code/essay reference solutions are not invented. Only MCQ exposes its validated, stored correct choice after evaluation.

## Backend guarantees and failure policy

1. The /hint command checks an active unanswered Practice question and whether a hint exists.
2. Inspect hint without mutating Practice state.
3. Persist /hint user intent, then mark in-memory assisted, then persist the assistant hint; on failure report a recoverable persistence error.
4. Answer submission first saves the draft, then uses the existing `practiceSubmission` request; retry does not create a parallel evaluation pipeline.
5. A committed evaluation event includes `questionId`; the view looks up that exact question from the canonical session transcript to obtain any MCQ correct choice.
6. No questionId/committed evaluation -> no answer reveal.
7. Evaluated cards are read-only; failed evaluations restore the ability to submit.
8. Preparing another activity populates the canonical composer with `/next`, `/start-session` or a free Practice prompt; it does not silently run an AI request.

## Acceptance

- Hint is hidden until /hint was persisted and completed successfully.
- Hint failure is visible and retryable; repeated toggles never duplicate /hint.
- Session restore offers Show hint without re-requesting it.
- Assisted evaluations explicitly say they do not count as independent recall.
- MCQ solution appears only inside a post-evaluation disclosure, never in a live unanswered card.
- Feedback shows grading and misconceptions immediately, rubric is optional disclosure.
- Failed submit can be retried with preserved answer; successful submit locks input.
- Keyboard Tab can exit the code editor, reduced-motion disables expansion animation.
- All records stay in the existing session/evidence pipeline; no new provider or persistence owner.

## Verification

Run `pnpm verify` and inspect in a real Obsidian desktop vault using at least:
MCQ with/without hint, essay minWords, code, failed persistence, provider outage, manual retry, history restore, light/dark, and reduced motion. Existing CI does not verify real Obsidian layout/keyboard interaction.
