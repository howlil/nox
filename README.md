# Nox

Nox is an AI learning companion for Obsidian. It keeps explanation,
practice, review, and safe Markdown editing beside the note you are working on.

Nox is agent-runtime agnostic at the product boundary. The current runtime
adapters use AGY CLI, local Codex CLI, or the ChatGPT plan OAuth provider, while the UI and Learning OS flow depend on the
normalized agent contract rather than provider-specific stream events.

## What Nox does

Nox also supports opt-in **goal-based learning programs** across domains—not
just backend engineering. Create a validated curriculum from a goal, inspect
time-budget feasibility, practice objective-specific questions, and let the
application prioritize due retrieval and targeted remediation. Learning
programs are stored in `00-learning-os/programs.json`; assessed evidence
remains in `progress.json`.

### Learning program commands

```text
/plan Learn conversational Japanese | deadline=2026-12-01 | minutes=45 | sessions=3
/plan Understand this note | sources=active | minutes=30
/start-session
/next
/hint
/progress
/review-due
/end-session
```

If you omit time settings, Nox uses explicit application defaults of 45
minutes/session and 3 sessions/week. No deadline is invented.
`/plan` requires a configured and available agent runtime, and existing
Ask/Explain/Practice/Review/Edit workflows remain usable without a program.

See `docs/LEARNING_ORCHESTRATOR.md` for the decision policy and limitations.



- Uses the current selection or active note as explicit context.
- Streams answers into an Obsidian sidebar.
- Supports Ask, Explain, Practice, Review, and Edit learning actions.
- Tracks evidence-backed learning state in the vault.
- Shows proposed Markdown changes before applying them.
- Applies approved edits through Obsidian APIs so editor state and undo remain
  available.
- Persists sessions, model preferences, and structured learning cards in the plugin data.
- Restores an unanswered practice question with its original note context after reopening the sidebar or switching sessions.

## Requirements

- Obsidian desktop `1.4.0` or newer.
- Node.js and `pnpm` for development.
- For AGY or Codex: a configured CLI runtime, signed in locally, to be
  available on `PATH`, or at an absolute path configured in Nox settings.

## Setup

```sh
pnpm install
pnpm run verify
```

Open the plugin settings in Obsidian, choose **Agent provider**, and configure **Agent executable** if the
runtime is not discoverable on `PATH`. **Preferred model** may be left blank to
use the runtime default.

AGY is the default for existing installations. Codex uses the existing local CLI
login; Nox does not store an API key. Run `codex login` externally if needed.
Provider changes apply immediately while idle and refresh the model menu. Finish
or stop an active turn before changing runtime settings. Transcript and learning state are preserved;
runtime thread/model state is reset when it belongs to the previous provider.
Codex runs read-only, and note changes still require a Nox proposal and Apply.\n\n### ChatGPT plan (no API key)\n\nIn **Nox Settings → Agent provider**, select **ChatGPT plan**, then choose **Continue with ChatGPT**. Your default browser completes Sign in with ChatGPT using OAuth Authorization Code + PKCE. The local callback listens only on `127.0.0.1` and requires an exact matching `state`. Nox verifies the signed ID token and checks the granted `chatgpt.tokens.use.direct` scope. You must authorize plan use; identity-only sign-in does not enable inference.\n\nNox discovers models for the signed-in account, streams supported Responses requests with `store: false` and `stream: true`, and sends relevant local transcript history as input. ChatGPT plan inference has usage limits and may not support every Responses feature; no fallback to an API key or paid API billing is performed. Obsidian note selections/context are transmitted to OpenAI **only when you send a turn**. Nox still requires separate approval before applying any Markdown edit.\n\nThe issued client ID, host ID, tokens, and basic account profile are stored **outside the Obsidian vault** in the user-local Nox configuration folder (`LOCALAPPDATA\\nox` on Windows or `~/.config/nox` on Unix by default). Windows credentials are protected with current-user DPAPI; on Unix credential files use owner-only permissions (`0600`) and a private directory (`0700`). Do not sync or publish this directory. ChatGPT permission/token issues require **Reconnect ChatGPT**; **Disconnect ChatGPT** clears local tokens while retaining the original client registration. To check login without a browser, use the Codex CLI provider and run `codex login` once outside Obsidian.\n\n### ChatGPT model picker and response transport

