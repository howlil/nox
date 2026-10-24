# NOX UI Feature Ownership — M0–M5 Implementation Contract

Status: implementation in progress on `refactor/ui-feature-ownership`. Baseline: NOX 1.3.1 master, Obsidian desktop.
These milestones **restructure presentation responsibilities**, not the user-facing product, its design tokens, or its persisted schemas.
The canonical UI remains an Obsidian `ChatView` right sidebar plus a declarative `SettingsTab`.

## UI surface graph (design-graph C/V/N)

| Surface | C: content / moves | V: meaningful visible variants | N: prerequisites | Presentation owner | Durable owner |
|---|---|---|---|---|---|
| Composer | prompt, file/context chips, actions, model | empty, running, blocked | session and provider state | Chat shell/composer | SessionController |
| History | select, fork, archive, restore, delete | empty, pending, failed | session snapshot | HistoryPresenter | SessionController |
| Transcript | messages, streaming, variants, retry | empty, running, cancelled, failed | active session | Conversation presentation | SessionController |
| Native Practice | MCQ/essay/code, draft, hint, submit, evaluation | unanswered, assisted, submitting, evaluated | durable question ID in transcript | PracticePresenter | SessionController + learning evidence |
| Response Quick Quiz | 1-question-at-a-time interactive response widget | preview, unanswered, completed | validated response-spec payload | response-quiz-render | **local only**, never mastery evidence |
| Learning Map | objective dependencies, mastery, revision, next action | no program, paused, pending revision | program + evidence | LearningPresenter | VaultProgramStore + VaultLearningStore |
| Activity | heatmap, program filters | empty, populated, read failure | session history from programs | LearningPresenter | VaultProgramStore |
| Focus/Timer | current focus and elapsed time, pause/resume | hidden, active, paused, recovered, failed | active program + session timing | LearningPresenter | VaultProgramStore |
| Onboarding | note/source choice, goal, preview, approve, resume | welcome, form, generating, approving, recovery | current note identity, provider readiness | OnboardingFlow/Presenter | OnboardingStateRepository + VaultProgramStore |
| Provider Settings | select provider/model/auth | disconnected, saving, missing CSS | plugin data + adapter | SettingsTab | PluginDataRepository |
| Provider Usage | read-only quota | loading, live, stale, unavailable | QuotaSync | ProviderUsageSection | in-memory read-through |
| Token Usage | usage chart, model/provider breakdown | empty, populated, tracking failed | token usage ledger | TokenUsageSection | TokenUsageRepository |
| Rich visuals | charts, diagrams, isolated previews | invalid payload fallback, expanded, preview running | committed assistant response or current text | response-visuals | transcript |

**Surface edges:** History → Transcript restore; Review Finding → Practice or Edit composer; Practice → Evaluation → Evidence → Learning Map; Learning Map → authorized command/Next; Focus → Timer/Activity; Settings → Runtime adapter → Composer; Runtime completion → Token Usage ledger. Edges are *user moves or app outcomes*, not direct presenter-to-presenter imports.

## Runtime graph (design-thinking A/E/R)

```text
Obsidian ChatView lifecycle
  → construct UI presenters with narrow callbacks (R)
  → read session / program snapshot from application facade (A)
  → render owned surface (C)
  → user move (event)
    → application admission / validation / authorization
    → durable commit (SessionController or ProgramOrchestrator)
    → explicit owner refresh; no new durable UI ledger
  → close / navigate / switch session
    → invalidate pending timers/async epochs
    → dispose editors, listeners, presenters (scope)
```

