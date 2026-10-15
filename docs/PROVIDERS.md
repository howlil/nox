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

## What data is accessed?

Nox may read the selected text, active Markdown notes, and explicit attached/researched context. Content actually supplied with an AI request can be transmitted to the selected provider. Nox stores sessions, progress, and usage locally and writes proposed Markdown edits only after approval. The CLIs may access files outside your vault independently of Nox and may contact external upstream services.

A separate provider subscription, account, entitlement, or usage-based cost can apply. Review each provider's own privacy and retention policies before sending confidential notes. Nox has no separate mandatory account to install the plugin.

Next: [Troubleshooting](TROUBLESHOOTING.md), [Architecture](../.agents/ENGINEERING_DESIGN.md).
