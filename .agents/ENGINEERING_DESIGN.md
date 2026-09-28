# Nox — Engineering Design

Status: **Canonical target architecture with incremental migration**
Depends on: `PRODUCT_DESIGN.md`, `../DESIGN.md`
Scope: Obsidian plugin runtime, learning orchestration, context, agent adapter,
persistence, mutation, testing, and delivery
Last updated: 2026-09-25

---

## 1. Engineering goal

Implement the Nox product without allowing framework, provider, persistence, or
UI details to own learning rules.

The engineering system must preserve these contracts:

1. one business rule has one canonical owner;
2. UI captures intent and renders product state;
3. application use cases orchestrate work but do not become domain rule stores;
4. learning and practice transitions are independently testable;
5. context resolution has one source of truth;
6. provider process/protocol details stay behind `AgentAdapter`;
7. persistence stores state but does not decide learning policy;
8. approved Markdown changes go through a safe Obsidian mutation boundary;
9. failure, cancellation, and timeout are explicit state transitions;
10. verification targets the real changed boundary.

Primary target graph:

```text
Obsidian UI
   ↓
application use case
   ↓
domain transition / policy
   ↓
port
   ↓
Obsidian / vault / runtime adapter
```

Provider path:

```text
application use case
→ AgentRuntime port
→ AgentAdapter
→ configured runtime
→ normalized agent events
```

---

## 2. Current architecture and migration direction

Current implementation is already separated into modules, but runtime ownership
does not yet fully match the folder structure.

Observed current path:

```text
ChatView
  ↓
LearningController
  ├── ContextResolver
  ├── PolicyLoader
  ├── VaultLearningStore
  ├── MutationService
  ├── PracticeStateMachine
  ├── StructuredStreamParser
  └── SessionController
          ↓
       AgentAdapter
```

The current architecture is therefore best described as:

```text
modular files
≠
fully separated responsibilities
```

### 2.1 Architecture health state

| Area | Current state | Target |
| --- | --- | --- |
| `ContextResolver` | cohesive | keep as context authority |
| `StructuredStreamParser` | cohesive and independently testable | keep parser-only |
| `PracticeStateMachine` | cohesive state machine | keep domain-owned; fix lifetime ownership |
| `MutationService` | coherent mutation boundary | keep until a concrete split is justified |
| `main.ts` | correct composition root | keep composition-only |
| UI primitives/composer/menu | useful mechanical extraction | keep |
| `VaultLearningStore` | persistence + learning policy | persistence only |
| `SessionController` | conversation + runtime execution | split responsibilities |
| `LearningController` | broad orchestration + state/effect ownership | thin facade over application use cases |
| proposal state | transient Map + persisted session state | one canonical lifecycle owner |
| practice state | controller-instance lifetime | session-scoped ownership |
| plugin data writes | multiple read/merge/write paths | one serialized writer |
| `SessionStore` | exposes mutable stored objects | encapsulated/immutable updates |
| failure model | transport + application failures mixed | typed product/application failure union |
| `types.ts` | cross-domain type drawer | types colocated with owning modules |
| `ChatView` | presentation + workflow coordinator | Obsidian view + presentation composition |

### 2.2 Concrete boundary drift

#### LearningController

`LearningController` currently has too many reasons to change:

```text
context preparation
practice coordination
prompt construction
stream interpretation
proposal lifecycle
learning persistence
conversation persistence
timeout / cancellation
error translation
UI event projection
```

This is the main application-layer smell.

The problem is not line count. The problem is mixed ownership and mixed levels
of abstraction.

#### VaultLearningStore

Current behavior resembles:

```text
load JSON
→ create evidence
→ decide gap transition
→ update topic
→ save JSON
```

Persistence therefore owns learning policy.

Target:

```text
repository.load()
→ pure learning-state transition
→ repository.save(next)
```

#### SessionController

Current responsibility includes:

```text
session CRUD
+ plugin persistence
+ model preference
+ model discovery
+ runtime health
+ agent execution
+ conversation ID updates
+ proposal history
```

Conversation state and runtime execution have different reasons to change and
must become separate boundaries.

#### Proposal lifecycle

Proposal state currently exists in both:

```text
LearningController.pendingProposals
+
ChatSession.messages[].proposalState
```

This is duplicate canonical state.

Target:

```text
one Proposal lifecycle
pending
├─ applied
├─ rejected
└─ stale
```

#### Practice lifetime

Practice is currently owned by one `LearningController` instance and reset on
session changes.

Target lifetime:

```text
conversation/session
→ practice state
```

Do not persist it merely for architecture purity; first make its owner explicit.
Persist only if the product contract requires restart continuity.

#### Plugin data persistence