* **A / Success:** present the same job outcomes, with state ownership narrowed.
* **E / Expected failure:** provider unavailable, invalid quiz draft, deleted session, cancelled turn, stale program revision, vault write failure. Surface shows a scoped recovery status and never fabricates a commit.
* **R / Capabilities:** injected read/command callbacks, DOM mount point, application interface. Do **not** put repositories or Obsidian host/agent adapters inside feature UI packages.
* **Cardinality:** one active chat session and one active practice question per relevant scope; many transcript messages; many objective nodes; streaming incremental response events.
* **Ordering:** draft persist → submit turn → transcript outcome commit → evidence append/reconcile → UI success.
* **Concurrency:** session change invalidates old render, delayed draft and async response; immutable committed source IDs prevent stale callbacks.
* **Recovery:** replay committed practice/review transcript outcomes through TranscriptEvidenceReconciler. Do not add duplicate mastery records.
* **Trust:** user text, model payloads and vault records retain existing validation at application/domain ingress; a disabled UI control does not confer authorization.
* **Scope:** ChatView owns lifecycle; each presenter owns child timer, DOM events and transient view state. Closing one surface must not abort unrelated canonical app activity.

## Milestone implementation plan and proof

### M0 — Baseline and owner inventory
Implement: capture this graph; document required UI moves, void variants, dependencies and non-goals. Inspect `scripts/boundaries.mjs` and baseline tests.
Proof: no new feature/capability, no migrations, and baseline architecture remains executable.

### M1 — Native Practice Presenter
Implement: presenter owns quiz rendering and draft debounce, active-question/hint projection, evaluation disclosure and cleanup. Application interactions stay behind injected callbacks.
Proof: question ID/session guard, draft before inference, hint only after transcript commit, correct answer only after evaluation, code editor scope, retry/restore across sessions. Quick Quiz remains non-tracked.

### M2 — Conversation and History
Implement: reuse existing HistoryPresenter, TranscriptPresenter and StreamTextPresenter; extract any remaining owner-specific coordination where lifecycle or stale async rendering justifies it. No parallel history implementation.
Proof: session select, history mutation, transcript restore and fork maintain identity, no unexpected active-session changes, presentation disposal.

### M3 — Learning/Onboarding
Implement: a single Learning presentation owner for map, activity and focus summary; retain program read models and VaultProgramStore authority. OnboardingFlow is the existing stateful owner; narrow its external callbacks before moving across package boundaries.
Proof: program switch, paused focus, interrupted async reads, activity filter, onboarding recovery and approved-workspace idempotence.

### M4 — Thin ChatView composition
Implement: ChatView wires lifecycle and routing, event delivery, host Obsidian APIs and cross-feature intent. It must not duplicate presenter's state. Only refactor code once corresponding presenter has proof.
Proof: async cancellation, focus restoration, Escape/popover behavior, new session/switch session/close/reopen, no leaked intervals.

### M5 — Architectural and runtime evidence
Implement: package allow-list only for concrete new owner edges, tests for allowed/forbidden imports and regression paths. Collect CI artifacts; desktop smoke of Default theme, one community theme, narrow pane, keyboard/reduced motion.
Proof: pnpm check:boundaries, typecheck, lint, unit/integration, build, artifact checks; manual desktop remains separate from CI.

## Implementation record (2026-10-21)

