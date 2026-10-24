# NOX runtime provenance and release reliability

## Runtime contract

The runtime records source revision, build timestamp, transport and
plugin/vault directories. Installed `main.js`, `manifest.json` and
`styles.css` have independently verifiable SHA-256 digests.

```text
Build source → deterministic plugin bundle + runtime identity
  → verify three installable artifacts
  → install/reload → compare running revision and installed digest
  → OAuth and model requests via Obsidian requestUrl
  → inference with Node HTTPS, timeout/abort and terminal SSE verification
  → durable RunLearningTurn outcomes
  → release CI (Linux, Windows, Community scanner, policy)
  → source SHA + signed artifact attestations + digest parity
  → publish only certified bytes
```

## Failure ownership

| Failure | Owner | Policy |
| --- | --- | --- |
| Missing plugin directory or mismatched bytes | Deploy script | Refuse false success |
| Loaded runtime and installed digest differ | Diagnostic command | Show difference, request reload |
| SSE timeout, abort or premature EOF | Provider transport | No silent POST replay or invalid commit |
| Corrupt program JSON | Program store | Fail program mutations closed |
| Missing attestation or SHA mismatch | Release workflow | Stop publication |
| Already-published version | Release workflow | Do not overwrite |

## Verification

`pnpm verify` runs portable architecture, session/evidence conformance,
headless and Chromium proof, Obsidian bundle and artifact tests.
Release certification adds Windows provider/DPAPI checks, Linux
reproducibility, upstream Community policy and attestations.

A disposable-vault smoke test may help investigate OS/UI/provider issues,
but it is not a mandatory publication gate. Never claim native behavior
has been tested when only mocks or scripted inference ran.