Settings and session code both perform read/merge/write operations against
plugin data. Some callers also initiate persistence without awaiting completion.

That creates a correctness risk:

```text
load snapshot A
load snapshot B
→ save A
→ save B with stale unrelated fields
```

Target:

```text
all plugin-data mutations
→ PluginDataRepository
→ serialized update
→ plugin.saveData
```

This is a correctness boundary, not only a cleanup.

### 2.3 Engineering principles applied

Nox should use principles as decision tools, not as reasons to add layers.

| Principle | Nox interpretation |
| --- | --- |
| SRP | one module has one primary reason to change |
| DIP | application code depends on ports at real I/O boundaries |
| ISP | ports expose only the operations required by a use case |
| Encapsulation | repositories do not leak mutable internal state |
| DRY | one business rule/state owner; syntax duplication is secondary |
| KISS | no command bus, event bus, DI framework, or repository framework without need |
| YAGNI | abstractions are introduced only for a current boundary or testability need |
| Functional core | domain transitions are pure where practical |
| Imperative shell | Obsidian, process, filesystem, and persistence remain adapters/effects |
| High cohesion | types, rules, and tests for one concept stay near each other |
| Low coupling | provider and Obsidian details do not leak into domain code |
| Explicit state machine | lifecycle transitions are modeled rather than inferred from flags |
| Single source of truth | one canonical owner for proposal, practice, session, and learning state |
| Fail explicitly | failure categories preserve where and why an operation failed |

Do not optimize for "Clean Architecture" terminology itself.

The target is:

```text
clear ownership
+ local reasoning
+ small blast radius
+ faithful tests
+ fast shipping
```

These are migration targets, not reasons for a rewrite.

Refactor only when a concrete slice crosses one of these boundaries.

---

## 3. Target repository shape

Nox can stay a single package.

Recommended direction:

```text
src/
├── application/
│   ├── RunLearningTurn.ts
│   ├── ApplyProposal.ts
│   ├── ChangeSession.ts
│   └── ports.ts
├── domain/
│   ├── learning-state/
│   │   ├── types.ts
│   │   └── transitions.ts
│   ├── practice/
│   │   ├── types.ts
│   │   └── PracticeStateMachine.ts
│   └── proposal/
│       └── types.ts
├── agent/
│   ├── AgentAdapter.ts
│   ├── StructuredStreamParser.ts
│   └── AgyAdapter.ts
├── context/
├── persistence/
│   ├── LearningStateRepository.ts
│   └── SessionRepository.ts
├── mutation/
├── chat/
├── ui/
├── settings/
└── main.ts
```

This is a dependency/ownership target, not a required bulk file move.

A compatibility `LearningController` facade may remain while use cases migrate
behind it.

---

## 4. Dependency direction

Allowed direction:

```text
UI / Obsidian adapter
        ↓
application use case
        ↓
domain rules
        ↓
ports
        ↓
infrastructure implementation
```

Domain code must not depend on:

- Obsidian view classes;
- DOM;
- child-process APIs;
- provider-specific event shapes;
- plugin data APIs;
- editor instances.

Persistence adapters may serialize domain state. They do not decide domain
transitions.

UI may project domain/application state. It does not recreate business rules.

---

## 4.1 Mandatory architecture boundary rules

These rules are the default placement and dependency contract for every
non-trivial code change.

The goal is not to maximize layers. The goal is to make ownership and dependency
direction obvious before code is written.

### Layer responsibilities

```text
Presentation
    ↓ commands / queries
Application
    ↓ domain decisions
Domain

Application
    ↓ ports
Infrastructure / adapters
```

#### Presentation

Examples:

- `ChatView`;
- settings UI;
- composer/menu/popover primitives;
- Obsidian-specific rendering and interaction surfaces.

Presentation owns:

- rendering;
- local visual state;
- translating user interaction into application commands;
- projecting application/domain state for display.

Presentation must not own:

- learning rules;
- proposal validity;
- practice transition rules;
- persistence semantics;
- provider/runtime protocol;
- direct plugin-data writes.

A UI check may improve interaction quality, but correctness must still be
enforced below the UI boundary.

#### Application

Examples:

- `RunLearningTurn`;
- `ApplyProposal`;
- `RejectProposal`;
- `ChangeSession`;
- model/session coordination use cases.

Application owns:

- workflow ordering;
- effect coordination;
- turn/session lifecycle coordination;
- calling domain transitions;
- deciding when repositories and external ports are invoked;
- translating boundary failures into product/application failures.

Application does not own the detailed meaning of domain state.

Use this distinction:

```text
"What does this state transition mean?"
→ domain

"When should this transition and its effects happen?"
→ application
```

Application may depend on domain modules and narrow ports.

