# Changelog

## [1.3.0]

### Features

- simplify first learning and recover approved plans
- refresh transparent hero mascot from NOX SVG
- add full NOX vector brand icon
- add traced NOX mascot SVG

### Fixes

- document new vector logo variants
- round brand icon edges
- refresh website favicon and footer logo
- refresh preview avatar to SVG
- use canonical NOX SVG in navbar
- assert embedded SVG branding
- use SVG data URI for plugin runtime

### Documentation

- fix NOX logo asset list formatting

## [1.2.1]

### Interactive learning and coding

- Add native, one-question-at-a-time NOX quiz rendering for multiple-choice and coding questions, including Previous/Next navigation, progress, answer retention, review, and restart.
- Introduce a shared CodeMirror 6 coding editor in Practice and structured quizzes, with intrinsic auto-height, wrapped long lines, lexical coloring for Java, JavaScript/TypeScript, Python and SQL, and safe textarea fallback.
- Bound coding answers to 40,000 characters, preserve the last valid draft on rejected input, and harden editor cleanup across transcript re-renders.
- Keep generated quiz coding responses review-only and ungraded; no compilation, execution, or claim of verified correctness.

### Visualizations and graph navigation

- Improve Mermaid diagrams with a shared Fit, Zoom, Pan and Expand viewport in compact Obsidian panes.
- Add opt-in `nox-flow` v2 rendering with labeled edges, grouped nodes, and local ELK orthogonal layout while retaining compatibility with v1.
- Introduce flat, light HTML preview styling and responsive content-height updates with bounded sandbox messages.

### Engineering and reliability

- Integrate responsibility-first architecture boundary research and migration guidance.
- Verify the reconciled graph and quiz changes together, including 551 unit and 123 integration tests on combined CI, plus code-editor stress and lifecycle regressions.
- Document bundled ELK licensing in `THIRD_PARTY_NOTICES.md` and the production JavaScript header.

### Compatibility and limitations

- Desktop-only; requires Obsidian 1.13.0 or later. No automatic migration of existing learning data is required.
- Coding quiz answers remain local to the mounted response; restarting or re-rendering the response starts a new quiz attempt. Native Practice draft persistence remains separate.
- Syntax coloring is lightweight lexical highlighting, not grammar-level diagnostics.
- Automated CI cannot establish pixel-perfect desktop behavior; live Obsidian Desktop acceptance for narrow panes, pop-outs and long code remains outstanding.

## [1.2.0]

### Adaptive learning

- Introduce evidence-driven learning programs with objective-level focus, prerequisite graphs, and self-paced study without mandatory timers.
- Adapt the next learning activity between diagnostic, teaching, guided practice, delayed recall, and transfer, using criterion-specific feedback and scaffolded remediation.
- Project an explainable learner mastery profile from committed revision-scoped practice evidence; historical unverified attempts do not falsely unlock prerequisites.
- Suggest and preview evidence-grounded curriculum revisions, with explicit approval, versioned snapshots, and the ability to revert the most recent eligible revision.
- Provide a compact learning dashboard with focus controls, mastery criteria, upcoming activities, evidence, and revision previews.
- Allow clarification of a pending practice question without grading the request; subsequent answers are treated as assisted.

### Source boundaries and reliability

- Retrieve approved note excerpts from relevant sections of long source notes within explicit processing budgets, preserving source provenance.
- Use provider capability checks to restrict source-bound curriculum planning to isolated inference transports without vault filesystem tools; unsafe CLI adapters remain denied.
- Harden persistence with optimistic concurrency checks, transcript-based evidence reconciliation, migration backup verification, and retry-safe recovery.
- Add regression coverage for v3 evidence eligibility, learning focus, source isolation, curriculum reversion, and fault recovery.

### Compatibility and limitations

- Desktop-only; requires Obsidian 1.13.0 or later. Existing learning history is retained.
- Source-bound planning requires an isolated provider adapter; AGY/Codex CLI transports do not currently qualify.
- Semantic curriculum reversion is supported only for the latest revision with a saved snapshot.
- Automated CI and artifact verification do not constitute live provider or Obsidian desktop acceptance.

## [1.1.4]

