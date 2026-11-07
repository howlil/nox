# Nox — repository rules

Scope: entire repository. Ship one correct, verified behavior slice at a time.
Route engineering work through the installed Agentflow skill and read only the
specialists needed for unresolved decisions. Preserve existing dirty work.

## Contracts and commands

- Product behavior: `.agents/PRODUCT_DESIGN.md`; architecture and state owners:
  `.agents/ENGINEERING_DESIGN.md`; visual rules: `DESIGN.md`.
- Use the current implemented contracts. Historical migration proposals do not
  override source, tests, package exports or the current ownership map.
- Node: `.node-version`; pnpm: `packageManager` in `package.json`.
- Install: `pnpm install --frozen-lockfile`; dev: `pnpm dev`.
- Local feedback: `pnpm typecheck`, `pnpm lint`, and focused behavioral tests.
- Before integration: `pnpm verify`, `pnpm ci:critical`, `git diff --check`.
  Verify includes boundary, CSS, docs/release, unit/integration, headless,
  core/host/browser, production build, artifact and compiled-plugin checks.
- Never edit generated `dist/` or deploy to a user's vault without a request.

## Canonical ownership

```text
packages/core/src/
  application/  use cases, effect ordering and narrow ports
  domain/       pure rules, validation and state transitions
  agent/        portable runtime and normalized structured parsing
  context/      portable context resolution and research policy
  session/      transcript schema, snapshots and serialized session writes
  features/     feature-private turn/program collaborators
  persistence/  portable codecs
src/
  agent/        provider processes, authentication and transport adapters
  context/      Obsidian note and policy collection
  persistence/  plugin data, vault program/evidence and workspace adapters
  mutation/     Obsidian editor replacement and native Undo boundary
  chat/, features/*/view/  rendering, interaction and transient UI state
  features/learning/onboarding/  host onboarding presentation workflow
  settings/, diagnostics/  host settings and runtime provenance
  host/obsidian/, main.ts  host composition and lifecycle
headless/src/, browser/src/  other host composition and effects
```

Hosts consume the curated `@nox/core` entrypoint. Unit tests may target core
internals directly. Legacy `src/` core facades are compatibility only: migrate
actual references before deleting them, preserve constructor identity, and
never recreate a retired facade. Run `pnpm check:boundaries` after import moves.

Core imports no Obsidian/Electron/Node/network/DOM authority. Domain owns
meaning, application owns sequencing, adapters own I/O, and views own rendering.
One rule and mutable state have one authoritative owner. Do not introduce a
second session, proposal, practice, evidence or program authority. Prefer owner
local types and existing ports over generic services, managers or event buses.
Do not create broad `ui`, `learning`, `common`, `helpers`, `utils` buckets.

## State and safety invariants

- `SessionController` serializes mutation, durable snapshot and publication;
  callers receive detached snapshots. One shared `PluginDataRepository` orders
  plugin read/modify/write across settings, sessions, onboarding and usage.
- Program mutations use `LearningProgramOrchestrator`'s queue; vault program
  and evidence adapters preserve validation, snapshots and CAS conflict checks.
- A normal question is not mastery evidence. Practice evidence and material
  review findings remain distinct; a correct answer is not automatic mastery.
- Practice questions/evaluations and Edit proposals are turn-local candidates
  until terminal `completed`. Failed/cancelled/timed-out/malformed/duplicate
  output never becomes actionable or advances durable practice state.
- Commit a Practice question before exposing it as answerable. Evaluation
  failure preserves the same question; the plugin owns lifecycle transitions.
- Selection precedes the current note. Explicit context is additional and
  read-only; policy/progress are not user-selected context. Research scope
  constrains provider-bound context, not external CLI filesystem permissions.
- Edit narrative and one proposal commit atomically through
  `SessionController.recordEditOutcome`. Repeated turn IDs replay persisted
  outcomes; pending proposals become stale on restart.
- Apply re-reads the authorized note and requires one exact match and one
  native editor transaction. Never silently rebase stale/ambiguous proposals.
- If Apply succeeds but status persistence fails, block abandoning recovery
  and expose Retry status sync only. It never repeats editor replacement;
  publish proposal state only after durable persistence. Preserve native Undo.
- Spawn configured providers on demand, pass user content through structured
  stdin, normalize output, bound execution and release processes on cancel,
  view close and unload. Keep raw protocol/provider events out of product UI.
- Keep secrets and note contents out of source, logs and commits. Credentials
  stay outside the vault. Preserve provider/network/privacy disclosures.

## Verification and delivery

Reproduce behavioral bugs before fixing them when practical. Use the cheapest
faithful proof: unit for rules/parsing, integration for real storage/process
semantics and failure recovery. Inspect the final diff and dependency path;
remove paths made obsolete by the change. Native Obsidian interaction and live
provider access are separate evidence from automated harnesses.

Continue the working branch by default; isolate risky changes when necessary.
Keep commits coherent and protect uncommitted work. Do not force-push, discard
data, publish or deploy without authorization. User-visible changes update the
relevant public docs; provider/network/privacy/file-access changes update the
README or `docs/PROVIDERS.md` in the same change.

`docs/RELEASING.md` owns publication. Ordinary feature merges do not release.
A verified `release/x.y.z` candidate must publish its immutable, source-bound
release before version metadata merges to `master`. The public tag is exactly
`x.y.z`, ID `nox`, with exactly nonempty `main.js`, `manifest.json`, `styles.css`.
Never bypass certification, attestations, live parity or native edit approval.

Required checks must always report for PRs, including landing-only changes.
Activate remote protection only after updated workflow checks are available.
Report implemented, verified, published, deployed and released separately.
