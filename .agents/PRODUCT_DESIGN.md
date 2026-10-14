# Nox — Product Design Specification

Status: **Canonical current product direction**
Owner: howlil
Scope: Obsidian desktop plugin
Primary interface: right-sidebar Learning OS workspace
Last updated: 2026-09-25

---

## 1. Product definition

Nox is an AI learning companion that lives beside material already stored in
Obsidian.

It turns the current note, selection, and explicit supporting context into a
small learning loop:

```text
material + explicit context + learning state
→ ask / explain / practice / review / edit
→ understanding + evidence + approved vault change
```

The core promise is:

> **Nox helps the user understand, test, review, and safely improve learning
> material without leaving the note they are working on.**

Nox is not primarily a chatbot dashboard, autonomous note rewriter, provider
manager, or progress analytics product. It additionally supports opt-in,
goal-based **domain-neutral learning programs** with validated curricula,
explicit constraints, objective-scoped evidence and timeboxed sessions.
See `docs/LEARNING_ORCHESTRATOR.md` for the newer product contract.

---

## 2. Product principles

### 2.1 Context before configuration

The current learning material should be useful immediately.

Default context:

```text
selection
→ otherwise current note
```

Explicit context is additive, not a replacement for understanding what is
currently active.

### 2.2 Evidence before progress

Durable learning state changes only from meaningful evidence.

```text
interaction
→ meaningful evidence?
→ evidence
→ learning-state transition
```

A normal question is not proof of mastery.

### 2.3 User owns consequential edits

Nox may propose a Markdown change, but the user decides whether it is applied.

```text
proposal
→ inspect
→ Apply / Reject
→ exact revalidation
→ mutation
```

No silent note rewrite.

### 2.4 Learning modes are intents, not separate products

Ask is the default.

Explain, Review, and Edit are one-turn intents.

Practice is the only persistent learning mode because it has a multi-turn state
machine. The UI intent persists after a question is generated until the answer
is evaluated and the practice session ends; generating a question does not end
the user's practice interaction.

### 2.5 Native Obsidian behavior matters

Nox should feel like part of the current note workflow.

Selection retention, editor state, keyboard behavior, and native Undo are
product behavior, not implementation details.

### 2.6 Structured UI only where structure adds value

Normal AI prose is rendered inline.

Use structured cards for states where the user must understand or act on a
specific object: practice, review findings, edit proposals, errors, and
operational status.

---

## 3. Core product objects

### 3.1 TurnContext

The context visible to the user and sent to the agent for one turn.

```text
TurnContext
├── automatic primary context
│   ├── selected text
│   └── current note fallback
├── explicit readable context
│   ├── @vault-note
│   └── attached text file
└── system context
    ├── vault policy
    └── learning progress
```

User-selected context and system context remain conceptually separate.

### 3.2 LearningAction

```text
ask
explain
practice
review
edit
```

Ask is implicit default.

### 3.3 LearningEvidence

A meaningful observation that may change the learner model.

Examples:

- evaluated practice answer;
- explicit misconception observed during practice;
- other future evidence defined by the learning domain.

### 3.4 LearningGap

A durable learning-state item such as a misconception, weak relationship, or
known area still being improved.

Its lifecycle is owned by learning-state domain rules, not the UI or store.

### 3.5 PracticeSession

The active recall lifecycle:

```text
question
→ answer
→ evaluation
→ evidence
→ next question / complete
```

### 3.6 ReviewFinding

A structured finding about the learning material.

Material finding types may include:

- misconception;
- missing relationship;
- factual error;
- weak explanation.

A ReviewFinding describes the material. It does not automatically mean the user
has that weakness.

### 3.7 EditProposal

A proposed exact Markdown replacement associated with the currently authorized
mutable note.

States:

```text
pending
→ applied
→ rejected
→ stale
```

### 3.8 Conversation

A durable session containing user/assistant history, model selection context,
and proposal history needed to restore a useful thread.

Conversation history is not the canonical owner of learning-domain state.

---

## 4. Information architecture

Nox uses one Obsidian right-sidebar ItemView.

