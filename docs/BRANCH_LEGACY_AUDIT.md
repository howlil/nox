# NOX branch and domain-agnostic legacy audit

**Snapshot:** 2026-10-15; default branch `master` at `11ec8c201b31693164f3764c0c518d6a8ec0f87f`.
**Method:** GitHub branch/ref comparison, PR history, file/blob verification and source-level responsibility/dependency trace. GitHub three-dot comparisons count commits since merge base: ahead counts **do not** establish that code is absent from master (rebased/cherry-picked features can still be present). No local checkout or desktop Obsidian acceptance was available. Recheck refs before any destructive action.

## Branch triage

| Branch | Behind / ahead vs master | PR / evidence | Decision |
| --- | --- | --- | --- |
| `feat/agentic-ui-foundation-m0-m5` | 56 / 3 | #47 merged the only remaining `ui-events.ts` reducer and test; their blob SHAs are identical on master | **Delete candidate**; no fresh merge |
| `feat/agentic-ui-inspectors-20261014` | 58 / 11 | #43 closed as superseded; #44 merged the updated inspector/learning map | **Delete candidate**; no fresh merge |
| `feat/agentic-ui-m0-m5-20261014` | 56 / 47 | #41 closed as superseded; #44 merged replacement, #47 preserved remaining reducer | **Delete candidate**; no fresh merge |
| `feat/rich-response-design-graph-20261015` | 47 / 16 | #56 closed as superseded by #59; current master has newer rich-response and graph-layout files | **Delete candidate**; no fresh merge |
| `feat/lazy-learning-skills` | 50 / 3 | #50 remains an open draft; optional activity-based policy loading is absent on master; mergeable=false at audit time; historical CI success on old head `cebe13b` | **Keep/rebase**. Resolve conflicts against current master, rerun checks and desktop smoke before merge |

Do **not** bulk-merge the four superseded branches: their three-dot diffs are stale relative to current master and could regress UI, session, diagram, or design-token behavior. Verify head SHAs and absence of unrecovered commits before deleting remote refs. GitHub branch deletion was **not** performed as part of this audit.

## Architecture: actual responsibility graph

```text
ChatView / action-menu       [presentation]
    |
    v
LearningController          [application facade / command routing]
    |\
    | +--> LearningProgramOrchestrator --> ProgramStorePort --> VaultProgramStore
    |                                  --> LearningStatePort --> VaultLearningStore
    v
RunLearningTurn              [one turn, practice recovery, prompt and commit]
    |\
    | +--> action-builders.ts (instruction policy)
    | +--> PracticeSessionRegistry / PracticeStateMachine
    | +--> domain/practice/learning-scope.ts (legacy backend-only lock)
    | +--> SessionPort --> SessionController --> SessionStore / plugin data
    | +--> AgentRuntimePort --> AgentRuntime --> AGY / Codex / ChatGPT adapters
    v
TranscriptPart --> SessionStore + ChatView
```

The **provider boundary** is already largely agnostic: application depends on `AgentRuntimePort`, not a specific LLM transport. The **learning-mode boundary** is not fully domain-neutral.

### Findings by risk

**P0 — Default learning-mode semantics are still backend-specific**
- `src/domain/practice/learning-scope.ts` contains `scopeDeflection()` with a fixed backend domain and generic `/mode assessment` / `/mode focused` commands mapping to the old backend lock.
- `src/application/action-builders.ts` `buildScopedPracticeInstruction()` unconditionally demands “backend engineering only,” regardless of the active learning goal.
- `src/application/RunLearningTurn.ts` uses `${session.id}:backend` as a practice registry key, routes locked turns through the backend-only instruction, and stores backend-marked structured parts. This is a *semantic owner* issue, not just copywriting.
- `src/application/LearningController.ts` blocks domain-neutral `/plan` and `/next` under that legacy scope rather than representing two coherent independent modes.

**P1 — Legacy scope leaks into presentation and durable contracts**
- `src/chat/ChatView.ts` hardcodes “Backend · Assessment/Focused/Paused,” backend placeholders and tooltips; `src/chat/action-menu.ts` exposes backend pause/resume entries.
- `src/session/transcript-types.ts` and `src/session/transcript-schema.ts` have the persisted `scope?: "backend"` discriminator. Do **not** delete this discriminator or relabel old transcript parts without a tested read migration; preserve correct outstanding-question recovery.
- `docs/LEARNING_ORCHESTRATOR.md` describes general program activities as separate from the opt-in historical backend-only scope. Document that distinction in the UI and tests until legacy support is explicitly retired.

