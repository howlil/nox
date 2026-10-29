# @nox/core — portable package

Status: **private, implemented portable package**, not published to npm.
The Obsidian plugin is separately published through
`manifest.json`, `main.js` and `styles.css`.

## Current ownership and consumption

- **Canonical source:** `packages/core/src/**` physically owns portable
  application, domain, session, runtime and context code. The curated public
  API is `packages/core/src/index.ts`; do not duplicate implementation in
  Obsidian, headless or browser.
- **Host integration:** Obsidian, headless and browser compositions consume
  the `@nox/core` entrypoint. Within the monorepo, the root TypeScript
  source alias resolves to that same canonical implementation. The hosts
  must not bundle a second compiled engine or import package-private sources.
- **Distribution:** the private package emits ESM, CJS and TypeScript
  declarations for isolated consumer verification; no public npm or
  production browser app publication is implied.
- **Compatibility:** M13 retired 38 obsolete `src/**` facades; 20 remain
  because identified tests or architecture contracts still reference them.
  The old re-exports are not a second source of truth or a public API.
  Retire additional facades only after migrating real consumers and
  preserving architecture guards.
- **Proof boundary:** package, host-identity, browser IndexedDB and compiled
  plugin-host tests run in CI. They do not certify a real installed Obsidian
  desktop session, OAuth entitlement or a live provider.

The later sections document successive build and migration decisions. Their
older milestones are preserved for provenance; superseded statements about
`src/` being canonical, CI pending, or a future extraction **are historical**.

## Build and verify


```sh
pnpm install --frozen-lockfile
pnpm core:build
pnpm core:verify
```

`core:verify` rebuilds from the canonical modules and stages **only**
`packages/core/package.json` and `packages/core/dist/` inside a temporary
outside-the-repository consumer. It then verifies ESM import, CommonJS
`require`, a real `SessionController` durable write, and strict TypeScript
consumer resolution with `skipLibCheck: false`. The package build checks
the esbuild input graph for concrete Obsidian/desktop adapters and rejects any
unresolved imports. CI runs the same gate before the Obsidian release build.

`@nox/core` exposes the application facades `LearningController`,
`LearningProgramOrchestrator`, `AgentRuntime`, `SessionController`,
`SessionStore` and `ContextResolver`; durable failure constructors;
`DEFAULT_LEARNING_STATE`; and documented TypeScript ports, event, session,
learning and program contracts. There are **no Obsidian UI/vault/editor,
Node filesystem, login, provider transports or internal capability exports**.

## A / E / R contract

```text
Canonical packages/core/src/
  → packages/core/src/index.ts (curated public API, no new business logic)
  → esbuild ESM + CJS, tsc declaration emit
  → staged external consumer (package.json + dist only)
  → import/require/types/session transaction smoke → CI accepted
  ├─ A: one learning implementation, two portable module formats, typed API
  ├─ E: host dependency/external import, missing declaration, broken runtime,
  │     inaccessible private type, or ABI failure causes a nonzero build
  └─ R: source modules, esbuild, TypeScript, ephemeral local consumer

Obsidian main.ts → Obsidian host adapter → canonical NOX source
Headless Node   → headless adapter      → canonical NOX source
```

### Guarantees and limitations

- **No double writer or mutable core singleton:** each consuming host creates
  its own `SessionController`, `AgentRuntime`, provider and host storage
  adapters. Package exports only constructors, pure state defaults and types.
- Session transaction ordering, evidence CAS, transcript-first learning outcome,
  onboarding approval and edit Undo remain the responsibility of the real
  NOX engine/adapters; package bundling creates no alternate workflow.
- The `0.1.0` package version is **independent preview API metadata**.
  `private: true` explicitly prevents accidental npm publication. It does
  not change NOX 1.3.2 or its public release manifest.
- Browser execution, a real second provider, package API semver stability,
  cross-device sync and native desktop compatibility is **not** established by
  this test. Avoid treating a successful Node consumer as browser certification.
- When the source tree becomes a full `packages/core` workspace, preserve the
  exact import/export contract and historical session/evidence decoders rather
  than performing a speculative rewrite.

## Next extraction criteria

Only migrate individual canonical implementation modules into the package's
own source directory when all imports and state guarantees are covered by
cross-host conformance. The initial facade is the first distribution boundary,
not an excuse to copy the engine or to publish an unstable API.

## M5 consumer migration and browser-target contract