| Milestone | Applied implementation | Outstanding acceptance |
|---|---|---|
| M0 | Surface C/V/N matrix, A/E/R flow, persistence and scope contract in this document | Review traceability as code evolves |
| M1 | `PracticePresenter` owns question/evaluation projection and one stale-safe draft debounce; ChatView exposes narrow request callbacks | Desktop quiz/CodeMirror smoke |
| M2 | Existing History/Transcript presenters retained; response toolbar moved to `response-actions-presenter.ts` with typed session-scoped callbacks | Desktop navigation, fork and regenerated-response smoke |
| M3 | `LearningPresenter` owns Learning Map, Activity, Focus Strip, session clock/cache/polling; original `OnboardingFlow` remains the sole onboarding owner | Desktop focus and onboarding recovery smoke |
| M4 | ChatView composes Practice/Learning/Model/Prompt/**Thinking** presenters. `ThinkingPresenter` owns live/restored trace, observed stages, tool rows, disclosure, elapsed time, stale-event guard and interval lifecycle. ChatView retains cross-feature routing and canonical turn dispatch. | Targeted UI tests pass; native behavior remains unverified |
| M5 | Explicit architecture allow-list, presenter tests and final race-condition fixes (single-flight Practice draft, post-close streaming guard, retryable Model selection), with automated architecture and presenter tests | CI on final HEAD |

### M5 audit findings and verification boundary (2026-10-21)

**Code-review findings resolved in this branch:**

1. **Practice write ordering:** overlapping draft flushes could write older text after newer input. `PracticePresenter.flushDraft()` now serializes in-flight writes and loops until the newest pending edit has been committed. Failed writes retain the draft for retry. `onSubmit` waits for a successful pending draft write rather than discarding it pre-emptively.
2. **Stale stream after leaf close:** `runTurn()` now compares its captured `viewEpoch` before forwarding each provider event, completing regenerate restoration, and displaying unexpected failures. Late events on detached view are cancelled and ignored.
3. **Model save failure:** `ModelMenuPresenter` no longer closes/pretends success after a failed model selection; selection requests are single-flight, with a visible retry path.

**Automated verification:** `tests/chat/practice-presenter.test.ts`, `tests/chat/model-menu.test.ts`, and `tests/architecture/ui-feature-ownership.test.ts` include regression proof for these fixes. The existing CI runs architecture, TypeScript, lint, integration, CSS, build and artifact checks.

**Automated UI verification:** `docs/PORTABLE_CORE_M7_ACCEPTANCE.md` records the automated portability and release verification contract. CI cannot establish live UI/provider behavior; source-bound release certification and attestation remain mandatory.

### M4 follow-up: Thinking UI owner (2026-10-21)

**Surface:** Live agent activity trace above the assistant response; restored traces reconstructed from committed conversation messages.

- **C:** real observed runtime phases, tool start/completion, context inspector, optional model thought text, elapsed time, response-completed or interrupted label.
- **V:** actively running (expanded by default), waiting for model, tool running/done/failed/interrupted, completed (auto-collapsed unless explicitly expanded), stopped/failed, historical restored trace (collapsed by default).
- **N:** stream event emitter from LearningController, a valid ChatView thread mount, action label and NOX logo URL. The UI does **not** own inference, program state, transcript writes, or token accounting.
- **Moves:** incoming event → incremental phase/tool UI; manual disclosure toggle → expanded/collapsed with aria sync; terminal event → final label + mark pending tool calls interrupted; restore → read-only historical activity display.
- **Ownership:** `ThinkingPresenter` owns all live trace DOM references, stage/tool map, `NoxRunInspector`, elapsed 500ms interval, auto-follow of activity viewport, optional thought projection, restored trace renderer, and cleanup. `ChatView` owns `streamText` and assistant bubble responses and forwards only observed runtime events.
- **Ordering/invariants:** No fabricated phases or tools; tool-completed without observed tool-started is ignored; historical model-provided thought text must not be auto-disclosed; settlement retains the DOM but releases only the live state/timer; close/session change/dispose invalidate live state. After terminal/cancel, stale thought/tool events cannot re-open the activity trace.
- **Trust:** model-supplied thought/tool labels are rendered with textContent/Obsidian text helpers, not HTML injection. No raw model output is used to issue host actions.

**Regression proof:** `tests/chat/thinking-presenter.test.ts` covers observed-only stages, interrupted tools, restored disclosure state, timer count/cleanup, and late-event admission; `tests/chat/thinking-layout.test.ts` now verifies the presenter directly owns both live and restored thread child nodes. No data migration or style token changes.

### M4 follow-up: Prompt Menu owner (2026-10-21)

**Surface:** Composer action/search overlay shared by typed `/command` and `@note`.

- **C:** available Learning actions, live vault-note search, attached sources, program selector, command hints.
- **V:** closed, source search, command search, disabled current-source row, empty matches, nested learning-programs page, failed program-index read (fallback actions).
- **N:** composer input/token, current note/selection, explicit context references, application action-menu/program read models. The presenter never reads the vault or session repositories directly.
- **Moves:** source token → select/attach; slash token → action/scope/programs/back; ArrowUp/ArrowDown → select; Enter/Tab → accept; Escape/outside click → dismiss.
- **Ownership:** `PromptMenuPresenter` holds menu kind/page, active row, query-reset, visible DOM/aria, async request counter and disposal. `ChatView.getPromptMenuItems()` remains the application-facing read-model adapter, and `pickPromptMenuItem()` remains the authorized command-routing callback.
- **Stale responses:** newer typed query, close or session change invalidate the old DOM projection. Old program-index results must not revive a cached command menu after it closes.
- **Trust:** unknown slash queries must never fall through as unsolicited provider prompts; exact recognized scope commands continue to use the existing parser and application authorization.

**Verification:** `tests/chat/prompt-menu-presenter.test.ts` covers keyboard selection/Escape, stale reads, menu disposal, programs/back, and invalid slash command admission. No persistence schema or design-token changes.

### M4 follow-up: Model Picker and draft navigation (2026-10-21)

Surface<C,V,N> for the model picker:
- **C:** runtime default, discovered models, manual selection, selection checkmark and explicit retry.
- **V:** closed, open, discovering, discovery failure, no catalog, manually selected ID.
- **N:** NoxComposer menu anchor, read-only model catalog, current session model and the LearningController runtime command.
- **Moves:** trigger → open → choose model / retry; Escape/Tab/outside click → close; successful selection → close and focus trigger.
- **Ownership:** `ModelMenuPresenter` owns the popover, rows, keyboard index, pending discovery UI, and listener lifetime; application `LearningController.setModel()` remains sole write path. `ChatView` wires callback ports only.
- **Async:** discovery completion after view disposal must not render into detached DOM. The model picker is recreated when the Obsidian leaf reopens.
- **Failure:** model persistence failures are reported, the menu closes and the currently committed model remains authoritative.

A new navigation invariant surfaced during review: Practice answer debouncing must not silently discard unsaved text when creating, switching, forking, archiving, or closing a session.

```text
user types answer
  → PracticePresenter.pendingDraft
  → navigation or close intent
  → flushDraft via LearningController.savePracticeDraft
  → durable SessionController write
  → session transition
  → presenter reset / old async work invalidated
```

A failure to save the draft prevents navigation/other mutation and leaves the draft pending for retry; closing a view attempts the flush and reports a persistence error if it cannot save.

**Proof:** `tests/chat/model-menu.test.ts` covers keyboard Escape, focus restoration and late discovery after disposal; `tests/chat/practice-presenter.test.ts` covers flushing pending essay edits once, retrying failed writes, and not writing to a new session. Existing architecture and integration suites continue to be run in CI.

Turn admission also invokes `PracticePresenter.flushDraft()` before clearing Composer or emitting a new learning turn. A synchronous `turnStarting` latch precedes that await (preventing rapid double-send); a `viewEpoch` invalidates pending starts after session navigation or Obsidian view close. This applies to hints as well as ordinary composer sends. `tests/architecture/ui-feature-ownership.test.ts` locks the ordering against regressions.
The shared code-answer editor remains under `src/chat` because both tracked Practice and untracked Rich Quick Quiz use it. No file migrations and no changes to `src/main.ts` or persisted schemas are part of this patch. It is intentionally not a blanket rewrite of 3,000 lines of ChatView without host acceptance.

## Non-goals / compatibility contracts

- No change to `nox-sessions`, `nox-settings`, `nox-token-usage-v1`, `nox-onboarding`, `00-learning-os/programs.json`, or `00-learning-os/progress.json`.
- No new global event bus, app state framework, or unnecessary atoms/layers.
- No movement of the shared code-answer editor into the Practice-only package; both Practice and non-tracked response Quick Quiz import it.
- No direct feature UI → persistence, provider adapter, or Obsidian host API dependencies.
- No release without certified CI and attested artifacts; PR #128 is a separate Settings fix.