Application must not depend directly on:

- AGY-specific protocol shapes;
- child-process APIs;
- Obsidian view/editor implementation details;
- raw `plugin.loadData/saveData`;
- persistence serialization formats.

#### Domain

Domain owns state meaning and valid transitions.

Current Nox domain responsibilities include:

- learning evidence and gap transitions;
- practice lifecycle;
- proposal lifecycle where transition validity is business state rather than
  Obsidian write mechanics.

Domain code must remain pure where practical.

Domain must not import:

- `obsidian`;
- DOM APIs;
- child-process APIs;
- provider-specific protocol;
- plugin-data APIs;
- repository implementations;
- UI components.

Domain may expose plain types, pure functions, and state machines.

#### Ports

Create ports only for real side-effect, storage, or external-system boundaries.

Valid examples:

- `AgentRuntime`;
- `SessionRepository`;
- `LearningStateRepository`;
- `PluginDataStore`;
- `MutationPort`.

Do not create an interface merely because a class exists.

A port is justified when at least one is true:

- application/domain must not depend on the external implementation;
- the boundary represents I/O or durable state;
- the boundary needs a faithful substitute in tests;
- ownership would otherwise leak across layers.

#### Infrastructure / adapters

Infrastructure implements ports and owns integration mechanics.

Examples:

- `AgyAdapter` and provider protocol handling;
- Obsidian vault/editor adapters;
- plugin-data persistence;
- session serialization;
- vault learning-state serialization.

Infrastructure decides **how** an effect happens.

It must not decide **what domain state means**.

Examples:

```text
GOOD
LearningStateRepository.save(nextState)

BAD
VaultLearningStore.recordPracticeEvaluation(...)
→ creates evidence
→ decides gap transitions
→ saves state
```

Persistence stores domain state; it does not own domain policy.

#### Composition root

`main.ts` owns construction and wiring only.

It may:

- instantiate adapters;
- compose repositories and use cases;
- register Obsidian views, commands, and settings;
- dispose application/runtime resources.

It must not become a fallback location for business rules or cross-module state
reconciliation.

### Mandatory placement test

Before adding or moving non-trivial behavior, identify:

```text
responsibility
→ authoritative owner
→ layer
→ allowed dependencies
→ state/effects touched
→ consumers
```

Then apply these questions in order:

```text
Does this determine the meaning or validity of state?
→ Domain

Does this coordinate a workflow or sequence effects?
→ Application

Does this only store/restore state?
→ Repository / persistence adapter

Does this communicate with Obsidian, AGY, filesystem, process, or plugin data?
→ Infrastructure adapter

Does this only capture user intent or render state?
→ Presentation
```

If a responsibility cannot be placed without crossing these rules, fix the
boundary before adding another parallel path.

### Allowed dependency direction

Canonical dependency direction:

```text
Presentation
    ↓
Application
    ↓
Domain

Application
    ↓
Ports
    ↑
Infrastructure
```

Allowed:

```text
presentation → application
application  → domain
application  → port
infrastructure → port contract
infrastructure → domain data required for serialization
main.ts → concrete implementations for composition
```

Forbidden:

```text
domain → presentation
domain → infrastructure
domain → Obsidian
domain → AGY/provider
domain → plugin data

application → concrete AgyAdapter
application → Obsidian view/editor implementation
application → plugin.loadData/saveData

repository → domain policy decisions
UI → direct durable-state mutation
adapter → product workflow decisions
```

Do not use an event bus, command bus, DI framework, or generic repository
framework to enforce these rules. Direct dependencies are preferred when the
boundary is already clear.

### State authority rule

Every consequential state must have exactly one authoritative owner.

For each state answer:

- who owns the source of truth?
- what is its lifecycle?
- who may mutate it?
- who may read it?
- may projections or cached copies exist?
- what invalidates those copies?
- does it require serialized writes or transaction-like ordering?

Derived UI projections and immutable snapshots are allowed.

Multiple mutable authorities are not.

Examples:

```text
learning meaning
→ learning-state domain

learning-state storage
→ LearningStateRepository

conversation/session state
→ SessionRepository

proposal lifecycle
→ proposal application/domain boundary

practice lifecycle
→ PracticeStateMachine scoped to session lifetime

active turn/cancellation
→ RunLearningTurn / application turn coordinator

runtime/process state
→ AgentRuntime adapter

plugin-data writes
→ one PluginDataRepository serialized writer
```

### One operation, one legal mutation path

Callers must not retrieve repository-owned mutable objects and change them
directly.

Prefer:

```text
sessionRepository.appendMessage(sessionId, message)
sessionRepository.setConversationId(sessionId, id)
sessionRepository.transitionProposal(sessionId, proposalId, nextState)
```

