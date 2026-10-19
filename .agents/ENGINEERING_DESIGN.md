# Nox — Engineering Design

Status: **Canonical target architecture with incremental migration**
Depends on: `PRODUCT_DESIGN.md`, `../DESIGN.md`
Scope: Obsidian plugin runtime, learning orchestration, context, agent adapter,
persistence, mutation, testing, and delivery
Last updated: 2026-10-13

---

## M5 feature-private physical package checkpoint — 2026-10-20

**State:** Scoped M0–M5 code migration is implemented in draft PR #121.
GitHub CI verifies static/automated safety; Obsidian desktop acceptance remains
outstanding. The full aspirational feature-first layout is NOT fully migrated.

Physical ownership after moving eleven tested M1–M3 private collaborators:
- `src/features/conversation/turn/`: `StructuredTurnBuffer`,
  `TurnProviderEnvelope`, `TranscriptEvidenceReconciler`, protocol-invalid error.
- `src/features/conversation/view/`: history, streaming-text and transcript
  presenters. These may render but never commit durable session state.
- `src/features/learning/program/`: the original single
  `ProgramMutationQueue`, `ProgramFocusService`, `ProgramSessionTransitions`,
  and provider `ProgramPlanGenerator`.

Root public entry points remain `src/chat/ChatView.ts`,
`src/application/RunLearningTurn.ts`, and
`src/application/LearningProgramOrchestrator.ts`. Do not add duplicate shims
or second owners. The physical migration and removal of old paths occurred
atomically in Git commit `f70bdc5`.

`scripts/boundaries.mjs` enforces the exact private-feature package set,
facade-only imports, and no cross-feature direct access to private code,
persistence or host/OS interfaces. `scripts/architecture-graph.mjs` now measures
each feature package separately for future impact analysis. All tests referencing
private collaborators use their new canonical paths.

Protection policy remains unchanged: SessionController + PluginDataRepository
own committed conversation snapshots; RunLearningTurn owns successful terminal
commit order; VaultProgramStore/VaultLearningStore retain CAS and schema
compatibility; LearningProgramOrchestrator retains the single program mutation
lane, focus authority and timer; Obsidian editor undo and provider transports
stay in their current adapters.

**Before merge/release:** verify final CI, review new dependency graph and
validate native Obsidian desktop behavior (history interaction, transcript and
streaming, practice/evaluation/recovery, proposal apply/reject and Undo). Do not
equate successful typecheck/unit/integration tests with real desktop validation.
See `docs/ARCHITECTURE_BOUNDARY_REDESIGN.md` for the implementation graph and
the deliberate limits of this staged architecture migration.

---

## M4 data and context dependency checkpoint — 2026-10-19

M4 prevents pure token accounting and context request orchestration from
depending on concrete Obsidian persistence/host adapters:

- `src/domain/usage/usage-accounting.ts` is pure cumulative-to-delta
  aggregation, UTC bucket rollup, input validation and untrusted persisted
  snapshot decoding. `src/domain/usage/usage-types.ts` defines the domain value
  shape; root `src/types.ts` retains the structurally compatible wire contract
  because root-to-domain coupling would break architecture direction.
- `TokenUsageRepository` only uses the existing `PluginDataRepository.update`
  serialized writer with the same `nox-token-usage-v1` key. The accounting
  projection cannot read/save plugin data or create an additional writer.
  Duplicate and nonfresh AGY historical reports do not inflate token totals;
  terminal counters and already-observed checkpoint history remain canonical.
- `ContextResolver` now depends on host-neutral `ContextSourcePort`, not
  `ObsidianContext`. Only the composition root creates concrete Obsidian
  adapters. Source authorization, search filtering, live editor precedence
  and freshness remain in existing contextual flows.
- A targeted architecture guard forbids `ContextResolver` importing
  `ObsidianContext` directly. Tests demonstrate structural injection,
  scoped research forwarding, malformed bucket rejection, idempotent
  usage totals and persistence failure behavior.

