# NOX — Responsibility-first architecture audit and redesign

Status: **target architecture proposed; M0 instrumentation implemented on draft PR, M1–M5 not implemented**
Audit base: `master` on 2026-10-19
Decision scope: modular boundaries, mutable state ownership, public contracts, runtime flow, and incremental migration.
Canonical references: `AGENTS.md`, `.agents/ENGINEERING_DESIGN.md`, `docs/ADAPTIVE_LEARNING_MILESTONES.md`.
This proposal does **not** replace the existing engineering contract until a verified migration slice lands.

## Executive decision

Use a **feature-first modular monolith with small internal presentation/controller/application/domain/data boundaries**. Keep inference and Obsidian host integrations under `platform/`. These are logical responsibilities, not an obligation to create five subdirectories in every feature. Create a new file/folder only when its independent lifecycle, invariant, dependency, or failure mode justifies it.

Do not assume a folder called `domain` is a real boundary. Verify incoming and outgoing edges, mutable source of truth, and runtime transitions.

Do not rewrite the entire plugin, introduce a DI framework, an event bus, CQRS, or a second session store.

## §1 Facts verified in current code

| Evidence | Current responsibility | Architecture implication |
|---|---|---|
| `src/chat/ChatView.ts` (~3173 LOC) | Obsidian ItemView, state/stream lifecycle, menus, rendering, history, composer, practice, model selection | A presentation integration point with excessive change surface. Extract independent *view controllers/presenters* along existing interactive components without moving business authority into the view. |
| `src/application/RunLearningTurn.ts` (~1609 LOC) | active turn lock, scope enforcement, prompt/context, model streaming, parser, completion gates, review/practice/edit persistence, evidence reconciliation | One use case mixes many distinct decisions. Decompose *private collaborators* only after preserving terminal-commit ordering; leave a single run coordinator. |
| `src/application/LearningController.ts` (~816 LOC) | UI facade spanning chat, program operations, runtime switching, practice, edit apply, time accounting | Stable gateway is useful, but its implementation should delegate to capability-specific use cases, not repeat policy. |
| `src/application/LearningProgramOrchestrator.ts` (~765 LOC) | program planning, focus, session timing, curriculum revision, profile/progress, write serialization | One mutable program authority must remain. Separate operations by responsibility while sharing **one** aggregate write coordinator. |
| `src/session/SessionController.ts` | serialized session mutations and persisted publish | **Retain** transaction authority; staged state is published after `PluginDataRepository.update` resolves. |
| `src/persistence/PluginDataRepository.ts` | one queued read-modify-write owner for Obsidian `loadData/saveData` | **Retain** serialized writer; never create parallel plugin-data writers per feature. |
| `src/persistence/VaultProgramStore.ts` | versioned vault persistence + compare-and-swap against loaded byte snapshot | **Retain** snapshot identity and CAS semantics; a folder move cannot bypass these. |
| `src/context/ContextResolver.ts` | imports concrete `ObsidianContext` within same technical folder | Context service is coupled to host concrete implementation rather than a capability-local interface. |
| `src/persistence/TokenUsageRepository.ts` | persistence plus provider-specific cumulative checkpoint arithmetic | Extract pure usage aggregation/domain policy; leave storage and serialization in data adapter. |
| `src/application/ports.ts` | ports import types from `context/`, `session/`, and `types.ts` | Structural ports exist, but dependency *contracts* still point toward technical owners; move only semantically application-owned contracts on migration. |
| `src/main.ts` | composition and registrations, plus idle/visibility handlers and provider login/settings lifecycle | Create a focused Obsidian lifecycle/host bridge as these operations change; keep main strictly as composition/registration. |
| `scripts/boundaries.mjs` | source regex and allowed root-folder import matrix | Checks some forbidden imports; does **not** validate cohesion, runtime policy, cycles within domain, ownership of state/writes, or architectural bypass through methods. |

### Positive architecture that must not regress

