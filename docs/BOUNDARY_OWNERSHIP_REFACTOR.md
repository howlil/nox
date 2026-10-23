# NOX — Boundary ownership implementation (PR #133)

Status: draft, pending final verification and Obsidian Desktop acceptance.

## Intent and boundaries

Correct source-of-truth ownership without replacing public facades or creating
duplicate mutable stores. See `.agents/ENGINEERING_DESIGN.md` and
`docs/ARCHITECTURE_BOUNDARY_REDESIGN.md`.

## Implementation graph (A / E / R)

### 1. Idle tracking

`Host DOM event/tick → LearningActivityPresence → ProgramOrchestrator.setIdle
→ ProgramMutationQueue → VaultProgramStore.save(next, expected)`

- **A:** The activity observer updates desired idle status. One reconciliation
  loop serializes writes; acknowledgment occurs only after the CAS operation.
- **E:** A persistence error leaves the desired status pending. The next tick
  or interaction retries; an interaction supersedes an in-flight idle request
  and reconciles after completion.
- **R:** Injected clock, durable program mutation function, Obsidian-registered
  event/timer ownership at composition root.
- **Proof:** Threshold, failed persistence, concurrent in-flight interaction tests.

### 2. Onboarding approval

`OnboardingFlow (intent) → LearningController.approveOnboarding
→ OnboardingStatePort.saveDraft(receipt) → commitPrepared(CAS)
→ WorkspaceWriterPort.ensure? → ready / recovery`

- **A:** Exactly one durable approval intent precedes the program commit.
  Workspace creation is optional, explicit, reentrant, and create-only.
- **E:** If receipt persistence fails, no program commit occurs. If program or
  workspace operation fails afterward, persisted receipt enables read-first
  reconciliation; the provider is never blindly invoked on restart.
- **R:** Existing onboarding/program/workspace ports and authoritative CAS lane.
- **Proof:** Unit tests for failed receipt, ordered commit, plan-only and
  workspace failure; UI tests for expiry, retry, and interrupted recovery.

### 3. Pure domain planning and read models

- Lesson paths/content are projected in `domain/workspace/plan.ts`.
  VaultWorkspaceWriter does not decide Markdown template semantics.
- `domain/learner-model/learning-overview.ts` derives status, verified evidence
  counts and adaptive activity from program/evidence snapshots and one clock.
- `domain/learning-program/focus-transitions.ts` owns mastery-gated focus
  eligibility. Feature-level entry points delegate without duplicating policy.

### 4. Diagnostics infrastructure

`main.ts → diagnostics/runtime-provenance.ts → installed main.js`

The diagnostics module alone owns Node filesystem inspection. UI settings
neither read disk directly nor have a second persistence path.

## Invariants not to weaken

1. Conversation transcript is committed before progress reconciliation.
2. Program mutations retain the one queue and immutable expected CAS snapshot.
3. Approval receipt is durable before any program commit.
4. File creation is create-only and preserves existing learner changes.
5. Provider/Obsidian interfaces remain outside the pure domain.
6. Desktop acceptance remains mandatory before merge/release.

## Deliberate remaining scope

`RunLearningTurn` remains the terminal commit coordinator. UI-level
`/focus → /next` presentation sequencing and ChatGPT authentication
collaborator extraction are not changed without separately proven risk,
because splitting those now would enlarge runtime and provider failure surfaces.
