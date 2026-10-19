# M1 — Shared Coding Answer Editor (2026-10-19)

Status: implemented in PR #119; pending GitHub CI and real Obsidian Desktop acceptance.
**Do not conflate with M2** (adding code variants to typed nox-quiz) or M3
(comprehensive UI/virtualization/release hardening).

## Contract and shapes (§1)

- CodeAnswerEditorOptions: `language`, `source`, `readOnly`, `onChange(source)`.
- CodeAnswerEditorHandle: `setReadOnly(boolean)`, `destroy()`.
- PracticeAnswer (unchanged): `{type:"code", language, source}`.
- CodeToken: offset range and one of keyword/type/number/string/comment/literal.
- Source of truth: Practice draft in the existing LearningController/session flow,
  NOT EditorView, decoration ranges, or a new persistence store.

## A — Successful implementation graph (§2)

```text
Validated PracticeQuestion(input.type == code)
  -> quiz-card chooses restored draft or minimal starterCode
  -> mountCodeAnswerEditor(language, source, readOnly)
     -> acquire Obsidian's host-compatible CM6 core
     -> EditorState with one CodeMirror view and readonly compartment
     -> EditorView.lineWrapping + light tokens + lightweight token decoration
     -> intrinsic content height (no max-height; no nested vertical scroll)
  -> learner types
     -> CM6 docChanged update -> PracticeAnswer(code, language, source)
     -> existing onDraft -> canonical learning controller/session
  -> user submits
     -> readonly during existing onSubmit
     -> commit accepted -> keep readonly
     -> commit rejected -> restore editable state
  -> transcript view removed -> destroy EditorView
```

Only a changed source is emitted; no source modification, preview execution,
syntax-based grading or compiler is introduced.

## Execution semantics (§3)

One CM6 view for each mounted active code Practice card, synchronous construction
from existing host CodeMirror modules. Updates happen in document order; no network
calls or concurrent worker activity. Lexical decorations are recalculated for
validated maximum 40,000-character answers, never persisted.

## E / boundaries (§4, §6)

- If CodeMirror fails to initialize or a fake/test host has no real DOM,
  use the existing safe textarea behavior with content-based resizing.
  The learner must not be blocked from answering.
- Unexpected runtime/editor failures do not grant privileges to generated code.
- Unsupported languages use a plain CM6 text buffer without misleading syntax.
- Untrusted source is only editor text; no code evaluation, terminal,
  filesystem, network, CSS injection or HTML insertion.
- PracticeAnswer validation and 40,000-character boundary stay owned by
  the existing domain schema.

## R / policies / lifecycle (§5, §7, §8)

- Dependencies: `@codemirror/state@6.5.0`,
  `@codemirror/view@6.38.6`, resolved by the Obsidian runtime via the
  existing external esbuild configuration. Pinned matching development
  dependencies do not embed duplicate CM6 runtime instances.
- Syntax: bounded lexical coloring for Java, JS/TS, Python, SQL. It is **not**
  a full grammar or linter and intentionally does not report validation results.
- NOX's flat white palette applies only to this code answer surface.
- The editor uses no fixed height, no max-height and no nested vertical scroll.
  A compact minimum content area remains; long code expands the chat.
- `setReadOnly` reconfigures the same editor on submission or retry, without
  replacing the document state. `destroy()` is idempotent.
- Owner-document MutationObserver cleans up a view when its host has been
  attached and later detached (e.g. re-render/close). No manual global timers.
- Tab is *not* rebound for inserting indentation; keyboard users can leave
  the editor with Tab.

## Small faithful verification (§9)

- Unit: Java, TS, Python, SQL coloring; string/comment precedence; sorted
  token offsets; unknown/oversized source returns no tokens.
- Practice: restored draft, input/onDraft, submit/readonly, failure/retry
  and existing legacy essay/MCQ behavior.
- CI: architecture boundary, frozen lockfile, typecheck, lint, unit,
  integration, CSS parser and build artifact checks.
- Desktop acceptance (pending): light and dark Obsidian host, Java/TS/Python/SQL
  snippets, wrapping in a 320px sidebar, expansion and shrink after edits,
  100-line code (chat scroll only), pop-out, restored draft, Tab focus,
  failed submission, accepted submission read-only, transcript unmount.

## Explicitly deferred

- **M2:** Extend the `nox-quiz` schema to include code questions and preserve
  per-question source across Next/Previous using this shared editor.
- **M3:** Full grammar parser packages, performance profiling of very large
  edits, broader browser/Obsidian acceptance and deep resource tests.