- Domain transition logic is mostly pure and separate from Obsidian.
- Runtime/provider-specific code is not directly imported by `ChatView`.
- `SessionController` and `PluginDataRepository` preserve staged persistence then publish.
- Provider-neutral runtime streams and integration tests already exist.
- Vault program/progress stores have explicit compatibility and conflict semantics.
- `main.ts` currently creates concrete objects and binds the runtime; keep one composition root.

These facts make a big-bang rewrite a poor choice. Boundary improvements must be behavior-preserving slices.

## §2 R — ownership and responsibility map

| Capability / owner | Must decide | Must not decide |
|---|---|---|
| Conversation | chat session identity, transcript persistence, history/archive/fork, final commit of conversation outcomes | AI provider wire formats, DOM, evidence/mastery policy |
| Learning program | one active program, focus/session timers, curriculum authority, revision approval and program version | raw Obsidian vault calls, DOM rendering |
| Learning evidence | eligibility, mastery, activity recommendations and evidence transition | storage mechanics, provider-specific event parsing |
| Practice | question state machine, allowed answer/hint semantics, evaluation eligibility | session data writes directly, vault operations |
| Context/research | selection precedence, authorized sources, permitted retrieval | unauthorized vault enumeration, UI state |
| Editing | edit proposal permission, apply coordination, editor Undo semantics | direct transcript writes without conversation authority |
| Inference integration | AGY/Codex/ChatGPT transport/auth/process, runtime stream and cancellation | changing learning-domain decisions |
| Usage | canonical token accounting/delta rules and persisted usage ledger | transcript/learning evidence |
| Presentation | view state, rendering, user-intent dispatch, accessibility, popup lifecycles | durable source-of-truth or business policy enforcement |
| Plugin host/platform | Obsidian API event registration, lifecycle, serialized plugin-data transport, native adapters | product/domain meaning |

## §3 S — state authority and invariants

1. Chat session/transcript/proposal state: one authoritative conversation/session owner; one serialized transaction pipeline. No view writes.
2. Program/focus/time state: one learning-program aggregate writer. A focus transition and session timing checkpoint must serialize through the same owner.
3. Learning evidence: one learning-state store; evidence uses stable IDs and terminal-only commits. If an outcome persists but evidence reconciliation fails, replay from committed transcript.
4. Practice active state: reconstructable from committed transcript; in-process registry is derived, not a second durable authority.
5. Obsidian plugin data: `PluginDataRepository` is the only loadData/update/saveData serialization boundary, regardless of feature package.
6. Vault file changes and proposal status: independent effects; applied editor change cannot be undone by merely failing the subsequent proposal-status write. Preserve applied-but-unsynced receipt and retry-status-only behavior.
7. UI transient state: view-owned and disposable. It may cache projections but never act as canonical domain state.
8. Token usage: durable usage ledger; provider cumulative-to-delta accounting is owned by a pure usage rule, persisted by its adapter.

## §4 Proposed small folder architecture

```text
src/
  main.ts                              # composition + Obsidian registration only
  features/
    conversation/
      view/                            # ChatView shell, history, composer, transcript, response
      controller.ts                    # UI intents, read projections
      run-turn.ts                      # one learning turn coordinator
      turn-effects.ts                  # terminal commit + event reconciliation (after tests)
      model/                           # ChatSession, transcript, history transitions
      data/                            # SessionRepository/codec, uses platform plugin data
    learning/
      view/                            # activity/learning graph/panel
      controller.ts                    # program/focus intent, overview projection
      program-service.ts               # aggregate command coordinator and write serialization
      session-time-service.ts          # timing lifecycle under same program authority
      curriculum-service.ts            # revisions/planning under same program authority
      model/                           # program/focus/revision/evidence/learner rules
      data/                            # program and learning-evidence vault adapters
    practice/
      view/                            # question/evaluation cards
      model/                           # practice state machine, answer validation, scope
    context/
      resolver.ts                      # context policy / source precedence
      research-index.ts                # pure indexing/retrieval
      data/                            # Obsidian notes, metadata cache, policy source
    editing/
      controller.ts                    # apply/retry/status coordination
      model/                           # replacement validation
      data/                            # Obsidian editor adapter, native Undo
    usage/
      view/                            # usage/settings sections
      accounting.ts                    # pure provider-neutral usage accounting
      data/                            # ledger repository
    settings/
      view/                            # settings tab
      data/                            # plugin settings codec
  platform/
    inference/                         # agent runtime, AGY, Codex, ChatGPT, OAuth, transport
    obsidian/                          # plugin-data writer, lifecycle subscriptions
```