```text
NoxView
├── Header
│   ├── product identity
│   ├── session/history controls
│   └── model/runtime controls when needed
├── Thread
│   ├── user turns
│   ├── inline responses
│   ├── practice states
│   ├── review findings
│   ├── edit proposals
│   ├── operational status
│   └── recoverable errors
└── Composer
    ├── prompt input
    ├── intent
    ├── visible context
    └── send / stop
```

Do not turn the sidebar into a dashboard.

---

## 5. Intent model

### Ask

Default path.

```text
context + question
→ streamed answer
→ Ask remains default
```

No explicit mode selection is required.

### Explain

One-shot intent.

```text
choose Explain
→ next turn explains active material
→ return to Ask
```

### Review

One-shot structured analysis of the material.

```text
choose Review
→ structured findings
→ optional Practice or Fix action
→ return to Ask
```

### Edit

One-shot intent for proposing a note change.

```text
choose Edit
→ proposal
→ Apply / Reject
→ return to Ask
```

### Practice

Persistent only while the active practice lifecycle exists.

```text
start Practice
→ question
→ answer in main composer
→ evaluation
→ evidence
→ next question / complete
```

---

### Domain-neutral learning programs (2026-10-14)

General programs are created with `/plan`; they are NOT implicitly backend-scoped.
Program objectives and prerequisites come from a validated curriculum, activity
priority from deterministic domain rules, and learning evidence from evaluated
Practice answers. A plan is not proof of competence. Explicit session timeboxes
and source restrictions are enforced by the application. Users can inspect
progress without starting an agent turn. Goal controls remain optional: Ask,
Explain, Review, Edit and free Practice still work without a plan.

The legacy opt-in backend scope lock below is retained for older sessions.

### Backend scope lock

New conversations start in **FREE** mode. Existing learning intents remain
available there. Backend curriculum modes are opt-in:

- `/mode assessment` enters **BASELINE_ASSESSMENT** for diagnostic backend questions.
- `/mode focused` enters **FOCUSED_LEARNING** for the current backend concept.
- `/pause` or `/mode free` permits free discussion and retains the backend question.
- `/resume` restores the saved backend mode and unanswered question.

Commands must be standalone user submissions. Slash-menu selection prepares a
command; Send/Enter submits it. Mode entry acknowledges the lock and asks the user
to send `mulai` for the first question. Relevant notes ground questions; absent
relevant material, use backend fundamentals. Ordinary text and model output never
change modes.

While locked, messages address the active question or its necessary prerequisites.
Wrong answers and admissions of not knowing remain valid evaluation inputs.
Hints/clarification retain the question without creating learning evidence.
Product design, feature brainstorming, unrelated chat, and topic/role-switch
requests receive a brief application-authored deflection to the exact active
question. OOS input must not advance the question or learner progress. Review/Edit
shortcuts and historical Apply actions require an explicit pause first.

Mode and pause state survive session switching and plugin restart. Free Practice
while paused cannot replace the backend question. Question completion does not
implicitly unlock a mode or promote assessment to focused learning. Explicit mode
commands retain any pending backend question.

The model judges semantic relevance; this is not a guarantee against every
adversarial prompt. The application enforces transitions, output shape, terminal
success, and progress effects. Missing/invalid/duplicate scope decisions fail
closed with retry while retaining the active question.

## 6. Context model

### 6.1 Automatic context

Priority:

```text
selected text
→ current note
```

If text was selected before the user focuses Nox, that selection should remain
the turn context when the product can faithfully retain it.

### 6.2 Explicit vault context

Typing `@name` searches Markdown notes.

Selecting a result:

1. removes the `@...` token from user content;
2. adds the note as visible context;
3. sends the actual note content to the agent;
4. does not make the supporting note writable.

### 6.3 Attached text context

Text attachments are readable supporting context.

Binary artifact workflows are outside the current product boundary.

### 6.4 System context

Vault-root learning policy and durable learning progress may be sent to the
agent, but they are not presented as user-selected source chips.

---

## 7. Thread presentation

Thread primitives:

- UserBubble;
- PlainResponse;
- StatusTrace;
- PracticeCard;
- PracticeEvaluation;
- ReviewFindingCard;
- ProposalCard;
- ErrorRow.

Normal assistant prose is inline rather than wrapped in a generic card.

The thread should preserve conversational continuity without hiding structured
learning state.

---

## 8. Practice behavior

Question creation:

```text
active material
+ current learning state
→ practice question
```