Nox requests the signed-in account's model catalog from `https://api.openai.com/v1/models`
and inference from `https://api.openai.com/v1/responses` through Obsidian
`requestUrl` instead of an unbound Electron `window.fetch`. This avoids the
`Failed to execute 'fetch' on 'Window': Illegal invocation` failure and the
associated empty model catalog. The model menu now displays a discovery error
and a **Retry model discovery** action rather than hiding errors behind
`Runtime default`.

**Streaming trade-off:** Obsidian `requestUrl` buffers the whole HTTP
response, so Nox does not render tokens incrementally for this provider.
Nox still sends `store: false, stream: true`, parses SSE events, and
accepts only a terminal `response.completed`. Other CLI providers retain
their separate streaming implementations. Do not automatically repeat a
timed-out inference because it may already have been processed remotely.

### Obsidian OAuth network transport

ChatGPT OAuth token exchange and JWKS verification use Obsidian's `requestUrl` network
transport rather than renderer/Node global `fetch`. This avoids relying on the
Electron renderer's CORS behavior and may improve compatibility with the
network/proxy configuration used by Obsidian. All OAuth requests are restricted
to the official OpenAI authorization token and JWKS URLs; no authorization
code is sent to unrelated hosts. Timeouts stop waiting for responses, but
Obsidian's `requestUrl` cannot cancel the underlying request, so never
automatically retry a one-time authorization code.

If sign-in still reports `network_error`, verify that your network can reach
`https://auth.openai.com` from the Obsidian desktop environment. Test with
`curl.exe -I https://auth.openai.com/.well-known/jwks.json` in PowerShell,
which does not transmit any credential. Browser success alone does not prove
a plugin's HTTPS networking works.

### ChatGPT sign-in failure diagnostics

If the callback page says **ChatGPT connection failed**, return to **Obsidian → Settings → Nox → ChatGPT account**. The **Last ChatGPT sign-in error** row now shows the failing stage (registration, callback, token exchange, identity validation, or secure credential storage). Click **Copy diagnostic** to share the stage and a safe error code, **not** the browser callback URL, raw server response, access token, or authorization code.

For `invalid_grant`, start a fresh sign-in; authorization codes are single-use. For `credential_protection_failed`, check Windows PowerShell/DPAPI and the local Nox storage directory. For `identity_verification_failed`, the ID token was rejected and no new account was activated. When reauthorizing an existing issued client ID, it is normal for the callback to omit `client_id`—Nox uses its previously saved registration. Do not remove the local credential file as a troubleshooting shortcut; it retains your issued client registration and is encrypted on Windows.

Live consent, account entitlement, Windows browser callback, and refresh-token behavior require desktop testing with an eligible ChatGPT account. CI uses mocked auth and SSE transports; it does not exercise OpenAI production token issuance.
Codex model choices come from the local CLI's app-server catalog. Pick a model in
the chat menu, leave **Runtime default**, or enter an ID in **Preferred model**.
If discovery fails, the default and manual model remain available. Local Codex
user config is excluded for Nox turns. Catalog entries do not guarantee account
access; a completed turn verifies access to the selected model.

Executable paths can also be configured through `AGY_PATH` or `CODEX_PATH`.
Restart Obsidian after changing environment variables. On Windows, a native
`codex.exe` is required; common npm shims are resolved to their bundled native
binary, or you can configure that absolute path directly.

## Actions menu and welcome screen

The slash menu is deliberately small. Open **Actions** without a query to see
one contextual learning action, four note tools, and the program picker when
plans exist. With a query, search matches command/title prefixes and explicit
keywords. A single letter is **prefix-only** (`/s` should not show every action
whose description happens to contain an `s`). Duplicate program-ID commands
and legacy backend modes are not promoted into search results.

Legacy `/mode assessment`, `/mode focused`, `/pause`, and `/resume`
continue to work when typed explicitly in compatible learning modes. These
commands are retained for existing sessions, not recommended to new learners.

On an empty conversation, the welcome view shows the **same contextual primary
learning action** as the menu and four original soft-gradient note cards, each with\nits own purple/blue/coral/green accent, description, slash shortcut and metadata.
Clicking a note shortcut selects its intent without sending an AI request.
Creating a learning plan leaves the `/plan` prefix in the composer so the goal
can be entered. A complete session-action CTA can execute with one click.