over:

```text
const session = repository.getSession(id)
session.messages.push(message)
repository.updateSession(session)
```

Repository reads should return immutable values, snapshots, or values that
cannot mutate repository-owned state accidentally.

### Boundary-first refactoring rule

Do not move files merely to make the directory tree resemble Clean
Architecture.

Refactor in this order:

```text
authority
→ dependency direction
→ mutation path
→ test boundary
→ file/module placement
```

A large file is not by itself an architecture violation.

A small file can still violate architecture when it owns the wrong decision.


---

## 5. Ownership map

| Concern | Canonical owner |
| --- | --- |
| Plugin composition | `main.ts` |
| User intent + rendering | UI/chat layer |
| Turn orchestration | `RunLearningTurn` application use case |
| Session switching | `ChangeSession` application use case |
| Proposal application | `ApplyProposal` application use case |
| Practice lifecycle | practice domain/state machine |
| Evidence/gap transition | learning-state domain |
| Turn context | `ContextResolver` |
| Vault policy | `PolicyLoader` |
| Structured model blocks | `StructuredStreamParser` |
| Runtime/process protocol | `AgentAdapter` implementation |
| Conversation storage | session repository |
| Learning-state storage | learning-state repository |
| Replacement validity | mutation logic |
| Obsidian editor write | Obsidian mutation adapter |

Rule:

```text
one decision
→ one owner
→ all callers route through it
```

---

## 6. Learning-turn application boundary

Target use case:

```text
LearningRequest
→ prepare turn
→ resolve context + policy + learning state
→ build agent request
→ execute runtime
→ normalize structured events
→ apply domain transitions
→ persist effects
→ emit LearningEvent
```

The application layer coordinates order and transaction-like behavior.

It should not contain the detailed rule for whether a learning gap moves from
`open` to `improving`; that belongs to the learning-state domain.

Recommended conceptual interface:

```ts
runLearningTurn(request)
  -> AsyncIterable<LearningEvent>
```

Internal stages may be extracted only when they establish useful ownership or
test boundaries.

---

## 7. Context boundary

`ContextResolver` is the single source of truth for product context.

Resolution:

```text
selection
→ current note fallback
+ explicit note/file context
+ system policy/progress
→ agent context
```

Important distinction:

```text
readable source
≠
mutable source
```

Supporting context is readable.

The authorized current Markdown note is the normal mutation target.

Context resolution tests should prove precedence and the actual source content
sent to the agent.

---

## 8. Agent runtime boundary

Upper layers depend on normalized runtime contracts.

```text
application
→ AgentRuntime / AgentAdapter
→ provider adapter
→ process
```

The provider adapter owns:

- executable discovery;
- argv construction;
- stdin/input transport;
- child-process lifecycle;
- provider stream parsing;
- stderr capture;
- provider-specific model listing;
- low-level cancellation.

It must emit normalized agent events.

User prompt/context must not be shell-interpolated.

Large user-controlled input belongs in stdin or the runtime's structured input
channel, not argv.

Do not refactor `AgyAdapter` merely because it is large; refactor it when
process/protocol ownership actually becomes ambiguous or unsafe.

---

## 9. Structured response parsing

`StructuredStreamParser` owns incremental parsing of structured model blocks.

Current structured product events include concepts such as:

- edit proposal;
- practice question/evaluation;
- review findings.

Parser responsibilities:

```text
raw normalized text stream
→ recognize complete structured block
→ validate shape
→ emit structured parser event
```

It does not persist learning state or decide UI rendering.

Test every meaningful split boundary and malformed/invalid schema path.

---

## 10. Practice domain

Practice is a state machine, not a UI mode flag.

Canonical lifecycle:

```text
idle
→ waiting-answer
→ evaluating
├─ failure/cancel/timeout → waiting-answer
├─ next question → waiting-answer
└─ no next question → complete
```

The state machine owns transition validity.

The application layer owns when to call the model and when to persist resulting
evidence.

The UI owns presentation.

Session ownership must be explicit. Because conversations are durable,
practice state should not accidentally become a process-global singleton.
Migration should move toward session-scoped/restorable practice semantics where
the product contract requires continuity.

---

## 11. Learning-state domain

Learning-state rules must be pure where practical.

Target:

```text
current LearningState
+ LearningEvidence
→ transitionLearningState(...)
→ next LearningState
```

Examples of policy that belong here:

- evidence creation semantics;
- matching evidence to an existing gap;
- allowed gap-state transitions;
- current-topic update semantics.

The repository/store then performs:

```text
load
→ domain transition called by application layer
→ save
```

It must not independently decide the learning policy.

