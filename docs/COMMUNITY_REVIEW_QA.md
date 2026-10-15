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

## Follow-up: risk-focused hardening after 1.1.2 review

This change is a **new source patch on master**, not a mutation of previously distributed 1.1.2 artifacts.

- Plugin typed ESLint checks are deliberately strict only on the changed external
  provider and preview-window boundaries. Legacy unsafe-type warnings elsewhere
  require independent evidence before widening the gate. CI keeps the Community
  Directory scan as a separate, non-blocking source of warning data.
- `ChatGptAdapter` never sends arbitrary provider `message` / `code` strings,
  network exception bodies, credentials, or paths to the UI; known error classes
  map to stable messages. User cancellation is unchanged.
- `CodexAdapter.probe` caps stdout at 64 KiB, drains stderr, and has a three-second
  deadline. Its failures never forward a CLI-originating message.
- Rich-card/chart/flow and code preview DOM nodes use the target Obsidian surface's
  `ownerDocument`. Preview resize messages attach once per owner window, validate
  origin, source and instance ID, then release listeners when all previews exit.
- The Astro landing is tested in a **separate CI job** using the landing package's
  own installation, lint, check, and production build. It is *not* added to the
  Obsidian plugin's pnpm workspace or compiled plugin artifact.

### Manual desktop acceptance before next release

1. Install the GitHub Actions artifact from this commit into an isolated test vault.
2. Open Nox in a main window and in an Obsidian pop-out: verify chart, flow,
   card, Mermaid, copy button, and HTML/JS isolated preview sizing.
3. Close and reopen both windows; verify there are no duplicate resize responses
   or unhandled errors. Test disabled iframe, malicious postMessage source/ID.
4. Force HTTP/SSE and network failures with synthetic secret strings: no full
   provider message or credential should appear in the notice, chat, or logs.
5. Run Codex with malformed executable output: the health probe must end with
   a safe, bounded failure and should not send prompts.
6. On Windows verify existing OAuth credential decrypt/recovery, plus native
   Codex executable resolution. Do not substitute Linux-only process tests.

### Residual issues

- Obsidian capability warnings for approved local filesystem, subprocesses and
  vault enumeration are **intentional** for desktop providers; they are not proof
  that runtime controls can be removed.
- Unsafe-type warnings in the separately built landing package require its own
  correctly installed React/Motion/Astro type environment.
- True popout compatibility requires a manual Obsidian/Electron smoke test;
  fake-window tests prove listener ownership and cleanup only.
- Landing currently has no committed npm lockfile. Its CI job follows the
  independently deployed package's install approach, but it is not yet a
  fully reproducible dependency-resolution proof.


## CSS keyboard and cascade hardening — 2026-10-16

**Scope:** Nox plugin `styles.css`, model picker, history menu, composer.
The companion Astro landing remains an independent build and is not part of the
installable Obsidian CSS. This work does not change the plugin's visual layout,
the learning workflow, or the minimum supported Obsidian version.

### Verified source behavior

- `src/chat/menu.ts`: model picker keeps keyboard focus on the trigger and
  exposes the highlighted option using `aria-activedescendant`. Arrow movement
  changes `.is-active`; selecting a model is a different operation.
  Consequently `:focus-visible` on menu rows is insufficient. A high-contrast
  inset outline is also attached to `.is-active` and tested with the menu state.
- Keyboard-focus outlines are scoped to Nox buttons and actions affected by
  the previous reset, not to all Obsidian controls. The accent-ink token has a
  measured contrast above 3:1 against the default Nox page and soft accent fill.
  Filled primary and destructive buttons use an inset light ring.
- The composer keeps `.nox-composer-footer { display: contents; }`: this is a
  neutral div wrapper that makes the attachment, model, and send controls direct
  grid layout participants. Swapping this declaration for flex/grid would change
  position, Tab order, and sizing. The focus-within border uses the dark accent
  ink instead of the pale accent border.
- Removed 19 blanket `!important` declarations from model picker and history
  controls by increasing scoped selector specificity. Other `!important`
  declarations remain until Obsidian desktop computed styles demonstrate
  equivalence under native and community themes. Native Mermaid and
  reduced-motion handling are intentionally left intact.

### CSS warning policy

| Scanner report | Decision | Boundary |
| --- | --- | --- |
| `@source` / `@theme` | Tailwind v4 **input directives**; keep them | Plugin build must reject uncompiled directives in `dist/styles.css` |
| `text-decoration-color` | Decorative text-underline enhancement | Source compatibility warning; basic underline remains |
| `column-gap` / multicolumn | Flexbox gap in quiz heading, not CSS multicolumn | Visual check at minimum supported version |
| `display: contents` | Keep until an actual composer layout or accessibility regression is proven | Focus, layout, screen-reader desktop acceptance |
| `clip-path` in `landing/` | Landing-only clip/morph/accessibility styles | Separate Astro React build; not the plugin artifact |
| Remaining `!important` | Review by owned component, no blanket removal | Computed-style comparison under themes |

### Proof and remaining acceptance

Automated tests in `tests/chat/keyboard-css.test.ts` check focus rule
presence, color contrast, active/selected styling boundaries, cascade scope
and composer layout policy. `tests/chat/menu.test.ts` also checks the
`openAt → setRows → move → syncTrigger → close` sequence. These are
**source + state invariants**, not a substitute for computed browser styles.

Before the next plugin release, manually exercise an installable CI artifact
on the minimum supported Obsidian version and latest desktop version.
In the main and popout window, check at least: Tab to model trigger, Arrow
navigation with visually distinct active and selected models, Escape/Enter,
history tabs/actions (including destructive action), composer short/multiline,
attachment chips, disabled/hover/focus states, 320px sidebar, reduced-motion,
default/light/dark and one community theme. Inspect `getComputedStyle` to
confirm `outline-style: solid`, `outline-width: 2px`, and owner/theme
colors; also verify that focusing a button does not change its box size.

The following CSS warnings may remain after these changes. Warning count alone
is neither security evidence nor a release-acceptance criterion.
