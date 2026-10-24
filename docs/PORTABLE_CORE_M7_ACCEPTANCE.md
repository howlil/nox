# NOX Portable Core — M7 Final Acceptance

**Decision:** AUTOMATED ACCEPTANCE and NATIVE DESKTOP ACCEPTANCE are
separate gates. As of the introduction of this document, **native Obsidian
desktop D01–D10 is NOT RUN; PR #134 is NOT merge-ready and remains draft.**
A green CI run does not create human acceptance evidence or authorize publication.

## A / E / R — completion graph

```text
M0 AST portable ownership fence ─┐
M1 storage/runtime ports ─────────┤
M2 Node headless Ask/Practice ────┤
M3 Obsidian host composition ─────┤
M4 private @nox/core bundle ──────┼→ M7 automated gate (CI source SHA)
M5 one-core per host identity ────┤        ├─ broken contract → FAIL
M6 real Chromium IDB E2E ────────┘        └─ success → AUTOMATED PASS
                                               ↓
                                   Native Obsidian desktop D01–D10
                                     ├─ no source-bound evidence → NOT RUN
                                     ├─ invalid/stale evidence → FAIL
                                     └─ real verified evidence → PASS
                                               ↓
                                      Merge readiness review
                                      (never automatic release)
```

### A — Successful acceptance

Every relevant source-bound automatic gate passes on the *same PR head*:
pnpm frozen install, architecture and portable boundaries, typecheck, lint,
unit/integration tests, package build and outside-consumer ESM/CJS/types proof,
headless recovery, one-runtime-per-host graph, real Chrome IndexedDB
restart/abort/corrupt/CAS proof, Obsidian build, and artifact checks.

Then, on a **disposable Obsidian desktop test vault**, a human tester installs
the exact candidate build and executes D01–D10 in
`docs/ARCHITECTURE_DESKTOP_ACCEPTANCE.md`. Record the source commit,
manifest version, Obsidian version, operating system, sanitized logs,
actual observation, evidence links and artifacts. Native screenshot/video
evidence must not be synthesized from mock tests.

### E — Defects, failures and stale proof

- Missing or failing CI gate blocks automated acceptance.
- Successful tests with absent desktop proof yield `automated=PASS`,
  `native=NOT RUN`, `mergeReady=false`: **this is not a failure of CI**,
  but a real merge blocker.
- Invalid/stale desktop evidence fails closed. The publication validator
  compares the tested ancestor with all runtime-critical sources, including
  `packages/core`, `browser`, `headless`, `public`, plugin code,
  scripts, tests, pnpm manifests, compiler/build configs and CI workflows.
  A runtime-affecting commit after the desktop run requires retesting.
- Failed provider turns never credit evidence before terminal transcript
  commitment; stale program/evidence writes reject rather than overwrite;
  unsupported browser edit capability never mutates a vault.
- Neither a draft PR nor a green CI is a substitute for platform-native
  auth/transport, file rename, history restore, native editor Undo and
  runtime provenance inspection.

### R — Authorities and verification

- Source: `@nox/core` canonical facade and the existing production engine.
- Persistence: Obsidian PluginDataRepository/Vault CAS, Node FileWorkspace,
  browser IndexedDB readwrite transaction and snapshot CAS.
- Release owner: validates `docs/desktop-acceptance.json` under existing
  `scripts/verify-desktop-acceptance.mjs`, with actual inspectable evidence.
- Automated M7 preflight: `pnpm acceptance:portable`. This checks essential
  CI/release publication guards, package privacy, canonical alias, exports,
  and real native-evidence presence. It does **not** mark missing evidence PASS.
- CI on PR source: `pnpm verify` plus source-bound GitHub Actions. The M7
  preflight is independently invoked in the CI workflow before build.

## Handoff: native desktop D01–D10

See `docs/ARCHITECTURE_DESKTOP_ACCEPTANCE.md` for exact scenarios.
Use a disposable vault and sanitize any sensitive data. Most important
functional groups are legacy transcript recovery, stale UI render,
turn cancellation, terminal Practice evaluation / evidence replay,
editor Apply+Undo and rejected stale edits, focus timing on restart,
source isolation, and provider switch retaining conversation state.

**No pass is recorded in this implementation.** Do not invent
`docs/desktop-acceptance.json` or declare a release ready without actually
performing the native tests and validating source-bound evidence.

## Merge and release decision

- M7 automated acceptance is merge-ready **only after** the native gate is
  genuinely PASS and the exact head CI is green. Inspect all diffs and
  required reviews; then optionally mark the draft PR ready and merge.
- Merging `master` may invoke the repository's existing automated release
  preparation workflow. It does not itself authorize an immediate public
  version. Do not request a release bump, publish `@nox/core`, create a
  public tag or bypass the desktop publication guard.
- Even after merge, explicit staged release approval/attestation must
  remain source-bound. M7 itself creates no release and changes no manifest.

## Scope limits

Node/headless and Chromium are proofs using scripted provider events, not
new full user products. Other browsers, actual browser OAuth, migration/sync,
cloud multi-tenancy and independent native edit Undo are not certified.