This is the highest-value first boundary correction in the current codebase.

---

## 12. Review evidence semantics

Keep learner evidence separate from material findings.

```text
practice evaluation
→ learner evidence
→ may affect learner gap

review finding
→ material evidence
→ must not automatically imply learner weakness
```

If future product behavior intentionally connects a review finding to learner
state, that transition must be explicit and product-approved.

---

## 13. Proposal and mutation lifecycle

Canonical lifecycle:

```text
structured proposal
→ persist/display pending state
→ user Apply / Reject
→ re-read current note
→ exact unique validation
→ editor transaction
→ applied / stale / rejected
```

Avoid split canonical ownership between an in-memory proposal map and persisted
conversation state.

Migration target:

```text
one proposal record/state
→ one lifecycle owner
→ UI projects it
```

`MutationService` or its successor owns replacement safety and Obsidian write
mechanics, not proposal business history.

Never fall back to blind `vault.modify` when editor semantics and native Undo
are required.

---

## 14. Conversation and runtime separation

Conversation persistence and agent execution are distinct responsibilities.

Target:

```text
ConversationRepository
├── load/list/select/save history
└── proposal/session metadata

AgentRuntime
├── runtime health
├── model discovery
├── execute turn
└── cancel
```

Application use cases compose them.

Do not make the conversation repository aware of provider protocol.

Do not make the runtime own product session history.

---

## 15. State ownership

Nox has several legitimate state machines. They must not collapse into one
global state object.

```text
UI presentation state
→ UI

active turn/cancellation
→ application turn use case

practice lifecycle
→ practice domain/session

conversation history
→ session persistence

learning progress
→ learning-state domain + repository

proposal lifecycle
→ application/session proposal model
```

Each state should answer:

- who may transition it?
- whether it is durable;
- what restores it;
- what invalidates it;
- what consumer observes it.

---

## 16. Normalized product events

The UI consumes Nox events, not provider events.

Conceptual boundary:

```text
provider stream
→ adapter normalization
→ structured parser
→ application/domain effects
→ LearningEvent
→ UI
```

Examples:

- response delta;
- context ready;
- practice question;
- practice evaluation;
- review findings;
- mutation proposed;
- learning state updated;
- completed;
- recoverable failure.

Do not expose provider JSON or protocol names as rendering contracts.

---

## 17. Error and cancellation model

Failures must preserve a usable product state.

Categories may include:

- runtime unavailable;
- protocol malformed;
- timeout;
- cancelled;
- context missing;
- stale proposal;
- ambiguous replacement;
- persistence failure.

Cancellation path:

```text
user stop / view close / unload
→ abort active use case
→ cancel runtime
→ rollback transient transition where required
→ emit recoverable terminal state
```

A failed practice evaluation returns to the same answerable question.

A malformed structured response must not partially mutate durable state.

---

## 18. Persistence boundaries

Current durable state includes:

- conversation/session data in plugin data;
- learning state in the vault;
- note content through Obsidian Markdown/editor APIs.

Principles:

```text
domain decides meaning
repository decides serialization/storage
application decides when effects occur
```

Persistence formats must be decoded defensively.

Legacy state should either migrate explicitly or degrade safely.

Pending mutations restored after restart should default to stale/expired unless
fresh validity can be proven.

---

## 19. Security and process boundaries

- Never shell-interpolate user content.
- Keep provider executable configuration explicit.
- Treat runtime output as untrusted until normalized/validated.
- Do not mutate files outside the user-authorized note path.
- Do not log sensitive note/context content unnecessarily.
- Dispose spawned processes on plugin unload.
- Do not add background autonomous mutation.

---

## 20. Testing strategy

Nox tests follow product risk, not coverage percentage.

```text
pure transformation
→ unit test

state transition
→ behavioral state test

multiple Nox modules
→ service integration

process / Obsidian / filesystem
→ boundary integration

actual plugin interaction
→ real Obsidian smoke
```

The smallest faithful proof wins.

Do not mock a boundary so deeply that the test merely restates implementation.

### 20.1 Automated gate

```text
pnpm typecheck
→ pnpm test:unit
→ pnpm test:integration
→ pnpm build
→ pnpm test:artifacts
```

`pnpm verify` runs the repository's complete automated verification gate.

### 20.2 Module proof map

