# NOX Onboarding — M1 Privacy & Provider Readiness

Status: implemented in draft PR #121; native Obsidian desktop acceptance NOT RUN.
Scope: **M1 only** of the onboarding redesign. M2 (entry point UX), M3 (post-plan first activity), M4 (full recovery), M5 (native acceptance) remain separate milestones.

## Product contract / preserved behavior

- General goal planning may generate a curriculum from an explicit goal and the existing program constraints without implicitly sending active note or editor selection content.
- Source-bound planning is explicit: the source path selected in onboarding must still match the current source at provider-call time and the provider must support isolation from arbitrary vault filesystem tools.
- Guided onboarding still previews before the user authorizes program/workspace persistence. No new account, store, telemetry, provider, or agent framework.
- Existing goal discovery, program generator, CAS, workspace approval, and cancel/abort ownership are preserved.

## Design-thinking shapes / A / E / R

### Shapes

`ProgramConstraints.sourceBound`, `ProgramConstraints.sourcePaths`: source intent and allowlist.
`LearningContext.selection` / `activeNote`: potentially private local Obsidian contents, not ambient permission to send.
`AgentHealth`: provider readiness observation (`ready | unavailable | misconfigured`).
`OnboardingDraft`: persisted locally through the original `OnboardingStateRepository`.

### A — successful execution graph

```text
General goal intent
  -> OnboardingFlow -> checkRuntime (readiness hint)
  -> LearningController.previewLearningProgram
  -> LearningProgramOrchestrator.prepareProgram
  -> ProgramPlanGenerator.generate
       -> sourceBound=false: SKIP ContextPort.resolve entirely
       -> goal+constraints only, no note/selection text
  -> provider stream -> validateCurriculum -> preview (NO WRITE)
  -> existing explicit approval -> ProgramMutationQueue -> VaultProgramStore CAS
  -> optional workspace writer (unchanged)

Source-bound intent
  -> select current note in onboarding -> persist sourcePath in draft
  -> display note path and "content will be included" disclosure
  -> checkRuntime
  -> ProgramPlanGenerator.generate
       -> ContextPort.resolve (only on source-bound path)
       -> assert selected file matches configured allowlist
       -> assert provider supports isolated source access
       -> include only selected note/selection text in bounded request
  -> provider stream -> validateCurriculum -> preview

Help me decide
  -> checkRuntime -> discoverGoals -> suggestions
  -> existing goal form (same logic thereafter)
```

**Cardinality / ordering:** one health probe before each explicit provider-backed onboarding action; one context resolution at most when `sourceBound=true`. Health is an early UX check, not provider-side authorization: the subsequent provider call can still fail after the check. Program proposals remain non-durable until approval.

### E — expected failure / interruption

- `unavailable/misconfigured` health or rejected check: inline error on discovery/form surface tells user to check Nox provider settings, then retry. The goal/interests/source draft remain in the existing view.
- Context no longer read at all for general plans. For explicit note path mismatch, fail before the request is sent; never silently substitute another vault file.
- Source-bound on a provider without filesystem-tool isolation: fail before inference and preserve draft.
- Async health check or provider response after Cancel: request epoch guard prevents transition into a stale view. Generation cancel uses original `LearningController.cancel()`.
- Invalid structured provider output, rejection/timeout and expiry: existing generator/orchestrator errors; no program or vault workspace is automatically persisted.

### R — capabilities / trust boundaries

- `AgentRuntimePort.check()` for early provider health and `send()` for real inference; no new provider health ownership.
- `ContextPort.resolve()` only within the source-bound branch of `ProgramPlanGenerator`.
- `OnboardingStateRepository` retains the only draft writer; `LearningProgramOrchestrator` retains preview, timeout, abort and CAS state.
- Obsidian UI stays an adapter in `src/chat/onboarding-flow.ts`; the source gate remains in `features/learning/program/ProgramPlanGenerator.ts`, not only as a button state.

## Security claim boundary

The M1 guarantee is **no implicit active-note or selection text in curriculum generation prompts** for general goals, and no context resolver invocation on that path. It is **not** a blanket claim that a CLI provider process has no filesystem access; only source-bound generation demands the existing `supportsSourceIsolation()` capability. Separate provider file-tool permission policies remain outside this M1 scope.

## Verification

- `tests/application/ProgramPlanGeneratorPrivacy.test.ts`: general goal skips resolver and hides private note sentinel from provider prompt; explicit source-only prompt still includes authorized note; note mismatch and missing source isolation reject before provider send.
- Existing `tests/application/LearningProgramOrchestrator.test.ts`: source-bound identity, invalid structured output, idempotent CAS and active program persistence.
- Entire existing CI: typecheck, typed lint, boundaries, unit/integration, dev orchestration, artifact checks and architecture graph.
- Native Obsidian desktop acceptance not executed; required before merge/release. Do not mark native acceptance as passed based on mocked ports.

## M2 / later (NOT implemented)

M2 will reshape the welcome into Note / Goal / Chat entries. M3 will provide an explicit first learning activity after successful plan approval. M4 will cover robust draft and partial-write recovery, and M5 will conduct native interaction/keyboard acceptance.
