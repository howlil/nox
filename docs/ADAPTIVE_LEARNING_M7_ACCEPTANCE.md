# NOX Adaptive Learning — M7 acceptance and release gate

**Status:** Automated hardening implemented on draft PR #110. Live desktop/provider behavior: **not certified by automated tests**. This document does not authorize a merge or release.

## Scope and source of authority

M0 objective focus → M1 committed evidence → M2 curriculum revisions → M3 derived learner model → M4 deterministic activity policy → M5 bounded context → M6 read-only adaptive UI.

The canonical data is in the vault: `00-learning-os/programs.json`, `00-learning-os/progress.json`, and the local conversation transcript. A derived profile, model response, browser UI, transcript projection, or provider-hidden context is **never** an independent authority.

## Program<A,E,R>

- **A (allowed):** Commit a validated provider evaluation to the transcript exactly once, then project evidence with optimistic CAS against the latest authoritative vault bytes. A competing external edit causes retry/reload, never last-write-wins. Every program focus/session/creation update also uses atomic CAS; on restart reconstruct state from persisted program/evidence/transcript.
- **E (failure):** Offline/no provider, cancelled stream, invalid output, partial evaluation, stale focus or rubric revision, malformed vault JSON, concurrent vault writes, injected disk failures, truncated source text and oversized context each preserve original durable data and reject unsupported actions.
- **R (recovery):** Transactionally retain the committed transcript; repeat a bounded evidence projection after a conflicting write. A failed projection must not trigger model re-grading. Failed CAS attempts do not corrupt `progress.json` or `programs.json`. On legacy evidence migration, verify a uniquely named non-destructive backup before replacing the canonical file.

## Automated acceptance matrix

| Boundary | Invariant | Automated evidence |
|---|---|---|
| Program CAS | Two concurrent program edits cannot silently overwrite a focus/session or scope | `tests/persistence/VaultProgramStore.test.ts` |
| Evidence CAS | A stale writer is rejected; reloading merges its event without erasing the other writer | `tests/persistence/VaultLearningStore.test.ts` |
| Data migration | v2→v3 progress upgrade leaves a byte-exact backup, including retriable failures | `tests/persistence/VaultLearningStore.test.ts` |
| Vault failure | Injected `Vault.process` failure retains prior bytes and later retries succeed | Both Vault store test suites |
| Canonical transcript | CAS contention doesn't make the provider grade twice or duplicate practice evidence | `tests/application/LearningController.test.ts` |
| Focus authority | Wrong chat, stale objective revision and active lock cannot change activity | `tests/domain/learning-program/focus-transitions.test.ts`, `tests/application/AdaptiveActivityIntegration.test.ts` |
| Curriculum | Preview-only proposal, dependency-DAG validity, evidence provenance, version conflicts | `tests/application/CurriculumRevisionService.test.ts`, domain curriculum tests |
| Learner state | Unknown/assisted/MCQ evidence cannot fabricate independent mastery; failed recall reopens | learner-model domain tests |
| Context privacy | Only authorized fresh note excerpts; stale revisions and ambient private notes excluded | `tests/application/LearningContextOrchestrator.test.ts` and controller integration |
| UI authority | Compact focus/criterion view read-only, expired approval hidden, all actions pass application boundary | `tests/chat/learning-panel-state.test.ts`, overview tests |
| Packaging | Production plugin manifest, CSS and JS assets verified; no hotreload or obsolete root bundle | `pnpm test:artifacts`, `pnpm release:check` |
| Plugin CI | No landing/Cloudflare job in NOX plugin CI | `.github/workflows/ci.yml` |

Run using `pnpm check:boundaries && pnpm typecheck && pnpm lint && pnpm lint:typed && pnpm test:unit && pnpm test:integration && pnpm build && pnpm test:artifacts`.

The automated matrix becomes **verified** only when the exact M7 head commit finishes every required CI check successfully. A previously green CI run on a parent commit is not sufficient.

## Desktop/provider acceptance — external gate, not performed in this implementation

The release owner must test the **exact GitHub draft assets**, not a locally rebuilt binary. Record OS, Obsidian version, provider, manifest version, artifact digest / source SHA, expected and observed behavior, and logs for each scenario.

1. Install the three release assets (`main.js`, `manifest.json`, `styles.css`) in a disposable test vault; confirm plugin loads/reloads and reports its current runtime build identity.
2. Onboard a program from approved notes, exercise M0 start/pause/resume/end focus and wrong-chat/wrong-objective preflight. Confirm no unexpected timer lock.
3. Generate and answer practice; use hints and MCQ, test independent revision-specific criterion evidence, delayed recall, failed recall and transfer activity selection.
4. Verify the M2 proposal is **not saved** before explicit approval; reject, expire, reopen, and approve revised previews. Check backup and revision lineage.
5. Load a long history with several thousand learner evidence entries. Confirm M3/M5 context remains bounded, source-scoped and responsive; no off-scope note is forwarded to a provider.
6. Fault-inject provider disconnection, aborted stream, Obsidian restart, existing incomplete answer, and external vault file change. Confirm pending transcript-driven recovery without double grading or lost evidence.
7. Test plugin disabled/enabled, vault switch, file rename, sidebar narrow width, keyboard-only controls, reduced motion and settings persistence. Confirm no warnings requiring additional Obsidian Community policy mitigation.
8. Validate platform-specific ChatGPT/Gemini sign-in, callback, token handling, and inference transport for all supported providers; verify no token or note contents appear in diagnostic logs.

**Do not mark desktop acceptance passed based on mocks, CI, or this document.**

## Community and publication requirements

Obsidian downloads `main.js`, `manifest.json`, and optionally `styles.css` from a GitHub release tagged identically to `manifest.json.version`. The repository's default-branch manifest and version compatibility mapping must be accurate. The plugin is desktop-only because its runtime requires Node/Electron. Official requirements:
- https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin
- https://docs.obsidian.md/community-directory/submission-requirements-for-plugins

Release automation must require exact source SHA, provider and policy certification and verified artifact attestations. This M7 work does not dispatch or publish a release. Cloudflare owns landing CI/CD separately.

## Remaining risk register

- **P0 gate:** release/provider certification and exact artifact verification.
- **P0 gate:** release owner approves source privacy checks, fault-injection records and scanner diagnostics on the final merged SHA; code CI alone is not sufficient.
- **P1 follow-up:** GitHub issue #82 — triage remaining Obsidian typed-lint/CSS warnings with a pinned scanner report. Current advisory scanner success is not zero warnings.
- **P1 follow-up:** GitHub issue #81 — declarative Obsidian 1.13 settings migration. Do not conflate roadmap issue with a proven production crash without evidence.
- **Merge coordination:** upstream M0–M6 and M7 are stacked draft PRs targeting master for CI. Review the cumulative diff, check upstream heads have not drifted, and do not merge partial stages out of order.