Answer submission uses the main composer.

Evaluation:

```text
question + answer + context
→ structured evaluation
→ evidence
→ learning-state transition
→ next question / complete
```

Failure semantics:

```text
evaluating
├─ failure
├─ cancel
└─ timeout
    ↓
same active question remains answerable
```

A failed evaluation must not destroy the question the user just answered.

---

## 9. Review behavior

Review emits only material gaps worth acting on.

Each finding should make clear:

- what is wrong or weak;
- where it appears;
- why it matters;
- the next useful action when available.

Possible actions:

```text
finding
├─ Practice
└─ Fix
```

Review evidence remains material-scoped unless a separate learner interaction
creates learner evidence. Each follow-up Practice/Fix action retains the
source note provenance of the Review finding. A Fix cannot silently write to
a different active note after navigation.

---

## 10. Edit behavior

The product flow is:

```text
Edit intent
→ validated single proposal candidate
→ successful agent completion
→ durable narrative + proposal commit
→ ProposalCard
→ Reject / Apply
```

During streaming, only narrative is shown; Apply and Reject are not actionable
until the complete proposal is durably recorded. Failed/cancelled/invalid
streams never display a ProposalCard. A retry of the same logical turn must
not duplicate a committed edit or reopen a settled one.

Apply must revalidate against the current document.

```text
authorized current note
→ exact old text
→ unique match?
├─ no → stale / ambiguous
└─ yes → editor transaction
```

Supporting context cannot become a mutation target merely because the model
mentions it.

Native Undo must remain available after Apply. Missing open editor and
pre-mutation failures keep Apply available for a safe retry. When editor Apply
succeeds but saving its applied status fails, remove Apply/Reject and show
"Edit was applied; status not saved" with a separate Retry status sync action.
That action must never execute the editor mutation again. Do not silently
navigate sessions while that receipt is unresolved. A changed,
missing, or ambiguous source makes the proposal stale and requires regeneration.

---

### Chat history management

History is persisted by the existing SessionController/SessionStore boundary.
Sessions can be selected in bulk, all visible chats in the current folder can
be selected, and chats can be archived, restored or deleted. Archive preserves
the transcript; deletion is permanent and requires confirmation. Current-session
removal automatically selects an available unarchived session or creates one.
These are blocked while agent turns, plans, note edits or unsynchronized Apply
status are active. Swipe gestures never bypass the same guarded actions.

### Appearance

NOX provides one flat, light-only scoped theme across the sidebar, Settings
and owned menus/dialogs; it does not alter Obsidian's host appearance.
There is no separate dark-mode or Appearance control.

## 11. Session and model behavior

Nox Settings selects AGY or local Codex CLI as the runtime provider. Existing
installations default to AGY. Provider changes take effect immediately while idle,
refreshing the runtime and model menu together. Active turns, note edits, and
pending edit status recovery must finish before runtime settings can change;
the executable path is retained separately for each provider. Local CLI sign-in
owns authentication. Nox keeps no provider API key.

Conversation history, learning evidence, and active backend scope survive provider
changes. Incompatible runtime thread/model state is reset before sending to a new
provider. Codex's model picker lists visible models from its local CLI catalog,
alongside Runtime default. An explicit model can be entered in Preferred model
and is shown by ID when absent from the catalog. Discovery failure preserves
default/manual choices. The catalog is not an account entitlement guarantee.
Codex cannot directly edit notes: normal Nox proposal
review and native editor Apply remain authoritative.

The user may create and switch conversations.

A session switch restores conversation history and session-level settings that
belong to that conversation. Switching and creating sessions are unavailable
during active turns. All asynchronous writes remain bound to the session that
started the turn, regardless of which conversation is currently visible.

Pending proposal state must never be restored as silently applicable after a
restart when its source document can no longer be trusted as unchanged.

Model selection is a runtime preference, not a learning-domain rule.

Provider implementation details are not normal product language.

---

## 12. Loading, cancellation, and errors

Running UI may show real operational state and elapsed time.

It must not invent timer-driven fake steps.

Recoverable failure states include:

- runtime unavailable;
- malformed structured response;
- cancellation;
- timeout;
- stale edit proposal;
- ambiguous replacement;
- missing context.

