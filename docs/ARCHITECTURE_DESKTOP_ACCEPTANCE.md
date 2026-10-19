# NOX M0–M5 — Desktop acceptance contract

Status: **Automated CI can verify the core contracts; real Obsidian desktop acceptance is NOT yet recorded.**
Scope: PR #121 staged responsibility migration. This is a technical acceptance protocol, not a public product release plan. No Cloudflare CI, release signing, or artificial GitHub gate is introduced.

## §1 Shapes and ownership

- **Session ID, message ID, turn ID, operation ID:** durable identities owned by existing SessionController, RunLearningTurn and learning evidence ledger. Navigation and retries must not change their meaning.
- **Program collection:** original loaded snapshot is `expected`; distinct proposed collection is `next`; only VaultProgramStore CAS may publish the update.
- **Provider stream:** `text | thought | structured candidate | completed | failed | cancelled`. Only a successful terminal event after validation can make a proposal/evaluation actionable.
- **Edit proposal:** `pending | applied | rejected | stale`. Native Obsidian editor owns the actual file mutation and Undo history. SessionController owns the durable receipt.
- **Presenter state:** transient DOM and animation frames only; no transcript, evidence, or program persistence authority.

## §2 A — Successful runtime graph

```text
Desktop Obsidian plugin activation
  -> SessionController.init: decode legacy/new plugin data
  -> ChatView: restore current transcript with cancelable epoch
  -> UI intent -> LearningController
      -> RunLearningTurn (single turn lock + terminal coordination)
          -> ContextResolver: authorized live editor data
          -> agent transport: authorized envelope
          -> StructuredTurnBuffer: non-actionable structured candidate
          -> terminal success -> SessionController: committed transcript
          -> TranscriptEvidenceReconciler: idempotent evidence CAS
          -> ChatView: actionable practice/review/proposal UI
  -> User approves edit
      -> MutationService: authorized open Markdown editor
      -> editor.replaceRange: native Undo
      -> SessionController: durable proposal status receipt
```

Program focus/timing, curriculum preview/approval and program switching use the single `ProgramMutationQueue` with `save(next, expected)`. Usage accounting is a pure projection inside the existing `PluginDataRepository` serialized writer.

## §3 Execution, interruption, and failure policy

- **Navigation while restoring:** new epoch wins; stale asynchronous Markdown rendering cannot add buttons to the new session. A stale rejection is ignored, while a current renderer failure propagates and remains recoverable.
- **Streaming:** frame coalescing preserves full response text; a callback delivered after cancellation cannot paint the next turn; rendering another container cannot duplicate buffered text.
- **Provider cancel/failure/timeout:** buffered structured events remain non-actionable. A previously committed transcript stays authoritative; retry must reconcile by stable operation ID, not append duplicate evidence.
- **Crash/restart after transcript commit:** replay missing evidence once. Never re-run an already-applied editor mutation on status retry.
- **File moved/closed or stale replacement:** reject mutation without writing an unauthorized file; preserve current native Undo semantics for successful editor replacement.
- **Program CAS conflict:** return an explicit failure instead of silently overwriting an intervening edit; a failed mutation does not poison later FIFO work.
- **Source-bound research:** preserve allowlisted file context; CLI provider filesystem access must not be misrepresented as source-isolated.

## §4 Automated proofs currently available

| Contract | Tests |
|---|---|
| Presenter cancellation after async Markdown; stale error; stream stale RAF | `tests/chat/transcript-presenter.test.ts`, `tests/chat/stream-text-presenter.test.ts` |
| Archive/delete/switch session and active transcript durability | `tests/session/HistoryActions.test.ts`, `tests/session/SessionController.test.ts` |
| Practice/review terminal gating, retry/restart replay, status-unsaved edit and mock Undo | `tests/integration/learning/recovery-flow.test.ts` |
| Authorization of open editor, stale/ambiguous mutation replacement | `tests/mutation/MutationService.test.ts` |
| Program concurrent focus/timing/revision, immutable expected CAS, restart recovery | `tests/application/LearningProgramOrchestrator.test.ts`, `tests/application/ProgramMutationQueue.test.ts`, `tests/persistence/VaultProgramStore.test.ts` |
| Source-bound context and research isolation | `tests/context/ObsidianContext.test.ts`, `tests/integration/research/research-privacy.test.ts` |
| Storage/transport compatibility and no dependency cycles | `tests/session/SessionStore.test.ts`, `tests/architecture/dependency-graph.test.ts`, `tests/architecture/boundaries.test.ts` |

Repeatable automated command on a checked-out PR branch:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm architecture:graph --format=json --check
```

Use the current commit's CI run as test evidence. `pnpm verify` covers typecheck, boundary/lint, unit/integration, documentation/release checks, build and artifacts. These are **mock-backed/host-independent proofs**, not Obsidian Electron acceptance.

## §5 Native Obsidian desktop acceptance matrix

These cases require actual Obsidian desktop with the PR plugin installed in a **disposable test vault**, not a production vault. Do not mark any case `PASS` merely because its mock-backed test passed.

| ID | Scenario / input | Required observable outcome | Evidence |
|---|---|---|---|
| D01 | Reopen Obsidian with existing multi-message and legacy history | No lost messages; active session and selected response version preserved | Screenshot/video + plugin log |
| D02 | Switch history while a long Markdown transcript is restoring; archive/delete another session | Only selected session rendered; no stale proposal toolbar or dangling history popover | Video showing switch and final state |
| D03 | Stream answer; stop mid-stream; immediately start another request | No stale frame appended to second answer; stopped response has no actionable structured candidate | Video + persisted transcript |
| D04 | Generate one practice question, attempt answer; simulate provider failure before completed | No phantom evaluation/mastery; pending question recoverable after reopening plugin | Transcript and learning-state snapshot |
| D05 | Complete practice and review; restart before/after evidence projection | Exactly one evidence operation receipt per committed terminal outcome | Transcript IDs + evidence IDs |
| D06 | Preview/apply an edit to the current Markdown note, press native Undo, then retry a previously saved status error | Editor Undo restores original text; retry does not apply replacement twice | Desktop video + note before/after |
| D07 | Attempt edit after switching note, moving file, or changing original text | No unauthorized or ambiguous replacement | Note inspection + Notice/error |
| D08 | Focus objective, pause/resume session, switch/reopen Obsidian | One active objective focus; recovered timer does not count unobserved downtime | Program snapshot + UI clock |
| D09 | Run source-bound program against ChatGPT; attempt CLI source isolation | Authorized source only in provider envelope; unsupported CLI source-bound use rejected | Sanitized request trace + UI failure |
| D10 | Change runtime provider with existing transcript and pending practice | Cursor/model appropriately rotated, local messages and practice history retained | Before/after session snapshot |

**Native execution rules:** Capture plugin version, commit SHA, OS, Obsidian version and installed provider mode. Redact chat content, OAuth tokens, credentials and personal vault paths from evidence. Save results in a review comment or an acceptance record; do not use source code comments as fake evidence.

**Pass gate:** all applicable D01–D10 pass, with no data loss, provider privacy regression, unauthorized edit, duplicate evidence, or broken Undo. If one fails, attach repro and fix the responsible owner; re-run relevant automated tests and that desktop scenario. If execution is unavailable, status remains **NOT RUN** rather than `PASS`.

## §6 Current conclusion

The staged refactor has independent automated proofs. **Native acceptance is an unresolved release prerequisite.** Keep PR #121 as Draft until desktop evidence is recorded and reviewed. Do not automatically merge, tag, publish, or modify Cloudflare workflows.