**P2 — Legitimate compatibility and adapter naming; not domain leaks**
- `SessionController` intentionally migrates persisted `agy-sessions` into `nox-sessions` atomically. Keep the read path until backward compatibility is formally ended; do not delete user data.
- AGY, Codex and ChatGPT names in `main.ts`, `agent/*`, settings and quota parsers describe concrete provider implementations, not a mandate to learn backend engineering.
- “backend” in server/HTTP protocol explanations or technical documentation is a subject noun, not automatically a product-coupling defect.

## Target: one curriculum semantics owner, explicit legacy compatibility

```text
UI user intent
  --> LearningController
      --> program mode: programId + objectiveId + activity kind
          --> generic domain rules + evidence, provider-neutral prompt
      --> legacy mode: explicit old session state only
          --> compatibility scope adapter + old transcript decoder
      --> free ask/practice: session-local state
  --> normalized agent runtime + validated events
  --> one transcript/evidence persistence authority
```

**Design constraints**
1. No domain keyword, including `backend`, is the hidden default for any **new** plan or learning session. `LearningProgram.goal` and objective outcome/criteria own subject matter.
2. The application owns practice identity. Derive namespaces from a tagged context such as `free`, `program(programId, objectiveId)`, or `legacyBackend`; never infer them by matching message text. There remains **one active practice state per appropriate session/context**.
3. The provider adapter only transports requests/events. No domain-specific practice instruction or mastery rule belongs in AGY/Codex/ChatGPT adapters.
4. Preserve old `learningScope` and `scope: "backend"` on read; ensure pending question, hint state, and fork provenance restore after upgrades.
5. Define one command contract: new `/mode assessment` must either operate on the active program's goal, or the old command must be explicitly presented as legacy/opt-in. Never silently change the meaning of an existing persisted session.
6. Do not add a new mutable store or parallel learning controller. Make narrow changes to the existing `LearningController`, `RunLearningTurn`, domain scope rules, application prompt builder and UI projection.

## Recommended execution order

1. **Behavioral tests first.** Add regression coverage for legacy recovery, old transcript decode/forks/hints; domain-neutral examples (Spanish grammar, calculus, physics, backend engineering); selected program isolation; out-of-scope policy; provider swaps. Ensure a general `/plan` cannot unexpectedly trigger a backend-only prompt.
2. **Isolate compatibility.** Parse legacy scope into an explicitly tagged compatibility mode. Keep the old storage decoder and backend-only policy callable **only** from that path; prohibit accidental general-program use.
3. **Move generic constraints to existing domain/application owners.** Scope decisions derive from active program goal, objective, learning activity and approved note sources; preserve application validation before evidence writes.
4. **Project state into UI.** Replace hardcoded backend labels in the generic composer, intent chip and action menu with goal-based display text while marking old sessions accurately. Remove dead strings and branches only after cross-layer tests.
5. **Rebase #50** independently on current master; resolve `RunLearningTurn` changes carefully. Confirm the optional 12 KB vault skill cannot supersede source authorization, app validation or domain-evidence rules. Do not merge the stale draft as-is.
6. **Run gates:** `pnpm check:boundaries`, `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:integration`, `pnpm docs:check`, `pnpm release:check`, `pnpm build`, `pnpm test:artifacts`; then manual Obsidian Windows provider and 320px/narrow sidebar smoke tests. No gate is claimed as run by this audit.
7. **Cleanup remote refs:** after checking PR-to-branch provenance, delete four superseded branches through GitHub Branches/merged PR pages. Keep `master` and the surviving skill PR branch until resolved. Enable “Automatically delete head branches” under repository Settings > General > Pull Requests to prevent future accumulation.

### Acceptance / stop conditions

- Program: language/math/physics topics remain correct under default and focused workflows with no backend hardcoding.
- Legacy: old backend-only transcript can reopen, resume, fork and preserve pending-practice evidence; no data is rewritten destructively.
- Authorization: selected materials, practice validation, learner evidence and approval-only note edits remain governed by their current canonical owners.
- Runtime: provider swaps do not alter the learning goal or misattribute conversation state.
- Release: no automatic publish is triggered from docs/feature merges; `docs/RELEASING.md` stays authoritative.

## References

- Superseded inspector PRs: [#41](https://github.com/howlil/nox/pull/41), [#43](https://github.com/howlil/nox/pull/43); replacement [#44](https://github.com/howlil/nox/pull/44).
- Foundation salvage [#47](https://github.com/howlil/nox/pull/47).
- Superseded rich response [#56](https://github.com/howlil/nox/pull/56), replacement [#59](https://github.com/howlil/nox/pull/59).
- Skill loading draft [#50](https://github.com/howlil/nox/pull/50).
- Canonical architecture: [AGENTS.md](../AGENTS.md), [Engineering Design](../.agents/ENGINEERING_DESIGN.md), [Learning Orchestrator](LEARNING_ORCHESTRATOR.md).
