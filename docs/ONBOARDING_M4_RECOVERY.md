# NOX Onboarding M4 — Durable Approval & Recovery

Status: implemented on draft PR #121 after M1–M3. M5 Obsidian-native acceptance still NOT RUN. No merge/release.

## 1. Objective and existing authority

Make interrupted onboarding reproducible without a second generator, writer, program repository, or inferred learning evidence. The authoritative program store persists programs by `creationOperationId`; the plugin-data onboarding draft holds a **receipt written before program-store mutation**. Workspace files remain create-only under the existing `VaultWorkspaceWriter`. Approval is explicit and remains valid across a crash; no inference or new approval is performed on restart.

The prior behavior lost `preview` (memory-only) and `operationId` after reload, and existing-program detection hid onboarding despite a partially materialized workspace. Startup workspace recovery was log-only. M4 binds these existing capabilities with a durable receipt and visible recovery UI.

## 2. Shapes (A/E/R design-thinking §1)

```ts
type ApprovalReceipt = {
  programId: string;        // validated preview ID
  operationId: string;      // stable identity across retries
  withWorkspace: boolean;   // immutable choice after first approval attempt
};
type OnboardingDraft = {
  version: 1;
  stage: OnboardingStage;
  // ... existing user inputs
  approval?: ApprovalReceipt;
};
type OnboardingStage = "welcome" | ... | "recovering" | "ready";
```

No new persistence schema version: optional receipt for older version-1 drafts; invalid receipts fail closed at the existing `OnboardingStateRepository.load` edge. If the receipt is missing, transient `preview` / `applying` / `ready` restore as `form`. With a valid receipt, any transient stage restores as `recovering`.

## 3. A — One-shot call graph and cardinality

```text
A1 User edits goal
  -> OnboardingFlow.prepare
  -> saveOnboardingDraft({ stage: generating }) [durable]
  -> requireProviderReady -> previewLearningProgram [one bounded model generation]
  -> OnboardingFlow.preview [in-memory; 15-minute validity in orchestrator]

A2 User explicitly selects plan-only or create-workspace
  -> choose stable {preview.id, operationId, withWorkspace}
  -> saveOnboardingDraft({ stage: applying, approval }) [durable precondition]
  -> LearningController.approveLearningProgram / approveLearningWorkspace
  -> LearningProgramOrchestrator.commitPrepared [CAS/idempotent receipt]
  -> if withWorkspace: VaultWorkspaceWriter.ensure [create-only manifest]
  -> saveOnboardingDraft({ stage: ready, approval }) [success handoff]
  -> display ready + adaptive next objective
  -> on explicit "Start first objective" or "Maybe later":
       dismissOnboarding [clear receipt] -> standard focus / chat path

R1 Restart with unfinished approval
  -> OnboardingStateRepository.load [validate receipt]
  -> restoreOnboardingDraft [recovering]
  -> ChatView detects pending receipt even when program exists
  -> LearningController.recoverOnboardingApproval
       -> listPrograms [authoritative program ID + creationOperationId + choice]
       -> if workspace-approved: VaultWorkspaceWriter.ensure [same create-only writer]
       -> ready projection; no second commit, no AI generation
  -> user resumes first objective or chooses later

R2 Old chat transcript on startup
  -> ChatView.restoreSession
  -> recovery notification + "Resume recovery" action
  -> standard showEmpty / OnboardingFlow(recovering)
```

Cardinality: **one** logical approval ID, **zero** automatic replacement programs, **zero** model sends during recovery; multiple bounded file writes may be resumed. In-process concurrent ensure calls for one program share a single promise, including startup auto-recovery and onboarding repair.

## 4. E — Failures and invariants

| Break | Expected behavior |
| --- | --- |
| Input interrupted during generation | Draft saved; restart returns to form without provider replay |
| Provider unavailable or request aborted | Existing form/cancel recovery, no commit |
| Preview expires before commit | Clear approval receipt; require fresh explicit preview |
| Receipt save fails | Do **not** invoke program commit; show retry |
| Program-store CAS fails before commit | Retain stable receipt/preview for retry; on restart reconcile first |
| Restart before program commit | Matching program absent; clear receipt, return to goal form |
| Restart after commit, before workspace complete | Verify stored program+operation ID+workspace intent, ensure only missing owned paths |
| Workspace path collides with an unowned file | Do not overwrite; show retry/error |
| Startup writer + manual repair concurrent | Single flight per program ID; no duplicate create |
| Restart after commit before user chooses first activity | Ready handoff remains durable until Start/Maybe later |
| Read model fails after commit | Success remains committed; user can return to chat and inspect /progress |
| Legacy draft without receipt | Exactly same shape and former restore semantics |

**Boundary guarantees:** no source-note bytes included in recovery metadata; unknown receipt must match committed program and operation ID, cannot escalate plan-only to workspace-approved. No new provider authorization is inferred. Crash recovery cannot guarantee safety across concurrent *external* Obsidian processes, therefore file ownership checks still reject conflicting writes.

## 5. R — Required collaborators and behavior layering

```text
OnboardingFlow (native view) -> LearningController
    -> OnboardingStatePort -> OnboardingStateRepository -> PluginDataRepository [serialized metadata]
    -> LearningProgramOrchestrator -> ProgramStorePort [CAS authoritative program state]
    -> WorkspaceWriterPort -> VaultWorkspaceWriter [create-only, single flight]
ChatView -> same onboarding controller and transcript; no duplicate domain state.
```

Transaction boundary is **not** a fake two-phase cross-file ACID transaction. The receipt is a precondition, program CAS is authoritative, and missing files are repaired by bounded, idempotent compensation after restart. The error channel is explicit: retry verified writes, escape to fresh preview only when no commit exists, and reject ownership conflicts.

## 6. Test substitution & acceptance

The same call graph is exercised with fake plugin data, fake program store, fake native elements, and fake Obsidian vault. Regression tests:

- `tests/persistence/OnboardingStateRepository.test.ts` — receipt across restart, malformed receipt rejected, legacy draft compatibility.
- `tests/application/OnboardingWorkflow.test.ts` — all interrupted approval stages restore to `recovering`.
- `tests/chat/onboarding-entry.test.ts` — pre-commit interruption, committed-ready handoff, workspace failure/retry, no replayed approval, receipt prewrite failure, expired preview behavior.
- `tests/persistence/VaultWorkspaceWriter.test.ts` — concurrent ensure single-flight, partial files, safe collision error and later retry.

Native Obsidian restart, local vault permissions, keyboard/focus, and visual interaction remain M5 acceptance, not a claim of passing tests. The separate startup auto-repair remains enabled but errors must also be visible through pending receipt UI.

## 7. Verification record

Automated GitHub CI gates: architecture/boundaries, typecheck, lint, unit/integration tests, build/artifacts. See latest PR #121 checks for the final commit. No release action authorized.
