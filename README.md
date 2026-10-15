![NOX — AI Learning Companion for Obsidian](docs/assets/nox-banner.webp)

# NOX

**Turn your notes into understanding.**

NOX is an open-source AI learning companion for [Obsidian](https://obsidian.md). It works alongside your notes to help you explain ideas, practise recall, review material, and propose improvements to Markdown—without leaving your workspace.

[Get started](docs/GETTING_STARTED.md) · [Documentation](docs/README.md) · [Providers](docs/PROVIDERS.md) · [Report an issue](https://github.com/howlil/nox/issues)

[![CI](https://github.com/howlil/nox/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/howlil/nox/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-6f42c1)](LICENSE) ![Obsidian desktop](https://img.shields.io/badge/platform-Obsidian%20desktop-8653D5)

## What you can do

- **Learn in context.** Ask questions or request explanations using your current note, selected text, or explicitly attached Markdown context.
- **Practise, then review.** Answer interactive practice questions and receive feedback rather than treating AI replies as proof of learning.
- **Build a learning plan.** Create a goal-based curriculum, progress through prerequisite-aware activities, and review evidence of your learning over time.
- **Improve notes safely.** Preview proposed Markdown changes and choose whether to apply them through Obsidian.
- **Choose your runtime.** Connect a configured AGY CLI, Codex CLI, or eligible ChatGPT plan integration. NOX does not bundle an AI model or credits.

NOX is designed around a simple cycle:

```text
Your note or selection
        ↓
Explain → Practice → Review
        ↓
Learning evidence → Next activity
        ↓
Optional note edit → Review → Apply
```

## Install

**Requirements:** Obsidian **desktop 1.13.0+**. Mobile is not supported. An external AI provider is required for model-backed features.

**From Community Plugins** — once NOX is listed, open **Settings → Community plugins → Browse**, search for **Nox**, select **Install**, then **Enable**.

**From a GitHub Release** — before the listing is approved, use a separate test vault and download these files from a matching [NOX release](https://github.com/howlil/nox/releases):

```text
<vault>/.obsidian/plugins/nox/
├── main.js
├── manifest.json
└── styles.css
```

The configuration folder can differ if you changed Obsidian's default. Do not install GitHub's auto-generated source ZIP. Then enable **Nox** in Community plugins. For migration from the older development ID `nox-obsidian`, back up your plugin data and follow the [migration troubleshooting steps](docs/TROUBLESHOOTING.md).

## Connect an AI provider

| Provider | Before you start |
| --- | --- |
| **AGY CLI** | Install and authenticate AGY separately; configure the executable if necessary. |
| **Codex CLI** | Install Codex and sign in using `codex login`; select Codex in NOX settings. |
| **ChatGPT plan** | Select **ChatGPT plan → Continue with ChatGPT** and authorize access. Availability depends on account eligibility and limits. |

See [setup instructions, data handling, and provider limitations](docs/PROVIDERS.md). A successful sign-in does not guarantee access to model inference.

## Your first learning session

1. Open a Markdown note in Obsidian and select a paragraph.
2. Open **Nox** from the ribbon or command palette.
3. Ask a question about the selection or choose **Explain** or **Practice**.
4. To create a structured learning program, enter:

   ```text
   /plan Learn networking fundamentals | minutes=30 | sessions=3
   /start-session
   /next
   ```

Use `/hint`, `/progress`, or `/review-due` as your learning program requires. The [getting-started tutorial](docs/GETTING_STARTED.md) covers a complete example.

## Privacy and control

NOX uses the note content you choose to include as context. Content sent to an AI runtime **may be transmitted to its external provider**. Provider accounts, entitlements, and costs are separate from NOX; the AGY and Codex CLIs may also have file and network access according to their own settings.

ChatGPT sign-in credentials are stored outside the vault in user-local configuration. Sessions and learning progress are stored locally. **Proposed Markdown edits require your approval before applying.** Read the [provider and privacy guide](docs/PROVIDERS.md) before using NOX with sensitive notes.

## Documentation

| Guide | Purpose |
| --- | --- |
| [Getting started](docs/GETTING_STARTED.md) | Installation and your first note-based learning session |
| [Providers & privacy](docs/PROVIDERS.md) | AGY, Codex, ChatGPT, account and data considerations |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Installation, authentication, and runtime failures |
| [Learning programs](docs/LEARNING_ORCHESTRATOR.md) | Commands, curriculum rules, and progress semantics |
| [Development](docs/DEVELOPMENT.md) | Local build, testing, and hot reload |
| [Community review remediation](docs/COMMUNITY_REVIEW_1_1.md) | Design decisions, trust boundaries, verification and 1.1 release gates |
| [Full documentation](docs/README.md) | Technical reference and engineering context |

## Development

Requires Node.js 22 and pnpm 10.

```sh
pnpm install --frozen-lockfile
pnpm verify
```

Production plugin assets are generated under `dist/`. See [local development](docs/DEVELOPMENT.md) for watching, deployment to a test vault, and runtime diagnostics. Contributions should follow [CONTRIBUTING.md](CONTRIBUTING.md); vulnerabilities should be reported using [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Third-party components retain their own license notices where applicable.