M4 does not modify vault program/evidence CAS, proposal status receipt,
undo mechanics, provider runtimes, rendering, or storage schema. See
`docs/ARCHITECTURE_BOUNDARY_REDESIGN.md` for graphs and failure coverage.
M5 physical package migration is still pending. CI and native Obsidian desktop
acceptance remain independent checks; do not merge/release on docs alone.

---

## M3 program responsibility and CAS checkpoint — 2026-10-19

M3 isolates plan generation, focus authorization and timed-session transitions
without adding any second mutable source of truth. The public program
orchestrator remains the lifecycle and preview receipt facade; VaultProgramStore
remains the only authoritative `programs.json` persistence adapter.

- `ProgramMutationQueue` holds **one** per-orchestrator FIFO write lane shared
  across selection, planning approvals, revision approvals, focus, session,
  material rename, and restart recovery. Rejected work cannot poison the tail.
- Every queued RMW reads `expected = ProgramStorePort.load()` and saves
  `store.save(next, expected)` with a **distinct** proposed collection;
  never modify `expected` before the CAS check. Preservation of the loaded
  WeakMap snapshot is a correctness contract, not just a naming convention.
- `ProgramPlanGenerator` produces validated proposal data from provider and
  authorized note context, never durable updates. Cancellation and preview
  lifetime are orchestrator-owned.
- `ProgramFocusService` checks prerequisites against evidence-based learner
  profile and delegates transitions to existing pure domain focus functions.
- `ProgramSessionTransitions` reuses domain timing transitions and never
  infers time during unobserved app downtime. Active learning excludes AI wait.
- Existing curriculum revision proposer remains the only proposal generator;
  approval receipts stay idempotent and CAS-protected in orchestrator.
- Resource lifecycle (AbortController, timeout and 30-second checkpoint timer)
  stays with `LearningProgramOrchestrator`; the queue has no own timer or I/O.

M3 automated acceptance requires every program mutation path to use the shared
lane and immutable expected snapshot, concurrent transition tests, restart
recovery and legacy schema regressions. Native Obsidian desktop tests are still
required before merge/release. M4–M5 are not implemented. Full execution graph
and failures: `docs/ARCHITECTURE_BOUNDARY_REDESIGN.md`.

---

## M2 conversation turn responsibility checkpoint — 2026-10-19

The existing `RunLearningTurn` remains the **single** coordinator for the
active-turn lock, cancellation/timeout, source/focus authority, normalized
stream consumption, terminal gating and ordered commits. M2 extracts three
collaborators with distinct responsibility, not a new writer or generic
workflow framework:

- `TurnProviderEnvelope`: produces the final authorized provider-bound
  visible/system/history envelope, cursor rotation, retry/regenerate history,
  and timing/usage estimate before invoking the runtime. Restricted modes,
  selected sources and programs must not inherit hidden prior provider state.
- `StructuredTurnBuffer`: per-turn untrusted candidates and text/thought
  deltas. `assertTerminalEligible` checks required output only **after** a
  provider completes; it cannot mutate persistent transcript/evidence.
- `TranscriptEvidenceReconciler`: idempotent evidence projection from
  previously committed transcript outcomes. Uses the original
  `LearningStatePort` with bounded CAS retries and fresh snapshots on conflict.

The order remains terminal validity → focus authority → transcript commit →
evidence projection → UI completion. If projection fails after a durable
transcript commit, repeat only idempotent reconciliation: do not invoke the
provider again or create a second verdict. Cancellation and deadline behavior
are still owned by `RunLearningTurn` and may not be moved behind a detached
worker. All provider transports and data schemas remain unchanged.

