# NOX Onboarding M2 — First-value entry points

Status: implemented in draft PR #121, after M1 privacy and provider readiness. Native Obsidian desktop acceptance NOT RUN. M3 first-objective post-approval, M4 full recovery, and M5 native acceptance are separate work.

## Scope / acceptance

Change the first-run UI from four setup-oriented entries to **Note / Goal / Chat** with one learning engine; do not add a second plan generator, provider transport, persistence store, or agent framework.

- **Note:** identify the open Markdown note by path metadata only, show it before disclosure, choose Explain or independent Practice, verify it remains active before inference, then dispatch via the existing conversation turn. No curriculum or workspace creation. Free practice does not claim program mastery.
- **Goal:** one minimal goal input; `Create quick plan` dispatches the existing `/plan <goal>` command, which generates a plan without workspace scaffolding. `Prefer guided setup?` exposes the existing preview → explicit approval → create-only workspace flow.
- **Chat:** dismiss onboarding and focus the existing composer, without provider inference or workspace mutation.
- Preserve existing guided workspace approval, manual `/plan`, `/free-practice`, source-bound privacy, program ownership, and old drafts.

## Design Thinking — shapes, A/E/R graph

Shapes:
```text
OnboardingDraft v1 {stage, goal, sourceBound, sourcePath, ...}
stage: welcome | quick-goal | notes | legacy guided stages
NoteIntent: {sourcePath, kind: explain | practice}
QuickIntent: {/plan <validated goal>}
ExplicitContextRef: {kind: vault-note, path}
```

A (success; one-shot transitions unless stated):
```text
Open empty NOX -> getOnboardingContext(path metadata only) -> OnboardingFlow
  |-- Note -> selectCurrentNote(path) -> notes surface -> Explain/Practice
  |      -> verify active note still equals selected path -> checkRuntime
  |      -> ChatView.onNoteAction -> dismissOnboarding
  |      -> explicit vault-note ref + explicit-only context -> existing LearningController/RunLearningTurn
  |      -> ContextResolver.resolve(includeAmbient=false) -> provider stream -> durable conversation
  |-- Goal -> quick-goal input -> normalize + validate -> checkRuntime
  |      -> ChatView.onQuickPlan -> dismissOnboarding -> /plan <goal>
  |      -> existing curriculum preview/commit command (NO workspace files)
  |      -> optional guided setup -> unchanged preview + approval path
  \-- Chat -> dismissOnboarding -> showEmpty -> composer focused
```

Cardinality: one chosen note, one explicit provider request per clicked action; no repeated wizard calls to discover goals. Provider responses stream through the existing turn coordinator. Onboarding draft updates are idempotent user-state saves, not learning evidence.

E (anticipated):
```text
No open Markdown note  -> prompt to open one and retry selection (no provider call)
Active note changed    -> reject action; keep note screen; reselect
Provider unavailable   -> inline failure; preserve goal/source; retry
Goal too short         -> inline validation; no command dispatch
Navigation during preflight -> requestEpoch invalidates pending operation
Prompt already typed   -> do not overwrite composer's unsent draft
Provider turn failure  -> existing ChatView/runTurn failure and retry semantics
```

R (dependencies and authority):
```text
OnboardingFlow (Obsidian UI) -> LearningController.checkRuntime/getOnboardingContext
  -> ContextSourcePort.getActiveNotePath (metadata only)
ChatView -> LearningController.run -> RunLearningTurn / existing program orchestrator
OnboardingWorkflow (pure) -> OnboardingDraft + ProgramConstraints types
OnboardingStateRepository -> sole draft persistence owner
VaultProgramStore / VaultWorkspaceWriter -> unchanged CAS and create-only ownership
```

Security: the note-first entry uses `LearningRequest.contextMode="explicit-only"`, which skips ambient editor selection/note reads and forwards the chosen explicit vault note. Normal chat keeps its previous automatic-context behavior. This input-context restriction does **not** provide filesystem sandboxing for CLI providers; M1 source-bound curriculum isolation is unchanged. Do not describe local CLI executions as source-isolated.

## Design Graph — interface surfaces and actions

| Surface | C: content/actions | V: visible variants | N: prerequisites |
| --- | --- | --- | --- |
| Welcome | Learn from a note / Start with a goal / Just chat | first-run or resumed | no existing program or prior chat, not dismissed |
| Note | selected path, Use current note, Explain, Practice, Back | no note, selected, changed, provider error, checking | open Markdown note, explicit selection |
| Quick goal | one goal field, Create quick plan, Guided setup, Back | empty, invalid, checking, provider error | valid goal, connected provider |
| Guided form | existing goal/advanced inputs and preview approval | existing failure/cancel/preview states | validated constraints |
| Chat | existing composer and response | ordinary runtime states | provider for inference |

Interaction: native buttons are keyboard-reachable; on stage transitions focus moves to the heading or goal input, and inline failures have `role=alert`. Sidebar stays single-column using the existing NOX UI classes. Back and reselect preserve the minimal input and avoid hidden provider work. No extra modal or duplicate workspace mechanism.

## Tests / evidence

- `tests/chat/onboarding-entry.test.ts`: three cards only, chat skip, quick `/plan`, note practice, changed path blocks send, provider not ready blocks send.
- `tests/application/OnboardingWorkflow.test.ts`: legacy discovery stages migrate to welcome; quick-goal state survives restore, source scope resets, invalid goals rejected.
- `tests/context/ContextResolver.test.ts` asserts explicit-only requests perform zero ambient reads and forward only the authorized note.\n- Existing `ProgramPlanGeneratorPrivacy.test.ts` protects M1 provider egress and pre-read isolation.
- CI should run `pnpm verify` plus architecture graph verification. Real Obsidian desktop interaction remains unverified until M5.

M2 does **not** wire `onStart` after guided approval (M3), prove workspace partial-write recovery (M4), or claim native desktop acceptance (M5).