| Module / boundary | Required proof |
| --- | --- |
| Agent protocol normalization | event/status/error matrix |
| `AgyAdapter` | argv/stdin/stream/cancel process boundary |
| `ContextResolver` | precedence, refs, missing explicit context |
| Obsidian selection context | focus retention + live editor buffer |
| `PolicyLoader` | cache invalidation |
| `StructuredStreamParser` | split boundaries + invalid schema |
| practice domain | every changed transition + rollback |
| learning-turn use case | orchestration + terminal failure paths |
| learning-state domain | evidence/gap transition rules |
| learning-state repository | schema/decode/persistence |
| mutation boundary | authorization, stale, ambiguous, editor-only apply |
| session repository | decoding, legacy load, deterministic CRUD |
| composer token logic | source/command parsing |
| deployment | disposable filesystem integration |
| build | plugin identity + artifact contents |

### 20.3 High-risk proofs

Practice:

```text
question
→ evaluating
├─ failure/cancel/timeout → same question
└─ evaluation → next / complete
```

Learning evidence:

```text
learner evidence
≠
material review finding
```

Editing:

```text
primary mutable note
→ exact unique replacement
→ open Markdown editor
→ replaceRange
→ native Undo
```

Agent transport:

```text
argv → runtime options only
stdin → prompt + context
```

### 20.4 Real Obsidian smoke

Keep these as release-level checks because Node tests cannot prove native
editor/history behavior:

1. select text in a Markdown note;
2. focus Nox and Explain; original selection remains turn context;
3. start Practice, fail/cancel one evaluation, retry; the same question remains;
4. create an edit proposal, Apply, then Undo; original content returns;
5. add a supporting note; Nox may read it but refuses to mutate it;
6. restart Obsidian; pending proposals restore safely as stale/expired;
7. exercise unavailable runtime, cancel, and malformed response; composer returns usable.

Do not claim these behaviors are verified from typecheck/build alone.

---

## 21. Build and delivery

Source inputs:

- TypeScript source;
- root `styles.css`;
- plugin manifest/assets.

Generated output:

```text
dist/main.js
dist/styles.css
...
```

Do not edit `dist/` manually.

Deployment targets:

```text
.obsidian/plugins/nox-obsidian
```

Do not deploy without explicit user intent.

Plugin identity changes are migrations, not cosmetic renames.

---

## 22. Incremental migration sequence

Do not rewrite the architecture in one pass.

The order is dependency-driven:

```text
domain ownership
→ persistence correctness
→ runtime/application boundaries
→ canonical state ownership
→ presentation cleanup
```

### NOW — highest-value boundary corrections

#### Slice 1 — learning-state ownership

Move learning policy out of `VaultLearningStore`.

```text
current LearningState
+ PracticeEvaluation / ReviewFinding
→ pure transition
→ next LearningState
```

Then:

```text
application
→ repository.load()
→ transition
→ repository.save(next)
```

Requirements:

- preserve current observable behavior;
- inject ID/time generation where determinism is needed;
- move business assertions from store tests into domain tests;
- keep repository tests focused on serialization and vault I/O.

#### Slice 2 — serialize plugin-data writes

Introduce one plugin-data persistence owner.

```text
settings mutation
session mutation
future plugin metadata
        ↓
PluginDataRepository.update(...)
        ↓
serialized load / merge / save
```

Requirements:

- no fire-and-forget persistence for operations whose completion matters;
- preserve unrelated plugin-data keys;
- test overlapping updates;
- keep decoding owned by each domain-specific repository/service.

#### Slice 3 — conversation vs runtime

Split the responsibilities currently combined in `SessionController`.

Target:

```text
Conversation / Session boundary
├── create/select/list session
├── append messages
├── proposal/session metadata
└── model preference

AgentRuntime
├── health
├── model discovery
├── execute turn
└── cancel
```

Application use cases compose both.

Do not make the conversation boundary aware of provider protocol.

#### Slice 4 — one proposal lifecycle

Remove duplicate ownership between `pendingProposals` and persisted messages.

Target:

```text
Proposal
├── id
├── sessionId
├── edit payload
├── mutable target
└── state
    ├── pending
    ├── applied
    ├── rejected
    └── stale
```

`ApplyProposal` becomes the canonical transition path.

### NEXT — application and state ownership

#### Slice 5 — practice session ownership

Make practice state explicitly session-scoped.

First target may remain in memory:

```text
sessionId
→ PracticeStateMachine
```

Persist only when restart continuity is a product requirement.

A session switch must select the correct practice state rather than reset a
process-global singleton by accident.

#### Slice 6 — extract RunLearningTurn

Keep `LearningController` as a compatibility facade while moving orchestration.

```text
ChatView
→ LearningController facade
→ RunLearningTurn
```

Target pipeline:

```text
LearningRequest
→ prepareTurn
→ prepareAction
→ executeAgent
→ interpret events
→ apply domain effects
→ persist effects
→ LearningEvent
```

The use case coordinates order. It does not own detailed learning rules.

#### Slice 7 — separate structured-event interpretation from effects

Current `mapStructuredEvents()` is not only a mapper.