Focused regressions cover wrong-action/duplicate payload, terminal missing
candidates, edit-file authority, retry and regenerated history, selected-source
cursor isolation, duplicate evidence, CAS conflict, and non-CAS failure.
The older recovery and vault persistence integration tests remain mandatory.
See `docs/ARCHITECTURE_BOUNDARY_REDESIGN.md` for the runtime path and
M3–M5 sequencing. Desktop Obsidian acceptance is not implied by green CI.

---

## M1 presentation isolation checkpoint — 2026-10-19

The M1 changes on the architecture refactor draft branch isolate **UI-only**
lifecycles behind dedicated presenters; there is no new service for transcript
persistence and no new domain store. M1 status is **implemented, verification
pending** until current PR CI and Obsidian desktop acceptance are available.

- `ChatView` is still the registered Obsidian `ItemView` and maps normalized
  `LearningEvent` variants into presentation calls.
- `HistoryPresenter` owns menu/ARIA/swipe presentation state and delegates all
  session mutations through `LearningController` to `SessionController`.
- `TranscriptPresenter` reads authoritative committed messages, sequences
  restoration, and uses epoch cancellation to discard stale session renders.
- `StreamTextPresenter` owns DOM text coalescing, RAF scheduling and cancellation,
  not durable assistant output. The terminal turn coordinator remains unchanged.
- `LearningController` owns the presentation-facing offline command and
  learning scope queries; `ChatView` cannot import domain command parser files.
- The architecture boundary checker encodes the last constraint, and focused
  presenter tests check frame coalescing and restore cancellation.

M2–M5 remain unimplemented. Do not interpret green static boundary checks as
proof of native Obsidian visual or provider behavior. See
`docs/ARCHITECTURE_BOUNDARY_REDESIGN.md` for the current-to-target map.

---

## M0 architecture measurement and authority lock — 2026-10-19

This checkpoint implements **instrumentation and regression mapping only**, not the proposed
feature-first package migration. See `docs/ARCHITECTURE_BOUNDARY_REDESIGN.md` for
the affected responsibility graph, public capability contracts, state-owner table,
critical runtime flows, and milestone sequencing.

- Use `pnpm architecture:graph` for deterministic TypeScript AST dependency
  metrics (module owners, type/runtime edges, fan-in/out, cycles and unresolved
  imports). Use `--format=json` to review complete file-to-file edges.
- CI emits the graph to the workflow job summary. The existing
  `pnpm check:boundaries` remains the import enforcement mechanism; structural
  metrics **do not prove** behavioral isolation, consistency or trust boundaries.
- SessionController + PluginDataRepository retain one authoritative serialized
  session/plugin-data transaction path. VaultProgramStore and VaultLearningStore
  retain CAS/concurrency semantics. Practice remains transcript-derived.
- RunLearningTurn remains the one inference terminal-outcome coordinator; view
  decomposition and package moves are **M1–M5**, not part of M0.
- No source-of-truth, persistence schema, provider API, user-visible behavior,
  or runtime import direction changed in M0.
- A green unit/CI report is not Obsidian desktop acceptance or live provider
  validation. Do not call the full redesign implemented until relevant
  behavior-preserving migrations have landed.

---

## Context + research incremental extension — 2026-10-14

Optional `/research` uses `ContextResolver` and `ObsidianContext` to query
derived, on-demand `LocalResearchIndex` from Markdown notes and resolvedLinks.
`ContextBudget` is a pure, provider-neutral envelope invoked by `RunLearningTurn`.
`NodeInferenceTransport` sends progressive SSE over Node HTTPS; OAuth and
catalog discovery remain on Obsidian requestUrl. Source truth remains with
SessionController, VaultLearningStore and the existing token usage ledger.
See `docs/CONTEXT_RESEARCH_ENGINE.md` for limits and smoke-test gates.

## Implementation checkpoint — 2026-10-13

The migration discussions in sections 2 and 22 include historical September
baseline observations. Always inspect current code before treating them as
unresolved issues.