**Not a mandatory template:** smaller capabilities need only one or two files. Do not create empty controller, service, domain, and data folders. Put public capability contracts next to their owner; do not introduce a new global `shared/` unless actual ownership is shared.

**Important distinctions:** `controller.ts` translates a user intent into an application call and a read projection; `*-service.ts` coordinates operations and transactions; `model/` owns pure business rules and transitions; `data/` owns serialization/storage; `platform/` implements external APIs. There is no separate HTTP controller layer in this Obsidian desktop plugin.

### Direction of legal dependencies

```text
Obsidian plugin/main (composition root)
       |
       +-> feature.view -> feature.controller -> feature service -> feature model
       |                                    |               |
       |                                    +--------------> owned ports
       |
       +-> concrete data adapters / platform integrations --> domain models/ports

feature A -> public interface of feature B, when needed
feature A -X-> private data adapter or model internals of feature B
model -X-> presentation, Obsidian, persistence, provider, platform
view -X-> data adapter, raw pluginData, vault mutation
```

Runtime dependencies may flow from use case to a port supplied by an adapter, but source imports for port types must flow toward the use case/contract owner (dependency inversion).

### Example target runtime graph

```text
ChatView (dispatch intent)
  -> ConversationController
  -> RunTurn coordinator
       -> ContextService -> ContextPort -> ObsidianContext adapter
       -> Learning/Practice domain decisions (pure)
       -> InferencePort -> AGY/Codex/ChatGPT adapter
       -> normalized parsing and terminal validation
       -> ConversationSessionPort.commit(outcome)
            -> SessionTransaction -> PluginDataRepository
       -> LearningEvidencePort.appendWithReconciliation
            -> VaultLearningStore (CAS)
  -> UI events / read projection -> ChatView render
```

A model `completed` transport event must not imply a committed business outcome until validation and relevant persistence succeed. Preserve the existing per-action completion gates.

## §5 Risk and verified guarantees

**Risk P0 — data correctness:** session lost updates, partial Practice/Review commits, mistaken completion, stale edit proposals, vault CAS conflicts, source-bound authorization, legacy transcript decoding. Prove with real repository integration tests, restarts, failure injection. Do not replace authoritative writers.

**Risk P1 — change amplification:** a renderer change should not touch business state, a provider addition should not touch domain and chat view, a curriculum decision should not change session persistence internals. Track the changed-file blast radius per feature.

**Risk P1 — runtime resource lifetime:** one plugin-level host listener owner; view-level timers and renderer resources disposed with each view, and inference cancelled on proper lifecycle. Obsidian recommends `registerEvent`, `registerDomEvent`, `registerInterval` for host lifecycle management.

**Risk P2 — structural constraints:** scripts/boundaries checks imports, not behavior. Add graph-based checks for forbidden feature-private edges, acyclic dependency components, and dependency direction. Keep tests for protected behavior.

## §6 Architecture trade-off

Rejected:
- **Current top-level technical owner folders forever**: low move cost, but `application/` and `chat/` remain large attention scopes and obscure feature cohesion.
- **Strict 5+ layers everywhere**: increases indirection and folder ceremony without independent responsibilities.
- **Rewrite to full Clean Architecture / DDD / CQRS / event bus**: high migration and compatibility cost for a single-process Obsidian plugin.