Obsidian and headless host compositions now import `@nox/core` (as does the
plugin's application type facade). The monorepo root declares a `workspace:*`
dependency. The `tsconfig.json` paths entry explicitly resolves the package
to `packages/core/src/index.ts`, ensuring esbuild and TypeScript use the
exact canonical `src/` modules. Neither host bundles `dist/index.*`
alongside its source modules.

Run `pnpm core:hosts` to verify both host dependency graphs:
one facade, one set of runtime/session/domain constructors, zero compiled
package copies, zero unresolved `@nox/core` specifiers. Identity regression
tests also assert that importing through the public API and the legacy
source location returns the very same classes (including persistence errors).

`pnpm core:verify` additionally builds an *isolated external consumer*
for `platform: browser`. It rejects runtime externals and executes a real
session transaction from the staged browser bundle in a JavaScript VM
without Node globals. This **does not** certify actual browsers, source
permissions, browser storage, or provider/auth integration. A full web
host requires a separate capability contract and real browser E2E tests.

M6 adds a real Chromium IndexedDB host proof; see [Browser proof](BROWSER_PROOF.md). The browser host imports only the public `@nox/core` facade, not Obsidian runtime adapters. This does not publish or certify a production web application.

## Reliability correction — mixed-module runtime identity

The ESM entrypoint is now a native ESM facade importing the **one CJS engine
bundle**, rather than a second independent bundle. Mixed Node
`import("@nox/core")` and `require("@nox/core")` share the exact same
constructor and error objects. The isolated consumer test asserts identity
and `instanceof` for both persistence-conflict errors.

## M10.4 — Independent source acceptance

The package's `tsconfig.build.json` is standalone, not derived from the Obsidian root config. It emits `dist/types/index.d.ts` and a package-local declaration graph, and `package.json` points to that entrypoint. No declaration import rewrite is required.

`pnpm core:verify` runs `scripts/check-core-source.mjs` with only a copy of `packages/core/src/**`, its manifest, and its own `tsconfig.build.json` in an isolated temporary directory. The staged sources undergo a real TypeScript declarations build and esbuild runtime build graph check (no `src/` root, no parent `tsconfig.json`, no runtime externals) plus an independent runtime smoke. The original output-only ESM/CJS/types consumer and host identity checks continue to run.

The package remains private. Compatibility shims are retained until an actual consumer/reference inventory proves individual shims safe to remove; all production imports already bypass them, and source-only acceptance does not need them.

## Post-M10 review: compatibility and host-specific presentation

The canonical engine assembles host-neutral instructions. Obsidian-specific `[[note path]]` citation formatting and narrow-pane guidance are supplied as trusted host-owned `LearningPolicy.hostInstructions` by the Obsidian `PolicyLoader`. User-controlled `AGENTS.md` content remains contextual material, not authorization for source access or learning scope changes. Browser and headless hosts do not inherit these Obsidian conventions.

Legacy `src/**` compatibility shims are **in-repository migration conveniences**, not publicly supported import paths. The shim inventory checks repository static importers and portable contract tests only; it cannot prove compatibility for unregistered external deep imports. External clients should import the curated `@nox/core` API, not monorepo paths. Public publication and semantic-version support are separate decisions.

## Build from a separate @nox/core checkout

After installing the package's own development dependencies, run `pnpm build` from the package root. In this workspace the equivalent is `pnpm -C packages/core build`. The package owns `scripts/build.mjs`, its TypeScript configuration and its declared build toolchain. The root `scripts/build-core.mjs` is only a compatibility launcher. A frozen-lockfile CI run verifies the independent package importer and its dependencies.

**Scope of independence:** the core source and its own build can run outside the repository; the current Obsidian UI and some adapters still import package-internal source via monorepo paths. Those host-facing interfaces require an intentionally designed public/first-party contracts surface before distributing the hosts as independent repositories. Do not expose the entire internal package just to remove these imports.

The package-local `pnpm verify` runs its own build and checks ESM/CJS constructor identity and emitted declarations. The repository's `pnpm core:verify` invokes that package-owned verification first and then runs isolated package/source consumers. Both entrypoints are available without a second runtime implementation.

## M11.1 — Context adapter public API boundary

`ObsidianContext` and `PolicyLoader` consume the curated `@nox/core`
entrypoint. `LearningPolicy` and `ResearchScope` remain portable types.
`LocalResearchIndex` and `ResearchResult` form the narrow, explicitly
exported host-owned research indexing interface, sharing constructor identity
with the canonical source. The index is derived: the host still owns note
enumeration, authorization allowlists, editor freshness, vault events and
lifecycle.

The source-only build and isolated ESM/CJS/TypeScript consumers prove the
new API, and architecture CI prevents private package imports in these
two migrated adapters. Other Obsidian adapters/presenters still require
a future contract audit; `@nox/core` remains private and this does not yet
certify independent Obsidian-host packaging or semver stability.

## M11.2 — Provider and Obsidian persistence contracts

Provider adapters (`ChatGptAdapter`, `CodexAdapter`, `AgyAdapter`),
vault learning/program stores, plugin-data writer, onboarding repository,
and the Obsidian learning lifecycle consume `@nox/core`'s curated package
entrypoint, not `packages/core/src/**`.

The only additional public contracts are `AgentRuntimeConfig`,
`OnboardingDraft` (both type-only) and `validateProgram`, the canonical
portable validation function used by durable program stores. Existing
`AgentAdapter`, `SessionDataPort`, `LearningState`, `ProgramCollection`,
decoders and persistence error constructors are reused. No new state owner,
concrete provider implementation or Obsidian dependency enters core.

Architecture CI guards these migrated host adapters against source/deep
package imports. Outside-monorepo ESM, CJS and strict TypeScript consumers
exercise the new validation/types; identity and existing CAS regression
checks preserve one implementation and durable ordering.

**Not certified:** unconverted Obsidian UI presenters and ancillary adapters
still import private core source. This incremental slice does not guarantee
standalone distribution of the Obsidian host, npm publication, or a stable
public-semver API. Those require further host import cleanup and acceptance.

## M11.3 — Presenter contract boundary

The Obsidian view and presentation-only modules consume the `@nox/core`
entrypoint rather than private `packages/core/src/**` implementations.
The curated additions are **type-only read models**:
`NoxProgramOverview`, `LearningActionKind`, `ChatReplyReference`,
`PracticeAnswer`, `PracticeQuestion`, `PracticeEvaluation`,
`ReviewFinding`, `ActivitySummary`, and `CurriculumOperation`.
The existing `LearningEvent`, `LearningRequest`, `LearningContext`,
`ChatMessage`, and `LearningController` are reused.

The one new runtime helper is `isLocallyExecutableCommand`, a pure core-owned
business command predicate previously re-exported by `src/chat/chat-state.ts`
from a package-private file. Its implementation is not copied or moved
into the UI. The Obsidian view, presenters, and pure projection helpers
still own DOM updates, navigation, accessibility, timers and UI state;
the core owns learning command parsing, policy, models and persistence.

M11.3 architecture tests forbid source and compiled deep imports in the
migrated presentation modules, and the isolated consumer verifies TypeScript
contract availability and ESM/CJS runtime function identity and behavior.
Not all UI helpers/host adapters are converted yet; no independent
Obsidian package release or public npm guarantee follows from this milestone.

## M11.4 — Final production host boundary and isolated Obsidian compile

The **complete production host graph** (`src/**`, `browser/src/**`,
`headless/src/**`) is now subject to a default-deny AST import rule:
host-owned modules cannot import `packages/core/src/**`, `dist/**`, or
`@nox/core/*` private subpaths. Only deliberate `src/**` compatibility
facades with physically equivalent package-owned files are exempt; these are
tracked by the independently verified legacy-shim usage inventory.

The curated public package contract now includes the pure code-edit planner,
workspace manifest/lesson planner, onboarding feasibility projection,
practice answer validator, usage accounting/decoder, associated host data
types, and the authoritative onboarding approval receipt error. Provider
and Obsidian adapters keep external I/O and mutation lifecycle ownership.
The public API is still an internal **private preview**, not a declaration
of a frozen semver surface.

`pnpm core:verify` stages an **isolated Obsidian host source checkout** and
a copy of the already-built `@nox/core` package artifact into a temporary
directory, with no package source or root TypeScript paths alias. esbuild
bundles `src/main.ts` using only that staged dist entrypoint; the graph
asserts that the ESM/CJS engine is loaded from the staged artifact and that
no monorepo core source or compiled developer copy appears. External Obsidian,
Electron, and third-party host dependencies remain runtime externals.

This establishes **bundle-time source independence** of the Obsidian host
entrypoint, on top of existing outside-repository runtime/type contracts,
canonical source identity and real Chromium/IndexedDB conformance. It does
**not** establish Obsidian runtime E2E with an installed vault, all platform
packaging, release to npm, or compatibility for third-party deep imports.
Retain compatibility shims while reference contracts require them.

## M12.1 — Compiled Obsidian plugin lifecycle smoke test

`pnpm test:plugin-runtime` loads the real production `dist/main.js` from
a temporary plugin-install layout (with manifest and CSS) into a controlled
CommonJS host VM. It supplies an intentionally **limited mock** of the
Obsidian and Electron APIs rather than importing the TypeScript composition
root. The executable gate verifies plugin construction, `onload` view and
command registration, lifecycle subscriptions and timers, real
`PluginDataRepository`/core session writes, switching to a new session,
`onunload`, and session restoration after creating and loading a second
plugin instance. The loader rejects runtime external `@nox/core` requires
and rejects unexpected network calls during startup and reload.

It runs in CI **after the production artifact build and verification**.
The check does **not** claim Obsidian desktop API parity, GUI behavior,
provider connectivity, operating-system installation, screen reader behavior,
or a successful native-vault integration. A separate native desktop
acceptance gate is not required. `@nox/core` remains private;
no npm publication or plugin release is implied.

## M13.1 — Incremental legacy shim elimination

The first seven obsolete `src/` re-export facades (learner-model activity,
feedback and profile; activity aggregation; workspace planning; mutation
replacement; application research scope) were removed after dependent test
imports were retargeted to `packages/core/src/`. The canonical engine was
**not copied or rewritten**. The architecture checker now fails if any of
those retired facades reappear, or a consumer still references a removed shim.

**Current inventory after M13 waves 1–7:** 38 retired facades are protected
against reintroduction; 20 reference-backed facades remain for separate,
bounded consumer migrations. This later state supersedes the first-wave
51-remaining count. Do not describe facade elimination as fully completed.
Public API stability and native Obsidian acceptance remain independent
requirements.