**Implemented:** domain learning transitions are pure; plugin-data writes
share a serialized repository; runtime and conversation lifecycles are separate;
proposal state is session-owned; practice is session-scoped with transcript-based
unanswered-question restoration. Completed Practice and Review outcomes are
canonical transcript decisions and replay missing progress with stable evidence
IDs; incomplete Review streams cannot commit material evidence.
New Practice questions likewise wait for terminal agent completion, with
failure/cancellation/duplicate-question recovery tests proving no phantom
question is persisted or made answerable. Session restores
sanitize nested proposals and structured parts; session reads return defensive
copies. Presentation restores pinned practice origin across startup/session
navigation, and Practice/Review card DOM renderers are feature-owned. The
streaming text path does not unconditionally force scroll.

**Session/persistence/mutation audit (2026-10-13):** These are separate
failure and ownership boundaries, not gratuitous technical layers. Concurrent
session writes previously staged stale snapshots despite serialized plugin-data
I/O. `SessionController` now serializes complete session mutations (including
Practice/Review outcomes and ordinary messages); regression tests reproduce
both same-session and cross-session lost updates. Keep vault progress and editor
mutations in their existing owners. Do not collapse all three into an Obsidian
folder to meet a folder-count target.

**Edit Proposal hardening (2026-10-13):** `RunLearningTurn` buffers
validated proposals until successful terminal completion. It rejects
malformed, unexpected, unauthorized, or multiple proposals with no edit
commit. `SessionController.recordEditOutcome` atomically persists the visible
narrative and proposal before the UI receives an actionable event. Stable
session/turn IDs make retries idempotent while applied, rejected, and
restart-stale proposals never return to pending. Parser and UI responsibilities
remain unchanged; no new service or folder was created.

**Apply status recovery (2026-10-13):** Editor replacement and session
persistence are distinct operations, not one ACID transaction. A successful
editor replacement followed by a failed session status write is surfaced as
`ok: true, statusSync: "failed"`: the note was changed. `LearningController`
holds a short-lived unsynced-apply receipt to prevent applying the same edit
again and exposes `retryAppliedStatus()`, which only writes `applied` state.
`SessionController.updateProposalState()` stages the next snapshot and
publishes it only after the serialized plugin-data write succeeds. Session
switching is blocked while a local applied-status receipt is unsynced; on
restart the existing stale-on-restore guard remains in force. Do not add a
distributed-transaction layer or assume native filesystem crash atomicity.

**Current remaining boundary:** `RunLearningTurn` owns orchestration,
timeouts, structured event effects and reconciliation behind the stable
`LearningController` facade. This is intentional; only extract a narrower
use case on proven change pressure. `ChatView` still coordinates several UI
responsibilities. Do not create parallel Practice/Review stores or a generic
handler framework.

**Verification boundary:** GitHub CI covers typecheck, lint, unit/integration
tests, build, and artifacts. Real Obsidian UI verification (including selection
restore, panel lifecycles and native Undo) still requires manual smoke tests.
Automated multi-module recovery tests exercise real session and learning
repositories against controlled Obsidian adapters, including simulated restart,
failed vault writes, incomplete Practice/Review streams, cancellation, pinned
Practice origin, selection preservation and editor-only Apply with mock undo.
These tests do not prove filesystem power-loss atomicity, native editor Undo or
GUI lifecycle behavior, which still require manual Obsidian verification.

---

## Legacy cleanup and hint persistence — 2026-10-14

The tracked root `main.js` artifact is retired. Only `dist/main.js` is a
deployable entrypoint; verification fails if the obsolete root bundle returns.
The unused `SessionController.recordProposal` entrypoint is removed; edit
decisions use the already-atomic `recordEditOutcome` path.

On startup, fully decoded `agy-sessions` data with a valid selected session is
promoted atomically into `nox-sessions` through the existing serialized plugin
data writer. The old key is deleted only by the successful write; failed writes
leave the legacy input intact. Invalid legacy data is preserved for recovery.
Existing canonical data continues to take precedence and is not overwritten.