Chosen: feature-first responsibilities with **logical** layers where warranted, one composition root, and integration adapters outside the domain. The migration is completed *per behavior* rather than *per folder*.

## §6a Concrete dependency audit and refactor placement (2026-10-19)

This is based on **source code paths**, not the folder names or a green boundary checker. The checker in `scripts/boundaries.mjs` defines allowed root owners and a regular-expression import scan; it cannot prove actual state ownership, business-rule purity inside the view, or contract inversion.

| Source path(s) | Verified actual dependency or responsibility | Target owner / *safe* treatment |
|---|---|---|
| `src/chat/ChatView.ts` (3,173 lines) | Calls `LearningController`, but also imports `parseScopeCommand`, `isActiveLearningScope`, `isProgramLearningScope` directly from domain; contains UI lifecycle and feature intent flow | `features/conversation/view/` remains the Obsidian ItemView shell; command *policy* and interpretation move behind a controller/query, while local UI mechanics stay in view collaborators |
| `src/application/LearningController.ts` (816 lines) | Facade to `RunLearningTurn`, session, focus/programs, edit apply, active practice and runtime switching | Retain a compatibility facade while splitting conversation, learning, and editing use-case entry points, but avoid duplicating state or the authoritative writers |
| `src/application/RunLearningTurn.ts` (1,615 lines) | Mixes context preparation, model streaming, parser, practice/review terminal gates, committed transcript outcomes, evidence projection and edit proposals | `features/conversation/run-turn.ts` remains the **one** turn coordinator; extract pure preparation/terminal-validation helpers under their semantic owner, not a second commit manager |
| `src/application/LearningProgramOrchestrator.ts` (765 lines) | Owns one `mutationTail` and calls `ProgramStorePort.load/save` across focus, timing, program and curriculum operations | `features/learning/program-service.ts` owns **one write serialiser**; optional timing and curriculum collaborators must share that ownership |
| `src/session/SessionController.ts`, `src/session/SessionStore.ts` | SessionController owns `writeTail` and commits `SessionStore` draft via `PluginDataRepository.update` before publishing; SessionStore includes persisted codec and state operations | `features/conversation/` owns session transaction semantics; separate codecs from transitions *only where needed*, maintain the same atomic publish path |
| `src/persistence/PluginDataRepository.ts` | Single `loadData/saveData` read-modify-write queue across plugin-data consumers | `platform/obsidian/` remains sole serialized plugin-data writer, injected into authorized capability adapters |
| `src/persistence/VaultProgramStore.ts`, `VaultLearningStore.ts` | Snapshot identity, CAS/conflict detection, migration decoding and vault mutation | `features/learning/data/` must preserve loaded-snapshot CAS and compatibility; do not introduce per-feature copies of the vault writer |
| `src/context/ContextResolver.ts` | Constructor accepts **concrete** `ObsidianContext` type; calls note/selection/research I/O directly through it | `features/context/resolver.ts` consumes an application-owned, minimal `NoteContextSource` contract; Obsidian implementation moves to `features/context/data/` |
| `src/context/ObsidianContext.ts`, `LocalResearch.ts` | Obsidian API interaction and local research policy/index share the same technical folder | Isolate Obsidian-host I/O as a context data adapter; keep deterministic selection/indexing under pure context logic |
| `src/persistence/TokenUsageRepository.ts` | Decodes persistent token usage and implements provider-cumulative AGY checkpoint arithmetic in the same class | `features/usage/model/accounting.ts` contains pure delta/accounting rule; `features/usage/data/` owns codec/persistence with the same serialized plugin data owner |
| `src/mutation/MutationService.ts` | Authorizes primary Markdown note and uses Obsidian `MarkdownView.editor.replaceRange` for native Undo | `features/editing/` owns edit authorization/application; editor adapter remains Obsidian-specific; preserve authorized-file check and applied-but-status-unsynced semantics |
| `src/agent/AgentRuntime.ts`, provider adapters | Runtime/provider integration is provider-neutral to consumers but public port type is imported from the concrete `agent/` folder | Stable `InferencePort` belongs beside consuming use-case contract; concrete runtime, transport, auth and adapters remain under `platform/inference/` |
| `src/main.ts` | Wires concrete adapters, registers Obsidian view/settings, document listeners, focus and idle lifecycle | Keep a *single* composition root; move host event translation to an Obsidian lifecycle adapter only if separating it reduces real change coupling |
| `src/types.ts`, `src/application/ports.ts` | Shared types and generic ports couple several unrelated technical owners | Move only contracts whose owner is established by actual callers and invariants; avoid a new unbounded `shared/types.ts` bucket |