After failure or cancellation, the composer returns to a usable state when
runtime is available. When the agent runtime is unavailable, the local
conversation history remains readable while sending is disabled.

Errors should describe the action the user can take next rather than expose raw
provider protocol.

---

## 13. Keyboard interaction

Core behavior:

- Enter — send;
- Shift+Enter — newline;
- `@` — source menu;
- `/` — command/intent menu;
- Arrow keys — navigate active menu;
- Enter/Tab — select;
- Escape — close menu or stop/cancel the active action when appropriate.

Command tokens are interaction syntax and must not leak into the final prompt.

---

## 14. Visual direction

Detailed visual rules live in `DESIGN.md`.

Product-level direction:

- compact;
- white/Obsidian-surface first;
- calm and technical;
- minimal hierarchy;
- semantic accent used sparingly;
- no dashboard-like density;
- no decorative gradients or oversized hero composition;
- cards only when they represent a real interaction object or state.

Visual styling must not obscure context, learning state, or the primary action.

---

## 15. MVP feature boundary

Current product scope:

- right-sidebar workspace;
- streamed Markdown answers;
- Ask / Explain / Practice / Review / Edit;
- current selection and active note context;
- explicit vault-note and text context;
- model choice;
- practice evaluation;
- structured review;
- evidence-backed learning progress;
- safe edit proposal and approval;
- local session persistence;
- recoverable runtime states.

Deferred until a concrete product need exists:

- external and embedding-based RAG;
- always-on background indexing;
- autonomous note mutation;
- multi-agent orchestration;
- progress dashboards;
- visual course dashboards;
- background scheduling and notifications;
- provider management UI;
- generalized knowledge graph infrastructure.

---

## 16. Product acceptance criteria

### Domain-neutral learning programs

- A plan has measurable objectives, a valid acyclic dependency graph and explicit time/source constraints.
- Source-bound objectives cite only approved material.
- A scheduled session must start before new program Practice activities.
- The model cannot directly establish mastery or override objective selection.
- Due recall and remediation take precedence over new topics; timebox exhaustion stops new activities.
- Program evidence includes program and objective IDs and survives restart.
- Revealed hints do not count toward independent mastery.

### Default learning flow

- Ask works without choosing a mode.
- Selection is preferred over current-note fallback.
- Explicit context contains real source content.
- Normal assistant prose renders inline.

### Intent behavior

- Explain, Review, and Edit reset after one turn.
- Practice persists only for its active session.
- Slash command syntax is not sent as user content.

### Practice

- The active question survives evaluation failure/cancel/timeout.
- Evaluation creates evidence only through the learning-state rules.
- One correct answer is not automatic mastery.

### Review

- Findings are structured and material-scoped.
- Review does not silently label the learner with a gap.
- Practice/Fix actions preserve the finding context.

### Editing

- Proposals remain pending until explicit Apply/Reject.
- Apply revalidates an exact unique match.
- Supporting notes remain read-only.
- Applied changes remain Undo-safe.

### Runtime

- Cancel and failure return to a usable composer.
- Raw provider protocol does not appear in normal UI.
- Product behavior remains independent from a specific provider adapter.

### Visual

- The surface remains compact and native to the Obsidian workflow.
- Context and action hierarchy are immediately understandable.
- Detailed implementation follows `DESIGN.md`.

---


## Runtime observability in Settings

Settings displays provider-reported Nox-only input/output/total token usage,
cached input, reasoning, and request counts. Filter by runtime provider, model,
and time horizon without changing the current learning turn. The plugin must
not present usage totals as account-wide credit or plan quota consumption.
Account limits and reset times are unavailable until a trusted provider-specific
integration exists. See `docs/TOKEN_USAGE.md`.

## Remaining credits

NOX can persist explicitly user-entered quota snapshots for model-specific
limits or a shared provider pool. It must label them Manual, never Verified;
display Unavailable when no balance exists; and never subtract token usage from
a manual credit balance. The UI is Settings-only, compact and light-only.

## Provider quota reads

Token Usage separates provider-reported quota windows from manually entered
balance snapshots. An explicit Refresh credits action only performs bounded,
authenticated CLI read-only operations, never an AI inference turn, credit
consumption or quota bypass. The settings view is truthful when no data is
available, when stale, or when pools are shared. ChatGPT direct-plan quota
remains unavailable.