A Practice hint now persists its user intent and assistant hint in one serialized
session transaction via `SessionController.recordPracticeHint`. Only after
persistence succeeds does `RunLearningTurn` mark the attempt assisted. A failed
write cannot publish half a hint or mutate evidence eligibility.

## Domain-neutral scoped programs — 2026-10-15

Versioned `ProgramLearningScope` in `domain/practice/learning-scope.ts`
binds a selected `programId` to `ASSESSMENT` / `FOCUSED` / `FREE`. The
original unversioned `LegacyLearningScope` and serialized `scope:"backend"`
remain compatible. `SessionStore` decodes both without remapping historical
practice transcripts. `RunLearningTurn` gives free, legacy-backend and
program-scoped questions distinct in-process registry identities, reconstructs
pending questions from durable committed transcript parts, and retains strict
single `learning-scope` output validation in both locked paths.

The application's program store selects the goal and objective; prompt builder
uses those values only as validated context. Program selection, timeboxes,
source-bound note authorization, parse/terminal gates, and evidence recording
remain with existing owners. Provider adapters are unchanged; program goals are
never inferred from model or CLI. `ChatView` uses read-only program menu state
to label the intent chip; async responses are guarded by session/program ID.
A paused v2 scope can rebind explicitly on new assessment/focused entry; a
locked scope cannot silently switch subjects.

Integration regression for new domain-neutral sessions, v1 restart and scoped
transcript roundtrip is required, plus real Windows Obsidian acceptance before
Community plugin release.

## Backend scope enforcement — 2026-10-14 (v1 compatibility)

`domain/practice/learning-scope.ts` owns mode transitions and command meaning.
`ChatSession` lives in `session/transcript-types.ts`, with a compatibility type
export from `types.ts`. `SessionController.recordScopeChange` serializes state
and acknowledgement together and publishes only after storage succeeds. Sessions
without a scope remain free.

`RunLearningTurn` handles exact mode commands locally, routes ordinary locked
turns through Practice, and rejects Review/Edit shortcuts. Historical Apply also
checks the mode in `LearningController`. Locked turns do not resume provider
history; explicit mode changes clear its cursor.
Mode commands are blocked during an in-flight Apply, and Apply is blocked during
an active turn, so editor effects cannot overlap a transition into a scope lock.

Locked output is buffered until completion. The parser normalizes a
`learning-scope` decision (`answer`, `help`, `out-of-scope`); the application
requires exactly one valid decision. OOS output is discarded for a local
re-anchor. Help retains the question without evidence. Answers require exactly
one expected question/evaluation, with no other structured effects; narrative
on this path is discarded.

Backend Practice transcript parts carry `scope: "backend"`. The existing registry
holds a derived machine per session/scope, so free Practice during a pause cannot
replace the backend question. Both restore from the canonical transcript. New
question parts are staged and published only after persistence succeeds.

`tests/integration/learning/scope-flow.test.ts` exercises real session
serialization with a controlled model boundary. This proves application state
and effect enforcement, not semantic classifier accuracy or live Obsidian UI.

## 2026-10-15 — History actions and NOX appearance

Archived session membership (optional `archivedAt`) lives in the canonical
ChatSession snapshot and is decoded defensively. SessionStore owns the
archive/delete/fallback state transitions. SessionController stages the complete
mutation and publishes only after the plugin-data write succeeds, serialized
with all other session writes. LearningController gates mutations during active
turns/plans/applies and unsynced editor-apply receipts. UI-only selected IDs
and swipe state live in chat/history-list.ts. The implementation uses native
Obsidian DOM rather than adding React for the UIArc interaction pattern.

Theme selection is a persisted NOX settings field. Appearance-only writes go
directly through the existing serialized PluginDataRepository, avoiding
unnecessary runtime reconfiguration. ChatView and SettingsTab apply class
overrides to the existing flat NOX color tokens without changing the global
Obsidian theme.

