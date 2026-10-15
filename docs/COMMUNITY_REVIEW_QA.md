# Obsidian Community review remediation and QA

Status: **Implementation in progress — desktop acceptance outstanding**
Baseline: reviewer scanner snapshot dated 2026-10-15, published NOX `0.1.0`, commit `d8e107e`. Snapshot status: **Pending / incomplete**. Scanner output is not an Obsidian approval or rejection decision.

## Evidence and scope

The scanner listed three source-code error rule groups: (1) `obsidianmd/no-static-styles-assignment` at 11 source locations; (2) detaching NOX leaves from `onunload()`; (3) an HTML heading created directly inside PluginSettingTab. The report also identified a lack of GitHub provenance attestations for `main.js` and `styles.css`, Node filesystem/subprocess capabilities, vault enumeration, clipboard writes, and web storage.

A large volume of warnings concerns the `landing/` Astro/React/third-party Arc UI project, which Cloudflare builds independently of the plugin. The community scanner may analyze source repository content; do not treat landing warnings as defects in Obsidian's shipped `main.js` without a corresponding runtime test. Never change Cloudflare deployment triggers to silence this scanner.

## Implemented in this patch

| Finding | Code boundary | Remediation | Automated QA | Desktop QA |
| --- | --- | --- | --- | --- |
| Leaf detach | `src/main.ts` | Leave workspace placement to Obsidian on unload; retain session-time flushing | Compliance regression source gate | Disable and re-enable after dragging sidebar to different location |
| Inline composer styles | `src/chat/composer.ts`, `styles.css` | `setCssProps(--nox-input-height)` and `is-overflowing` state class | CSS contract gate, existing composer build tests | Empty/one line/multiline/context chip/attachment, narrow sidepane |
| Swipe inline style | `src/chat/history-list.ts`, `styles.css` | CSS variable transform, `is-gesturing` for transition | Existing swipe release algorithm tests + CSS contract gate | Pointercancel, scroll, full swipe, delete confirmation, reduced motion |
| Motion hint | `src/chat/motion.ts`, `styles.css` | Scoped `nox-motion-active` class with completion/error cleanup | CSS contract gate | Reopen popover many times, do not leave GPU hints behind |
| Icon inline overrides | `src/chat/primitives.ts`, `styles.css` | Use existing scoped icon CSS and extra portal icon style | CSS contract gate | Inspect menu icons in forced theme and portal |
| Settings HTML heading | `src/settings/SettingsTab.ts` | Native `Setting.setHeading()` | Source compliance gate | Open all settings pages and verify heading/keyboard navigation |
| Missing provenance | `.github/workflows/release.yml` | Attest exact release JS, CSS and manifest; verify before public publish | Workflow contract gate | Verify downloaded assets with `gh attestation verify` after the **next** patch release |
| Provider diagnostics | `src/agent/AgyAdapter.ts`, `CodexAdapter.ts` | Do not log/return untrusted raw CLI stderr | Integration tests inject secrets in stderr | Fail provider and verify notice/console excludes tokens |
| Capability disclosure | `docs/PROVIDERS.md` | Describe OS credential storage, process execution, vault scope and clipboard | Documentation validation | Manual privacy/security review |

## Security invariants (must continue to hold)

1. Prompts, note contents, and authentication secrets never become shell-interpreted command strings or logged CLI stderr.
2. Agent runtime paths remain explicit executable paths or vetted local discovery; input uses stdin.
3. Codex `--sandbox read-only` and restrictive approval arguments are mandatory on the Codex execution path; do not extrapolate this to AGY.
4. ChatGPT OAuth tokens remain outside Obsidian's vault and use the existing secure Windows/Unix storage implementation. A provider can still have broader OS permissions; disclose that fact to the user.
5. Note edits go through the existing Obsidian mutation/approval boundary; do not grant a CLI the authority to apply proposed Markdown edits silently.
6. Released binaries are immutable. `0.1.0` remains the published baseline. Future changes go into a **new patch release** after validation.

## Residual findings and separate engineering decisions

These are **not** claimed fixed by this patch:

- `getSettingDefinitions()` / `this.update()`: Obsidian 1.13 declarative settings requires an end-to-end migration of NOX's custom Settings/Usage/Token tabs and serialized settings owner. Simply adding the method bypasses `display()` and would break the existing UX. Implement behind a dedicated PR with Obsidian desktop search/re-render/persistence tests.
- Other TypeScript unsafe-value and promise/timer warnings: review at typed provider protocol boundaries; avoid broad mechanical casting or turning Node process timers into browser window timers.
- CSS `:has`, `!important`, Tailwind `@theme`/`@source` warnings: triage compiled `dist/styles.css` vs source. Browser-support warnings against older versions must be checked against the manifest's minimum supported version before changing layout selectors.
- `builtin-modules` package replacement: change the build config and pnpm lockfile together in a separate build-only PR.
- Community scanner warnings and external repository `landing/` noise: do not force a strict failure on all baseline warnings without a reviewed suppression and ownership policy.
- Desktop OAuth, native editor Undo, provider network entitlement, actual pane persistence, theme rendering, and accessibility cannot be proven by mock-only CI.

## Acceptance checklist — disposable desktop vault

- [ ] New install in Obsidian 1.13+ using the CI preview `main.js`, `manifest.json`, `styles.css`
- [ ] Desktop plugin enable, disable, reload; sidebar remains in its manually chosen position
- [ ] Composer autosize with short/long/multiline message, attached files, 360px sidebar and zoom/reduced-motion
- [ ] Swipe both directions, pointercancel, scroll-close, confirmation modal, keyboard menu actions
- [ ] Settings three tabs, model/provider switch, ChatGPT sign in and sign out, persistence after restart
- [ ] AGY/Codex exits and failures do not disclose credentials in UI or developer console
- [ ] Restrict research context and verify only selected/allowed note text enters the provider request
- [ ] Runtime upgrade from 0.1.0 with backed-up data; no lost sessions
- [ ] Run the **latest** Obsidian community scan on the **new** patch release and compare rule groups with this snapshot
- [ ] Validate `gh attestation verify` for all three downloadable new-version assets

## Rollout

1. CI and integration tests on a review PR (no automatic publication).
2. Manual desktop acceptance and security/privacy inspection.
3. Merge remediation, then let `Prepare release PR` propose a patch bump from `0.1.0`.
4. Review/merge the release PR only after acceptance. The publishing job signs and verifies artifacts before publication.
5. Re-run community scanner on the newly published version and resolve remaining review items separately.
