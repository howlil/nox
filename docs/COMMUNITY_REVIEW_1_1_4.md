# NOX Community review 1.1.3 → 1.1.4

## Evidence and scope

Official Community scan of public `1.1.3` (commit `322f2db`, 2026-10-17): **Failed** with one explicit source error:
`src/settings/SettingsTab.ts:210: Avoid using "settings" in settings headings.`

The line used `new Setting(header).setName("Settings").setHeading()`. While `setHeading()` is the correct Obsidian API, **a heading literally named "Settings" is still forbidden**. The plugin-name sidebar already provides a page title. The original integration test incorrectly required that exact code, and GitHub's scanner action had `lint: false` with `scanner-lint: true`, generating a false appearance of equivalence to upstream review.

Upstream references:
- https://docs.obsidian.md/Plugins/Releasing/Plugin%20guidelines
- https://docs.obsidian.md/Plugins/User%20interface/Settings
- https://github.com/obsidianmd/eslint-plugin
- https://github.com/obsidianmd/obsidian-workflows

## $design-thinking: implementation graph

```text
X = published Community report + checked-out source + Obsidian API policy
  → decode reviewer findings by severity and trust boundary
  → locate exact SettingsTab call at rejected source line
  → remove redundant top-level heading, preserve settings store/navigation
  → expand AST P0 policy and invert outdated acceptance test
  → run deterministic unit/integration and active official scanner lint
  → verify release with source digest, attestation and 3 assets
  → publish NEW immutable patch release 1.1.4
```

**A (success):** no forbidden heading; P0 test reproduces prior rejection and passes after fix; real scanner executes (`lint: true`); release assets are attested to the source SHA and version.

**E (failure):** scanner source error (reject), regression fixture reappears (reject), build/attestation/release mismatch (reject), permission/network failure (fail closed), known historical scanner *warnings* (record and triage, but not silently relabel as zero).

**R (capabilities):** TypeScript AST and targeted tests, Obsidian CI runner, GitHub Actions/Release API. The separate Cloudflare landing pipeline is not executed or modified here. No manual desktop testing is claimed or required.

**Execution and resource lifetime:** single source-driven patch, serial version promotion, CI fan-out of Linux/Windows/scanner; publishing only after verification; no background state mutated when a gate fails.

## Warning classification (not an assertion of zero)

The activated Community scanner on the remediation PR reported **0 errors and 979 warnings** on the codebase. This is a real finding count, in contrast with the earlier disabled-lint summary. Warnings span multiple owners and are **not all fixed** by the P0 patch.

| Category | Ownership / decision |
| --- | --- |
| Landing React/Astro type warnings | Cloudflare marketing source; CI/deploy belongs to Cloudflare, but Community source scanner can still inspect repo paths |
| Plugin unsafe typed-value warnings | Audit external decoders/provider boundaries; avoid mass `as` casts and regression risks |
| Node `fs` and subprocess capabilities | Intentional desktop provider/auth runtime access; maintain permission disclosure and narrow trust boundaries |
| Vault enumeration and clipboard | Scope reads and user-initiated clipboard actions; verify appropriate privacy boundaries |
| Popout timers | Separate DOM/window timers from Node subprocess/network timers before changing them |
| CSS Tailwind directives, `!important`, old-Obsidian browser warnings | Check compiled `dist/styles.css` against `manifest.minAppVersion`; don't rewrite unrelated layout wholesale |

Strict scanner mode cannot presently block *all warnings* without blocking these historical categories. The local source AST rule specifically blocks the P0 finding actually reported. The upstream Community Directory remains a separate approval authority.

## Release policy

Public `1.1.3` assets, attestation, SHA and tag must remain unchanged: consumers may already have downloaded and cached these bytes. A compatibility/source fix must use a monotonic version `1.1.4`, with a new build and verifiable assets. Do not overwrite a published release to make its source differ from the previously attested binary.

## Automated proof

- Negative test: explicit `Settings`, `Plugin settings`, `Options`, `Nox` heading variants rejected.
- Positive test: named real section (e.g. `Provider accounts`) allowed.
- Existing 1.1.3 test requiring forbidden code inverted.
- Actual upstream scanner lint enabled; collect and report warning count.
- Linux plugin CI, Windows OAuth/DPAPI and artifact SHA validation remain mandatory.
