# @nox/core — portable package (M4)

Status: **private preview**, not a published npm package. The Obsidian plugin
remains a separately built release (`manifest.json`, `main.js`, `styles.css`).

## Ownership and scope

`packages/core/src/index.ts` is an intentionally small API facade over the
canonical NOX `src/` application, domain and session modules. It **contains no
duplicate learning engine**. Build emits ESM, CommonJS and a self-contained
declaration tree under `packages/core/dist/`. Neither the Obsidian host nor
the headless host imports its own built distribution bundle inside the plugin:
that would risk two copies of stateful constructors. They continue using the
same canonical source graph, while M4 proves an independent external consumer
can load the packaged form. Adopting the package as a host's sole runtime
dependency is a separate planned migration with explicit compatibility tests.

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