## 2026-10-15 — Appearance scope and native portal alignment

Independent NOX appearance is a scoped CSS contract, not an Obsidian global
theme toggle. `styles.css` owns both paletted token sets and maps the
minimum native Obsidian variables needed by MarkdownRenderer, dropdowns,
links and code blocks. `color-scheme` aligns browser-painted form controls
and scrollbars. System follows the containing `.theme-dark` class without
runtime observers; forced light/dark class selectors override it.

ChatView applies appearance to the root and to its Obsidian delete modal.
HistoryList creates a short-lived fixed portal for the Obsidian DOM Menu and
destroys it on hide; no second theme store, modal manager or global body
mutations. SettingsTab uses the same scope and the persisted `NoxSettings`
appearance preference.

Protect the four effective theme combinations, contrast and portal ownership
with `tests/branding/NoxThemeScope.test.ts`. CI static tests do not replace
real Obsidian browser/theme visual verification.

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
| `VaultLearningStore` | persistence-only, pure learning transitions in domain | keep |
| `SessionController` | session persistence and proposal ownership, runtime separate | keep |
| `LearningController` | stable UI-facing façade delegating runtime turns | keep |
| `RunLearningTurn` | owns execution, cancellation, practice and stream effects | keep cohesive, extract only on concrete change |
| proposal state | persisted in canonical session transcript | keep |
| practice state | session-scoped, unanswered questions restored from transcript | keep + verify real restart UX |
| plugin data writes | one serialized `PluginDataRepository` writer | keep |
| `SessionStore` | defensive read snapshots and explicit updates | keep |
| failure model | persistence failures distinguished from protocol errors | refine as real needs arise |
| `types.ts` | shared transport/session types, with feature-owned learning types | split only when useful |
| `ChatView` | UI orchestration + presentation | extract focused renderers when behavior warrants |

### 2.2 Historical boundary drift (pre-October remediation)

The following is retained as the rationale for earlier migration decisions,
not an inventory of current defects. See the implementation checkpoint above.

### Historical details

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

## 3. Canonical repository shape (enforced)

This is the **current, actively enforced** source layout. The former
`src/learning/` is eliminated; it mixed domain rules, application orchestration
and provider parsing. The existing adapter folders remain: do not move them to
fictional layers or split the package to satisfy a diagram.

```text
src/
├── application/
│   ├── LearningController.ts         # UI-facing application façade
│   ├── RunLearningTurn.ts            # canonical turn/use-case owner
│   ├── PracticeSessionRegistry.ts    # per-session transient lifecycle
│   ├── action-builders.ts            # action instruction assembly
│   ├── learning-state-projection.ts  # prompt-only projection
│   ├── learning-types.ts             # normalized product commands/events
│   └── ports.ts                      # narrow structural I/O contracts
├── domain/
│   ├── learning-state/{types,transitions}.ts
│   ├── practice/{types,PracticeStateMachine}.ts
│   ├── review/types.ts
│   └── mutation/replacement.ts
├── agent/{AgentRuntime,AgyAdapter,AgyProtocol,CodexAdapter,CodexProtocol,StructuredStreamParser}.ts
├── context/{ContextResolver,ObsidianContext,PolicyLoader,context-types}.ts
├── session/{SessionController,SessionStore,transcript-types,transcript-schema}.ts
├── persistence/{PluginDataRepository,VaultLearningStore,PersistenceError,learning-state-schema}.ts
├── mutation/MutationService.ts
├── chat/                         # Obsidian view, cards, composer and UI primitives
├── settings/
├── types.ts                      # legacy shared transport/session contracts
└── main.ts                       # wiring only
```

