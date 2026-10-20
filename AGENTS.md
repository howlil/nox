# AGENTS.md

Scope: entire repository.

## Goal

Ship the smallest correct Nox product slice quickly, with clear ownership and
verification proportional to real risk.

Default workflow:

```text
UNDERSTAND
→ MODEL ONLY WHAT MATTERS
→ IMPLEMENT
→ VERIFY ACTUAL RISK
→ SHIP
```

Do not optimize for ceremony, maximum abstraction, maximum test count, or
architecture purity. Optimize for short feedback loops, one owner per rule,
correctness, maintainability, and low regression risk.

---

## Community release and public documentation rules

- `docs/RELEASING.md` owns the publish process; regular feature merges must
  never create public releases. A reviewed `release/x.y.z` candidate with real
  native acceptance must publish the exact tag and three installable assets
  **before** its version bump is merged into `master`.
- **Community manifest parity is blocking:** the version in `master/manifest.json`
  must always match a public (non-draft, non-prerelease) GitHub Release tag
  spelled exactly `x.y.z` (never `vx.y.z`). That release must contain exactly
  nonempty `main.js`, `manifest.json`, and `styles.css`.
- `CI / build` runs `scripts/ci/check-public-release.mjs` for PRs targeting
  `master` and pushes to `master`. Do not merge a release PR until this
  check succeeds against the live public GitHub Release.
- Never bypass the D01–D10 native Obsidian acceptance gate, impersonate evidence,
  or merge version metadata early to force the release job. An unpublished
  version must remain on `release/x.y.z`, not in `master`.
- Never edit tags or published release binaries. The authoritative public ID
  is `nox`, and package/manifest/tag must use the same `x.y.z` version.
- Public docs start at `docs/README.md`. Keep a how-to focused on the user's
  action; put architecture rationale in the existing canonical design files.
- User-visible changes require docs or a stated reason why docs do not change.
  Provider/network/privacy/file-access changes require explicit README or
  `docs/PROVIDERS.md` disclosures in the same PR.
- Never claim production compatibility or external-provider entitlement from
  mocked CI. Record real desktop acceptance before approving a release PR.
- Check `pnpm docs:check` and `pnpm release:check` alongside `pnpm verify`.

---

## Canonical product context

Before changing behavior, use these repository contracts:

- `.agents/PRODUCT_DESIGN.md` — product behavior, user flows, states, scope, and product acceptance criteria.
- `DESIGN.md` — detailed UI and visual rules.
- `.agents/ENGINEERING_DESIGN.md` — architecture, boundaries, state ownership, runtime, persistence, testing, and migration direction.

A direct user instruction overrides these documents. If the requested behavior
intentionally changes a canonical contract, update the relevant document in the
same task.

Do not silently redesign product behavior while implementing engineering work.

---

# 1. Understand

Before editing code:

1. inspect the smallest relevant area;
2. identify the observable outcome requested;
3. identify callers, state, dependencies, side effects, and consumers;
4. identify the highest-risk failure mode;
5. define concrete acceptance criteria.

Use this graph when the change is non-trivial:

```text
input / caller
→ responsibility
→ state + dependencies
→ side effects
→ output / consumer
```

Do not audit or redesign unrelated architecture.

If existing behavior is unclear, inspect it before replacing it.

---

# 1.1 Architecture gate before coding

For every non-trivial code change, `.agents/ENGINEERING_DESIGN.md` is a
mandatory engineering constraint, not optional background reading.

Before implementation, determine:

```text
requested behavior
→ responsibility
→ authoritative owner
→ architecture layer
→ allowed dependencies
→ state + side effects
→ consumer
```

The default Nox boundary model is:

```text
Presentation
    ↓
Application
    ↓
Domain

Application
    ↓ ports
Infrastructure / adapters
```

Use these placement rules:

- state meaning and valid transitions → domain;
- workflow ordering and effect coordination → application;
- durable storage/serialization → repository or persistence adapter;
- Obsidian, AGY, process, filesystem, and plugin-data mechanics →
  infrastructure adapter;
- user intent and rendering → presentation;
- construction/wiring only → `main.ts`.

Before writing code, answer:

1. What module is the canonical owner of this responsibility?
2. Is any existing module already authoritative for the same decision?
3. Is this state authoritative, derived, cached, or purely presentational?
4. Who is legally allowed to mutate it?
5. Does the proposed dependency follow the allowed direction?
6. Does this introduce a second mutable source of truth?
7. Is a new interface/layer actually required by an I/O, lifecycle, ownership,
   or test boundary?

If ownership is ambiguous, reconstruct the current responsibility graph before
implementing.