Manual Obsidian acceptance checks: `/s` yields at most prefix matches; `/pro`
only matches intentional program/progress entries; `/legacy` and `/mode` do
not offer legacy modes; new/saved/active/answered states select an appropriate
primary CTA; initial shortcuts fit a normal sidebar without gradients or large
cards. Check the loaded build in Settings → Nox when the UI still shows old copy.

## Live development in Obsidian

NOX uses an incremental esbuild watcher, a separate Tailwind v4 watcher, and
an orchestrator that deploys completed artifacts to the selected local Obsidian
vault. You no longer need to close Obsidian or toggle the plugin after each
successful edit.

1. Install dependencies with `pnpm install`.
2. Enable **Settings → General → Command line interface** in a recent Obsidian
   desktop installation. Confirm `obsidian version` runs in your terminal.
3. Create an untracked `.env.local` in the repository root:

   ```dotenv
   NOX_DEV_VAULT=C:\\Users\\howlil\\Documents\\howlil
   NOX_DEV_RELOAD=cli
   # Optional if the Obsidian CLI uses a different vault name/id:
   # NOX_DEV_VAULT_NAME=howlil
   ```

4. Keep the target vault open in Obsidian, enable NOX once in Community Plugins,
   then run `pnpm dev`. Changing a TypeScript file or Tailwind source will
   build, sync, and request plugin reload automatically.

CLI reload targets `vault=<vault-name>` and `id=nox-obsidian`. The default
vault selector is the basename of `NOX_DEV_VAULT`; set
`NOX_DEV_VAULT_NAME` if the CLI uses a different name or unique ID, especially
when two vaults share the same name. The orchestrator prints the actual target
path and confirms that the installed `main.js` matches the build.

If Obsidian CLI is unavailable, install and enable the community developer
**Hot-Reload** plugin (pjeby/hot-reload), and set `NOX_DEV_RELOAD=hot-reload`.
The orchestrator creates the required `.hotreload` marker **only** in the
development vault's plugin directory. Do not enable CLI auto-reload and the
Hot-Reload plugin for the same plugin at once. Use `NOX_DEV_RELOAD=none` for
automatic builds/deploys without reload.

You can override local settings without editing files:

```sh
pnpm dev -- --vault "C:\\Path\\To\\Vault" --vault-name "Vault" --reload cli
```

**Failure behavior:** A failed TypeScript compilation does not sync the bundle;
the existing installed NOX remains unchanged. Repeated changes are debounced and
reloads are serialized. The dev build remembers an open NOX sidebar briefly
across a plugin reload, but in-flight AI turns can be canceled because full
plugin reload is not React-style module HMR. An unsent composer draft may be
lost. CLI command success confirms a reload request, not a completed end-to-end
runtime test: verify **Settings → Nox → Loaded plugin build** if necessary.

Production `pnpm build` never installs a `.hotreload` marker.

## Development commands

```sh
pnpm run dev               # watch, deploy to dev vault, and reload Obsidian
pnpm run typecheck         # TypeScript check
pnpm run test:unit         # deterministic unit and state tests
pnpm run test:integration  # process, deploy, and boundary tests
pnpm run build             # production artifacts in dist/
pnpm run test:artifacts    # verify plugin identity and artifact contents
pnpm run verify            # complete local verification gate
```

`dist/` is generated output. Do not edit it directly.

## Diagnose a stale Obsidian plugin runtime

If Nox still reports `Failed to execute 'fetch' on 'Window': Illegal invocation`
after updating source, verify the **running build** before debugging OpenAI or
switching network transports again. The current ChatGPT provider uses Obsidian
`requestUrl`; the old renderer `window.fetch` error may mean an older
`main.js` is still loaded.

1. In Obsidian open **Settings → Nox → Loaded plugin build** and note the
   **Git revision**, **built time**, **transport marker**, and **vault/plugin path**.
   If this section is absent, Obsidian is definitely running an older plugin.
2. In the local Nox checkout run `git pull origin master` and
   `git rev-parse --short=12 HEAD`. Build + deploy to the exact vault path
   shown in the running Obsidian instance:
   `pnpm run deploy "C:\\Actual\\Vault\\Path"`.
   Deployment now **refuses non-vault directories**, verifies the compiled
   `main.js` SHA256 after copying, and prints the installed path and hash.
