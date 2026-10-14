# NOX Agentic UI — M0–M5 Implementation Contract

Date: 2026-10-14. Baseline: [Beautiful UI](https://www.beautifului.dev/) for
AI-native affordances; [Arc UI](https://uiarc.dev/docs/motion) for explainable,
interruptible, reduced-motion-safe interaction. Use their patterns, not their
React runtime: NOX is a native Obsidian plugin.

## Design thinking

**Empathize.** Learners need to understand what the agent is doing, which note
content is included, how many model tokens are reported, and why one objective
is recommended next. A compact Obsidian right sidebar should not turn into a
multi-pane coding IDE.

**Define.** The current application has a durable learning DAG and evidence
log but renders much of the information as text. The agent runtime originally
emitted only text/completed/failed/cancelled. No provider-neutral tool/usage
events existed, so a pretty trace would have to invent operations.

**Ideate.** Use one primary conversation, an optional run inspector attached
to the thinking trace, an optional read-only learning map and usage in Settings.
Maintain one canonical owner of execution and of learner evidence. Surface
only provider-reported telemetry.

**Prototype.** Wire data end-to-end; do not create a visual control before the
corresponding event, persistence, or authorization path exists.

**Test.** Typecheck and lint; run all existing unit/integration suites;
manually exercise real Obsidian light/dark, narrow sidebar, keyboard and
reduced-motion; verify real agent responses, provider billing, source scope,
restart, cancellation and stale-state recovery.

## Design tokens and motion

- Existing NOX CSS color/space/radius tokens remain authoritative; no new theme.
- Header icon exposes learning map; graph is grouped by actual prerequisite
  depth and never reorders curriculum authority.
- Run inspector is an HTML details element nested under existing StatusTrace:
  source paths and characters, metadata-only tool lifecycle, provider usage.
- Disclosure defaults closed. No permanently expanded diagnostic dashboard.
- Hover 100–160 ms; inset/entry 160–200 ms; layout/panel 200–260 ms.
- Prefer opacity/transform, not layout animation every stream token.
- Respect prefers-reduced-motion: no entry travel or looping decoration.
- All controls are keyboard reachable and aria labels describe their action.
- No model-generated fake progress percentage, sources, tool calls, costs or
  quota. Absent telemetry remains absent and is labelled as unsupported.

## Data and ownership graph

```text
AGY / Codex / ChatGPT adapter
  → AgentStreamEvent (normalized, data-only)
  → RunLearningTurn (turn lifecycle, origin session, usage receipts)
  → LearningEvent
  → ChatView
     ├─ existing StatusTrace → RunInspector
     ├─ existing conversation → practice/review/edit cards
     └─ LearningGraph → LearningController.getProgramOverview()
                          → LearningProgramOrchestrator + LearningStatePort
  → SessionPort.recordUsage() → SessionController → SessionStore → plugin data
  → SettingsTab via NoxPlugin.getUsageRecords()
```

No new event bus, Redux store, scheduler, runtime, or learning database.
Unknown provider capabilities are **not** inferred from elapsed time.

## M0 — Normalized telemetry foundation

**Files:** `src/types.ts`, `src/domain/telemetry/token-usage.ts`,
`src/agent/CodexProtocol.ts`, `src/agent/ChatGptAdapter.ts`,
`src/application/learning-types.ts`, `src/application/RunLearningTurn.ts`.

Contracts: tool-started(id,name), tool-completed(id,outcome), usage(input,
output,cachedInput?). Codex only reveals allowlisted tool *kind*, never command
arguments, shell stdout, secrets, filenames, or private reasoning. ChatGPT
usage is read only from a real response.completed usage object. Missing fields
remain unknown; integer counts are validated. Never allow tool events to
alter learning evidence or grant permission.

**Acceptance:** normal event order, multiple tools, failed tools, no fabricated
start, truncated stream and cancellation. Unknown usage omitted. Idempotent
learning commits remain independent from observational telemetry.

## M1 — Inspectable run, context and token usage

**Files:** `src/chat/run-inspector.ts`, `src/chat/ChatView.ts`,
`src/settings/SettingsTab.ts`, `src/session/SessionController.ts`,
`src/session/SessionStore.ts`, `src/main.ts`.

1. Show expandable run inspector in the existing thinking trace.
2. Source rows reflect `TurnContextSnapshot.visible/system` actually sent.
   Character length is explicitly *not* a token estimate.
3. Tool rows have started/completed/failed/interrupted states.
4. Usage receipts are written through existing serialized SessionController;
   one actual provider result yields one receipt. Failed persistence of
   observability must not retroactively mark an answer incorrect.
5. Settings shows all/by-provider/by-model and actual input/output/cached
   counters. No known provider usage = no numerical estimate. No cross-provider
   ChatGPT plan quota or exact API spend is asserted.
6. A historical run inspector requires persisted tool spans; this version
   intentionally keeps tool traces ephemeral. Usage receipts survive restart.

**Acceptance:** disconnected provider, stream failure, unavailable usage,
retry billed as separate actual inference, multiple sessions, invalid legacy
plugin data and provider filtering.

## M2 — Learning graph and progress surfaces

**Files:** `src/application/LearningController.ts`,
`src/application/learning-types.ts`, `src/chat/learning-graph.ts`,
`src/chat/ChatView.ts`.

Application produces a read-only objective status projection using
`objectiveProgress()`, never a UI-derived mastery heuristic. Graph orders
nodes by prerequisite depth, displays prerequisite links textually, statuses,
objective-specific attempts, due date and allowed source references. Continue
uses existing /next or /start-session, so the domain still enforces gates.

**Acceptance:** DAG with multiple prerequisites, unseen/provisional/mastered/
remediate, due recalls, session with timebox, no program, mismatched origin
and narrow sidebar. Do not claim assessment success from one MCQ.

## M3 — Research and retrieval

**Current delivery:** real context provenance rows in the run inspector;
objective source references in the learning map. This is NOT semantic search,
external research, grounded web citations or ranked retrieval.

**Next backend contract:** RetrievalPort.search({query,scope,maxChunks}) must
return sourceId/path, exact bounded passage or safe snippet, document revision,
rank evidence and provenance. Application validates scope, citations and
budget before a provider gets context. The UI then adds compact SourceCards
with open-source, quote span, and deterministic missing-source state.

**Security:** note content and embeddings are user-private; scoped retrieval
must not silently let local CLI agents read outside the selected vault notes.
Do not render citations for unverified passages. Metrics: precision@k, source
coverage, query latency, retrieval tokens and scope violations.

## M4 — Tool activity, approvals and artifacts

**Current delivery:** live metadata-only tool lifecycle chips (when provider
reports them); existing validated Apply/Reject Markdown diff stays the only
mutating UI. General tool execution and grants are NOT added by these cards.

**Required execution contract:** ToolRegistry defines tool ID, origin provider,
capability, permission scope, user-visible redacted invocation, timeout and
expected artifact. ApprovalRequest carries stable approvalId, intended change,
explicit allowed path/host, expiry and immutable request hash. The runtime
checks authorization *again* at execution, never trusts an approved UI boolean.
Persist decision and result; do not auto-retry non-idempotent actions.
Artifacts get typed previews (markdown/code/table), download/save only after
validation, and no unsafe HTML/script execution in Obsidian renderer.

**Acceptance:** deny, approve, timeout, stale approval, cancelled tool,
unsupported provider, duplicate approval, replay, arbitrary path traversal,
external host controls, redaction, audited artifacts and keyboard accessibility.

## M5 — Multi-agent and background orchestration

**Current delivery:** learning objective DAG visualization and deterministic
next-activity orchestration already in NOX. This is **not** a subagent graph.

**Required runtime contract:** separate durable run IDs, parent/child agent IDs,
typed handoffs, parallel task join semantics, resumable checkpoint state and
permissions inherited as least privilege. A graphical agent timeline is
read-only derived state. Long-running execution needs an explicit background
worker lifecycle, reliable scheduler, crash recovery, user-visible cancellation
and persisted checkpoints. UI must show capability-unavailable until these
runtime contracts are implemented.

**Acceptance:** concurrent child failure, parent cancellation, stale checkpoint,
resume with changed source revision, idempotent aggregation, no runaway token
usage, and no fabricated background progress.

## Release checks and actual status

- M0: implemented provider-neutral telemetry slice for supported events.
- M1: implemented in-thread runtime inspect and durable reported usage slice.
- M2: implemented read-only learning graph/navigation slice.
- M3: context/source provenance only; retrieval infrastructure pending.
- M4: tool lifecycle inspection + existing note edit approvals only; generalized
  tool permissions, sandbox and artifacts pending.
- M5: learning DAG UI only; durable background and subagent runtime pending.
- Automated CI and live Obsidian regression verification are separate gates.
  A code commit without a green pipeline is not a verified deployment.

Recommended release order: ship M0–M2 after CI/live acceptance; add M3 retrieval
as its own contract-tested vertical slice; then M4 authorized tool execution;
only after demonstrated need add M5 multi-agent/background complexity.
