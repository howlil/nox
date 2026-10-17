# Changelog

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

