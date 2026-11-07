# Nox — Engineering Design

Status: current implemented system contract. Source, package exports and tests
are authoritative; Git history preserves superseded migration proposals.
Product: [PRODUCT_DESIGN.md](PRODUCT_DESIGN.md). UI: [DESIGN.md](../DESIGN.md).
Distribution: [core package](../docs/CORE_PACKAGE.md) and
[release operations](../docs/RELEASING.md).

## System and structure

```text
Obsidian chat/settings → @nox/core application → domain rules
                                      ↓ narrow ports
Obsidian host adapters ← persistence/context/editor/provider effects
Headless and browser hosts → the same curated @nox/core entrypoint
```

`packages/core/src/**` physically owns the portable implementation. Its public
entrypoint is `index.ts`; ESM/CJS/types distribution preserves one constructor
identity. Hosts use the public entrypoint and workspace source alias, never
package-private deep imports or a second compiled engine. Unit tests may import
an internal module to test its owned rule.

| Owner | Responsibility |
| --- | --- |
| core `application/` | Turn/controller/program orchestration and structural ports |
| core `domain/` | Pure learning, practice, review, program, mutation and usage rules |
| core `agent/`, `context/` | Portable runtime/parser and context/research policy |
| core `session/`, `persistence/` | Transcript/snapshot authority and portable codecs |
| core `features/` | Feature-private conversation-turn/program collaborators |
| `src/agent/`, `src/context/` | Provider processes/auth/transports; Obsidian context/policy |
| `src/persistence/`, `src/mutation/` | Plugin/vault I/O and native editor replacement |
| `src/chat/`, `src/features/*/view/` | Rendering, composer and transient interaction state |
| `src/features/learning/onboarding/` | Host onboarding presentation workflow |
| `src/settings/`, `src/diagnostics/` | Host settings and runtime provenance |
| `src/host/obsidian/`, `src/main.ts` | Construction, registrations and teardown |
| `headless/src/`, `browser/src/` | Other host-specific storage and composition |

Core imports no host, Node-only, DOM or network authority. Domain owns meaning;
application owns sequencing; ports expose effects; adapters implement I/O.
Views never write persistence directly. Shared core transport/session types
remain compatibility contracts; new feature types stay with their owner.

## State ownership

| State | Authority and write rule |
| --- | --- |
| Sessions, transcript, proposals | `SessionController` queues mutation + durable snapshot; publishes after persistence |
| Plugin data | One shared `PluginDataRepository` orders read/modify/write across all consumers |
| Practice lifecycle | Core practice state machine/registry; transcript restores committed questions |
| Learning evidence and gaps | Domain transitions; vault learning adapter validates snapshots/CAS |
| Program, focus, session time, revisions | `LearningProgramOrchestrator` and its mutation queue; vault program CAS |
| Model catalog/provider cursor | Runtime/session boundary; settings coordinate replacement when safe |
| Composer, rendered cards, optimistic status | Host view state, derived from canonical results |

Callers get detached session snapshots. Persistence never invents domain
meaning. Usage is telemetry, not learning evidence. Settings/provider changes
must not abandon active turns, edits or unsynced Apply recovery.

## Critical flows and invariants

**Turn:** intent → context/policy → runtime → normalized stream → turn-local
structured candidates → terminal validation → durable outcome → product event.
Parser success alone never authorizes a durable or actionable outcome. Failure,
cancellation, timeout, malformed/multiple output and duplicate questions discard
candidates. Structured parsing handles arbitrary split boundaries and schemas.

**Practice:** committed question → waiting-answer → evaluating → committed
feedback and next question/completion. Failure preserves the same active question.
Commit the question before exposing it as answerable. Hints/drafts and completed
outcomes belong to the session; the model supplies content, not lifecycle authority.
Only meaningful learner evidence changes gaps; normal chat is not evidence and
material-review findings never silently become learner weakness or mastery.