3. **Fully reload** the installed Nox plugin in Obsidian (toggle the plugin
   off/on under Community plugins, use **Reload app without saving**, or
   restart Obsidian). Reopen Settings and confirm the embedded Git revision,
   build time, and `NOX_RUNTIME_TRANSPORT_V2:obsidian-requesturl` marker.
   Copy the *build diagnostic* if the values do not match the deployment.
4. Only after the loaded build is confirmed should you retry ChatGPT model
   discovery and a short inference prompt. If those fail, share the safe
   model picker/runtime error without any access token or OAuth callback URL.

The plugin `manifest.json` version is currently `0.0.1` across multiple
commits, so **manifest version alone cannot prove which code was loaded**.
A successful CI run or a successful deployment to some vault does not prove
the currently open Obsidian window has reloaded that bundle.

## Interactive practice cards

Nox Practice now supports typed AI-generated **multiple-choice, essay and code**
questions directly inside the conversation. Answers are submitted from the
question card, not the main composer. Multiple-choice grading uses the validated
answer key; essays and code receive AI rubric review. Code is **never executed**
in Obsidian. Unfinished drafts survive normal plugin/session reloads and
evaluations are committed to the existing evidence log.

See [Interactive Practice implementation, security and acceptance criteria](docs/INTERACTIVE_PRACTICE.md).

## Deploy to a local vault

Build and copy the generated plugin into an Obsidian vault with:

```sh
pnpm run deploy "C:\\Path\\To\\Your\\Vault"
```

The deploy command targets `.obsidian/plugins/nox-obsidian`, copies the
contents of `dist/`, and can update the vault's community plugin list. It does
not modify a vault unless a vault path is explicitly provided or configured
through `OBSIDIAN_VAULT`.

## Product flow

```text
selection or current note
        ↓
user intent
        ↓
Learning OS action
  ask / explain / practice / review / edit
        ↓
streamed response or practice state
        ↓
evidence-backed learning update
        ↓
optional proposed Markdown edit
        ↓
user review → Apply or Reject
```

Nox treats context as visible input, recommendations as proposals, and file
changes as user-approved mutations. A normal question is not treated as proof
of mastery; learning progress requires meaningful evidence.

## Architecture

Current implementation:

```text
ChatView
  ↓
LearningController (stable UI facade)
  ├── RunLearningTurn
  │     ├── ContextResolver / PolicyLoader
  │     ├── VaultLearningStore / SessionController
  │     └── AgentRuntime → AgyAdapter → AGY CLI
  └── MutationService (user-approved edits)
```

The canonical target boundaries and incremental migration path live in
`.agents/ENGINEERING_DESIGN.md`.

Provider protocol parsing stays behind the agent adapter boundary. The UI
consumes normalized learning events and never renders raw provider JSON.
Structured Practice/Review events are also saved into the canonical session
transcript; restoring history reuses the existing card renderers. Practice
origin remains pinned even when the active Obsidian note changes.

## Repository map

```text
src/
├── agent/       runtime contract and AGY adapter
├── application/ one-turn orchestration and execution lifecycle
├── chat/        Obsidian view, interaction surface, and learning-card rendering
├── context/     selection, note, and policy context
├── learning/    actions, practice, and learning state
├── mutation/    safe Markdown proposal application
├── persistence/ durable vault learning state
├── session/     conversation persistence/runtime coordination
└── settings/    Nox runtime settings

tests/           unit and integration behavior proofs
public/nox.png   canonical Nox brand asset
styles.css       Tailwind v4 design token and component entry
manifest.json    Obsidian plugin metadata
```

## Canonical design and engineering context

- `AGENTS.md` — development workflow and shipping rules.
- `.agents/PRODUCT_DESIGN.md` — product behavior, flows, states, scope, and acceptance criteria.
- `DESIGN.md` — detailed UI/visual system.
- `.agents/ENGINEERING_DESIGN.md` — architecture, boundaries, state ownership, testing, and migration direction.

Keep changes small, preserve one owner per rule, verify the actual risky
boundary, and run the relevant repository gates before shipping.
