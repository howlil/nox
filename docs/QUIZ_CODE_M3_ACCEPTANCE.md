# M3 — Code Quiz Hardening and Desktop Acceptance

**Branch:** `feat/flat-html-preview-autoheight-20261019` (PR #119)
**Code/CI scope:** Implemented; separate real-Obsidian desktop acceptance remains **NOT VERIFIED**.
**Non-goals:** replacing native Practice, compiling/running model or learner code,
server-side grading, storing transient `nox-quiz` attempts as learning evidence.

## Design-thinking implementation graph (§1–§11)

### §1 Shapes
- `CodeAnswerEditorOptions/Handle`: language, source, readOnly, onChange,
  setReadOnly, idempotent destroy.
- `CodeToken`: nonexecutable decorations, bounded by a shared 40,000-char
  maximum in `code-syntax.ts`.
- `Registration`: host element, once-connected state, cleanup callback.
  `Registry`: one MutationObserver and registrations per owner Document.
- `NoxQuizSpec`: <=50 mixed code/MCQ questions; same M2 JSON decoder.
- `NoxQuizAnswers`: local Map keyed by question ID, never a persisted grade.

### §2 A: successful vertical slice
```text
User opens code question in Practice or a typed nox-quiz
  -> shared CodeAnswerEditor mounts
  -> shared owner-document observer registers
  -> CodeMirror 6 colors and wraps source, grows with contents
  -> user types
       -> CodeMirror changeFilter admits <=40,000 chars
       -> onChange(source) routes to existing Practice draft OR local quiz Map
  -> next/previous navigation
       -> explicitly destroy current editor
       -> registry unregister; disconnect observer at final registration
       -> rehydrate editor from exact saved draft (including empty string)
  -> if transcript/editor host detached
       -> document observer releases editor
  -> result
       -> MCQs graded only; code awaiting separate review
  -> restart
       -> local quiz answers cleared and original starter codes restored
```

### §3 Execution, ordering and performance
- Exactly one active code editor per *typed response quiz*, independent of
  number of questions. Practice cards may independently own their editor.
- Rapid synchronous attach/detach is detected using DOM removal records,
  even when `isConnected` was not observed in a prior callback.
- At most **one document-wide MutationObserver per Document** regardless
  of how many CM6 editors share it.
- Token decoration work is local to active editors and capped at 40,000
  characters per source. No web workers, background requests, timers or code
  execution are introduced. Parser complexity is finite, but the CI tests
  are functional stress tests, **not** a browser frame-time benchmark.
- The sidebar/chat is the sole vertical scroll owner. Both real editor and
  fallback use intrinsic content height; 100-line code grows and shorter code
  shrinks. Long lines wrap within the available inline width.

### §4 E: expected failures and fault recovery
- If CodeMirror setup fails, the learner retains a plain auto-sizing
  textarea; if setup fails *after* EditorView is created, the instance is
  destroyed before the fallback mounts.
- If a paste/change exceeds 40,000 characters, CodeMirror changeFilter
  rejects it; fallback reverts to last valid text. Neither path updates
  the canonical Practice draft or local quiz Map on a rejected change.
- A polite inline size-limit warning appears only on overflow.
- One editor's faulty teardown cannot prevent other editors from being
  disposed or leave the shared document observer active.
- Invalid mixed schema, unsupported execution mode or excess source remain
  code blocks with a warning, not untrusted executable UI.

### §5 R, §6 Trust
- Existing Obsidian host-compatible `@codemirror/state` and
  `@codemirror/view` (excluded from release JS by existing build policy).
  No additional grammar runtime dependencies.
- No user-supplied code executes. Lexical coloring is deliberately not a
  compiler, syntax validator or full grammar parser; unsupported languages
  retain a plain-text editor.
- Generated question text, code and answer review are plain DOM text,
  never `innerHTML` or a script-capable interpreter.
- Browser/DOM state is a presentation concern; native Practice remains the
  only authority for persisted learning evidence.

### §7 Policy, §8 Scope
- CodeMirror view lifetime matches its editor host. User navigation calls
  explicit destroy. External detach calls destroy via one shared observer.
- Input remains editable after a failed evaluation; accepted Practice
  evaluation locks the editor.
- All transient nox-quiz drafts remain in memory while the current visual
  is mounted, not across transcript rerenders. Native Practice remains
  backed by the established onDraft/persistence flow.
- Components always preserve user code text exactly when inside the limit.

### §9 Automated verification
- Shared document observer remains one for multiple editors; final release
  disconnects; same-microtask attach/removal cleans up; stale or throwing
  cleanup does not block others.
- Fallback height expands to content height and shrinks after deletion,
  clamps minimum at 92px, retains content, enforces 40k maximum, shows
  and clears an accessible warning, supports read-only and destroys once.
- 50 mixed questions and a 100-line code answer retain only one active
  editor per response visual; navigation preserves all drafts, result
  counts coding answers only as pending review, and long draft is restored.
- CSS static regression checks protect light-only surface, line wrapping,
  intrinsic height, no nested vertical scroll, keyboard focus contrast,
  and the warning's empty state.
- Existing unit/integration suites, typed lint, boundaries, CSS checks,
  reproducible build and artifact verification run in GitHub CI.
- **No real Obsidian Desktop screenshot/interaction evidence exists yet.**

### §10–§11 Projection and code
The repo uses standard TypeScript/DOM callbacks, not Effect; no Effect
runtime or context layer is introduced.

Relevant files:
- `src/chat/code-editor-lifecycle.ts`: one observer, lifecycle cleanup.
- `src/chat/code-answer-editor.ts`: source bound, warning, fallback,
  read-only and explicit destroy.
- `src/chat/code-syntax.ts`: shared 40k source threshold.
- `src/chat/response-quiz-render.ts`: local draft/navigation/resource ownership.
- `styles.css`: intrinsic height, flat/light, compact responsive layout.
- `tests/chat/code-editor-{lifecycle,styles}.test.ts`
- `tests/chat/code-answer-editor.test.ts`
- `tests/chat/response-quiz.test.ts`

## Release gate: manual Desktop acceptance checklist (pending)

This checklist is **not evidence that a human/agent already ran Obsidian**.
Check each item in the real desktop app, with the PR build and a clean vault:

- [ ] Light and dark Obsidian host: NOX code/editor surface stays flat light,
      syntax colors readable; no unintended dark variants.
- [ ] ~320px sidebar and wider/pop-out windows: no horizontal page overflow;
      long code lines wrap, footer buttons remain operable.
- [ ] Paste/type 100+ lines: code editor grows and only the chat scrolls.
      Delete down to 1 line: editor shrinks (minimum baseline remains).
- [ ] Paste >40,000 chars: blocked with visible warning; previous valid
      draft stays intact. Edits below limit clear the warning.
- [ ] Java, JS/TS, Python, SQL: keyword/string/comment colors appear;
      unsupported language stays plain text. Check unicode/IME/undo.
- [ ] Keyboard: Tab exits to next control, Shift+Tab returns; screen reader
      receives editor label and question progress. Focus order remains sane.
- [ ] Practice: saved draft restored; submit locks editor on success, failed
      submission unlocks and retains code.
- [ ] Typed quiz: 50 mixed questions, Next/Previous, empty drafts, restart,
      result review, and NO code execution/grading claims.
- [ ] Transcript close/reopen and pop-out: no stale editors or detached DOM;
      transient quiz attempt resets on rerender by design.
- [ ] Release package has only expected Obsidian plugin assets. No
      Cloudflare CI or manual deployment is introduced here.

**Merge/release decision:** Keep PR #119 a draft until this checklist is
actually executed and any failed observations are repaired.