Split conceptually:

```text
StructuredStreamParser
→ structured product event
→ application event handler
→ domain transition / persistence
→ LearningEvent
```

Do not create one class per event unless it provides real value.

Remove duplicated handling between streamed parser output and parser finalization
through one shared consumption path.

#### Slice 8 — typed failure model

Replace catch-all failure collapsing with explicit categories.

Conceptual model:

```ts
type NoxFailure =
  | RuntimeFailure
  | ContextFailure
  | ProtocolFailure
  | PersistenceFailure
  | MutationFailure
  | TurnFailure;
```

Requirements:

- preserve failure origin;
- keep user-facing copy at the presentation boundary where practical;
- do not map persistence/domain exceptions to `protocol-invalid`;
- cancellation and timeout remain explicit terminal outcomes.

### LATER — encapsulation and presentation cleanup

#### Slice 9 — encapsulate session mutation

Do not expose repository-owned mutable objects for callers to mutate in place.

Prefer immutable replacement or explicit mutation operations.

Example:

```text
appendMessage
setConversationId
setModel
updateProposalState
```

over:

```text
getSession()
→ mutate returned object
→ remember to updateSession()
```

#### Slice 10 — colocate shared types

Gradually remove the global `src/types.ts` junk-drawer pattern.

Target locality:

```text
agent/agent-types.ts
session/session-types.ts
mutation/mutation-types.ts
context/context-types.ts
domain/.../types.ts
```

Do not create a new global `types/` directory.

Move a type only when its owner is clear and the current slice already touches it.

#### Slice 11 — reduce ChatView responsibility

Do this only after lower boundaries are stable.

Target:

```text
ChatView
├── Obsidian lifecycle
├── compose presentation objects
└── bind user actions

TurnPresenter
→ LearningEvent → presentation state

ThreadRenderer
→ response / practice / review / proposal / status
```

Do not split `ChatView` only because it is large.

Extraction is valid when responsibility and testability improve.

#### Slice 12 — strengthen TypeScript checks

After core boundaries are clearer, incrementally enable stronger compiler checks
such as full `strict` and `noUncheckedIndexedAccess` where the codebase can
absorb them without mixing a broad mechanical migration into domain refactors.

Treat compiler tightening as a separate coherent slice.

### Slice completion rule

Every migration slice must satisfy:

```text
same or intentionally updated observable behavior
+
one ownership problem reduced
+
no second architecture introduced
+
focused regression proof
+
relevant full gate
+
old/dead path removed
```

Do not start the next slice merely to make the architecture look complete.

---

## 23. What not to refactor first

The following boundaries are currently coherent enough and should not be
rewritten without a concrete task:

- `ContextResolver`;
- `StructuredStreamParser`;
- `AgyAdapter` process/protocol boundary;
- replacement planning / mutation validation;
- `PracticeStateMachine` transition logic;
- `main.ts` composition root;
- recently extracted generic UI primitives.

Large size alone does not change this rule.

---

## 24. Primary engineering risks

### Risk 1 — business rules in persistence

Effect:

```text
storage change
→ learning behavior changes
→ broad regression surface
```

Mitigation: pure learning-state transitions.

### Risk 2 — orchestration becomes a god object

Effect:

```text
one feature change
→ context + session + practice + parser + persistence all touched
```

Mitigation: application use cases by observable behavior.

### Risk 3 — duplicated transient and durable state

Effect:

```text
restart / session switch
→ two sources disagree
```

Mitigation: one canonical lifecycle owner.

### Risk 4 — plugin-data lost update

Effect:

```text
two independent load/merge/save operations
→ stale snapshot wins
→ unrelated state is overwritten
```

Mitigation: one serialized plugin-data writer and awaited persistence where
completion is part of the operation.

### Risk 5 — mutable repository state leakage

Effect:

```text
caller receives stored object
→ mutates it directly
→ repository invariants depend on call order
```

Mitigation: immutable replacement or explicit repository mutation methods.

### Risk 6 — failure category collapse

Effect:

```text
persistence / domain / parser / runtime error
→ generic or protocol-invalid failure
→ weak diagnostics + wrong recovery behavior
```

Mitigation: typed failure categories and boundary-specific translation.

### Risk 7 — provider leakage

Effect:

```text
runtime protocol
→ controller/UI contracts
→ runtime replacement becomes product rewrite
```

Mitigation: normalize at adapter boundary.

### Risk 8 — premature UI decomposition

Effect:

```text
bad workflow boundaries
→ split into more files
→ same coupling becomes harder to trace
```

Mitigation: clean domain/application ownership before presentation extraction.

### Risk 9 — abstraction inflation

Effect:

