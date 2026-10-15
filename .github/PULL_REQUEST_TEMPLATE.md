## Problem and outcome

What user or developer problem does this solve? State the observable before/after behavior.

## Changes and affected boundaries

Describe relevant modules, state ownership, external providers, vault I/O, and permissions. For behavior changes, link the affected [public docs](../docs/README.md) or explain why none change.

## Evidence

- [ ] `pnpm verify` (or list exactly which gates were run).
- [ ] Unit/integration regression coverage for changed behavior where appropriate.
- [ ] Manual Obsidian desktop acceptance for changed UI, OS integration, or real provider behavior.
- [ ] No new secrets, telemetry, unapproved edits, or unreviewed external file/network access.
- [ ] README/privacy disclosure updated for new external provider or data handling.

## Risks and rollback

Describe possible data migration, plugin ID/path changes, version impact, known limitations, and safe rollback.

**Releases:** Never tag or publish from this PR. Use the [release PR workflow](../docs/RELEASING.md) after merging ordinary changes.
