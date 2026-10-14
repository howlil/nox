# Nox

Nox is an AI learning companion for Obsidian. It keeps explanation,
practice, review, and safe Markdown editing beside the note you are working on.

Nox is agent-runtime agnostic at the product boundary. The current runtime
adapters use the AGY CLI or local Codex CLI, while the UI and Learning OS flow depend on the
normalized agent contract rather than provider-specific stream events.

## What Nox does

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
- A configured AGY or Codex CLI runtime, signed in locally, to be
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
Codex runs read-only, and note changes still require a Nox proposal and Apply.
Codex model choices come from the local CLI's app-server catalog. Pick a model in
the chat menu, leave **Runtime default**, or enter an ID in **Preferred model**.
If discovery fails, the default and manual model remain available. Local Codex
user config is excluded for Nox turns. Catalog entries do not guarantee account
access; a completed turn verifies access to the selected model.

Executable paths can also be configured through `AGY_PATH` or `CODEX_PATH`.
Restart Obsidian after changing environment variables. On Windows, a native
`codex.exe` is required; common npm shims are resolved to their bundled native
binary, or you can configure that absolute path directly.

## Development commands

```sh
pnpm run dev               # watch the plugin bundle
pnpm run typecheck         # TypeScript check
pnpm run test:unit         # deterministic unit and state tests
pnpm run test:integration  # process, deploy, and boundary tests
pnpm run build             # production artifacts in dist/
pnpm run test:artifacts    # verify plugin identity and artifact contents
pnpm run verify            # complete local verification gate
```

`dist/` is generated output. Do not edit it directly.

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