`tests/` mirrors feature owners; integration workflows remain under
`tests/integration/`. Do not create generic `utils/services/managers` buckets.
New behavior goes into its authoritative owner first, even when it is only
one file. Do not move `ChatView` or create new layers based on file length alone.

Presentation consolidation checkpoint — 2026-10-13: `src/ui/` had five
chat-only components and no external feature consumers. All five now live
beside `ChatView` in `src/chat/`; the matching menu/popover tests live under
`tests/chat/`. No runtime, domain, persistence, or editor ownership moved.
Do not recreate a top-level `ui/` just to group files by technical type.


The rules are executable in `scripts/boundaries.mjs`, exercised by
`tests/architecture/boundaries.test.ts`, and enforced via
`pnpm check:boundaries` in `pnpm verify` and CI. Exceptions must be narrowly
documented in the code-level guard: application may import normalized
`agent/AgentRuntime.ts` and `agent/StructuredStreamParser.ts`,
`session/transcript-types.ts` for durable outcome shape, and the
`persistence/PersistenceError.ts` failure contract. Do not expand the
exceptions as a workaround for unclear ownership.

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

AGY and Codex are concrete adapters selected from Nox Settings.
Legacy settings default to AGY. Executable paths are stored separately; changing
provider clears the preferred-model setting. `LearningController.configureRuntime`
guards active turns, editor Apply/status recovery, and concurrent configuration.
Settings and staged session compatibility state persist in one plugin-data write
before `AgentRuntime.replaceAdapter` clears and refreshes its model catalog.
The composition root then refreshes open chat model menus and runtime health.
Settings input updates are serialized by the settings tab.
`SessionController.configureRuntime` binds the session's generic `runtimeProvider`
metadata and resets incompatible cursor/model state after durable persistence.
Historical sessions are aligned to the configured runtime when selected; transcript,
structured cards, scope locks, and learning evidence remain session/domain-owned.

`CodexAdapter` uses the local signed-in CLI (`codex exec --json`, stdin input,
read-only sandbox, no interactive approvals). User configuration is excluded for
the run while local CLI authentication remains in Codex. Resume uses only the
originating session's validated UUID, never `--last`. `CodexProtocol` validates
JSONL and projects assistant messages; reasoning, commentary and tools remain
adapter-private. Success is held until process exit code zero; malformed output,
failed turns, stdin errors and nonzero exits remain normalized failures.
Cancellation kills the owned Windows process tree or Unix process group.

`CodexAdapter.listModels` opens a short-lived `app-server --listen stdio://`
connection, binds the OpenAI provider to match Nox exec turns, performs
`initialize` → `initialized` → paginated `model/list`, and returns visible model
slugs/display names. It never starts a thread/turn or sends note context. Model
discovery uses local CLI sign-in/config; exec turns still exclude user config.
Malformed/RPC/early-exit failures, repeated cursors, excessive output, timeout
(10 seconds), and abort release the owned process; no partial catalog is published.
`AgentRuntime` cancels replaced/disposed discoveries and prevents late catalogs
from overwriting the active provider. Plugin unload disposes runtime discovery.
Discovery failure retains default/manual model choices. Catalog entries are not
an account entitlement guarantee. Do not invent a static catalog.
Process integration tests exercise real controlled subprocess exit/cancellation,
alongside protocol fixtures. They do not prove live account access or Obsidian UI.

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
→ pnpm lint
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
8. switch between sessions with different unfinished Practice questions; the pinned
   source chip must match the restored question, not the currently active note.
9. force a storage failure after a completed Practice/Review outcome, then retry;
   history and learning progress must converge without re-grading or duplicates.

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
- chat-owned UI primitives (previously under `src/ui/`).

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


## Interactive practice card boundary (2026-10-14)

```text
AI content → StructuredStreamParser → PracticeQuestion candidate
           → RunLearningTurn validates terminal completion
           → SessionController commits question
           → ChatView / quiz-card (typed input and presentation)
           → LearningController → RunLearningTurn (question ID validated)
           → deterministic MCQ / provider-based essay-code evaluation
           → SessionController transcript commit → LearningState projection
```