Do not resolve ambiguity by adding another controller, service, wrapper,
manager, store, or interface.

Fix the ownership boundary first.

### Architecture stop conditions

Do not implement the proposed shape as-is when it would introduce any of these:

- domain importing Obsidian, provider, process, persistence, or UI code;
- application importing a concrete provider/Obsidian adapter when a real port
  boundary is required;
- persistence deciding learning/practice/proposal domain meaning;
- UI directly mutating durable domain/session state;
- multiple independent `plugin.loadData → merge → saveData` writers;
- callers mutating repository-owned session objects directly;
- a second mutable proposal, practice, session, or learning-state authority;
- provider-specific events becoming UI or domain contracts;
- business rules placed in `main.ts` because it is convenient.

When one of these conditions appears:

```text
stop local implementation
→ identify canonical owner
→ route through or repair that boundary
→ then continue the smallest vertical slice
```

### Architecture verification before ship

For changed behavior, inspect the final dependency path:

```text
caller
→ application use case
→ domain rule and/or port
→ adapter/repository
→ result/event
→ consumer
```

The change is not architecture-complete if the same rule or mutable state can
still be changed through another competing path.


---

# 1.2 Folder ownership — mandatory for all new code

Folder placement is an executable contract, not a stylistic preference.
Before adding a file or moving behavior, read the current architecture map in
`.agents/ENGINEERING_DESIGN.md` and select one existing canonical owner.

```text
src/
├── application/  # workflow / orchestration / narrow I/O contracts
├── domain/
│   ├── learning-state/  # evidence and gap invariants
│   ├── practice/        # question/evaluation lifecycle
│   ├── review/          # material-quality findings
│   └── mutation/        # pure exact replacement planning
├── agent/        # runtime boundary, normalized stream parser, AGY adapter
├── context/      # selection, note resolution, vault policy adapter
├── session/      # durable transcript, session, proposal persistence
├── persistence/  # plugin data and vault progress adapters
├── mutation/     # Obsidian editor mutation adapter
├── chat/         # Nox panel, renderers, composer, and UI primitives
├── settings/     # settings model and Obsidian settings tab
├── types.ts      # existing shared contracts only; prefer owner-local types
└── main.ts       # composition only
```

Ownership test for **every new module**:

- Domain state meaning, invariants, or pure transitions → `domain/<feature>/`.
- User intent, sequencing, retry, and use-case ports → `application/`.
- Provider parsing, processes, runtime → `agent/`.
- Note context and policy collection → `context/`.
- Session history and serialization → `session/`.
- Raw plugin/vault storage → `persistence/`.
- Native note edits → `mutation/`.
- Do not merge `session/`, `persistence/`, and `mutation/` only to reduce
  folder count: they own transcript state, durable I/O, and editor Undo
  respectively. Every session mutation must be serialized together with its
  durable snapshot by `SessionController`; the plugin-data writer alone does
  not serialize snapshot staging.
- Chat rendering, interactions, composer, and Nox-specific UI primitives → `chat/`.
  Avoid a separate `ui/` layer until a second feature genuinely owns/reuses it.
- Settings only → `settings/`; wiring only → `main.ts`.

Do **not** recreate `src/learning/`, `src/ui/`, `src/helpers/`, `src/common/`,
`src/managers/`, `src/services/`, or broad `utils.ts` buckets.
Do not create a new top-level owner without changing this contract, the
architecture guard, and its regression tests in the **same PR**.

Dependency rules:

```text
chat → application → domain
                  ↘ narrow I/O ports
infrastructure (agent/context/session/persistence/mutation) implements effects
main.ts → all concrete implementations (composition root only)
```

- `domain/` imports only `domain/`, never Obsidian, provider, session,
  runtime, persistence, or application.
- `application/` consumes structural contracts in `application/ports.ts`,
  domain types/rules, normalized agent events, and narrow transcript contracts.
  It must not import concrete session, context, mutation, or vault adapters.
- `chat/` never reads/writes persistence directly.
- `src/types.ts` is existing shared transport/session compatibility only;
  new feature contracts live with their owner.
- Co-locate tests in matching `tests/<owner>/`; complete workflows live under
  `tests/integration/`.
- Avoid barrel exports and path aliases that hide cross-boundary edges.
- Prefer **moving one responsibility and fixing its imports** over introducing
  a generic interface, repository, event bus, manager or dependency-injection
  framework.

After any file/import change, run `pnpm check:boundaries` and `pnpm verify`.
The guard rejects unknown owners, unresolved relative imports, and forbidden
dependency edges in CI. Never bypass it with a suppression merely to ship.

---