### Fixes

- remove invalid NOX settings heading and enable real scanner lint

## [1.1.3]

### Fixes

- Make configuration rows independently searchable through Obsidian 1.13 declarative settings while retaining segmented Settings/Usage/Token navigation.
- Enforce the official Community scanner as a blocking gate and guard known manual HTML heading regressions.

- Use the native Obsidian Setting heading in the Settings tab and align its styles with Obsidian's heading structure.

### Maintenance

- Remove GitHub-hosted landing/Cloudflare build checks; Cloudflare remains the sole landing CI/CD owner.
- Automatically publish only the exact attested plugin assets after Linux, Windows, and Community certification, with no manual desktop-test requirement.
- Separate fast development CI from release certification, including Windows DPAPI checks and reproducible production artifacts.
- Enforce an AST-based check against unsupported manual settings headings.
- Prepare attested release drafts first; require verification of exact assets and explicit desktop acceptance before public publication.

## [1.1.2]

### Fixes

- Harden agent lifecycle, OAuth recovery, and provider diagnostics.
- Enforce selected/folder research authority on final provider context, including ambient and historical data.
- Preserve committed assistant replies when study timer persistence fails.
- Keep model-free learning commands accessible while a provider is offline.
- Add regression coverage for scoped context, timer failure, and offline commands.
- Carry forward latest Obsidian popout, accessibility and CSS corrections from master.

## [1.1.1]

### Fixes

- Fix malformed literal newline escapes in the landing dialog stylesheet.
- Correct the production CSS validation so uncompiled Tailwind directives are rejected from release artifacts.
- Use Obsidian font variables with compatible generic font fallbacks.

### Quality and compatibility

- Add regression coverage for malformed CSS and compiled-artifact validation.
- Parse plugin and landing CSS in CI, including landing-only changes.
- Document the runtime call graph and review decisions for privileged provider and vault boundaries.

## [1.1.0]

### Compatibility

- Adopt Obsidian 1.13 declarative settings with searchable configuration and native Usage/Token pages.
- Align plugin unload with Obsidian's synchronous lifecycle while observing the final learning checkpoint.
- Replace an expensive quiz CSS `:has()` selector with explicit selection state.

### Security and reliability

- Validate persisted OAuth credentials before accepting scopes, expiration, or refresh tokens.
- Preserve authenticated provider transports and restricted subprocess boundaries.
- Use a supported Electron import boundary and Obsidian DOM helpers where appropriate.

### Engineering

- Replace deprecated `builtin-modules` with Node.js `builtinModules`.
- Add targeted regression tests for credential decoding, quiz state, settings, and unload behavior.
- Document Community review trade-offs, external provider permissions, and release acceptance criteria.

### Release caveats

- Desktop-only, requires Obsidian 1.13.0 or later.
- Provider capabilities depend on installed CLIs or account eligibility.
- Production publication requires separate native desktop smoke tests and the final Community review.

## [1.0.0]

### First major release

- Establish NOX 1.0.0 as the desktop Obsidian plugin release line. Requires Obsidian 1.13.0 or later.
- Include contextual note explanations, guided learning plans, practice and review flows, opt-in note edit proposals, and AGY, Codex, or authorized ChatGPT provider integrations from the current NOX codebase.

### Community review compatibility

- Preserve user-controlled sidebar placement when disabling or reloading the plugin.
- Move composer, history-swipe, icon, and motion style changes to Obsidian-compatible scoped CSS and dynamic custom properties.
- Render the settings heading with the native Obsidian Setting API.

### Security and release integrity

- Stop emitting raw AGY/Codex subprocess standard-error details into NOX diagnostics.
- Document local subprocess, filesystem, vault, clipboard, and credential-storage boundaries.
- Add tests for Community review regressions and credential-safe process failures.
- Generate and verify provenance attestations for main.js, manifest.json, and styles.css before publishing new release assets.

### Release limitations

- NOX remains desktop-only. Provider access depends on locally installed runtimes and account entitlements.
- Passing CI and release-provenance verification does not certify live provider connectivity or native Obsidian desktop acceptance.

## [0.1.0]

Initial public release candidate for the Nox desktop learning companion.

