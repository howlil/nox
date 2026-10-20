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

## Non-goals / compatibility contracts

- No change to `nox-sessions`, `nox-settings`, `nox-token-usage-v1`, `nox-onboarding`, `00-learning-os/programs.json`, or `00-learning-os/progress.json`.
- No new global event bus, app state framework, or unnecessary atoms/layers.
- No movement of the shared code-answer editor into the Practice-only package; both Practice and non-tracked response Quick Quiz import it.
- No direct feature UI → persistence, provider adapter, or Obsidian host API dependencies.
- No merge/release before checks and desktop acceptance; PR #128 is a separate Settings fix.