# 2. Model only what matters

Choose one canonical owner for every rule.

Examples:

```text
learning evidence transition
→ learning-state domain

practice lifecycle
→ practice state machine

visible / sent context
→ ContextResolver

agent process + provider protocol
→ AgentAdapter implementation

structured model block parsing
→ StructuredStreamParser

conversation persistence
→ session persistence boundary

Markdown replacement validity
→ mutation logic

visual state
→ UI
```

Do not duplicate the same decision across UI, controller, store, session, and
adapter layers.

Prefer:

```text
UI / adapter
→ application use case
→ domain rule
→ port
→ infrastructure adapter
```

Avoid speculative abstractions.

Create an interface, service, repository, or helper when it establishes a real
boundary, removes proven duplication, or makes important behavior independently
testable. Do not create abstractions merely because they may be useful later.

---

# 3. Implement the smallest vertical slice

Prefer an end-to-end behavior slice over building disconnected architecture in
advance.

Good:

```text
practice answer
→ evaluate
→ transition learning state
→ persist evidence
→ render next state
```

Avoid:

```text
create generic domain framework
→ create generic repository framework
→ migrate every module
→ no user-visible behavior completed
```

Rules:

- reuse the canonical path before introducing a second pattern;
- keep source-of-truth ownership explicit;
- keep adapters thin;
- keep domain rules independent from Obsidian and provider details;
- do not leave parallel legacy paths after migration unless compatibility requires them;
- do not broaden the task with unrelated cleanup;
- remove code made dead by the change.

For bug fixes, reproduce the failure first when practical.

Use compatibility facades when they let a boundary improve incrementally without
forcing a rewrite.

---

# 4. Testing strategy

Testing is risk-driven.

Test public or observable behavior rather than implementation details.

## TDD by default

Write or identify a failing behavioral test first for:

- business rules;
- lifecycle and state transitions;
- validation;
- parser behavior;
- context precedence;
- data transformation;
- mutation safety;
- bug regressions.

Flow:

```text
failing test
→ confirm intended failure
→ smallest implementation
→ green
→ refactor if needed
→ targeted verification
```

Do not force TDD mechanically for:

- documentation;
- generated files;
- simple configuration;
- dependency metadata;
- purely visual styling;
- mechanical renames;
- composition-root edits with no behavior change.

## Verify the actual risk

Start with the narrowest useful check.

| Change | Minimum useful verification |
| --- | --- |
| Pure domain rule | focused unit test |
| Bug fix | regression test + focused suite |
| Structured stream parser | split-boundary + invalid-schema tests |
| Context resolution | selection/current-note/explicit-context behavior |
| Session or learning persistence | repository/store integration proof |
| Agent process or cancellation | adapter/process integration proof |
| Markdown mutation | stale/ambiguous + editor boundary proof |
| UI interaction | affected flow inspection + typecheck/build |
| Style-only UI | type/build + visual verification |
| Packaging | artifact identity + target-path inspection |
| Docs only | links + consistency review |

Run broader checks only when the blast radius justifies them or before shipping
a change that crosses major boundaries.

A passing suite is not proof of correctness if the risky behavior is not covered.

The standard repository gate is:

```sh
pnpm verify
pnpm lint
git diff --check
```

If a baseline tool cannot run because of repository configuration, report the
exact failure. Do not call it green.

Real Obsidian behavior is release-level proof when native editor history,
selection retention, plugin lifecycle, or live process integration is involved.

---

# 5. Nox-specific invariants

These are architectural constraints, not preferences.

## Learning

- A normal question is not mastery evidence.
- Only meaningful evidence may change durable learning state.
- Practice evaluation may create learner evidence.
- Review findings describe material quality; they must not silently become learner weakness.
- One correct answer may improve a gap when the domain rule allows it, but it is not automatic mastery.

## Practice

```text
question
→ waiting for answer
→ evaluating
├─ failure / cancel / timeout → same active question
└─ evaluation
   ├─ next question → waiting for answer
   └─ no next question → complete
```

The plugin owns practice lifecycle state. The model supplies question and
evaluation content, not lifecycle authority.

Both new Practice questions and evaluations are **candidates until a terminal
agent `completed` event**. A failed, cancelled, timed-out, malformed, or
duplicate-question stream must not create a durable/answerable question. Commit
the question to the transcript before exposing it as active.

## Context

- Selection has priority over the current note for automatic turn context.
- Explicit note/file context is additional readable context.
- System policy and learning progress are not user-selected context.
- Supporting context is read-only.
- The current authorized mutable note is the normal edit target.

## Editing

