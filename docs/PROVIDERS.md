# Agent providers and privacy

Nox implements the learning experience; inference runs through an **external provider**. Nox does not include a model, paid tokens, or a hosted AI account.

| Provider | Setup requirement | Network or file impact |
| --- | --- | --- |
| AGY CLI | Install and authenticate AGY separately; select executable | The chosen CLI/upstream service may access external files or network |
| Codex CLI | Install Codex and run `codex login` separately | CLI behavior is governed by its own permissions and services |
| ChatGPT plan | Sign in using explicit OAuth, with a supported account entitlement | OpenAI authentication, model discovery, and inference endpoints |

## Set up AGY or Codex

Install the CLI from its upstream project. Confirm the executable works in a terminal. In Nox settings select the provider and configure the absolute executable path if PATH discovery fails. For Codex, authenticate with `codex login` outside Obsidian. Credentials and provider billing are managed by the upstream tools.

## Set up ChatGPT plan

Select **ChatGPT plan → Continue with ChatGPT** and complete authorization in a browser. Your account must have the relevant inference permission and usage capacity; successful OAuth authentication alone is insufficient. Nox keeps OAuth credentials and basic account metadata outside the vault, using Windows user-local DPAPI protection or private Unix filesystem permissions where supported.

Disconnect from Nox settings to clear local tokens. Never share provider tokens, callback URLs, or the local configuration directory.

## Desktop capabilities and threat boundaries

NOX is a **desktop-only** Obsidian plugin. A community-plugin scanner correctly detects access to Node.js filesystem and subprocess APIs. These capabilities are not hidden permissions or unrestricted shell entrypoints exposed by the chat UI:

- **External filesystem:** the direct ChatGPT OAuth client stores its own identity and credentials in the OS user configuration directory (`%LOCALAPPDATA%\\nox\\chatgpt-auth.json` on Windows, or `$XDG_CONFIG_HOME/nox/chatgpt-auth.json`, defaulting to `~/.config/nox/chatgpt-auth.json`, on Unix). This is outside the vault to avoid syncing tokens with notes. Windows credential payloads use user-scoped DPAPI; Unix files use mode `0600` with a `0700` directory where supported. NOX does not claim that local administrator or malware on the user's OS can be isolated.
- **Shell/process execution:** the AGY and Codex integrations launch locally installed executables through Node `spawn()` with argument arrays, not shell-interpolated chat text. The Windows credential implementation also invokes a fixed PowerShell DPAPI command with its payload supplied via standard input. Provider executables are third-party software and may have independent filesystem/network permissions.
- **Provider boundaries:** Codex inference currently starts with `--sandbox read-only`, `approval_policy="never"`, and `--ignore-user-config`. This is a Codex-specific restriction, **not** a sandbox guarantee for arbitrary configured AGY executables. Review CLI trust and provider permissions before using NOX.
- **Vault enumeration:** filename search uses `vault.getMarkdownFiles()`; optional research indexes a bounded subset of Markdown notes only on demand. When `allowedPaths` is supplied it filters research candidates. Do not run broad research in a confidential vault without inspecting the requested context.
- **Clipboard:** user-triggered copy actions write diagnostics or selected text to the system clipboard. NOX does not intentionally read clipboard history.
- **Web storage:** `sessionStorage` is used only to remember development hot-reload sidebar intent; normal sessions and settings use the Obsidian plugin data repository.

The external-provider boundary must remain visible: a locally installed CLI can have **broader permissions than NOX's own Obsidian vault mutation flow**. Only install trusted binaries and use a disposable vault for a new provider.

## What data is accessed?

Nox may read the selected text, active Markdown notes, and explicit attached/researched context. Content actually supplied with an AI request can be transmitted to the selected provider. Nox stores sessions, progress, and usage locally and writes proposed Markdown edits only after approval. The CLIs may access files outside your vault independently of Nox and may contact external upstream services.

A separate provider subscription, account, entitlement, or usage-based cost can apply. Review each provider's own privacy and retention policies before sending confidential notes. Nox has no separate mandatory account to install the plugin.

Next: [Troubleshooting](TROUBLESHOOTING.md), [Architecture](../.agents/ENGINEERING_DESIGN.md).
