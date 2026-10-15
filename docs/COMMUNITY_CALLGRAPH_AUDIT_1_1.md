# NOX Obsidian Community audit — actual call graphs and design decisions

**Baseline:** `master` at `9457d0a` (release `1.1.0`). This audit maps implementation source to external trust boundaries and Obsidian Community requirements; it does **not** infer correctness from all-green CI.

## Sources and scope

- Review reports dated 2026-10-15 (CSS lint, source lint, behavior warnings).
- `src/main.ts`, agent adapters, domain and application services, vault and session persistence, CSS source and production build pipeline.
- Official guidance: [Developer policies](https://docs.obsidian.md/community-directory/developer-policies), [Plugin submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins), [Plugin checklist](https://docs.obsidian.md/oo/plugin), [stylelint config](https://github.com/obsidianmd/stylelint-config), and [ESLint scanner configuration](https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md).

The **call-graph-output** below serializes verified relationships. `→` denotes direct dependency or call; `⇢` async calls; `↺` retry; `∥` independent paths.

## Production — runtime and note effects

```text
NoxPlugin.onload()
├─⇢ PluginDataRepository.read()
├─→ createAdapter(settings)
│  ├─→ AgyAdapter (local CLI)
│  ├─→ CodexAdapter (local CLI)
│  └─→ ChatGptAdapter (OAuth + remote inference)
├─→ AgentRuntime
├─⇢ SessionController.init()
├─→ ContextResolver(ObsidianContext)
├─→ LearningProgramOrchestrator
└─→ LearningController
   └─→ ChatView (registerView)

ChatView ⇢ LearningController.run()
  └─⇢ RunLearningTurn.run()
     ├─⇢ ContextResolver.resolve() ∥ PolicyLoader.load() ∥ VaultLearningStore.load()
     ├─⇢ ObsidianContext.searchKnowledge() [research action; bounded]
     ├─→ ContextBudget
     ├─⇢ AgentRuntime.send()
     │  ├─⇢ AgyAdapter.send() → spawn(argv) → AgyProtocol
     │  ├─⇢ CodexAdapter.send() → spawn(argv) → CodexProtocol
     │  └─⇢ ChatGptAdapter.send() → NodeInferenceTransport (HTTPS/SSE)
     ├─→ StructuredStreamParser
     └─⇢ durable transcript / evidence writes

ChatView.Apply ⇢ LearningController.applyProposal()
  ├─→ scope + pending-proposal checks
  ├─⇢ MutationService.apply()
  │  ├─→ exact MarkdownView/editor selection
  │  ├─→ planReplacement()
  │  └─→ editor.replaceRange() [undo-capable]
  └─⇢ SessionController.updateProposalState()
     └─→ PluginDataRepository.update()
     └─↺ retryAppliedStatus() [status only, never re-apply edit]

ChatGptAuth.signIn()
  ├─⇢ ObsidianOAuthTransport(requestUrl)
  ├─→ browser + localhost OAuth callback
  ├─→ verifyChatGptIdToken()
  └─→ OS-specific credentials file [outside vault, documented]
```

## Audit findings by boundary

| Finding | Risk | Evidence / decision | Proof |
| --- | --- | --- | --- |
| Literal `\\n` in `landing/.../dialog.module.css` | P0 | Real CSS parsing defect introduced by escaped newline at file end; fixed with real newline | source check + regression |
| `scripts/verify-artifacts.mjs` regexp `\\\\b` / `\\\\s` | P0 | Guard for Tailwind at-rules could not match the intended source syntax; replaced with tested policy | invalid samples rejected |
| `styles.css` fallback system-font names | P1 | Prefer `var(--font-interface, sans-serif)` and `var(--font-monospace, monospace)` | stylesheet parser + existing UI tests |
| `@source/@theme` in CSS inputs | Advisory | Required Tailwind build DSL, not distributable CSS; gate the compiled output instead | `assertCompiledPluginCss(dist/styles.css)` |
| `!important` in theme resets and Mermaid/SVG | Advisory/design debt | Reduce only alongside visual verification across themes and narrow sidebars; do not break active controls by global deletion | future visual tests |
| `display: contents`, `column-gap`, `text-decoration-color` | Compatibility | Each has fallback/structural implications; initial scan targeted 1.11.4 while manifest requires 1.13.0 | test against declared min version |
| `clip-path` in Astro components | Advisory | Landing-only motion; keep reduced-motion/fallback path | landing build and browser tests |
| `no-unsafe-*` scanner output | Scanner-dependent | Current official community configuration disables these rules; production still requires typed boundaries, JSON validation and TS checks | TypeScript + decoder tests |
| `fs`, DPAPI PowerShell, `spawn` | Privileged intentional | Desktop only, explicit CLI argv, credential storage outside synced vault | Windows DPAPI + process abort/limits |
| `vault.getMarkdownFiles()` | Privacy scope | Name search and on-demand research, max 600 recent files, `allowedPaths` on source bound research | scoped search regression |
| Clipboard writes | Capability | User-initiated copy of selected text and safe diagnostics only | UI interaction |
| `sessionStorage` | Capability | Dev-only sidebar restoration, not durable user data | dev hot-reload test |
| `vault.read`, `vault.create` | Preferred host APIs | Authorized learning workspace creation; editor edits use `replaceRange` for undo | workspace and mutation tests |

## Design-thinking decision (A/E/R)

**A — Success:** user installs 3-file release and can learn, research selected sources, run trusted providers, and approve note edits without corrupting vault data.

**E — Failure:** malformed CSS fails pre-release; bad OAuth disk data fails closed; external CLI fails safely without secrets in diagnostics; a successful editor mutation with failed receipt cannot execute twice.

**R — Requirements:** desktop-only flag; clearly documented network and external-file access; exact tag/manifest mapping; minimal bundle; no client-side telemetry or executable self-update; automatic cleanup of plugin lifetime handlers.

**Critical path:** CSS source → parser + build → three installed artifacts → official scanner → desktop smoke test → patch release.

## Delivery contract

1. CI parses plugin and landing CSS even for landing-only edits.
2. `pnpm verify` runs source CSS parser, TypeScript, ESLint, unit/integration, artifact and release checks.
3. Production CSS rejects `@source`, `@theme`, `@apply`, and Tailwind package imports.
4. Community review warnings are classified individually; no blanket `eslint-disable` or removal of necessary subprocess features.
5. This patch has no release metadata changes. Use a separate `1.1.1` release plan when acceptance is complete.

## Follow-up opportunities (not implemented in this patch)

- Reduce scoped `!important` selectors only after visual regressions across Obsidian default and community themes.
- Investigate sourcing UI timers from the owning view window for popped-out leaves; Node process timers are a separate lifecycle.
- Optional user-facing research scope controls when enumerating large vaults.
- Separate Tailwind source input from published plugin CSS filenames if community scanner continues to inspect uncompiled source as if distributable.
