# NOX — Responsibility-first architecture audit and redesign

Status: **proposed architecture; not implemented**
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

### This proposal's validation status

Source-level audit only. NOX production files, boundaries guard, and canonical `.agents/ENGINEERING_DESIGN.md` are unchanged. No tests or manual Obsidian acceptance were run in this proposal. This plan must not be merged as though architecture refactoring is complete.