```text
agent complete + valid single proposal
→ atomic durable transcript commit
→ user review
→ re-read current document
→ exact unique match
→ Apply
→ one Obsidian editor transaction
```

Never silently rebase stale or ambiguous edits.

- Parser output is only a turn-local candidate. Failed/cancelled/timeout/
  malformed/multiple proposals never become actionable.
- Commit Edit narrative and its one proposal atomically through
  `SessionController.recordEditOutcome`, then emit `mutation-proposed`.
- Retry with the same `turnId` must replay canonical persisted state rather
  than generate another edit; applied/rejected/stale outcomes do not reopen.
- Pending proposals become stale on restart until explicitly regenerated
  by a new logical turn. Do not bypass editor authorization or native Undo.

Use Obsidian editor APIs so native Undo remains available.

When native editor Apply succeeds but persisting `proposalState=applied` fails,
never offer Retry Apply: the document has already changed. Retain only a
turn-local recovery receipt, show an explicit warning and **Retry status sync**
action (which writes session status only, never calls editor replacement).
SessionController must stage proposal-state updates and publish them to memory
only after durable persistence succeeds. Until status sync completes, block
session transitions that would abandon recovery. After restart, an unresolved
pending proposal is stale—not silently actionable. Native Undo still requires
manual Obsidian verification.

## Agent runtime

- Nox is runtime-agnostic above the `AgentAdapter` boundary.
- Spawn the configured runtime only when needed.
- Send user-controlled content through structured stdin/input, never shell interpolation.
- Normalize provider output before product/UI consumption.
- Capture stderr and convert malformed/failed streams into recoverable product errors.
- Stop child processes on cancellation, view close, and plugin unload.
- Provider names and raw protocol events must not leak into normal product UI.

---

# 6. Git workflow

Use a lightweight trunk-oriented workflow.

## Branches

Default: continue on the current working branch.

Create a dedicated branch only when:

- the change is risky or large enough to need isolation;
- parallel work is happening;
- the user explicitly requests a branch or PR;
- the change cannot reasonably be completed as one coherent working session.

Do not create a branch for every small edit.

If a branch is created:

```text
branch
→ complete one coherent task
→ verify
→ merge promptly
→ delete branch
```

Avoid long-lived feature branches.

## Commits

A commit should represent one coherent completed slice.

Prefer:

```text
implementation + relevant tests + required docs
→ one logical commit
```

Avoid WIP commit spam, unrelated formatting, and feature + cleanup mixtures.

---

# 7. Refactoring rule

Refactor when it reduces concrete risk in the current change.

Good reasons:

- two paths implement the same business rule differently;
- ownership is ambiguous;
- dependency direction prevents faithful testing;
- the current structure creates a known unsafe change path;
- the change would otherwise add a second source of truth.

Not sufficient by itself:

- a file is large;
- code is not maximally DRY;
- a pattern could be introduced;
- clean-code terminology suggests a different shape.

Do not perform architecture rewrites as incidental cleanup.

---

# 8. Dependency rule

Do not add a dependency until existing platform/runtime capabilities are
insufficient.

Before adding one, answer:

```text
what concrete problem does it solve?
why is current code/platform insufficient?
what bundle/runtime/maintenance cost does it add?
```

Prefer established dependencies when they remove meaningful risk. Avoid
framework duplication.

---

# 9. Obsidian compatibility workflow

For behavior touching Obsidian APIs:

```text
focused deterministic proof
→ implement
→ build
→ verify native Obsidian boundary when required
```

Do not replace Obsidian editor behavior with filesystem shortcuts when native
selection, editor state, or Undo semantics matter.

Generated `dist/` output is not source. Do not edit it manually.

Do not deploy to a user's vault unless explicitly requested.

---

# 10. Review before ship

Inspect the final diff, not only test output.

Check:

- does the change satisfy the requested observable behavior?
- is there one source of truth for each changed rule?
- did UI, persistence, or adapters acquire business logic?
- is failure behavior explicit?
- are practice, context, and edit invariants preserved?
- are tests protecting the actual risky behavior?
- did unrelated files change?
- did the change leave dead or parallel paths?
- did a product/engineering contract change and need documentation?

Do not keep adding polish once acceptance criteria are satisfied.

---

# 11. Definition of done

A task is done when:

```text
requested behavior works
+
important failure path is handled
+
changed rule has one canonical owner
+
actual regression risk is verified
+
types/build are healthy for affected scope
+
dead transition code is removed
+
canonical docs are updated if contracts changed
+
diff contains no unrelated work
```

"More architecture" is not part of done.

"More tests" is not part of done once the important behavior is protected.

Ship when the slice is correct, understandable, and easy to change next.
