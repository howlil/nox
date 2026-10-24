# M6 — Browser-host proof

**Status:** private implementation proof; not a deployed web NOX application.

## Goal and architecture

The browser uses the **same** `@nox/core` LearningController,
RunLearningTurn, AgentRuntime, SessionController, SessionStore,
ContextResolver and learning-state codec as Obsidian/headless.

```text
Chrome (http://127.0.0.1, same origin across restarts)
  ├─ browser/src/composition.ts → canonical @nox/core learning engine
  │       ├─ fixture AgentAdapter only (no real credentials or provider)
  │       ├─ empty ContextSourcePort (no ambient vault/file access)
  │       └─ disabled editor mutation port (no fake Apply/Undo)
  └─ browser/src/BrowserWorkspace.ts → IndexedDB records
          ├─ "sessions" (serialized read-modify-write transaction)
          └─ "progress" (revision token + state decoder/CAS)
```

The IndexedDB read/modify/write callback executes **synchronously inside one
readwrite transaction**. Separate tabs coordinate via the database's
transaction serialization rather than an unrelated process lock. Each
`load()` of progress returns a snapshot tracked in a WeakMap with its
revision. `save(next, expected)` verifies revision atomically and throws
`LearningStateWriteConflict` for stale or unguarded overwrites. Malformed
stored progress must not be overwritten. Transaction aborts reject callers,
which prevents an uncommitted transcript being accepted by SessionController.
No durable write is considered complete until IDB `tx.oncomplete`.

## Real browser acceptance

Run:

```bash
pnpm browser:verify
```

Requires Google Chrome/Chromium (override `CHROME_BIN` if necessary).
The test runner serves the browser bundle over localhost and uses Chrome
DevTools Protocol to await asynchronous completion, never `dump-dom`
timers. It opens three independent browser processes with the same temporary
profile and stable origin:

1. **Ask → Practice question:** the actual engine emits responses, stores a
   pending question without granting evidence, receives no ambient note data,
   and two IndexedDB connections commit concurrent session updates.
2. **Restart → Practice answer:** a fresh controller restores the pending
   question from IDB, commits its terminal evaluation into the transcript,
   then persists exactly one learner evidence item.
3. **Restart → CAS:** a fresh controller verifies the evidence and previous
   concurrent session writes survived; stale evidence state is rejected and
   the prior committed evidence remains intact.

The CI gate runs after the existing unit/integration and portable
package/host checks, before the normal Obsidian release build. The bundle
is checked for forbidden Obsidian/Electron adapter imports and unresolved
runtime dependencies.

## A / E / R

- **A:** all user-visible Ask/Practice and transcript/evidence outcomes
  originate from the shared NOX engine, not browser-specific business logic.
- **E:** IndexedDB unavailable, quota/transaction abort, malformed state, stale
  evidence revision, missing provider output and unsupported editor capability
  must fail without promising a successful write or permission.
- **R:** one browser database object store with two record keys, browser-supplied
  IndexedDB and crypto, one injected AgentAdapter, no filesystem/auth/editor.

## Limits and release boundaries

This demonstrates **real Chrome/Chromium** only, using a fixed inference
fixture. It does not certify Firefox/Safari, private-mode quota behavior,
multi-device synchronization, browser storage durability against device failure,
a production web UI, CSP for remote deployment, or real AI authentication.
The browser proof offers no note or native editing access. IndexedDB storage
is per-origin: opening another origin uses a different database. There is no
automatic migration of Obsidian vaults or a public `@nox/core` release.

Neither `master` nor published NOX v1.3.2 is changed by this draft PR.
