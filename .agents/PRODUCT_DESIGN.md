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

Nox is not primarily a chatbot dashboard, course builder, autonomous note
rewriter, provider manager, or progress analytics product.

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
→ structured proposal
→ ProposalCard
→ Reject / Apply
```

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
transient write failures keep the proposal pending for a safe retry. A changed,
missing, or ambiguous source makes the proposal stale and requires regeneration.

---

## 11. Session and model behavior

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

- RAG and embeddings;
- background indexing;
- autonomous note mutation;
- multi-agent orchestration;
- progress dashboards;
- course builders;
- scheduling;
- provider management UI;
- generalized knowledge graph infrastructure.

---

## 16. Product acceptance criteria

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
