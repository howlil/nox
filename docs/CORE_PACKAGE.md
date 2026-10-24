# @nox/core — portable package (M4)

Status: **private preview**, not a published npm package. The Obsidian plugin
remains a separately built release (`manifest.json`, `main.js`, `styles.css`).

## Ownership and scope

`packages/core/src/index.ts` is an intentionally small API facade over the
canonical NOX `src/` application, domain and session modules. It **contains no
duplicate learning engine**. Build emits ESM, CommonJS and a self-contained
declaration tree under `packages/core/dist/`. The M5 Obsidian and headless compositions now import the **public**
`@nox/core` API. During monorepo compilation, `tsconfig.json` resolves this
specifier to `packages/core/src/index.ts`, which re-exports the exact canonical
`src/` implementations. Both hosts bundle the SAME module graph rather than
importing the compiled package distribution alongside source modules. This
explicit source-alias policy is temporary until implementation files physically
move into `packages/core`. A real standalone consumer resolves the built
exports, never the monorepo alias. Runtime identity and duplicate-module checks
are mandatory gates.

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
Canonical NOX src/
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
  cross-device sync and native desktop acceptance are **not** established by
  this test. Avoid treating a successful Node consumer as browser certification.
- When the source tree becomes a full `packages/core` workspace, preserve the
  exact import/export contract and historical session/evidence decoders rather
  than performing a speculative rewrite.

## Next extraction criteria

Only migrate individual canonical implementation modules into the package's
own source directory when all imports and state guarantees are covered by
cross-host conformance. The initial facade is the first distribution boundary,
not an excuse to copy the engine or to publish an unstable API.
