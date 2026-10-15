# Changelog

## [1.0.1]

### Fixes

- community review compatibility, security, and UI remediation

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

