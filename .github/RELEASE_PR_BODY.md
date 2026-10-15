## Public release checklist

This PR updates the version manifest, package version, release plan, and changelog. Merging it will trigger a **public GitHub Release** if automated validation succeeds.

- [ ] Version is exactly `x.y.z` (no `v`), and changes are justified by SemVer.
- [ ] Linux CI and Windows provider/DPAPI tests passed.
- [ ] Installed **only** `main.js` + `manifest.json` + `styles.css` in a disposable Obsidian desktop vault.
- [ ] Sidebar, logo, commands, settings, plan/practice, note edit approval, and plugin reload were checked.
- [ ] Provider login, inference, streaming, and disconnect were exercised on the target platform.
- [ ] Old plugin ID data migration considered; no data loss observed in the tested path.
- [ ] README/disclosures and third-party license attribution updated as needed.
- [ ] Release notes are accurate and omit unreleased/incomplete features.
- [ ] Owner approved publication to the GitHub Releases page.

**Do not merge without recording manual desktop acceptance results.** A passing CI run is not a live Obsidian acceptance test.