### Logical stack, not mandatory folders

```text
Obsidian event / gesture
  -> feature/view       : render, collect intent, manage transient DOM state
  -> feature/controller : translate intent, query projection, report errors
  -> feature/service    : coordinate use case, ordering and write guarantees
       -> feature/model : pure rules, transitions, invariants
       -> feature/port  : *required capability*, not concrete storage class
            <- feature/data OR platform adapter : Obsidian/AI/I-O mechanics

main.ts composes the port -> adapter at startup.
```

A pure one-file feature does not need controller + service + model + data directories. A controller does **not** own business-rule decisions; a service is not synonymous with domain logic; and a data adapter cannot be a second source of truth. Use stable feature-owned public contracts for cross-feature calls, rather than direct imports of another feature's private data adapters.

### Four critical end-to-end proof paths

1. **Chat/inference:** UI intent -> ConversationController -> one RunTurn -> scoped ContextPort -> InferencePort -> normalized stream -> terminal validation -> SessionController commits transcript; only afterwards reconcile evidence and render committed result. Cancel, malformed, failed or partial streams cannot commit phantom practice/review/edit outcomes.
2. **Program/focus:** user focus intent -> LearningController facade -> program service serialiser -> pure focus/timing rules -> VaultProgramStore CAS -> updated projection. Concurrent intents and external vault changes cannot bypass the single writer or accept stale revisions.
3. **Edit proposal:** terminal provider output -> validated pending proposal in transcript -> explicit approval -> editor adapter with primary-file authorization/native Undo -> proposal-status persistence. A successful editor mutation followed by failed status sync must be represented as applied with unsynced status, not as an unapplied edit.
4. **Context/privacy:** explicit note references and selected note -> context policy -> authorized Obsidian note source -> bounded research envelope -> inference. Do not let provider or presentation bypass source-bound checks or enumerate unrelated vault files.

### Evidence that the migration must produce

- Source-level dependency graph with import cycles, fan-in/fan-out and illegal private feature edges, plus an explicit list of allowed cross-feature contracts.
- Test doubles for port boundaries; tests proving no duplicate writes, no phantom evidence on incomplete inference, and no state publish on failed plugin-data persistence.
- Changes reviewed by behavior slice, not by folder count. Compare before/after effect owners and executable tests; a passing import rule is necessary but insufficient.
- Do **not** treat source inspection as measured behavior: this branch does not claim a runnable Obsidian desktop acceptance or a verified baseline test suite.

## §7 Incremental migration, acceptance and rollback

### M0 — Lock contracts, gather baseline
- Add measured import dependency graph and identify incoming/outgoing edges per core file; include baseline typecheck/lint/test/build outputs.
- Record state authority inventory above and final public APIs per feature.
- Add tests for `RunLearningTurn` terminal persistence, program CAS, session atomicity, provider cancellation and UI mapping; reuse existing tests rather than duplicate.
- Acceptance: baseline green; no production changes.
- Rollback: remove checks/docs only.

