# NOX Agentic UI — M0–M5 Delivery & Design Contract

**Product:** provider-agnostic, domain-neutral Obsidian learning companion.
**Reference:** [Beautiful UI](https://www.beautifului.dev/) for AI-native
thinking traces, tool chips, context cards, approval patterns and flowcharts;
[Arc UI](https://uiarc.dev/docs/motion) for motion cause/effect, accessibility,
interruptibility and reduced motion. Adapt patterns to the native Obsidian DOM;
do not copy React dependencies or licensed proprietary components.

## Design thinking

1. **Empathize:** understand why the agent is working, which note it read,
   and what evidence is needed to progress, without creating dashboard clutter.
2. **Define:** conversation already streams; objective prerequisites and
   mastery are authoritative in the learning domain, but not graphically
   inspectable. Tool lifecycle metadata is not yet surfaced.
3. **Ideate:** one calm sidebar with an expandable run inspector and a
   collapsible, read-only learning map. Preserve the existing Settings
   token-usage dashboard, approved-note-edit controls and tool permissions.
4. **Prototype:** normalized metadata → LearningEvent → native DOM inspector;
   learning evidence → application projection → prerequisite navigator.
5. **Test:** event causality, recoverable failure, origin isolation, controlled
   actions, keyboard behavior, dark/light, narrow sidebar and reduced motion.

## Canonical ownership

```text
AGY / Codex / ChatGPT adapter
  → AgentStreamEvent
  → AgentRuntime [existing consumption of usage → TokenUsageRepository]
  → RunLearningTurn [pass safe tool lifecycle metadata only]
  → LearningEvent → ChatView → NoxRunInspector

LearningProgramOrchestrator + LearningStatePort
  → LearningController.getProgramOverview()
  → read-only LearningGraph
  → existing /start-session and /next use cases
```

User data, token accounting and execution outcomes remain owned by
existing controllers and repositories. There is no second usage ledger,
progress database, orchestration layer or event bus.

## Design rules and motion

- Reuse `styles.css` NOX tokens and Obsidian light/dark variables.
- No permanent multi-panel layout, thick borders or decorative telemetry.
- Every value shown must come from runtime data or validated learning state.
- Tool metadata shows allowlisted tool *kind* and status; command strings,
  shell output, file contents, secrets and private reasoning stay unexposed.
- Context cards may disclose a bounded passage supplied to the model; system
  instructions are **never** previewed. Characters are not token estimates.
- Native `details/summary` for expandable inspectors; default collapsed.
- Short 160–200 ms opacity/transform reveals. No text jitter or per-token
  animation; reduced motion disables travel/looping.
- UI records no new authority: Continue invokes the existing learning command.

## M0 — Provider-neutral agent event foundation

**Implemented on this branch:**
- Tool-started(id,name) and tool-completed(id,outcome) in `AgentStreamEvent`
  and `LearningEvent`.
- Codex JSONL lifecycle parser exposes sanitized metadata for allowlisted
  tool kinds (command execution, MCP tool call, web search and file change).
- Application forwards lifecycle metadata without affecting mastery, practice
  commit or note edits.
- AGY and ChatGPT do not fabricate tool events if adapters cannot report them.
- Existing provider usage parsing and aggregation from `docs/TOKEN_USAGE.md`
  remains untouched.

**Acceptance:** unrelated private reasoning/output omitted; only reported
tools appear; stale/out-of-order completion cannot create fictional starts;
cancelled runs mark outstanding tools interrupted.

## M1 — Observability and source-context inspector

**Implemented on this branch:**
- Inline expandable NoxRunInspector under existing StatusTrace.
- Source cards from actual turn snapshot visible/system context.
- Bounded 320-character user-context excerpt; system-context excerpts hidden.
- Tool status transitions running → completed/failed/interrupted.
- Existing Settings token usage from TokenUsageRepository is reused and stays
  separate from learning evidence.

**No false claims:** current run tool metadata is ephemeral; archived per-turn
tool traces are not yet persisted. No per-turn usage counter is projected into
chat, because master already owns its aggregated usage in Settings.

## M2 — Curriculum DAG and mastery evidence

**Implemented on this branch:**
- Header Learning Map control and accessible, collapsible node list.
- Prerequisite-depth topological ordering (no fabricated relationship).
- Objective status, assessed attempts, due recall date, estimated minutes,
  source references and next activity from the existing domain.
- Command reuse for Continue and Start Session. No direct objective unlocks,
  stale plan mutations or parallel mastery algorithm.

**Acceptance:** no program, multi-parent DAG, unmet prerequisite,
provisional/mastered/remediation, due recall and timebox limits.

## M3 — Research & retrieval UI

**Implemented slice:** provenance/source cards for actual context supplied
to a turn; approved objective sourceRefs in the learning map.

**Not yet implemented:** semantic + hybrid vault retrieval, website research,
citation ranking, knowledge graph index and research task execution.

**Required contract:** RetrievalPort.search({query,approvedScope,maxChunks})
returns stable source/revision IDs, exact passages, bounded snippets, retrieval
scores with semantics, citation spans, and policy checks. Source cards must
support click-to-source with stale/deleted source errors. Enforce prompt
injection isolation and source-bound restrictions before inference.
Benchmark retrieval quality/latency before adding embedding infrastructure.

## M4 — Tools, permissions and artifact UI

**Implemented slice:** live sanitized tool activity in RunInspector.
Existing note proposal preview and Apply/Reject are retained untouched.

**Not yet implemented:** general-purpose command/file/web tool permission
authority, sandbox execution, MCP connection manager, artifact workspace.

**Required contract:** ToolRegistry and PermissionPort own capability/scopes.
A stable approvalId, action digest, expiry, redacted invocation and allowed
path/domain must be revalidated on execution. Deny/timeout/replay/cancel
must be safe. Tool results cannot be inferred from a start event. Sandboxed
code execution belongs outside the Obsidian renderer.

## M5 — Agent orchestration UI

**Implemented slice:** objective prerequisite graph and deterministic learning
decision from existing orchestrator.

**Not yet implemented:** subagent delegation, parallel execution, background
agent jobs, resume from durable run checkpoints, run replay/time travel.

**Required contract:** distinct parent/child run IDs, child capability grants,
join and cancellation semantics, durable checkpoints, and crash recovery.
Build a read-only orchestration timeline only after the corresponding runtime
emits authenticated events. Do not show invented agent activity.

## Verification gates

1. `pnpm check:boundaries`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm test:unit`
5. `pnpm test:integration`
6. `pnpm build && pnpm test:artifacts`
7. Manual Windows Obsidian smoke for focus, keyboard, narrow sidebar, theme,
   reduced motion, restart, cancellation, ChatGPT/AGY/Codex differences.
8. For M3–M5, backend architecture and permission acceptance precede UI release.

**Delivery truth:** M0–M2 delivered as an additional UI vertical slice,
M3/M4/M5 have scoped partial UI and documented dependency gates; they must
not be called complete full-agent capabilities. No pass/fail claim is made
without actual verification artifacts.