```text
clean-code goal
→ interfaces/services/factories everywhere
→ more indirection than behavior
→ slower change
```

Mitigation: use DIP only at real I/O/lifecycle boundaries; keep pure/local code
concrete.

### Risk 10 — fake confidence from tests

Effect:

```text
green unit suite
→ native Obsidian behavior still broken
```

Mitigation: prove the actual boundary and retain release-level smoke tests.

---

## 25. Engineering acceptance criteria

### Boundaries

- each changed business rule has one owner;
- each durable/transient state has an explicit owner and lifetime;
- domain transitions do not depend on Obsidian/provider APIs;
- persistence does not independently decide learning policy;
- provider-specific protocol remains below `AgentAdapter`;
- UI does not recreate learning rules;
- application use cases coordinate effects without becoming domain rule stores.

### Cohesion and coupling

- a module's public API reflects one primary responsibility;
- a change in provider protocol does not require domain/UI changes;
- a storage-format change does not require learning-policy changes;
- types live near the concept that owns them when practical;
- interfaces exist at real boundaries, not around every class;
- no new parallel architecture is introduced during migration.

### State and persistence

- proposal state has one canonical lifecycle owner;
- practice state belongs to an explicit session lifetime;
- plugin-data writes cannot silently overwrite unrelated concurrent updates;
- repositories do not rely on callers mutating returned internal objects;
- persisted state is decoded defensively and legacy behavior degrades safely.

### Learning

- learner evidence and material review findings remain semantically distinct;
- practice rollback preserves the active question;
- learning-state transitions are independently testable;
- learning-state domain rules can be tested without Obsidian vault mocks.

### Editing

- supporting context remains read-only;
- stale/ambiguous replacements fail explicitly;
- approved edits use the Obsidian editor path and preserve Undo.

### Runtime and failures

- prompt/context travel through structured input rather than shell interpolation;
- cancellation terminates process work and restores usable product state;
- malformed structured output cannot partially mutate durable state;
- failure categories preserve whether the failure originated in context,
  protocol, persistence, mutation, runtime, or turn coordination.

### Code quality

- DRY means no duplicated business decision or state owner;
- small syntax duplication is allowed when abstraction would reduce clarity;
- large files are refactored only when responsibility/coupling justifies it;
- pure transitions remain side-effect free;
- side effects are visible at application/adapter boundaries;
- dead compatibility paths are removed when migration completes.

### Testing

- the changed rule has a focused behavioral proof;
- the changed external boundary has a faithful integration proof when needed;
- broader gates match blast radius;
- real Obsidian claims are not inferred from Node/build tests.

### Delivery

- no parallel/dead implementation path remains without a compatibility reason;
- generated artifacts are current when affected;
- canonical product/engineering docs change with their contracts;
- final diff contains no unrelated work;
- a slice stops when its acceptance criteria are satisfied.

---

## 26. Final engineering model

The target system should be explainable without knowing file-level details:

```text
                         ┌──────────────────┐
                         │     ChatView     │
                         │ presentation/UI  │
                         └────────┬─────────┘
                                  │
                         commands / queries
                                  │
                    ┌─────────────▼─────────────┐
                    │        Application        │
                    │                           │
                    │ RunLearningTurn           │
                    │ ApplyProposal             │
                    │ Session use cases         │
                    └──────┬───────────┬────────┘
                           │           │
                     domain rules      │ ports
                           │           │
              ┌────────────▼───┐       ▼
              │     Domain     │   Infrastructure
              │                │
              │ learning-state │   VaultLearningStateRepository
              │ practice       │   PluginSessionRepository
              │ proposal       │   PluginDataRepository
              └────────────────┘   ObsidianMutationAdapter
                                   AgyAdapter
```

For a practice answer:

```text
ChatView
→ RunLearningTurn
→ PracticeStateMachine
→ learning-state transition
→ LearningStateRepository
→ LearningEvent
→ presentation
```

For an edit:

```text
ChatView
→ ApplyProposal
→ proposal lifecycle
→ MutationPort
→ Obsidian editor
→ proposal state transition
→ presentation
```

The architecture is healthy when common ownership questions have one obvious
answer:

```text
Who decides a gap becomes improving?
→ learning-state domain

Who stores progress.json?
→ VaultLearningStateRepository

Who runs the configured agent?
→ AgentRuntime / AgyAdapter

Who stores conversation history?
→ session repository

Who decides proposal lifecycle?
→ proposal application/domain boundary

Who renders a proposal card?
→ presentation
```

The goal is not more layers.

The goal is:

```text
one rule → one owner
one state → one lifetime
pure rule → cheap test
side effect → explicit boundary
small slice → small blast radius
real risk → faithful proof
clear done → ship
```
