# NOX Onboarding M3 — Plan approval → first learning activity

Status: implemented on draft PR #121 after M1/M2. Native Obsidian Desktop acceptance: NOT RUN. M4 partial-write recovery and M5 real desktop acceptance remain separate milestones.

## Product/behavior contract

An approved validated curriculum should not disappear into empty chat. After the learner approves a preview, show **Your learning plan is ready** with the actual next recommended objective, **Start first objective**, and **Maybe later**.

Guided preview offers two explicit approval decisions:
- **Use plan only**: call existing `LearningProgramOrchestrator.commitPrepared(previewId, operationId, false)` through `LearningController.approveLearningProgram`. No workspace writer invocation.
- **Create workspace**: call existing `approveLearningWorkspace` (commit with `workspaceApproved=true` and idempotent create-only workspace materialization). Existing manifest remains source of truth.

No automatic timed session, teaching, evidence, or filesystem write is triggered when merely rendering the success state. First activity requires a deliberate user click.

## Design Thinking — shapes, A/E/R, cardinality, scope

Shapes:
```text
LearningProgram {id, creationOperationId, workspaceApproved?, objectives[]}
ApprovalIntent = plan-only | create-workspace
ReadyState {committedProgram, nextObjective?}  // transient view state
FirstObjective = selectFirstOnboardingObjective(program, adaptiveDecision)
LearningRequest.focusProgramId = expected program identity for CAS focus mutation
```

Production A (success):
```text
OnboardingFlow.preview
  -> choose approval intent (one immutable selection on retry)
  -> LearningController.approveLearningProgram / approveLearningWorkspace
  -> LearningProgramOrchestrator.commitPrepared (existing CAS / stable operationId)
     -> optional workspace writer (existing create-only writer)
  -> OnboardingFlow.ready (no inference)
     -> read committed program overview + current program identity
     -> select objective from adaptiveDecision.next.objectiveId (never array[0])
     -> render "Start first objective" + "Maybe later"
     -> explicit start click
       -> ChatView guard active program and unsent composer
       -> LearningController.run(/focus <id>, focusProgramId=expected)
       -> LearningProgramOrchestrator.startFocus (program identity asserted *inside* CAS mutation)
       -> read persisted focus and active program to confirm success
       -> check runtime
       -> LearningController.run(/next)
       -> existing adaptive teach/practice session stream
```

Cardinality: one program commit per operationId, zero workspace writes for plan-only, at most one focus + one follow-on next per explicit click; duplicate clicks are disabled while starting. `/next` is never sent after failed focus. All learning evidence is still owned by existing transcript/evidence reconciliation.

E (failure graph):
```text
Provider generation fails   -> existing preview error, no persisted plan
Approval/CAS fails          -> remain on preview; reuse same operation ID
Workspace writes fail       -> retry workspace path only; never downgrade to plan-only
Commit succeeds, dismissal fails -> success state retained; warning, no second commit
Commit succeeds, read model fails -> success retained; "Maybe later" /progress fallback
Adaptive decision has no runnable objective -> no fake first-objective CTA; progress fallback
Program switches before focus CAS -> reject expected program ID without focus write
/focus fails                -> no /next inference; existing chat error + Notice if success surface detached
Provider not ready          -> focus persists, /next not sent, user can reconnect and type /next
/next fails                 -> existing transient turn error/retry semantics; never replay /focus
```

R (requirements/boundaries):
```text
OnboardingFlow [native UI]: LearningController, preview and committed IDs
ChatView [view coordinator]: present chat, submit canonical commands, focus verification
LearningController [application authority]: approve and run program commands
LearningProgramOrchestrator [CAS owner]: commitPrepared, startFocus with expected ID
NoxProgramOverview [read projection]: next decision, current focus
VaultWorkspaceWriter [files authority]: unchanged optional create-only materialization
```

No duplicate repository, new actor, extra endpoint, autonomous command chain, or background task is introduced. An awaited sequential UI action dispatches the two existing commands after the explicit Start click.

## Design Graph — C/V/N

| Surface | C (content/action) | V (meaningful rendering) | N (prerequisites) |
| --- | --- | --- | --- |
| Preview | objectives, feasibility, optional workspace manifest; Use plan only / Create workspace | idle, commit pending, retry locked | validated unexpired preview + operation ID |
| Ready | committed goal, workspace status, next objective, Start first objective, Maybe later | objective available / no runnable objective / read-model warning / launching | commit acknowledged |
| Chat | focused objective status and /next streamed activity | provider failure, pending response, success | same active program and focused objective |

UX: buttons reuse NOX primitives; no extra modal; main heading becomes focus target after ready renders; inline errors use `role=alert`; optional workspace wording is explicit. `Maybe later` returns to ordinary chat without silently starting focus. Existing composer remains available.

## Verification and review

- `tests/chat/onboarding-entry.test.ts`: program-only approval, original workspace writer, adaptive next objective (not first array element), ready CTA, stable operation ID across workspace failure, and post-commit dismissal/read-model failures.
- `tests/application/OnboardingWorkflow.test.ts`: first objective derived solely from adaptive decision; missing/deprecated/wait are not offered.
- `tests/application/LearningProgramOrchestrator.test.ts`: program-ID mismatch rejects before CAS write; matching ID can begin focus.
- Existing architecture, privacy, learning-program, turn-terminal, and recovery tests remain applicable.

M3 does NOT claim native Obsidian desktop acceptance or full crash/partial-write recovery (M4/M5). No merge, release, or Cloudflare CI changes are part of this milestone.