### M1 — Presentation isolation
- Extract `ChatView` state/event control into **existing related view collaborators** first: stream presenter, transcript presenter, history presenter; keep Obsidian `ItemView` as shell.
- Move `isLocallyExecutableCommand` offline capability decision behind a UI-facing controller query; presentation no longer parses domain commands as policy.
- Acceptance: no view import of data adapters; end-to-end send/history/practice/proposal behavior unchanged, navigation cleanup proven.

### M2 — Conversation turn coordinator
- Keep one `RunTurn` active-turn/cancel owner.
- Extract context request preparation, terminal validation and structured outcome reconciliation as testable functions/use cases **without introducing an independent transaction owner**.
- Acceptance: cancellation/timeouts/incomplete model output never commit phantom evidence or proposals; idempotent retry.

### M3 — Learning program responsibilities
- Split plan/revision, focus transitions, and session timing handling behind shared program write serialization.
- Keep CAS expected-read snapshot identity and operation IDs intact.
- Acceptance: concurrent focus/timer/revision commands cannot overwrite or violate one-active-focus invariant; restart recovery/legacy program data compatible.

### M4 — Data/contract direction
- Move usage arithmetic into pure accounting module; keep ledger repository I/O only.
- Move context application ports/types out of concrete Obsidian adapter dependencies when usages prove boundary.
- Preserve serialized plugin data writer, vault `process` CAS, status receipt and native Obsidian Undo path.
- Acceptance: same usage totals for cumulative AGY, other providers, replay and restart; same context selections and privacy constraints.

### M5 — Move packages after behavior is decoupled
- Move files with mostly import-only changes; update boundary checker **in the same slice**, preserve public compatibility facade where necessary.
- Delete emptied old folders only when all consumers migrate. Do not keep two write paths.
- Acceptance: TypeScript/lint/test/build/boundary guard green, release-critical artifact checks green, Obsidian desktop acceptance before release.

**No mass folder rename prior to M1-M4.** A rename without meaningful responsibility separation is deliberately not counted as architectural progress.

## §8 New executable architecture rules (target)

1. Exactly one mutable source of truth per state; UI may not persist domain aggregates.
2. Module-local model code imports only pure model types/functions (plus allowed pure model peers).
3. Controllers dispatch intents, prepare read projections, and map errors; they do not open files, create provider processes, or implement mastery/focus rules.
4. Application services may call only owned public capability contracts + injected ports; no host framework imports or concrete adapter imports.
5. Data adapters do storage, decode/encode and defensive schema validation; no policy decisions that change permitted domain transitions.
6. Host adapters cannot issue business decisions; provider output is untrusted until validated and terminal-gated by the application.
7. Cross-feature imports must target explicit public contracts; no direct imports of private data, view state, or transaction internals.
8. Dependency graph must be acyclic across capability modules; guard must check source content and known escape paths (imports, dynamic imports).
9. Preserve session writer queue, program/progress CAS, proposal receipt and legacy schema compatibility as architectural invariants.
10. No empty layers, `shared/utils.ts` buckets, new event bus, duplicated repositories, or naming-only reorganization.

## §9 Engineering proof, not a folder-only proof

For each migration PR attach:
- before/after responsibility graph with concrete file references;
- one end-to-end production call path, including persistence side effects and negative terminal path;
- source-of-truth inventory and conflict/retry behavior;
- import boundary report and changed module count;
- focused tests and `pnpm check:boundaries`, `pnpm verify`, `pnpm docs:check`, `pnpm release:check` where applicable;
- explicit disclosure of what CI does not prove: native Obsidian desktop behavior, Undo, live provider health, filesystem crash durability.

### M0 executable baseline and protected contracts (2026-10-19)

