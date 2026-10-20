# NOX runtime provenance and desktop release acceptance

Status: implementation staged; **native Obsidian acceptance NOT RUN**. Do not report desktop PASS or publish from this branch.

## Implementation graph — $design-thinking

### Shapes
- `RuntimeBuildIdentity`: in-memory `revision`, `builtAt`, `transport`, `pluginDir`, `vaultDir`.
- `InstalledArtifact`: filesystem `main.js`, `manifest.json`, `styles.css` verified by SHA-256.
- `DesktopAcceptance`: version, testedCommit, platform, Obsidian version, reviewer, testedAt and D01–D10 evidence.
- `TransportOutcome`: incremental SSE bytes, abort, timeout, incomplete EOF or oversized stream.

### A — successful flow

```text
Build source -> dist bundle + metadata -> deploy validated 3-file artifact
  -> installed SHA-256 verification
  -> Obsidian loads plugin / in-memory build identity
  -> "Nox: Copy runtime diagnostics" -> installed main.js digest + mismatch warning
  -> ChatGPT OAuth via Obsidian requestUrl
  -> GET models via Obsidian requestUrl
  -> POST inference via Node HTTPS -> SSE terminal response.completed
  -> RunLearningTurn persists eligible outcomes
  -> native desktop D01-D10 -> source-bound acceptance record
  -> release certification -> publish only attested bytes
```

### E — failures and recovery ownership

| Failure | Owner | Policy |
| --- | --- | --- |
| Invalid vault, dist missing or byte mismatch | deploy script | fail before enabling plugin; no false success |
| Different running build and on-disk bundle | diagnostic command | show loaded identity and disk hash separately; require reload |
| HTTPS error, abort, timeout, nonterminal SSE | transport / adapter | no silent POST replay, no actionable structured commit |
| Corrupt program JSON | program store / LearningController | program actions fail closed; ordinary chat may continue |
| No native desktop acceptance | publishing workflow | stop both automated and manual recovery publication |
| Runtime code changed after acceptance | release proof | reject stale testedCommit until D01-D10 re-executed |

### R — capabilities

`Obsidian workspace`, `requestUrl`, Node HTTPS, local filesystem, OS clipboard, release Git metadata and a human desktop reviewer. No new credential storage, inference service, external telemetry or automatic retries.

### Verification strategy

- Unit: relative/absolute or missing plugin directory; runtime/disk identity mismatch.
- Integration: deploy validates all three installed SHA-256 hashes and excludes unrelated dist output.
- Windows: Node HTTPS SSE success, abort, timeout, premature EOF and 16 MiB size ceiling; OAuth and buffered Obsidian transport tests stay active.
- Release: missing, incomplete, fabricated-looking or stale acceptance record blocks publication. A GitHub evidence URL alone is not proof of execution; human review remains mandatory.
- Real desktop: D01–D10 from `ARCHITECTURE_DESKTOP_ACCEPTANCE.md` must be conducted in a disposable vault; not executable here.

## Operational steps

1. Install candidate in the **actual** test vault. Reload the plugin or restart Obsidian.
2. Open command palette → **Nox: Copy runtime diagnostics**; redact local directory paths before sharing.
3. Compare `installedMainSha256` with the deployed hash and check `diskMatchesLoadedIdentity=yes`. For a release, `loadedRevision` should be `release/x.y.z`; development builds report git revision.
4. Exercise short and long streaming prompts, cancel and resume, provider switch and privacy boundaries.
5. Execute D01–D10 and upload redacted logs/videos/snapshots to stable GitHub issue or PR comments.
6. Commit `docs/desktop-acceptance.json` containing actual results, with the following shape **only after all ten pass**:

```json
{
  "version": "x.y.z",
  "testedCommit": "<full tested 40-hex SHA>",
  "platform": "win32",
  "obsidianVersion": "1.13.0",
  "reviewer": "<human reviewer>",
  "testedAt": "<ISO-8601>",
  "cases": [
    { "id": "D01", "status": "PASS", "evidenceUrl": "https://github.com/owner/repo/issues/..." }
  ]
}
```

The example intentionally omits D02–D10 and cannot pass the validator as-is.
The tested commit must be a release ancestor, with no `src/`, `styles.css`, `scripts/`, `tests/`, `.github/workflows/` or build-config changes afterward. Release metadata and acceptance record changes are allowed. All ten evidence URLs must be genuine, inspected and safely redacted.

```sh
node scripts/verify-desktop-acceptance.mjs
pnpm verify
```

No desktop acceptance record is added by this change. In particular, no mock test is treated as human evidence.