**Programs:** explicit onboarding approval → validated curriculum → serialized
workspace/program commit → focus/session transitions → durable evidence and time
checkpoints. Preserve draft/receipt recovery, source restrictions, explicit
revision approval/revert and legacy schema decoding. Scope is persisted state,
not prompt-only policy; switching incompatible context resets the provider cursor.

**Edit:** completed valid single proposal → atomic narrative/proposal commit via
`recordEditOutcome` → user review → re-read authorized target → unique exact match
→ one editor transaction → durable applied status. A repeated logical turn replays
canonical persisted state; terminal outcomes do not reopen. Pending proposals are
stale after restart. Supporting notes are read-only; no silent stale/ambiguous rebase.

If native Apply succeeds but status persistence fails, retain a turn-local recovery
receipt, block abandoning it and offer Retry status sync only. Sync writes status,
never edits again. Publish proposal state after persistence; preserve native Undo.

**Context/privacy:** selection precedes the current note; explicit notes add context.
System policy/progress are separate. Research selected/folder scope constrains the
final provider-bound context including history. It is not a filesystem sandbox;
external CLIs can have broader access. Strict source isolation requires an adapter
capability that actually guarantees it. Credentials live outside the vault.

**Runtime/lifetime:** configured adapters spawn on demand; prompt/context use
structured stdin rather than shell interpolation. Normalize protocol output before
product consumption; bound buffers/timeouts, sanitize failures and clean up owned
processes on cancel, view close and unload. Model discovery never starts inference
and availability is not entitlement. Host lifecycle drains owned pending writes;
background failures remain observable without rewriting successful turn outcomes.

## Contracts and compatibility

Durable transcript/program/evidence decoders validate unknown input and preserve
legacy data for recovery. Repositories stage snapshots, serialize mutation and
check conflicts at the storage boundary; never overwrite an unverified snapshot.
One shared plugin writer does not replace session-level snapshot serialization.

36 retired `src/**` core facades are blocked from reintroduction; 22 remain because
actual tests/architecture consumers reference them. Migrate references and enforce
identity before deleting another facade. Four transcript contract manifest entries
now point directly to their canonical core source. Do not create parallel engines,
state stores, broad helpers or new layers without an actual boundary requirement.

## Fitness and debt

- `check-boundaries.mjs` checks owners, dependency direction, portable contracts,
  unknown/unresolved imports, physical core ownership and facade references.
- Facade validation accepts LF/CRLF while rejecting extra code or a wrong target.
- `core:verify` proves isolated ESM/CJS/types consumers and source ownership;
  `core:hosts` proves public entrypoint consumption and single runtime identity.
- Root and package TypeScript use strict mode. `.node-version` and `packageManager`
  pin the plugin toolchain; the lockfile owns dependency resolution.
- Remaining facade migration and large view/turn orchestrators are bounded debt.
  Extract responsibilities only when a changed flow exposes concrete risk.

## Verification

- `iter`: focused rule/parser/newline regression, `pnpm typecheck`, `pnpm lint`.
- `pr`/`merge`: `pnpm verify`, `pnpm ci:critical`, `git diff --check`.
- `verify` includes architecture, CSS, docs/release, unit/integration, headless,
  core consumers/hosts, real Chromium/IndexedDB, production artifacts/plugin smoke.
- Storage/process risks use real-boundary integration, including failed writes,
  replay, cancellation, conflict, restart, stale/ambiguous edits and status sync.
- Native Obsidian Undo/selection/lifecycle and live-provider entitlement need
  separate evidence. Automated harnesses do not certify those interactions.

## Release

`docs/RELEASING.md` owns immutable SemVer plugin publication; `@nox/core` remains
private. Cloudflare landing deployment is separate. Ordinary merges never publish.
Require PR checks `build`, `pr-title`, `public-release-parity`, `release-certified`
after their updated workflows are available. Every PR gets an explicit outcome;
release-sensitive diffs require Linux, Windows and Community certification.
Publish from certified `release/x.y.z` with source-bound attestations and exact
three-asset allowlist before merging version metadata. Re-run parity on the same
candidate after publication; a changed source requires new certification. Never
edit public tags/assets. Recovery follows the existing verified-draft workflow.
