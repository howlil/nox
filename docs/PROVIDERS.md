# Providers & privacy

Nox runs inference through an **external AI provider**. It includes no model, account, credits, or paid usage.

| Provider | Connect | Important limit |
| --- | --- | --- |
| AGY CLI | Install and authenticate the CLI; select its executable in Nox. | The executable may have its own file/network access. |
| Codex CLI | Install Codex and run \`codex login\`; select Codex in Nox. | CLI permissions and upstream usage terms apply. |
| ChatGPT plan | **Settings → Nox → ChatGPT plan → Continue with ChatGPT**. | Account eligibility and usage limits apply; sign-in does not guarantee inference access. |

If a CLI is not found, configure its absolute executable path. Never share tokens, callback URLs, or credential files.

## What leaves your vault?

Nox may read selected text, your active note, or explicitly attached/researched Markdown. **Text supplied to AI requests can leave your device for the chosen provider.** An external CLI can independently access files or the network beyond Nox's selected context; do not treat note scoping as an OS sandbox.

- Sessions, learning progress, and token usage are stored locally in Obsidian plugin data.
- Proposed Markdown edits are applied only after your approval.
- ChatGPT OAuth credentials are stored **outside the vault** in user-local config: \`%LOCALAPPDATA%\\nox\\chatgpt-auth.json\` on Windows; \`$XDG_CONFIG_HOME/nox/chatgpt-auth.json\` (default \`~/.config/nox/chatgpt-auth.json\`) on Unix. Windows uses user-scoped DPAPI; Unix uses private file/directory permissions where supported.
- Disconnect in Nox settings to clear credentials. If local credentials become unreadable, **Back up and reset credentials** preserves a recovery copy before clearing sign-in.

## Research scope

\`\`\`text
/research question
/research --scope=selected question
/research --scope=folder:"Study Notes" question
/research --scope=vault question
\`\`\`

Broad research indexes up to 600 recent Markdown notes on demand. Selected/folder modes constrain the **final provider-bound context**, including historical context; they are not a guarantee against every local read. Strict source-bound curricula require an isolated provider capability—AGY/Codex CLI transports are not assumed isolated.

## Desktop permissions

Nox uses Node.js desktop APIs to launch configured CLI executables (argument-based \`spawn\`) and protect local OAuth credentials. It may enumerate Markdown filenames for search; copy actions write to the clipboard when triggered by you. Nox does not intentionally read clipboard history or use browser local/session storage as its data store.

The Codex adapter uses its documented read-only invocation settings; this does not restrict other external binaries. Review each provider's data retention, billing, and permissions before using confidential notes.

[Get started](GETTING_STARTED.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Security](../SECURITY.md)