**Implementation:** `scripts/architecture-graph.mjs` builds a deterministic, source-level graph from TypeScript AST; `tests/architecture/dependency-graph.test.ts` proves parser, cycle, resolution, and report behavior. `pnpm architecture:graph` prints Markdown, `pnpm architecture:graph --format=json` emits full machine-readable edges, and `pnpm architecture:graph --check` additionally rejects unresolved relative imports or computed dynamic import expressions. Existing `pnpm check:boundaries` remains the production guard; M0 does not treat existing cycles as automatically safe or introduce a new gate for yet-unmigrated feature contracts. CI prints the measured graph in the build job summary.

**Graph units:** A node is a source file, an edge is a unique static TS import/export or literal dynamic import/require (including type-only references). `fanIn` and `fanOut` count distinct neighboring files; cross-owner counts use the *current* top-level folders, **not** the future capability grouping. Strongly connected components report cycles; type-only edges are retained so a runtime-only graph cannot conceal coupling. Computed dynamic references and missing modules are explicitly reported for investigation.

**Public contracts that migration must preserve:**

| Capability | Current public entry point / contract | State/effect owner |
|---|---|---|
| Conversation | `LearningController.run`, `SessionPort`, `SessionController` | `SessionController` serializes mutations and commits through `PluginDataRepository`; only then publishes in-memory session |
| Program and focus | `LearningProgramOrchestrator`, `ProgramStorePort` | Shared program mutation queue + `VaultProgramStore` expected-snapshot CAS |
| Learning evidence | `LearningStatePort`, committed transcript outcomes | `VaultLearningStore` owns the authoritative evidence ledger; failed projection can reconcile from committed transcript |
| Practice | `PracticeSessionRegistry`, domain practice state machine | Derived session-scoped memory; **not** a second durable writer |
| Context | `ContextPort`, `ContextResolver` | Request-time resolution under context/source authority; Obsidian vault adapter performs I/O |
| Inference | `AgentRuntimePort`, normalized `AgentStreamEvent` | `AgentRuntime` owns provider lifecycle; terminal validity belongs to the turn coordinator |
| Editing | `MutationPort`, `MutationService`, proposal transcript state | Authorized Obsidian editor mutation + separate proposal-status synchronization |
| Usage and plugin data | `TokenUsageRepository`, `PluginDataRepository` | Exactly one serialized plugin-data writer; provider checkpoint deltas do not double count |

**Runtime and failure contract test inventory (existing tests, not duplicated):**

| Guarantee | Existing regression proof |
|---|---|
| Concurrent plugin-data writes keep unrelated keys, later writes survive failure | `tests/persistence/PluginDataRepository.test.ts` |
| Failed session write cannot publish staged history; same/cross-session serialized mutation | `tests/session/SessionController.test.ts` |
| Program CAS, stale content and migration compatibility | `tests/persistence/VaultProgramStore.test.ts` |
| Evidence CAS and migration/error recovery | `tests/persistence/VaultLearningStore.test.ts` |
| Interrupted/failed practice or review stream does not commit phantom evidence; edit outcome failure recovery | `tests/integration/learning/recovery-flow.test.ts` |
| Provider swap preserves history and uses refreshed runtime state | `tests/integration/learning/runtime-switch.test.ts` |
| Forbidden root-module imports remain denied | `tests/architecture/boundaries.test.ts` |

**M0 acceptance and non-goals:**

1. AST graph available as Markdown/JSON and exercised with unit tests; existing checker remains active.
2. PR CI checks include typecheck, existing unit/integration suite, build, release artifact check; report actual outcomes before calling acceptance complete.
3. No production TS files, vault schemas, provider transports, or runtime authority writers changed.
4. No obligation to remove existing cycles or cross-owner edges until a behavior-preserving migration slice proves a better owner.
5. Native desktop behavior, live providers, Obsidian Undo, and filesystem crash durability **cannot** be certified by CI.
6. M1–M5 remain pending and the full feature-first target is **not** implemented in M0.

### M0 verification status

Graph instrumentation and contract mapping are implemented on this branch. The status of GitHub CI and any measured metrics must be read from the current PR run rather than assumed from source inspection. No manual Obsidian acceptance was conducted; this is not a release.