- `domain/practice/question-schema.ts` is authoritative for MCQ/essay/code
  shapes and answer validation; the active lifecycle still belongs to
  `PracticeStateMachine`. The model cannot author an active question ID,
  override the active state or submit a grade by itself.
- `SessionController` is the only writer of in-progress `practiceDrafts`;
  the canonical transcript owns completed questions and outcomes. Draft deletion
  and evaluation creation happen in one durable session snapshot.
- `quiz-card.ts` owns only inputs/focus/visual feedback and calls the
  application facade. It cannot import Obsidian persistence, agent providers,
  run code, or project evidence.
- All practice evaluations share the existing idempotent operation key
  `practice:<sessionId>:<questionId>`. No duplicate evidence store.
- Correct MCQ answers covering only one fact are tagged
  `assessmentCoverage=single-item` when tied to a curriculum; they cannot
  satisfy broader mastery gates or unlock prerequisites. Essays/code require
  the existing rubric checks.
- Code answers are reviewed as source text. There is no runtime execution,
  compiler, process launch, or network sandbox.
- Legacy `PracticeQuestion` data without `input` remains valid and is rendered
  as an essay input for any still-active historical question.
- Structured question payloads are discarded after a failed/cancelled model
  response; evaluator failures leave the same question answerable.
- Refer to `docs/INTERACTIVE_PRACTICE.md` for test cases and manual Obsidian
  acceptance. Automated tests do not certify renderer behavior in the user's
  actual vault/theme/account.

---


## Token usage telemetry ownership

`AgentRuntime` consumes the normalized `usage` transport event and
persists it via a composition-root callback, never through LearningController
or transcript evidence. `TokenUsageRepository` owns daily immutable-on-read
aggregates via the existing serialized `PluginDataRepository` writer.
AGY cumulative counters require checkpoint deltas to avoid double counting.
Settings reads a snapshot through the plugin host boundary. See
`docs/TOKEN_USAGE.md`.

## Release 1.1.2 — scoped provider authority and terminal-outcome rules

- For selected/folder research, both retrieval and final provider-bound context
  must satisfy the scope. No automatic ambient context, historical transcript
  or policy/progress data may bypass the final authority. Source-bound programs
  enforce that authority even without an explicit research command.
- The canonical terminal outcome is owned by the learning turn. Auxiliary study
  timer persistence errors must not convert a durably committed assistant reply
  into a retryable inference failure. Runtime-owned wait tokens release even if
  the underlying vault save fails.
- Offline chat input distinguishes local commands from model-backed operations.
  Plan generation, /next and free practice continue to require inference.
- Regression proofs: provider input capture, authority unit test, timer failure
  injection and offline command classification. Desktop acceptance remains a
  separate mandatory release gate.

## R1–R4 ownership follow-up — 2026-10-20

The bounded feature migration on draft PR #121 now includes four follow-ups to M5.
Private program curriculum generation lives in `features/learning/program`; public preview
shape is `domain/learning-program/curriculum-preview.ts`; the program orchestrator retains
the only CAS write, request cancellation and approval lifecycle. Pure onboarding projection
lives in `features/learning/onboarding` while the Obsidian adapter owns the request epoch,
DOM, callbacks and draft save port. Practice UI is exclusively
`features/practice/view`, whereas untracked legacy Quick Quiz is in
`features/conversation/view`. Separate approval, evidence and source-bound semantics
must remain intact. The architecture checker enforces explicitly enumerated UI bridge
imports and denies private cross-feature access to persistence or unrelated domain policy.
Consult `docs/FEATURE_OWNERSHIP_R1_R4.md` for code graph, failures and acceptance.
The existing native Obsidian desktop gate is still outstanding; passing unit/integration
CI alone does not authorize merge or release.
